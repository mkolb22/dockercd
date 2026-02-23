package secrets

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVaultProvider_CanHandle(t *testing.T) {
	p := NewVault("http://localhost:8200", "test-token")

	if !p.CanHandle("vault:secret/data/myapp") {
		t.Error("expected CanHandle=true for vault: prefix")
	}
	if p.CanHandle("awssm:my-secret") {
		t.Error("expected CanHandle=false for awssm: prefix")
	}
	if p.CanHandle(".env.age") {
		t.Error("expected CanHandle=false for .env.age")
	}
}

func TestVaultProvider_Decrypt(t *testing.T) {
	// Create mock Vault server
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Vault-Token") != "test-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"data": map[string]interface{}{
				"data": map[string]interface{}{
					"password": "secret123",
					"username": "admin",
				},
			},
		})
	}))
	defer srv.Close()

	p := NewVault(srv.URL, "test-token")

	// Test getting all fields
	result, err := p.Decrypt(context.Background(), "vault:secret/data/myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["password"] != "secret123" {
		t.Errorf("password = %q, want %q", result["password"], "secret123")
	}
	if result["username"] != "admin" {
		t.Errorf("username = %q, want %q", result["username"], "admin")
	}

	// Test getting a specific field
	result, err = p.Decrypt(context.Background(), "vault:secret/data/myapp#password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["password"] != "secret123" {
		t.Errorf("password = %q, want %q", result["password"], "secret123")
	}
	if _, ok := result["username"]; ok {
		t.Error("should only contain the requested field")
	}
}

func TestVaultProvider_Decrypt_MissingField(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"data": map[string]interface{}{
				"data": map[string]interface{}{
					"password": "secret123",
				},
			},
		})
	}))
	defer srv.Close()

	p := NewVault(srv.URL, "test-token")

	_, err := p.Decrypt(context.Background(), "vault:secret/data/myapp#nonexistent")
	if err == nil {
		t.Error("expected error for missing field")
	}
}

func TestVaultProvider_Decrypt_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("permission denied")) //nolint:errcheck
	}))
	defer srv.Close()

	p := NewVault(srv.URL, "bad-token")

	_, err := p.Decrypt(context.Background(), "vault:secret/data/myapp")
	if err == nil {
		t.Error("expected error for HTTP 403")
	}
}

func TestMultiProvider_DelegatesToCorrectProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"data": map[string]interface{}{
				"data": map[string]interface{}{"key": "value"},
			},
		})
	}))
	defer srv.Close()

	vault := NewVault(srv.URL, "token")
	multi := NewMulti(vault)

	if !multi.CanHandle("vault:secret/data/app") {
		t.Error("expected multi to handle vault: refs")
	}
	if multi.CanHandle(".env.age") {
		t.Error("expected multi not to handle .env.age without age provider")
	}

	result, err := multi.Decrypt(context.Background(), "vault:secret/data/app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["key"] != "value" {
		t.Errorf("key = %q, want %q", result["key"], "value")
	}
}

func TestMultiProvider_NoHandlerError(t *testing.T) {
	multi := NewMulti()

	_, err := multi.Decrypt(context.Background(), "vault:secret/data/app")
	if err == nil {
		t.Error("expected error when no provider can handle reference")
	}
}

func TestAWSSecretsManagerProvider_CanHandle(t *testing.T) {
	p := NewAWSSecretsManager("us-east-1", "")

	if !p.CanHandle("awssm:my-secret") {
		t.Error("expected CanHandle=true for awssm: prefix")
	}
	if p.CanHandle("vault:secret/data/app") {
		t.Error("expected CanHandle=false for vault: prefix")
	}
	if p.CanHandle(".env.age") {
		t.Error("expected CanHandle=false for .env.age")
	}
}
