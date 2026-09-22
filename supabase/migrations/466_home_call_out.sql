-- COL-596 (Home W4): phone-first staff call-out from Home. Shipped dark:
-- released per facility as call_out through home_set_module_release (464).
--
-- A call-out does three things in one transaction:
--   1. marks the scheduled shift_assignments row called_out (or no_show),
--   2. writes a staff_attendance_events row (callout / no_show) linked to that
--      shift -- which is exactly what Stand Up's "callouts last week" counts
--      (src/lib/executive/standup.ts), so the figure moves without re-entry,
--   3. leaves the shift uncovered until someone covers it.
-- "Uncovered" had no representation (shift_assignments.staff_id is NOT NULL,
-- so there are no open-shift rows). shift_assignments.covers_assignment_id now
-- links a replacement to the shift it covers; a called-out/no-show shift with
-- no live replacement is uncovered.
--
-- New hires, terminations and everything else stay on the Staffing Roster.
-- The ADP catch-up rule (Jessica + payroll) gates release, not this build.
-- Rolls forward only.

BEGIN;

ALTER TABLE public.shift_assignments
  ADD COLUMN IF NOT EXISTS covers_assignment_id uuid REFERENCES public.shift_assignments(id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_covers ON public.shift_assignments (covers_assignment_id)
  WHERE covers_assignment_id IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN public.shift_assignments.covers_assignment_id IS
  'COL-596: the called-out or no-show shift this assignment covers. A called-out shift with no live covering row is uncovered.';

-- Today's shifts for the building, and which are uncovered. Operators read it
-- through this function because a manager cannot read other people's shifts.
CREATE OR REPLACE FUNCTION public.home_shifts_today(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_local date;
BEGIN
  a := haven.home_operator_for(p_facility_id, 'call_out');
  SELECT (p_as_of AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date INTO v_local
    FROM public.facilities f WHERE f.id = p_facility_id;
  RETURN jsonb_build_object(
    'localDate', v_local,
    'shifts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'assignmentId', sa.id, 'staffId', sa.staff_id,
          'staffName', s.last_name || ', ' || COALESCE(nullif(s.preferred_name, ''), s.first_name),
          'shiftType', sa.shift_type, 'status', sa.status,
          'customStart', sa.custom_start_time, 'customEnd', sa.custom_end_time,
          'coversAssignmentId', sa.covers_assignment_id,
          'uncovered', sa.status IN ('called_out', 'no_show') AND NOT EXISTS (
            SELECT 1 FROM public.shift_assignments c WHERE c.covers_assignment_id = sa.id
              AND c.deleted_at IS NULL AND c.status NOT IN ('called_out', 'no_show')))
        ORDER BY sa.shift_type, s.last_name)
      FROM public.shift_assignments sa JOIN public.staff s ON s.id = sa.staff_id
      WHERE sa.facility_id = p_facility_id AND sa.shift_date = v_local AND sa.deleted_at IS NULL), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('staffId', s.id,
          'staffName', s.last_name || ', ' || COALESCE(nullif(s.preferred_name, ''), s.first_name)) ORDER BY s.last_name, s.first_name)
      FROM public.staff s
      WHERE s.facility_id = p_facility_id AND s.deleted_at IS NULL AND s.employment_status::text = 'active'
        AND COALESCE(s.excluded_from_care, false) = false), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.home_shifts_today(uuid, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_shifts_today(uuid, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.home_shifts_today(uuid, timestamptz) IS
  'COL-37 ruling: definer required — shift_assignments RLS does not let a manager read other people''s shifts; the function asserts a Home operator for the facility with call_out released and returns only today''s shifts (names, type, status, uncovered) and the active roster names for that facility (COL-596).';

CREATE OR REPLACE FUNCTION public.home_record_callout(
  p_event_id uuid, p_assignment_id uuid, p_reason text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  v_shift public.shift_assignments;
  v_prior public.staff_attendance_events;
  v_status public.shift_assignment_status;
  v_event public.staff_attendance_event_type;
BEGIN
  IF p_reason NOT IN ('sick', 'family', 'no_show', 'other') THEN
    RAISE EXCEPTION 'Reason must be sick, family, no-show or other' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shift FROM public.shift_assignments WHERE id = p_assignment_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_shift.facility_id, 'call_out');

  SELECT * INTO v_prior FROM public.staff_attendance_events WHERE id = p_event_id;
  IF FOUND THEN
    IF v_prior.shift_assignment_id IS DISTINCT FROM p_assignment_id THEN
      RAISE EXCEPTION 'Call-out identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('eventId', v_prior.id, 'assignmentId', p_assignment_id, 'status', v_shift.status, 'replayed', true);
  END IF;
  IF v_shift.status NOT IN ('assigned', 'confirmed', 'swap_requested') THEN
    RAISE EXCEPTION 'This shift is already %', replace(v_shift.status::text, '_', ' ') USING ERRCODE = '22023';
  END IF;

  v_status := CASE WHEN p_reason = 'no_show' THEN 'no_show' ELSE 'called_out' END;
  v_event := CASE WHEN p_reason = 'no_show' THEN 'no_show' ELSE 'callout' END;
  UPDATE public.shift_assignments
     SET status = v_status, updated_at = now(), updated_by = a.actor_user_id
   WHERE id = v_shift.id;
  INSERT INTO public.staff_attendance_events (id, staff_id, facility_id, organization_id, event_type, occurred_at,
                                              shift_assignment_id, reason, notes, created_by, updated_by)
  VALUES (p_event_id, v_shift.staff_id, v_shift.facility_id, v_shift.organization_id, v_event, now(),
          v_shift.id, p_reason, nullif(btrim(coalesce(p_note, '')), ''), a.actor_user_id, a.actor_user_id);
  RETURN jsonb_build_object('eventId', p_event_id, 'assignmentId', v_shift.id, 'status', v_status, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_record_callout(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_record_callout(uuid, uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.home_record_callout(uuid, uuid, text, text) IS
  'COL-37 ruling: definer required — managers cannot write shift_assignments and attendance inserts are policy-gated; the function asserts a Home operator for the shift''s facility with call_out released, changes only that shift''s status and appends one attributable attendance event linked to it (pending review, counted by Stand Up). A repeated event id replays (COL-596).';

CREATE OR REPLACE FUNCTION public.home_cover_shift(p_id uuid, p_called_out_assignment_id uuid, p_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_gap public.shift_assignments; v_row public.shift_assignments; v_prior public.shift_assignments;
BEGIN
  SELECT * INTO v_gap FROM public.shift_assignments WHERE id = p_called_out_assignment_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_gap.facility_id, 'call_out');
  SELECT * INTO v_prior FROM public.shift_assignments WHERE id = p_id;
  IF FOUND THEN
    IF v_prior.covers_assignment_id IS DISTINCT FROM p_called_out_assignment_id OR v_prior.staff_id <> p_staff_id THEN
      RAISE EXCEPTION 'Cover identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('assignmentId', v_prior.id, 'replayed', true);
  END IF;
  IF v_gap.status NOT IN ('called_out', 'no_show') THEN
    RAISE EXCEPTION 'Only a called-out or no-show shift is covered here' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments c WHERE c.covers_assignment_id = v_gap.id
             AND c.deleted_at IS NULL AND c.status NOT IN ('called_out', 'no_show')) THEN
    RAISE EXCEPTION 'This shift is already covered' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_staff_id AND s.facility_id = v_gap.facility_id
                 AND s.deleted_at IS NULL AND s.employment_status::text = 'active') OR p_staff_id = v_gap.staff_id THEN
    RAISE EXCEPTION 'Pick someone else who works in this building' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.staff_id = p_staff_id AND x.shift_date = v_gap.shift_date
             AND x.shift_type = v_gap.shift_type AND x.deleted_at IS NULL AND x.status NOT IN ('called_out', 'no_show')) THEN
    RAISE EXCEPTION 'That person is already on this shift' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type,
                                        custom_start_time, custom_end_time, unit_id, status, notes, covers_assignment_id,
                                        created_by, updated_by)
  VALUES (p_id, v_gap.schedule_id, p_staff_id, v_gap.facility_id, v_gap.organization_id, v_gap.shift_date, v_gap.shift_type,
          v_gap.custom_start_time, v_gap.custom_end_time, v_gap.unit_id, 'assigned', 'Covering a call-out (Home)',
          v_gap.id, a.actor_user_id, a.actor_user_id)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('assignmentId', v_row.id, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_cover_shift(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_cover_shift(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.home_cover_shift(uuid, uuid, uuid) IS
  'COL-37 ruling: definer required — managers cannot write shift_assignments; the function asserts a Home operator for the facility with call_out released and inserts one covering assignment for an active staff member of that building, linked to the called-out shift, refusing a double cover or a double-booking. The eligibility trigger (059) still applies. A repeated id replays (COL-596).';

COMMIT;

NOTIFY pgrst, 'reload schema';
