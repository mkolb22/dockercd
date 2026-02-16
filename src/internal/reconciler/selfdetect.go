package reconciler

import (
	"context"
	"log/slog"
	"os"

	"github.com/docker/docker/client"
)

// DetectSelfProject attempts to determine the Docker Compose project name
// that this process is running under. It reads the container ID from the
// hostname (Docker sets hostname to the container ID), inspects the container
// via the Docker API, and returns the com.docker.compose.project label.
//
// Returns "" if not running inside Docker or on any error (graceful degradation).
func DetectSelfProject(ctx context.Context, dockerHost string, logger *slog.Logger) string {
	hostname, err := os.Hostname()
	if err != nil {
		return ""
	}

	// Container IDs are 64-char hex strings; short hostnames are not container IDs
	if len(hostname) < 12 {
		return ""
	}

	opts := []client.Opt{
		client.WithAPIVersionNegotiation(),
	}
	if dockerHost != "" {
		opts = append(opts, client.WithHost(dockerHost))
	}

	cli, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return ""
	}
	defer cli.Close()

	info, err := cli.ContainerInspect(ctx, hostname)
	if err != nil {
		return ""
	}

	project := info.Config.Labels["com.docker.compose.project"]
	if project != "" {
		logger.Info("self-deployment protection enabled", "project", project, "containerID", hostname[:12])
	}

	return project
}
