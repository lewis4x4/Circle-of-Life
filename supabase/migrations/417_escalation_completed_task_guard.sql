-- Smart Rounding: an escalation may not fire against a task that was completed
-- while the engine was walking its queue.
--
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md section 5.
-- Fixes the read-write gap in migration 415's
-- public.record_observation_escalation_rung.
--
-- The defect, demonstrated rather than theorized.
-- public.observation_escalations_due already excludes a completed task, but it
-- is a single read that returns up to five hundred rows and
-- supabase/functions/observation-escalation-engine fires them one round trip at
-- a time. Seconds to minutes separate the read from the call. The command then
-- read the task row and never re-checked its status, so a caregiver who
-- finished the check inside that gap had a full escalation written against
-- them: an observation_escalation_dispatches row, a
-- resident_observation_escalations row, queued
-- observation_escalation_deliveries, and at the terminal rung a critical
-- exec_alerts row. With real notification routes in place that is an SMS to an
-- administrator about a resident who was checked on time, which is exactly the
-- kind of alert that teaches a building to ignore the ladder.
--
-- The two task status UPDATEs at the end of the command were already guarded,
-- so the task row itself was never corrupted. Every other row it wrote was.
--
-- The fix is a re-select FOR UPDATE before any write, and a return of
-- fired false with reason task_completed when the status is terminal. The lock
-- is taken before the decision, so a completion already in flight blocks and
-- this command then reads its committed status instead of a stale one.
--
-- Migration 415 is not edited. This file replaces the function body in place;
-- nothing else in that migration changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_observation_escalation_rung (p_task_id uuid, p_rung_key text, p_at timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_task record;
  v_rung record;
  v_close timestamptz;
  v_shift text;
  v_dispatch_id uuid;
  v_escalation_id uuid := NULL;
  v_facility_name text;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_recipients integer := 0;
BEGIN
  -- The lock comes before the decision, not after it.
  --
  -- observation_escalations_due correctly excludes a completed task, but the
  -- engine walks up to five hundred due rows one round trip at a time, so
  -- seconds to minutes pass between that read and this call. A caregiver who
  -- finishes the check inside that gap used to get a full escalation written
  -- against them: a dispatch row, an escalation row, queued deliveries, and at
  -- the terminal rung a critical exec_alerts row that texts an administrator
  -- about a resident who was seen on time. The task status UPDATEs at the end
  -- of this function were already guarded, so the task row itself survived;
  -- everything else in the record did not.
  --
  -- FOR UPDATE makes the re-read authoritative. A completion that is already in
  -- flight blocks here and this statement then sees its committed status,
  -- rather than reading a stale row and deciding against it.
  SELECT
    t.id,
    t.organization_id,
    t.entity_id,
    t.facility_id,
    t.resident_id,
    t.assigned_staff_id,
    t.status INTO v_task
  FROM
    public.resident_observation_tasks t
  WHERE
    t.id = p_task_id
    AND t.deleted_at IS NULL
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'task_not_found');
  END IF;

  -- The idempotency answer comes before the completion answer, because it is
  -- the more specific truth: a rung that already fired did fire, whatever the
  -- task did afterwards, and the engine counts that answer. This is a read; the
  -- INSERT ... ON CONFLICT below is still the anchor that makes two concurrent
  -- ticks safe.
  IF EXISTS (
    SELECT
      1
    FROM
      public.observation_escalation_dispatches d
    WHERE
      d.task_id = p_task_id
      AND d.rung_key = p_rung_key) THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'already_fired', 'rung_key', p_rung_key);
  END IF;

  -- The terminal set is exactly the set observation_escalations_due excludes,
  -- so the due read and this guard cannot drift apart and disagree about what
  -- is still escalatable.
  --
  -- missed is deliberately in the set. Only the terminal rung writes it, no
  -- rung sorts above the terminal one, and a task that has already run the
  -- whole ladder is closed: a rung added below terminal afterwards must not
  -- reopen it.
  IF v_task.status IN ('completed_on_time', 'completed_late', 'excused', 'missed', 'reassigned') THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', CASE WHEN v_task.status::text = 'reassigned' THEN
        'task_reassigned'
      ELSE
        'task_completed'
      END, 'task_status', v_task.status::text);
  END IF;

  v_close := public.observation_task_window_close (p_task_id);
  IF v_close IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'no_window_close');
  END IF;

  SELECT
    sw.shift_key INTO v_shift
  FROM
    public.facility_shift_window_at (v_task.facility_id, v_close) sw;

  SELECT
    r.* INTO v_rung
  FROM
    public.observation_escalation_rungs_at (v_task.facility_id, v_close, v_shift) r
  WHERE
    r.rung_key = p_rung_key;

  IF v_rung.rung_key IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'rung_not_in_force');
  END IF;

  INSERT INTO public.observation_escalation_dispatches (organization_id, entity_id, facility_id, resident_id, task_id, escalation_version_id, escalation_rung_id, rung_key, is_terminal, shift_key, window_closes_at, fired_at, channels)
    VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.escalation_version_id, v_rung.rung_id, v_rung.rung_key, v_rung.is_terminal, v_shift, v_close, p_at, v_rung.channels)
  ON CONFLICT (task_id, rung_key)
    DO NOTHING
  RETURNING
    id INTO v_dispatch_id;

  IF v_dispatch_id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'already_fired', 'rung_key', p_rung_key);
  END IF;

  IF NOT v_rung.assigned_staff_only THEN
    INSERT INTO public.resident_observation_escalations (organization_id, entity_id, facility_id, resident_id, task_id, escalation_level, escalation_type, escalation_version_id, rung_key, triggered_at)
      VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.sort_order, 'auto_overdue', v_rung.escalation_version_id, v_rung.rung_key, p_at)
    RETURNING
      id INTO v_escalation_id;

    UPDATE
      public.observation_escalation_dispatches
    SET
      escalation_id = v_escalation_id
    WHERE
      id = v_dispatch_id;
  END IF;

  FOREACH v_channel IN ARRAY v_rung.channels LOOP
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, send_after)
    SELECT
      v_task.organization_id,
      v_task.facility_id,
      v_dispatch_id,
      rec.notification_route_id,
      v_rung.rung_key,
      rec.target_role,
      rec.target_user_id,
      rec.target_phone,
      v_channel,
      'queued',
      p_at
    FROM
      haven.observation_escalation_recipients (v_task.organization_id, v_task.facility_id, v_rung.rung_id, v_task.assigned_staff_id) rec;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;
    v_recipients := GREATEST(v_recipients, v_rows);
  END LOOP;

  -- A rung that resolved to nobody is recorded as a skipped delivery rather
  -- than as no delivery, so "nobody was told" is visible in the ledger instead
  -- of looking like a tick that never ran.
  IF v_queued = 0 THEN
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, skip_reason, send_after)
      VALUES (v_task.organization_id, v_task.facility_id, v_dispatch_id, NULL, v_rung.rung_key, 'unresolved', NULL, NULL, v_rung.channels[1], 'skipped', 'no_target', p_at);
  END IF;

  UPDATE
    public.observation_escalation_dispatches
  SET
    recipients_resolved = v_recipients
  WHERE
    id = v_dispatch_id;

  IF v_rung.is_terminal THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'missed',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status NOT IN ('completed_on_time', 'completed_late', 'excused', 'reassigned');
  ELSIF NOT v_rung.assigned_staff_only THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'critically_overdue',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status IN ('upcoming', 'due_soon', 'due_now', 'overdue');
  END IF;

  -- The terminal rung is the one an owner should see without opening the
  -- module. Earlier rungs stay inside the rounding surface.
  --
  -- source_module is 'compliance'. The retired engine wrote 'resident_assurance',
  -- which is not a value of exec_alert_source_module and never has been, so
  -- every exec alert it tried to raise failed. That was the second piece of
  -- drift in that function, alongside the two columns it wrote that do not
  -- exist.
  IF v_rung.is_terminal THEN
    SELECT
      f.name INTO v_facility_name
    FROM
      public.facilities f
    WHERE
      f.id = v_task.facility_id;

    INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
    SELECT
      v_task.organization_id,
      v_task.entity_id,
      v_task.facility_id,
      'compliance',
      'critical',
      format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility')),
      format('An observation window closed without a check and reached the last rung of the facility escalation policy. Open Smart Rounding for the resident and the window.')
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.exec_alerts existing
        WHERE
          existing.organization_id = v_task.organization_id
          AND existing.facility_id = v_task.facility_id
          AND existing.title = format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility'))
          AND existing.resolved_at IS NULL
          AND existing.deleted_at IS NULL);
  END IF;

  RETURN jsonb_build_object('fired', TRUE, 'rung_key', v_rung.rung_key, 'dispatch_id', v_dispatch_id, 'escalation_id', v_escalation_id, 'is_escalation', NOT v_rung.assigned_staff_only, 'channels', to_jsonb (v_rung.channels), 'shift_key', v_shift, 'deliveries_queued', v_queued, 'recipients', v_recipients);
END;
$func$;
COMMENT ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) IS
  'Fires one escalation rung against one task, once. Re-selects the task FOR UPDATE and refuses to fire anything at all when its status is terminal, because the engine walks a queue read seconds to minutes earlier and a caregiver who completed the check in that gap must not be escalated on. Writes the dispatch ledger row, the resident_observation_escalations row when the rung is a real escalation rather than a staff nudge, and one delivery row per recipient per channel. Returns fired false with a reason when the rung already fired, which is what makes a re-tick of the engine a no-op.';

REVOKE ALL ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) TO service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
