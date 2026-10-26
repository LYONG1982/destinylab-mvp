-- Only after disabling the feature, backing up these four tables, and approving removal
-- of the newly collected wall consent and statistics. Ordinary app rollback retains them.
BEGIN;
DROP TABLE IF EXISTS dl_member_wall_sessions;
DROP TABLE IF EXISTS dl_member_wall_exposure;
DROP TABLE IF EXISTS dl_member_wall_config;
DROP TABLE IF EXISTS dl_member_wall_consents;
COMMIT;
