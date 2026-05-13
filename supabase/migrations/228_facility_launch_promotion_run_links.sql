-- Facility Launch promotion row-level link ledger.
-- Item 1 creates the durable table only; no links are written until concrete promoters land.

CREATE TABLE IF NOT EXISTS public.facility_launch_promotion_run_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_item_id uuid NOT NULL REFERENCES public.facility_launch_promotion_run_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  target_table text NOT NULL,
  target_row_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'noop')),
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_run_links_run_item
  ON public.facility_launch_promotion_run_links (run_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_run_links_target
  ON public.facility_launch_promotion_run_links (target_table, target_row_id);

CREATE INDEX IF NOT EXISTS idx_facility_launch_promotion_run_links_org_facility
  ON public.facility_launch_promotion_run_links (organization_id, facility_id);

ALTER TABLE public.facility_launch_promotion_run_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_launch_promotion_run_links_org_read ON public.facility_launch_promotion_run_links;
CREATE POLICY facility_launch_promotion_run_links_org_read ON public.facility_launch_promotion_run_links
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_run_links_admin_write_insert ON public.facility_launch_promotion_run_links;
CREATE POLICY facility_launch_promotion_run_links_admin_write_insert ON public.facility_launch_promotion_run_links
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS facility_launch_promotion_run_links_admin_write_update ON public.facility_launch_promotion_run_links;
CREATE POLICY facility_launch_promotion_run_links_admin_write_update ON public.facility_launch_promotion_run_links
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

DROP TRIGGER IF EXISTS tr_facility_launch_promotion_run_links_audit ON public.facility_launch_promotion_run_links;
CREATE TRIGGER tr_facility_launch_promotion_run_links_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_launch_promotion_run_links
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE public.facility_launch_promotion_run_links IS 'Row-level Facility Launch promotion link ledger from module values to target rows.';
