-- COL-595 (Home W3): Quick note → task, and the collections contact log.
-- Native scratch-only probe; every fixture rolls back. Synthetic people only.
--
-- Protects: dark until released; only Home operators write; a dated or
-- assigned note reaches the right person's On tap on its date and not before;
-- a thread appends and closes; a person or vendor from another facility is
-- refused; a voicemail schedules tomorrow's retry; an escalation reaches only
-- the named Facility Executive.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE TEMP TABLE qn AS
SELECT gen_random_uuid() owner_actor, gen_random_uuid() owner_session,
       gen_random_uuid() fa_actor, gen_random_uuid() fa_session,
       gen_random_uuid() mgr_actor, gen_random_uuid() mgr_session,
       gen_random_uuid() aide_actor, gen_random_uuid() aide_session,
       gen_random_uuid() exec_actor, gen_random_uuid() exec_session,
       gen_random_uuid() entity, gen_random_uuid() facility, gen_random_uuid() other_facility, o.id org,
       gen_random_uuid() resident, gen_random_uuid() vendor, gen_random_uuid() other_vendor,
       gen_random_uuid() note_1, gen_random_uuid() note_2, gen_random_uuid() note_3
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
GRANT SELECT ON qn TO authenticated;

INSERT INTO public.entities(id,organization_id,name,entity_type,status) SELECT entity, org, 'Quick Note Probe LLC', 'llc', 'active'::public.entity_status FROM qn;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT facility, entity, org, 'Quick Note Probe House', '1 Probe Way', 'Probeville', '00000', 10 FROM qn
  UNION ALL SELECT other_facility, entity, org, 'Quick Note Other House', '2 Probe Way', 'Probeville', '00000', 10 FROM qn;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT u, u||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM qn, LATERAL unnest(ARRAY[owner_actor,fa_actor,mgr_actor,aide_actor,exec_actor]) u;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT owner_actor, owner_actor||'@review.invalid','Owner probe','owner'::public.app_role,org,true FROM qn
  UNION ALL SELECT fa_actor, fa_actor||'@review.invalid','Ada Administrator','facility_admin'::public.app_role,org,true FROM qn
  UNION ALL SELECT mgr_actor, mgr_actor||'@review.invalid','Mo Manager','manager'::public.app_role,org,true FROM qn
  UNION ALL SELECT aide_actor, aide_actor||'@review.invalid','Cal Aide','caregiver'::public.app_role,org,true FROM qn
  UNION ALL SELECT exec_actor, exec_actor||'@review.invalid','Eve Executive','org_admin'::public.app_role,org,true FROM qn;
INSERT INTO auth.sessions(id,user_id)
  SELECT owner_session, owner_actor FROM qn UNION ALL SELECT fa_session, fa_actor FROM qn UNION ALL SELECT mgr_session, mgr_actor FROM qn
  UNION ALL SELECT aide_session, aide_actor FROM qn UNION ALL SELECT exec_session, exec_actor FROM qn;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT u, facility, org FROM qn, LATERAL unnest(ARRAY[owner_actor,fa_actor,mgr_actor,aide_actor,exec_actor]) u;
INSERT INTO public.facility_executives(facility_id,organization_id,user_id) SELECT facility, org, exec_actor FROM qn;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status,admission_date)
  SELECT resident, facility, org, 'Note', 'Probe', date '1939-01-01', 'female'::public.gender, 'active'::public.resident_status, current_date - 100 FROM qn;
INSERT INTO public.vendors(id,organization_id,name,category,status)
  SELECT vendor, org, 'Probe Plumbing '||left(vendor::text,8), (SELECT enum_range(NULL::public.vendor_category))[1], (SELECT enum_range(NULL::public.vendor_status))[1] FROM qn
  UNION ALL SELECT other_vendor, org, 'Probe Other '||left(other_vendor::text,8), (SELECT enum_range(NULL::public.vendor_category))[1], (SELECT enum_range(NULL::public.vendor_status))[1] FROM qn;
INSERT INTO public.vendor_facilities(vendor_id,facility_id,organization_id) SELECT vendor, facility, org FROM qn;
INSERT INTO public.vendor_facilities(vendor_id,facility_id,organization_id) SELECT other_vendor, other_facility, org FROM qn;

CREATE FUNCTION pg_temp.qn_as(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;
CREATE FUNCTION pg_temp.qn_fail(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'COL-595 expected failure: %', expected;
END $$;

SET LOCAL ROLE authenticated;

-- 1. Dark until released.
SELECT pg_temp.qn_as(fa_actor, fa_session) FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_note_create(%L,%L,''maintenance'',''Leak in 12'')', note_1, facility), 'not switched on') FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_log_collection_contact(gen_random_uuid(),%L,''call'',''Spoke to son'')', resident), 'not switched on') FROM qn;
SELECT pg_temp.qn_as(owner_actor, owner_session) FROM qn;
SELECT public.home_set_module_release(facility, 'quick_note', true, 'probe') FROM qn;
SELECT public.home_set_module_release(facility, 'collections_log', true, 'probe') FROM qn;

-- 2. A caregiver cannot write; a person or vendor from elsewhere is refused.
SELECT pg_temp.qn_as(aide_actor, aide_session) FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_note_create(%L,%L,''other'',''x'')', note_1, facility), 'Home is for facility operators') FROM qn;
SELECT pg_temp.qn_as(fa_actor, fa_session) FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_note_create(%L,%L,''maintenance'',''Leak'',NULL,NULL,%L)', note_1, facility, other_vendor), 'not linked to this facility') FROM qn;

-- 3. Notes: dated for the manager tomorrow; vendor task today; plain note.
SELECT public.home_note_create(note_1, facility, 'staffing', 'Call Mo about the weekend schedule', NULL, mgr_actor, NULL, current_date + 1) FROM qn;
SELECT public.home_note_create(note_2, facility, 'maintenance', 'Leak under sink in 12', resident, NULL, vendor, current_date) FROM qn;
SELECT public.home_note_create(note_3, facility, 'other', 'Fire marshal said the new signs look good') FROM qn;
-- replay
SELECT public.home_note_create(note_3, facility, 'other', 'Fire marshal said the new signs look good') FROM qn;

DO $$ DECLARE got jsonb; f qn; BEGIN
  SELECT * INTO f FROM qn;
  PERFORM pg_temp.qn_as(f.fa_actor, f.fa_session);
  got := public.home_notes_on_tap(f.facility);
  IF jsonb_array_length(got) <> 1 OR (got->0->>'noteId')::uuid <> f.note_2 OR got->0->'assignee'->>'kind' <> 'vendor' THEN
    RAISE EXCEPTION 'COL-595: administrator should see only the vendor task today, got %', got;
  END IF;
  PERFORM pg_temp.qn_as(f.mgr_actor, f.mgr_session);
  got := public.home_notes_on_tap(f.facility);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(got) e WHERE (e->>'noteId')::uuid = f.note_1) THEN
    RAISE EXCEPTION 'COL-595: a note dated tomorrow showed today';
  END IF;
  got := public.home_notes_on_tap(f.facility, now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(got) e WHERE (e->>'noteId')::uuid = f.note_1) THEN
    RAISE EXCEPTION 'COL-595: the manager''s note did not reach their On tap on its date, got %', got;
  END IF;
  PERFORM pg_temp.qn_as(f.fa_actor, f.fa_session);
  got := public.home_notes_on_tap(f.facility, now() + interval '1 day');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(got) e WHERE (e->>'noteId')::uuid = f.note_1) THEN
    RAISE EXCEPTION 'COL-595: someone else''s assigned note reached the administrator';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(got) e WHERE (e->>'noteId')::uuid = f.note_3) THEN
    RAISE EXCEPTION 'COL-595: a plain note became a task';
  END IF;
  IF (SELECT count(*) FROM public.home_notes WHERE facility_id = f.facility AND note_type = 'maintenance') <> 1 THEN
    RAISE EXCEPTION 'COL-595: notes are not searchable by type';
  END IF;
END $$;

-- 4. Thread appends, then closes; a closed note leaves On tap and refuses more.
SELECT public.home_note_append(gen_random_uuid(), note_2, 'Plumber booked for 2pm', false) FROM qn;
SELECT public.home_note_append(gen_random_uuid(), note_2, 'Fixed', true) FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_note_append(gen_random_uuid(),%L,''more'',false)', note_2), 'closed') FROM qn;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.home_note_updates WHERE note_id = (SELECT note_2 FROM qn)) <> 2
     OR jsonb_array_length(public.home_notes_on_tap((SELECT facility FROM qn))) <> 0 THEN
    RAISE EXCEPTION 'COL-595: the thread did not append and close';
  END IF;
END $$;

-- 5. Contact log: voicemail schedules the next day; escalation reaches only the executive.
SELECT public.home_log_collection_contact(gen_random_uuid(), resident, 'voicemail', 'No answer at the son''s number') FROM qn;
SELECT public.home_log_collection_contact(gen_random_uuid(), resident, 'escalate', 'Three weeks, no response') FROM qn;
SELECT pg_temp.qn_fail(format('SELECT public.home_log_collection_contact(gen_random_uuid(),%L,''letter'',''x'')', resident), 'call, voicemail or escalate') FROM qn;
DO $$ DECLARE got jsonb; f qn; BEGIN
  SELECT * INTO f FROM qn;
  IF (SELECT follow_up_date - activity_date FROM public.collection_activities WHERE resident_id = f.resident AND activity_type = 'voicemail') <> 1 THEN
    RAISE EXCEPTION 'COL-595: a voicemail did not schedule the next-day retry';
  END IF;
  PERFORM pg_temp.qn_as(f.exec_actor, f.exec_session);
  got := public.home_collection_escalations_for_executive();
  IF jsonb_array_length(got) <> 1 OR got->0->>'note' <> 'Three weeks, no response' THEN
    RAISE EXCEPTION 'COL-595: the executive did not receive the escalation, got %', got;
  END IF;
  PERFORM pg_temp.qn_as(f.fa_actor, f.fa_session);
  IF jsonb_array_length(public.home_collection_escalations_for_executive()) <> 0 THEN
    RAISE EXCEPTION 'COL-595: a non-executive read collection escalations';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
