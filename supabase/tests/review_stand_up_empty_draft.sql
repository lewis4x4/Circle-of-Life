-- Native scratch-only probe for migration 406 (COL-298 / NAV-008); fixtures and
-- auth adaptation roll back.
--
-- The finding: "Standup draft creation can reserve the whole week with missing
-- or partial metrics." A row must exist only once a save carries a figure, an
-- existing empty row must read as nothing entered, and none of it may weaken
-- CAS, idempotency, the facility-and-Monday uniqueness rule or the revisions.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ed_fixture AS
 SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() mate,gen_random_uuid() mate_session,
  f.id facility,f.organization_id org,gen_random_uuid() legacy_facility
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT x.legacy_facility,f.entity_id,x.org,'Legacy empty draft probe','Test','Test','00000',1 FROM ed_fixture x JOIN public.facilities f ON f.id=x.facility;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Empty draft probe"}' FROM ed_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT mate,mate||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Second administrator probe"}' FROM ed_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Empty draft probe','facility_admin',org,true FROM ed_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT mate,mate||'@review.invalid','Second administrator probe','facility_admin',org,true FROM ed_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM ed_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT mate_session,mate FROM ed_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM ed_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT mate,facility,org FROM ed_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,legacy_facility,org FROM ed_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT mate,legacy_facility,org FROM ed_fixture;
CREATE FUNCTION pg_temp.ed_actor(p_first boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',CASE WHEN p_first THEN f.actor ELSE f.mate END,'session_id',CASE WHEN p_first THEN f.session ELSE f.mate_session END,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ed_fixture f JOIN public.user_profiles p ON p.id=CASE WHEN p_first THEN f.actor ELSE f.mate END;
END $$;
CREATE TEMP TABLE ed_plan AS SELECT f.facility,f.legacy_facility,
 haven.stand_up_open_week(f.facility) AS week,
 gen_random_uuid() AS retry_request,
 (SELECT jsonb_object_agg(k,'null'::jsonb) FROM unnest(haven.stand_up_keys()) k) AS blank,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(38) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS one_figure,
 (SELECT jsonb_object_agg(k,CASE WHEN k='overtime_reported' THEN to_jsonb(3.75) ELSE 'null'::jsonb END) FROM unnest(haven.stand_up_keys()) k) AS invalid_duration
 FROM ed_fixture f;
GRANT SELECT ON ed_plan TO authenticated;
CREATE TEMP TABLE ed_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON ed_results TO authenticated;
CREATE FUNCTION pg_temp.ed_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

SELECT pg_temp.ed_actor(true);
SET LOCAL ROLE authenticated;

-- 1. A save carrying sixteen blanks reserves nothing. This is the state an
--    opened and abandoned form can reach; the finding's reservation is gone.
INSERT INTO ed_results SELECT 'blank',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',blank)) FROM ed_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ed_results WHERE name='blank';
 IF (r->>'not_started')::boolean IS NOT TRUE OR r->>'id' IS NOT NULL OR (r->>'version')::int<>0 OR r->>'revision_id' IS NOT NULL THEN
  RAISE EXCEPTION 'A blank save did not return a not-started receipt: %',r;
 END IF;
 -- No stamp is invented for figures that were never recorded.
 IF r->>'source_as_of' IS NOT NULL OR r->>'updated_at' IS NOT NULL THEN RAISE EXCEPTION 'A blank save claimed a recorded time: %',r; END IF;
END $$;

-- 2. Retrying the same request answers identically and still creates nothing.
INSERT INTO ed_results SELECT 'retry_one',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',week,'expected_version',0,'request_id',retry_request,'status','draft','values',blank)) FROM ed_plan;
INSERT INTO ed_results SELECT 'retry_two',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',week,'expected_version',0,'request_id',retry_request,'status','draft','values',blank)) FROM ed_plan;
DO $$ BEGIN
 IF (SELECT value FROM ed_results WHERE name='retry_one') IS DISTINCT FROM (SELECT value FROM ed_results WHERE name='retry_two') THEN
  RAISE EXCEPTION 'A retried blank save returned a different receipt';
 END IF;
END $$;

-- 3. A save that fails validation leaves no half row and no receipt.
SELECT pg_temp.ed_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,facility,week,invalid_duration),'Overtime requires hours and minutes') FROM ed_plan;

-- 4. The first save that carries a figure creates the report at version 1.
-- COL-553: the figure is a census on a facility that may hold residents, so the
-- open-period save carries a reason in case it differs from the roster.
INSERT INTO ed_results SELECT 'first_figure',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',week,'expected_version',0,'request_id',gen_random_uuid(),'status','draft','values',one_figure,
 'roster',jsonb_build_object('current_total_census',jsonb_build_object('override_reason','other')))) FROM ed_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ed_results WHERE name='first_figure';
 IF r->>'id' IS NULL OR (r->>'version')::int<>1 OR r->>'revision_id' IS NULL OR r ? 'not_started' THEN RAISE EXCEPTION 'The first figure did not create a Draft: %',r; END IF;
 IF r->'values'->>'current_total_census'<>'38' THEN RAISE EXCEPTION 'The saved figure did not round-trip: %',r; END IF;
 IF r->>'entry_origin'<>'manual' THEN RAISE EXCEPTION 'A one-figure Draft is not an administrator entry: %',r; END IF;
 IF (SELECT count(*) FROM jsonb_each(r->'values') WHERE value<>'null'::jsonb)<>1 THEN RAISE EXCEPTION 'A partial Draft claimed more than one provided figure: %',r; END IF;
END $$;

RESET ROLE;
-- Exactly one row, one revision, and the uniqueness rule untouched.
DO $$ DECLARE rows integer; revisions integer; BEGIN
 SELECT count(*) INTO rows FROM public.stand_up_reports r JOIN ed_plan p ON p.facility=r.facility_id AND r.week_start=p.week;
 SELECT count(*) INTO revisions FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id JOIN ed_plan p ON p.facility=r.facility_id AND r.week_start=p.week;
 IF rows<>1 OR revisions<>1 THEN RAISE EXCEPTION 'Expected one report and one revision after four saves, found % and %',rows,revisions; END IF;
END $$;

-- 5. A legacy empty row, the kind a facility already carries from before the
--    fix, blocks nothing: it reads as nothing entered, and another
--    administrator saves over it on the same facility and Monday.
WITH inserted AS (
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status,version)
 SELECT f.org,p.legacy_facility,p.week,p.blank,'draft',1 FROM ed_plan p CROSS JOIN ed_fixture f RETURNING id
), revised AS (
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id)
 SELECT i.id,1,p.blank,'draft',f.actor FROM inserted i CROSS JOIN ed_plan p CROSS JOIN ed_fixture f RETURNING id,report_id
)
UPDATE public.stand_up_reports r SET revision_id=revised.id FROM revised WHERE r.id=revised.report_id;
DO $$ DECLARE w jsonb; BEGIN
 SELECT to_jsonb(r)||haven.stand_up_revision_metadata(r.revision_id) INTO w FROM public.stand_up_reports r JOIN ed_plan p ON p.legacy_facility=r.facility_id AND r.week_start=p.week;
 -- entry_origin initialized plus zero provided figures is the vocabulary's "Not started".
 IF w->>'entry_origin'<>'initialized' THEN RAISE EXCEPTION 'A legacy empty draft did not read as never populated: %',w; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(w->'values') WHERE value<>'null'::jsonb) THEN RAISE EXCEPTION 'The legacy fixture is not empty'; END IF;
END $$;
SELECT pg_temp.ed_actor(false);
SET LOCAL ROLE authenticated;
INSERT INTO ed_results SELECT 'second_admin',public.stand_up_command('save',jsonb_build_object(
 'facility_id',legacy_facility,'week_start',week,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',one_figure)) FROM ed_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ed_results WHERE name='second_admin';
 IF (r->>'version')::int<>2 OR r->'values'->>'current_total_census'<>'38' THEN RAISE EXCEPTION 'An empty draft blocked another administrator: %',r; END IF;
END $$;
-- CAS is unchanged: a stale expected version is still refused.
SELECT pg_temp.ed_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb))$q$,legacy_facility,week,one_figure),'Stale report version') FROM ed_plan;
RESET ROLE;
DO $$ DECLARE rows integer; BEGIN
 SELECT count(*) INTO rows FROM public.stand_up_reports r JOIN ed_plan p ON r.facility_id IN (p.facility,p.legacy_facility) AND r.week_start=p.week;
 IF rows<>2 THEN RAISE EXCEPTION 'The facility and Monday uniqueness rule changed: % rows for two facilities',rows; END IF;
END $$;
ROLLBACK;
