package httpui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
	"github.com/mkolb22/dockercd/web/internal/presentation"
)

type sourceProviderFunc func(context.Context, *http.Request) (presentation.Source, error)

func (f sourceProviderFunc) SourceForRequest(ctx context.Context, request *http.Request) (presentation.Source, error) {
	return f(ctx, request)
}

type scopedTestSource struct {
	view         presentation.ViewContext
	fleet        presentation.Fleet
	applications []presentation.Application
	application  presentation.Application
	activity     []presentation.Event
	fleetErr     error
	activityErr  error
	fleetCalls   int
}

func (s *scopedTestSource) ViewContext() presentation.ViewContext { return s.view }
func (s *scopedTestSource) Fleet(context.Context) (presentation.Fleet, error) {
	s.fleetCalls++
	return s.fleet, s.fleetErr
}
func (s *scopedTestSource) Applications(context.Context, string, string) (presentation.Fleet, []presentation.Application, error) {
	return s.fleet, s.applications, s.fleetErr
}
func (s *scopedTestSource) Application(context.Context, string) (presentation.Application, bool, error) {
	return s.application, s.application.Name != "", nil
}
func (s *scopedTestSource) Activity(context.Context) ([]presentation.Event, error) {
	return s.activity, s.activityErr
}

func TestFixtureRoutesRenderWithoutController(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	for _, target := range []string{
		"/fleet",
		"/applications",
		"/applications?q=signal",
		"/applications?state=attention",
		"/applications/signal",
		"/applications/edge-api/deploy",
		"/applications/edge-api/timeline",
		"/applications/edge-api/inspect",
		"/activity",
		"/system",
		"/settings",
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, target, nil)
		server.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s returned %d: %s", target, recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), "Fixture") {
			t.Fatalf("GET %s did not identify fixture mode", target)
		}
	}
}

func TestUnavailableSourceProviderFailsClosedWithoutFixtureFallback(t *testing.T) {
	server := NewWithSourceProvider(sourceProviderFunc(func(context.Context, *http.Request) (presentation.Source, error) {
		return nil, errors.New("session expired: secret detail")
	}))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable source returned %d", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "Presentation unavailable") || strings.Contains(body, "secret detail") || strings.Contains(body, "Fixture mode") {
		t.Fatalf("unavailable response leaked or fell back: %s", body)
	}
}

func TestLiveModeKeepsIndependentCapabilitiesAndHidesFixtureOnlyJourneys(t *testing.T) {
	view := presentation.ViewContext{Controller: "My Apps", Environment: "Scoped session", Freshness: "Explicit refresh", Connection: presentation.State{Label: "Scoped session", Tone: "mint", Glyph: "✓"}}
	fleetOnly := &scopedTestSource{
		view: view, fleet: presentation.Fleet{Applications: []presentation.Application{{Name: "signal", Health: presentation.State{Label: "Healthy", Tone: "mint", Glyph: "✓"}}, {Name: "controller-alert", Health: presentation.State{Label: "Degraded", Tone: "coral", Glyph: "!"}}}, Attention: []presentation.Application{{Name: "controller-alert", Health: presentation.State{Label: "Degraded", Tone: "coral", Glyph: "!"}}}},
		activityErr: controlplane.ErrFeatureUnavailable,
	}
	server := NewWithSourceProvider(sourceProviderFunc(func(context.Context, *http.Request) (presentation.Source, error) { return fleetOnly, nil }))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "Scoped session") || !strings.Contains(recorder.Body.String(), "controller-alert") || strings.Contains(recorder.Body.String(), "Fixture mode") || strings.Contains(recorder.Body.String(), "9b84c0d1") || strings.Contains(recorder.Body.String(), "edge-api needs review") {
		t.Fatalf("fleet-only scoped page was not truthful and available: %d %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "Activity unavailable") || strings.Contains(recorder.Body.String(), "The controller returned no authorized events") {
		t.Fatalf("fleet-only scoped page misrepresented unavailable activity: %s", recorder.Body.String())
	}

	appOnly := &scopedTestSource{
		view: view, fleetErr: errors.New("fleet scope must not be called"),
		application: presentation.Application{Name: "signal", Revision: "abc123", Sync: presentation.State{Label: "Synced", Tone: "mint", Glyph: "✓"}, Health: presentation.State{Label: "Healthy", Tone: "mint", Glyph: "✓"}, Observation: "Observed 4 sec ago"},
		activity:    []presentation.Event{{Application: "signal", Kind: "Sync succeeded"}},
	}
	server = NewWithSourceProvider(sourceProviderFunc(func(context.Context, *http.Request) (presentation.Source, error) { return appOnly, nil }))
	for _, target := range []string{"/activity", "/applications/signal"} {
		recorder = httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusOK || appOnly.fleetCalls != 0 || strings.Contains(recorder.Body.String(), "Manage fixture") || strings.Contains(recorder.Body.String(), "Review sync") || strings.Contains(recorder.Body.String(), "Compare desired state") || strings.Contains(recorder.Body.String(), `href="/system"`) {
			t.Fatalf("app-only request %s improperly required fleet or exposed fixture action: %d calls=%d body=%s", target, recorder.Code, appOnly.fleetCalls, recorder.Body.String())
		}
	}
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/system", nil))
	if recorder.Code != http.StatusOK || appOnly.fleetCalls != 0 || !strings.Contains(recorder.Body.String(), "Host details are not in this session.") || strings.Contains(recorder.Body.String(), "That fixture page does not exist.") {
		t.Fatalf("live system route was not an honest scoped boundary: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/applications/signal/deploy", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "This detail is not requested yet.") || strings.Contains(recorder.Body.String(), "No managed Compose services are declared") {
		t.Fatalf("live deploy inferred unavailable detail: %d %s", recorder.Code, recorder.Body.String())
	}
	for _, target := range []string{"/applications/signal/manage", "/applications/signal/sync"} {
		recorder = httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, target, nil))
		if recorder.Code == http.StatusOK || strings.Contains(recorder.Body.String(), "Fixture confirmation") {
			t.Fatalf("live source unexpectedly accepted fixture route %s: %d %s", target, recorder.Code, recorder.Body.String())
		}
	}
}

type httpUITestToken string

func (token httpUITestToken) PresentationToken(context.Context) (string, error) {
	return string(token), nil
}

type httpUITestSessionResolver struct{ session presentation.Session }

func (resolver httpUITestSessionResolver) ResolvePresentationSession(context.Context, *http.Request) (presentation.Session, error) {
	return resolver.session, nil
}

func TestSessionScopedProviderUsesOnlyThePresentationContract(t *testing.T) {
	var calls []string
	controller := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer scoped-test-token" {
			t.Errorf("controller received wrong authorization header %q", request.Header.Get("Authorization"))
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		calls = append(calls, request.URL.RequestURI())
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/v1/presentation/permissions":
			_, _ = writer.Write([]byte(`{"subject":"operator","credentialId":"test","audience":"dockercd","expiresAt":"2026-09-16T00:00:00Z","capabilities":["fleet:read"],"applications":["controller-alert"]}`))
		case "/api/v1/presentation/capabilities":
			_, _ = writer.Write([]byte(`{"apiVersion":"v1","features":["presentation.fleet","presentation.activity","presentation.status-metadata"]}`))
		case "/api/v1/presentation/fleet":
			_, _ = writer.Write([]byte(`{"applications":[{"name":"controller-alert","syncStatus":"Error","healthStatus":"Healthy","observedHealthStatus":"Healthy","observationCompleteness":"complete","lastSyncedSHA":"controller-revision","lastObservedAt":"2026-09-15T14:32:00Z"}],"total":1,"responseGeneratedAt":"2026-09-15T14:32:00Z"}`))
		case "/api/v1/presentation/activity":
			_, _ = writer.Write([]byte(`{"events":[],"total":0,"responseGeneratedAt":"2026-09-15T14:33:00Z"}`))
		default:
			t.Errorf("unexpected controller route %s", request.URL.RequestURI())
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer controller.Close()

	provider, err := presentation.NewSessionSourceProvider(presentation.SessionSourceProviderConfig{
		Resolver:      httpUITestSessionResolver{session: presentation.Session{ID: "opaque-session", Subject: "operator", ControllerToken: httpUITestToken("scoped-test-token")}},
		ControllerURL: controller.URL, ControllerLabel: "Authorized controller", Environment: "Operator session",
		Clock: func() time.Time { return time.Date(2026, 9, 15, 14, 33, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}

	server := NewWithSourceProvider(provider)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("scoped presentation response=%d body=%s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	for _, expected := range []string{"Authorized controller", "Operator session", "controller-alert", "controller-revision", "scoped response", "Controller response · 2026-09-15T14:32:00Z"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("scoped fleet omitted %q: %s", expected, body)
		}
	}
	if strings.Contains(body, "Controller response · 2026-09-15T14:33:00Z") {
		t.Fatalf("fleet page used activity freshness instead of fleet freshness: %s", body)
	}
	for _, forbidden := range []string{"Fixture mode", "edge-api", "9b84c0d1", "Manage fixture"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("scoped fleet rendered fixture evidence %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{"/api/v1/presentation/permissions", "/api/v1/presentation/capabilities", "/api/v1/presentation/fleet", "/api/v1/presentation/activity?limit=50"} {
		if !slices.Contains(calls, required) {
			t.Fatalf("controller contract omitted %q: calls=%v", required, calls)
		}
	}
}

func TestApplicationsFilterUsesGetParameters(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/applications?q=edge&state=attention", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "edge-api") || strings.Contains(body, "signal signal ·") || strings.Contains(body, "registry registry ·") {
		t.Fatalf("filter result did not render the expected fixture set: %s", body)
	}
}

func TestFixtureConfirmationNeverCallsAController(t *testing.T) {
	server := New(presentation.NewFixtureSource())

	for _, action := range []string{"sync", "rollback", "edit", "delete"} {
		review := httptest.NewRecorder()
		server.ServeHTTP(review, httptest.NewRequest(http.MethodPost, "/applications/edge-api/"+action, nil))
		if review.Code != http.StatusOK || !strings.Contains(review.Body.String(), "does not call dockercd") || !strings.Contains(review.Body.String(), "My Apps") {
			t.Fatalf("fixture %s review was not rendered safely: %d %s", action, review.Code, review.Body.String())
		}
	}

	confirm := httptest.NewRecorder()
	server.ServeHTTP(confirm, httptest.NewRequest(http.MethodPost, "/applications/edge-api/sync/confirm", nil))
	if confirm.Code != http.StatusSeeOther {
		t.Fatalf("confirmation returned %d, want %d", confirm.Code, http.StatusSeeOther)
	}
	location := confirm.Header().Get("Location")
	if !strings.HasPrefix(location, "/applications/edge-api/timeline?notice=") {
		t.Fatalf("unexpected confirmation redirect %q", location)
	}
}

func TestFixtureScenariosAndRefreshPreserveEvidenceContext(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	for _, assertion := range []struct {
		path     string
		contains string
	}{
		{path: "/fleet?scenario=healthy", contains: "No known issues in displayed data"},
		{path: "/fleet?scenario=stale", contains: "Last data retained"},
		{path: "/fleet?scenario=error", contains: "Controller unavailable"},
		{path: "/applications?state=attention", contains: `href="/applications?state=attention"`},
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, assertion.path, nil))
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), assertion.contains) {
			t.Fatalf("GET %s did not preserve fixture context: status=%d body=%s", assertion.path, recorder.Code, recorder.Body.String())
		}
	}
}

func TestActivityExplainsTheBoundedLiveIntegrationPath(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/activity", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("activity returned %d", recorder.Code)
	}
	body := recorder.Body.String()
	for _, expected := range []string{"bounded recent-activity window", "exhaustive history", "Fixture mode"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("activity view omitted %q: %s", expected, body)
		}
	}
}

func TestLiveActivityExplainsAnEmptyScopedWindow(t *testing.T) {
	view := presentation.ViewContext{Controller: "Personal", Environment: "Personal", Freshness: "Controller response", Connection: presentation.State{Label: "Scoped session", Tone: "mint", Glyph: "✓"}}
	source := &scopedTestSource{view: view}
	server := NewWithSourceProvider(sourceProviderFunc(func(context.Context, *http.Request) (presentation.Source, error) { return source, nil }))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/activity", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "No authorized changes in this window") || strings.Contains(recorder.Body.String(), "Fixture mode") {
		t.Fatalf("live empty activity did not render an honest state: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestNotFoundUsesSessionSpecificCopy(t *testing.T) {
	view := presentation.ViewContext{Controller: "Personal", Environment: "Personal", Connection: presentation.State{Label: "Scoped session", Tone: "mint", Glyph: "✓"}}
	server := NewWithSourceProvider(sourceProviderFunc(func(context.Context, *http.Request) (presentation.Source, error) {
		return &scopedTestSource{view: view}, nil
	}))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/not-a-live-route", nil))
	if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "That page is not available in this session.") || strings.Contains(recorder.Body.String(), "That fixture page does not exist.") {
		t.Fatalf("live not-found copy was misleading: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestFixtureNavigationRetainsSystem(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `href="/system"`) {
		t.Fatalf("fixture navigation lost its supported system route: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestApplicationEvidenceContextPersistsAcrossDetailPages(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	for _, target := range []string{"/applications/edge-api/deploy", "/applications/edge-api/timeline", "/applications/edge-api/inspect"} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		body := recorder.Body.String()
		for _, expected := range []string{"Displayed application evidence", "edge-api", "e713ab42", "Observed 43 sec ago"} {
			if recorder.Code != http.StatusOK || !strings.Contains(body, expected) {
				t.Fatalf("GET %s did not retain %q: status=%d body=%s", target, expected, recorder.Code, body)
			}
		}
	}
}

func TestNarrowStylesKeepFixtureAndFreshnessEvidenceVisible(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/styles.css", nil))
	styles := recorder.Body.String()
	narrowStart := strings.Index(styles, "@media (max-width: 610px)")
	if narrowStart < 0 {
		t.Fatal("missing narrow viewport stylesheet")
	}
	narrowStyles := styles[narrowStart:]
	for _, forbidden := range []string{".rail-controller, .rail-footer { display: none; }", ".freshness { display: none; }", "text-overflow: ellipsis", "max-width: 13rem"} {
		if strings.Contains(narrowStyles, forbidden) {
			t.Fatalf("narrow stylesheet hides required evidence: %q", forbidden)
		}
	}
	for _, required := range []string{".rail-footer { display: grid", ".freshness { display: inline", ".rail nav { grid-column: 1 / -1", "white-space: normal"} {
		if !strings.Contains(styles, required) {
			t.Fatalf("narrow stylesheet does not retain required evidence: %q", required)
		}
	}
}

func TestApplicationRoutesRejectAmbiguousSegments(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	for _, target := range []string{
		"/applications/signal/deploy/extra",
		"/applications/signal/sync/extra",
		"/applications/signal/sync/confirm/extra",
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("GET %s returned %d, want %d", target, recorder.Code, http.StatusNotFound)
		}
	}
}

func TestDeployViewReflectsTheSelectedApplication(t *testing.T) {
	server := New(presentation.NewFixtureSource())

	for _, assertion := range []struct {
		path     string
		contains string
		excludes string
	}{
		{path: "/applications/signal/deploy", contains: "signal-worker", excludes: "redis:7.4-alpine"},
		{path: "/applications/infra/deploy", contains: "No managed Compose services are declared.", excludes: "Health timeout"},
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, assertion.path, nil))
		body := recorder.Body.String()
		if recorder.Code != http.StatusOK || !strings.Contains(body, assertion.contains) || strings.Contains(body, assertion.excludes) {
			t.Fatalf("GET %s did not reflect fixture application: status=%d body=%s", assertion.path, recorder.Code, body)
		}
	}
}

func TestStaticAssetsExposeNoJavaScript(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/styles.css", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("styles returned %d", recorder.Code)
	}
	if strings.Contains(strings.ToLower(recorder.Body.String()), "javascript") {
		t.Fatal("stylesheet unexpectedly references JavaScript")
	}

	for _, target := range []string{"/fleet", "/applications", "/applications/edge-api", "/applications/edge-api/manage"} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		body := strings.ToLower(recorder.Body.String())
		if strings.Contains(body, "<script") || strings.Contains(body, " onload=") || strings.Contains(body, " onclick=") {
			t.Fatalf("GET %s unexpectedly rendered executable browser code", target)
		}
	}
}

func TestFixturePagesKeepKeyboardAndTextStatusEvidence(t *testing.T) {
	server := New(presentation.NewFixtureSource())
	styles := httptest.NewRecorder()
	server.ServeHTTP(styles, httptest.NewRequest(http.MethodGet, "/styles.css", nil))
	if styles.Code != http.StatusOK {
		t.Fatalf("styles returned %d", styles.Code)
	}
	styleText := styles.Body.String()
	for _, required := range []string{
		"a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible",
		".skip-link:focus { top: 1rem; }",
		"@media (prefers-reduced-motion: reduce)",
		"transition: none !important; animation: none !important;",
	} {
		if !strings.Contains(styleText, required) {
			t.Fatalf("stylesheet omitted accessibility rule %q", required)
		}
	}
	narrowStart := strings.Index(styleText, "@media (max-width: 610px)")
	if narrowStart < 0 || strings.Contains(styleText[narrowStart:], ".roster-row .status:first-of-type { display: none; }") || !strings.Contains(styleText[narrowStart:], ".roster-statuses { grid-column: 1 / -1; justify-content: start; }") {
		t.Fatal("narrow layout does not preserve both roster status badges without clipping")
	}
	for _, required := range []string{".filter-bar input, .filter-bar select { min-height", "--danger-text: #17131f;", "--danger-text: #fff;", ".button-danger { color: var(--danger-text);"} {
		if !strings.Contains(styleText, required) {
			t.Fatalf("stylesheet omitted accessible control rule %q", required)
		}
	}
	if strings.Contains(styleText, ".filter-bar input, .filter-bar select { min-height: 2.6rem; padding: .55rem .7rem; color: var(--text); border: 1px solid var(--line); outline: 0;") {
		t.Fatal("filter controls override the visible keyboard outline")
	}

	for _, target := range []string{"/fleet", "/applications/edge-api", "/applications/edge-api/inspect"} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		body := recorder.Body.String()
		for _, required := range []string{"href=\"#content\"", "<main id=\"content\"", "Fixture mode", "aria-label=\"Primary navigation\""} {
			if !strings.Contains(body, required) {
				t.Fatalf("GET %s omitted keyboard or fixture evidence %q", target, required)
			}
		}
	}
	fleet := httptest.NewRecorder()
	server.ServeHTTP(fleet, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	for _, required := range []string{"Out of sync", "Degraded", "class=\"roster-statuses\"", "aria-label=\"2 of 4 applications display healthy state\""} {
		if !strings.Contains(fleet.Body.String(), required) {
			t.Fatalf("fleet status depends on color or lacks a text alternative %q", required)
		}
	}
}
