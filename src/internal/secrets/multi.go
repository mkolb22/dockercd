package secrets

import (
	"context"
	"fmt"
)

// MultiProvider chains multiple Provider implementations, delegating to the first
// one that reports it can handle a given reference. This allows combining Age,
// Vault, AWS Secrets Manager, and any future provider transparently.
type MultiProvider struct {
	providers []Provider
}

// NewMulti creates a MultiProvider from the given providers.
func NewMulti(providers ...Provider) *MultiProvider {
	return &MultiProvider{providers: providers}
}

// CanHandle returns true if any registered provider can handle the path.
func (m *MultiProvider) CanHandle(path string) bool {
	for _, p := range m.providers {
		if p.CanHandle(path) {
			return true
		}
	}
	return false
}

// Decrypt delegates to the first provider that can handle the path.
// Returns an error if no provider can handle the reference.
func (m *MultiProvider) Decrypt(ctx context.Context, path string) (map[string]string, error) {
	for _, p := range m.providers {
		if p.CanHandle(path) {
			return p.Decrypt(ctx, path)
		}
	}
	return nil, fmt.Errorf("no secrets provider can handle %q", path)
}
