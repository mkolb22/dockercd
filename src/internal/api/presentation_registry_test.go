package api

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadOpaquePresentationAuthenticatorFile(t *testing.T) {
	token := "registry-token"
	digest := sha256.Sum256([]byte(token))
	registry := `{
  "credentials": [{
    "token_sha256": "` + fmtDigest(digest) + `",
    "credential_id": "web-reader-1",
    "subject": "web:alice",
    "audience": "dockercd-web",
    "issued_at": "2026-09-15T00:00:00Z",
    "expires_at": "2030-09-15T00:00:00Z",
    "capabilities": ["fleet:read"],
    "applications": ["project-git"]
  }]
}`
	path := writePresentationRegistry(t, registry)

	authenticator, err := LoadOpaquePresentationAuthenticatorFile(path)
	if err != nil {
		t.Fatalf("LoadOpaquePresentationAuthenticatorFile() error = %v", err)
	}
	authenticator.now = func() time.Time { return time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC) }
	principal, err := authenticator.AuthenticatePresentation(t.Context(), token)
	if err != nil {
		t.Fatalf("AuthenticatePresentation() error = %v", err)
	}
	if !principal.Allows(CapabilityFleetRead, "project-git") || principal.Allows(CapabilityFleetRead, "other") {
		t.Fatalf("unexpected loaded grants: %+v", principal)
	}
}

func TestLoadOpaquePresentationAuthenticatorFileRejectsUnsafeInput(t *testing.T) {
	digest := sha256.Sum256([]byte("registry-token"))
	valid := `{"credentials":[{"token_sha256":"` + fmtDigest(digest) + `","credential_id":"reader","subject":"web:alice","audience":"dockercd-web","issued_at":"2026-09-15T00:00:00Z","expires_at":"2030-09-15T00:00:00Z","capabilities":["fleet:read"],"applications":["project-git"]}]}`
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: strings.Replace(valid, "{\"credentials\"", "{\"unexpected\":true,\"credentials\"", 1)},
		{name: "raw token field", body: strings.Replace(valid, "\"token_sha256\"", "\"token\":\"secret\",\"token_sha256\"", 1)},
		{name: "uppercase digest", body: strings.Replace(valid, fmtDigest(digest), strings.ToUpper(fmtDigest(digest)), 1)},
		{name: "two documents", body: valid + "\n{}"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := LoadOpaquePresentationAuthenticatorFile(writePresentationRegistry(t, test.body))
			if err == nil {
				t.Fatal("expected registry to be rejected")
			}
		})
	}
}

func TestLoadOpaquePresentationAuthenticatorFileRejectsEmptyOversizedAndMalformedRegistry(t *testing.T) {
	for _, body := range []string{
		`{"credentials":[]}`,
		`{"credentials":[{"token_sha256":"not-a-digest","credential_id":"reader","subject":"web:alice","audience":"dockercd-web","issued_at":"2026-09-15T00:00:00Z","expires_at":"2030-09-15T00:00:00Z","capabilities":["fleet:read"],"applications":["project-git"]}]}`,
		strings.Repeat(" ", maxPresentationCredentialRegistrySize+1),
	} {
		_, err := LoadOpaquePresentationAuthenticatorFile(writePresentationRegistry(t, body))
		if err == nil {
			t.Fatal("expected unsafe registry to be rejected")
		}
	}
}

func TestLoadOpaquePresentationAuthenticatorFileRejectsNonRegularFile(t *testing.T) {
	_, err := LoadOpaquePresentationAuthenticatorFile(t.TempDir())
	if err == nil {
		t.Fatal("expected directory registry to be rejected")
	}
}

func writePresentationRegistry(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "presentation-credentials.json")
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatalf("writing registry fixture: %v", err)
	}
	return path
}

func fmtDigest(digest [sha256.Size]byte) string {
	return hex.EncodeToString(digest[:])
}
