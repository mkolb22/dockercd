package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/store"
)

type blockingTagChecker struct {
	mu          sync.Mutex
	active      int
	maxActive   int
	calls       int
	deadlineSet bool
	started     chan struct{}
}

func (c *blockingTagChecker) ListTags(ctx context.Context, _ string) ([]string, error) {
	_, hasDeadline := ctx.Deadline()
	c.mu.Lock()
	c.calls++
	c.active++
	if c.active > c.maxActive {
		c.maxActive = c.active
	}
	c.deadlineSet = c.deadlineSet || hasDeadline
	c.mu.Unlock()

	c.started <- struct{}{}
	<-ctx.Done()

	c.mu.Lock()
	c.active--
	c.mu.Unlock()
	return nil, ctx.Err()
}

func (c *blockingTagChecker) stats() (calls, maxActive int, deadlineSet bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls, c.maxActive, c.deadlineSet
}

type testGitSyncer struct{ paths map[string]string }

func (g *testGitSyncer) Sync(context.Context, app.SourceSpec) (string, error) { return "", nil }
func (g *testGitSyncer) CheckoutSHA(context.Context, string, string) error    { return nil }
func (g *testGitSyncer) RepoPath(repoURL string) string                       { return g.paths[repoURL] }
func (g *testGitSyncer) Commit(context.Context, string, string, []string) error {
	return nil
}
func (g *testGitSyncer) Push(context.Context, string) error { return nil }
func (g *testGitSyncer) Close() error                       { return nil }

func setupPollerStore(t *testing.T) *store.SQLiteStore {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	s, err := store.New(":memory:", logger)
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func createPollerApp(t *testing.T, s *store.SQLiteStore, name, repoURL string) {
	t.Helper()
	manifest := fmt.Sprintf(`{"apiVersion":"dockercd/v1","kind":"Application","metadata":{"name":%q},"spec":{"source":{"repoURL":%q,"targetRevision":"main","path":".","composeFiles":["docker-compose.yml"]},"destination":{"dockerHost":"unix:///var/run/docker.sock","projectName":%q}}}`, name, repoURL, name)
	if err := s.CreateApplication(context.Background(), &store.ApplicationRecord{Name: name, Manifest: manifest}); err != nil {
		t.Fatalf("create app: %v", err)
	}
}

func TestParseImageRef(t *testing.T) {
	tests := []struct {
		input    string
		wantName string
		wantTag  string
	}{
		{"nginx:1.26", "nginx", "1.26"},
		{"nginx", "nginx", "latest"},
		{"myregistry.com/app:v1.0", "myregistry.com/app", "v1.0"},
		{"registry:5000/myapp:2.0", "registry:5000/myapp", "2.0"},
	}

	for _, tt := range tests {
		name, tag := ParseImageRef(tt.input)
		if name != tt.wantName || tag != tt.wantTag {
			t.Errorf("ParseImageRef(%q) = (%q, %q), want (%q, %q)",
				tt.input, name, tag, tt.wantName, tt.wantTag)
		}
	}
}

func TestSemVer_Parse(t *testing.T) {
	tests := []struct {
		input string
		major int
		minor int
		patch int
	}{
		{"1.26.0", 1, 26, 0},
		{"v2.0.1", 2, 0, 1},
		{"1.26", 1, 26, 0},
	}

	for _, tt := range tests {
		sv, err := ParseSemVer(tt.input)
		if err != nil {
			t.Errorf("ParseSemVer(%q): %v", tt.input, err)
			continue
		}
		if sv.Major != tt.major || sv.Minor != tt.minor || sv.Patch != tt.patch {
			t.Errorf("ParseSemVer(%q) = %d.%d.%d, want %d.%d.%d",
				tt.input, sv.Major, sv.Minor, sv.Patch, tt.major, tt.minor, tt.patch)
		}
	}
}

func TestFindLatestTag_Semver(t *testing.T) {
	tags := []string{"1.24.0", "1.25.0", "1.26.0", "1.26.1", "1.27.0", "2.0.0", "latest", "alpine"}

	// PolicySemver: any newer version
	tag, found := FindLatestTag(tags, "1.26.0", PolicySemver)
	if !found || tag != "2.0.0" {
		t.Errorf("semver: expected 2.0.0, got %q (found=%v)", tag, found)
	}

	// PolicyMajor: same major only
	tag, found = FindLatestTag(tags, "1.26.0", PolicyMajor)
	if !found || tag != "1.27.0" {
		t.Errorf("major: expected 1.27.0, got %q (found=%v)", tag, found)
	}

	// PolicyMinor: same major.minor only
	tag, found = FindLatestTag(tags, "1.26.0", PolicyMinor)
	if !found || tag != "1.26.1" {
		t.Errorf("minor: expected 1.26.1, got %q (found=%v)", tag, found)
	}

	// No update available
	_, found = FindLatestTag(tags, "2.0.0", PolicySemver)
	if found {
		t.Error("expected no update for 2.0.0")
	}
}

func TestGenericRegistryChecker_ListTags(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"name": "myapp",
			"tags": []string{"1.0.0", "1.1.0", "2.0.0"},
		})
	}))
	defer srv.Close()

	checker := NewGenericRegistryChecker(srv.URL)
	tags, err := checker.ListTags(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tags) != 3 {
		t.Errorf("expected 3 tags, got %d", len(tags))
	}
}

func TestCheckAllApps_BoundsConcurrencyAndUsesDeadlines(t *testing.T) {
	s := setupPollerStore(t)
	repoPath := t.TempDir()
	compose := `services:
  web:
    image: nginx:1.0.0
    labels:
      com.dockercd.image-policy: semver
`
	if err := os.WriteFile(filepath.Join(repoPath, "docker-compose.yml"), []byte(compose), 0600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	paths := make(map[string]string)
	for i := range 4 {
		repoURL := fmt.Sprintf("https://example.test/repo-%d.git", i)
		paths[repoURL] = repoPath
		createPollerApp(t, s, fmt.Sprintf("app-%d", i), repoURL)
	}
	checker := &blockingTagChecker{started: make(chan struct{}, 4)}
	cfg := DefaultPollerConfig()
	cfg.MaxConcurrentChecks = 2
	cfg.CheckTimeout = 20 * time.Millisecond
	p := NewPoller(checker, &testGitSyncer{paths: paths}, s, nil, slog.Default(), cfg)

	done := make(chan struct{})
	go func() {
		p.checkAllApps(context.Background())
		close(done)
	}()
	for range 4 {
		select {
		case <-checker.started:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for registry checks")
		}
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("registry poll did not finish after check deadlines")
	}

	calls, maxActive, deadlineSet := checker.stats()
	if calls != 4 {
		t.Errorf("expected 4 registry checks, got %d", calls)
	}
	if maxActive > cfg.MaxConcurrentChecks {
		t.Errorf("max concurrent registry checks = %d, limit = %d", maxActive, cfg.MaxConcurrentChecks)
	}
	if !deadlineSet {
		t.Error("expected each registry check to receive a deadline")
	}
}

func TestStartCheckAllApps_SkipsOverlappingPoll(t *testing.T) {
	s := setupPollerStore(t)
	repoPath := t.TempDir()
	compose := `services:
  web:
    image: nginx:1.0.0
    labels:
      com.dockercd.image-policy: semver
`
	if err := os.WriteFile(filepath.Join(repoPath, "docker-compose.yml"), []byte(compose), 0600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}
	repoURL := "https://example.test/repo.git"
	createPollerApp(t, s, "myapp", repoURL)
	checker := &blockingTagChecker{started: make(chan struct{}, 1)}
	cfg := DefaultPollerConfig()
	cfg.CheckTimeout = time.Second
	p := NewPoller(checker, &testGitSyncer{paths: map[string]string{repoURL: repoPath}}, s, nil, slog.Default(), cfg)

	ctx, cancel := context.WithCancel(context.Background())
	p.startCheckAllApps(ctx)
	select {
	case <-checker.started:
	case <-time.After(time.Second):
		t.Fatal("initial poll did not start")
	}
	p.startCheckAllApps(ctx)
	time.Sleep(20 * time.Millisecond)

	calls, _, _ := checker.stats()
	if calls != 1 {
		t.Errorf("expected overlapping poll to be skipped, got %d checks", calls)
	}
	cancel()
	p.wg.Wait()
}
