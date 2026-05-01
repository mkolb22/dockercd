// Package deployer provides blue-green deployment support on top of the standard
// Docker Compose deployer. When the com.dockercd.strategy label is set to
// "blue-green" on any service, BlueGreenDeployer wraps the inner Deployer and
// performs zero-downtime color switching.
package deployer

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
)

// colorBlue and colorGreen are the two deployment slots used in blue-green deployments.
const (
	colorBlue  = "blue"
	colorGreen = "green"
)

// defaultHealthPollInterval is how often to check health of the new color deployment.
const defaultHealthPollInterval = 5 * time.Second

// defaultHealthTimeout is the default timeout to wait for the new color to become healthy.
const defaultHealthTimeout = 120 * time.Second

// BlueGreenDeployer wraps an existing Deployer to implement blue-green deployment.
// It determines the currently active color, deploys the opposite color, waits
// for it to become healthy, then stops the old color. Traefik routing is updated
// automatically because it discovers services by scanning running container labels.
type BlueGreenDeployer struct {
	inner        Deployer
	inspector    inspector.StateInspector
	logger       *slog.Logger
	pollInterval time.Duration // how often to poll health; defaults to defaultHealthPollInterval
	timeout      time.Duration // health check timeout; defaults to defaultHealthTimeout
}

// NewBlueGreen creates a BlueGreenDeployer that wraps the given inner Deployer.
// The inspector is used to determine the active color and to poll health of the
// new color deployment.
func NewBlueGreen(inner Deployer, insp inspector.StateInspector, logger *slog.Logger) *BlueGreenDeployer {
	return &BlueGreenDeployer{
		inner:        inner,
		inspector:    insp,
		logger:       logger,
		pollInterval: defaultHealthPollInterval,
		timeout:      defaultHealthTimeout,
	}
}

// Deploy implements a blue-green deployment:
//  1. Determines the active color by inspecting {project}-blue and {project}-green.
//  2. Deploys the opposite color as a new project.
//  3. Waits for the new color to become healthy.
//  4. Stops the old color project.
//
// If the new color fails health checks, it is torn down and an error is returned.
func (bg *BlueGreenDeployer) Deploy(ctx context.Context, req DeployRequest) error {
	originalProject := req.ProjectName

	// Step 1: Determine active color.
	activeColor, err := bg.detectActiveColor(ctx, req)
	if err != nil {
		return fmt.Errorf("blue-green: detecting active color: %w", err)
	}
	newColor := oppositeColor(activeColor)

	bg.logger.Info("blue-green deployment starting",
		"project", originalProject,
		"activeColor", activeColor,
		"newColor", newColor,
	)

	// Step 2: Deploy the new color project.
	newProject := coloredProject(originalProject, newColor)
	newReq := req
	newReq.ProjectName = newProject

	bg.logger.Info("blue-green: deploying new color", "project", newProject)
	if err := bg.inner.Deploy(ctx, newReq); err != nil {
		return fmt.Errorf("blue-green: deploying %s: %w", newProject, err)
	}

	// Step 3: Wait for the new color to become healthy.
	newDest := app.DestinationSpec{
		DockerHost:  req.DockerHost,
		ProjectName: newProject,
	}

	bg.logger.Info("blue-green: waiting for new color to become healthy", "project", newProject)
	healthTimeout := bg.timeout
	if req.HealthTimeout > 0 {
		healthTimeout = req.HealthTimeout
	}
	if err := bg.waitForHealthy(ctx, newDest, healthTimeout); err != nil {
		// Health check failed — tear down the failed new color deployment.
		bg.logger.Error("blue-green: new color failed health check, tearing down",
			"project", newProject,
			"error", err,
		)
		downReq := req
		downReq.ProjectName = newProject
		if downErr := bg.inner.Down(ctx, downReq); downErr != nil {
			bg.logger.Error("blue-green: failed to clean up unhealthy deployment",
				"project", newProject,
				"error", downErr,
			)
		}
		return fmt.Errorf("blue-green: new color %s failed health check: %w", newProject, err)
	}

	bg.logger.Info("blue-green: new color is healthy", "project", newProject)

	// Step 4: Stop the old color project (if there was one).
	if activeColor != "" {
		oldProject := coloredProject(originalProject, activeColor)
		bg.logger.Info("blue-green: stopping old color", "project", oldProject)
		oldReq := req
		oldReq.ProjectName = oldProject
		if err := bg.inner.Down(ctx, oldReq); err != nil {
			// Log but don't fail — new color is already serving traffic.
			bg.logger.Error("blue-green: failed to stop old color (new color is live)",
				"project", oldProject,
				"error", err,
			)
		}
	}

	bg.logger.Info("blue-green deployment complete",
		"project", originalProject,
		"activeColor", newColor,
	)
	return nil
}

// Pull delegates to the inner deployer.
func (bg *BlueGreenDeployer) Pull(ctx context.Context, req DeployRequest) error {
	return bg.inner.Pull(ctx, req)
}

// DeployServices delegates to the inner deployer for interface completeness.
// Full blue-green application deployments should use Deploy so color switching
// and health gating remain atomic.
func (bg *BlueGreenDeployer) DeployServices(ctx context.Context, req DeployRequest, serviceNames []string) error {
	return bg.inner.DeployServices(ctx, req, serviceNames)
}

// Down stops both the blue and green color projects for the given base project.
func (bg *BlueGreenDeployer) Down(ctx context.Context, req DeployRequest) error {
	originalProject := req.ProjectName
	var lastErr error

	for _, color := range []string{colorBlue, colorGreen} {
		colorReq := req
		colorReq.ProjectName = coloredProject(originalProject, color)

		bg.logger.Info("blue-green: stopping color project", "project", colorReq.ProjectName)
		if err := bg.inner.Down(ctx, colorReq); err != nil {
			bg.logger.Error("blue-green: failed to stop color project",
				"project", colorReq.ProjectName,
				"error", err,
			)
			lastErr = err
		}
	}

	return lastErr
}

// RunHook delegates to the inner deployer.
func (bg *BlueGreenDeployer) RunHook(ctx context.Context, req DeployRequest, serviceName string) error {
	return bg.inner.RunHook(ctx, req, serviceName)
}

// detectActiveColor inspects {project}-blue and {project}-green to find which
// color has running containers. Returns an empty string if neither exists (first deploy).
func (bg *BlueGreenDeployer) detectActiveColor(ctx context.Context, req DeployRequest) (string, error) {
	color, _, _, ok, err := ActiveBlueGreenState(ctx, bg.inspector, app.DestinationSpec{
		DockerHost:  req.DockerHost,
		ProjectName: req.ProjectName,
	})
	if err != nil {
		return "", err
	}
	if !ok {
		return "", nil
	}
	return color, nil
}

// ActiveBlueGreenState inspects both color projects for a blue-green application
// and returns the currently active color, destination, and live state. A color is
// active when it has at least one running container.
func ActiveBlueGreenState(ctx context.Context, insp inspector.StateInspector, dest app.DestinationSpec) (string, app.DestinationSpec, []app.ServiceState, bool, error) {
	for _, color := range []string{colorBlue, colorGreen} {
		colorDest := app.DestinationSpec{
			DockerHost:  dest.DockerHost,
			ProjectName: coloredProject(dest.ProjectName, color),
		}

		states, err := insp.Inspect(ctx, colorDest)
		if err != nil {
			return "", app.DestinationSpec{}, nil, false, fmt.Errorf("inspecting %s project: %w", color, err)
		}

		// A color is "active" if it has at least one running container.
		for _, s := range states {
			if s.Status == "running" {
				return color, colorDest, states, true, nil
			}
		}
	}

	// Neither color has running containers — this is the first deployment.
	return "", app.DestinationSpec{}, nil, false, nil
}

// waitForHealthy polls the inspector until all containers in the given project
// are running and healthy, or the timeout expires.
func (bg *BlueGreenDeployer) waitForHealthy(ctx context.Context, dest app.DestinationSpec, timeout time.Duration) error {
	deadlineTimer := time.NewTimer(timeout)
	defer deadlineTimer.Stop()
	ticker := time.NewTicker(bg.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadlineTimer.C:
			return fmt.Errorf("timeout after %s waiting for %s to become healthy", timeout, dest.ProjectName)
		case <-ticker.C:
			states, err := bg.inspector.Inspect(ctx, dest)
			if err != nil {
				bg.logger.Debug("blue-green: health poll error", "project", dest.ProjectName, "error", err)
				continue
			}

			if len(states) == 0 {
				// No containers yet — keep waiting.
				continue
			}

			if allHealthy(states) {
				return nil
			}

			bg.logger.Debug("blue-green: waiting for healthy",
				"project", dest.ProjectName,
				"services", len(states),
			)
		}
	}
}

// allHealthy returns true when every container in states is running and healthy.
// A container without a healthcheck is considered healthy when running.
func allHealthy(states []app.ServiceState) bool {
	if len(states) == 0 {
		return false
	}
	for _, s := range states {
		switch s.Health {
		case app.HealthStatusHealthy:
			// Good.
		default:
			// Progressing, Degraded, or Unknown — not yet ready.
			return false
		}
	}
	return true
}

// coloredProject returns the project name with the given color suffix.
// e.g. coloredProject("myapp", "blue") → "myapp-blue"
func coloredProject(project, color string) string {
	return project + "-" + color
}

// oppositeColor returns the opposite deployment color.
// If activeColor is empty (first deploy), we default to deploying "blue".
func oppositeColor(activeColor string) string {
	switch activeColor {
	case colorBlue:
		return colorGreen
	default:
		// empty (first deploy) or green → blue
		return colorBlue
	}
}
