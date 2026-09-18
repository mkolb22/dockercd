// Package api provides the REST API server for dockercd.
package api

import (
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/store"
)

// ApplicationResponse is the API representation of an application.
type ApplicationResponse struct {
	Metadata      app.AppMetadata    `json:"metadata"`
	Spec          app.AppSpec        `json:"spec"`
	Status        AppStatusResponse  `json:"status"`
	RecentHistory []store.SyncRecord `json:"recentHistory,omitempty"`
}

// AppStatusResponse is the API representation of application status.
type AppStatusResponse struct {
	SyncStatus    string              `json:"syncStatus"`
	HealthStatus  string              `json:"healthStatus"`
	LastSyncedSHA string              `json:"lastSyncedSHA,omitempty"`
	HeadSHA       string              `json:"headSHA,omitempty"`
	LastSyncTime  string              `json:"lastSyncTime,omitempty"`
	LastError     string              `json:"lastError,omitempty"`
	Services      []app.ServiceStatus `json:"services,omitempty"`
}

// ListResponse wraps a list of items with a total count.
type ListResponse[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}

// ErrorResponse is the standard error response.
type ErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// HealthResponse is the response for /healthz.
type HealthResponse struct {
	Status string `json:"status"`
}

// CapabilitiesResponse describes the stable API surface understood by a client.
// It permits native clients to feature-detect newer controllers without relying
// on their container image tag or browser assets.
type CapabilitiesResponse struct {
	APIVersion string   `json:"apiVersion"`
	Features   []string `json:"features"`
}

// PresentationPermissionsResponse contains verified scoped grants, never the
// credential or a mutable authorization decision supplied by the client.
type PresentationPermissionsResponse struct {
	Subject      string   `json:"subject"`
	CredentialID string   `json:"credentialId"`
	Audience     string   `json:"audience"`
	ExpiresAt    string   `json:"expiresAt"`
	Capabilities []string `json:"capabilities"`
	Applications []string `json:"applications"`
}

// PresentationCapabilitiesResponse lets an unprivileged presentation client
// preflight only the separately scoped API surface and its effective bounds.
type PresentationCapabilitiesResponse struct {
	APIVersion string             `json:"apiVersion"`
	ServerTime string             `json:"serverTime"`
	Features   []string           `json:"features"`
	ExpiresAt  string             `json:"expiresAt"`
	Limits     PresentationLimits `json:"limits"`
}

type PresentationLimits struct {
	MaxApplications int `json:"maxApplications"`
}

// PresentationFleetResponse is intentionally less detailed than the legacy
// application collection: it contains only bounded operational summary data.
type PresentationFleetResponse struct {
	Applications        []PresentationApplicationSummary `json:"applications"`
	Total               int                              `json:"total"`
	ResponseGeneratedAt string                           `json:"responseGeneratedAt"`
}

type PresentationApplicationSummary struct {
	Name                 string `json:"name"`
	SyncStatus           string `json:"syncStatus"`
	HealthStatus         string `json:"healthStatus"`
	LastSyncedSHA        string `json:"lastSyncedSHA,omitempty"`
	HeadSHA              string `json:"headSHA,omitempty"`
	LastSyncTime         string `json:"lastSyncTime,omitempty"`
	LastObservedAt       string `json:"lastObservedAt,omitempty"`
	ObservedHealthStatus string `json:"observedHealthStatus,omitempty"`
	// ObservationCompleteness describes whether observed health and its time
	// are one persisted pair, distinct from desired Git state.
	ObservationCompleteness string `json:"observationCompleteness"`
}

// PresentationApplicationResponse is a purpose-built, redacted application
// status DTO. It excludes manifest, source, service topology, conditions,
// history, and error text because those values can disclose sensitive details.
type PresentationApplicationResponse struct {
	Name                    string `json:"name"`
	SyncStatus              string `json:"syncStatus"`
	HealthStatus            string `json:"healthStatus"`
	LastSyncedSHA           string `json:"lastSyncedSHA,omitempty"`
	HeadSHA                 string `json:"headSHA,omitempty"`
	LastSyncTime            string `json:"lastSyncTime,omitempty"`
	LastObservedAt          string `json:"lastObservedAt,omitempty"`
	ObservedHealthStatus    string `json:"observedHealthStatus,omitempty"`
	ObservationCompleteness string `json:"observationCompleteness"`
	ResponseGeneratedAt     string `json:"responseGeneratedAt"`
}

// PresentationActivityResponse deliberately carries only a redacted event
// index. Details require a later capability-scoped evidence contract.
type PresentationActivityResponse struct {
	Events              []PresentationActivityEvent `json:"events"`
	Total               int                         `json:"total"`
	ResponseGeneratedAt string                      `json:"responseGeneratedAt"`
}

type PresentationActivityEvent struct {
	Application string `json:"application"`
	Type        string `json:"type"`
	Severity    string `json:"severity"`
	OccurredAt  string `json:"occurredAt"`
}

type PresentationControllerResponse struct {
	StateDatabaseReady  bool   `json:"stateDatabaseReady"`
	ResponseGeneratedAt string `json:"responseGeneratedAt"`
}

type PresentationCapacityResponse struct {
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

// ReadyResponse is the response for /readyz.
type ReadyResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// SystemInfoResponse is the response for GET /system.
type SystemInfoResponse struct {
	Host *app.DockerHostInfo `json:"host"`
}

// HostStatsResponse is the response for GET /system/stats.
type HostStatsResponse struct {
	Stats *app.HostStats `json:"stats"`
}

// PollIntervalRequest is the request for PUT /settings/poll-interval.
type PollIntervalRequest struct {
	IntervalMs int64 `json:"intervalMs"`
}

// PollIntervalResponse is the response for GET/PUT /settings/poll-interval.
type PollIntervalResponse struct {
	IntervalMs int64 `json:"intervalMs"`
}

// DryRunResponse is the response for a dry-run sync request.
type DryRunResponse struct {
	Diff    *app.DiffResult `json:"diff"`
	HeadSHA string          `json:"headSHA"`
}

// RenderedDesiredResponse is the response for the rendered desired-state endpoint.
type RenderedDesiredResponse struct {
	AppName string           `json:"appName"`
	HeadSHA string           `json:"headSHA"`
	Compose *app.ComposeSpec `json:"compose"`
}

// WebhookResponse is the response for POST /api/v1/webhooks/git.
type WebhookResponse struct {
	Message   string `json:"message"`
	Triggered int    `json:"triggered"`
}

// RollbackRequest is the request body for POST /api/v1/applications/{name}/rollback.
type RollbackRequest struct {
	TargetSHA string `json:"targetSHA"`
}

// DockerHostResponse is the API representation of a Docker host.
type DockerHostResponse struct {
	Name         string              `json:"name"`
	URL          string              `json:"url"`
	TLSCertPath  string              `json:"tlsCertPath,omitempty"`
	TLSVerify    bool                `json:"tlsVerify"`
	HealthStatus string              `json:"healthStatus"`
	LastCheck    string              `json:"lastCheck,omitempty"`
	LastError    string              `json:"lastError,omitempty"`
	Info         *app.DockerHostInfo `json:"info,omitempty"`
	Stats        *app.HostStats      `json:"stats,omitempty"`
	CreatedAt    string              `json:"createdAt"`
}

// CreateHostRequest is the request body for POST /api/v1/hosts.
type CreateHostRequest struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	TLSCertPath string `json:"tlsCertPath,omitempty"`
	TLSVerify   *bool  `json:"tlsVerify,omitempty"`
}

// Error codes.
const (
	CodeNotFound        = "NOT_FOUND"
	CodeBadRequest      = "BAD_REQUEST"
	CodeInternalError   = "INTERNAL_ERROR"
	CodeConflict        = "CONFLICT"
	CodeUnavailable     = "UNAVAILABLE"
	CodeForbidden       = "FORBIDDEN"
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeTooManyRequests = "TOO_MANY_REQUESTS"
)
