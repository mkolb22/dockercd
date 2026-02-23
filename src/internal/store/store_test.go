package store

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	s, err := New(":memory:", logger)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestMigrations(t *testing.T) {
	s := newTestStore(t)
	version := s.getCurrentVersion()
	if version < 1 {
		t.Fatalf("expected migration version >= 1, got %d", version)
	}
}

func TestCreateAndGetApplication(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{
		Name:         "test-app",
		Manifest:     "apiVersion: dockercd/v1\nkind: Application",
		SyncStatus:   "Unknown",
		HealthStatus: "Unknown",
	}

	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if app.ID == "" {
		t.Fatal("expected ID to be generated")
	}

	got, err := s.GetApplication(ctx, "test-app")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected application, got nil")
	}
	if got.Name != "test-app" {
		t.Errorf("expected name=test-app, got %q", got.Name)
	}
	if got.SyncStatus != "Unknown" {
		t.Errorf("expected syncStatus=Unknown, got %q", got.SyncStatus)
	}
}

func TestGetApplication_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetApplication(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent app")
	}
}

func TestCreateApplication_DuplicateName(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "dup-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("first create failed: %v", err)
	}

	app2 := &ApplicationRecord{Name: "dup-app", Manifest: "test2", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app2); err == nil {
		t.Fatal("expected error for duplicate name")
	}
}

func TestListApplications(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for _, name := range []string{"charlie", "alpha", "bravo"} {
		app := &ApplicationRecord{Name: name, Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
		if err := s.CreateApplication(ctx, app); err != nil {
			t.Fatalf("create %q: %v", name, err)
		}
	}

	apps, err := s.ListApplications(ctx)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(apps) != 3 {
		t.Fatalf("expected 3 apps, got %d", len(apps))
	}
	// Should be alphabetically ordered
	if apps[0].Name != "alpha" || apps[1].Name != "bravo" || apps[2].Name != "charlie" {
		t.Errorf("expected alphabetical order, got %s, %s, %s", apps[0].Name, apps[1].Name, apps[2].Name)
	}
}

func TestUpdateApplicationStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "status-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	now := time.Now().UTC()
	if err := s.UpdateApplicationStatus(ctx, "status-app", StatusUpdate{
		SyncStatus:    "Synced",
		HealthStatus:  "Healthy",
		LastSyncedSHA: "abc123",
		HeadSHA:       "abc123",
		LastSyncTime:  &now,
	}); err != nil {
		t.Fatalf("update failed: %v", err)
	}

	got, _ := s.GetApplication(ctx, "status-app")
	if got.SyncStatus != "Synced" {
		t.Errorf("expected Synced, got %q", got.SyncStatus)
	}
	if got.HealthStatus != "Healthy" {
		t.Errorf("expected Healthy, got %q", got.HealthStatus)
	}
	if got.LastSyncedSHA != "abc123" {
		t.Errorf("expected sha abc123, got %q", got.LastSyncedSHA)
	}
}

func TestUpdateApplicationStatus_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.UpdateApplicationStatus(ctx, "nonexistent", StatusUpdate{SyncStatus: "Synced"})
	if err == nil {
		t.Fatal("expected error for nonexistent app")
	}
}

func TestDeleteApplication(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "del-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if err := s.DeleteApplication(ctx, "del-app"); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	got, _ := s.GetApplication(ctx, "del-app")
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestDeleteApplication_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.DeleteApplication(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent app")
	}
}

func TestRecordAndListSync(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "sync-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create app failed: %v", err)
	}

	now := time.Now().UTC()
	finished := now.Add(5 * time.Second)
	record := &SyncRecord{
		AppName:    "sync-app",
		StartedAt:  now,
		FinishedAt: &finished,
		CommitSHA:  "def456",
		Operation:  "poll",
		Result:     "success",
		DurationMs: 5000,
	}

	if err := s.RecordSync(ctx, record); err != nil {
		t.Fatalf("record sync failed: %v", err)
	}

	history, err := s.ListSyncHistory(ctx, "sync-app", 10)
	if err != nil {
		t.Fatalf("list sync history failed: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("expected 1 record, got %d", len(history))
	}
	if history[0].CommitSHA != "def456" {
		t.Errorf("expected sha def456, got %q", history[0].CommitSHA)
	}
	if history[0].Result != "success" {
		t.Errorf("expected result success, got %q", history[0].Result)
	}
}

func TestRecordAndListEvents(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "event-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create app failed: %v", err)
	}

	event := &EventRecord{
		AppName:  "event-app",
		Type:     "SyncCompleted",
		Message:  "Sync succeeded",
		Severity: "info",
	}

	if err := s.RecordEvent(ctx, event); err != nil {
		t.Fatalf("record event failed: %v", err)
	}

	events, err := s.ListEvents(ctx, "event-app", 10)
	if err != nil {
		t.Fatalf("list events failed: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "SyncCompleted" {
		t.Errorf("expected type SyncCompleted, got %q", events[0].Type)
	}
}

func TestCascadeDelete(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	app := &ApplicationRecord{Name: "cascade-app", Manifest: "test", SyncStatus: "Unknown", HealthStatus: "Unknown"}
	if err := s.CreateApplication(ctx, app); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	// Add sync record and event
	now := time.Now().UTC()
	_ = s.RecordSync(ctx, &SyncRecord{AppName: "cascade-app", StartedAt: now, Operation: "poll", Result: "success"})
	_ = s.RecordEvent(ctx, &EventRecord{AppName: "cascade-app", Type: "Test", Message: "test"})

	// Delete app — should cascade
	if err := s.DeleteApplication(ctx, "cascade-app"); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	history, _ := s.ListSyncHistory(ctx, "cascade-app", 10)
	if len(history) != 0 {
		t.Errorf("expected sync history to be cascaded, got %d records", len(history))
	}

	events, _ := s.ListEvents(ctx, "cascade-app", 10)
	if len(events) != 0 {
		t.Errorf("expected events to be cascaded, got %d records", len(events))
	}
}

// --- Docker Host Tests ---

func TestCreateAndGetDockerHost(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{
		Name:      "my-server",
		URL:       "tcp://192.168.1.100:2376",
		TLSCertPath: "/certs/my-server",
		TLSVerify: true,
	}

	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if host.ID == "" {
		t.Fatal("expected ID to be generated")
	}

	got, err := s.GetDockerHost(ctx, "my-server")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected host, got nil")
	}
	if got.Name != "my-server" {
		t.Errorf("expected name=my-server, got %q", got.Name)
	}
	if got.URL != "tcp://192.168.1.100:2376" {
		t.Errorf("expected URL, got %q", got.URL)
	}
	if got.TLSCertPath != "/certs/my-server" {
		t.Errorf("expected TLSCertPath, got %q", got.TLSCertPath)
	}
	if !got.TLSVerify {
		t.Error("expected TLSVerify=true")
	}
	if got.HealthStatus != "Unknown" {
		t.Errorf("expected HealthStatus=Unknown, got %q", got.HealthStatus)
	}
}

func TestGetDockerHost_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	got, err := s.GetDockerHost(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent host")
	}
}

func TestGetDockerHostByURL(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "srv1", URL: "tcp://10.0.0.1:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := s.GetDockerHostByURL(ctx, "tcp://10.0.0.1:2376")
	if err != nil {
		t.Fatalf("get by URL failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected host, got nil")
	}
	if got.Name != "srv1" {
		t.Errorf("expected name=srv1, got %q", got.Name)
	}
}

func TestCreateDockerHost_DuplicateName(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	h1 := &DockerHostRecord{Name: "dup", URL: "tcp://1.1.1.1:2376"}
	if err := s.CreateDockerHost(ctx, h1); err != nil {
		t.Fatalf("first create failed: %v", err)
	}

	h2 := &DockerHostRecord{Name: "dup", URL: "tcp://2.2.2.2:2376"}
	if err := s.CreateDockerHost(ctx, h2); err == nil {
		t.Fatal("expected error for duplicate name")
	}
}

func TestCreateDockerHost_DuplicateURL(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	h1 := &DockerHostRecord{Name: "host-a", URL: "tcp://1.1.1.1:2376"}
	if err := s.CreateDockerHost(ctx, h1); err != nil {
		t.Fatalf("first create failed: %v", err)
	}

	h2 := &DockerHostRecord{Name: "host-b", URL: "tcp://1.1.1.1:2376"}
	if err := s.CreateDockerHost(ctx, h2); err == nil {
		t.Fatal("expected error for duplicate URL")
	}
}

func TestListDockerHosts(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for _, name := range []string{"charlie", "alpha", "bravo"} {
		h := &DockerHostRecord{Name: name, URL: "tcp://" + name + ":2376"}
		if err := s.CreateDockerHost(ctx, h); err != nil {
			t.Fatalf("create %q: %v", name, err)
		}
	}

	hosts, err := s.ListDockerHosts(ctx)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(hosts) != 3 {
		t.Fatalf("expected 3 hosts, got %d", len(hosts))
	}
	if hosts[0].Name != "alpha" || hosts[1].Name != "bravo" || hosts[2].Name != "charlie" {
		t.Errorf("expected alphabetical order, got %s, %s, %s", hosts[0].Name, hosts[1].Name, hosts[2].Name)
	}
}

func TestUpdateDockerHostStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "status-host", URL: "tcp://10.0.0.5:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	now := time.Now().UTC()
	if err := s.UpdateDockerHostStatus(ctx, "status-host", HostStatusUpdate{
		HealthStatus: "Healthy",
		LastCheck:    &now,
		InfoJSON:     `{"serverVersion":"24.0"}`,
	}); err != nil {
		t.Fatalf("update failed: %v", err)
	}

	got, _ := s.GetDockerHost(ctx, "status-host")
	if got.HealthStatus != "Healthy" {
		t.Errorf("expected Healthy, got %q", got.HealthStatus)
	}
	if got.LastCheck == nil {
		t.Error("expected LastCheck to be set")
	}
	if got.InfoJSON != `{"serverVersion":"24.0"}` {
		t.Errorf("expected info JSON, got %q", got.InfoJSON)
	}
}

func TestUpdateDockerHostStatus_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.UpdateDockerHostStatus(ctx, "nonexistent", HostStatusUpdate{HealthStatus: "Healthy"})
	if err == nil {
		t.Fatal("expected error for nonexistent host")
	}
}

func TestDeleteDockerHost(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "del-host", URL: "tcp://10.0.0.10:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if err := s.DeleteDockerHost(ctx, "del-host"); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	got, _ := s.GetDockerHost(ctx, "del-host")
	if got != nil {
		t.Fatal("expected nil after delete")
	}
}

func TestDeleteDockerHost_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.DeleteDockerHost(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent host")
	}
}

func TestParseVersion(t *testing.T) {
	cases := []struct {
		name    string
		version int
	}{
		{"001_initial.sql", 1},
		{"002_add_index.sql", 2},
		{"010_something.sql", 10},
		{"bad_name.sql", 0},
	}

	for _, tc := range cases {
		got := parseVersion(tc.name)
		if got != tc.version {
			t.Errorf("parseVersion(%q) = %d, want %d", tc.name, got, tc.version)
		}
	}
}
