// contract_test.go — Contract tests for the store package.
// Generated from ZenSpec "docker-host-management".
//
// Tests Docker host CRUD operations against an in-memory SQLite database.
package store

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"pgregory.net/rapid"
)

func newContractTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	s, err := New(":memory:", logger)
	if err != nil {
		t.Fatalf("creating test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// --- Generators ---

func genHostName() *rapid.Generator[string] {
	return rapid.StringMatching(`[a-z][a-z0-9\-]{0,14}`)
}

func genHostURL() *rapid.Generator[string] {
	return rapid.Custom(func(t *rapid.T) string {
		ip1 := rapid.IntRange(1, 254).Draw(t, "ip1")
		ip2 := rapid.IntRange(0, 255).Draw(t, "ip2")
		ip3 := rapid.IntRange(0, 255).Draw(t, "ip3")
		ip4 := rapid.IntRange(1, 254).Draw(t, "ip4")
		return fmt.Sprintf("tcp://%d.%d.%d.%d:2376", ip1, ip2, ip3, ip4)
	})
}

func genDockerHost() *rapid.Generator[DockerHostRecord] {
	return rapid.Custom(func(t *rapid.T) DockerHostRecord {
		return DockerHostRecord{
			Name:      genHostName().Draw(t, "name"),
			URL:       genHostURL().Draw(t, "url"),
			TLSVerify: rapid.Bool().Draw(t, "tlsVerify"),
		}
	})
}

// --- Contract: CreateDockerHost ---

// TestContract_CreateDockerHostSuccess verifies basic creation.
func TestContract_CreateDockerHostSuccess(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{
		Name:      "test-server",
		URL:       "tcp://192.168.1.100:2376",
		TLSVerify: true,
	}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("CreateDockerHost: %v", err)
	}
	if host.ID == "" {
		t.Fatal("CreateDockerHost should set ID")
	}
	if host.HealthStatus != "Unknown" {
		t.Fatalf("default health status: want Unknown, got %q", host.HealthStatus)
	}
	if host.CreatedAt.IsZero() {
		t.Fatal("CreatedAt should be set")
	}
}

// TestContract_CreateDockerHostDuplicateName verifies unique name constraint.
func TestContract_CreateDockerHostDuplicateName(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host1 := &DockerHostRecord{Name: "server-a", URL: "tcp://10.0.0.1:2376"}
	if err := s.CreateDockerHost(ctx, host1); err != nil {
		t.Fatalf("first create: %v", err)
	}
	host2 := &DockerHostRecord{Name: "server-a", URL: "tcp://10.0.0.2:2376"}
	if err := s.CreateDockerHost(ctx, host2); err == nil {
		t.Fatal("duplicate name should fail")
	}
}

// TestContract_CreateDockerHostDuplicateURL verifies unique URL constraint.
func TestContract_CreateDockerHostDuplicateURL(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host1 := &DockerHostRecord{Name: "server-a", URL: "tcp://10.0.0.1:2376"}
	if err := s.CreateDockerHost(ctx, host1); err != nil {
		t.Fatalf("first create: %v", err)
	}
	host2 := &DockerHostRecord{Name: "server-b", URL: "tcp://10.0.0.1:2376"}
	if err := s.CreateDockerHost(ctx, host2); err == nil {
		t.Fatal("duplicate URL should fail")
	}
}

// --- Contract: GetDockerHost ---

// TestContract_GetDockerHostFound verifies retrieval by name.
func TestContract_GetDockerHostFound(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{
		Name:        "my-server",
		URL:         "tcp://192.168.1.50:2376",
		TLSCertPath: "/certs/my-server",
		TLSVerify:   true,
	}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetDockerHost(ctx, "my-server")
	if err != nil {
		t.Fatalf("GetDockerHost: %v", err)
	}
	if got == nil {
		t.Fatal("GetDockerHost returned nil")
	}
	if got.Name != "my-server" {
		t.Fatalf("name: want my-server, got %q", got.Name)
	}
	if got.URL != "tcp://192.168.1.50:2376" {
		t.Fatalf("url: want tcp://192.168.1.50:2376, got %q", got.URL)
	}
	if got.TLSCertPath != "/certs/my-server" {
		t.Fatalf("tls cert path: want /certs/my-server, got %q", got.TLSCertPath)
	}
	if !got.TLSVerify {
		t.Fatal("tls verify should be true")
	}
}

// TestContract_GetDockerHostNotFound verifies nil returned for missing host.
func TestContract_GetDockerHostNotFound(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	got, err := s.GetDockerHost(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetDockerHost: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent host")
	}
}

// --- Contract: GetDockerHostByURL ---

// TestContract_GetDockerHostByURLFound verifies retrieval by URL.
func TestContract_GetDockerHostByURLFound(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "url-test", URL: "tcp://10.0.0.99:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetDockerHostByURL(ctx, "tcp://10.0.0.99:2376")
	if err != nil {
		t.Fatalf("GetDockerHostByURL: %v", err)
	}
	if got == nil || got.Name != "url-test" {
		t.Fatal("should find host by URL")
	}
}

// --- Contract: ListDockerHosts ---

// TestContract_ListDockerHostsEmpty verifies empty list for fresh store.
func TestContract_ListDockerHostsEmpty(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	hosts, err := s.ListDockerHosts(ctx)
	if err != nil {
		t.Fatalf("ListDockerHosts: %v", err)
	}
	if len(hosts) != 0 {
		t.Fatalf("want 0 hosts, got %d", len(hosts))
	}
}

// TestContract_ListDockerHostsSorted verifies results sorted by name.
func TestContract_ListDockerHostsSorted(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	names := []string{"charlie", "alpha", "bravo"}
	urls := []string{"tcp://10.0.0.3:2376", "tcp://10.0.0.1:2376", "tcp://10.0.0.2:2376"}
	for i, name := range names {
		host := &DockerHostRecord{
			Name: name,
			URL:  urls[i],
		}
		if err := s.CreateDockerHost(ctx, host); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}

	hosts, err := s.ListDockerHosts(ctx)
	if err != nil {
		t.Fatalf("ListDockerHosts: %v", err)
	}
	if len(hosts) != 3 {
		t.Fatalf("want 3 hosts, got %d", len(hosts))
	}
	if hosts[0].Name != "alpha" || hosts[1].Name != "bravo" || hosts[2].Name != "charlie" {
		t.Fatalf("not sorted by name: %s, %s, %s", hosts[0].Name, hosts[1].Name, hosts[2].Name)
	}
}

// --- Contract: UpdateDockerHostStatus ---

// TestContract_UpdateDockerHostStatusSuccess verifies status update.
func TestContract_UpdateDockerHostStatusSuccess(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "update-test", URL: "tcp://10.0.0.1:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create: %v", err)
	}

	now := time.Now().UTC()
	err := s.UpdateDockerHostStatus(ctx, "update-test", HostStatusUpdate{
		HealthStatus: "Healthy",
		LastCheck:    &now,
		InfoJSON:     `{"serverVersion":"24.0.7"}`,
	})
	if err != nil {
		t.Fatalf("UpdateDockerHostStatus: %v", err)
	}

	got, _ := s.GetDockerHost(ctx, "update-test")
	if got.HealthStatus != "Healthy" {
		t.Fatalf("health status: want Healthy, got %q", got.HealthStatus)
	}
	if got.InfoJSON != `{"serverVersion":"24.0.7"}` {
		t.Fatalf("info json not updated: got %q", got.InfoJSON)
	}
}

// TestContract_UpdateDockerHostStatusNotFound verifies error for missing host.
func TestContract_UpdateDockerHostStatusNotFound(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	err := s.UpdateDockerHostStatus(ctx, "nonexistent", HostStatusUpdate{
		HealthStatus: "Unreachable",
	})
	if err == nil {
		t.Fatal("expected error for nonexistent host")
	}
}

// TestContract_UpdateDockerHostStatusEmptyNoOp verifies no-op for empty update.
func TestContract_UpdateDockerHostStatusEmptyNoOp(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "noop-test", URL: "tcp://10.0.0.2:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Empty update should be no-op (no error)
	err := s.UpdateDockerHostStatus(ctx, "noop-test", HostStatusUpdate{})
	if err != nil {
		t.Fatalf("empty update should be no-op: %v", err)
	}
}

// --- Contract: DeleteDockerHost ---

// TestContract_DeleteDockerHostSuccess verifies deletion.
func TestContract_DeleteDockerHostSuccess(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	host := &DockerHostRecord{Name: "delete-me", URL: "tcp://10.0.0.3:2376"}
	if err := s.CreateDockerHost(ctx, host); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteDockerHost(ctx, "delete-me"); err != nil {
		t.Fatalf("DeleteDockerHost: %v", err)
	}

	got, _ := s.GetDockerHost(ctx, "delete-me")
	if got != nil {
		t.Fatal("host should be deleted")
	}
}

// TestContract_DeleteDockerHostNotFound verifies error for missing host.
func TestContract_DeleteDockerHostNotFound(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	if err := s.DeleteDockerHost(ctx, "nonexistent"); err == nil {
		t.Fatal("expected error for nonexistent host")
	}
}

// --- Property: CRUD Roundtrip ---

// TestProperty_DockerHostCRUDRoundtrip verifies create → get → list → delete cycle.
func TestProperty_DockerHostCRUDRoundtrip(t *testing.T) {
	s := newContractTestStore(t)
	ctx := context.Background()

	rapid.Check(t, func(rt *rapid.T) {
		name := genHostName().Draw(rt, "name")
		url := genHostURL().Draw(rt, "url")
		tlsVerify := rapid.Bool().Draw(rt, "tlsVerify")

		rec := &DockerHostRecord{
			Name:      name,
			URL:       url,
			TLSVerify: tlsVerify,
		}

		// Create (may fail on duplicate — that's fine)
		err := s.CreateDockerHost(ctx, rec)
		if err != nil {
			return // skip on duplicate name/url collision
		}

		// Get by name
		got, err := s.GetDockerHost(ctx, name)
		if err != nil {
			rt.Fatalf("get: %v", err)
		}
		if got == nil {
			rt.Fatal("get returned nil after create")
		}
		if got.Name != name {
			rt.Fatalf("name mismatch: want %q, got %q", name, got.Name)
		}
		if got.URL != url {
			rt.Fatalf("url mismatch: want %q, got %q", url, got.URL)
		}

		// Get by URL
		got2, err := s.GetDockerHostByURL(ctx, url)
		if err != nil {
			rt.Fatalf("get by url: %v", err)
		}
		if got2 == nil || got2.Name != name {
			rt.Fatal("get by url failed")
		}

		// Delete
		if err := s.DeleteDockerHost(ctx, name); err != nil {
			rt.Fatalf("delete: %v", err)
		}

		// Verify gone
		gone, _ := s.GetDockerHost(ctx, name)
		if gone != nil {
			rt.Fatal("host should be gone after delete")
		}
	})
}
