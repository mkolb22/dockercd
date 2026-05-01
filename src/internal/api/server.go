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
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
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
}

// Server is the HTTP API server.
type Server struct {
	httpServer *http.Server
	handler    *Handler
	logger     *slog.Logger
}

// NewServer creates a new API server.
func NewServer(addr string, deps ServerDeps) *Server {
	h := &Handler{
		store:         deps.Store,
		reconciler:    deps.Reconciler,
		inspector:     deps.Inspector,
		logger:        deps.Logger,
		sseHub:        deps.SSEHub,
		eventWatcher:  deps.EventWatcher,
		webhookSecret: deps.WebhookSecret,
		apiToken:      deps.APIToken,
	}

	router := chi.NewRouter()

	// Middleware stack
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(slogRequestLogger(deps.Logger))
	router.Use(middleware.Recoverer)

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
		}
		r.Get("/system", h.GetSystemInfo)
		r.Get("/system/stats", h.GetHostStats)
		r.Get("/settings/poll-interval", h.GetPollInterval)
		r.Put("/settings/poll-interval", h.SetPollInterval)
		r.Route("/applications", func(r chi.Router) {
			r.Get("/", h.ListApplications)
			r.Post("/", h.CreateApplication)
			r.Route("/{name}", func(r chi.Router) {
				r.Get("/", h.GetApplication)
				r.Delete("/", h.DeleteApplication)
				r.Post("/sync", h.SyncApplication)
				r.Post("/rollback", h.RollbackApplication)
				r.Post("/adopt", h.AdoptApplication)
				r.Get("/diff", h.DiffApplication)
				r.Get("/desired", h.GetRenderedDesired)
				r.Get("/events", h.GetEvents)
				r.Get("/history", h.GetHistory)
				r.Get("/metrics", h.GetAppMetrics)
				r.Route("/services/{service}", func(r chi.Router) {
					r.Get("/", h.GetServiceDetail)
					r.Get("/metrics", h.GetServiceMetrics)
					r.Get("/logs", h.GetServiceLogs)
				})
			})
		})
	})

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
			// WriteTimeout is intentionally omitted: SSE streams are long-lived
			// connections. Long-running sync handlers are bounded by each
			// application's syncTimeout policy.
		},
		handler: h,
		logger:  deps.Logger,
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

// bearerAuth returns middleware that validates a Bearer token in the Authorization header.
// Uses constant-time comparison to prevent timing attacks.
func bearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := ""
			auth := r.Header.Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				provided = strings.TrimPrefix(auth, "Bearer ")
			} else if cookie, err := r.Cookie(authCookieName); err == nil {
				provided = cookie.Value
			}
			if provided == "" {
				http.Error(w, `{"error":"missing or invalid Authorization header"}`, http.StatusUnauthorized)
				return
			}
			if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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
