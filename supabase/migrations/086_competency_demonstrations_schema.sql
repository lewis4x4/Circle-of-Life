-- Phase 6: Training & Competency (spec 12-training-competency) — DDL

CREATE TYPE competency_demonstration_status AS ENUM (
  'draft',
  'submitted',
  'passed',
  'failed',
  'voided'
);

CREATE TABLE competency_demonstrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  evaluator_user_id uuid NOT NULL REFERENCES auth.users (id),
  demonstrated_at timestamptz NOT NULL DEFAULT now (),
  status competency_demonstration_status NOT NULL DEFAULT 'draft',
  skills_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_competency_demonstrations_facility ON competency_demonstrations (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_competency_demonstrations_staff ON competency_demonstrations (staff_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_competency_demonstrations_evaluator ON competency_demonstrations (evaluator_user_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE competency_demonstrations IS 'Skills demonstration records; RLS in 087. attachments = jsonb array of {storage_path, label}.';
