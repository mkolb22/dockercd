package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/deployer"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock implementations ---

type mockGitSyncer struct {
	sha    string
	err    error
	path   string
	synced bool
}

func (m *mockGitSyncer) Sync(_ context.Context, _ app.SourceSpec) (string, error) {
	m.synced = true
	return m.sha, m.err
}
func (m *mockGitSyncer) CheckoutSHA(_ context.Context, _ string, _ string) error { return m.err }
func (m *mockGitSyncer) RepoPath(_ string) string                                { return m.path }
func (m *mockGitSyncer) Commit(_ context.Context, _ string, _ string, _ []string) error {
	return nil
}
func (m *mockGitSyncer) Push(_ context.Context, _ string) error { return nil }
func (m *mockGitSyncer) Close() error                           { return nil }

type mockParser struct {
	spec *app.ComposeSpec
	err  error
}

func (m *mockParser) Parse(_ context.Context, _ string, _ []string) (*app.ComposeSpec, error) {
	return m.spec, m.err
}

type mockInspector struct {
	states          []app.ServiceState
	statesByProject map[string][]app.ServiceState
	err             error
	destinations    []app.DestinationSpec
}

func (m *mockInspector) Inspect(_ context.Context, dest app.DestinationSpec) ([]app.ServiceState, error) {
	m.destinations = append(m.destinations, dest)
	if m.statesByProject != nil {
		if states, ok := m.statesByProject[dest.ProjectName]; ok {
			return states, m.err
		}
	}
	return m.states, m.err
}
func (m *mockInspector) InspectService(_ context.Context, _ app.DestinationSpec, _ string) (*app.ServiceState, error) {
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

type mockDiffer struct {
	result  *app.DiffResult
	desired []app.ServiceSpec
	live    []app.ServiceState
}

func (m *mockDiffer) Diff(desired []app.ServiceSpec, live []app.ServiceState) *app.DiffResult {
	m.desired = desired
	m.live = live
	return m.result
}

type mockDeployer struct {
	deployed           bool
	deployCalls        int
	deployServiceCalls int
	pulled             bool
	pullCalls          int
	err                error
	lastReq            deployer.DeployRequest
	downed             bool
	downErr            error
	hookRun            bool
	hookServices       []string
	hookErr            error
	deployFn           func(context.Context, deployer.DeployRequest) error
}

func (m *mockDeployer) Deploy(ctx context.Context, req deployer.DeployRequest) error {
	m.deployed = true
	m.deployCalls++
	m.lastReq = req
	if m.deployFn != nil {
		return m.deployFn(ctx, req)
	}
	return m.err
}
func (m *mockDeployer) Pull(_ context.Context, req deployer.DeployRequest) error {
	m.pulled = true
	m.pullCalls++
	m.lastReq = req
	return m.err
}
func (m *mockDeployer) DeployServices(_ context.Context, req deployer.DeployRequest, _ []string) error {
	m.deployed = true
	m.deployServiceCalls++
	m.lastReq = req
	return m.err
}
func (m *mockDeployer) Down(_ context.Context, req deployer.DeployRequest) error {
	m.downed = true
	return m.downErr
}
func (m *mockDeployer) RunHook(_ context.Context, _ deployer.DeployRequest, serviceName string) error {
	m.hookRun = true
	m.hookServices = append(m.hookServices, serviceName)
	return m.hookErr
}

type mockHealthMonitor struct {
	watchCalled   bool
	unwatchCalled bool
	waitCalled    bool
	waitCalls     [][]string
	waitErr       error
	waitServices  []string
}

func (m *mockHealthMonitor) Start(_ context.Context) error { return nil }
func (m *mockHealthMonitor) Stop()                         {}
func (m *mockHealthMonitor) CheckApp(_ context.Context, _ string) (app.HealthStatus, []app.ServiceStatus, error) {
	return app.HealthStatusHealthy, nil, nil
}
func (m *mockHealthMonitor) WatchApp(_ string, _ time.Duration) {
	m.watchCalled = true
}
func (m *mockHealthMonitor) UnwatchApp(_ string) {
	m.unwatchCalled = true
}
func (m *mockHealthMonitor) WaitForServicesHealthy(_ context.Context, _ string, serviceNames []string, _ time.Duration) error {
	m.waitCalled = true
	m.waitCalls = append(m.waitCalls, append([]string(nil), serviceNames...))
	m.waitServices = serviceNames
	return m.waitErr
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

func createTestApp(t *testing.T, s *store.SQLiteStore, name string, automated bool, lastSyncedSHA string) {
	t.Helper()
	application := app.Application{
		APIVersion: "dockercd/v1",
		Kind:       "Application",
		Metadata:   app.AppMetadata{Name: name},
		Spec: app.AppSpec{
			Source: app.SourceSpec{
				RepoURL:        "https://github.com/test/repo.git",
				TargetRevision: "main",
				Path:           ".",
				ComposeFiles:   []string{"docker-compose.yml"},
			},
			Destination: app.DestinationSpec{
				DockerHost:  "unix:///var/run/docker.sock",
				ProjectName: name,
			},
			SyncPolicy: app.SyncPolicy{
				Automated: automated,
				Prune:     true,
			},
		},
	}

	manifest, _ := json.Marshal(application)
	rec := &store.ApplicationRecord{
		Name:         name,
		Manifest:     string(manifest),
		SyncStatus:   string(app.SyncStatusUnknown),
		HealthStatus: string(app.HealthStatusUnknown),
	}
	if err := s.CreateApplication(context.Background(), rec); err != nil {
		t.Fatalf("create app: %v", err)
	}
	// CreateApplication INSERT doesn't include last_synced_sha, so set it via update
	if lastSyncedSHA != "" {
		if err := s.UpdateApplicationStatus(context.Background(), name, store.StatusUpdate{
			LastSyncedSHA: lastSyncedSHA,
		}); err != nil {
			t.Fatalf("set last_synced_sha: %v", err)
		}
	}
}

func newTestReconciler(
	s *store.SQLiteStore,
	gs *mockGitSyncer,
	p *mockParser,
	insp *mockInspector,
	d *mockDiffer,
	dep *mockDeployer,
) *ReconcilerImpl {
	return New(Deps{
		GitSyncer:   gs,
		Parser:      p,
		Inspector:   insp,
		Differ:      d,
		Deployer:    dep,
		Store:       s,
		Logger:      testLogger(),
		WorkerCount: 1,
	})
}

// --- Tests ---

func TestReconcile_NoChanges_Skip(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "abc123")

	gs := &mockGitSyncer{sha: "abc123", path: "/tmp/repo"}
	p := &mockParser{}
	insp := &mockInspector{}
	d := &mockDiffer{}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	// Use reconcileApp with forced=false to test the skip path
	lock := r.getAppLock("myapp")
	lock.Lock()
	result, err := r.reconcileApp(context.Background(), "myapp", false)
	lock.Unlock()

	// No error since skipping is normal
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Result != app.SyncResultSkipped {
		t.Errorf("expected skipped, got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should not have deployed")
	}
}

func TestReconcile_ChangesDetected_AutomatedDeploy(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{Name: "web", Image: "nginx:1.26"},
		},
	}}
	insp := &mockInspector{states: []app.ServiceState{
		{Name: "web", Image: "nginx:1.25"},
	}}
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{
				ServiceName: "web",
				ChangeType:  app.ChangeTypeUpdate,
				Fields: []app.FieldDiff{
					{Field: "image", Desired: "nginx:1.26", Live: "nginx:1.25"},
				},
			},
		},
		Summary: "1 to update",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	result, _ := r.ReconcileNow(context.Background(), "myapp")

	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success, got %s (err: %s)", result.Result, result.Error)
	}
	if !dep.deployed {
		t.Error("should have deployed")
	}

	// Verify pull was requested (image change)
	if !dep.lastReq.Pull {
		t.Error("should have pulled images (image change detected)")
	}

	// Verify status was updated
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.LastSyncedSHA != "new-sha" {
		t.Errorf("expected LastSyncedSHA=new-sha, got %q", appRec.LastSyncedSHA)
	}
}

func TestReconcile_ChangesDetected_ManualMode(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", false, "old-sha") // automated=false

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{Name: "web", Image: "nginx:1.26"},
		},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{
		InSync:  false,
		Summary: "1 to update",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	// Use reconcileApp directly with forced=false to simulate poll behavior
	lock := r.getAppLock("myapp")
	lock.Lock()
	result, _ := r.reconcileApp(context.Background(), "myapp", false)
	lock.Unlock()

	if result.Result != app.SyncResultSkipped {
		t.Errorf("expected skipped (manual mode), got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should NOT have deployed in manual mode")
	}

	// Containers exist (no ToCreate in diff) → ManuallyManaged, not OutOfSync
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.SyncStatus != string(app.SyncStatusManuallyManaged) {
		t.Errorf("expected ManuallyManaged, got %q", appRec.SyncStatus)
	}
}

func TestReconcile_ManualMode_ForcedSync(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", false, "old-sha") // automated=false

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.26"}},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{InSync: false, Summary: "1 to update"}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	// ReconcileNow is forced=true, so manual-policy apps deploy when the
	// user explicitly clicks Sync or calls the API/CLI sync endpoint.
	result, _ := r.ReconcileNow(context.Background(), "myapp")

	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success (forced manual sync), got %s", result.Result)
	}
	if !dep.deployed {
		t.Error("should deploy manual-policy apps when forced")
	}

	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.SyncStatus != string(app.SyncStatusSynced) {
		t.Errorf("expected Synced, got %q", appRec.SyncStatus)
	}
}

func TestReconcile_GitError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "")

	gs := &mockGitSyncer{err: fmt.Errorf("connection refused")}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, &mockParser{}, &mockInspector{}, &mockDiffer{}, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err == nil {
		t.Fatal("expected error")
	}
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should not deploy after git error")
	}

	// Check health was set to Degraded
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.HealthStatus != string(app.HealthStatusDegraded) {
		t.Errorf("expected Degraded health, got %q", appRec.HealthStatus)
	}
}

func TestReconcile_ParseError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "")

	gs := &mockGitSyncer{sha: "abc123", path: "/tmp/repo"}
	p := &mockParser{err: fmt.Errorf("invalid YAML")}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, &mockInspector{}, &mockDiffer{}, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err == nil {
		t.Fatal("expected error")
	}
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should not deploy after parse error")
	}

	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.HealthStatus != string(app.HealthStatusDegraded) {
		t.Errorf("expected Degraded, got %q", appRec.HealthStatus)
	}
}

func TestReconcile_InspectError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "")

	gs := &mockGitSyncer{sha: "abc123", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx"}},
	}}
	insp := &mockInspector{err: fmt.Errorf("docker socket unreachable")}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, &mockDiffer{}, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err == nil {
		t.Fatal("expected error")
	}
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should not deploy after inspect error")
	}
}

func TestReconcile_DeployError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.26"}},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{InSync: false, Summary: "changes"}}
	dep := &mockDeployer{err: fmt.Errorf("compose up failed")}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err == nil {
		t.Fatal("expected error")
	}
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
	if !dep.deployed {
		t.Error("deploy should have been attempted")
	}

	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.HealthStatus != string(app.HealthStatusDegraded) {
		t.Errorf("expected Degraded after deploy error, got %q", appRec.HealthStatus)
	}
}

func TestReconcile_EnforcesSyncTimeout(t *testing.T) {
	s := setupTestStore(t)
	application := app.Application{
		APIVersion: "dockercd/v1",
		Kind:       "Application",
		Metadata:   app.AppMetadata{Name: "myapp"},
		Spec: app.AppSpec{
			Source: app.SourceSpec{
				RepoURL:        "https://github.com/test/repo.git",
				TargetRevision: "main",
				Path:           ".",
				ComposeFiles:   []string{"docker-compose.yml"},
			},
			Destination: app.DestinationSpec{
				DockerHost:  "unix:///var/run/docker.sock",
				ProjectName: "myapp",
			},
			SyncPolicy: app.SyncPolicy{
				Automated:   true,
				SyncTimeout: app.NewDuration(5 * time.Millisecond),
			},
		},
	}
	manifest, _ := json.Marshal(application)
	if err := s.CreateApplication(context.Background(), &store.ApplicationRecord{
		Name:         "myapp",
		Manifest:     string(manifest),
		SyncStatus:   string(app.SyncStatusUnknown),
		HealthStatus: string(app.HealthStatusUnknown),
	}); err != nil {
		t.Fatalf("create app: %v", err)
	}

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.26"}},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{InSync: false, Summary: "changes"}}
	dep := &mockDeployer{
		deployFn: func(ctx context.Context, _ deployer.DeployRequest) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err == nil {
		t.Fatal("expected timeout error")
	}
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
	if !strings.Contains(result.Error, "sync timeout after") {
		t.Fatalf("expected sync timeout error, got %q", result.Error)
	}
	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if !strings.Contains(appRec.LastError, "sync timeout after") {
		t.Fatalf("expected persisted timeout error, got %q", appRec.LastError)
	}
}

func TestReconcile_InSync(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.25"}},
	}}
	insp := &mockInspector{states: []app.ServiceState{
		{Name: "web", Image: "nginx:1.25"},
	}}
	d := &mockDiffer{result: &app.DiffResult{InSync: true, Summary: "All services in sync"}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	result, _ := r.ReconcileNow(context.Background(), "myapp")

	if result.Result != app.SyncResultSkipped {
		t.Errorf("expected skipped (in sync), got %s", result.Result)
	}
	if dep.deployed {
		t.Error("should not deploy when in sync")
	}

	appRec, _ := s.GetApplication(context.Background(), "myapp")
	if appRec.SyncStatus != string(app.SyncStatusSynced) {
		t.Errorf("expected Synced, got %q", appRec.SyncStatus)
	}
	if appRec.LastSyncedSHA != "new-sha" {
		t.Errorf("expected SHA updated to new-sha, got %q", appRec.LastSyncedSHA)
	}
}

func TestReconcile_AppNotFound(t *testing.T) {
	s := setupTestStore(t)

	r := newTestReconciler(s, &mockGitSyncer{}, &mockParser{}, &mockInspector{}, &mockDiffer{}, &mockDeployer{})
	result, err := r.ReconcileNow(context.Background(), "nonexistent")

	// App not found is a silent no-op: deleted app races with in-flight worker.
	// The worker should not record a sync or return an error — just skip.
	if err != nil {
		t.Fatalf("expected no error for missing app, got %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result for missing app, got %+v", result)
	}
}

func TestReconcile_SyncRecordCreated(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "abc123")

	gs := &mockGitSyncer{sha: "abc123", path: "/tmp/repo"}
	r := newTestReconciler(s, gs, &mockParser{}, &mockInspector{}, &mockDiffer{}, &mockDeployer{})

	_, _ = r.ReconcileNow(context.Background(), "myapp")

	// Verify sync record was created
	records, err := s.ListSyncHistory(context.Background(), "myapp", 10)
	if err != nil {
		t.Fatalf("list sync history: %v", err)
	}
	if len(records) == 0 {
		t.Fatal("expected at least 1 sync record")
	}
	if records[0].AppName != "myapp" {
		t.Errorf("expected appName=myapp, got %q", records[0].AppName)
	}
}

func TestReconcile_PruneOnlyWhenRemovalsExist(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.26"}},
	}}
	insp := &mockInspector{}

	// Diff with no ToRemove
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", Fields: []app.FieldDiff{{Field: "image"}}},
		},
		Summary: "update",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	_, _ = r.ReconcileNow(context.Background(), "myapp")

	if dep.lastReq.Prune {
		t.Error("should not prune when no services to remove")
	}
}

func TestReconcile_PruneWhenRemovalsExist(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx"}},
	}}
	insp := &mockInspector{}

	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToRemove: []app.ServiceDiff{
			{ServiceName: "old-svc", ChangeType: app.ChangeTypeRemove},
		},
		Summary: "remove",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	_, _ = r.ReconcileNow(context.Background(), "myapp")

	if !dep.lastReq.Prune {
		t.Error("should prune when services to remove exist")
	}
}

// --- Circuit breaker tests ---

func TestCircuitBreaker_ClosedByDefault(t *testing.T) {
	cb := NewCircuitBreaker(3, 5*time.Minute)
	if !cb.Allow() {
		t.Error("expected Allow=true when closed")
	}
	if cb.State() != CircuitClosed {
		t.Error("expected CircuitClosed")
	}
}

func TestCircuitBreaker_OpensAfterMaxFailures(t *testing.T) {
	cb := NewCircuitBreaker(3, 5*time.Minute)

	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != CircuitClosed {
		t.Error("should still be closed after 2 failures")
	}

	cb.RecordFailure()
	if cb.State() != CircuitOpen {
		t.Error("should be open after 3 failures")
	}
	if cb.Allow() {
		t.Error("should not allow when open")
	}
}

func TestCircuitBreaker_SuccessResets(t *testing.T) {
	cb := NewCircuitBreaker(3, 5*time.Minute)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordSuccess()

	if cb.State() != CircuitClosed {
		t.Error("should be closed after success")
	}
	if cb.FailureCount() != 0 {
		t.Error("failure count should be reset")
	}
}

func TestCircuitBreaker_HalfOpenAfterTimeout(t *testing.T) {
	cb := NewCircuitBreaker(3, 10*time.Millisecond)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != CircuitOpen {
		t.Fatal("expected open")
	}

	// Wait for reset timeout
	time.Sleep(15 * time.Millisecond)

	if !cb.Allow() {
		t.Error("should allow after timeout (half-open)")
	}
	if cb.State() != CircuitHalfOpen {
		t.Error("expected half-open")
	}
}

func TestCircuitBreaker_HalfOpenSuccess_Closes(t *testing.T) {
	cb := NewCircuitBreaker(3, 10*time.Millisecond)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	time.Sleep(15 * time.Millisecond)
	cb.Allow() // moves to half-open

	cb.RecordSuccess()
	if cb.State() != CircuitClosed {
		t.Error("expected closed after half-open success")
	}
}

func TestCircuitBreaker_HalfOpenFailure_Reopens(t *testing.T) {
	cb := NewCircuitBreaker(3, 10*time.Millisecond)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	time.Sleep(15 * time.Millisecond)
	cb.Allow() // moves to half-open

	cb.RecordFailure()
	if cb.State() != CircuitOpen {
		t.Error("expected re-open after half-open failure")
	}
}

func TestReconcile_CircuitBreakerOpens(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "")

	gs := &mockGitSyncer{err: fmt.Errorf("connection refused")}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, &mockParser{}, &mockInspector{}, &mockDiffer{}, dep)

	// Fail 3 times to open the circuit
	for i := 0; i < 3; i++ {
		_, _ = r.ReconcileNow(context.Background(), "myapp")
	}

	// Fourth attempt should be skipped by circuit breaker
	result, _ := r.ReconcileNow(context.Background(), "myapp")
	if result.Result != app.SyncResultSkipped {
		t.Errorf("expected skipped (circuit breaker open), got %s", result.Result)
	}

	// Verify git sync was NOT called on the 4th attempt
	gs.synced = false
	_, _ = r.ReconcileNow(context.Background(), "myapp")
	if gs.synced {
		t.Error("should not have called git sync when circuit breaker is open")
	}
}

func TestHasImageChanges(t *testing.T) {
	tests := []struct {
		name string
		diff *app.DiffResult
		want bool
	}{
		{
			name: "new service",
			diff: &app.DiffResult{
				ToCreate: []app.ServiceDiff{{ServiceName: "web"}},
			},
			want: true,
		},
		{
			name: "image field changed",
			diff: &app.DiffResult{
				ToUpdate: []app.ServiceDiff{
					{Fields: []app.FieldDiff{{Field: "image"}}},
				},
			},
			want: true,
		},
		{
			name: "env change only",
			diff: &app.DiffResult{
				ToUpdate: []app.ServiceDiff{
					{Fields: []app.FieldDiff{{Field: "environment.FOO"}}},
				},
			},
			want: false,
		},
		{
			name: "no changes",
			diff: &app.DiffResult{InSync: true},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasImageChanges(tt.diff); got != tt.want {
				t.Errorf("hasImageChanges() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDryRun_ReturnsDiffWithoutDeploying(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{Name: "web", Image: "nginx:1.26"},
		},
	}}
	insp := &mockInspector{states: []app.ServiceState{
		{Name: "web", Image: "nginx:1.25"},
	}}
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{
				ServiceName: "web",
				ChangeType:  app.ChangeTypeUpdate,
				Fields: []app.FieldDiff{
					{Field: "image", Desired: "nginx:1.26", Live: "nginx:1.25"},
				},
			},
		},
		Summary: "1 to update",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	diff, headSHA, err := r.DryRun(context.Background(), "myapp")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if headSHA != "new-sha" {
		t.Errorf("expected headSHA=new-sha, got %q", headSHA)
	}
	if diff == nil {
		t.Fatal("expected diff result")
	}
	if diff.InSync {
		t.Error("expected diff.InSync=false (changes exist)")
	}
	if dep.deployed {
		t.Error("dry-run should not deploy")
	}
}

func TestDryRun_BlueGreenDiffUsesActiveColor(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{
				Name:  "web",
				Image: "nginx:1.27",
				Labels: map[string]string{
					"com.dockercd.strategy": "blue-green",
				},
			},
		},
	}}
	insp := &mockInspector{
		statesByProject: map[string][]app.ServiceState{
			"myapp-blue": {
				{Name: "web", Image: "nginx:1.26", Status: "running", Health: app.HealthStatusHealthy},
			},
			"myapp-green": nil,
		},
	}
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeUpdate},
		},
		Summary: "image changed",
	}}

	r := New(Deps{
		GitSyncer:   gs,
		Parser:      p,
		Inspector:   insp,
		Differ:      d,
		Deployer:    &mockDeployer{},
		Store:       s,
		Logger:      testLogger(),
		WorkerCount: 1,
	})

	diff, _, err := r.DryRun(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if diff == nil || diff.InSync {
		t.Fatalf("expected out-of-sync diff, got %+v", diff)
	}
	if len(d.live) != 1 || d.live[0].Image != "nginx:1.26" {
		t.Fatalf("expected diff against active blue state, got %+v", d.live)
	}
	if len(insp.destinations) != 1 || insp.destinations[0].ProjectName != "myapp-blue" {
		t.Fatalf("expected only active blue project inspection, got %+v", insp.destinations)
	}
}

func TestRenderDesired_DoesNotInspectDocker(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.27"}},
	}}
	insp := &mockInspector{err: fmt.Errorf("docker unavailable")}

	r := New(Deps{
		GitSyncer:   gs,
		Parser:      p,
		Inspector:   insp,
		Differ:      &mockDiffer{},
		Deployer:    &mockDeployer{},
		Store:       s,
		Logger:      testLogger(),
		WorkerCount: 1,
	})

	rendered, headSHA, err := r.RenderDesired(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("RenderDesired: %v", err)
	}
	if headSHA != "new-sha" {
		t.Fatalf("expected headSHA=new-sha, got %q", headSHA)
	}
	if rendered == nil || len(rendered.Services) != 1 {
		t.Fatalf("unexpected rendered spec: %+v", rendered)
	}
	if len(insp.destinations) != 0 {
		t.Fatalf("expected no Docker inspections, got %+v", insp.destinations)
	}
}

func TestReconcile_SyncWaves_DeploysInOrder(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{Name: "web", Image: "nginx:1.26", Labels: map[string]string{"com.dockercd.sync-wave": "1"}},
			{Name: "db", Image: "postgres:16", Labels: map[string]string{"com.dockercd.sync-wave": "0"}},
			{Name: "cache", Image: "redis:7"}, // no label = wave 0
		},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeUpdate, Fields: []app.FieldDiff{{Field: "image"}}},
		},
		Summary: "changes",
	}}
	dep := &mockDeployer{}
	hm := &mockHealthMonitor{}

	r := New(Deps{
		GitSyncer:     gs,
		Parser:        p,
		Inspector:     insp,
		Differ:        d,
		Deployer:      dep,
		HealthMonitor: hm,
		Store:         s,
		Logger:        testLogger(),
		WorkerCount:   1,
	})

	result, err := r.ReconcileNow(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success, got %s (err: %s)", result.Result, result.Error)
	}
	if !dep.deployed {
		t.Error("should have deployed")
	}
	if dep.deployServiceCalls != 2 {
		t.Errorf("expected two service wave deploys, got %d", dep.deployServiceCalls)
	}
	if dep.deployCalls != 0 {
		t.Errorf("expected no full deploy during wave sync, got %d", dep.deployCalls)
	}
	if dep.pullCalls != 1 {
		t.Errorf("expected one pull before wave deploys, got %d", dep.pullCalls)
	}
	// With multiple waves (wave 0: db+cache, wave 1: web), each wave is health
	// gated, including the final wave before post-sync hooks would run.
	if len(hm.waitCalls) != 2 {
		t.Fatalf("expected WaitForServicesHealthy for each wave, got %d", len(hm.waitCalls))
	}
	if fmt.Sprint(hm.waitCalls[0]) != "[cache db]" {
		t.Errorf("expected wave 0 services [cache db], got %v", hm.waitCalls[0])
	}
	if fmt.Sprint(hm.waitCalls[1]) != "[web]" {
		t.Errorf("expected wave 1 services [web], got %v", hm.waitCalls[1])
	}
}

func TestReconcile_TLSLookupPopulatesCertPath(t *testing.T) {
	s := setupTestStore(t)

	// Create an app targeting a remote Docker host
	application := app.Application{
		APIVersion: "dockercd/v1",
		Kind:       "Application",
		Metadata:   app.AppMetadata{Name: "remote-app"},
		Spec: app.AppSpec{
			Source: app.SourceSpec{
				RepoURL:        "https://github.com/test/repo.git",
				TargetRevision: "main",
				Path:           ".",
				ComposeFiles:   []string{"docker-compose.yml"},
			},
			Destination: app.DestinationSpec{
				DockerHost:  "tcp://192.168.1.100:2376",
				ProjectName: "remote-app",
			},
			SyncPolicy: app.SyncPolicy{Automated: true},
		},
	}
	manifest, _ := json.Marshal(application)
	_ = s.CreateApplication(context.Background(), &store.ApplicationRecord{
		Name:         "remote-app",
		Manifest:     string(manifest),
		SyncStatus:   string(app.SyncStatusUnknown),
		HealthStatus: string(app.HealthStatusUnknown),
	})

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:1.26"}},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{
		InSync:  false,
		Summary: "1 to update",
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeUpdate, Fields: []app.FieldDiff{{Field: "image"}}},
		},
	}}
	dep := &mockDeployer{}

	r := New(Deps{
		GitSyncer:   gs,
		Parser:      p,
		Inspector:   insp,
		Differ:      d,
		Deployer:    dep,
		Store:       s,
		Logger:      testLogger(),
		WorkerCount: 1,
		TLSLookup: func(host string) string {
			if host == "tcp://192.168.1.100:2376" {
				return "/certs/remote-server"
			}
			return ""
		},
	})

	result, err := r.ReconcileNow(context.Background(), "remote-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success, got %s (err: %s)", result.Result, result.Error)
	}
	if dep.lastReq.TLSCertPath != "/certs/remote-server" {
		t.Errorf("expected TLSCertPath=/certs/remote-server, got %q", dep.lastReq.TLSCertPath)
	}
}

func TestReconcile_HookServicesPassedToDeployer(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "old-sha")

	gs := &mockGitSyncer{sha: "new-sha", path: "/tmp/repo"}
	p := &mockParser{spec: &app.ComposeSpec{
		Services: []app.ServiceSpec{
			{Name: "web", Image: "nginx:1.26"},
			{Name: "migrate", Image: "myapp:latest", Labels: map[string]string{"com.dockercd.hook": "pre-sync"}},
			{Name: "notify", Image: "myapp:latest", Labels: map[string]string{"com.dockercd.hook": "post-sync"}},
		},
	}}
	insp := &mockInspector{}
	d := &mockDiffer{result: &app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeUpdate, Fields: []app.FieldDiff{{Field: "image"}}},
		},
		Summary: "1 to update",
	}}
	dep := &mockDeployer{}

	r := newTestReconciler(s, gs, p, insp, d, dep)
	result, err := r.ReconcileNow(context.Background(), "myapp")

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success, got %s (err: %s)", result.Result, result.Error)
	}
	if !dep.deployed {
		t.Error("should have deployed")
	}
	// Verify pre-sync and post-sync services were passed to the deployer
	if len(dep.lastReq.PreSyncServices) != 1 || dep.lastReq.PreSyncServices[0] != "migrate" {
		t.Errorf("expected PreSyncServices=[migrate], got %v", dep.lastReq.PreSyncServices)
	}
	if len(dep.lastReq.PostSyncServices) != 1 || dep.lastReq.PostSyncServices[0] != "notify" {
		t.Errorf("expected PostSyncServices=[notify], got %v", dep.lastReq.PostSyncServices)
	}
}
