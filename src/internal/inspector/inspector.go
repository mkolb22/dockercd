// Package inspector queries the Docker daemon for the live state of containers
// belonging to a Docker Compose project.
package inspector

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/system"
	"github.com/docker/docker/client"
	"github.com/mkolb22/dockercd/internal/app"
)

// StateInspector queries the Docker daemon for current container state.
type StateInspector interface {
	// Inspect returns the live state of all containers belonging to the given
	// compose project on the specified Docker host.
	Inspect(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceState, error)

	// InspectService returns the live state of a single service by name.
	InspectService(ctx context.Context, dest app.DestinationSpec, serviceName string) (*app.ServiceState, error)

	// InspectWithMetrics returns service states with resource usage metrics.
	InspectWithMetrics(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceStatus, error)

	// SystemInfo returns Docker daemon system information.
	SystemInfo(ctx context.Context, dockerHost string) (*app.DockerHostInfo, error)
}

// DockerInspector implements StateInspector using the Docker SDK.
type DockerInspector struct {
	// clientFactory creates Docker clients for the given host.
	// This allows injecting mock clients for testing.
	clientFactory ClientFactory
}

// ClientFactory creates Docker API clients.
type ClientFactory func(host string) (DockerClient, error)

// DockerClient is the subset of the Docker client API we use.
// This interface enables mocking in tests.
type DockerClient interface {
	ContainerList(ctx context.Context, options container.ListOptions) ([]types.Container, error)
	ContainerInspect(ctx context.Context, containerID string) (types.ContainerJSON, error)
	ContainerStatsOneShot(ctx context.Context, containerID string) (container.StatsResponseReader, error)
	Info(ctx context.Context) (system.Info, error)
	Close() error
}

// New creates a DockerInspector with the default Docker client factory.
func New() *DockerInspector {
	return &DockerInspector{
		clientFactory: defaultClientFactory,
	}
}

// NewWithFactory creates a DockerInspector with a custom client factory (for testing).
func NewWithFactory(factory ClientFactory) *DockerInspector {
	return &DockerInspector{
		clientFactory: factory,
	}
}

func defaultClientFactory(host string) (DockerClient, error) {
	opts := []client.Opt{
		client.WithAPIVersionNegotiation(),
	}
	if host != "" {
		opts = append(opts, client.WithHost(host))
	}
	return client.NewClientWithOpts(opts...)
}

// Inspect returns the live state of all containers in the given compose project.
func (d *DockerInspector) Inspect(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceState, error) {
	cli, err := d.clientFactory(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client for %q: %w", dest.DockerHost, err)
	}
	defer cli.Close()

	// Filter containers by compose project label
	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", dest.ProjectName))

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true, // Include stopped containers
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("listing containers for project %q: %w", dest.ProjectName, err)
	}

	var states []app.ServiceState
	for _, c := range containers {
		// Get detailed inspection data
		detail, err := cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			// Skip containers that vanish between list and inspect
			continue
		}
		state := mapContainerToState(c, detail)
		states = append(states, state)
	}

	return states, nil
}

// InspectService returns the live state of a single service by name.
func (d *DockerInspector) InspectService(ctx context.Context, dest app.DestinationSpec, serviceName string) (*app.ServiceState, error) {
	cli, err := d.clientFactory(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}
	defer cli.Close()

	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", dest.ProjectName))
	f.Add("label", fmt.Sprintf("com.docker.compose.service=%s", serviceName))

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("listing containers for service %q: %w", serviceName, err)
	}

	if len(containers) == 0 {
		return nil, nil
	}

	// Use the first matching container (compose services typically have one container)
	detail, err := cli.ContainerInspect(ctx, containers[0].ID)
	if err != nil {
		return nil, fmt.Errorf("inspecting container %q: %w", containers[0].ID, err)
	}

	state := mapContainerToState(containers[0], detail)
	return &state, nil
}

// mapContainerToState converts Docker container data into our domain ServiceState.
func mapContainerToState(c types.Container, detail types.ContainerJSON) app.ServiceState {
	state := app.ServiceState{
		Name:          c.Labels["com.docker.compose.service"],
		ContainerName: strings.TrimPrefix(c.Names[0], "/"),
		Image:         c.Image,
		Status:        c.State,
		Health:        mapHealth(c.State, detail),
		Labels:        filterComposeLabels(c.Labels),
	}

	// Extract environment variables
	if detail.Config != nil {
		state.Environment = parseEnvList(detail.Config.Env)
		state.Command = detail.Config.Cmd
		state.Entrypoint = detail.Config.Entrypoint
	}

	// Extract port mappings
	for containerPort, bindings := range detail.NetworkSettings.Ports {
		port := string(containerPort)
		proto := "tcp"
		if parts := strings.SplitN(port, "/", 2); len(parts) == 2 {
			port = parts[0]
			proto = parts[1]
		}
		if len(bindings) == 0 {
			state.Ports = append(state.Ports, app.PortMapping{
				ContainerPort: port,
				Protocol:      proto,
			})
		} else {
			for _, b := range bindings {
				state.Ports = append(state.Ports, app.PortMapping{
					HostPort:      b.HostPort,
					ContainerPort: port,
					Protocol:      proto,
				})
			}
		}
	}

	// Extract volume mounts
	if detail.Mounts != nil {
		for _, m := range detail.Mounts {
			state.Volumes = append(state.Volumes, app.VolumeMount{
				Source:   m.Source,
				Target:   m.Destination,
				ReadOnly: !m.RW,
			})
		}
	}

	// Extract network names
	if detail.NetworkSettings != nil {
		for netName := range detail.NetworkSettings.Networks {
			state.Networks = append(state.Networks, netName)
		}
	}

	// Extract restart policy
	if detail.HostConfig != nil {
		state.RestartPolicy = string(detail.HostConfig.RestartPolicy.Name)
	}

	return state
}

// parseEnvList converts ["KEY=value", ...] to a map.
func parseEnvList(env []string) map[string]string {
	if len(env) == 0 {
		return nil
	}
	result := make(map[string]string, len(env))
	for _, e := range env {
		if idx := strings.IndexByte(e, '='); idx != -1 {
			result[e[:idx]] = e[idx+1:]
		}
	}
	return result
}

// filterComposeLabels removes Docker Compose internal labels,
// keeping only user-defined labels.
func filterComposeLabels(labels map[string]string) map[string]string {
	if len(labels) == 0 {
		return nil
	}
	result := make(map[string]string)
	for k, v := range labels {
		if strings.HasPrefix(k, "com.docker.compose.") {
			continue
		}
		result[k] = v
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// extractPorts extracts port mappings from a container's network settings.
func extractPorts(detail types.ContainerJSON) []app.PortMapping {
	if detail.NetworkSettings == nil {
		return nil
	}
	var ports []app.PortMapping
	for containerPort, bindings := range detail.NetworkSettings.Ports {
		port := string(containerPort)
		proto := "tcp"
		if parts := strings.SplitN(port, "/", 2); len(parts) == 2 {
			port = parts[0]
			proto = parts[1]
		}
		if len(bindings) == 0 {
			ports = append(ports, app.PortMapping{
				ContainerPort: port,
				Protocol:      proto,
			})
		} else {
			for _, b := range bindings {
				ports = append(ports, app.PortMapping{
					HostPort:      b.HostPort,
					ContainerPort: port,
					Protocol:      proto,
				})
			}
		}
	}
	return ports
}

// InspectWithMetrics returns per-service status with resource usage metrics.
func (d *DockerInspector) InspectWithMetrics(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceStatus, error) {
	cli, err := d.clientFactory(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}
	defer cli.Close()

	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", dest.ProjectName))

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("listing containers: %w", err)
	}

	var results []app.ServiceStatus
	for _, c := range containers {
		detail, err := cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			continue
		}

		svc := app.ServiceStatus{
			Name:   c.Labels["com.docker.compose.service"],
			Image:  c.Image,
			Health: mapHealth(c.State, detail),
			State:  c.State,
			Ports:  extractPorts(detail),
		}

		// Only collect metrics for running containers
		if c.State == "running" {
			metrics := collectMetrics(ctx, cli, c.ID, detail)
			if metrics != nil {
				svc.Metrics = metrics
			}
		}

		results = append(results, svc)
	}

	return results, nil
}

// collectMetrics gathers resource usage stats for a single container.
func collectMetrics(ctx context.Context, cli DockerClient, containerID string, detail types.ContainerJSON) *app.ContainerMetrics {
	resp, err := cli.ContainerStatsOneShot(ctx, containerID)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	var stats container.StatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil
	}

	metrics := &app.ContainerMetrics{
		PIDs: int(stats.PidsStats.Current),
	}

	// CPU percentage
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	if systemDelta > 0 && stats.CPUStats.OnlineCPUs > 0 {
		metrics.CPUPercent = math.Round((cpuDelta/systemDelta)*float64(stats.CPUStats.OnlineCPUs)*10000) / 100
	}

	// Memory
	memUsage := float64(stats.MemoryStats.Usage)
	memLimit := float64(stats.MemoryStats.Limit)
	metrics.MemoryUsageMB = math.Round(memUsage/1024/1024*100) / 100
	metrics.MemoryLimitMB = math.Round(memLimit/1024/1024*100) / 100
	if memLimit > 0 {
		metrics.MemoryPercent = math.Round(memUsage/memLimit*10000) / 100
	}

	// Network I/O (sum across all interfaces)
	var rxBytes, txBytes uint64
	for _, net := range stats.Networks {
		rxBytes += net.RxBytes
		txBytes += net.TxBytes
	}
	metrics.NetworkRxMB = math.Round(float64(rxBytes)/1024/1024*100) / 100
	metrics.NetworkTxMB = math.Round(float64(txBytes)/1024/1024*100) / 100

	// Block I/O
	for _, bio := range stats.BlkioStats.IoServiceBytesRecursive {
		switch bio.Op {
		case "read", "Read":
			metrics.BlockReadMB += float64(bio.Value)
		case "write", "Write":
			metrics.BlockWriteMB += float64(bio.Value)
		}
	}
	metrics.BlockReadMB = math.Round(metrics.BlockReadMB/1024/1024*100) / 100
	metrics.BlockWriteMB = math.Round(metrics.BlockWriteMB/1024/1024*100) / 100

	// Uptime and created time
	if detail.State != nil && detail.State.StartedAt != "" {
		if started, err := time.Parse(time.RFC3339Nano, detail.State.StartedAt); err == nil {
			metrics.Uptime = formatUptime(time.Since(started))
		}
	}
	if detail.Created != "" {
		metrics.CreatedAt = detail.Created
	}

	return metrics
}

// formatUptime formats a duration as a human-readable string.
func formatUptime(d time.Duration) string {
	days := int(d.Hours() / 24)
	hours := int(d.Hours()) % 24
	mins := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	return fmt.Sprintf("%dm", mins)
}

// SystemInfo returns information about the Docker daemon.
func (d *DockerInspector) SystemInfo(ctx context.Context, dockerHost string) (*app.DockerHostInfo, error) {
	cli, err := d.clientFactory(dockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}
	defer cli.Close()

	info, err := cli.Info(ctx)
	if err != nil {
		return nil, fmt.Errorf("getting system info: %w", err)
	}

	return &app.DockerHostInfo{
		ServerVersion: info.ServerVersion,
		OS:            info.OperatingSystem,
		Architecture:  info.Architecture,
		KernelVersion: info.KernelVersion,
		TotalMemoryMB: info.MemTotal / 1024 / 1024,
		CPUs:          info.NCPU,
		StorageDriver: info.Driver,
		Containers:    info.Containers,
		ContRunning:   info.ContainersRunning,
		ContPaused:    info.ContainersPaused,
		ContStopped:   info.ContainersStopped,
		Images:        info.Images,
		DockerRootDir: info.DockerRootDir,
	}, nil
}
