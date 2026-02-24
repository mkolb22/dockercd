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
}

// DefaultConfig returns the default health monitor configuration.
func DefaultConfig() Config {
	return Config{
		PollInterval:   10 * time.Second,
		SweepInterval:  30 * time.Second,
		DefaultTimeout: 120 * time.Second,
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
	inspector      inspector.StateInspector
	store          *store.SQLiteStore
	logger         *slog.Logger
	config         Config
	Broadcaster    eventbus.Broadcaster
	eventNotifier  notifier.Notifier

	// Watched apps (those recently deployed, monitored more aggressively)
	watched   map[string]*watchEntry
	watchedMu sync.Mutex

	cancel context.CancelFunc
	wg     sync.WaitGroup
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
	if cfg.DefaultTimeout <= 0 {
		cfg.DefaultTimeout = DefaultConfig().DefaultTimeout
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
	ctx, m.cancel = context.WithCancel(ctx)

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
	if m.cancel != nil {
		m.cancel()
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
	if timeout <= 0 {
		timeout = m.config.DefaultTimeout
	}

	deadline := time.After(timeout)
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
		case <-deadline:
			return fmt.Errorf("timeout waiting for services to become healthy: %v", serviceNames)
		case <-ticker.C:
			_, services, err := m.CheckApp(ctx, appName)
			if err != nil {
				m.logger.Debug("health check error during wave wait", "app", appName, "error", err)
				continue
			}

			allHealthy := true
			for _, svc := range services {
				if nameSet[svc.Name] && svc.Health != app.HealthStatusHealthy {
					allHealthy = false
					break
				}
			}
			if allHealthy {
				return nil
			}
		}
	}
}

// CheckApp performs a single health check for the named application.
// Only writes to the store when the health status or services have changed,
// avoiding unnecessary DB writes during periodic sweeps.
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

	// Only persist when status changed to avoid unnecessary DB writes on every sweep
	servicesJSON, _ := json.Marshal(serviceStatuses)
	newServicesStr := string(servicesJSON)
	if string(aggregated) != appRec.HealthStatus || newServicesStr != appRec.ServicesJSON {
		_ = m.store.UpdateApplicationStatus(ctx, appName, store.StatusUpdate{
			HealthStatus: string(aggregated),
			ServicesJSON: newServicesStr,
		})
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
	m.watchedMu.Lock()
	entries := make([]*watchEntry, 0, len(m.watched))
	for _, e := range m.watched {
		entries = append(entries, e)
	}
	m.watchedMu.Unlock()

	var expired []string

	for _, entry := range entries {
		health, _, err := m.CheckApp(ctx, entry.appName)
		if err != nil {
			m.logger.Error("health check failed", "app", entry.appName, "error", err)
			continue
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
			expired = append(expired, entry.appName)
			continue
		}

		if elapsed >= entry.timeout {
			m.logger.Warn("health check timeout",
				"app", entry.appName,
				"health", health,
				"timeout", entry.timeout,
			)
			// Update status to reflect timeout
			_ = m.store.UpdateApplicationStatus(ctx, entry.appName, store.StatusUpdate{
				HealthStatus: string(health),
				LastError:    "health check timeout: not all services healthy",
			})
			if m.Broadcaster != nil {
				m.Broadcaster.Broadcast(eventbus.Event{
					Type:    "health",
					AppName: entry.appName,
					Data:    map[string]interface{}{"health": string(health)},
				})
			}
			if m.eventNotifier != nil {
				if notifyErr := m.eventNotifier.Notify(ctx, notifier.NotificationEvent{
					Type:    "health.degraded",
					AppName: entry.appName,
					Message: fmt.Sprintf("Health check timeout: %s is %s after %s", entry.appName, health, entry.timeout),
					Time:    time.Now(),
				}); notifyErr != nil {
					m.logger.Error("health degraded notification failed", "app", entry.appName, "error", notifyErr)
				}
			}
			expired = append(expired, entry.appName)
			continue
		}

		m.logger.Debug("app not yet healthy",
			"app", entry.appName,
			"health", health,
			"elapsed", elapsed,
		)
	}

	// Remove expired entries
	if len(expired) > 0 {
		m.watchedMu.Lock()
		for _, name := range expired {
			delete(m.watched, name)
		}
		m.watchedMu.Unlock()
	}
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
			m.sweepAllApps(ctx)
		}
	}
}

// sweepAllApps checks health for every registered application.
func (m *Monitor) sweepAllApps(ctx context.Context) {
	apps, err := m.store.ListApplications(ctx)
	if err != nil {
		m.logger.Error("sweep: failed to list applications", "error", err)
		return
	}

	for _, appRec := range apps {
		if ctx.Err() != nil {
			return
		}
		_, _, err := m.CheckApp(ctx, appRec.Name)
		if err != nil {
			m.logger.Debug("sweep: health check failed", "app", appRec.Name, "error", err)
		}
	}
}
