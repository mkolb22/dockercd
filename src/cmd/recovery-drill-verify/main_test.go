package main

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/internal/store"
)

var (
	shaA       = strings.Repeat("a", 40)
	shaB       = strings.Repeat("b", 40)
	unknownSHA = strings.Repeat("c", 40)
)

func TestVerifyAcceptsRequiredRecoveryEvidence(t *testing.T) {
	databasePath, e := validSnapshot(t)
	escapedDir := filepath.Join(filepath.Dir(filepath.Dir(databasePath)), "snapshot?not-options#fragment")
	if err := os.Rename(filepath.Dir(databasePath), escapedDir); err != nil {
		t.Fatal(err)
	}
	e.databasePath = filepath.Join(escapedDir, "dockercd.db")

	report, err := verify(e)
	if err != nil {
		t.Fatal(err)
	}
	if !report.IntegrityOK || !report.LastSuccessfulIsA || !report.UnknownRollbackFailed || !report.SnapshotUnchanged {
		t.Fatalf("unexpected report: %+v", report)
	}
	if err := snapshotSidecarsAbsent(e.databasePath); err != nil {
		t.Fatalf("verification created a sidecar: %v", err)
	}
}

func TestVerifyRejectsMissingHistory(t *testing.T) {
	dir := t.TempDir()
	s, err := store.New(dir, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateApplication(context.Background(), &store.ApplicationRecord{Name: "drill", Manifest: "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateApplicationStatus(context.Background(), "drill", store.StatusUpdate{LastSyncedSHA: shaA}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	_, err = verify(expectation{
		databasePath: filepath.Join(dir, "dockercd.db"),
		application:  "drill",
		shaA:         shaA,
		shaB:         shaB,
		unknownSHA:   unknownSHA,
	})
	if err == nil {
		t.Fatal("verify succeeded without required history")
	}
}

func TestVerifyEscapesDatabasePathAndRejectsWALSidecars(t *testing.T) {
	databasePath, e := validSnapshot(t)
	if err := os.WriteFile(databasePath+"-wal", []byte("not a WAL"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.databasePath = databasePath
	mustError(t, "snapshot has an unexpected SQLite WAL sidecar", func() error { _, err := verify(e); return err })
}

func TestVerifyRejectsInvalidOrCollapsedRevisions(t *testing.T) {
	databasePath, _ := validSnapshot(t)
	for _, e := range []expectation{
		{databasePath: databasePath, application: "drill", shaA: shaA, shaB: shaA, unknownSHA: unknownSHA},
		{databasePath: databasePath, application: "drill", shaA: "abc123", shaB: shaB, unknownSHA: unknownSHA},
		{databasePath: databasePath, application: "drill", shaA: strings.ToUpper(shaA), shaB: shaB, unknownSHA: unknownSHA},
	} {
		mustError(t, "revisions must be distinct full lowercase commit SHAs", func() error { _, err := verify(e); return err })
	}
}

func TestVerifyRejectsIncompleteOrUnexpectedMigrationLedger(t *testing.T) {
	for _, mutation := range []string{
		"DELETE FROM schema_migrations WHERE version = 7",
		"INSERT INTO schema_migrations (version) VALUES (9)",
	} {
		databasePath, e := validSnapshot(t)
		e.databasePath = databasePath
		db, err := sql.Open("sqlite", databasePath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(mutation); err != nil {
			t.Fatal(err)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		mustError(t, "reading schema version", func() error { _, err := verify(e); return err })
	}
}

func TestVerifyRejectsNonRegularFileAndCanceledContext(t *testing.T) {
	fifo := filepath.Join(t.TempDir(), "dockercd.db")
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := verify(expectation{databasePath: fifo, application: "drill", shaA: shaA, shaB: shaB, unknownSHA: unknownSHA})
	if err == nil {
		t.Fatal("verify accepted FIFO as a database")
	}

	_, e := validSnapshot(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	mustError(t, "SQLite integrity check did not return ok", func() error { _, err := verifyWithContext(ctx, e); return err })
}

func validSnapshot(t *testing.T) (string, expectation) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "snapshot")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	s, err := store.New(dir, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := s.CreateApplication(ctx, &store.ApplicationRecord{Name: "drill", Manifest: "{}"}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, record := range []store.SyncRecord{
		{AppName: "drill", StartedAt: now, CommitSHA: shaA, Operation: "manual", Result: "success"},
		{AppName: "drill", StartedAt: now.Add(time.Second), CommitSHA: shaB, Operation: "manual", Result: "success"},
		{AppName: "drill", StartedAt: now.Add(2 * time.Second), CommitSHA: shaA, Operation: "rollback", Result: "success"},
		{AppName: "drill", StartedAt: now.Add(3 * time.Second), CommitSHA: unknownSHA, Operation: "rollback", Result: "failure"},
	} {
		record := record
		if err := s.RecordSync(ctx, &record); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.UpdateApplicationStatus(ctx, "drill", store.StatusUpdate{LastSyncedSHA: shaA}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(dir, "dockercd.db")
	return databasePath, expectation{databasePath: databasePath, application: "drill", shaA: shaA, shaB: shaB, unknownSHA: unknownSHA}
}

func mustError(t *testing.T, want string, run func() error) {
	t.Helper()
	err := run()
	if err == nil || err.Error() != want {
		t.Fatalf("error = %v, want %q", err, want)
	}
}
