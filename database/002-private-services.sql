BEGIN;
CREATE TABLE IF NOT EXISTS dl_tongzhou_submissions (
 activity_id text NOT NULL REFERENCES dl_activities(id), actor text NOT NULL,
 organization_id text NOT NULL DEFAULT 'tongzhou' CHECK (organization_id='tongzhou'),
 record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,actor)
);
CREATE TABLE IF NOT EXISTS dl_agency_sessions (
 token_hash text PRIMARY KEY, activity_id text NOT NULL REFERENCES dl_activities(id),
 organization_id text NOT NULL CHECK (organization_id='tongzhou'), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS dl_agency_expiry ON dl_agency_sessions(expires_at);
CREATE TABLE IF NOT EXISTS dl_private_commands (
 activity_id text NOT NULL REFERENCES dl_activities(id), actor text NOT NULL,
 command_id text NOT NULL, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,actor,command_id)
);
CREATE TABLE IF NOT EXISTS dl_avatar_assets (
 id uuid PRIMARY KEY, activity_id text NOT NULL REFERENCES dl_activities(id), actor text NOT NULL,
 bytes bytea NOT NULL CHECK (octet_length(bytes)<=204800),
 created_at timestamptz NOT NULL DEFAULT now(), attached boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS dl_avatar_owner ON dl_avatar_assets(activity_id,actor);
COMMIT;
