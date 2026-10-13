BEGIN;
CREATE TABLE IF NOT EXISTS dl_mini_identity_sessions (
 token_hash text PRIMARY KEY,
 identity_id uuid NOT NULL REFERENCES dl_wechat_identities(id),
 activity_id text NOT NULL REFERENCES dl_activities(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dl_mini_identity_session_owner ON dl_mini_identity_sessions(identity_id,activity_id);
CREATE TABLE IF NOT EXISTS dl_wechat_registrations (
 identity_id uuid NOT NULL REFERENCES dl_wechat_identities(id),
 activity_id text NOT NULL REFERENCES dl_activities(id),
 registration_id uuid,
 PRIMARY KEY(identity_id,activity_id),
 UNIQUE(activity_id,registration_id),
 FOREIGN KEY(activity_id,registration_id) REFERENCES dl_registrations(activity_id,id)
);
ALTER TABLE dl_wechat_entry_codes ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'encounter' CHECK(entry_type IN ('registration','encounter'));
ALTER TABLE dl_wechat_entry_codes DROP CONSTRAINT IF EXISTS dl_wechat_entry_codes_pkey;
ALTER TABLE dl_wechat_entry_codes ADD PRIMARY KEY(activity_id,appid,env_version,entry_type);
COMMIT;
