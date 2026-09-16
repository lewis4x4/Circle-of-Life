-- 07A "Something happened" capture: the level engine mirror, the submit
-- fan-out, acknowledgment, the administrator completion form, the escalation
-- tick, and the two views (resident timeline, incident reports log).
--
-- Spec: docs/specs/07A-something-happened-capture.md sections 3, 4, 5, 6.2.
-- Binding parity contract: docs/specs/07A-level-engine-contract.md. Every case
-- in src/lib/care-events/level-cases.json must produce byte-identical level,
-- derived_level, category, flags and sentence from care_event_derive and the
-- TypeScript engine; scripts/care-events/verify-level-parity.mjs diffs them.
--
-- No Florida timer lives in this file except the AHCA one business day and
-- fifteen day report clocks, which the spec places on
-- regulatory_reporting_obligations under jurisdiction FL_AHCA. Every other
-- timer comes from care_event_escalation_policies and
-- incident_followup_protocols (403 seeds the organization default).
--
-- No named person appears in this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. care_event_derive: pure, IMMUTABLE, reads no table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_derive(p_kind text, p_answers jsonb, p_context jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  a jsonb := CASE WHEN p_answers IS NOT NULL AND pg_catalog.jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  c jsonb := CASE WHEN p_context IS NOT NULL AND pg_catalog.jsonb_typeof(p_context) = 'object' THEN p_context ELSE '{}'::jsonb END;
  v_level integer;
  v_derived integer;
  v_category text;
  v_worried boolean := pg_catalog.lower(coalesce(a ->> 'worried', 'false')) = 'true';
  v_active_watch boolean := pg_catalog.lower(coalesce(c ->> 'active_watch', 'false')) = 'true';
  v_elopement_risk boolean := pg_catalog.lower(coalesce(c ->> 'elopement_risk', 'false')) = 'true';
  v_prior_bruise boolean := pg_catalog.lower(coalesce(c ->> 'prior_unexplained_bruise_30d', 'false')) = 'true';
  v_location_label text := nullif(c ->> 'location_label', '');
  v_time_label text := nullif(c ->> 'time_label', '');
  v_loc text := '';
  v_time text := '';
  -- single-select answers
  v_hurt text := a ->> 'hurt';
  v_head text := a ->> 'head';
  v_witnessed text := a ->> 'witnessed';
  v_going_out text := a ->> 'going_out';
  v_care text := a ->> 'care';
  v_cause_known text := a ->> 'cause_known';
  v_onset text := a ->> 'onset';
  v_what text := a ->> 'what';
  v_touched text := a ->> 'touched';
  v_over text := a ->> 'over';
  v_where text := a ->> 'where';
  v_reaction text := a ->> 'reaction';
  v_danger text := a ->> 'danger';
  -- multi-select answers (non-array becomes empty)
  v_seen text[] := '{}';
  v_signs text[] := '{}';
  v_seen_labels text[] := '{}';
  v_signs_labels text[] := '{}';
  v_sign_count integer := 0;
  v_item text;
  v_parts text[] := '{}';
  v_sentence text;
  v_flags jsonb;
  v_ahca boolean;
  v_insurance boolean;
  v_dcf boolean;
  v_grievance boolean;
  v_neuro boolean;
  v_call_911 boolean;
  v_photo boolean;
  v_emar boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('fall','injury_found','condition_change','behavior','wandering','medication','family_complaint','environment') THEN
    RAISE EXCEPTION 'care_event: unknown kind %', coalesce(p_kind, '<null>');
  END IF;

  IF pg_catalog.jsonb_typeof(a -> 'seen') = 'array' THEN
    SELECT coalesce(pg_catalog.array_agg(x), '{}') INTO v_seen
    FROM pg_catalog.jsonb_array_elements_text(a -> 'seen') AS t(x);
  END IF;
  IF pg_catalog.jsonb_typeof(a -> 'signs') = 'array' THEN
    SELECT coalesce(pg_catalog.array_agg(x), '{}') INTO v_signs
    FROM pg_catalog.jsonb_array_elements_text(a -> 'signs') AS t(x);
  END IF;

  -- Labels in display order (contract section 7), ignoring unknown values.
  FOREACH v_item IN ARRAY ARRAY['bruise','skin_tear','burn','swelling_pain','other'] LOOP
    IF v_item = ANY (v_seen) THEN
      v_seen_labels := v_seen_labels || CASE v_item
        WHEN 'bruise' THEN 'bruise'
        WHEN 'skin_tear' THEN 'skin tear or cut'
        WHEN 'burn' THEN 'burn'
        WHEN 'swelling_pain' THEN 'swelling or pain'
        ELSE 'other' END;
    END IF;
  END LOOP;
  FOREACH v_item IN ARRAY ARRAY['confused','weak_dizzy','fever_chills','vomiting_diarrhea','not_eating_drinking','pain','short_of_breath','chest_pain','stroke_signs','wont_wake'] LOOP
    IF v_item = ANY (v_signs) THEN
      v_sign_count := v_sign_count + 1;
      v_signs_labels := v_signs_labels || CASE v_item
        WHEN 'confused' THEN 'more confused than usual'
        WHEN 'weak_dizzy' THEN 'weak or dizzy'
        WHEN 'fever_chills' THEN 'fever or chills'
        WHEN 'vomiting_diarrhea' THEN 'vomiting or diarrhea'
        WHEN 'not_eating_drinking' THEN 'not eating or drinking'
        WHEN 'pain' THEN 'pain'
        WHEN 'short_of_breath' THEN 'short of breath'
        WHEN 'chest_pain' THEN 'chest pain'
        WHEN 'stroke_signs' THEN 'face droop, slurred speech, or one weak side'
        ELSE 'will not wake up or very hard to wake' END;
    END IF;
  END LOOP;

  -- ---- Section 4: level -------------------------------------------------
  v_level := CASE p_kind WHEN 'fall' THEN 2 WHEN 'condition_change' THEN 2 ELSE 1 END;

  IF p_kind = 'fall' THEN
    IF v_hurt = 'badly' THEN v_level := greatest(v_level, 4); END IF;
    IF v_hurt = 'a_little' THEN v_level := greatest(v_level, 2); END IF;
    IF v_head IN ('yes','not_sure') THEN v_level := greatest(v_level, 3); END IF;
    IF v_going_out = 'yes' THEN v_level := greatest(v_level, 4); END IF;
    IF v_active_watch THEN v_level := v_level + 1; END IF;
  ELSIF p_kind = 'injury_found' THEN
    IF v_care = 'more_than_first_aid' THEN v_level := greatest(v_level, 3); END IF;
    IF v_cause_known = 'no' THEN v_level := greatest(v_level, 2); END IF;
    IF v_prior_bruise AND v_cause_known = 'no' AND 'bruise' = ANY (v_seen) THEN v_level := greatest(v_level, 3); END IF;
  ELSIF p_kind = 'condition_change' THEN
    IF 'short_of_breath' = ANY (v_signs) OR 'chest_pain' = ANY (v_signs) OR 'stroke_signs' = ANY (v_signs) OR 'wont_wake' = ANY (v_signs) THEN
      v_level := greatest(v_level, 4);
    ELSIF v_sign_count >= 2 THEN
      v_level := greatest(v_level, 3);
    ELSIF v_sign_count = 1 THEN
      v_level := greatest(v_level, 2);
    END IF;
    IF v_active_watch THEN v_level := v_level + 1; END IF;
  ELSIF p_kind = 'behavior' THEN
    IF v_what = 'self_harm' THEN v_level := greatest(v_level, 3); END IF;
    IF v_touched = 'another_resident' THEN v_level := greatest(v_level, 3); END IF;
    IF v_touched = 'staff' THEN v_level := greatest(v_level, 2); END IF;
    IF v_over = 'still_going' THEN v_level := greatest(v_level, 2); END IF;
  ELSIF p_kind = 'wandering' THEN
    IF v_where = 'found_inside' THEN v_level := greatest(v_level, 1); END IF;
    IF v_where = 'found_grounds' THEN v_level := greatest(v_level, 2); END IF;
    IF v_where = 'found_off_property' THEN v_level := greatest(v_level, 3); END IF;
    IF v_where = 'not_found' THEN v_level := greatest(v_level, 4); END IF;
    IF v_hurt = 'yes' THEN v_level := v_level + 1; END IF;
    IF v_elopement_risk THEN v_level := v_level + 1; END IF;
  ELSIF p_kind = 'medication' THEN
    IF v_what = 'refused' THEN v_level := greatest(v_level, 1); END IF;
    IF v_what = 'missed_late' THEN v_level := greatest(v_level, 2); END IF;
    IF v_what IN ('wrong','not_theirs') THEN v_level := greatest(v_level, 3); END IF;
    IF v_reaction = 'yes' THEN v_level := greatest(v_level, 4); END IF;
  ELSIF p_kind = 'family_complaint' THEN
    IF v_what = 'mistreated' THEN v_level := greatest(v_level, 3); END IF;
    IF v_what = 'resident_complaint' THEN v_level := greatest(v_level, 2); END IF;
  ELSIF p_kind = 'environment' THEN
    IF v_what = 'smoke_fire' THEN v_level := greatest(v_level, 4); END IF;
    IF v_what IN ('water_leak','power_out') THEN v_level := greatest(v_level, 2); END IF;
    IF v_danger = 'yes' THEN v_level := greatest(v_level, 4); END IF;
  END IF;

  v_derived := least(4, greatest(1, v_level));
  v_level := v_derived + CASE WHEN v_worried THEN 1 ELSE 0 END;
  v_level := least(4, greatest(1, v_level));

  -- ---- Section 5: category ---------------------------------------------
  v_category := CASE p_kind
    WHEN 'fall' THEN CASE WHEN v_hurt IS NULL OR v_hurt = 'not_hurt' THEN 'fall_without_injury' ELSE 'fall_with_injury' END
    WHEN 'injury_found' THEN CASE
      WHEN v_cause_known = 'no' AND 'bruise' = ANY (v_seen) THEN 'unexplained_bruise'
      WHEN 'bruise' = ANY (v_seen) OR 'skin_tear' = ANY (v_seen) OR 'burn' = ANY (v_seen) OR 'swelling_pain' = ANY (v_seen) THEN 'skin_integrity'
      ELSE 'other' END
    WHEN 'condition_change' THEN 'other'
    WHEN 'behavior' THEN CASE
      WHEN v_what = 'self_harm' THEN 'behavioral_self_harm'
      WHEN v_touched = 'another_resident' THEN 'behavioral_resident_to_resident'
      WHEN v_touched = 'staff' THEN 'behavioral_resident_to_staff'
      ELSE 'other' END
    WHEN 'wandering' THEN CASE WHEN v_where IN ('found_off_property','not_found') THEN 'elopement' ELSE 'wandering' END
    WHEN 'medication' THEN CASE WHEN v_what = 'refused' THEN 'medication_refusal' ELSE 'medication_error' END
    WHEN 'family_complaint' THEN CASE WHEN v_what = 'mistreated' THEN 'abuse_allegation' ELSE 'other' END
    WHEN 'environment' THEN CASE v_what
      WHEN 'smoke_fire' THEN 'environmental_fire'
      WHEN 'water_leak' THEN 'environmental_flood'
      WHEN 'power_out' THEN 'environmental_power'
      WHEN 'broken_equipment' THEN 'property_damage'
      WHEN 'missing_damaged' THEN 'property_loss'
      ELSE 'other' END
  END;

  -- ---- Section 6: flags (from the final level and the category) ----------
  -- Spec 07A section 3: Level 4 alone qualifies only for fall and condition_change;
  -- wandering, medication and environment need their own answer.
  v_ahca := (v_level = 4 AND p_kind IN ('fall','condition_change'))
            OR (p_kind = 'wandering' AND v_where = 'not_found')
            OR (p_kind = 'medication' AND v_reaction = 'yes')
            OR (p_kind = 'environment' AND v_danger = 'yes')
            OR v_category IN ('abuse_allegation','neglect_allegation')
            OR (p_kind = 'fall' AND v_going_out = 'yes');
  v_insurance := v_level >= 3 OR v_category = 'elopement' OR v_category IN ('abuse_allegation','neglect_allegation');
  v_dcf := v_category IN ('abuse_allegation','neglect_allegation');
  v_grievance := p_kind = 'family_complaint' AND v_what = 'resident_complaint';
  v_neuro := p_kind = 'fall' AND v_head IN ('yes','not_sure');
  v_call_911 := v_level = 4 AND p_kind IN ('fall','condition_change','wandering','environment');
  v_photo := p_kind = 'injury_found' AND v_level = 1;
  v_emar := p_kind = 'medication' AND v_what = 'refused';

  v_flags := pg_catalog.jsonb_build_object(
    'ahca_reportable', coalesce(v_ahca, false),
    'insurance_reportable', coalesce(v_insurance, false),
    'dcf_report_required', coalesce(v_dcf, false),
    'grievance_clock', coalesce(v_grievance, false),
    'neuro_checks', coalesce(v_neuro, false),
    'call_911_prompt', coalesce(v_call_911, false),
    'photo_prompt', coalesce(v_photo, false),
    'emar_reminder', coalesce(v_emar, false)
  );

  -- ---- Section 7: sentence ---------------------------------------------
  IF v_location_label IS NOT NULL THEN v_loc := ' in the ' || pg_catalog.lower(v_location_label); END IF;
  IF v_time_label IS NOT NULL THEN v_time := ' at ' || v_time_label; END IF;

  IF p_kind = 'fall' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Found on the floor' || v_loc || v_time || '.'));
    IF v_witnessed = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Witnessed.'); ELSIF v_witnessed = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'Not witnessed.'); END IF;
    IF v_hurt = 'not_hurt' THEN v_parts := pg_catalog.array_append(v_parts, 'Not hurt.');
    ELSIF v_hurt = 'a_little' THEN v_parts := pg_catalog.array_append(v_parts, 'Hurt a little.');
    ELSIF v_hurt = 'badly' THEN v_parts := pg_catalog.array_append(v_parts, 'Hurt badly.'); END IF;
    IF v_head = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'Did not hit head.');
    ELSIF v_head = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Hit head.');
    ELSIF v_head = 'not_sure' THEN v_parts := pg_catalog.array_append(v_parts, 'Not sure if head was hit.'); END IF;
    IF v_going_out = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'Not going out.');
    ELSIF v_going_out = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Going out to the ER or 911 called.'); END IF;
    IF v_hurt = 'a_little' THEN v_parts := pg_catalog.array_append(v_parts, 'First aid given.');
    ELSIF v_hurt = 'badly' THEN v_parts := pg_catalog.array_append(v_parts, 'Emergency care requested.'); END IF;
  ELSIF p_kind = 'injury_found' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Injury found' || v_loc || v_time || '.'));
    IF pg_catalog.cardinality(v_seen_labels) > 0 THEN v_parts := pg_catalog.array_append(v_parts, ('Seen: ' || pg_catalog.array_to_string(v_seen_labels, ', ') || '.')); END IF;
    IF v_care = 'first_aid_enough' THEN v_parts := pg_catalog.array_append(v_parts, 'First aid was enough.');
    ELSIF v_care = 'more_than_first_aid' THEN v_parts := pg_catalog.array_append(v_parts, 'Needs more than first aid.'); END IF;
    IF v_cause_known = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Cause known.');
    ELSIF v_cause_known = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'Cause unknown.'); END IF;
  ELSIF p_kind = 'condition_change' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Not themselves' || v_loc || v_time || '.'));
    IF pg_catalog.cardinality(v_signs_labels) > 0 THEN v_parts := pg_catalog.array_append(v_parts, ('Signs: ' || pg_catalog.array_to_string(v_signs_labels, ', ') || '.')); END IF;
    IF v_onset = 'today' THEN v_parts := pg_catalog.array_append(v_parts, 'Came on today.');
    ELSIF v_onset = 'over_days' THEN v_parts := pg_catalog.array_append(v_parts, 'Getting worse over days.'); END IF;
  ELSIF p_kind = 'behavior' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Behavior' || v_loc || v_time || '.'));
    IF v_what = 'yelling' THEN v_parts := pg_catalog.array_append(v_parts, 'Yelling or cursing.');
    ELSIF v_what = 'refusing_care' THEN v_parts := pg_catalog.array_append(v_parts, 'Refusing care.');
    ELSIF v_what = 'hitting' THEN v_parts := pg_catalog.array_append(v_parts, 'Hitting, pushing, or grabbing.');
    ELSIF v_what = 'sexual' THEN v_parts := pg_catalog.array_append(v_parts, 'Sexual behavior.');
    ELSIF v_what = 'crying_withdrawn' THEN v_parts := pg_catalog.array_append(v_parts, 'Crying or withdrawn.');
    ELSIF v_what = 'self_harm' THEN v_parts := pg_catalog.array_append(v_parts, 'Hurting themselves.'); END IF;
    IF v_touched = 'no_one' THEN v_parts := pg_catalog.array_append(v_parts, 'No one touched or hurt.');
    ELSIF v_touched = 'another_resident' THEN v_parts := pg_catalog.array_append(v_parts, 'Another resident touched or hurt.');
    ELSIF v_touched = 'staff' THEN v_parts := pg_catalog.array_append(v_parts, 'Staff touched or hurt.'); END IF;
    IF v_over = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'It is over.');
    ELSIF v_over = 'still_going' THEN v_parts := pg_catalog.array_append(v_parts, 'Still going.'); END IF;
  ELSIF p_kind = 'wandering' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Wandering' || v_loc || v_time || '.'));
    IF v_where = 'found_inside' THEN v_parts := pg_catalog.array_append(v_parts, 'Found inside.');
    ELSIF v_where = 'found_grounds' THEN v_parts := pg_catalog.array_append(v_parts, 'Found outside on the grounds.');
    ELSIF v_where = 'found_off_property' THEN v_parts := pg_catalog.array_append(v_parts, 'Found off the property.');
    ELSIF v_where = 'not_found' THEN v_parts := pg_catalog.array_append(v_parts, 'Not found yet.'); END IF;
    IF v_hurt = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'Not hurt.');
    ELSIF v_hurt = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Hurt.'); END IF;
  ELSIF p_kind = 'medication' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Medicine' || v_loc || v_time || '.'));
    IF v_what = 'refused' THEN v_parts := pg_catalog.array_append(v_parts, 'Refused.');
    ELSIF v_what = 'missed_late' THEN v_parts := pg_catalog.array_append(v_parts, 'Missed or late.');
    ELSIF v_what = 'wrong' THEN v_parts := pg_catalog.array_append(v_parts, 'Wrong medicine, dose, time, or person.');
    ELSIF v_what = 'not_theirs' THEN v_parts := pg_catalog.array_append(v_parts, 'Took something not theirs.'); END IF;
    IF v_reaction = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'No reaction.');
    ELSIF v_reaction = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Reaction or feeling bad.'); END IF;
  ELSIF p_kind = 'family_complaint' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Family or complaint' || v_loc || v_time || '.'));
    IF v_what = 'family_upset' THEN v_parts := pg_catalog.array_append(v_parts, 'Family upset or complaint.');
    ELSIF v_what = 'visitor_problem' THEN v_parts := pg_catalog.array_append(v_parts, 'Visitor problem.');
    ELSIF v_what = 'resident_complaint' THEN v_parts := pg_catalog.array_append(v_parts, 'Resident complaint about care.');
    ELSIF v_what = 'mistreated' THEN v_parts := pg_catalog.array_append(v_parts, 'Someone may have been mistreated.'); END IF;
  ELSIF p_kind = 'environment' THEN
    v_parts := pg_catalog.array_append(v_parts, ('Building' || v_loc || v_time || '.'));
    IF v_what = 'water_leak' THEN v_parts := pg_catalog.array_append(v_parts, 'Water leak or flood.');
    ELSIF v_what = 'smoke_fire' THEN v_parts := pg_catalog.array_append(v_parts, 'Smoke, fire, or alarm.');
    ELSIF v_what = 'power_out' THEN v_parts := pg_catalog.array_append(v_parts, 'Power out.');
    ELSIF v_what = 'broken_equipment' THEN v_parts := pg_catalog.array_append(v_parts, 'Broken equipment.');
    ELSIF v_what = 'missing_damaged' THEN v_parts := pg_catalog.array_append(v_parts, 'Something missing or damaged.');
    ELSIF v_what = 'other' THEN v_parts := pg_catalog.array_append(v_parts, 'Other.'); END IF;
    IF v_danger = 'no' THEN v_parts := pg_catalog.array_append(v_parts, 'No one in danger.');
    ELSIF v_danger = 'yes' THEN v_parts := pg_catalog.array_append(v_parts, 'Someone in danger.'); END IF;
  END IF;

  v_sentence := pg_catalog.array_to_string(v_parts, ' ');

  RETURN pg_catalog.jsonb_build_object(
    'level', v_level,
    'derived_level', v_derived,
    'category', v_category,
    'flags', v_flags,
    'sentence', v_sentence
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_derive(text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_event_derive(text, jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.care_event_derive(text, jsonb, jsonb) IS
  'SQL mirror of src/lib/care-events/level-engine.ts. Pure and IMMUTABLE; reads no table. Binding contract: docs/specs/07A-level-engine-contract.md. Invoker, no data access.';

-- ---------------------------------------------------------------------------
-- 2a. allocate_incident_number: widen the role list to the capture roles.
--     Same body as 184; only the role array changes. Grants unchanged
--     (authenticated and service_role execute; anon does not).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_incident_number (p_facility_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
DECLARE
  v_year integer;
  v_prefix text;
  v_next integer;
  v_org uuid;
  v_clean text;
  v_existing_max integer;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (haven.app_role () = ANY (ARRAY['owner'::app_role, 'org_admin'::app_role, 'facility_admin'::app_role, 'manager'::app_role, 'admin_assistant'::app_role, 'coordinator'::app_role, 'nurse'::app_role, 'caregiver'::app_role, 'med_tech'::app_role])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    f.organization_id INTO v_org
  FROM
    facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org IS NULL OR v_org <> haven.organization_id () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_facility_id NOT IN (
    SELECT
      haven.accessible_facility_ids ()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_year := (EXTRACT(YEAR FROM timezone('America/New_York', now())))::integer;

  SELECT
    COALESCE(NULLIF(trim(f.settings ->> 'incident_report_prefix'), ''), '') INTO v_prefix
  FROM
    facilities f
  WHERE
    f.id = p_facility_id;

  IF v_prefix IS NULL OR length(v_prefix) = 0 THEN
    SELECT
      regexp_replace(f.name, '[^a-zA-Z]', '', 'g') INTO v_clean
    FROM
      facilities f
    WHERE
      f.id = p_facility_id;
    v_prefix := upper(left(coalesce(v_clean, ''), 3));
  END IF;

  IF v_prefix IS NULL OR length(v_prefix) < 3 THEN
    v_prefix := 'HVN';
  END IF;

  IF length(v_prefix) > 12 THEN
    v_prefix := left(v_prefix, 12);
  END IF;

  SELECT
    COALESCE(MAX(COALESCE(NULLIF(substring(i.incident_number FROM '([0-9]+)$'), ''), '0')::integer), 0) INTO v_existing_max
  FROM
    incidents i
  WHERE
    i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.incident_number LIKE format('%s-%s-%%', v_prefix, v_year);

  INSERT INTO incident_sequences (facility_id, year, last_number)
    VALUES (p_facility_id, v_year, v_existing_max)
  ON CONFLICT (facility_id, year)
    DO NOTHING;

  UPDATE
    incident_sequences
  SET
    last_number = GREATEST(last_number + 1, v_existing_max + 1)
  WHERE
    facility_id = p_facility_id
    AND year = v_year
  RETURNING
    last_number INTO v_next;

  RETURN format('%s-%s-%s', v_prefix, v_year, lpad(v_next::text, 4, '0'));
END
$func$;

REVOKE ALL ON FUNCTION public.allocate_incident_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_incident_number(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.allocate_incident_number(uuid) IS
  'Draws the next facility incident number. COL-37 ruling: definer required -- public.incident_sequences admits only owner/org_admin/facility_admin/nurse under RLS, while every capture role files incidents from /caregiver/report (402 widened the role list to owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, caregiver, med_tech), and the max-so-far scan over public.incidents must see every incident or it reissues a number. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() before writing. Do not switch to invoker without first giving the capture roles a policy on incident_sequences.';

-- ---------------------------------------------------------------------------
-- 2b. care_event_expand_targets: shared target expansion for one policy step.
--     Called by submit_care_event and care_event_escalation_tick only.
--     Writes one care_event_deliveries row per (target, channel); rows a
--     channel cannot reach are written as skipped so the ledger shows the gap
--     and the tick does not retry the step every minute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_expand_targets(p_care_event_id uuid, p_policy_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_policy record;
  v_route record;
  v_tz text;
  v_today date;
  v_target_role text;
  v_channel text;
  v_inserted integer := 0;
  v_rows integer := 0;
  v_target_count integer := 0;
BEGIN
  SELECT ce.id, ce.organization_id, ce.facility_id, ce.shift, ce.reported_by
    INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_policy FROM public.care_event_escalation_policies WHERE id = p_policy_id AND is_active;
  IF v_policy.id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_event.facility_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  IF to_regclass('pg_temp.care_event_targets_tmp') IS NULL THEN
    CREATE TEMP TABLE care_event_targets_tmp (
      target_user_id uuid,
      target_phone text
    ) ON COMMIT DROP;
  END IF;
  -- TRUNCATE, not a bare DELETE: Supabase preloads safeupdate for the API roles,
  -- which refuses DELETE without WHERE even inside a definer function.
  TRUNCATE care_event_targets_tmp;

  IF v_policy.target_kind = 'route' THEN
    SELECT nr.id, nr.name, nr.staff_role_targets, nr.user_targets
      INTO v_route
    FROM public.notification_routes nr
    WHERE nr.id = v_policy.notification_route_id
      AND nr.is_active
      AND nr.deleted_at IS NULL;
    v_target_role := COALESCE(v_route.name, 'route');

    IF v_route.id IS NOT NULL THEN
      -- staff at the facility whose staff_role is on the route
      INSERT INTO care_event_targets_tmp (target_user_id, target_phone)
      SELECT s.user_id, NULLIF(btrim(s.phone), '')
      FROM public.staff s
      WHERE s.facility_id = v_event.facility_id
        AND s.organization_id = v_event.organization_id
        AND s.deleted_at IS NULL
        AND s.employment_status = 'active'
        AND s.user_id IS NOT NULL
        AND v_route.staff_role_targets IS NOT NULL
        AND s.staff_role = ANY (v_route.staff_role_targets);

      -- explicit user targets on the route
      INSERT INTO care_event_targets_tmp (target_user_id, target_phone)
      SELECT up.id, NULLIF(btrim(up.phone), '')
      FROM public.user_profiles up
      WHERE v_route.user_targets IS NOT NULL
        AND up.id = ANY (v_route.user_targets)
        AND up.organization_id = v_event.organization_id
        AND up.is_active
        AND up.deleted_at IS NULL;
    END IF;

    -- fallback: the administrator or assistant with access to the facility,
    -- or the owners and organization admins
    IF NOT EXISTS (SELECT 1 FROM care_event_targets_tmp) THEN
      INSERT INTO care_event_targets_tmp (target_user_id, target_phone)
      SELECT up.id, NULLIF(btrim(up.phone), '')
      FROM public.user_profiles up
      WHERE up.organization_id = v_event.organization_id
        AND up.is_active
        AND up.deleted_at IS NULL
        AND (
          (up.app_role IN ('facility_admin','admin_assistant')
           AND EXISTS (
             SELECT 1 FROM public.user_facility_access ufa
             WHERE ufa.user_id = up.id
               AND ufa.facility_id = v_event.facility_id
               AND ufa.revoked_at IS NULL))
          OR up.app_role IN ('owner','org_admin')
        );
    END IF;
  ELSE
    v_target_role := v_policy.target_kind;

    INSERT INTO care_event_targets_tmp (target_user_id, target_phone)
    SELECT s.user_id, COALESCE(NULLIF(btrim(oc.phone_override), ''), NULLIF(btrim(s.phone), ''))
    FROM public.on_call_schedules oc
    JOIN public.staff s ON s.id = oc.staff_id AND s.deleted_at IS NULL
    WHERE oc.facility_id = v_event.facility_id
      AND oc.deleted_at IS NULL
      AND oc.shift_date = v_today
      AND oc.shift_type = v_event.shift
      AND oc.is_primary = (v_policy.target_kind = 'on_call_primary');

    -- fallback: any on-call row today for the facility, primary first
    IF NOT EXISTS (SELECT 1 FROM care_event_targets_tmp) THEN
      INSERT INTO care_event_targets_tmp (target_user_id, target_phone)
      SELECT s.user_id, COALESCE(NULLIF(btrim(oc.phone_override), ''), NULLIF(btrim(s.phone), ''))
      FROM public.on_call_schedules oc
      JOIN public.staff s ON s.id = oc.staff_id AND s.deleted_at IS NULL
      WHERE oc.facility_id = v_event.facility_id
        AND oc.deleted_at IS NULL
        AND oc.shift_date = v_today
      ORDER BY (oc.is_primary = (v_policy.target_kind = 'on_call_primary')) DESC, oc.is_primary DESC, oc.created_at
      LIMIT 1;
    END IF;
  END IF;

  SELECT count(*) INTO v_target_count FROM care_event_targets_tmp;

  FOREACH v_channel IN ARRAY v_policy.channels LOOP
    IF v_channel NOT IN ('in_app','push','sms','voice') THEN
      CONTINUE;
    END IF;

    IF v_target_count = 0 THEN
      INSERT INTO public.care_event_deliveries (
        organization_id, facility_id, care_event_id, escalation_step, target_role,
        target_user_id, target_phone, channel, status, skip_reason, send_after
      ) VALUES (
        v_event.organization_id, v_event.facility_id, v_event.id, v_policy.step, v_target_role,
        NULL, NULL, v_channel, 'skipped', 'no_target', now()
      );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_inserted := v_inserted + v_rows;
      CONTINUE;
    END IF;

    INSERT INTO public.care_event_deliveries (
      organization_id, facility_id, care_event_id, escalation_step, target_role,
      target_user_id, target_phone, channel, status, skip_reason, send_after
    )
    SELECT
      v_event.organization_id, v_event.facility_id, v_event.id, v_policy.step, v_target_role,
      t.target_user_id,
      t.target_phone,
      v_channel,
      CASE
        WHEN v_channel IN ('in_app','push') AND t.target_user_id IS NULL THEN 'skipped'
        WHEN v_channel IN ('sms','voice') AND t.target_phone IS NULL THEN 'skipped'
        ELSE 'queued'
      END,
      CASE
        WHEN v_channel IN ('in_app','push') AND t.target_user_id IS NULL THEN 'no_user'
        WHEN v_channel IN ('sms','voice') AND t.target_phone IS NULL THEN 'no_phone'
        ELSE NULL
      END,
      now()
    FROM (
      SELECT DISTINCT ON (COALESCE(x.target_user_id::text, x.target_phone))
        x.target_user_id, x.target_phone
      FROM care_event_targets_tmp x
      WHERE x.target_user_id IS NOT NULL OR x.target_phone IS NOT NULL
      ORDER BY COALESCE(x.target_user_id::text, x.target_phone), x.target_phone NULLS LAST
    ) t;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_inserted := v_inserted + v_rows;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_expand_targets(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_event_expand_targets(uuid, uuid) IS
  'Private helper: expands one escalation policy step into care_event_deliveries rows. Called only by submit_care_event and care_event_escalation_tick; no request role may execute it.';

-- ---------------------------------------------------------------------------
-- 2c. submit_care_event: the one write the caregiver makes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_care_event(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_witness record;
  v_witness_rows integer := 0;
  v_policy record;
  v_level_word text;
  v_tile_word text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech') THEN
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
  v_shift := CASE WHEN v_hour >= 7 AND v_hour < 15 THEN 'day' WHEN v_hour >= 15 AND v_hour < 23 THEN 'evening' ELSE 'night' END;

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
        ELSE NULL END;

      IF v_proto.task_type = 'witness_statement' THEN
        v_witness_rows := 0;
        FOR v_witness IN
          SELECT DISTINCT s.user_id
          FROM public.shift_assignments sa
          JOIN public.staff s ON s.id = sa.staff_id AND s.deleted_at IS NULL
          WHERE sa.facility_id = v_facility_id
            AND sa.deleted_at IS NULL
            AND sa.shift_date = (v_occurred_at AT TIME ZONE v_tz)::date
            AND sa.shift_type = v_shift
            AND sa.status NOT IN ('called_out','no_show')
            AND s.user_id IS NOT NULL
        LOOP
          INSERT INTO public.incident_followups (
            incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
          ) VALUES (
            v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type,
            format('%s for %s', v_proto.description, v_incident_number),
            v_occurred_at + make_interval(mins => v_proto.due_offset_minutes), v_witness.user_id
          );
          v_witness_rows := v_witness_rows + 1;
        END LOOP;
        IF v_witness_rows = 0 THEN
          INSERT INTO public.incident_followups (
            incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
          ) VALUES (
            v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type,
            format('%s for %s', v_proto.description, v_incident_number),
            v_occurred_at + make_interval(mins => v_proto.due_offset_minutes), NULL
          );
        END IF;
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

REVOKE ALL ON FUNCTION public.submit_care_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_care_event(jsonb) TO authenticated;

COMMENT ON FUNCTION public.submit_care_event(jsonb) IS
  'Writes one care event and fans out into incidents, behavioral_logs, condition_changes, incident_followups, regulatory_reporting_obligations, exec_alerts and care_event_deliveries in one transaction. Idempotent on (organization_id, client_event_id). COL-37 ruling: definer required -- the caller (a caregiver) has no INSERT policy on exec_alerts, regulatory_reporting_obligations or care_event_deliveries, and the level must be derived server-side from the same statement that writes it. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() before writing, and reported_by is always auth.uid().';

-- ---------------------------------------------------------------------------
-- 2d. Small helpers used by submit and the admin form.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_applicable_policies(p_organization_id uuid, p_facility_id uuid, p_level incident_severity)
RETURNS SETOF public.care_event_escalation_policies
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.*
  FROM public.care_event_escalation_policies p
  WHERE p.organization_id = p_organization_id
    AND p.is_active
    AND p.level = p_level
    AND (
      (p.facility_id = p_facility_id)
      OR (p.facility_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.care_event_escalation_policies q
        WHERE q.organization_id = p_organization_id AND q.is_active AND q.level = p_level AND q.facility_id = p_facility_id))
    )
  ORDER BY p.step;
$function$;

REVOKE ALL ON FUNCTION public.care_event_applicable_policies(uuid, uuid, incident_severity) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_event_applicable_policies(uuid, uuid, incident_severity) IS
  'Private helper: the escalation policy rows in force for a facility and level (facility set if any row exists, else the organization default). No request role may execute it.';

CREATE OR REPLACE FUNCTION public.care_event_create_ahca_obligations(p_incident_id uuid, p_facility_id uuid, p_organization_id uuid, p_occurred_at timestamptz, p_tz text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_day date := (p_occurred_at AT TIME ZONE p_tz)::date + 1;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.regulatory_reporting_obligations o
    WHERE o.incident_id = p_incident_id AND o.jurisdiction = 'FL_AHCA' AND o.deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;
  WHILE EXTRACT(DOW FROM v_day) IN (0, 6) LOOP
    v_day := v_day + 1;
  END LOOP;
  INSERT INTO public.regulatory_reporting_obligations (incident_id, facility_id, organization_id, jurisdiction, authority, due_at)
  VALUES
    (p_incident_id, p_facility_id, p_organization_id, 'FL_AHCA', 'AHCA preliminary report', (v_day + time '17:00') AT TIME ZONE p_tz),
    (p_incident_id, p_facility_id, p_organization_id, 'FL_AHCA', 'AHCA full report', p_occurred_at + interval '15 days');
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_create_ahca_obligations(uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_event_create_ahca_obligations(uuid, uuid, uuid, timestamptz, text) IS
  'Private helper: the FL_AHCA preliminary (next business day 17:00 facility time) and full (15 days) report clocks for one incident. Idempotent per incident. No request role may execute it.';

CREATE OR REPLACE FUNCTION public.care_event_receipt(p_care_event_id uuid, p_replayed boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_deliveries jsonb;
  v_next_check_at timestamptz;
BEGIN
  SELECT ce.id, ce.final_level, ce.incident_id, ce.reported_by, i.incident_number
    INTO v_event
  FROM public.care_events ce
  LEFT JOIN public.incidents i ON i.id = ce.incident_id
  WHERE ce.id = p_care_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'target_name', COALESCE(up.full_name, d.target_role),
      'target_role', d.target_role,
      'channel', d.channel,
      'status', d.status
    ) ORDER BY d.escalation_step, d.channel, d.created_at), '[]'::jsonb)
    INTO v_deliveries
  FROM public.care_event_deliveries d
  LEFT JOIN public.user_profiles up ON up.id = d.target_user_id
  WHERE d.care_event_id = p_care_event_id;

  IF v_event.incident_id IS NOT NULL THEN
    SELECT min(f.due_at) INTO v_next_check_at
    FROM public.incident_followups f
    WHERE f.incident_id = v_event.incident_id
      AND f.assigned_to = v_event.reported_by
      AND f.completed_at IS NULL
      AND f.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'care_event_id', v_event.id,
    'level', substring(v_event.final_level::text FROM '[0-9]+$')::integer,
    'incident_number', v_event.incident_number,
    'incident_id', v_event.incident_id,
    'deliveries', v_deliveries,
    'next_check_at', v_next_check_at,
    'replayed', p_replayed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_receipt(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_event_receipt(uuid, boolean) IS
  'Private helper: builds the submit receipt for one care event. No request role may execute it.';

-- ---------------------------------------------------------------------------
-- 3. acknowledge_care_event: "I have got it". Stops the escalation clock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_care_event(p_care_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager','coordinator','nurse') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  SELECT ce.id, ce.status, ce.facility_id, ce.organization_id, ce.incident_id
    INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF v_event.status <> 'open' THEN
    RETURN;
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  UPDATE public.care_events
  SET status = 'acknowledged', acknowledged_by = v_uid, acknowledged_at = now()
  WHERE id = v_event.id;

  UPDATE public.care_event_deliveries
  SET status = 'acknowledged', acknowledged_at = now()
  WHERE care_event_id = v_event.id
    AND target_user_id = v_uid
    AND status = 'queued';

  UPDATE public.care_event_deliveries
  SET status = 'skipped', skip_reason = 'acknowledged'
  WHERE care_event_id = v_event.id
    AND status = 'queued'
    AND send_after > now();

  IF v_event.incident_id IS NOT NULL THEN
    UPDATE public.incidents
    SET administrator_notified = true,
        administrator_notified_at = COALESCE(administrator_notified_at, now()),
        nurse_notified = CASE WHEN v_role = 'nurse' THEN true ELSE nurse_notified END,
        nurse_notified_at = CASE WHEN v_role = 'nurse' THEN COALESCE(nurse_notified_at, now()) ELSE nurse_notified_at END,
        nurse_notified_by = CASE WHEN v_role = 'nurse' THEN COALESCE(nurse_notified_by, v_uid) ELSE nurse_notified_by END
    WHERE id = v_event.incident_id;
  END IF;

  UPDATE public.exec_alerts
  SET acknowledged_at = now(), acknowledged_by = v_uid
  WHERE organization_id = v_event.organization_id
    AND deep_link_path = '/admin/care-events/' || v_event.id::text
    AND status = 'open'
    AND acknowledged_at IS NULL
    AND deleted_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.acknowledge_care_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_care_event(uuid) TO authenticated;

COMMENT ON FUNCTION public.acknowledge_care_event(uuid) IS
  'Acknowledges an open care event, stamps incidents.administrator_notified (and nurse_notified for a nurse), marks the caller''s queued deliveries acknowledged and cancels unsent escalation rows. COL-37 ruling: definer required -- nurse and coordinator may acknowledge but hold no UPDATE policy on care_events, care_event_deliveries or exec_alerts. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first.';

-- ---------------------------------------------------------------------------
-- 3b. care_event_close_gate: the close gate as a read-only query.
-- The admin card loads this on every view; it must never write (a phantom
-- audit_log row per page view is not "audit everything").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_close_gate(p_care_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
  v_admin jsonb;
  v_family_notified boolean := false;
  v_physician_notified boolean := false;
  v_level_int integer;
  v_missing text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  SELECT ce.* INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  v_admin := CASE WHEN jsonb_typeof(v_event.answers -> 'admin') = 'object' THEN v_event.answers -> 'admin' ELSE '{}'::jsonb END;
  IF v_event.incident_id IS NOT NULL THEN
    SELECT i.family_notified, i.physician_notified
      INTO v_family_notified, v_physician_notified
    FROM public.incidents i WHERE i.id = v_event.incident_id;
  END IF;
  v_level_int := substring(v_event.final_level::text FROM '[0-9]+$')::integer;

  IF v_level_int >= 2 AND v_event.status = 'open' THEN
    v_missing := array_append(v_missing, 'acknowledgment');
  END IF;
  IF v_level_int >= 3 THEN
    IF NOT (COALESCE(v_family_notified, false) OR COALESCE((v_admin ->> 'family_later')::boolean, false)) THEN
      v_missing := array_append(v_missing, 'family_notified');
    END IF;
    IF NOT (COALESCE(v_physician_notified, false) OR COALESCE((v_admin ->> 'physician_later')::boolean, false)) THEN
      v_missing := array_append(v_missing, 'physician_notified');
    END IF;
    IF NOT (v_admin ? 'ahca_reportable') THEN
      v_missing := array_append(v_missing, 'ahca_decision');
    END IF;
  END IF;
  IF v_level_int >= 4 THEN
    IF NOT (v_admin ? 'ems') THEN
      v_missing := array_append(v_missing, 'ems_decision');
    END IF;
    IF NOT (v_admin ? 'video_secured') THEN
      v_missing := array_append(v_missing, 'video_secured');
    END IF;
  END IF;
  IF COALESCE((v_event.flags ->> 'dcf_report_required')::boolean, false) AND NOT (v_admin ? 'dcf_reported_at') THEN
    v_missing := array_append(v_missing, 'dcf_report');
  END IF;

  RETURN jsonb_build_object(
    'status', v_event.status,
    'final_level', v_level_int,
    'missing', to_jsonb(v_missing)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_close_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_event_close_gate(uuid) TO authenticated;

COMMENT ON FUNCTION public.care_event_close_gate(uuid) IS
  'Read-only close gate for the administrator card (spec 07A section 5): returns {status, final_level, missing} without writing anything, so a page view never produces an audit row. COL-37 ruling: definer required -- complete_care_event_admin_section (definer) calls this to decide whether an event may close, and the card must show the same answer, so the gate reads care_events and incidents with the same rights as the writer instead of through the caller''s RLS view; it stays STABLE so a card load is a pure read. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first, exactly as complete_care_event_admin_section does.';

-- ---------------------------------------------------------------------------
-- 4. complete_care_event_admin_section: Sections 2 and 4 of the paper form.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_care_event_admin_section(p_care_event_id uuid, p_section jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
  v_admin jsonb;
  v_section jsonb := COALESCE(p_section, '{}'::jsonb);
  v_item jsonb;
  v_chips text[];
  v_other text;
  v_new_level integer;
  v_reason text;
  v_level_int integer;
  v_missing text[] := '{}';
  v_tz text;
  v_status text;
  v_gate jsonb;
  -- True once any section key carried something to merge into answers->'admin';
  -- an empty section (the read-only card load) must not touch the row.
  v_touched boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF jsonb_typeof(v_section) <> 'object' THEN
    RAISE EXCEPTION 'care_event: section must be an object';
  END IF;

  SELECT ce.* INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  v_admin := CASE WHEN jsonb_typeof(v_event.answers -> 'admin') = 'object' THEN v_event.answers -> 'admin' ELSE '{}'::jsonb END;
  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_event.facility_id;

  -- family_notified
  v_item := v_section -> 'family_notified';
  IF jsonb_typeof(v_item) = 'object' AND v_item ? 'now' THEN
    IF COALESCE((v_item ->> 'now')::boolean, false) THEN
      IF v_event.incident_id IS NOT NULL THEN
        UPDATE public.incidents
        SET family_notified = true, family_notified_at = now(), family_notified_by = v_uid,
            family_notified_method = COALESCE(NULLIF(v_item ->> 'method', ''), family_notified_method)
        WHERE id = v_event.incident_id;
      END IF;
      v_admin := v_admin || jsonb_build_object('family_notified_at', now(), 'family_later', false);
    ELSE
      v_admin := v_admin || jsonb_build_object('family_later', true);
    END IF;
    v_touched := true;
  END IF;

  -- physician_notified
  v_item := v_section -> 'physician_notified';
  IF jsonb_typeof(v_item) = 'object' AND v_item ? 'now' THEN
    IF COALESCE((v_item ->> 'now')::boolean, false) THEN
      IF v_event.incident_id IS NOT NULL THEN
        UPDATE public.incidents
        SET physician_notified = true, physician_notified_at = now(),
            physician_orders_received = COALESCE(NULLIF(v_item ->> 'orders', ''), physician_orders_received)
        WHERE id = v_event.incident_id;
      END IF;
      v_admin := v_admin || jsonb_build_object('physician_notified_at', now(), 'physician_later', false);
    ELSE
      v_admin := v_admin || jsonb_build_object('physician_later', true);
    END IF;
    v_touched := true;
  END IF;

  -- ems
  v_item := v_section -> 'ems';
  IF jsonb_typeof(v_item) = 'object' AND v_item ->> 'treatment' IN ('er_visit','hospitalization','none') THEN
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents SET injury_treatment = v_item ->> 'treatment' WHERE id = v_event.incident_id;
    END IF;
    v_admin := v_admin || jsonb_build_object('ems', v_item ->> 'treatment');
    v_touched := true;
  END IF;

  -- corrective_actions
  v_item := v_section -> 'corrective_actions';
  IF jsonb_typeof(v_item) = 'object' THEN
    v_chips := '{}';
    IF jsonb_typeof(v_item -> 'chips') = 'array' THEN
      SELECT COALESCE(array_agg(x ORDER BY ord), '{}') INTO v_chips
      FROM jsonb_array_elements_text(v_item -> 'chips') WITH ORDINALITY AS t(x, ord);
    END IF;
    v_other := NULLIF(btrim(COALESCE(v_item ->> 'other', '')), '');
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents
      SET resolution_notes = NULLIF(concat_ws('; ', NULLIF(array_to_string(v_chips, '; '), ''), v_other), ''),
          care_plan_updated = CASE WHEN 'care_plan_review' = ANY (v_chips) THEN true ELSE care_plan_updated END
      WHERE id = v_event.incident_id;
    END IF;
    v_admin := v_admin || jsonb_build_object('corrective_actions', to_jsonb(v_chips), 'corrective_other', v_other);
    v_touched := true;
  END IF;

  -- ahca
  v_item := v_section -> 'ahca';
  IF jsonb_typeof(v_item) = 'object' AND jsonb_typeof(v_item -> 'reportable') = 'boolean' THEN
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents SET ahca_reportable = (v_item ->> 'reportable')::boolean WHERE id = v_event.incident_id;
      IF (v_item ->> 'reportable')::boolean THEN
        PERFORM public.care_event_create_ahca_obligations(v_event.incident_id, v_event.facility_id, v_event.organization_id, v_event.occurred_at, v_tz);
      ELSE
        -- The Administrator says the flag was a false positive: withdraw the
        -- unsubmitted FL_AHCA clocks so no phantom deadline stays on the board.
        UPDATE public.regulatory_reporting_obligations
        SET deleted_at = now()
        WHERE incident_id = v_event.incident_id
          AND jurisdiction = 'FL_AHCA'
          AND submitted_at IS NULL
          AND deleted_at IS NULL;
      END IF;
    END IF;
    v_admin := v_admin || jsonb_build_object('ahca_reportable', (v_item ->> 'reportable')::boolean, 'ahca_reason', NULLIF(v_item ->> 'reason_code', ''));
    v_touched := true;
  END IF;

  -- dcf_reported_at
  IF v_section ? 'dcf_reported_at' AND NULLIF(v_section ->> 'dcf_reported_at', '') IS NOT NULL THEN
    v_admin := v_admin || jsonb_build_object('dcf_reported_at', (v_section ->> 'dcf_reported_at')::timestamptz);
    v_touched := true;
  END IF;

  -- video_secured
  IF v_section ->> 'video_secured' IN ('yes','no','na') THEN
    v_admin := v_admin || jsonb_build_object('video_secured', v_section ->> 'video_secured');
    v_touched := true;
  END IF;

  -- lower_level
  v_item := v_section -> 'lower_level';
  IF jsonb_typeof(v_item) = 'object' THEN
    v_new_level := (v_item ->> 'level')::integer;
    v_reason := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');
    v_level_int := substring(v_event.final_level::text FROM '[0-9]+$')::integer;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'care_event: a reason is required to lower the level';
    END IF;
    IF v_new_level IS NULL OR v_new_level < 1 OR v_new_level > 4 OR v_new_level >= v_level_int THEN
      RAISE EXCEPTION 'care_event: the new level must be lower than the current level';
    END IF;
    UPDATE public.care_events
    SET final_level = ('level_' || v_new_level)::incident_severity,
        level_changed_by = v_uid, level_changed_at = now(), level_change_reason = v_reason
    WHERE id = v_event.id;
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents SET severity = ('level_' || v_new_level)::incident_severity WHERE id = v_event.incident_id;
    END IF;
  END IF;

  -- Only write when a section key actually carried something. The read-only
  -- card load goes through care_event_close_gate and never reaches here with
  -- v_touched = true.
  IF v_touched THEN
    UPDATE public.care_events
    SET answers = answers || jsonb_build_object('admin', v_admin)
    WHERE id = v_event.id;
  END IF;

  -- The close gate, computed once, in one place, after the writes above.
  v_gate := public.care_event_close_gate(p_care_event_id);
  v_level_int := (v_gate ->> 'final_level')::integer;
  SELECT COALESCE(array_agg(x ORDER BY ord), '{}') INTO v_missing
  FROM jsonb_array_elements_text(v_gate -> 'missing') WITH ORDINALITY AS t(x, ord);

  v_status := v_gate ->> 'status';
  IF COALESCE((v_section ->> 'close')::boolean, false) AND v_status <> 'closed' THEN
    IF cardinality(v_missing) > 0 THEN
      RAISE EXCEPTION 'care_event: close gate: %', v_missing[1];
    END IF;
    UPDATE public.care_events
    SET status = 'closed', closed_by = v_uid, closed_at = now()
    WHERE id = v_event.id;
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents
      SET status = 'resolved', resolved_at = COALESCE(resolved_at, now()), resolved_by = COALESCE(resolved_by, v_uid)
      WHERE id = v_event.incident_id;
    END IF;
    v_status := 'closed';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'final_level', v_level_int,
    'missing', to_jsonb(v_missing)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_care_event_admin_section(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_care_event_admin_section(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.complete_care_event_admin_section(uuid, jsonb) IS
  'The administrator completion form (spec 07A section 5): family, physician, EMS, corrective actions, AHCA decision, DCF stamp, video, lower the level with a reason, close behind the level gate. Merges into answers->''admin'' and never replaces caregiver answers. COL-37 ruling: definer required -- the AHCA decision writes regulatory_reporting_obligations, which admin roles cannot insert directly, and the level change must land on care_events and incidents in one statement. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first.';

-- ---------------------------------------------------------------------------
-- 5. care_event_escalation_tick: pg_cron every minute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_escalation_tick()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_policy record;
  v_last timestamptz;
  v_total integer := 0;
BEGIN
  PERFORM set_config('haven.care_event_definer', '1', true);

  FOR v_event IN
    SELECT ce.id, ce.organization_id, ce.facility_id, ce.final_level, ce.created_at
    FROM public.care_events ce
    WHERE ce.status = 'open'
      AND ce.deleted_at IS NULL
      AND ce.final_level >= 'level_2'
      AND ce.created_at >= now() - interval '7 days'
    ORDER BY ce.created_at
  LOOP
    FOR v_policy IN
      SELECT * FROM public.care_event_applicable_policies(v_event.organization_id, v_event.facility_id, v_event.final_level)
      WHERE after_minutes > 0
      ORDER BY step
    LOOP
      IF now() < v_event.created_at + make_interval(mins => v_policy.after_minutes) THEN
        CONTINUE;
      END IF;

      SELECT max(d.created_at) INTO v_last
      FROM public.care_event_deliveries d
      WHERE d.care_event_id = v_event.id AND d.escalation_step = v_policy.step;

      IF v_last IS NULL THEN
        v_total := v_total + public.care_event_expand_targets(v_event.id, v_policy.id);
      ELSIF v_policy.repeat_every_minutes IS NOT NULL
            AND v_policy.repeat_every_minutes > 0
            AND v_last <= now() - make_interval(mins => v_policy.repeat_every_minutes) THEN
        v_total := v_total + public.care_event_expand_targets(v_event.id, v_policy.id);
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_escalation_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.care_event_escalation_tick() TO service_role;

COMMENT ON FUNCTION public.care_event_escalation_tick() IS
  'pg_cron every minute (scripts/care-events/cron-schedules.sql): inserts the next escalation step deliveries for open Level 2 and above care events past their policy after_minutes, and repeats steps with repeat_every_minutes. service_role only; no signed-in user may call it.';

-- ---------------------------------------------------------------------------
-- 6. Views (security_invoker so the caller's RLS applies).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_resident_timeline
WITH (security_invoker = true)
AS
  SELECT
    ce.resident_id,
    ce.organization_id,
    ce.facility_id,
    ce.occurred_at,
    'care_event'::text AS source,
    ce.id AS source_id,
    ce.kind AS kind,
    ce.final_level AS level,
    CASE ce.kind
      WHEN 'fall' THEN 'Fall'
      WHEN 'injury_found' THEN 'Hurt'
      WHEN 'condition_change' THEN 'Sick or not themselves'
      WHEN 'behavior' THEN 'Upset or behavior'
      WHEN 'wandering' THEN 'Wandering or left'
      WHEN 'medication' THEN 'Medicine'
      WHEN 'family_complaint' THEN 'Family or complaint'
      ELSE 'Building or other' END AS title,
    ce.sentence AS detail,
    ce.incident_id,
    ce.id AS care_event_id,
    ce.status
  FROM public.care_events ce
  WHERE ce.deleted_at IS NULL
UNION ALL
  SELECT
    i.resident_id,
    i.organization_id,
    i.facility_id,
    i.occurred_at,
    'incident'::text,
    i.id,
    i.category::text,
    i.severity,
    initcap(replace(i.category::text, '_', ' ')),
    i.description,
    i.id,
    NULL::uuid,
    i.status::text
  FROM public.incidents i
  WHERE i.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.incident_id = i.id)
UNION ALL
  SELECT
    cc.resident_id,
    cc.organization_id,
    cc.facility_id,
    cc.reported_at,
    'condition_change'::text,
    cc.id,
    cc.change_type,
    NULL::incident_severity,
    'Condition change'::text,
    cc.description,
    cc.linked_incident_id,
    NULL::uuid,
    CASE WHEN cc.resolved_at IS NULL THEN 'open' ELSE 'resolved' END
  FROM public.condition_changes cc
  WHERE cc.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.condition_change_id = cc.id)
UNION ALL
  SELECT
    bl.resident_id,
    bl.organization_id,
    bl.facility_id,
    bl.occurred_at,
    'behavior'::text,
    bl.id,
    bl.behavior_type,
    NULL::incident_severity,
    'Behavior'::text,
    bl.behavior,
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.behavioral_logs bl
  WHERE bl.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.behavioral_log_id = bl.id)
UNION ALL
  SELECT
    dl.resident_id,
    dl.organization_id,
    dl.facility_id,
    dl.created_at,
    'daily_log'::text,
    dl.id,
    'note'::text,
    NULL::incident_severity,
    'Shift note'::text,
    dl.general_notes,
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.daily_logs dl
  WHERE dl.deleted_at IS NULL
    AND NULLIF(btrim(COALESCE(dl.general_notes, '')), '') IS NOT NULL
UNION ALL
  SELECT
    ol.resident_id,
    ol.organization_id,
    ol.facility_id,
    ol.observed_at,
    'observation_exception'::text,
    ol.id,
    'observation'::text,
    NULL::incident_severity,
    'Observation exception'::text,
    ol.note,
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.resident_observation_logs ol
  WHERE ol.deleted_at IS NULL
    AND ol.exception_present;

COMMENT ON VIEW public.v_resident_timeline IS
  'The digital Resident Observation Log: care events plus pre-launch incidents, condition changes and behavior logs that have no care event, shift notes, and observation exceptions. security_invoker: the caller''s RLS on every source table applies. Order is left to the caller.';

REVOKE ALL ON public.v_resident_timeline FROM PUBLIC, anon;
GRANT SELECT ON public.v_resident_timeline TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_incident_reports_log
WITH (security_invoker = true)
AS
  SELECT
    i.organization_id,
    i.facility_id,
    i.id AS incident_id,
    ce.id AS care_event_id,
    i.incident_number,
    (i.occurred_at AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date AS log_date,
    i.occurred_at,
    rm.room_number AS room,
    CASE WHEN r.id IS NULL THEN NULL ELSE r.last_name || ', ' || r.first_name END AS resident,
    (i.category::text LIKE 'fall%') AS fall,
    (COALESCE(ce.answers -> 'seen' ? 'bruise', false) OR COALESCE(i.injury_description, '') ILIKE '%bruise%') AS bruise,
    (COALESCE(ce.answers -> 'seen' ? 'burn', false)
      OR COALESCE(i.injury_description, '') ILIKE '%scrape%'
      OR COALESCE(i.injury_description, '') ILIKE '%burn%') AS scrapes_or_burn,
    (COALESCE(ce.answers -> 'seen' ? 'skin_tear', false)
      OR COALESCE(i.injury_description, '') ILIKE ANY (ARRAY['%cut%','%laceration%','%puncture%','%tear%'])) AS cut_laceration_puncture,
    (i.injury_occurred
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'bruise', false) OR COALESCE(i.injury_description, '') ILIKE '%bruise%')
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'burn', false) OR COALESCE(i.injury_description, '') ILIKE '%scrape%' OR COALESCE(i.injury_description, '') ILIKE '%burn%')
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'skin_tear', false) OR COALESCE(i.injury_description, '') ILIKE ANY (ARRAY['%cut%','%laceration%','%puncture%','%tear%']))
    ) AS non_apparent,
    (NOT i.injury_occurred AND NOT (i.category::text LIKE 'fall%')) AS other,
    array_to_string(i.contributing_factors, '; ') AS contributing_factors,
    i.shift,
    i.severity,
    i.category
  FROM public.incidents i
  JOIN public.facilities f ON f.id = i.facility_id
  LEFT JOIN public.care_events ce ON ce.incident_id = i.id AND ce.deleted_at IS NULL
  LEFT JOIN public.residents r ON r.id = i.resident_id
  LEFT JOIN public.beds b ON b.id = r.bed_id
  LEFT JOIN public.rooms rm ON rm.id = b.room_id
  WHERE i.deleted_at IS NULL;

COMMENT ON VIEW public.v_incident_reports_log IS
  'The paper Incident Reports Log, one row per incident: date, room, resident, fall, bruise, scrapes or burn, cut or laceration or puncture, non-apparent, other, contributing factors, shift. security_invoker: the caller''s RLS on incidents, residents and care_events applies.';

REVOKE ALL ON public.v_incident_reports_log FROM PUBLIC, anon;
GRANT SELECT ON public.v_incident_reports_log TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. append_care_event_note: the receipt's voice note and photo attachments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_care_event_note(p_care_event_id uuid, p_note text, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_path text := NULLIF(btrim(COALESCE(p_photo_path, '')), '');
  v_attachments jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT ce.id, ce.organization_id, ce.facility_id, ce.reported_by, ce.incident_id, ce.note, ce.answers
    INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF v_event.reported_by <> v_uid
     AND (v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager')) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  v_attachments := CASE WHEN jsonb_typeof(v_event.answers -> 'attachments') = 'array'
                        THEN v_event.answers -> 'attachments' ELSE '[]'::jsonb END;

  IF v_note IS NOT NULL THEN
    UPDATE public.care_events
    SET note = CASE WHEN note IS NULL OR btrim(note) = '' THEN v_note ELSE note || E'\n' || v_note END
    WHERE id = v_event.id;
    IF v_event.incident_id IS NOT NULL THEN
      UPDATE public.incidents
      SET description = description || E'\n\nStaff note: ' || v_note
      WHERE id = v_event.incident_id;
    END IF;
  END IF;

  IF v_path IS NOT NULL THEN
    -- Path law: <organization_id>/<facility_id>/<care_event_id>/<file>; the
    -- storage policies scope on the first two segments, so refuse anything else.
    IF v_path !~ ('^' || v_event.organization_id::text || '/' || v_event.facility_id::text || '/' || v_event.id::text || '/[^/]+$') THEN
      RAISE EXCEPTION 'care_event: photo path must be <organization_id>/<facility_id>/<care_event_id>/<file>';
    END IF;
    v_attachments := v_attachments || to_jsonb(v_path);
    UPDATE public.care_events
    SET answers = answers || jsonb_build_object('attachments', v_attachments)
    WHERE id = v_event.id;
    IF v_event.incident_id IS NOT NULL THEN
      INSERT INTO public.incident_photos (incident_id, facility_id, organization_id, storage_path, taken_by)
      VALUES (v_event.incident_id, v_event.facility_id, v_event.organization_id, v_path, v_uid);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'care_event_id', v_event.id,
    'note', (SELECT ce.note FROM public.care_events ce WHERE ce.id = v_event.id),
    'attachments', v_attachments
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.append_care_event_note(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_care_event_note(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.append_care_event_note(uuid, text, text) IS
  'Appends the caregiver voice note to care_events.note and incidents.description (as "Staff note:") and records a photo storage path under answers->''attachments'' plus incident_photos when an incident exists. Reporter or admin roles only. COL-37 ruling: definer required -- the reporter holds no UPDATE policy on incidents. The body checks auth.uid(), the organization and haven.accessible_facility_ids() first.';

COMMIT;

NOTIFY pgrst, 'reload schema';
