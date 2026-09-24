-- Native scratch-only probe for migration 512 (COL-797); fixtures and auth
-- adaptation roll back.
--
-- The finding: "Once a facility submits Stand Up for a staffing week, nobody but
-- an owner can change it." The facility administrator who submitted a week, and
-- another facility administrator for that facility, must be able to correct the
-- submitted week without wiping it; every change after the submission must leave
-- one audit row per field with actor, time, before and after; and a user without
-- Stand Up authority, or without access to the facility, is still refused.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ps_fixture AS
 SELECT gen_random_uuid() facility,gen_random_uuid() other_facility,f.organization_id org,f.entity_id
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity_id,org,'Post-submit probe','Test','Test','00000',1 FROM ps_fixture
 UNION ALL SELECT other_facility,entity_id,org,'Post-submit other probe','Test','Test','00000',1 FROM ps_fixture;
-- submitter: facility_admin who submitted; peer: another facility_admin here;
-- floor: med_tech here; outsider: facility_admin for another facility only.
CREATE TEMP TABLE ps_actor AS
 SELECT name,gen_random_uuid() id,gen_random_uuid() session,role,here FROM (VALUES
  ('submitter','facility_admin',true),('peer','facility_admin',true),('floor','med_tech',true),('outsider','facility_admin',false)) v(name,role,here);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT a.id,a.id||'@review.invalid',jsonb_build_object('organization_id',f.org,'app_role',a.role),jsonb_build_object('full_name','Probe '||a.name) FROM ps_actor a CROSS JOIN ps_fixture f;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT a.id,a.id||'@review.invalid','Probe '||a.name,a.role::public.app_role,f.org,true FROM ps_actor a CROSS JOIN ps_fixture f
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,full_name=excluded.full_name,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ps_actor;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT a.id,CASE WHEN a.here THEN f.facility ELSE f.other_facility END,f.org FROM ps_actor a CROSS JOIN ps_fixture f;
CREATE FUNCTION pg_temp.ps_as(p_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',f.org,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ps_actor a CROSS JOIN ps_fixture f JOIN public.user_profiles p ON true WHERE p.id=a.id AND a.name=p_name;
END $$;
CREATE TEMP TABLE ps_plan AS SELECT f.facility,f.org,
 haven.stand_up_open_week(f.facility) AS open_week,
 (haven.stand_up_open_week(f.facility)-7)::date AS past_week,
 (haven.stand_up_open_week(f.facility)-14)::date AS unsubmitted_week,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(38) ELSE to_jsonb(1) END) FROM unnest(haven.stand_up_keys()) k) AS submitted,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(39) ELSE to_jsonb(1) END) FROM unnest(haven.stand_up_keys()) k) AS corrected,
 (SELECT jsonb_object_agg(k,CASE WHEN k='current_total_census' THEN to_jsonb(39) WHEN k='callouts_last_week' THEN to_jsonb(4) ELSE to_jsonb(1) END) FROM unnest(haven.stand_up_keys()) k) AS corrected_again,
 -- The open week keeps its roster figures blank so the probe does not depend on a roster.
 (SELECT jsonb_object_agg(k,CASE WHEN k IN('current_total_census','hospital_and_rehab_total') THEN 'null'::jsonb ELSE to_jsonb(2) END) FROM unnest(haven.stand_up_keys()) k) AS open_submitted,
 (SELECT jsonb_object_agg(k,CASE WHEN k IN('current_total_census','hospital_and_rehab_total') THEN 'null'::jsonb WHEN k='callouts_last_week' THEN to_jsonb(5) ELSE to_jsonb(2) END) FROM unnest(haven.stand_up_keys()) k) AS open_edited
 FROM ps_fixture f;
GRANT SELECT ON ps_plan,ps_fixture,ps_actor TO authenticated;
CREATE TEMP TABLE ps_results(name text PRIMARY KEY,value jsonb);
GRANT ALL ON ps_results TO authenticated;
CREATE FUNCTION pg_temp.ps_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;

-- Grant posture: authenticated reads the audit through RLS and never writes it.
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.stand_up_post_submit_changes','INSERT') OR has_table_privilege('authenticated','public.stand_up_post_submit_changes','UPDATE')
  OR has_table_privilege('authenticated','public.stand_up_post_submit_changes','DELETE') OR has_table_privilege('anon','public.stand_up_post_submit_changes','SELECT')
  OR has_function_privilege('authenticated','haven.stand_up_can_edit_submitted(uuid,date)','EXECUTE') THEN RAISE EXCEPTION 'Post-submit audit grant boundary failed'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stand_up_post_submit_changes'::regclass) THEN RAISE EXCEPTION 'Post-submit audit has no RLS'; END IF;
END $$;

-- Two weeks already past: one submitted by the facility administrator, one
-- only ever drafted. Plus the open week, submitted by the same person.
CREATE FUNCTION pg_temp.ps_seed(p_week date,p_values jsonb,p_status text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rid uuid; vid uuid; BEGIN
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status,version)
  SELECT org,facility,p_week,p_values,p_status,1 FROM ps_plan RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id)
  SELECT rid,1,p_values,p_status,a.id FROM ps_actor a WHERE a.name='submitter' RETURNING id INTO vid;
 UPDATE public.stand_up_reports SET revision_id=vid WHERE id=rid;
END $$;
SELECT pg_temp.ps_seed(past_week,submitted,'ready') FROM ps_plan;
SELECT pg_temp.ps_seed(unsubmitted_week,submitted,'draft') FROM ps_plan;
SELECT pg_temp.ps_seed(open_week,open_submitted,'ready') FROM ps_plan;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stand_up_post_submit_changes c JOIN ps_plan p ON p.facility=c.facility_id) THEN RAISE EXCEPTION 'A first submission was audited as a post-submit change'; END IF;
END $$;

-- 1. The submitter corrects the submitted past week. Before migration 512 this
--    was "Stand Up access denied" for everyone below org_admin.
SELECT pg_temp.ps_as('submitter');
SET LOCAL ROLE authenticated;
INSERT INTO ps_results SELECT 'submitter_edit',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',corrected,
 'reason','Census corrected after the stand-up call')) FROM ps_plan;
DO $$ DECLARE r jsonb; BEGIN
 SELECT value INTO r FROM ps_results WHERE name='submitter_edit';
 IF (r->>'version')::int<>2 OR r->'values'->>'current_total_census'<>'39' OR r->>'status'<>'draft' THEN RAISE EXCEPTION 'The submitter could not edit the submitted week: %',r; END IF;
 IF r->>'last_submitted_by' IS DISTINCT FROM (SELECT id::text FROM ps_actor WHERE name='submitter') THEN RAISE EXCEPTION 'The receipt did not name the last submitter: %',r; END IF;
 -- Every other figure survived: nothing was wiped.
 IF (SELECT count(*) FROM jsonb_each(r->'values') WHERE value='null'::jsonb)<>0 THEN RAISE EXCEPTION 'The edit wiped figures: %',r; END IF;
END $$;

-- 2. The field history: one row for census, one for the status, each with actor, time, before and after.
INSERT INTO ps_results SELECT 'history_1',public.stand_up_command('post_submit_changes',jsonb_build_object('facility_id',facility,'week_start',past_week)) FROM ps_plan;
DO $$ DECLARE h jsonb; c jsonb; s jsonb; BEGIN
 SELECT value->'changes' INTO h FROM ps_results WHERE name='history_1';
 IF jsonb_array_length(h)<>2 THEN RAISE EXCEPTION 'Expected census and status rows, found %',h; END IF;
 SELECT x INTO c FROM jsonb_array_elements(h) x WHERE x->>'field_key'='current_total_census';
 SELECT x INTO s FROM jsonb_array_elements(h) x WHERE x->>'field_key'='status';
 IF c->'before_value'<>'38'::jsonb OR c->'after_value'<>'39'::jsonb THEN RAISE EXCEPTION 'Census before/after wrong: %',c; END IF;
 IF c->>'actor_id' IS DISTINCT FROM (SELECT id::text FROM ps_actor WHERE name='submitter') OR c->>'actor_name'<>'Probe submitter' OR c->>'actor_role'<>'facility_admin' THEN RAISE EXCEPTION 'Actor not recorded: %',c; END IF;
 IF c->>'created_at' IS NULL OR c->>'reason'<>'Census corrected after the stand-up call' OR (c->>'version')::int<>2 THEN RAISE EXCEPTION 'Time, reason or version not recorded: %',c; END IF;
 IF s->'before_value'<>'"ready"'::jsonb OR s->'after_value'<>'"draft"'::jsonb THEN RAISE EXCEPTION 'Status change not recorded: %',s; END IF;
END $$;

-- 3. Another facility administrator for the facility corrects it again and resubmits.
SELECT pg_temp.ps_as('peer');
INSERT INTO ps_results SELECT 'peer_edit',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',past_week,'expected_version',2,'request_id',gen_random_uuid(),'status','ready','values',corrected_again,
 'reason','Callouts confirmed with payroll')) FROM ps_plan;
DO $$ DECLARE r jsonb; h jsonb; c jsonb; BEGIN
 SELECT value INTO r FROM ps_results WHERE name='peer_edit';
 IF (r->>'version')::int<>3 OR r->>'status'<>'ready' OR r->'values'->>'callouts_last_week'<>'4' THEN RAISE EXCEPTION 'A facility administrator could not edit and resubmit: %',r; END IF;
 SELECT public.stand_up_command('post_submit_changes',jsonb_build_object('facility_id',facility,'week_start',past_week))->'changes' INTO h FROM ps_plan;
 SELECT x INTO c FROM jsonb_array_elements(h) x WHERE x->>'field_key'='callouts_last_week';
 IF c IS NULL OR c->'before_value'<>'1'::jsonb OR c->'after_value'<>'4'::jsonb OR c->>'actor_name'<>'Probe peer' THEN RAISE EXCEPTION 'Peer change not audited: %',h; END IF;
 IF jsonb_array_length(h)<>4 THEN RAISE EXCEPTION 'Expected four audit rows after two edits, found %',h; END IF;
 -- RLS lets the same administrator read the table directly.
 IF (SELECT count(*) FROM public.stand_up_post_submit_changes c JOIN ps_plan p ON p.facility=c.facility_id)<>4 THEN RAISE EXCEPTION 'RLS hid the audit from a facility administrator'; END IF;
END $$;

-- 4. The open week: an edit after submission is audited the same way.
SELECT pg_temp.ps_as('submitter');
INSERT INTO ps_results SELECT 'open_edit',public.stand_up_command('save',jsonb_build_object(
 'facility_id',facility,'week_start',open_week,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',open_edited)) FROM ps_plan;
DO $$ DECLARE h jsonb; BEGIN
 SELECT public.stand_up_command('post_submit_changes',jsonb_build_object('facility_id',facility,'week_start',open_week))->'changes' INTO h FROM ps_plan;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h) x WHERE x->>'field_key'='callouts_last_week' AND x->'before_value'='2'::jsonb AND x->'after_value'='5'::jsonb) THEN RAISE EXCEPTION 'Open-week post-submit edit not audited: %',h; END IF;
END $$;

-- 5. A past week that was never submitted stays owner and org_admin only.
SELECT pg_temp.ps_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',1,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb,'reason','Not submitted'))$q$,
 facility,unsubmitted_week,corrected),'Stand Up access denied') FROM ps_plan;

-- 6. A med_tech at the facility is refused the edit and the history.
SELECT pg_temp.ps_as('floor');
SELECT pg_temp.ps_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',3,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb,'reason','Not allowed'))$q$,
 facility,past_week,corrected),'Stand Up access denied') FROM ps_plan;
SELECT pg_temp.ps_fail(format($q$SELECT public.stand_up_command('post_submit_changes',jsonb_build_object('facility_id',%L,'week_start',%L::date))$q$,facility,past_week),'Stand Up access denied') FROM ps_plan;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stand_up_post_submit_changes c JOIN ps_plan p ON p.facility=c.facility_id) THEN RAISE EXCEPTION 'RLS showed the audit to a med_tech'; END IF;
END $$;

-- 7. A facility administrator for another facility is refused the edit and the history.
SELECT pg_temp.ps_as('outsider');
SELECT pg_temp.ps_fail(format($q$SELECT public.stand_up_command('save',jsonb_build_object('facility_id',%L,'week_start',%L::date,'expected_version',3,'request_id',gen_random_uuid(),'status','draft','values',%L::jsonb,'reason','Not allowed'))$q$,
 facility,past_week,corrected),'Stand Up access denied') FROM ps_plan;
SELECT pg_temp.ps_fail(format($q$SELECT public.stand_up_command('post_submit_changes',jsonb_build_object('facility_id',%L,'week_start',%L::date))$q$,facility,past_week),'Stand Up access denied') FROM ps_plan;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.stand_up_post_submit_changes c JOIN ps_plan p ON p.facility=c.facility_id) THEN RAISE EXCEPTION 'RLS showed the audit outside facility access'; END IF;
END $$;

RESET ROLE;
-- 8. The audit is immutable even to the owning role.
SELECT pg_temp.ps_fail($q$UPDATE public.stand_up_post_submit_changes SET after_value='0'::jsonb WHERE facility_id=(SELECT facility FROM ps_plan)$q$,'Stand Up evidence is immutable');
SELECT pg_temp.ps_fail($q$DELETE FROM public.stand_up_post_submit_changes WHERE facility_id=(SELECT facility FROM ps_plan)$q$,'Stand Up evidence is immutable');
ROLLBACK;
