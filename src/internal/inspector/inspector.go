// Package inspector queries the Docker daemon for the live state of containers
// belonging to a Docker Compose project.
package inspector

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"math"
	gohttp "net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/system"
	"github.com/docker/docker/client"
	"github.com/mkolb22/dockercd/internal/app"
)

// TLSConfig holds paths for TLS client certificates used to connect to a remote Docker daemon.
type TLSConfig struct {
	// CertPath is the directory containing cert.pem, key.pem, and ca.pem.
	CertPath string
	// Verify controls whether the server certificate is verified against the CA.
	Verify bool
}

// LoadTLSConfig loads TLS certificates from CertPath and returns a *tls.Config.
func (c TLSConfig) LoadTLSConfig() (*tls.Config, error) {
	certFile := filepath.Join(c.CertPath, "cert.pem")
	keyFile := filepath.Join(c.CertPath, "key.pem")
	caFile := filepath.Join(c.CertPath, "ca.pem")

	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("loading client certificate: %w", err)
	}

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
	}

	// Load CA certificate if present
	if caCert, err := os.ReadFile(caFile); err == nil {
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		tlsCfg.RootCAs = caCertPool
	}

	if !c.Verify {
		tlsCfg.InsecureSkipVerify = true //nolint:gosec // intentionally configurable
	}

	return tlsCfg, nil
}

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

	// HostStats returns aggregated resource usage across all running containers.
	HostStats(ctx context.Context, dockerHost string) (*app.HostStats, error)

	// RegisterTLS adds or updates TLS configuration for a remote Docker host.
	RegisterTLS(host string, cfg TLSConfig)

	// UnregisterTLS removes TLS configuration for a remote Docker host.
	UnregisterTLS(host string)

	// GetTLSCertPath returns the TLS cert path for a host, or empty string if not configured.
	GetTLSCertPath(host string) string
}

// DockerInspector implements StateInspector using the Docker SDK.
type DockerInspector struct {
	// clientFactory creates Docker clients for the given host.
	// This allows injecting mock clients for testing.
	clientFactory ClientFactory

	// Dynamic TLS config registry for runtime host management.
	tlsConfigs map[string]TLSConfig
	tlsMu      sync.RWMutex

	// Client cache: one client per host, reused across calls to avoid
	// repeated TLS config loading and client creation overhead.
	clientCache   map[string]DockerClient
	clientCacheMu sync.Mutex
}

// ClientFactory creates Docker API clients.
type ClientFactory func(host string) (DockerClient, error)

// DockerClient is the subset of the Docker client API we use.
// This interface enables mocking in tests.
type DockerClient interface {
	ContainerList(ctx context.Context, options container.ListOptions) ([]container.Summary, error)
	ContainerInspect(ctx context.Context, containerID string) (container.InspectResponse, error)
	ContainerStatsOneShot(ctx context.Context, containerID string) (container.StatsResponseReader, error)
	Info(ctx context.Context) (system.Info, error)
	DiskUsage(ctx context.Context, options types.DiskUsageOptions) (types.DiskUsage, error)
	Close() error
}

// New creates a DockerInspector with the default Docker client factory.
func New() *DockerInspector {
	d := &DockerInspector{
		tlsConfigs:  make(map[string]TLSConfig),
		clientCache: make(map[string]DockerClient),
	}
	d.clientFactory = d.tlsAwareClientFactory
	return d
}

// NewWithFactory creates a DockerInspector with a custom client factory (for testing).
func NewWithFactory(factory ClientFactory) *DockerInspector {
	return &DockerInspector{
		clientFactory: factory,
		tlsConfigs:    make(map[string]TLSConfig),
		clientCache:   make(map[string]DockerClient),
	}
}

// NewWithTLS creates a DockerInspector with TLS support for remote Docker hosts.
// The tlsConfigs map is keyed by Docker host URL (e.g., "tcp://remote:2376").
// Hosts not present in the map use the default (unauthenticated) client.
func NewWithTLS(tlsConfigs map[string]TLSConfig) *DockerInspector {
	d := &DockerInspector{
		tlsConfigs:  make(map[string]TLSConfig, len(tlsConfigs)),
		clientCache: make(map[string]DockerClient),
	}
	for k, v := range tlsConfigs {
		d.tlsConfigs[k] = v
	}
	d.clientFactory = d.tlsAwareClientFactory
	return d
}

// tlsAwareClientFactory creates Docker clients with TLS if configured for the host.
func (d *DockerInspector) tlsAwareClientFactory(host string) (DockerClient, error) {
	opts := []client.Opt{client.WithAPIVersionNegotiation()}
	if host != "" {
		opts = append(opts, client.WithHost(host))
	}

	d.tlsMu.RLock()
	cfg, hasTLS := d.tlsConfigs[host]
	d.tlsMu.RUnlock()

	if hasTLS {
		tlsConfig, err := cfg.LoadTLSConfig()
		if err != nil {
			return nil, fmt.Errorf("loading TLS config for %q: %w", host, err)
		}
		httpClient := &gohttp.Client{
			Transport: &gohttp.Transport{TLSClientConfig: tlsConfig},
		}
		opts = append(opts, client.WithHTTPClient(httpClient))
	}
	return client.NewClientWithOpts(opts...)
}

// RegisterTLS adds or updates TLS configuration for a remote Docker host.
// Invalidates any cached client for this host so the new TLS config takes effect.
func (d *DockerInspector) RegisterTLS(host string, cfg TLSConfig) {
	d.tlsMu.Lock()
	d.tlsConfigs[host] = cfg
	d.tlsMu.Unlock()

	d.clientCacheMu.Lock()
	if cli, ok := d.clientCache[host]; ok {
		cli.Close()
		delete(d.clientCache, host)
	}
	d.clientCacheMu.Unlock()
}

// UnregisterTLS removes TLS configuration for a remote Docker host.
// Invalidates any cached client for this host.
func (d *DockerInspector) UnregisterTLS(host string) {
	d.tlsMu.Lock()
	delete(d.tlsConfigs, host)
	d.tlsMu.Unlock()

	d.clientCacheMu.Lock()
	if cli, ok := d.clientCache[host]; ok {
		cli.Close()
		delete(d.clientCache, host)
	}
	d.clientCacheMu.Unlock()
}

// GetTLSCertPath returns the TLS cert path for a host, or empty string if not configured.
func (d *DockerInspector) GetTLSCertPath(host string) string {
	d.tlsMu.RLock()
	cfg, ok := d.tlsConfigs[host]
	d.tlsMu.RUnlock()
	if ok {
		return cfg.CertPath
	}
	return ""
}

// getClient returns a cached Docker client for the given host, creating one
// via clientFactory on first access. Clients are reused across calls to avoid
// repeated TLS config loading and object allocation.
func (d *DockerInspector) getClient(host string) (DockerClient, error) {
	d.clientCacheMu.Lock()
	defer d.clientCacheMu.Unlock()

	if cli, ok := d.clientCache[host]; ok {
		return cli, nil
	}

	cli, err := d.clientFactory(host)
	if err != nil {
		return nil, err
	}
	d.clientCache[host] = cli
	return cli, nil
}

// CloseAllClients closes and removes all cached Docker clients.
// Call during shutdown to release resources.
func (d *DockerInspector) CloseAllClients() {
	d.clientCacheMu.Lock()
	defer d.clientCacheMu.Unlock()

	for host, cli := range d.clientCache {
		cli.Close()
		delete(d.clientCache, host)
	}
}

// Inspect returns the live state of all containers in the given compose project.
func (d *DockerInspector) Inspect(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceState, error) {
	cli, err := d.getClient(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client for %q: %w", dest.DockerHost, err)
	}

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

	states := make([]app.ServiceState, 0, len(containers))
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
	cli, err := d.getClient(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

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
func mapContainerToState(c container.Summary, detail container.InspectResponse) app.ServiceState {
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

	// Extract port mappings (reuse extractPorts to avoid duplication)
	state.Ports = extractPorts(detail)

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
func extractPorts(detail container.InspectResponse) []app.PortMapping {
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
	cli, err := d.getClient(dest.DockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", dest.ProjectName))

	containers, err := cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, fmt.Errorf("listing containers: %w", err)
	}

	results := make([]app.ServiceStatus, 0, len(containers))
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
func collectMetrics(ctx context.Context, cli DockerClient, containerID string, detail container.InspectResponse) *app.ContainerMetrics {
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
	cli, err := d.getClient(dockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

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

// HostStats aggregates resource usage across all running containers on the host.
func (d *DockerInspector) HostStats(ctx context.Context, dockerHost string) (*app.HostStats, error) {
	cli, err := d.getClient(dockerHost)
	if err != nil {
		return nil, fmt.Errorf("creating docker client: %w", err)
	}

	// Get system info for CPU cores and total memory
	info, err := cli.Info(ctx)
	if err != nil {
		return nil, fmt.Errorf("getting system info: %w", err)
	}

	// Single ContainerList call with All:true, then filter running in memory
	allContainers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("listing containers: %w", err)
	}

	containers := make([]container.Summary, 0, len(allContainers))
	for _, c := range allContainers {
		if c.State == "running" {
			containers = append(containers, c)
		}
	}

	stats := &app.HostStats{
		CPUCores:          info.NCPU,
		MemoryLimitMB:     math.Round(float64(info.MemTotal)/1024/1024*100) / 100,
		ContainersRunning: len(containers),
		ContainersTotal:   len(allContainers),
		CollectedAt:       time.Now().UTC().Format(time.RFC3339),
	}

	if info.NCPU > 0 {
		stats.PerCPUPercent = make([]float64, info.NCPU)
	}

	// Collect metrics concurrently with bounded semaphore
	type metricsResult struct {
		stats    container.StatsResponse
		hasStats bool
		project  string
	}

	results := make([]metricsResult, len(containers))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10) // max 10 concurrent

	for i, c := range containers {
		project := c.Labels["com.docker.compose.project"]
		wg.Add(1)
		go func(idx int, containerID string, proj string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			resp, err := cli.ContainerStatsOneShot(ctx, containerID)
			if err != nil {
				results[idx] = metricsResult{project: proj}
				return
			}
			defer resp.Body.Close()

			var s container.StatsResponse
			if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
				results[idx] = metricsResult{project: proj}
				return
			}
			results[idx] = metricsResult{stats: s, hasStats: true, project: proj}
		}(i, c.ID, project)
	}
	wg.Wait()

	// Per-app stats map
	appStats := make(map[string]*app.AppResourceStats)

	// Aggregate all results
	for _, r := range results {
		// Track per-app container count even without stats
		if r.project != "" {
			as, ok := appStats[r.project]
			if !ok {
				as = &app.AppResourceStats{}
				appStats[r.project] = as
			}
			as.Containers++
		}

		if !r.hasStats {
			continue
		}
		s := r.stats

		// CPU
		cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage - s.PreCPUStats.CPUUsage.TotalUsage)
		systemDelta := float64(s.CPUStats.SystemUsage - s.PreCPUStats.SystemUsage)
		var cpuPct float64
		if systemDelta > 0 && s.CPUStats.OnlineCPUs > 0 {
			cpuPct = (cpuDelta / systemDelta) * float64(s.CPUStats.OnlineCPUs) * 100
			stats.CPUPercent += cpuPct
		}

		// Per-CPU usage aggregation
		if len(s.CPUStats.CPUUsage.PercpuUsage) > 0 && len(s.PreCPUStats.CPUUsage.PercpuUsage) > 0 {
			for j := 0; j < len(s.CPUStats.CPUUsage.PercpuUsage) && j < len(stats.PerCPUPercent); j++ {
				coreDelta := float64(s.CPUStats.CPUUsage.PercpuUsage[j] - s.PreCPUStats.CPUUsage.PercpuUsage[j])
				if systemDelta > 0 {
					stats.PerCPUPercent[j] += (coreDelta / systemDelta) * float64(s.CPUStats.OnlineCPUs) * 100
				}
			}
		}

		// Memory
		memUsageMB := float64(s.MemoryStats.Usage) / 1024 / 1024
		memLimitMB := float64(s.MemoryStats.Limit) / 1024 / 1024
		stats.MemoryUsageMB += memUsageMB

		// Network
		var rxMB, txMB float64
		for _, net := range s.Networks {
			rxMB += float64(net.RxBytes) / 1024 / 1024
			txMB += float64(net.TxBytes) / 1024 / 1024
		}
		stats.NetworkRxMB += rxMB
		stats.NetworkTxMB += txMB

		// Block I/O
		for _, bio := range s.BlkioStats.IoServiceBytesRecursive {
			switch bio.Op {
			case "read", "Read":
				stats.BlockReadMB += float64(bio.Value) / 1024 / 1024
			case "write", "Write":
				stats.BlockWriteMB += float64(bio.Value) / 1024 / 1024
			}
		}

		// PIDs
		pids := int(s.PidsStats.Current)
		stats.PIDs += pids

		// Accumulate per-app stats
		if r.project != "" {
			as := appStats[r.project]
			as.CPUPercent += cpuPct
			as.MemoryUsageMB += memUsageMB
			as.MemoryLimitMB += memLimitMB
			as.NetworkRxMB += rxMB
			as.NetworkTxMB += txMB
			as.PIDs += pids
		}
	}

	// Round per-app values
	for _, as := range appStats {
		as.CPUPercent = math.Round(as.CPUPercent*100) / 100
		as.MemoryUsageMB = math.Round(as.MemoryUsageMB*100) / 100
		as.MemoryLimitMB = math.Round(as.MemoryLimitMB*100) / 100
		if as.MemoryLimitMB > 0 {
			as.MemoryPercent = math.Round(as.MemoryUsageMB/as.MemoryLimitMB*10000) / 100
		}
		as.NetworkRxMB = math.Round(as.NetworkRxMB*100) / 100
		as.NetworkTxMB = math.Round(as.NetworkTxMB*100) / 100
	}
	if len(appStats) > 0 {
		stats.Apps = appStats
	}

	// Round values
	stats.CPUPercent = math.Round(stats.CPUPercent*100) / 100
	stats.MemoryUsageMB = math.Round(stats.MemoryUsageMB*100) / 100
	stats.NetworkRxMB = math.Round(stats.NetworkRxMB*100) / 100
	stats.NetworkTxMB = math.Round(stats.NetworkTxMB*100) / 100
	stats.BlockReadMB = math.Round(stats.BlockReadMB*100) / 100
	stats.BlockWriteMB = math.Round(stats.BlockWriteMB*100) / 100
	for j := range stats.PerCPUPercent {
		stats.PerCPUPercent[j] = math.Round(stats.PerCPUPercent[j]*100) / 100
	}

	if stats.MemoryLimitMB > 0 {
		stats.MemoryPercent = math.Round(stats.MemoryUsageMB/stats.MemoryLimitMB*10000) / 100
	}

	// Docker disk usage (best-effort, don't fail if unavailable)
	du, err := cli.DiskUsage(ctx, types.DiskUsageOptions{})
	if err == nil {
		diskUsage := &app.DiskUsage{
			ImagesCount:  len(du.Images),
			VolumesCount: len(du.Volumes),
		}
		for _, img := range du.Images {
			if img != nil {
				diskUsage.ImagesSizeMB += float64(img.Size) / 1024 / 1024
			}
		}
		for _, c := range du.Containers {
			if c != nil {
				diskUsage.ContainersSizeMB += float64(c.SizeRw) / 1024 / 1024
			}
		}
		for _, v := range du.Volumes {
			if v != nil && v.UsageData != nil && v.UsageData.Size > 0 {
				diskUsage.VolumesSizeMB += float64(v.UsageData.Size) / 1024 / 1024
			}
		}
		for _, bc := range du.BuildCache {
			if bc != nil {
				diskUsage.BuildCacheSizeMB += float64(bc.Size) / 1024 / 1024
			}
		}
		diskUsage.ImagesSizeMB = math.Round(diskUsage.ImagesSizeMB*100) / 100
		diskUsage.ContainersSizeMB = math.Round(diskUsage.ContainersSizeMB*100) / 100
		diskUsage.VolumesSizeMB = math.Round(diskUsage.VolumesSizeMB*100) / 100
		diskUsage.BuildCacheSizeMB = math.Round(diskUsage.BuildCacheSizeMB*100) / 100
		diskUsage.TotalSizeMB = math.Round((diskUsage.ImagesSizeMB+diskUsage.ContainersSizeMB+diskUsage.VolumesSizeMB+diskUsage.BuildCacheSizeMB)*100) / 100
		stats.DiskUsage = diskUsage
	}

	return stats, nil
}
