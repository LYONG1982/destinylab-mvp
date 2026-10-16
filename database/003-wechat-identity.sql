BEGIN;
CREATE TABLE IF NOT EXISTS dl_wechat_identities (
 id uuid PRIMARY KEY, appid text NOT NULL, openid text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(appid,openid)
);
CREATE TABLE IF NOT EXISTS dl_wechat_participants (
 identity_id uuid NOT NULL REFERENCES dl_wechat_identities(id),
 activity_id text NOT NULL REFERENCES dl_activities(id), actor text NOT NULL,
 PRIMARY KEY(identity_id,activity_id), UNIQUE(activity_id,actor)
);
CREATE TABLE IF NOT EXISTS dl_mini_sessions (
 token_hash text PRIMARY KEY, identity_id uuid NOT NULL REFERENCES dl_wechat_identities(id),
 activity_id text NOT NULL REFERENCES dl_activities(id), actor text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dl_mini_session_owner ON dl_mini_sessions(identity_id,activity_id);
CREATE TABLE IF NOT EXISTS dl_wechat_codes_used (
 code_hash text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dl_wechat_entry_codes (
 activity_id text NOT NULL REFERENCES dl_activities(id), appid text NOT NULL,
 env_version text NOT NULL CHECK(env_version IN ('develop','trial','release')),
 scene text NOT NULL UNIQUE, image bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(activity_id,appid,env_version)
);
COMMIT;
