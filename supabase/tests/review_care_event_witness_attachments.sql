-- COL-354 witness statements and attachments: native scratch-only probe.
-- Synthetic staff and residents only ("Probe Caregiver A" ...). Rolls back.
--
-- Covers migration 414 against spec 07A section 5 and the COL-354 decisions:
-- a Level 2 event creates one task per on-shift staff member except the
-- reporter; a Level 1 creates none; another facility's staff get nothing;
-- each of the three choices completes; a second completion is refused; an
-- administrator adds and removes a witness; caregiver B cannot complete
-- caregiver A's task. Then the attachment kind, size, count and path rules.
--
-- Two traps this file has to work around, both recorded in
-- docs/homewood/care-events-as-built-2026-09-16.md section 1:
--   * the replay stub carries no Supabase default privileges, so `authenticated`
--     needs explicit grants before an RLS assertion means anything;
--   * submit_care_event sets haven.care_event_definer with is_local => true,
--     which is transaction-local. PostgREST gives each request its own
--     transaction; this probe shares one, so it clears the flag before every
--     assertion that depends on the reporter column guard or on RLS.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;

CREATE TEMP TABLE wf AS
SELECT f.id facility, f.organization_id org, f.entity_id entity,
       gen_random_uuid() facility_b,
       gen_random_uuid() admin_u,  gen_random_uuid() admin_s,
       gen_random_uuid() cg_a,     gen_random_uuid() cg_a_s,
       gen_random_uuid() cg_b,     gen_random_uuid() cg_b_s,
       gen_random_uuid() cg_c,     gen_random_uuid() cg_c_s,
       gen_random_uuid() cg_far,   gen_random_uuid() cg_far_s,
       gen_random_uuid() staff_a,  gen_random_uuid() staff_b,
       gen_random_uuid() staff_c,  gen_random_uuid() staff_far,
       gen_random_uuid() resident
FROM public.facilities f WHERE f.deleted_at IS NULL ORDER BY f.name LIMIT 1;

INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility_b, entity, org, 'COL354 witness scope probe', 'Test', 'Test', '00000', 1 FROM wf;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT admin_u, admin_u||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','facility_admin'), '{"full_name":"Probe Administrator"}'::jsonb FROM wf
  UNION ALL SELECT cg_a,   cg_a||'@review.invalid',   jsonb_build_object('organization_id',org,'app_role','med_tech'), '{"full_name":"Probe Caregiver A"}'::jsonb FROM wf
  UNION ALL SELECT cg_b,   cg_b||'@review.invalid',   jsonb_build_object('organization_id',org,'app_role','med_tech'), '{"full_name":"Probe Caregiver B"}'::jsonb FROM wf
  UNION ALL SELECT cg_c,   cg_c||'@review.invalid',   jsonb_build_object('organization_id',org,'app_role','med_tech'), '{"full_name":"Probe Caregiver C"}'::jsonb FROM wf
  UNION ALL SELECT cg_far, cg_far||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','med_tech'), '{"full_name":"Probe Caregiver Far"}'::jsonb FROM wf;

INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT admin_u, admin_u||'@review.invalid','Probe Administrator','facility_admin'::public.app_role,org,true FROM wf
  UNION ALL SELECT cg_a,   cg_a||'@review.invalid',  'Probe Caregiver A','med_tech'::public.app_role,org,true FROM wf
  UNION ALL SELECT cg_b,   cg_b||'@review.invalid',  'Probe Caregiver B','med_tech'::public.app_role,org,true FROM wf
  UNION ALL SELECT cg_c,   cg_c||'@review.invalid',  'Probe Caregiver C','med_tech'::public.app_role,org,true FROM wf
  UNION ALL SELECT cg_far, cg_far||'@review.invalid','Probe Caregiver Far','med_tech'::public.app_role,org,true FROM wf;

INSERT INTO auth.sessions(id,user_id)
  SELECT admin_s, admin_u FROM wf UNION ALL SELECT cg_a_s, cg_a FROM wf
  UNION ALL SELECT cg_b_s, cg_b FROM wf UNION ALL SELECT cg_c_s, cg_c FROM wf
  UNION ALL SELECT cg_far_s, cg_far FROM wf;

INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT admin_u, facility, org FROM wf
  UNION ALL SELECT cg_a, facility, org FROM wf
  UNION ALL SELECT cg_b, facility, org FROM wf
  UNION ALL SELECT cg_c, facility, org FROM wf
  UNION ALL SELECT cg_far, facility_b, org FROM wf;

INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date,employment_status)
  SELECT staff_a,   org, facility,   cg_a,   'Probe Staff','A',   'resident_aide'::public.staff_role, current_date-100, 'active'::public.employment_status FROM wf
  UNION ALL SELECT staff_b,   org, facility,   cg_b,   'Probe Staff','B',   'resident_aide'::public.staff_role, current_date-100, 'active'::public.employment_status FROM wf
  UNION ALL SELECT staff_c,   org, facility,   cg_c,   'Probe Staff','C',   'resident_aide'::public.staff_role, current_date-100, 'active'::public.employment_status FROM wf
  UNION ALL SELECT staff_far, org, facility_b, cg_far, 'Probe Staff','Far', 'resident_aide'::public.staff_role, current_date-100, 'active'::public.employment_status FROM wf;

INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,admission_date,status)
  SELECT resident, org, facility, 'Probe','Resident', current_date-30000,'prefer_not_to_say'::public.gender, current_date-100,'active'::public.resident_status FROM wf;

-- The probe's clock is the facility's, not the server's. submit_care_event
-- derives the shift from `occurred_at AT TIME ZONE <facility tz>`, so
-- `date_trunc('day', now()) + 18 hours` only means "evening" when the session
-- already sits in Eastern. CI replays with the session at UTC, where that
-- expression is 2 p.m. Eastern -- a day shift -- so the evening roster below
-- matched nobody and care_event_sync_witness_tasks fell through to its single
-- unassigned row: expected 2, got 1. Yesterday at 6 p.m. Eastern is evening
-- wherever the session sits, and is always in the past whatever the hour.
CREATE TEMP TABLE wclock AS
SELECT ev,
       (ev AT TIME ZONE 'America/New_York')::date AS shift_date,
       date_trunc('week', (ev AT TIME ZONE 'America/New_York')::date)::date AS week_start
FROM (SELECT ((date_trunc('day', now() AT TIME ZONE 'America/New_York') - interval '1 day' + interval '18 hours') AT TIME ZONE 'America/New_York') AS ev) t;
GRANT SELECT ON wclock TO authenticated, service_role;

-- Three aides on that evening shift at the facility, one at the other building.
CREATE TEMP TABLE wsched AS SELECT gen_random_uuid() sched_a, gen_random_uuid() sched_b;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date,status)
  SELECT sched_a, facility, org, week_start, 'published'::public.schedule_status FROM wf, wsched, wclock
  WHERE NOT EXISTS (SELECT 1 FROM public.schedules s WHERE s.facility_id=(SELECT facility FROM wf) AND s.week_start_date=(SELECT week_start FROM wclock))
  UNION ALL SELECT sched_b, facility_b, org, week_start, 'published'::public.schedule_status FROM wf, wsched, wclock;
UPDATE wsched SET sched_a = COALESCE(
  (SELECT s.id FROM public.schedules s WHERE s.facility_id=(SELECT facility FROM wf) AND s.week_start_date=(SELECT week_start FROM wclock) LIMIT 1), sched_a);

INSERT INTO public.shift_assignments(schedule_id,organization_id,facility_id,staff_id,shift_date,shift_type,status)
  SELECT sched_a, org, facility, staff_a, shift_date, 'evening'::public.shift_type, 'assigned'::public.shift_assignment_status FROM wf, wsched, wclock
  UNION ALL SELECT sched_a, org, facility, staff_b, shift_date, 'evening'::public.shift_type, 'assigned'::public.shift_assignment_status FROM wf, wsched, wclock
  UNION ALL SELECT sched_a, org, facility, staff_c, shift_date, 'evening'::public.shift_type, 'assigned'::public.shift_assignment_status FROM wf, wsched, wclock
  UNION ALL SELECT sched_b, org, facility_b, staff_far, shift_date, 'evening'::public.shift_type, 'assigned'::public.shift_assignment_status FROM wf, wsched, wclock;

-- The seed in 403 targets organization 00000000-...-001. Mirror it when the
-- probe's facility belongs to another organization.
INSERT INTO public.incident_followup_protocols (organization_id, facility_id, kind, min_level, requires_flag, task_type, description, due_offset_minutes, repeat_every_minutes, repeat_until_minutes, assign_to_role, is_active)
SELECT (SELECT org FROM wf), NULL, p.kind, p.min_level, p.requires_flag, p.task_type, p.description, p.due_offset_minutes, p.repeat_every_minutes, p.repeat_until_minutes, p.assign_to_role, true
FROM public.incident_followup_protocols p
WHERE p.organization_id = '00000000-0000-0000-0000-000000000001' AND p.facility_id IS NULL
  AND (SELECT org FROM wf) <> '00000000-0000-0000-0000-000000000001';

-- Hosted Supabase grants every table to authenticated through default
-- privileges; the replay stub does not. Mirror that so the assertions below
-- test row level security rather than a missing grant.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE FUNCTION pg_temp.actor(p uuid, s uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',p,'session_id',s,'role','authenticated',
    'auth_claim_version',up.auth_claim_version,'app_role',up.app_role,'organization_id',up.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)
  FROM public.user_profiles up WHERE up.id = p;
  -- Clear the transaction-local definer flag a previous submit may have left set.
  PERFORM set_config('haven.care_event_definer', '', true);
END $$;

CREATE FUNCTION pg_temp.must_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected "%" but got "%"', expected, SQLERRM;
  END;
  RAISE EXCEPTION 'Expected failure: %', expected;
END $$;

GRANT SELECT ON wf TO authenticated, service_role;

-- ===========================================================================
-- Witness statements
-- ===========================================================================

-- 1. A Level 2 fall reported by caregiver A creates a task for B and C, not A.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
CREATE TEMP TABLE w_l2 AS
SELECT public.submit_care_event(jsonb_build_object(
  'client_event_id', gen_random_uuid(),
  'facility_id', (SELECT facility FROM wf),
  'resident_id', (SELECT resident FROM wf),
  'kind', 'fall',
  'occurred_at', (SELECT ev FROM wclock)::text,
  'answers', jsonb_build_object('hurt','a_little','head','no','witnessed','yes','going_out','no')
)) AS r;
GRANT ALL ON w_l2 TO authenticated, service_role;
RESET ROLE;

DO $$
DECLARE v_incident uuid; v_n integer; v_reporter integer;
BEGIN
  SELECT ce.incident_id INTO v_incident FROM public.care_events ce
  WHERE ce.id = (SELECT (r->>'care_event_id')::uuid FROM w_l2);
  IF v_incident IS NULL THEN RAISE EXCEPTION 'Level 2 fall produced no incident'; END IF;

  SELECT count(*) INTO v_n FROM public.incident_followups f
  WHERE f.incident_id = v_incident AND f.task_type = 'witness_statement' AND f.deleted_at IS NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Level 2 witness tasks: expected 2 (the two aides who were not the reporter), got %', v_n;
  END IF;

  SELECT count(*) INTO v_reporter FROM public.incident_followups f
  WHERE f.incident_id = v_incident AND f.task_type = 'witness_statement'
    AND f.assigned_to = (SELECT cg_a FROM wf) AND f.deleted_at IS NULL;
  IF v_reporter <> 0 THEN
    RAISE EXCEPTION 'The reporter was asked for a witness statement on their own event';
  END IF;

  -- The aide at the other building is not on this shift roster.
  IF EXISTS (
    SELECT 1 FROM public.incident_followups f
    WHERE f.incident_id = v_incident AND f.task_type = 'witness_statement'
      AND f.assigned_to = (SELECT cg_far FROM wf)
  ) THEN
    RAISE EXCEPTION 'A staff member at another facility was asked for a witness statement';
  END IF;
END $$;

-- 2. A Level 1 note creates no incident and therefore no witness task.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
CREATE TEMP TABLE w_l1 AS
SELECT public.submit_care_event(jsonb_build_object(
  'client_event_id', gen_random_uuid(),
  'facility_id', (SELECT facility FROM wf),
  'resident_id', (SELECT resident FROM wf),
  'kind', 'medication',
  'answers', jsonb_build_object('what','refused','reaction','no')
)) AS r;
GRANT ALL ON w_l1 TO authenticated, service_role;
RESET ROLE;

DO $$ DECLARE v_level integer; v_incident uuid; BEGIN
  SELECT (r->>'level')::integer INTO v_level FROM w_l1;
  SELECT ce.incident_id INTO v_incident FROM public.care_events ce WHERE ce.id = (SELECT (r->>'care_event_id')::uuid FROM w_l1);
  IF v_level <> 1 THEN RAISE EXCEPTION 'Medicine refused should derive Level 1, got %', v_level; END IF;
  IF v_incident IS NOT NULL THEN RAISE EXCEPTION 'A Note created an incident'; END IF;
END $$;

-- 3. Caregiver B cannot complete caregiver C's task.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_b, cg_b_s) FROM wf;
DO $$ DECLARE v_task uuid; BEGIN
  SELECT f.id INTO v_task FROM public.incident_followups f
  WHERE f.task_type='witness_statement' AND f.assigned_to = (SELECT cg_c FROM wf) AND f.deleted_at IS NULL LIMIT 1;
  IF v_task IS NULL THEN RAISE EXCEPTION 'No task assigned to caregiver C to try'; END IF;
  PERFORM pg_temp.must_fail(
    format('SELECT public.complete_incident_followup(%L, %L, NULL)', v_task, 'saw_it'),
    'given by the person it was assigned to');
END $$;

-- 2026-09-22: caregivers are med-techs now (migration 464), and med_tech holds what the
-- nurse held — including the follow-up supervision RLS gives it. So B's direct UPDATE of
-- C's follow-up is allowed through RLS; the witness function above still refuses it.
-- The row is put back so the rest of this probe sees C's task open.
DO $$ DECLARE v_task uuid; v_rows integer; BEGIN
  SELECT f.id INTO v_task FROM public.incident_followups f
  WHERE f.task_type='witness_statement' AND f.assigned_to = (SELECT cg_c FROM wf) AND f.deleted_at IS NULL LIMIT 1;
  UPDATE public.incident_followups SET completed_at = now() WHERE id = v_task;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Med-tech lost the follow-up supervision nurse held';
  END IF;
  UPDATE public.incident_followups SET completed_at = NULL WHERE id = v_task;
END $$;
RESET ROLE;

-- 4. Each of the three choices completes, and a note stays optional.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_b, cg_b_s) FROM wf;
DO $$ DECLARE v_task uuid; v_out jsonb; BEGIN
  SELECT f.id INTO v_task FROM public.incident_followups f
  WHERE f.task_type='witness_statement' AND f.assigned_to = (SELECT cg_b FROM wf) AND f.deleted_at IS NULL LIMIT 1;
  v_out := public.complete_incident_followup(v_task, 'saw_it', NULL);
  IF v_out->>'witness_choice' <> 'saw_it' THEN RAISE EXCEPTION 'saw_it did not stick'; END IF;
  -- 5. A second completion is refused.
  PERFORM pg_temp.must_fail(
    format('SELECT public.complete_incident_followup(%L, %L, NULL)', v_task, 'did_not_see_it'),
    'already complete');
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_c, cg_c_s) FROM wf;
DO $$ DECLARE v_task uuid; BEGIN
  SELECT f.id INTO v_task FROM public.incident_followups f
  WHERE f.task_type='witness_statement' AND f.assigned_to = (SELECT cg_c FROM wf) AND f.deleted_at IS NULL LIMIT 1;
  -- 6. A choice outside the three is refused, on the caller's own task.
  PERFORM pg_temp.must_fail(
    format('SELECT public.complete_incident_followup(%L, %L, NULL)', v_task, 'maybe'),
    'choose I saw it');
  -- A witness statement with no choice at all is refused: the choice is the answer.
  PERFORM pg_temp.must_fail(
    format('SELECT public.complete_incident_followup(%L, NULL, NULL)', v_task),
    'choose I saw it');
  PERFORM public.complete_incident_followup(v_task, 'arrived_after', 'Came on at the change of shift.');
END $$;
RESET ROLE;

DO $$ DECLARE v_choices text; BEGIN
  SELECT string_agg(DISTINCT f.witness_choice, ',' ORDER BY f.witness_choice) INTO v_choices
  FROM public.incident_followups f WHERE f.task_type='witness_statement' AND f.completed_at IS NOT NULL;
  IF v_choices IS DISTINCT FROM 'arrived_after,saw_it' THEN
    RAISE EXCEPTION 'Recorded witness choices were %', COALESCE(v_choices,'none');
  END IF;
END $$;

-- 7. The administrator adds a witness the roster missed, and cannot add the reporter.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(admin_u, admin_s) FROM wf;
DO $$ DECLARE v_event uuid; v_out jsonb; v_task uuid; BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l2;

  PERFORM pg_temp.must_fail(
    format('SELECT public.care_event_add_witness(%L, %L)', v_event, (SELECT cg_a FROM wf)),
    'the reporter already gave the account');

  PERFORM pg_temp.must_fail(
    format('SELECT public.care_event_add_witness(%L, %L)', v_event, (SELECT cg_far FROM wf)),
    'not at a facility you can see');

  -- Adding somebody who already has a task returns the existing one.
  v_out := public.care_event_add_witness(v_event, (SELECT cg_b FROM wf));
  IF (v_out->>'created')::boolean THEN RAISE EXCEPTION 'A duplicate witness task was created'; END IF;

  -- 8. Remove an unanswered request; refuse to remove a given statement.
  SELECT f.id INTO v_task FROM public.incident_followups f
  WHERE f.task_type='witness_statement' AND f.completed_at IS NOT NULL AND f.deleted_at IS NULL LIMIT 1;
  PERFORM pg_temp.must_fail(
    format('SELECT public.care_event_remove_witness(%L, NULL)', v_task),
    'stays on the record');
END $$;
RESET ROLE;

-- An unanswered request can be withdrawn, and then the administrator can re-add.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
CREATE TEMP TABLE w_l3 AS
SELECT public.submit_care_event(jsonb_build_object(
  'client_event_id', gen_random_uuid(),
  'facility_id', (SELECT facility FROM wf),
  'resident_id', (SELECT resident FROM wf),
  'kind', 'fall',
  'occurred_at', (SELECT ev FROM wclock)::text,
  'answers', jsonb_build_object('hurt','a_little','head','yes','witnessed','no','going_out','no')
)) AS r;
GRANT ALL ON w_l3 TO authenticated, service_role;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(admin_u, admin_s) FROM wf;
DO $$ DECLARE v_event uuid; v_task uuid; v_out jsonb; BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l3;
  SELECT f.id INTO v_task FROM public.incident_followups f
  JOIN public.care_events ce ON ce.incident_id = f.incident_id AND ce.id = v_event
  WHERE f.task_type='witness_statement' AND f.completed_at IS NULL AND f.assigned_to = (SELECT cg_b FROM wf)
    AND f.deleted_at IS NULL LIMIT 1;
  IF v_task IS NULL THEN RAISE EXCEPTION 'The Level 3 fall produced no open witness task for caregiver B'; END IF;
  PERFORM public.care_event_remove_witness(v_task, 'not_on_unit');
  IF EXISTS (SELECT 1 FROM public.incident_followups f WHERE f.id = v_task AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The withdrawn witness request is still live';
  END IF;
  v_out := public.care_event_add_witness(v_event, (SELECT cg_b FROM wf));
  IF NOT (v_out->>'created')::boolean THEN RAISE EXCEPTION 'Re-adding a withdrawn witness did not create a task'; END IF;
END $$;
RESET ROLE;

-- ===========================================================================
-- Attachments
-- ===========================================================================

-- 9. The bucket is private, takes PDF, and stops at 20 MB.
DO $$ DECLARE b record; BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'incident-photos';
  IF b.id IS NULL THEN RAISE EXCEPTION 'The incident-photos bucket is missing'; END IF;
  IF b.public THEN RAISE EXCEPTION 'The incident-photos bucket is public'; END IF;
  IF b.file_size_limit <> 20971520 THEN RAISE EXCEPTION 'Bucket size limit is %', b.file_size_limit; END IF;
  IF NOT ('application/pdf' = ANY (b.allowed_mime_types)) THEN RAISE EXCEPTION 'The bucket refuses PDF'; END IF;
  IF 'text/html' = ANY (b.allowed_mime_types) THEN RAISE EXCEPTION 'The bucket accepts an unexpected type'; END IF;
END $$;

-- 10. The three storage policies still scope on organization and facility.
DO $$ DECLARE v_n integer; BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'incident_photos_%';
  IF v_n < 3 THEN RAISE EXCEPTION 'Expected the three incident-photos storage policies, found %', v_n; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'incident_photos_%'
      AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%accessible_facility_ids%'
  ) THEN
    RAISE EXCEPTION 'An incident-photos storage policy does not scope on accessible_facility_ids';
  END IF;
END $$;

-- 11. Kind, path law, duplicates and the ten-file cap.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
DO $$
DECLARE
  v_event uuid; v_org uuid; v_fac uuid; v_prefix text; v_out jsonb; i integer;
BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l2;
  SELECT ce.organization_id, ce.facility_id INTO v_org, v_fac FROM public.care_events ce WHERE ce.id = v_event;
  v_prefix := v_org::text || '/' || v_fac::text || '/' || v_event::text || '/';

  -- A path outside the law the storage policies depend on is refused.
  PERFORM pg_temp.must_fail(
    format('SELECT public.attach_care_event_file(%L, %L, %L, NULL)', v_event, 'somewhere-else/a.pdf', 'photo'),
    'file path must be');
  PERFORM pg_temp.must_fail(
    format('SELECT public.attach_care_event_file(%L, %L, %L, NULL)', v_event, v_prefix || 'nested/a.pdf', 'photo'),
    'file path must be');

  -- An unknown kind is refused.
  PERFORM pg_temp.must_fail(
    format('SELECT public.attach_care_event_file(%L, %L, %L, NULL)', v_event, v_prefix || 'a.pdf', 'xray'),
    'unknown attachment kind');

  -- The four kinds land, with their kind on incident_photos.
  PERFORM public.attach_care_event_file(v_event, v_prefix || 'k1.jpg', 'photo', NULL);
  PERFORM public.attach_care_event_file(v_event, v_prefix || 'k2.pdf', 'scanned_form', NULL);
  PERFORM public.attach_care_event_file(v_event, v_prefix || 'k3.pdf', 'physician_order', NULL);
  PERFORM public.attach_care_event_file(v_event, v_prefix || 'k4.pdf', 'other', NULL);

  -- The same path twice is refused.
  PERFORM pg_temp.must_fail(
    format('SELECT public.attach_care_event_file(%L, %L, %L, NULL)', v_event, v_prefix || 'k1.jpg', 'photo'),
    'already attached');

  -- Fill to ten, then refuse the eleventh.
  FOR i IN 5..10 LOOP
    PERFORM public.attach_care_event_file(v_event, v_prefix || 'f' || i || '.jpg', 'photo', NULL);
  END LOOP;
  v_out := to_jsonb((SELECT ce.answers -> 'attachments' FROM public.care_events ce WHERE ce.id = v_event));
  PERFORM pg_temp.must_fail(
    format('SELECT public.attach_care_event_file(%L, %L, %L, NULL)', v_event, v_prefix || 'f11.jpg', 'photo'),
    'ten files is the limit');
END $$;
RESET ROLE;

DO $$ DECLARE v_kinds text; v_n integer; BEGIN
  SELECT count(*), string_agg(DISTINCT kind, ',' ORDER BY kind) INTO v_n, v_kinds
  FROM public.incident_photos WHERE kind IS NOT NULL;
  IF v_n <> 10 THEN RAISE EXCEPTION 'Expected ten attachments, found %', v_n; END IF;
  IF v_kinds IS DISTINCT FROM 'other,photo,physician_order,scanned_form' THEN
    RAISE EXCEPTION 'Recorded attachment kinds were %', COALESCE(v_kinds,'none');
  END IF;
END $$;

-- 11b. A Level 1 Note has no incident, and its files must still be findable.
-- Before COL-354 the row was only written when an incident existed and the view
-- joined through it, so a Note's photo reached the bucket and no surface.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
DO $$
DECLARE v_event uuid; v_org uuid; v_fac uuid; v_prefix text; v_rows integer; v_incident uuid;
BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l1;
  SELECT ce.organization_id, ce.facility_id, ce.incident_id INTO v_org, v_fac, v_incident
  FROM public.care_events ce WHERE ce.id = v_event;
  IF v_incident IS NOT NULL THEN
    RAISE EXCEPTION 'The Level 1 fixture grew an incident; this probe no longer tests what it claims';
  END IF;

  v_prefix := v_org::text || '/' || v_fac::text || '/' || v_event::text || '/';
  PERFORM public.attach_care_event_file(v_event, v_prefix || 'note.jpg', 'photo', NULL);

  SELECT count(*) INTO v_rows FROM public.v_care_event_attachments v WHERE v.care_event_id = v_event;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'A Level 1 Note''s attachment is invisible: expected 1 row, got %', v_rows;
  END IF;

  SELECT count(*) INTO v_rows FROM public.incident_photos ip
  WHERE ip.care_event_id = v_event AND ip.incident_id IS NULL;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'A Level 1 Note''s file has no incident_photos row: got %', v_rows;
  END IF;
END $$;
RESET ROLE;

-- 11c. append_care_event_note's photo path goes through the same writer, so the
-- kind, the duplicate check and the ten-file cap cannot be walked past.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
DO $$
DECLARE v_event uuid; v_org uuid; v_fac uuid; v_prefix text; v_kind text;
BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l1;
  SELECT ce.organization_id, ce.facility_id INTO v_org, v_fac FROM public.care_events ce WHERE ce.id = v_event;
  v_prefix := v_org::text || '/' || v_fac::text || '/' || v_event::text || '/';

  PERFORM public.append_care_event_note(v_event, 'Voice note on a Note.', v_prefix || 'via-note.jpg');
  SELECT kind INTO v_kind FROM public.incident_photos WHERE storage_path = v_prefix || 'via-note.jpg';
  IF v_kind IS DISTINCT FROM 'photo' THEN
    RAISE EXCEPTION 'append_care_event_note did not record a kind: %', COALESCE(v_kind,'null');
  END IF;

  -- The same path twice is refused by the shared writer.
  PERFORM pg_temp.must_fail(
    format('SELECT public.append_care_event_note(%L, NULL, %L)', v_event, v_prefix || 'via-note.jpg'),
    'already attached');

  -- And the path law still holds through the older entry point.
  PERFORM pg_temp.must_fail(
    format('SELECT public.append_care_event_note(%L, NULL, %L)', v_event, 'elsewhere/x.jpg'),
    'file path must be');
END $$;
RESET ROLE;

-- 12. A caregiver at facility B cannot read facility A's attachment rows.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_far, cg_far_s) FROM wf;
DO $$ DECLARE v_n integer; BEGIN
  SELECT count(*) INTO v_n FROM public.v_care_event_attachments;
  IF v_n <> 0 THEN RAISE EXCEPTION 'A caregiver at another facility read % attachment rows', v_n; END IF;
END $$;
RESET ROLE;

-- 13. The attachment list carries kind and uploader for the administrator.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(admin_u, admin_s) FROM wf;
DO $$ DECLARE v_n integer; BEGIN
  SELECT count(*) INTO v_n FROM public.v_care_event_attachments
  WHERE kind IS NOT NULL AND taken_by IS NOT NULL;
  IF v_n < 10 THEN RAISE EXCEPTION 'The attachment list showed % rows with a kind and an uploader', v_n; END IF;
END $$;
RESET ROLE;

-- ===========================================================================
-- Print record
-- ===========================================================================

-- 14. Role checks, and the payload carries ids but no name.
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(cg_a, cg_a_s) FROM wf;
DO $$ DECLARE v_event uuid; BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l2;
  -- 2026-09-22: this staff member is a med-tech now (caregiver folded into med_tech),
  -- and med_tech holds the nurse's print authority for the physician sheet and log.
  PERFORM public.care_event_print_record('physician_sheet', v_event, NULL, NULL, NULL);
  PERFORM public.care_event_print_record('incident_reports_log', NULL, (SELECT facility FROM wf), NULL, NULL);
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(admin_u, admin_s) FROM wf;
DO $$ DECLARE v_event uuid; BEGIN
  SELECT (r->>'care_event_id')::uuid INTO v_event FROM w_l2;
  PERFORM public.care_event_print_record('incident_form', v_event, NULL, NULL, NULL);
  PERFORM public.care_event_print_record('physician_sheet', v_event, NULL, NULL, NULL);
  PERFORM public.care_event_print_record('incident_reports_log', NULL, (SELECT facility FROM wf), current_date - 30, current_date);
  PERFORM pg_temp.must_fail(
    format('SELECT public.care_event_print_record(%L, NULL, %L, NULL, NULL)', 'made_up_kind', (SELECT facility FROM wf)),
    'unknown print kind');
  -- The taxonomy packet is owner and org_admin only; a facility_admin is refused.
  PERFORM pg_temp.must_fail(
    format('SELECT public.care_event_print_record(%L, NULL, %L, NULL, NULL)', 'taxonomy_packet', (SELECT facility FROM wf)),
    'print: forbidden');
END $$;
RESET ROLE;

DO $$ DECLARE v_n integer; v_bad integer; BEGIN
  SELECT count(*) INTO v_n FROM public.audit_log WHERE table_name = 'care_event_print';
  -- Three admin prints plus the two the med-tech may now make (see step 14).
  IF v_n <> 5 THEN RAISE EXCEPTION 'Expected five print rows, found %', v_n; END IF;

  -- No name of any kind reaches the payload: not the resident, not the staff.
  SELECT count(*) INTO v_bad FROM public.audit_log a
  WHERE a.table_name = 'care_event_print'
    AND (a.new_data::text ILIKE '%Probe Resident%'
      OR a.new_data::text ILIKE '%Probe Caregiver%'
      OR a.new_data::text ILIKE '%Probe Administrator%'
      OR a.new_data ? 'resident_name'
      OR a.new_data ? 'printed_by_name');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'A print audit payload carried a name'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.table_name='care_event_print' AND a.new_data->>'print_kind'='physician_sheet'
      AND a.user_id IS NOT NULL AND a.facility_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The physician sheet print row is missing its actor or facility';
  END IF;
END $$;

-- 15. Grant posture: the private helper is unreachable from every request role.
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.care_event_sync_witness_tasks(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.care_event_sync_witness_tasks(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.complete_incident_followup(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.attach_care_event_file(uuid,text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.care_event_print_record(text,uuid,uuid,date,date)','EXECUTE')
     OR has_function_privilege('anon','public.care_event_add_witness(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.care_event_remove_witness(uuid,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Care-event witness or attachment grant boundary failed'; END IF;
END $$;

ROLLBACK;
