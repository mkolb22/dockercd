package deployer

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/inspector"
)

// mockDeployer records Deploy/Down/DeployServices/RunHook calls for test assertions.
type mockDeployer struct {
	mu          sync.Mutex
	deployCalls []DeployRequest
	downCalls   []DeployRequest
	deployErr   map[string]error // keyed by ProjectName
	downErr     map[string]error // keyed by ProjectName
}

func newMockDeployer() *mockDeployer {
	return &mockDeployer{
		deployErr: make(map[string]error),
		downErr:   make(map[string]error),
	}
}

func (m *mockDeployer) Deploy(ctx context.Context, req DeployRequest) error {
	m.mu.Lock()
	m.deployCalls = append(m.deployCalls, req)
	m.mu.Unlock()
	if err, ok := m.deployErr[req.ProjectName]; ok {
		return err
	}
	return nil
}

func (m *mockDeployer) DeployServices(ctx context.Context, req DeployRequest, serviceNames []string) error {
	return nil
}

func (m *mockDeployer) Down(ctx context.Context, req DeployRequest) error {
	m.mu.Lock()
	m.downCalls = append(m.downCalls, req)
	m.mu.Unlock()
	if err, ok := m.downErr[req.ProjectName]; ok {
		return err
	}
	return nil
}

func (m *mockDeployer) RunHook(ctx context.Context, req DeployRequest, serviceName string) error {
	return nil
}

// inspectCall records a single Inspect call and its project name.
type inspectResult struct {
	projectName string
	states      []app.ServiceState
	err         error
}

// mockInspector is a sequence-based inspector. Each call to Inspect consumes
// the next result in the queue for that project. When the queue is exhausted,
// the last result is repeated.
type mockInspector struct {
	mu      sync.Mutex
	results map[string][]inspectResult // keyed by ProjectName
}

func newMockInspector() *mockInspector {
	return &mockInspector{
		results: make(map[string][]inspectResult),
	}
}

// addResult appends an Inspect result for the given project.
// Calls are consumed in order; the last result is repeated when the queue is empty.
func (m *mockInspector) addResult(projectName string, states []app.ServiceState, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.results[projectName] = append(m.results[projectName], inspectResult{
		projectName: projectName,
		states:      states,
		err:         err,
	})
}

func (m *mockInspector) Inspect(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	queue := m.results[dest.ProjectName]
	if len(queue) == 0 {
		// No results configured — return empty (no containers).
		return nil, nil
	}

	// Consume the first result; keep the last for repetition.
	result := queue[0]
	if len(queue) > 1 {
		m.results[dest.ProjectName] = queue[1:]
	}
	return result.states, result.err
}

func (m *mockInspector) InspectService(ctx context.Context, dest app.DestinationSpec, serviceName string) (*app.ServiceState, error) {
	return nil, nil
}

func (m *mockInspector) InspectWithMetrics(ctx context.Context, dest app.DestinationSpec) ([]app.ServiceStatus, error) {
	return nil, nil
}

func (m *mockInspector) SystemInfo(ctx context.Context, dockerHost string) (*app.DockerHostInfo, error) {
	return nil, nil
}

func (m *mockInspector) HostStats(ctx context.Context, dockerHost string) (*app.HostStats, error) {
	return nil, nil
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

// healthyState returns a service state that is running and healthy.
func healthyState(name string) app.ServiceState {
	return app.ServiceState{
		Name:   name,
		Status: "running",
		Health: app.HealthStatusHealthy,
	}
}

// runningState returns a service state that is running (used to indicate "active" color).
func runningState(name string) app.ServiceState {
	return app.ServiceState{
		Name:   name,
		Status: "running",
		Health: app.HealthStatusHealthy,
	}
}

// degradedState returns a service state that is degraded.
func degradedState(name string) app.ServiceState {
	return app.ServiceState{
		Name:   name,
		Status: "running",
		Health: app.HealthStatusDegraded,
	}
}

// --- Tests ---

// TestBlueGreen_FirstDeploy verifies that when no color exists, the first deploy
// targets the blue project.
func TestBlueGreen_FirstDeploy(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	// Detection phase: both blue and green return empty (no running containers).
	// These two results are consumed by detectActiveColor (one for blue, one for green).
	insp.addResult("myapp-blue", nil, nil)  // detection: blue has no containers
	insp.addResult("myapp-green", nil, nil) // detection: green has no containers (not checked since blue is first)

	// Health polling phase: blue is healthy after deploy.
	// This result is consumed repeatedly by waitForHealthy.
	insp.addResult("myapp-blue", []app.ServiceState{healthyState("web")}, nil)

	bg := NewBlueGreen(inner, insp, logger)
	bg.pollInterval = 10 * time.Millisecond // fast polling for tests

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := bg.Deploy(context.Background(), req); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	// Should have deployed to myapp-blue.
	if len(inner.deployCalls) != 1 {
		t.Fatalf("expected 1 deploy call, got %d", len(inner.deployCalls))
	}
	if inner.deployCalls[0].ProjectName != "myapp-blue" {
		t.Errorf("expected deploy to myapp-blue, got %q", inner.deployCalls[0].ProjectName)
	}

	// No old color to stop (first deploy), so Down should not have been called.
	if len(inner.downCalls) != 0 {
		t.Errorf("expected 0 Down calls on first deploy, got %d: %v", len(inner.downCalls), inner.downCalls)
	}
}

// TestBlueGreen_DeployWithExistingBlue verifies that when blue is active,
// the deployer targets green and then stops blue.
func TestBlueGreen_DeployWithExistingBlue(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	// Detection phase: blue has running containers → blue is active.
	insp.addResult("myapp-blue", []app.ServiceState{runningState("web")}, nil)

	// Health polling phase: green is healthy after deploy.
	insp.addResult("myapp-green", []app.ServiceState{healthyState("web")}, nil)

	bg := NewBlueGreen(inner, insp, logger)
	bg.pollInterval = 10 * time.Millisecond // fast polling for tests

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := bg.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy with blue active: %v", err)
	}

	// Should have deployed to myapp-green.
	if len(inner.deployCalls) != 1 {
		t.Fatalf("expected 1 deploy call, got %d", len(inner.deployCalls))
	}
	if inner.deployCalls[0].ProjectName != "myapp-green" {
		t.Errorf("expected deploy to myapp-green, got %q", inner.deployCalls[0].ProjectName)
	}

	// Should have stopped myapp-blue.
	if len(inner.downCalls) != 1 {
		t.Fatalf("expected 1 Down call, got %d", len(inner.downCalls))
	}
	if inner.downCalls[0].ProjectName != "myapp-blue" {
		t.Errorf("expected Down on myapp-blue, got %q", inner.downCalls[0].ProjectName)
	}
}

// TestBlueGreen_DeployWithExistingGreen verifies that when green is active,
// the deployer targets blue and then stops green.
func TestBlueGreen_DeployWithExistingGreen(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	// Detection phase: blue has no containers.
	insp.addResult("myapp-blue", nil, nil)
	// Detection phase: green has running containers → green is active.
	insp.addResult("myapp-green", []app.ServiceState{runningState("api")}, nil)

	// Health polling phase: blue is healthy after deploy.
	insp.addResult("myapp-blue", []app.ServiceState{healthyState("api")}, nil)

	bg := NewBlueGreen(inner, insp, logger)
	bg.pollInterval = 10 * time.Millisecond // fast polling for tests

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := bg.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy with green active: %v", err)
	}

	// Should have deployed to myapp-blue.
	if len(inner.deployCalls) != 1 {
		t.Fatalf("expected 1 deploy call, got %d", len(inner.deployCalls))
	}
	if inner.deployCalls[0].ProjectName != "myapp-blue" {
		t.Errorf("expected deploy to myapp-blue, got %q", inner.deployCalls[0].ProjectName)
	}

	// Should have stopped myapp-green.
	if len(inner.downCalls) != 1 {
		t.Fatalf("expected 1 Down call, got %d", len(inner.downCalls))
	}
	if inner.downCalls[0].ProjectName != "myapp-green" {
		t.Errorf("expected Down on myapp-green, got %q", inner.downCalls[0].ProjectName)
	}
}

// TestBlueGreen_HealthCheckFailure verifies that when the new color fails health
// checks, it is torn down and the error is returned.
func TestBlueGreen_HealthCheckFailure(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	// Detection phase: blue has running containers → blue is active.
	insp.addResult("myapp-blue", []app.ServiceState{runningState("web")}, nil)

	// Health polling phase: green is always degraded (fails health check).
	// This result will be repeated because it's the last (and only) entry.
	insp.addResult("myapp-green", []app.ServiceState{degradedState("web")}, nil)

	bg := NewBlueGreen(inner, insp, logger)
	bg.pollInterval = 5 * time.Millisecond // fast polling for tests
	bg.timeout = 50 * time.Millisecond    // short timeout so the test completes quickly

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	err := bg.Deploy(context.Background(), req)
	if err == nil {
		t.Fatal("expected error when health check fails")
	}

	// Should have deployed to myapp-green.
	if len(inner.deployCalls) != 1 || inner.deployCalls[0].ProjectName != "myapp-green" {
		t.Errorf("expected deploy to myapp-green, got %v", inner.deployCalls)
	}

	// Should have called Down on myapp-green to clean up the failed deployment.
	downedGreen := false
	for _, d := range inner.downCalls {
		if d.ProjectName == "myapp-green" {
			downedGreen = true
		}
	}
	if !downedGreen {
		t.Errorf("expected Down on myapp-green for cleanup, got downCalls: %v", inner.downCalls)
	}

	// Should NOT have stopped the old blue (it's still the active color).
	for _, d := range inner.downCalls {
		if d.ProjectName == "myapp-blue" {
			t.Errorf("should not have stopped myapp-blue when new color failed, got downCalls: %v", inner.downCalls)
		}
	}
}

// TestBlueGreen_Down verifies that Down stops both the blue and green projects.
func TestBlueGreen_Down(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	bg := NewBlueGreen(inner, insp, logger)

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := bg.Down(context.Background(), req); err != nil {
		t.Fatalf("Down: %v", err)
	}

	// Should have stopped both myapp-blue and myapp-green.
	if len(inner.downCalls) != 2 {
		t.Fatalf("expected 2 Down calls, got %d: %v", len(inner.downCalls), inner.downCalls)
	}

	projects := make(map[string]bool)
	for _, d := range inner.downCalls {
		projects[d.ProjectName] = true
	}

	if !projects["myapp-blue"] {
		t.Error("expected Down on myapp-blue")
	}
	if !projects["myapp-green"] {
		t.Error("expected Down on myapp-green")
	}
}

// TestBlueGreen_ColoredProject verifies the project name helper.
func TestBlueGreen_ColoredProject(t *testing.T) {
	tests := []struct {
		project string
		color   string
		want    string
	}{
		{"myapp", "blue", "myapp-blue"},
		{"myapp", "green", "myapp-green"},
		{"my-app", "blue", "my-app-blue"},
	}
	for _, tc := range tests {
		got := coloredProject(tc.project, tc.color)
		if got != tc.want {
			t.Errorf("coloredProject(%q, %q) = %q, want %q", tc.project, tc.color, got, tc.want)
		}
	}
}

// TestBlueGreen_OppositeColor verifies the color switching logic.
func TestBlueGreen_OppositeColor(t *testing.T) {
	tests := []struct {
		active string
		want   string
	}{
		{"blue", "green"},
		{"green", "blue"},
		{"", "blue"}, // first deploy → blue
	}
	for _, tc := range tests {
		got := oppositeColor(tc.active)
		if got != tc.want {
			t.Errorf("oppositeColor(%q) = %q, want %q", tc.active, got, tc.want)
		}
	}
}

// TestBlueGreen_AllHealthy verifies the health aggregation helper.
func TestBlueGreen_AllHealthy(t *testing.T) {
	tests := []struct {
		name   string
		states []app.ServiceState
		want   bool
	}{
		{
			name:   "empty states",
			states: nil,
			want:   false,
		},
		{
			name:   "all healthy",
			states: []app.ServiceState{healthyState("a"), healthyState("b")},
			want:   true,
		},
		{
			name: "one degraded",
			states: []app.ServiceState{
				healthyState("a"),
				{Name: "b", Health: app.HealthStatusDegraded},
			},
			want: false,
		},
		{
			name: "one progressing",
			states: []app.ServiceState{
				{Name: "a", Health: app.HealthStatusProgressing},
			},
			want: false,
		},
		{
			name: "one unknown",
			states: []app.ServiceState{
				{Name: "a", Health: app.HealthStatusUnknown},
			},
			want: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := allHealthy(tc.states)
			if got != tc.want {
				t.Errorf("allHealthy() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestBlueGreen_InspectorError verifies that an inspector error during color
// detection propagates as an error.
func TestBlueGreen_InspectorError(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	// Detection will fail on blue.
	insp.addResult("myapp-blue", nil, fmt.Errorf("docker daemon unavailable"))

	bg := NewBlueGreen(inner, insp, logger)

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	err := bg.Deploy(context.Background(), req)
	if err == nil {
		t.Fatal("expected error when inspector fails")
	}

	// Should not have deployed anything.
	if len(inner.deployCalls) != 0 {
		t.Errorf("expected no deploy calls, got %d", len(inner.deployCalls))
	}
}

// TestBlueGreen_DeployServices_Delegates verifies that DeployServices delegates to inner.
func TestBlueGreen_DeployServices_Delegates(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	bg := NewBlueGreen(inner, insp, logger)

	req := DeployRequest{
		ProjectName: "myapp",
	}

	if err := bg.DeployServices(context.Background(), req, []string{"web"}); err != nil {
		t.Fatalf("DeployServices: %v", err)
	}
}

// TestBlueGreen_RunHook_Delegates verifies that RunHook delegates to inner.
func TestBlueGreen_RunHook_Delegates(t *testing.T) {
	inner := newMockDeployer()
	insp := newMockInspector()
	logger := testLogger()

	bg := NewBlueGreen(inner, insp, logger)

	req := DeployRequest{
		ProjectName: "myapp",
	}

	if err := bg.RunHook(context.Background(), req, "migrate"); err != nil {
		t.Fatalf("RunHook: %v", err)
	}
}
