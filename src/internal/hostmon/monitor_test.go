package hostmon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/store"
)

// --- Mock inspector ---

type mockInspector struct {
	systemInfoFn func(ctx context.Context, host string) (*app.DockerHostInfo, error)
	hostStatsFn  func(ctx context.Context, host string) (*app.HostStats, error)
}

func (m *mockInspector) Inspect(_ context.Context, _ app.DestinationSpec) ([]app.ServiceState, error) {
	return nil, nil
}
func (m *mockInspector) InspectService(_ context.Context, _ app.DestinationSpec, _ string) (*app.ServiceState, error) {
	return nil, nil
}
func (m *mockInspector) InspectWithMetrics(_ context.Context, _ app.DestinationSpec) ([]app.ServiceStatus, error) {
	return nil, nil
}
func (m *mockInspector) SystemInfo(ctx context.Context, host string) (*app.DockerHostInfo, error) {
	if m.systemInfoFn != nil {
		return m.systemInfoFn(ctx, host)
	}
	return &app.DockerHostInfo{ServerVersion: "24.0.0"}, nil
}
func (m *mockInspector) HostStats(ctx context.Context, host string) (*app.HostStats, error) {
	if m.hostStatsFn != nil {
		return m.hostStatsFn(ctx, host)
	}
	return &app.HostStats{CPUCores: 4}, nil
}
func (m *mockInspector) InspectServiceDetail(_ context.Context, _ app.DestinationSpec, _ string) (*app.ServiceDetail, error) {
	return nil, nil
}
func (m *mockInspector) GetServiceLogs(_ context.Context, _ app.DestinationSpec, _ string, _ int) ([]string, error) {
	return nil, nil
}
func (m *mockInspector) RegisterTLS(_ string, _ inspector.TLSConfig)   {}
func (m *mockInspector) UnregisterTLS(_ string)                        {}
func (m *mockInspector) GetTLSCertPath(_ string) string                { return "" }

// --- Helpers ---

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func setupTestStore(t *testing.T) *store.SQLiteStore {
	t.Helper()
	s, err := store.New(":memory:", testLogger())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func createTestHost(t *testing.T, s *store.SQLiteStore, name, url string) {
	t.Helper()
	if err := s.CreateDockerHost(context.Background(), &store.DockerHostRecord{
		Name:         name,
		URL:          url,
		TLSVerify:    true,
		HealthStatus: "Unknown",
	}); err != nil {
		t.Fatalf("create host: %v", err)
	}
}

// --- Tests ---

func TestSweep_HealthyHost(t *testing.T) {
	s := setupTestStore(t)
	createTestHost(t, s, "server-a", "tcp://10.0.0.1:2376")

	insp := &mockInspector{}
	mon := New(insp, s, testLogger(), DefaultConfig())

	mon.sweep(context.Background())

	host, _ := s.GetDockerHost(context.Background(), "server-a")
	if host.HealthStatus != "Healthy" {
		t.Errorf("expected Healthy, got %q", host.HealthStatus)
	}
	if host.LastCheck == nil {
		t.Error("expected LastCheck to be set")
	}
	if host.InfoJSON == "" {
		t.Error("expected InfoJSON to be set")
	}
	if host.StatsJSON == "" {
		t.Error("expected StatsJSON to be set")
	}
}

func TestSweep_UnreachableHost(t *testing.T) {
	s := setupTestStore(t)
	createTestHost(t, s, "server-a", "tcp://10.0.0.1:2376")

	insp := &mockInspector{
		systemInfoFn: func(_ context.Context, _ string) (*app.DockerHostInfo, error) {
			return nil, fmt.Errorf("connection refused")
		},
	}
	mon := New(insp, s, testLogger(), DefaultConfig())

	mon.sweep(context.Background())

	host, _ := s.GetDockerHost(context.Background(), "server-a")
	if host.HealthStatus != "Unreachable" {
		t.Errorf("expected Unreachable, got %q", host.HealthStatus)
	}
	if host.LastError == "" {
		t.Error("expected LastError to be set")
	}
}

func TestSweep_MultipleHosts(t *testing.T) {
	s := setupTestStore(t)
	createTestHost(t, s, "healthy-host", "tcp://10.0.0.1:2376")
	createTestHost(t, s, "dead-host", "tcp://10.0.0.2:2376")

	insp := &mockInspector{
		systemInfoFn: func(_ context.Context, host string) (*app.DockerHostInfo, error) {
			if host == "tcp://10.0.0.2:2376" {
				return nil, fmt.Errorf("timeout")
			}
			return &app.DockerHostInfo{ServerVersion: "24.0.0"}, nil
		},
	}
	cfg := DefaultConfig()
	cfg.MaxConcurrent = 1 // serialize for in-memory SQLite
	mon := New(insp, s, testLogger(), cfg)

	mon.sweep(context.Background())

	h1, err := s.GetDockerHost(context.Background(), "healthy-host")
	if err != nil {
		t.Fatalf("get healthy-host: %v", err)
	}
	if h1 == nil {
		t.Fatal("healthy-host not found after sweep")
	}
	if h1.HealthStatus != "Healthy" {
		t.Errorf("expected healthy-host=Healthy, got %q", h1.HealthStatus)
	}

	h2, err := s.GetDockerHost(context.Background(), "dead-host")
	if err != nil {
		t.Fatalf("get dead-host: %v", err)
	}
	if h2 == nil {
		t.Fatal("dead-host not found after sweep")
	}
	if h2.HealthStatus != "Unreachable" {
		t.Errorf("expected dead-host=Unreachable, got %q", h2.HealthStatus)
	}
}

func TestCheckHost_SingleHost(t *testing.T) {
	s := setupTestStore(t)
	createTestHost(t, s, "my-server", "tcp://10.0.0.1:2376")

	insp := &mockInspector{}
	mon := New(insp, s, testLogger(), DefaultConfig())

	if err := mon.CheckHost(context.Background(), "my-server"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	host, _ := s.GetDockerHost(context.Background(), "my-server")
	if host.HealthStatus != "Healthy" {
		t.Errorf("expected Healthy, got %q", host.HealthStatus)
	}
}

func TestSweep_NoHosts(t *testing.T) {
	s := setupTestStore(t)
	insp := &mockInspector{}
	mon := New(insp, s, testLogger(), DefaultConfig())

	// Should not panic or error with no hosts
	mon.sweep(context.Background())
}

func TestMonitor_StartStop(t *testing.T) {
	s := setupTestStore(t)
	insp := &mockInspector{}
	cfg := DefaultConfig()
	cfg.CheckInterval = 50 * time.Millisecond
	mon := New(insp, s, testLogger(), cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- mon.Start(ctx)
	}()

	// Let it run a few cycles
	time.Sleep(150 * time.Millisecond)
	mon.Stop()

	if err := <-errCh; err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
