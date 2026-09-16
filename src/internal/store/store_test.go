package store

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
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

func TestRecordSync_DropsComposeSnapshot(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.CreateApplication(ctx, &ApplicationRecord{Name: "test-app", Manifest: "{}"}); err != nil {
		t.Fatalf("create application: %v", err)
	}
	now := time.Now().UTC()
	record := &SyncRecord{
		AppName:         "test-app",
		StartedAt:       now,
		FinishedAt:      &now,
		Operation:       "poll",
		Result:          "success",
		ComposeSpecJSON: `{"services":[{"environment":{"PASSWORD":"secret"}}]}`,
	}
	if err := s.RecordSync(ctx, record); err != nil {
		t.Fatalf("record sync: %v", err)
	}

	history, err := s.ListSyncHistory(ctx, "test-app", 1)
	if err != nil {
		t.Fatalf("list sync history: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history length = %d, want 1", len(history))
	}
	if history[0].ComposeSpecJSON != "" {
		t.Fatalf("compose snapshot was retained: %q", history[0].ComposeSpecJSON)
	}
}

func TestListRecentSyncHistory_GroupsRecordsByApplication(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, name := range []string{"alpha", "bravo"} {
		if err := s.CreateApplication(ctx, &ApplicationRecord{Name: name, Manifest: "{}"}); err != nil {
			t.Fatalf("create application %q: %v", name, err)
		}
		for i := 0; i < 3; i++ {
			now := time.Now().UTC().Add(time.Duration(i) * time.Second)
			if err := s.RecordSync(ctx, &SyncRecord{AppName: name, StartedAt: now, FinishedAt: &now, Operation: "poll", Result: "success"}); err != nil {
				t.Fatalf("record sync: %v", err)
			}
		}
	}

	history, err := s.ListRecentSyncHistory(ctx, 2)
	if err != nil {
		t.Fatalf("list recent history: %v", err)
	}
	if len(history["alpha"]) != 2 || len(history["bravo"]) != 2 {
		t.Fatalf("unexpected per-app history lengths: %#v", history)
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

func TestGetApplicationStatusSummary(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.CreateApplication(ctx, &ApplicationRecord{
		Name: "summary-app", Manifest: `{"contains":"sensitive desired state"}`, SyncStatus: "Synced", HealthStatus: "Healthy",
	}); err != nil {
		t.Fatalf("create application: %v", err)
	}
	lastSync := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	if err := s.UpdateApplicationStatus(ctx, "summary-app", StatusUpdate{
		LastSyncedSHA: "abc123", HeadSHA: "def456", LastSyncTime: &lastSync, LastError: StringPtr("secret error"),
	}); err != nil {
		t.Fatalf("update application status: %v", err)
	}
	current, err := s.GetApplication(ctx, "summary-app")
	if err != nil {
		t.Fatal(err)
	}
	lastObserved := lastSync.Add(30 * time.Second)
	if updated, err := s.RecordHealthObservation(ctx, "summary-app", current.UpdatedAt, "Healthy", `[]`, lastObserved); err != nil || !updated {
		t.Fatalf("record health observation = %t, %v", updated, err)
	}

	summary, err := s.GetApplicationStatusSummary(ctx, "summary-app")
	if err != nil {
		t.Fatalf("get application status summary: %v", err)
	}
	if summary == nil || summary.Name != "summary-app" || summary.SyncStatus != "Synced" || summary.HealthStatus != "Healthy" || summary.LastSyncedSHA != "abc123" || summary.HeadSHA != "def456" || summary.LastSyncTime == nil || !summary.LastSyncTime.Equal(lastSync) || summary.LastObservationTime == nil || !summary.LastObservationTime.Equal(lastObserved) {
		t.Fatalf("unexpected status summary: %+v", summary)
	}
	if err := s.CreateApplication(ctx, &ApplicationRecord{Name: "empty-summary", Manifest: `{}`, SyncStatus: "Unknown", HealthStatus: "Unknown"}); err != nil {
		t.Fatalf("create application with null status fields: %v", err)
	}
	empty, err := s.GetApplicationStatusSummary(ctx, "empty-summary")
	if err != nil || empty == nil || empty.LastSyncedSHA != "" || empty.HeadSHA != "" || empty.LastSyncTime != nil {
		t.Fatalf("unexpected null status fields: %#v, %v", empty, err)
	}

	missing, err := s.GetApplicationStatusSummary(ctx, "missing")
	if err != nil || missing != nil {
		t.Fatalf("missing status summary = %#v, %v", missing, err)
	}
}

func TestRecordHealthObservationRejectsStaleWriter(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.CreateApplication(ctx, &ApplicationRecord{Name: "observed-app", Manifest: `{}`, SyncStatus: "Synced", HealthStatus: "Unknown"}); err != nil {
		t.Fatalf("create application: %v", err)
	}
	original, err := s.GetApplication(ctx, "observed-app")
	if err != nil {
		t.Fatalf("read application: %v", err)
	}
	firstAt := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	updated, err := s.RecordHealthObservation(ctx, "observed-app", original.UpdatedAt, "Healthy", `[{"name":"web"}]`, firstAt)
	if err != nil || !updated {
		t.Fatalf("record first observation = %t, %v", updated, err)
	}
	secondAt := firstAt.Add(time.Minute)
	updated, err = s.RecordHealthObservation(ctx, "observed-app", original.UpdatedAt, "Degraded", `[{"name":"web"}]`, secondAt)
	if err != nil || updated {
		t.Fatalf("stale observation update = %t, %v", updated, err)
	}
	stored, err := s.GetApplication(ctx, "observed-app")
	if err != nil || stored.LastObservedHealthStatus != "Healthy" || stored.LastObservationTime == nil || !stored.LastObservationTime.Equal(firstAt) {
		t.Fatalf("stale observation overwrote stored state: %#v, %v", stored, err)
	}
}

func TestListEventsForApplicationsReturnsMetadataOnlyAndAllowsNullPayload(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, name := range []string{"allowed", "other"} {
		if err := s.CreateApplication(ctx, &ApplicationRecord{Name: name, Manifest: `{}`, SyncStatus: "Unknown", HealthStatus: "Unknown"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO events (id, app_name, type, message, severity, data_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, "allowed-null-payload", "allowed", "SyncSuccess", strings.Repeat("sensitive-message", 1000), "info", nil, time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO events (id, app_name, type, message, severity, data_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, "other-event", "other", "SyncFailed", "not authorized", "error", `{"token":"other-secret"}`, time.Date(2026, 9, 15, 12, 0, 1, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	metadata, err := s.ListEventsForApplications(ctx, []string{"allowed"}, 10)
	if err != nil || len(metadata) != 1 || metadata[0].AppName != "allowed" || metadata[0].Type != "SyncSuccess" {
		t.Fatalf("unexpected activity metadata: %#v, %v", metadata, err)
	}
}

func TestListEventsForApplicationsBoundsPerApplicationCandidates(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, name := range []string{"app-a", "app-b"} {
		if err := s.CreateApplication(ctx, &ApplicationRecord{Name: name, Manifest: `{}`, SyncStatus: "Unknown", HealthStatus: "Unknown"}); err != nil {
			t.Fatal(err)
		}
	}
	base := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	for _, name := range []string{"app-a", "app-b"} {
		for index := 0; index < 5; index++ {
			at := base.Add(time.Duration(index) * time.Second)
			id := fmt.Sprintf("%s-%d", name, index)
			typeName := fmt.Sprintf("%s-%d", name, index)
			if _, err := s.db.ExecContext(ctx, `INSERT INTO events (id, app_name, type, message, severity, data_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`, id, name, typeName, "private", "info", nil, at); err != nil {
				t.Fatal(err)
			}
		}
	}
	events, err := s.ListEventsForApplications(ctx, []string{"app-a", "app-b", "app-a"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("events length = %d, want global limit 2", len(events))
	}
	if events[0].Type != "app-b-4" || events[1].Type != "app-a-4" {
		t.Fatalf("global merge selected %#v, want newest event from each authorized application", events)
	}
	rows, err := s.db.Query(`EXPLAIN QUERY PLAN SELECT app_name FROM events WHERE app_name = ? ORDER BY created_at DESC, id DESC LIMIT 2`, "app-a")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var selectID, order, from int
		var detail string
		if err := rows.Scan(&selectID, &order, &from, &detail); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "idx_events_app_created_id") {
		t.Fatalf("expected composite activity index, plan = %s", plan.String())
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
		Name:        "my-server",
		URL:         "tcp://192.168.1.100:2376",
		TLSCertPath: "/certs/my-server",
		TLSVerify:   true,
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
