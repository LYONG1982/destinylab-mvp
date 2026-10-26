BEGIN;
-- Only explicitly published current user photos are copied; private albums stay live projections.
CREATE TABLE IF NOT EXISTS dl_agency_user_photo_snapshots (
 activity_id text NOT NULL, actor text NOT NULL, id uuid NOT NULL,
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=204800),
 PRIMARY KEY(activity_id,actor,id),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_agency_profiles(activity_id,actor)
);
COMMIT;
