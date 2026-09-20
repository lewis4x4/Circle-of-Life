-- Complete the clinical capture boundary and immutable configuration workflow.
-- Current materialized policy remains available to existing workers; snapshots
-- are the authority for forward configuration and its historical meaning.
BEGIN;

CREATE OR REPLACE FUNCTION haven.require_observation_capture(p_task_id uuid,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE t public.resident_observation_tasks%ROWTYPE; g record; code text; n integer:=0;
BEGIN
 SELECT * INTO t FROM public.resident_observation_tasks WHERE id=p_task_id;
 IF t.cadence_version_id IS NULL AND t.monitoring_order_id IS NULL THEN RETURN; END IF;
 -- Receipt replay never inserts a log, so pre-upgrade immutable receipts remain replayable.
 IF NULLIF(btrim(p_payload->>'resident_location'),'') IS NULL OR NULLIF(btrim(p_payload->>'resident_state'),'') IS NULL THEN
  RAISE EXCEPTION 'Where the resident was and how they presented are required on every check' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof((p_payload->'chip_selections')) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Chip selections must arrive as a group to code map' USING ERRCODE='22023';
 END IF;
 FOR g IN SELECT * FROM jsonb_each((p_payload->'chip_selections')) LOOP
  IF g.key NOT IN ('meal_intake','mood_state','med_response') OR jsonb_typeof(g.value)<>'array' THEN
   RAISE EXCEPTION 'Select valid meal, mood or medication chips' USING ERRCODE='22023';
  END IF;
  FOR code IN SELECT jsonb_array_elements_text(g.value) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.observation_vocab v WHERE v.organization_id=t.organization_id
    AND (v.facility_id IS NULL OR v.facility_id=t.facility_id) AND v.field_name=g.key AND v.value_code=code AND v.active AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The observation chip is not available at this facility' USING ERRCODE='22023';
   END IF;
   n:=n+1;
  END LOOP;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'Tap at least one meal, mood or medication chip before recording this check' USING ERRCODE='22023'; END IF;
 RETURN;
END $$;
REVOKE ALL ON FUNCTION haven.require_observation_capture(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.complete_rounding_task_core(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
  p_organization_id uuid,p_facility_id uuid,p_actual_staff_id uuid,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_task public.resident_observation_tasks%ROWTYPE;
  v_actor jsonb;
  v_role text;
  v_staff_id uuid;
  v_has_active_assignment boolean;
  v_is_active_assignee boolean;
  v_log_id uuid;
  v_status public.resident_observation_task_status;
BEGIN
  SELECT * INTO STRICT v_task FROM public.resident_observation_tasks
  WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL
  FOR UPDATE;
  v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,false,true);
  v_role:=v_actor->>'role';
  v_staff_id:=(v_actor->>'staff_id')::uuid;
  IF v_staff_id IS DISTINCT FROM p_actual_staff_id THEN
    RAISE EXCEPTION 'Rounding actor staff identity changed' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM public.resident_observation_assignments AS assignment
  WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
    AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
  ORDER BY assignment.id FOR SHARE;
  SELECT EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL),
    EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
        AND assignment.staff_id=v_staff_id)
  INTO v_has_active_assignment,v_is_active_assignee;

  -- Assignee guard, unchanged from the approved 327 body. `IS NOT TRUE` rather
  -- than `NOT (...)` is deliberate: an unassigned task compares NULL, and NULL
  -- must refuse rather than pass. supabase/tests/review_authoritative_actor.sql
  -- asserts a caregiver cannot complete a task whose assigned_staff_id is null
  -- and whose assignment rows are all released. That tested invariant outranks
  -- the spec's facility pool wording; see the build notes, decision D12.
  IF v_role NOT IN('owner','org_admin','facility_admin','nurse')
     AND (CASE WHEN v_has_active_assignment THEN v_is_active_assignee ELSE v_task.assigned_staff_id=v_staff_id END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rounding task assignee changed' USING ERRCODE='42501';
  END IF;
  IF v_task.status IN('completed_on_time','completed_late','excused') THEN
    RAISE EXCEPTION 'Observation task is no longer completable' USING ERRCODE='P0001';
  END IF;
  v_status:=(p_payload->>'completion_status')::public.resident_observation_task_status;
  IF v_status NOT IN('completed_on_time','completed_late') THEN
    RAISE EXCEPTION 'Invalid completion status' USING ERRCODE='22023';
  END IF;

  PERFORM haven.require_observation_capture(p_task_id,p_payload);

  INSERT INTO public.resident_observation_logs(
    organization_id,entity_id,facility_id,resident_id,task_id,assigned_staff_id,staff_id,
    observed_at,entered_at,entry_mode,quick_status,resident_location,resident_position,resident_state,
    distress_present,breathing_concern,pain_concern,toileting_assisted,hydration_offered,repositioned,
    skin_concern_observed,fall_hazard_observed,refused_assistance,intervention_codes,exception_present,
    note,late_reason,composed_summary,chip_selections,created_by
  ) VALUES(
    v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_task.id,
    v_task.assigned_staff_id,v_staff_id,(p_payload->>'observed_at')::timestamptz,
    (p_payload->>'entered_at')::timestamptz,(p_payload->>'entry_mode')::public.resident_observation_entry_mode,
    (p_payload->>'quick_status')::public.resident_observation_quick_status,p_payload->>'resident_location',
    p_payload->>'resident_position',p_payload->>'resident_state',
    coalesce((p_payload->>'distress_present')::boolean,false),coalesce((p_payload->>'breathing_concern')::boolean,false),
    coalesce((p_payload->>'pain_concern')::boolean,false),coalesce((p_payload->>'toileting_assisted')::boolean,false),
    coalesce((p_payload->>'hydration_offered')::boolean,false),coalesce((p_payload->>'repositioned')::boolean,false),
    coalesce((p_payload->>'skin_concern_observed')::boolean,false),coalesce((p_payload->>'fall_hazard_observed')::boolean,false),
    coalesce((p_payload->>'refused_assistance')::boolean,false),ARRAY(SELECT pg_catalog.jsonb_array_elements_text(
      coalesce(p_payload->'intervention_codes','[]'::jsonb))),coalesce((p_payload->>'exception_present')::boolean,false),
    p_payload->>'note',p_payload->>'late_reason',
    nullif(btrim(p_payload->>'composed_summary'),''),coalesce(p_payload->'chip_selections','{}'::jsonb),p_actor_id
  ) RETURNING id INTO v_log_id;

  IF nullif(p_payload->>'exception_type','') IS NOT NULL THEN
    INSERT INTO public.resident_observation_exceptions(
      organization_id,entity_id,facility_id,resident_id,log_id,exception_type,severity,requires_follow_up,follow_up_status
    ) VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log_id,
      (p_payload->>'exception_type')::public.resident_observation_exception_type,
      coalesce(nullif(p_payload->>'exception_severity',''),'medium')::public.resident_observation_severity,true,'open');
  END IF;

  UPDATE public.resident_observation_tasks SET status=v_status,completed_log_id=v_log_id,updated_by=p_actor_id
  WHERE id=v_task.id;
  RETURN pg_catalog.jsonb_build_object('log_id',v_log_id,'status',v_status::text);
END $function$;

ALTER TABLE public.facility_cadence_versions ADD COLUMN configuration jsonb, ADD COLUMN proposal_id uuid;
ALTER TABLE public.facility_escalation_versions ADD COLUMN proposal_id uuid;

CREATE OR REPLACE FUNCTION haven.observation_configuration(p_facility_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object(
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',s.shift_key,'label',s.label,'roster_shift_type',s.roster_shift_type,
  'starts_at_local',s.starts_at_local,'ends_at_local',s.ends_at_local,'enabled',s.active,'sort_order',s.sort_order) ORDER BY s.sort_order,s.shift_key),'[]'::jsonb)
  FROM public.facility_shift_definitions s WHERE s.facility_id=p_facility_id AND s.deleted_at IS NULL),
 'monitoring_interval_presets_minutes',to_jsonb(t.monitoring_order_interval_presets),
 'monitoring_grace_divisor',t.observation_grace_divisor,
 'thresholds',to_jsonb(t)-ARRAY['id','organization_id','facility_id','created_at','created_by','updated_at','updated_by','deleted_at'],
 'watchlist_rules',(SELECT coalesce(jsonb_agg(to_jsonb(r)-ARRAY['id','organization_id','facility_id','inherited'] ORDER BY r.sort_order,r.signal_key),'[]'::jsonb) FROM public.watchlist_rules_for_facility(p_facility_id) r))
 FROM public.facility_observation_thresholds t WHERE t.facility_id=p_facility_id AND t.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION haven.observation_configuration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.observation_configuration(uuid) TO authenticated,service_role;

-- Snapshot today's known baseline, without changing historical version rows.
CREATE TABLE public.observation_configuration_baselines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid UNIQUE NOT NULL REFERENCES public.facilities(id), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 captured_at timestamptz NOT NULL DEFAULT now(), configuration jsonb NOT NULL);
INSERT INTO public.observation_configuration_baselines(facility_id,organization_id,configuration)
 SELECT f.id,f.organization_id,haven.observation_configuration(f.id) FROM public.facilities f
 WHERE f.deleted_at IS NULL AND haven.observation_configuration(f.id) IS NOT NULL;
ALTER TABLE public.observation_configuration_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY observation_configuration_baselines_read ON public.observation_configuration_baselines FOR SELECT TO authenticated
 USING(organization_id=haven.organization_id() AND haven.has_facility_access(facility_id));
REVOKE ALL ON public.observation_configuration_baselines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.observation_configuration_baselines TO authenticated;
GRANT ALL ON public.observation_configuration_baselines TO service_role;
CREATE TRIGGER tr_observation_configuration_baselines_audit AFTER INSERT OR UPDATE OR DELETE ON public.observation_configuration_baselines FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION haven.observation_configuration_for_version(p_facility_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT coalesce((SELECT v.configuration FROM public.facility_cadence_versions v WHERE v.id=coalesce(p_version_id,public.facility_cadence_in_force(p_facility_id,now())) AND v.facility_id=p_facility_id),
 (SELECT b.configuration FROM public.observation_configuration_baselines b WHERE b.facility_id=p_facility_id),haven.observation_configuration(p_facility_id));
$$;
REVOKE ALL ON FUNCTION haven.observation_configuration_for_version(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.observation_configuration_for_version(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.observation_shifts_for_version(p_facility_id uuid,p_version_id uuid)
RETURNS TABLE(facility_id uuid,shift_key text,label text,roster_shift_type public.shift_type,starts_at_local time,ends_at_local time,sort_order integer,active boolean,deleted_at timestamptz)
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT p_facility_id,s.shift_key,s.label,s.roster_shift_type,s.starts_at_local,s.ends_at_local,s.sort_order,s.enabled,NULL::timestamptz
 FROM jsonb_to_recordset(haven.observation_configuration_for_version(p_facility_id,p_version_id)->'shifts') s(
 shift_key text,label text,roster_shift_type public.shift_type,starts_at_local time,ends_at_local time,sort_order integer,enabled boolean);
$$;
REVOKE ALL ON FUNCTION haven.observation_shifts_for_version(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.observation_shifts_for_version(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_cadence_version (p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility_id uuid;
  v_cadence_facility uuid;
  v_escalation_facility uuid;
  v_shape jsonb;
  v_current_shape jsonb;
  v_current_cadence uuid;
  v_floor jsonb;
  v_thresholds record;
  v_blocks jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_row record;
  v_windows_per_day integer := NULL;
  v_gap integer := NULL;
  v_current_windows_per_day integer := NULL;
BEGIN
  IF p_cadence_version_id IS NULL AND p_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'validate_cadence_version needs a cadence version, an escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    v.facility_id INTO v_cadence_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = p_cadence_version_id
    AND v.deleted_at IS NULL;

  SELECT
    v.facility_id INTO v_escalation_facility
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = p_escalation_version_id
    AND v.deleted_at IS NULL;

  IF p_cadence_version_id IS NOT NULL AND v_cadence_facility IS NULL THEN
    RAISE EXCEPTION 'Cadence version not found'
      USING ERRCODE = '22023';
  END IF;

  IF p_escalation_version_id IS NOT NULL AND v_escalation_facility IS NULL THEN
    RAISE EXCEPTION 'Escalation version not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_cadence_facility IS NOT NULL AND v_escalation_facility IS NOT NULL AND v_cadence_facility <> v_escalation_facility THEN
    RAISE EXCEPTION 'The cadence version and the escalation version belong to different buildings and cannot be validated as one change'
      USING ERRCODE = '22023';
  END IF;

  v_facility_id := COALESCE(v_cadence_facility, v_escalation_facility);

  IF NOT haven.can_read_observation_config (v_facility_id) THEN
    RAISE EXCEPTION 'Validating an observation configuration needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    t.maximum_unobserved_gap_minutes,
    t.maximum_windows_per_resident_per_day INTO v_thresholds
  FROM
    jsonb_to_record(haven.observation_configuration_for_version(v_facility_id,p_cadence_version_id)->'thresholds') t(maximum_unobserved_gap_minutes integer,maximum_windows_per_resident_per_day integer);

  -- -----------------------------------------------------------------------
  -- Cadence blocks
  -- -----------------------------------------------------------------------
  IF p_cadence_version_id IS NOT NULL THEN
    v_shape := public.cadence_version_day_shape (p_cadence_version_id);
    v_windows_per_day := (v_shape ->> 'windows_per_day')::integer;
    v_gap := (v_shape ->> 'largest_unobserved_gap_minutes')::integer;

    -- Block 1. Two enabled windows whose grace spans overlap.
    FOR v_row IN
    SELECT DISTINCT
      least(w ->> 'window_key', other) AS a_key,
      greatest(w ->> 'window_key', other) AS b_key
    FROM
      jsonb_array_elements(v_shape -> 'windows') w
      CROSS JOIN LATERAL jsonb_array_elements_text(w -> 'overlaps_window_keys') AS o (other)
    WHERE
      (w ->> 'enabled')::boolean
    ORDER BY
      1,
      2 LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'overlapping_grace_spans', 'message', format('Two enabled windows overlap. %s and %s share time, so one observation would satisfy both windows and silently inflate compliance.', v_row.a_key, v_row.b_key));
      END LOOP;

    -- Block 2. Zero enabled windows on any defined shift.
    FOR v_row IN
    SELECT
      s.shift_key,
      s.label
    FROM
      haven.observation_shifts_for_version(v_facility_id,coalesce(p_cadence_version_id,public.facility_cadence_in_force(v_facility_id,now()))) s
    WHERE
      s.facility_id = v_facility_id
      AND s.deleted_at IS NULL
      AND s.active
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.facility_cadence_windows w
        WHERE
          w.cadence_version_id = p_cadence_version_id
          AND w.deleted_at IS NULL
          AND w.enabled
          AND w.shift_key = s.shift_key)
      ORDER BY
        s.sort_order,
        s.shift_key LOOP
          v_blocks := v_blocks || jsonb_build_object('code', 'shift_without_window', 'message', format('The %s shift has no enabled observation window. Every defined shift must carry at least one check.', v_row.label));
        END LOOP;

    -- Block 3. grace_before_minutes above zero on a window whose due time is a
    -- shift start. Derived from the shift definitions, never from a hardcoded
    -- 06:00 or 18:00.
    FOR v_row IN
    SELECT
      w.window_key,
      w.label,
      w.grace_before_minutes,
      s.label AS shift_label
    FROM
      public.facility_cadence_windows w
      JOIN haven.observation_shifts_for_version(v_facility_id,coalesce(p_cadence_version_id,public.facility_cadence_in_force(v_facility_id,now()))) s ON s.facility_id = v_facility_id
        AND s.deleted_at IS NULL
        AND s.active
        AND s.starts_at_local = w.due_at_local
    WHERE
      w.cadence_version_id = p_cadence_version_id
      AND w.deleted_at IS NULL
      AND w.enabled
      AND w.grace_before_minutes > 0
    ORDER BY
      w.sort_order,
      w.window_key LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'shift_start_grace_before', 'message', format('%s is due at the start of the %s shift and opens %s minutes early. The incoming shift must be the one that lays eyes on the resident, so grace before has to be zero on a window due at a shift start.', v_row.label, v_row.shift_label, v_row.grace_before_minutes));
      END LOOP;

    FOR v_row IN SELECT w.window_key,w.label FROM public.facility_cadence_windows w
      WHERE w.cadence_version_id=p_cadence_version_id AND w.deleted_at IS NULL AND w.enabled AND NOT EXISTS(
       SELECT 1 FROM haven.observation_shifts_for_version(v_facility_id,p_cadence_version_id) s
       WHERE s.active AND s.shift_key=w.shift_key AND CASE WHEN s.starts_at_local<s.ends_at_local
        THEN w.due_at_local>=s.starts_at_local AND w.due_at_local<s.ends_at_local
        ELSE w.due_at_local>=s.starts_at_local OR w.due_at_local<s.ends_at_local END)
    LOOP v_blocks:=v_blocks||jsonb_build_object('code','window_outside_shift','message',format('%s must be due inside its selected shift.',v_row.label)); END LOOP;

    -- Block 6. Window frequency below the jurisdiction floor. A null floor
    -- passes; nothing here invents a number.
    v_floor := public.facility_observation_jurisdiction_floor (v_facility_id);

    IF (v_floor ->> 'minimum_windows_per_24h') IS NOT NULL AND v_windows_per_day < (v_floor ->> 'minimum_windows_per_24h')::integer THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'below_jurisdiction_floor', 'message', format('%s enabled windows per 24 hours is below the %s floor of %s. The regulator minimum may not be configured away.', v_windows_per_day, v_floor ->> 'jurisdiction_key', v_floor ->> 'minimum_windows_per_24h'));
    ELSIF (v_floor ->> 'maximum_unobserved_gap_minutes') IS NOT NULL AND v_gap > (v_floor ->> 'maximum_unobserved_gap_minutes')::integer THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'below_jurisdiction_floor', 'message', format('The largest unobserved gap of %s minutes exceeds the %s floor of %s minutes. The regulator minimum may not be configured away.', v_gap, v_floor ->> 'jurisdiction_key', v_floor ->> 'maximum_unobserved_gap_minutes'));
    END IF;
  END IF;

  p_escalation_version_id:=coalesce(p_escalation_version_id,public.facility_escalation_in_force(v_facility_id,now()));

  -- -----------------------------------------------------------------------
  -- Escalation blocks
  -- -----------------------------------------------------------------------
  IF p_escalation_version_id IS NOT NULL THEN
    -- Block 4. Rung offsets not strictly increasing. Compared in sort order,
    -- because sort_order is also the escalation level written on the row, so a
    -- later rung that fires earlier records a higher level at an earlier time.
    FOR v_row IN
    SELECT
      prev_key,
      prev_offset,
      rung_key,
      offset_minutes
    FROM (
      SELECT
        r.rung_key,
        r.offset_minutes,
        lag(r.rung_key) OVER (ORDER BY r.sort_order, r.rung_key) AS prev_key,
        lag(r.offset_minutes) OVER (ORDER BY r.sort_order, r.rung_key) AS prev_offset
      FROM
        public.facility_escalation_rungs r
      WHERE
        r.escalation_version_id = p_escalation_version_id
        AND r.deleted_at IS NULL
        AND r.enabled) ordered
    WHERE
      prev_offset IS NOT NULL
      AND offset_minutes <= prev_offset LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'rung_offsets_not_increasing', 'message', format('Escalation rung offsets are not strictly increasing. %s fires at %s minutes and %s fires at %s minutes, so the later rung does not come later.', v_row.prev_key, v_row.prev_offset, v_row.rung_key, v_row.offset_minutes));
      END LOOP;

    FOR v_row IN
     SELECT * FROM (
      SELECT s.shift_key,r.rung_key,coalesce(o.offset_minutes,r.offset_minutes) AS offset_minutes,
       lag(coalesce(o.offset_minutes,r.offset_minutes)) OVER(PARTITION BY s.shift_key ORDER BY r.sort_order,r.rung_key) AS prev_offset
      FROM haven.observation_shifts_for_version(v_facility_id,coalesce(p_cadence_version_id,public.facility_cadence_in_force(v_facility_id,now()))) s
      CROSS JOIN public.facility_escalation_rungs r
      LEFT JOIN public.facility_escalation_rung_shift_overrides o ON o.escalation_rung_id=r.id AND o.shift_key=s.shift_key AND o.deleted_at IS NULL
      WHERE s.active AND r.escalation_version_id=p_escalation_version_id AND r.enabled AND r.deleted_at IS NULL) effective
     WHERE prev_offset IS NOT NULL AND offset_minutes<=prev_offset
    LOOP v_blocks:=v_blocks||jsonb_build_object('code','rung_offsets_not_increasing','message',format('The %s escalation ladder must increase on every rung; check %s.',v_row.shift_key,v_row.rung_key)); END LOOP;
    IF EXISTS(SELECT 1 FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_version_id=p_escalation_version_id AND o.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM haven.observation_shifts_for_version(v_facility_id,coalesce(p_cadence_version_id,public.facility_cadence_in_force(v_facility_id,now()))) s WHERE s.shift_key=o.shift_key AND s.active)) THEN
      v_blocks:=v_blocks||jsonb_build_object('code','unknown_shift_override','message','Every override must name an enabled shift.');
    END IF;
    IF EXISTS(SELECT 1 FROM public.facility_escalation_rungs r WHERE r.escalation_version_id=p_escalation_version_id AND r.is_terminal AND r.deleted_at IS NULL AND nullif(btrim(r.protocol_text),'') IS NULL) THEN
      v_blocks:=v_blocks||jsonb_build_object('code','terminal_protocol_required','message','The terminal escalation needs its written protocol.');
    END IF;
    -- Block 5. The terminal rung disabled. A version with no terminal rung at
    -- all is the same defect by another route and reads the same message.
    FOR v_row IN
    SELECT
      r.rung_key,
      r.label
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_escalation_version_id
      AND r.deleted_at IS NULL
      AND r.is_terminal
      AND NOT r.enabled LOOP
        v_blocks := v_blocks || jsonb_build_object('code', 'terminal_rung_disabled', 'message', format('The terminal escalation rung %s is disabled. The last rung protocol may be rewritten but its existence may not be turned off.', v_row.label));
      END LOOP;

    IF NOT EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_rungs r
      WHERE
        r.escalation_version_id = p_escalation_version_id
        AND r.deleted_at IS NULL
        AND r.is_terminal) THEN
      v_blocks := v_blocks || jsonb_build_object('code', 'terminal_rung_disabled', 'message', 'The terminal escalation rung is missing. The last rung protocol may be rewritten but its existence may not be turned off.');
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- Warnings. Typed acknowledgment, never a refusal: an administrator with a
  -- reason still gets to proceed, on the record.
  -- -----------------------------------------------------------------------
  IF p_cadence_version_id IS NOT NULL THEN
    v_current_cadence := public.facility_cadence_in_force (v_facility_id, now());

    IF v_current_cadence IS NOT NULL AND v_current_cadence <> p_cadence_version_id THEN
      v_current_shape := public.cadence_version_day_shape (v_current_cadence);
      v_current_windows_per_day := (v_current_shape ->> 'windows_per_day')::integer;
    END IF;

    IF v_thresholds.maximum_unobserved_gap_minutes IS NOT NULL AND v_gap > v_thresholds.maximum_unobserved_gap_minutes THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'largest_gap_exceeds_threshold', 'requires_acknowledgment', TRUE, 'message', format('The largest span in which nobody looks at a resident becomes %s minutes, past the %s minutes this building accepts.', v_gap, v_thresholds.maximum_unobserved_gap_minutes));
    END IF;

    IF v_current_windows_per_day IS NOT NULL AND v_windows_per_day < v_current_windows_per_day THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'windows_per_day_decreased', 'requires_acknowledgment', TRUE, 'message', format('Checks per resident per day fall from %s to %s.', v_current_windows_per_day, v_windows_per_day));
    END IF;

    IF v_thresholds.maximum_windows_per_resident_per_day IS NOT NULL AND v_windows_per_day > v_thresholds.maximum_windows_per_resident_per_day THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'windows_per_day_above_ceiling', 'requires_acknowledgment', TRUE, 'message', format('%s checks per resident per day is more than the %s this building treats as workable.', v_windows_per_day, v_thresholds.maximum_windows_per_resident_per_day));
    END IF;
  END IF;

  IF p_escalation_version_id IS NOT NULL THEN
    FOR v_row IN
    SELECT
      rung ->> 'label' AS rung_label,
      role_entry ->> 'staff_role' AS staff_role
    FROM
      jsonb_array_elements(public.observation_escalation_role_holders (v_facility_id, p_escalation_version_id)) rung
      CROSS JOIN LATERAL jsonb_array_elements(rung -> 'roles') AS role_entry
    WHERE
      (rung ->> 'enabled')::boolean
      AND (role_entry ->> 'holder_count')::integer = 0 LOOP
        v_warnings := v_warnings || jsonb_build_object('code', 'rung_role_has_no_holders', 'requires_acknowledgment', TRUE, 'message', format('Nobody at this building currently holds the %s role that %s is addressed to, so that rung reaches nobody through it.', v_row.staff_role, v_row.rung_label));
      END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_blocks) = 0, 'facility_id', v_facility_id, 'cadence_version_id', p_cadence_version_id, 'escalation_version_id', p_escalation_version_id, 'windows_per_day', v_windows_per_day, 'current_windows_per_day', v_current_windows_per_day, 'largest_unobserved_gap_minutes', v_gap, 'jurisdiction_floor', v_floor, 'blocks', v_blocks, 'warnings', v_warnings);
END;
$func$;

CREATE OR REPLACE FUNCTION public.observation_escalation_role_holders (p_facility_id uuid, p_escalation_version_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the escalation recipient resolution needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(jsonb_agg (entry ORDER BY sort_order, rung_key), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      r.sort_order,
      r.rung_key,
      jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'channels', to_jsonb (r.channels), 'enabled', r.enabled, 'sort_order',r.sort_order,'protocol_text',r.protocol_text,'target_staff_roles',to_jsonb(r.target_staff_roles),'shift_overrides',(SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',o.shift_key,'offset_minutes',o.offset_minutes,'channels',o.channels) ORDER BY o.shift_key),'[]'::jsonb) FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_rung_id=r.id AND o.deleted_at IS NULL), 'standing_alert_route_count', (
          SELECT
            count(*)
          FROM
            public.notification_routes nr
          WHERE
            nr.facility_id = p_facility_id
            AND nr.is_active
            AND nr.deleted_at IS NULL), 'roles', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('staff_role', role_name, 'holder_count', (
                    SELECT
                      count(*)
                    FROM
                      public.staff s
                    WHERE
                      s.facility_id = p_facility_id
                      AND s.staff_role = role_name
                      AND s.employment_status = 'active'
                      AND s.deleted_at IS NULL))
                ORDER BY role_name::text)
            FROM
              unnest(r.target_staff_roles) AS role_name), '[]'::jsonb)) AS entry
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_escalation_version_id
      AND r.facility_id=p_facility_id
      AND r.deleted_at IS NULL) rungs;

  RETURN v_result;
END;
$func$;

CREATE OR REPLACE FUNCTION haven.assert_observation_configuration(p_facility_id uuid,p_config jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s record; r record; t public.facility_observation_thresholds%ROWTYPE; presets integer[]; total_minutes integer;
BEGIN
 IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR jsonb_typeof(p_config->'shifts') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_config->'shifts')=0 THEN RAISE EXCEPTION 'Define at least one shift' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT * FROM jsonb_to_recordset(p_config->'shifts') x(shift_key text,label text,roster_shift_type public.shift_type,starts_at_local time,ends_at_local time,enabled boolean,sort_order integer) LOOP
  IF s.shift_key IS NULL OR s.shift_key !~ '^[a-z0-9_]+$' OR nullif(btrim(s.label),'') IS NULL OR length(s.label)>60 OR s.roster_shift_type IS NULL
   OR s.starts_at_local IS NULL OR s.ends_at_local IS NULL OR s.enabled IS NULL OR s.sort_order IS NULL THEN
   RAISE EXCEPTION 'Every shift needs a key, label, roster mapping, local start and end, and enabled state' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'shift_key') FROM jsonb_array_elements(p_config->'shifts')) THEN
  RAISE EXCEPTION 'Shift keys must be unique' USING ERRCODE='22023'; END IF;
 -- The active shifts must partition the local day, without overlap or gaps.
 IF EXISTS(WITH spans AS (SELECT shift_key,extract(epoch FROM starts_at_local)/60 AS a,
   extract(epoch FROM starts_at_local)/60+CASE WHEN ends_at_local>starts_at_local THEN extract(epoch FROM ends_at_local-starts_at_local)/60 ELSE 1440-extract(epoch FROM starts_at_local-ends_at_local)/60 END AS b
  FROM jsonb_to_recordset(p_config->'shifts') x(shift_key text,starts_at_local time,ends_at_local time,enabled boolean) WHERE enabled)
  SELECT 1 FROM spans a CROSS JOIN spans b CROSS JOIN (VALUES(-1440),(0),(1440)) d(n)
  WHERE a.shift_key<>b.shift_key AND a.a<b.b+d.n AND b.a+d.n<a.b) THEN
  RAISE EXCEPTION 'Enabled shifts must not overlap' USING ERRCODE='22023'; END IF;
 SELECT sum(CASE WHEN ends_at_local>starts_at_local THEN extract(epoch FROM ends_at_local-starts_at_local)/60 ELSE 1440-extract(epoch FROM starts_at_local-ends_at_local)/60 END)::integer INTO total_minutes
 FROM jsonb_to_recordset(p_config->'shifts') x(starts_at_local time,ends_at_local time,enabled boolean) WHERE enabled;
 IF total_minutes IS DISTINCT FROM 1440 THEN RAISE EXCEPTION 'Enabled shifts must cover the full local day' USING ERRCODE='22023'; END IF;
 t:=jsonb_populate_record(NULL::public.facility_observation_thresholds,p_config->'thresholds');
 SELECT array_agg(value::integer) INTO presets FROM jsonb_array_elements_text(p_config->'monitoring_interval_presets_minutes');
 IF coalesce(cardinality(presets),0)=0 OR EXISTS(SELECT 1 FROM unnest(presets) v WHERE v IS NULL OR v<t.monitoring_order_interval_min_minutes OR v>t.monitoring_order_interval_max_minutes)
  OR t.monitoring_order_interval_min_minutes IS NULL OR t.monitoring_order_interval_max_minutes IS NULL
  OR t.monitoring_order_interval_min_minutes<15 OR t.monitoring_order_interval_max_minutes>720 OR t.monitoring_order_interval_min_minutes>t.monitoring_order_interval_max_minutes
  OR coalesce((p_config->>'monitoring_grace_divisor')::numeric,0)<=0
  OR coalesce(t.maximum_unobserved_gap_minutes,0)<=0 OR coalesce(t.maximum_windows_per_resident_per_day,0)<=0
  OR coalesce(t.observation_grace_floor_minutes,0)<=0 OR t.observation_grace_ceiling_minutes<t.observation_grace_floor_minutes THEN
  RAISE EXCEPTION 'Check the monitoring presets, interval bounds, grace formula, gap and load thresholds' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_config->'watchlist_rules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Watchlist rules must be a list' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->>'signal_key') FROM jsonb_array_elements(p_config->'watchlist_rules')) THEN
  RAISE EXCEPTION 'Watchlist signal keys must be unique' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT signal_key FROM public.watchlist_rules_for_facility(p_facility_id) EXCEPT SELECT value->>'signal_key' FROM jsonb_array_elements(p_config->'watchlist_rules')) THEN
  RAISE EXCEPTION 'Preserve every Watchlist rule; disable a rule explicitly instead of removing its history' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT * FROM jsonb_populate_recordset(NULL::public.watchlist_signal_rules,p_config->'watchlist_rules') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.watchlist_rules_for_facility(p_facility_id) existing WHERE existing.signal_key=r.signal_key)
   OR r.enabled IS NULL OR r.severity_class IS NULL OR r.severity_class NOT IN('informational','elevated','critical')
   OR r.threshold_count IS NULL OR r.threshold_count<1 OR r.lookback_days IS NULL OR r.lookback_days NOT BETWEEN 1 AND 366
   OR r.severity_weight IS NULL OR r.severity_weight NOT BETWEEN 0 AND 100 OR nullif(btrim(r.label),'') IS NULL OR nullif(btrim(r.description),'') IS NULL
   OR r.source_kind IS NULL OR r.source_kind NOT IN('clinical','data_quality') OR jsonb_typeof(r.source_filter) IS DISTINCT FROM 'object'
   OR (r.secondary_threshold_percent IS NULL)<>(r.secondary_lookback_days IS NULL)
   OR r.threshold_percent<=0 OR r.secondary_threshold_percent<=0 OR r.secondary_lookback_days NOT BETWEEN 1 AND 366 OR r.baseline_days NOT BETWEEN 1 AND 366 THEN
   RAISE EXCEPTION 'Every Watchlist rule needs valid thresholds, lookbacks, severity and enabled state' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION haven.assert_observation_configuration(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_cadence_version (p_facility_id uuid, p_change_reason text, p_windows jsonb, p_escalation_rungs jsonb, p_effective_from timestamptz, p_source_cadence_template_id uuid, p_source_escalation_template_id uuid, p_configuration jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_org uuid;
  v_actor uuid;
  v_status text;
  v_effective_from timestamptz;
  v_cadence_id uuid := NULL;
  v_escalation_id uuid := NULL;
  v_cadence_number integer;
  v_escalation_number integer;
  v_rung record;
  v_configuration jsonb;
  v_proposal_id uuid:=gen_random_uuid();
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Every observation configuration change needs a reason. Say what changed and why, so the change log is worth reading in six months'
      USING ERRCODE = '22023';
  END IF;

  IF p_windows IS NULL AND p_escalation_rungs IS NULL AND p_configuration IS NULL THEN
    RAISE EXCEPTION 'A proposal has to change something: pass the observation windows, the escalation rungs, or both'
      USING ERRCODE = '22023';
  END IF;

  IF haven.can_edit_observation_config (p_facility_id) THEN
    v_status := 'draft';
  ELSIF haven.can_propose_observation_config (p_facility_id) THEN
    -- Spec 6.12 and open item 7: facility administrators propose rather than
    -- edit. A cadence change is policy for an entire building.
    v_status := 'pending_approval';
  ELSE
    RAISE EXCEPTION 'Proposing an observation configuration change needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text,0));
  SELECT
    f.organization_id INTO v_org
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_cadence_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cadence_templates WHERE id=p_source_cadence_template_id AND organization_id=v_org AND deleted_at IS NULL)
   OR p_source_escalation_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.escalation_templates WHERE id=p_source_escalation_template_id AND organization_id=v_org AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The source template does not belong to this organization' USING ERRCODE='42501'; END IF;

  SELECT
    p.id INTO v_actor
  FROM
    public.user_profiles p
  WHERE
    p.id = auth.uid ();

  -- A provisional effective_from, because the column is NOT NULL and a draft
  -- has to land somewhere. Activation resolves the real one from the apply
  -- mode and overwrites this.
  v_effective_from := COALESCE(p_effective_from, public.facility_next_shift_boundary_at (p_facility_id, now()), now());

  INSERT INTO public.observation_configuration_baselines(facility_id,organization_id,configuration)
   SELECT p_facility_id,v_org,haven.observation_configuration(p_facility_id) WHERE haven.observation_configuration(p_facility_id) IS NOT NULL
   ON CONFLICT(facility_id) DO NOTHING;
  v_configuration:=haven.observation_configuration(p_facility_id)||coalesce(p_configuration,'{}'::jsonb);
  v_configuration:=jsonb_set(v_configuration,'{thresholds}',(haven.observation_configuration(p_facility_id)->'thresholds')||coalesce(p_configuration->'thresholds','{}'::jsonb));
  PERFORM haven.assert_observation_configuration(p_facility_id,v_configuration);
  IF p_configuration IS NOT NULL AND p_windows IS NULL THEN
    SELECT jsonb_agg(to_jsonb(w)) INTO p_windows FROM public.facility_cadence_windows w
      WHERE w.cadence_version_id=public.facility_cadence_in_force(p_facility_id,now()) AND w.deleted_at IS NULL;
  END IF;
  IF p_windows IS NOT NULL THEN
    IF jsonb_typeof(p_windows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_windows) = 0 THEN
      RAISE EXCEPTION 'The observation windows have to be a non empty JSON array'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      COALESCE(max(v.version_number), 0) + 1 INTO v_cadence_number
    FROM
      public.facility_cadence_versions v
    WHERE
      v.facility_id = p_facility_id;

    INSERT INTO public.facility_cadence_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, created_by,configuration,proposal_id)
      VALUES (v_org, p_facility_id, v_cadence_number, v_status, v_effective_from, p_change_reason, p_source_cadence_template_id, v_actor,v_configuration,v_proposal_id)
    RETURNING
      id INTO v_cadence_id;

    INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled, created_by)
    SELECT
      v_org,
      p_facility_id,
      v_cadence_id,
      w.window_key,
      w.label,
      w.due_at_local,
      w.grace_before_minutes,
      w.grace_after_minutes,
      w.shift_key,
      COALESCE(w.sort_order, 0),
      COALESCE(w.enabled, TRUE),
      v_actor
    FROM
      jsonb_to_recordset(p_windows) AS w (window_key text, label text, due_at_local time, grace_before_minutes integer, grace_after_minutes integer, shift_key text, sort_order integer, enabled boolean);
  END IF;

  IF p_escalation_rungs IS NOT NULL THEN
    IF jsonb_typeof(p_escalation_rungs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_escalation_rungs) = 0 THEN
      RAISE EXCEPTION 'The escalation rungs have to be a non empty JSON array'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      COALESCE(max(v.version_number), 0) + 1 INTO v_escalation_number
    FROM
      public.facility_escalation_versions v
    WHERE
      v.facility_id = p_facility_id;

    INSERT INTO public.facility_escalation_versions (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, created_by,proposal_id)
      VALUES (v_org, p_facility_id, v_escalation_number, v_status, v_effective_from, p_change_reason, p_source_escalation_template_id, v_actor,v_proposal_id)
    RETURNING
      id INTO v_escalation_id;

    INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled, created_by)
    SELECT
      v_org,
      p_facility_id,
      v_escalation_id,
      r.rung_key,
      r.label,
      r.offset_minutes,
      COALESCE(r.is_terminal, FALSE),
      COALESCE(r.assigned_staff_only, FALSE),
      COALESCE(r.include_assigned_staff, FALSE),
      COALESCE(r.use_standing_alert_routes, FALSE),
      COALESCE(r.target_staff_roles, ARRAY[]::public.staff_role[]),
      r.channels,
      r.protocol_text,
      COALESCE(r.sort_order, 0),
      COALESCE(r.enabled, TRUE),
      v_actor
    FROM
      jsonb_to_recordset(p_escalation_rungs) AS r (rung_key text, label text, offset_minutes integer, is_terminal boolean, assigned_staff_only boolean, include_assigned_staff boolean, use_standing_alert_routes boolean, target_staff_roles public.staff_role[], channels text[], protocol_text text, sort_order integer, enabled boolean);

    -- Per shift overrides ride along on the rung they belong to. A shift key is
    -- facility configuration, so an override cannot be templated, but it can
    -- certainly be proposed.
    FOR v_rung IN
    SELECT
      r.rung_key,
      r.shift_overrides
    FROM
      jsonb_to_recordset(p_escalation_rungs) AS r (rung_key text, shift_overrides jsonb)
    WHERE
      r.shift_overrides IS NOT NULL
      AND jsonb_typeof(r.shift_overrides) = 'array' LOOP
        INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels, created_by)
        SELECT
          v_org,
          p_facility_id,
          v_escalation_id,
          rung.id,
          ov.shift_key,
          ov.offset_minutes,
          ov.channels,
          v_actor
        FROM
          public.facility_escalation_rungs rung
          CROSS JOIN LATERAL jsonb_to_recordset(v_rung.shift_overrides) AS ov (shift_key text, offset_minutes integer, channels text[])
        WHERE
          rung.escalation_version_id = v_escalation_id
          AND rung.rung_key = v_rung.rung_key;
      END LOOP;
  END IF;

  RETURN jsonb_build_object('facility_id', p_facility_id, 'status', v_status, 'cadence_version_id', v_cadence_id, 'cadence_version_number', v_cadence_number, 'escalation_version_id', v_escalation_id, 'escalation_version_number', v_escalation_number, 'provisional_effective_from', v_effective_from, 'validation', public.validate_cadence_version (v_cadence_id, v_escalation_id));
END;
$func$;
REVOKE ALL ON FUNCTION public.create_cadence_version(uuid,text,jsonb,jsonb,timestamptz,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_cadence_version(uuid,text,jsonb,jsonb,timestamptz,uuid,uuid,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_cadence_version(p_facility_id uuid,p_change_reason text,p_windows jsonb DEFAULT NULL,p_escalation_rungs jsonb DEFAULT NULL,p_effective_from timestamptz DEFAULT NULL,p_source_cadence_template_id uuid DEFAULT NULL,p_source_escalation_template_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path=public,pg_catalog AS $$
 SELECT public.create_cadence_version(p_facility_id,p_change_reason,p_windows,p_escalation_rungs,p_effective_from,p_source_cadence_template_id,p_source_escalation_template_id,NULL::jsonb);
$$;

CREATE OR REPLACE FUNCTION haven.capture_observation_shift_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $func$
DECLARE effective_at timestamptz:=coalesce(nullif(current_setting('haven.observation_config_effective_at',true),'')::timestamptz,now());
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
  VALUES(NEW.organization_id,NEW.facility_id,NEW.shift_key,NEW.active AND NEW.deleted_at IS NULL,effective_at);
 ELSIF OLD.shift_key IS DISTINCT FROM NEW.shift_key OR OLD.active IS DISTINCT FROM NEW.active OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
  UPDATE public.facility_observation_shift_history SET effective_to=effective_at
  WHERE facility_id=OLD.facility_id AND shift_key=OLD.shift_key AND effective_to IS NULL AND deleted_at IS NULL;
  INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
  VALUES(NEW.organization_id,NEW.facility_id,NEW.shift_key,NEW.active AND NEW.deleted_at IS NULL,effective_at);
 END IF;
 RETURN NEW;
END;
$func$;
CREATE OR REPLACE FUNCTION haven.materialize_observation_configuration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE s record; r record; t public.facility_observation_thresholds%ROWTYPE; prior_effective text;
BEGIN
 IF NEW.status<>'active' OR OLD.status='active' OR NEW.configuration IS NULL THEN RETURN NEW; END IF;
 PERFORM haven.assert_observation_configuration(NEW.facility_id,NEW.configuration);
 prior_effective:=current_setting('haven.observation_config_effective_at',true);
 PERFORM set_config('haven.observation_config_effective_at',NEW.effective_from::text,true);
 UPDATE public.facility_shift_definitions SET active=false,updated_by=NEW.activated_by
 WHERE facility_id=NEW.facility_id AND deleted_at IS NULL AND active;
 FOR s IN SELECT * FROM jsonb_to_recordset(NEW.configuration->'shifts') x(shift_key text,label text,roster_shift_type public.shift_type,starts_at_local time,ends_at_local time,enabled boolean,sort_order integer) LOOP
  INSERT INTO public.facility_shift_definitions(organization_id,facility_id,shift_key,label,roster_shift_type,starts_at_local,ends_at_local,active,sort_order,created_by)
  VALUES(NEW.organization_id,NEW.facility_id,s.shift_key,s.label,s.roster_shift_type,s.starts_at_local,s.ends_at_local,s.enabled,s.sort_order,NEW.activated_by)
  ON CONFLICT(facility_id,shift_key) WHERE deleted_at IS NULL DO UPDATE SET label=excluded.label,roster_shift_type=excluded.roster_shift_type,
   starts_at_local=excluded.starts_at_local,ends_at_local=excluded.ends_at_local,active=excluded.active,sort_order=excluded.sort_order,updated_by=NEW.activated_by;
 END LOOP;
 PERFORM set_config('haven.observation_config_effective_at',coalesce(prior_effective,''),true);
 t:=jsonb_populate_record(NULL::public.facility_observation_thresholds,NEW.configuration->'thresholds');
 UPDATE public.facility_observation_thresholds SET maximum_unobserved_gap_minutes=t.maximum_unobserved_gap_minutes,
 maximum_windows_per_resident_per_day=t.maximum_windows_per_resident_per_day,
 monitoring_order_interval_presets=ARRAY(SELECT value::integer FROM jsonb_array_elements_text(NEW.configuration->'monitoring_interval_presets_minutes')),
 observation_grace_divisor=(NEW.configuration->>'monitoring_grace_divisor')::numeric,
 monitoring_order_interval_min_minutes=t.monitoring_order_interval_min_minutes,monitoring_order_interval_max_minutes=t.monitoring_order_interval_max_minutes,
 observation_grace_floor_minutes=t.observation_grace_floor_minutes,observation_grace_ceiling_minutes=t.observation_grace_ceiling_minutes,updated_by=NEW.activated_by
 WHERE facility_id=NEW.facility_id AND deleted_at IS NULL;
 -- New rows retain old rule IDs and values for signal evidence. The snapshot
 -- also records inherited rules, so later organization edits cannot rewrite it.
 UPDATE public.watchlist_signal_rules SET deleted_at=now(),updated_by=NEW.activated_by
 WHERE facility_id=NEW.facility_id AND deleted_at IS NULL;
 FOR r IN SELECT * FROM jsonb_populate_recordset(NULL::public.watchlist_signal_rules,NEW.configuration->'watchlist_rules') LOOP
  INSERT INTO public.watchlist_signal_rules(organization_id,facility_id,signal_key,label,description,severity_class,severity_weight,threshold_count,lookback_days,baseline_days,
   threshold_percent,secondary_threshold_percent,secondary_lookback_days,source_filter,enabled,source_kind,jurisdiction,sort_order,created_by)
  VALUES(NEW.organization_id,NEW.facility_id,r.signal_key,r.label,r.description,r.severity_class,r.severity_weight,r.threshold_count,r.lookback_days,r.baseline_days,
   r.threshold_percent,r.secondary_threshold_percent,r.secondary_lookback_days,r.source_filter,r.enabled,r.source_kind,r.jurisdiction,r.sort_order,NEW.activated_by);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.materialize_observation_configuration() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_materialize_observation_configuration AFTER UPDATE OF status ON public.facility_cadence_versions FOR EACH ROW EXECUTE FUNCTION haven.materialize_observation_configuration();

-- Config writes must go through role-gated, audited version commands.
REVOKE INSERT,UPDATE,DELETE ON public.facility_shift_definitions,public.facility_observation_thresholds,
 public.watchlist_signal_rules,public.facility_cadence_versions,public.facility_cadence_windows,
 public.facility_escalation_versions,public.facility_escalation_rungs,public.facility_escalation_rung_shift_overrides FROM authenticated;

CREATE OR REPLACE FUNCTION public.facility_shift_window_at (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    shift_key text,
    roster_shift_type public.shift_type,
    shift_service_date date,
    starts_at_utc timestamptz,
    ends_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
local_now AS (
  SELECT
    fac.timezone,
    (p_at AT TIME ZONE fac.timezone) AS ts
  FROM
    facility fac
),
candidate AS (
  SELECT
    s.shift_key AS key,
    s.roster_shift_type AS roster_type,
    d.day AS service_day,
    (d.day + s.starts_at_local) AS local_start,
    (d.day + s.starts_at_local) + CASE WHEN s.ends_at_local > s.starts_at_local THEN
      (s.ends_at_local - s.starts_at_local)
    ELSE
      (interval '24 hours' - (s.starts_at_local - s.ends_at_local))
    END AS local_end
  FROM
    haven.observation_shifts_for_version(p_facility_id,public.facility_cadence_in_force(p_facility_id,p_at)) s
    CROSS JOIN local_now ln
    CROSS JOIN LATERAL unnest(ARRAY[ln.ts::date - 1, ln.ts::date]) AS d (day)
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.active
)
SELECT
  c.key,
  c.roster_type,
  c.service_day,
  (c.local_start AT TIME ZONE ln.timezone),
  (c.local_end AT TIME ZONE ln.timezone)
FROM
  candidate c
  CROSS JOIN local_now ln
WHERE
  ln.ts >= c.local_start
  AND ln.ts < c.local_end
ORDER BY
  c.local_start DESC
LIMIT 1;
$func$;

CREATE OR REPLACE FUNCTION public.observation_config_overview (p_facility_id uuid, p_proposed_cadence_version_id uuid DEFAULT NULL, p_proposed_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_org uuid;
  v_tz text;
  v_facility_name text;
  v_cadence uuid;
  v_escalation uuid;
  v_active_residents integer;
  v_shifts jsonb;
  v_binding record;
  v_current_cadence_row record;
  v_current_escalation_row record;
  v_configuration jsonb;
  v_pending jsonb;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the observation configuration needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id,
    COALESCE(f.timezone, 'America/New_York'),
    f.name INTO v_org,
    v_tz,
    v_facility_name
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  v_cadence := public.facility_cadence_in_force (p_facility_id, now());
  v_escalation := public.facility_escalation_in_force (p_facility_id, now());

  SELECT
    count(*) INTO v_active_residents
  FROM
    public.residents r
  WHERE
    r.facility_id = p_facility_id
    AND r.deleted_at IS NULL
    AND r.status = 'active';

  SELECT
    COALESCE(jsonb_agg (jsonb_build_object('shift_key', s.shift_key, 'label', s.label, 'starts_at_local', to_char(s.starts_at_local, 'HH24:MI'), 'ends_at_local', to_char(s.ends_at_local, 'HH24:MI'), 'starts_minute', extract(hour FROM s.starts_at_local)::integer * 60 + extract(minute FROM s.starts_at_local)::integer, 'ends_minute', extract(hour FROM s.ends_at_local)::integer * 60 + extract(minute FROM s.ends_at_local)::integer)
      ORDER BY s.sort_order, s.shift_key), '[]'::jsonb) INTO v_shifts
  FROM
    public.facility_shift_definitions s
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.active;

  SELECT
    b.cadence_template_id,
    ct.name AS cadence_template_name,
    b.escalation_template_id,
    et.name AS escalation_template_name INTO v_binding
  FROM
    public.facility_config_template_bindings b
    LEFT JOIN public.cadence_templates ct ON ct.id = b.cadence_template_id
      AND ct.deleted_at IS NULL
    LEFT JOIN public.escalation_templates et ON et.id = b.escalation_template_id
      AND et.deleted_at IS NULL
  WHERE
    b.facility_id = p_facility_id
    AND b.deleted_at IS NULL;

  SELECT
    v.version_number,
    v.effective_from,
    v.change_reason,
    v.activation_reason INTO v_current_cadence_row
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = v_cadence;

  SELECT
    v.version_number,
    v.effective_from INTO v_current_escalation_row
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = v_escalation;

  IF p_proposed_cadence_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_cadence_versions WHERE id=p_proposed_cadence_version_id AND facility_id=p_facility_id AND deleted_at IS NULL)
   OR p_proposed_escalation_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_escalation_versions WHERE id=p_proposed_escalation_version_id AND facility_id=p_facility_id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The proposed configuration belongs to another building' USING ERRCODE='42501'; END IF;
  v_configuration:=haven.observation_configuration_for_version(p_facility_id,v_cadence);
  SELECT coalesce(jsonb_agg(jsonb_build_object('proposal_id',q.proposal_id,'cadence_version_id',q.cadence_id,'escalation_version_id',q.escalation_id,
   'change_reason',q.change_reason,'created_at',q.created_at,'created_by_name',coalesce(up.full_name,'Administrator')) ORDER BY q.created_at DESC),'[]'::jsonb) INTO v_pending
  FROM (
   SELECT coalesce(c.proposal_id,e.proposal_id,c.id,e.id) AS proposal_id,c.id AS cadence_id,e.id AS escalation_id,
    coalesce(c.change_reason,e.change_reason) AS change_reason,coalesce(c.created_at,e.created_at) AS created_at,coalesce(c.created_by,e.created_by) AS created_by
   FROM (SELECT * FROM public.facility_cadence_versions WHERE facility_id=p_facility_id AND status IN('draft','pending_approval') AND deleted_at IS NULL) c
   FULL JOIN (SELECT * FROM public.facility_escalation_versions WHERE facility_id=p_facility_id AND status IN('draft','pending_approval') AND deleted_at IS NULL) e
    ON c.proposal_id=e.proposal_id AND c.proposal_id IS NOT NULL
  ) q LEFT JOIN public.user_profiles up ON up.id=q.created_by;
  RETURN jsonb_build_object('available_staff_roles',(SELECT jsonb_agg(jsonb_build_object('staff_role',role_name,'holder_count',(SELECT count(*) FROM public.staff st WHERE st.facility_id=p_facility_id AND st.staff_role=role_name AND st.employment_status='active' AND st.deleted_at IS NULL))) FROM unnest(enum_range(NULL::public.staff_role)) role_name),
 'available_channels',(SELECT jsonb_agg(channel ORDER BY channel) FROM (SELECT DISTINCT unnest(channels) channel FROM public.facility_escalation_rungs WHERE organization_id=v_org AND deleted_at IS NULL) ch),
 'available_severity_classes',(SELECT jsonb_agg(severity_class ORDER BY severity_class) FROM (SELECT DISTINCT severity_class FROM public.watchlist_signal_rules WHERE organization_id=v_org AND deleted_at IS NULL) sc),
 'roster_shift_types',to_jsonb(enum_range(NULL::public.shift_type)),
 'configuration',v_configuration,'pending_proposals',v_pending,'facility_id' , p_facility_id, 'facility_name', v_facility_name, 'timezone', v_tz, 'active_resident_count', v_active_residents, 'shifts', v_shifts, 'cadence_template_id', v_binding.cadence_template_id, 'cadence_template_name', v_binding.cadence_template_name, 'escalation_template_id', v_binding.escalation_template_id, 'escalation_template_name', v_binding.escalation_template_name, 'jurisdiction_floor', public.facility_observation_jurisdiction_floor (p_facility_id), 'thresholds', (
      SELECT
        jsonb_build_object('maximum_unobserved_gap_minutes', t.maximum_unobserved_gap_minutes, 'maximum_windows_per_resident_per_day', t.maximum_windows_per_resident_per_day, 'simulation_lookback_days', t.simulation_lookback_days, 'change_log_page_size', t.change_log_page_size)
      FROM
        public.facility_observation_thresholds t
      WHERE
        t.facility_id = p_facility_id
        AND t.deleted_at IS NULL), 'current', jsonb_build_object('configuration',v_configuration,'cadence_version_id', v_cadence, 'cadence_version_number', v_current_cadence_row.version_number, 'cadence_effective_from', v_current_cadence_row.effective_from, 'cadence_change_reason', v_current_cadence_row.change_reason, 'escalation_version_id', v_escalation, 'escalation_version_number', v_current_escalation_row.version_number, 'escalation_effective_from', v_current_escalation_row.effective_from, 'day_shape', CASE WHEN v_cadence IS NULL THEN
        NULL
      ELSE
        public.cadence_version_day_shape (v_cadence)
      END, 'daily_task_total', CASE WHEN v_cadence IS NULL THEN
        NULL
      ELSE
        v_active_residents * (public.cadence_version_day_shape (v_cadence) ->> 'windows_per_day')::integer
      END, 'ladder', CASE WHEN v_escalation IS NULL THEN
        '[]'::jsonb
      ELSE
        public.observation_escalation_role_holders (p_facility_id, v_escalation)
      END), 'proposed', CASE WHEN p_proposed_cadence_version_id IS NULL AND p_proposed_escalation_version_id IS NULL THEN
      NULL
    ELSE
      jsonb_build_object('configuration',CASE WHEN p_proposed_cadence_version_id IS NULL THEN v_configuration ELSE haven.observation_configuration_for_version(p_facility_id,p_proposed_cadence_version_id) END,'cadence_version_id', p_proposed_cadence_version_id, 'escalation_version_id', p_proposed_escalation_version_id, 'day_shape', public.cadence_version_day_shape(coalesce(p_proposed_cadence_version_id,v_cadence)), 'daily_task_total', v_active_residents*(public.cadence_version_day_shape(coalesce(p_proposed_cadence_version_id,v_cadence))->>'windows_per_day')::integer, 'ladder', public.observation_escalation_role_holders(p_facility_id,coalesce(p_proposed_escalation_version_id,v_escalation)), 'validation', public.validate_cadence_version (p_proposed_cadence_version_id, p_proposed_escalation_version_id))
    END, 'next_shift_boundary_at', public.facility_next_shift_boundary_at (p_facility_id, now()));
END;
$func$;

CREATE OR REPLACE FUNCTION public.rollback_cadence_version (p_facility_id uuid, p_change_reason text, p_restore_cadence_version_id uuid DEFAULT NULL, p_restore_escalation_version_id uuid DEFAULT NULL, p_apply_mode text DEFAULT 'next_shift_boundary', p_effective_from timestamptz DEFAULT NULL, p_acknowledgment text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_windows jsonb := NULL;
  v_rungs jsonb := NULL;
  v_cadence_template uuid := NULL;
  v_escalation_template uuid := NULL;
  v_restore_cadence_number integer := NULL;
  v_restore_escalation_number integer := NULL;
  v_created jsonb;
  v_activated jsonb;
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'A rollback needs a reason. Say what is being undone and why'
      USING ERRCODE = '22023';
  END IF;

  IF p_restore_cadence_version_id IS NULL AND p_restore_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'A rollback needs the earlier cadence version, the earlier escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  IF NOT haven.can_edit_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Rolling an observation configuration back needs an organization administrator or the owner'
      USING ERRCODE = '42501';
  END IF;

  IF p_restore_cadence_version_id IS NOT NULL THEN
    SELECT
      v.version_number,
      v.source_template_id INTO v_restore_cadence_number,
      v_cadence_template
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_restore_cadence_version_id
      AND v.facility_id = p_facility_id
      AND v.deleted_at IS NULL;

    IF v_restore_cadence_number IS NULL THEN
      RAISE EXCEPTION 'That cadence version does not belong to this building'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'sort_order', w.sort_order, 'enabled', w.enabled)
        ORDER BY w.sort_order, w.due_at_local) INTO v_windows
    FROM
      public.facility_cadence_windows w
    WHERE
      w.cadence_version_id = p_restore_cadence_version_id
      AND w.deleted_at IS NULL;
  END IF;

  IF p_restore_escalation_version_id IS NOT NULL THEN
    SELECT
      v.version_number,
      v.source_template_id INTO v_restore_escalation_number,
      v_escalation_template
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_restore_escalation_version_id
      AND v.facility_id = p_facility_id
      AND v.deleted_at IS NULL;

    IF v_restore_escalation_number IS NULL THEN
      RAISE EXCEPTION 'That escalation version does not belong to this building'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'target_staff_roles', to_jsonb (r.target_staff_roles), 'channels', to_jsonb (r.channels), 'protocol_text', r.protocol_text, 'sort_order', r.sort_order, 'enabled', r.enabled, 'shift_overrides', COALESCE((
              SELECT
                jsonb_agg (jsonb_build_object('shift_key', ov.shift_key, 'offset_minutes', ov.offset_minutes, 'channels', to_jsonb (ov.channels)))
              FROM public.facility_escalation_rung_shift_overrides ov
              WHERE
                ov.escalation_rung_id = r.id
                AND ov.deleted_at IS NULL), '[]'::jsonb))
        ORDER BY r.sort_order, r.rung_key) INTO v_rungs
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = p_restore_escalation_version_id
      AND r.deleted_at IS NULL;
  END IF;

  v_created := public.create_cadence_version (p_facility_id := p_facility_id, p_change_reason := format('Rollback to %s. %s', trim(concat_ws(' and ', CASE WHEN v_restore_cadence_number IS NOT NULL THEN
          format('cadence version %s', v_restore_cadence_number)
        END, CASE WHEN v_restore_escalation_number IS NOT NULL THEN
          format('escalation version %s', v_restore_escalation_number)
        END)), p_change_reason), p_windows := v_windows, p_escalation_rungs := v_rungs, p_effective_from := p_effective_from, p_source_cadence_template_id := v_cadence_template, p_source_escalation_template_id := v_escalation_template,p_configuration := CASE WHEN p_restore_cadence_version_id IS NULL THEN NULL ELSE haven.observation_configuration_for_version(p_facility_id,p_restore_cadence_version_id) END);

  v_activated := public.activate_cadence_version (p_change_reason := p_change_reason, p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := p_apply_mode, p_effective_from := p_effective_from, p_acknowledgment := p_acknowledgment);

  RETURN jsonb_build_object('facility_id', p_facility_id, 'restored_from_cadence_version_number', v_restore_cadence_number, 'restored_from_escalation_version_number', v_restore_escalation_number, 'created', v_created, 'activated', v_activated);
END;
$func$;
-- Retired policy rows remain readable as clinical evidence through signal FK joins.
DROP POLICY watchlist_signal_rules_select ON public.watchlist_signal_rules;
CREATE POLICY watchlist_signal_rules_select ON public.watchlist_signal_rules FOR SELECT
 USING(organization_id=haven.organization_id() AND (facility_id IS NULL OR haven.has_facility_access(facility_id)));
CREATE OR REPLACE FUNCTION public.observation_config_change_log (p_facility_id uuid, p_limit integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_limit integer;
  v_result jsonb;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Reading the observation configuration change log needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(p_limit, t.change_log_page_size) INTO v_limit
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;

  v_limit := COALESCE(v_limit, p_limit);

  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'The change log page size has to be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(jsonb_agg (entry ORDER BY created_at DESC, version_number DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      v.created_at,
      v.version_number,
      jsonb_build_object('configuration',haven.observation_configuration_for_version(p_facility_id,v.id),'previous_configuration',(SELECT haven.observation_configuration_for_version(p_facility_id,prev.id) FROM public.facility_cadence_versions prev WHERE prev.facility_id=p_facility_id AND prev.version_number<v.version_number AND prev.deleted_at IS NULL ORDER BY prev.version_number DESC LIMIT 1),'kind', 'cadence', 'version_id', v.id, 'version_number', v.version_number, 'status', v.status, 'effective_from', v.effective_from, 'effective_to', v.effective_to, 'change_reason', v.change_reason, 'activation_reason', v.activation_reason, 'apply_mode', v.apply_mode, 'created_at', v.created_at, 'created_by_name', cp.full_name, 'activated_at', v.activated_at, 'activated_by_name', ap.full_name, 'source_template_id', v.source_template_id, 'rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
              ORDER BY w.sort_order, w.due_at_local)
            FROM public.facility_cadence_windows w
            WHERE
              w.cadence_version_id = v.id
              AND w.deleted_at IS NULL), '[]'::jsonb), 'previous_rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'enabled', w.enabled)
              ORDER BY w.sort_order, w.due_at_local)
            FROM public.facility_cadence_windows w
            WHERE
              w.cadence_version_id = (
                SELECT
                  prev.id
                FROM
                  public.facility_cadence_versions prev
                WHERE
                  prev.facility_id = v.facility_id
                  AND prev.version_number < v.version_number
                  AND prev.deleted_at IS NULL
                ORDER BY
                  prev.version_number DESC
                LIMIT 1)
              AND w.deleted_at IS NULL), '[]'::jsonb)) AS entry
    FROM
      public.facility_cadence_versions v
      LEFT JOIN public.user_profiles cp ON cp.id = v.created_by
      LEFT JOIN public.user_profiles ap ON ap.id = v.activated_by
    WHERE
      v.facility_id = p_facility_id
      AND v.deleted_at IS NULL
    UNION ALL
    SELECT
      v.created_at,
      v.version_number,
      jsonb_build_object('kind', 'escalation', 'version_id', v.id, 'version_number', v.version_number, 'status', v.status, 'effective_from', v.effective_from, 'effective_to', v.effective_to, 'change_reason', v.change_reason, 'activation_reason', v.activation_reason, 'apply_mode', v.apply_mode, 'created_at', v.created_at, 'created_by_name', cp.full_name, 'activated_at', v.activated_at, 'activated_by_name', ap.full_name, 'source_template_id', v.source_template_id, 'rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'channels', to_jsonb (r.channels), 'target_staff_roles', to_jsonb (r.target_staff_roles), 'enabled', r.enabled,'sort_order',r.sort_order,'protocol_text',r.protocol_text,'assigned_staff_only',r.assigned_staff_only,'include_assigned_staff',r.include_assigned_staff,'use_standing_alert_routes',r.use_standing_alert_routes,'shift_overrides',(SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',o.shift_key,'offset_minutes',o.offset_minutes,'channels',o.channels) ORDER BY o.shift_key),'[]'::jsonb) FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_rung_id=r.id AND o.deleted_at IS NULL))
              ORDER BY r.sort_order, r.rung_key)
            FROM public.facility_escalation_rungs r
            WHERE
              r.escalation_version_id = v.id
              AND r.deleted_at IS NULL), '[]'::jsonb), 'previous_rows', COALESCE((
            SELECT
              jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'channels', to_jsonb (r.channels), 'target_staff_roles', to_jsonb (r.target_staff_roles), 'enabled', r.enabled,'sort_order',r.sort_order,'protocol_text',r.protocol_text,'assigned_staff_only',r.assigned_staff_only,'include_assigned_staff',r.include_assigned_staff,'use_standing_alert_routes',r.use_standing_alert_routes,'shift_overrides',(SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',o.shift_key,'offset_minutes',o.offset_minutes,'channels',o.channels) ORDER BY o.shift_key),'[]'::jsonb) FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_rung_id=r.id AND o.deleted_at IS NULL))
              ORDER BY r.sort_order, r.rung_key)
            FROM public.facility_escalation_rungs r
            WHERE
              r.escalation_version_id = (
                SELECT
                  prev.id
                FROM
                  public.facility_escalation_versions prev
                WHERE
                  prev.facility_id = v.facility_id
                  AND prev.version_number < v.version_number
                  AND prev.deleted_at IS NULL
                ORDER BY
                  prev.version_number DESC
                LIMIT 1)
              AND r.deleted_at IS NULL), '[]'::jsonb)) AS entry
    FROM
      public.facility_escalation_versions v
      LEFT JOIN public.user_profiles cp ON cp.id = v.created_by
      LEFT JOIN public.user_profiles ap ON ap.id = v.activated_by
    WHERE
      v.facility_id = p_facility_id
      AND v.deleted_at IS NULL
    ORDER BY
      1 DESC,
      2 DESC
    LIMIT v_limit) log;

  RETURN v_result;
END;
$func$;
CREATE OR REPLACE FUNCTION public.activate_cadence_version (p_change_reason text, p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL, p_apply_mode text DEFAULT 'next_shift_boundary', p_effective_from timestamptz DEFAULT NULL, p_acknowledgment text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility_id uuid;
  v_cadence_facility uuid;
  v_escalation_facility uuid;
  v_org uuid;
  v_facility_name text;
  v_actor uuid;
  v_validation jsonb;
  v_effective_from timestamptz;
  v_needs_ack boolean := FALSE;
  v_ack_reasons text[] := ARRAY[]::text[];
  v_cadence_result jsonb := NULL;
  v_escalation_result jsonb := NULL;
  v_cadence_template uuid;
  v_escalation_template uuid;
  v_now CONSTANT timestamptz := now();
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Putting an observation configuration change in force needs a reason. Say why it is happening now'
      USING ERRCODE = '22023';
  END IF;

  IF p_cadence_version_id IS NULL AND p_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'activate_cadence_version needs a cadence version, an escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  IF p_apply_mode NOT IN ('next_shift_boundary', 'scheduled', 'immediate') THEN
    RAISE EXCEPTION 'Unknown effective timing %. The three options are next_shift_boundary, scheduled and immediate', p_apply_mode
      USING ERRCODE = '22023';
  END IF;

  SELECT
    v.facility_id INTO v_cadence_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.id = p_cadence_version_id
    AND v.deleted_at IS NULL;

  SELECT
    v.facility_id INTO v_escalation_facility
  FROM
    public.facility_escalation_versions v
  WHERE
    v.id = p_escalation_version_id
    AND v.deleted_at IS NULL;

  IF p_cadence_version_id IS NOT NULL AND v_cadence_facility IS NULL THEN
    RAISE EXCEPTION 'Cadence version not found'
      USING ERRCODE = '22023';
  END IF;

  IF p_escalation_version_id IS NOT NULL AND v_escalation_facility IS NULL THEN
    RAISE EXCEPTION 'Escalation version not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_cadence_facility IS NOT NULL AND v_escalation_facility IS NOT NULL AND v_cadence_facility <> v_escalation_facility THEN
    RAISE EXCEPTION 'The cadence version and the escalation version belong to different buildings and cannot be activated as one change'
      USING ERRCODE = '22023';
  END IF;

  v_facility_id := COALESCE(v_cadence_facility, v_escalation_facility);

  IF NOT haven.can_edit_observation_config (v_facility_id) THEN
    RAISE EXCEPTION 'Putting an observation cadence or escalation change in force needs an organization administrator or the owner. A facility administrator proposes the change and somebody at the organization approves it'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.organization_id,
    f.name INTO v_org,
    v_facility_name
  FROM
    public.facilities f
  WHERE
    f.id = v_facility_id
    AND f.deleted_at IS NULL;

  SELECT
    p.id INTO v_actor
  FROM
    public.user_profiles p
  WHERE
    p.id = auth.uid ();

  PERFORM pg_advisory_xact_lock(hashtextextended(v_facility_id::text,0));
  PERFORM 1 FROM public.facility_cadence_versions WHERE id=p_cadence_version_id FOR UPDATE;
  PERFORM 1 FROM public.facility_escalation_versions WHERE id=p_escalation_version_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.facility_cadence_versions WHERE id=p_cadence_version_id AND status NOT IN('draft','pending_approval','scheduled'))
   OR EXISTS(SELECT 1 FROM public.facility_escalation_versions WHERE id=p_escalation_version_id AND status NOT IN('draft','pending_approval','scheduled')) THEN
    RAISE EXCEPTION 'An effective historical version cannot be rescheduled. Create a forward version or rollback instead' USING ERRCODE='22023'; END IF;

  -- The six hard blocks, enforced here and not only in the client. The errcode
  -- is 22023 and which code it is matters; the note above CREATE OR REPLACE
  -- says why, and review_smart_rounding_authority.sql refuses any other.
  v_validation := public.validate_cadence_version (p_cadence_version_id, p_escalation_version_id);

  IF (v_validation ->> 'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_validation -> 'blocks' -> 0 ->> 'message'
      USING ERRCODE = '22023';
  END IF;

  -- Effective timing, spec 6.4.
  IF p_apply_mode = 'next_shift_boundary' THEN
    v_effective_from := public.facility_next_shift_boundary_at (v_facility_id, v_now);
    IF v_effective_from IS NULL THEN
      RAISE EXCEPTION 'This building has no shift model, so there is no next shift boundary to take effect at. Schedule the change or apply it immediately'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_apply_mode = 'scheduled' THEN
    IF p_effective_from IS NULL THEN
      RAISE EXCEPTION 'A scheduled change needs the date and time it takes effect'
        USING ERRCODE = '22023';
    END IF;
    IF p_effective_from <= v_now THEN
      RAISE EXCEPTION 'A scheduled change has to take effect in the future. To change the board now, apply the change immediately and acknowledge it'
        USING ERRCODE = '22023';
    END IF;
    v_effective_from := p_effective_from;
    IF NOT public.facility_is_shift_boundary (v_facility_id, v_effective_from) THEN
      v_needs_ack := TRUE;
      v_ack_reasons := array_append(v_ack_reasons, 'the change lands part way through a shift rather than on a shift boundary'::text);
    END IF;
  ELSE
    v_effective_from := v_now;
    v_needs_ack := TRUE;
    v_ack_reasons := array_append(v_ack_reasons, 'the change applies immediately and cancels the pending checks on the current board'::text);
  END IF;

  IF jsonb_array_length(v_validation -> 'warnings') > 0 THEN
    v_needs_ack := TRUE;
    SELECT
      v_ack_reasons || array_agg((w ->> 'message')::text) INTO v_ack_reasons
    FROM
      jsonb_array_elements(v_validation -> 'warnings') w
    WHERE
      (w ->> 'requires_acknowledgment')::boolean;
  END IF;

  IF v_needs_ack AND (p_acknowledgment IS NULL OR lower(btrim(p_acknowledgment)) <> lower(btrim(v_facility_name))) THEN
    RAISE EXCEPTION 'This change needs a typed acknowledgment because %. Type the building name exactly to confirm', array_to_string(v_ack_reasons, ', and ')
      USING ERRCODE = '22023';
  END IF;

  -- A change that takes effect in the future is marked scheduled and left for
  -- the activator. Marking it active now with a future effective_from would
  -- close the outgoing version's effective_to at a date that has not arrived,
  -- so a second change needed before then would have nowhere in the timeline to
  -- go, and public.facility_cadence_in_force would be answering from a version
  -- nobody had reached yet. Migration 417 put draft, pending and scheduled
  -- outside the exclusion constraint for exactly this reason.
  --
  -- next_shift_boundary and scheduled are therefore both future dated and both
  -- land as scheduled; only immediate activates inside this call.
  IF v_effective_from > v_now THEN
    IF p_cadence_version_id IS NOT NULL THEN
      UPDATE
        public.facility_cadence_versions
      SET
        status = 'scheduled',
        effective_from = v_effective_from,
        activation_reason = p_change_reason,
        apply_mode = p_apply_mode,
        activated_by = COALESCE(v_actor, activated_by)
      WHERE
        id = p_cadence_version_id;
    END IF;

    IF p_escalation_version_id IS NOT NULL THEN
      UPDATE
        public.facility_escalation_versions
      SET
        status = 'scheduled',
        effective_from = v_effective_from,
        activation_reason = p_change_reason,
        apply_mode = p_apply_mode,
        activated_by = COALESCE(v_actor, activated_by)
      WHERE
        id = p_escalation_version_id;
    END IF;

    RETURN jsonb_build_object('facility_id', v_facility_id, 'apply_mode', p_apply_mode, 'effective_from', v_effective_from, 'scheduled', TRUE, 'in_force', FALSE, 'acknowledgment_required', v_needs_ack, 'cadence_version_id', p_cadence_version_id, 'escalation_version_id', p_escalation_version_id, 'warnings', v_validation -> 'warnings');
  END IF;

  -- Cadence first, so a combined change cannot leave an escalation version in
  -- force against a cadence that failed to activate.
  IF p_cadence_version_id IS NOT NULL THEN
    UPDATE
      public.facility_cadence_versions
    SET
      activation_reason = p_change_reason,
      apply_mode = p_apply_mode
    WHERE
      id = p_cadence_version_id;

    -- Cancellation is filtered to tasks due at or after effective_from that are
    -- still pending and have never had a rung fire, so an immediate apply
    -- clears the rest of the current shift and a boundary apply clears only
    -- what sits past the boundary. Nothing on the shift being worked right now
    -- moves under a boundary or scheduled change, which is what spec 6.4 means
    -- by "nothing on the current board changes".
    v_cadence_result := haven.apply_observation_config_activation ('cadence', p_cadence_version_id, v_effective_from, v_actor, TRUE);

    SELECT
      v.source_template_id INTO v_cadence_template
    FROM
      public.facility_cadence_versions v
    WHERE
      v.id = p_cadence_version_id;
  END IF;

  IF p_escalation_version_id IS NOT NULL THEN
    UPDATE
      public.facility_escalation_versions
    SET
      activation_reason = p_change_reason,
      apply_mode = p_apply_mode
    WHERE
      id = p_escalation_version_id;

    v_escalation_result := haven.apply_observation_config_activation ('escalation', p_escalation_version_id, v_effective_from, v_actor, FALSE);

    SELECT
      v.source_template_id INTO v_escalation_template
    FROM
      public.facility_escalation_versions v
    WHERE
      v.id = p_escalation_version_id;
  END IF;

  RETURN jsonb_build_object('facility_id', v_facility_id, 'apply_mode', p_apply_mode, 'effective_from', v_effective_from, 'scheduled', FALSE, 'in_force', TRUE, 'acknowledgment_required', v_needs_ack, 'cadence', v_cadence_result, 'escalation', v_escalation_result, 'on_cadence_template_id', v_cadence_template, 'on_escalation_template_id', v_escalation_template, 'warnings', v_validation -> 'warnings');
END;
$func$;
NOTIFY pgrst,'reload schema';
COMMENT ON FUNCTION public.create_cadence_version(uuid,text,jsonb,jsonb,timestamptz,uuid,uuid,jsonb) IS 'COL-37 ruling: definer required to create immutable version snapshots and children after direct mutation grants are revoked. Current-authority can_edit/can_propose gates facility access and chooses approval status before writes; actor and reason are audited.';
COMMIT;

-- Operational rollback / containment (execute only for a verified incident):
-- BEGIN;
-- REVOKE EXECUTE ON FUNCTION public.create_cadence_version(uuid,text,jsonb,jsonb,timestamptz,uuid,uuid,jsonb) FROM authenticated;
-- COMMIT;
-- Preserve all new history and assignments. Restore service with a reviewed
-- forward correction and the matching GRANT EXECUTE, not DROP or data deletion.
-- The release handoff records pre-change definitions and the recovery marker.
