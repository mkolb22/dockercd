-- Track how an application was created: 'manifest' (config file) or 'api' (REST API).
-- Defaults to 'api' for backward compatibility with existing rows.
ALTER TABLE applications ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
