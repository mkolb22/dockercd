package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock reconciler ---

type mockReconciler struct {
	result           *app.SyncResult
	err              error
	dryRun           *app.DiffResult
	dryRunSHA        string
	dryRunErr        error
	rendered         *app.ComposeSpec
	renderSHA        string
	renderErr        error
	reconcileStarted chan<- struct{}
	reconcileRelease <-chan struct{}
}

// --- Mock inspector ---

type mockInspector struct {
	states         []app.ServiceState
	detail         *app.ServiceDetail
	hostStats      *app.HostStats
	hostStatsCalls int
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
	m.hostStatsCalls++
	return m.hostStats, nil
}
func (m *mockInspector) InspectServiceDetail(_ context.Context, _ app.DestinationSpec, _ string) (*app.ServiceDetail, error) {
	return m.detail, nil
}
func (m *mockInspector) GetServiceLogs(_ context.Context, _ app.DestinationSpec, _ string, _ int) ([]string, error) {
	return nil, nil
}
func (m *mockInspector) RegisterTLS(_ string, _ inspector.TLSConfig) {}
func (m *mockInspector) UnregisterTLS(_ string)                      {}
func (m *mockInspector) GetTLSCertPath(_ string) string              { return "" }

func (m *mockReconciler) Start(_ context.Context) error { return nil }
func (m *mockReconciler) Stop(_ context.Context) error  { return nil }
func (m *mockReconciler) TriggerReconcile(_ string)     {}
func (m *mockReconciler) ReconcileNow(_ context.Context, appName string) (*app.SyncResult, error) {
	if m.reconcileStarted != nil {
		m.reconcileStarted <- struct{}{}
	}
	if m.reconcileRelease != nil {
		<-m.reconcileRelease
	}
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
	if m.dryRun != nil || m.dryRunErr != nil || m.dryRunSHA != "" {
		return m.dryRun, m.dryRunSHA, m.dryRunErr
	}
	return &app.DiffResult{InSync: true, Summary: "All in sync"}, "abc123", nil
}

func (m *mockReconciler) RenderDesired(_ context.Context, appName string) (*app.ComposeSpec, string, error) {
	if m.rendered != nil || m.renderErr != nil || m.renderSHA != "" {
		return m.rendered, m.renderSHA, m.renderErr
	}
	return &app.ComposeSpec{
		Services: []app.ServiceSpec{{Name: "web", Image: "nginx:latest"}},
	}, "abc123", nil
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
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := w.Header().Get("Content-Security-Policy"); got == "" {
		t.Error("expected Content-Security-Policy header")
	}
}

func TestCapabilities(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)
	w := doRequest(t, srv, http.MethodGet, "/api/v1/capabilities")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var response CapabilitiesResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.APIVersion != "v1" || len(response.Features) == 0 {
		t.Fatalf("unexpected capabilities: %+v", response)
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

func TestGetHostStats_CachesRecentResult(t *testing.T) {
	s := setupTestStore(t)
	insp := &mockInspector{hostStats: &app.HostStats{CPUPercent: 12.5}}
	srv := NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: &mockReconciler{},
		Inspector:  insp,
		Logger:     testLogger(),
	})

	for range 2 {
		w := doRequest(t, srv, "GET", "/api/v1/system/stats")
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	}
	if insp.hostStatsCalls != 1 {
		t.Fatalf("HostStats called %d times, want 1", insp.hostStatsCalls)
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

func TestAPIToken_BearerAndCookieAuth(t *testing.T) {
	s := setupTestStore(t)
	srv := NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: &mockReconciler{},
		Logger:     testLogger(),
		APIToken:   "secret-token",
	})

	unauth := doRequest(t, srv, "GET", "/api/v1/applications")
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated request to return 401, got %d", unauth.Code)
	}

	req := httptest.NewRequest("POST", "/api/v1/auth/session", strings.NewReader(`{"token":"secret-token"}`))
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected login 200, got %d: %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != authCookieName {
		t.Fatalf("expected auth cookie, got %v", cookies)
	}

	req = httptest.NewRequest("GET", "/api/v1/applications", nil)
	req.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected cookie-authenticated request 200, got %d", w.Code)
	}

	req = httptest.NewRequest("GET", "/api/v1/applications", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected bearer-authenticated request 200, got %d", w.Code)
	}

	req = httptest.NewRequest("PUT", "/api/v1/settings/poll-interval", strings.NewReader(`{"intervalMs":300000}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected cookie-authenticated mutation without CSRF header to return 403, got %d", w.Code)
	}

	req = httptest.NewRequest("PUT", "/api/v1/settings/poll-interval", strings.NewReader(`{"intervalMs":300000}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected cookie-authenticated mutation with CSRF header to return 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPresentationPermissionsUsesOnlyScopedCredentials(t *testing.T) {
	s := setupTestStore(t)
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{testPresentationCredential("test-only-opaque-token")})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{
		Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token",
		PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation",
	})

	legacy := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/permissions", nil)
	legacy.Header.Set("Authorization", "Bearer legacy-admin-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, legacy)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy bearer received %d, want %d", w.Code, http.StatusUnauthorized)
	}

	cookieFallback := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/permissions", nil)
	cookieFallback.AddCookie(&http.Cookie{Name: authCookieName, Value: "legacy-admin-token"})
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, cookieFallback)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy cookie received %d, want %d", w.Code, http.StatusUnauthorized)
	}

	scoped := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/permissions", nil)
	scoped.Header.Set("Authorization", "Bearer test-only-opaque-token")
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, scoped)
	if w.Code != http.StatusOK {
		t.Fatalf("scoped credential received %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "test-only-opaque-token") || !strings.Contains(w.Body.String(), "operator-42") {
		t.Fatalf("permissions response leaked token or omitted subject: %s", w.Body.String())
	}

	capabilityRequest := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	capabilityRequest.Header.Set("Authorization", "Bearer legacy-admin-token")
	capabilities := httptest.NewRecorder()
	srv.Router().ServeHTTP(capabilities, capabilityRequest)
	if !strings.Contains(capabilities.Body.String(), "presentation.scoped-auth") {
		t.Fatalf("scoped feature is absent: %s", capabilities.Body.String())
	}
}

func TestPresentationCapabilitiesAreScopedToThePrincipal(t *testing.T) {
	s := setupTestStore(t)
	credential := testPresentationCredential("test-only-capabilities-token")
	credential.Capabilities = []Capability{CapabilityApplicationRead}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/capabilities", nil)
	request.Header.Set("Authorization", "Bearer test-only-capabilities-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusOK {
		t.Fatalf("scoped capabilities returned %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"presentation.permissions"`) || !strings.Contains(body, `"presentation.application"`) || !strings.Contains(body, `"presentation.activity"`) || !strings.Contains(body, `"presentation.status-metadata"`) || strings.Contains(body, `"presentation.fleet"`) || strings.Contains(body, "legacy-admin-token") {
		t.Fatalf("unexpected scoped capabilities response: %s", body)
	}
	if !strings.Contains(body, `"maxApplications":100`) || !strings.Contains(body, `"expiresAt"`) || !strings.Contains(body, `"serverTime"`) {
		t.Fatalf("scoped capabilities omitted integration bounds: %s", body)
	}

	legacy := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/capabilities", nil)
	legacy.Header.Set("Authorization", "Bearer legacy-admin-token")
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, legacy)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy credential received %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestPresentationFleetIsIsolatedFromLegacyExpensiveRequests(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "app-a")
	started := make(chan struct{}, maxConcurrentExpensiveRequests)
	release := make(chan struct{})
	type responseResult struct {
		code int
		body string
	}
	responses := make(chan responseResult, maxConcurrentExpensiveRequests)
	credential := testPresentationCredential("test-only-isolated-fleet-token")
	credential.Capabilities = []Capability{CapabilityFleetRead}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{reconcileStarted: started, reconcileRelease: release}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})

	var waiting sync.WaitGroup
	for range maxConcurrentExpensiveRequests {
		waiting.Add(1)
		go func() {
			defer waiting.Done()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/applications/app-a/sync", nil)
			request.Header.Set("Authorization", "Bearer legacy-admin-token")
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			srv.Router().ServeHTTP(response, request)
			responses <- responseResult{code: response.Code, body: response.Body.String()}
		}()
	}
	for range maxConcurrentExpensiveRequests {
		select {
		case <-started:
		case response := <-responses:
			close(release)
			waiting.Wait()
			t.Fatalf("legacy expensive request returned %d before reconciliation: %s", response.code, response.body)
		case <-time.After(time.Second):
			close(release)
			waiting.Wait()
			t.Fatal("legacy expensive requests did not saturate their limiter")
		}
	}

	fleet := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/fleet", nil)
	fleet.Header.Set("Authorization", "Bearer test-only-isolated-fleet-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, fleet)
	close(release)
	waiting.Wait()
	if w.Code != http.StatusOK {
		t.Fatalf("fleet was blocked by legacy expensive work: %d %s", w.Code, w.Body.String())
	}
}

func TestLimitConcurrencyRejectsExcessAndRecoversCapacity(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	handler := limitConcurrency(1)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		started <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	}))

	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first request did not acquire limiter capacity")
	}

	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/", nil))
	if denied.Code != http.StatusTooManyRequests {
		t.Fatalf("saturated limiter returned %d, want %d", denied.Code, http.StatusTooManyRequests)
	}
	close(release)
	select {
	case <-firstDone:
	case <-time.After(time.Second):
		t.Fatal("first request did not release limiter capacity")
	}

	recovered := httptest.NewRecorder()
	handler.ServeHTTP(recovered, httptest.NewRequest(http.MethodGet, "/", nil))
	if recovered.Code != http.StatusOK {
		t.Fatalf("recovered limiter returned %d, want %d", recovered.Code, http.StatusOK)
	}
}

func TestPresentationRoutesRejectWrongAudience(t *testing.T) {
	s := setupTestStore(t)
	credential := testPresentationCredential("test-only-wrong-audience-token")
	credential.Audience = "different-controller"
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})
	for _, path := range []string{"/api/v1/presentation/permissions", "/api/v1/presentation/fleet"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("Authorization", "Bearer test-only-wrong-audience-token")
		w := httptest.NewRecorder()
		srv.Router().ServeHTTP(w, request)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("wrong audience %s returned %d, want %d", path, w.Code, http.StatusUnauthorized)
		}
	}
}

func TestPresentationRoutesStayDisabledWithoutLegacyAdminAuthentication(t *testing.T) {
	s := setupTestStore(t)
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{testPresentationCredential("test-only-disabled-token")})
	if err != nil {
		t.Fatal(err)
	}
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})
	capabilities := doRequest(t, srv, http.MethodGet, "/api/v1/capabilities")
	if strings.Contains(capabilities.Body.String(), "presentation.scoped-auth") {
		t.Fatalf("disabled server advertised scoped auth: %s", capabilities.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/permissions", nil)
	request.Header.Set("Authorization", "Bearer test-only-disabled-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusNotFound {
		t.Fatalf("disabled presentation route returned %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestPresentationFleetFiltersResourcesAndOmitsManifestData(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "app-a")
	createTestApp(t, s, "app-b")
	credential := testPresentationCredential("test-only-fleet-token")
	credential.Capabilities = []Capability{CapabilityFleetRead}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/fleet", nil)
	request.Header.Set("Authorization", "Bearer test-only-fleet-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusOK {
		t.Fatalf("fleet returned %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"name":"app-a"`) || strings.Contains(body, "app-b") || strings.Contains(body, `"spec"`) || strings.Contains(body, "recentHistory") {
		t.Fatalf("fleet response was not a filtered summary: %s", body)
	}

	credential.Capabilities = []Capability{CapabilityApplicationRead}
	deniedAuthenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	deniedAuthenticator.now = authenticator.now
	denied := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: deniedAuthenticator, PresentationAudience: "dockercd-presentation"})
	w = httptest.NewRecorder()
	denied.Router().ServeHTTP(w, request)
	if w.Code != http.StatusForbidden {
		t.Fatalf("missing fleet scope returned %d, want %d", w.Code, http.StatusForbidden)
	}
}

func TestPresentationApplicationFiltersResourcesAndRedactsSensitiveData(t *testing.T) {
	s := setupTestStore(t)
	manifest := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"app-a"},"spec":{"source":{"repoURL":"https://user:password@example.test/repo.git"}}}`
	if err := s.CreateApplication(context.Background(), &store.ApplicationRecord{
		Name: "app-a", Manifest: manifest, SyncStatus: "Synced", HealthStatus: "Healthy",
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateApplicationStatus(context.Background(), "app-a", store.StatusUpdate{LastError: store.StringPtr("password=secret")}); err != nil {
		t.Fatal(err)
	}
	observedAt := time.Date(2026, 9, 15, 13, 1, 0, 0, time.UTC)
	record, err := s.GetApplication(context.Background(), "app-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecordHealthObservation(context.Background(), "app-a", record.UpdatedAt, "Healthy", `[]`, observedAt); err != nil {
		t.Fatal(err)
	}
	createTestApp(t, s, "app-b")
	credential := testPresentationCredential("test-only-application-token")
	credential.Capabilities = []Capability{CapabilityApplicationRead}
	credential.Applications = []string{"app-a"}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/applications/app-a", nil)
	request.Header.Set("Authorization", "Bearer test-only-application-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusOK {
		t.Fatalf("application returned %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, forbidden := range []string{"password", "secret", `"spec"`, "lastError", "recentHistory", "services"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("application response exposed %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `"lastObservedAt":"2026-09-15T13:01:00Z"`) {
		t.Fatalf("application response omitted persisted observation time: %s", body)
	}
	if !strings.Contains(body, `"observedHealthStatus":"Healthy"`) {
		t.Fatalf("application response omitted observed health status: %s", body)
	}
	var response PresentationApplicationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode presentation application response: %v", err)
	}
	if response.ObservationCompleteness != "complete" {
		t.Fatalf("observation completeness = %q, want complete", response.ObservationCompleteness)
	}
	if _, err := time.Parse(time.RFC3339, response.ResponseGeneratedAt); err != nil {
		t.Fatalf("response generation time = %q: %v", response.ResponseGeneratedAt, err)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/presentation/applications/app-b", nil)
	request.Header.Set("Authorization", "Bearer test-only-application-token")
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusNotFound {
		t.Fatalf("ungranted application returned %d, want %d", w.Code, http.StatusNotFound)
	}
	if strings.Contains(w.Body.String(), "app-b") {
		t.Fatalf("ungranted response disclosed application name: %s", w.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/presentation/applications/missing", nil)
	request.Header.Set("Authorization", "Bearer test-only-application-token")
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusNotFound {
		t.Fatalf("ungranted missing application returned %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestPresentationApplicationAuditsAllowBeforeStorageFailure(t *testing.T) {
	s := setupTestStore(t)
	credential := testPresentationCredential("test-only-audit-token")
	credential.Capabilities = []Capability{CapabilityApplicationRead}
	credential.Applications = []string{"app-a"}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	var auditLog bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&auditLog, nil))
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: logger, APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/applications/app-a", nil)
	request.Header.Set("Authorization", "Bearer test-only-audit-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("closed store returned %d, want %d", w.Code, http.StatusInternalServerError)
	}
	for _, expected := range []string{`"event":"presentation_authorization"`, `"subject":"operator-42"`, `"credential_id":"cred-reader"`, `"capability":"application:read"`, `"resource":"app-a"`, `"decision":"allow"`} {
		if !strings.Contains(auditLog.String(), expected) {
			t.Fatalf("missing audit field %q in %s", expected, auditLog.String())
		}
	}
}

func TestPresentationActivityFiltersResourcesAndRedactsEventDetails(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "app-a")
	createTestApp(t, s, "app-b")
	for _, event := range []store.EventRecord{
		{AppName: "app-a", Type: "SyncSuccess", Severity: "info", Message: "password=secret", DataJSON: `{"token":"secret"}`},
		{AppName: "app-b", Type: "SyncFailed", Severity: "error", Message: "app-b private detail", DataJSON: `{"token":"other-secret"}`},
	} {
		if err := s.RecordEvent(context.Background(), &event); err != nil {
			t.Fatal(err)
		}
	}
	credential := testPresentationCredential("test-only-activity-token")
	credential.Capabilities = []Capability{CapabilityApplicationRead}
	credential.Applications = []string{"app-a"}
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	srv := NewServer(":0", ServerDeps{Store: s, Reconciler: &mockReconciler{}, Logger: testLogger(), APIToken: "legacy-admin-token", PresentationAuthenticator: authenticator, PresentationAudience: "dockercd-presentation"})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/presentation/activity?limit=1000", nil)
	request.Header.Set("Authorization", "Bearer test-only-activity-token")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, request)
	if w.Code != http.StatusOK {
		t.Fatalf("activity returned %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, forbidden := range []string{"app-b", "password", "secret", "dataJson", "message"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("activity response exposed %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `"application":"app-a"`) || !strings.Contains(body, `"type":"SyncSuccess"`) {
		t.Fatalf("activity omitted authorized event metadata: %s", body)
	}
	var response PresentationActivityResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode presentation activity response: %v", err)
	}
	if _, err := time.Parse(time.RFC3339, response.ResponseGeneratedAt); err != nil {
		t.Fatalf("activity response generation time = %q: %v", response.ResponseGeneratedAt, err)
	}
}

func TestPresentationObservationCompletenessRequiresThePersistedPair(t *testing.T) {
	observedAt := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name       string
		status     string
		observedAt *time.Time
		want       string
	}{
		{name: "both values", status: "Healthy", observedAt: &observedAt, want: "complete"},
		{name: "missing status", observedAt: &observedAt, want: "unavailable"},
		{name: "missing timestamp", status: "Healthy", want: "unavailable"},
		{name: "zero timestamp", status: "Healthy", observedAt: &time.Time{}, want: "unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if actual := presentationObservationCompleteness(test.status, test.observedAt); actual != test.want {
				t.Fatalf("presentationObservationCompleteness(%q, %v) = %q, want %q", test.status, test.observedAt, actual, test.want)
			}
		})
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

func TestUpdateApplication_ReplacesManifestAndPreservesRuntimeStatus(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)
	body := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"myapp"},"spec":{"source":{"repoURL":"https://github.com/test/updated.git","targetRevision":"release","path":"deploy","composeFiles":["compose.yml"]},"destination":{"dockerHost":"unix:///var/run/docker.sock","projectName":"myapp"},"syncPolicy":{"automated":false,"prune":true,"selfHeal":true}}}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/applications/myapp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var response ApplicationResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Spec.Source.RepoURL != "https://github.com/test/updated.git" {
		t.Fatalf("repoURL = %q", response.Spec.Source.RepoURL)
	}
	if response.Status.SyncStatus != string(app.SyncStatusSynced) {
		t.Fatalf("sync status was not preserved: %q", response.Status.SyncStatus)
	}
}

func TestUpdateApplication_RejectsRename(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, nil)
	body := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"other"},"spec":{"source":{"repoURL":"https://github.com/test/repo.git","targetRevision":"main","path":".","composeFiles":["docker-compose.yml"]},"destination":{"dockerHost":"unix:///var/run/docker.sock","projectName":"other"},"syncPolicy":{"automated":true}}}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/applications/myapp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
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

func TestGetRenderedDesired(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	rec := &mockReconciler{
		renderSHA: "def456",
		rendered: &app.ComposeSpec{
			Services: []app.ServiceSpec{{Name: "api", Image: "example/api:1.0.0"}},
		},
	}
	srv := newTestServer(t, s, rec)

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/desired")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp RenderedDesiredResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.AppName != "myapp" {
		t.Errorf("expected appName=myapp, got %q", resp.AppName)
	}
	if resp.HeadSHA != "def456" {
		t.Errorf("expected headSHA=def456, got %q", resp.HeadSHA)
	}
	if resp.Compose == nil || len(resp.Compose.Services) != 1 || resp.Compose.Services[0].Name != "api" {
		t.Fatalf("unexpected compose response: %+v", resp.Compose)
	}
}

func TestGitWebhookRequiresConfiguredSecret(t *testing.T) {
	s := setupTestStore(t)
	srv := newTestServer(t, s, nil)

	req := httptest.NewRequest("POST", "/api/v1/webhook/git", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when webhook secret is unset, got %d", w.Code)
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

func TestDiffApplication_IgnoresStaleHistory(t *testing.T) {
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

	srv := newTestServer(t, s, &mockReconciler{
		dryRun: &app.DiffResult{InSync: true, Summary: "All services in sync"},
	})

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/diff")

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var diff app.DiffResult
	_ = json.NewDecoder(w.Body).Decode(&diff)
	if !diff.InSync {
		t.Error("expected live dry-run diff to report inSync=true")
	}
	if diff.Summary != "All services in sync" {
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

func TestGetApplication_RedactsEmbeddedRepoCredentials(t *testing.T) {
	s := setupTestStore(t)
	manifest := `{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":"myapp"},"spec":{"source":{"repoURL":"https://user:password@example.com/org/repo.git"}}}`
	if err := s.CreateApplication(context.Background(), &store.ApplicationRecord{Name: "myapp", Manifest: manifest}); err != nil {
		t.Fatalf("create app: %v", err)
	}

	w := doRequest(t, newTestServer(t, s, nil), "GET", "/api/v1/applications/myapp")
	if strings.Contains(w.Body.String(), "password") || strings.Contains(w.Body.String(), "user@") {
		t.Fatalf("application response exposed credentials: %s", w.Body.String())
	}
}

func TestRenderedDesired_RedactsEnvironment(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := newTestServer(t, s, &mockReconciler{rendered: &app.ComposeSpec{Services: []app.ServiceSpec{{
		Name:        "api",
		Environment: map[string]string{"PASSWORD": "secret"},
	}}}, renderSHA: "abc123"})

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/desired")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("desired-state response exposed environment value: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), app.RedactedValue) {
		t.Fatalf("desired-state response did not mark environment as redacted: %s", w.Body.String())
	}
}

func TestGetServiceDetail_RedactsEnvironment(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp")
	srv := NewServer(":0", ServerDeps{
		Store:      s,
		Reconciler: &mockReconciler{},
		Inspector: &mockInspector{detail: &app.ServiceDetail{ServiceState: app.ServiceState{
			Name:        "api",
			Environment: map[string]string{"PASSWORD": "secret"},
		}}},
		Logger: testLogger(),
	})

	w := doRequest(t, srv, "GET", "/api/v1/applications/myapp/services/api")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("service detail exposed environment value: %s", w.Body.String())
	}
}
