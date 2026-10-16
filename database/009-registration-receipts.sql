BEGIN;
ALTER TABLE dl_registrations ADD COLUMN IF NOT EXISTS legacy_receipt text;
CREATE UNIQUE INDEX IF NOT EXISTS dl_registration_legacy_receipt
  ON dl_registrations(legacy_receipt) WHERE legacy_receipt IS NOT NULL;
COMMIT;
