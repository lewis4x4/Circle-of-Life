-- COL-353: the visitor log is written through functions, corrected by voiding,
-- and never rewritten in place.
-- Local disposable replay only: every fixture rolls back. Synthetic visitors only.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- The vanilla replay stub omits the table grants the hosted project has. The
-- posture probe below runs BEFORE this, so a blanket SELECT here cannot hide a
-- missing revoke on UPDATE or DELETE.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Grant posture: the write path is definer functions, not table privileges.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF has_table_privilege('authenticated','public.visitor_log_entries','UPDATE')
     OR has_table_privilege('authenticated','public.visitor_log_entries','DELETE') THEN
    RAISE EXCEPTION 'visitor entries can still be rewritten or deleted from the client'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='visitor_log_entries' AND cmd IN ('UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'an UPDATE or DELETE policy is back on visitor_log_entries'; END IF;
  IF has_function_privilege('anon','public.visitor_sign_out(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.visitor_sign_out_all_open(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.visitor_void(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.visitor_log(uuid,uuid,timestamptz,timestamptz,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.visitor_log_open(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.survey_print_pack_record(uuid,text[],date,date)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute a visitor or print pack function'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- left_open: the 04:00 Eastern boundary, asked directly so no clock is faked.
-- ---------------------------------------------------------------------------
DO $$
DECLARE entry timestamptz := timestamptz '2026-06-10 22:00 America/New_York';
BEGIN
  IF entry < haven.visitor_left_open_threshold(timestamptz '2026-06-11 03:59 America/New_York') THEN
    RAISE EXCEPTION 'a visitor signed in at 22:00 was already an exception at 03:59 the next morning'; END IF;
  IF entry >= haven.visitor_left_open_threshold(timestamptz '2026-06-11 04:01 America/New_York') THEN
    RAISE EXCEPTION 'a visitor still signed in from last night was not flagged at 04:01'; END IF;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE TEMP TABLE vis AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() other_fac,
  gen_random_uuid() res_here, gen_random_uuid() res_there,
  gen_random_uuid() clerk, gen_random_uuid() clerk_session,
  gen_random_uuid() outsider, gen_random_uuid() outsider_session;

INSERT INTO organizations(id,name) SELECT org,'Visitor review' FROM vis;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Visitor Entity' FROM vis;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Visitor Facility','1 Way','Town','00000',10 FROM vis
  UNION ALL SELECT other_fac,ent,org,'Other Facility','2 Way','Town','00000',10 FROM vis;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status)
  SELECT res_here,fac,org,'Test Resident','Here','prefer_not_to_say'::gender,'active'::resident_status FROM vis
  UNION ALL SELECT res_there,other_fac,org,'Test Resident','There','prefer_not_to_say'::gender,'active'::resident_status FROM vis;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT clerk,clerk||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),jsonb_build_object('full_name','Review clerk') FROM vis
UNION ALL SELECT outsider,outsider||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),jsonb_build_object('full_name','Review outsider') FROM vis;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT clerk,clerk||'@review.invalid','Review clerk','facility_admin'::public.app_role,org,true FROM vis
UNION ALL SELECT outsider,outsider||'@review.invalid','Review outsider','facility_admin'::public.app_role,org,true FROM vis
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT clerk,fac,org FROM vis
UNION ALL SELECT outsider,other_fac,org FROM vis;
INSERT INTO auth.sessions(id,user_id) SELECT clerk_session,clerk FROM vis UNION ALL SELECT outsider_session,outsider FROM vis;
GRANT SELECT ON vis TO authenticated;
GRANT SELECT, INSERT ON public.visitor_log_entries TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.be(p_user uuid, p_session uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN
  SELECT * INTO f FROM vis;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=p_user),
    'role','authenticated','app_role','facility_admin','organization_id',f.org,
    'app_metadata',jsonb_build_object('app_role','facility_admin','organization_id',f.org))::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- Sign in: a resident in this building yes, a resident in another building no.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM vis;
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,resident_id,signed_in_by)
    VALUES(f.org,f.fac,'Test Visitor One','family_friend','resident',f.res_here,f.clerk);
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by)
    VALUES(f.org,f.fac,'Test Visitor Two','surveyor_regulator','facility',f.clerk);
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by)
    VALUES(f.org,f.fac,'Test Visitor Three','vendor_contractor','staff',f.clerk);
  BEGIN
    INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,resident_id,signed_in_by)
      VALUES(f.org,f.fac,'Test Visitor Four','family_friend','resident',f.res_there,f.clerk);
    RAISE EXCEPTION 'a visitor was signed in against a resident of another facility';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by)
      VALUES(f.org,f.fac,'Test Visitor Five','family_friend','resident',f.clerk);
    RAISE EXCEPTION 'visiting a resident was accepted with no resident named';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO n FROM public.visitor_log_entries WHERE facility_id=f.fac;
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 signed in visitors, found %', n; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Sign out once. Twice is refused.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; e public.visitor_log_entries; target uuid; BEGIN
  SELECT * INTO f FROM vis;
  SELECT id INTO target FROM public.visitor_log_entries WHERE facility_id=f.fac AND visitor_name='Test Visitor One';
  e := public.visitor_sign_out(target);
  IF e.checked_out_at IS NULL OR e.sign_out_method <> 'individual' OR e.signed_out_by <> f.clerk THEN
    RAISE EXCEPTION 'sign out did not record when, how and who'; END IF;
  BEGIN
    PERFORM public.visitor_sign_out(target);
    RAISE EXCEPTION 'the same visitor was signed out twice';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Void with a coded reason. A voided entry cannot then be signed out, and a
-- second void is refused.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; e public.visitor_log_entries; target uuid; BEGIN
  SELECT * INTO f FROM vis;
  SELECT id INTO target FROM public.visitor_log_entries WHERE facility_id=f.fac AND visitor_name='Test Visitor Three';
  BEGIN
    PERFORM public.visitor_void(target,'changed_my_mind');
    RAISE EXCEPTION 'an uncoded void reason was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  e := public.visitor_void(target,'entered_in_error');
  IF e.voided_at IS NULL OR e.void_reason <> 'entered_in_error' OR e.voided_by <> f.clerk THEN
    RAISE EXCEPTION 'void did not record when, why and who'; END IF;
  BEGIN
    PERFORM public.visitor_sign_out(target);
    RAISE EXCEPTION 'a voided entry was signed out';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.visitor_void(target,'duplicate');
    RAISE EXCEPTION 'an entry was voided twice';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Sign out everyone: counts the open ones, leaves voided rows alone.
-- Visitor One is signed out, Three is voided, Two is still open.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM vis;
  n := public.visitor_sign_out_all_open(f.fac);
  IF n <> 1 THEN RAISE EXCEPTION 'sign out everyone closed % entries, want 1', n; END IF;
  n := public.visitor_sign_out_all_open(f.fac);
  IF n <> 0 THEN RAISE EXCEPTION 'sign out everyone closed % entries on an empty building, want 0', n; END IF;
END $$;
RESET ROLE;

DO $$ DECLARE f record; e public.visitor_log_entries; BEGIN
  SELECT * INTO f FROM vis;
  SELECT * INTO e FROM public.visitor_log_entries WHERE facility_id=f.fac AND visitor_name='Test Visitor Two';
  IF e.sign_out_method <> 'bulk_end_of_day' THEN RAISE EXCEPTION 'the bulk sign out was not recorded as end of day'; END IF;
  SELECT * INTO e FROM public.visitor_log_entries WHERE facility_id=f.fac AND visitor_name='Test Visitor Three';
  IF e.checked_out_at IS NOT NULL THEN RAISE EXCEPTION 'sign out everyone closed a voided entry'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Sign out everyone, with more than one person in the building. A single open
-- visitor cannot tell a real count from a count that is always 1.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM vis;
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by)
    VALUES(f.org,f.fac,'Test Visitor Six','family_friend','facility',f.clerk),
          (f.org,f.fac,'Test Visitor Seven','family_friend','facility',f.clerk),
          (f.org,f.fac,'Test Visitor Eight','vendor_contractor','staff',f.clerk);
  n := public.visitor_sign_out_all_open(f.fac);
  IF n <> 3 THEN RAISE EXCEPTION 'sign out everyone reported % of 3 visitors', n; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; open_left int; audited int; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO open_left FROM public.visitor_log_entries
    WHERE facility_id=f.fac AND checked_out_at IS NULL AND voided_at IS NULL;
  IF open_left <> 0 THEN RAISE EXCEPTION '% visitors were left in the building', open_left; END IF;
  SELECT count(*) INTO audited FROM public.audit_log
    WHERE table_name='visitor_log_entries' AND new_data->>'event'='visitor_signed_out_bulk_end_of_day';
  IF audited <> 4 THEN RAISE EXCEPTION 'bulk sign out wrote % audit rows, want 4', audited; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- In the building now ignores the log's date range. Somebody who signed in
-- last night and never signed out is still here this morning, and is the row
-- the 04:00 exception exists to raise.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; flagged int; BEGIN
  SELECT * INTO f FROM vis;
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by,checked_in_at)
    -- Three days back, not "18 hours ago": the latter is still today when the
    -- probe runs in the evening, and a fixture that depends on the wall clock
    -- is a probe that passes or fails by time of day.
    VALUES(f.org,f.fac,'Test Visitor Overnight','family_friend','facility',f.clerk, now() - interval '3 days');
  -- The log for today alone does not contain last night's arrival ...
  SELECT count(*) INTO n FROM public.visitor_log(f.org,f.fac,
    date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York',
    now() + interval '1 minute', false) WHERE visitor_name='Test Visitor Overnight';
  IF n <> 0 THEN RAISE EXCEPTION 'fixture wrong: the overnight arrival is inside today'; END IF;
  -- ... but the building does, and it is flagged.
  SELECT count(*) INTO n FROM public.visitor_log_open(f.org,f.fac) WHERE visitor_name='Test Visitor Overnight';
  IF n <> 1 THEN RAISE EXCEPTION 'someone still in the building overnight fell off the in-the-building list'; END IF;
  SELECT count(*) INTO flagged FROM public.visitor_log_open(f.org,f.fac)
    WHERE visitor_name='Test Visitor Overnight' AND left_open;
  IF flagged <> 1 THEN RAISE EXCEPTION 'an overnight visitor was not flagged as still signed in'; END IF;
END $$;
RESET ROLE;

-- Voided and signed out rows are not in the building.
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO n FROM public.visitor_log_open(f.org,f.fac)
    WHERE visitor_name IN ('Test Visitor One','Test Visitor Three');
  IF n <> 0 THEN RAISE EXCEPTION 'a signed out or voided visitor is still listed as in the building'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Sign out everyone, with more than one person in the building. A single open
-- visitor cannot tell a real count from a count that is always 1.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; expected int; BEGIN
  SELECT * INTO f FROM vis;
  INSERT INTO public.visitor_log_entries(organization_id,facility_id,visitor_name,visitor_type,visiting_type,signed_in_by)
    VALUES(f.org,f.fac,'Test Visitor Six','family_friend','facility',f.clerk),
          (f.org,f.fac,'Test Visitor Seven','family_friend','facility',f.clerk),
          (f.org,f.fac,'Test Visitor Eight','vendor_contractor','staff',f.clerk);
  SELECT count(*) INTO expected FROM public.visitor_log_open(f.org,f.fac);
  IF expected < 3 THEN RAISE EXCEPTION 'fixture wrong: only % open', expected; END IF;
  -- The number the confirmation shows and the number actually closed are the
  -- same number, which is what makes the confirmation worth reading.
  n := public.visitor_sign_out_all_open(f.fac);
  IF n <> expected THEN RAISE EXCEPTION 'sign out everyone reported % of % visitors', n, expected; END IF;
  IF (SELECT count(*) FROM public.visitor_log_open(f.org,f.fac)) <> 0 THEN
    RAISE EXCEPTION 'visitors were left in the building'; END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- A user granted a different facility sees nothing and can call nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(outsider, outsider_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; target uuid; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO n FROM public.visitor_log(f.org,f.fac,'2000-01-01Z','2100-01-01Z',true);
  IF n <> 0 THEN RAISE EXCEPTION 'a user without the facility grant read % visitor rows', n; END IF;
  SELECT count(*) INTO n FROM public.visitor_log_open(f.org,f.fac);
  IF n <> 0 THEN RAISE EXCEPTION 'a user without the facility grant saw % people in the building', n; END IF;
  BEGIN
    PERFORM public.visitor_sign_out_all_open(f.fac);
    RAISE EXCEPTION 'a user without the facility grant signed out a building they cannot see';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.survey_print_pack_record(f.fac, ARRAY['register'], '2026-01-01','2026-06-30');
    RAISE EXCEPTION 'a user without the facility grant printed a survey pack';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- The entry id is guessable; the grant check is what stops the call.
SELECT pg_temp.be(outsider, outsider_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; target uuid; BEGIN
  SELECT * INTO f FROM vis;
  RESET ROLE;
  SELECT id INTO target FROM public.visitor_log_entries WHERE facility_id=f.fac LIMIT 1;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.visitor_sign_out(target);
    RAISE EXCEPTION 'a named entry id let a user act on another facility';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- The print pack event names what was provided, and nobody who is in it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.be(clerk, clerk_session) FROM vis;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; id uuid; BEGIN
  SELECT * INTO f FROM vis;
  id := public.survey_print_pack_record(f.fac, ARRAY['register','census','visitors'], '2026-01-01','2026-06-30');
  IF id IS NULL THEN RAISE EXCEPTION 'the print was not recorded'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; row_data jsonb; n int; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO n FROM public.audit_log WHERE table_name='survey_print_pack' AND facility_id=f.fac;
  IF n <> 1 THEN RAISE EXCEPTION 'one print wrote % audit events, want 1', n; END IF;
  SELECT new_data INTO row_data FROM public.audit_log WHERE table_name='survey_print_pack' AND facility_id=f.fac;
  IF row_data->>'event' <> 'survey_print_pack_printed' THEN RAISE EXCEPTION 'the print event is not named'; END IF;
  IF row_data::text ILIKE '%Test Visitor%' OR row_data::text ILIKE '%Test Resident%' OR row_data::text ILIKE '%Review clerk%' THEN
    RAISE EXCEPTION 'a name reached the print pack audit payload'; END IF;
END $$;

-- Voided entries stay readable so a correction can be seen, and stay hidden by default.
DO $$ DECLARE f record; shown int; hidden int; voided_rows int; BEGIN
  SELECT * INTO f FROM vis;
  SELECT count(*) INTO hidden FROM public.visitor_log(f.org,f.fac,'2000-01-01Z','2100-01-01Z',false);
  SELECT count(*) INTO shown  FROM public.visitor_log(f.org,f.fac,'2000-01-01Z','2100-01-01Z',true);
  SELECT count(*) INTO voided_rows FROM public.visitor_log_entries
    WHERE facility_id=f.fac AND voided_at IS NOT NULL AND deleted_at IS NULL;
  -- Counted against the table rather than a literal, so adding a fixture above
  -- does not quietly turn this into a different assertion.
  IF voided_rows < 1 THEN RAISE EXCEPTION 'fixture wrong: nothing was voided'; END IF;
  IF shown - hidden <> voided_rows THEN
    RAISE EXCEPTION 'including voided changed the row count by % , want %', shown - hidden, voided_rows; END IF;
  IF hidden <> shown - voided_rows THEN
    RAISE EXCEPTION 'the default log is not exactly the unvoided rows'; END IF;
  IF shown <> (SELECT count(*) FROM public.visitor_log_entries WHERE facility_id=f.fac AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'a voided entry disappeared instead of staying on the record'; END IF;
END $$;

ROLLBACK;
