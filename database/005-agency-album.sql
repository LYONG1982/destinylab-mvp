BEGIN;
CREATE TABLE IF NOT EXISTS dl_agency_albums (
 activity_id text NOT NULL, actor text NOT NULL, version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(activity_id,actor),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_tongzhou_submissions(activity_id,actor)
);
CREATE TABLE IF NOT EXISTS dl_agency_photos (
 id uuid PRIMARY KEY, activity_id text NOT NULL, actor text NOT NULL,
 organization_id text NOT NULL DEFAULT 'tongzhou' CHECK(organization_id='tongzhou'),
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=2097152),
 thumbnail bytea NOT NULL CHECK(octet_length(thumbnail)<=204800),
 width integer NOT NULL, height integer NOT NULL, position integer NOT NULL,
 staff text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_tongzhou_submissions(activity_id,actor)
);
CREATE INDEX IF NOT EXISTS dl_agency_photos_owner ON dl_agency_photos(activity_id,actor,position);
ALTER TABLE dl_agency_profiles ADD COLUMN IF NOT EXISTS photo_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE dl_agency_profiles ADD COLUMN IF NOT EXISTS source_album_version integer;
COMMIT;
