-- Use the existing roster authority for order tasks as for cadence tasks.
BEGIN;
CREATE OR REPLACE FUNCTION public.generate_monitoring_order_tasks (p_facility_id uuid DEFAULT NULL, p_through timestamptz DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_order record;
  v_task record;
  v_shift record;
  v_assignee record;
  v_timezone text;
  v_horizon timestamptz;
  v_grace integer;
  v_rows integer;
  v_inserted integer := 0;
BEGIN
  FOR v_order IN
  SELECT
    o.id,
    o.organization_id,
    o.entity_id,
    o.facility_id,
    o.resident_id,
    o.interval_minutes,
    o.starts_at,
    o.ends_at
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.status = 'active'
    AND o.deleted_at IS NULL
    AND (p_facility_id IS NULL OR o.facility_id = p_facility_id)
    -- The resident is still in the building this order belongs to, and still in
    -- a status the module generates for.
    AND EXISTS (
      SELECT
        1
      FROM
        public.residents r
      WHERE
        r.id = o.resident_id
        AND r.deleted_at IS NULL
        AND r.facility_id = o.facility_id
        AND r.status = 'active')
  ORDER BY
    o.facility_id,
    o.starts_at LOOP
      SELECT
        COALESCE(f.timezone, 'America/New_York') INTO v_timezone
      FROM
        public.facilities f
      WHERE
        f.id = v_order.facility_id;

      IF p_through IS NOT NULL THEN
        v_horizon := p_through;
      ELSE
        SELECT
          nxt.ends_at_utc INTO v_horizon
        FROM
          public.facility_next_shift_window (v_order.facility_id, now()) nxt;
      END IF;

      -- A facility with no shift definitions yet generates nothing rather than
      -- guessing a horizon of its own.
      IF v_horizon IS NULL THEN
        CONTINUE;
      END IF;

      -- Safety stop. Nothing should ask for more than a week of order tasks in
      -- one call, and a 15 minute order over an open ended horizon would try to
      -- write forever.
      v_horizon := LEAST(v_horizon, now() + interval '7 days');
      IF v_order.ends_at IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_order.ends_at);
      END IF;
      IF v_horizon < v_order.starts_at THEN
        CONTINUE;
      END IF;

      v_grace := public.monitoring_order_grace_minutes (v_order.facility_id, v_order.interval_minutes);

      INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, monitoring_order_id, service_date, scheduled_for, due_at, grace_ends_at, status)
      SELECT
        v_order.organization_id,
        v_order.entity_id,
        v_order.facility_id,
        v_order.resident_id,
        v_order.id,
        ((occurrence AT TIME ZONE v_timezone)::date),
        occurrence,
        occurrence,
        occurrence + make_interval(mins => v_grace),
        'upcoming'::public.resident_observation_task_status
      FROM
        generate_series(v_order.starts_at, v_horizon, make_interval(mins => v_order.interval_minutes)) AS occurrence
      WHERE
        -- Never backfill a check nobody could have done. An order entered at
        -- 21:00 with a start time of 21:00 produces its first task at 21:00, not
        -- a row for every interval since the paperwork was signed.
        occurrence + make_interval(mins => v_grace) >= now()
      ON CONFLICT (monitoring_order_id, due_at)
        WHERE deleted_at IS NULL AND monitoring_order_id IS NOT NULL
        DO NOTHING;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_inserted := v_inserted + v_rows;
      -- Repair only unowned, live order tasks. Completed/missed evidence and
      -- an existing operator assignment are never redistributed on a tick.
      FOR v_task IN SELECT t.* FROM public.resident_observation_tasks t
       WHERE t.monitoring_order_id=v_order.id AND t.deleted_at IS NULL AND t.assigned_staff_id IS NULL
        AND t.status IN('upcoming','due_soon','due_now','overdue','critically_overdue','reassigned','escalated') AND t.due_at<=v_horizon
        AND NOT EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=t.id AND a.released_at IS NULL)
       ORDER BY t.due_at,t.id FOR UPDATE LOOP
       SELECT * INTO v_shift FROM public.facility_shift_window_at(v_task.facility_id,v_task.due_at);
       IF v_shift.shift_key IS NULL THEN CONTINUE; END IF;
       SELECT * INTO v_assignee FROM public.resolve_observation_task_assignees(v_task.facility_id,v_shift.shift_service_date,v_shift.roster_shift_type::text,ARRAY[v_task.resident_id]);
       IF v_assignee.staff_id IS NULL THEN
        PERFORM public.record_observation_staffing_gap(v_task.facility_id,v_shift.shift_key,v_shift.shift_service_date);
        CONTINUE;
       END IF;
       UPDATE public.resident_observation_tasks SET assigned_staff_id=v_assignee.staff_id,shift_assignment_id=v_assignee.shift_assignment_id
        WHERE id=v_task.id;
       INSERT INTO public.resident_observation_assignments(organization_id,entity_id,facility_id,resident_id,task_id,shift_assignment_id,staff_id,assignment_type)
        VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_task.id,v_assignee.shift_assignment_id,v_assignee.staff_id,'primary')
        ON CONFLICT(task_id,staff_id) WHERE released_at IS NULL DO NOTHING;
      END LOOP;
    END LOOP;

  RETURN v_inserted;
END;
$func$;
REVOKE ALL ON FUNCTION public.generate_monitoring_order_tasks(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monitoring_order_tasks(uuid,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_observation_task(p_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE t public.resident_observation_tasks%ROWTYPE; actor jsonb; aid uuid:=auth.uid(); sid uuid; claim_version integer; role_name text; assignment uuid; observer_staff_id uuid;
BEGIN
 SELECT * INTO t FROM public.resident_observation_tasks WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Observation task not found' USING ERRCODE='P0002'; END IF;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 SELECT p.app_role::text INTO role_name FROM public.user_profiles p WHERE p.id=aid;
 claim_version:=nullif(auth.jwt()->>'auth_claim_version','')::integer;
 IF aid IS NULL OR sid IS NULL OR role_name NOT IN('caregiver','med_tech','nurse','manager','coordinator','admin_assistant','facility_admin','org_admin','owner') THEN
  RAISE EXCEPTION 'An authorized observer is required to take this check' USING ERRCODE='42501'; END IF;
 actor:=haven.assert_rounding_service_actor(aid,role_name,sid,claim_version,t.organization_id,t.facility_id,false,true);
 observer_staff_id:=(actor->>'staff_id')::uuid;
 IF t.status NOT IN('upcoming','due_soon','due_now','overdue','critically_overdue','reassigned','escalated') THEN
  RAISE EXCEPTION 'This check is no longer available to take' USING ERRCODE='22023'; END IF;
 INSERT INTO public.resident_observation_assignments(organization_id,entity_id,facility_id,resident_id,task_id,staff_id,assignment_type,reason,created_by)
 VALUES(t.organization_id,t.entity_id,t.facility_id,t.resident_id,t.id,observer_staff_id,'rescue','Observer explicitly took responsibility for this check',aid)
 ON CONFLICT(task_id,staff_id) WHERE released_at IS NULL DO NOTHING RETURNING id INTO assignment;
 IF assignment IS NULL THEN SELECT a.id INTO assignment FROM public.resident_observation_assignments a WHERE a.task_id=t.id AND a.staff_id=observer_staff_id AND a.released_at IS NULL; END IF;
 RETURN jsonb_build_object('task_id',t.id,'staff_id',observer_staff_id,'assignment_id',assignment,'claimed',true);
END $$;
REVOKE ALL ON FUNCTION public.claim_observation_task(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_observation_task(uuid) TO authenticated;
COMMENT ON FUNCTION public.claim_observation_task(uuid) IS 'COL-37 ruling: definer required to append an audited rescue assignment without direct assignment mutation grants. Uses authenticated session identity, JWT claim version and assert_rounding_service_actor to recheck current active profile, organization, facility grant and staff employment. Task is locked, terminal tasks refused and primary assignment preserved; no completion permission is widened.';
COMMIT;

-- Operational rollback / containment (execute only for a verified incident):
-- BEGIN;
-- REVOKE EXECUTE ON FUNCTION public.claim_observation_task(uuid) FROM authenticated;
-- COMMIT;
-- Preserve all new history and assignments. Restore service with a reviewed
-- forward correction and the matching GRANT EXECUTE, not DROP or data deletion.
-- The release handoff records pre-change definitions and the recovery marker.
