-- Phase 4: Referral and Inquiry (spec 01-referral-inquiry) — DDL + indexes

CREATE TYPE referral_lead_status AS ENUM (
  'new',
  'contacted',
  'tour_scheduled',
  'tour_completed',
  'application_pending',
  'waitlisted',
  'converted',
  'lost',
  'merged'
);

CREATE TYPE pii_access_tier AS ENUM (
  'public_summary',
  'standard_ops',
  'clinical_precheck'
);

CREATE TABLE referral_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  name text NOT NULL,
  source_type text NOT NULL,
  external_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT referral_sources_org_name_active UNIQUE NULLS NOT DISTINCT (organization_id, name, deleted_at)
);

CREATE INDEX idx_referral_sources_org ON referral_sources (organization_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE referral_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  referral_source_id uuid REFERENCES referral_sources (id),
  status referral_lead_status NOT NULL DEFAULT 'new',
  pii_access_tier pii_access_tier NOT NULL DEFAULT 'standard_ops',
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date,
  phone text,
  email text,
  notes text,
  converted_resident_id uuid REFERENCES residents (id),
  converted_at timestamptz,
  merged_into_lead_id uuid REFERENCES referral_leads (id),
  merged_at timestamptz,
  merged_by uuid REFERENCES auth.users (id),
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_referral_leads_facility_status ON referral_leads (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_referral_leads_org_created ON referral_leads (organization_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_referral_leads_dedupe_external ON referral_leads (organization_id, facility_id, external_reference)
WHERE
  deleted_at IS NULL
  AND external_reference IS NOT NULL;

ALTER TABLE residents
  ADD CONSTRAINT residents_referral_source_id_fkey
  FOREIGN KEY (referral_source_id) REFERENCES referral_sources (id);

COMMENT ON TABLE referral_sources IS 'Referral channel master data; ties to residents.referral_source_id.';

COMMENT ON TABLE referral_leads IS 'Pre-admission inquiries and referrals; RLS in 076.';
