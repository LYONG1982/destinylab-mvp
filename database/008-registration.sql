BEGIN;
CREATE TABLE IF NOT EXISTS dl_registration_config (
 activity_id text PRIMARY KEY REFERENCES dl_activities(id), config jsonb NOT NULL, version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS dl_registrations (
 id uuid PRIMARY KEY, activity_id text NOT NULL REFERENCES dl_activities(id),
 nickname text NOT NULL, fields jsonb NOT NULL, status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','checked_in','cancelled')),
 receipt text NOT NULL UNIQUE, consent_version text NOT NULL, consent_at timestamptz NOT NULL DEFAULT now(),
 agency_allowed boolean NOT NULL DEFAULT false, agency_consent_at timestamptz,
 version integer NOT NULL DEFAULT 1, participant_id text, participant_epoch text, checkin_epoch text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), checked_in_at timestamptz,
 UNIQUE(activity_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dl_registration_phone ON dl_registrations(activity_id,(fields->>'phone'));
CREATE UNIQUE INDEX IF NOT EXISTS dl_registration_participant ON dl_registrations(activity_id,participant_epoch,participant_id) WHERE participant_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS dl_registration_sessions (
 token_hash text PRIMARY KEY, activity_id text NOT NULL REFERENCES dl_activities(id), registration_id uuid,
 expires_at timestamptz NOT NULL, FOREIGN KEY(activity_id,registration_id) REFERENCES dl_registrations(activity_id,id)
);
CREATE TABLE IF NOT EXISTS dl_registration_photos (
 id uuid PRIMARY KEY, registration_id uuid NOT NULL REFERENCES dl_registrations(id),
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=2097152), thumbnail bytea NOT NULL CHECK(octet_length(thumbnail)<=204800),
 width integer NOT NULL, height integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dl_registration_actions (
 activity_id text NOT NULL REFERENCES dl_activities(id), owner text NOT NULL, command_id text NOT NULL,
 payload_hash text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,owner,command_id)
);
COMMIT;
