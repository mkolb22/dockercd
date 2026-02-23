package inspector

import (
	"github.com/docker/docker/api/types/container"
	"github.com/mkolb22/dockercd/internal/app"
)

// mapHealth maps Docker container state and health status to our HealthStatus model.
//
// Docker container states: created, running, paused, restarting, removing, exited, dead
// Docker health statuses (if healthcheck defined): starting, healthy, unhealthy, none
//
// Mapping:
//
//	running + healthy  → Healthy
//	running + starting → Progressing
//	running + none     → Healthy (no healthcheck defined, running is good enough)
//	running + unhealthy → Degraded
//	created / paused    → Progressing
//	restarting          → Degraded
//	exited / dead       → Unknown
func mapHealth(containerState string, detail container.InspectResponse) app.HealthStatus {
	switch containerState {
	case "running":
		return mapRunningHealth(detail)
	case "created", "paused":
		return app.HealthStatusProgressing
	case "restarting":
		return app.HealthStatusDegraded
	case "exited", "dead", "removing":
		return app.HealthStatusUnknown
	default:
		return app.HealthStatusUnknown
	}
}

// mapRunningHealth maps the health of a running container.
func mapRunningHealth(detail container.InspectResponse) app.HealthStatus {
	if detail.State == nil || detail.State.Health == nil {
		// No healthcheck configured — running is considered healthy
		return app.HealthStatusHealthy
	}

	switch detail.State.Health.Status {
	case "healthy":
		return app.HealthStatusHealthy
	case "starting":
		return app.HealthStatusProgressing
	case "unhealthy":
		return app.HealthStatusDegraded
	default:
		// "none" or any other value — running without healthcheck is healthy
		return app.HealthStatusHealthy
	}
}
