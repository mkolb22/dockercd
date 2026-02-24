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

// AWSSecretsManagerProvider retrieves secrets from AWS Secrets Manager.
// This is a simplified implementation using the REST API. It relies on IAM
// credentials from the environment (e.g., ECS task role, EC2 instance role,
// or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables).
// For production use with full SigV4 signing, consider using the aws-sdk-go-v2.
type AWSSecretsManagerProvider struct {
	region   string
	endpoint string // Optional custom endpoint (for LocalStack, etc.)
	client   *http.Client
}

// NewAWSSecretsManager creates an AWSSecretsManagerProvider.
// If endpoint is empty, the standard AWS endpoint for the region is used.
func NewAWSSecretsManager(region, endpoint string) *AWSSecretsManagerProvider {
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://secretsmanager.%s.amazonaws.com", region)
	}
	return &AWSSecretsManagerProvider{
		region:   region,
		endpoint: strings.TrimRight(endpoint, "/"),
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CanHandle returns true for awssm: prefixed references.
func (p *AWSSecretsManagerProvider) CanHandle(path string) bool {
	return strings.HasPrefix(path, "awssm:")
}

// Decrypt resolves an AWS Secrets Manager reference.
// Format: awssm:my-secret-name#field
// The optional #field suffix selects a specific key from a JSON secret.
// If the secret is a plain string (not JSON), it is returned under the secret name as the key.
func (p *AWSSecretsManagerProvider) Decrypt(ctx context.Context, ref string) (map[string]string, error) {
	ref = strings.TrimPrefix(ref, "awssm:")
	secretName := ref
	field := ""
	if idx := strings.IndexByte(ref, '#'); idx >= 0 {
		secretName = ref[:idx]
		field = ref[idx+1:]
	}

	// Construct GetSecretValue request
	url := p.endpoint
	body := fmt.Sprintf(`{"SecretId":"%s"}`, secretName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating aws request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Target", "secretsmanager.GetSecretValue")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("aws request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16)) // 64 KiB max error body
		return nil, fmt.Errorf("aws returned %d: %s", resp.StatusCode, string(respBody))
	}

	var awsResp struct {
		SecretString string `json:"SecretString"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&awsResp); err != nil {
		return nil, fmt.Errorf("decoding aws response: %w", err)
	}

	result := make(map[string]string)

	// Try to parse SecretString as JSON key-value pairs
	var secretData map[string]interface{}
	if err := json.Unmarshal([]byte(awsResp.SecretString), &secretData); err == nil {
		if field != "" {
			if val, ok := secretData[field]; ok {
				result[field] = fmt.Sprintf("%v", val)
			} else {
				return nil, fmt.Errorf("field %q not found in aws secret", field)
			}
		} else {
			for k, v := range secretData {
				result[k] = fmt.Sprintf("%v", v)
			}
		}
	} else {
		// Plain string secret — return under the secret name as key
		result[secretName] = awsResp.SecretString
	}

	return result, nil
}
