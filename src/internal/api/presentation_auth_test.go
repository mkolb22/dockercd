package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"
)

func testPresentationCredential(token string) PresentationCredential {
	return PresentationCredential{
		TokenDigest: sha256.Sum256([]byte(token)), CredentialID: "cred-reader", Subject: "operator-42", Audience: "dockercd-presentation",
		IssuedAt: time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC),
		Capabilities: []Capability{CapabilityFleetRead, CapabilityApplicationRead}, Applications: []string{"app-a"},
	}
}

func TestOpaquePresentationAuthenticatorScopesAndExpiry(t *testing.T) {
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{testPresentationCredential("test-only-opaque-token")})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	principal, err := authenticator.AuthenticatePresentation(context.Background(), "test-only-opaque-token")
	if err != nil {
		t.Fatal(err)
	}
	if !principal.Allows(CapabilityApplicationRead, "app-a") || principal.Allows(CapabilityApplicationRead, "app-b") || principal.Allows(CapabilityLogsRead, "app-a") {
		t.Fatalf("unexpected resource capability grants: %+v", principal)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC) }
	if _, err := authenticator.AuthenticatePresentation(context.Background(), "test-only-opaque-token"); !errors.Is(err, ErrInvalidPresentationCredential) {
		t.Fatalf("expired credential error = %v", err)
	}
}

func TestOpaquePresentationAuthenticatorRejectsInvalidRegistry(t *testing.T) {
	credential := testPresentationCredential("test-only-opaque-token")
	credential.Capabilities = []Capability{"unexpected:scope"}
	if _, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential}); err == nil {
		t.Fatal("unknown capability was accepted")
	}
}

func TestOpaquePresentationAuthenticatorRejectsBroadOrEmptyApplicationGrants(t *testing.T) {
	credential := testPresentationCredential("test-only-opaque-token")
	credential.Applications = []string{"*"}
	if _, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential}); err == nil {
		t.Fatal("wildcard application grant was accepted")
	}
	credential = testPresentationCredential("test-only-other-token")
	credential.Applications = nil
	if _, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential}); err == nil {
		t.Fatal("empty application grant was accepted for a reader")
	}
	credential = testPresentationCredential("test-only-many-grants-token")
	credential.Applications = make([]string, maxPresentationApplicationGrants+1)
	for index := range credential.Applications {
		credential.Applications[index] = fmt.Sprintf("app-%d", index)
	}
	if _, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential}); err == nil {
		t.Fatal("unbounded application grants were accepted")
	}
}

func TestOpaquePresentationAuthenticatorOwnsValidatedGrantSnapshot(t *testing.T) {
	credential := testPresentationCredential("test-only-opaque-token")
	authenticator, err := NewOpaquePresentationAuthenticator([]PresentationCredential{credential})
	if err != nil {
		t.Fatal(err)
	}
	authenticator.now = func() time.Time { return time.Date(2026, 9, 15, 13, 0, 0, 0, time.UTC) }
	credential.Applications[0] = "*"
	credential.Capabilities[0] = CapabilityLogsRead
	principal, err := authenticator.AuthenticatePresentation(context.Background(), "test-only-opaque-token")
	if err != nil {
		t.Fatal(err)
	}
	if principal.Allows(CapabilityApplicationRead, "app-b") || principal.Allows(CapabilityLogsRead, "app-a") {
		t.Fatal("caller mutation changed the validated credential snapshot")
	}
}
