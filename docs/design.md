# dockercd Engineering Architecture

## Document Metadata

| Field | Value |
|-------|-------|
| **Document** | Engineering Architecture for dockercd PoC |
| **Status** | Draft |
| **Date** | 2026-02-15 |
| **Scope** | PoC -- 18 acceptance criteria covering core GitOps reconciliation |
| **Story** | story-20260215-dockercd-poc |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Module Architecture](#2-module-architecture)
3. [Data Models](#3-data-models)
4. [Reconciliation Loop Detail](#4-reconciliation-loop-detail)
5. [Docker API Integration](#5-docker-api-integration)
6. [State Store Schema](#6-state-store-schema)
7. [API Design](#7-api-design)
8. [Project Structure](#8-project-structure)
9. [Interface Definitions](#9-interface-definitions)
10. [Concurrency Model](#10-concurrency-model)
11. [Error Handling and Resilience](#11-error-handling-and-resilience)
12. [Configuration](#12-configuration)
13. [Logging Strategy](#13-logging-strategy)
14. [Security Considerations](#14-security-considerations)
15. [Development Plan](#15-development-plan)
16. [Appendix A: Alternatives Evaluated](#appendix-a-alternatives-evaluated)
17. [Appendix B: Risk Register](#appendix-b-risk-register)

---

## 1. Executive Summary

dockercd is a single-container GitOps continuous deployment tool that brings ArgoCD-quality reconciliation to Docker Compose environments. It mounts the Docker socket, polls Git repositories for compose file changes, computes diffs between desired and live state, and automatically deploys to bring the system into convergence.

### Design Goals

1. **Single binary, single container.** No external dependencies beyond Docker and Git repos.
2. **Pure Go, no CGO.** The binary must be statically compiled and run on distroless/alpine.
3. **Clear module boundaries.** Every module communicates through Go interfaces to enable independent testing.
4. **Correctness over speed.** The reconciliation loop must never produce false diffs or skip real changes.
5. **Graceful degradation.** Any single subsystem failure (git unreachable, Docker API down, SQLite locked) must not crash the process.

### Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | Go 1.22+ | Docker ecosystem standard, static compilation, goroutine concurrency |
| Docker SDK | `github.com/docker/docker/client` | Official SDK, direct API access without shelling out |
| Git | `github.com/go-git/go-git/v5` | Pure Go, no git binary dependency |
| Database | `modernc.org/sqlite` | Pure Go SQLite, no CGO required |
| HTTP Router | `github.com/go-chi/chi/v5` | Lightweight, stdlib-compatible, middleware support |
| Logging | `log/slog` (stdlib) | Structured JSON logging, zero dependencies |
| Config | `github.com/spf13/viper` | Environment variables + config files, industry standard |
| CLI | `github.com/spf13/cobra` | Subcommand trees, auto-generated help, industry standard |
| Testing | `testing` + `github.com/stretchr/testify` | Standard assertions, mocks, suites |
| YAML | `gopkg.in/yaml.v3` | Compose file and app manifest parsing |
| Container | Multi-stage Dockerfile, distroless runtime | Minimal attack surface, <100MB image |

---

## 2. Module Architecture

### 2.1 Module Overview

```
                    +------------------+
                    |    cmd/dockercd   |
                    |    (main.go)      |
                    +--------+---------+
                             |
                    +--------+---------+
                    |       cli        |
                    | (cobra commands) |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
     +--------+--------+          +--------+--------+
     |   api (chi)      |          |   reconciler    |
     |  REST endpoints  |          |  (core loop)    |
     +--------+---------+          +--------+--------+
              |                             |
              |            +----------------+----------------+
              |            |                |                |
              |   +--------+------+  +------+-------+ +-----+------+
              |   |   gitsync     |  |   parser     | |  inspector |
              |   | (go-git)      |  | (compose)    | | (docker)   |
              |   +---------------+  +--------------+ +-----+------+
              |                                             |
              |            +----------------+----------------+
              |            |                |
              |   +--------+------+  +------+-------+
              |   |   differ      |  |   deployer   |
              |   | (state diff)  |  | (compose up) |
              |   +---------------+  +--------------+
              |
              |   +---------------+  +--------------+  +-----------+
              |   |   health      |  |   events     |  |   store   |
              |   | (monitoring)  |  | (docker evt) |  | (sqlite)  |
              |   +---------------+  +--------------+  +-----------+
              |
              +----> All modules access store and config
```

### 2.2 Module Descriptions

#### `cmd/dockercd` -- Entry Point
- **Responsibility**: Binary entry point. Wires together all modules via dependency injection.
- **Dependencies**: `cli`
- **Files**: `main.go`

#### `internal/cli` -- Command-Line Interface
- **Responsibility**: Defines cobra commands (`serve`, `app list`, `app get`, `app sync`, `app diff`). The `serve` command initializes the full runtime (reconciler, API server, event watcher). Other commands are one-shot operations that connect to either the local store or the API.
- **Dependencies**: `config`, `app`, `store`, `reconciler`, `api`
- **Key decisions**: CLI commands that query state (`list`, `get`, `diff`) operate directly against SQLite when running locally, or via HTTP API when a remote address is provided. This avoids requiring the server to be running for basic queries.

#### `internal/config` -- Configuration Management
- **Responsibility**: Loads configuration from environment variables and optional config file. Validates all values. Provides typed access via a `Config` struct.
- **Dependencies**: None (leaf module)
- **Key decisions**: Uses viper for env/file merging. All configuration has sensible defaults so dockercd works out of the box with zero configuration.

#### `internal/app` -- Application Model
- **Responsibility**: Defines the core domain types: `Application`, `SyncStatus`, `HealthStatus`, `SyncResult`, `AppCondition`, `ServiceState`. Provides validation logic for application manifests.
- **Dependencies**: None (leaf module, pure types)
- **Key decisions**: This is a pure domain module with no I/O. All types are serializable to both YAML (for manifests) and JSON (for API responses). The `Application` type is the primary aggregate root.

#### `internal/store` -- State Persistence
- **Responsibility**: SQLite database operations. CRUD for applications, sync history, and events. Schema migrations. Transaction management.
- **Dependencies**: `app` (for types)
- **Key decisions**: Uses `modernc.org/sqlite` for pure Go compilation. All writes are wrapped in transactions. Read operations use snapshot isolation. Migrations are embedded in the binary via `embed.FS`.

#### `internal/gitsync` -- Git Repository Management
- **Responsibility**: Clones repositories, polls for changes, detects new commits by comparing HEAD SHA with last synced SHA. Manages local repository cache.
- **Dependencies**: `app` (for `Application.Spec.Source`)
- **Key decisions**: Uses go-git for all operations (no shelling out). Performs shallow clones (`--depth 1`) to minimize disk and bandwidth. Caches cloned repos in `{dataDir}/repos/{appName}/`. Supports HTTPS only for PoC.

#### `internal/parser` -- Compose File Parser
- **Responsibility**: Parses Docker Compose YAML files into a normalized `ComposeSpec`. Handles multiple compose files with override semantics. Performs variable substitution from `.env` files.
- **Dependencies**: `app` (for `ComposeSpec`, `ServiceSpec`)
- **Key decisions**: Does NOT use `docker compose config` (would require docker compose binary). Instead, parses YAML directly with `gopkg.in/yaml.v3` and implements the compose override merge algorithm. Supports v3.8+ format only. Unsupported features (extends, profiles, configs, secrets) produce warnings, not errors.

#### `internal/inspector` -- Live State Inspector
- **Responsibility**: Queries the Docker API for current container state. Filters by compose project label. Normalizes Docker container data into `ServiceState` objects that match the parser output schema for comparison.
- **Dependencies**: `app` (for `ServiceState`), Docker client
- **Key decisions**: Uses the Docker SDK client, not the CLI. Filters containers by `com.docker.compose.project={projectName}` label. Each inspection call is a fresh read -- no caching of live state to avoid staleness.

#### `internal/differ` -- State Diff Engine
- **Responsibility**: Compares desired state (`ComposeSpec`) against live state (`[]ServiceState`). Produces a `DiffResult` with three categories: `ToCreate`, `ToUpdate`, `ToRemove`. Each diff entry includes the reason for the change (image changed, env changed, etc.).
- **Dependencies**: `app` (for types)
- **Key decisions**: This is a pure function module -- no I/O. Comparison is field-by-field: image tag, environment variables, published ports, volume mounts, labels, networks, restart policy. Order-independent comparison for lists (ports, volumes).

#### `internal/deployer` -- Deployment Executor
- **Responsibility**: Executes Docker Compose operations to bring live state into alignment with desired state. Runs `docker compose pull`, `docker compose up -d`, and `docker compose down --remove-orphans` (when pruning).
- **Dependencies**: `app` (for types), Docker client (for compose operations)
- **Key decisions**: Shells out to `docker compose` CLI for deployment operations. While the Docker SDK handles inspection, compose orchestration (service dependency ordering, network creation, volume management) is complex enough that using the compose CLI is the pragmatic choice. The compose binary is included in the container image.

#### `internal/health` -- Health Monitor
- **Responsibility**: Polls container health status after deployments. Maps Docker container states to the four-level health model. Computes application-level health as worst-child-status. Detects health transitions and logs them.
- **Dependencies**: `app` (for types), `inspector` (for live state), `store` (for persisting health)
- **Key decisions**: Polls every 10 seconds after a deployment. Uses a configurable timeout (default 120s) to wait for all services to become healthy. A deployment is marked successful only when all services reach `Healthy`. The monitor runs as a separate goroutine.

#### `internal/events` -- Docker Event Watcher
- **Responsibility**: Subscribes to the Docker event stream. Filters for container die/stop/remove events on managed containers. Triggers reconciliation for the affected application when `selfHeal=true`.
- **Dependencies**: `app` (for types), Docker client (for event stream)
- **Key decisions**: Uses the Docker SDK `Events()` API which returns a channel. Events generated by dockercd itself are identified by a label (`managed-by=dockercd`) and ignored to prevent reconciliation loops. Debounces events -- waits 2 seconds after the last event before triggering reconciliation, to batch multiple container stops from a single `docker compose down`.

#### `internal/reconciler` -- Core Reconciliation Loop
- **Responsibility**: The central orchestrator. For each application, runs the reconciliation algorithm: git sync, parse, inspect, diff, deploy, health check. Manages per-application timers. Handles both periodic and on-demand reconciliation.
- **Dependencies**: `gitsync`, `parser`, `inspector`, `differ`, `deployer`, `health`, `store`, `app`
- **Key decisions**: Uses a worker pool model (not per-app goroutines) to bound concurrency. Default pool size is 4 workers. Applications are queued for reconciliation either by timer expiry or by external trigger (API call, Docker event). A per-app mutex prevents concurrent reconciliation of the same application.

#### `internal/api` -- REST API Server
- **Responsibility**: HTTP server exposing REST endpoints for application management. Serves JSON responses. Provides health and readiness probes.
- **Dependencies**: `app`, `store`, `reconciler`, `differ`
- **Key decisions**: Uses chi router with middleware stack (recovery, request logging, content-type enforcement). All endpoints are under `/api/v1/` for versioning. Error responses use a consistent JSON schema.

### 2.3 Dependency Graph

```
cmd/dockercd
  └── cli
       ├── config
       ├── api
       │    ├── app
       │    ├── store
       │    ├── reconciler
       │    └── differ
       ├── reconciler
       │    ├── gitsync
       │    │    └── app
       │    ├── parser
       │    │    └── app
       │    ├── inspector
       │    │    └── app
       │    ├── differ
       │    │    └── app
       │    ├── deployer
       │    │    └── app
       │    ├── health
       │    │    ├── app
       │    │    ├── inspector
       │    │    └── store
       │    ├── store
       │    └── app
       ├── events
       │    ├── app
       │    └── reconciler (trigger interface only)
       └── store
            └── app
```

**Critical constraint**: No circular dependencies. The `app` package is the leaf. Every module depends on `app` for types but `app` depends on nothing. The `reconciler` is the highest-level orchestration module. The `events` module depends on a minimal trigger interface of the reconciler, not the full implementation.

---

## 3. Data Models

All types are defined in `internal/app/types.go`. This is the single source of truth for domain types.

### 3.1 Application

The top-level aggregate representing a managed Docker Compose application.

```go
// Application represents a managed Docker Compose deployment.
// It is the equivalent of an ArgoCD Application CRD.
type Application struct {
    // APIVersion is always "dockercd/v1" for this PoC.
    APIVersion string `yaml:"apiVersion" json:"apiVersion"`

    // Kind is always "Application".
    Kind string `yaml:"kind" json:"kind"`

    // Metadata contains the application identity.
    Metadata AppMetadata `yaml:"metadata" json:"metadata"`

    // Spec defines the desired state configuration.
    Spec AppSpec `yaml:"spec" json:"spec"`

    // Status is the observed runtime state (not persisted in manifest).
    Status AppStatus `yaml:"-" json:"status"`
}

type AppMetadata struct {
    // Name is the unique identifier for this application.
    // Must be a valid DNS label: lowercase alphanumeric and hyphens, max 63 chars.
    Name string `yaml:"name" json:"name"`
}

type AppSpec struct {
    // Source defines where the compose files come from.
    Source SourceSpec `yaml:"source" json:"source"`

    // Destination defines the Docker target.
    Destination DestinationSpec `yaml:"destination" json:"destination"`

    // SyncPolicy defines how and when syncs happen.
    SyncPolicy SyncPolicy `yaml:"syncPolicy" json:"syncPolicy"`
}

type SourceSpec struct {
    // RepoURL is the HTTPS URL of the Git repository.
    RepoURL string `yaml:"repoURL" json:"repoURL"`

    // TargetRevision is the branch, tag, or commit to track.
    // Default: "main"
    TargetRevision string `yaml:"targetRevision" json:"targetRevision"`

    // Path is the directory within the repo containing compose files.
    // Default: "."
    Path string `yaml:"path" json:"path"`

    // ComposeFiles is the ordered list of compose files to merge.
    // Default: ["docker-compose.yml"]
    ComposeFiles []string `yaml:"composeFiles" json:"composeFiles"`
}

type DestinationSpec struct {
    // DockerHost is the Docker daemon socket path.
    // Default: "unix:///var/run/docker.sock"
    DockerHost string `yaml:"dockerHost" json:"dockerHost"`

    // ProjectName is the Docker Compose project name used for container labeling.
    // Default: application metadata.name
    ProjectName string `yaml:"projectName" json:"projectName"`
}

type SyncPolicy struct {
    // Automated enables automatic deployment when drift is detected.
    // Default: false
    Automated bool `yaml:"automated" json:"automated"`

    // Prune enables removal of containers not in the desired state.
    // Executes "docker compose down --remove-orphans".
    // Default: false
    Prune bool `yaml:"prune" json:"prune"`

    // SelfHeal enables re-deployment when containers are stopped externally.
    // Default: false
    SelfHeal bool `yaml:"selfHeal" json:"selfHeal"`

    // PollInterval is the duration between Git polling cycles.
    // Minimum: 30s, Default: 180s (3 minutes)
    PollInterval Duration `yaml:"pollInterval" json:"pollInterval"`

    // SyncTimeout is the maximum time to wait for a sync to complete.
    // Default: 300s (5 minutes)
    SyncTimeout Duration `yaml:"syncTimeout" json:"syncTimeout"`

    // HealthTimeout is the maximum time to wait for services to become healthy
    // after deployment. Default: 120s (2 minutes)
    HealthTimeout Duration `yaml:"healthTimeout" json:"healthTimeout"`
}

// Duration is a wrapper around time.Duration that supports YAML/JSON
// marshaling with human-readable strings like "180s", "3m", "1h".
type Duration struct {
    time.Duration
}
```

### 3.2 Status Types

```go
// SyncStatus represents the synchronization state of an application.
type SyncStatus string

const (
    SyncStatusSynced    SyncStatus = "Synced"     // Desired == Live
    SyncStatusOutOfSync SyncStatus = "OutOfSync"  // Desired != Live
    SyncStatusUnknown   SyncStatus = "Unknown"    // Cannot determine (e.g., git unreachable)
    SyncStatusError     SyncStatus = "Error"       // Sync attempted but failed
)

// HealthStatus represents the health of an application or service.
// Ordered by severity: Healthy < Progressing < Degraded < Unknown.
type HealthStatus string

const (
    HealthStatusHealthy     HealthStatus = "Healthy"     // All containers running + healthy
    HealthStatusProgressing HealthStatus = "Progressing"  // Containers starting
    HealthStatusDegraded    HealthStatus = "Degraded"     // Containers restarting or unhealthy
    HealthStatusUnknown     HealthStatus = "Unknown"      // Cannot determine or containers exited
)

// HealthSeverity returns a numeric severity for comparison.
// Higher number = worse health.
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

// AppStatus is the observed runtime state of an application.
type AppStatus struct {
    // SyncStatus is the current synchronization state.
    SyncStatus SyncStatus `json:"syncStatus"`

    // HealthStatus is the aggregate health of all services.
    HealthStatus HealthStatus `json:"healthStatus"`

    // LastSyncedSHA is the Git commit SHA that was last successfully deployed.
    LastSyncedSHA string `json:"lastSyncedSHA,omitempty"`

    // LastSyncTime is the timestamp of the last successful sync.
    LastSyncTime *time.Time `json:"lastSyncTime,omitempty"`

    // LastSyncResult is the outcome of the most recent sync attempt.
    LastSyncResult *SyncResult `json:"lastSyncResult,omitempty"`

    // HeadSHA is the current HEAD commit SHA of the tracked branch.
    HeadSHA string `json:"headSHA,omitempty"`

    // Conditions are the current conditions on the application.
    Conditions []AppCondition `json:"conditions,omitempty"`

    // Services is the per-service health breakdown.
    Services []ServiceStatus `json:"services,omitempty"`

    // Message is a human-readable summary of the current state.
    Message string `json:"message,omitempty"`
}
```

### 3.3 Sync Result

```go
// SyncResult records the outcome of a sync operation.
type SyncResult struct {
    // ID is the unique identifier for this sync attempt.
    ID string `json:"id"`

    // AppName is the application that was synced.
    AppName string `json:"appName"`

    // StartedAt is when the sync began.
    StartedAt time.Time `json:"startedAt"`

    // FinishedAt is when the sync completed (success or failure).
    FinishedAt time.Time `json:"finishedAt"`

    // CommitSHA is the Git commit that was deployed.
    CommitSHA string `json:"commitSHA"`

    // Operation is what triggered the sync.
    Operation SyncOperation `json:"operation"`

    // Result is the outcome.
    Result SyncResultStatus `json:"result"`

    // Diff is the diff that was applied (or would have been applied).
    Diff *DiffResult `json:"diff,omitempty"`

    // Error is the error message if the sync failed.
    Error string `json:"error,omitempty"`

    // DurationMs is the sync duration in milliseconds.
    DurationMs int64 `json:"durationMs"`
}

type SyncOperation string

const (
    SyncOperationPoll     SyncOperation = "poll"      // Triggered by poll interval
    SyncOperationManual   SyncOperation = "manual"    // Triggered by API/CLI
    SyncOperationSelfHeal SyncOperation = "self-heal" // Triggered by Docker event
)

type SyncResultStatus string

const (
    SyncResultSuccess SyncResultStatus = "success"
    SyncResultFailure SyncResultStatus = "failure"
    SyncResultSkipped SyncResultStatus = "skipped"  // No diff, nothing to do
)
```

### 3.4 App Condition

```go
// AppCondition represents a notable event or state on an application.
// Modeled after Kubernetes conditions.
type AppCondition struct {
    // Type is the condition type.
    Type ConditionType `json:"type"`

    // Status is the condition status.
    Status string `json:"status"`

    // Message is a human-readable description.
    Message string `json:"message"`

    // LastTransitionTime is when the condition last changed.
    LastTransitionTime time.Time `json:"lastTransitionTime"`
}

type ConditionType string

const (
    ConditionSyncError    ConditionType = "SyncError"
    ConditionHealthCheck  ConditionType = "HealthCheck"
    ConditionGitError     ConditionType = "GitError"
    ConditionParseError   ConditionType = "ParseError"
    ConditionDeployError  ConditionType = "DeployError"
    ConditionSelfHealed   ConditionType = "SelfHealed"
)
```

### 3.5 Service State

```go
// ServiceState represents the live state of a single Docker Compose service.
// Used for both desired state (from compose file) and live state (from Docker API).
type ServiceState struct {
    // Name is the compose service name.
    Name string `json:"name"`

    // Image is the full image reference (e.g., "nginx:1.25").
    Image string `json:"image"`

    // ContainerName is the actual container name (e.g., "myapp-web-1").
    ContainerName string `json:"containerName,omitempty"`

    // Status is the container state from Docker.
    Status string `json:"status,omitempty"`

    // Health is the computed health status.
    Health HealthStatus `json:"health"`

    // Environment is the map of environment variables.
    Environment map[string]string `json:"environment,omitempty"`

    // Ports is the list of published port mappings.
    Ports []PortMapping `json:"ports,omitempty"`

    // Volumes is the list of volume mounts.
    Volumes []VolumeMount `json:"volumes,omitempty"`

    // Networks is the list of attached networks.
    Networks []string `json:"networks,omitempty"`

    // Labels is the map of container labels.
    Labels map[string]string `json:"labels,omitempty"`

    // RestartPolicy is the container restart policy.
    RestartPolicy string `json:"restartPolicy,omitempty"`

    // Command is the container command override.
    Command []string `json:"command,omitempty"`

    // Entrypoint is the container entrypoint override.
    Entrypoint []string `json:"entrypoint,omitempty"`
}

type PortMapping struct {
    // HostPort is the port on the host.
    HostPort string `json:"hostPort"`

    // ContainerPort is the port in the container.
    ContainerPort string `json:"containerPort"`

    // Protocol is "tcp" or "udp". Default: "tcp".
    Protocol string `json:"protocol"`
}

type VolumeMount struct {
    // Source is the host path or volume name.
    Source string `json:"source"`

    // Target is the mount point in the container.
    Target string `json:"target"`

    // ReadOnly indicates if the mount is read-only.
    ReadOnly bool `json:"readOnly"`
}

// ServiceStatus is a summary of a service's current state for API responses.
type ServiceStatus struct {
    Name   string       `json:"name"`
    Image  string       `json:"image"`
    Health HealthStatus `json:"health"`
    State  string       `json:"state"`
}
```

### 3.6 Compose Spec

```go
// ComposeSpec is the parsed and normalized representation of Docker Compose files.
// It is the "desired state" for an application.
type ComposeSpec struct {
    // Services is the ordered list of service definitions.
    Services []ServiceSpec `json:"services"`

    // Networks is the map of network definitions.
    Networks map[string]NetworkSpec `json:"networks,omitempty"`

    // Volumes is the map of volume definitions.
    Volumes map[string]VolumeSpec `json:"volumes,omitempty"`
}

type ServiceSpec struct {
    // Name is the service name (the key in the compose file services map).
    Name string `json:"name"`

    // Image is the full image reference.
    Image string `json:"image"`

    // Environment is the resolved environment variables.
    Environment map[string]string `json:"environment,omitempty"`

    // Ports is the list of port mappings.
    Ports []PortMapping `json:"ports,omitempty"`

    // Volumes is the list of volume mounts.
    Volumes []VolumeMount `json:"volumes,omitempty"`

    // Networks is the list of network names this service connects to.
    Networks []string `json:"networks,omitempty"`

    // Labels is the map of labels.
    Labels map[string]string `json:"labels,omitempty"`

    // RestartPolicy is the restart policy.
    RestartPolicy string `json:"restartPolicy,omitempty"`

    // Healthcheck defines the health check configuration.
    Healthcheck *HealthcheckSpec `json:"healthcheck,omitempty"`

    // Command is the command override.
    Command []string `json:"command,omitempty"`

    // Entrypoint is the entrypoint override.
    Entrypoint []string `json:"entrypoint,omitempty"`

    // DependsOn lists service dependencies.
    DependsOn []string `json:"dependsOn,omitempty"`
}

type HealthcheckSpec struct {
    Test     []string `json:"test"`
    Interval string   `json:"interval,omitempty"`
    Timeout  string   `json:"timeout,omitempty"`
    Retries  int      `json:"retries,omitempty"`
    StartPeriod string `json:"startPeriod,omitempty"`
}

type NetworkSpec struct {
    Driver   string `json:"driver,omitempty"`
    External bool   `json:"external,omitempty"`
}

type VolumeSpec struct {
    Driver   string `json:"driver,omitempty"`
    External bool   `json:"external,omitempty"`
}
```

### 3.7 Diff Result

```go
// DiffResult represents the computed difference between desired and live state.
type DiffResult struct {
    // InSync is true when desired == live (no changes needed).
    InSync bool `json:"inSync"`

    // ToCreate lists services that exist in desired state but not in live state.
    ToCreate []ServiceDiff `json:"toCreate,omitempty"`

    // ToUpdate lists services that exist in both but have configuration differences.
    ToUpdate []ServiceDiff `json:"toUpdate,omitempty"`

    // ToRemove lists services that exist in live state but not in desired state.
    ToRemove []ServiceDiff `json:"toRemove,omitempty"`

    // Summary is a human-readable diff summary.
    // Example: "2 to create, 1 to update (image changed: nginx:1.24 -> nginx:1.25), 1 to remove"
    Summary string `json:"summary"`
}

// ServiceDiff describes what changed for a single service.
type ServiceDiff struct {
    // ServiceName is the compose service name.
    ServiceName string `json:"serviceName"`

    // ChangeType is the high-level change category.
    ChangeType ChangeType `json:"changeType"`

    // Fields lists the specific fields that differ.
    Fields []FieldDiff `json:"fields,omitempty"`

    // DesiredState is the desired configuration (nil for ToRemove).
    DesiredState *ServiceSpec `json:"desiredState,omitempty"`

    // LiveState is the current configuration (nil for ToCreate).
    LiveState *ServiceState `json:"liveState,omitempty"`
}

type ChangeType string

const (
    ChangeTypeCreate ChangeType = "create"
    ChangeTypeUpdate ChangeType = "update"
    ChangeTypeRemove ChangeType = "remove"
)

// FieldDiff describes a single field difference.
type FieldDiff struct {
    // Field is the field path (e.g., "image", "environment.DB_HOST", "ports[0].hostPort").
    Field string `json:"field"`

    // Desired is the desired value (as string for display).
    Desired string `json:"desired"`

    // Live is the live value (as string for display).
    Live string `json:"live"`
}
```

---

## 4. Reconciliation Loop Detail

### 4.1 High-Level Algorithm

```
RECONCILE(app Application) -> SyncResult:
    result = SyncResult{AppName: app.Name, StartedAt: now()}

    // STEP 1: Git Sync
    headSHA, err = gitSyncer.Sync(app.Spec.Source)
    if err:
        result.Result = failure
        result.Error = "git sync failed: " + err
        store.RecordCondition(app.Name, GitError, err)
        return result

    // STEP 2: Change Detection (skip if no changes and no forced sync)
    if headSHA == app.Status.LastSyncedSHA and not forcedSync:
        // Even if SHA matches, check live state for drift
        if not app.Spec.SyncPolicy.SelfHeal:
            result.Result = skipped
            return result

    // STEP 3: Parse Desired State
    composeSpec, err = parser.Parse(
        repoPath = gitSyncer.RepoPath(app.Name),
        files    = app.Spec.Source.ComposeFiles,
        envFile  = ".env",
    )
    if err:
        result.Result = failure
        result.Error = "parse error: " + err
        store.RecordCondition(app.Name, ParseError, err)
        app.Status.HealthStatus = Degraded
        return result

    // STEP 4: Inspect Live State
    liveServices, err = inspector.Inspect(app.Spec.Destination)
    if err:
        result.Result = failure
        result.Error = "inspect error: " + err
        return result

    // STEP 5: Compute Diff
    diff = differ.Diff(composeSpec.Services, liveServices)
    result.Diff = diff
    result.CommitSHA = headSHA

    // STEP 6: Decision
    if diff.InSync:
        app.Status.SyncStatus = Synced
        app.Status.LastSyncedSHA = headSHA
        result.Result = skipped
        store.UpdateAppStatus(app)
        return result

    // diff detected
    app.Status.SyncStatus = OutOfSync

    if not app.Spec.SyncPolicy.Automated and not forcedSync:
        // Manual mode: record diff but do not deploy
        store.UpdateAppStatus(app)
        result.Result = skipped
        result.Message = "out of sync, manual sync required"
        return result

    // STEP 7: Deploy
    app.Status.HealthStatus = Progressing
    store.UpdateAppStatus(app)

    err = deployer.Deploy(DeployRequest{
        ProjectName: app.Spec.Destination.ProjectName,
        ComposeFiles: absoluteComposeFilePaths(app),
        Prune: app.Spec.SyncPolicy.Prune and len(diff.ToRemove) > 0,
        Pull: len(diff.ToCreate) > 0 or hasImageChanges(diff.ToUpdate),
    })
    if err:
        result.Result = failure
        result.Error = "deploy error: " + err
        store.RecordCondition(app.Name, DeployError, err)
        app.Status.HealthStatus = Degraded
        return result

    // STEP 8: Wait for Healthy
    healthResult = health.WaitForHealthy(
        app.Spec.Destination,
        app.Spec.SyncPolicy.HealthTimeout,
    )

    if healthResult.Healthy:
        app.Status.SyncStatus = Synced
        app.Status.HealthStatus = Healthy
        app.Status.LastSyncedSHA = headSHA
        app.Status.LastSyncTime = now()
        result.Result = success
    else:
        app.Status.HealthStatus = healthResult.AggregateHealth
        result.Result = failure
        result.Error = "health check timeout: " + healthResult.Summary

    app.Status.Services = healthResult.Services
    store.UpdateAppStatus(app)
    store.RecordSync(result)
    return result
```

### 4.2 Polling Mechanism

The reconciler uses a scheduling approach rather than per-app goroutines with `time.Ticker`:

```go
// Scheduler manages reconciliation timing for all applications.
type Scheduler struct {
    mu        sync.Mutex
    schedule  map[string]time.Time // appName -> next reconciliation time
    trigger   chan string          // channel for immediate reconciliation requests
    workQueue chan string          // bounded work queue for the worker pool
}
```

**How it works**:

1. On startup, the scheduler loads all applications from the store and computes `nextReconcileTime = now()` for each (immediate first reconciliation).
2. A single scheduler goroutine runs a tight loop with `time.After(shortestWait)` where `shortestWait` is the minimum time until the next app's poll interval expires.
3. When an app's time arrives, the scheduler pushes the app name onto the `workQueue` channel.
4. Worker goroutines (pool size configurable, default 4) read from `workQueue` and execute the reconciliation algorithm.
5. After reconciliation completes, the scheduler updates `nextReconcileTime = now() + app.PollInterval`.
6. The `trigger` channel allows the API, CLI, or event watcher to request immediate reconciliation. The scheduler sets `nextReconcileTime = now()` for the triggered app and wakes up.

**Per-app mutex**: A `sync.Map` of `*sync.Mutex` prevents two workers from reconciling the same app simultaneously. If a worker cannot acquire the lock (another worker is already reconciling that app), it skips and the scheduler will retry on the next cycle.

### 4.3 Git Change Detection

```
SYNC(source SourceSpec) -> (commitSHA string, err error):
    repoPath = cacheDir + "/" + sanitize(source.RepoURL)

    if not exists(repoPath):
        // First clone
        repo, err = git.PlainClone(repoPath, false, &git.CloneOptions{
            URL:           source.RepoURL,
            ReferenceName: plumbing.NewBranchReferenceName(source.TargetRevision),
            Depth:         1,
            SingleBranch:  true,
        })
    else:
        // Fetch updates
        repo, err = git.PlainOpen(repoPath)
        worktree, err = repo.Worktree()
        err = worktree.Pull(&git.PullOptions{
            RemoteName:    "origin",
            ReferenceName: plumbing.NewBranchReferenceName(source.TargetRevision),
            Depth:         1,
            Force:         true,
        })
        if err == git.NoErrAlreadyUpToDate:
            // No new commits, return current HEAD
            err = nil

    head, err = repo.Head()
    return head.Hash().String(), err
```

**Key behaviors**:
- Shallow clone (`Depth: 1`) to minimize disk usage.
- `Force: true` on pull to handle force pushes in the remote (the desired state is whatever is at HEAD of the tracked branch).
- Repository cache is at `{dataDir}/repos/{urlHash}/` where `urlHash` is a deterministic hash of the repo URL.
- If the repository directory exists but is corrupted (e.g., partial clone from a previous crash), delete it and re-clone.

### 4.4 Compose File Parsing

The parser handles multiple compose files with Docker Compose's override semantics:

```
PARSE(repoPath string, files []string, envFile string) -> (ComposeSpec, error):
    // Load .env file for variable substitution
    envVars = loadDotEnv(repoPath + "/" + envFile)

    // Parse base compose file
    baseSpec = parseYAML(repoPath + "/" + files[0])

    // Merge override files in order
    for i = 1; i < len(files); i++:
        overrideSpec = parseYAML(repoPath + "/" + files[i])
        baseSpec = mergeSpecs(baseSpec, overrideSpec)

    // Substitute variables
    baseSpec = substituteVars(baseSpec, envVars)

    // Normalize: sort services by name, sort ports, normalize image tags
    baseSpec = normalize(baseSpec)

    return baseSpec, nil
```

**Override merge rules** (matching Docker Compose specification):
- **Scalar fields** (image, restart): override replaces base.
- **Map fields** (environment, labels): override values merge with base; override keys win on conflict.
- **List fields** (ports, volumes): override values are appended to base (no deduplication -- matches Docker Compose behavior).
- **Missing services**: services in override but not in base are added. Services in base but not in override remain unchanged.

**Variable substitution**: Supports `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `${VAR:?error}` syntax as defined by the Docker Compose specification.

### 4.5 Live State Collection

```
INSPECT(destination DestinationSpec) -> ([]ServiceState, error):
    client = docker.NewClientWithOpts(docker.WithHost(destination.DockerHost))

    // List containers filtered by compose project
    containers = client.ContainerList(ctx, container.ListOptions{
        All: true,  // include stopped containers
        Filters: filters.NewArgs(
            filters.Arg("label", "com.docker.compose.project=" + destination.ProjectName),
        ),
    })

    services = []ServiceState{}
    for each container in containers:
        // Full inspect for detailed config
        inspect = client.ContainerInspect(ctx, container.ID)

        service = ServiceState{
            Name:          inspect.Config.Labels["com.docker.compose.service"],
            Image:         normalizeImageRef(inspect.Config.Image),
            ContainerName: inspect.Name,
            Status:        inspect.State.Status,
            Health:        mapDockerHealth(inspect.State),
            Environment:   parseEnvList(inspect.Config.Env),
            Ports:         extractPorts(inspect.NetworkSettings.Ports),
            Volumes:       extractVolumes(inspect.Mounts),
            Networks:      extractNetworks(inspect.NetworkSettings.Networks),
            Labels:        filterLabels(inspect.Config.Labels),  // exclude compose internal labels
            RestartPolicy: inspect.HostConfig.RestartPolicy.Name,
            Command:       inspect.Config.Cmd,
            Entrypoint:    inspect.Config.Entrypoint,
        }
        services = append(services, service)

    return services, nil
```

**Docker health mapping**:

| Docker State | Docker Health | dockercd HealthStatus |
|-------------|---------------|----------------------|
| running | healthy | Healthy |
| running | starting | Progressing |
| running | unhealthy | Degraded |
| running | (no healthcheck) | Healthy |
| restarting | any | Degraded |
| created | any | Progressing |
| exited | any | Unknown |
| dead | any | Unknown |
| paused | any | Unknown |

**Image normalization**: `nginx` becomes `docker.io/library/nginx:latest`, `myregistry.com/app:v1` stays as-is. This ensures consistent comparison between desired and live state.

### 4.6 Diff Computation

```
DIFF(desired []ServiceSpec, live []ServiceState) -> DiffResult:
    result = DiffResult{}

    desiredMap = indexByName(desired)   // map[string]ServiceSpec
    liveMap    = indexByName(live)      // map[string]ServiceState

    // Find services to create (in desired but not in live)
    for name, spec in desiredMap:
        if name not in liveMap:
            result.ToCreate = append(result.ToCreate, ServiceDiff{
                ServiceName: name,
                ChangeType: create,
                DesiredState: &spec,
            })

    // Find services to remove (in live but not in desired)
    for name, state in liveMap:
        if name not in desiredMap:
            result.ToRemove = append(result.ToRemove, ServiceDiff{
                ServiceName: name,
                ChangeType: remove,
                LiveState: &state,
            })

    // Find services to update (in both but different)
    for name in intersection(desiredMap, liveMap):
        spec  = desiredMap[name]
        state = liveMap[name]
        fields = compareService(spec, state)
        if len(fields) > 0:
            result.ToUpdate = append(result.ToUpdate, ServiceDiff{
                ServiceName: name,
                ChangeType: update,
                Fields: fields,
                DesiredState: &spec,
                LiveState: &state,
            })

    result.InSync = len(result.ToCreate) == 0 and
                    len(result.ToUpdate) == 0 and
                    len(result.ToRemove) == 0
    result.Summary = buildSummary(result)
    return result


COMPARE_SERVICE(desired ServiceSpec, live ServiceState) -> []FieldDiff:
    diffs = []FieldDiff{}

    // Image comparison (normalized)
    if normalizeImage(desired.Image) != normalizeImage(live.Image):
        diffs = append(diffs, FieldDiff{
            Field: "image",
            Desired: desired.Image,
            Live: live.Image,
        })

    // Environment comparison (key-by-key)
    for key in union(keys(desired.Environment), keys(live.Environment)):
        dv = desired.Environment[key]
        lv = live.Environment[key]
        if dv != lv:
            diffs = append(diffs, FieldDiff{
                Field: "environment." + key,
                Desired: dv,
                Live: lv,
            })

    // Port comparison (order-independent)
    if not portsEqual(desired.Ports, live.Ports):
        diffs = append(diffs, FieldDiff{
            Field: "ports",
            Desired: formatPorts(desired.Ports),
            Live: formatPorts(live.Ports),
        })

    // Volume comparison (order-independent)
    if not volumesEqual(desired.Volumes, live.Volumes):
        diffs = append(diffs, FieldDiff{
            Field: "volumes",
            Desired: formatVolumes(desired.Volumes),
            Live: formatVolumes(live.Volumes),
        })

    // Network comparison (order-independent)
    if not setsEqual(desired.Networks, live.Networks):
        diffs = append(diffs, FieldDiff{
            Field: "networks",
            Desired: strings.Join(sorted(desired.Networks), ","),
            Live: strings.Join(sorted(live.Networks), ","),
        })

    // Restart policy comparison
    if desired.RestartPolicy != live.RestartPolicy:
        diffs = append(diffs, FieldDiff{
            Field: "restartPolicy",
            Desired: desired.RestartPolicy,
            Live: live.RestartPolicy,
        })

    // Command comparison
    if not slicesEqual(desired.Command, live.Command):
        diffs = append(diffs, FieldDiff{
            Field: "command",
            Desired: strings.Join(desired.Command, " "),
            Live: strings.Join(live.Command, " "),
        })

    return diffs
```

**Design decision -- label comparison**: Compose-internal labels (`com.docker.compose.*`) are excluded from diff comparison. Only user-defined labels in the compose file are compared. This prevents false positives from Docker-injected metadata.

**Design decision -- environment variable filtering**: Variables injected by Docker itself (e.g., `PATH`, `HOME`) are excluded from comparison. Only variables explicitly defined in the compose file's `environment` section are compared.

### 4.7 Deployment Execution

The deployer shells out to the `docker compose` CLI rather than reimplementing compose orchestration through the Docker SDK:

```
DEPLOY(request DeployRequest) -> error:
    // Build base command
    args = ["compose"]
    for each file in request.ComposeFiles:
        args = append(args, "-f", file)
    args = append(args, "-p", request.ProjectName)

    // Step 1: Pull images (if needed)
    if request.Pull:
        err = exec("docker", append(args, "pull")...)
        if err:
            return fmt.Errorf("pull failed: %w", err)

    // Step 2: Apply desired state
    err = exec("docker", append(args, "up", "-d", "--remove-orphans")...)
    if err:
        return fmt.Errorf("up failed: %w", err)

    // Step 3: Prune orphans (if prune=true and there are services to remove)
    // Note: --remove-orphans in step 2 handles most cases.
    // Explicit down is needed only when removing ALL services of a previously
    // managed application.

    return nil
```

**Why shell out to `docker compose` instead of using the Docker SDK directly?**

The Docker SDK provides low-level container/network/volume CRUD operations. Docker Compose adds substantial orchestration logic on top:
- Service dependency ordering (DependsOn)
- Network creation with proper naming (`{project}_{network}`)
- Volume creation with proper naming
- Container naming conventions (`{project}-{service}-{replica}`)
- Label injection for project/service identification
- Rolling updates within a service

Reimplementing this logic would be error-prone and would diverge from Compose's actual behavior. Using the CLI ensures behavioral parity with what users expect from `docker compose up -d`.

**The Docker SDK IS used for**: container inspection, event stream subscription, health status queries -- all read operations where we need structured data, not orchestration.

### 4.8 Error Recovery During Deployment

```
If pull fails:
    - Log error with image name and registry
    - Mark app as Degraded with condition DeployError
    - Do NOT proceed to "up" -- partial pulls could leave inconsistent state
    - Next reconciliation will retry

If up fails:
    - Log error with compose output (stderr)
    - Mark app as Degraded with condition DeployError
    - Docker Compose is atomic at the service level: services that started
      successfully remain running; failed services are stopped
    - Next reconciliation will see the drift and retry

If up succeeds but health check times out:
    - App stays in Progressing/Degraded (depending on service states)
    - Sync is marked as failure but the deployed state remains
    - No automatic rollback in PoC (future enhancement)
    - Operator can manually revert the git commit
```

---

## 5. Docker API Integration

### 5.1 SDK Usage Summary

| Operation | Method | Purpose |
|-----------|--------|---------|
| List containers | `client.ContainerList()` | Enumerate all containers for a compose project |
| Inspect container | `client.ContainerInspect()` | Get detailed config, state, health for a container |
| Container logs | `client.ContainerLogs()` | Stream logs for a specific container (API endpoint) |
| Event stream | `client.Events()` | Subscribe to container lifecycle events for self-healing |
| Image inspect | `client.ImageInspectWithRaw()` | Resolve image digest for precise comparison (future) |
| Ping | `client.Ping()` | Health/readiness check for Docker connectivity |

### 5.2 Client Initialization

```go
func NewDockerClient(host string) (*client.Client, error) {
    opts := []client.Opt{
        client.WithHost(host),
        client.WithAPIVersionNegotiation(), // auto-detect API version
    }

    // For TCP connections, TLS would be configured here (future)
    if strings.HasPrefix(host, "tcp://") {
        // PoC: TCP without TLS (for development only)
        // Future: TLS with client certs
    }

    return client.NewClientWithOpts(opts...)
}
```

### 5.3 Event Stream for Self-Healing

```go
func (w *EventWatcher) Watch(ctx context.Context) {
    eventCh, errCh := w.client.Events(ctx, events.ListOptions{
        Filters: filters.NewArgs(
            filters.Arg("type", "container"),
            filters.Arg("event", "die"),
            filters.Arg("event", "stop"),
            filters.Arg("event", "destroy"),
        ),
    })

    debounceTimers := map[string]*time.Timer{} // per-app debounce

    for {
        select {
        case event := <-eventCh:
            projectName := event.Actor.Attributes["com.docker.compose.project"]
            if projectName == "" {
                continue // not a compose-managed container
            }

            // Check if this is a dockercd-initiated operation
            if event.Actor.Attributes["dockercd.managed"] == "true" {
                continue // skip our own operations
            }

            // Debounce: wait 2s after last event before triggering
            if timer, exists := debounceTimers[projectName]; exists {
                timer.Stop()
            }
            debounceTimers[projectName] = time.AfterFunc(2*time.Second, func() {
                w.triggerReconcile(projectName)
                delete(debounceTimers, projectName)
            })

        case err := <-errCh:
            // Event stream disconnected -- reconnect with backoff
            w.logger.Error("docker event stream error", "error", err)
            time.Sleep(w.reconnectBackoff())
            // Re-subscribe (the for loop will restart with new channels)
            eventCh, errCh = w.client.Events(ctx, eventOpts)

        case <-ctx.Done():
            return
        }
    }
}
```

**Preventing reconciliation loops**: When the deployer executes `docker compose up -d`, Docker emits container create/start events. The event watcher must ignore these to prevent an infinite reconciliation loop. This is achieved through two mechanisms:

1. **Operation tracking**: The reconciler sets a flag (`reconciling[appName] = true`) before deploying and clears it after. The event watcher checks this flag and skips events for apps currently being reconciled.
2. **Time-based guard**: Events within 5 seconds of a successful sync completion are ignored for that app, as they are likely side effects of the deployment.

### 5.4 Docker Compose CLI Execution

```go
// ComposeExec runs a docker compose command and captures output.
func (d *Deployer) ComposeExec(ctx context.Context, args []string) error {
    cmd := exec.CommandContext(ctx, "docker", args...)
    cmd.Env = append(os.Environ(),
        "DOCKER_HOST="+d.dockerHost,
        "COMPOSE_PROJECT_NAME="+d.projectName,
    )

    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr

    d.logger.Info("executing docker compose",
        "args", strings.Join(args, " "),
        "project", d.projectName,
    )

    err := cmd.Run()
    if err != nil {
        return fmt.Errorf("docker compose %s failed: %w\nstderr: %s",
            args[len(args)-1], err, stderr.String())
    }

    return nil
}
```

---

## 6. State Store Schema

### 6.1 Schema Definition

```sql
-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    version  INTEGER PRIMARY KEY,
    applied  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Application definitions and current status
CREATE TABLE IF NOT EXISTS applications (
    id              TEXT PRIMARY KEY,          -- UUID
    name            TEXT NOT NULL UNIQUE,      -- application name (DNS label)
    manifest        TEXT NOT NULL,             -- full YAML manifest
    sync_status     TEXT NOT NULL DEFAULT 'Unknown',
    health_status   TEXT NOT NULL DEFAULT 'Unknown',
    last_synced_sha TEXT,                      -- last successfully synced commit
    head_sha        TEXT,                      -- current HEAD of tracked branch
    last_sync_time  TIMESTAMP,
    last_error      TEXT,
    services_json   TEXT,                      -- JSON array of ServiceStatus
    conditions_json TEXT,                      -- JSON array of AppCondition
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sync history (every sync attempt, successful or not)
CREATE TABLE IF NOT EXISTS sync_history (
    id           TEXT PRIMARY KEY,             -- UUID
    app_name     TEXT NOT NULL,                -- FK to applications.name
    started_at   TIMESTAMP NOT NULL,
    finished_at  TIMESTAMP,
    commit_sha   TEXT,
    operation    TEXT NOT NULL,                 -- poll, manual, self-heal
    result       TEXT NOT NULL,                 -- success, failure, skipped
    diff_json    TEXT,                          -- JSON DiffResult
    error        TEXT,
    duration_ms  INTEGER,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (app_name) REFERENCES applications(name) ON DELETE CASCADE
);

-- Application events (state transitions, conditions)
CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,               -- UUID
    app_name   TEXT NOT NULL,                  -- FK to applications.name
    type       TEXT NOT NULL,                  -- SyncStarted, SyncCompleted, HealthChanged, etc.
    message    TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info',   -- info, warning, error
    data_json  TEXT,                           -- optional structured data
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (app_name) REFERENCES applications(name) ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sync_history_app_name ON sync_history(app_name);
CREATE INDEX IF NOT EXISTS idx_sync_history_started_at ON sync_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_name ON events(app_name);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
```

### 6.2 Migration Strategy

Migrations are embedded in the Go binary using `embed.FS`:

```go
//go:embed migrations/*.sql
var migrationsFS embed.FS

func (s *Store) Migrate() error {
    currentVersion := s.getCurrentVersion()

    entries, _ := migrationsFS.ReadDir("migrations")
    for _, entry := range entries {
        version := parseVersion(entry.Name()) // e.g., "001_initial.sql" -> 1
        if version <= currentVersion {
            continue
        }

        sql, _ := migrationsFS.ReadFile("migrations/" + entry.Name())
        tx, _ := s.db.Begin()
        tx.Exec(string(sql))
        tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version)
        tx.Commit()
    }
    return nil
}
```

Migration files follow naming convention: `{NNN}_{description}.sql` (e.g., `001_initial.sql`).

### 6.3 Transaction Patterns

All write operations use explicit transactions:

```go
func (s *Store) RecordSync(result *app.SyncResult) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Insert sync record
    _, err = tx.ExecContext(ctx,
        "INSERT INTO sync_history (id, app_name, started_at, finished_at, commit_sha, operation, result, diff_json, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        result.ID, result.AppName, result.StartedAt, result.FinishedAt,
        result.CommitSHA, result.Operation, result.Result,
        marshalJSON(result.Diff), result.Error, result.DurationMs,
    )
    if err != nil {
        return err
    }

    // Update app status
    _, err = tx.ExecContext(ctx,
        "UPDATE applications SET sync_status = ?, last_synced_sha = ?, last_sync_time = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
        result.appSyncStatus(), result.CommitSHA, result.FinishedAt,
        result.Error, result.AppName,
    )
    if err != nil {
        return err
    }

    // Insert event
    _, err = tx.ExecContext(ctx,
        "INSERT INTO events (id, app_name, type, message, severity) VALUES (?, ?, ?, ?, ?)",
        uuid(), result.AppName, "SyncCompleted",
        fmt.Sprintf("Sync %s: %s", result.Result, result.Diff.Summary),
        severityFromResult(result),
    )
    if err != nil {
        return err
    }

    return tx.Commit()
}
```

### 6.4 Data Retention

- **sync_history**: Retain last 100 records per application. A cleanup job runs after each sync and deletes older records.
- **events**: Retain last 500 records per application. Same cleanup pattern.
- **applications**: Never automatically deleted. Removed only by explicit API call or manifest removal.

---

## 7. API Design

### 7.1 Endpoint Overview

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/v1/applications` | List all applications | `ApplicationList` |
| `GET` | `/api/v1/applications/{name}` | Get application detail | `Application` |
| `POST` | `/api/v1/applications/{name}/sync` | Trigger sync | `SyncResult` |
| `GET` | `/api/v1/applications/{name}/diff` | Get current diff | `DiffResult` |
| `GET` | `/api/v1/applications/{name}/events` | Get application events | `EventList` |
| `GET` | `/api/v1/applications/{name}/history` | Get sync history | `SyncHistoryList` |
| `GET` | `/healthz` | Liveness probe | `{"status": "ok"}` |
| `GET` | `/readyz` | Readiness probe | `{"status": "ready"}` |

### 7.2 Request/Response Schemas

#### GET /api/v1/applications

```json
{
  "items": [
    {
      "metadata": {"name": "my-app"},
      "spec": { "..." },
      "status": {
        "syncStatus": "Synced",
        "healthStatus": "Healthy",
        "lastSyncedSHA": "abc123",
        "lastSyncTime": "2026-02-15T10:30:00Z",
        "services": [
          {"name": "web", "image": "nginx:1.25", "health": "Healthy", "state": "running"},
          {"name": "api", "image": "myapp:v2", "health": "Healthy", "state": "running"}
        ]
      }
    }
  ],
  "total": 1
}
```

#### GET /api/v1/applications/{name}

Returns a single `Application` object with full spec and status (same schema as list items, but with complete detail).

#### POST /api/v1/applications/{name}/sync

Request body is optional. If empty, triggers a standard sync. Optional fields:

```json
{
  "prune": true,
  "revision": "specific-commit-sha"
}
```

Response:

```json
{
  "id": "sync-uuid",
  "appName": "my-app",
  "startedAt": "2026-02-15T10:35:00Z",
  "finishedAt": "2026-02-15T10:35:12Z",
  "commitSHA": "abc123",
  "operation": "manual",
  "result": "success",
  "diff": {
    "inSync": false,
    "toUpdate": [
      {
        "serviceName": "api",
        "changeType": "update",
        "fields": [
          {"field": "image", "desired": "myapp:v3", "live": "myapp:v2"}
        ]
      }
    ],
    "summary": "1 to update (image changed)"
  },
  "durationMs": 12340
}
```

#### GET /api/v1/applications/{name}/diff

Returns the current diff without triggering a sync. Performs a live git-fetch + parse + inspect + diff operation.

```json
{
  "inSync": false,
  "toCreate": [],
  "toUpdate": [
    {
      "serviceName": "api",
      "changeType": "update",
      "fields": [
        {"field": "image", "desired": "myapp:v3", "live": "myapp:v2"}
      ]
    }
  ],
  "toRemove": [],
  "summary": "1 to update (image changed: myapp:v2 -> myapp:v3)"
}
```

#### GET /api/v1/applications/{name}/events

Query parameters: `?limit=50&type=SyncCompleted`

```json
{
  "items": [
    {
      "id": "evt-uuid",
      "appName": "my-app",
      "type": "SyncCompleted",
      "message": "Sync success: 1 to update (image changed)",
      "severity": "info",
      "createdAt": "2026-02-15T10:35:12Z"
    }
  ],
  "total": 42
}
```

#### GET /api/v1/applications/{name}/history

Query parameters: `?limit=20`

```json
{
  "items": [
    {
      "id": "sync-uuid",
      "appName": "my-app",
      "startedAt": "2026-02-15T10:35:00Z",
      "finishedAt": "2026-02-15T10:35:12Z",
      "commitSHA": "abc123",
      "operation": "poll",
      "result": "success",
      "durationMs": 12340
    }
  ],
  "total": 15
}
```

#### Error Response Schema

All error responses follow this format:

```json
{
  "error": "application not found: my-app",
  "code": "NOT_FOUND"
}
```

Error codes: `NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_ERROR`, `CONFLICT` (sync already in progress), `UNAVAILABLE` (Docker API down).

#### GET /healthz

```json
{"status": "ok"}
```

Returns HTTP 200 if the process is alive. No dependency checks -- this is a liveness probe.

#### GET /readyz

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "docker": "ok"
  }
}
```

Returns HTTP 200 if the system is ready to serve requests. Checks SQLite connectivity and Docker socket accessibility. Returns HTTP 503 if any check fails.

### 7.3 Middleware Stack

```go
r := chi.NewRouter()

// Middleware (applied in order)
r.Use(middleware.RequestID)       // X-Request-ID header
r.Use(middleware.RealIP)          // Trust X-Forwarded-For
r.Use(requestLogger)             // slog-based request logging
r.Use(middleware.Recoverer)      // Panic recovery -> 500
r.Use(middleware.Timeout(30s))   // Request timeout
r.Use(contentTypeJSON)           // Set Content-Type: application/json

// Routes
r.Get("/healthz", healthz)
r.Get("/readyz", readyz)

r.Route("/api/v1", func(r chi.Router) {
    r.Route("/applications", func(r chi.Router) {
        r.Get("/", listApplications)
        r.Route("/{name}", func(r chi.Router) {
            r.Get("/", getApplication)
            r.Post("/sync", syncApplication)
            r.Get("/diff", diffApplication)
            r.Get("/events", getEvents)
            r.Get("/history", getHistory)
        })
    })
})
```

---

## 8. Project Structure

```
src/
    cmd/
        dockercd/
            main.go                 # Entry point, wires dependencies
    internal/
        app/
            types.go                # All domain types (Application, Status, etc.)
            validation.go           # Manifest validation logic
            duration.go             # Custom Duration type with YAML/JSON marshaling
        config/
            config.go               # Config struct and loading
            defaults.go             # Default values
        store/
            store.go                # Store interface and SQLite implementation
            queries.go              # SQL query methods
            migrations.go           # Migration runner
            migrations/
                001_initial.sql     # Initial schema
        gitsync/
            gitsync.go              # GitSyncer interface and implementation
            cache.go                # Repository cache management
        parser/
            parser.go               # ComposeParser interface and implementation
            merge.go                # Compose file merge logic
            substitute.go           # Variable substitution
            normalize.go            # State normalization
        inspector/
            inspector.go            # StateInspector interface and implementation
            mapping.go              # Docker state to ServiceState mapping
        differ/
            differ.go               # StateDiffer interface and implementation
            compare.go              # Field-level comparison functions
            summary.go              # Human-readable summary generation
        deployer/
            deployer.go             # Deployer interface and implementation
            compose.go              # Docker compose CLI wrapper
        health/
            health.go               # HealthChecker interface and implementation
            aggregator.go           # Worst-child-status aggregation
        events/
            watcher.go              # EventWatcher interface and implementation
            debounce.go             # Event debouncing logic
        reconciler/
            reconciler.go           # Reconciler interface and implementation
            scheduler.go            # Poll scheduling and work queue
            worker.go               # Worker pool
        api/
            server.go               # HTTP server setup and middleware
            handlers.go             # Request handlers
            responses.go            # Response types and helpers
        cli/
            root.go                 # Root cobra command
            serve.go                # serve subcommand
            app.go                  # app subcommand group
            app_list.go             # app list subcommand
            app_get.go              # app get subcommand
            app_sync.go             # app sync subcommand
            app_diff.go             # app diff subcommand
    go.mod
    go.sum
    Dockerfile
    Makefile
    docker-compose.yml              # For running dockercd itself
    examples/
        simple-app.yaml             # Example: single-service app
        multi-service-app.yaml      # Example: web + api + db
        app-with-healthchecks.yaml  # Example: app with health monitoring
```

### 8.1 File Counts by Phase

| Phase | New Files | Cumulative |
|-------|-----------|-----------|
| Phase 1: Scaffolding | 12 | 12 |
| Phase 2: Git Sync | 3 | 15 |
| Phase 3: Parser + Inspector | 8 | 23 |
| Phase 4: Diff Engine | 4 | 27 |
| Phase 5: Deployer | 3 | 30 |
| Phase 6: Reconciler | 4 | 34 |
| Phase 7: Health + Events | 5 | 39 |
| Phase 8: API + CLI | 9 | 48 |
| Phase 9: Container + Integration | 4 | 52 |
| Phase 10: Docs + Examples | 7 | 59 |

---

## 9. Interface Definitions

Every module boundary is defined by a Go interface. Implementations are injected via constructor parameters. This enables independent unit testing with mocks.

```go
// === internal/gitsync/gitsync.go ===

// GitSyncer manages Git repository cloning, pulling, and change detection.
type GitSyncer interface {
    // Sync fetches the latest state of the repository and returns the HEAD commit SHA.
    // If the repository is not yet cloned, it performs an initial clone.
    // Returns the commit SHA of HEAD after sync.
    Sync(ctx context.Context, source app.SourceSpec) (commitSHA string, err error)

    // RepoPath returns the local filesystem path to the cloned repository
    // for the given application. Returns empty string if not yet cloned.
    RepoPath(appName string) string

    // Close releases resources (e.g., file locks on cached repos).
    Close() error
}


// === internal/parser/parser.go ===

// ComposeParser parses Docker Compose files into a normalized desired state.
type ComposeParser interface {
    // Parse reads compose files from the given directory, merges them in order,
    // substitutes variables from .env, and returns the normalized ComposeSpec.
    Parse(ctx context.Context, repoPath string, composeFiles []string) (*app.ComposeSpec, error)
}


// === internal/inspector/inspector.go ===

// StateInspector queries the Docker daemon for the current live state
// of containers belonging to a compose project.
type StateInspector interface {
    // Inspect returns the live state of all containers belonging to the given
    // compose project on the specified Docker host.
    Inspect(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceState, error)

    // InspectService returns the live state of a single service by name.
    InspectService(ctx context.Context, dest app.DestinationSpec, serviceName string) (*app.ServiceState, error)
}


// === internal/differ/differ.go ===

// StateDiffer computes the difference between desired and live state.
type StateDiffer interface {
    // Diff compares the desired service specs against the live service states
    // and returns a structured diff result.
    Diff(desired []app.ServiceSpec, live []app.ServiceState) *app.DiffResult
}


// === internal/deployer/deployer.go ===

// DeployRequest contains the parameters for a deployment operation.
type DeployRequest struct {
    // ProjectName is the Docker Compose project name.
    ProjectName string

    // ComposeFiles is the list of compose file paths to use.
    ComposeFiles []string

    // Pull indicates whether to pull images before deploying.
    Pull bool

    // Prune indicates whether to remove orphaned containers.
    Prune bool

    // DockerHost is the Docker daemon socket path.
    DockerHost string
}

// Deployer executes Docker Compose operations to reconcile state.
type Deployer interface {
    // Deploy executes a deployment operation (pull + up + optional prune).
    Deploy(ctx context.Context, req DeployRequest) error
}


// === internal/health/health.go ===

// HealthResult contains the result of a health check operation.
type HealthResult struct {
    // Healthy is true if all services are healthy.
    Healthy bool

    // AggregateHealth is the worst-child-status across all services.
    AggregateHealth app.HealthStatus

    // Services is the per-service health breakdown.
    Services []app.ServiceStatus

    // Summary is a human-readable health summary.
    Summary string
}

// HealthChecker monitors container health status.
type HealthChecker interface {
    // CheckNow performs an immediate health check and returns the current state.
    CheckNow(ctx context.Context, dest app.DestinationSpec) (*HealthResult, error)

    // WaitForHealthy polls health status until all services are healthy
    // or the timeout expires. Returns the final health state.
    WaitForHealthy(ctx context.Context, dest app.DestinationSpec, timeout time.Duration) (*HealthResult, error)
}


// === internal/events/watcher.go ===

// ReconcileTrigger is the minimal interface the event watcher needs
// to trigger reconciliation. This avoids a direct dependency on the
// full Reconciler.
type ReconcileTrigger interface {
    // TriggerReconcile queues an immediate reconciliation for the named app.
    TriggerReconcile(appName string)
}

// EventWatcher subscribes to Docker events and triggers reconciliation
// for self-healing when containers die unexpectedly.
type EventWatcher interface {
    // Start begins watching Docker events. Blocks until ctx is canceled.
    Start(ctx context.Context) error

    // Stop gracefully stops the watcher.
    Stop() error
}


// === internal/reconciler/reconciler.go ===

// Reconciler orchestrates the reconciliation loop for all applications.
type Reconciler interface {
    // Start begins the reconciliation loop. Blocks until ctx is canceled.
    Start(ctx context.Context) error

    // Stop gracefully stops the reconciler and waits for in-flight
    // reconciliations to complete (with timeout).
    Stop(ctx context.Context) error

    // TriggerReconcile queues an immediate reconciliation for the named app.
    // This is called by the API (manual sync) and event watcher (self-heal).
    TriggerReconcile(appName string)

    // ReconcileNow performs a synchronous reconciliation for the named app.
    // Used by CLI commands that need to wait for the result.
    ReconcileNow(ctx context.Context, appName string) (*app.SyncResult, error)
}


// === internal/store/store.go ===

// Store provides persistence for application state, sync history, and events.
type Store interface {
    // Application CRUD
    ListApplications(ctx context.Context) ([]app.Application, error)
    GetApplication(ctx context.Context, name string) (*app.Application, error)
    SaveApplication(ctx context.Context, application *app.Application) error
    DeleteApplication(ctx context.Context, name string) error
    UpdateAppStatus(ctx context.Context, name string, status *app.AppStatus) error

    // Sync history
    RecordSync(ctx context.Context, result *app.SyncResult) error
    GetSyncHistory(ctx context.Context, appName string, limit int) ([]app.SyncResult, error)

    // Events
    RecordEvent(ctx context.Context, appName string, eventType string, message string, severity string) error
    GetEvents(ctx context.Context, appName string, limit int, eventType string) ([]app.AppCondition, error)

    // Lifecycle
    Migrate() error
    Close() error

    // Health
    Ping(ctx context.Context) error
}
```

---

## 10. Concurrency Model

### 10.1 Goroutine Architecture

```
main goroutine
    |
    +-- signal handler (SIGINT, SIGTERM)
    |
    +-- store.Migrate()  (synchronous on startup)
    |
    +-- app loader (reads manifests from config dir, saves to store)
    |
    +-- goroutine: reconciler.Start(ctx)
    |       |
    |       +-- goroutine: scheduler loop
    |       |       reads schedule map, pushes to workQueue
    |       |
    |       +-- goroutine pool: N workers (default 4)
    |               each reads from workQueue channel
    |               acquires per-app mutex
    |               runs reconciliation algorithm
    |               releases mutex
    |
    +-- goroutine: eventWatcher.Start(ctx)
    |       subscribes to Docker event stream
    |       debounces events
    |       calls reconciler.TriggerReconcile()
    |
    +-- goroutine: apiServer.ListenAndServe()
    |       handles HTTP requests
    |       calls reconciler.ReconcileNow() for sync endpoint
    |       calls store for read endpoints
    |
    +-- <blocks on ctx.Done()>
    |
    +-- graceful shutdown sequence
```

### 10.2 Channels and Synchronization

```go
type ReconcilerImpl struct {
    // Worker pool
    workQueue chan string        // buffered channel, capacity = 2 * workerCount
    workers   int               // number of worker goroutines

    // Scheduling
    schedule  map[string]time.Time  // protected by scheduleMu
    scheduleMu sync.RWMutex
    trigger   chan string            // unbuffered, for immediate reconciliation

    // Per-app locking
    appLocks  sync.Map              // map[string]*sync.Mutex

    // State tracking
    reconciling sync.Map            // map[string]bool -- apps currently being reconciled

    // Dependencies (injected)
    gitSyncer  gitsync.GitSyncer
    parser     parser.ComposeParser
    inspector  inspector.StateInspector
    differ     differ.StateDiffer
    deployer   deployer.Deployer
    health     health.HealthChecker
    store      store.Store

    // Lifecycle
    wg         sync.WaitGroup       // tracks active workers
    logger     *slog.Logger
}
```

### 10.3 Worker Pool Implementation

```go
func (r *ReconcilerImpl) Start(ctx context.Context) error {
    // Start workers
    for i := 0; i < r.workers; i++ {
        r.wg.Add(1)
        go r.worker(ctx, i)
    }

    // Start scheduler
    r.wg.Add(1)
    go r.schedulerLoop(ctx)

    // Wait for shutdown
    <-ctx.Done()

    // Drain work queue (don't accept new work)
    close(r.workQueue)

    // Wait for in-flight work to complete (with timeout)
    done := make(chan struct{})
    go func() { r.wg.Wait(); close(done) }()

    select {
    case <-done:
        return nil
    case <-time.After(30 * time.Second):
        return fmt.Errorf("shutdown timeout: workers did not finish in 30s")
    }
}

func (r *ReconcilerImpl) worker(ctx context.Context, id int) {
    defer r.wg.Done()
    logger := r.logger.With("worker", id)

    for appName := range r.workQueue {
        // Acquire per-app lock (non-blocking)
        lock := r.getAppLock(appName)
        if !lock.TryLock() {
            logger.Debug("app already being reconciled, skipping", "app", appName)
            continue
        }

        r.reconciling.Store(appName, true)
        result, err := r.reconcileApp(ctx, appName)
        r.reconciling.Delete(appName)
        lock.Unlock()

        if err != nil {
            logger.Error("reconciliation failed", "app", appName, "error", err)
        } else {
            logger.Info("reconciliation complete",
                "app", appName,
                "result", result.Result,
                "duration_ms", result.DurationMs,
            )
        }
    }
}
```

### 10.4 Graceful Shutdown Sequence

```
1. SIGINT/SIGTERM received
2. Cancel root context (signals all goroutines)
3. API server: stop accepting new connections, drain in-flight requests (5s timeout)
4. Event watcher: close Docker event subscription, return
5. Reconciler:
   a. Scheduler: stop scheduling new work
   b. Close workQueue channel (workers drain remaining items)
   c. Wait for in-flight reconciliations to complete (30s timeout)
   d. If timeout: log warning, abandon in-flight work
6. Store: close SQLite connection
7. Exit with code 0
```

**Context propagation**: All long-running operations accept `context.Context`. When the root context is canceled:
- Git operations (clone/pull) are interrupted via go-git's context support.
- Docker API calls are interrupted via the SDK's context support.
- Docker compose CLI operations are killed via `exec.CommandContext`.
- SQL queries are interrupted via `database/sql`'s context support.

---

## 11. Error Handling and Resilience

### 11.1 Error Categories and Responses

| Error Category | Example | Response | Recovery |
|---------------|---------|----------|----------|
| Git unreachable | Network timeout, auth failure | Log error, set GitError condition | Retry next poll interval |
| Git clone corrupted | Partial clone, disk error | Delete cache, re-clone | Automatic on next sync |
| Compose parse error | Invalid YAML, unknown directive | Log error, set ParseError condition, mark Degraded | Fix compose file in Git |
| Docker socket unavailable | Permission denied, daemon down | Log error, readyz returns 503 | Retry with backoff |
| Docker API error | Container inspect fails | Log error, skip this app | Retry next poll interval |
| Deploy failure | Image not found, resource limits | Log error, set DeployError condition, mark Degraded | Fix compose file or registry |
| Health timeout | Services never become healthy | Mark as failed sync, Degraded health | Operator investigation |
| SQLite error | Disk full, corruption | Log error, retry with backoff | After 5 failures: graceful shutdown |
| Panic | Nil pointer, array bounds | Recover in middleware/worker, log stack trace, continue | Automatic |

### 11.2 Retry Strategy

```go
// RetryConfig defines the retry behavior for a specific operation.
type RetryConfig struct {
    MaxAttempts int           // Maximum number of attempts (including first)
    InitialWait time.Duration // Wait time before first retry
    MaxWait     time.Duration // Maximum wait time (cap for exponential backoff)
    Multiplier  float64       // Backoff multiplier (e.g., 2.0 for doubling)
}

// Default retry configs
var (
    GitRetryConfig = RetryConfig{
        MaxAttempts: 3,
        InitialWait: 5 * time.Second,
        MaxWait:     30 * time.Second,
        Multiplier:  2.0,
    }

    DockerRetryConfig = RetryConfig{
        MaxAttempts: 3,
        InitialWait: 2 * time.Second,
        MaxWait:     10 * time.Second,
        Multiplier:  2.0,
    }

    DBRetryConfig = RetryConfig{
        MaxAttempts: 5,
        InitialWait: 1 * time.Second,
        MaxWait:     30 * time.Second,
        Multiplier:  2.0,
    }
)

func retry(ctx context.Context, cfg RetryConfig, op func() error) error {
    var lastErr error
    wait := cfg.InitialWait

    for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
        lastErr = op()
        if lastErr == nil {
            return nil
        }

        if attempt == cfg.MaxAttempts {
            break
        }

        select {
        case <-time.After(wait):
            wait = time.Duration(float64(wait) * cfg.Multiplier)
            if wait > cfg.MaxWait {
                wait = cfg.MaxWait
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }

    return fmt.Errorf("after %d attempts: %w", cfg.MaxAttempts, lastErr)
}
```

### 11.3 Circuit Breaker

Prevents runaway reconciliation when an application is in a broken state:

```go
type CircuitBreaker struct {
    mu              sync.Mutex
    failureCount    int
    lastFailure     time.Time
    state           CircuitState // closed, open, half-open

    maxFailures     int           // open circuit after this many consecutive failures
    resetTimeout    time.Duration // try again after this duration
}

const (
    CircuitClosed   CircuitState = "closed"   // normal operation
    CircuitOpen     CircuitState = "open"      // rejecting operations
    CircuitHalfOpen CircuitState = "half-open" // allowing one test operation
)
```

**Behavior**: After 3 consecutive sync failures for an application, the circuit opens. While open, reconciliation is skipped and the app remains in its last known state. After 5 minutes, the circuit moves to half-open and allows one reconciliation attempt. If it succeeds, the circuit closes. If it fails, the circuit re-opens.

The circuit breaker state is logged and visible in the app status as a condition.

### 11.4 Rate Limiting

Docker API calls are rate-limited to prevent overwhelming the daemon:

```go
// dockerLimiter limits Docker API calls to 50 per second.
// This prevents issues when reconciling many applications simultaneously.
var dockerLimiter = rate.NewLimiter(rate.Limit(50), 10) // 50/s with burst of 10
```

### 11.5 Partial Deployment Failure

When `docker compose up -d` fails partway (some services started, some did not):

1. Docker Compose itself handles rollback for individual service failures -- if a container cannot start, it logs the error but other services continue.
2. dockercd does NOT attempt to rollback successfully started services. This matches Docker Compose's native behavior.
3. The health monitor will detect the partial failure and mark the app as Degraded.
4. On the next reconciliation, the deployer will re-attempt `docker compose up -d`, which is idempotent -- already-running services are left alone, failed services are retried.

---

## 12. Configuration

### 12.1 Configuration Struct

```go
type Config struct {
    // DataDir is the base directory for persistent data.
    // Contains: SQLite database, Git repo cache.
    // Default: /data
    // Env: DOCKERCD_DATA_DIR
    DataDir string `mapstructure:"data_dir"`

    // ConfigDir is the directory containing application manifests.
    // Default: /config/applications
    // Env: DOCKERCD_CONFIG_DIR
    ConfigDir string `mapstructure:"config_dir"`

    // LogLevel controls the logging verbosity.
    // Values: debug, info, warn, error
    // Default: info
    // Env: DOCKERCD_LOG_LEVEL
    LogLevel string `mapstructure:"log_level"`

    // APIPort is the port for the REST API server.
    // Default: 8080
    // Env: DOCKERCD_API_PORT
    APIPort int `mapstructure:"api_port"`

    // DockerHost is the default Docker daemon socket path.
    // Can be overridden per-application in the manifest.
    // Default: unix:///var/run/docker.sock
    // Env: DOCKER_HOST
    DockerHost string `mapstructure:"docker_host"`

    // WorkerCount is the number of concurrent reconciliation workers.
    // Default: 4
    // Env: DOCKERCD_WORKER_COUNT
    WorkerCount int `mapstructure:"worker_count"`

    // DefaultPollInterval is the default poll interval for applications
    // that do not specify one.
    // Default: 180s
    // Env: DOCKERCD_DEFAULT_POLL_INTERVAL
    DefaultPollInterval time.Duration `mapstructure:"default_poll_interval"`
}
```

### 12.2 Validation Rules

```go
func (c *Config) Validate() error {
    if c.DataDir == "" {
        return errors.New("data_dir must not be empty")
    }
    if c.ConfigDir == "" {
        return errors.New("config_dir must not be empty")
    }
    if c.APIPort < 1 || c.APIPort > 65535 {
        return fmt.Errorf("api_port must be 1-65535, got %d", c.APIPort)
    }
    if c.WorkerCount < 1 || c.WorkerCount > 32 {
        return fmt.Errorf("worker_count must be 1-32, got %d", c.WorkerCount)
    }
    if c.DefaultPollInterval < 30*time.Second {
        return fmt.Errorf("default_poll_interval must be >= 30s, got %s", c.DefaultPollInterval)
    }
    validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
    if !validLevels[c.LogLevel] {
        return fmt.Errorf("log_level must be one of debug/info/warn/error, got %q", c.LogLevel)
    }
    return nil
}
```

### 12.3 Loading Order

1. Compiled-in defaults (in `defaults.go`)
2. Config file (`/etc/dockercd/config.yaml` or `$HOME/.dockercd/config.yaml`)
3. Environment variables (prefix `DOCKERCD_`)
4. CLI flags (highest priority)

Viper handles this merge automatically.

---

## 13. Logging Strategy

### 13.1 Logger Setup

```go
func NewLogger(level string) *slog.Logger {
    var lvl slog.Level
    switch level {
    case "debug":
        lvl = slog.LevelDebug
    case "info":
        lvl = slog.LevelInfo
    case "warn":
        lvl = slog.LevelWarn
    case "error":
        lvl = slog.LevelError
    default:
        lvl = slog.LevelInfo
    }

    handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: lvl,
        AddSource: lvl == slog.LevelDebug,
    })

    return slog.New(handler)
}
```

### 13.2 Log Events

| Event | Level | Context Fields |
|-------|-------|----------------|
| Reconciliation started | info | `app`, `trigger` (poll/manual/self-heal) |
| Git sync completed | info | `app`, `commitSHA`, `changed` (bool), `duration_ms` |
| Git sync failed | error | `app`, `repoURL`, `error` |
| Compose parse completed | debug | `app`, `serviceCount`, `duration_ms` |
| Compose parse failed | error | `app`, `file`, `line`, `error` |
| Live state inspected | debug | `app`, `containerCount`, `duration_ms` |
| Diff computed | info | `app`, `inSync`, `toCreate`, `toUpdate`, `toRemove`, `summary` |
| Deploy started | info | `app`, `commitSHA`, `pull` (bool), `prune` (bool) |
| Deploy completed | info | `app`, `commitSHA`, `duration_ms` |
| Deploy failed | error | `app`, `commitSHA`, `error`, `stderr` |
| Health changed | info | `app`, `service`, `from`, `to` |
| Health check timeout | warn | `app`, `timeout`, `unhealthyServices` |
| Self-heal triggered | info | `app`, `container`, `event` (die/stop/remove) |
| API request | info | `method`, `path`, `status`, `duration_ms`, `requestID` |
| Circuit breaker opened | warn | `app`, `consecutiveFailures` |
| Shutdown initiated | info | `signal` |
| Shutdown complete | info | `duration_ms` |

### 13.3 Log Output Format

```json
{
  "time": "2026-02-15T10:35:00.123Z",
  "level": "INFO",
  "msg": "reconciliation complete",
  "app": "my-app",
  "commitSHA": "abc1234",
  "result": "success",
  "duration_ms": 12340,
  "diff_summary": "1 to update (image changed: nginx:1.24 -> nginx:1.25)"
}
```

---

## 14. Security Considerations

### 14.1 Docker Socket Access

The Docker socket (`/var/run/docker.sock`) grants root-equivalent access to the host system. This is an inherent requirement for any tool that manages containers (Watchtower, Portainer, Traefik all use the same pattern).

**Mitigations for the PoC**:

1. **Non-root user**: The container runs as UID 1000, added to the `docker` group.
2. **Scope limitation**: Docker API calls are filtered by `com.docker.compose.project` label to only affect managed applications. dockercd never operates on containers outside its managed projects.
3. **Read-only where possible**: Inspection and event watching are read-only operations. Write operations (compose up/down) are limited to the deployer module.
4. **Documentation**: The README and deployment guide will clearly document the security implications and recommend running dockercd on a dedicated host or with a Docker socket proxy (e.g., Tecnativa/docker-socket-proxy).

### 14.2 Git Credentials

For the PoC, Git authentication is handled via HTTPS URL with embedded token:

```
https://token:x-oauth-basic@github.com/org/repo.git
```

**Mitigations**:
- Tokens in repo URLs are stored in application manifests on the filesystem, not in the database.
- Application manifests should be mounted as read-only volumes with restricted file permissions.
- Future enhancement: support for Git credential helpers, SSH keys, and secrets management integration.

### 14.3 API Security

The PoC API has no authentication or authorization. It is intended to be accessed from localhost or a trusted network only.

**Mitigations**:
- Default bind address is `0.0.0.0:8080` but can be restricted to `127.0.0.1` via config.
- Future enhancement: API key authentication, OAuth2, RBAC.
- Documentation recommends running behind a reverse proxy with authentication for non-local access.

### 14.4 Container Image Security

- Multi-stage build: only the compiled binary and necessary certificates are in the runtime image.
- Runtime base image: `gcr.io/distroless/static-debian12` (no shell, no package manager, minimal attack surface).
- Alternative: `alpine:3.19` if the `docker compose` CLI is needed (distroless cannot run external binaries). Since the deployer shells out to `docker compose`, Alpine is required.
- Image scanning: recommend running `docker scout` or `trivy` in CI.

---

## 15. Development Plan

### Phase 1: Project Scaffolding, Config, Store, App Model

**Goal**: Establish the project structure, build system, configuration loading, database schema, and core domain types. At the end of this phase, you can build the binary, load configuration, connect to SQLite, and create/list/get application records.

**Files created**:
- `src/go.mod`, `src/go.sum`
- `src/Makefile`
- `src/cmd/dockercd/main.go`
- `src/internal/app/types.go`
- `src/internal/app/validation.go`
- `src/internal/app/duration.go`
- `src/internal/config/config.go`
- `src/internal/config/defaults.go`
- `src/internal/store/store.go`
- `src/internal/store/queries.go`
- `src/internal/store/migrations.go`
- `src/internal/store/migrations/001_initial.sql`

**Interfaces implemented**: `Store`

**Tests**:
- `src/internal/app/validation_test.go` -- manifest validation (valid manifests, missing fields, invalid values)
- `src/internal/app/duration_test.go` -- Duration marshaling/unmarshaling
- `src/internal/config/config_test.go` -- config loading, defaults, validation
- `src/internal/store/store_test.go` -- CRUD operations, migrations, transactions (using in-memory SQLite)

**Deliverable**: `make build` produces a binary. `make test` passes. The binary starts, loads config, runs migrations, and exits.

---

### Phase 2: Git Sync Module

**Goal**: Clone and pull Git repositories, detect changes by commit SHA, manage local cache.

**Files created**:
- `src/internal/gitsync/gitsync.go`
- `src/internal/gitsync/cache.go`

**Interfaces implemented**: `GitSyncer`

**Tests**:
- `src/internal/gitsync/gitsync_test.go` -- clone, pull, change detection, cache management, error handling. Uses a temporary bare Git repo on the local filesystem (no network needed).

**Deliverable**: Given a git repo URL, clone it, detect when new commits appear, return the HEAD SHA. Handles errors (unreachable repo, corrupted cache).

---

### Phase 3: Compose File Parser + Live State Inspector

**Goal**: Parse Docker Compose YAML files into normalized desired state. Query Docker API for current live state.

**Files created**:
- `src/internal/parser/parser.go`
- `src/internal/parser/merge.go`
- `src/internal/parser/substitute.go`
- `src/internal/parser/normalize.go`
- `src/internal/inspector/inspector.go`
- `src/internal/inspector/mapping.go`

**Interfaces implemented**: `ComposeParser`, `StateInspector`

**Tests**:
- `src/internal/parser/parser_test.go` -- single file parsing, multi-file merge, variable substitution, normalization, error handling. Uses fixture YAML files (no Docker needed).
- `src/internal/parser/merge_test.go` -- override merge semantics (scalars, maps, lists).
- `src/internal/inspector/inspector_test.go` -- mocks Docker client, tests container-to-ServiceState mapping, label filtering, health status mapping.

**Deliverable**: Parse compose files into `ComposeSpec`. Query Docker for `[]ServiceState`. Both use the same data model for comparison.

---

### Phase 4: Diff Engine

**Goal**: Compare desired and live state to produce actionable diffs.

**Files created**:
- `src/internal/differ/differ.go`
- `src/internal/differ/compare.go`
- `src/internal/differ/summary.go`

**Interfaces implemented**: `StateDiffer`

**Tests**:
- `src/internal/differ/differ_test.go` -- comprehensive test cases:
  - All in sync (empty diff)
  - New service (ToCreate)
  - Removed service (ToRemove)
  - Image change (ToUpdate)
  - Environment variable change (ToUpdate)
  - Port change (ToUpdate)
  - Volume change (ToUpdate)
  - Multiple changes on one service
  - Multiple services with mixed changes
  - Edge cases: empty desired, empty live, both empty

**Deliverable**: Pure function module. Given desired and live state, produces a structured diff with human-readable summary. No I/O, no Docker, no Git -- fully testable with unit tests.

---

### Phase 5: Deployer Module

**Goal**: Execute Docker Compose CLI operations to reconcile state.

**Files created**:
- `src/internal/deployer/deployer.go`
- `src/internal/deployer/compose.go`

**Interfaces implemented**: `Deployer`

**Tests**:
- `src/internal/deployer/deployer_test.go` -- mocks exec.Command to test CLI argument construction, environment setup, error handling. Does not actually call Docker.

**Deliverable**: Given a `DeployRequest`, constructs and executes the correct `docker compose` commands. Captures and returns errors with stderr output.

---

### Phase 6: Reconciliation Loop

**Goal**: Wire together git sync, parser, inspector, differ, and deployer into the core reconciliation algorithm. Implement the scheduler and worker pool.

**Files created**:
- `src/internal/reconciler/reconciler.go`
- `src/internal/reconciler/scheduler.go`
- `src/internal/reconciler/worker.go`

**Interfaces implemented**: `Reconciler`

**Tests**:
- `src/internal/reconciler/reconciler_test.go` -- uses mock implementations of all dependencies. Tests the reconciliation algorithm:
  - No changes: skip
  - Changes detected, automated=true: deploy
  - Changes detected, automated=false: report only
  - Git error: condition set, no deploy
  - Parse error: condition set, Degraded status
  - Deploy error: condition set, Degraded status
  - Circuit breaker: opens after 3 failures, closes after success
- `src/internal/reconciler/scheduler_test.go` -- tests scheduling logic, trigger channel, work queue

**Deliverable**: The reconciler can orchestrate a full reconciliation cycle using mocked dependencies. The scheduler queues work correctly based on poll intervals and manual triggers.

---

### Phase 7: Health Monitor + Self-Healing (Events)

**Goal**: Monitor container health after deployment, compute application health. Subscribe to Docker events for self-healing.

**Files created**:
- `src/internal/health/health.go`
- `src/internal/health/aggregator.go`
- `src/internal/events/watcher.go`
- `src/internal/events/debounce.go`

**Interfaces implemented**: `HealthChecker`, `EventWatcher`

**Tests**:
- `src/internal/health/health_test.go` -- health status mapping (all Docker states), worst-child aggregation, timeout behavior (using mock inspector)
- `src/internal/health/aggregator_test.go` -- aggregation edge cases (all healthy, one degraded, mixed, empty)
- `src/internal/events/watcher_test.go` -- event filtering (compose labels), debouncing (multiple events within window), self-event suppression (using mock Docker client)

**Deliverable**: Health monitor polls and computes health. Event watcher triggers reconciliation on container die/stop events. Both are tested with mocks.

---

### Phase 8: API Server + CLI

**Goal**: REST API for programmatic access. CLI commands for interactive use.

**Files created**:
- `src/internal/api/server.go`
- `src/internal/api/handlers.go`
- `src/internal/api/responses.go`
- `src/internal/cli/root.go`
- `src/internal/cli/serve.go`
- `src/internal/cli/app.go`
- `src/internal/cli/app_list.go`
- `src/internal/cli/app_get.go`
- `src/internal/cli/app_sync.go`
- `src/internal/cli/app_diff.go`

**Interfaces implemented**: (API and CLI are consumers of existing interfaces, they do not define new ones)

**Tests**:
- `src/internal/api/handlers_test.go` -- HTTP handler tests using `httptest.NewRecorder()`. Tests all endpoints with mock store and reconciler. Tests error responses, content types, status codes.

**Deliverable**: `dockercd serve` starts the API server + reconciler + event watcher. CLI commands can list/get/sync/diff applications. API endpoints return JSON responses.

---

### Phase 9: Containerization + Integration Tests

**Goal**: Dockerfile, docker-compose.yml for running dockercd itself, and integration tests.

**Files created**:
- `src/Dockerfile`
- `docker-compose.yml` (for running dockercd)
- `src/internal/integration/reconcile_test.go` (integration test)
- `src/internal/integration/testdata/` (test fixtures: compose files, app manifests)

**Tests**:
- Integration test: starts a real Git repo (local bare repo), creates test containers, runs a full reconciliation cycle, verifies containers are created/updated/removed correctly. Uses `testcontainers-go` or direct Docker SDK for test setup.
- Build test: `docker build` succeeds, image size <100MB.

**Deliverable**: `docker build -t dockercd .` produces a working image. `docker compose up` runs dockercd with socket mounting. Integration tests pass with real Docker.

---

### Phase 10: Documentation + Examples

**Goal**: Complete documentation suite and example application manifests.

**Files created**:
- `README.md` (project overview, quick start, architecture summary)
- `docs/architecture.md` (this document, finalized)
- `docs/configuration.md` (all env vars, manifest schema, examples)
- `docs/development.md` (build, test, contribute)
- `examples/simple-app.yaml`
- `examples/multi-service-app.yaml`
- `examples/app-with-healthchecks.yaml`

**Tests**: None (documentation only).

**Deliverable**: A developer can read the docs, build the project, deploy an example app, and verify the reconciliation loop works.

---

### Phase Dependency Graph

```
Phase 1 (scaffolding)
    |
    +---> Phase 2 (git sync)
    |         |
    |         +---> Phase 3 (parser + inspector)
    |                   |
    |                   +---> Phase 4 (diff engine)
    |                             |
    |                             +---> Phase 5 (deployer)
    |                                       |
    |                                       +---> Phase 6 (reconciler)
    |                                                 |
    +---> Phase 7 (health + events) <-----------------+
              |
              +---> Phase 8 (API + CLI)
                        |
                        +---> Phase 9 (containerization)
                                  |
                                  +---> Phase 10 (docs)
```

Note: Phase 7 depends on both Phase 1 (store for persistence) and Phase 6 (reconciler for trigger interface), but development can start in parallel with Phases 4-5 since it uses mock dependencies.

---

## Appendix A: Alternatives Evaluated

### A.1 Compose Parsing: CLI vs Library

| Approach | Pros | Cons |
|----------|------|------|
| **Shell out to `docker compose config`** | Perfect parity with Docker Compose's own parser; handles all edge cases | Requires docker compose binary in image; slower (process spawn per parse); harder to test |
| **Direct YAML parsing (selected)** | No external dependency; testable with pure unit tests; fast | Must reimplement override merge semantics; may miss edge cases in complex compose files |
| **Use compose-go library** | Official Go library for compose parsing | Heavy dependency; API changes frequently; designed for Docker's internal use, not third-party |

**Decision**: Direct YAML parsing for the PoC. If edge cases become problematic, `docker compose config` is a straightforward fallback. The compose-go library was considered but its API surface is large and unstable.

### A.2 Deployment: SDK vs CLI

| Approach | Pros | Cons |
|----------|------|------|
| **Docker SDK only** | No external binary dependency; direct API access; testable | Must reimplement compose orchestration (service ordering, naming, network creation, labels) |
| **`docker compose` CLI (selected)** | Behavioral parity with what users expect; handles all orchestration logic | Requires compose CLI in image; shells out (process spawn); stderr parsing for errors |
| **Hybrid: SDK for inspection, CLI for deployment (selected)** | Best of both: structured data for reads, proven orchestration for writes | Two integration points to maintain |

**Decision**: Hybrid approach. The Docker SDK provides rich, structured data for inspection and event watching. The compose CLI provides correct, battle-tested orchestration for deployments. This is the same pattern used by other tools in the ecosystem.

### A.3 Database: SQLite vs Bolt vs No Persistence

| Approach | Pros | Cons |
|----------|------|------|
| **SQLite (selected)** | SQL query flexibility; relational data; transactions; well-understood | Schema management; slightly more complex setup |
| **BoltDB/bbolt** | Simpler K/V model; no schema; embedded | No SQL queries; manual indexing; less flexible querying |
| **In-memory only** | Simplest; no disk I/O | No persistence across restarts; no audit trail |

**Decision**: SQLite via `modernc.org/sqlite`. The relational model fits the data (applications have sync histories have diffs). SQL queries enable flexible filtering for the API. Pure Go compilation (no CGO) is essential for distroless images.

### A.4 Concurrency: Worker Pool vs Per-App Goroutine

| Approach | Pros | Cons |
|----------|------|------|
| **Worker pool (selected)** | Bounded concurrency; controllable resource usage; fair scheduling | More complex scheduling logic; apps may wait in queue |
| **Per-app goroutine** | Simple; each app is independent | Unbounded goroutines; all apps reconcile simultaneously; Docker API overload risk |

**Decision**: Worker pool with configurable size (default 4). This bounds the number of concurrent Docker API interactions and compose CLI executions. For a single-host deployment managing 5-20 applications, 4 workers provide adequate parallelism without overwhelming the Docker daemon.

---

## Appendix B: Risk Register

| # | Risk | Severity | Likelihood | Impact | Mitigation |
|---|------|----------|-----------|--------|------------|
| R1 | Docker socket grants root-equivalent access | High | Certain | Security compromise | Document clearly; recommend socket proxy; scope API calls by label |
| R2 | Reconciliation loops (infinite deploy cycles) | High | Medium | Resource exhaustion, service disruption | Circuit breaker (3 failures -> pause 5min); thorough diff engine testing |
| R3 | Large repos cause slow clones and disk exhaustion | Medium | Medium | Delayed reconciliation, disk pressure | Shallow clones (--depth 1); configurable cache cleanup |
| R4 | Compose file parsing edge cases | Medium | High | False diffs or missed changes | Start with core v3.8 features; document limitations; fallback to `docker compose config` |
| R5 | Health monitoring false positives | Medium | Medium | Unnecessary alerts, incorrect status | Conservative timeouts; per-app timeout config; verbose health logging |
| R6 | SQLite contention under load | Low | Low | Slow API responses, failed writes | WAL mode; connection pooling; bounded concurrent writers |
| R7 | go-git memory usage on large repos | Medium | Low | OOM in container | Shallow clones; memory limits in container; monitoring |
| R8 | Docker daemon overload from too many inspections | Medium | Low | Slow Docker operations for all containers | Rate limiter (50 req/s); bounded worker pool; inspection caching (future) |
| R9 | Partial deployment leaves inconsistent state | Medium | Medium | Some services updated, others not | Accept compose CLI's native behavior; no manual rollback; next reconciliation retries |
| R10 | Event stream disconnection misses container deaths | Medium | Low | Self-healing does not trigger | Reconnect with backoff; periodic full reconciliation catches missed events |

---

## Appendix C: Dockerfile

```dockerfile
# ---- Build stage ----
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /dockercd ./cmd/dockercd

# ---- Runtime stage ----
FROM alpine:3.19

# Install docker CLI (for docker compose plugin)
RUN apk add --no-cache \
    docker-cli \
    docker-cli-compose \
    ca-certificates \
    && addgroup -g 1000 dockercd \
    && adduser -u 1000 -G dockercd -s /bin/sh -D dockercd \
    && addgroup dockercd docker

COPY --from=builder /dockercd /usr/local/bin/dockercd

# Default directories
RUN mkdir -p /data /config/applications \
    && chown -R dockercd:dockercd /data /config

USER dockercd

VOLUME ["/data", "/config"]

EXPOSE 8080

ENTRYPOINT ["dockercd"]
CMD ["serve"]
```

**Image size estimate**: Alpine base (~7MB) + docker-cli (~50MB) + docker-compose plugin (~25MB) + dockercd binary (~15MB) = ~97MB compressed. Meets the <100MB target.

**Note**: Distroless cannot be used because the deployer shells out to `docker compose`. Alpine is the minimal alternative that supports external binaries.

---

## Appendix D: docker-compose.yml (for running dockercd)

```yaml
version: "3.8"

services:
  dockercd:
    image: dockercd:latest
    container_name: dockercd
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - dockercd-data:/data
      - ./applications:/config/applications:ro
    environment:
      - DOCKERCD_LOG_LEVEL=info
      - DOCKERCD_API_PORT=8080
      - DOCKERCD_DATA_DIR=/data
      - DOCKERCD_CONFIG_DIR=/config/applications

volumes:
  dockercd-data:
```

---

## Appendix E: Example Application Manifest

```yaml
# examples/simple-app.yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-web-app
spec:
  source:
    repoURL: https://github.com/example/my-web-app.git
    targetRevision: main
    path: deploy/
    composeFiles:
      - docker-compose.yml
      - docker-compose.prod.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-web-app
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 180s
    healthTimeout: 120s
```
