package secrets

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"filippo.io/age"
)

func TestAgeProvider_CanHandle(t *testing.T) {
	p := &AgeProvider{}

	tests := []struct {
		path string
		want bool
	}{
		{".env.age", true},
		{".env.enc", true},
		{".env", false},
		{"config.yaml", false},
		{"secrets.age", true},
	}

	for _, tt := range tests {
		if got := p.CanHandle(tt.path); got != tt.want {
			t.Errorf("CanHandle(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestAgeProvider_DecryptRoundTrip(t *testing.T) {
	// Generate a test key pair
	identity, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatalf("generating identity: %v", err)
	}
	recipient := identity.Recipient()

	// Create test .env content
	envContent := "DB_HOST=localhost\nDB_PORT=5432\nSECRET_KEY=super-secret-value\n"

	// Encrypt the content
	var encrypted bytes.Buffer
	w, err := age.Encrypt(&encrypted, recipient)
	if err != nil {
		t.Fatalf("creating encryptor: %v", err)
	}
	if _, err := io.WriteString(w, envContent); err != nil {
		t.Fatalf("writing plaintext: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("closing encryptor: %v", err)
	}

	// Write key file
	tmpDir := t.TempDir()
	keyFile := filepath.Join(tmpDir, "key.txt")
	if err := os.WriteFile(keyFile, []byte(identity.String()+"\n"), 0600); err != nil {
		t.Fatalf("writing key file: %v", err)
	}

	// Write encrypted file
	encFile := filepath.Join(tmpDir, ".env.age")
	if err := os.WriteFile(encFile, encrypted.Bytes(), 0644); err != nil {
		t.Fatalf("writing encrypted file: %v", err)
	}

	// Decrypt
	p, err := NewAge(keyFile)
	if err != nil {
		t.Fatalf("creating provider: %v", err)
	}

	result, err := p.Decrypt(context.Background(), encFile)
	if err != nil {
		t.Fatalf("decrypting: %v", err)
	}

	if result["DB_HOST"] != "localhost" {
		t.Errorf("DB_HOST = %q, want %q", result["DB_HOST"], "localhost")
	}
	if result["DB_PORT"] != "5432" {
		t.Errorf("DB_PORT = %q, want %q", result["DB_PORT"], "5432")
	}
	if result["SECRET_KEY"] != "super-secret-value" {
		t.Errorf("SECRET_KEY = %q, want %q", result["SECRET_KEY"], "super-secret-value")
	}
}

func TestParseEnvContent(t *testing.T) {
	content := []byte(`
# Comment line
DB_HOST=localhost
DB_PORT=5432
QUOTED="hello world"
SINGLE='test value'
EMPTY=

# Another comment
API_KEY=abc123
`)

	result := parseEnvContent(content)

	tests := map[string]string{
		"DB_HOST": "localhost",
		"DB_PORT": "5432",
		"QUOTED":  "hello world",
		"SINGLE":  "test value",
		"EMPTY":   "",
		"API_KEY": "abc123",
	}

	for k, want := range tests {
		if got := result[k]; got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}

	if len(result) != len(tests) {
		t.Errorf("got %d keys, want %d", len(result), len(tests))
	}
}
