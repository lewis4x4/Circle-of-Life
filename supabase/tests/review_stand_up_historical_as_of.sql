-- Native scratch-only probe for migration 416 (COL-395); fixtures and auth
-- adaptation roll back.
--
-- The finding: "A historical correction erases the report's recorded as-of
-- time." A correction to a past week sends no as_of, and haven.stand_up_save
-- wrote that absence over stand_up_reports.source_as_of. The recorded
-- observation time must survive a correction, an explicit as_of must still win
-- (including the explicit null that reversal and outage recovery restore), a
-- future as_of must still be refused, and the open reporting period must still
-- stamp a fresh time on every save.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ao_fixture AS
 SELECT gen_random_uuid() actor,gen_random_uuid() session,f.organization_id org,gen_random_uuid() facility,f.entity_id
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity_id,org,'Historical as-of probe','Test','Test','00000',1 FROM ao_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Historical as-of probe"}' FROM ao_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Historical as-of probe','owner',org,true FROM ao_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM ao_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM ao_fixture;
CREATE FUNCTION pg_temp.ao_actor() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ao_fixture f JOIN public.user_profiles p ON p.id=f.actor;
END $$;
CREATE TEMP TABLE ao_plan AS SELECT f.facility,f.org,
 haven.stand_up_open_week(f.facility) AS open_week,
 (haven.stand_up_open_week(f.facility)-7)::date AS past_week,
 -- The time the past week's figures were actually observed, recorded then.
 (clock_timestamp()-interval '6 days')::timestamptz AS recorded_as_of,
 (clock_timestamp()-interval '2 days')::timestamptz AS stated_as_of,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(38) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS original,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(39) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS corrected,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(40) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS corrected_again
 FROM ao_fixture f;
GRANT SELECT ON ao_plan TO authenticated;
CREATE TEMP TABLE ao_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON ao_results TO authenticated;
CREATE FUNCTION pg_temp.ao_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

-- A past week that was reported at the time, with its observation time recorded.
WITH inserted AS (
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status,version,source_as_of)
 SELECT org,facility,past_week,original,'draft',1,recorded_as_of FROM ao_plan RETURNING id
), revised AS (
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,source_as_of)
 SELECT i.id,1,p.original,'draft',f.actor,p.recorded_as_of FROM inserted i CROSS JOIN ao_plan p CROSS JOIN ao_fixture f RETURNING id,report_id
)
UPDATE public.stand_up_reports r SET revision_id=revised.id FROM revised WHERE r.id=revised.report_id;

SELECT pg_temp.ao_actor();
SET LOCAL ROLE authenticated;

-- 1. The finding. A reasoned correction to the past week, sending no as_of,
--    keeps the recorded observation time on the report.
INSERT INTO ao_results SELECT 'correction',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',corrected,
 'reason','Census miscounted at the meeting')) FROM ao_plan;
DO $$ DECLARE r jsonb; expected timestamptz; BEGIN
 SELECT value INTO r FROM ao_results WHERE name='correction';
 SELECT recorded_as_of INTO expected FROM ao_plan;
 IF (r->>'version')::int<>2 OR r->'values'->>'current_total_census'<>'39' THEN RAISE EXCEPTION 'The correction did not save: %',r; END IF;
 IF r->>'source_as_of' IS NULL THEN RAISE EXCEPTION 'The correction erased the recorded as-of time: %',r; END IF;
 IF (r->>'source_as_of')::timestamptz<>expected THEN RAISE EXCEPTION 'The correction changed the recorded as-of time: % expected %',r->>'source_as_of',expected; END IF;
END $$;
-- 2. An explicit as_of still wins over what the report carries.
INSERT INTO ao_results SELECT 'stated',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',2,'request_id',gen_random_uuid(),'status','draft','values',corrected_again,
 'as_of',stated_as_of,'reason','Corrected from the signed meeting sheet')) FROM ao_plan;
DO $$ DECLARE r jsonb; stated timestamptz; BEGIN
 SELECT value INTO r FROM ao_results WHERE name='stated';
 SELECT stated_as_of INTO stated FROM ao_plan;
 IF (r->>'source_as_of')::timestamptz<>stated THEN RAISE EXCEPTION 'An explicit as_of did not win: % expected %',r->>'source_as_of',stated; END IF;
END $$;

-- 3. An explicit null still clears it. This is the contract reversal and outage
--    recovery depend on: they always send the key, carrying the prior
--    revision's source_as_of, and restoring a state that had none must restore
--    none rather than inherit the current one.
INSERT INTO ao_results SELECT 'explicit_null',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',3,'request_id',gen_random_uuid(),'status','draft','values',corrected,
 'as_of',NULL::timestamptz,'reason','Restoring the state before the import')) FROM ao_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ao_results WHERE name='explicit_null';
 IF r->>'source_as_of' IS NOT NULL THEN RAISE EXCEPTION 'An explicit null as_of was overridden by the stored time: %',r; END IF;
END $$;
-- And once nothing is recorded, a later correction has nothing to inherit: the
-- form's "As-of time not recorded" is then true rather than a side effect.
INSERT INTO ao_results SELECT 'after_null',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',4,'request_id',gen_random_uuid(),'status','draft','values',corrected_again,
 'reason','Second correction with nothing recorded')) FROM ao_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ao_results WHERE name='after_null';
 IF r->>'source_as_of' IS NOT NULL THEN RAISE EXCEPTION 'A correction invented an as-of time: %',r; END IF;
END $$;

-- 4. A future observation time is still refused.
SELECT pg_temp.ao_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',5,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb,'as_of',%L::timestamptz,'reason','Future time'))$q$,
 facility,past_week,original,clock_timestamp()+interval '1 day'),'Source observation time cannot be future') FROM ao_plan;

-- 5. The open reporting period is unchanged: every save stamps server time, and
--    a second save moves the stamp forward rather than holding the first one.
INSERT INTO ao_results SELECT 'open_first',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',open_week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',original)) FROM ao_plan;
INSERT INTO ao_results SELECT 'open_second',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',open_week,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',corrected)) FROM ao_plan;
DO $$ DECLARE first jsonb; second jsonb; BEGIN
 SELECT value INTO first FROM ao_results WHERE name='open_first';
 SELECT value INTO second FROM ao_results WHERE name='open_second';
 IF first->>'source_as_of' IS NULL OR second->>'source_as_of' IS NULL THEN RAISE EXCEPTION 'The open period stopped stamping an as-of time: % then %',first,second; END IF;
 IF (second->>'source_as_of')::timestamptz<(first->>'source_as_of')::timestamptz THEN RAISE EXCEPTION 'The open period stamp went backwards: % then %',first->>'source_as_of',second->>'source_as_of'; END IF;
END $$;

RESET ROLE;
-- The new revision records the same value, so history and the report agree.
-- Read as the owning role: the replay has no Supabase default privileges, so
-- `authenticated` cannot select the revision table directly here.
DO $$ DECLARE v timestamptz; expected timestamptz; BEGIN
 SELECT recorded_as_of INTO expected FROM ao_plan;
 SELECT x.source_as_of INTO v FROM public.stand_up_revisions x JOIN public.stand_up_reports rp ON rp.id=x.report_id
  JOIN ao_plan p ON p.facility=rp.facility_id AND rp.week_start=p.past_week WHERE x.version=2;
 IF v IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Revision 2 recorded % rather than the observation time %',v,expected; END IF;
END $$;
-- The correction path did not multiply reports or skip revisions.
DO $$ DECLARE reports integer; revisions integer; BEGIN
 SELECT count(*) INTO reports FROM public.stand_up_reports r JOIN ao_plan p ON p.facility=r.facility_id AND r.week_start IN(p.past_week,p.open_week);
 SELECT count(*) INTO revisions FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id JOIN ao_plan p ON p.facility=r.facility_id AND r.week_start=p.past_week;
 IF reports<>2 THEN RAISE EXCEPTION 'Expected one past and one open report, found %',reports; END IF;
 IF revisions<>5 THEN RAISE EXCEPTION 'Expected five revisions on the corrected week, found %',revisions; END IF;
END $$;
ROLLBACK;
