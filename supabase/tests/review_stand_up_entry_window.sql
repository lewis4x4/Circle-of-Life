-- Native scratch-only probe for migration 405 (COL-350); fixtures and auth adaptation roll back.
--
-- Two layers are checked here. The boundary minutes are asserted against
-- haven.stand_up_open_week(facility, instant), because a probe cannot move the
-- server clock; the save path is then exercised against the live clock, which
-- is what an administrator actually hits.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ew_fixture AS
 SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() aide,gen_random_uuid() aide_session,
  f.id facility,f.organization_id org,gen_random_uuid() other_facility
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Entry window probe"}' FROM ew_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT aide,aide||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Entry window aide probe"}' FROM ew_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Entry window probe','owner',org,true FROM ew_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT aide,aide||'@review.invalid','Entry window aide probe','facility_admin',org,true FROM ew_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM ew_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT aide_session,aide FROM ew_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT x.other_facility,f.entity_id,x.org,'Entry window scope probe','Test','Test','00000',1 FROM ew_fixture x JOIN public.facilities f ON f.id=x.facility;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM ew_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT aide,facility,org FROM ew_fixture;
CREATE FUNCTION pg_temp.ew_actor(p_owner boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',CASE WHEN p_owner THEN f.actor ELSE f.aide END,'session_id',CASE WHEN p_owner THEN f.session ELSE f.aide_session END,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ew_fixture f JOIN public.user_profiles p ON p.id=CASE WHEN p_owner THEN f.actor ELSE f.aide END;
END $$;
CREATE TEMP TABLE ew_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON ew_results TO authenticated;
GRANT SELECT ON ew_fixture TO authenticated;
CREATE FUNCTION pg_temp.ew_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

-- Google/workbook reporting scope remains calendar Monday, independently of
-- early draft entry. An enabled bridge must still accept the week's workbook.
DO $$ BEGIN
 IF haven.stand_up_reporting_week('2026-09-16T12:00:00Z') <> date '2026-09-14'
  OR haven.stand_up_reporting_week('2026-09-20T04:00:00Z') <> date '2026-09-21'
  OR haven.stand_up_week() <> haven.stand_up_reporting_week(clock_timestamp()) THEN
  RAISE EXCEPTION 'Google/calendar reporting week changed with continuous entry'; END IF;
END $$;

-- COL-427: the upcoming Monday is editable continuously from the preceding
-- Monday call, regardless of stored legacy opening leads.
DO $$ DECLARE f uuid := (SELECT facility FROM ew_fixture); r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
  (date '2026-09-21', timestamptz '2026-09-14T13:15:00Z'),
  (date '2026-11-02', timestamptz '2026-10-26T13:15:00Z'),
  (date '2027-03-15', timestamptz '2027-03-08T14:15:00Z'),
  (date '2026-11-30', timestamptz '2026-11-23T14:15:00Z')
 ) v(meeting_monday, opens_at) LOOP
  IF haven.stand_up_entry_opens_at(f,r.meeting_monday) <> r.opens_at THEN
   RAISE EXCEPTION 'Continuous Monday opening/DST mismatch: %',r; END IF;
  IF haven.stand_up_open_week(f,r.opens_at-interval '1 microsecond') <> r.meeting_monday-7
   OR haven.stand_up_open_week(f,r.opens_at) <> r.meeting_monday
   OR haven.stand_up_open_week(f,r.opens_at+interval '1 microsecond') <> r.meeting_monday THEN
   RAISE EXCEPTION 'Monday call must atomically close the prior ordinary entry and open the next: %',r; END IF;
 END LOOP;
 FOR r IN SELECT generate_series(timestamptz '2026-09-14T13:15:00Z',timestamptz '2026-09-21T13:14:00Z',interval '6 hours') instant LOOP
  IF haven.stand_up_open_week(f,r.instant) <> date '2026-09-21' THEN
   RAISE EXCEPTION 'Monday entry unavailable during the week: %',r.instant; END IF;
 END LOOP;
END $$;
INSERT INTO public.stand_up_facility_settings(organization_id,facility_id,entry_open_lead_minutes) SELECT org,facility,885 FROM ew_fixture;
DO $$ DECLARE f uuid := (SELECT facility FROM ew_fixture); lead integer; BEGIN
 FOREACH lead IN ARRAY ARRAY[60,525,885,1965,3405] LOOP
  UPDATE public.stand_up_facility_settings SET entry_open_lead_minutes=lead WHERE facility_id=f;
  IF haven.stand_up_open_week(f,timestamptz '2026-09-18T03:00:00Z') <> date '2026-09-21'
   OR haven.stand_up_entry_opens_at(f,date '2026-09-21') <> timestamptz '2026-09-14T13:15:00Z' THEN
   RAISE EXCEPTION 'Legacy opening lead must not restrict continuous entry: %',lead; END IF;
 END LOOP;
 IF haven.stand_up_open_week(NULL,timestamptz '2026-09-18T03:00:00Z') <> date '2026-09-21' THEN
  RAISE EXCEPTION 'Organization default is not continuously open'; END IF;
END $$;
DELETE FROM public.stand_up_facility_settings WHERE facility_id=(SELECT facility FROM ew_fixture);

-- 4. The bounds are refused by the CHECK constraint on both sides.
SELECT pg_temp.ew_fail(format($q$INSERT INTO public.stand_up_facility_settings(organization_id,facility_id,entry_open_lead_minutes) VALUES(%L,%L,59)$q$,org,facility),'stand_up_facility_settings') FROM ew_fixture;
SELECT pg_temp.ew_fail(format($q$INSERT INTO public.stand_up_facility_settings(organization_id,facility_id,entry_open_lead_minutes) VALUES(%L,%L,3406)$q$,org,facility),'stand_up_facility_settings') FROM ew_fixture;

-- 5. Only the authorized command reaches the window helpers.
DO $$ BEGIN
 IF has_function_privilege('authenticated','haven.stand_up_entry_open_lead_minutes(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','haven.stand_up_set_entry_window(jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.stand_up_entry_opens_at(uuid,date)','EXECUTE')
 OR has_table_privilege('anon','public.stand_up_facility_settings','SELECT')
 OR NOT has_function_privilege('authenticated','haven.stand_up_command(text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Entry window grant boundary failed'; END IF;
END $$;

-- 6. The save path against the live clock: the open week saves, the next one is
--    refused as not open, and the refusal carries its machine-readable hint.
--    The payload is built before the role switch, because the window helpers and
--    the metric key list are reachable only through the authorized command.
CREATE TEMP TABLE ew_plan AS SELECT
 f.facility,f.other_facility,
 haven.stand_up_open_week(f.facility) AS open_week,
 haven.stand_up_open_week(f.facility)+7 AS next_week,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(41) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS census_only,
 (SELECT jsonb_object_agg(k,'null'::jsonb) FROM unnest(haven.stand_up_keys()) k) AS all_blank
 FROM ew_fixture f;
GRANT SELECT ON ew_plan TO authenticated;
SELECT pg_temp.ew_actor(true);
SET LOCAL ROLE authenticated;
-- COL-553: an open-period census on a facility that may hold residents carries a reason in case it differs from the roster.
INSERT INTO ew_results SELECT 'open_save',public.stand_up_command('save',jsonb_build_object(
 'facility_id',p.facility,'week_start',p.open_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',p.census_only,
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','other')))) FROM ew_plan p;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ew_results WHERE name='open_save';
 IF r->>'week_start' IS DISTINCT FROM (SELECT open_week::text FROM ew_plan) OR (r->>'version')::int<>1 THEN RAISE EXCEPTION 'Open week save did not record a first revision: %',r; END IF;
 IF r->'values'->>'current_total_census'<>'41' THEN RAISE EXCEPTION 'Saved figure did not round-trip: %',r; END IF;
END $$;
DO $$ DECLARE p ew_plan%ROWTYPE; state text; hint text; BEGIN
 SELECT * INTO p FROM ew_plan;
 BEGIN
  PERFORM public.stand_up_command('save',jsonb_build_object('facility_id',p.facility,'week_start',p.next_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','reason','Probe early entry','values',p.census_only));
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,hint=PG_EXCEPTION_HINT;
 END;
 IF state IS DISTINCT FROM 'P0409' OR hint IS DISTINCT FROM 'stand_up_entry_not_open' THEN
  RAISE EXCEPTION 'A save before the window opened was not refused as not open (sqlstate %, hint %)',state,hint;
 END IF;
END $$;

-- 7. An owner writes the window; the value is read back and clears to the default.
INSERT INTO ew_results SELECT 'set',public.stand_up_command('set_entry_window',jsonb_build_object('facility_id',facility,'entry_open_lead_minutes',3405)) FROM ew_fixture;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ew_results WHERE name='set';
 IF (r->>'entry_open_lead_minutes')::int<>3405 THEN RAISE EXCEPTION 'Owner write did not return the stored window: %',r; END IF;
 IF (SELECT entry_open_lead_minutes FROM public.stand_up_facility_settings WHERE facility_id=(SELECT facility FROM ew_fixture))<>3405 THEN RAISE EXCEPTION 'Owner write did not persist'; END IF;
END $$;
-- The workspace reports the window beside the facility it belongs to.
DO $$ DECLARE w jsonb; BEGIN
 SELECT value INTO w FROM jsonb_array_elements((SELECT public.stand_up_command('workspace','{}')->'facilities')) WHERE (value->>'id')::uuid=(SELECT facility FROM ew_fixture);
 IF (w->>'entry_open_lead_minutes')::int<>3405 OR w->>'open_week' IS NULL OR w->>'entry_opens_at' IS NULL THEN RAISE EXCEPTION 'Workspace did not report the facility entry window: %',w; END IF;
END $$;
SELECT pg_temp.ew_fail(format($q$SELECT public.stand_up_command('set_entry_window',jsonb_build_object('facility_id',%L,'entry_open_lead_minutes',59))$q$,facility),'between 60 and 3405') FROM ew_fixture;
SELECT pg_temp.ew_fail(format($q$SELECT public.stand_up_command('set_entry_window',jsonb_build_object('facility_id',%L,'entry_open_lead_minutes',3406))$q$,facility),'between 60 and 3405') FROM ew_fixture;
INSERT INTO ew_results SELECT 'cleared',public.stand_up_command('set_entry_window',jsonb_build_object('facility_id',facility,'entry_open_lead_minutes',NULL)) FROM ew_fixture;
DO $$ BEGIN
 IF (SELECT entry_open_lead_minutes FROM public.stand_up_facility_settings WHERE facility_id=(SELECT facility FROM ew_fixture)) IS NOT NULL THEN RAISE EXCEPTION 'Clearing the window did not fall back to the default'; END IF;
END $$;

-- 8. A facility administrator is refused by the command and by RLS, and still
--    cannot save for a facility outside their grant.
RESET ROLE;
-- The refusal in section 6 left no row: an unopened week is never reserved.
-- Cleared to null, the facility reads the Haven default again.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stand_up_reports r JOIN ew_plan p ON p.facility=r.facility_id AND r.week_start=p.next_week) THEN
  RAISE EXCEPTION 'A refused early save still reserved the week';
 END IF;
 IF haven.stand_up_entry_open_lead_minutes((SELECT facility FROM ew_fixture))<>1965 THEN RAISE EXCEPTION 'Cleared window did not read the Haven default'; END IF;
END $$;
SELECT pg_temp.ew_actor(false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ew_fail(format($q$SELECT public.stand_up_command('set_entry_window',jsonb_build_object('facility_id',%L,'entry_open_lead_minutes',3405))$q$,facility),'Stand Up access denied') FROM ew_fixture;
-- A save for a facility outside the grant stays a 42501 denial, window or no window.
SELECT pg_temp.ew_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,other_facility,open_week,census_only),'Stand Up access denied') FROM ew_plan;
DO $$ DECLARE f uuid; o uuid; touched integer; BEGIN
 SELECT facility,org INTO f,o FROM ew_fixture;
 -- RLS is the second wall: a direct write finds no permissive policy for this role.
 BEGIN
  INSERT INTO public.stand_up_facility_settings(organization_id,facility_id,entry_open_lead_minutes) VALUES(o,f,3405);
  RAISE EXCEPTION 'A facility administrator inserted an entry window row';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 UPDATE public.stand_up_facility_settings SET entry_open_lead_minutes=3405 WHERE facility_id=f;
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>0 THEN RAISE EXCEPTION 'A facility administrator changed an entry window row'; END IF;
 -- Reading it is allowed: the administrator must be able to see when entry opens.
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_facility_settings WHERE facility_id=f) THEN RAISE EXCEPTION 'A facility administrator cannot read its own entry window'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
