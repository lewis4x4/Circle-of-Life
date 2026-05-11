-- COL v2 handoff foundation: resident status history + Medicaid provider catalog.
-- Source: docs/specs/handoff-evidence/HAVEN_ENGINEER_HANDOFF_v2.md

CREATE OR REPLACE VIEW public.resident_billable_status AS
SELECT
  r.id AS resident_id,
  r.organization_id,
  r.facility_id,
  r.status,
  CASE
    WHEN r.status IN ('active', 'hospital_hold', 'loa') THEN true
    WHEN r.status IN ('inquiry', 'pending_admission', 'discharged', 'deceased') THEN false
    ELSE false
  END AS is_billable
FROM public.residents r
WHERE r.deleted_at IS NULL;

COMMENT ON VIEW public.resident_billable_status IS
  'Computed COL billing/census status view. Active, hospital hold, and LOA are billable until provider-specific bed-hold policies are configured.';

CREATE TABLE IF NOT EXISTS public.resident_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  status public.resident_status NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reason text,
  notes text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_resident_status_history_resident
  ON public.resident_status_history(resident_id, effective_from DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resident_status_history_facility_dates
  ON public.resident_status_history(facility_id, effective_from, effective_to)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_status_history_current_unique
  ON public.resident_status_history(resident_id)
  WHERE effective_to IS NULL AND deleted_at IS NULL;

ALTER TABLE public.resident_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_status_history_select ON public.resident_status_history;
CREATE POLICY resident_status_history_select ON public.resident_status_history
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS resident_status_history_manage ON public.resident_status_history;
CREATE POLICY resident_status_history_manage ON public.resident_status_history
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

CREATE OR REPLACE FUNCTION public.fn_resident_status_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := COALESCE(NEW.updated_by, NEW.created_by, auth.uid());

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.resident_status_history (
      organization_id,
      facility_id,
      resident_id,
      status,
      effective_from,
      created_by,
      updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      COALESCE(NEW.admission_date::timestamptz, now()),
      v_actor,
      v_actor
    )
    ON CONFLICT (resident_id) WHERE effective_to IS NULL AND deleted_at IS NULL DO NOTHING;

    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.resident_status_history
       SET effective_to = now(),
           updated_at = now(),
           updated_by = v_actor
     WHERE resident_id = NEW.id
       AND effective_to IS NULL
       AND deleted_at IS NULL;

    INSERT INTO public.resident_status_history (
      organization_id,
      facility_id,
      resident_id,
      status,
      effective_from,
      created_by,
      updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      now(),
      v_actor,
      v_actor
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_residents_status_history_capture ON public.residents;
CREATE TRIGGER tr_residents_status_history_capture
  AFTER INSERT OR UPDATE OF status ON public.residents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_resident_status_history_capture();

DROP TRIGGER IF EXISTS tr_resident_status_history_set_updated_at ON public.resident_status_history;
CREATE TRIGGER tr_resident_status_history_set_updated_at
  BEFORE UPDATE ON public.resident_status_history
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_resident_status_history_audit ON public.resident_status_history;
CREATE TRIGGER tr_resident_status_history_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_status_history
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

ALTER TABLE public.resident_payers
  ADD COLUMN IF NOT EXISTS medicaid_rate_unit text NOT NULL DEFAULT 'monthly'
    CHECK (medicaid_rate_unit IN ('monthly', 'daily', 'per_billable_day'));

CREATE TABLE IF NOT EXISTS public.facility_medicaid_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  provider_name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('LTC', 'MMA', 'OTHER')),
  default_rate_cents integer NOT NULL CHECK (default_rate_cents >= 0),
  rate_unit text NOT NULL DEFAULT 'monthly'
    CHECK (rate_unit IN ('monthly', 'daily', 'per_billable_day')),
  bed_hold_hospital_billing text NOT NULL DEFAULT 'full_rate'
    CHECK (bed_hold_hospital_billing IN ('full_rate', 'reduced_rate', 'no_pay', 'unknown')),
  bed_hold_hospital_reduced_rate_cents integer CHECK (bed_hold_hospital_reduced_rate_cents IS NULL OR bed_hold_hospital_reduced_rate_cents >= 0),
  bed_hold_max_days integer CHECK (bed_hold_max_days IS NULL OR bed_hold_max_days >= 0),
  contract_start_date date,
  contract_renewal_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (facility_id, provider_name, provider_type, active)
);

CREATE INDEX IF NOT EXISTS idx_facility_medicaid_providers_facility_active
  ON public.facility_medicaid_providers(facility_id, provider_name)
  WHERE deleted_at IS NULL AND active = true;

CREATE INDEX IF NOT EXISTS idx_facility_medicaid_providers_org
  ON public.facility_medicaid_providers(organization_id, provider_type)
  WHERE deleted_at IS NULL;

ALTER TABLE public.facility_medicaid_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_medicaid_providers_select ON public.facility_medicaid_providers;
CREATE POLICY facility_medicaid_providers_select ON public.facility_medicaid_providers
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_medicaid_providers_manage ON public.facility_medicaid_providers;
CREATE POLICY facility_medicaid_providers_manage ON public.facility_medicaid_providers
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP TRIGGER IF EXISTS tr_facility_medicaid_providers_set_updated_at ON public.facility_medicaid_providers;
CREATE TRIGGER tr_facility_medicaid_providers_set_updated_at
  BEFORE UPDATE ON public.facility_medicaid_providers
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_facility_medicaid_providers_audit ON public.facility_medicaid_providers;
CREATE TRIGGER tr_facility_medicaid_providers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_medicaid_providers
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

ALTER TABLE public.resident_payers
  ADD COLUMN IF NOT EXISTS facility_medicaid_provider_id uuid REFERENCES public.facility_medicaid_providers(id);

CREATE INDEX IF NOT EXISTS idx_resident_payers_facility_medicaid_provider
  ON public.resident_payers(facility_medicaid_provider_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.resident_status_history IS
  'Resident status timeline for census, billing, and inspector lookback reporting.';

COMMENT ON TABLE public.facility_medicaid_providers IS
  'Facility-level Medicaid provider and default rate catalog used by resident payers and admissions rate clearance.';

COMMENT ON COLUMN public.resident_payers.medicaid_rate_unit IS
  'Unit for resident_payers.medicaid_rate: monthly, daily, or per billable day.';
