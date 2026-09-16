package localauth

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/argon2"
)

func TestLoginCreatesOpaqueSessionAndResolvesScopedToken(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	authenticator := newTestAuthenticator(t, &now, bytes.NewReader(bytes.Repeat([]byte{0x41}, 256)))

	start := httptest.NewRecorder()
	csrf, err := authenticator.BeginLogin(start)
	if err != nil {
		t.Fatalf("begin login: %v", err)
	}
	flowCookie := cookieFrom(t, start, loginCookieName)

	login := httptest.NewRequest(http.MethodPost, "/login", nil)
	login.RemoteAddr = "192.0.2.8:4312"
	login.AddCookie(flowCookie)
	result := httptest.NewRecorder()
	if err := authenticator.Login(result, login, "operator", "correct-password", csrf); err != nil {
		t.Fatalf("login: %v", err)
	}
	sessionCookie := cookieFrom(t, result, sessionCookieName)
	if !sessionCookie.HttpOnly || !sessionCookie.Secure || sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookie protections: %#v", sessionCookie)
	}
	if strings.Contains(sessionCookie.Value, "controller-test-token") || len(sessionCookie.Value) < 40 {
		t.Fatalf("session cookie must be opaque")
	}

	request := httptest.NewRequest(http.MethodGet, "/fleet", nil)
	request.AddCookie(sessionCookie)
	session, err := authenticator.ResolvePresentationSession(context.Background(), request)
	if err != nil {
		t.Fatalf("resolve session: %v", err)
	}
	if session.Subject != "operator" || session.ID != sessionCookie.Value {
		t.Fatalf("unexpected session: %#v", session)
	}
	token, err := session.ControllerToken.PresentationToken(context.Background())
	if err != nil || token != "controller-test-token" {
		t.Fatalf("scoped token was not retained server side")
	}
	_, sessionCSRF, ok := authenticator.Current(request)
	if !ok || sessionCSRF == "" {
		t.Fatal("current session context missing")
	}

	logout := httptest.NewRecorder()
	if err := authenticator.Logout(logout, request, sessionCSRF); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := authenticator.ResolvePresentationSession(context.Background(), request); err == nil {
		t.Fatal("logged-out session remained valid")
	}
}

func TestHashPasswordProducesRandomUsableVerifierWithoutMutatingInput(t *testing.T) {
	password := []byte("correct-password")
	original := append([]byte(nil), password...)
	first, err := HashPassword(password)
	if err != nil {
		t.Fatalf("first password hash: %v", err)
	}
	second, err := HashPassword(password)
	if err != nil {
		t.Fatalf("second password hash: %v", err)
	}
	if first == second {
		t.Fatal("password hashes reused a salt")
	}
	if !bytes.Equal(password, original) {
		t.Fatal("password hash mutated its caller buffer")
	}
	parsed, err := parseArgon2id(first)
	if err != nil || !parsed.verify("correct-password") {
		t.Fatalf("generated verifier was not usable: %v", err)
	}
	for _, invalid := range [][]byte{nil, bytes.Repeat([]byte{'x'}, maxPasswordBytes+1)} {
		if _, err := HashPassword(invalid); err == nil {
			t.Fatal("invalid password length was accepted")
		}
	}
}

func TestLoginRejectsInvalidCSRFAndTamperedChallenge(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	authenticator := newTestAuthenticator(t, &now, bytes.NewReader(bytes.Repeat([]byte{0x42}, 512)))

	flow, csrf := beginLoginRequest(t, authenticator)
	wrong := httptest.NewRequest(http.MethodPost, "/login", nil)
	wrong.RemoteAddr = "198.51.100.3:99"
	wrong.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), wrong, "operator", "incorrect", csrf); err != ErrInvalidCredentials {
		t.Fatalf("incorrect password error = %v, want ErrInvalidCredentials", err)
	}
	flow, csrf = beginLoginRequest(t, authenticator)
	valid := httptest.NewRequest(http.MethodPost, "/login", nil)
	valid.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), valid, "operator", "correct-password", csrf+"x"); err != ErrInvalidCSRF {
		t.Fatalf("invalid csrf error = %v, want ErrInvalidCSRF", err)
	}

	flow, csrf = beginLoginRequest(t, authenticator)
	tampered := httptest.NewRequest(http.MethodPost, "/login", nil)
	tampered.AddCookie(&http.Cookie{Name: loginCookieName, Value: flow.Value + "x"})
	if err := authenticator.Login(httptest.NewRecorder(), tampered, "operator", "correct-password", csrf); err != ErrInvalidCSRF {
		t.Fatalf("tampered login challenge error = %v, want ErrInvalidCSRF", err)
	}
}

func TestLoginRateLimitExpires(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	authenticator := newTestAuthenticator(t, &now, bytes.NewReader(bytes.Repeat([]byte{0x43}, 2048)))
	for attempt := 0; attempt < lockoutAfterFailures; attempt++ {
		flow, csrf := beginLoginRequest(t, authenticator)
		request := httptest.NewRequest(http.MethodPost, "/login", nil)
		request.RemoteAddr = "203.0.113.9:999"
		request.AddCookie(flow)
		if err := authenticator.Login(httptest.NewRecorder(), request, "operator", "incorrect", csrf); err != ErrInvalidCredentials {
			t.Fatalf("attempt %d error = %v", attempt, err)
		}
	}
	flow, csrf := beginLoginRequest(t, authenticator)
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "203.0.113.9:999"
	request.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), request, "operator", "correct-password", csrf); err != ErrRateLimited {
		t.Fatalf("locked login error = %v, want ErrRateLimited", err)
	}

	now = now.Add(lockoutDuration + time.Second)
	flow, csrf = beginLoginRequest(t, authenticator)
	request = httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = "203.0.113.9:999"
	request.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), request, "operator", "correct-password", csrf); err != nil {
		t.Fatalf("login after lockout expiration: %v", err)
	}
}

func TestNewRejectsPlaintextAndUnknownRegistryFields(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "users.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"users":[{"subject":"operator","password":"not-a-verifier","controllerToken":"test"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{UsersFile: path}); err == nil {
		t.Fatal("plaintext password registry was accepted")
	}
}

func TestNewRejectsReusedControllerCredential(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "users.json")
	registry := fmt.Sprintf(`{"version":1,"users":[{"subject":"operator-a","passwordHash":%q,"controllerToken":"shared"},{"subject":"operator-b","passwordHash":%q,"controllerToken":"shared"}]}`, argonHash("one"), argonHash("two"))
	if err := os.WriteFile(path, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{UsersFile: path}); err == nil {
		t.Fatal("reused controller credential registry was accepted")
	}
}

func TestNewRejectsMixedArgon2idCostProfiles(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "users.json")
	secondHash := strings.Replace(argonHash("two"), "m=32768,t=1,p=1", "m=65536,t=1,p=1", 1)
	registry := fmt.Sprintf(`{"version":1,"users":[{"subject":"operator-a","passwordHash":%q,"controllerToken":"token-a"},{"subject":"operator-b","passwordHash":%q,"controllerToken":"token-b"}]}`, argonHash("one"), secondHash)
	if err := os.WriteFile(path, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{UsersFile: path}); err == nil {
		t.Fatal("mixed Argon2id cost registry was accepted")
	}
}

func TestLoginAdmissionIsBoundedAndLockedBucketFailsClosed(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	authenticator := newTestAuthenticator(t, &now, bytes.NewReader(bytes.Repeat([]byte{0x44}, 512)))
	flow, csrf := beginLoginRequest(t, authenticator)
	authenticator.passwordChecks <- struct{}{}
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), request, "operator", "correct-password", csrf); err != ErrRateLimited {
		t.Fatalf("saturated verifier admission error = %v, want ErrRateLimited", err)
	}
	<-authenticator.passwordChecks

	authenticator.mu.Lock()
	index := authenticator.rateBucketIndex("candidate")
	authenticator.rateBuckets[index] = rateBucket{until: now.Add(lockoutDuration)}
	authenticator.mu.Unlock()
	if authenticator.admitAttempt(index, now) {
		t.Fatal("locked rate bucket admitted a new login attempt")
	}
}

func TestLoginChallengesAreStatelessAndExpire(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	authenticator := newTestAuthenticator(t, &now, bytes.NewReader(bytes.Repeat([]byte{0x45}, 160000)))
	for index := 0; index < 2048; index++ {
		if _, err := authenticator.BeginLogin(httptest.NewRecorder()); err != nil {
			t.Fatalf("stateless login challenge %d: %v", index, err)
		}
	}
	flow, csrf := beginLoginRequest(t, authenticator)
	now = now.Add(defaultLoginFlowTTL)
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.AddCookie(flow)
	if err := authenticator.Login(httptest.NewRecorder(), request, "operator", "correct-password", csrf); err != ErrInvalidCSRF {
		t.Fatalf("expired login challenge error = %v, want ErrInvalidCSRF", err)
	}
}

func newTestAuthenticator(t *testing.T, now *time.Time, random *bytes.Reader) *Authenticator {
	t.Helper()
	directory := t.TempDir()
	path := filepath.Join(directory, "users.json")
	registry := fmt.Sprintf(`{"version":1,"users":[{"subject":"operator","passwordHash":%q,"controllerToken":"controller-test-token"}]}`+"\n", argonHash("correct-password"))
	if err := os.WriteFile(path, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	authenticator, err := New(Config{UsersFile: path, CookieSecure: true, Clock: func() time.Time { return *now }, Random: random})
	if err != nil {
		t.Fatalf("new authenticator: %v", err)
	}
	return authenticator
}

func beginLoginRequest(t *testing.T, authenticator *Authenticator) (*http.Cookie, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	csrf, err := authenticator.BeginLogin(recorder)
	if err != nil {
		t.Fatalf("begin login: %v", err)
	}
	return cookieFrom(t, recorder, loginCookieName), csrf
}

func cookieFrom(t *testing.T, recorder *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("cookie %q was not set", name)
	return nil
}

func argonHash(password string) string {
	salt := bytes.Repeat([]byte{0x11}, 16)
	digest := argon2.IDKey([]byte(password), salt, 1, 32768, 1, 32)
	return "$argon2id$v=19$m=32768,t=1,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(digest)
}
