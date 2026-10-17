BEGIN;
-- Bootstrap the migration history table. Existing databases retain their recorded history.
CREATE TABLE IF NOT EXISTS dl_schema_migrations (
 version text PRIMARY KEY,
 name text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dl_schema_migrations(version,name)
VALUES ('000','migration-history-bootstrap')
ON CONFLICT(version) DO NOTHING;
COMMIT;
