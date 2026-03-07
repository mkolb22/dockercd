// Package events subscribes to the Docker event stream and triggers
// reconciliation for self-healing when containers die or stop unexpectedly.
package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/differ"
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/store"
)

// EventClient is the subset of the Docker client API used for event streaming.
type EventClient interface {
	Events(ctx context.Context, options events.ListOptions) (<-chan events.Message, <-chan error)
	Close() error
}

// EventClientFactory creates Docker clients for event streaming.
type EventClientFactory func(host string) (EventClient, error)

// ReconcileTrigger is a minimal interface for triggering reconciliation.
// This avoids importing the full reconciler package.
type ReconcileTrigger interface {
	TriggerReconcile(appName string)
}

// WatcherConfig holds event watcher configuration.
type WatcherConfig struct {
	// DebounceWindow is how long to wait after the last event before
	// triggering reconciliation (default 2s).
	DebounceWindow time.Duration

	// SelfEventGuard is the time window after a sync during which events
	// are suppressed to prevent reconciliation loops (default 5s).
	SelfEventGuard time.Duration

	// ReconnectBackoff is the initial backoff duration when the event
	// stream disconnects (default 1s, max 30s).
	ReconnectBackoff time.Duration
	MaxBackoff       time.Duration
}

// DefaultWatcherConfig returns the default event watcher configuration.
func DefaultWatcherConfig() WatcherConfig {
	return WatcherConfig{
		DebounceWindow:   2 * time.Second,
		SelfEventGuard:   5 * time.Second,
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}
}

// Watcher subscribes to Docker events and triggers reconciliation
// for self-healing applications.
type Watcher struct {
	clientFactory EventClientFactory
	trigger       ReconcileTrigger
	store         *store.SQLiteStore
	logger        *slog.Logger
	config        WatcherConfig
	broadcaster   eventbus.Broadcaster

	// Per-app debounce timers
	debounce *Debouncer

	// Track recent sync completions to suppress self-events
	recentSyncs   map[string]time.Time
	recentSyncsMu sync.RWMutex

	// Project name → app name mapping (cached from store)
	projectMap   map[string]string
	projectMapMu sync.RWMutex

	// Per-host event watchers for remote Docker hosts
	hostWatchers   map[string]context.CancelFunc
	hostWatchersMu sync.Mutex

	// ctx is the derived context set in Start, used by WatchHost to tie
	// remote host goroutines to the watcher's lifecycle.
	ctx      context.Context
	cancelMu sync.Mutex
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

// SetBroadcaster sets the event broadcaster for container event notifications.
func (w *Watcher) SetBroadcaster(b eventbus.Broadcaster) {
	w.broadcaster = b
}

// NewWatcher creates a new event Watcher.
func NewWatcher(
	clientFactory EventClientFactory,
	trigger ReconcileTrigger,
	s *store.SQLiteStore,
	logger *slog.Logger,
	cfg WatcherConfig,
) *Watcher {
	if cfg.DebounceWindow <= 0 {
		cfg.DebounceWindow = DefaultWatcherConfig().DebounceWindow
	}
	if cfg.SelfEventGuard <= 0 {
		cfg.SelfEventGuard = DefaultWatcherConfig().SelfEventGuard
	}
	if cfg.ReconnectBackoff <= 0 {
		cfg.ReconnectBackoff = DefaultWatcherConfig().ReconnectBackoff
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = DefaultWatcherConfig().MaxBackoff
	}

	return &Watcher{
		clientFactory: clientFactory,
		trigger:       trigger,
		store:         s,
		logger:        logger,
		config:        cfg,
		debounce:      NewDebouncer(cfg.DebounceWindow),
		recentSyncs:   make(map[string]time.Time),
		projectMap:    make(map[string]string),
		hostWatchers:  make(map[string]context.CancelFunc),
	}
}

// Start begins watching Docker events. Blocks until ctx is canceled.
func (w *Watcher) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	w.cancelMu.Lock()
	w.ctx = ctx
	w.cancel = cancel
	w.cancelMu.Unlock()

	// Build initial project name → app name mapping
	if err := w.refreshProjectMap(ctx); err != nil {
		w.logger.Error("failed to build project map", "error", err)
		// Continue anyway — we'll retry on events
	}

	w.wg.Add(1)
	go w.watchLoop(ctx)

	<-ctx.Done()
	w.debounce.StopAll()
	w.wg.Wait()
	return nil
}

// Stop cancels the event watcher and all host watchers.
func (w *Watcher) Stop() {
	// Stop all remote host watchers
	w.hostWatchersMu.Lock()
	for host, cancel := range w.hostWatchers {
		cancel()
		delete(w.hostWatchers, host)
	}
	w.hostWatchersMu.Unlock()

	w.cancelMu.Lock()
	cancel := w.cancel
	w.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// RecordSync records that a sync just completed for an app, suppressing
// subsequent events within the self-event guard window.
func (w *Watcher) RecordSync(appName string) {
	w.recentSyncsMu.Lock()
	w.recentSyncs[appName] = time.Now() // always a write
	w.recentSyncsMu.Unlock()
}

// RefreshProjectMap rebuilds the project name → app name mapping from the store.
func (w *Watcher) RefreshProjectMap(ctx context.Context) error {
	return w.refreshProjectMap(ctx)
}

func (w *Watcher) refreshProjectMap(ctx context.Context) error {
	apps, err := w.store.ListApplications(ctx)
	if err != nil {
		return err
	}

	newMap := make(map[string]string, len(apps))
	for _, a := range apps {
		var application app.Application
		if err := json.Unmarshal([]byte(a.Manifest), &application); err != nil {
			continue
		}
		projectName := application.Spec.Destination.ProjectName
		if projectName == "" {
			projectName = application.Metadata.Name
		}
		newMap[projectName] = a.Name
	}

	w.projectMapMu.Lock()
	w.projectMap = newMap
	w.projectMapMu.Unlock()

	return nil
}

// watchLoop runs the event stream with reconnection on errors.
func (w *Watcher) watchLoop(ctx context.Context) {
	defer w.wg.Done()

	backoff := w.config.ReconnectBackoff

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := w.streamEvents(ctx, "")
		if ctx.Err() != nil {
			return // context canceled
		}

		w.logger.Error("event stream disconnected", "error", err)

		// Exponential backoff on reconnect
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > w.config.MaxBackoff {
			backoff = w.config.MaxBackoff
		}
	}
}

// WatchHost starts watching Docker events on a remote host.
// Events from the host are processed identically to local events.
func (w *Watcher) WatchHost(host string) {
	w.hostWatchersMu.Lock()
	defer w.hostWatchersMu.Unlock()

	// Already watching this host
	if _, exists := w.hostWatchers[host]; exists {
		return
	}

	w.cancelMu.Lock()
	parentCtx := w.ctx
	w.cancelMu.Unlock()
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(parentCtx)
	w.hostWatchers[host] = cancel

	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		w.hostWatchLoop(ctx, host)
	}()

	w.logger.Info("watching remote Docker host events", "host", host)
}

// UnwatchHost stops watching Docker events on a remote host.
func (w *Watcher) UnwatchHost(host string) {
	w.hostWatchersMu.Lock()
	defer w.hostWatchersMu.Unlock()

	if cancel, exists := w.hostWatchers[host]; exists {
		cancel()
		delete(w.hostWatchers, host)
		w.logger.Info("stopped watching remote Docker host events", "host", host)
	}
}

// hostWatchLoop runs the event stream for a remote host with reconnection.
func (w *Watcher) hostWatchLoop(ctx context.Context, host string) {
	backoff := w.config.ReconnectBackoff

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := w.streamEvents(ctx, host)
		if ctx.Err() != nil {
			return
		}

		w.logger.Error("remote host event stream disconnected", "host", host, "error", err)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > w.config.MaxBackoff {
			backoff = w.config.MaxBackoff
		}
	}
}

// streamEvents connects to Docker and processes events until an error occurs.
func (w *Watcher) streamEvents(ctx context.Context, host string) error {
	cli, err := w.clientFactory(host)
	if err != nil {
		return err
	}
	defer cli.Close()

	eventFilters := filters.NewArgs(
		filters.Arg("type", "container"),
		filters.Arg("event", "die"),
		filters.Arg("event", "stop"),
		filters.Arg("event", "destroy"),
	)

	msgCh, errCh := cli.Events(ctx, events.ListOptions{
		Filters: eventFilters,
	})

	w.logger.Info("connected to Docker event stream")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case msg, ok := <-msgCh:
			if !ok {
				return nil // channel closed
			}
			w.handleEvent(msg)

		case err, ok := <-errCh:
			if !ok {
				return nil
			}
			return err
		}
	}
}

// handleEvent processes a single Docker event.
func (w *Watcher) handleEvent(msg events.Message) {
	// Extract compose project name
	projectName := msg.Actor.Attributes["com.docker.compose.project"]
	if projectName == "" {
		return // not a compose-managed container
	}

	serviceName := msg.Actor.Attributes["com.docker.compose.service"]

	// Look up app name from project name
	w.projectMapMu.RLock()
	appName, known := w.projectMap[projectName]
	w.projectMapMu.RUnlock()

	if !known {
		return // not a managed application
	}

	// Check if this service has the ignore-drift label — suppress self-heal
	// triggers for services that are explicitly excluded from drift detection.
	if msg.Actor.Attributes[differ.IgnoreDriftLabel] == "true" {
		w.logger.Debug("suppressing self-heal for ignore-drift service",
			"app", appName,
			"service", serviceName,
		)
		return
	}

	// Check if this event is within the self-event guard window
	if w.isSelfEvent(appName) {
		w.logger.Debug("suppressing self-event",
			"app", appName,
			"event", msg.Action,
			"service", serviceName,
		)
		return
	}

	containerID := msg.Actor.ID
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	w.logger.Info("container event detected",
		"app", appName,
		"event", msg.Action,
		"service", serviceName,
		"container", containerID,
	)

	// Record event in store
	w.recordEvent(appName, msg, serviceName)

	// Broadcast container event to SSE subscribers
	if w.broadcaster != nil {
		w.broadcaster.Broadcast(eventbus.Event{
			Type:    "container",
			AppName: appName,
			Data:    map[string]interface{}{"action": string(msg.Action), "service": serviceName},
		})
	}

	// Debounce and trigger reconciliation
	w.debounce.Debounce(appName, func() {
		w.logger.Info("triggering self-heal reconciliation", "app", appName)
		w.trigger.TriggerReconcile(appName)
	})
}

// isSelfEvent checks if the event was caused by a recent dockercd sync.
// Uses RLock for the common (no-expiry) read path; upgrades to Lock only
// when an expired entry needs to be deleted.
func (w *Watcher) isSelfEvent(appName string) bool {
	w.recentSyncsMu.RLock()
	syncTime, exists := w.recentSyncs[appName]
	w.recentSyncsMu.RUnlock()

	if !exists {
		return false
	}
	if time.Since(syncTime) <= w.config.SelfEventGuard {
		return true // within guard window
	}

	// Entry expired — delete under write lock (re-check to avoid TOCTOU)
	w.recentSyncsMu.Lock()
	if t, ok := w.recentSyncs[appName]; ok && time.Since(t) > w.config.SelfEventGuard {
		delete(w.recentSyncs, appName)
	}
	w.recentSyncsMu.Unlock()
	return false
}

// recordEvent stores the container event in the database.
func (w *Watcher) recordEvent(appName string, msg events.Message, serviceName string) {
	event := &store.EventRecord{
		AppName:  appName,
		Type:     "ContainerEvent",
		Message:  "Container " + string(msg.Action) + ": " + serviceName,
		Severity: "warning",
	}
	// Use a fresh context so event recording is not cancelled by watcher shutdown.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := w.store.RecordEvent(ctx, event); err != nil {
		w.logger.Error("failed to record event", "error", err)
	}
}
