// Package httpui renders the fixture-backed dockercd Web UI mockup.
package httpui

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/mkolb22/dockercd/web/internal/presentation"
)

//go:embed templates/*.html static/*
var assets embed.FS

type Server struct {
	provider  SourceProvider
	auth      LoginAuthenticator
	templates *template.Template
	static    http.Handler
}

// SourceProvider returns an isolated presentation source for one request. A
// live provider must resolve the browser's server-side session before it can
// return a scoped source; it must never fall back to fixture or admin access.
type SourceProvider interface {
	SourceForRequest(context.Context, *http.Request) (presentation.Source, error)
}

// LoginAuthenticator keeps identity policy outside the presentation package.
// Its implementation owns only opaque browser cookies and server-side
// sessions; it must not return controller credentials to this package.
type LoginAuthenticator interface {
	BeginLogin(http.ResponseWriter) (string, error)
	Login(http.ResponseWriter, *http.Request, string, string, string) error
	Logout(http.ResponseWriter, *http.Request, string) error
	Current(*http.Request) (subject, csrf string, ok bool)
}

type navigationItem struct {
	Label  string
	Path   string
	Active bool
}

type pageData struct {
	Title          string
	Page           string
	Section        string
	Navigation     []navigationItem
	View           presentation.ViewContext
	Fleet          presentation.Fleet
	Applications   []presentation.Application
	Application    *presentation.Application
	Activity       []presentation.Event
	RecentActivity []presentation.Event
	Query          string
	StateFilter    string
	Notice         string
	Action         string
	RefreshPath    string
	Subject        string
	CSRF           string
	LoginError     string
}

func New(source presentation.Source) *Server {
	if source == nil {
		panic("presentation source is required")
	}
	return NewWithSourceProvider(staticSourceProvider{source: source})
}

// NewWithSourceProvider permits the future live server to inject a
// session-scoped source factory. The executable keeps using New with fixtures.
func NewWithSourceProvider(provider SourceProvider) *Server {
	return newServer(provider, nil)
}

// NewWithSourceProviderAndAuthenticator wires a fail-closed live source to a
// narrowly scoped identity boundary. Fixture construction intentionally keeps
// this nil so fixture review continues to require no credentials.
func NewWithSourceProviderAndAuthenticator(provider SourceProvider, auth LoginAuthenticator) *Server {
	if auth == nil {
		panic("login authenticator is required")
	}
	return newServer(provider, auth)
}

func newServer(provider SourceProvider, auth LoginAuthenticator) *Server {
	if provider == nil {
		panic("presentation source provider is required")
	}
	parsed := template.Must(template.ParseFS(assets, "templates/*.html"))
	staticFS, err := fs.Sub(assets, "static")
	if err != nil {
		panic(fmt.Sprintf("static assets: %v", err))
	}
	server := &Server{
		provider:  provider,
		auth:      auth,
		templates: parsed,
		static:    http.FileServer(http.FS(staticFS)),
	}
	return server
}

type staticSourceProvider struct{ source presentation.Source }

func (p staticSourceProvider) SourceForRequest(_ context.Context, request *http.Request) (presentation.Source, error) {
	if source, ok := p.source.(fixtureScenarioSource); ok {
		return source.Scenario(request.URL.Query().Get("scenario")), nil
	}
	return p.source, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	if r.URL.Path == "/styles.css" {
		s.static.ServeHTTP(w, r)
		return
	}
	if r.URL.Path == "/" {
		if s.auth != nil {
			if _, _, ok := s.auth.Current(r); !ok {
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
		}
		http.Redirect(w, r, "/fleet", http.StatusSeeOther)
		return
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/login":
		s.loginPage(w, r, "", http.StatusOK)
	case r.Method == http.MethodPost && r.URL.Path == "/login":
		s.login(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/logout":
		s.logout(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/fleet":
		s.fleet(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/applications":
		s.applications(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/activity":
		s.activity(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/system":
		s.system(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/settings":
		s.settings(w, r)
	case strings.HasPrefix(r.URL.Path, "/applications/"):
		s.applicationRoute(w, r)
	default:
		s.notFound(w, r)
	}
}

func (s *Server) fleet(w http.ResponseWriter, r *http.Request) {
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	fleet, err := source.Fleet(r.Context())
	if err != nil {
		s.unavailable(w)
		return
	}
	// Keep fleet freshness with the fleet projection. The optional activity
	// request below has its own controller response time and must not overwrite
	// the timestamp shown for the primary page evidence.
	view := source.ViewContext()
	activity, activityErr := source.Activity(r.Context())
	if activityErr != nil && !presentation.IsFeatureUnavailable(activityErr) {
		s.unavailable(w)
		return
	}
	recentActivity := activity
	if len(recentActivity) > 3 {
		recentActivity = recentActivity[:3]
	}
	s.render(w, r, "fleet", pageData{
		Title: "Fleet · dockercd", Page: "fleet", View: view, Fleet: fleet,
		Applications: fleet.Applications, Activity: activity, RecentActivity: recentActivity,
		Notice: r.URL.Query().Get("notice"), RefreshPath: refreshPath(r),
	})
}

func (s *Server) applications(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	state := r.URL.Query().Get("state")
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	fleet, applications, err := source.Applications(r.Context(), query, state)
	if err != nil {
		s.unavailable(w)
		return
	}
	s.render(w, r, "applications", pageData{
		Title: "Applications · dockercd", Page: "applications", View: source.ViewContext(), Fleet: fleet,
		Applications: applications, Query: query, StateFilter: state, RefreshPath: refreshPath(r),
	})
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	activity, err := source.Activity(r.Context())
	if err != nil {
		s.unavailable(w)
		return
	}
	s.render(w, r, "activity", pageData{
		Title: "Activity · dockercd", Page: "activity", View: source.ViewContext(), Activity: activity, RefreshPath: refreshPath(r),
	})
}

func (s *Server) system(w http.ResponseWriter, r *http.Request) {
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	if !source.ViewContext().Fixture {
		s.notFound(w, r)
		return
	}
	fleet, err := source.Fleet(r.Context())
	if err != nil {
		s.unavailable(w)
		return
	}
	s.render(w, r, "system", pageData{Title: "System · dockercd", Page: "system", View: source.ViewContext(), Fleet: fleet, RefreshPath: refreshPath(r)})
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	s.render(w, r, "settings", pageData{Title: "Settings · dockercd", Page: "settings", View: source.ViewContext(), RefreshPath: refreshPath(r)})
}

func (s *Server) applicationRoute(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(path.Clean(r.URL.Path), "/applications/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "." || parts[0] == "" {
		s.notFound(w, r)
		return
	}
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	application, found, err := source.Application(r.Context(), parts[0])
	if err != nil {
		s.unavailable(w)
		return
	}
	if !found {
		s.notFound(w, r)
		return
	}

	section := "overview"
	if len(parts) > 1 {
		section = parts[1]
	}

	view := source.ViewContext()
	if r.Method == http.MethodPost && isFixtureAction(section) && view.Fixture && (len(parts) == 2 || (len(parts) == 3 && parts[2] == "confirm")) {
		s.confirmation(w, r, application, view, section, len(parts) == 3)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if section == "manage" && !view.Fixture {
		s.notFound(w, r)
		return
	}
	data := pageData{
		Title: fmt.Sprintf("%s · dockercd", application.Name), Page: "applications", View: view,
		Application: &application, Notice: r.URL.Query().Get("notice"), Section: "application-" + section, RefreshPath: refreshPath(r),
	}
	if len(parts) > 2 {
		s.notFound(w, r)
		return
	}
	switch section {
	case "overview":
		s.render(w, r, "application-overview", data)
	case "deploy":
		if data.View.Fixture {
			s.render(w, r, "application-deploy", data)
		} else {
			s.render(w, r, "application-limited", data)
		}
	case "timeline":
		if data.View.Fixture {
			s.render(w, r, "application-timeline", data)
		} else {
			s.render(w, r, "application-limited", data)
		}
	case "inspect":
		if data.View.Fixture {
			s.render(w, r, "application-inspect", data)
		} else {
			s.render(w, r, "application-limited", data)
		}
	case "manage":
		s.render(w, r, "application-manage", data)
	default:
		s.notFound(w, r)
	}
}

func (s *Server) confirmation(w http.ResponseWriter, r *http.Request, application presentation.Application, view presentation.ViewContext, action string, confirmed bool) {
	if confirmed {
		// Fixture behavior only: no controller call or state mutation occurs.
		notice := url.QueryEscape(fmt.Sprintf("Fixture confirmation recorded for %s. No controller operation was sent.", action))
		http.Redirect(w, r, "/applications/"+url.PathEscape(application.Name)+"/timeline?notice="+notice, http.StatusSeeOther)
		return
	}
	s.render(w, r, "confirmation", pageData{
		Title: fmt.Sprintf("Confirm %s · %s", action, application.Name), Page: "applications", View: view,
		Application: &application, Action: action, Section: "application-" + action, RefreshPath: "/applications/" + url.PathEscape(application.Name),
	})
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request, message string, status int) {
	if s.auth == nil {
		s.notFound(w, r)
		return
	}
	if _, _, ok := s.auth.Current(r); ok {
		http.Redirect(w, r, "/fleet", http.StatusSeeOther)
		return
	}
	csrf, err := s.auth.BeginLogin(w)
	if err != nil {
		s.unavailable(w)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	setSecurityHeaders(w)
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	if err := s.templates.ExecuteTemplate(w, "login", pageData{Title: "Sign in · dockercd", CSRF: csrf, LoginError: message}); err != nil {
		return
	}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		s.notFound(w, r)
		return
	}
	form, ok := boundedForm(w, r)
	if !ok {
		s.loginPage(w, r, "Sign-in failed. Start again.", http.StatusBadRequest)
		return
	}
	subject, subjectOK := singleFormValue(form, "subject")
	password, passwordOK := singleFormValue(form, "password")
	csrf, csrfOK := singleFormValue(form, "csrf")
	if len(form) != 3 || !subjectOK || !passwordOK || !csrfOK {
		s.loginPage(w, r, "Sign-in failed. Start again.", http.StatusBadRequest)
		return
	}
	if err := s.auth.Login(w, r, subject, password, csrf); err != nil {
		s.loginPage(w, r, "Sign-in failed. Check your details and try again.", http.StatusUnauthorized)
		return
	}
	http.Redirect(w, r, "/fleet", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		s.notFound(w, r)
		return
	}
	form, ok := boundedForm(w, r)
	csrf, csrfOK := singleFormValue(form, "csrf")
	if !ok || len(form) != 1 || !csrfOK || s.auth.Logout(w, r, csrf) != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		setSecurityHeaders(w)
		http.Error(w, "invalid sign-out request", http.StatusForbidden)
		return
	}
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func boundedForm(w http.ResponseWriter, r *http.Request) (url.Values, bool) {
	if r == nil || r.Body == nil || r.ContentLength > 4096 {
		return nil, false
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if contentType != "application/x-www-form-urlencoded" {
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		return nil, false
	}
	if len(r.PostForm) > 3 {
		return nil, false
	}
	return r.PostForm, true
}

func singleFormValue(form url.Values, name string) (string, bool) {
	values, ok := form[name]
	returnValue := ""
	if len(values) == 1 {
		returnValue = values[0]
	}
	return returnValue, ok && len(values) == 1
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, name string, data pageData) {
	data.Navigation = navigation(data.Page)
	s.addSessionContext(r, &data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	setSecurityHeaders(w)
	if err := s.templates.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template render failed", http.StatusInternalServerError)
	}
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	source, err := s.sourceForRequest(r)
	if err != nil {
		s.sourceError(w, r, err)
		return
	}
	data := pageData{Title: "Not found · dockercd", View: source.ViewContext(), RefreshPath: "/fleet"}
	data.Navigation = navigation(data.Page)
	s.addSessionContext(r, &data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	setSecurityHeaders(w)
	w.WriteHeader(http.StatusNotFound)
	if err := s.templates.ExecuteTemplate(w, "not-found", data); err != nil {
		// The response status and headers have already been committed. There is no
		// useful recovery body we can safely send at this point.
		return
	}
}

type fixtureScenarioSource interface {
	Scenario(name string) presentation.Source
}

func (s *Server) sourceForRequest(r *http.Request) (presentation.Source, error) {
	if s == nil || s.provider == nil {
		return nil, presentation.ErrUnauthenticatedSession
	}
	return s.provider.SourceForRequest(r.Context(), r)
}

func (s *Server) unavailable(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	setSecurityHeaders(w)
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write([]byte("<!doctype html><html lang=\"en\"><title>Presentation unavailable</title><main><h1>Presentation unavailable</h1><p>Refresh after your session and controller connection are available.</p></main></html>"))
}

func (s *Server) sourceError(w http.ResponseWriter, r *http.Request, err error) {
	if s.auth != nil && errors.Is(err, presentation.ErrUnauthenticatedSession) {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	s.unavailable(w)
}

func (s *Server) addSessionContext(r *http.Request, data *pageData) {
	if s.auth == nil || data == nil {
		return
	}
	data.Subject, data.CSRF, _ = s.auth.Current(r)
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'none'; object-src 'none'; style-src 'self'; img-src 'self' data:")
}

func refreshPath(r *http.Request) string {
	if r.Method != http.MethodGet {
		return "/fleet"
	}
	path := r.URL.EscapedPath()
	if path == "" || !strings.HasPrefix(path, "/") {
		return "/fleet"
	}
	if r.URL.RawQuery != "" {
		return path + "?" + r.URL.RawQuery
	}
	return path
}

func isFixtureAction(section string) bool {
	return section == "sync" || section == "rollback" || section == "edit" || section == "delete"
}

func navigation(active string) []navigationItem {
	items := []navigationItem{
		{Label: "Fleet", Path: "/fleet"},
		{Label: "Applications", Path: "/applications"},
		{Label: "Activity", Path: "/activity"},
		{Label: "System", Path: "/system"},
		{Label: "Settings", Path: "/settings"},
	}
	for index := range items {
		items[index].Active = strings.EqualFold(items[index].Label, active)
	}
	return items
}
