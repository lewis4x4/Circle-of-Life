-- UI-V2 S2: append-only audit trail for alert actions.

CREATE TABLE IF NOT EXISTS public.alert_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  alert_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ack', 'detail_open', 'escalate', 'dismiss', 'assign')),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  actor_role public.app_role NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY alert_audit_log_select ON public.alert_audit_log
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY alert_audit_log_insert ON public.alert_audit_log
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND actor_id = auth.uid()
  );

-- No UPDATE or DELETE policies. Audit rows are immutable per non-negotiable rule #2.

CREATE INDEX IF NOT EXISTS alert_audit_log_facility_created_idx
  ON public.alert_audit_log (facility_id, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_audit_log_actor_created_idx
  ON public.alert_audit_log (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_audit_log_alert_idx
  ON public.alert_audit_log (alert_id, created_at DESC);

-- alert_audit_log itself is an audit surface, so NO haven_capture_audit_log trigger
-- (would create infinite recursion / double-audit). Append-only via RLS insert policy.

COMMENT ON TABLE public.alert_audit_log IS
  'Append-only audit trail for UI-V2 PriorityAlertStack actions (ack/detail_open/escalate/dismiss/assign). UI-V2 S2.';
