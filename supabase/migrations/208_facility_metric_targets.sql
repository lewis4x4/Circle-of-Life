-- UI-V2 S2: per-facility metric targets for semantic dashboard callouts.

CREATE TABLE IF NOT EXISTS public.facility_metric_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  target_value numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('up', 'down')),
  warning_band_pct numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (facility_id, metric_key)
);

ALTER TABLE public.facility_metric_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_metric_targets_select ON public.facility_metric_targets
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY facility_metric_targets_insert ON public.facility_metric_targets
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY facility_metric_targets_update ON public.facility_metric_targets
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE INDEX IF NOT EXISTS facility_metric_targets_facility_metric_idx
  ON public.facility_metric_targets (facility_id, metric_key);

DROP TRIGGER IF EXISTS tr_facility_metric_targets_set_updated_at ON public.facility_metric_targets;
CREATE TRIGGER tr_facility_metric_targets_set_updated_at
  BEFORE UPDATE ON public.facility_metric_targets
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER facility_metric_targets_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_metric_targets
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

COMMENT ON TABLE public.facility_metric_targets IS
  'Per-facility thresholds driving UI-V2 red/amber/green callouts on dashboards and DataTable cells. UI-V2 S2.';
