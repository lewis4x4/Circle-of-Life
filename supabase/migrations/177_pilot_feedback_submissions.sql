-- Pilot feedback capture for COL testing
-- Structured in-product feedback tied to route, role, and optional facility.

CREATE TABLE IF NOT EXISTS public.pilot_feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  user_email text,
  app_role text NOT NULL,
  shell_kind text NOT NULL,
  route text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  triaged_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.pilot_feedback_submissions
  DROP CONSTRAINT IF EXISTS pilot_feedback_submissions_category_check,
  DROP CONSTRAINT IF EXISTS pilot_feedback_submissions_severity_check,
  DROP CONSTRAINT IF EXISTS pilot_feedback_submissions_status_check;

ALTER TABLE public.pilot_feedback_submissions
  ADD CONSTRAINT pilot_feedback_submissions_category_check
    CHECK (category IN ('bug', 'confusion', 'request', 'friction', 'praise')),
  ADD CONSTRAINT pilot_feedback_submissions_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ADD CONSTRAINT pilot_feedback_submissions_status_check
    CHECK (status IN ('new', 'triaged', 'planned', 'done', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_pilot_feedback_org_created
  ON public.pilot_feedback_submissions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_feedback_org_status
  ON public.pilot_feedback_submissions (organization_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_pilot_feedback_facility
  ON public.pilot_feedback_submissions (facility_id, created_at DESC)
  WHERE facility_id IS NOT NULL;

ALTER TABLE public.pilot_feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_feedback_submit_own_org ON public.pilot_feedback_submissions;
CREATE POLICY pilot_feedback_submit_own_org ON public.pilot_feedback_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id::text = haven.organization_id()::text
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS pilot_feedback_read_own_org ON public.pilot_feedback_submissions;
CREATE POLICY pilot_feedback_read_own_org ON public.pilot_feedback_submissions
  FOR SELECT
  TO authenticated
  USING (
    organization_id::text = haven.organization_id()::text
    AND (
      user_id = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
    )
  );

DROP POLICY IF EXISTS pilot_feedback_update_admin ON public.pilot_feedback_submissions;
CREATE POLICY pilot_feedback_update_admin ON public.pilot_feedback_submissions
  FOR UPDATE
  TO authenticated
  USING (
    organization_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  )
  WITH CHECK (
    organization_id::text = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP TRIGGER IF EXISTS trg_pilot_feedback_submissions_audit
  ON public.pilot_feedback_submissions;

CREATE TRIGGER trg_pilot_feedback_submissions_audit
  AFTER INSERT OR UPDATE OR DELETE
  ON public.pilot_feedback_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log();

COMMENT ON TABLE public.pilot_feedback_submissions IS 'Structured pilot-testing feedback tied to role, route, and optional facility scope.';
