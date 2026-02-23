CREATE TABLE IF NOT EXISTS image_policies (
    id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL REFERENCES applications(name) ON DELETE CASCADE,
    service_name TEXT NOT NULL,
    image TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT 'semver',
    last_checked_tag TEXT,
    last_check_time TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(app_name, service_name)
);
