package inspector

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/system"
	"github.com/docker/docker/client"
)

type capacityMockClient struct {
	info       system.Info
	containers []container.Summary
	stats      map[string]container.StatsResponse
	statsErr   map[string]error
}

type budgetCapacityClient struct {
	*capacityMockClient
	mu            sync.Mutex
	listOptions   container.ListOptions
	concurrent    int
	maxConcurrent int
	started       chan struct{}
	release       <-chan struct{}
}

type deadlineCapacityClient struct{ *capacityMockClient }

func (m deadlineCapacityClient) ContainerStatsOneShot(ctx context.Context, _ string) (container.StatsResponseReader, error) {
	<-ctx.Done()
	return container.StatsResponseReader{}, ctx.Err()
}

type infoDeadlineCapacityClient struct{ *capacityMockClient }

func (m infoDeadlineCapacityClient) CapacityInfo(ctx context.Context) (system.Info, error) {
	<-ctx.Done()
	return system.Info{}, ctx.Err()
}

func (m *budgetCapacityClient) CapacityContainerList(ctx context.Context, options container.ListOptions) ([]container.Summary, error) {
	m.mu.Lock()
	m.listOptions = options
	m.mu.Unlock()
	return m.capacityMockClient.CapacityContainerList(ctx, options)
}

func (m *budgetCapacityClient) ContainerStatsOneShot(ctx context.Context, id string) (container.StatsResponseReader, error) {
	m.mu.Lock()
	m.concurrent++
	if m.concurrent > m.maxConcurrent {
		m.maxConcurrent = m.concurrent
	}
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.concurrent--
		m.mu.Unlock()
	}()
	m.started <- struct{}{}
	select {
	case <-m.release:
	case <-ctx.Done():
		return container.StatsResponseReader{}, ctx.Err()
	}
	return m.capacityMockClient.ContainerStatsOneShot(ctx, id)
}

func (m *capacityMockClient) CapacityInfo(context.Context) (system.Info, error) { return m.info, nil }
func (m *capacityMockClient) CapacityContainerList(_ context.Context, _ container.ListOptions) ([]container.Summary, error) {
	return m.containers, nil
}
func (m *capacityMockClient) ContainerStatsOneShot(_ context.Context, id string) (container.StatsResponseReader, error) {
	if err := m.statsErr[id]; err != nil {
		return container.StatsResponseReader{}, err
	}
	body, err := json.Marshal(m.stats[id])
	if err != nil {
		return container.StatsResponseReader{}, err
	}
	return container.StatsResponseReader{Body: io.NopCloser(bytes.NewReader(body))}, nil
}

// Unused DockerClient methods exist solely because CapacitySample obtains the
// shared cached client through the normal inspector interface.
func (m *capacityMockClient) ContainerList(context.Context, container.ListOptions) ([]container.Summary, error) {
	return m.containers, nil
}
func (m *capacityMockClient) ContainerInspect(context.Context, string) (container.InspectResponse, error) {
	return container.InspectResponse{}, nil
}
func (m *capacityMockClient) ContainerLogs(context.Context, string, container.LogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (m *capacityMockClient) Info(context.Context) (system.Info, error) { return m.info, nil }
func (m *capacityMockClient) DiskUsage(context.Context, types.DiskUsageOptions) (types.DiskUsage, error) {
	return types.DiskUsage{}, nil
}
func (m *capacityMockClient) Close() error { return nil }

func capacityStats(total, systemUsage uint64) container.StatsResponse {
	return container.StatsResponse{
		CPUStats: container.CPUStats{
			CPUUsage:    container.CPUUsage{TotalUsage: total},
			SystemUsage: systemUsage,
			OnlineCPUs:  2,
		},
		MemoryStats: container.MemoryStats{Usage: 128 * 1024 * 1024},
	}
}

func TestCapacitySampleUsesValidatedCPUBaselinesAndPrunesStaleCounters(t *testing.T) {
	mock := &capacityMockClient{
		info:       system.Info{NCPU: 2, MemTotal: 8 * 1024 * 1024 * 1024, ContainersRunning: 1},
		containers: []container.Summary{{ID: "one"}},
		stats:      map[string]container.StatsResponse{"one": capacityStats(100, 1_000)},
		statsErr:   map[string]error{},
	}
	inspector := NewWithFactory(mockFactory(mock))
	first, err := inspector.CapacitySample(context.Background(), "")
	if err != nil {
		t.Fatalf("first sample: %v", err)
	}
	if first.Completeness != "partial" || first.CPUPercent != 0 || first.ObservedContainers != 1 {
		t.Fatalf("first sample must be explicitly partial without a baseline: %+v", first)
	}

	mock.stats["one"] = capacityStats(200, 1_100)
	second, err := inspector.CapacitySample(context.Background(), "")
	if err != nil {
		t.Fatalf("second sample: %v", err)
	}
	if second.Completeness != "complete" || second.CPUPercent != 100 {
		t.Fatalf("second sample must normalize CPU against host cores: %+v", second)
	}

	mock.stats["one"] = capacityStats(150, 1_200)
	regressed, err := inspector.CapacitySample(context.Background(), "")
	if err != nil {
		t.Fatalf("regressed sample: %v", err)
	}
	if regressed.Completeness != "partial" {
		t.Fatalf("counter rollback must be partial, got %+v", regressed)
	}

	inspector.capacityMu.Lock()
	inspector.capacityCPU["retired"] = capacityCounters{observedAt: time.Now().Add(-capacityBaselineTTL - time.Second)}
	inspector.capacityMu.Unlock()
	_, err = inspector.CapacitySample(context.Background(), "")
	if err != nil {
		t.Fatalf("sample with retired baseline: %v", err)
	}
	inspector.capacityMu.Lock()
	_, retained := inspector.capacityCPU["retired"]
	inspector.capacityMu.Unlock()
	if retained {
		t.Fatal("stale capacity baseline was not pruned")
	}
	mock.containers = nil
	mock.info.ContainersRunning = 0
	inspector.capacityMu.Lock()
	inspector.capacityCPU["retired-while-idle"] = capacityCounters{observedAt: time.Now().Add(-capacityBaselineTTL - time.Second)}
	inspector.capacityMu.Unlock()
	if _, err := inspector.CapacitySample(context.Background(), ""); err != nil {
		t.Fatalf("idle sample: %v", err)
	}
	inspector.capacityMu.Lock()
	_, retained = inspector.capacityCPU["retired-while-idle"]
	inspector.capacityMu.Unlock()
	if retained {
		t.Fatal("idle capacity sample did not prune stale baseline")
	}
}

func TestCapacitySampleRejectsMetadataBeyondWorkBudget(t *testing.T) {
	tooMany := make([]container.Summary, capacityMaxContainers+1)
	for index := range tooMany {
		tooMany[index].ID = fmt.Sprintf("container-%d", index)
	}
	mock := &capacityMockClient{info: system.Info{NCPU: 2}, containers: tooMany, stats: map[string]container.StatsResponse{}, statsErr: map[string]error{}}
	inspector := NewWithFactory(mockFactory(mock))
	if _, err := inspector.CapacitySample(context.Background(), ""); err == nil {
		t.Fatal("capacity sample accepted Docker metadata beyond the work budget")
	}
	mock.containers = []container.Summary{{ID: "duplicate"}, {ID: "duplicate"}}
	if _, err := inspector.CapacitySample(context.Background(), ""); err == nil {
		t.Fatal("capacity sample accepted duplicate Docker metadata")
	}
}

func TestCapacitySampleCapsWorkerConcurrencyAndUsesRunningListQuery(t *testing.T) {
	containers := make([]container.Summary, capacityWorkers+3)
	stats := make(map[string]container.StatsResponse, len(containers))
	for index := range containers {
		containers[index].ID = fmt.Sprintf("container-%d", index)
		stats[containers[index].ID] = capacityStats(uint64(100+index), uint64(1_000+index))
	}
	release := make(chan struct{})
	client := &budgetCapacityClient{capacityMockClient: &capacityMockClient{info: system.Info{NCPU: 2, MemTotal: 1024, ContainersRunning: len(containers)}, containers: containers, stats: stats, statsErr: map[string]error{}}, started: make(chan struct{}, len(containers)), release: release}
	inspector := NewWithFactory(mockFactory(client))
	finished := make(chan error, 1)
	go func() { _, err := inspector.CapacitySample(context.Background(), ""); finished <- err }()
	for range capacityWorkers {
		<-client.started
	}
	select {
	case <-client.started:
		t.Fatal("capacity collector exceeded its worker limit")
	default:
	}
	client.mu.Lock()
	maxConcurrent := client.maxConcurrent
	options := client.listOptions
	client.mu.Unlock()
	if maxConcurrent != capacityWorkers || options.Limit != capacityMaxContainers || !options.All || options.Filters.Get("status")[0] != "running" {
		t.Fatalf("unexpected capacity collection budget: max=%d options=%+v", maxConcurrent, options)
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatalf("capacity sample: %v", err)
	}
}

func TestCapacitySampleHonorsCallerDeadlineWhenStatCollectionStalls(t *testing.T) {
	client := deadlineCapacityClient{capacityMockClient: &capacityMockClient{
		info:       system.Info{NCPU: 2, MemTotal: 1024, ContainersRunning: 1},
		containers: []container.Summary{{ID: "one"}}, stats: map[string]container.StatsResponse{}, statsErr: map[string]error{},
	}}
	inspector := NewWithFactory(mockFactory(client))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	sample, err := inspector.CapacitySample(ctx, "")
	if err != nil || sample == nil || sample.Completeness != "partial" || time.Since(started) > time.Second {
		t.Fatalf("stalled capacity sample ignored deadline: sample=%+v err=%v elapsed=%s", sample, err, time.Since(started))
	}
}

func TestCapacitySampleHonorsItsOwnMetadataAndStatDeadlines(t *testing.T) {
	metadataClient := infoDeadlineCapacityClient{capacityMockClient: &capacityMockClient{stats: map[string]container.StatsResponse{}, statsErr: map[string]error{}}}
	inspector := NewWithFactory(mockFactory(metadataClient))
	started := time.Now()
	if _, err := inspector.CapacitySample(context.Background(), ""); err == nil || time.Since(started) < capacityDeadline-250*time.Millisecond || time.Since(started) > capacityDeadline+2*time.Second {
		t.Fatalf("metadata collection did not obey internal deadline: err=%v elapsed=%s", err, time.Since(started))
	}

	statClient := deadlineCapacityClient{capacityMockClient: &capacityMockClient{
		info:       system.Info{NCPU: 2, MemTotal: 1024, ContainersRunning: 1},
		containers: []container.Summary{{ID: "one"}}, stats: map[string]container.StatsResponse{}, statsErr: map[string]error{},
	}}
	inspector = NewWithFactory(mockFactory(statClient))
	started = time.Now()
	sample, err := inspector.CapacitySample(context.Background(), "")
	if err != nil || sample == nil || sample.Completeness != "partial" || time.Since(started) < capacityStatDeadline-150*time.Millisecond || time.Since(started) > capacityStatDeadline+2*time.Second {
		t.Fatalf("stat collection did not obey internal deadline: sample=%+v err=%v elapsed=%s", sample, err, time.Since(started))
	}
}

func TestDecodeCapacityJSONRejectsOversizedResponse(t *testing.T) {
	var destination system.Info
	err := decodeCapacityJSON(strings.NewReader(strings.Repeat("x", capacityMaxBody+1)), -1, &destination)
	if !errors.Is(err, errCapacityResponseTooLarge) {
		t.Fatalf("expected oversized response error, got %v", err)
	}
}

func TestCapacityStatRejectsOversizedAndTrailingResponseData(t *testing.T) {
	inspector := New()
	oversized := io.NopCloser(strings.NewReader(strings.Repeat("x", capacityMaxBody+1)))
	result := inspector.capacityContainerStat(context.Background(), statReaderClient{capacityMockClient: &capacityMockClient{}, body: oversized}, "one")
	if result.ok {
		t.Fatal("oversized stat response was accepted")
	}
	stats, err := json.Marshal(capacityStats(100, 1_000))
	if err != nil {
		t.Fatal(err)
	}
	trailing := io.NopCloser(strings.NewReader(string(stats) + " {}"))
	result = inspector.capacityContainerStat(context.Background(), statReaderClient{capacityMockClient: &capacityMockClient{}, body: trailing}, "one")
	if result.ok {
		t.Fatal("trailing stat response data was accepted")
	}
}

type statReaderClient struct {
	*capacityMockClient
	body io.ReadCloser
}

func (m statReaderClient) ContainerStatsOneShot(context.Context, string) (container.StatsResponseReader, error) {
	return container.StatsResponseReader{Body: m.body}, nil
}

func TestBoundedCapacityClientRejectsOversizedInfoResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1.44/info" {
			t.Fatalf("unexpected metadata request path %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(strings.Repeat("x", capacityMaxBody+1)))
	}))
	defer server.Close()
	host := "tcp://" + strings.TrimPrefix(server.URL, "http://")
	apiClient, err := client.NewClientWithOpts(client.WithHost(host), client.WithVersion("1.44"), client.WithHTTPClient(server.Client()))
	if err != nil {
		t.Fatalf("new docker client: %v", err)
	}
	bounded := &boundedCapacityClient{Client: apiClient}
	_, err = bounded.CapacityInfo(context.Background())
	if !errors.Is(err, errCapacityResponseTooLarge) {
		t.Fatalf("expected bounded info error, got %v", err)
	}
}

func TestBoundedCapacityClientUsesConfiguredUnixSocketTransport(t *testing.T) {
	socketPath := fmt.Sprintf("/tmp/dc-%x.sock", time.Now().UnixNano())
	defer os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1.44/info" || r.Host != "docker" {
			t.Fatalf("unexpected unix metadata request path=%q host=%q", r.URL.Path, r.Host)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"NCPU":2,"MemTotal":1024,"ContainersRunning":1}`))
	})}
	defer server.Close()
	defer listener.Close()
	go func() { _ = server.Serve(listener) }()
	apiClient, err := client.NewClientWithOpts(client.WithHost("unix://"+socketPath), client.WithVersion("1.44"))
	if err != nil {
		t.Fatalf("new unix docker client: %v", err)
	}
	info, err := (&boundedCapacityClient{Client: apiClient}).CapacityInfo(context.Background())
	if err != nil || info.NCPU != 2 || info.ContainersRunning != 1 {
		t.Fatalf("unix capacity info = %+v, %v", info, err)
	}
}
