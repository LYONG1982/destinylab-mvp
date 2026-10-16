BEGIN;
CREATE TABLE IF NOT EXISTS dl_mini_media_reviews (
 asset_id uuid PRIMARY KEY REFERENCES dl_avatar_assets(id) ON DELETE CASCADE,
 identity_id uuid NOT NULL REFERENCES dl_wechat_identities(id),
 appid text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','pass','review','risky','error')),
 trace_id text UNIQUE,
 token_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- A signed callback can arrive before the provider's submission response.
CREATE TABLE IF NOT EXISTS dl_mini_review_results (
 appid text NOT NULL, trace_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('pass','review','risky','error')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(appid,trace_id)
);
COMMIT;
