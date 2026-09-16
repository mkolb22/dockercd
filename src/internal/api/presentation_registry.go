package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
)

// maxPresentationCredentialRegistrySize bounds operator-supplied registry
// input before decoding. Credentials are intentionally few and explicit; a
// large registry would make every authenticated request needlessly expensive.
const maxPresentationCredentialRegistrySize = 1 << 20

// PresentationCredentialRegistry is the on-disk, digest-only credential
// registry. It contains authorization metadata, never bearer token values.
// The file is loaded once during controller startup into an immutable snapshot.
type PresentationCredentialRegistry struct {
	Credentials []PresentationCredentialRecord `json:"credentials"`
}

// PresentationCredentialRecord is the JSON representation of one opaque
// presentation credential. TokenSHA256 must be the lowercase hexadecimal
// SHA-256 digest of the independently provisioned high-entropy token.
type PresentationCredentialRecord struct {
	TokenSHA256  string       `json:"token_sha256"`
	CredentialID string       `json:"credential_id"`
	Subject      string       `json:"subject"`
	Audience     string       `json:"audience"`
	IssuedAt     time.Time    `json:"issued_at"`
	ExpiresAt    time.Time    `json:"expires_at"`
	Capabilities []Capability `json:"capabilities"`
	Applications []string     `json:"applications"`
	Revoked      bool         `json:"revoked"`
}

// LoadOpaquePresentationAuthenticatorFile reads a bounded, strict JSON
// registry and validates it before any request can use it. The token is never
// present in the file or returned from this function.
func LoadOpaquePresentationAuthenticatorFile(path string) (*OpaquePresentationAuthenticator, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("presentation credential registry path is empty")
	}

	file, err := openPresentationCredentialRegistry(path)
	if err != nil {
		return nil, fmt.Errorf("opening presentation credential registry: %w", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("stating presentation credential registry: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("presentation credential registry must be a regular file")
	}
	if info.Size() > maxPresentationCredentialRegistrySize {
		return nil, fmt.Errorf("presentation credential registry exceeds %d bytes", maxPresentationCredentialRegistrySize)
	}

	decoder := json.NewDecoder(io.LimitReader(file, maxPresentationCredentialRegistrySize+1))
	decoder.DisallowUnknownFields()
	var registry PresentationCredentialRegistry
	if err := decoder.Decode(&registry); err != nil {
		return nil, fmt.Errorf("decoding presentation credential registry: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, err
	}
	if len(registry.Credentials) == 0 {
		return nil, fmt.Errorf("presentation credential registry contains no credentials")
	}

	credentials := make([]PresentationCredential, 0, len(registry.Credentials))
	for index, record := range registry.Credentials {
		digest, err := decodePresentationTokenDigest(record.TokenSHA256)
		if err != nil {
			return nil, fmt.Errorf("presentation credential %d: %w", index, err)
		}
		credentials = append(credentials, PresentationCredential{
			TokenDigest:  digest,
			CredentialID: record.CredentialID,
			Subject:      record.Subject,
			Audience:     record.Audience,
			IssuedAt:     record.IssuedAt,
			ExpiresAt:    record.ExpiresAt,
			Capabilities: record.Capabilities,
			Applications: record.Applications,
			Revoked:      record.Revoked,
		})
	}

	authenticator, err := NewOpaquePresentationAuthenticator(credentials)
	if err != nil {
		return nil, fmt.Errorf("validating presentation credential registry: %w", err)
	}
	return authenticator, nil
}

func decodePresentationTokenDigest(value string) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	if strings.TrimSpace(value) != value || strings.ToLower(value) != value {
		return digest, fmt.Errorf("token_sha256 must be lowercase hexadecimal")
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return digest, fmt.Errorf("token_sha256 must be a SHA-256 digest")
	}
	copy(digest[:], decoded)
	return digest, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("presentation credential registry must contain exactly one JSON document")
		}
		return fmt.Errorf("reading presentation credential registry: %w", err)
	}
	return nil
}
