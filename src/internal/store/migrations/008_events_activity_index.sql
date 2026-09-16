-- Bounded per-application activity windows are merged by created time and id.
CREATE INDEX IF NOT EXISTS idx_events_app_created_id
    ON events(app_name, created_at DESC, id DESC);
