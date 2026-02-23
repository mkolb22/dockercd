-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version  INTEGER PRIMARY KEY,
    applied  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Application definitions and current status
CREATE TABLE IF NOT EXISTS applications (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    manifest        TEXT NOT NULL,
    sync_status     TEXT NOT NULL DEFAULT 'Unknown',
    health_status   TEXT NOT NULL DEFAULT 'Unknown',
    last_synced_sha TEXT,
    head_sha        TEXT,
    last_sync_time  TIMESTAMP,
    last_error      TEXT,
    services_json   TEXT,
    conditions_json TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sync history
CREATE TABLE IF NOT EXISTS sync_history (
    id           TEXT PRIMARY KEY,
    app_name     TEXT NOT NULL,
    started_at   TIMESTAMP NOT NULL,
    finished_at  TIMESTAMP,
    commit_sha   TEXT,
    operation    TEXT NOT NULL,
    result       TEXT NOT NULL,
    diff_json    TEXT,
    error        TEXT,
    duration_ms  INTEGER,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (app_name) REFERENCES applications(name) ON DELETE CASCADE
);

-- Application events
CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    app_name   TEXT NOT NULL,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info',
    data_json  TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (app_name) REFERENCES applications(name) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sync_history_app_name ON sync_history(app_name);
CREATE INDEX IF NOT EXISTS idx_sync_history_started_at ON sync_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_app_name ON events(app_name);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
