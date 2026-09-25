-- Native scratch-only probe for migration 517 (COL-752); fixtures and auth
-- adaptation roll back.
--
-- Stand Up meets Monday and Thursday. Thursday takes its times from the runtime
-- schedule, opens when Monday's call starts, stores its own four figures beside
-- Monday's submitted ones, is read by recruiters and written only by Stand Up
-- administrators, and never reaches a publisher or export: the Monday exports
-- are byte-identical with and without Thursday rows. Every call below fails on
-- the code before 517, which has no meeting schedule and refuses any week that
-- is not a Monday report.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE md_fixture AS
 SELECT gen_random_uuid() facility,gen_random_uuid() other_facility,f.organization_id org,f.entity_id
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity_id,org,'Meeting-day probe','Test','Test','00000',1 FROM md_fixture
 UNION ALL SELECT other_facility,entity_id,org,'Meeting-day other probe','Test','Test','00000',1 FROM md_fixture;
CREATE TEMP TABLE md_actor AS
 SELECT name,gen_random_uuid() id,gen_random_uuid() session,role,here FROM (VALUES
  ('owner','owner',true),('admin','facility_admin',true),('recruiter','recruiter',true),('floor','med_tech',true),('outsider','facility_admin',false)) v(name,role,here);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT a.id,a.id||'@review.invalid',jsonb_build_object('organization_id',f.org,'app_role',a.role),jsonb_build_object('full_name','Probe '||a.name) FROM md_actor a CROSS JOIN md_fixture f;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT a.id,a.id||'@review.invalid','Probe '||a.name,a.role::public.app_role,f.org,true FROM md_actor a CROSS JOIN md_fixture f
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,full_name=excluded.full_name,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM md_actor;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT a.id,CASE WHEN a.here THEN f.facility ELSE f.other_facility END,f.org FROM md_actor a CROSS JOIN md_fixture f;
CREATE FUNCTION pg_temp.md_as(p_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM md_actor a CROSS JOIN md_fixture f JOIN public.user_profiles p ON true WHERE p.id=a.id AND a.name=p_name;
END $$;
CREATE FUNCTION pg_temp.md_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
CREATE TEMP TABLE md_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON md_results TO authenticated;
GRANT SELECT ON md_fixture,md_actor TO authenticated;

-- 1. The schedule is seeded for every organization: Monday and Thursday, due
--    08:45, call 09:15, Eastern. Nobody but the definer functions reads it.
DO $$ DECLARE org uuid:=(SELECT org FROM md_fixture); BEGIN
 IF (SELECT count(*) FROM public.stand_up_meeting_schedule s WHERE s.organization_id=org AND s.facility_id IS NULL AND s.active
   AND s.entry_due_local=time '08:45' AND s.call_local=time '09:15' AND s.time_zone='America/New_York'
   AND ((s.meeting_day='monday' AND s.weekday=1) OR (s.meeting_day='thursday' AND s.weekday=4)))<>2 THEN
  RAISE EXCEPTION 'Monday and Thursday are not seeded with 08:45 and 09:15 Eastern';
 END IF;
 IF EXISTS(SELECT 1 FROM public.organizations o WHERE NOT EXISTS(SELECT 1 FROM public.stand_up_meeting_schedule s WHERE s.organization_id=o.id AND s.meeting_day='thursday')) THEN
  RAISE EXCEPTION 'An organization has no Thursday meeting';
 END IF;
 IF has_table_privilege('authenticated','public.stand_up_meeting_schedule','SELECT') OR has_table_privilege('authenticated','public.stand_up_meeting_reports','SELECT')
  OR has_table_privilege('authenticated','public.stand_up_meeting_revisions','SELECT') OR has_table_privilege('anon','public.stand_up_meeting_reports','SELECT')
  OR has_function_privilege('authenticated','haven.stand_up_meeting_save(jsonb)','EXECUTE') OR has_function_privilege('authenticated','haven.stand_up_meeting_command(text,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','haven.stand_up_set_meeting_schedule(jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Meeting-day grant boundary failed';
 END IF;
 IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.stand_up_meeting_schedule'::regclass,'public.stand_up_meeting_reports'::regclass,'public.stand_up_meeting_revisions'::regclass)) THEN
  RAISE EXCEPTION 'A meeting-day table has no RLS';
 END IF;
END $$;

-- 2. Thursday's window, from the schedule: it opens when Monday's call starts,
--    is due Thursday 8:45 and meets Thursday 9:15 Eastern, on both sides of a
--    daylight-saving change, and never reaches back into Monday's meeting.
DO $$ DECLARE org uuid:=(SELECT org FROM md_fixture); f uuid:=(SELECT facility FROM md_fixture); t jsonb; BEGIN
 t:=haven.stand_up_meeting_times(org,f,'thursday','2026-09-21');
 IF t->>'meeting_date'<>'2026-09-24' OR (t->>'entry_opens_at')::timestamptz<>'2026-09-21 13:15:00+00' OR (t->>'entry_due_at')::timestamptz<>'2026-09-24 12:45:00+00'
  OR (t->>'call_at')::timestamptz<>'2026-09-24 13:15:00+00' THEN RAISE EXCEPTION 'Thursday window wrong in daylight time: %',t; END IF;
 t:=haven.stand_up_meeting_times(org,f,'thursday','2026-11-02');
 IF (t->>'entry_opens_at')::timestamptz<>'2026-11-02 14:15:00+00' OR (t->>'call_at')::timestamptz<>'2026-11-05 14:15:00+00' THEN RAISE EXCEPTION 'Thursday window wrong in standard time: %',t; END IF;
 IF haven.stand_up_meeting_open_week(org,f,'thursday','2026-09-21 13:14:59+00')<>'2026-09-14' THEN RAISE EXCEPTION 'Thursday opened before Monday''s call'; END IF;
 IF haven.stand_up_meeting_open_week(org,f,'thursday','2026-09-21 13:15:00+00')<>'2026-09-21' THEN RAISE EXCEPTION 'Thursday did not open at Monday''s call'; END IF;
 IF haven.stand_up_meeting_open_week(org,f,'thursday','2026-09-28 13:14:00+00')<>'2026-09-21' THEN RAISE EXCEPTION 'Thursday closed before the next Monday call'; END IF;
 IF haven.stand_up_meeting_keys('monday') IS NOT NULL THEN RAISE EXCEPTION 'Monday must stay on stand_up_reports'; END IF;
END $$;

CREATE TEMP TABLE md_plan AS SELECT f.facility,f.other_facility,f.org,
 haven.stand_up_meeting_open_week(f.org,f.facility,'thursday',clock_timestamp()) AS open_week,
 jsonb_build_object('current_ar_cents',11710800,'current_total_census',987654,'departures_since_monday',2,'hospital_and_rehab_total',3,'hospital_total',1,'rehab_total',2) AS thursday_values,
 (SELECT jsonb_object_agg(k,CASE k WHEN 'monthly_rent_roll_cents' THEN to_jsonb(11000000) WHEN 'current_total_census' THEN to_jsonb(38) WHEN 'hospital_and_rehab_total' THEN to_jsonb(1) ELSE to_jsonb(1) END) FROM unnest(haven.stand_up_keys()) k) AS monday_values
 FROM md_fixture f;
GRANT SELECT ON md_plan TO authenticated;

-- Monday's submitted report for the same week: the baseline Thursday compares with.
DO $$ DECLARE rid uuid; vid uuid; BEGIN
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status,version)
  SELECT org,facility,open_week,monday_values,'ready',1 FROM md_plan RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id)
  SELECT rid,1,p.monday_values,'ready',a.id FROM md_plan p CROSS JOIN md_actor a WHERE a.name='admin' RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET revision_id=vid WHERE id=rid;
END $$;

-- 3. Before any Thursday row: what every publisher and export reads.
INSERT INTO md_results SELECT 'aggregate_before',public.stand_up_export_aggregate(org,NULL) FROM md_plan;
INSERT INTO md_results SELECT 'history_before',public.stand_up_export_history(org,open_week-70,open_week+7)-'archive_as_of' FROM md_plan;

-- 4. The administrator enters Thursday: a draft, then the submission.
SELECT pg_temp.md_as('admin');
SET LOCAL ROLE authenticated;
INSERT INTO md_results SELECT 'thursday_draft',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday',
 'facility_id',facility,'week_start',open_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft',
 'values',thursday_values||jsonb_build_object('departures_since_monday',NULL))) FROM md_plan;
INSERT INTO md_results SELECT 'thursday_ready',public.stand_up_command('save',jsonb_build_object('meeting_day','thursday',
 'facility_id',facility,'week_start',open_week,'expected_version',1,'request_id',gen_random_uuid(),'status','ready','values',thursday_values)) FROM md_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM md_results WHERE name='thursday_ready';
 IF (r->>'version')::int<>2 OR r->>'status'<>'ready' OR r->>'meeting_day'<>'thursday' OR r->'values'->>'current_total_census'<>'987654' THEN RAISE EXCEPTION 'Thursday did not save: %',r; END IF;
 IF r->>'last_submitted_by' IS DISTINCT FROM (SELECT id::text FROM md_actor WHERE name='admin') OR r->>'source_as_of' IS NULL THEN RAISE EXCEPTION 'Thursday submission not attributed: %',r; END IF;
 IF r->'monday_submitted'->'values'<>jsonb_build_object('current_ar_cents',11000000,'current_total_census',38,'hospital_and_rehab_total',1) THEN RAISE EXCEPTION 'Monday''s submitted figures are not beside Thursday: %',r; END IF;
END $$;
-- The same figures cannot be submitted incomplete, stale, in the future, or in a past week without a reason.
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',2,'request_id',gen_random_uuid(),'status','ready','values',%L::jsonb))$q$,
 facility,open_week,thursday_values||jsonb_build_object('current_ar_cents',NULL)),'Submitting requires every figure') FROM md_plan;
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,
 facility,open_week,thursday_values),'Stale report version') FROM md_plan;
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,
 facility,open_week+7,thursday_values),'This report opens') FROM md_plan;
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,
 facility,open_week,thursday_values-'departures_since_monday'),'Exactly the 6 supported figures required') FROM md_plan;
-- A past Thursday that was never submitted stays owner and org_admin only, as on Monday.
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb,'reason','Late entry'))$q$,
 facility,open_week-7,thursday_values),'Stand Up access denied') FROM md_plan;

-- 5. Monday and Thursday of the same week are two reports with their own history.
DO $$ DECLARE h jsonb; m jsonb; BEGIN
 SELECT public.stand_up_command('revisions',jsonb_build_object('meeting_day','thursday','facility_id',facility,'week_start',open_week)) INTO h FROM md_plan;
 IF jsonb_array_length(h->'revisions')<>2 OR h->'revisions'->1->>'status'<>'ready' OR h->'window'->>'call_at' IS NULL THEN RAISE EXCEPTION 'Thursday history wrong: %',h; END IF;
 -- Both revisions were written just now, so nothing was current when a call already held had started.
 IF clock_timestamp()>=(h->'window'->>'call_at')::timestamptz AND h->>'call_snapshot_revision_id' IS NOT NULL THEN RAISE EXCEPTION 'A snapshot predates every revision: %',h; END IF;
 SELECT public.stand_up_command('revisions',jsonb_build_object('facility_id',facility,'week_start',open_week)) INTO m FROM md_plan;
 IF jsonb_array_length(m->'revisions')<>1 OR m->'revisions'->0->'values'->>'current_total_census'<>'38' THEN RAISE EXCEPTION 'Thursday leaked into Monday''s history: %',m; END IF;
 -- A payload naming Monday is the Monday path, unchanged.
 SELECT public.stand_up_command('revisions',jsonb_build_object('meeting_day','monday','facility_id',facility,'week_start',open_week)) INTO h FROM md_plan;
 IF h IS DISTINCT FROM m THEN RAISE EXCEPTION 'meeting_day monday changed the Monday answer: %',h; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.stand_up_command('workspace','{}')->'reports') x WHERE x->'values' ? 'departures_since_monday') THEN RAISE EXCEPTION 'A Thursday report appeared in the Monday workspace'; END IF;
END $$;

-- 6. Recruiters read Thursday, with Monday's figures beside it, and write nothing.
SELECT pg_temp.md_as('recruiter');
DO $$ DECLARE w jsonb; r jsonb; BEGIN
 SELECT public.stand_up_command('workspace',jsonb_build_object('meeting_day','thursday')) INTO w;
 IF w->>'can_edit'<>'false' OR w->>'scheduled'<>'true' OR w->>'actor_role'<>'recruiter' THEN RAISE EXCEPTION 'Recruiter workspace wrong: %',w-'reports'; END IF;
 SELECT x INTO r FROM jsonb_array_elements(w->'reports') x WHERE x->>'facility_id'=(SELECT facility::text FROM md_plan);
 IF r IS NULL OR r->'values'->>'current_total_census'<>'987654' OR r->'monday_submitted'->'values'->>'current_total_census'<>'38' THEN RAISE EXCEPTION 'Recruiter cannot read Thursday beside Monday: %',w; END IF;
 IF r->'monday_submitted'->'values' ? 'callouts_last_week' THEN RAISE EXCEPTION 'Recruiter was shown Monday figures Thursday does not compare'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(w->'facilities') x WHERE x->>'id'=(SELECT other_facility::text FROM md_plan)) THEN RAISE EXCEPTION 'Recruiter saw a facility without access'; END IF;
END $$;
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date,'expected_version',2,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,
 facility,open_week,thursday_values),'Stand Up access denied') FROM md_plan;
SELECT pg_temp.md_fail($q$SELECT public.stand_up_command('workspace','{}')$q$,'Stand Up access denied');
SELECT pg_temp.md_fail($q$SELECT public.stand_up_command('set_meeting_schedule','{"meeting_day":"thursday","call_local":"10:00"}')$q$,'Stand Up access denied');

-- 7. A med_tech is refused Thursday; a facility administrator elsewhere cannot read this facility.
SELECT pg_temp.md_as('floor');
SELECT pg_temp.md_fail($q$SELECT public.stand_up_command('workspace','{"meeting_day":"thursday"}')$q$,'Stand Up access denied');
SELECT pg_temp.md_as('outsider');
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('revisions',jsonb_build_object('meeting_day','thursday','facility_id',%L,'week_start',%L::date))$q$,facility,open_week),'Stand Up access denied') FROM md_plan;

-- 8. The schedule is runtime configuration: an owner moves one facility's
--    Thursday call; the other facility keeps the organization's. Monday has no
--    facility override, and a facility administrator cannot change any.
SELECT pg_temp.md_as('admin');
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('set_meeting_schedule',jsonb_build_object('meeting_day','thursday','facility_id',%L,'call_local','10:00'))$q$,facility),'Stand Up access denied') FROM md_plan;
SELECT pg_temp.md_as('owner');
SELECT public.stand_up_command('set_meeting_schedule',jsonb_build_object('meeting_day','thursday','facility_id',facility,'weekday',5,'entry_due_local','09:30','call_local','10:00')) FROM md_plan;
-- COL-805: Monday is set for the whole organization only (review_stand_up_monday_schedule.sql covers moving it).
SELECT pg_temp.md_fail(format($q$SELECT public.stand_up_command('set_meeting_schedule',jsonb_build_object('meeting_day','monday','facility_id',%L,'call_local','10:00'))$q$,facility),'whole organization') FROM md_plan;
SELECT pg_temp.md_fail($q$SELECT public.stand_up_command('set_meeting_schedule','{"meeting_day":"thursday","time_zone":"Mars/Olympus"}')$q$,'Unknown time zone');
RESET ROLE;
DO $$ DECLARE p md_plan%ROWTYPE; t jsonb; o jsonb; BEGIN
 SELECT * INTO p FROM md_plan;
 t:=haven.stand_up_meeting_times(p.org,p.facility,'thursday','2026-09-21');
 o:=haven.stand_up_meeting_times(p.org,p.other_facility,'thursday','2026-09-21');
 IF t->>'meeting_date'<>'2026-09-25' OR (t->>'entry_due_at')::timestamptz<>'2026-09-25 13:30:00+00' OR (t->>'call_at')::timestamptz<>'2026-09-25 14:00:00+00' THEN RAISE EXCEPTION 'Facility override not applied: %',t; END IF;
 IF o->>'meeting_date'<>'2026-09-24' OR (o->>'call_at')::timestamptz<>'2026-09-24 13:15:00+00' THEN RAISE EXCEPTION 'Facility override leaked to another facility: %',o; END IF;
 IF (SELECT count(*) FROM public.stand_up_meeting_schedule WHERE organization_id=p.org AND meeting_day='monday' AND call_local=time '09:15' AND facility_id IS NULL)<>1 THEN RAISE EXCEPTION 'Monday schedule changed'; END IF;
END $$;

-- The as-of-the-call snapshot of a past Thursday: the revision current when its call started.
DO $$ DECLARE p md_plan%ROWTYPE; rid uuid; before_call uuid; after_call uuid; call_at timestamptz; BEGIN
 SELECT * INTO p FROM md_plan;
 call_at:=(haven.stand_up_meeting_times(p.org,p.facility,'thursday',p.open_week-7)->>'call_at')::timestamptz;
 INSERT INTO public.stand_up_meeting_reports(organization_id,facility_id,week_start,meeting_day,values,status,version)
  VALUES(p.org,p.facility,p.open_week-7,'thursday',p.thursday_values,'ready',2) RETURNING id INTO rid;
 INSERT INTO public.stand_up_meeting_revisions(report_id,version,values,status,actor_id,created_at)
  SELECT rid,1,p.thursday_values,'ready',a.id,call_at-interval '1 hour' FROM md_actor a WHERE a.name='admin' RETURNING id INTO before_call;
 INSERT INTO public.stand_up_meeting_revisions(report_id,version,values,status,actor_id,reason,created_at)
  SELECT rid,2,p.thursday_values,'ready',a.id,'Corrected after the call',call_at+interval '1 hour' FROM md_actor a WHERE a.name='admin' RETURNING id INTO after_call;
 UPDATE public.stand_up_meeting_reports SET revision_id=after_call WHERE id=rid;
 INSERT INTO md_results VALUES('snapshot_expected',to_jsonb(before_call));
END $$;
SELECT pg_temp.md_as('admin');
SET LOCAL ROLE authenticated;
INSERT INTO md_results SELECT 'snapshot',public.stand_up_command('revisions',jsonb_build_object('meeting_day','thursday','facility_id',facility,'week_start',open_week-7)) FROM md_plan;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT value->'call_snapshot_revision_id' FROM md_results WHERE name='snapshot') IS DISTINCT FROM (SELECT value FROM md_results WHERE name='snapshot_expected') THEN
  RAISE EXCEPTION 'Thursday''s as-of-the-call snapshot is not the revision current at the call: %',(SELECT value FROM md_results WHERE name='snapshot');
 END IF;
END $$;

-- 9. Haven only. The Monday exports every publisher reads are byte-identical
--    with the Thursday rows present, and no publisher or export function reads
--    the meeting tables at all.
INSERT INTO md_results SELECT 'aggregate_after',public.stand_up_export_aggregate(org,NULL) FROM md_plan;
INSERT INTO md_results SELECT 'history_after',public.stand_up_export_history(org,open_week-70,open_week+7)-'archive_as_of' FROM md_plan;
DO $$ BEGIN
 IF (SELECT value FROM md_results WHERE name='aggregate_before') IS DISTINCT FROM (SELECT value FROM md_results WHERE name='aggregate_after') THEN RAISE EXCEPTION 'A Thursday row changed the Front Office export'; END IF;
 IF (SELECT value FROM md_results WHERE name='history_before') IS DISTINCT FROM (SELECT value FROM md_results WHERE name='history_after') THEN RAISE EXCEPTION 'A Thursday row changed the history export'; END IF;
 IF EXISTS(SELECT 1 FROM md_results WHERE name IN('aggregate_after','history_after') AND (value::text LIKE '%987654%' OR value::text LIKE '%departures_since_monday%')) THEN RAISE EXCEPTION 'A Thursday figure reached an export'; END IF;
 IF NOT EXISTS(SELECT 1 FROM md_results WHERE name='aggregate_after' AND value::text LIKE '%11000000%') THEN RAISE EXCEPTION 'The probe''s Monday report is not in the export, so the comparison proves nothing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN('public','haven') AND (p.proname IN('stand_up_export_aggregate','stand_up_export_history','stand_up_revision_aggregate','stand_up_google_bridge','stand_up_google_export_bridge','stand_up_connector_save')
    OR p.proname LIKE 'stand\_up\_publisher\_%' OR p.proname LIKE 'stand\_up\_history\_publisher\_%' OR p.proname LIKE 'stand\_up\_google\_%')
   AND (p.prosrc LIKE '%stand\_up\_meeting\_reports%' OR p.prosrc LIKE '%stand\_up\_meeting\_revisions%' OR p.prosrc LIKE '%stand\_up\_meeting\_schedule%' OR p.prosrc LIKE '%meeting\_day%')) THEN
  RAISE EXCEPTION 'A publisher or export function reads the meeting-day tables';
 END IF;
END $$;

-- 10. Thursday history is immutable evidence.
SELECT pg_temp.md_fail($q$UPDATE public.stand_up_meeting_revisions SET status='draft' WHERE report_id IN (SELECT id FROM public.stand_up_meeting_reports WHERE facility_id=(SELECT facility FROM md_plan))$q$,'Stand Up evidence is immutable');
ROLLBACK;
