-- Migration 172: Extend existing tables for med-tech cockpit integration
--
-- Adds FK columns to emar_records linking to med_passes + witness_signatures.
-- Adds witness_required + geofence_enforced flags to resident_medications.
-- All columns nullable / have defaults — backward compatible.

-- ── emar_records extensions ──
ALTER TABLE emar_records
  ADD COLUMN IF NOT EXISTS med_pass_id uuid REFERENCES med_passes(id),
  ADD COLUMN IF NOT EXISTS witness_signature_id uuid REFERENCES witness_signatures(id);

CREATE INDEX IF NOT EXISTS idx_emar_records_med_pass
  ON emar_records(med_pass_id) WHERE med_pass_id IS NOT NULL;

-- ── resident_medications extensions ──
ALTER TABLE resident_medications
  ADD COLUMN IF NOT EXISTS witness_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_enforced boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
