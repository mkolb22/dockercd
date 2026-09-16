// Package health monitors container health after deployments and computes
// application-level health status using worst-child aggregation.
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/notifier"
	"github.com/mkolb22/dockercd/internal/store"
)

// HealthChecker monitors container health and computes application-level health.
type HealthChecker interface {
	// Start begins the health monitoring loop. Blocks until ctx is canceled.
	Start(ctx context.Context) error

	// Stop gracefully stops the health monitor.
	Stop()

	// CheckApp performs a single health check for the named application and
	// returns the aggregated health status.
	CheckApp(ctx context.Context, appName string) (app.HealthStatus, []app.ServiceStatus, error)

	// WatchApp registers an application for continuous health monitoring after a deploy.
	// The monitor will poll until all services are healthy or the timeout expires.
	WatchApp(appName string, timeout time.Duration)

	// UnwatchApp removes an application from active health monitoring.
	UnwatchApp(appName string)

	// WaitForServicesHealthy blocks until the named services are all healthy or
	// the context/timeout expires. Returns nil if all healthy, error otherwise.
	WaitForServicesHealthy(ctx context.Context, appName string, serviceNames []string, timeout time.Duration) error
}

// Config holds health monitor configuration.
type Config struct {
	// PollInterval is how often to check health of watched apps (default 10s).
	PollInterval time.Duration

	// SweepInterval is how often to check health of ALL registered apps (default 30s).
	SweepInterval time.Duration

	// DefaultTimeout is the default time to wait for services to become healthy
	// after a deployment (default 120s).
	DefaultTimeout time.Duration

	// MaxConcurrentChecks limits simultaneous Docker inspections during polls
	// and sweeps (default 4).
	MaxConcurrentChecks int

	// CheckTimeout bounds one application's store and Docker inspection during
	// background polling (default 15s).
	CheckTimeout time.Duration
}

// DefaultConfig returns the default health monitor configuration.
func DefaultConfig() Config {
	return Config{
		PollInterval:        10 * time.Second,
		SweepInterval:       30 * time.Second,
		DefaultTimeout:      120 * time.Second,
		MaxConcurrentChecks: 4,
		CheckTimeout:        15 * time.Second,
	}
}

// watchEntry tracks a watched application.
type watchEntry struct {
	appName   string
	timeout   time.Duration
	startedAt time.Time
}

// Monitor implements HealthChecker with periodic polling.
type Monitor struct {
	inspector     inspector.StateInspector
	store         *store.SQLiteStore
	logger        *slog.Logger
	config        Config
	Broadcaster   eventbus.Broadcaster
	eventNotifier notifier.Notifier

	// Watched apps (those recently deployed, monitored more aggressively)
	watched   map[string]*watchEntry
	watchedMu sync.RWMutex

	cancelMu sync.Mutex
	cancel   context.CancelFunc
	wg       sync.WaitGroup

	// sweepMu ensures a slow sweep does not cause queued ticker events to start
	// another full scan immediately after it finishes.
	sweepMu      sync.Mutex
	sweepRunning bool
}

// SetBroadcaster sets the event broadcaster for health status change notifications.
func (m *Monitor) SetBroadcaster(b eventbus.Broadcaster) {
	m.Broadcaster = b
}

// SetNotifier sets the notifier for health degradation events.
func (m *Monitor) SetNotifier(n notifier.Notifier) {
	m.eventNotifier = n
}

// New creates a new health Monitor.
func New(insp inspector.StateInspector, s *store.SQLiteStore, logger *slog.Logger, cfg Config) *Monitor {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = DefaultConfig().PollInterval
	}
	if cfg.SweepInterval <= 0 {
		cfg.SweepInterval = DefaultConfig().SweepInterval
	}
	if cfg.DefaultTimeout <= 0 {
		cfg.DefaultTimeout = DefaultConfig().DefaultTimeout
	}
	if cfg.MaxConcurrentChecks <= 0 {
		cfg.MaxConcurrentChecks = DefaultConfig().MaxConcurrentChecks
	}
	if cfg.CheckTimeout <= 0 {
		cfg.CheckTimeout = DefaultConfig().CheckTimeout
	}

	return &Monitor{
		inspector: insp,
		store:     s,
		logger:    logger,
		config:    cfg,
		watched:   make(map[string]*watchEntry),
	}
}

// Start begins the health monitoring loop.
func (m *Monitor) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	m.cancelMu.Lock()
	m.cancel = cancel
	m.cancelMu.Unlock()

	m.wg.Add(1)
	go m.pollLoop(ctx)

	m.wg.Add(1)
	go m.sweepLoop(ctx)

	<-ctx.Done()
	m.wg.Wait()
	return nil
}

// Stop cancels the health monitor.
func (m *Monitor) Stop() {
	m.cancelMu.Lock()
	cancel := m.cancel
	m.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// WatchApp registers an application for continuous health monitoring.
func (m *Monitor) WatchApp(appName string, timeout time.Duration) {
	if timeout <= 0 {
		timeout = m.config.DefaultTimeout
	}

	m.watchedMu.Lock()
	m.watched[appName] = &watchEntry{
		appName:   appName,
		timeout:   timeout,
		startedAt: time.Now(),
	}
	m.watchedMu.Unlock()

	m.logger.Debug("watching app health", "app", appName, "timeout", timeout)
}

// UnwatchApp removes an application from active health monitoring.
func (m *Monitor) UnwatchApp(appName string) {
	m.watchedMu.Lock()
	delete(m.watched, appName)
	m.watchedMu.Unlock()
}

// WaitForServicesHealthy blocks until the named services are all healthy or
// the context/timeout expires. Returns nil when all named services are healthy.
func (m *Monitor) WaitForServicesHealthy(ctx context.Context, appName string, serviceNames []string, timeout time.Duration) error {
	if len(serviceNames) == 0 {
		return nil
	}
	if timeout <= 0 {
		timeout = m.config.DefaultTimeout
	}

	deadlineTimer := time.NewTimer(timeout)
	defer deadlineTimer.Stop()
	ticker := time.NewTicker(m.config.PollInterval)
	defer ticker.Stop()

	nameSet := make(map[string]bool, len(serviceNames))
	for _, n := range serviceNames {
		nameSet[n] = true
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadlineTimer.C:
			return fmt.Errorf("timeout waiting for services to become healthy: %v", serviceNames)
		case <-ticker.C:
			_, services, err := m.CheckApp(ctx, appName)
			if err != nil {
				m.logger.Debug("health check error during wave wait", "app", appName, "error", err)
				continue
			}

			healthy := make(map[string]bool, len(nameSet))
			allSeenHealthy := true
			for _, svc := range services {
				if !nameSet[svc.Name] {
					continue
				}
				if svc.Health != app.HealthStatusHealthy {
					allSeenHealthy = false
					break
				}
				healthy[svc.Name] = true
			}
			if allSeenHealthy && len(healthy) == len(nameSet) {
				return nil
			}
		}
	}
}

// CheckApp performs a single health check for the named application. A
// successful inspection is persisted with its observation time even when the
// health result is unchanged, because reconciliation and response time are not
// substitutes for a live Docker observation in a status view.
func (m *Monitor) CheckApp(ctx context.Context, appName string) (app.HealthStatus, []app.ServiceStatus, error) {
	// Look up the application
	appRec, err := m.store.GetApplication(ctx, appName)
	if err != nil {
		return app.HealthStatusUnknown, nil, err
	}
	if appRec == nil {
		return app.HealthStatusUnknown, nil, nil
	}

	// Deserialize manifest
	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		return app.HealthStatusUnknown, nil, err
	}

	// Inspect live state
	liveStates, err := m.inspector.Inspect(ctx, application.Spec.Destination)
	if err != nil {
		return app.HealthStatusUnknown, nil, err
	}

	// Build service statuses and aggregate
	serviceStatuses := make([]app.ServiceStatus, 0, len(liveStates))
	for _, s := range liveStates {
		serviceStatuses = append(serviceStatuses, app.ServiceStatus{
			Name:   s.Name,
			Image:  s.Image,
			Health: s.Health,
			State:  s.Status,
			Ports:  s.Ports,
		})
	}

	aggregated := Aggregate(serviceStatuses)

	// Persist health, service snapshot, and observation time as one guarded
	// record. A concurrent reconciler or checker can win the race; in that case
	// this older observation is intentionally discarded rather than mislabeled.
	servicesJSON, _ := json.Marshal(serviceStatuses)
	observedAt := time.Now().UTC()
	updated, err := m.store.RecordHealthObservation(ctx, appName, appRec.UpdatedAt, string(aggregated), string(servicesJSON), observedAt)
	if err != nil {
		return app.HealthStatusUnknown, nil, fmt.Errorf("persisting health observation: %w", err)
	}
	if !updated {
		m.logger.Debug("discarded stale health observation", "app", appName)
	}

	return aggregated, serviceStatuses, nil
}

// pollLoop periodically checks health of watched applications.
func (m *Monitor) pollLoop(ctx context.Context) {
	defer m.wg.Done()

	ticker := time.NewTicker(m.config.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.checkWatchedApps(ctx)
		}
	}
}

// checkWatchedApps checks all watched applications and removes expired ones.
func (m *Monitor) checkWatchedApps(ctx context.Context) {
	m.watchedMu.RLock()
	entries := make([]*watchEntry, 0, len(m.watched))
	for _, e := range m.watched {
		entries = append(entries, e)
	}
	m.watchedMu.RUnlock()

	var (
		expired   []string
		expiredMu sync.Mutex
		workers   sync.WaitGroup
		jobs      = make(chan *watchEntry)
	)
	workerCount := min(m.config.MaxConcurrentChecks, len(entries))
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for entry := range jobs {
				m.checkWatchedApp(ctx, entry, &expired, &expiredMu)
			}
		}()
	}
enqueueWatched:
	for _, entry := range entries {
		select {
		case <-ctx.Done():
			break enqueueWatched
		case jobs <- entry:
		}
	}
	close(jobs)
	workers.Wait()

	// Remove expired entries.
	if len(expired) > 0 {
		m.watchedMu.Lock()
		for _, name := range expired {
			delete(m.watched, name)
		}
		m.watchedMu.Unlock()
	}
}

func (m *Monitor) checkWatchedApp(ctx context.Context, entry *watchEntry, expired *[]string, expiredMu *sync.Mutex) {
	checkCtx, cancel := context.WithTimeout(ctx, m.config.CheckTimeout)
	defer cancel()

	health, _, err := m.CheckApp(checkCtx, entry.appName)
	if err != nil {
		m.logger.Error("health check failed", "app", entry.appName, "error", err)
		return
	}

	elapsed := time.Since(entry.startedAt)

	if health == app.HealthStatusHealthy {
		m.logger.Info("app healthy", "app", entry.appName, "elapsed", elapsed)
		if m.Broadcaster != nil {
			m.Broadcaster.Broadcast(eventbus.Event{
				Type:    "health",
				AppName: entry.appName,
				Data:    map[string]interface{}{"health": string(health)},
			})
		}
		expiredMu.Lock()
		*expired = append(*expired, entry.appName)
		expiredMu.Unlock()
		return
	}

	if elapsed >= entry.timeout {
		m.logger.Warn("health check timeout",
			"app", entry.appName,
			"health", health,
			"timeout", entry.timeout,
		)
		// Update status to reflect timeout
		_ = m.store.UpdateApplicationStatus(checkCtx, entry.appName, store.StatusUpdate{
			HealthStatus: string(health),
			LastError:    store.StringPtr("health check timeout: not all services healthy"),
		})
		if m.Broadcaster != nil {
			m.Broadcaster.Broadcast(eventbus.Event{
				Type:    "health",
				AppName: entry.appName,
				Data:    map[string]interface{}{"health": string(health)},
			})
		}
		if m.eventNotifier != nil {
			if notifyErr := m.eventNotifier.Notify(checkCtx, notifier.NotificationEvent{
				Type:    "health.degraded",
				AppName: entry.appName,
				Message: fmt.Sprintf("Health check timeout: %s is %s after %s", entry.appName, health, entry.timeout),
				Time:    time.Now(),
			}); notifyErr != nil {
				m.logger.Error("health degraded notification failed", "app", entry.appName, "error", notifyErr)
			}
		}
		expiredMu.Lock()
		*expired = append(*expired, entry.appName)
		expiredMu.Unlock()
		return
	}

	m.logger.Debug("app not yet healthy",
		"app", entry.appName,
		"health", health,
		"elapsed", elapsed,
	)
}

// sweepLoop periodically checks health of ALL registered applications.
func (m *Monitor) sweepLoop(ctx context.Context) {
	defer m.wg.Done()

	ticker := time.NewTicker(m.config.SweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.startSweep(ctx)
		}
	}
}

func (m *Monitor) startSweep(ctx context.Context) {
	m.sweepMu.Lock()
	if m.sweepRunning {
		m.sweepMu.Unlock()
		m.logger.Debug("health sweep skipped: previous sweep is still running")
		return
	}
	m.sweepRunning = true
	m.sweepMu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer func() {
			m.sweepMu.Lock()
			m.sweepRunning = false
			m.sweepMu.Unlock()
		}()
		m.sweepAllApps(ctx)
	}()
}

// sweepAllApps checks health for every registered application.
func (m *Monitor) sweepAllApps(ctx context.Context) {
	apps, err := m.store.ListApplications(ctx)
	if err != nil {
		m.logger.Error("sweep: failed to list applications", "error", err)
		return
	}

	jobs := make(chan string)
	var workers sync.WaitGroup
	workerCount := min(m.config.MaxConcurrentChecks, len(apps))
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for appName := range jobs {
				checkCtx, cancel := context.WithTimeout(ctx, m.config.CheckTimeout)
				_, _, err := m.CheckApp(checkCtx, appName)
				cancel()
				if err != nil {
					m.logger.Debug("sweep: health check failed", "app", appName, "error", err)
				}
			}
		}()
	}
enqueueApps:
	for _, appRec := range apps {
		select {
		case <-ctx.Done():
			break enqueueApps
		case jobs <- appRec.Name:
		}
	}
	close(jobs)
	workers.Wait()
}
