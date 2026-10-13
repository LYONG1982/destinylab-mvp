BEGIN;
-- Source submissions and staff records remain intact. Only verified server-side
-- registration -> participant bindings can create a shared institutional member.
CREATE TABLE IF NOT EXISTS dl_agency_source_links (
 activity_id text NOT NULL, actor text NOT NULL, member_actor text NOT NULL,
 PRIMARY KEY(activity_id,actor),
 FOREIGN KEY(activity_id,actor) REFERENCES dl_tongzhou_submissions(activity_id,actor),
 FOREIGN KEY(activity_id,member_actor) REFERENCES dl_tongzhou_submissions(activity_id,actor)
);
CREATE INDEX IF NOT EXISTS dl_agency_source_member ON dl_agency_source_links(activity_id,member_actor);
CREATE OR REPLACE FUNCTION dl_refresh_agency_members(a text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; member text; added integer;
BEGIN
 FOR r IN
  SELECT 'registration:'||g.id AS registration_actor,g.participant_id AS encounter_actor
  FROM dl_registrations g
  JOIN dl_tongzhou_submissions x ON x.activity_id=g.activity_id AND x.actor='registration:'||g.id
  JOIN dl_tongzhou_submissions y ON y.activity_id=g.activity_id AND y.actor=g.participant_id
  WHERE g.activity_id=a AND g.participant_id IS NOT NULL
 LOOP
  SELECT member_actor INTO member FROM dl_agency_source_links
   WHERE activity_id=a AND actor IN(r.registration_actor,r.encounter_actor)
   ORDER BY actor LIMIT 1;
  IF member IS NULL THEN
   SELECT actor INTO member FROM dl_tongzhou_submissions
    WHERE activity_id=a AND actor IN(r.registration_actor,r.encounter_actor)
    ORDER BY EXISTS(SELECT 1 FROM dl_agency_profiles p WHERE p.activity_id=a AND p.actor=dl_tongzhou_submissions.actor) DESC,(record->>'submittedAt')::bigint,actor LIMIT 1;
  END IF;
  INSERT INTO dl_agency_source_links VALUES(a,r.registration_actor,member),(a,r.encounter_actor,member)
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  IF added>0 THEN
   -- Keep both originals for provenance; the canonical follow-up incorporates
   -- statuses and notes once, never on later participant edits.
   UPDATE dl_agency_profiles m SET
    signed=m.signed OR other.signed,
    service=CASE WHEN m.service='done' OR other.service='done' THEN 'done'
                 WHEN m.service='active' OR other.service='active' THEN 'active' ELSE 'none' END,
    note=CASE WHEN other.note='' OR m.note=other.note THEN m.note
              WHEN m.note='' THEN other.note
              WHEN length(m.note||E'\n\n[合并前跟进]\n'||other.note)<=2000
               THEN m.note||E'\n\n[合并前跟进]\n'||other.note ELSE m.note END,
    version=m.version+1,updated_at=now()
   FROM dl_agency_profiles other
   WHERE m.activity_id=a AND m.actor=member AND other.activity_id=a
    AND other.actor IN(r.registration_actor,r.encounter_actor) AND other.actor<>member;
   UPDATE dl_agency_profiles SET published=false,version=version+1
    WHERE activity_id=a AND actor IN(r.registration_actor,r.encounter_actor,member);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION dl_agency_members_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM dl_refresh_agency_members(NEW.activity_id);
 IF TG_TABLE_NAME='dl_tongzhou_submissions' THEN
  UPDATE dl_agency_profiles SET published=false
   WHERE activity_id=NEW.activity_id AND actor IN
    (NEW.actor,COALESCE((SELECT member_actor FROM dl_agency_source_links
      WHERE activity_id=NEW.activity_id AND actor=NEW.actor),NEW.actor));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dl_agency_submission_changed ON dl_tongzhou_submissions;
CREATE TRIGGER dl_agency_submission_changed AFTER INSERT OR UPDATE OF record ON dl_tongzhou_submissions
 FOR EACH ROW EXECUTE FUNCTION dl_agency_members_changed();
DROP TRIGGER IF EXISTS dl_agency_registration_linked ON dl_registrations;
CREATE TRIGGER dl_agency_registration_linked AFTER INSERT OR UPDATE OF participant_id ON dl_registrations
 FOR EACH ROW EXECUTE FUNCTION dl_agency_members_changed();
SELECT dl_refresh_agency_members(id) FROM dl_activities;
CREATE OR REPLACE VIEW dl_agency_sources AS
 SELECT s.*,COALESCE(l.member_actor,s.actor) AS member_actor,
  CASE WHEN s.actor LIKE 'registration:%' THEN 'registration' ELSE 'encounter' END AS source,
  (s.record->>'status'='active' AND s.record->'consent'->>'version'='tongzhou-2026-10-06-v1') AS active
 FROM dl_tongzhou_submissions s LEFT JOIN dl_agency_source_links l USING(activity_id,actor);
CREATE OR REPLACE VIEW dl_agency_members AS
 WITH versions AS (
  SELECT activity_id,member_actor,sum((record->>'version')::integer)::integer AS version
  FROM dl_agency_sources GROUP BY activity_id,member_actor
 ), available AS (
  SELECT *,row_number() OVER(PARTITION BY activity_id,member_actor
    ORDER BY (record->>'updatedAt')::bigint DESC,actor) AS rank
  FROM dl_agency_sources WHERE active
 ), origins AS (
  SELECT activity_id,member_actor,jsonb_agg(DISTINCT source) AS sources
  FROM available GROUP BY activity_id,member_actor
 )
 SELECT a.activity_id,a.member_actor AS actor,a.organization_id,
  a.record||jsonb_build_object('participantId',a.member_actor,'version',v.version) AS record,
  a.updated_at,o.sources,a.source AS latest_source,a.actor AS source_actor
 FROM available a JOIN versions v USING(activity_id,member_actor)
 JOIN origins o USING(activity_id,member_actor) WHERE a.rank=1;
COMMIT;
