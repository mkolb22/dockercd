package deployer

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
)

// CommandRunner abstracts exec.CommandContext for testing.
type CommandRunner func(ctx context.Context, name string, args ...string) *exec.Cmd

// ComposeDeployer implements Deployer using the docker compose CLI.
type ComposeDeployer struct {
	logger    *slog.Logger
	runCmd    CommandRunner
}

// New creates a ComposeDeployer with the default command runner.
func New(logger *slog.Logger) *ComposeDeployer {
	return &ComposeDeployer{
		logger: logger,
		runCmd: exec.CommandContext,
	}
}

// NewWithRunner creates a ComposeDeployer with a custom command runner (for testing).
func NewWithRunner(logger *slog.Logger, runner CommandRunner) *ComposeDeployer {
	return &ComposeDeployer{
		logger: logger,
		runCmd: runner,
	}
}

// Deploy executes a deployment: pre-sync hooks → optional pull → up -d → post-sync hooks.
// Pre-sync hook failures abort the deployment. Post-sync hook failures are logged but
// do not fail the overall operation.
func (d *ComposeDeployer) Deploy(ctx context.Context, req DeployRequest) error {
	// Step 1: Run pre-sync hooks
	for _, svc := range req.PreSyncServices {
		if err := d.RunHook(ctx, req, svc); err != nil {
			return fmt.Errorf("pre-sync hook failed: %w", err)
		}
	}

	// Step 2: Pull images (if requested)
	if req.Pull {
		pullArgs := d.baseArgs(req)
		pullArgs = append(pullArgs, "pull")

		d.logger.Info("pulling images",
			"project", req.ProjectName,
			"files", req.ComposeFiles,
		)

		if err := d.run(ctx, req, pullArgs); err != nil {
			return fmt.Errorf("pull failed: %w", err)
		}
	}

	// Step 3: Apply desired state
	upArgs := d.baseArgs(req)
	upArgs = append(upArgs, "up", "-d")
	if req.Prune {
		upArgs = append(upArgs, "--remove-orphans")
	}

	d.logger.Info("deploying",
		"project", req.ProjectName,
		"files", req.ComposeFiles,
		"prune", req.Prune,
	)

	if err := d.run(ctx, req, upArgs); err != nil {
		return fmt.Errorf("up failed: %w", err)
	}

	// Step 4: Run post-sync hooks (failures logged but do not fail the deploy)
	for _, svc := range req.PostSyncServices {
		if err := d.RunHook(ctx, req, svc); err != nil {
			d.logger.Error("post-sync hook failed",
				"project", req.ProjectName,
				"service", svc,
				"error", err,
			)
		}
	}

	return nil
}

// DeployServices deploys only the named services via docker compose up -d <services...>.
// This is used for sync wave deployment to apply one wave at a time.
func (d *ComposeDeployer) DeployServices(ctx context.Context, req DeployRequest, serviceNames []string) error {
	args := d.baseArgs(req)
	args = append(args, "up", "-d")
	args = append(args, serviceNames...)

	d.logger.Info("deploying services",
		"project", req.ProjectName,
		"services", serviceNames,
	)

	if err := d.run(ctx, req, args); err != nil {
		return fmt.Errorf("up services failed: %w", err)
	}
	return nil
}

// RunHook executes a single service as a one-shot container via docker compose run --rm.
func (d *ComposeDeployer) RunHook(ctx context.Context, req DeployRequest, serviceName string) error {
	args := d.baseArgs(req)
	args = append(args, "run", "--rm", serviceName)

	d.logger.Info("running hook",
		"project", req.ProjectName,
		"service", serviceName,
	)

	if err := d.run(ctx, req, args); err != nil {
		return fmt.Errorf("hook %q failed: %w", serviceName, err)
	}

	return nil
}

// Down stops and removes all containers, networks, and volumes for the project.
func (d *ComposeDeployer) Down(ctx context.Context, req DeployRequest) error {
	args := d.baseArgs(req)
	args = append(args, "down", "--remove-orphans")

	d.logger.Info("tearing down",
		"project", req.ProjectName,
	)

	if err := d.run(ctx, req, args); err != nil {
		return fmt.Errorf("down failed: %w", err)
	}

	return nil
}

// baseArgs builds the common docker compose arguments:
// compose -f file1.yml -f file2.yml -p projectName
func (d *ComposeDeployer) baseArgs(req DeployRequest) []string {
	args := []string{"compose"}

	for _, f := range req.ComposeFiles {
		args = append(args, "-f", f)
	}

	if req.ProjectName != "" {
		args = append(args, "-p", req.ProjectName)
	}

	return args
}

// run executes a docker CLI command and returns any error with stderr context.
func (d *ComposeDeployer) run(ctx context.Context, req DeployRequest, args []string) error {
	cmd := d.runCmd(ctx, "docker", args...)

	if req.WorkDir != "" {
		cmd.Dir = req.WorkDir
	}

	// Set DOCKER_HOST if specified
	if req.DockerHost != "" {
		cmd.Env = appendEnv(cmd.Env, "DOCKER_HOST="+req.DockerHost)
	}

	// Set TLS env vars for remote Docker hosts when a cert directory is configured
	if req.TLSCertPath != "" {
		cmd.Env = appendEnv(cmd.Env, "DOCKER_TLS_VERIFY=1")
		cmd.Env = appendEnv(cmd.Env, "DOCKER_CERT_PATH="+req.TLSCertPath)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	d.logger.Debug("executing command",
		"cmd", "docker",
		"args", args,
		"workdir", req.WorkDir,
	)

	if err := cmd.Run(); err != nil {
		errOutput := strings.TrimSpace(stderr.String())
		if errOutput != "" {
			return fmt.Errorf("%w: %s", err, errOutput)
		}
		return err
	}

	return nil
}

// appendEnv adds an environment variable to the cmd.Env slice.
// If cmd.Env is nil, it inherits the current process environment first,
// since setting Env to a non-nil slice replaces the entire environment.
func appendEnv(env []string, kv string) []string {
	if env == nil {
		env = os.Environ()
	}
	return append(env, kv)
}
