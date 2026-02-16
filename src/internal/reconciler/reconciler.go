// Package reconciler orchestrates the reconciliation loop for all applications.
// It wires together git sync, parser, inspector, differ, and deployer into
// the core reconciliation algorithm with a scheduler and worker pool.
package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/deployer"
	"github.com/mkolb22/dockercd/internal/differ"
	"github.com/mkolb22/dockercd/internal/gitsync"
	"github.com/mkolb22/dockercd/internal/health"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/parser"
	"github.com/mkolb22/dockercd/internal/store"
)

// Reconciler orchestrates the reconciliation loop for all applications.
type Reconciler interface {
	// Start begins the reconciliation loop. Blocks until ctx is canceled.
	Start(ctx context.Context) error

	// Stop gracefully stops the reconciler and waits for in-flight
	// reconciliations to complete (with timeout).
	Stop(ctx context.Context) error

	// TriggerReconcile queues an immediate reconciliation for the named app.
	TriggerReconcile(appName string)

	// ReconcileNow performs a synchronous reconciliation for the named app.
	ReconcileNow(ctx context.Context, appName string) (*app.SyncResult, error)
}

// Deps holds all dependencies needed by the reconciler.
type Deps struct {
	GitSyncer     gitsync.GitSyncer
	Parser        parser.ComposeParser
	Inspector     inspector.StateInspector
	Differ        differ.StateDiffer
	Deployer      deployer.Deployer
	HealthMonitor *health.Monitor
	Store         *store.SQLiteStore
	Logger        *slog.Logger

	WorkerCount int
}

// ReconcilerImpl implements Reconciler with a worker pool and scheduler.
type ReconcilerImpl struct {
	deps Deps

	// Worker pool
	workQueue chan string
	workers   int

	// Scheduling
	schedule   map[string]time.Time
	scheduleMu sync.RWMutex
	trigger    chan string

	// Per-app locking
	appLocks sync.Map // map[string]*sync.Mutex

	// Circuit breakers
	breakers   map[string]*CircuitBreaker
	breakersMu sync.Mutex

	// Lifecycle
	wg     sync.WaitGroup
	cancel context.CancelFunc
	logger *slog.Logger
}

// New creates a ReconcilerImpl with the given dependencies.
func New(deps Deps) *ReconcilerImpl {
	workers := deps.WorkerCount
	if workers <= 0 {
		workers = 4
	}

	return &ReconcilerImpl{
		deps:      deps,
		workQueue: make(chan string, workers*2),
		workers:   workers,
		schedule:  make(map[string]time.Time),
		trigger:   make(chan string, 16),
		breakers:  make(map[string]*CircuitBreaker),
		logger:    deps.Logger,
	}
}

// Start begins the scheduler and worker pool. Blocks until ctx is canceled.
func (r *ReconcilerImpl) Start(ctx context.Context) error {
	ctx, r.cancel = context.WithCancel(ctx)

	// Load all apps and schedule immediate first reconciliation
	apps, err := r.deps.Store.ListApplications(ctx)
	if err != nil {
		return fmt.Errorf("loading applications: %w", err)
	}

	r.scheduleMu.Lock()
	for _, a := range apps {
		r.schedule[a.Name] = time.Now()
	}
	r.scheduleMu.Unlock()

	r.logger.Info("starting reconciler",
		"workers", r.workers,
		"apps", len(apps),
	)

	// Start workers
	for i := 0; i < r.workers; i++ {
		r.wg.Add(1)
		go r.worker(ctx, i)
	}

	// Start scheduler
	r.wg.Add(1)
	go r.schedulerLoop(ctx)

	// Block until context is canceled
	<-ctx.Done()

	// Wait for in-flight work with timeout
	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()

	select {
	case <-done:
		r.logger.Info("reconciler stopped gracefully")
		return nil
	case <-time.After(30 * time.Second):
		return fmt.Errorf("shutdown timeout: workers did not finish in 30s")
	}
}

// Stop cancels the reconciler context and waits for shutdown.
func (r *ReconcilerImpl) Stop(_ context.Context) error {
	if r.cancel != nil {
		r.cancel()
	}
	return nil
}

// TriggerReconcile queues an immediate reconciliation for the named app.
func (r *ReconcilerImpl) TriggerReconcile(appName string) {
	select {
	case r.trigger <- appName:
	default:
		// Trigger channel full — will be picked up next cycle
		r.logger.Debug("trigger channel full, skipping", "app", appName)
	}
}

// ReconcileNow performs a synchronous reconciliation for the named app.
func (r *ReconcilerImpl) ReconcileNow(ctx context.Context, appName string) (*app.SyncResult, error) {
	lock := r.getAppLock(appName)
	lock.Lock()
	defer lock.Unlock()

	return r.reconcileApp(ctx, appName, true)
}

// reconcileApp runs the full reconciliation algorithm for a single application.
func (r *ReconcilerImpl) reconcileApp(ctx context.Context, appName string, forced bool) (*app.SyncResult, error) {
	startTime := time.Now()
	result := &app.SyncResult{
		AppName:   appName,
		StartedAt: startTime,
		Operation: app.SyncOperationPoll,
	}
	if forced {
		result.Operation = app.SyncOperationManual
	}

	logger := r.logger.With("app", appName)

	// Look up the application from the store
	appRec, err := r.deps.Store.GetApplication(ctx, appName)
	if err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("store error: %v", err), logger)
	}
	if appRec == nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("application %q not found", appName), logger)
	}

	// Deserialize manifest to get app spec
	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("invalid manifest: %v", err), logger)
	}

	// Check circuit breaker
	breaker := r.getBreaker(appName)
	if !breaker.Allow() {
		logger.Debug("circuit breaker open, skipping reconciliation")
		return r.finishResult(ctx, result, app.SyncResultSkipped, "circuit breaker open", logger)
	}

	// STEP 1: Git Sync
	logger.Debug("syncing git repository")
	headSHA, err := r.deps.GitSyncer.Sync(ctx, application.Spec.Source)
	if err != nil {
		breaker.RecordFailure()
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("git sync failed: %v", err),
		})
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("git sync failed: %v", err), logger)
	}

	// Update head SHA
	r.updateStatus(ctx, appName, store.StatusUpdate{HeadSHA: headSHA})

	// STEP 2: Change detection
	if headSHA == appRec.LastSyncedSHA && !forced {
		if !application.Spec.SyncPolicy.SelfHeal {
			logger.Debug("no changes detected, skipping")
			return r.finishResult(ctx, result, app.SyncResultSkipped, "", logger)
		}
		// Self-heal: continue to check live state for drift
	}

	// STEP 3: Parse desired state
	repoPath := r.deps.GitSyncer.RepoPath(application.Spec.Source.RepoURL)
	if repoPath == "" {
		return r.finishResult(ctx, result, app.SyncResultFailure, "repo path not found after sync", logger)
	}

	composePath := repoPath
	if application.Spec.Source.Path != "" && application.Spec.Source.Path != "." {
		composePath = filepath.Join(repoPath, application.Spec.Source.Path)
	}

	composeSpec, err := r.deps.Parser.Parse(ctx, composePath, application.Spec.Source.ComposeFiles)
	if err != nil {
		breaker.RecordFailure()
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("parse error: %v", err),
		})
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("parse error: %v", err), logger)
	}
	if composeSpec == nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, "parser returned nil spec", logger)
	}

	// STEP 4: Inspect live state
	liveServices, err := r.deps.Inspector.Inspect(ctx, application.Spec.Destination)
	if err != nil {
		breaker.RecordFailure()
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("inspect error: %v", err), logger)
	}

	// STEP 5: Compute diff
	diffResult := r.deps.Differ.Diff(composeSpec.Services, liveServices)
	result.Diff = diffResult
	result.CommitSHA = headSHA

	// STEP 6: Decision
	if diffResult.InSync {
		logger.Debug("all services in sync")
		breaker.RecordSuccess()
		r.updateStatus(ctx, appName, store.StatusUpdate{
			SyncStatus:    string(app.SyncStatusSynced),
			LastSyncedSHA: headSHA,
			LastError:     " ", // clear error (space to trigger update)
		})
		return r.finishResult(ctx, result, app.SyncResultSkipped, "", logger)
	}

	// Diff detected
	logger.Info("drift detected", "summary", diffResult.Summary)
	r.updateStatus(ctx, appName, store.StatusUpdate{
		SyncStatus: string(app.SyncStatusOutOfSync),
	})

	if !application.Spec.SyncPolicy.Automated && !forced {
		logger.Info("manual sync required")
		return r.finishResult(ctx, result, app.SyncResultSkipped, "out of sync, manual sync required", logger)
	}

	// STEP 7: Deploy
	r.updateStatus(ctx, appName, store.StatusUpdate{
		HealthStatus: string(app.HealthStatusProgressing),
	})

	// Build compose file paths
	composeFiles := make([]string, len(application.Spec.Source.ComposeFiles))
	for i, f := range application.Spec.Source.ComposeFiles {
		composeFiles[i] = filepath.Join(composePath, f)
	}

	deployReq := deployer.DeployRequest{
		ProjectName:  application.Spec.Destination.ProjectName,
		ComposeFiles: composeFiles,
		WorkDir:      composePath,
		Pull:         hasImageChanges(diffResult),
		Prune:        application.Spec.SyncPolicy.Prune && len(diffResult.ToRemove) > 0,
		DockerHost:   application.Spec.Destination.DockerHost,
	}

	if err := r.deps.Deployer.Deploy(ctx, deployReq); err != nil {
		breaker.RecordFailure()
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("deploy error: %v", err),
		})
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("deploy error: %v", err), logger)
	}

	// STEP 8: Mark success (health monitoring is Phase 7)
	now := time.Now()
	breaker.RecordSuccess()
	r.updateStatus(ctx, appName, store.StatusUpdate{
		SyncStatus:    string(app.SyncStatusSynced),
		HealthStatus:  string(app.HealthStatusProgressing),
		LastSyncedSHA: headSHA,
		LastSyncTime:  &now,
		LastError:     " ", // clear
	})

	// Register with health monitor to transition from Progressing → Healthy
	if r.deps.HealthMonitor != nil {
		r.deps.HealthMonitor.WatchApp(appName, application.Spec.SyncPolicy.HealthTimeout.Duration)
	}

	logger.Info("deployment successful", "sha", headSHA, "summary", diffResult.Summary)
	return r.finishResult(ctx, result, app.SyncResultSuccess, "", logger)
}

// finishResult completes a SyncResult and records it in the store.
func (r *ReconcilerImpl) finishResult(ctx context.Context, result *app.SyncResult, status app.SyncResultStatus, errMsg string, logger *slog.Logger) (*app.SyncResult, error) {
	now := time.Now()
	result.FinishedAt = now
	result.Result = status
	result.DurationMs = now.Sub(result.StartedAt).Milliseconds()
	if errMsg != "" {
		result.Error = errMsg
	}

	// Record sync history
	syncRec := &store.SyncRecord{
		AppName:    result.AppName,
		StartedAt:  result.StartedAt,
		FinishedAt: &result.FinishedAt,
		CommitSHA:  result.CommitSHA,
		Operation:  string(result.Operation),
		Result:     string(result.Result),
		Error:      result.Error,
		DurationMs: result.DurationMs,
	}

	if result.Diff != nil {
		if diffJSON, err := json.Marshal(result.Diff); err == nil {
			syncRec.DiffJSON = string(diffJSON)
		}
	}

	if err := r.deps.Store.RecordSync(ctx, syncRec); err != nil {
		logger.Error("failed to record sync", "error", err)
	}

	if errMsg != "" {
		return result, fmt.Errorf("%s", errMsg)
	}
	return result, nil
}

// updateStatus updates the application status in the store.
func (r *ReconcilerImpl) updateStatus(ctx context.Context, appName string, update store.StatusUpdate) {
	if err := r.deps.Store.UpdateApplicationStatus(ctx, appName, update); err != nil {
		r.logger.Error("failed to update app status",
			"app", appName,
			"error", err,
		)
	}
}

// getAppLock returns a per-app mutex for serializing reconciliation.
func (r *ReconcilerImpl) getAppLock(appName string) *sync.Mutex {
	val, _ := r.appLocks.LoadOrStore(appName, &sync.Mutex{})
	return val.(*sync.Mutex)
}

// getBreaker returns the circuit breaker for an app, creating one if needed.
func (r *ReconcilerImpl) getBreaker(appName string) *CircuitBreaker {
	r.breakersMu.Lock()
	defer r.breakersMu.Unlock()

	if cb, ok := r.breakers[appName]; ok {
		return cb
	}
	cb := NewCircuitBreaker(3, 5*time.Minute)
	r.breakers[appName] = cb
	return cb
}

// hasImageChanges returns true if any ToCreate or ToUpdate diffs involve image changes.
func hasImageChanges(diff *app.DiffResult) bool {
	if len(diff.ToCreate) > 0 {
		return true
	}
	for _, u := range diff.ToUpdate {
		for _, f := range u.Fields {
			if f.Field == "image" {
				return true
			}
		}
	}
	return false
}
