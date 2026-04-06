-- Phase 4: Discharge and Transition (spec 05-discharge-transition) — DDL + indexes

CREATE TYPE hospice_status AS ENUM (
  'none',
  'pending',
  'active',
  'ended'
);

CREATE TYPE discharge_med_reconciliation_status AS ENUM (
  'draft',
  'pharmacist_review',
  'complete',
  'cancelled'
);

ALTER TABLE residents
  ADD COLUMN discharge_target_date date,
  ADD COLUMN hospice_status hospice_status NOT NULL DEFAULT 'none';

CREATE TABLE discharge_med_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  status discharge_med_reconciliation_status NOT NULL DEFAULT 'draft',
  pharmacist_reviewed_at timestamptz,
  pharmacist_reviewed_by uuid REFERENCES auth.users (id),
  pharmacist_npi text,
  pharmacist_notes text,
  nurse_reconciliation_notes text,
  med_snapshot_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_discharge_med_reconciliation_facility ON discharge_med_reconciliation (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_discharge_med_reconciliation_resident ON discharge_med_reconciliation (resident_id)
WHERE
  deleted_at IS NULL;

COMMENT ON COLUMN residents.discharge_target_date IS 'Planned discharge date for transition planning (Phase 4).';

COMMENT ON COLUMN residents.hospice_status IS 'Hospice involvement for the resident (Phase 4).';

COMMENT ON TABLE discharge_med_reconciliation IS 'Medication reconciliation at discharge/transition; RLS in 080.';
