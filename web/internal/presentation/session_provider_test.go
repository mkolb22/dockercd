package presentation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
)

type providerToken string

func (t providerToken) PresentationToken(context.Context) (string, error) { return string(t), nil }

type fakeSessionResolver struct {
	session Session
	err     error
	request *http.Request
}

func TestSessionSourceProviderRejectsControllerSubjectMismatchBeforeData(t *testing.T) {
	controller := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/presentation/permissions" {
			t.Fatalf("unexpected controller request %s", request.URL.Path)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"subject":"other-operator","credentialId":"test","audience":"dockercd","expiresAt":"2026-09-16T00:00:00Z","capabilities":["fleet:read"],"applications":[]}`))
	}))
	defer controller.Close()

	resolver := &fakeSessionResolver{session: Session{ID: "session-opaque-id", Subject: "operator-42", ControllerToken: providerToken("short-lived-scoped-token")}}
	provider, err := NewSessionSourceProvider(SessionSourceProviderConfig{Resolver: resolver, ControllerURL: controller.URL})
	if err != nil {
		t.Fatal(err)
	}
	source, err := provider.SourceForRequest(t.Context(), httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Fleet(t.Context()); !errors.Is(err, ErrUnauthenticatedSession) {
		t.Fatalf("mismatched controller subject error = %v", err)
	}
}

func (r *fakeSessionResolver) ResolvePresentationSession(_ context.Context, request *http.Request) (Session, error) {
	r.request = request
	return r.session, r.err
}

func TestSessionSourceProviderRequiresAnAuthenticatedServerSideSession(t *testing.T) {
	resolver := &fakeSessionResolver{session: Session{ID: "session-opaque-id", Subject: "operator-42", ControllerToken: providerToken("short-lived-scoped-token")}}
	provider, err := NewSessionSourceProvider(SessionSourceProviderConfig{Resolver: resolver, ControllerURL: "https://controller.example.test", ControllerLabel: "My Apps"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/fleet", nil)
	request.Header.Set("X-Subject", "forged-browser-header")
	source, err := provider.SourceForRequest(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := source.(*LiveSource); !ok || resolver.request != request {
		t.Fatalf("unexpected request source %#v", source)
	}

	for _, session := range []Session{
		{Subject: "operator", ControllerToken: providerToken("token")},
		{ID: "session", ControllerToken: providerToken("token")},
		{ID: "session", Subject: "operator"},
	} {
		resolver.session = session
		if _, err := provider.SourceForRequest(t.Context(), request); !errors.Is(err, ErrUnauthenticatedSession) {
			t.Fatalf("invalid session %#v error = %v", session, err)
		}
	}
	resolver.err = errors.New("expired")
	if _, err := provider.SourceForRequest(t.Context(), request); !errors.Is(err, ErrUnauthenticatedSession) {
		t.Fatalf("resolver failure error = %v", err)
	}
}

func TestSessionSourceProviderRejectsUnsafeClientConfiguration(t *testing.T) {
	resolver := &fakeSessionResolver{}
	for _, config := range []SessionSourceProviderConfig{
		{},
		{Resolver: resolver, ControllerURL: "ftp://controller.example.test"},
		{Resolver: resolver, ControllerURL: "https://user:password@controller.example.test"},
	} {
		if _, err := NewSessionSourceProvider(config); err == nil {
			t.Fatalf("unsafe provider configuration succeeded: %#v", config)
		}
	}
}

var _ controlplane.TokenSource = providerToken("")
