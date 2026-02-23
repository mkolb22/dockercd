// Package store provides SQLite-backed persistence for applications,
// sync history, and events.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"log/slog"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store is the interface for persistent state operations.
type Store interface {
	// Application CRUD
	CreateApplication(ctx context.Context, app *ApplicationRecord) error
	GetApplication(ctx context.Context, name string) (*ApplicationRecord, error)
	ListApplications(ctx context.Context) ([]ApplicationRecord, error)
	UpdateApplicationStatus(ctx context.Context, name string, update StatusUpdate) error
	DeleteApplication(ctx context.Context, name string) error

	// Sync history
	RecordSync(ctx context.Context, record *SyncRecord) error
	ListSyncHistory(ctx context.Context, appName string, limit int) ([]SyncRecord, error)
	GetSyncBySHA(ctx context.Context, appName, sha string) (*SyncRecord, error)

	// Events
	RecordEvent(ctx context.Context, event *EventRecord) error
	ListEvents(ctx context.Context, appName string, limit int) ([]EventRecord, error)

	// Docker hosts
	CreateDockerHost(ctx context.Context, host *DockerHostRecord) error
	GetDockerHost(ctx context.Context, name string) (*DockerHostRecord, error)
	GetDockerHostByURL(ctx context.Context, url string) (*DockerHostRecord, error)
	ListDockerHosts(ctx context.Context) ([]DockerHostRecord, error)
	UpdateDockerHostStatus(ctx context.Context, name string, update HostStatusUpdate) error
	DeleteDockerHost(ctx context.Context, name string) error

	// Lifecycle
	Close() error
}

// SQLiteStore implements Store using SQLite.
type SQLiteStore struct {
	db     *sql.DB
	logger *slog.Logger
}

// New creates a new SQLiteStore. The dataDir is the directory where the
// database file will be created. Use ":memory:" for in-memory databases (testing).
func New(dataDir string, logger *slog.Logger) (*SQLiteStore, error) {
	var dsn string
	if dataDir == ":memory:" {
		dsn = ":memory:?_pragma=journal_mode(wal)&_pragma=foreign_keys(1)"
	} else {
		dbPath := filepath.Join(dataDir, "dockercd.db")
		dsn = dbPath + "?_pragma=journal_mode(wal)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// Verify connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	s := &SQLiteStore{db: db, logger: logger}

	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("running migrations: %w", err)
	}

	return s, nil
}

// Close closes the database connection.
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// migrate runs all pending database migrations.
func (s *SQLiteStore) migrate() error {
	// Ensure schema_migrations table exists
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return fmt.Errorf("creating migrations table: %w", err)
	}

	currentVersion := s.getCurrentVersion()

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("reading migrations dir: %w", err)
	}

	for _, entry := range entries {
		version := parseVersion(entry.Name())
		if version <= currentVersion {
			continue
		}

		sqlBytes, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("reading migration %s: %w", entry.Name(), err)
		}

		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("beginning transaction for migration %d: %w", version, err)
		}

		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("executing migration %d: %w", version, err)
		}

		if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("recording migration %d: %w", version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("committing migration %d: %w", version, err)
		}

		s.logger.Info("applied migration", "version", version, "file", entry.Name())
	}

	return nil
}

func (s *SQLiteStore) getCurrentVersion() int {
	var version int
	row := s.db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
	if err := row.Scan(&version); err != nil {
		return 0
	}
	return version
}

// parseVersion extracts the version number from a migration filename like "001_initial.sql".
func parseVersion(name string) int {
	parts := strings.SplitN(name, "_", 2)
	if len(parts) == 0 {
		return 0
	}
	v, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0
	}
	return v
}
