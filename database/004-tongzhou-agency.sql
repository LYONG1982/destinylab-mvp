BEGIN;
CREATE TABLE IF NOT EXISTS dl_agency_profiles (
 activity_id text NOT NULL, actor text NOT NULL,
 organization_id text NOT NULL DEFAULT 'tongzhou' CHECK(organization_id='tongzhou'),
 version integer NOT NULL DEFAULT 0,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 signed boolean NOT NULL DEFAULT false,
 service text NOT NULL DEFAULT 'none' CHECK(service IN ('none','active','done')),
 nickname text NOT NULL DEFAULT '', code text NOT NULL UNIQUE,
 intro text NOT NULL DEFAULT '', fields jsonb NOT NULL DEFAULT '[]',
 slug text NOT NULL UNIQUE, published boolean NOT NULL DEFAULT false,
 snapshot jsonb, photo bytea CHECK(octet_length(photo)<=204800),
 source_version integer, source_photo text,
 published_draft jsonb, published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,actor),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_tongzhou_submissions(activity_id,actor)
);
CREATE TABLE IF NOT EXISTS dl_agency_actions (
 activity_id text NOT NULL, actor text NOT NULL, command_id text NOT NULL,
 payload_hash text NOT NULL, action text NOT NULL, staff text NOT NULL,
 public_permission_confirmed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,actor,command_id)
);
COMMIT;
