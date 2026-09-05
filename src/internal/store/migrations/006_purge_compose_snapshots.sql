-- Compose snapshots contain resolved environment variables and may therefore
-- contain deployment secrets. Rollback reconstructs the target state from Git,
-- so historical snapshots are not required for operation.
UPDATE sync_history SET compose_spec_json = NULL WHERE compose_spec_json IS NOT NULL;
