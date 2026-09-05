package health

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock inspector ---

type mockInspector struct {
	mu     sync.Mutex
	states []app.ServiceState
	err    error
	calls  int
}

// blockingInspector records concurrent inspections and only returns when its
// context is canceled. It makes poll timeout and concurrency behavior testable.
type blockingInspector struct {
	mu          sync.Mutex
	active      int
	maxActive   int
	calls       int
	deadlineSet bool
	started     chan struct{}
}

func (m *blockingInspector) Inspect(ctx context.Context, _ app.DestinationSpec) ([]app.ServiceState, error) {
	_, hasDeadline := ctx.Deadline()
	m.mu.Lock()
	m.calls++
	m.active++
	if m.active > m.maxActive {
		m.maxActive = m.active
	}
	m.deadlineSet = m.deadlineSet || hasDeadline
	m.mu.Unlock()

	m.started <- struct{}{}
	<-ctx.Done()

	m.mu.Lock()
	m.active--
	m.mu.Unlock()
	return nil, ctx.Err()
}

func (m *blockingInspector) InspectService(context.Context, app.DestinationSpec, string) (*app.ServiceState, error) {
	return nil, nil
}
func (m *blockingInspector) InspectWithMetrics(context.Context, app.DestinationSpec) ([]app.ServiceStatus, error) {
	return nil, nil
}
func (m *blockingInspector) SystemInfo(context.Context, string) (*app.DockerHostInfo, error) {
	return nil, nil
}
func (m *blockingInspector) HostStats(context.Context, string) (*app.HostStats, error) {
	return nil, nil
}
func (m *blockingInspector) InspectServiceDetail(context.Context, app.DestinationSpec, string) (*app.ServiceDetail, error) {
	return nil, nil
}
func (m *blockingInspector) GetServiceLogs(context.Context, app.DestinationSpec, string, int) ([]string, error) {
	return nil, nil
}
func (m *blockingInspector) RegisterTLS(string, inspector.TLSConfig) {}
func (m *blockingInspector) UnregisterTLS(string)                    {}
func (m *blockingInspector) GetTLSCertPath(string) string            { return "" }

func (m *blockingInspector) stats() (calls, maxActive int, deadlineSet bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls, m.maxActive, m.deadlineSet
}

func (m *mockInspector) Inspect(_ context.Context, _ app.DestinationSpec) ([]app.ServiceState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	return m.states, m.err
}

func (m *mockInspector) InspectService(_ context.Context, _ app.DestinationSpec, name string) (*app.ServiceState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.states {
		if s.Name == name {
			return &s, nil
		}
	}
	return nil, nil
}

func (m *mockInspector) InspectWithMetrics(_ context.Context, _ app.DestinationSpec) ([]app.ServiceStatus, error) {
	return nil, nil
}

func (m *mockInspector) SystemInfo(_ context.Context, _ string) (*app.DockerHostInfo, error) {
	return nil, nil
}

func (m *mockInspector) HostStats(_ context.Context, _ string) (*app.HostStats, error) {
	return nil, nil
}
func (m *mockInspector) InspectServiceDetail(_ context.Context, _ app.DestinationSpec, _ string) (*app.ServiceDetail, error) {
	return nil, nil
}
func (m *mockInspector) GetServiceLogs(_ context.Context, _ app.DestinationSpec, _ string, _ int) ([]string, error) {
	return nil, nil
}
func (m *mockInspector) RegisterTLS(_ string, _ inspector.TLSConfig) {}
func (m *mockInspector) UnregisterTLS(_ string)                      {}
func (m *mockInspector) GetTLSCertPath(_ string) string              { return "" }

func (m *mockInspector) getCalls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
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

func createTestApp(t *testing.T, s *store.SQLiteStore, name string) {
	t.Helper()
	manifest := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"` + name + `"},"spec":{"source":{"repoURL":"https://github.com/test/repo.git","targetRevision":"main","path":".","composeFiles":["docker-compose.yml"]},"destination":{"dockerHost":"unix:///var/run/docker.sock","projectName":"` + name + `"},"syncPolicy":{"automated":true}}}`
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

func TestCheckApp_AllHealthy(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Image: "nginx:1.26", Health: app.HealthStatusHealthy, Status: "running"},
			{Name: "api", Image: "node:20", Health: app.HealthStatusHealthy, Status: "running"},
		},
	}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, services, err := m.CheckApp(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if health != app.HealthStatusHealthy {
		t.Errorf("expected Healthy, got %s", health)
	}
	if len(services) != 2 {
		t.Errorf("expected 2 services, got %d", len(services))
	}
}

func TestCheckApp_OneDegraded(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusHealthy, Status: "running"},
			{Name: "db", Health: app.HealthStatusDegraded, Status: "running"},
		},
	}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, _, err := m.CheckApp(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if health != app.HealthStatusDegraded {
		t.Errorf("expected Degraded (worst-child), got %s", health)
	}
}

func TestCheckApp_Mixed(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusHealthy},
			{Name: "api", Health: app.HealthStatusProgressing},
			{Name: "db", Health: app.HealthStatusHealthy},
		},
	}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, _, err := m.CheckApp(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if health != app.HealthStatusProgressing {
		t.Errorf("expected Progressing (worst-child), got %s", health)
	}
}

func TestCheckApp_NoContainers(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{states: []app.ServiceState{}}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, services, err := m.CheckApp(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for no containers, got %s", health)
	}
	if len(services) != 0 {
		t.Errorf("expected 0 services, got %d", len(services))
	}
}

func TestCheckApp_InspectError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{err: context.DeadlineExceeded}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, _, err := m.CheckApp(context.Background(), "myapp")
	if err == nil {
		t.Fatal("expected error")
	}
	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown on error, got %s", health)
	}
}

func TestCheckApp_AppNotFound(t *testing.T) {
	s := setupTestStore(t)
	insp := &mockInspector{}

	m := New(insp, s, testLogger(), DefaultConfig())
	health, _, err := m.CheckApp(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for missing app, got %s", health)
	}
}

func TestCheckApp_PersistsStatus(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusHealthy, Status: "running"},
		},
	}

	m := New(insp, s, testLogger(), DefaultConfig())
	_, _, _ = m.CheckApp(context.Background(), "myapp")

	// Verify status was persisted
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.HealthStatus != string(app.HealthStatusHealthy) {
		t.Errorf("expected Healthy persisted, got %q", appRec.HealthStatus)
	}
	if appRec.ServicesJSON == "" {
		t.Error("expected services JSON to be persisted")
	}
}

func TestWaitForServicesHealthy_RequiresEveryRequestedService(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusHealthy, Status: "running"},
		},
	}
	cfg := DefaultConfig()
	cfg.PollInterval = time.Millisecond

	m := New(insp, s, testLogger(), cfg)
	err := m.WaitForServicesHealthy(context.Background(), "myapp", []string{"web", "db"}, 5*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout while requested service db is missing")
	}
}

func TestWatchApp_PollingStops_WhenHealthy(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusHealthy, Status: "running"},
		},
	}

	cfg := Config{PollInterval: 20 * time.Millisecond, DefaultTimeout: 5 * time.Second}
	m := New(insp, s, testLogger(), cfg)

	m.WatchApp("myapp", 5*time.Second)

	// Run one poll cycle
	ctx := context.Background()
	m.checkWatchedApps(ctx)

	// App should have been removed from watch list (it's healthy)
	m.watchedMu.Lock()
	_, stillWatched := m.watched["myapp"]
	m.watchedMu.Unlock()

	if stillWatched {
		t.Error("expected app to be unwatched after reaching Healthy")
	}
}

func TestWatchApp_PollingContinues_WhenDegraded(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusDegraded, Status: "running"},
		},
	}

	cfg := Config{PollInterval: 20 * time.Millisecond, DefaultTimeout: 5 * time.Second}
	m := New(insp, s, testLogger(), cfg)

	m.WatchApp("myapp", 5*time.Second)

	ctx := context.Background()
	m.checkWatchedApps(ctx)

	// App should still be watched (not healthy yet)
	m.watchedMu.Lock()
	_, stillWatched := m.watched["myapp"]
	m.watchedMu.Unlock()

	if !stillWatched {
		t.Error("expected app to remain watched when Degraded")
	}
}

func TestWatchApp_Timeout(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusProgressing, Status: "running"},
		},
	}

	cfg := Config{PollInterval: 20 * time.Millisecond, DefaultTimeout: 1 * time.Second}
	m := New(insp, s, testLogger(), cfg)

	// Watch with a very short timeout
	m.WatchApp("myapp", 1*time.Millisecond)

	// Wait for the timeout to pass
	time.Sleep(5 * time.Millisecond)

	ctx := context.Background()
	m.checkWatchedApps(ctx)

	// App should have been removed (timed out)
	m.watchedMu.Lock()
	_, stillWatched := m.watched["myapp"]
	m.watchedMu.Unlock()

	if stillWatched {
		t.Error("expected app to be unwatched after timeout")
	}

	// Verify error was recorded
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.LastError == "" {
		t.Error("expected timeout error to be persisted")
	}
}

func TestUnwatchApp(t *testing.T) {
	m := New(nil, nil, testLogger(), DefaultConfig())

	m.WatchApp("myapp", 5*time.Second)
	m.UnwatchApp("myapp")

	m.watchedMu.Lock()
	_, exists := m.watched["myapp"]
	m.watchedMu.Unlock()

	if exists {
		t.Error("expected app to be unwatched")
	}
}

func TestPollLoop_CalledMultipleTimes(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	insp := &mockInspector{
		states: []app.ServiceState{
			{Name: "web", Health: app.HealthStatusDegraded},
		},
	}

	cfg := Config{PollInterval: 10 * time.Millisecond, DefaultTimeout: 5 * time.Second}
	m := New(insp, s, testLogger(), cfg)

	m.WatchApp("myapp", 5*time.Second)

	ctx, cancel := context.WithCancel(context.Background())

	m.wg.Add(1)
	go func() {
		m.pollLoop(ctx)
	}()

	// Wait for at least 2 polls
	time.Sleep(50 * time.Millisecond)
	cancel()
	m.wg.Wait()

	if insp.getCalls() < 2 {
		t.Errorf("expected at least 2 poll calls, got %d", insp.getCalls())
	}
}

func TestSweepAllApps_BoundsConcurrencyAndUsesDeadlines(t *testing.T) {
	// A file-backed database permits concurrent reads from the worker pool. Each
	// SQLite in-memory connection otherwise owns an independent database.
	s, err := store.New(t.TempDir(), testLogger())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	for i := range 4 {
		createTestApp(t, s, fmt.Sprintf("app-%d", i))
	}

	insp := &blockingInspector{started: make(chan struct{}, 4)}
	cfg := DefaultConfig()
	cfg.MaxConcurrentChecks = 2
	cfg.CheckTimeout = 20 * time.Millisecond
	m := New(insp, s, testLogger(), cfg)

	done := make(chan struct{})
	go func() {
		m.sweepAllApps(context.Background())
		close(done)
	}()

	for range 4 {
		select {
		case <-insp.started:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for sweep checks")
		}
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("sweep did not finish after check deadlines")
	}

	calls, maxActive, deadlineSet := insp.stats()
	if calls != 4 {
		t.Errorf("expected 4 checks, got %d", calls)
	}
	if maxActive > cfg.MaxConcurrentChecks {
		t.Errorf("max concurrent checks = %d, limit = %d", maxActive, cfg.MaxConcurrentChecks)
	}
	if !deadlineSet {
		t.Error("expected each sweep check to receive a deadline")
	}
}

func TestStartSweep_SkipsOverlappingSweep(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	insp := &blockingInspector{started: make(chan struct{}, 1)}
	cfg := DefaultConfig()
	cfg.CheckTimeout = time.Second
	m := New(insp, s, testLogger(), cfg)

	ctx, cancel := context.WithCancel(context.Background())
	m.startSweep(ctx)
	select {
	case <-insp.started:
	case <-time.After(time.Second):
		t.Fatal("initial sweep did not start")
	}
	m.startSweep(ctx)
	time.Sleep(20 * time.Millisecond)

	calls, _, _ := insp.stats()
	if calls != 1 {
		t.Errorf("expected overlapping sweep to be skipped, got %d checks", calls)
	}
	cancel()
	m.wg.Wait()
}
