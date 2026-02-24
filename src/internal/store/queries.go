package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// CreateApplication inserts a new application record.
func (s *SQLiteStore) CreateApplication(ctx context.Context, app *ApplicationRecord) error {
	if app.ID == "" {
		app.ID = uuid.New().String()
	}
	now := time.Now().UTC()
	app.CreatedAt = now
	app.UpdatedAt = now

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO applications (id, name, manifest, sync_status, health_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		app.ID, app.Name, app.Manifest, app.SyncStatus, app.HealthStatus, app.CreatedAt, app.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("creating application %q: %w", app.Name, err)
	}
	return nil
}

// GetApplication retrieves an application by name.
func (s *SQLiteStore) GetApplication(ctx context.Context, name string) (*ApplicationRecord, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, manifest, sync_status, health_status, last_synced_sha, head_sha,
		        last_sync_time, last_error, services_json, conditions_json, created_at, updated_at
		 FROM applications WHERE name = ?`, name,
	)

	var app ApplicationRecord
	var lastSyncedSHA, headSHA, lastError, servicesJSON, conditionsJSON sql.NullString
	var lastSyncTime sql.NullTime

	err := row.Scan(
		&app.ID, &app.Name, &app.Manifest, &app.SyncStatus, &app.HealthStatus,
		&lastSyncedSHA, &headSHA, &lastSyncTime, &lastError,
		&servicesJSON, &conditionsJSON, &app.CreatedAt, &app.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getting application %q: %w", name, err)
	}

	app.LastSyncedSHA = lastSyncedSHA.String
	app.HeadSHA = headSHA.String
	app.LastError = lastError.String
	app.ServicesJSON = servicesJSON.String
	app.ConditionsJSON = conditionsJSON.String
	if lastSyncTime.Valid {
		app.LastSyncTime = &lastSyncTime.Time
	}

	return &app, nil
}

// ListApplications returns all application records.
func (s *SQLiteStore) ListApplications(ctx context.Context) ([]ApplicationRecord, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, manifest, sync_status, health_status, last_synced_sha, head_sha,
		        last_sync_time, last_error, services_json, conditions_json, created_at, updated_at
		 FROM applications ORDER BY CASE WHEN name = 'dockercd' THEN 0 ELSE 1 END, name`,
	)
	if err != nil {
		return nil, fmt.Errorf("listing applications: %w", err)
	}
	defer rows.Close()

	var apps []ApplicationRecord
	for rows.Next() {
		var app ApplicationRecord
		var lastSyncedSHA, headSHA, lastError, servicesJSON, conditionsJSON sql.NullString
		var lastSyncTime sql.NullTime

		if err := rows.Scan(
			&app.ID, &app.Name, &app.Manifest, &app.SyncStatus, &app.HealthStatus,
			&lastSyncedSHA, &headSHA, &lastSyncTime, &lastError,
			&servicesJSON, &conditionsJSON, &app.CreatedAt, &app.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning application row: %w", err)
		}

		app.LastSyncedSHA = lastSyncedSHA.String
		app.HeadSHA = headSHA.String
		app.LastError = lastError.String
		app.ServicesJSON = servicesJSON.String
		app.ConditionsJSON = conditionsJSON.String
		if lastSyncTime.Valid {
			app.LastSyncTime = &lastSyncTime.Time
		}

		apps = append(apps, app)
	}
	return apps, rows.Err()
}

// UpdateApplicationStatus updates the runtime status fields of an application.
func (s *SQLiteStore) UpdateApplicationStatus(ctx context.Context, name string, update StatusUpdate) error {
	var sets []string
	var args []interface{}

	if update.SyncStatus != "" {
		sets = append(sets, "sync_status = ?")
		args = append(args, update.SyncStatus)
	}
	if update.HealthStatus != "" {
		sets = append(sets, "health_status = ?")
		args = append(args, update.HealthStatus)
	}
	if update.LastSyncedSHA != "" {
		sets = append(sets, "last_synced_sha = ?")
		args = append(args, update.LastSyncedSHA)
	}
	if update.HeadSHA != "" {
		sets = append(sets, "head_sha = ?")
		args = append(args, update.HeadSHA)
	}
	if update.LastSyncTime != nil {
		sets = append(sets, "last_sync_time = ?")
		args = append(args, *update.LastSyncTime)
	}
	if update.LastError != nil {
		sets = append(sets, "last_error = ?")
		args = append(args, *update.LastError)
	}
	if update.ServicesJSON != "" {
		sets = append(sets, "services_json = ?")
		args = append(args, update.ServicesJSON)
	}
	if update.ConditionsJSON != "" {
		sets = append(sets, "conditions_json = ?")
		args = append(args, update.ConditionsJSON)
	}

	if len(sets) == 0 {
		return nil
	}

	sets = append(sets, "updated_at = ?")
	args = append(args, time.Now().UTC())
	args = append(args, name)

	query := fmt.Sprintf("UPDATE applications SET %s WHERE name = ?", joinStrings(sets, ", "))
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("updating application %q: %w", name, err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("application %q not found", name)
	}
	return nil
}

// DeleteApplication removes an application and cascades to sync_history and events.
func (s *SQLiteStore) DeleteApplication(ctx context.Context, name string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM applications WHERE name = ?", name)
	if err != nil {
		return fmt.Errorf("deleting application %q: %w", name, err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("application %q not found", name)
	}
	return nil
}

// RecordSync inserts a sync history record.
func (s *SQLiteStore) RecordSync(ctx context.Context, record *SyncRecord) error {
	if record.ID == "" {
		record.ID = uuid.New().String()
	}
	record.CreatedAt = time.Now().UTC()

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sync_history (id, app_name, started_at, finished_at, commit_sha, operation, result, diff_json, compose_spec_json, error, duration_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.ID, record.AppName, record.StartedAt, record.FinishedAt,
		record.CommitSHA, record.Operation, record.Result,
		record.DiffJSON, record.ComposeSpecJSON, record.Error, record.DurationMs, record.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("recording sync for %q: %w", record.AppName, err)
	}
	return nil
}

// ListSyncHistory returns recent sync records for an application.
func (s *SQLiteStore) ListSyncHistory(ctx context.Context, appName string, limit int) ([]SyncRecord, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, app_name, started_at, finished_at, commit_sha, operation, result, diff_json, compose_spec_json, error, duration_ms, created_at
		 FROM sync_history WHERE app_name = ? ORDER BY started_at DESC LIMIT ?`,
		appName, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("listing sync history for %q: %w", appName, err)
	}
	defer rows.Close()

	var records []SyncRecord
	for rows.Next() {
		var r SyncRecord
		var finishedAt sql.NullTime
		var commitSHA, diffJSON, composeSpecJSON, errMsg sql.NullString
		var durationMs sql.NullInt64

		if err := rows.Scan(
			&r.ID, &r.AppName, &r.StartedAt, &finishedAt,
			&commitSHA, &r.Operation, &r.Result, &diffJSON,
			&composeSpecJSON, &errMsg, &durationMs, &r.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning sync record: %w", err)
		}

		if finishedAt.Valid {
			r.FinishedAt = &finishedAt.Time
		}
		r.CommitSHA = commitSHA.String
		r.DiffJSON = diffJSON.String
		r.ComposeSpecJSON = composeSpecJSON.String
		r.Error = errMsg.String
		r.DurationMs = durationMs.Int64

		records = append(records, r)
	}
	return records, rows.Err()
}

// GetSyncBySHA returns the most recent sync record for the given app and commit SHA.
// Returns nil, nil if no matching record is found.
func (s *SQLiteStore) GetSyncBySHA(ctx context.Context, appName, sha string) (*SyncRecord, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, app_name, started_at, finished_at, commit_sha, operation, result, diff_json, compose_spec_json, error, duration_ms, created_at
		 FROM sync_history WHERE app_name = ? AND commit_sha = ? ORDER BY started_at DESC LIMIT 1`,
		appName, sha,
	)

	var r SyncRecord
	var finishedAt sql.NullTime
	var commitSHA, diffJSON, composeSpecJSON, errMsg sql.NullString
	var durationMs sql.NullInt64

	err := row.Scan(
		&r.ID, &r.AppName, &r.StartedAt, &finishedAt,
		&commitSHA, &r.Operation, &r.Result, &diffJSON,
		&composeSpecJSON, &errMsg, &durationMs, &r.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("getting sync record for %q sha %q: %w", appName, sha, err)
	}

	if finishedAt.Valid {
		r.FinishedAt = &finishedAt.Time
	}
	r.CommitSHA = commitSHA.String
	r.DiffJSON = diffJSON.String
	r.ComposeSpecJSON = composeSpecJSON.String
	r.Error = errMsg.String
	r.DurationMs = durationMs.Int64

	return &r, nil
}

// RecordEvent inserts an event record.
func (s *SQLiteStore) RecordEvent(ctx context.Context, event *EventRecord) error {
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	if event.Severity == "" {
		event.Severity = "info"
	}
	event.CreatedAt = time.Now().UTC()

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO events (id, app_name, type, message, severity, data_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		event.ID, event.AppName, event.Type, event.Message, event.Severity,
		event.DataJSON, event.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("recording event for %q: %w", event.AppName, err)
	}
	return nil
}

// ListEvents returns recent events for an application.
func (s *SQLiteStore) ListEvents(ctx context.Context, appName string, limit int) ([]EventRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, app_name, type, message, severity, data_json, created_at
		 FROM events WHERE app_name = ? ORDER BY created_at DESC LIMIT ?`,
		appName, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("listing events for %q: %w", appName, err)
	}
	defer rows.Close()

	var events []EventRecord
	for rows.Next() {
		var e EventRecord
		var dataJSON sql.NullString

		if err := rows.Scan(&e.ID, &e.AppName, &e.Type, &e.Message, &e.Severity, &dataJSON, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning event row: %w", err)
		}
		e.DataJSON = dataJSON.String
		events = append(events, e)
	}
	return events, rows.Err()
}

// --- Docker Host CRUD ---

// CreateDockerHost inserts a new Docker host record.
func (s *SQLiteStore) CreateDockerHost(ctx context.Context, host *DockerHostRecord) error {
	if host.ID == "" {
		host.ID = uuid.New().String()
	}
	now := time.Now().UTC()
	host.CreatedAt = now
	host.UpdatedAt = now
	if host.HealthStatus == "" {
		host.HealthStatus = "Unknown"
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO docker_hosts (id, name, url, tls_cert_path, tls_verify, health_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Name, host.URL, host.TLSCertPath, host.TLSVerify,
		host.HealthStatus, host.CreatedAt, host.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("creating docker host %q: %w", host.Name, err)
	}
	return nil
}

// GetDockerHost retrieves a Docker host by name.
func (s *SQLiteStore) GetDockerHost(ctx context.Context, name string) (*DockerHostRecord, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, url, tls_cert_path, tls_verify, health_status, last_check,
		        last_error, info_json, stats_json, created_at, updated_at
		 FROM docker_hosts WHERE name = ?`, name,
	)
	return scanDockerHost(row)
}

// GetDockerHostByURL retrieves a Docker host by URL.
func (s *SQLiteStore) GetDockerHostByURL(ctx context.Context, url string) (*DockerHostRecord, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, url, tls_cert_path, tls_verify, health_status, last_check,
		        last_error, info_json, stats_json, created_at, updated_at
		 FROM docker_hosts WHERE url = ?`, url,
	)
	return scanDockerHost(row)
}

// ListDockerHosts returns all Docker host records ordered by name.
func (s *SQLiteStore) ListDockerHosts(ctx context.Context) ([]DockerHostRecord, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, url, tls_cert_path, tls_verify, health_status, last_check,
		        last_error, info_json, stats_json, created_at, updated_at
		 FROM docker_hosts ORDER BY name`,
	)
	if err != nil {
		return nil, fmt.Errorf("listing docker hosts: %w", err)
	}
	defer rows.Close()

	var hosts []DockerHostRecord
	for rows.Next() {
		var h DockerHostRecord
		var tlsCertPath, lastError, infoJSON, statsJSON sql.NullString
		var lastCheck sql.NullTime
		var tlsVerify int

		if err := rows.Scan(
			&h.ID, &h.Name, &h.URL, &tlsCertPath, &tlsVerify, &h.HealthStatus,
			&lastCheck, &lastError, &infoJSON, &statsJSON, &h.CreatedAt, &h.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning docker host row: %w", err)
		}

		h.TLSCertPath = tlsCertPath.String
		h.TLSVerify = tlsVerify != 0
		h.LastError = lastError.String
		h.InfoJSON = infoJSON.String
		h.StatsJSON = statsJSON.String
		if lastCheck.Valid {
			h.LastCheck = &lastCheck.Time
		}

		hosts = append(hosts, h)
	}
	return hosts, rows.Err()
}

// UpdateDockerHostStatus updates the runtime status fields of a Docker host.
func (s *SQLiteStore) UpdateDockerHostStatus(ctx context.Context, name string, update HostStatusUpdate) error {
	var sets []string
	var args []interface{}

	if update.HealthStatus != "" {
		sets = append(sets, "health_status = ?")
		args = append(args, update.HealthStatus)
	}
	if update.LastCheck != nil {
		sets = append(sets, "last_check = ?")
		args = append(args, *update.LastCheck)
	}
	if update.LastError != nil {
		sets = append(sets, "last_error = ?")
		args = append(args, *update.LastError)
	}
	if update.InfoJSON != "" {
		sets = append(sets, "info_json = ?")
		args = append(args, update.InfoJSON)
	}
	if update.StatsJSON != "" {
		sets = append(sets, "stats_json = ?")
		args = append(args, update.StatsJSON)
	}

	if len(sets) == 0 {
		return nil
	}

	sets = append(sets, "updated_at = ?")
	args = append(args, time.Now().UTC())
	args = append(args, name)

	query := fmt.Sprintf("UPDATE docker_hosts SET %s WHERE name = ?", joinStrings(sets, ", "))
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("updating docker host %q: %w", name, err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("docker host %q not found", name)
	}
	return nil
}

// DeleteDockerHost removes a Docker host by name.
func (s *SQLiteStore) DeleteDockerHost(ctx context.Context, name string) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM docker_hosts WHERE name = ?", name)
	if err != nil {
		return fmt.Errorf("deleting docker host %q: %w", name, err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("docker host %q not found", name)
	}
	return nil
}

// scanDockerHost scans a single row into a DockerHostRecord.
func scanDockerHost(row *sql.Row) (*DockerHostRecord, error) {
	var h DockerHostRecord
	var tlsCertPath, lastError, infoJSON, statsJSON sql.NullString
	var lastCheck sql.NullTime
	var tlsVerify int

	err := row.Scan(
		&h.ID, &h.Name, &h.URL, &tlsCertPath, &tlsVerify, &h.HealthStatus,
		&lastCheck, &lastError, &infoJSON, &statsJSON, &h.CreatedAt, &h.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scanning docker host: %w", err)
	}

	h.TLSCertPath = tlsCertPath.String
	h.TLSVerify = tlsVerify != 0
	h.LastError = lastError.String
	h.InfoJSON = infoJSON.String
	h.StatsJSON = statsJSON.String
	if lastCheck.Valid {
		h.LastCheck = &lastCheck.Time
	}

	return &h, nil
}

func joinStrings(strs []string, sep string) string {
	return strings.Join(strs, sep)
}

// PruneOldEvents deletes events older than the given duration.
// Returns the number of deleted rows.
func (s *SQLiteStore) PruneOldEvents(ctx context.Context, maxAge time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-maxAge)
	result, err := s.db.ExecContext(ctx,
		"DELETE FROM events WHERE created_at < ?", cutoff)
	if err != nil {
		return 0, fmt.Errorf("pruning old events: %w", err)
	}
	return result.RowsAffected()
}

// PruneSyncHistory keeps only the most recent maxPerApp sync records per app.
// Returns the number of deleted rows.
func (s *SQLiteStore) PruneSyncHistory(ctx context.Context, maxPerApp int) (int64, error) {
	// Delete sync records that are not in the top N per app.
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM sync_history
		WHERE id NOT IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (PARTITION BY app_name ORDER BY started_at DESC) AS rn
				FROM sync_history
			) ranked
			WHERE rn <= ?
		)`, maxPerApp)
	if err != nil {
		return 0, fmt.Errorf("pruning sync history: %w", err)
	}
	return result.RowsAffected()
}
