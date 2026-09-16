-- 07A "Something happened" capture: row-level security, audit and updated_at
-- triggers, and the reporter column guard for the four care event tables.
--
-- Spec: docs/specs/07A-something-happened-capture.md section 6.2 (401).
--
-- Role law:
--   capture roles  owner, org_admin, facility_admin, manager, admin_assistant,
--                  coordinator, nurse, caregiver, med_tech
--   admin roles    owner, org_admin, facility_admin, admin_assistant, manager
-- family, dietary, dietary_aide, housekeeper, maintenance_role and broker see
-- nothing here. Level words never reach the family portal (spec section 10).

BEGIN;

-- ---------------------------------------------------------------------------
-- care_events
-- ---------------------------------------------------------------------------
ALTER TABLE public.care_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Capture roles see care events in accessible facilities" ON public.care_events
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
  );

CREATE POLICY "Capture roles report care events they witnessed" ON public.care_events
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND reported_by = auth.uid()
    AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
  );

-- The reporter may touch the row for 24 hours. Which columns they may touch is
-- enforced by care_events_guard_reporter_update below (note only).
CREATE POLICY "Reporter updates own care event within 24 hours" ON public.care_events
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND reported_by = auth.uid()
    AND created_at > now() - interval '24 hours'
    AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND reported_by = auth.uid()
  );

CREATE POLICY "Admin roles update care events in accessible facilities" ON public.care_events
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  );

-- No DELETE policy. Soft delete only, and only through an admin update.

-- ---------------------------------------------------------------------------
-- Reporter column guard. A non-admin caller reaching the row through the
-- reporter policy may change note and updated_at and nothing else. Definer
-- functions (402) set haven.care_event_definer for the transaction and are
-- exempt because they carry their own role checks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_events_guard_reporter_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role text := haven.app_role()::text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF pg_catalog.current_setting('haven.care_event_definer', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF v_role IN ('owner','org_admin','facility_admin','admin_assistant','manager') THEN
    RETURN NEW;
  END IF;
  v_old := pg_catalog.to_jsonb(OLD) - 'note' - 'updated_at';
  v_new := pg_catalog.to_jsonb(NEW) - 'note' - 'updated_at';
  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'care_event: reporter may only change the note'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_events_guard_reporter_update() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_events_guard_reporter_update() IS
  'BEFORE UPDATE guard on care_events: non-admin roles may change note and updated_at only. Trigger function, not callable directly.';

CREATE TRIGGER care_events_guard_reporter_update
  BEFORE UPDATE ON public.care_events
  FOR EACH ROW EXECUTE FUNCTION public.care_events_guard_reporter_update();

CREATE TRIGGER tr_care_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.care_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE TRIGGER tr_care_events_set_updated_at
  BEFORE UPDATE ON public.care_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

-- ---------------------------------------------------------------------------
-- care_event_deliveries: read by admin roles, nurse, coordinator, and the
-- reporter of the parent event. No insert or update policy: written only by
-- definer functions and the dispatcher (service role).
-- ---------------------------------------------------------------------------
ALTER TABLE public.care_event_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins nurse coordinator and reporter see deliveries" ON public.care_event_deliveries
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse','coordinator')
      OR EXISTS (
        SELECT 1 FROM public.care_events ce
        WHERE ce.id = care_event_deliveries.care_event_id
          AND ce.reported_by = auth.uid()
      )
    )
  );

CREATE TRIGGER tr_care_event_deliveries_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.care_event_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- incident_followup_protocols and care_event_escalation_policies:
-- configuration. Every staff capture role may read; admin roles may write.
-- Organization defaults (facility_id NULL) are visible to everyone in the org.
-- ---------------------------------------------------------------------------
ALTER TABLE public.incident_followup_protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see incident followup protocols" ON public.incident_followup_protocols
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
  );

CREATE POLICY "Admin roles create incident followup protocols" ON public.incident_followup_protocols
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  );

CREATE POLICY "Admin roles update incident followup protocols" ON public.incident_followup_protocols
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  );

ALTER TABLE public.care_event_escalation_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see care event escalation policies" ON public.care_event_escalation_policies
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
  );

CREATE POLICY "Admin roles create care event escalation policies" ON public.care_event_escalation_policies
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  );

CREATE POLICY "Admin roles update care event escalation policies" ON public.care_event_escalation_policies
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager')
  );

-- ---------------------------------------------------------------------------
-- Grants. Hosted Supabase grants request roles through default privileges;
-- the replay stub does not, so state them. RLS above is the real boundary.
-- Deliveries are read-only for signed-in users by design.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.care_events TO authenticated;
GRANT SELECT ON public.care_event_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.incident_followup_protocols TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.care_event_escalation_policies TO authenticated;

GRANT ALL ON public.care_events TO service_role;
GRANT ALL ON public.care_event_deliveries TO service_role;
GRANT ALL ON public.incident_followup_protocols TO service_role;
GRANT ALL ON public.care_event_escalation_policies TO service_role;

REVOKE ALL ON public.care_events FROM anon;
REVOKE ALL ON public.care_event_deliveries FROM anon;
REVOKE ALL ON public.incident_followup_protocols FROM anon;
REVOKE ALL ON public.care_event_escalation_policies FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
