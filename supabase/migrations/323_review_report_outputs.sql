-- Preserve immutable execution output and claim each scheduled occurrence once.
ALTER TABLE public.report_runs ADD COLUMN result_snapshot_json jsonb;
ALTER TABLE public.report_runs ADD COLUMN schedule_id uuid REFERENCES public.report_schedules(id);
ALTER TABLE public.report_runs ADD COLUMN scheduled_for timestamptz;
CREATE UNIQUE INDEX report_runs_schedule_occurrence ON public.report_runs(schedule_id,scheduled_for) WHERE schedule_id IS NOT NULL;

ALTER TABLE public.report_runs ALTER COLUMN generated_by_user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS report_runs_select ON public.report_runs;
CREATE POLICY report_runs_select ON public.report_runs FOR SELECT TO authenticated USING (
  organization_id=haven.organization_id() AND haven.app_role() IN ('owner','org_admin','facility_admin')
  AND (haven.app_role() IN ('owner','org_admin') OR
    (run_scope_json->>'facility_id')::uuid IN (SELECT haven.accessible_facility_ids()))
);
DROP POLICY IF EXISTS report_runs_insert ON public.report_runs;
CREATE POLICY report_runs_insert ON public.report_runs FOR INSERT TO authenticated WITH CHECK (
  organization_id=haven.organization_id() AND generated_by_user_id=auth.uid()
  AND haven.app_role() IN ('owner','org_admin','facility_admin') AND status='running'
  AND result_snapshot_json IS NULL AND schedule_id IS NULL
  AND (haven.app_role() IN ('owner','org_admin') OR
    (run_scope_json->>'facility_id')::uuid IN (SELECT haven.accessible_facility_ids()))
);
CREATE POLICY report_runs_finalize_own ON public.report_runs FOR UPDATE TO authenticated
  USING (organization_id=haven.organization_id() AND generated_by_user_id=auth.uid() AND status='running'
    AND haven.app_role() IN ('owner','org_admin','facility_admin'))
  WITH CHECK (organization_id=haven.organization_id() AND generated_by_user_id=auth.uid()
    AND status IN ('completed','failed'));
GRANT SELECT, INSERT, UPDATE ON public.report_runs TO authenticated;

CREATE OR REPLACE FUNCTION haven.guard_report_run_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.status IN ('completed','failed') AND
    ROW(NEW.status,NEW.result_snapshot_json,NEW.completed_at,NEW.run_scope_json,NEW.organization_id,NEW.generated_by_user_id,NEW.source_type,NEW.source_id)
      IS DISTINCT FROM ROW(OLD.status,OLD.result_snapshot_json,OLD.completed_at,OLD.run_scope_json,OLD.organization_id,OLD.generated_by_user_id,OLD.source_type,OLD.source_id) THEN
    RAISE EXCEPTION 'Finalized report receipts are immutable' USING ERRCODE='42501';
  END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF ROW(NEW.organization_id,NEW.generated_by_user_id,NEW.source_type,NEW.source_id,NEW.run_scope_json,NEW.schedule_id,NEW.scheduled_for)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.generated_by_user_id,OLD.source_type,OLD.source_id,OLD.run_scope_json,OLD.schedule_id,OLD.scheduled_for) THEN
      RAISE EXCEPTION 'Report identity and scope are immutable' USING ERRCODE='42501';
    END IF;
    IF NEW.status='completed' AND (NEW.result_snapshot_json IS NULL OR
      NEW.result_snapshot_json->>'facilityId' IS DISTINCT FROM NEW.run_scope_json->>'facility_id') THEN
      RAISE EXCEPTION 'Completed reports require output matching the execution scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_report_run_receipt BEFORE UPDATE ON public.report_runs FOR EACH ROW EXECUTE FUNCTION haven.guard_report_run_receipt();
