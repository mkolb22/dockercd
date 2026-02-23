package events

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/docker/docker/api/types/events"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock implementations ---

type mockEventClient struct {
	msgCh chan events.Message
	errCh chan error
}

func newMockEventClient() *mockEventClient {
	return &mockEventClient{
		msgCh: make(chan events.Message, 100),
		errCh: make(chan error, 10),
	}
}

func (m *mockEventClient) Events(_ context.Context, _ events.ListOptions) (<-chan events.Message, <-chan error) {
	return m.msgCh, m.errCh
}

func (m *mockEventClient) Close() error { return nil }

type mockTrigger struct {
	mu       sync.Mutex
	triggers []string
}

func (m *mockTrigger) TriggerReconcile(appName string) {
	m.mu.Lock()
	m.triggers = append(m.triggers, appName)
	m.mu.Unlock()
}

func (m *mockTrigger) getTriggers() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]string, len(m.triggers))
	copy(result, m.triggers)
	return result
}

func (m *mockTrigger) triggerCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.triggers)
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func setupTestStore(t *testing.T) *store.SQLiteStore {
	t.Helper()
	s, err := store.New(":memory:", testLogger())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func createTestApp(t *testing.T, s *store.SQLiteStore, name, projectName string) {
	t.Helper()
	manifest := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"` + name + `"},"spec":{"source":{"repoURL":"https://github.com/test/repo.git","targetRevision":"main","path":".","composeFiles":["docker-compose.yml"]},"destination":{"dockerHost":"unix:///var/run/docker.sock","projectName":"` + projectName + `"},"syncPolicy":{"automated":true,"selfHeal":true}}}`
	rec := &store.ApplicationRecord{
		Name:         name,
		Manifest:     manifest,
		SyncStatus:   string(app.SyncStatusUnknown),
		HealthStatus: string(app.HealthStatusUnknown),
	}
	if err := s.CreateApplication(context.Background(), rec); err != nil {
		t.Fatalf("create app: %v", err)
	}
}

func composeEvent(action, projectName, serviceName string) events.Message {
	return events.Message{
		Action: events.Action(action),
		Actor: events.Actor{
			ID: "abc123def456",
			Attributes: map[string]string{
				"com.docker.compose.project": projectName,
				"com.docker.compose.service": serviceName,
			},
		},
	}
}

func newTestWatcher(t *testing.T, client *mockEventClient, trigger *mockTrigger, s *store.SQLiteStore, cfg WatcherConfig) *Watcher {
	t.Helper()
	factory := func(host string) (EventClient, error) {
		return client, nil
	}
	return NewWatcher(factory, trigger, s, testLogger(), cfg)
}

func TestHandleEvent_TriggersReconciliation(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := WatcherConfig{
		DebounceWindow:   10 * time.Millisecond,
		SelfEventGuard:   5 * time.Second,
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	// Send a die event
	w.handleEvent(composeEvent("die", "myproject", "web"))

	// Wait for debounce
	time.Sleep(50 * time.Millisecond)

	triggers := trigger.getTriggers()
	if len(triggers) != 1 {
		t.Fatalf("expected 1 trigger, got %d", len(triggers))
	}
	if triggers[0] != "myapp" {
		t.Errorf("expected trigger for myapp, got %q", triggers[0])
	}
}

func TestHandleEvent_IgnoresNonComposeContainers(t *testing.T) {
	s := setupTestStore(t)
	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := DefaultWatcherConfig()
	cfg.DebounceWindow = 10 * time.Millisecond

	w := newTestWatcher(t, client, trigger, s, cfg)

	// Event without compose labels
	msg := events.Message{
		Action: "die",
		Actor: events.Actor{
			ID:         "abc123",
			Attributes: map[string]string{},
		},
	}
	w.handleEvent(msg)

	time.Sleep(30 * time.Millisecond)

	if trigger.triggerCount() != 0 {
		t.Error("should not trigger for non-compose containers")
	}
}

func TestHandleEvent_IgnoresUnmanagedProjects(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := DefaultWatcherConfig()
	cfg.DebounceWindow = 10 * time.Millisecond

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	// Event for a project not managed by dockercd
	w.handleEvent(composeEvent("die", "unknown-project", "web"))

	time.Sleep(30 * time.Millisecond)

	if trigger.triggerCount() != 0 {
		t.Error("should not trigger for unmanaged projects")
	}
}

func TestHandleEvent_SelfEventSuppression(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := WatcherConfig{
		DebounceWindow:   10 * time.Millisecond,
		SelfEventGuard:   1 * time.Second,
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	// Record a recent sync
	w.RecordSync("myapp")

	// Send a die event (should be suppressed)
	w.handleEvent(composeEvent("die", "myproject", "web"))

	time.Sleep(30 * time.Millisecond)

	if trigger.triggerCount() != 0 {
		t.Error("should suppress events within self-event guard window")
	}
}

func TestHandleEvent_SelfEventExpires(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := WatcherConfig{
		DebounceWindow:   10 * time.Millisecond,
		SelfEventGuard:   10 * time.Millisecond, // very short guard
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	// Record a sync and wait for guard to expire
	w.RecordSync("myapp")
	time.Sleep(20 * time.Millisecond)

	// Now the event should not be suppressed
	w.handleEvent(composeEvent("die", "myproject", "web"))

	time.Sleep(30 * time.Millisecond)

	if trigger.triggerCount() != 1 {
		t.Errorf("expected 1 trigger after guard expiry, got %d", trigger.triggerCount())
	}
}

func TestHandleEvent_RecordsEvent(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := DefaultWatcherConfig()
	cfg.DebounceWindow = 10 * time.Millisecond

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	w.handleEvent(composeEvent("die", "myproject", "web"))

	// Check event was recorded
	evts, err := s.ListEvents(context.Background(), "myapp", 10)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(evts) != 1 {
		t.Fatalf("expected 1 event, got %d", len(evts))
	}
	if evts[0].Type != "ContainerEvent" {
		t.Errorf("expected ContainerEvent type, got %q", evts[0].Type)
	}
}

func TestStreamEvents_ProcessesMessages(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := WatcherConfig{
		DebounceWindow:   10 * time.Millisecond,
		SelfEventGuard:   5 * time.Second,
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}

	w := newTestWatcher(t, client, trigger, s, cfg)
	_ = w.refreshProjectMap(context.Background())

	ctx, cancel := context.WithCancel(context.Background())

	var done atomic.Bool
	go func() {
		_ = w.streamEvents(ctx, "")
		done.Store(true)
	}()

	// Send an event through the channel
	client.msgCh <- composeEvent("die", "myproject", "web")

	// Wait for debounce
	time.Sleep(50 * time.Millisecond)

	cancel()

	// Wait for stream to exit
	time.Sleep(20 * time.Millisecond)

	if trigger.triggerCount() != 1 {
		t.Errorf("expected 1 trigger, got %d", trigger.triggerCount())
	}
}

func TestStreamEvents_ExitsOnError(t *testing.T) {
	client := newMockEventClient()
	trigger := &mockTrigger{}
	s := setupTestStore(t)
	cfg := DefaultWatcherConfig()

	w := newTestWatcher(t, client, trigger, s, cfg)

	ctx := context.Background()

	var exited atomic.Bool
	go func() {
		_ = w.streamEvents(ctx, "")
		exited.Store(true)
	}()

	// Send an error
	client.errCh <- context.DeadlineExceeded

	time.Sleep(20 * time.Millisecond)

	if !exited.Load() {
		t.Error("expected streamEvents to exit on error")
	}
}

func TestStreamEvents_ExitsOnChannelClose(t *testing.T) {
	client := newMockEventClient()
	trigger := &mockTrigger{}
	s := setupTestStore(t)
	cfg := DefaultWatcherConfig()

	w := newTestWatcher(t, client, trigger, s, cfg)

	ctx := context.Background()

	var exited atomic.Bool
	go func() {
		_ = w.streamEvents(ctx, "")
		exited.Store(true)
	}()

	close(client.msgCh)

	time.Sleep(20 * time.Millisecond)

	if !exited.Load() {
		t.Error("expected streamEvents to exit when channel closes")
	}
}

func TestRefreshProjectMap(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", "myproject")
	createTestApp(t, s, "other", "otherproject")

	client := newMockEventClient()
	trigger := &mockTrigger{}
	cfg := DefaultWatcherConfig()

	w := newTestWatcher(t, client, trigger, s, cfg)
	if err := w.RefreshProjectMap(context.Background()); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	w.projectMapMu.RLock()
	defer w.projectMapMu.RUnlock()

	if w.projectMap["myproject"] != "myapp" {
		t.Errorf("expected myproject→myapp, got %q", w.projectMap["myproject"])
	}
	if w.projectMap["otherproject"] != "other" {
		t.Errorf("expected otherproject→other, got %q", w.projectMap["otherproject"])
	}
}

func TestRecordSync_AndExpiry(t *testing.T) {
	cfg := WatcherConfig{
		DebounceWindow:   10 * time.Millisecond,
		SelfEventGuard:   10 * time.Millisecond,
		ReconnectBackoff: 1 * time.Second,
		MaxBackoff:       30 * time.Second,
	}
	w := NewWatcher(nil, nil, nil, testLogger(), cfg)

	w.RecordSync("myapp")

	// Should be a self-event
	if !w.isSelfEvent("myapp") {
		t.Error("expected isSelfEvent=true immediately after RecordSync")
	}

	// Wait for guard to expire
	time.Sleep(20 * time.Millisecond)

	if w.isSelfEvent("myapp") {
		t.Error("expected isSelfEvent=false after guard expiry")
	}
}
