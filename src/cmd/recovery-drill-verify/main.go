// recovery-drill-verify validates redacted, structural recovery evidence from
// a stopped disposable DockerCD SQLite state directory. It deliberately does
// not migrate, repair, or otherwise modify the database.
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"time"

	_ "modernc.org/sqlite"
)

const currentSchemaVersion = 8

const (
	maxSnapshotBytes    = 128 << 20
	verificationTimeout = 5 * time.Second
)

var fullCommitSHA = regexp.MustCompile(`^[a-f0-9]{40}([a-f0-9]{24})?$`)

type verificationReport struct {
	IntegrityOK           bool `json:"integrityOk"`
	SchemaVersion         int  `json:"schemaVersion"`
	ApplicationPresent    bool `json:"applicationPresent"`
	LastSuccessfulIsA     bool `json:"lastSuccessfulIsA"`
	ManualASuccess        bool `json:"manualASuccess"`
	ManualBSuccess        bool `json:"manualBSuccess"`
	RollbackASuccess      bool `json:"rollbackASuccess"`
	UnknownRollbackFailed bool `json:"unknownRollbackFailed"`
	SnapshotUnchanged     bool `json:"snapshotUnchanged"`
}

type expectation struct {
	databasePath string
	application  string
	shaA         string
	shaB         string
	unknownSHA   string
}

func main() {
	var e expectation
	flag.StringVar(&e.databasePath, "database", "", "path to stopped drill dockercd.db")
	flag.StringVar(&e.application, "application", "", "disposable application name")
	flag.StringVar(&e.shaA, "sha-a", "", "full commit A SHA")
	flag.StringVar(&e.shaB, "sha-b", "", "full commit B SHA")
	flag.StringVar(&e.unknownSHA, "unknown-sha", "", "generated unknown rollback SHA")
	flag.Parse()

	report, err := verify(e)
	if err != nil {
		fmt.Fprintln(os.Stderr, "recovery drill verification failed:", err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, "encoding recovery drill verification:", err)
		os.Exit(1)
	}
}

func verify(e expectation) (verificationReport, error) {
	ctx, cancel := context.WithTimeout(context.Background(), verificationTimeout)
	defer cancel()
	return verifyWithContext(ctx, e)
}

func verifyWithContext(ctx context.Context, e expectation) (verificationReport, error) {
	if e.databasePath == "" || e.application == "" || e.shaA == "" || e.shaB == "" || e.unknownSHA == "" {
		return verificationReport{}, errors.New("database, application, sha-a, sha-b, and unknown-sha are required")
	}
	if !fullCommitSHA.MatchString(e.shaA) || !fullCommitSHA.MatchString(e.shaB) || !fullCommitSHA.MatchString(e.unknownSHA) {
		return verificationReport{}, errors.New("revisions must be distinct full lowercase commit SHAs")
	}
	if e.shaA == e.shaB || e.shaA == e.unknownSHA || e.shaB == e.unknownSHA {
		return verificationReport{}, errors.New("revisions must be distinct full lowercase commit SHAs")
	}
	if filepath.Base(e.databasePath) != "dockercd.db" {
		return verificationReport{}, errors.New("database must be named dockercd.db")
	}
	absolutePath, err := filepath.Abs(e.databasePath)
	if err != nil {
		return verificationReport{}, errors.New("resolving database path")
	}
	info, err := os.Lstat(absolutePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxSnapshotBytes {
		return verificationReport{}, errors.New("database is not a readable regular file")
	}
	beforeDigest, err := fileDigest(absolutePath)
	if err != nil {
		return verificationReport{}, errors.New("hashing database before verification")
	}
	// The drill takes its snapshot only after verified controller termination.
	// Reject sidecars rather than ambiguously reading a possibly incomplete WAL
	// set. This keeps the verifier independent of SQLite recovery/write paths.
	if err := snapshotSidecarsAbsent(absolutePath); err != nil {
		return verificationReport{}, err
	}

	// The readonly URI is intentional: a release-evidence verifier must not
	// migrate, checkpoint, or create a WAL sidecar in the snapshot directory.
	// url.URL escapes ? and # in valid filesystem names, preventing a path from
	// being interpreted as attacker-controlled SQLite query options.
	databaseURI := (&url.URL{Scheme: "file", Path: absolutePath, RawQuery: "mode=ro&immutable=1"}).String()
	db, err := sql.Open("sqlite", databaseURI)
	if err != nil {
		return verificationReport{}, errors.New("opening readonly database")
	}
	defer db.Close()

	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return verificationReport{}, errors.New("SQLite integrity check did not return ok")
	}

	schemaVersion, err := completeSchemaVersion(ctx, db)
	if err != nil {
		return verificationReport{}, errors.New("reading schema version")
	}

	var lastSuccessfulSHA sql.NullString
	err = db.QueryRowContext(ctx, "SELECT last_synced_sha FROM applications WHERE name = ?", e.application).Scan(&lastSuccessfulSHA)
	if errors.Is(err, sql.ErrNoRows) {
		return verificationReport{}, errors.New("disposable application is absent")
	}
	if err != nil {
		return verificationReport{}, errors.New("reading disposable application")
	}

	report := verificationReport{
		IntegrityOK:        true,
		SchemaVersion:      schemaVersion,
		ApplicationPresent: true,
		LastSuccessfulIsA:  lastSuccessfulSHA.Valid && lastSuccessfulSHA.String == e.shaA,
	}
	if !report.LastSuccessfulIsA {
		return verificationReport{}, errors.New("last successful revision is not commit A")
	}

	var errQuery error
	if report.ManualASuccess, errQuery = hasRecord(ctx, db, e.application, "manual", "success", e.shaA); errQuery != nil {
		return verificationReport{}, errQuery
	}
	if report.ManualBSuccess, errQuery = hasRecord(ctx, db, e.application, "manual", "success", e.shaB); errQuery != nil {
		return verificationReport{}, errQuery
	}
	if report.RollbackASuccess, errQuery = hasRecord(ctx, db, e.application, "rollback", "success", e.shaA); errQuery != nil {
		return verificationReport{}, errQuery
	}
	if report.UnknownRollbackFailed, errQuery = hasRecord(ctx, db, e.application, "rollback", "failure", e.unknownSHA); errQuery != nil {
		return verificationReport{}, errQuery
	}
	if !report.ManualASuccess || !report.ManualBSuccess || !report.RollbackASuccess || !report.UnknownRollbackFailed {
		return verificationReport{}, errors.New("required recovery history record is missing")
	}

	if err := db.Close(); err != nil {
		return verificationReport{}, errors.New("closing readonly database")
	}
	afterDigest, err := fileDigest(absolutePath)
	if err != nil || beforeDigest != afterDigest || snapshotSidecarsAbsent(absolutePath) != nil {
		return verificationReport{}, errors.New("database changed during verification")
	}
	report.SnapshotUnchanged = true
	return report, nil
}

func snapshotSidecarsAbsent(databasePath string) error {
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Lstat(databasePath + suffix); err == nil {
			return errors.New("snapshot has an unexpected SQLite WAL sidecar")
		} else if !errors.Is(err, os.ErrNotExist) {
			return errors.New("checking SQLite snapshot sidecars")
		}
	}
	return nil
}

func completeSchemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	version := 1
	for rows.Next() {
		var actual int
		if err := rows.Scan(&actual); err != nil || actual != version {
			return 0, errors.New("incomplete schema migration ledger")
		}
		version++
	}
	if err := rows.Err(); err != nil || version != currentSchemaVersion+1 {
		return 0, errors.New("incomplete schema migration ledger")
	}
	return currentSchemaVersion, nil
}

func hasRecord(ctx context.Context, db *sql.DB, application, operation, result, sha string) (bool, error) {
	var count int
	err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sync_history WHERE app_name = ? AND operation = ? AND result = ? AND commit_sha = ?",
		application, operation, result, sha,
	).Scan(&count)
	if err != nil {
		return false, errors.New("reading recovery history")
	}
	return count > 0, nil
}

func fileDigest(path string) ([sha256.Size]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer file.Close()
	hash := sha256.New()
	bytesRead, err := io.Copy(hash, io.LimitReader(file, maxSnapshotBytes+1))
	if err != nil || bytesRead > maxSnapshotBytes {
		return [sha256.Size]byte{}, errors.New("database digest exceeds allowed size")
	}
	var digest [sha256.Size]byte
	copy(digest[:], hash.Sum(nil))
	return digest, nil
}
