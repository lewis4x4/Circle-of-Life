-- Facility Launch promotion run ledger.
-- Dry runs are intentionally not persisted by the Item 1 Edge Function.

CREATE TABLE IF NOT EXISTS public.facility_launch_promotion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  modules_requested text[] NOT NULL DEFAULT '{}'::text[],
  summary text,
  triggered_by uuid REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_runs_org_facility_created
  ON public.facility_launch_promotion_runs (organization_id, facility_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_runs_status
  ON public.facility_launch_promotion_runs (organization_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.facility_launch_promotion_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_launch_promotion_runs_org_read ON public.facility_launch_promotion_runs;
CREATE POLICY facility_launch_promotion_runs_org_read ON public.facility_launch_promotion_runs
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_runs_admin_write_insert ON public.facility_launch_promotion_runs;
CREATE POLICY facility_launch_promotion_runs_admin_write_insert ON public.facility_launch_promotion_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_runs_admin_write_update ON public.facility_launch_promotion_runs;
CREATE POLICY facility_launch_promotion_runs_admin_write_update ON public.facility_launch_promotion_runs
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP TRIGGER IF EXISTS tr_facility_launch_promotion_runs_set_updated_at ON public.facility_launch_promotion_runs;
CREATE TRIGGER tr_facility_launch_promotion_runs_set_updated_at
  BEFORE UPDATE ON public.facility_launch_promotion_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_facility_launch_promotion_runs_audit ON public.facility_launch_promotion_runs;
CREATE TRIGGER tr_facility_launch_promotion_runs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_launch_promotion_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE public.facility_launch_promotion_runs IS 'Facility Launch promotion run ledger for Push to Haven attempts.';
