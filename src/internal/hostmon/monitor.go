// Package hostmon provides background health monitoring for registered Docker hosts.
package hostmon

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// Config holds configuration for the host health monitor.
type Config struct {
	CheckInterval time.Duration
	Timeout       time.Duration
	MaxConcurrent int
}

// DefaultConfig returns the default monitor configuration.
func DefaultConfig() Config {
	return Config{
		CheckInterval: 60 * time.Second,
		Timeout:       10 * time.Second,
		MaxConcurrent: 5,
	}
}

// Monitor periodically checks all registered Docker hosts for reachability
// and resource health.
type Monitor struct {
	inspector   inspector.StateInspector
	store       *store.SQLiteStore
	logger      *slog.Logger
	config      Config
	broadcaster eventbus.Broadcaster

	cancelMu sync.Mutex
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

// New creates a new host health Monitor.
func New(insp inspector.StateInspector, st *store.SQLiteStore, logger *slog.Logger, cfg Config) *Monitor {
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = DefaultConfig().MaxConcurrent
	}
	return &Monitor{
		inspector: insp,
		store:     st,
		logger:    logger,
		config:    cfg,
	}
}

// SetBroadcaster sets the event broadcaster for status change notifications.
func (m *Monitor) SetBroadcaster(b eventbus.Broadcaster) {
	m.broadcaster = b
}

// Start begins the periodic health check loop. Blocks until ctx is canceled.
func (m *Monitor) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	m.cancelMu.Lock()
	m.cancel = cancel
	m.cancelMu.Unlock()

	m.logger.Info("host health monitor started", "interval", m.config.CheckInterval)

	// Run initial sweep
	m.sweep(ctx)

	ticker := time.NewTicker(m.config.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.wg.Wait()
			m.logger.Info("host health monitor stopped")
			return nil
		case <-ticker.C:
			m.sweep(ctx)
		}
	}
}

// Stop cancels the monitor.
func (m *Monitor) Stop() {
	m.cancelMu.Lock()
	cancel := m.cancel
	m.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// CheckHost performs a health check on a single host by name.
func (m *Monitor) CheckHost(ctx context.Context, name string) error {
	host, err := m.store.GetDockerHost(ctx, name)
	if err != nil {
		return err
	}
	if host == nil {
		return nil
	}
	m.checkHost(ctx, *host)
	return nil
}

// sweep checks all registered Docker hosts.
func (m *Monitor) sweep(ctx context.Context) {
	hosts, err := m.store.ListDockerHosts(ctx)
	if err != nil {
		m.logger.Error("listing docker hosts for health check", "error", err)
		return
	}

	if len(hosts) == 0 {
		return
	}

	sem := make(chan struct{}, m.config.MaxConcurrent)
	var wg sync.WaitGroup

	for _, host := range hosts {
		wg.Add(1)
		go func(h store.DockerHostRecord) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			m.checkHost(ctx, h)
		}(host)
	}

	wg.Wait()
}

// checkHost performs a health check on a single Docker host.
func (m *Monitor) checkHost(ctx context.Context, host store.DockerHostRecord) {
	checkCtx, cancel := context.WithTimeout(ctx, m.config.Timeout)
	defer cancel()

	now := time.Now()
	update := store.HostStatusUpdate{LastCheck: &now}
	oldStatus := host.HealthStatus

	// Try system info
	info, err := m.inspector.SystemInfo(checkCtx, host.URL)
	if err != nil {
		update.HealthStatus = "Unreachable"
		errStr := err.Error()
		update.LastError = &errStr
		if updateErr := m.store.UpdateDockerHostStatus(ctx, host.Name, update); updateErr != nil {
			m.logger.Error("failed to update docker host status", "name", host.Name, "error", updateErr)
		}

		if oldStatus != "Unreachable" {
			m.logger.Warn("docker host unreachable", "name", host.Name, "url", host.URL, "error", err)
			m.broadcastHostHealth(host.Name, "Unreachable")
		}
		return
	}

	update.HealthStatus = "Healthy"
	update.LastError = store.StringPtr("") // clear previous error

	if infoJSON, err := json.Marshal(info); err == nil {
		update.InfoJSON = string(infoJSON)
	} else {
		m.logger.Warn("failed to marshal host info", "name", host.Name, "error", err)
	}

	// Try host stats (best-effort)
	stats, err := m.inspector.HostStats(checkCtx, host.URL)
	if err == nil {
		if statsJSON, err := json.Marshal(stats); err == nil {
			update.StatsJSON = string(statsJSON)
		} else {
			m.logger.Warn("failed to marshal host stats", "name", host.Name, "error", err)
		}
	}

	if err := m.store.UpdateDockerHostStatus(ctx, host.Name, update); err != nil {
		m.logger.Error("failed to update docker host status", "name", host.Name, "error", err)
	}

	if oldStatus != "Healthy" {
		m.logger.Info("docker host healthy", "name", host.Name, "url", host.URL)
		m.broadcastHostHealth(host.Name, "Healthy")
	}
}

// broadcastHostHealth sends a host_health event via SSE.
func (m *Monitor) broadcastHostHealth(hostName, status string) {
	if m.broadcaster == nil {
		return
	}
	m.broadcaster.Broadcast(eventbus.Event{
		Type: "host_health",
		Data: map[string]string{
			"host":   hostName,
			"status": status,
		},
	})
}
