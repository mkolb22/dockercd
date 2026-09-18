// Package controlplane is the Web presentation's narrow, typed client for the
// capability-scoped controller surface. It never calls legacy administrator
// endpoints and intentionally has no browser-session implementation.
package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var applicationName = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

const (
	defaultRequestTimeout = 5 * time.Second
	maxResponseBody       = 1 << 20
)

var (
	ErrUnauthorized       = errors.New("presentation credential rejected")
	ErrForbidden          = errors.New("presentation permission denied")
	ErrNotFound           = errors.New("presentation resource not found")
	ErrFeatureUnavailable = errors.New("presentation feature unavailable")
)

// TokenSource supplies a short-lived, server-side scoped credential. Browser
// pages never receive it. A future session-to-subject exchange will implement
// this interface per user request.
type TokenSource interface {
	PresentationToken(context.Context) (string, error)
}

// ClientConfig intentionally accepts only an injected HTTP transport and token
// source. It has no environment parsing, no insecure TLS option, and no
// fallback to a controller administrator credential.
type ClientConfig struct {
	BaseURL        string
	HTTPClient     *http.Client
	TokenSource    TokenSource
	RequestTimeout time.Duration
}

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
	tokens     TokenSource
	timeout    time.Duration
}

func NewClient(config ClientConfig) (*Client, error) {
	endpoint, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("invalid controller URL")
	}
	if endpoint.Scheme != "https" && endpoint.Scheme != "http" {
		return nil, fmt.Errorf("controller URL must use http or https")
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, fmt.Errorf("controller URL must not include credentials, query, or fragment")
	}
	if config.TokenSource == nil {
		return nil, fmt.Errorf("presentation token source is required")
	}
	client := http.DefaultClient
	if config.HTTPClient != nil {
		client = config.HTTPClient
	}
	// Never forward a scoped bearer to a redirect target. Presentation routes
	// are stable; a redirect is a compatibility failure, not a recovery path.
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	timeout := config.RequestTimeout
	if timeout == 0 {
		timeout = defaultRequestTimeout
	}
	if timeout <= 0 || timeout > 30*time.Second {
		return nil, fmt.Errorf("controller request timeout must be between 1ns and 30s")
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/")
	return &Client{baseURL: endpoint, httpClient: &clientCopy, tokens: config.TokenSource, timeout: timeout}, nil
}

// Capabilities is the required scoped compatibility handshake. A Web adapter
// must reject unsupported controllers rather than falling back to legacy API.
func (c *Client) Capabilities(ctx context.Context) (Capabilities, error) {
	var response Capabilities
	if err := c.get(ctx, "/api/v1/presentation/capabilities", &response); err != nil {
		return Capabilities{}, err
	}
	if response.APIVersion != "v1" {
		return Capabilities{}, ErrFeatureUnavailable
	}
	return response, nil
}

func (c *Client) Permissions(ctx context.Context) (Permissions, error) {
	var response Permissions
	if err := c.get(ctx, "/api/v1/presentation/permissions", &response); err != nil {
		return Permissions{}, err
	}
	return response, nil
}

func (c *Client) Fleet(ctx context.Context) (Fleet, error) {
	var response Fleet
	if err := c.get(ctx, "/api/v1/presentation/fleet", &response); err != nil {
		return Fleet{}, err
	}
	return response, nil
}

func (c *Client) Controller(ctx context.Context) (Controller, error) {
	var response Controller
	err := c.get(ctx, "/api/v1/presentation/controller", &response)
	return response, err
}
func (c *Client) Capacity(ctx context.Context) (Capacity, error) {
	var response Capacity
	err := c.get(ctx, "/api/v1/presentation/capacity", &response)
	return response, err
}

func (c *Client) Activity(ctx context.Context, limit int) (Activity, error) {
	if limit < 1 || limit > 100 {
		return Activity{}, ErrFeatureUnavailable
	}
	var response Activity
	if err := c.getWithQuery(ctx, "/api/v1/presentation/activity", url.Values{"limit": []string{strconv.Itoa(limit)}}, &response); err != nil {
		return Activity{}, err
	}
	return response, nil
}

func (c *Client) Application(ctx context.Context, name string) (Application, error) {
	name = strings.TrimSpace(name)
	if !applicationName.MatchString(name) {
		return Application{}, ErrNotFound
	}
	var response Application
	if err := c.get(ctx, "/api/v1/presentation/applications/"+name, &response); err != nil {
		return Application{}, err
	}
	return response, nil
}

func (c *Client) get(ctx context.Context, path string, destination any) error {
	return c.getWithQuery(ctx, path, nil, destination)
}

func (c *Client) getWithQuery(ctx context.Context, path string, query url.Values, destination any) error {
	if c == nil || c.baseURL == nil || c.httpClient == nil || c.tokens == nil {
		return ErrFeatureUnavailable
	}
	requestContext, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	token, err := c.tokens.PresentationToken(requestContext)
	if err != nil {
		return fmt.Errorf("obtaining presentation credential: %w", err)
	}
	if strings.TrimSpace(token) == "" {
		return ErrUnauthorized
	}
	endpoint := *c.baseURL
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + path
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return fmt.Errorf("building controller request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("requesting controller: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return presentationStatusError(response.StatusCode)
	}
	if !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "application/json") {
		return fmt.Errorf("controller returned unexpected content type")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBody+1))
	if err != nil {
		return fmt.Errorf("reading controller response: %w", err)
	}
	if len(body) > maxResponseBody {
		return fmt.Errorf("controller response exceeds %d bytes", maxResponseBody)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("decoding controller response: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("controller returned multiple JSON documents")
		}
		return fmt.Errorf("reading controller response: %w", err)
	}
	return nil
}

func presentationStatusError(status int) error {
	switch status {
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbidden
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusTooManyRequests, http.StatusNotImplemented:
		return ErrFeatureUnavailable
	default:
		return fmt.Errorf("controller request failed with status %d", status)
	}
}

type Capabilities struct {
	APIVersion string   `json:"apiVersion"`
	ServerTime string   `json:"serverTime"`
	Features   []string `json:"features"`
	ExpiresAt  string   `json:"expiresAt"`
	Limits     Limits   `json:"limits"`
}

type Limits struct {
	MaxApplications int `json:"maxApplications"`
}

type Permissions struct {
	Subject      string   `json:"subject"`
	CredentialID string   `json:"credentialId"`
	Audience     string   `json:"audience"`
	ExpiresAt    string   `json:"expiresAt"`
	Capabilities []string `json:"capabilities"`
	Applications []string `json:"applications"`
}

type Controller struct {
	StateDatabaseReady  bool   `json:"stateDatabaseReady"`
	ResponseGeneratedAt string `json:"responseGeneratedAt"`
}
type Capacity struct {
	CPUPercent          float64 `json:"cpuPercent"`
	CPUCores            int     `json:"cpuCores"`
	MemoryUsageMiB      float64 `json:"memoryUsageMiB"`
	MemoryTotalMiB      float64 `json:"memoryTotalMiB"`
	RunningContainers   int     `json:"runningContainers"`
	EligibleContainers  int     `json:"eligibleContainers"`
	ObservedContainers  int     `json:"observedContainers"`
	Completeness        string  `json:"completeness"`
	SampleStartedAt     string  `json:"sampleStartedAt"`
	SampleCompletedAt   string  `json:"sampleCompletedAt"`
	ResponseGeneratedAt string  `json:"responseGeneratedAt"`
}

type Fleet struct {
	Applications        []Application `json:"applications"`
	Total               int           `json:"total"`
	ResponseGeneratedAt string        `json:"responseGeneratedAt"`
}

type Activity struct {
	Events              []ActivityEvent `json:"events"`
	Total               int             `json:"total"`
	ResponseGeneratedAt string          `json:"responseGeneratedAt"`
}

type ActivityEvent struct {
	Application string `json:"application"`
	Type        string `json:"type"`
	Severity    string `json:"severity"`
	OccurredAt  string `json:"occurredAt"`
}

// Application is the complete redacted application status representation
// available to the first Web client tranche.
type Application struct {
	Name                    string `json:"name"`
	SyncStatus              string `json:"syncStatus"`
	HealthStatus            string `json:"healthStatus"`
	LastSyncedSHA           string `json:"lastSyncedSHA"`
	HeadSHA                 string `json:"headSHA"`
	LastSyncTime            string `json:"lastSyncTime"`
	LastObservedAt          string `json:"lastObservedAt"`
	ObservedHealthStatus    string `json:"observedHealthStatus"`
	ObservationCompleteness string `json:"observationCompleteness"`
	ResponseGeneratedAt     string `json:"responseGeneratedAt,omitempty"`
}
