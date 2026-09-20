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
	"sort"
	"time"

	_ "modernc.org/sqlite"
)

const currentSchemaVersion = 8

const (
	maxSnapshotBytes    = 128 << 20
	maxBaselineRecords  = 128
	maxBaselineBytes    = 1 << 20
	verificationTimeout = 5 * time.Second
)

var fullCommitSHA = regexp.MustCompile(`^[a-f0-9]{40}([a-f0-9]{24})?$`)

type verificationReport struct {
	IntegrityOK            bool  `json:"integrityOk"`
	SchemaVersion          int   `json:"schemaVersion"`
	ApplicationPresent     bool  `json:"applicationPresent"`
	LastSuccessfulIsA      bool  `json:"lastSuccessfulIsA"`
	ManualASuccess         bool  `json:"manualASuccess"`
	ManualBSuccess         bool  `json:"manualBSuccess"`
	RollbackASuccess       bool  `json:"rollbackASuccess"`
	UnknownRollbackFailed  bool  `json:"unknownRollbackFailed"`
	SnapshotUnchanged      bool  `json:"snapshotUnchanged"`
	RestoreBaselineMatches *bool `json:"restoreBaselineMatches,omitempty"`
}

type expectation struct {
	databasePath string
	application  string
	shaA         string
	shaB         string
	unknownSHA   string
	baselineOut  string
	baselineIn   string
}

// restoreBaseline is deliberately digest-only: recovery evidence must prove
// exact persistence without exporting manifests, error strings, diffs, or
// full revisions from the disposable state database.
type restoreBaseline struct {
	Version                 int                  `json:"version"`
	Application             string               `json:"application"`
	ApplicationConfigDigest string               `json:"applicationConfigDigest"`
	Records                 []historyFingerprint `json:"records"`
}

type historyFingerprint struct {
	ID        string `json:"id"`
	Digest    string `json:"digest"`
	operation string
	result    string
}

func main() {
	var e expectation
	flag.StringVar(&e.databasePath, "database", "", "path to stopped drill dockercd.db")
	flag.StringVar(&e.application, "application", "", "disposable application name")
	flag.StringVar(&e.shaA, "sha-a", "", "full commit A SHA")
	flag.StringVar(&e.shaB, "sha-b", "", "full commit B SHA")
	flag.StringVar(&e.unknownSHA, "unknown-sha", "", "generated unknown rollback SHA")
	flag.StringVar(&e.baselineOut, "write-restore-baseline", "", "new private digest-only baseline file")
	flag.StringVar(&e.baselineIn, "compare-restore-baseline", "", "private digest-only baseline file to compare")
	flag.Parse()

	report, err := verify(e)
	if err != nil {
		fmt.Fprintln(os.Stderr, "recovery drill verification failed:", err)
		os.Exit(1)
	}
	if e.baselineOut != "" {
		baseline, baselineErr := baselineForSnapshot(e)
		if baselineErr != nil {
			fmt.Fprintln(os.Stderr, "creating recovery restore baseline:", baselineErr)
			os.Exit(1)
		}
		if baselineErr = writeBaseline(e.baselineOut, baseline); baselineErr != nil {
			fmt.Fprintln(os.Stderr, "writing recovery restore baseline:", baselineErr)
			os.Exit(1)
		}
	}
	if e.baselineIn != "" {
		baseline, baselineErr := readBaseline(e.baselineIn, e.application)
		if baselineErr != nil {
			fmt.Fprintln(os.Stderr, "reading recovery restore baseline:", baselineErr)
			os.Exit(1)
		}
		if baselineErr = compareBaseline(e, baseline); baselineErr != nil {
			fmt.Fprintln(os.Stderr, "comparing recovery restore baseline:", baselineErr)
			os.Exit(1)
		}
		matched := true
		report.RestoreBaselineMatches = &matched
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, "encoding recovery drill verification:", err)
		os.Exit(1)
	}
}

func baselineForSnapshot(e expectation) (restoreBaseline, error) {
	ctx, cancel := context.WithTimeout(context.Background(), verificationTimeout)
	defer cancel()
	db, err := openReadonlySnapshot(e.databasePath)
	if err != nil {
		return restoreBaseline{}, err
	}
	defer db.Close()
	return readBaselineFromDB(ctx, db, e.application)
}

func readBaselineFromDB(ctx context.Context, db *sql.DB, application string) (restoreBaseline, error) {
	var manifest, source string
	if err := db.QueryRowContext(ctx, `SELECT manifest, source FROM applications WHERE name = ?`, application).Scan(&manifest, &source); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return restoreBaseline{}, errors.New("disposable application is absent")
		}
		return restoreBaseline{}, errors.New("reading application configuration")
	}

	rows, err := db.QueryContext(ctx, `SELECT id, operation, result, quote(app_name), quote(started_at), quote(finished_at), quote(commit_sha), quote(operation), quote(result), quote(diff_json), quote(compose_spec_json), quote(error), quote(duration_ms), quote(created_at)
		FROM sync_history WHERE app_name = ? LIMIT ?`, application, maxBaselineRecords+1)
	if err != nil {
		return restoreBaseline{}, errors.New("reading recovery history")
	}
	defer rows.Close()
	baseline := restoreBaseline{
		Version:                 1,
		Application:             application,
		ApplicationConfigDigest: digestFields(manifest, source),
	}
	seen := make(map[string]struct{})
	for rows.Next() {
		var id, operation, result string
		fields := make([]string, 11)
		values := make([]any, 14)
		values[0] = &id
		values[1] = &operation
		values[2] = &result
		for i := range fields {
			values[i+3] = &fields[i]
		}
		if err := rows.Scan(values...); err != nil {
			return restoreBaseline{}, errors.New("scanning recovery history")
		}
		if id == "" {
			return restoreBaseline{}, errors.New("recovery history has an empty identifier")
		}
		if _, duplicate := seen[id]; duplicate {
			return restoreBaseline{}, errors.New("recovery history has duplicate identifiers")
		}
		seen[id] = struct{}{}
		baseline.Records = append(baseline.Records, historyFingerprint{ID: id, Digest: digestFields(fields...), operation: operation, result: result})
		if len(baseline.Records) > maxBaselineRecords {
			return restoreBaseline{}, errors.New("recovery history exceeds baseline limit")
		}
	}
	if err := rows.Err(); err != nil {
		return restoreBaseline{}, errors.New("reading recovery history")
	}
	sort.Slice(baseline.Records, func(i, j int) bool { return baseline.Records[i].ID < baseline.Records[j].ID })
	return baseline, nil
}

func compareBaseline(e expectation, baseline restoreBaseline) error {
	current, err := baselineForSnapshot(e)
	if err != nil {
		return err
	}
	if current.ApplicationConfigDigest != baseline.ApplicationConfigDigest {
		return errors.New("restored application configuration differs from snapshot")
	}
	expected := make(map[string]string, len(baseline.Records))
	for _, record := range baseline.Records {
		expected[record.ID] = record.Digest
	}
	for _, record := range current.Records {
		if expectedDigest, present := expected[record.ID]; present {
			if record.Digest != expectedDigest {
				return errors.New("restored history record differs from snapshot")
			}
			delete(expected, record.ID)
			continue
		}
		if record.operation != "poll" || record.result != "skipped" {
			return errors.New("restored history contains an unexpected record")
		}
	}
	if len(expected) != 0 {
		return errors.New("restored history is missing a snapshot record")
	}
	return nil
}

func digestFields(fields ...string) string {
	hash := sha256.New()
	for _, field := range fields {
		_, _ = fmt.Fprintf(hash, "%d:", len(field))
		_, _ = io.WriteString(hash, field)
		_, _ = io.WriteString(hash, "\n")
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}

func writeBaseline(path string, baseline restoreBaseline) error {
	if path == "" || filepath.Base(path) == "." || filepath.Base(path) == string(filepath.Separator) {
		return errors.New("baseline path is invalid")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return errors.New("creating private baseline file")
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(baseline); err != nil {
		return errors.New("encoding private baseline file")
	}
	return nil
}

func readBaseline(path, application string) (restoreBaseline, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxBaselineBytes {
		return restoreBaseline{}, errors.New("private baseline file is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return restoreBaseline{}, errors.New("opening private baseline file")
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxBaselineBytes+1))
	decoder.DisallowUnknownFields()
	var baseline restoreBaseline
	if err := decoder.Decode(&baseline); err != nil {
		return restoreBaseline{}, errors.New("decoding private baseline file")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return restoreBaseline{}, errors.New("private baseline file is invalid")
	}
	if baseline.Version != 1 || baseline.Application != application || !digestString(baseline.ApplicationConfigDigest) || len(baseline.Records) > maxBaselineRecords {
		return restoreBaseline{}, errors.New("private baseline file is invalid")
	}
	seen := make(map[string]struct{}, len(baseline.Records))
	for _, record := range baseline.Records {
		if record.ID == "" || !digestString(record.Digest) {
			return restoreBaseline{}, errors.New("private baseline file is invalid")
		}
		if _, duplicate := seen[record.ID]; duplicate {
			return restoreBaseline{}, errors.New("private baseline file is invalid")
		}
		seen[record.ID] = struct{}{}
	}
	return baseline, nil
}

func digestString(value string) bool {
	return regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(value)
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

	db, err := openReadonlySnapshot(absolutePath)
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

func openReadonlySnapshot(databasePath string) (*sql.DB, error) {
	absolutePath, err := filepath.Abs(databasePath)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(absolutePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxSnapshotBytes {
		return nil, errors.New("database is not a readable regular file")
	}
	if err := snapshotSidecarsAbsent(absolutePath); err != nil {
		return nil, err
	}
	// The readonly URI is intentional: a release-evidence verifier must not
	// migrate, checkpoint, or create a WAL sidecar in the snapshot directory.
	// url.URL escapes ? and # in valid filesystem names, preventing a path from
	// being interpreted as attacker-controlled SQLite query options.
	databaseURI := (&url.URL{Scheme: "file", Path: absolutePath, RawQuery: "mode=ro&immutable=1"}).String()
	return sql.Open("sqlite", databaseURI)
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
