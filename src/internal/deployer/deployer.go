// Package deployer executes Docker Compose CLI operations to reconcile state.
// It shells out to the `docker compose` CLI rather than reimplementing compose
// orchestration through the Docker SDK, ensuring behavioral parity with what
// users expect from `docker compose up -d`.
package deployer

import "context"

// DeployRequest contains the parameters for a deployment operation.
type DeployRequest struct {
	// ProjectName is the Docker Compose project name.
	ProjectName string

	// ComposeFiles is the list of compose file paths to use.
	ComposeFiles []string

	// WorkDir is the working directory for the compose command.
	// Compose resolves relative paths (volumes, env_file) from this directory.
	WorkDir string

	// Pull indicates whether to pull images before deploying.
	Pull bool

	// Prune indicates whether to remove orphaned containers.
	Prune bool

	// DockerHost is the Docker daemon socket path.
	DockerHost string

	// PreSyncServices is the list of services with com.dockercd.hook=pre-sync.
	// These are run before the main deployment (pull + up).
	PreSyncServices []string

	// PostSyncServices is the list of services with com.dockercd.hook=post-sync.
	// These are run after a successful deployment. Failures are logged but do not
	// fail the overall deployment.
	PostSyncServices []string

	// TLSCertPath is the path to the TLS cert directory for remote Docker hosts.
	// When set, DOCKER_TLS_VERIFY=1 and DOCKER_CERT_PATH are injected into the
	// docker compose subprocess environment.
	TLSCertPath string
}

// Deployer executes Docker Compose operations to reconcile state.
type Deployer interface {
	// Deploy executes a deployment operation (pre-hooks + pull + up + post-hooks).
	Deploy(ctx context.Context, req DeployRequest) error

	// DeployServices deploys only the named services (for sync wave targeting).
	DeployServices(ctx context.Context, req DeployRequest, serviceNames []string) error

	// Down stops and removes all containers for the given project.
	Down(ctx context.Context, req DeployRequest) error

	// RunHook executes a single service as a one-shot container via docker compose run --rm.
	RunHook(ctx context.Context, req DeployRequest, serviceName string) error
}
