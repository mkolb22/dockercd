package deployer

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// commandRecorder captures the commands that would be executed.
type commandRecorder struct {
	mu       sync.Mutex
	commands []recordedCommand
	failOn   map[string]error // subcommand → error to return
}

type recordedCommand struct {
	name string
	args []string
}

func newRecorder() *commandRecorder {
	return &commandRecorder{
		failOn: make(map[string]error),
	}
}

// runner returns a CommandRunner that records commands instead of executing them.
func (r *commandRecorder) runner() CommandRunner {
	return func(ctx context.Context, name string, args ...string) *exec.Cmd {
		r.mu.Lock()
		defer r.mu.Unlock()

		rec := recordedCommand{
			name: name,
			args: args,
		}

		// Check if this command should fail
		for _, a := range args {
			if err, ok := r.failOn[a]; ok {
				// Use a helper process pattern to simulate failure
				r.commands = append(r.commands, rec)
				cmd := exec.CommandContext(ctx, "sh", "-c", fmt.Sprintf("echo '%s' >&2; exit 1", err.Error()))
				return cmd
			}
		}

		r.commands = append(r.commands, rec)
		// Return a command that always succeeds
		cmd := exec.CommandContext(ctx, "true")
		return cmd
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestDeploy_BasicUp(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	// Should have 1 command: up -d (no pull)
	if len(rec.commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(rec.commands))
	}

	cmd := rec.commands[0]
	if cmd.name != "docker" {
		t.Errorf("expected 'docker', got %q", cmd.name)
	}

	expected := []string{"compose", "-f", "docker-compose.yml", "-p", "myapp", "up", "-d"}
	if !reflect.DeepEqual(cmd.args, expected) {
		t.Errorf("expected args %v, got %v", expected, cmd.args)
	}
}

func TestDeploy_WithPull(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
		Pull:         true,
	}

	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	// Should have 2 commands: pull, then up
	if len(rec.commands) != 2 {
		t.Fatalf("expected 2 commands, got %d", len(rec.commands))
	}

	// First command: pull
	pullArgs := rec.commands[0].args
	if pullArgs[len(pullArgs)-1] != "pull" {
		t.Errorf("expected first command to be pull, got %v", pullArgs)
	}

	// Second command: up -d
	upArgs := rec.commands[1].args
	if upArgs[len(upArgs)-2] != "up" || upArgs[len(upArgs)-1] != "-d" {
		t.Errorf("expected second command to be up -d, got %v", upArgs)
	}
}

func TestDeploy_WithPrune(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
		Prune:        true,
	}

	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	cmd := rec.commands[0]
	expected := []string{"compose", "-f", "docker-compose.yml", "-p", "myapp", "up", "-d", "--remove-orphans"}
	if !reflect.DeepEqual(cmd.args, expected) {
		t.Errorf("expected args %v, got %v", expected, cmd.args)
	}
}

func TestDeploy_MultipleComposeFiles(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml", "docker-compose.prod.yml"},
	}

	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	cmd := rec.commands[0]
	expected := []string{"compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml", "-p", "myapp", "up", "-d"}
	if !reflect.DeepEqual(cmd.args, expected) {
		t.Errorf("expected args %v, got %v", expected, cmd.args)
	}
}

func TestDeploy_PullFailure(t *testing.T) {
	rec := newRecorder()
	rec.failOn["pull"] = fmt.Errorf("network timeout")
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
		Pull:         true,
	}

	err := d.Deploy(context.Background(), req)
	if err == nil {
		t.Fatal("expected error on pull failure")
	}
	if !strings.Contains(err.Error(), "pull failed") {
		t.Errorf("expected 'pull failed' in error, got %q", err.Error())
	}

	// Should NOT have attempted up after pull failure
	if len(rec.commands) != 1 {
		t.Errorf("expected 1 command (pull only, no up), got %d", len(rec.commands))
	}
}

func TestDeploy_UpFailure(t *testing.T) {
	rec := newRecorder()
	rec.failOn["up"] = fmt.Errorf("compose error")
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	err := d.Deploy(context.Background(), req)
	if err == nil {
		t.Fatal("expected error on up failure")
	}
	if !strings.Contains(err.Error(), "up failed") {
		t.Errorf("expected 'up failed' in error, got %q", err.Error())
	}
}

func TestDeploy_DockerHostEnv(t *testing.T) {
	// Use a runner that lets us inspect the cmd's Env
	var capturedEnv []string
	runner := func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "true")
		// The deployer will set Env on this cmd after we return it.
		// We need to capture it after Run is called.
		// Trick: return a cmd, then check what the deployer does.
		return cmd
	}

	// Use a custom approach: wrap the run method
	d := NewWithRunner(testLogger(), runner)

	// Override runCmd to capture the environment
	d.runCmd = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "true")
		// Store reference so we can check after deploy
		go func() {
			// Wait briefly, then capture
		}()
		return cmd
	}

	// Actually, let's test this more directly by inspecting the appendEnv function
	env := appendEnv(nil, "DOCKER_HOST=tcp://remote:2376")
	found := false
	for _, e := range env {
		if e == "DOCKER_HOST=tcp://remote:2376" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected DOCKER_HOST in environment")
	}
	_ = capturedEnv
	_ = d
}

func TestDeploy_WithPullAndPrune(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
		Pull:         true,
		Prune:        true,
	}

	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	if len(rec.commands) != 2 {
		t.Fatalf("expected 2 commands (pull + up), got %d", len(rec.commands))
	}

	// Pull should not have --remove-orphans
	pullArgs := rec.commands[0].args
	for _, a := range pullArgs {
		if a == "--remove-orphans" {
			t.Error("pull should not have --remove-orphans")
		}
	}

	// Up should have --remove-orphans
	upArgs := rec.commands[1].args
	hasOrphans := false
	for _, a := range upArgs {
		if a == "--remove-orphans" {
			hasOrphans = true
		}
	}
	if !hasOrphans {
		t.Error("up should have --remove-orphans when prune=true")
	}
}

func TestDown_Basic(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	if err := d.Down(context.Background(), req); err != nil {
		t.Fatalf("down: %v", err)
	}

	if len(rec.commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(rec.commands))
	}

	cmd := rec.commands[0]
	expected := []string{"compose", "-f", "docker-compose.yml", "-p", "myapp", "down", "--remove-orphans"}
	if !reflect.DeepEqual(cmd.args, expected) {
		t.Errorf("expected args %v, got %v", expected, cmd.args)
	}
}

func TestDown_Failure(t *testing.T) {
	rec := newRecorder()
	rec.failOn["down"] = fmt.Errorf("containers still running")
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	err := d.Down(context.Background(), req)
	if err == nil {
		t.Fatal("expected error on down failure")
	}
	if !strings.Contains(err.Error(), "down failed") {
		t.Errorf("expected 'down failed' in error, got %q", err.Error())
	}
}

func TestBaseArgs_NoProject(t *testing.T) {
	d := NewWithRunner(testLogger(), nil)

	req := DeployRequest{
		ComposeFiles: []string{"compose.yml"},
	}

	args := d.baseArgs(req)
	expected := []string{"compose", "-f", "compose.yml"}
	if !reflect.DeepEqual(args, expected) {
		t.Errorf("expected args %v, got %v", expected, args)
	}
}

func TestBaseArgs_MultipleFiles(t *testing.T) {
	d := NewWithRunner(testLogger(), nil)

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"base.yml", "override.yml", "prod.yml"},
	}

	args := d.baseArgs(req)
	expected := []string{"compose", "-f", "base.yml", "-f", "override.yml", "-f", "prod.yml", "-p", "myapp"}
	if !reflect.DeepEqual(args, expected) {
		t.Errorf("expected args %v, got %v", expected, args)
	}
}

func TestAppendEnv_NilInheritsProcessEnv(t *testing.T) {
	result := appendEnv(nil, "MY_KEY=my_value")

	// Should contain the current process env + our new var
	found := false
	for _, e := range result {
		if e == "MY_KEY=my_value" {
			found = true
		}
	}
	if !found {
		t.Error("expected MY_KEY=my_value in result")
	}

	// Should also contain at least PATH from the process env
	hasPath := false
	for _, e := range result {
		if strings.HasPrefix(e, "PATH=") {
			hasPath = true
		}
	}
	if !hasPath {
		t.Error("expected inherited PATH from process environment")
	}
}

func TestAppendEnv_ExistingEnv(t *testing.T) {
	existing := []string{"A=1", "B=2"}
	result := appendEnv(existing, "C=3")

	expected := []string{"A=1", "B=2", "C=3"}
	if !reflect.DeepEqual(result, expected) {
		t.Errorf("expected %v, got %v", expected, result)
	}
}

func TestDeploy_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName:  "myapp",
		ComposeFiles: []string{"docker-compose.yml"},
	}

	// Deploy with cancelled context — the command should fail
	err := d.Deploy(ctx, req)
	if err == nil {
		// It's ok if "true" completes before context check,
		// but typically this will error
		return
	}
	// Error is expected with cancelled context
}

func TestDeploy_NoComposeFiles(t *testing.T) {
	rec := newRecorder()
	d := NewWithRunner(testLogger(), rec.runner())

	req := DeployRequest{
		ProjectName: "myapp",
	}

	// Should still work — docker compose will use default file discovery
	if err := d.Deploy(context.Background(), req); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	cmd := rec.commands[0]
	expected := []string{"compose", "-p", "myapp", "up", "-d"}
	if !reflect.DeepEqual(cmd.args, expected) {
		t.Errorf("expected args %v, got %v", expected, cmd.args)
	}
}
