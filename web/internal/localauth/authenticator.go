// Package localauth implements the deliberately small first identity boundary
// for dockercd-web. It authenticates only an operator-provisioned, file-backed
// local user registry; passwords are Argon2id verifiers and controller tokens
// remain server side in ephemeral sessions.
package localauth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
	"github.com/mkolb22/dockercd/web/internal/presentation"
	"golang.org/x/crypto/argon2"
)

const (
	maxUserRegistryBytes = 128 << 10
	maxPasswordBytes     = 1024
	defaultArgonMemory   = 65536
	defaultArgonTime     = 3
	defaultArgonParallel = 1
	maxSessions          = 1024
	rateBucketCount      = 1024
	maxPasswordChecks    = 1
	defaultSessionTTL    = 8 * time.Hour
	defaultLoginFlowTTL  = 10 * time.Minute
	lockoutAfterFailures = 5
	lockoutDuration      = 15 * time.Minute
	sessionCookieName    = "dockercd_web_session"
	loginCookieName      = "dockercd_web_login"
)

var (
	ErrInvalidCredentials = errors.New("local login failed")
	ErrRateLimited        = errors.New("local login is temporarily rate limited")
	ErrInvalidCSRF        = errors.New("local login request is invalid")
)

var localSubject = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

// HashPassword produces the supported Argon2id PHC verifier for an operator
// provisioned local user registry. It deliberately returns only a verifier;
// callers must never store or print the supplied plaintext password.
func HashPassword(password []byte) (string, error) {
	if len(password) == 0 || len(password) > maxPasswordBytes {
		return "", errors.New("local password must be between 1 and 1024 bytes")
	}
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("creating Argon2id salt: %w", err)
	}
	input := append([]byte(nil), password...)
	defer clear(input)
	digest := argon2.IDKey(input, salt, defaultArgonTime, defaultArgonMemory, defaultArgonParallel, 32)
	defer clear(digest)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", defaultArgonMemory, defaultArgonTime, defaultArgonParallel, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(digest)), nil
}

// Config contains only process-local authentication configuration. UsersFile
// must be a Docker Compose secret mount, not a path derived from a request.
type Config struct {
	UsersFile    string
	CookieSecure bool
	SessionTTL   time.Duration
	LoginFlowTTL time.Duration
	Clock        func() time.Time
	Random       io.Reader
}

// Authenticator owns a process-local login signing key, sessions, and
// rate-limit state. A process restart intentionally logs everybody out rather
// than persisting controller credentials or session material.
type Authenticator struct {
	users          map[string]user
	cookieSecure   bool
	sessionTTL     time.Duration
	loginFlowTTL   time.Duration
	now            func() time.Time
	random         io.Reader
	mu             sync.Mutex
	sessions       map[string]session
	rateBuckets    []rateBucket
	passwordChecks chan struct{}
	fallbackHash   argon2idHash
	loginKey       []byte
	rateKey        []byte
}

type user struct {
	subject         string
	passwordHash    argon2idHash
	controllerToken string
}

type session struct {
	subject         string
	controllerToken string
	csrf            string
	expiresAt       time.Time
}

type rateBucket struct {
	failures int
	inFlight int
	until    time.Time
	updated  time.Time
}

type registry struct {
	Version int            `json:"version"`
	Users   []registryUser `json:"users"`
}

type registryUser struct {
	Subject         string `json:"subject"`
	PasswordHash    string `json:"passwordHash"`
	ControllerToken string `json:"controllerToken"`
}

// New loads and validates a bounded local registry. It accepts no plaintext
// password field and fails closed on malformed, duplicate, or unsafe entries.
func New(config Config) (*Authenticator, error) {
	path := strings.TrimSpace(config.UsersFile)
	if path == "" {
		return nil, errors.New("local user secret file is required")
	}
	raw, err := readBoundedFile(path, maxUserRegistryBytes)
	if err != nil {
		return nil, err
	}
	var loaded registry
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&loaded); err != nil {
		return nil, fmt.Errorf("decoding local user registry: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, fmt.Errorf("decoding local user registry: %w", err)
	}
	if loaded.Version != 1 || len(loaded.Users) == 0 || len(loaded.Users) > 128 {
		return nil, errors.New("local user registry must be version 1 with 1 to 128 users")
	}
	users := make(map[string]user, len(loaded.Users))
	tokenSubjects := make(map[string]string, len(loaded.Users))
	var fallbackHash argon2idHash
	for index, entry := range loaded.Users {
		subject := strings.TrimSpace(entry.Subject)
		if subject != entry.Subject || !localSubject.MatchString(subject) {
			return nil, errors.New("local user registry contains an invalid subject")
		}
		if _, exists := users[subject]; exists {
			return nil, errors.New("local user registry contains a duplicate subject")
		}
		hash, err := parseArgon2id(strings.TrimSpace(entry.PasswordHash))
		if err != nil {
			return nil, fmt.Errorf("local user registry password hash for %q: %w", subject, err)
		}
		if index > 0 && !sameArgon2idParameters(hash, fallbackHash) {
			return nil, errors.New("local user registry must use one Argon2id cost profile")
		}
		token := strings.TrimSpace(entry.ControllerToken)
		if token == "" || len(token) > 4096 {
			return nil, errors.New("local user registry contains an invalid scoped controller credential")
		}
		if existing, duplicate := tokenSubjects[token]; duplicate {
			return nil, fmt.Errorf("local user registry reuses a scoped controller credential for %q and %q", existing, subject)
		}
		tokenSubjects[token] = subject
		users[subject] = user{subject: subject, passwordHash: hash, controllerToken: token}
		if index == 0 {
			fallbackHash = hash
		}
	}
	now := config.Clock
	if now == nil {
		now = time.Now
	}
	random := config.Random
	if random == nil {
		random = rand.Reader
	}
	sessionTTL := config.SessionTTL
	if sessionTTL == 0 {
		sessionTTL = defaultSessionTTL
	}
	if sessionTTL < 5*time.Minute || sessionTTL > 24*time.Hour {
		return nil, errors.New("local session lifetime must be between 5 minutes and 24 hours")
	}
	flowTTL := config.LoginFlowTTL
	if flowTTL == 0 {
		flowTTL = defaultLoginFlowTTL
	}
	if flowTTL < time.Minute || flowTTL > 30*time.Minute {
		return nil, errors.New("local login flow lifetime must be between 1 and 30 minutes")
	}
	loginKey := make([]byte, 32)
	if _, err := io.ReadFull(random, loginKey); err != nil {
		return nil, fmt.Errorf("creating local login challenge key: %w", err)
	}
	rateKey := make([]byte, 32)
	if _, err := io.ReadFull(random, rateKey); err != nil {
		return nil, fmt.Errorf("creating local login rate key: %w", err)
	}
	return &Authenticator{
		users: users, cookieSecure: config.CookieSecure, sessionTTL: sessionTTL, loginFlowTTL: flowTTL,
		now: now, random: random, sessions: make(map[string]session), rateBuckets: make([]rateBucket, rateBucketCount), passwordChecks: make(chan struct{}, maxPasswordChecks), fallbackHash: fallbackHash, loginKey: loginKey, rateKey: rateKey,
	}, nil
}

// BeginLogin creates a signed, short-lived login challenge. It is stateless so
// untrusted GET traffic cannot consume a shared flow map. The cookie is
// host-only, HttpOnly, and SameSite=Lax; its paired hidden value protects the
// cookie-authenticated login POST from cross-site form submission.
func (a *Authenticator) BeginLogin(w http.ResponseWriter) (string, error) {
	if a == nil {
		return "", ErrInvalidCredentials
	}
	csrf, err := a.randomToken()
	if err != nil {
		return "", err
	}
	nonce, err := a.randomToken()
	if err != nil {
		return "", err
	}
	flow, err := a.loginChallenge(a.now().Add(a.loginFlowTTL), csrf, nonce)
	if err != nil {
		return "", err
	}
	a.setCookie(w, loginCookieName, flow, int(a.loginFlowTTL.Seconds()))
	return csrf, nil
}

// Login verifies the login challenge, verifies an Argon2id password verifier,
// applies a bounded rate limit, and creates a fresh opaque server-side session.
func (a *Authenticator) Login(w http.ResponseWriter, r *http.Request, subject, password, csrf string) error {
	if a == nil || r == nil || !a.verifyLoginChallengeFromRequest(r, csrf) {
		return ErrInvalidCSRF
	}
	subject = strings.TrimSpace(subject)
	account, exists := a.users[subject]
	bucketIndex := a.rateBucketIndex(subject)
	candidateHash := a.fallbackHash
	if exists {
		candidateHash = account.passwordHash
	}
	now := a.now()
	if !a.admitAttempt(bucketIndex, now) {
		return ErrRateLimited
	}
	if !a.acquirePasswordCheck() {
		a.cancelAttempt(bucketIndex, now)
		return ErrRateLimited
	}
	candidatePassword := password
	if len(candidatePassword) > maxPasswordBytes {
		candidatePassword = ""
	}
	verified := candidateHash.verify(candidatePassword)
	a.releasePasswordCheck()
	successful := exists && len(password) > 0 && len(password) <= maxPasswordBytes && verified
	a.finishAttempt(bucketIndex, a.now(), successful)
	if !successful {
		return ErrInvalidCredentials
	}
	sessionID, err := a.randomToken()
	if err != nil {
		return err
	}
	sessionCSRF, err := a.randomToken()
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.cleanupLocked(now)
	if len(a.sessions) >= maxSessions {
		a.mu.Unlock()
		return ErrRateLimited
	}
	a.sessions[sessionID] = session{subject: account.subject, controllerToken: account.controllerToken, csrf: sessionCSRF, expiresAt: now.Add(a.sessionTTL)}
	a.mu.Unlock()
	a.clearCookie(w, loginCookieName)
	a.setCookie(w, sessionCookieName, sessionID, int(a.sessionTTL.Seconds()))
	return nil
}

// Logout requires the same session-bound form token used for future mutation
// forms. It is intentionally POST-only at the HTTP routing boundary.
func (a *Authenticator) Logout(w http.ResponseWriter, r *http.Request, csrf string) error {
	if a == nil || r == nil {
		return ErrInvalidCSRF
	}
	sessionID, err := cookieValue(r, sessionCookieName)
	if err != nil {
		return ErrInvalidCSRF
	}
	now := a.now()
	a.mu.Lock()
	a.cleanupLocked(now)
	value, exists := a.sessions[sessionID]
	if !exists || subtle.ConstantTimeCompare([]byte(value.csrf), []byte(csrf)) != 1 {
		a.mu.Unlock()
		return ErrInvalidCSRF
	}
	delete(a.sessions, sessionID)
	a.mu.Unlock()
	a.clearCookie(w, sessionCookieName)
	return nil
}

// ResolvePresentationSession implements presentation.SessionResolver. It
// never uses request headers as identity and never exposes its token value.
func (a *Authenticator) ResolvePresentationSession(_ context.Context, r *http.Request) (presentation.Session, error) {
	sessionID, value, ok := a.current(r)
	if !ok {
		return presentation.Session{}, presentation.ErrUnauthenticatedSession
	}
	return presentation.Session{ID: sessionID, Subject: value.subject, ControllerToken: tokenSource(value.controllerToken)}, nil
}

// Current returns only the non-secret context required by the HTML shell.
func (a *Authenticator) Current(r *http.Request) (subject, csrf string, ok bool) {
	_, value, ok := a.current(r)
	if !ok {
		return "", "", false
	}
	return value.subject, value.csrf, true
}

func (a *Authenticator) current(r *http.Request) (string, session, bool) {
	if a == nil || r == nil {
		return "", session{}, false
	}
	sessionID, err := cookieValue(r, sessionCookieName)
	if err != nil {
		return "", session{}, false
	}
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cleanupLocked(now)
	value, exists := a.sessions[sessionID]
	return sessionID, value, exists
}

func (a *Authenticator) verifyLoginChallengeFromRequest(r *http.Request, csrf string) bool {
	flow, err := cookieValue(r, loginCookieName)
	if err != nil {
		return false
	}
	return a.verifyLoginChallenge(flow, csrf, a.now())
}

func (a *Authenticator) admitAttempt(index int, now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cleanupLocked(now)
	if index < 0 || index >= len(a.rateBuckets) {
		return false
	}
	bucket := a.rateBuckets[index]
	if now.Before(bucket.until) {
		return false
	}
	if bucket.failures+bucket.inFlight >= lockoutAfterFailures {
		return false
	}
	bucket.inFlight++
	bucket.updated = now
	a.rateBuckets[index] = bucket
	return true
}

func (a *Authenticator) cancelAttempt(index int, now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if index < 0 || index >= len(a.rateBuckets) {
		return
	}
	bucket := a.rateBuckets[index]
	if bucket.inFlight == 0 {
		return
	}
	bucket.inFlight--
	bucket.updated = now
	a.rateBuckets[index] = bucket
}

func (a *Authenticator) finishAttempt(index int, now time.Time, successful bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if index < 0 || index >= len(a.rateBuckets) {
		return
	}
	bucket := a.rateBuckets[index]
	if bucket.inFlight == 0 {
		return
	}
	bucket.inFlight--
	if successful {
		bucket.failures = 0
	} else {
		bucket.failures++
	}
	bucket.updated = now
	if bucket.failures >= lockoutAfterFailures {
		bucket.failures = 0
		bucket.until = now.Add(lockoutDuration)
	}
	a.rateBuckets[index] = bucket
}

func (a *Authenticator) acquirePasswordCheck() bool {
	select {
	case a.passwordChecks <- struct{}{}:
		return true
	default:
		return false
	}
}

func (a *Authenticator) releasePasswordCheck() {
	<-a.passwordChecks
}

func (a *Authenticator) cleanupLocked(now time.Time) {
	for id, value := range a.sessions {
		if !now.Before(value.expiresAt) {
			delete(a.sessions, id)
		}
	}
	for index, value := range a.rateBuckets {
		if value.inFlight > 0 {
			continue
		}
		if !value.until.IsZero() && now.Before(value.until) {
			continue
		}
		if !value.until.IsZero() || now.Sub(value.updated) > lockoutDuration {
			a.rateBuckets[index] = rateBucket{}
		}
	}
}

func (a *Authenticator) rateBucketIndex(subject string) int {
	if a == nil || len(a.rateKey) != 32 || len(a.rateBuckets) == 0 {
		return -1
	}
	mac := hmac.New(sha256.New, a.rateKey)
	_, _ = mac.Write([]byte(subject))
	digest := mac.Sum(nil)
	return int(binary.BigEndian.Uint64(digest[:8]) % uint64(len(a.rateBuckets)))
}

func (a *Authenticator) loginChallenge(expiresAt time.Time, csrf, nonce string) (string, error) {
	if a == nil || len(a.loginKey) != 32 {
		return "", ErrInvalidCSRF
	}
	payload := fmt.Sprintf("%d.%s.%s", expiresAt.Unix(), csrf, nonce)
	mac := hmac.New(sha256.New, a.loginKey)
	if _, err := mac.Write([]byte(payload)); err != nil {
		return "", fmt.Errorf("signing local login challenge: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (a *Authenticator) verifyLoginChallenge(value, csrf string, now time.Time) bool {
	if a == nil || len(a.loginKey) != 32 || len(value) > 256 {
		return false
	}
	encodedPayload, encodedMAC, ok := strings.Cut(value, ".")
	if !ok || encodedPayload == "" || encodedMAC == "" || strings.Contains(encodedMAC, ".") {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil || len(payload) > 192 {
		return false
	}
	providedMAC, err := base64.RawURLEncoding.DecodeString(encodedMAC)
	if err != nil || len(providedMAC) != sha256.Size {
		return false
	}
	mac := hmac.New(sha256.New, a.loginKey)
	_, _ = mac.Write(payload)
	if subtle.ConstantTimeCompare(providedMAC, mac.Sum(nil)) != 1 {
		return false
	}
	parts := strings.Split(string(payload), ".")
	if len(parts) != 3 || len(parts[1]) > 64 || len(parts[2]) > 64 {
		return false
	}
	expiresUnix, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || !now.Before(time.Unix(expiresUnix, 0)) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(parts[1]), []byte(csrf)) == 1
}

func (a *Authenticator) randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := io.ReadFull(a.random, bytes); err != nil {
		return "", fmt.Errorf("creating local session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (a *Authenticator) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: a.cookieSecure, SameSite: http.SameSiteLaxMode})
}

func (a *Authenticator) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.cookieSecure, SameSite: http.SameSiteLaxMode})
}

func readBoundedFile(path string, maximum int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("reading local user secret file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maximum {
		return nil, errors.New("local user secret file must be a bounded regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("reading local user secret file: %w", err)
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, fmt.Errorf("reading local user secret file: %w", err)
	}
	if int64(len(raw)) > maximum {
		return nil, errors.New("local user secret file must be a bounded regular file")
	}
	return raw, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON documents")
		}
		return err
	}
	return nil
}

func cookieValue(r *http.Request, name string) (string, error) {
	cookie, err := r.Cookie(name)
	if err != nil || strings.TrimSpace(cookie.Value) == "" || len(cookie.Value) > 256 {
		return "", errors.New("missing local session cookie")
	}
	return cookie.Value, nil
}

type tokenSource string

func (token tokenSource) PresentationToken(context.Context) (string, error) {
	return string(token), nil
}

var _ controlplane.TokenSource = tokenSource("")

type argon2idHash struct {
	memory      uint32
	time        uint32
	parallelism uint8
	salt        []byte
	hash        []byte
}

func parseArgon2id(value string) (argon2idHash, error) {
	parts := strings.Split(value, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return argon2idHash{}, errors.New("must be an Argon2id PHC verifier")
	}
	params := make(map[string]string, 3)
	for _, item := range strings.Split(parts[3], ",") {
		key, parameter, found := strings.Cut(item, "=")
		if !found || params[key] != "" {
			return argon2idHash{}, errors.New("has invalid Argon2id parameters")
		}
		params[key] = parameter
	}
	memory, err := parseBoundedUint32(params["m"], 32768, 262144)
	if err != nil {
		return argon2idHash{}, errors.New("has invalid Argon2id memory cost")
	}
	timeCost, err := parseBoundedUint32(params["t"], 1, 10)
	if err != nil {
		return argon2idHash{}, errors.New("has invalid Argon2id time cost")
	}
	parallelism, err := parseBoundedUint32(params["p"], 1, 4)
	if err != nil {
		return argon2idHash{}, errors.New("has invalid Argon2id parallelism")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return argon2idHash{}, errors.New("has invalid Argon2id salt")
	}
	hash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(hash) != 32 {
		return argon2idHash{}, errors.New("has invalid Argon2id digest")
	}
	return argon2idHash{memory: memory, time: timeCost, parallelism: uint8(parallelism), salt: salt, hash: hash}, nil
}

func parseBoundedUint32(value string, minimum, maximum uint32) (uint32, error) {
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil || parsed < uint64(minimum) || parsed > uint64(maximum) {
		return 0, errors.New("outside permitted range")
	}
	return uint32(parsed), nil
}

func sameArgon2idParameters(left, right argon2idHash) bool {
	return left.memory == right.memory && left.time == right.time && left.parallelism == right.parallelism
}

func (hash argon2idHash) verify(password string) bool {
	input := []byte(password)
	defer clear(input)
	computed := argon2.IDKey(input, hash.salt, hash.time, hash.memory, hash.parallelism, uint32(len(hash.hash)))
	defer clear(computed)
	return subtle.ConstantTimeCompare(computed, hash.hash) == 1
}

func clear(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
