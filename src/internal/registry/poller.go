package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/gitsync"
	"github.com/mkolb22/dockercd/internal/store"
)

// ImagePolicyLabel is the Docker Compose service label that enables image auto-update.
// Value should be the policy: "semver", "major", or "minor".
const ImagePolicyLabel = "com.dockercd.image-policy"

// PollerConfig holds configuration for the image update poller.
type PollerConfig struct {
	PollInterval    time.Duration
	DefaultRegistry string

	// MaxConcurrentChecks limits concurrent repository groups checked in a poll.
	// Apps sharing a repository are kept in the same group to avoid concurrent
	// compose-file and Git updates in one worktree.
	MaxConcurrentChecks int

	// CheckTimeout bounds all filesystem, registry, and Git work for one app
	// during a background poll.
	CheckTimeout time.Duration
}

// DefaultPollerConfig returns the default poller configuration.
func DefaultPollerConfig() PollerConfig {
	return PollerConfig{
		PollInterval:        300 * time.Second, // 5 minutes
		DefaultRegistry:     "",                // empty means Docker Hub
		MaxConcurrentChecks: 4,
		CheckTimeout:        30 * time.Second,
	}
}

// ReconcileTrigger triggers reconciliation for an app.
type ReconcileTrigger interface {
	TriggerReconcile(appName string)
}

// Poller periodically checks registries for new image tags and updates compose files.
type Poller struct {
	checker   TagChecker
	gitSyncer gitsync.GitSyncer
	store     *store.SQLiteStore
	trigger   ReconcileTrigger
	logger    *slog.Logger
	config    PollerConfig

	cancelMu sync.Mutex
	cancel   context.CancelFunc
	wg       sync.WaitGroup

	pollMu      sync.Mutex
	pollRunning bool
}

// NewPoller creates an image update Poller.
func NewPoller(
	checker TagChecker,
	gs gitsync.GitSyncer,
	st *store.SQLiteStore,
	trigger ReconcileTrigger,
	logger *slog.Logger,
	cfg PollerConfig,
) *Poller {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = DefaultPollerConfig().PollInterval
	}
	if cfg.MaxConcurrentChecks <= 0 {
		cfg.MaxConcurrentChecks = DefaultPollerConfig().MaxConcurrentChecks
	}
	if cfg.CheckTimeout <= 0 {
		cfg.CheckTimeout = DefaultPollerConfig().CheckTimeout
	}
	return &Poller{
		checker:   checker,
		gitSyncer: gs,
		store:     st,
		trigger:   trigger,
		logger:    logger,
		config:    cfg,
	}
}

// Start begins the image update polling loop. It blocks until ctx is canceled.
func (p *Poller) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	p.cancelMu.Lock()
	p.cancel = cancel
	p.cancelMu.Unlock()

	p.wg.Add(1)
	go p.pollLoop(ctx)

	<-ctx.Done()
	p.wg.Wait()
	return nil
}

// Stop cancels the poller.
func (p *Poller) Stop() {
	p.cancelMu.Lock()
	cancel := p.cancel
	p.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (p *Poller) pollLoop(ctx context.Context) {
	defer p.wg.Done()

	// Initial check after a short delay to let other components start first.
	t := time.NewTimer(30 * time.Second)
	select {
	case <-ctx.Done():
		t.Stop()
		return
	case <-t.C:
	}

	p.startCheckAllApps(ctx)

	ticker := time.NewTicker(p.config.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.startCheckAllApps(ctx)
		}
	}
}

// startCheckAllApps starts a poll only when the previous poll has completed.
// Ticker events are intentionally skipped rather than queued: a delayed
// registry or Git server must not turn the periodic poll into continuous work.
func (p *Poller) startCheckAllApps(ctx context.Context) {
	p.pollMu.Lock()
	if p.pollRunning {
		p.pollMu.Unlock()
		p.logger.Debug("image poll skipped: previous poll is still running")
		return
	}
	p.pollRunning = true
	p.pollMu.Unlock()

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		defer func() {
			p.pollMu.Lock()
			p.pollRunning = false
			p.pollMu.Unlock()
		}()
		p.checkAllApps(ctx)
	}()
}

type pollTarget struct {
	record      store.ApplicationRecord
	application app.Application
}

func (p *Poller) checkAllApps(ctx context.Context) {
	apps, err := p.store.ListApplications(ctx)
	if err != nil {
		p.logger.Error("image poller: failed to list applications", "error", err)
		return
	}

	// Group by repository so concurrent workers never modify or push the same
	// local worktree at the same time.
	byRepo := make(map[string][]pollTarget)
	for _, appRec := range apps {
		var application app.Application
		if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
			continue
		}
		byRepo[application.Spec.Source.RepoURL] = append(byRepo[application.Spec.Source.RepoURL], pollTarget{
			record:      appRec,
			application: application,
		})
	}

	jobs := make(chan []pollTarget)
	var workers sync.WaitGroup
	workerCount := min(p.config.MaxConcurrentChecks, len(byRepo))
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for group := range jobs {
				for _, target := range group {
					if ctx.Err() != nil {
						return
					}
					p.checkApplication(ctx, target.record, target.application)
				}
			}
		}()
	}
	for _, group := range byRepo {
		select {
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return
		case jobs <- group:
		}
	}
	close(jobs)
	workers.Wait()
}

func (p *Poller) checkApplication(ctx context.Context, appRec store.ApplicationRecord, application app.Application) {
	checkCtx, cancel := context.WithTimeout(ctx, p.config.CheckTimeout)
	defer cancel()

	repoPath := p.gitSyncer.RepoPath(application.Spec.Source.RepoURL)
	if repoPath == "" {
		return
	}

	composePath := repoPath
	if application.Spec.Source.Path != "" && application.Spec.Source.Path != "." {
		composePath = filepath.Join(repoPath, application.Spec.Source.Path)
	}

	for _, cf := range application.Spec.Source.ComposeFiles {
		filePath := filepath.Join(composePath, cf)
		if err := p.checkComposeFile(checkCtx, appRec.Name, application.Spec.Source.RepoURL, filePath, cf); err != nil {
			p.logger.Debug("image poller: error checking compose file",
				"app", appRec.Name,
				"file", cf,
				"error", err,
			)
		}
	}
}

// composeServiceRaw is a minimal representation of a compose service for label/image extraction.
type composeServiceRaw struct {
	Image  string            `yaml:"image"`
	Labels map[string]string `yaml:"labels"`
}

// composeFileRaw is a minimal representation of a compose file for image policy scanning.
type composeFileRaw struct {
	Services map[string]composeServiceRaw `yaml:"services"`
}

func (p *Poller) checkComposeFile(ctx context.Context, appName, repoURL, filePath, relPath string) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	var raw composeFileRaw
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing compose file: %w", err)
	}

	updated := false
	content := string(data)

	for svcName, svc := range raw.Services {
		policyStr, ok := svc.Labels[ImagePolicyLabel]
		if !ok {
			continue
		}
		policy := ImagePolicy(policyStr)

		imageName, currentTag := ParseImageRef(svc.Image)
		if currentTag == "" || currentTag == "latest" {
			// Cannot do semver matching on digest refs or the "latest" tag
			continue
		}

		tags, err := p.checker.ListTags(ctx, imageName)
		if err != nil {
			p.logger.Debug("image poller: failed to list tags",
				"app", appName,
				"service", svcName,
				"image", imageName,
				"error", err,
			)
			continue
		}

		latestTag, found := FindLatestTag(tags, currentTag, policy)
		if !found {
			continue
		}

		p.logger.Info("image update available",
			"app", appName,
			"service", svcName,
			"current", svc.Image,
			"latest", imageName+":"+latestTag,
		)

		// Replace the image reference in the compose file content.
		// Use strings.Replace with n=1 to replace the first occurrence only.
		oldRef := svc.Image
		newRef := imageName + ":" + latestTag
		content = strings.Replace(content, oldRef, newRef, 1)
		updated = true
	}

	if !updated {
		return nil
	}

	fi, err := os.Stat(filePath)
	mode := os.FileMode(0644)
	if err == nil {
		mode = fi.Mode()
	}
	if err := os.WriteFile(filePath, []byte(content), mode); err != nil {
		return fmt.Errorf("writing updated compose file: %w", err)
	}

	message := fmt.Sprintf("chore(image): update images for %s", appName)
	if err := p.gitSyncer.Commit(ctx, repoURL, message, []string{relPath}); err != nil {
		return fmt.Errorf("committing image update: %w", err)
	}
	if err := p.gitSyncer.Push(ctx, repoURL); err != nil {
		return fmt.Errorf("pushing image update: %w", err)
	}

	p.logger.Info("image update committed and pushed", "app", appName)

	// Trigger reconciliation so the new image is deployed immediately.
	p.trigger.TriggerReconcile(appName)

	return nil
}
