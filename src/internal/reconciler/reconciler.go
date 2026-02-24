// Package reconciler orchestrates the reconciliation loop for all applications.
// It wires together git sync, parser, inspector, differ, and deployer into
// the core reconciliation algorithm with a scheduler and worker pool.
package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/deployer"
	"github.com/mkolb22/dockercd/internal/differ"
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/gitsync"
	"github.com/mkolb22/dockercd/internal/health"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/notifier"
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

	// DryRun computes the diff for an application without deploying anything.
	// Returns the diff result and the current HEAD SHA.
	DryRun(ctx context.Context, appName string) (*app.DiffResult, string, error)

	// Rollback re-deploys the application from the git repository state at the
	// given commit SHA. The SHA must exist in sync history. A new sync record is
	// stored with operation=rollback.
	Rollback(ctx context.Context, appName string, targetSHA string) (*app.SyncResult, error)

	// SetPollOverride sets a global poll interval override for all apps.
	// Pass 0 to clear the override and revert to per-app intervals.
	SetPollOverride(d time.Duration)

	// GetPollOverride returns the current global poll interval override.
	// Returns 0 if no override is set.
	GetPollOverride() time.Duration
}

// Deps holds all dependencies needed by the reconciler.
type Deps struct {
	GitSyncer     gitsync.GitSyncer
	Parser        parser.ComposeParser
	Inspector     inspector.StateInspector
	Differ        differ.StateDiffer
	Deployer      deployer.Deployer
	HealthMonitor health.HealthChecker
	Store         *store.SQLiteStore
	Logger        *slog.Logger
	Broadcaster   eventbus.Broadcaster
	Notifier      notifier.Notifier // optional: sends sync event notifications
	TLSLookup     func(host string) string // returns TLS cert path for a Docker host URL

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

	// Global poll interval override (0 = use per-app intervals)
	pollOverride   time.Duration
	pollOverrideMu sync.RWMutex

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

// SetPollOverride sets a global poll interval override for all apps.
func (r *ReconcilerImpl) SetPollOverride(d time.Duration) {
	r.pollOverrideMu.Lock()
	r.pollOverride = d
	r.pollOverrideMu.Unlock()
	if d > 0 {
		r.logger.Info("poll interval override set", "interval", d)
	} else {
		r.logger.Info("poll interval override cleared")
	}
}

// GetPollOverride returns the current global poll interval override.
func (r *ReconcilerImpl) GetPollOverride() time.Duration {
	r.pollOverrideMu.RLock()
	defer r.pollOverrideMu.RUnlock()
	return r.pollOverride
}

// computeDiff runs steps 1-5 of the reconciliation algorithm: git sync, change
// detection, parse, inspect, and diff. It returns the compose spec, diff
// result, head SHA, and any error. It also updates application status in the
// store as a side effect (headSHA, health on error).
//
// If appRec and application are non-nil, they are used directly (avoiding a
// redundant store fetch and JSON unmarshal). Pass nil for both when calling
// from DryRun where no pre-fetched data is available.
func (r *ReconcilerImpl) computeDiff(ctx context.Context, appName string, forced bool, appRec *store.ApplicationRecord, application *app.Application) (*app.ComposeSpec, *app.DiffResult, string, error) {
	logger := r.logger.With("app", appName)

	// Look up the application from the store (unless pre-fetched)
	if appRec == nil {
		var err error
		appRec, err = r.deps.Store.GetApplication(ctx, appName)
		if err != nil {
			return nil, nil, "", fmt.Errorf("store error: %v", err)
		}
		if appRec == nil {
			return nil, nil, "", fmt.Errorf("application %q not found", appName)
		}
	}

	// Deserialize manifest to get app spec (unless pre-parsed)
	if application == nil {
		var a app.Application
		if err := json.Unmarshal([]byte(appRec.Manifest), &a); err != nil {
			return nil, nil, "", fmt.Errorf("invalid manifest: %v", err)
		}
		application = &a
	}

	// STEP 1: Git Sync
	logger.Debug("syncing git repository")
	headSHA, err := r.deps.GitSyncer.Sync(ctx, application.Spec.Source)
	if err != nil {
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("git sync failed: %v", err),
		})
		return nil, nil, "", fmt.Errorf("git sync failed: %v", err)
	}

	// Update head SHA
	r.updateStatus(ctx, appName, store.StatusUpdate{HeadSHA: headSHA})

	// STEP 2: Change detection
	if headSHA == appRec.LastSyncedSHA && !forced {
		if !application.Spec.SyncPolicy.SelfHeal {
			logger.Debug("no changes detected, skipping")
			return nil, nil, headSHA, nil
		}
		// Self-heal: continue to check live state for drift
	}

	// STEP 3: Parse desired state
	repoPath := r.deps.GitSyncer.RepoPath(application.Spec.Source.RepoURL)
	if repoPath == "" {
		return nil, nil, headSHA, fmt.Errorf("repo path not found after sync")
	}

	composePath := repoPath
	if application.Spec.Source.Path != "" && application.Spec.Source.Path != "." {
		composePath = filepath.Join(repoPath, application.Spec.Source.Path)
	}

	composeSpec, err := r.deps.Parser.Parse(ctx, composePath, application.Spec.Source.ComposeFiles)
	if err != nil {
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("parse error: %v", err),
		})
		return nil, nil, headSHA, fmt.Errorf("parse error: %v", err)
	}
	if composeSpec == nil {
		return nil, nil, headSHA, fmt.Errorf("parser returned nil spec")
	}

	// STEP 3b: Check port conflicts
	if err := checkPortConflicts(ctx, r.deps.Store, appName, composeSpec.Services); err != nil {
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("port conflict: %v", err),
		})
		return nil, nil, headSHA, fmt.Errorf("port conflict: %v", err)
	}

	// STEP 4: Inspect live state
	liveServices, err := r.deps.Inspector.Inspect(ctx, application.Spec.Destination)
	if err != nil {
		return nil, nil, headSHA, fmt.Errorf("inspect error: %v", err)
	}

	// STEP 5: Compute diff
	diffResult := r.deps.Differ.Diff(composeSpec.Services, liveServices)

	return composeSpec, diffResult, headSHA, nil
}

// DryRun computes the diff for an application without deploying anything.
func (r *ReconcilerImpl) DryRun(ctx context.Context, appName string) (*app.DiffResult, string, error) {
	_, diffResult, headSHA, err := r.computeDiff(ctx, appName, true, nil, nil)
	if err != nil {
		return nil, headSHA, err
	}
	if diffResult == nil {
		// No changes detected (skipped)
		return &app.DiffResult{InSync: true, Summary: "All services in sync"}, headSHA, nil
	}
	return diffResult, headSHA, nil
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

	// Look up the application from the store (needed for circuit breaker and
	// post-diff decisions — computeDiff also reads the store, but we need the
	// record here for the circuit breaker check before calling computeDiff).
	appRec, err := r.deps.Store.GetApplication(ctx, appName)
	if err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("store error: %v", err), logger)
	}
	if appRec == nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("application %q not found", appName), logger)
	}

	// Deserialize manifest to get app spec (needed for policy decisions below)
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

	// STEPS 1-5: Git sync, parse, inspect, diff (pass pre-fetched record + parsed manifest)
	composeSpec, diffResult, headSHA, err := r.computeDiff(ctx, appName, forced, appRec, &application)
	if err != nil {
		breaker.RecordFailure()
		return r.finishResult(ctx, result, app.SyncResultFailure, err.Error(), logger)
	}

	result.CommitSHA = headSHA

	// Serialize compose spec for rollback snapshots
	if composeSpec != nil {
		if specJSON, err := json.Marshal(composeSpec); err == nil {
			result.ComposeSpecJSON = string(specJSON)
		}
	}

	// computeDiff returns nil diffResult when change detection skips (no SHA change)
	if diffResult == nil {
		return r.finishResult(ctx, result, app.SyncResultSkipped, "", logger)
	}

	result.Diff = diffResult

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

	// Derive compose path from repo for deployer (mirrors computeDiff logic)
	deployRepoPath := r.deps.GitSyncer.RepoPath(application.Spec.Source.RepoURL)
	composePath := deployRepoPath
	if application.Spec.Source.Path != "" && application.Spec.Source.Path != "." {
		composePath = filepath.Join(deployRepoPath, application.Spec.Source.Path)
	}

	// Build compose file paths
	composeFiles := make([]string, len(application.Spec.Source.ComposeFiles))
	for i, f := range application.Spec.Source.ComposeFiles {
		composeFiles[i] = filepath.Join(composePath, f)
	}

	// Scan compose spec for hook services (pre-sync / post-sync).
	// Hook services run via docker compose run --rm and are excluded from the diff.
	var preSyncServices, postSyncServices []string
	if composeSpec != nil {
		for _, svc := range composeSpec.Services {
			switch svc.Labels[differ.HookLabel] {
			case "pre-sync":
				preSyncServices = append(preSyncServices, svc.Name)
			case "post-sync":
				postSyncServices = append(postSyncServices, svc.Name)
			}
		}
	}

	deployReq := deployer.DeployRequest{
		ProjectName:      application.Spec.Destination.ProjectName,
		ComposeFiles:     composeFiles,
		WorkDir:          composePath,
		Pull:             hasImageChanges(diffResult),
		Prune:            application.Spec.SyncPolicy.Prune && len(diffResult.ToRemove) > 0,
		DockerHost:       application.Spec.Destination.DockerHost,
		PreSyncServices:  preSyncServices,
		PostSyncServices: postSyncServices,
	}

	// Populate TLS cert path for remote hosts
	if r.deps.TLSLookup != nil && deployReq.DockerHost != "" {
		deployReq.TLSCertPath = r.deps.TLSLookup(deployReq.DockerHost)
	}

	// Check for blue-green strategy: if any service has the strategy label set to
	// "blue-green", wrap the deployer in a BlueGreenDeployer for this deployment.
	activeDep := r.deps.Deployer
	if composeSpec != nil && hasBlueGreenStrategy(composeSpec.Services) {
		logger.Info("blue-green strategy detected, wrapping deployer")
		activeDep = deployer.NewBlueGreen(r.deps.Deployer, r.deps.Inspector, r.logger)
	}

	// Group services by sync wave for ordered deployment
	waves := groupByWave(composeSpec.Services)

	if len(waves) <= 1 {
		// Single wave (or no wave labels): use standard Deploy for full compose apply
		if err := activeDep.Deploy(ctx, deployReq); err != nil {
			breaker.RecordFailure()
			r.updateStatus(ctx, appName, store.StatusUpdate{
				HealthStatus: string(app.HealthStatusDegraded),
				LastError:    fmt.Sprintf("deploy error: %v", err),
			})
			return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("deploy error: %v", err), logger)
		}
	} else {
		// Multi-wave deployment: deploy each wave and wait for healthy before proceeding
		for i, wave := range waves {
			logger.Info("deploying sync wave",
				"wave", wave.Wave,
				"services", wave.Services,
				"waveIndex", fmt.Sprintf("%d/%d", i+1, len(waves)),
			)

			if err := activeDep.DeployServices(ctx, deployReq, wave.Services); err != nil {
				breaker.RecordFailure()
				r.updateStatus(ctx, appName, store.StatusUpdate{
					HealthStatus: string(app.HealthStatusDegraded),
					LastError:    fmt.Sprintf("wave %d deploy error: %v", wave.Wave, err),
				})
				return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("wave %d deploy error: %v", wave.Wave, err), logger)
			}

			// Wait for health between waves (not after the last wave)
			if i < len(waves)-1 && r.deps.HealthMonitor != nil {
				logger.Info("waiting for wave services to become healthy",
					"wave", wave.Wave,
					"services", wave.Services,
				)
				if err := r.deps.HealthMonitor.WaitForServicesHealthy(ctx, appName, wave.Services, application.Spec.SyncPolicy.HealthTimeout.Duration); err != nil {
					breaker.RecordFailure()
					r.updateStatus(ctx, appName, store.StatusUpdate{
						HealthStatus: string(app.HealthStatusDegraded),
						LastError:    fmt.Sprintf("wave %d health gate failed: %v", wave.Wave, err),
					})
					return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("wave %d health gate failed: %v", wave.Wave, err), logger)
				}
				logger.Info("wave services healthy, proceeding to next wave", "wave", wave.Wave)
			}
		}

		// After all waves deployed, run a full compose apply for pruning if needed
		if deployReq.Prune {
			pruneReq := deployReq
			pruneReq.Pull = false
			pruneReq.PreSyncServices = nil
			pruneReq.PostSyncServices = nil
			if err := activeDep.Deploy(ctx, pruneReq); err != nil {
				logger.Warn("prune after wave deploy failed", "error", err)
			}
		}
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
		AppName:         result.AppName,
		StartedAt:       result.StartedAt,
		FinishedAt:      &result.FinishedAt,
		CommitSHA:       result.CommitSHA,
		Operation:       string(result.Operation),
		Result:          string(result.Result),
		Error:           result.Error,
		DurationMs:      result.DurationMs,
		ComposeSpecJSON: result.ComposeSpecJSON,
	}

	if result.Diff != nil {
		if diffJSON, err := json.Marshal(result.Diff); err == nil {
			syncRec.DiffJSON = string(diffJSON)
		}
	}

	if err := r.deps.Store.RecordSync(ctx, syncRec); err != nil {
		logger.Error("failed to record sync", "error", err)
	}

	// Record event and send notifications for non-skipped results
	if status != app.SyncResultSkipped {
		// Build message once, reuse for event record and notification
		severity := "info"
		eventType := "SyncSuccess"
		notifyType := "sync.success"
		message := fmt.Sprintf("Sync %s (%s)", status, result.Operation)
		if status == app.SyncResultFailure {
			severity = "error"
			eventType = "SyncError"
			notifyType = "sync.failure"
			message = fmt.Sprintf("Sync failed (%s): %s", result.Operation, errMsg)
		} else if result.CommitSHA != "" {
			message = fmt.Sprintf("Deployed %s via %s", result.CommitSHA[:min(7, len(result.CommitSHA))], result.Operation)
		}

		_ = r.deps.Store.RecordEvent(ctx, &store.EventRecord{
			AppName:  result.AppName,
			Type:     eventType,
			Message:  message,
			Severity: severity,
		})

		if r.deps.Notifier != nil {
			if notifyErr := r.deps.Notifier.Notify(ctx, notifier.NotificationEvent{
				Type:    notifyType,
				AppName: result.AppName,
				Message: message,
				Data:    result,
				Time:    now,
			}); notifyErr != nil {
				logger.Error("failed to send sync notification", "error", notifyErr)
			}
		}
	}

	// Broadcast sync event to SSE subscribers
	if r.deps.Broadcaster != nil {
		r.deps.Broadcaster.Broadcast(eventbus.Event{
			Type:    "sync",
			AppName: result.AppName,
			Data:    result,
		})
	}

	if errMsg != "" {
		return result, errors.New(errMsg)
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

// Rollback re-deploys an application from the git repository state at a stored
// commit SHA. The SHA must appear in sync history. A new sync record is written
// with operation=rollback.
func (r *ReconcilerImpl) Rollback(ctx context.Context, appName string, targetSHA string) (*app.SyncResult, error) {
	lock := r.getAppLock(appName)
	lock.Lock()
	defer lock.Unlock()

	startTime := time.Now()
	result := &app.SyncResult{
		AppName:   appName,
		StartedAt: startTime,
		Operation: app.SyncOperationRollback,
		CommitSHA: targetSHA,
	}
	logger := r.logger.With("app", appName, "targetSHA", targetSHA)

	// Look up the application.
	appRec, err := r.deps.Store.GetApplication(ctx, appName)
	if err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("store error: %v", err), logger)
	}
	if appRec == nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("application %q not found", appName), logger)
	}

	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("invalid manifest: %v", err), logger)
	}

	// Verify a sync record for this SHA exists.
	syncRec, err := r.deps.Store.GetSyncBySHA(ctx, appName, targetSHA)
	if err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("store error: %v", err), logger)
	}
	if syncRec == nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("no sync history found for SHA %s", targetSHA), logger)
	}

	// Ensure the repo is cloned/up-to-date (sync to the current branch first).
	_, err = r.deps.GitSyncer.Sync(ctx, application.Spec.Source)
	if err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("git sync failed: %v", err), logger)
	}

	// Check out the target SHA so compose files reflect the rollback revision.
	if err := r.deps.GitSyncer.CheckoutSHA(ctx, application.Spec.Source.RepoURL, targetSHA); err != nil {
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("checkout target SHA failed: %v", err), logger)
	}

	// Build compose file paths using the cached repo.
	repoPath := r.deps.GitSyncer.RepoPath(application.Spec.Source.RepoURL)
	composePath := repoPath
	if application.Spec.Source.Path != "" && application.Spec.Source.Path != "." {
		composePath = filepath.Join(repoPath, application.Spec.Source.Path)
	}
	composeFiles := make([]string, len(application.Spec.Source.ComposeFiles))
	for i, f := range application.Spec.Source.ComposeFiles {
		composeFiles[i] = filepath.Join(composePath, f)
	}

	r.updateStatus(ctx, appName, store.StatusUpdate{
		HealthStatus: string(app.HealthStatusProgressing),
	})

	deployReq := deployer.DeployRequest{
		ProjectName:  application.Spec.Destination.ProjectName,
		ComposeFiles: composeFiles,
		WorkDir:      composePath,
		Pull:         true,
		Prune:        application.Spec.SyncPolicy.Prune,
		DockerHost:   application.Spec.Destination.DockerHost,
	}

	// Populate TLS cert path for remote hosts
	if r.deps.TLSLookup != nil && deployReq.DockerHost != "" {
		deployReq.TLSCertPath = r.deps.TLSLookup(deployReq.DockerHost)
	}

	if err := r.deps.Deployer.Deploy(ctx, deployReq); err != nil {
		r.updateStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(app.HealthStatusDegraded),
			LastError:    fmt.Sprintf("rollback deploy error: %v", err),
		})
		return r.finishResult(ctx, result, app.SyncResultFailure, fmt.Sprintf("deploy error: %v", err), logger)
	}

	now := time.Now()
	r.updateStatus(ctx, appName, store.StatusUpdate{
		SyncStatus:    string(app.SyncStatusSynced),
		HealthStatus:  string(app.HealthStatusProgressing),
		LastSyncedSHA: targetSHA,
		LastSyncTime:  &now,
		LastError:     " ",
	})

	// Carry the stored compose spec snapshot forward into the new sync record.
	if syncRec.ComposeSpecJSON != "" {
		result.ComposeSpecJSON = syncRec.ComposeSpecJSON
	}

	if r.deps.HealthMonitor != nil {
		r.deps.HealthMonitor.WatchApp(appName, application.Spec.SyncPolicy.HealthTimeout.Duration)
	}

	logger.Info("rollback successful", "sha", targetSHA)
	return r.finishResult(ctx, result, app.SyncResultSuccess, "", logger)
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

// WaveGroup groups services belonging to the same sync wave.
type WaveGroup struct {
	Wave     int
	Services []string
}

// hasBlueGreenStrategy returns true if any service in the compose spec has the
// com.dockercd.strategy label set to "blue-green".
func hasBlueGreenStrategy(services []app.ServiceSpec) bool {
	for _, svc := range services {
		if svc.Labels[differ.StrategyLabel] == string(app.DeployStrategyBlueGreen) {
			return true
		}
	}
	return false
}

// groupByWave groups service specs by their com.dockercd.sync-wave label value.
// Services without the label default to wave 0. Hook services are excluded.
// Returns groups sorted by ascending wave number.
func groupByWave(services []app.ServiceSpec) []WaveGroup {
	waveMap := make(map[int][]string)
	for _, svc := range services {
		// Skip hook services — they are managed separately via pre/post-sync hooks
		if _, isHook := svc.Labels[differ.HookLabel]; isHook {
			continue
		}
		wave := 0
		if waveStr, ok := svc.Labels[differ.SyncWaveLabel]; ok {
			if w, err := strconv.Atoi(waveStr); err == nil {
				wave = w
			}
		}
		waveMap[wave] = append(waveMap[wave], svc.Name)
	}

	groups := make([]WaveGroup, 0, len(waveMap))
	for w, svcs := range waveMap {
		sort.Strings(svcs)
		groups = append(groups, WaveGroup{Wave: w, Services: svcs})
	}
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].Wave < groups[j].Wave
	})
	return groups
}
