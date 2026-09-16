package api

import (
	"context"
	"crypto/subtle"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/events"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/reconciler"
	"github.com/mkolb22/dockercd/internal/store"
)

//go:embed static/*
var staticFS embed.FS

// ServerDeps holds all dependencies for the API server.
type ServerDeps struct {
	Store         *store.SQLiteStore
	Reconciler    reconciler.Reconciler
	Inspector     inspector.StateInspector
	Logger        *slog.Logger
	SSEHub        eventbus.Broadcaster
	EventWatcher  *events.Watcher
	WebhookSecret string
	APIToken      string // If non-empty, require Bearer token on API routes
	// PresentationAuthenticator enables the additive, scoped presentation API.
	// It is intentionally distinct from legacy API-token and cookie auth.
	PresentationAuthenticator PresentationAuthenticator
	// PresentationAudience is the exact audience accepted for scoped requests.
	// An empty value leaves presentation routes disabled rather than guessing.
	PresentationAudience string
}

// Server is the HTTP API server.
type Server struct {
	httpServer *http.Server
	handler    *Handler
	logger     *slog.Logger
}

const hostStatsCacheTTL = 5 * time.Second

// hostStatsCache coalesces expensive Docker stats collection across dashboard
// clients. A short TTL keeps the UI responsive without repeatedly listing and
// inspecting every container for concurrent requests.
type hostStatsCache struct {
	mu        sync.Mutex
	stats     *app.HostStats
	fetchedAt time.Time
	wait      chan struct{}
}

func (c *hostStatsCache) get(ctx context.Context, insp inspector.StateInspector) (*app.HostStats, error) {
	for {
		c.mu.Lock()
		if c.stats != nil && time.Since(c.fetchedAt) < hostStatsCacheTTL {
			stats := c.stats
			c.mu.Unlock()
			return stats, nil
		}
		if c.wait == nil {
			c.wait = make(chan struct{})
			wait := c.wait
			c.mu.Unlock()

			stats, err := insp.HostStats(ctx, "")

			c.mu.Lock()
			if err == nil {
				c.stats = stats
				c.fetchedAt = time.Now()
			}
			c.wait = nil
			close(wait)
			c.mu.Unlock()
			return stats, err
		}
		wait := c.wait
		c.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-wait:
		}
	}
}

// NewServer creates a new API server.
func NewServer(addr string, deps ServerDeps) *Server {
	statsCache := &hostStatsCache{}
	h := &Handler{
		store:                     deps.Store,
		reconciler:                deps.Reconciler,
		inspector:                 deps.Inspector,
		logger:                    deps.Logger,
		sseHub:                    deps.SSEHub,
		eventWatcher:              deps.EventWatcher,
		webhookSecret:             deps.WebhookSecret,
		apiToken:                  deps.APIToken,
		presentationAuthenticator: deps.PresentationAuthenticator,
		presentationAudience:      strings.TrimSpace(deps.PresentationAudience),
		legacyAdminEnabled:        deps.APIToken != "",
		hostStats:                 statsCache,
	}

	router := chi.NewRouter()

	// Middleware stack
	router.Use(middleware.RequestID)
	router.Use(slogRequestLogger(deps.Logger))
	router.Use(middleware.Recoverer)
	router.Use(securityHeaders)
	expensiveRequests := limitConcurrency(maxConcurrentExpensiveRequests)
	presentationReadRequests := limitConcurrency(maxConcurrentPresentationReads)

	// Probes (no JSON content-type enforcement)
	router.Get("/healthz", h.Healthz)
	router.Get("/readyz", h.Readyz)

	// Browser session endpoint for the embedded UI. The UI cannot attach
	// Authorization headers to native EventSource connections, so a verified
	// HttpOnly cookie is used when API auth is enabled.
	if deps.APIToken != "" {
		router.Post("/api/v1/auth/session", h.Login)
		router.Delete("/api/v1/auth/session", h.Logout)
	}

	// API routes
	router.Route("/api/v1", func(r chi.Router) {
		r.Use(contentTypeJSON)
		if deps.APIToken != "" {
			r.Use(bearerAuth(deps.APIToken))
			r.Use(cookieCSRF)
		}
		r.Get("/capabilities", h.Capabilities)
		r.Get("/system", h.GetSystemInfo)
		r.With(expensiveRequests).Get("/system/stats", h.GetHostStats)
		r.Get("/settings/poll-interval", h.GetPollInterval)
		r.Put("/settings/poll-interval", h.SetPollInterval)
		r.Route("/applications", func(r chi.Router) {
			r.Get("/", h.ListApplications)
			r.Post("/", h.CreateApplication)
			r.Route("/{name}", func(r chi.Router) {
				r.Get("/", h.GetApplication)
				r.Put("/", h.UpdateApplication)
				r.Delete("/", h.DeleteApplication)
				r.With(expensiveRequests).Post("/sync", h.SyncApplication)
				r.With(expensiveRequests).Post("/rollback", h.RollbackApplication)
				r.With(expensiveRequests).Post("/adopt", h.AdoptApplication)
				r.With(expensiveRequests).Get("/diff", h.DiffApplication)
				r.With(expensiveRequests).Get("/desired", h.GetRenderedDesired)
				r.Get("/events", h.GetEvents)
				r.Get("/history", h.GetHistory)
				r.With(expensiveRequests).Get("/metrics", h.GetAppMetrics)
				r.Route("/services/{service}", func(r chi.Router) {
					r.With(expensiveRequests).Get("/", h.GetServiceDetail)
					r.With(expensiveRequests).Get("/metrics", h.GetServiceMetrics)
					r.With(expensiveRequests).Get("/logs", h.GetServiceLogs)
				})
			})
		})
	})

	// Presentation routes are additive and absent until an explicit scoped
	// authenticator is provided. They never accept a legacy cookie or token.
	if deps.PresentationAuthenticator != nil && strings.TrimSpace(deps.PresentationAudience) != "" && deps.APIToken != "" {
		router.Route("/api/v1/presentation", func(r chi.Router) {
			r.Use(contentTypeJSON)
			r.Use(presentationAuth(deps.PresentationAuthenticator, deps.PresentationAudience, deps.Logger))
			r.Get("/capabilities", h.PresentationCapabilities)
			r.Get("/permissions", h.PresentationPermissions)
			r.With(presentationReadRequests).Get("/fleet", h.PresentationFleet)
			r.With(presentationReadRequests).Get("/applications/{name}", h.PresentationApplication)
			r.With(presentationReadRequests).Get("/activity", h.PresentationActivity)
		})
	}

	// SSE event stream (outside JSON middleware — uses text/event-stream)
	if deps.APIToken != "" {
		router.With(bearerAuth(deps.APIToken)).Get("/api/v1/events/stream", h.StreamEvents)
	} else {
		router.Get("/api/v1/events/stream", h.StreamEvents)
	}

	// Git webhook (outside JSON middleware — accepts arbitrary push payloads).
	// Keep the singular route for compatibility with existing docs/configs.
	router.Post("/api/v1/webhook/git", h.HandleGitWebhook)
	router.Post("/api/v1/webhooks/git", h.HandleGitWebhook)

	// Web UI — embedded SPA
	staticContent, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic("embedded static FS missing 'static' subdirectory: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(staticContent))
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusMovedPermanently)
	})
	uiHandler := spaHandler(staticContent, fileServer)
	router.Get("/ui", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusMovedPermanently)
	})
	router.Get("/ui/", uiHandler)
	router.Get("/ui/*", uiHandler)

	return &Server{
		httpServer: &http.Server{
			Addr:              addr,
			Handler:           router,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			IdleTimeout:       120 * time.Second,
			MaxHeaderBytes:    32 << 10,
			// WriteTimeout is intentionally omitted: SSE streams are long-lived
			// connections. Long-running sync handlers are bounded by each
			// application's syncTimeout policy.
		},
		handler: h,
		logger:  deps.Logger,
	}
}

const maxConcurrentExpensiveRequests = 4

// Presentation status reads are independent of legacy Docker inspection,
// diff, and sync work. A burst of expensive administrator requests therefore
// cannot consume the Web fleet's bounded lightweight read capacity.
const maxConcurrentPresentationReads = 16

// securityHeaders protects the embedded browser UI without requiring an edge
// proxy. Style attributes remain allowed because the current UI uses them; the
// stricter script policy still disallows inline and dynamically evaluated code.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		next.ServeHTTP(w, r)
	})
}

// limitConcurrency rejects excess expensive work instead of accumulating an
// unbounded request backlog that can starve the Docker daemon and workers.
func limitConcurrency(max int) func(http.Handler) http.Handler {
	sem := make(chan struct{}, max)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
				next.ServeHTTP(w, r)
			default:
				writeError(w, http.StatusTooManyRequests, "too many concurrent requests", CodeTooManyRequests)
			}
		})
	}
}

// Start starts the HTTP server. Non-blocking.
func (s *Server) Start() error {
	s.logger.Info("starting API server", "addr", s.httpServer.Addr)
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("API server error", "error", err)
		}
	}()
	return nil
}

// Stop gracefully shuts down the API server.
func (s *Server) Stop(ctx context.Context) error {
	s.logger.Info("stopping API server")
	return s.httpServer.Shutdown(ctx)
}

// Addr returns the server's listen address.
func (s *Server) Addr() string {
	return s.httpServer.Addr
}

// Router returns the chi router for testing.
func (s *Server) Router() http.Handler {
	return s.httpServer.Handler
}

// contentTypeJSON sets Content-Type: application/json on responses.
func contentTypeJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}

// spaHandler serves static files under /ui/ with SPA fallback.
// Known files are served directly; unknown paths get index.html.
func spaHandler(staticContent fs.FS, fileServer http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Strip /ui/ prefix
		path := r.URL.Path
		if len(path) >= 4 {
			path = path[4:] // strip "/ui/"
		}

		// Serve index.html for root or empty path
		if path == "" || path == "index.html" {
			serveIndex(w, r, fileServer)
			return
		}

		// Try to open the file — if it exists, serve it
		if f, err := staticContent.Open(path); err == nil {
			f.Close()
			r2 := new(http.Request)
			*r2 = *r
			r2.URL = new(url.URL)
			*r2.URL = *r.URL
			r2.URL.Path = "/" + path
			fileServer.ServeHTTP(w, r2)
			return
		}

		// SPA fallback: serve index.html for unknown paths
		serveIndex(w, r, fileServer)
	}
}

// serveIndex rewrites the request to "/" so http.FileServer serves index.html.
func serveIndex(w http.ResponseWriter, r *http.Request, fileServer http.Handler) {
	r2 := new(http.Request)
	*r2 = *r
	r2.URL = new(url.URL)
	*r2.URL = *r.URL
	r2.URL.Path = "/"
	fileServer.ServeHTTP(w, r2)
}

const authCookieName = "dockercd_token"

type authMethodContextKey struct{}

type presentationPrincipalContextKey struct{}

const cookieAuthMethod = "cookie"

// bearerAuth returns middleware that validates a Bearer token in the Authorization header.
// Uses constant-time comparison to prevent timing attacks.
func bearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := ""
			auth := r.Header.Get("Authorization")
			authMethod := ""
			if strings.HasPrefix(auth, "Bearer ") {
				provided = strings.TrimPrefix(auth, "Bearer ")
			} else if cookie, err := r.Cookie(authCookieName); err == nil {
				provided = cookie.Value
				authMethod = cookieAuthMethod
			}
			if provided == "" {
				http.Error(w, `{"error":"missing or invalid Authorization header"}`, http.StatusUnauthorized)
				return
			}
			if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authMethodContextKey{}, authMethod)))
		})
	}
}

// presentationAuth recognizes only a scoped bearer credential. It deliberately
// ignores cookies and never falls back to legacy administrator authentication.
func presentationAuth(authenticator PresentationAuthenticator, audience string, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authorization := r.Header.Get("Authorization")
			if !strings.HasPrefix(authorization, "Bearer ") || strings.Count(authorization, "Bearer ") != 1 {
				auditPresentation(logger, r, nil, "authenticate", "", "deny")
				writeError(w, http.StatusUnauthorized, "missing or invalid presentation credential", CodeUnauthorized)
				return
			}
			principal, err := authenticator.AuthenticatePresentation(r.Context(), strings.TrimPrefix(authorization, "Bearer "))
			if err != nil || subtle.ConstantTimeCompare([]byte(principal.Audience), []byte(audience)) != 1 {
				auditPresentation(logger, r, nil, "authenticate", "", "deny")
				writeError(w, http.StatusUnauthorized, "missing or invalid presentation credential", CodeUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), presentationPrincipalContextKey{}, principal)))
		})
	}
}

func auditPresentation(logger *slog.Logger, r *http.Request, principal *Principal, capability, resource, decision string) {
	if logger == nil {
		return
	}
	attributes := []slog.Attr{
		slog.String("event", "presentation_authorization"), slog.String("route", r.URL.Path),
		slog.String("capability", capability), slog.String("resource", resource), slog.String("decision", decision),
		slog.String("request_id", middleware.GetReqID(r.Context())),
	}
	if principal != nil {
		attributes = append(attributes, slog.String("subject", principal.Subject), slog.String("credential_id", principal.CredentialID))
	}
	logger.LogAttrs(r.Context(), slog.LevelInfo, "presentation authorization", attributes...)
}

func presentationPrincipal(r *http.Request) (Principal, bool) {
	principal, ok := r.Context().Value(presentationPrincipalContextKey{}).(Principal)
	return principal, ok
}

// cookieCSRF requires a non-simple header for state-changing requests that
// authenticate through the browser cookie. Cross-origin forms and fetches
// cannot supply this header without an explicit CORS grant.
func cookieCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Value(authMethodContextKey{}) == cookieAuthMethod &&
			(r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch || r.Method == http.MethodDelete) &&
			r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
			writeError(w, http.StatusForbidden, "missing CSRF request header", CodeForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// slogRequestLogger returns middleware that logs HTTP requests using slog.
func slogRequestLogger(logger *slog.Logger) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Debug("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration", fmt.Sprintf("%.3fms", float64(time.Since(start).Microseconds())/1000),
				"bytes", ww.BytesWritten(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}
