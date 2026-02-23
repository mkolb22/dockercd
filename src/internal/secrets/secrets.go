// Package secrets provides decryption of encrypted env files for Docker Compose deployments.
package secrets

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"filippo.io/age"
)

// Provider decrypts encrypted files and returns key-value pairs.
type Provider interface {
	// Decrypt reads an encrypted file and returns the decrypted key-value pairs.
	Decrypt(ctx context.Context, path string) (map[string]string, error)

	// CanHandle returns true if this provider can decrypt the given file.
	CanHandle(path string) bool
}

// AgeProvider decrypts files encrypted with age (https://age-encryption.org).
type AgeProvider struct {
	identities []age.Identity
}

// NewAge creates an AgeProvider from a key file path.
// The key file contains age secret keys, one per line (e.g., AGE-SECRET-KEY-1...).
func NewAge(keyFilePath string) (*AgeProvider, error) {
	f, err := os.Open(keyFilePath)
	if err != nil {
		return nil, fmt.Errorf("opening age key file: %w", err)
	}
	defer f.Close()

	identities, err := age.ParseIdentities(f)
	if err != nil {
		return nil, fmt.Errorf("parsing age identities: %w", err)
	}

	return &AgeProvider{identities: identities}, nil
}

// CanHandle returns true for .age and .enc files.
func (p *AgeProvider) CanHandle(path string) bool {
	ext := filepath.Ext(path)
	return ext == ".age" || ext == ".enc"
}

// Decrypt reads an age-encrypted file and returns decrypted key-value pairs.
// The decrypted content is expected to be in .env format (KEY=value, one per line).
func (p *AgeProvider) Decrypt(_ context.Context, path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening encrypted file: %w", err)
	}
	defer f.Close()

	reader, err := age.Decrypt(f, p.identities...)
	if err != nil {
		return nil, fmt.Errorf("decrypting file: %w", err)
	}

	decrypted, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("reading decrypted content: %w", err)
	}

	return parseEnvContent(decrypted), nil
}

// parseEnvContent parses KEY=value lines from decrypted content.
func parseEnvContent(data []byte) map[string]string {
	result := make(map[string]string)
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.IndexByte(line, '=')
		if idx < 0 {
			continue
		}
		key := line[:idx]
		value := line[idx+1:]
		// Strip surrounding quotes if present
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		result[key] = value
	}
	return result
}
