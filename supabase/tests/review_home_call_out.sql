-- COL-596 (Home W4): phone-first call-out. Native scratch-only probe; every
-- fixture rolls back. Synthetic staff only.
--
-- Protects: dark until released; a manager (who cannot write shifts directly)
-- can record a call-out from Home; the shift becomes called_out and one
-- attendance event is written that Stand Up's callout count reads; the shift
-- is uncovered until covered; covering links the replacement and clears it;
-- no double cover, no double call-out, replay by id.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE TEMP TABLE co AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() mgr_actor, gen_random_uuid() mgr_session,
       gen_random_uuid() entity, gen_random_uuid() facility, o.id org,
       gen_random_uuid() schedule, gen_random_uuid() aide_a, gen_random_uuid() aide_b, gen_random_uuid() aide_c,
       gen_random_uuid() shift_a, gen_random_uuid() shift_b, gen_random_uuid() cover_id, gen_random_uuid() event_id,
       (now() AT TIME ZONE 'America/New_York')::date today
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
GRANT SELECT ON co TO authenticated;

INSERT INTO public.entities(id,organization_id,name,entity_type,status) SELECT entity, org, 'Call-out Probe LLC', 'llc', 'active'::public.entity_status FROM co;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility, entity, org, 'Call-out Probe House', '1 Probe Way', 'Probeville', '00000', 10 FROM co;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT u, u||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM co, LATERAL unnest(ARRAY[owner_actor, mgr_actor]) u;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Owner probe','owner'::public.app_role,org,true FROM co
  UNION ALL SELECT mgr_actor, mgr_actor||'@review.invalid','Mo Manager','manager'::public.app_role,org,true FROM co;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session, owner_actor FROM co UNION ALL SELECT mgr_session, mgr_actor FROM co;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT u, facility, org FROM co, LATERAL unnest(ARRAY[owner_actor, mgr_actor]) u;
INSERT INTO public.staff(id,facility_id,organization_id,first_name,last_name,staff_role,hire_date)
  SELECT aide_a, facility, org, 'Ann', 'Probe', (SELECT enum_range(NULL::public.staff_role))[1], current_date - 300 FROM co
  UNION ALL SELECT aide_b, facility, org, 'Ben', 'Probe', (SELECT enum_range(NULL::public.staff_role))[1], current_date - 300 FROM co
  UNION ALL SELECT aide_c, facility, org, 'Cy', 'Probe', (SELECT enum_range(NULL::public.staff_role))[1], current_date - 300 FROM co;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date,status)
  SELECT schedule, facility, org, date_trunc('week', today)::date, 'draft'::public.schedule_status FROM co;
INSERT INTO public.shift_assignments(id,schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,status,custom_start_time,custom_end_time)
  SELECT shift_a, schedule, aide_a, facility, org, today, 'day'::public.shift_type, 'assigned'::public.shift_assignment_status, time '06:00', time '18:00' FROM co
  UNION ALL SELECT shift_b, schedule, aide_b, facility, org, today, 'day'::public.shift_type, 'confirmed'::public.shift_assignment_status, time '06:00', time '18:00' FROM co;

CREATE FUNCTION pg_temp.co_as(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;
CREATE FUNCTION pg_temp.co_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'COL-596 expected failure: %', expected;
END $$;

SELECT pg_temp.co_as(owner_actor, owner_session) FROM co;
UPDATE public.schedules SET status='published' WHERE id=(SELECT schedule FROM co);
SET LOCAL ROLE authenticated;

-- 1. Dark until released.
SELECT pg_temp.co_as(mgr_actor, mgr_session) FROM co;
SELECT pg_temp.co_fail(format('SELECT public.home_record_callout(%L,%L,''sick'')', event_id, shift_a), 'not switched on') FROM co;
SELECT pg_temp.co_as(owner_actor, owner_session) FROM co;
SELECT public.home_set_module_release(facility, 'call_out', true, 'probe') FROM co;

-- 2. A manager records the call-out; the shift is uncovered; attendance is written.
SELECT pg_temp.co_as(mgr_actor, mgr_session) FROM co;
SELECT pg_temp.co_fail(format('SELECT public.home_record_callout(gen_random_uuid(),%L,''hungover'')', shift_a), 'Reason must be') FROM co;
SELECT public.home_record_callout(event_id, shift_a, 'sick', 'Fever since last night') FROM co;
SELECT public.home_record_callout(event_id, shift_a, 'sick', 'Fever since last night') FROM co;  -- replay
SELECT pg_temp.co_fail(format('SELECT public.home_record_callout(gen_random_uuid(),%L,''family'')', shift_a), 'already called out') FROM co;
DO $$ DECLARE got jsonb; f co; BEGIN
  SELECT * INTO f FROM co;
  got := public.home_shifts_today(f.facility);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(got->'shifts') e WHERE (e->>'assignmentId')::uuid = f.shift_a AND (e->>'uncovered')::boolean) THEN
    RAISE EXCEPTION 'COL-596: the called-out shift is not uncovered: %', got;
  END IF;
  IF jsonb_array_length(got->'staff') <> 3 THEN RAISE EXCEPTION 'COL-596: roster missing from the call-out read'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f co; BEGIN
  SELECT * INTO f FROM co;
  IF (SELECT status::text FROM public.shift_assignments WHERE id = f.shift_a) <> 'called_out' THEN
    RAISE EXCEPTION 'COL-596: the shift was not marked called_out';
  END IF;
  IF (SELECT count(*) FROM public.staff_attendance_events WHERE shift_assignment_id = f.shift_a AND event_type = 'callout' AND reason = 'sick') <> 1 THEN
    RAISE EXCEPTION 'COL-596: expected exactly one callout attendance event (Stand Up counts these)';
  END IF;
END $$;
SET LOCAL ROLE authenticated;

-- 3. Cover: not with the same person, not with someone already on the shift; then it clears.
SELECT pg_temp.co_fail(format('SELECT public.home_cover_shift(%L,%L,%L)', cover_id, shift_a, aide_a), 'Pick someone else') FROM co;
SELECT pg_temp.co_fail(format('SELECT public.home_cover_shift(%L,%L,%L)', cover_id, shift_a, aide_b), 'already on this shift') FROM co;
SELECT public.home_cover_shift(cover_id, shift_a, aide_c) FROM co;
SELECT public.home_cover_shift(cover_id, shift_a, aide_c) FROM co;  -- replay
SELECT pg_temp.co_fail(format('SELECT public.home_cover_shift(gen_random_uuid(),%L,%L)', shift_a, aide_c), 'already covered') FROM co;
DO $$ DECLARE got jsonb; f co; BEGIN
  SELECT * INTO f FROM co;
  got := public.home_shifts_today(f.facility);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(got->'shifts') e WHERE (e->>'uncovered')::boolean) THEN
    RAISE EXCEPTION 'COL-596: a covered shift still reads uncovered: %', got;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(got->'shifts') e WHERE (e->>'assignmentId')::uuid = f.cover_id AND (e->>'coversAssignmentId')::uuid = f.shift_a) THEN
    RAISE EXCEPTION 'COL-596: the replacement is not linked to the shift it covers';
  END IF;
END $$;

-- 4. No-show is its own status and event.
SELECT public.home_record_callout(gen_random_uuid(), shift_b, 'no_show') FROM co;
RESET ROLE;
DO $$ DECLARE f co; BEGIN
  SELECT * INTO f FROM co;
  IF (SELECT status::text FROM public.shift_assignments WHERE id = f.shift_b) <> 'no_show'
     OR NOT EXISTS (SELECT 1 FROM public.staff_attendance_events WHERE shift_assignment_id = f.shift_b AND event_type = 'no_show') THEN
    RAISE EXCEPTION 'COL-596: a no-show was not recorded as one';
  END IF;
END $$;

ROLLBACK;
