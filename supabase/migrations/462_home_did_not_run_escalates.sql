-- COL-602: a generator "Did not run" reaches the Facility Executive the same day.
--
-- Before this, Home's "Did not run" completed the check with a required note and
-- nothing else. The row was cleared, so the 5 PM home_escalate_uncleared sweep
-- never saw it: a generator failure was recorded but did not flow up (COL-568
-- says a generator failure routes to the Facility Executive).
--
--   * home_record_did_not_run: in one transaction, writes a level-1 escalation
--     (reason did_not_run) on the open row and then completes it through the
--     existing complete_operation_task_review, so the actor, the audit row and
--     the dual-sign rules are exactly the ones the completion route already uses.
--     If the completion refuses, the escalation rolls back with it.
--   * home_escalations_for_executive: also returns rows escalated as did_not_run
--     after they are completed, with the reason and the operator's note, and
--     links each row to its own task (COL-604's `instance` parameter).
--
-- The sweep only touches open rows at level 0, so it never escalates these a
-- second time. No new tables. Rolls forward only; re-runnable.

BEGIN;

CREATE OR REPLACE FUNCTION public.home_record_did_not_run(p_task_id uuid, p_notes text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_row public.operation_task_instances;
  v_exec uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Operation unavailable' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A note is required when the check did not pass' USING ERRCODE = '22023';
  END IF;
  IF NOT public.haven_operation_task_access(p_task_id) THEN
    RAISE EXCEPTION 'Task unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.operation_task_instances
  WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task unavailable' USING ERRCODE = '42501';
  END IF;

  -- Escalate while the row is still open; the row guard locks the caller's
  -- authority on this update exactly as it does for a claim. A row that was
  -- already recorded as did-not-run is not escalated twice.
  IF v_row.status IN ('pending', 'in_progress', 'missed', 'deferred')
     AND NOT COALESCE(v_row.escalation_history, '[]'::jsonb) @> '[{"reason":"did_not_run"}]'::jsonb THEN
    SELECT fe.user_id INTO v_exec FROM public.facility_executives fe WHERE fe.facility_id = v_row.facility_id;
    UPDATE public.operation_task_instances
    SET current_escalation_level = GREATEST(COALESCE(current_escalation_level, 0), 1),
        escalation_triggered_at = v_at,
        escalation_history = COALESCE(escalation_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'level', 1, 'to', v_exec, 'at', v_at, 'reason', 'did_not_run', 'by', v_uid)),
        updated_at = v_at
    WHERE id = v_row.id;
  END IF;

  RETURN public.complete_operation_task_review(p_task_id, v_uid, v_role, p_notes, '{}'::text[]);
END $$;

REVOKE ALL ON FUNCTION public.home_record_did_not_run(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_record_did_not_run(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.home_record_did_not_run(uuid, text) IS
  'COL-37 ruling: definer required — browser DML on operation_task_instances is revoked (348); the function re-checks the caller through haven_operation_task_access, writes only the escalation columns on one open row, and then completes it through complete_operation_task_review, which re-validates the actor, writes the audit row and keeps the dual-sign rules; the row guards still lock the caller''s authority (COL-602).';

-- ---------------------------------------------------------------------------
-- What the Facility Executive reads: uncleared rows and did-not-run checks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_escalations_for_executive()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'instanceId', i.id,
      'facilityId', i.facility_id,
      'facilityName', f.name,
      'title', i.template_name,
      'assignedShiftDate', i.assigned_shift_date,
      'status', i.status,
      'escalatedAt', i.escalation_triggered_at,
      'reason', CASE WHEN dnr.did_not_run THEN 'did_not_run' ELSE 'uncleared_end_of_day' END,
      'note', CASE WHEN dnr.did_not_run THEN i.completion_notes END,
      'owner', CASE WHEN i.assigned_to IS NULL THEN jsonb_build_object('kind', 'queue')
               ELSE jsonb_build_object('kind', 'user', 'userId', i.assigned_to, 'displayName', p.full_name) END,
      'href', '/admin/operations/work?facility_id=' || i.facility_id::text || '&instance=' || i.id::text
    ) ORDER BY i.escalation_triggered_at DESC NULLS LAST, i.assigned_shift_date DESC), '[]'::jsonb)
  FROM public.operation_task_instances i
  CROSS JOIN LATERAL (
    SELECT COALESCE(i.escalation_history, '[]'::jsonb) @> '[{"reason":"did_not_run"}]'::jsonb AS did_not_run
  ) dnr
  JOIN public.facility_executives fe ON fe.facility_id = i.facility_id AND fe.user_id = auth.uid()
  JOIN public.facilities f ON f.id = i.facility_id
  LEFT JOIN public.user_profiles p ON p.id = i.assigned_to
  WHERE i.deleted_at IS NULL
    AND COALESCE(i.current_escalation_level, 0) >= 1
    AND (i.status IN ('pending', 'in_progress') OR (dnr.did_not_run AND i.status <> 'cancelled'))
    AND i.assigned_shift_date >= current_date - 14
$$;

REVOKE ALL ON FUNCTION public.home_escalations_for_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_escalations_for_executive() TO authenticated;

COMMENT ON FUNCTION public.home_escalations_for_executive() IS
  'Facility Executive panel (COL-593 §5.4, COL-602): open operator-queue rows escalated at end of day, plus checks recorded as did-not-run (shown for 14 days after their shift date even though completed). Answers only for facilities where the caller is the named executive.';

COMMIT;

NOTIFY pgrst, 'reload schema';
