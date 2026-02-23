package inspector

import (
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/mkolb22/dockercd/internal/app"
)

func TestMapHealth_RunningNoHealthcheck(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{Running: true},
		},
	}
	health := mapHealth("running", detail)
	if health != app.HealthStatusHealthy {
		t.Errorf("expected Healthy for running without healthcheck, got %s", health)
	}
}

func TestMapHealth_RunningHealthy(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				Running: true,
				Health: &container.Health{
					Status: "healthy",
				},
			},
		},
	}
	health := mapHealth("running", detail)
	if health != app.HealthStatusHealthy {
		t.Errorf("expected Healthy, got %s", health)
	}
}

func TestMapHealth_RunningStarting(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				Running: true,
				Health: &container.Health{
					Status: "starting",
				},
			},
		},
	}
	health := mapHealth("running", detail)
	if health != app.HealthStatusProgressing {
		t.Errorf("expected Progressing, got %s", health)
	}
}

func TestMapHealth_RunningUnhealthy(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				Running: true,
				Health: &container.Health{
					Status: "unhealthy",
				},
			},
		},
	}
	health := mapHealth("running", detail)
	if health != app.HealthStatusDegraded {
		t.Errorf("expected Degraded, got %s", health)
	}
}

func TestMapHealth_Created(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{},
		},
	}
	health := mapHealth("created", detail)
	if health != app.HealthStatusProgressing {
		t.Errorf("expected Progressing for created, got %s", health)
	}
}

func TestMapHealth_Restarting(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{Restarting: true},
		},
	}
	health := mapHealth("restarting", detail)
	if health != app.HealthStatusDegraded {
		t.Errorf("expected Degraded for restarting, got %s", health)
	}
}

func TestMapHealth_Exited(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				ExitCode: 1,
			},
		},
	}
	health := mapHealth("exited", detail)
	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for exited, got %s", health)
	}
}

func TestMapHealth_Dead(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{Dead: true},
		},
	}
	health := mapHealth("dead", detail)
	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for dead, got %s", health)
	}
}

func TestMapHealth_Paused(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{Paused: true},
		},
	}
	health := mapHealth("paused", detail)
	if health != app.HealthStatusProgressing {
		t.Errorf("expected Progressing for paused, got %s", health)
	}
}

func TestMapHealth_UnknownState(t *testing.T) {
	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{},
		},
	}
	health := mapHealth("something-new", detail)
	if health != app.HealthStatusUnknown {
		t.Errorf("expected Unknown for unknown state, got %s", health)
	}
}

func TestMapContainerToState_FullMapping(t *testing.T) {
	c := container.Summary{
		ID:    "abc123",
		Names: []string{"/myapp-web-1"},
		Image: "nginx:1.25",
		State: "running",
		Labels: map[string]string{
			"com.docker.compose.service": "web",
			"com.docker.compose.project": "myapp",
			"custom.label":               "value",
		},
	}

	detail := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				Running: true,
				Health: &container.Health{
					Status: "healthy",
				},
			},
			HostConfig: &container.HostConfig{
				RestartPolicy: container.RestartPolicy{
					Name: container.RestartPolicyUnlessStopped,
				},
			},
		},
		Config: &container.Config{
			Env:        []string{"KEY=val"},
			Cmd:        []string{"nginx"},
			Entrypoint: []string{"/entrypoint.sh"},
		},
		NetworkSettings: &container.NetworkSettings{},
	}

	state := mapContainerToState(c, detail)

	if state.Name != "web" {
		t.Errorf("expected name 'web', got %q", state.Name)
	}
	if state.ContainerName != "myapp-web-1" {
		t.Errorf("expected container name 'myapp-web-1', got %q", state.ContainerName)
	}
	if state.Health != app.HealthStatusHealthy {
		t.Errorf("expected Healthy, got %s", state.Health)
	}
	if state.RestartPolicy != "unless-stopped" {
		t.Errorf("expected restart policy 'unless-stopped', got %q", state.RestartPolicy)
	}
	if state.Environment["KEY"] != "val" {
		t.Errorf("expected KEY=val, got %q", state.Environment["KEY"])
	}
	if len(state.Command) != 1 || state.Command[0] != "nginx" {
		t.Errorf("unexpected command: %v", state.Command)
	}
	if len(state.Entrypoint) != 1 || state.Entrypoint[0] != "/entrypoint.sh" {
		t.Errorf("unexpected entrypoint: %v", state.Entrypoint)
	}
	if state.Labels["custom.label"] != "value" {
		t.Errorf("expected custom label, got %v", state.Labels)
	}
}
