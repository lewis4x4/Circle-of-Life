-- Migration 554: a Smart Rounding check cannot be charted before its window opens.
-- Rollback-only fixture on a seeded facility and resident.
BEGIN;
CREATE TEMP TABLE wo AS
SELECT f.organization_id org, f.id facility, f.entity_id entity, r.id resident,
       gen_random_uuid() cadence, gen_random_uuid() early_task, gen_random_uuid() open_task, gen_random_uuid() plan_task,
       gen_random_uuid() plan, gen_random_uuid() rule, s.id staff
FROM public.facilities f JOIN public.residents r ON r.facility_id = f.id AND r.organization_id = f.organization_id AND r.deleted_at IS NULL
JOIN public.staff s ON s.facility_id = f.id AND s.deleted_at IS NULL
WHERE f.deleted_at IS NULL ORDER BY f.name, r.id, s.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM wo) THEN RAISE EXCEPTION 'Seeded facility with a resident and a staff member required'; END IF; END $$;

-- A cadence version in draft is enough to stamp the tasks; it is never put in force.
INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
SELECT cadence, org, facility, 900, 'draft', now(), 'Migration 554 probe' FROM wo;
INSERT INTO public.resident_observation_tasks (id, organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, scheduled_for, due_at, grace_ends_at, status)
SELECT early_task, org, entity, facility, resident, cadence, 'probe_tomorrow', current_date + 1, now() + interval '8 hours', now() + interval '8 hours', now() + interval '9 hours', 'upcoming'::public.resident_observation_task_status FROM wo
UNION ALL
SELECT open_task, org, entity, facility, resident, cadence, 'probe_open', current_date + 1, now() - interval '5 minutes', now() + interval '10 minutes', now() + interval '70 minutes', 'upcoming'::public.resident_observation_task_status FROM wo;
INSERT INTO public.resident_observation_plans (id, organization_id, facility_id, resident_id, status, source_type, effective_from, rationale)
SELECT plan, org, facility, resident, 'active', 'manual', now(), 'Migration 554 probe: an older plan-rule check stays outside the window rule' FROM wo;
INSERT INTO public.resident_observation_plan_rules (id, plan_id, organization_id, facility_id, resident_id, interval_type, interval_minutes, grace_minutes)
SELECT rule, plan, org, facility, resident, 'fixed_minutes', 60, 15 FROM wo;
INSERT INTO public.resident_observation_tasks (id, organization_id, facility_id, resident_id, plan_id, plan_rule_id, scheduled_for, due_at, grace_ends_at, status)
SELECT plan_task, org, facility, resident, plan, rule, now() + interval '2 hours', now() + interval '2 hours', now() + interval '3 hours', 'upcoming'::public.resident_observation_task_status FROM wo;

CREATE FUNCTION pg_temp.wo_log(p_task uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.resident_observation_logs (organization_id, entity_id, facility_id, resident_id, task_id, staff_id, observed_at, entered_at, entry_mode, quick_status, resident_location, resident_state)
  SELECT org, entity, facility, resident, p_task, staff, now(), now(), 'live', 'calm', 'resident_room', 'resting_in_bed' FROM wo
$$;

DO $$
DECLARE v_state text; v_detail text; v_message text;
BEGIN
  -- Charted eight hours before the window opens: refused, and the message names the opening time.
  BEGIN
    PERFORM pg_temp.wo_log((SELECT early_task FROM wo));
    RAISE EXCEPTION 'A check charted before its window opened was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    IF v_detail IS DISTINCT FROM 'check_not_open' OR v_message NOT LIKE 'This check opens at %. Chart it then.' THEN
      RAISE EXCEPTION 'Early chart refused with the wrong words: % / %', v_detail, v_message;
    END IF;
  END;
  -- Inside the window (after it opens, before the due time): accepted.
  PERFORM pg_temp.wo_log((SELECT open_task FROM wo));
  -- Older plan-rule tasks are outside the rule, as they are outside require_observation_capture.
  PERFORM pg_temp.wo_log((SELECT plan_task FROM wo));
  IF (SELECT count(*) FROM public.resident_observation_logs l WHERE l.task_id IN ((SELECT open_task FROM wo), (SELECT plan_task FROM wo))) <> 2 THEN
    RAISE EXCEPTION 'The in-window and plan-rule logs were not written';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resident_observation_logs l WHERE l.task_id = (SELECT early_task FROM wo)) THEN
    RAISE EXCEPTION 'The early log was written';
  END IF;
  IF has_function_privilege('authenticated', 'haven.refuse_observation_before_window_opens()', 'EXECUTE')
     OR has_function_privilege('service_role', 'haven.refuse_observation_before_window_opens()', 'EXECUTE') THEN
    RAISE EXCEPTION 'The trigger function is executable by a request role';
  END IF;
END $$;
ROLLBACK;
