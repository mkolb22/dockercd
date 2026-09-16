package httpui

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mkolb22/dockercd/web/internal/localauth"
	"github.com/mkolb22/dockercd/web/internal/presentation"
	"golang.org/x/crypto/argon2"
)

func TestLocalLoginProtectsPresentationAndKeepsCredentialsOutOfHTML(t *testing.T) {
	authenticator := localAuthenticator(t)
	provider := sourceProviderFunc(func(ctx context.Context, request *http.Request) (presentation.Source, error) {
		if _, err := authenticator.ResolvePresentationSession(ctx, request); err != nil {
			return nil, err
		}
		return presentation.NewFixtureSource(), nil
	})
	server := NewWithSourceProviderAndAuthenticator(provider, authenticator)

	unauthenticated := httptest.NewRecorder()
	server.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/fleet", nil))
	if unauthenticated.Code != http.StatusSeeOther || unauthenticated.Header().Get("Location") != "/login" {
		t.Fatalf("unauthenticated route = %d %q", unauthenticated.Code, unauthenticated.Header().Get("Location"))
	}

	loginPage := httptest.NewRecorder()
	server.ServeHTTP(loginPage, httptest.NewRequest(http.MethodGet, "/login", nil))
	if loginPage.Code != http.StatusOK || !strings.Contains(loginPage.Body.String(), "LOCAL OPERATOR ACCESS") {
		t.Fatalf("login page = %d %s", loginPage.Code, loginPage.Body.String())
	}
	flow := responseCookie(t, loginPage, "dockercd_web_login")
	csrf := hiddenInput(t, loginPage.Body.String(), "csrf")

	form := url.Values{"subject": {"operator"}, "password": {"correct-password"}, "csrf": {csrf}}
	login := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	login.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	login.AddCookie(flow)
	loginResult := httptest.NewRecorder()
	server.ServeHTTP(loginResult, login)
	if loginResult.Code != http.StatusSeeOther || loginResult.Header().Get("Location") != "/fleet" {
		t.Fatalf("login = %d %q", loginResult.Code, loginResult.Header().Get("Location"))
	}
	session := responseCookie(t, loginResult, "dockercd_web_session")
	if !session.HttpOnly || !session.Secure || session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookie: %#v", session)
	}

	fleet := httptest.NewRecorder()
	fleetRequest := httptest.NewRequest(http.MethodGet, "/fleet", nil)
	fleetRequest.AddCookie(session)
	server.ServeHTTP(fleet, fleetRequest)
	if fleet.Code != http.StatusOK {
		t.Fatalf("authenticated fleet = %d: %s", fleet.Code, fleet.Body.String())
	}
	if strings.Contains(fleet.Body.String(), "controller-test-token") || !strings.Contains(fleet.Body.String(), "Sign out") {
		t.Fatal("session page exposed a server-side credential or omitted logout")
	}
	if fleet.Header().Get("Content-Security-Policy") == "" || fleet.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("authenticated HTML response lacks security headers")
	}
}

func TestLocalLoginRejectsMissingCSRFAndLogoutRequiresSessionCSRF(t *testing.T) {
	authenticator := localAuthenticator(t)
	server := NewWithSourceProviderAndAuthenticator(staticSourceProvider{source: presentation.NewFixtureSource()}, authenticator)

	badLogin := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("subject=operator&password=correct-password"))
	badLogin.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginResult := httptest.NewRecorder()
	server.ServeHTTP(loginResult, badLogin)
	if loginResult.Code != http.StatusBadRequest {
		t.Fatalf("missing login csrf = %d", loginResult.Code)
	}

	page := httptest.NewRecorder()
	server.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/login", nil))
	flow := responseCookie(t, page, "dockercd_web_login")
	csrf := hiddenInput(t, page.Body.String(), "csrf")
	form := url.Values{"subject": {"operator"}, "password": {"correct-password"}, "csrf": {csrf}}
	request := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.AddCookie(flow)
	result := httptest.NewRecorder()
	server.ServeHTTP(result, request)
	session := responseCookie(t, result, "dockercd_web_session")

	logout := httptest.NewRequest(http.MethodPost, "/logout", strings.NewReader("csrf=wrong"))
	logout.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	logout.AddCookie(session)
	logoutResult := httptest.NewRecorder()
	server.ServeHTTP(logoutResult, logout)
	if logoutResult.Code != http.StatusForbidden {
		t.Fatalf("invalid logout csrf = %d", logoutResult.Code)
	}
}

func localAuthenticator(t *testing.T) *localauth.Authenticator {
	t.Helper()
	salt := bytes.Repeat([]byte{0x11}, 16)
	digest := argon2.IDKey([]byte("correct-password"), salt, 1, 32768, 1, 32)
	verifier := "$argon2id$v=19$m=32768,t=1,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(digest)
	path := filepath.Join(t.TempDir(), "users.json")
	registry := `{"version":1,"users":[{"subject":"operator","passwordHash":"` + verifier + `","controllerToken":"controller-test-token"}]}`
	if err := os.WriteFile(path, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	authenticator, err := localauth.New(localauth.Config{UsersFile: path, CookieSecure: true})
	if err != nil {
		t.Fatal(err)
	}
	return authenticator
}

func responseCookie(t *testing.T, recorder *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("response did not set cookie %q", name)
	return nil
}

func hiddenInput(t *testing.T, page, name string) string {
	t.Helper()
	prefix := `name="` + name + `" value="`
	start := strings.Index(page, prefix)
	if start < 0 {
		t.Fatalf("page has no hidden %q input", name)
	}
	remaining := page[start+len(prefix):]
	end := strings.Index(remaining, `"`)
	if end < 0 {
		t.Fatalf("hidden %q input is malformed", name)
	}
	return remaining[:end]
}
