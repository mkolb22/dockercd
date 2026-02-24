package store

import "time"

// ApplicationRecord is the database representation of an application.
type ApplicationRecord struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Manifest       string     `json:"manifest"`
	SyncStatus     string     `json:"syncStatus"`
	HealthStatus   string     `json:"healthStatus"`
	LastSyncedSHA  string     `json:"lastSyncedSHA,omitempty"`
	HeadSHA        string     `json:"headSHA,omitempty"`
	LastSyncTime   *time.Time `json:"lastSyncTime,omitempty"`
	LastError      string     `json:"lastError,omitempty"`
	ServicesJSON   string     `json:"servicesJson,omitempty"`
	ConditionsJSON string     `json:"conditionsJson,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// StatusUpdate holds fields to update on an application's status.
// Only non-zero/non-empty fields are applied. Pointer fields use nil
// to mean "don't update" and a non-nil value to set (including empty string to clear).
type StatusUpdate struct {
	SyncStatus     string
	HealthStatus   string
	LastSyncedSHA  string
	HeadSHA        string
	LastSyncTime   *time.Time
	LastError      *string
	ServicesJSON   string
	ConditionsJSON string
}

// StringPtr returns a pointer to s. Used for StatusUpdate pointer fields.
func StringPtr(s string) *string { return &s }

// SyncRecord is the database representation of a sync attempt.
type SyncRecord struct {
	ID              string     `json:"id"`
	AppName         string     `json:"appName"`
	StartedAt       time.Time  `json:"startedAt"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	CommitSHA       string     `json:"commitSHA,omitempty"`
	Operation       string     `json:"operation"`
	Result          string     `json:"result"`
	DiffJSON        string     `json:"diffJson,omitempty"`
	ComposeSpecJSON string     `json:"composeSpecJson,omitempty"`
	Error           string     `json:"error,omitempty"`
	DurationMs      int64      `json:"durationMs,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
}

// EventRecord is the database representation of an application event.
type EventRecord struct {
	ID        string    `json:"id"`
	AppName   string    `json:"appName"`
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	Severity  string    `json:"severity"`
	DataJSON  string    `json:"dataJson,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// DockerHostRecord is the database representation of a registered Docker host.
type DockerHostRecord struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	URL          string     `json:"url"`
	TLSCertPath  string     `json:"tlsCertPath,omitempty"`
	TLSVerify    bool       `json:"tlsVerify"`
	HealthStatus string     `json:"healthStatus"`
	LastCheck    *time.Time `json:"lastCheck,omitempty"`
	LastError    string     `json:"lastError,omitempty"`
	InfoJSON     string     `json:"infoJson,omitempty"`
	StatsJSON    string     `json:"statsJson,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

// HostStatusUpdate holds fields to update on a Docker host's status.
type HostStatusUpdate struct {
	HealthStatus string
	LastCheck    *time.Time
	LastError    *string
	InfoJSON     string
	StatsJSON    string
}
