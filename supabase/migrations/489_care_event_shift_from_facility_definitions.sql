-- COL-685: care events and the incidents they open carry the facility's
-- configured shift.
--
-- submit_care_event stamped care_events.shift, incidents.shift (and the
-- condition-change / behaviour rows it writes) from fixed 7a/3p/11p buckets, so
-- a 10 PM report at a 6a-6p / 6p-6a building was filed under "evening". It now
-- reads public.facility_shift_window_at(facility, occurred_at), which resolves
-- the facility_shift_definitions in force (417/436) and returns the roster enum
-- the definition maps to.
--
-- care_event_sync_witness_tasks then matched the roster on the calendar date of
-- occurred_at, so a 1 AM report found nobody on the night shift (dated the
-- evening before) and filed one unassigned witness row. It now matches the
-- shift's service date from the same window.
--
-- Both functions are re-created verbatim -- submit_care_event from
-- 468_role_consolidation.sql (hosted prosrc md5 92c0501778ab2dd5021eec8520bfb0b0)
-- and care_event_sync_witness_tasks from 414 (8084f149da253e867360d325f0b8b08a),
-- both matched on production before this was written -- with only those lines
-- changed. CREATE OR REPLACE keeps the grants, owners and definer rulings.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_care_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_client_event_id uuid;
  v_facility_id uuid;
  v_resident_id uuid;
  v_kind text;
  v_answers jsonb;
  v_note text;
  v_occurred_at timestamptz;
  v_location_code text;
  v_location_label text;
  v_captured_offline boolean;
  v_tz text;
  v_time_label text;
  v_hour integer;
  v_shift shift_type;
  v_existing record;
  v_context jsonb;
  v_derived jsonb;
  v_level integer;
  v_derived_level integer;
  v_final_level incident_severity;
  v_derived_sev incident_severity;
  v_category incident_category;
  v_flags jsonb;
  v_sentence text;
  v_worried boolean;
  v_care_event_id uuid;
  v_behavioral_log_id uuid;
  v_condition_change_id uuid;
  v_incident_id uuid;
  v_incident_number text;
  v_immediate_actions text;
  v_injury_occurred boolean;
  v_injury_severity text;
  v_injury_description text;
  v_where text;
  v_hurt text;
  v_what text;
  v_touched text;
  v_first_sign text;
  v_seen_labels text;
  v_proto record;
  v_due timestamptz;
  v_offset integer;
  v_assignee uuid;
  v_policy record;
  v_level_word text;
  v_tile_word text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'care_event: payload must be an object';
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  BEGIN
    v_client_event_id := (p_payload ->> 'client_event_id')::uuid;
    v_facility_id := (p_payload ->> 'facility_id')::uuid;
    v_resident_id := NULLIF(p_payload ->> 'resident_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'care_event: invalid identifier in payload';
  END;
  IF v_client_event_id IS NULL THEN
    RAISE EXCEPTION 'care_event: client_event_id required';
  END IF;
  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'care_event: facility_id required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = v_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL
  ) OR v_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  v_kind := p_payload ->> 'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('fall','injury_found','condition_change','behavior','wandering','medication','family_complaint','environment') THEN
    RAISE EXCEPTION 'care_event: unknown kind';
  END IF;

  IF v_resident_id IS NULL AND v_kind <> 'environment' THEN
    RAISE EXCEPTION 'care_event: resident required';
  END IF;
  IF v_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = v_resident_id AND r.facility_id = v_facility_id AND r.organization_id = v_org AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'care_event: resident not at facility';
  END IF;

  -- Idempotent replay: same organization and client_event_id returns the same receipt.
  SELECT ce.id, ce.final_level, ce.incident_id
    INTO v_existing
  FROM public.care_events ce
  WHERE ce.organization_id = v_org AND ce.client_event_id = v_client_event_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN public.care_event_receipt(v_existing.id, true);
  END IF;

  v_answers := CASE WHEN jsonb_typeof(p_payload -> 'answers') = 'object' THEN p_payload -> 'answers' ELSE '{}'::jsonb END;
  v_note := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_occurred_at := COALESCE(NULLIF(p_payload ->> 'occurred_at', '')::timestamptz, now());
  v_location_code := NULLIF(btrim(COALESCE(p_payload ->> 'location_code', '')), '');
  v_captured_offline := COALESCE((p_payload ->> 'captured_offline')::boolean, false);
  v_worried := lower(COALESCE(v_answers ->> 'worried', 'false')) = 'true';

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_facility_id;

  IF v_location_code IS NOT NULL THEN
    SELECT ov.display_label INTO v_location_label
    FROM public.observation_vocab ov
    WHERE ov.organization_id = v_org
      AND ov.field_name = 'location'
      AND ov.value_code = v_location_code
      AND ov.active
      AND ov.deleted_at IS NULL
      AND (ov.facility_id = v_facility_id OR ov.facility_id IS NULL)
    ORDER BY ov.facility_id NULLS LAST
    LIMIT 1;
  END IF;

  v_time_label := to_char(v_occurred_at AT TIME ZONE v_tz, 'FMHH12:MI AM');
  v_hour := EXTRACT(HOUR FROM (v_occurred_at AT TIME ZONE v_tz))::integer;
  -- COL-685: the facility's configured shift in force when it happened
  -- (facility_shift_window_at, the definitions the header and rounding read).
  -- The fixed 7/15/23 buckets stamped 'evening', a shift no building runs; they
  -- remain only for a facility with no shift definitions.
  v_shift := COALESCE(
    (SELECT w.roster_shift_type FROM public.facility_shift_window_at(v_facility_id, v_occurred_at) w),
    CASE WHEN v_hour >= 7 AND v_hour < 15 THEN 'day' WHEN v_hour >= 15 AND v_hour < 23 THEN 'evening' ELSE 'night' END::public.shift_type);

  v_context := jsonb_build_object(
    'active_watch', v_resident_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.resident_watch_instances w
      WHERE w.resident_id = v_resident_id
        AND w.deleted_at IS NULL
        AND w.status IN ('active','pending_approval')
        AND (w.ends_at IS NULL OR w.ends_at > now())),
    'elopement_risk', COALESCE((SELECT r.elopement_risk FROM public.residents r WHERE r.id = v_resident_id), false),
    'prior_unexplained_bruise_30d', v_resident_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.care_events ce
        WHERE ce.resident_id = v_resident_id
          AND ce.category = 'unexplained_bruise'
          AND ce.deleted_at IS NULL
          AND ce.occurred_at >= v_occurred_at - interval '30 days'
          AND ce.client_event_id <> v_client_event_id)
      OR EXISTS (
        SELECT 1 FROM public.incidents i
        WHERE i.resident_id = v_resident_id
          AND i.category = 'unexplained_bruise'
          AND i.deleted_at IS NULL
          AND i.occurred_at >= v_occurred_at - interval '30 days')),
    'location_label', v_location_label,
    'time_label', v_time_label
  );

  v_derived := public.care_event_derive(v_kind, v_answers, v_context);
  v_level := (v_derived ->> 'level')::integer;
  v_derived_level := (v_derived ->> 'derived_level')::integer;
  v_final_level := ('level_' || v_level)::incident_severity;
  v_derived_sev := ('level_' || v_derived_level)::incident_severity;
  v_category := (v_derived ->> 'category')::incident_category;
  v_flags := v_derived -> 'flags';
  v_sentence := v_derived ->> 'sentence';

  INSERT INTO public.care_events (
    organization_id, facility_id, resident_id, client_event_id, kind, answers,
    derived_level, final_level, level_bumped_by_reporter, category, flags, sentence, note,
    occurred_at, discovered_at, shift, location_code, reported_by, captured_offline
  ) VALUES (
    v_org, v_facility_id, v_resident_id, v_client_event_id, v_kind, v_answers,
    v_derived_sev, v_final_level, v_worried, v_category, v_flags, v_sentence, v_note,
    v_occurred_at, now(), v_shift, v_location_code, v_uid, v_captured_offline
  )
  RETURNING id INTO v_care_event_id;

  v_hurt := v_answers ->> 'hurt';
  v_what := v_answers ->> 'what';
  v_touched := v_answers ->> 'touched';
  v_where := v_answers ->> 'where';

  -- ---- behavioral_logs ----------------------------------------------------
  IF v_kind = 'behavior' THEN
    INSERT INTO public.behavioral_logs (
      resident_id, facility_id, organization_id, occurred_at, shift, logged_by,
      behavior, behavior_type, injury_occurred, involved_staff, notes
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_occurred_at, v_shift, v_uid,
      v_sentence, COALESCE(v_what, 'other'),
      v_touched IS NOT NULL AND v_touched <> 'no_one',
      CASE WHEN v_touched = 'staff' THEN '{}'::uuid[] ELSE NULL END,
      v_note
    )
    RETURNING id INTO v_behavioral_log_id;
    UPDATE public.care_events SET behavioral_log_id = v_behavioral_log_id WHERE id = v_care_event_id;
  END IF;

  -- ---- condition_changes (BEFORE INSERT trigger raises the care plan alert)
  IF v_kind = 'condition_change' THEN
    SELECT x INTO v_first_sign
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_answers -> 'signs') = 'array' THEN v_answers -> 'signs' ELSE '[]'::jsonb END) AS t(x)
    LIMIT 1;
    INSERT INTO public.condition_changes (
      resident_id, facility_id, organization_id, reported_at, reported_by, shift,
      change_type, description, severity
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_occurred_at, v_uid, v_shift,
      COALESCE(v_first_sign, 'not_themselves'), v_sentence,
      CASE WHEN v_level >= 4 THEN 'severe' WHEN v_level = 3 THEN 'moderate' ELSE 'mild' END
    )
    RETURNING id INTO v_condition_change_id;
    UPDATE public.care_events SET condition_change_id = v_condition_change_id WHERE id = v_care_event_id;
  END IF;

  -- ---- incidents for Level 2 and above --------------------------------------
  IF v_level >= 2 THEN
    v_incident_number := public.allocate_incident_number(v_facility_id);

    v_immediate_actions := CASE
      WHEN v_kind = 'fall' AND v_answers ->> 'going_out' = 'yes' THEN 'Emergency care requested.'
      WHEN v_kind = 'fall' AND v_hurt = 'badly' THEN 'Emergency care requested.'
      WHEN v_kind = 'fall' AND v_hurt = 'a_little' THEN 'First aid given.'
      WHEN v_kind = 'medication' AND v_answers ->> 'reaction' = 'yes' THEN 'Administrator alerted for medical follow-up.'
      WHEN v_kind = 'wandering' AND v_where = 'not_found' THEN 'Search started and Administrator alerted.'
      ELSE 'Resident checked and made safe. Administrator alerted.'
    END;

    v_injury_occurred := CASE
      WHEN v_kind = 'fall' THEN v_hurt IS NOT NULL AND v_hurt <> 'not_hurt'
      WHEN v_kind = 'injury_found' THEN true
      WHEN v_kind = 'wandering' THEN COALESCE(v_hurt = 'yes', false)
      WHEN v_kind = 'behavior' THEN v_touched IS NOT NULL AND v_touched <> 'no_one'
      ELSE false
    END;

    v_injury_severity := CASE
      WHEN v_kind = 'fall' AND v_hurt = 'a_little' THEN 'minor'
      WHEN v_kind = 'fall' AND v_hurt = 'badly' THEN 'major'
      WHEN v_kind = 'injury_found' AND v_answers ->> 'care' = 'first_aid_enough' THEN 'minor'
      WHEN v_kind = 'injury_found' AND v_answers ->> 'care' = 'more_than_first_aid' THEN 'major'
      ELSE NULL
    END;

    IF v_kind = 'injury_found' AND jsonb_typeof(v_answers -> 'seen') = 'array' THEN
      SELECT string_agg(CASE x
        WHEN 'bruise' THEN 'bruise'
        WHEN 'skin_tear' THEN 'skin tear or cut'
        WHEN 'burn' THEN 'burn'
        WHEN 'swelling_pain' THEN 'swelling or pain'
        WHEN 'other' THEN 'other' END, ', ' ORDER BY ord)
        INTO v_seen_labels
      FROM jsonb_array_elements_text(v_answers -> 'seen') WITH ORDINALITY AS t(x, ord)
      WHERE x IN ('bruise','skin_tear','burn','swelling_pain','other');
      v_injury_description := v_seen_labels;
    END IF;

    INSERT INTO public.incidents (
      resident_id, facility_id, organization_id, incident_number, category, severity, status,
      occurred_at, discovered_at, shift, location_description, location_type,
      description, immediate_actions,
      fall_witnessed, injury_occurred, injury_severity, injury_description,
      elopement_last_seen_at, elopement_found_at, elopement_found_location, elopement_outcome,
      reported_by, created_by, ahca_reportable, insurance_reportable, regulatory_flags
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_incident_number, v_category, v_final_level, 'open',
      v_occurred_at, now(), v_shift, COALESCE(v_location_label, 'Not specified'), v_location_code,
      v_sentence || CASE WHEN v_note IS NOT NULL THEN E'\n\nStaff note: ' || v_note ELSE '' END,
      v_immediate_actions,
      CASE WHEN v_kind = 'fall' THEN CASE v_answers ->> 'witnessed' WHEN 'yes' THEN true WHEN 'no' THEN false ELSE NULL END ELSE NULL END,
      v_injury_occurred, v_injury_severity, v_injury_description,
      CASE WHEN v_kind = 'wandering' THEN v_occurred_at ELSE NULL END,
      CASE WHEN v_kind = 'wandering' AND v_where IN ('found_inside','found_grounds','found_off_property') THEN now() ELSE NULL END,
      CASE WHEN v_kind = 'wandering' THEN CASE v_where
        WHEN 'found_inside' THEN 'Inside'
        WHEN 'found_grounds' THEN 'Outside on the grounds'
        WHEN 'found_off_property' THEN 'Off the property'
        ELSE NULL END ELSE NULL END,
      CASE WHEN v_kind = 'wandering' THEN v_where ELSE NULL END,
      v_uid, v_uid,
      COALESCE((v_flags ->> 'ahca_reportable')::boolean, false),
      COALESCE((v_flags ->> 'insurance_reportable')::boolean, false),
      v_flags
    )
    RETURNING id INTO v_incident_id;

    UPDATE public.care_events SET incident_id = v_incident_id WHERE id = v_care_event_id;
    IF v_condition_change_id IS NOT NULL THEN
      UPDATE public.condition_changes SET linked_incident_id = v_incident_id WHERE id = v_condition_change_id;
    END IF;

    -- ---- incident_followups from incident_followup_protocols ---------------
    FOR v_proto IN
      SELECT p.*
      FROM public.incident_followup_protocols p
      WHERE p.is_active
        AND p.deleted_at IS NULL
        AND p.organization_id = v_org
        AND (p.facility_id = v_facility_id OR p.facility_id IS NULL)
        AND (p.kind = v_kind OR p.kind = 'any')
        AND p.min_level <= v_final_level
        AND (p.requires_flag IS NULL OR v_flags ->> p.requires_flag = 'true')
        AND NOT (
          p.facility_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.incident_followup_protocols q
            WHERE q.is_active AND q.deleted_at IS NULL
              AND q.organization_id = v_org
              AND q.facility_id = v_facility_id
              AND q.task_type = p.task_type
              AND (q.kind = v_kind OR q.kind = 'any')
              AND q.min_level <= v_final_level
              AND (q.requires_flag IS NULL OR v_flags ->> q.requires_flag = 'true')))
      ORDER BY p.due_offset_minutes, p.task_type
    LOOP
      v_assignee := CASE v_proto.assign_to_role
        WHEN 'reporter' THEN v_uid
        WHEN 'caregiver' THEN v_uid
        WHEN 'med_tech' THEN v_uid
        ELSE NULL END;

      -- Section 3 of the paper form. One task per staff member on that shift at
      -- that facility, never the reporter: the reporter already gave the account
      -- the event is built from, and a witness statement asking them whether they
      -- saw what they just reported is noise on the floor and a false corroboration
      -- on the printed form. The whole rule lives in care_event_sync_witness_tasks
      -- so the administrator's add and remove path creates identical rows (COL-354).
      IF v_proto.task_type = 'witness_statement' THEN
        PERFORM public.care_event_sync_witness_tasks(v_care_event_id);
        CONTINUE;
      END IF;

      IF v_proto.repeat_every_minutes IS NOT NULL AND v_proto.repeat_every_minutes > 0 THEN
        v_offset := v_proto.due_offset_minutes;
        WHILE v_offset <= COALESCE(v_proto.repeat_until_minutes, v_proto.due_offset_minutes) LOOP
          INSERT INTO public.incident_followups (
            incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
          ) VALUES (
            v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type, v_proto.description,
            v_occurred_at + make_interval(mins => v_offset), v_assignee
          );
          v_offset := v_offset + v_proto.repeat_every_minutes;
        END LOOP;
      ELSE
        INSERT INTO public.incident_followups (
          incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
        ) VALUES (
          v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type, v_proto.description,
          v_occurred_at + make_interval(mins => v_proto.due_offset_minutes), v_assignee
        );
      END IF;
    END LOOP;

    -- ---- regulatory_reporting_obligations when the flags say AHCA ----------
    IF COALESCE((v_flags ->> 'ahca_reportable')::boolean, false) THEN
      PERFORM public.care_event_create_ahca_obligations(v_incident_id, v_facility_id, v_org, v_occurred_at, v_tz);
    END IF;

    -- ---- exec_alerts row for the in-app feed (no resident name; entity_id is the legal entity)
    v_level_word := CASE v_level WHEN 2 THEN 'Heads-up' WHEN 3 THEN 'Urgent' ELSE 'Emergency' END;
    v_tile_word := CASE v_kind
      WHEN 'fall' THEN 'Fall'
      WHEN 'injury_found' THEN 'Hurt'
      WHEN 'condition_change' THEN 'Sick or not themselves'
      WHEN 'behavior' THEN 'Upset or behavior'
      WHEN 'wandering' THEN 'Wandering or left'
      WHEN 'medication' THEN 'Medicine'
      WHEN 'family_complaint' THEN 'Family or complaint'
      ELSE 'Building or other' END;
    INSERT INTO public.exec_alerts (
      organization_id, source_module, severity, title, body, entity_id, facility_id,
      deep_link_path, category, status
    ) VALUES (
      v_org, 'incidents',
      (CASE v_level WHEN 2 THEN 'info' WHEN 3 THEN 'warning' ELSE 'critical' END)::exec_alert_severity,
      v_level_word || ' ' || v_tile_word, v_incident_number,
      (SELECT f.entity_id FROM public.facilities f WHERE f.id = v_facility_id), v_facility_id,
      '/admin/care-events/' || v_care_event_id::text, 'care_event', 'open'
    );

    -- ---- deliveries: step rows whose after_minutes = 0 ----------------------
    FOR v_policy IN
      SELECT * FROM public.care_event_applicable_policies(v_org, v_facility_id, v_final_level)
      WHERE after_minutes = 0
      ORDER BY step
    LOOP
      PERFORM public.care_event_expand_targets(v_care_event_id, v_policy.id);
    END LOOP;
  END IF;

  RETURN public.care_event_receipt(v_care_event_id, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.care_event_sync_witness_tasks(p_care_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_incident record;
  v_tz text;
  v_proto record;
  v_user uuid;
  v_added integer := 0;
BEGIN
  SELECT ce.* INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL OR v_event.incident_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT i.incident_number INTO v_incident
  FROM public.incidents i WHERE i.id = v_event.incident_id;

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM public.facilities f WHERE f.id = v_event.facility_id;

  -- The facility row wins over the organization default, as everywhere else.
  SELECT p.* INTO v_proto
  FROM public.incident_followup_protocols p
  WHERE p.is_active AND p.deleted_at IS NULL
    AND p.organization_id = v_event.organization_id
    AND (p.facility_id = v_event.facility_id OR p.facility_id IS NULL)
    AND p.task_type = 'witness_statement'
    AND p.min_level <= v_event.final_level
  ORDER BY p.facility_id NULLS LAST
  LIMIT 1;
  IF v_proto.id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_user IN
    SELECT DISTINCT s.user_id
    FROM public.shift_assignments sa
    JOIN public.staff s ON s.id = sa.staff_id AND s.deleted_at IS NULL
    WHERE sa.facility_id = v_event.facility_id
      AND sa.deleted_at IS NULL
      -- The shift's own service date: at 1 AM the night shift's roster is dated the
      -- evening it began, not the calendar day (COL-685).
      AND sa.shift_date = COALESCE(
        (SELECT w.shift_service_date FROM public.facility_shift_window_at(v_event.facility_id, v_event.occurred_at) w),
        (v_event.occurred_at AT TIME ZONE v_tz)::date)
      AND sa.shift_type = v_event.shift
      AND sa.status NOT IN ('called_out','no_show')
      AND s.user_id IS NOT NULL
      -- Never the reporter. Their account is the event.
      AND s.user_id <> v_event.reported_by
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.incident_followups f
      WHERE f.incident_id = v_event.incident_id
        AND f.task_type = 'witness_statement'
        AND f.assigned_to = v_user
        AND f.deleted_at IS NULL
    );
    INSERT INTO public.incident_followups (
      incident_id, resident_id, facility_id, organization_id,
      task_type, description, due_at, assigned_to
    ) VALUES (
      v_event.incident_id, v_event.resident_id, v_event.facility_id, v_event.organization_id,
      'witness_statement',
      format('Witness statement for %s', COALESCE(v_incident.incident_number, 'this incident')),
      v_event.occurred_at + make_interval(mins => v_proto.due_offset_minutes),
      v_user
    );
    v_added := v_added + 1;
  END LOOP;

  -- Nobody else on shift. Leave one unassigned row so the administrator can see
  -- that Section 3 was considered and name a witness by hand.
  IF v_added = 0 AND NOT EXISTS (
    SELECT 1 FROM public.incident_followups f
    WHERE f.incident_id = v_event.incident_id
      AND f.task_type = 'witness_statement'
      AND f.deleted_at IS NULL
  ) THEN
    INSERT INTO public.incident_followups (
      incident_id, resident_id, facility_id, organization_id,
      task_type, description, due_at, assigned_to
    ) VALUES (
      v_event.incident_id, v_event.resident_id, v_event.facility_id, v_event.organization_id,
      'witness_statement',
      format('Witness statement for %s', COALESCE(v_incident.incident_number, 'this incident')),
      v_event.occurred_at + make_interval(mins => v_proto.due_offset_minutes),
      NULL
    );
    v_added := 1;
  END IF;

  RETURN v_added;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
