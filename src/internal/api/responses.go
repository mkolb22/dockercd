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

// Error codes.
const (
	CodeNotFound      = "NOT_FOUND"
	CodeBadRequest    = "BAD_REQUEST"
	CodeInternalError = "INTERNAL_ERROR"
	CodeConflict      = "CONFLICT"
	CodeUnavailable   = "UNAVAILABLE"
)
