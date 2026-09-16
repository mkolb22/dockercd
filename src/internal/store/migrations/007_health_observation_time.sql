-- Reconciliation time and successful live-health observation are distinct.
-- Retaining the latter lets presentation clients describe freshness honestly.
ALTER TABLE applications ADD COLUMN last_observation_time TIMESTAMP;
ALTER TABLE applications ADD COLUMN last_observed_health_status TEXT;
