package presentation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
)

var ErrUnauthenticatedSession = errors.New("presentation session is not authenticated")

// Session is the server-side result of resolving an opaque browser session.
// ControllerToken stays server side and must be obtained from a resolver that
// has already authenticated and bound this session to Subject.
type Session struct {
	ID              string
	Subject         string
	ControllerToken controlplane.TokenSource
}

// SessionResolver owns browser-cookie validation, identity verification,
// expiry, logout, and CSRF policy. This package deliberately supplies no
// fallback resolver and never accepts identity from a request header.
type SessionResolver interface {
	ResolvePresentationSession(context.Context, *http.Request) (Session, error)
}

// SessionSourceProvider creates one scoped presentation source per request.
// It has no administrator-token field and never exposes a controller token to
// a template or browser response.
type SessionSourceProvider struct {
	resolver        SessionResolver
	baseURL         string
	httpClient      *http.Client
	requestTimeout  time.Duration
	controllerLabel string
	environment     string
	clock           func() time.Time
}

type SessionSourceProviderConfig struct {
	Resolver        SessionResolver
	ControllerURL   string
	HTTPClient      *http.Client
	RequestTimeout  time.Duration
	ControllerLabel string
	Environment     string
	Clock           func() time.Time
}

func NewSessionSourceProvider(config SessionSourceProviderConfig) (*SessionSourceProvider, error) {
	if config.Resolver == nil {
		return nil, errors.New("presentation session resolver is required")
	}
	// Validate the complete client configuration now, without retaining a
	// credential. Each request receives its token source only after session
	// resolution below.
	if _, err := controlplane.NewClient(controlplane.ClientConfig{
		BaseURL: config.ControllerURL, HTTPClient: config.HTTPClient,
		TokenSource: unavailableTokenSource{}, RequestTimeout: config.RequestTimeout,
	}); err != nil {
		return nil, err
	}
	return &SessionSourceProvider{
		resolver: config.Resolver, baseURL: config.ControllerURL, httpClient: config.HTTPClient,
		requestTimeout: config.RequestTimeout, controllerLabel: config.ControllerLabel,
		environment: config.Environment, clock: config.Clock,
	}, nil
}

// SourceForRequest is fail closed: resolver failure, malformed session data,
// or client construction failure creates no source and no fallback request.
func (p *SessionSourceProvider) SourceForRequest(ctx context.Context, request *http.Request) (Source, error) {
	if p == nil || p.resolver == nil || request == nil {
		return nil, ErrUnauthenticatedSession
	}
	session, err := p.resolver.ResolvePresentationSession(ctx, request)
	if err != nil {
		return nil, ErrUnauthenticatedSession
	}
	if strings.TrimSpace(session.ID) == "" || strings.TrimSpace(session.Subject) == "" || session.ControllerToken == nil {
		return nil, ErrUnauthenticatedSession
	}
	client, err := controlplane.NewClient(controlplane.ClientConfig{
		BaseURL: p.baseURL, HTTPClient: p.httpClient, TokenSource: session.ControllerToken, RequestTimeout: p.requestTimeout,
	})
	if err != nil {
		return nil, err
	}
	return NewLiveSource(LiveSourceConfig{
		Reader: &subjectBoundReader{client: client, subject: session.Subject}, ControllerLabel: p.controllerLabel, Environment: p.environment, Clock: p.clock,
	})
}

// subjectBoundReader verifies the controller's identity claim before every
// type of presentation data becomes reachable. The once is deliberately
// request-local because SessionSourceProvider creates this wrapper per request.
type subjectBoundReader struct {
	client  *controlplane.Client
	subject string
	once    sync.Once
	err     error
}

func (r *subjectBoundReader) Capabilities(ctx context.Context) (controlplane.Capabilities, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Capabilities{}, err
	}
	return r.client.Capabilities(ctx)
}

func (r *subjectBoundReader) Fleet(ctx context.Context) (controlplane.Fleet, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Fleet{}, err
	}
	return r.client.Fleet(ctx)
}

func (r *subjectBoundReader) Activity(ctx context.Context, limit int) (controlplane.Activity, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Activity{}, err
	}
	return r.client.Activity(ctx, limit)
}
func (r *subjectBoundReader) Controller(ctx context.Context) (controlplane.Controller, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Controller{}, err
	}
	return r.client.Controller(ctx)
}
func (r *subjectBoundReader) Capacity(ctx context.Context) (controlplane.Capacity, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Capacity{}, err
	}
	return r.client.Capacity(ctx)
}

func (r *subjectBoundReader) Application(ctx context.Context, name string) (controlplane.Application, error) {
	if err := r.authorize(ctx); err != nil {
		return controlplane.Application{}, err
	}
	return r.client.Application(ctx, name)
}

func (r *subjectBoundReader) authorize(ctx context.Context) error {
	if r == nil || r.client == nil || strings.TrimSpace(r.subject) == "" {
		return ErrUnauthenticatedSession
	}
	r.once.Do(func() {
		permissions, err := r.client.Permissions(ctx)
		if err != nil {
			r.err = fmt.Errorf("verifying scoped controller subject: %w", err)
			return
		}
		if permissions.Subject != r.subject {
			r.err = fmt.Errorf("%w: controller subject binding mismatch", ErrUnauthenticatedSession)
		}
	})
	return r.err
}

type unavailableTokenSource struct{}

func (unavailableTokenSource) PresentationToken(context.Context) (string, error) {
	return "", ErrUnauthenticatedSession
}
