BEGIN;
CREATE TABLE IF NOT EXISTS dl_field_archives (
 id uuid PRIMARY KEY, activity_id text NOT NULL REFERENCES dl_activities(id),
 epoch text NOT NULL, action text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dl_field_actions (
 activity_id text NOT NULL REFERENCES dl_activities(id), command_id text NOT NULL,
 payload_hash text NOT NULL, action text NOT NULL, staff text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(activity_id,command_id)
);
CREATE TABLE IF NOT EXISTS dl_field_removed (
 activity_id text NOT NULL REFERENCES dl_activities(id), epoch text NOT NULL, actor text NOT NULL,
 PRIMARY KEY(activity_id,epoch,actor)
);
CREATE TABLE IF NOT EXISTS dl_agency_retained_photos (
 activity_id text NOT NULL, actor text NOT NULL, id uuid NOT NULL,
 bytes bytea NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(activity_id,actor,id),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_tongzhou_submissions(activity_id,actor)
);
ALTER TABLE dl_wechat_participants ADD COLUMN IF NOT EXISTS epoch text;
UPDATE dl_wechat_participants w SET epoch=a.state->>'epoch' FROM dl_activities a
 WHERE w.activity_id=a.id AND w.epoch IS NULL
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.state->'participants') p WHERE p->>'id'=w.actor);
COMMIT;
