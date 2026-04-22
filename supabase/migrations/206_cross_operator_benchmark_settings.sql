-- Migration 206: Cross-operator benchmark opt-in stub
-- Records whether an organization has requested access to future cross-operator
-- benchmark comparisons. This slice does not enable external peer data; it only
-- stores governance state and keeps the lane explicitly opt-in.

CREATE TABLE IF NOT EXISTS public.cross_operator_benchmark_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined')),
  requested_by uuid REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  terms_acknowledged_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cross_operator_benchmark_settings_org_active
  ON public.cross_operator_benchmark_settings (organization_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.cross_operator_benchmark_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_operator_benchmark_settings_org_admin_select ON public.cross_operator_benchmark_settings;
CREATE POLICY cross_operator_benchmark_settings_org_admin_select
  ON public.cross_operator_benchmark_settings
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS cross_operator_benchmark_settings_org_admin_write ON public.cross_operator_benchmark_settings;
CREATE POLICY cross_operator_benchmark_settings_org_admin_write
  ON public.cross_operator_benchmark_settings
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP TRIGGER IF EXISTS tr_cross_operator_benchmark_settings_set_updated_at ON public.cross_operator_benchmark_settings;
CREATE TRIGGER tr_cross_operator_benchmark_settings_set_updated_at
  BEFORE UPDATE ON public.cross_operator_benchmark_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_cross_operator_benchmark_settings_audit ON public.cross_operator_benchmark_settings;
CREATE TRIGGER tr_cross_operator_benchmark_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cross_operator_benchmark_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

COMMENT ON TABLE public.cross_operator_benchmark_settings IS
  'Stub governance record for future external benchmark participation. Disabled by default and does not imply peer data is available.';
