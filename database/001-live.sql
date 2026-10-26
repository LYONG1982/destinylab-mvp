BEGIN;
CREATE TABLE IF NOT EXISTS dl_activities (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dl_sessions (
  token_hash text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES dl_activities(id),
  role text NOT NULL CHECK (role IN ('participant', 'operator')),
  actor text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dl_sessions_expiry ON dl_sessions(expires_at);
CREATE TABLE IF NOT EXISTS dl_commands (
  activity_id text NOT NULL REFERENCES dl_activities(id),
  actor text NOT NULL,
  command_id text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(activity_id, actor, command_id)
);
ALTER TABLE dl_commands ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS dl_events (
  activity_id text NOT NULL REFERENCES dl_activities(id),
  revision bigint NOT NULL,
  public_events jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(activity_id, revision)
);
CREATE TABLE IF NOT EXISTS dl_rate_limits (
  bucket text NOT NULL,
  window_id bigint NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY(bucket, window_id)
);
COMMIT;
