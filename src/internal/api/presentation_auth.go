package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Capability is an explicit controller authorization grant. New scoped routes
// must declare one; unknown strings are rejected while loading credentials.
type Capability string

const (
	CapabilityFleetRead         Capability = "fleet:read"
	CapabilityApplicationRead   Capability = "application:read"
	CapabilityLogsRead          Capability = "logs:read"
	CapabilityApplicationSync   Capability = "application:sync"
	CapabilityApplicationWrite  Capability = "application:write"
	CapabilityApplicationDelete Capability = "application:delete"
	CapabilityControllerAdmin   Capability = "controller:admin"
	CapabilityControllerStatus  Capability = "controller:status"
	CapabilityCapacityRead      Capability = "capacity:read"
)

var validCapabilities = map[Capability]struct{}{
	CapabilityFleetRead: {}, CapabilityApplicationRead: {}, CapabilityLogsRead: {},
	CapabilityApplicationSync: {}, CapabilityApplicationWrite: {},
	CapabilityApplicationDelete: {}, CapabilityControllerAdmin: {},
	CapabilityControllerStatus: {}, CapabilityCapacityRead: {},
}

const maxPresentationApplicationGrants = 100

var ErrInvalidPresentationCredential = errors.New("invalid presentation credential")

// Principal is the verified, immutable authorization identity available to
// presentation routes. It deliberately contains no raw credential material.
type Principal struct {
	Subject      string
	CredentialID string
	Audience     string
	IssuedAt     time.Time
	ExpiresAt    time.Time
	capabilities map[Capability]struct{}
	applications map[string]struct{}
}

// Allows reports whether a principal has a capability and access to a concrete
// application. The wildcard is explicit; an empty grant list never means all.
func (p Principal) Allows(capability Capability, application string) bool {
	if _, found := p.capabilities[capability]; !found {
		return false
	}
	if application == "" {
		return true
	}
	if _, found := p.applications["*"]; found {
		return true
	}
	_, found := p.applications[application]
	return found
}

func (p Principal) Capabilities() []string {
	values := make([]string, 0, len(p.capabilities))
	for capability := range p.capabilities {
		values = append(values, string(capability))
	}
	sort.Strings(values)
	return values
}

func (p Principal) Applications() []string {
	values := make([]string, 0, len(p.applications))
	for application := range p.applications {
		values = append(values, application)
	}
	sort.Strings(values)
	return values
}

// PresentationCredential is provisioned metadata for an opaque high-entropy
// token. TokenDigest is a SHA-256 digest, never the token itself.
type PresentationCredential struct {
	TokenDigest  [sha256.Size]byte
	CredentialID string
	Subject      string
	Audience     string
	IssuedAt     time.Time
	ExpiresAt    time.Time
	Capabilities []Capability
	Applications []string
	Revoked      bool
}

// PresentationAuthenticator verifies the separate scoped credential path.
// It is intentionally independent from legacy bearer and cookie auth.
type PresentationAuthenticator interface {
	AuthenticatePresentation(context.Context, string) (Principal, error)
}

// OpaquePresentationAuthenticator keeps a validated immutable credential
// snapshot. Callers can construct a replacement and atomically swap it when a
// future operator-controlled registry reloads or revokes a credential.
type OpaquePresentationAuthenticator struct {
	credentials []PresentationCredential
	now         func() time.Time
}

func NewOpaquePresentationAuthenticator(credentials []PresentationCredential) (*OpaquePresentationAuthenticator, error) {
	copy := append([]PresentationCredential(nil), credentials...)
	seenIDs := make(map[string]struct{}, len(copy))
	seenDigests := make(map[[sha256.Size]byte]struct{}, len(copy))
	for index := range copy {
		credential := &copy[index]
		credential.Capabilities = append([]Capability(nil), credential.Capabilities...)
		credential.Applications = append([]string(nil), credential.Applications...)
		credential.CredentialID = strings.TrimSpace(credential.CredentialID)
		credential.Subject = strings.TrimSpace(credential.Subject)
		credential.Audience = strings.TrimSpace(credential.Audience)
		if credential.CredentialID == "" || credential.Subject == "" || credential.Audience == "" {
			return nil, fmt.Errorf("presentation credential %d requires id, subject, and audience", index)
		}
		if credential.IssuedAt.IsZero() || credential.ExpiresAt.IsZero() || !credential.ExpiresAt.After(credential.IssuedAt) {
			return nil, fmt.Errorf("presentation credential %q has invalid validity", credential.CredentialID)
		}
		if len(credential.Capabilities) == 0 {
			return nil, fmt.Errorf("presentation credential %q has no capabilities", credential.CredentialID)
		}
		if len(credential.Applications) > maxPresentationApplicationGrants {
			return nil, fmt.Errorf("presentation credential %q exceeds %d application grants", credential.CredentialID, maxPresentationApplicationGrants)
		}
		for _, capability := range credential.Capabilities {
			if _, valid := validCapabilities[capability]; !valid {
				return nil, fmt.Errorf("presentation credential %q has unknown capability %q", credential.CredentialID, capability)
			}
		}
		for _, application := range credential.Applications {
			if application = strings.TrimSpace(application); application == "" {
				return nil, fmt.Errorf("presentation credential %q has an empty application grant", credential.CredentialID)
			}
			if application == "*" {
				return nil, fmt.Errorf("presentation credential %q must name explicit application grants", credential.CredentialID)
			}
		}
		if requiresApplicationGrant(credential.Capabilities) && len(credential.Applications) == 0 {
			return nil, fmt.Errorf("presentation credential %q requires at least one application grant", credential.CredentialID)
		}
		if _, exists := seenIDs[credential.CredentialID]; exists {
			return nil, fmt.Errorf("duplicate presentation credential id %q", credential.CredentialID)
		}
		if _, exists := seenDigests[credential.TokenDigest]; exists {
			return nil, fmt.Errorf("duplicate presentation credential digest")
		}
		seenIDs[credential.CredentialID] = struct{}{}
		seenDigests[credential.TokenDigest] = struct{}{}
	}
	return &OpaquePresentationAuthenticator{credentials: copy, now: time.Now}, nil
}

func requiresApplicationGrant(capabilities []Capability) bool {
	for _, capability := range capabilities {
		if capability == CapabilityFleetRead || capability == CapabilityApplicationRead || capability == CapabilityLogsRead || capability == CapabilityApplicationSync || capability == CapabilityApplicationWrite || capability == CapabilityApplicationDelete {
			return true
		}
	}
	return false
}

func (a *OpaquePresentationAuthenticator) AuthenticatePresentation(_ context.Context, token string) (Principal, error) {
	if a == nil || strings.TrimSpace(token) == "" {
		return Principal{}, ErrInvalidPresentationCredential
	}
	digest := sha256.Sum256([]byte(token))
	match := -1
	for index := range a.credentials {
		// Compare every fixed-length digest to avoid an early-match timing oracle.
		if subtle.ConstantTimeCompare(digest[:], a.credentials[index].TokenDigest[:]) == 1 {
			match = index
		}
	}
	if match < 0 {
		return Principal{}, ErrInvalidPresentationCredential
	}
	credential := a.credentials[match]
	now := a.now()
	if credential.Revoked || now.Before(credential.IssuedAt) || !now.Before(credential.ExpiresAt) {
		return Principal{}, ErrInvalidPresentationCredential
	}
	principal := Principal{
		Subject: credential.Subject, CredentialID: credential.CredentialID, Audience: credential.Audience,
		IssuedAt: credential.IssuedAt, ExpiresAt: credential.ExpiresAt,
		capabilities: make(map[Capability]struct{}, len(credential.Capabilities)),
		applications: make(map[string]struct{}, len(credential.Applications)),
	}
	for _, capability := range credential.Capabilities {
		principal.capabilities[capability] = struct{}{}
	}
	for _, application := range credential.Applications {
		principal.applications[application] = struct{}{}
	}
	return principal, nil
}
