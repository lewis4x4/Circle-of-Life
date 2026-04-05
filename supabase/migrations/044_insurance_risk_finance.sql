-- Module 18 — Insurance & Risk Finance (spec 18-insurance-risk-finance)
-- Depends on: organizations, entities, facilities, incidents (007), staff (024), gl_accounts (040)
-- RLS: haven.organization_id(), haven.accessible_facility_ids(), haven.app_role()
-- Triggers: public.haven_set_updated_at, public.haven_capture_audit_log (006_audit_triggers.sql)

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE insurance_policy_type AS ENUM (
  'general_liability',
  'property',
  'workers_comp',
  'auto',
  'umbrella',
  'directors_officers',
  'cyber',
  'epli',
  'professional',
  'other'
);

CREATE TYPE insurance_policy_status AS ENUM (
  'draft',
  'active',
  'expired',
  'cancelled',
  'pending_renewal'
);

CREATE TYPE insurance_renewal_status AS ENUM (
  'upcoming',
  'in_progress',
  'bound',
  'expired',
  'declined'
);

CREATE TYPE insurance_claim_status AS ENUM (
  'reported',
  'investigating',
  'reserved',
  'partially_paid',
  'closed',
  'denied',
  'withdrawn'
);

CREATE TYPE coi_holder_type AS ENUM (
  'vendor',
  'landlord',
  'lender',
  'other'
);

-- ============================================================
-- ENTITY GL SETTINGS — Module 17 extension (nullable GL account FKs)
-- ============================================================
ALTER TABLE entity_gl_settings
  ADD COLUMN insurance_expense_gl_account_id uuid REFERENCES gl_accounts (id),
  ADD COLUMN claims_reserve_gl_account_id uuid REFERENCES gl_accounts (id);

-- ============================================================
-- INSURANCE POLICIES
-- ============================================================
CREATE TABLE insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  policy_type insurance_policy_type NOT NULL,
  carrier_name text NOT NULL,
  broker_name text,
  policy_number text NOT NULL,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  status insurance_policy_status NOT NULL DEFAULT 'active',
  aggregate_limit_cents integer,
  occurrence_limit_cents integer,
  deductible_cents integer,
  premium_cents integer,
  premium_period text,
  notes text,
  document_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_policies_org ON insurance_policies (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_policies_entity ON insurance_policies (entity_id, expiration_date)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_policies_expiry ON insurance_policies (organization_id, expiration_date)
WHERE
  deleted_at IS NULL
  AND status = 'active';

-- ============================================================
-- RENEWAL DATA PACKAGES
-- ============================================================
CREATE TABLE renewal_data_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),
  generated_at timestamptz NOT NULL DEFAULT now (),
  period_start date NOT NULL,
  period_end date NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_renewal_data_packages_policy ON renewal_data_packages (insurance_policy_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- INSURANCE RENEWALS
-- ============================================================
CREATE TABLE insurance_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),
  renewal_data_package_id uuid REFERENCES renewal_data_packages (id),
  target_effective_date date NOT NULL,
  status insurance_renewal_status NOT NULL DEFAULT 'upcoming',
  milestone_120_date date,
  milestone_90_date date,
  milestone_60_date date,
  milestone_30_date date,
  quoted_premium_cents integer,
  bound_premium_cents integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_renewals_policy ON insurance_renewals (insurance_policy_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- INSURANCE CLAIMS
-- ============================================================
CREATE TABLE insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  insurance_policy_id uuid REFERENCES insurance_policies (id),
  incident_id uuid REFERENCES incidents (id),
  claim_number text,
  date_of_loss date,
  reported_at timestamptz,
  status insurance_claim_status NOT NULL DEFAULT 'reported',
  reserve_cents integer NOT NULL DEFAULT 0 CHECK (reserve_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  adjuster_name text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_claims_org ON insurance_claims (organization_id, date_of_loss DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_claims_incident ON insurance_claims (incident_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CLAIM ACTIVITIES
-- ============================================================
CREATE TABLE claim_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  insurance_claim_id uuid NOT NULL REFERENCES insurance_claims (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  activity_date date NOT NULL,
  activity_type text NOT NULL,
  description text NOT NULL,
  performed_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_claim_activities_claim ON claim_activities (insurance_claim_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- LOSS RUNS
-- ============================================================
CREATE TABLE loss_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now (),
  total_claims_count integer NOT NULL DEFAULT 0,
  total_paid_cents bigint NOT NULL DEFAULT 0,
  total_reserve_cents bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_loss_runs_entity ON loss_runs (entity_id, period_end DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- PREMIUM ALLOCATIONS
-- ============================================================
CREATE TABLE premium_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  allocation_method text NOT NULL DEFAULT 'bed_count'
    CHECK (allocation_method IN ('bed_count', 'revenue_share', 'manual', 'custom')),
  allocation_percent numeric(6, 3),
  allocated_premium_cents integer NOT NULL DEFAULT 0 CHECK (allocated_premium_cents >= 0),
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_premium_allocations_policy ON premium_allocations (insurance_policy_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_premium_allocations_facility ON premium_allocations (facility_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CERTIFICATES OF INSURANCE
-- ============================================================
CREATE TABLE certificates_of_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),
  holder_name text NOT NULL,
  holder_type coi_holder_type NOT NULL DEFAULT 'other',
  carrier_name text NOT NULL,
  policy_number text,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  additional_insured boolean NOT NULL DEFAULT false,
  waiver_of_subrogation boolean NOT NULL DEFAULT false,
  aggregate_limit_cents integer,
  document_storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_coi_expiry ON certificates_of_insurance (organization_id, expiration_date)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- WORKERS COMP CLAIMS
-- ============================================================
CREATE TABLE workers_comp_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid REFERENCES staff (id),
  claim_number text,
  injury_date date NOT NULL,
  status insurance_claim_status NOT NULL DEFAULT 'reported',
  first_report_filed_at timestamptz,
  modified_duty_start date,
  modified_duty_end date,
  return_to_work_date date,
  reserve_cents integer NOT NULL DEFAULT 0 CHECK (reserve_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_workers_comp_facility ON workers_comp_claims (facility_id, injury_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- RLS — shared expressions (inline per policy)
-- ============================================================

-- insurance_policies
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_policies_select ON insurance_policies
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL))));

CREATE POLICY insurance_policies_insert ON insurance_policies
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_policies_update ON insurance_policies
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_policies_delete ON insurance_policies
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- renewal_data_packages
ALTER TABLE renewal_data_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY renewal_data_packages_select ON renewal_data_packages
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL))));

CREATE POLICY renewal_data_packages_insert ON renewal_data_packages
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY renewal_data_packages_update ON renewal_data_packages
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY renewal_data_packages_delete ON renewal_data_packages
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- insurance_renewals
ALTER TABLE insurance_renewals ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_renewals_select ON insurance_renewals
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL))));

CREATE POLICY insurance_renewals_insert ON insurance_renewals
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_renewals_update ON insurance_renewals
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_renewals_delete ON insurance_renewals
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- insurance_claims
ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_claims_select ON insurance_claims
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND (
          facility_id IS NULL
          AND entity_id IN (
            SELECT
              f.entity_id
            FROM
              facilities f
            WHERE
              f.id IN (
                SELECT
                  haven.accessible_facility_ids ())
                AND f.deleted_at IS NULL)
          OR facility_id IN (
            SELECT
              haven.accessible_facility_ids ())))));

CREATE POLICY insurance_claims_insert ON insurance_claims
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_claims_update ON insurance_claims
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY insurance_claims_delete ON insurance_claims
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- claim_activities
ALTER TABLE claim_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY claim_activities_select ON claim_activities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            insurance_claims c
          WHERE
            c.id = claim_activities.insurance_claim_id
            AND c.organization_id = haven.organization_id ()
            AND c.deleted_at IS NULL
            AND (
              c.facility_id IS NULL
              AND c.entity_id IN (
                SELECT
                  f.entity_id
                FROM
                  facilities f
                WHERE
                  f.id IN (
                    SELECT
                      haven.accessible_facility_ids ())
                    AND f.deleted_at IS NULL)
              OR c.facility_id IN (
                SELECT
                  haven.accessible_facility_ids ()))))));

CREATE POLICY claim_activities_insert ON claim_activities
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        insurance_claims c
      WHERE
        c.id = claim_activities.insurance_claim_id
        AND c.organization_id = haven.organization_id ()
        AND c.deleted_at IS NULL));

CREATE POLICY claim_activities_update ON claim_activities
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY claim_activities_delete ON claim_activities
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- loss_runs
ALTER TABLE loss_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY loss_runs_select ON loss_runs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND entity_id IN (
          SELECT
            f.entity_id
          FROM
            facilities f
          WHERE
            f.id IN (
              SELECT
                haven.accessible_facility_ids ())
              AND f.deleted_at IS NULL))));

CREATE POLICY loss_runs_insert ON loss_runs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY loss_runs_update ON loss_runs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY loss_runs_delete ON loss_runs
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- premium_allocations
ALTER TABLE premium_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY premium_allocations_select ON premium_allocations
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY premium_allocations_insert ON premium_allocations
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY premium_allocations_update ON premium_allocations
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY premium_allocations_delete ON premium_allocations
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- certificates_of_insurance
ALTER TABLE certificates_of_insurance ENABLE ROW LEVEL SECURITY;

CREATE POLICY certificates_of_insurance_select ON certificates_of_insurance
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND (
          entity_id IS NULL
          OR entity_id IN (
            SELECT
              f.entity_id
            FROM
              facilities f
            WHERE
              f.id IN (
                SELECT
                  haven.accessible_facility_ids ())
                AND f.deleted_at IS NULL)))));

CREATE POLICY certificates_of_insurance_insert ON certificates_of_insurance
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY certificates_of_insurance_update ON certificates_of_insurance
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY certificates_of_insurance_delete ON certificates_of_insurance
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- workers_comp_claims
ALTER TABLE workers_comp_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY workers_comp_claims_select ON workers_comp_claims
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY workers_comp_claims_insert ON workers_comp_claims
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY workers_comp_claims_update ON workers_comp_claims
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY workers_comp_claims_delete ON workers_comp_claims
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- TRIGGERS — updated_at + audit
-- ============================================================
CREATE TRIGGER tr_insurance_policies_set_updated_at
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_insurance_policies_audit
  AFTER INSERT OR UPDATE OR DELETE ON insurance_policies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_renewal_data_packages_audit
  AFTER INSERT OR UPDATE OR DELETE ON renewal_data_packages
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_insurance_renewals_set_updated_at
  BEFORE UPDATE ON insurance_renewals
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_insurance_renewals_audit
  AFTER INSERT OR UPDATE OR DELETE ON insurance_renewals
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_insurance_claims_set_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_insurance_claims_audit
  AFTER INSERT OR UPDATE OR DELETE ON insurance_claims
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_claim_activities_audit
  AFTER INSERT OR UPDATE OR DELETE ON claim_activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_loss_runs_audit
  AFTER INSERT OR UPDATE OR DELETE ON loss_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_premium_allocations_set_updated_at
  BEFORE UPDATE ON premium_allocations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_premium_allocations_audit
  AFTER INSERT OR UPDATE OR DELETE ON premium_allocations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_certificates_of_insurance_set_updated_at
  BEFORE UPDATE ON certificates_of_insurance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_certificates_of_insurance_audit
  AFTER INSERT OR UPDATE OR DELETE ON certificates_of_insurance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_workers_comp_claims_set_updated_at
  BEFORE UPDATE ON workers_comp_claims
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_workers_comp_claims_audit
  AFTER INSERT OR UPDATE OR DELETE ON workers_comp_claims
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

COMMENT ON TABLE insurance_policies IS 'Module 18: entity-level corporate insurance policies.';
COMMENT ON COLUMN journal_entries.source_type IS 'Includes billing_invoice, invoice, insurance_premium, insurance_claim_reserve (app-posted).';
