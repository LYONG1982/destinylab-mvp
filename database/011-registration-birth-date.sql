-- Private registration metadata. Intentionally outside the shared/public fields JSON.
ALTER TABLE dl_registrations ADD COLUMN IF NOT EXISTS birth_date text;
