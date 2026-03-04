package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock reconciler ---

type mockReconciler struct {
	result *app.SyncResult
	err    error
}

// --- Mock inspector ---

type mockInspector struct {
	states []app.ServiceState
}

func (m *mockInspector) Inspect(_ context.Context, _ app.DestinationSpec) ([]app.ServiceState, error) {
	return m.states, nil
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
func (m *mockInspector) RegisterTLS(_ string, _ inspector.TLSConfig)   {}
func (m *mockInspector) UnregisterTLS(_ string)                        {}
func (m *mockInspector) GetTLSCertPath(_ string) string                { return "" }

func (m *mockReconciler) Start(_ context.Context) error                { return nil }
func (m *mockReconciler) Stop(_ context.Context) error                 { return nil }
func (m *mockReconciler) TriggerReconcile(_ string)                    {}
func (m *mockReconciler) ReconcileNow(_ context.Context, appName string) (*app.SyncResult, error) {
	if m.result != nil {
		return m.result, m.err
	}
	return &app.SyncResult{
		AppName:   appName,
		Result:    app.SyncResultSuccess,
		Operation: app.SyncOperationManual,
	}, m.err
}

func (m *mockReconciler) DryRun(_ context.Context, appName string) (*app.DiffResult, string, error) {
	return &app.DiffResult{InSync: true, Summary: "All in sync"}, "abc123", nil
}

func (m *mockReconciler) Rollback(_ context.Context, appName string, targetSHA string) (*app.SyncResult, error) {
	return &app.SyncResult{
		AppName:   appName,
		Result:    app.SyncResultSuccess,
		Operation: app.SyncOperationRollback,
		CommitSHA: targetSHA,
	}, nil
}

func (m *mockReconciler) SetPollOverride(_ time.Duration) {}
func (m *mockReconciler) GetPollOverride() time.Duration  { return 0 }

// --- Test helpers ---

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
		SyncStatus:   string(app.SyncStatusSynced),
		HealthStatus: string(app.HealthStatusHealthy),
	}
	if err := s.CreateApplication(context.Background(), rec); err != nil {
		t.Fatalf("create app: %v", err)
	}
}

func newTestServer(t *testing.T, s *store.SQLiteStore, rec *mockReconciler) *Server {
	t.Helper()
	if rec == nil {
		rec = &mockReconciler{}
	}
	return NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: rec,
		Logger:     testLogger(),
	})
}

func doRequest(t *testing.T, srv *Server, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	return w
}

// --- Healthz / Readyz ---

func TestHealthz(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/healthz")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp HealthResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Status != "ok" {
		t.Errorf("expected status=ok, got %q", resp.Status)
	}
}

func TestReadyz(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/readyz")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ReadyResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Status != "ready" {
		t.Errorf("expected status=ready, got %q", resp.Status)
	}
	if resp.Checks["database"] != "ok" {
		t.Errorf("expected database=ok, got %q", resp.Checks["database"])
	}
}

// --- List Applications ---

func TestListApplications_Empty(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ListResponse[ApplicationResponse]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 0 {
		t.Errorf("expected total=0, got %d", resp.Total)
	}
	if resp.Items == nil {
		t.Error("expected empty slice, got nil")
	}
}

func TestListApplications_WithApps(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "app1")
	createTestApp(t, s, "app2")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ListResponse[ApplicationResponse]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 2 {
		t.Errorf("expected total=2, got %d", resp.Total)
	}
}

func TestListApplications_ContentType(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications")

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type=application/json, got %q", ct)
	}
}

// --- Get Application ---

func TestGetApplication_Found(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ApplicationResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Metadata.Name != "myapp" {
		t.Errorf("expected name=myapp, got %q", resp.Metadata.Name)
	}
	if resp.Status.SyncStatus != string(app.SyncStatusSynced) {
		t.Errorf("expected Synced, got %q", resp.Status.SyncStatus)
	}
}

func TestGetApplication_NotFound(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/nonexistent")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}

	var resp ErrorResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Code != CodeNotFound {
		t.Errorf("expected code=%s, got %q", CodeNotFound, resp.Code)
	}
}

// --- Sync Application ---

func TestSyncApplication_Success(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	rec := &mockReconciler{
		result: &app.SyncResult{
			AppName:   "myapp",
			Result:    app.SyncResultSuccess,
			Operation: app.SyncOperationManual,
			CommitSHA: "abc123",
		},
	}
	srv := newTestServer(t, s, rec)

	w := doRequest(t, srv, "POST", "/api/v1/applications/myapp/sync")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var result app.SyncResult
	_ = json.NewDecoder(w.Body).Decode(&result)
	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected success, got %s", result.Result)
	}
	if result.CommitSHA != "abc123" {
		t.Errorf("expected sha=abc123, got %q", result.CommitSHA)
	}
}

func TestSyncApplication_NotFound(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "POST", "/api/v1/applications/nonexistent/sync")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestSyncApplication_WithError(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	rec := &mockReconciler{
		result: &app.SyncResult{
			AppName: "myapp",
			Result:  app.SyncResultFailure,
			Error:   "git sync failed",
		},
		err: fmt.Errorf("git sync failed"),
	}
	srv := newTestServer(t, s, rec)

	w := doRequest(t, srv, "POST", "/api/v1/applications/myapp/sync")

	// Should still return 200 with the result (error details in body)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var result app.SyncResult
	_ = json.NewDecoder(w.Body).Decode(&result)
	if result.Result != app.SyncResultFailure {
		t.Errorf("expected failure, got %s", result.Result)
	}
}

func TestSyncApplication_DryRun(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "POST", "/api/v1/applications/myapp/sync?dryRun=true")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp DryRunResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)

	if resp.HeadSHA != "abc123" {
		t.Errorf("expected headSHA=abc123, got %q", resp.HeadSHA)
	}
	if resp.Diff == nil {
		t.Fatal("expected diff in dry-run response")
	}
	if !resp.Diff.InSync {
		t.Errorf("expected diff.inSync=true, got false")
	}
}

// --- Diff Application ---

func TestDiffApplication_NoHistory(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/diff")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var diff app.DiffResult
	_ = json.NewDecoder(w.Body).Decode(&diff)
	if !diff.InSync {
		t.Error("expected inSync=true when no history")
	}
}

func TestDiffApplication_WithHistory(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	// Insert a sync record with diff data
	diffData := app.DiffResult{
		InSync: false,
		ToUpdate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeUpdate},
		},
		Summary: "1 to update",
	}
	diffJSON, _ := json.Marshal(diffData)
	_ = s.RecordSync(context.Background(), &store.SyncRecord{
		AppName:   "myapp",
		Operation: "poll",
		Result:    "success",
		DiffJSON:  string(diffJSON),
	})

	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/diff")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var diff app.DiffResult
	_ = json.NewDecoder(w.Body).Decode(&diff)
	if diff.InSync {
		t.Error("expected inSync=false")
	}
	if diff.Summary != "1 to update" {
		t.Errorf("expected summary, got %q", diff.Summary)
	}
}

// --- Events ---

func TestGetEvents_Empty(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/events")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ListResponse[store.EventRecord]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 0 {
		t.Errorf("expected 0 events, got %d", resp.Total)
	}
}

func TestGetEvents_WithEvents(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	_ = s.RecordEvent(context.Background(), &store.EventRecord{
		AppName:  "myapp",
		Type:     "SyncCompleted",
		Message:  "Sync success",
		Severity: "info",
	})

	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/events")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ListResponse[store.EventRecord]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 1 {
		t.Errorf("expected 1 event, got %d", resp.Total)
	}
}

func TestGetEvents_LimitParam(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	for i := 0; i < 5; i++ {
		_ = s.RecordEvent(context.Background(), &store.EventRecord{
			AppName:  "myapp",
			Type:     "test",
			Message:  fmt.Sprintf("event %d", i),
			Severity: "info",
		})
	}

	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/events?limit=2")

	var resp ListResponse[store.EventRecord]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 2 {
		t.Errorf("expected 2 events (limit=2), got %d", resp.Total)
	}
}

// --- History ---

func TestGetHistory_Empty(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/history")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp ListResponse[store.SyncRecord]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 0 {
		t.Errorf("expected 0 records, got %d", resp.Total)
	}
}

func TestGetHistory_WithRecords(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	_ = s.RecordSync(context.Background(), &store.SyncRecord{
		AppName:   "myapp",
		Operation: "poll",
		Result:    "success",
		CommitSHA: "abc123",
	})

	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/history")

	var resp ListResponse[store.SyncRecord]
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Total != 1 {
		t.Errorf("expected 1 record, got %d", resp.Total)
	}
}

// --- Web UI ---

func TestRootRedirectsToUI(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/")

	if w.Code != http.StatusMovedPermanently {
		t.Errorf("expected 301, got %d", w.Code)
	}
	loc := w.Header().Get("Location")
	if loc != "/ui/" {
		t.Errorf("expected redirect to /ui/, got %q", loc)
	}
}

func TestUIServesHTML(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/ui/")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "text/html; charset=utf-8" {
		t.Errorf("expected text/html content type, got %q", ct)
	}

	body := w.Body.String()
	if !strings.Contains(body, "dockercd") {
		t.Error("expected HTML to contain 'dockercd'")
	}
}

func TestUISPAFallback(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	// Unknown UI path should still serve index.html (SPA routing)
	w := doRequest(t, srv, "GET", "/ui/some/unknown/path")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, "dockercd") {
		t.Error("expected SPA fallback to serve index.html")
	}
}

// --- Method not allowed ---

func TestGetApplication_MethodNotAllowed(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "PATCH", "/api/v1/applications/myapp")

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

// --- Rollback Application ---

func TestRollbackApplication_Success(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	body := strings.NewReader(`{"targetSHA":"abc123"}`)
	req := httptest.NewRequest("POST", "/api/v1/applications/myapp/rollback", body)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result app.SyncResult
	_ = json.NewDecoder(w.Body).Decode(&result)
	if result.Result != app.SyncResultSuccess {
		t.Errorf("expected result=success, got %q", result.Result)
	}
	if result.Operation != app.SyncOperationRollback {
		t.Errorf("expected operation=rollback, got %q", result.Operation)
	}
	if result.CommitSHA != "abc123" {
		t.Errorf("expected commitSHA=abc123, got %q", result.CommitSHA)
	}
}

func TestRollbackApplication_NotFound(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	body := strings.NewReader(`{"targetSHA":"abc123"}`)
	req := httptest.NewRequest("POST", "/api/v1/applications/nonexistent/rollback", body)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}

	var resp ErrorResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Code != CodeNotFound {
		t.Errorf("expected code=%s, got %q", CodeNotFound, resp.Code)
	}
}

func TestRollbackApplication_MissingSHA(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)

	body := strings.NewReader(`{}`)
	req := httptest.NewRequest("POST", "/api/v1/applications/myapp/rollback", body)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}

	var resp ErrorResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Code != CodeBadRequest {
		t.Errorf("expected code=%s, got %q", CodeBadRequest, resp.Code)
	}
}

// --- Adopt Application ---

func TestAdoptApplication_Success(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	srv := NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: &mockReconciler{},
		Inspector: &mockInspector{
			states: []app.ServiceState{
				{Name: "web", Image: "nginx:latest", Health: app.HealthStatusHealthy, Status: "running"},
			},
		},
		Logger: testLogger(),
	})

	w := doRequest(t, srv, "POST", "/api/v1/applications/myapp/adopt")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	_ = json.NewDecoder(w.Body).Decode(&result)
	if result["status"] != "adopted" {
		t.Errorf("expected status=adopted, got %v", result["status"])
	}
	if result["name"] != "myapp" {
		t.Errorf("expected name=myapp, got %v", result["name"])
	}
}

func TestAdoptApplication_NotFound(t *testing.T) {
	s := setupTestStore(t)
	srv := NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: &mockReconciler{},
		Inspector:  &mockInspector{},
		Logger:     testLogger(),
	})

	w := doRequest(t, srv, "POST", "/api/v1/applications/nonexistent/adopt")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// --- Application Response Structure ---

func TestGetApplication_ResponseStructure(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")

	// Set some status fields
	_ = s.UpdateApplicationStatus(context.Background(), "myapp", store.StatusUpdate{
		LastSyncedSHA: "deadbeef",
		HeadSHA:       "deadbeef",
	})

	srv := newTestServer(t, s, nil)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp")

	var resp ApplicationResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)

	if resp.Spec.Source.RepoURL != "https://github.com/test/repo.git" {
		t.Errorf("unexpected repo URL: %q", resp.Spec.Source.RepoURL)
	}
	if resp.Spec.Destination.ProjectName != "myapp" {
		t.Errorf("unexpected project name: %q", resp.Spec.Destination.ProjectName)
	}
	if resp.Status.LastSyncedSHA != "deadbeef" {
		t.Errorf("expected LastSyncedSHA=deadbeef, got %q", resp.Status.LastSyncedSHA)
	}
}

