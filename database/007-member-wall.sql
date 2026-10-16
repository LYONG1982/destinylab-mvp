BEGIN;
CREATE TABLE IF NOT EXISTS dl_member_wall_consents (
 activity_id text NOT NULL REFERENCES dl_activities(id), participant_id text NOT NULL,
 epoch text NOT NULL, public_id uuid NOT NULL UNIQUE, encounter_code text NOT NULL,
 nickname text NOT NULL, allowed boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 consent_version text NOT NULL, question_ids jsonb NOT NULL,
 allowed_at timestamptz, revoked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,participant_id), UNIQUE(activity_id,encounter_code)
);
CREATE TABLE IF NOT EXISTS dl_member_wall_config (
 activity_id text PRIMARY KEY REFERENCES dl_activities(id), config jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dl_member_wall_exposure (
 activity_id text NOT NULL REFERENCES dl_activities(id), public_id uuid NOT NULL,
 visible_ms bigint NOT NULL DEFAULT 0 CHECK(visible_ms>=0), last_shown_at timestamptz,
 PRIMARY KEY(activity_id,public_id)
);
CREATE TABLE IF NOT EXISTS dl_member_wall_sessions (
 activity_id text PRIMARY KEY REFERENCES dl_activities(id), epoch text NOT NULL,
 token_hash text NOT NULL, owner text NOT NULL, visible_ids jsonb NOT NULL DEFAULT '[]',
 batch integer NOT NULL DEFAULT 1, sequence bigint NOT NULL DEFAULT 0,
 capacity integer NOT NULL CHECK(capacity BETWEEN 12 AND 32 AND capacity%4=0),
 started_at timestamptz NOT NULL DEFAULT now(), heartbeat_at timestamptz NOT NULL DEFAULT now(),
 rotated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
COMMIT;
