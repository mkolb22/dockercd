package inspector

import (
	"context"
	"sort"
	"testing"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/system"
	"github.com/docker/go-connections/nat"
	"github.com/mkolb22/dockercd/internal/app"
)

// mockDockerClient implements DockerClient for testing.
type mockDockerClient struct {
	containers    []container.Summary
	inspections   map[string]container.InspectResponse
	listErr       error
	inspectErrors map[string]error
}

func (m *mockDockerClient) ContainerList(_ context.Context, opts container.ListOptions) ([]container.Summary, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}

	// Filter by labels if present
	var result []container.Summary
	for _, c := range m.containers {
		match := true
		for _, f := range opts.Filters.Get("label") {
			found := false
			for k, v := range c.Labels {
				if k+"="+v == f {
					found = true
					break
				}
			}
			if !found {
				match = false
				break
			}
		}
		if match {
			result = append(result, c)
		}
	}
	return result, nil
}

func (m *mockDockerClient) ContainerInspect(_ context.Context, containerID string) (container.InspectResponse, error) {
	if err, ok := m.inspectErrors[containerID]; ok {
		return container.InspectResponse{}, err
	}
	if detail, ok := m.inspections[containerID]; ok {
		return detail, nil
	}
	return container.InspectResponse{}, nil
}

func (m *mockDockerClient) ContainerStatsOneShot(_ context.Context, _ string) (container.StatsResponseReader, error) {
	return container.StatsResponseReader{}, nil
}

func (m *mockDockerClient) Info(_ context.Context) (system.Info, error) {
	return system.Info{}, nil
}

func (m *mockDockerClient) DiskUsage(_ context.Context, _ types.DiskUsageOptions) (types.DiskUsage, error) {
	return types.DiskUsage{}, nil
}

func (m *mockDockerClient) Close() error { return nil }

func mockFactory(client DockerClient) ClientFactory {
	return func(host string) (DockerClient, error) {
		return client, nil
	}
}

func TestInspect_BasicService(t *testing.T) {
	mock := &mockDockerClient{
		containers: []container.Summary{
			{
				ID:    "abc123",
				Names: []string{"/myapp-web-1"},
				Image: "nginx:1.25",
				State: "running",
				Labels: map[string]string{
					"com.docker.compose.project": "myapp",
					"com.docker.compose.service": "web",
					"app.version":                "1.0",
				},
			},
		},
		inspections: map[string]container.InspectResponse{
			"abc123": {
				ContainerJSONBase: &container.ContainerJSONBase{
					State: &container.State{
						Running: true,
					},
					HostConfig: &container.HostConfig{
						RestartPolicy: container.RestartPolicy{
							Name: container.RestartPolicyAlways,
						},
					},
				},
				Config: &container.Config{
					Env: []string{"FOO=bar", "BAZ=qux"},
					Cmd: []string{"nginx", "-g", "daemon off;"},
				},
				NetworkSettings: &container.NetworkSettings{
					Networks: map[string]*network.EndpointSettings{
						"myapp_default": {},
					},
					NetworkSettingsBase: container.NetworkSettingsBase{ //nolint:staticcheck // Ports will move to NetworkSettings in v29
						Ports: nat.PortMap{
							"80/tcp": []nat.PortBinding{
								{HostPort: "8080"},
							},
						},
					},
				},
				Mounts: []container.MountPoint{
					{
						Type:        mount.TypeBind,
						Source:      "/host/data",
						Destination: "/app/data",
						RW:          true,
					},
				},
			},
		},
	}

	inspector := NewWithFactory(mockFactory(mock))
	dest := app.DestinationSpec{
		DockerHost:  "unix:///var/run/docker.sock",
		ProjectName: "myapp",
	}

	states, err := inspector.Inspect(context.Background(), dest)
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(states) != 1 {
		t.Fatalf("expected 1 service, got %d", len(states))
	}

	svc := states[0]
	if svc.Name != "web" {
		t.Errorf("expected service name 'web', got %q", svc.Name)
	}
	if svc.ContainerName != "myapp-web-1" {
		t.Errorf("expected container name 'myapp-web-1', got %q", svc.ContainerName)
	}
	if svc.Image != "nginx:1.25" {
		t.Errorf("expected image 'nginx:1.25', got %q", svc.Image)
	}
	if svc.Health != app.HealthStatusHealthy {
		t.Errorf("expected Healthy, got %s", svc.Health)
	}
	if svc.Environment["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", svc.Environment["FOO"])
	}
	if svc.RestartPolicy != "always" {
		t.Errorf("expected restart policy 'always', got %q", svc.RestartPolicy)
	}

	// Check user labels (compose labels should be filtered)
	if svc.Labels["app.version"] != "1.0" {
		t.Errorf("expected user label app.version=1.0, got %q", svc.Labels["app.version"])
	}
	if _, ok := svc.Labels["com.docker.compose.project"]; ok {
		t.Error("compose labels should be filtered out")
	}

	// Check ports
	if len(svc.Ports) != 1 || svc.Ports[0].HostPort != "8080" || svc.Ports[0].ContainerPort != "80" {
		t.Errorf("unexpected ports: %+v", svc.Ports)
	}

	// Check volumes
	if len(svc.Volumes) != 1 || svc.Volumes[0].Source != "/host/data" || svc.Volumes[0].Target != "/app/data" {
		t.Errorf("unexpected volumes: %+v", svc.Volumes)
	}

	// Check networks
	if len(svc.Networks) != 1 || svc.Networks[0] != "myapp_default" {
		t.Errorf("unexpected networks: %v", svc.Networks)
	}
}

func TestInspect_MultipleServices(t *testing.T) {
	mock := &mockDockerClient{
		containers: []container.Summary{
			{
				ID:    "web1",
				Names: []string{"/myapp-web-1"},
				Image: "nginx:1.25",
				State: "running",
				Labels: map[string]string{
					"com.docker.compose.project": "myapp",
					"com.docker.compose.service": "web",
				},
			},
			{
				ID:    "db1",
				Names: []string{"/myapp-db-1"},
				Image: "postgres:16",
				State: "running",
				Labels: map[string]string{
					"com.docker.compose.project": "myapp",
					"com.docker.compose.service": "db",
				},
			},
		},
		inspections: map[string]container.InspectResponse{
			"web1": {
				ContainerJSONBase: &container.ContainerJSONBase{
					State:      &container.State{Running: true},
					HostConfig: &container.HostConfig{},
				},
				Config:          &container.Config{},
				NetworkSettings: &container.NetworkSettings{},
			},
			"db1": {
				ContainerJSONBase: &container.ContainerJSONBase{
					State:      &container.State{Running: true},
					HostConfig: &container.HostConfig{},
				},
				Config:          &container.Config{},
				NetworkSettings: &container.NetworkSettings{},
			},
		},
	}

	inspector := NewWithFactory(mockFactory(mock))
	dest := app.DestinationSpec{ProjectName: "myapp"}

	states, err := inspector.Inspect(context.Background(), dest)
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(states) != 2 {
		t.Fatalf("expected 2 services, got %d", len(states))
	}

	names := make([]string, len(states))
	for i, s := range states {
		names[i] = s.Name
	}
	sort.Strings(names)
	if names[0] != "db" || names[1] != "web" {
		t.Errorf("expected [db web], got %v", names)
	}
}

func TestInspect_EmptyProject(t *testing.T) {
	mock := &mockDockerClient{
		containers: []container.Summary{},
	}

	inspector := NewWithFactory(mockFactory(mock))
	dest := app.DestinationSpec{ProjectName: "empty"}

	states, err := inspector.Inspect(context.Background(), dest)
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}

	if len(states) != 0 {
		t.Errorf("expected 0 services, got %d", len(states))
	}
}

func TestInspectService_Found(t *testing.T) {
	mock := &mockDockerClient{
		containers: []container.Summary{
			{
				ID:    "web1",
				Names: []string{"/myapp-web-1"},
				Image: "nginx:1.25",
				State: "running",
				Labels: map[string]string{
					"com.docker.compose.project": "myapp",
					"com.docker.compose.service": "web",
				},
			},
		},
		inspections: map[string]container.InspectResponse{
			"web1": {
				ContainerJSONBase: &container.ContainerJSONBase{
					State:      &container.State{Running: true},
					HostConfig: &container.HostConfig{},
				},
				Config:          &container.Config{},
				NetworkSettings: &container.NetworkSettings{},
			},
		},
	}

	inspector := NewWithFactory(mockFactory(mock))
	dest := app.DestinationSpec{ProjectName: "myapp"}

	state, err := inspector.InspectService(context.Background(), dest, "web")
	if err != nil {
		t.Fatalf("inspect service: %v", err)
	}
	if state == nil {
		t.Fatal("expected non-nil state")
	}
	if state.Name != "web" {
		t.Errorf("expected name 'web', got %q", state.Name)
	}
}

func TestInspectService_NotFound(t *testing.T) {
	mock := &mockDockerClient{
		containers: []container.Summary{},
	}

	inspector := NewWithFactory(mockFactory(mock))
	dest := app.DestinationSpec{ProjectName: "myapp"}

	state, err := inspector.InspectService(context.Background(), dest, "missing")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != nil {
		t.Errorf("expected nil state for missing service, got %+v", state)
	}
}

func TestFilterComposeLabels(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project": "myapp",
		"com.docker.compose.service": "web",
		"app.version":                "1.0",
		"maintainer":                 "team",
	}

	result := filterComposeLabels(labels)
	if len(result) != 2 {
		t.Fatalf("expected 2 user labels, got %d", len(result))
	}
	if result["app.version"] != "1.0" {
		t.Errorf("expected app.version=1.0, got %q", result["app.version"])
	}
	if result["maintainer"] != "team" {
		t.Errorf("expected maintainer=team, got %q", result["maintainer"])
	}
}

func TestFilterComposeLabels_AllCompose(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project": "myapp",
		"com.docker.compose.service": "web",
	}

	result := filterComposeLabels(labels)
	if result != nil {
		t.Errorf("expected nil when all labels are compose labels, got %v", result)
	}
}

func TestParseEnvList(t *testing.T) {
	env := []string{"FOO=bar", "BAZ=qux", "MULTI=a=b=c"}
	result := parseEnvList(env)

	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
	if result["BAZ"] != "qux" {
		t.Errorf("expected BAZ=qux, got %q", result["BAZ"])
	}
	if result["MULTI"] != "a=b=c" {
		t.Errorf("expected MULTI=a=b=c, got %q", result["MULTI"])
	}
}

func TestParseEnvList_Empty(t *testing.T) {
	result := parseEnvList(nil)
	if result != nil {
		t.Errorf("expected nil for empty env, got %v", result)
	}
}
