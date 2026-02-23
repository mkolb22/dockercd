// Package api provides the REST API server for dockercd.
package api

import "github.com/mkolb22/dockercd/internal/app"

// ApplicationResponse is the API representation of an application.
type ApplicationResponse struct {
	Metadata app.AppMetadata `json:"metadata"`
	Spec     app.AppSpec     `json:"spec"`
	Status   AppStatusResponse `json:"status"`
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
	Name         string             `json:"name"`
	URL          string             `json:"url"`
	TLSCertPath  string             `json:"tlsCertPath,omitempty"`
	TLSVerify    bool               `json:"tlsVerify"`
	HealthStatus string             `json:"healthStatus"`
	LastCheck    string             `json:"lastCheck,omitempty"`
	LastError    string             `json:"lastError,omitempty"`
	Info         *app.DockerHostInfo `json:"info,omitempty"`
	Stats        *app.HostStats     `json:"stats,omitempty"`
	CreatedAt    string             `json:"createdAt"`
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
	CodeNotFound      = "NOT_FOUND"
	CodeBadRequest    = "BAD_REQUEST"
	CodeInternalError = "INTERNAL_ERROR"
	CodeConflict      = "CONFLICT"
	CodeUnavailable   = "UNAVAILABLE"
)
