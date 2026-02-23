// Package app defines the core domain types for dockercd.
// All types in this package are pure data — no I/O, no side effects.
package app

import "time"

// Application represents a managed Docker Compose deployment.
// It is the equivalent of an ArgoCD Application CRD.
type Application struct {
	APIVersion string      `yaml:"apiVersion" json:"apiVersion"`
	Kind       string      `yaml:"kind" json:"kind"`
	Metadata   AppMetadata `yaml:"metadata" json:"metadata"`
	Spec       AppSpec     `yaml:"spec" json:"spec"`
	Status     AppStatus   `yaml:"-" json:"status"`
}

type AppMetadata struct {
	Name string `yaml:"name" json:"name"`
}

type AppSpec struct {
	Source      SourceSpec      `yaml:"source" json:"source"`
	Destination DestinationSpec `yaml:"destination" json:"destination"`
	SyncPolicy  SyncPolicy      `yaml:"syncPolicy" json:"syncPolicy"`
}

type SourceSpec struct {
	RepoURL        string   `yaml:"repoURL" json:"repoURL"`
	TargetRevision string   `yaml:"targetRevision" json:"targetRevision"`
	Path           string   `yaml:"path" json:"path"`
	ComposeFiles   []string `yaml:"composeFiles" json:"composeFiles"`
}

type DestinationSpec struct {
	DockerHost  string `yaml:"dockerHost" json:"dockerHost"`
	ProjectName string `yaml:"projectName" json:"projectName"`
}

type SyncPolicy struct {
	Automated     bool     `yaml:"automated" json:"automated"`
	Prune         bool     `yaml:"prune" json:"prune"`
	SelfHeal      bool     `yaml:"selfHeal" json:"selfHeal"`
	PollInterval  Duration `yaml:"pollInterval" json:"pollInterval"`
	SyncTimeout   Duration `yaml:"syncTimeout" json:"syncTimeout"`
	HealthTimeout Duration `yaml:"healthTimeout" json:"healthTimeout"`
}

// SyncStatus represents the synchronization state of an application.
type SyncStatus string

const (
	SyncStatusSynced    SyncStatus = "Synced"
	SyncStatusOutOfSync SyncStatus = "OutOfSync"
	SyncStatusUnknown   SyncStatus = "Unknown"
	SyncStatusError     SyncStatus = "Error"
)

// HealthStatus represents the health of an application or service.
type HealthStatus string

const (
	HealthStatusHealthy     HealthStatus = "Healthy"
	HealthStatusProgressing HealthStatus = "Progressing"
	HealthStatusDegraded    HealthStatus = "Degraded"
	HealthStatusUnknown     HealthStatus = "Unknown"
)

// Severity returns a numeric severity for comparison. Higher = worse.
func (h HealthStatus) Severity() int {
	switch h {
	case HealthStatusHealthy:
		return 0
	case HealthStatusProgressing:
		return 1
	case HealthStatusDegraded:
		return 2
	case HealthStatusUnknown:
		return 3
	default:
		return 3
	}
}

// WorstHealth returns the more severe of two health statuses.
func WorstHealth(a, b HealthStatus) HealthStatus {
	if a.Severity() >= b.Severity() {
		return a
	}
	return b
}

// AppStatus is the observed runtime state of an application.
type AppStatus struct {
	SyncStatus     SyncStatus     `json:"syncStatus"`
	HealthStatus   HealthStatus   `json:"healthStatus"`
	LastSyncedSHA  string         `json:"lastSyncedSHA,omitempty"`
	LastSyncTime   *time.Time     `json:"lastSyncTime,omitempty"`
	LastSyncResult *SyncResult    `json:"lastSyncResult,omitempty"`
	HeadSHA        string         `json:"headSHA,omitempty"`
	Conditions     []AppCondition `json:"conditions,omitempty"`
	Services       []ServiceStatus `json:"services,omitempty"`
	Message        string         `json:"message,omitempty"`
}

// SyncResult records the outcome of a sync operation.
type SyncResult struct {
	ID              string           `json:"id"`
	AppName         string           `json:"appName"`
	StartedAt       time.Time        `json:"startedAt"`
	FinishedAt      time.Time        `json:"finishedAt"`
	CommitSHA       string           `json:"commitSHA"`
	Operation       SyncOperation    `json:"operation"`
	Result          SyncResultStatus `json:"result"`
	Diff            *DiffResult      `json:"diff,omitempty"`
	Error           string           `json:"error,omitempty"`
	DurationMs      int64            `json:"durationMs"`
	ComposeSpecJSON string           `json:"-"` // internal use only — not serialized to API responses
}

type SyncOperation string

const (
	SyncOperationPoll     SyncOperation = "poll"
	SyncOperationManual   SyncOperation = "manual"
	SyncOperationSelfHeal SyncOperation = "self-heal"
	SyncOperationRollback SyncOperation = "rollback"
	SyncOperationAdopt    SyncOperation = "adopt"
)

type SyncResultStatus string

const (
	SyncResultSuccess SyncResultStatus = "success"
	SyncResultFailure SyncResultStatus = "failure"
	SyncResultSkipped SyncResultStatus = "skipped"
)

// AppCondition represents a notable event or state on an application.
type AppCondition struct {
	Type               ConditionType `json:"type"`
	Status             string        `json:"status"`
	Message            string        `json:"message"`
	LastTransitionTime time.Time     `json:"lastTransitionTime"`
}

type ConditionType string

const (
	ConditionSyncError   ConditionType = "SyncError"
	ConditionHealthCheck ConditionType = "HealthCheck"
	ConditionGitError    ConditionType = "GitError"
	ConditionParseError  ConditionType = "ParseError"
	ConditionDeployError ConditionType = "DeployError"
	ConditionSelfHealed  ConditionType = "SelfHealed"
)

// ServiceState represents the live state of a single Docker Compose service.
type ServiceState struct {
	Name          string            `json:"name"`
	Image         string            `json:"image"`
	ContainerName string            `json:"containerName,omitempty"`
	Status        string            `json:"status,omitempty"`
	Health        HealthStatus      `json:"health"`
	Environment   map[string]string `json:"environment,omitempty"`
	Ports         []PortMapping     `json:"ports,omitempty"`
	Volumes       []VolumeMount     `json:"volumes,omitempty"`
	Networks      []string          `json:"networks,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	RestartPolicy string            `json:"restartPolicy,omitempty"`
	Command       []string          `json:"command,omitempty"`
	Entrypoint    []string          `json:"entrypoint,omitempty"`
}

type PortMapping struct {
	HostPort      string `json:"hostPort"`
	ContainerPort string `json:"containerPort"`
	Protocol      string `json:"protocol"`
}

type VolumeMount struct {
	Source   string `json:"source"`
	Target  string `json:"target"`
	ReadOnly bool  `json:"readOnly"`
}

// ServiceStatus is a summary for API responses.
type ServiceStatus struct {
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	Health  HealthStatus      `json:"health"`
	State   string            `json:"state"`
	Ports   []PortMapping     `json:"ports,omitempty"`
	Metrics *ContainerMetrics `json:"metrics,omitempty"`
}

// ContainerMetrics holds resource usage stats for a running container.
type ContainerMetrics struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsageMB float64 `json:"memoryUsageMB"`
	MemoryLimitMB float64 `json:"memoryLimitMB"`
	MemoryPercent float64 `json:"memoryPercent"`
	NetworkRxMB   float64 `json:"networkRxMB"`
	NetworkTxMB   float64 `json:"networkTxMB"`
	BlockReadMB   float64 `json:"blockReadMB"`
	BlockWriteMB  float64 `json:"blockWriteMB"`
	PIDs          int     `json:"pids"`
	Uptime        string  `json:"uptime"`
	CreatedAt     string  `json:"createdAt"`
}

// DockerHostInfo holds system-level information about the Docker daemon.
type DockerHostInfo struct {
	ServerVersion  string `json:"serverVersion"`
	OS             string `json:"os"`
	Architecture   string `json:"architecture"`
	KernelVersion  string `json:"kernelVersion"`
	TotalMemoryMB  int64  `json:"totalMemoryMB"`
	CPUs           int    `json:"cpus"`
	StorageDriver  string `json:"storageDriver"`
	Containers     int    `json:"containers"`
	ContRunning    int    `json:"containersRunning"`
	ContPaused     int    `json:"containersPaused"`
	ContStopped    int    `json:"containersStopped"`
	Images         int    `json:"images"`
	DockerRootDir  string `json:"dockerRootDir"`
}

// HostStats holds aggregated resource usage across all running containers on the host.
type HostStats struct {
	CPUPercent        float64                      `json:"cpuPercent"`
	CPUCores          int                          `json:"cpuCores"`
	PerCPUPercent     []float64                    `json:"perCpuPercent,omitempty"`
	MemoryUsageMB     float64                      `json:"memoryUsageMB"`
	MemoryLimitMB     float64                      `json:"memoryLimitMB"`
	MemoryPercent     float64                      `json:"memoryPercent"`
	NetworkRxMB       float64                      `json:"networkRxMB"`
	NetworkTxMB       float64                      `json:"networkTxMB"`
	BlockReadMB       float64                      `json:"blockReadMB"`
	BlockWriteMB      float64                      `json:"blockWriteMB"`
	PIDs              int                          `json:"pids"`
	ContainersRunning int                          `json:"containersRunning"`
	ContainersTotal   int                          `json:"containersTotal"`
	DiskUsage         *DiskUsage                   `json:"diskUsage,omitempty"`
	Apps              map[string]*AppResourceStats `json:"apps,omitempty"`
	CollectedAt       string                       `json:"collectedAt"`
}

// AppResourceStats holds per-app aggregated resource usage.
type AppResourceStats struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsageMB float64 `json:"memoryUsageMB"`
	MemoryLimitMB float64 `json:"memoryLimitMB"`
	MemoryPercent float64 `json:"memoryPercent"`
	NetworkRxMB   float64 `json:"networkRxMB"`
	NetworkTxMB   float64 `json:"networkTxMB"`
	PIDs          int     `json:"pids"`
	Containers    int     `json:"containers"`
}

// DiskUsage holds Docker daemon disk usage info.
type DiskUsage struct {
	ImagesSizeMB     float64 `json:"imagesSizeMB"`
	ContainersSizeMB float64 `json:"containersSizeMB"`
	VolumesSizeMB    float64 `json:"volumesSizeMB"`
	BuildCacheSizeMB float64 `json:"buildCacheSizeMB"`
	TotalSizeMB      float64 `json:"totalSizeMB"`
	ImagesCount      int     `json:"imagesCount"`
	VolumesCount     int     `json:"volumesCount"`
}

// ComposeSpec is the parsed and normalized representation of Docker Compose files.
type ComposeSpec struct {
	Services []ServiceSpec          `json:"services"`
	Networks map[string]NetworkSpec `json:"networks,omitempty"`
	Volumes  map[string]VolumeSpec  `json:"volumes,omitempty"`
}

type ServiceSpec struct {
	Name          string            `json:"name"`
	Image         string            `json:"image"`
	Environment   map[string]string `json:"environment,omitempty"`
	Ports         []PortMapping     `json:"ports,omitempty"`
	Volumes       []VolumeMount     `json:"volumes,omitempty"`
	Networks      []string          `json:"networks,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	RestartPolicy string            `json:"restartPolicy,omitempty"`
	Healthcheck   *HealthcheckSpec  `json:"healthcheck,omitempty"`
	Command       []string          `json:"command,omitempty"`
	Entrypoint    []string          `json:"entrypoint,omitempty"`
	DependsOn     []string          `json:"dependsOn,omitempty"`
}

type HealthcheckSpec struct {
	Test        []string `json:"test"`
	Interval    string   `json:"interval,omitempty"`
	Timeout     string   `json:"timeout,omitempty"`
	Retries     int      `json:"retries,omitempty"`
	StartPeriod string   `json:"startPeriod,omitempty"`
}

type NetworkSpec struct {
	Driver   string `json:"driver,omitempty"`
	External bool   `json:"external,omitempty"`
}

type VolumeSpec struct {
	Driver   string `json:"driver,omitempty"`
	External bool   `json:"external,omitempty"`
}

// DeployStrategy defines the deployment strategy for a service.
type DeployStrategy string

const (
	// DeployStrategyDefault uses in-place deployment (standard docker compose up -d).
	DeployStrategyDefault DeployStrategy = ""

	// DeployStrategyBlueGreen deploys the new version as a separate project with the
	// opposite color suffix, waits for health, then stops the old color project.
	DeployStrategyBlueGreen DeployStrategy = "blue-green"
)

// DiffResult represents the computed difference between desired and live state.
type DiffResult struct {
	InSync   bool          `json:"inSync"`
	ToCreate []ServiceDiff `json:"toCreate,omitempty"`
	ToUpdate []ServiceDiff `json:"toUpdate,omitempty"`
	ToRemove []ServiceDiff `json:"toRemove,omitempty"`
	Summary  string        `json:"summary"`
}

type ServiceDiff struct {
	ServiceName  string        `json:"serviceName"`
	ChangeType   ChangeType    `json:"changeType"`
	Fields       []FieldDiff   `json:"fields,omitempty"`
	DesiredState *ServiceSpec  `json:"desiredState,omitempty"`
	LiveState    *ServiceState `json:"liveState,omitempty"`
}

type ChangeType string

const (
	ChangeTypeCreate ChangeType = "create"
	ChangeTypeUpdate ChangeType = "update"
	ChangeTypeRemove ChangeType = "remove"
)

type FieldDiff struct {
	Field   string `json:"field"`
	Desired string `json:"desired"`
	Live    string `json:"live"`
}
