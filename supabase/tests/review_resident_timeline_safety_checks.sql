-- Migration 556: every safety check shows on the resident's Timeline (COL-849 finding).
-- Rollback-only fixture on a seeded facility, resident and staff member.
BEGIN;
CREATE TEMP TABLE rt AS
SELECT f.organization_id org, f.id facility, f.entity_id entity, r.id resident, s.id staff,
       gen_random_uuid() routine_log, gen_random_uuid() wrong_log,
       gen_random_uuid() plan, gen_random_uuid() rule, gen_random_uuid() task
FROM public.facilities f
JOIN public.residents r ON r.facility_id = f.id AND r.organization_id = f.organization_id AND r.deleted_at IS NULL
JOIN public.staff s ON s.facility_id = f.id AND s.deleted_at IS NULL AND nullif(btrim(s.first_name), '') IS NOT NULL
WHERE f.deleted_at IS NULL ORDER BY f.name, r.id, s.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM rt) THEN RAISE EXCEPTION 'Seeded facility with a resident and a named staff member required'; END IF; END $$;

-- A check already charted is what the timeline reads; its task is an open plan-rule check.
INSERT INTO public.resident_observation_plans (id, organization_id, facility_id, resident_id, status, source_type, effective_from, rationale)
SELECT plan, org, facility, resident, 'active', 'manual', now() - interval '1 day', 'Migration 556 probe: every safety check on the resident timeline' FROM rt;
INSERT INTO public.resident_observation_plan_rules (id, plan_id, organization_id, facility_id, resident_id, interval_type, interval_minutes, grace_minutes)
SELECT rule, plan, org, facility, resident, 'fixed_minutes', 60, 15 FROM rt;
INSERT INTO public.resident_observation_tasks (id, organization_id, facility_id, resident_id, plan_id, plan_rule_id, scheduled_for, due_at, grace_ends_at, status)
SELECT task, org, facility, resident, plan, rule, now() - interval '3 hours', now() - interval '3 hours', now() - interval '150 minutes', 'upcoming'::public.resident_observation_task_status FROM rt;

INSERT INTO public.resident_observation_logs (id, organization_id, entity_id, facility_id, resident_id, task_id, staff_id, observed_at, entered_at, entry_mode, quick_status, resident_location, resident_state, note, exception_present)
SELECT routine_log, org, entity, facility, resident, task, staff, now() - interval '2 hours', now(), 'live', 'calm', 'resident_room', 'resting_in_bed', NULL, false FROM rt;
INSERT INTO public.resident_observation_logs (id, organization_id, entity_id, facility_id, resident_id, task_id, staff_id, observed_at, entered_at, entry_mode, quick_status, resident_location, resident_state, note, exception_present)
SELECT wrong_log, org, entity, facility, resident, task, staff, now() - interval '1 hour', now(), 'live', 'agitated', 'dining_room', 'eating_meal', 'Would not settle', true FROM rt;

DO $$
DECLARE x record; v_routine record; v_wrong record;
BEGIN
  SELECT * INTO x FROM rt;
  SELECT * INTO v_routine FROM public.v_resident_timeline t WHERE t.source_id = x.routine_log;
  SELECT * INTO v_wrong FROM public.v_resident_timeline t WHERE t.source_id = x.wrong_log;
  IF v_routine.source_id IS NULL THEN
    RAISE EXCEPTION 'A routine safety check is missing from the resident timeline';
  END IF;
  IF v_routine.source <> 'safety_check' OR v_routine.title <> 'Safety check' OR v_routine.kind <> 'observation'
     OR v_routine.resident_id <> x.resident OR v_routine.facility_id <> x.facility THEN
    RAISE EXCEPTION 'Routine safety check row is wrong: % / % / %', v_routine.source, v_routine.title, v_routine.kind;
  END IF;
  IF v_routine.detail NOT LIKE '%Charted by %' OR v_routine.detail NOT LIKE '%Resident Room%' THEN
    RAISE EXCEPTION 'Routine safety check detail does not say what was seen and who charted it: %', v_routine.detail;
  END IF;
  -- Something wrong keeps the source other readers count, with a plain title and the note.
  IF v_wrong.source <> 'observation_exception' OR v_wrong.title <> 'Safety check: something wrong' OR v_wrong.detail NOT LIKE '%Note: Would not settle%' THEN
    RAISE EXCEPTION 'Something-wrong safety check row is wrong: % / % / %', v_wrong.source, v_wrong.title, v_wrong.detail;
  END IF;
  IF (SELECT count(*) FROM public.v_resident_timeline t WHERE t.source_id IN (x.routine_log, x.wrong_log)) <> 2 THEN
    RAISE EXCEPTION 'Expected both checks once each on the timeline';
  END IF;
END $$;
ROLLBACK;
