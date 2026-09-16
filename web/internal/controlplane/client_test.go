package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type tokenSource string

func (t tokenSource) PresentationToken(context.Context) (string, error) { return string(t), nil }

type blockingTokenSource struct{}

func (blockingTokenSource) PresentationToken(ctx context.Context) (string, error) {
	<-ctx.Done()
	return "", ctx.Err()
}

func TestClientUsesOnlyScopedPresentationRoutes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer scoped-reader" {
			t.Fatalf("unexpected authorization header %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Fatalf("unexpected accept header %q", r.Header.Get("Accept"))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		switch r.URL.Path {
		case "/api/v1/presentation/capabilities":
			_, _ = io.WriteString(w, `{"apiVersion":"v1","serverTime":"2026-09-15T00:00:00Z","features":["presentation.fleet"],"expiresAt":"2026-09-16T00:00:00Z","limits":{"maxApplications":100}}`)
		case "/api/v1/presentation/fleet":
			_, _ = io.WriteString(w, `{"applications":[{"name":"signal","syncStatus":"Synced","healthStatus":"Healthy","observationCompleteness":"unavailable"}],"total":1,"responseGeneratedAt":"2026-09-15T00:00:00Z"}`)
		case "/api/v1/presentation/activity":
			if r.URL.Query().Get("limit") != "20" {
				t.Fatalf("unexpected activity limit %q", r.URL.Query().Get("limit"))
			}
			_, _ = io.WriteString(w, `{"events":[{"application":"signal","type":"SyncSuccess","severity":"info","occurredAt":"2026-09-15T00:00:00Z"}],"total":1,"responseGeneratedAt":"2026-09-15T00:00:00Z"}`)
		case "/api/v1/presentation/applications/signal":
			_, _ = io.WriteString(w, `{"name":"signal","syncStatus":"Synced","healthStatus":"Healthy","observedHealthStatus":"Healthy","observationCompleteness":"complete","lastObservedAt":"2026-09-15T00:00:00Z","responseGeneratedAt":"2026-09-15T00:00:00Z"}`)
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	if capabilities, err := client.Capabilities(t.Context()); err != nil || capabilities.Limits.MaxApplications != 100 {
		t.Fatalf("Capabilities() = %#v, %v", capabilities, err)
	}
	if fleet, err := client.Fleet(t.Context()); err != nil || fleet.Total != 1 || fleet.Applications[0].Name != "signal" {
		t.Fatalf("Fleet() = %#v, %v", fleet, err)
	}
	if activity, err := client.Activity(t.Context(), 20); err != nil || activity.Total != 1 || activity.Events[0].Application != "signal" {
		t.Fatalf("Activity() = %#v, %v", activity, err)
	}
	if application, err := client.Application(t.Context(), "signal"); err != nil || application.LastObservedAt == "" || application.ObservedHealthStatus != "Healthy" {
		t.Fatalf("Application() = %#v, %v", application, err)
	}
}

func TestClientDecodesFrozenPresentationV1ContractFixtures(t *testing.T) {
	fixtures := map[string][]byte{
		"/api/v1/presentation/capabilities":        webPresentationFixture(t, "capabilities.json"),
		"/api/v1/presentation/fleet":               webPresentationFixture(t, "fleet.json"),
		"/api/v1/presentation/applications/signal": webPresentationFixture(t, "application.json"),
		"/api/v1/presentation/activity?limit=20":   webPresentationFixture(t, "activity.json"),
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer scoped-reader" {
			t.Fatalf("unexpected authorization header %q", request.Header.Get("Authorization"))
		}
		body, ok := fixtures[request.URL.RequestURI()]
		if !ok {
			t.Fatalf("unexpected presentation route %s", request.URL.RequestURI())
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write(body)
	}))
	defer server.Close()
	client, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	if capabilities, err := client.Capabilities(t.Context()); err != nil || !reflect.DeepEqual(capabilities, Capabilities{
		APIVersion: "v1", ServerTime: "2026-09-15T14:32:00Z", Features: []string{"presentation.fleet", "presentation.application", "presentation.activity", "presentation.status-metadata"},
		ExpiresAt: "2026-09-15T15:32:00Z", Limits: Limits{MaxApplications: 100},
	}) {
		t.Fatalf("Capabilities() = %#v, %v", capabilities, err)
	}
	wantApplication := Application{
		Name: "signal", SyncStatus: "Synced", HealthStatus: "Healthy", LastSyncedSHA: "9b84c0d1", HeadSHA: "9b84c0d1",
		LastSyncTime: "2026-09-15T14:10:00Z", LastObservedAt: "2026-09-15T14:31:42Z", ObservedHealthStatus: "Healthy", ObservationCompleteness: "complete",
	}
	if fleet, err := client.Fleet(t.Context()); err != nil || !reflect.DeepEqual(fleet, Fleet{Applications: []Application{wantApplication}, Total: 1, ResponseGeneratedAt: "2026-09-15T14:32:00Z"}) {
		t.Fatalf("Fleet() = %#v, %v", fleet, err)
	}
	wantApplication.ResponseGeneratedAt = "2026-09-15T14:32:00Z"
	if application, err := client.Application(t.Context(), "signal"); err != nil || !reflect.DeepEqual(application, wantApplication) {
		t.Fatalf("Application() = %#v, %v", application, err)
	}
	if activity, err := client.Activity(t.Context(), 20); err != nil || !reflect.DeepEqual(activity, Activity{Events: []ActivityEvent{{Application: "signal", Type: "SyncSuccess", Severity: "info", OccurredAt: "2026-09-15T14:10:00Z"}}, Total: 1, ResponseGeneratedAt: "2026-09-15T14:32:00Z"}) {
		t.Fatalf("Activity() = %#v, %v", activity, err)
	}
}

func webPresentationFixture(t *testing.T, name string) []byte {
	t.Helper()
	// go test executes each package from its source directory. This deliberate
	// package-relative path works with -trimpath, unlike runtime.Caller paths.
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "presentation", "v1", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("validate %s JSON: %v", name, err)
	}
	return raw
}

func TestClientRejectsUnsafeConfigurationAndUnboundedResponses(t *testing.T) {
	for _, config := range []ClientConfig{
		{BaseURL: "ftp://controller", TokenSource: tokenSource("token")},
		{BaseURL: "https://user:password@controller", TokenSource: tokenSource("token")},
		{BaseURL: "https://controller?debug=true", TokenSource: tokenSource("token")},
		{BaseURL: "https://controller"},
		{BaseURL: "https://controller", TokenSource: tokenSource("token"), RequestTimeout: 31 * time.Second},
	} {
		if _, err := NewClient(config); err == nil {
			t.Fatalf("expected invalid configuration %#v to fail", config)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"applications":[],"total":0}`+strings.Repeat(" ", maxResponseBody))
	}))
	defer server.Close()
	client, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Fleet(t.Context()); err == nil {
		t.Fatal("expected oversized response to fail")
	}
	exactBody := `{"applications":[],"total":0}`
	exactServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, exactBody+strings.Repeat(" ", maxResponseBody-len(exactBody)))
	}))
	defer exactServer.Close()
	exactClient, err := NewClient(ClientConfig{BaseURL: exactServer.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	if fleet, err := exactClient.Fleet(t.Context()); err != nil || fleet.Total != 0 {
		t.Fatalf("exact boundary Fleet() = %#v, %v", fleet, err)
	}
}

func TestClientDoesNotExposeControllerErrorBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "secret controller error", http.StatusInternalServerError)
	}))
	defer server.Close()
	client, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Fleet(t.Context())
	if err == nil || strings.Contains(err.Error(), "secret") || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestClientRejectsRedirectsTimesOutTokenAndEscapesNamesOnce(t *testing.T) {
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Fatal("redirect target received scoped credential")
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer redirectTarget.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/presentation/fleet" {
			http.Redirect(w, r, redirectTarget.URL, http.StatusFound)
			return
		}
		if r.URL.EscapedPath() != "/api/v1/presentation/applications/valid-name" {
			t.Fatalf("unexpected escaped path %q", r.URL.EscapedPath())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"name":"valid-name"}`)
	}))
	defer server.Close()
	client, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: tokenSource("scoped-reader")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Fleet(t.Context()); err == nil {
		t.Fatal("expected redirect to be rejected")
	}
	if _, err := client.Application(t.Context(), "valid-name"); err != nil {
		t.Fatalf("Application() error = %v", err)
	}
	if _, err := client.Application(t.Context(), "name with space"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid application name error = %v, want ErrNotFound", err)
	}

	timed, err := NewClient(ClientConfig{BaseURL: server.URL, TokenSource: blockingTokenSource{}, RequestTimeout: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := timed.Fleet(t.Context()); err == nil {
		t.Fatal("expected token source timeout")
	}
}
