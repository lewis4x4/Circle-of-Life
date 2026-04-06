-- Phase 4: Admissions and Move-In (spec 02-admissions-move-in) — DDL + indexes

CREATE TYPE admission_case_status AS ENUM (
  'pending_clearance',
  'bed_reserved',
  'move_in',
  'cancelled'
);

CREATE TYPE admission_accommodation_quote AS ENUM (
  'private',
  'semi_private'
);

CREATE TABLE admission_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  referral_lead_id uuid REFERENCES referral_leads (id) ON DELETE SET NULL,
  bed_id uuid REFERENCES beds (id),
  status admission_case_status NOT NULL DEFAULT 'pending_clearance',
  target_move_in_date date,
  financial_clearance_at timestamptz,
  financial_clearance_by uuid REFERENCES auth.users (id),
  physician_orders_received_at timestamptz,
  physician_orders_summary text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_admission_cases_facility ON admission_cases (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_admission_cases_resident ON admission_cases (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_admission_cases_status ON admission_cases (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE TABLE admission_case_rate_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  admission_case_id uuid NOT NULL REFERENCES admission_cases (id) ON DELETE CASCADE,
  rate_schedule_id uuid REFERENCES rate_schedules (id),
  accommodation_type admission_accommodation_quote NOT NULL,
  quoted_base_rate_cents integer NOT NULL,
  quoted_care_surcharge_cents integer NOT NULL DEFAULT 0,
  effective_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id)
);

CREATE INDEX idx_admission_case_rate_terms_case ON admission_case_rate_terms (admission_case_id);

COMMENT ON TABLE admission_cases IS 'Pre-admission workflow; RLS and audit in 078.';

COMMENT ON TABLE admission_case_rate_terms IS 'Quoted rate snapshot lines for an admission case.';
