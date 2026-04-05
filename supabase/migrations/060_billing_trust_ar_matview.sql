-- Phase 3.5-C: billing-trust-ar-matview (Module 16)

CREATE TABLE trust_account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entry_date date NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('deposit', 'withdrawal', 'adjustment', 'invoice_apply')),
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_trust_resident ON trust_account_entries (resident_id, entry_date DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE invoice_generation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_payer_id uuid NOT NULL REFERENCES resident_payers (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL DEFAULT 'default',
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_invoice_gen_profile_payer ON invoice_generation_profiles (resident_payer_id)
WHERE
  deleted_at IS NULL
  AND is_active = TRUE;

ALTER TABLE trust_account_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY trust_entries_billing ON trust_account_entries
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE invoice_generation_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_gen_profiles ON invoice_generation_profiles
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_invoice_gen_profiles_set_updated_at
  BEFORE UPDATE ON invoice_generation_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE MATERIALIZED VIEW ar_aging_facility_daily AS
SELECT
  i.organization_id,
  i.facility_id,
  i.resident_id,
  date_trunc('day', i.due_date)::date AS bucket_date,
  i.status,
  sum(i.balance_due) AS balance_due_cents,
  count(*) AS invoice_count
FROM
  invoices i
WHERE
  i.deleted_at IS NULL
  AND i.status NOT IN ('void', 'draft')
GROUP BY
  i.organization_id,
  i.facility_id,
  i.resident_id,
  date_trunc('day', i.due_date)::date,
  i.status;

CREATE INDEX idx_ar_aging_mat_org_fac ON ar_aging_facility_daily (organization_id, facility_id);

COMMENT ON MATERIALIZED VIEW ar_aging_facility_daily IS 'Refresh nightly via cron: REFRESH MATERIALIZED VIEW CONCURRENTLY ar_aging_facility_daily; (add UNIQUE index for CONCURRENTLY if adopted)';
