BEGIN;
ALTER TABLE dl_registrations ADD COLUMN IF NOT EXISTS profile_progress jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE dl_registrations ADD COLUMN IF NOT EXISTS profile_confirmed_at timestamptz;
COMMIT;
