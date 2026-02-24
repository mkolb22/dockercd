package secrets

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// VaultProvider retrieves secrets from HashiCorp Vault using the HTTP API.
type VaultProvider struct {
	addr   string // Vault server address (e.g., "http://vault:8200")
	token  string // Vault token for authentication
	client *http.Client
}

// NewVault creates a VaultProvider.
func NewVault(addr, token string) *VaultProvider {
	return &VaultProvider{
		addr:  strings.TrimRight(addr, "/"),
		token: token,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CanHandle returns true for vault: prefixed references.
func (p *VaultProvider) CanHandle(path string) bool {
	return strings.HasPrefix(path, "vault:")
}

// Decrypt resolves a Vault secret reference.
// Format: vault:secret/data/myapp#field
// The path after "vault:" is the Vault KV v2 API path.
// The optional #field suffix selects a specific field from the secret data.
// If no field is specified, all fields are returned.
func (p *VaultProvider) Decrypt(ctx context.Context, ref string) (map[string]string, error) {
	// Parse reference: vault:secret/data/myapp#field
	ref = strings.TrimPrefix(ref, "vault:")
	secretPath := ref
	field := ""
	if idx := strings.IndexByte(ref, '#'); idx >= 0 {
		secretPath = ref[:idx]
		field = ref[idx+1:]
	}

	url := fmt.Sprintf("%s/v1/%s", p.addr, secretPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating vault request: %w", err)
	}
	req.Header.Set("X-Vault-Token", p.token)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vault request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("vault returned %d: %s", resp.StatusCode, string(body))
	}

	var vaultResp struct {
		Data struct {
			Data map[string]interface{} `json:"data"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&vaultResp); err != nil {
		return nil, fmt.Errorf("decoding vault response: %w", err)
	}

	result := make(map[string]string)
	if field != "" {
		// Return only the requested field
		if val, ok := vaultResp.Data.Data[field]; ok {
			result[field] = fmt.Sprintf("%v", val)
		} else {
			return nil, fmt.Errorf("field %q not found in vault secret", field)
		}
	} else {
		// Return all fields
		for k, v := range vaultResp.Data.Data {
			result[k] = fmt.Sprintf("%v", v)
		}
	}

	return result, nil
}
