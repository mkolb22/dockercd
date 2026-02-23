CREATE TABLE IF NOT EXISTS docker_hosts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    url           TEXT NOT NULL UNIQUE,
    tls_cert_path TEXT,
    tls_verify    INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'Unknown',
    last_check    TIMESTAMP,
    last_error    TEXT,
    info_json     TEXT,
    stats_json    TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
