-- Facility Launch promotion per-module item ledger.
-- Item 1 records module-level shell results only; module promoters populate real table counts later.

CREATE TABLE IF NOT EXISTS public.facility_launch_promotion_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.facility_launch_promotion_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  module_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('promoted', 'skipped', 'partial', 'failed', 'not_implemented')),
  summary text,
  tables_touched jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  prerequisites_unmet text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_run_items_run
  ON public.facility_launch_promotion_run_items (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_run_items_org_facility_module
  ON public.facility_launch_promotion_run_items (organization_id, facility_id, module_code);

ALTER TABLE public.facility_launch_promotion_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_launch_promotion_run_items_org_read ON public.facility_launch_promotion_run_items;
CREATE POLICY facility_launch_promotion_run_items_org_read ON public.facility_launch_promotion_run_items
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_run_items_admin_write_insert ON public.facility_launch_promotion_run_items;
CREATE POLICY facility_launch_promotion_run_items_admin_write_insert ON public.facility_launch_promotion_run_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_run_items_admin_write_update ON public.facility_launch_promotion_run_items;
CREATE POLICY facility_launch_promotion_run_items_admin_write_update ON public.facility_launch_promotion_run_items
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

DROP TRIGGER IF EXISTS tr_facility_launch_promotion_run_items_audit ON public.facility_launch_promotion_run_items;
CREATE TRIGGER tr_facility_launch_promotion_run_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_launch_promotion_run_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE public.facility_launch_promotion_run_items IS 'Per-module Facility Launch promotion shell results. Operational item detail is added by later promoters.';
