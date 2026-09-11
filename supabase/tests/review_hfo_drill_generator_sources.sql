-- COL-154: drill and generator/asset observation records connected to the
-- checklist through the COL-147 source-link mechanism, on the disposable
-- replay. Uses the real catalog activities (336) at Homewood Lodge with
-- synthetic versions, configurations, bindings and occurrences (the weekly
-- Tuesday rule is a fixture, not Homewood's schedule; Q06/Q09/Q14 stay open).
-- Proves: registration is exactly the two adapters and five rules and no
-- review activity is allowlisted; a staff-observed generator test satisfies
-- exactly its generator's occurrence once with the recorder as source author
-- and the observer as performer; replay returns the same reply; a duplicate
-- record is a visible conflict, never a second satisfaction; a failed
-- observation opens an issue that a later void leaves open; a correction
-- supersedes as a 344 chain and a correction that moves the record to the
-- other generator invalidates the first occurrence and satisfies the second;
-- an automatic self-test, a photo alone, a future or unstated-late instant, a
-- failed outcome without an issue, a retired or wrong-type asset and a
-- stranger observer are refused by name and write nothing; a legacy drill_log
-- row is a draft that cannot satisfy anything until finalized; finalizing a
-- fire drill satisfies its occurrence as awaiting verification while the
-- separate review occurrence stays pending; corrections, voids, tornado
-- drills, an unauthorised finalizer, the other site and every direct-DML path
-- behave as the contract says. Rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- Hosted Supabase grants authenticated the default table privileges the legacy page relies on for drill_log; the replay stub has none, so they are modelled here (RLS and the lifecycle guard are the real controls).
GRANT SELECT,INSERT,UPDATE,DELETE ON public.drill_log TO authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-154 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-154 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR coalesce(d,'')=detail_fragment) AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-154 expected rejection containing "%": %',fragment,stmt;
END $$;

-- 0. Registration is exactly the two adapters and five rules for the seeded organisation; no review activity is allowlisted; nothing was delivered, recorded or finalized.
SELECT pg_temp.c_assert((SELECT array_agg(source_key||':'||subject_kind||':'||reader_function||':'||status ORDER BY source_key) FROM public.operation_source_adapters)
 =ARRAY['asset-observation:asset:operation_source_read_asset_observation:registered','drill-log:facility:operation_source_read_drill_log:registered'],'COL-154 adapters not registered exactly');
SELECT pg_temp.c_assert((SELECT array_agg(ru.source_key||':'||a.activity_key ORDER BY ru.source_key,a.activity_key) FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id)
 =ARRAY['asset-observation:hfo-al-a07-03','asset-observation:hfo-al-w01-01','asset-observation:hfo-al-w01-02','drill-log:hfo-al-m05-01','drill-log:hfo-al-m06-01'],'COL-154 rules not registered exactly');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_key IN('hfo-al-a07-01','hfo-al-a07-02','hfo-al-a08-01','hfo-al-a08-02')),'a review activity is allowlisted');
SELECT pg_temp.c_assert((SELECT bool_and(status='registered') FROM public.operation_source_adapters) AND (SELECT bool_and(organization_id='00000000-0000-0000-0000-000000000001') FROM public.operation_source_adapters),'adapter registration drifted');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_events) AND NOT EXISTS(SELECT 1 FROM public.operation_source_record_requests) AND NOT EXISTS(SELECT 1 FROM public.asset_observations)
 AND NOT EXISTS(SELECT 1 FROM public.drill_log WHERE finalized_at IS NOT NULL OR voided_at IS NOT NULL OR record_version<>1),'the migration delivered, recorded or finalized something');

-- FIXTURES-BEGIN
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() aide,gen_random_uuid() aide_session,
 gen_random_uuid() site_b,gen_random_uuid() gen1,gen_random_uuid() gen2,gen_random_uuid() gen_ret,gen_random_uuid() co1,gen_random_uuid() ext1,gen_random_uuid() gen_b,
 gen_random_uuid() subj_gen1,gen_random_uuid() subj_gen2,gen_random_uuid() subj_co1,gen_random_uuid() subj_ext1,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-w01-01') act_gen,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-w01-02') act_co,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-a07-03') act_ext,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-m05-01') act_fire,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-m06-01') act_elope,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-a07-02') act_review_fire,
 -- Dates are anchored on the facility-local day: versions, configurations and bindings take effect at 23:59 yesterday (within the one-day
 -- backdate a publication allows, so they are in force on yesterday's and today's occurrences); d0 is today; the routine instant is five
 -- minutes ago and the late instant twenty minutes ago (a run in the first twenty minutes after local midnight is outside this fixture).
 ((current_timestamp AT TIME ZONE 'America/New_York')::date::timestamp-interval '1 minute') AT TIME ZONE 'America/New_York' since,
 date_trunc('minute',clock_timestamp()-interval '5 minutes') recent,date_trunc('minute',clock_timestamp()-interval '20 minutes') past_due,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE f.id='00000000-0000-0000-0002-000000000003' AND deleted_at IS NULL;
ALTER TABLE cf ADD COLUMN d0 date,ADD COLUMN d1 date,ADD COLUMN dold date,ADD COLUMN hh0 text;
UPDATE cf SET d0=(clock_timestamp() AT TIME ZONE 'America/New_York')::date,hh0=to_char(past_due AT TIME ZONE 'America/New_York','HH24:MI');
UPDATE cf SET d1=d0+7,dold=d0-3;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM cf) AND (SELECT act_gen IS NOT NULL AND act_co IS NOT NULL AND act_ext IS NOT NULL AND act_fire IS NOT NULL AND act_elope IS NOT NULL AND act_review_fire IS NOT NULL FROM cf),'Homewood or the catalog activities are missing');
CREATE TEMP TABLE cf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE cf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON cf TO authenticated,service_role; GRANT ALL ON cf_ids,cf_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Drill Site B','Test','Test','00000',1 FROM cf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@drill.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM cf
 UNION ALL SELECT admin_a,admin_a||'@drill.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM cf
 UNION ALL SELECT admin_b,admin_b||'@drill.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM cf
 UNION ALL SELECT maint,maint||'@drill.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM cf
 UNION ALL SELECT aide,aide||'@drill.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@drill.invalid','Corporate','owner'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_a,admin_a||'@drill.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_b,admin_b||'@drill.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT maint,maint||'@drill.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM cf
 UNION ALL SELECT aide,aide||'@drill.invalid','Aide','housekeeper'::public.app_role,org,true FROM cf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM cf UNION ALL SELECT admin_a_session,admin_a FROM cf UNION ALL SELECT admin_b_session,admin_b FROM cf
 UNION ALL SELECT maint_session,maint FROM cf UNION ALL SELECT aide_session,aide FROM cf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM cf UNION ALL SELECT admin_a,site_a,org FROM cf UNION ALL SELECT admin_b,site_b,org FROM cf UNION ALL SELECT maint,site_a,org FROM cf UNION ALL SELECT aide,site_a,org FROM cf;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name,status)
 SELECT gen1,org,site_a,'generator','Generator east',  'active' FROM cf UNION ALL SELECT gen2,org,site_a,'generator','Generator west','active' FROM cf
 UNION ALL SELECT gen_ret,org,site_a,'generator','Generator retired','retired' FROM cf UNION ALL SELECT co1,org,site_a,'other','CO detector hallway','active' FROM cf
 UNION ALL SELECT ext1,org,site_a,'fire_extinguisher','Extinguisher kitchen','active' FROM cf UNION ALL SELECT gen_b,org,site_b,'generator','Site B generator','active' FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id)
 SELECT subj_gen1,org,site_a,'asset',gen1 FROM cf UNION ALL SELECT subj_gen2,org,site_a,'asset',gen2 FROM cf UNION ALL SELECT subj_co1,org,site_a,'asset',co1 FROM cf UNION ALL SELECT subj_ext1,org,site_a,'asset',ext1 FROM cf;
CREATE FUNCTION pg_temp.c_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f cf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM cf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSE u:=f.aide; sess:=f.aide_session; r:='housekeeper'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.c_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.c_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.occ2(d date,p_start date,p_end date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(p_start,'YYYY-MM-DD'),'end_date',to_char(p_end,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col154-'||p $$;
CREATE FUNCTION pg_temp.rid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM cf_ids WHERE label=p_label $$;
CREATE FUNCTION pg_temp.res(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT result FROM cf_results WHERE label=p_label $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM cf_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.obs(p_key text,p_asset uuid,p_kind text,p_at timestamptz,p_outcome text,p_readings jsonb DEFAULT '{}'::jsonb,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_asset_observation_review(pg_temp.k(p_key),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',p_asset,'observation_kind',p_kind,'observed_at',p_at,'basis','staff_observed','outcome',p_outcome,'readings',p_readings)||p_extra)
$$;
CREATE FUNCTION pg_temp.deliver(p_key text,p_source text,p_id text,p_version text,p_kind text,p_facility uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.deliver_operation_source_event_review(pg_temp.k(p_key),jsonb_build_object('source_key',p_source,'source_record_id',p_id,'source_record_version',p_version,'event_kind',p_kind,'facility_id',p_facility))
$$;
CREATE FUNCTION pg_temp.drill(p_type text,p_date date,p_time text,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE new_id uuid; BEGIN
 INSERT INTO public.drill_log(organization_id,facility_id,drill_type,drill_date,drill_time,pull_station_activated,staff_present_count,residents_present_count,conducted_by,notes,created_by,outcome,issue_summary)
 SELECT org,site_a,p_type,p_date,p_time::time,coalesce((p_extra->>'pull')::boolean,true),coalesce((p_extra->>'staff')::int,4),coalesce((p_extra->>'residents')::int,20),nullif(p_extra->>'conducted_by','')::uuid,
  coalesce(p_extra->>'notes','Fixture drill'),auth.uid(),coalesce(p_extra->>'outcome','performed'),p_extra->>'issue_summary' FROM cf RETURNING id INTO new_id;
 RETURN new_id; END $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,int),pg_temp.occ2(date,date,date,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.c_login(text),pg_temp.c_service(),pg_temp.c_clear(),pg_temp.k(text),pg_temp.rid(text),pg_temp.res(text),pg_temp.rev(text),
 pg_temp.obs(text,uuid,text,timestamptz,text,jsonb,jsonb),pg_temp.deliver(text,text,text,text,text,uuid),pg_temp.drill(text,date,text,jsonb) TO authenticated,service_role;

-- Central versions (owner): recorder lists and typed inputs are fixtures.
SELECT pg_temp.c_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_gen',public.save_operation_requirement_draft_review(act_gen,jsonb_build_object('title','Record generator test','wording','Observe the weekly generator test.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','started_ok','label','Started and transferred','type','boolean','required',true),jsonb_build_object('key','run_minutes','label','Run time','type','number','required',false,'min',0,'max',120)))) FROM cf;
INSERT INTO cf_results SELECT 'v_co',public.save_operation_requirement_draft_review(act_co,jsonb_build_object('title','Record carbon monoxide check','wording','Read the CO detector.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin','housekeeper'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','co_ppm','label','CO ppm','type','number','required',true,'min',0,'max',500)))) FROM cf;
INSERT INTO cf_results SELECT 'v_ext',public.save_operation_requirement_draft_review(act_ext,jsonb_build_object('title','Check extinguisher currency','wording','Check the inspection tag.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','tag_current','label','Tag current','type','boolean','required',true)))) FROM cf;
INSERT INTO cf_results SELECT 'v_fire',public.save_operation_requirement_draft_review(act_fire,jsonb_build_object('title','Record fire drill','wording','Conduct and record the fire drill.','allowed_recorder_roles',jsonb_build_array('facility_admin','maintenance_role'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('owner','facility_admin'))) FROM cf;
INSERT INTO cf_results SELECT 'v_elope',public.save_operation_requirement_draft_review(act_elope,jsonb_build_object('title','Record elopement drill','wording','Conduct and record the elopement drill.','allowed_recorder_roles',jsonb_build_array('facility_admin','maintenance_role'))) FROM cf;
INSERT INTO cf_results SELECT 'v_review',public.save_operation_requirement_draft_review(act_review_fire,jsonb_build_object('title','Review fire drill coverage','wording','Review the month''s fire drill records.','allowed_recorder_roles',jsonb_build_array('facility_admin'))) FROM cf;
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'v\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.c_assert((SELECT count(*)=6 FROM cf_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_'||x.label,public.save_operation_facility_requirement_draft_review(x.act,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_'||x.label),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb))
 FROM cf CROSS JOIN LATERAL (VALUES('gen',cf.act_gen),('co',cf.act_co),('ext',cf.act_ext),('fire',cf.act_fire),('elope',cf.act_elope),('review',cf.act_review_fire)) x(label,act);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'fr\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.c_assert((SELECT count(*)=6 FROM cf_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO cf_results SELECT 'b_gen1',public.enroll_operation_binding_review(act_gen,site_a,subj_gen1,'asset',NULL,'{"source":"admin_log","reason":"Generator east"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_gen2',public.enroll_operation_binding_review(act_gen,site_a,subj_gen2,'asset',NULL,'{"source":"admin_log","reason":"Generator west"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_co1',public.enroll_operation_binding_review(act_co,site_a,subj_co1,'asset',NULL,'{"source":"admin_log","reason":"CO detector"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_ext1',public.enroll_operation_binding_review(act_ext,site_a,subj_ext1,'asset',NULL,'{"source":"admin_log","reason":"Extinguisher"}',since) FROM cf;
RESET ROLE;
-- Occurrences from the service generator: the asset activities' d0 period starts yesterday (so a late instant matches whatever the hour); facility activities keep the plain week; d1 is the following week.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_results SELECT 'g_'||x.label,public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_'||x.label),
 jsonb_build_array(pg_temp.occ2(d0,d0-1,d0+5,'America/New_York','10:00',120),pg_temp.occ(d1,'America/New_York','10:00',120)),pg_temp.run('run-'||x.label,d0,d1,pg_temp.rid('fr_'||x.label)))
 FROM cf CROSS JOIN LATERAL (VALUES('gen'),('co'),('ext')) x(label);
INSERT INTO cf_results SELECT 'g_'||x.label,public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_'||x.label),
 jsonb_build_array(pg_temp.occ(d0,'America/New_York','10:00',120),pg_temp.occ(d1,'America/New_York','10:00',120)),pg_temp.run('run-'||x.label,d0,d1,pg_temp.rid('fr_'||x.label)))
 FROM cf CROSS JOIN LATERAL (VALUES('fire'),('elope'),('review')) x(label);
SELECT pg_temp.c_assert((SELECT (result->'counts'->>'created')::int=4 FROM cf_results WHERE label='g_gen') AND (SELECT bool_and((result->'counts'->>'created')::int=2) FROM cf_results WHERE label IN('g_co','g_ext','g_fire','g_elope','g_review')),'occurrences not generated');
INSERT INTO cf_ids SELECT 'occ_gen1_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_gen1 AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_gen2_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_gen2 AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_co1_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.subject_id=cf.subj_co1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_ext1_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.subject_id=cf.subj_ext1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_fire_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_fire AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_elope_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_elope AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_review_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_review_fire AND t.assigned_shift_date=cf.d0;
SELECT pg_temp.c_assert((SELECT count(*)=9 FROM cf_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;
-- The previous period's fire drill occurrence (period d0-7 .. d0-1, assigned yesterday, when the versions are already in force) is minted as an event occurrence, as the 346 probe does for an older period.
SELECT pg_temp.c_clear();
DO $$ DECLARE f cf; src public.operation_task_instances; BEGIN
 SELECT * INTO f FROM cf;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 SELECT t.* INTO src FROM public.operation_task_instances t WHERE t.id=(SELECT id FROM cf_ids WHERE label='occ_fire_d0');
 INSERT INTO public.operation_task_instances SELECT (jsonb_populate_record(src,jsonb_build_object('id',gen_random_uuid(),'occurrence_kind','event','source_event_key','probe-event','source_event_id','F-old',
  'source_event_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York','governing_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York',
  'due_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York','grace_ends_at',NULL,'status','pending','execution_state','none','effective_receipt_id',NULL,'verification_receipt_id',NULL,
  'performed_at',NULL,'completed_at',NULL,'signed_by',NULL,'signed_at',NULL,'second_sign_by',NULL,'second_signed_at',NULL,'verified_by',NULL,'verified_at',NULL,'sla_met',NULL,'completion_notes',NULL,'created_by',NULL,'updated_by',NULL,'started_at',NULL,
  'assigned_shift_date',f.d0-1,'period_key','probe-event:F-old','period_start_date',f.d0-7,'period_end_date',f.d0-1,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
INSERT INTO cf_ids SELECT 'occ_fire_old',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_fire AND t.period_key='probe-event:F-old';
-- FIXTURES-END

-- 1. A staff-observed generator test satisfies exactly its generator's occurrence once: recorder is the source author, observer is the performer, typed readings are the values, occurrence completed.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'obs_gen1',pg_temp.obs('gen1-000001',gen1,'generator_test',recent,'pass','{"started_ok":true,"run_minutes":30}') FROM cf;
INSERT INTO cf_ids SELECT 'o_gen1',(result->'record'->>'id')::uuid FROM cf_results WHERE label='obs_gen1';
INSERT INTO cf_ids SELECT 'ev_gen1',(result->'delivery'->'event'->>'id')::uuid FROM cf_results WHERE label='obs_gen1';
INSERT INTO cf_ids SELECT 'r_gen1',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='obs_gen1';
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['delivery','linked','record','replayed'] FROM jsonb_object_keys(pg_temp.res('obs_gen1')) k),'record reply keys drifted');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->>'replayed')::boolean=false AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'attention')::boolean=false
 AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_gen1_d0') AND (result->'delivery'->'event'->>'subject_id')::uuid=(SELECT subj_gen1 FROM cf) AND result->'delivery'->'event'->>'source_key'='asset-observation'
 AND result->'delivery'->'event'->>'source_record_id'=pg_temp.rid('o_gen1')::text AND result->'delivery'->'event'->>'source_record_version'='1' AND (result->'delivery'->>'replayed')::boolean=false
 AND result->'delivery'->'occurrence'->>'status'='completed' AND result->'delivery'->'occurrence'->>'execution_state'='completed'
 AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM cf) AND result->'delivery'->'receipt'->>'performer_kind'='self' AND result->'delivery'->'receipt'->>'entry_kind'='routine'
 AND result->'delivery'->'receipt'->'values'='{"started_ok":true,"run_minutes":30}'::jsonb AND result->'delivery'->'receipt'->>'completion_state'='completed' AND (result->'delivery'->'receipt'->>'performed_at')::timestamptz=(SELECT recent FROM cf)
 AND result->'record'->>'basis'='staff_observed' AND (result->'record'->>'record_version')::int=1 AND result->'record'->>'finalized_at' IS NOT NULL AND (result->'record'->>'observed_by')::uuid=(SELECT maint FROM cf)
 FROM cf_results WHERE label='obs_gen1'),'a staff-observed generator test did not satisfy its occurrence');
SELECT pg_temp.c_assert((SELECT status='completed' AND effective_receipt_id=pg_temp.rid('r_gen1') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_gen1_d0'))
 AND (SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_gen2_d0')),'the other generator was touched');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(action='record' AND actor_id=(SELECT maint FROM cf) AND source_event_id=pg_temp.rid('ev_gen1') AND source_record_id=pg_temp.rid('o_gen1')::text AND request_key=pg_temp.k('gen1-000001')) FROM public.operation_source_record_requests),'request row not written');
-- 1a. Replay by key returns the same reply; the same key with other content conflicts; a second record for the same generator and week is a visible conflict, never a second satisfaction.
INSERT INTO cf_results SELECT 'obs_gen1_replay',pg_temp.obs('gen1-000001',gen1,'generator_test',recent,'pass','{"started_ok":true,"run_minutes":30}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'record'->>'id')::uuid=pg_temp.rid('o_gen1') AND (result->'delivery'->'event'->>'id')::uuid=pg_temp.rid('ev_gen1') FROM cf_results WHERE label='obs_gen1_replay'),'replay did not return the stored reply');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('gen1-000001',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{"started_ok":true,"run_minutes":31}')$q$,'already saved with different content');
INSERT INTO cf_results SELECT 'obs_gen1_dup',pg_temp.obs('gen1-000002',gen1,'generator_test',recent,'pass','{"started_ok":true}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'reason'='already_recorded' AND (result->'delivery'->'event'->>'attention')::boolean
 AND result->'delivery'->'event'->>'detail' LIKE '%another source%' AND jsonb_typeof(result->'delivery'->'receipt')='null' AND (result->'record'->>'id')::uuid<>pg_temp.rid('o_gen1') FROM cf_results WHERE label='obs_gen1_dup'),'a duplicate record satisfied again or was hidden');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_gen1_d0')) AND (SELECT count(*)=2 FROM public.asset_observations),'duplicate handling drifted');
RESET ROLE;

-- 2. A failed observation of the other generator by the administrator on behalf of maintenance opens an issue and leaves the occurrence failed; the void returns the occurrence to pending, keeps the issue open and leaves an attention row.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('gen2-000001',(SELECT gen2 FROM cf),'generator_test',(SELECT recent FROM cf),'fail','{"started_ok":false}',jsonb_build_object('observed_by',(SELECT maint FROM cf),'issue_summary','Generator west failed to transfer'))$q$,'entered on behalf');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('gen2-000001',(SELECT gen2 FROM cf),'generator_test',(SELECT recent FROM cf),'fail','{"started_ok":false}',jsonb_build_object('observed_by',(SELECT maint FROM cf),'entry_reason','Maintenance observed; admin logged'))$q$,'requires an issue summary');
INSERT INTO cf_results SELECT 'obs_gen2',pg_temp.obs('gen2-000001',gen2,'generator_test',recent,'fail','{"started_ok":false}',jsonb_build_object('observed_by',maint,'entry_reason','Maintenance observed; admin logged','issue_summary','Generator west failed to transfer')) FROM cf;
INSERT INTO cf_ids SELECT 'o_gen2',(result->'record'->>'id')::uuid FROM cf_results WHERE label='obs_gen2';
INSERT INTO cf_ids SELECT 'r_gen2',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='obs_gen2';
INSERT INTO cf_ids SELECT 'i_gen2',(result->'delivery'->'receipt'->>'issue_id')::uuid FROM cf_results WHERE label='obs_gen2';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND result->'delivery'->'receipt'->>'outcome'='failed' AND result->'delivery'->'receipt'->>'completion_state'='failed'
 AND result->'delivery'->'receipt'->>'performer_kind'='other_staff' AND (result->'delivery'->'receipt'->>'performer_user_id')::uuid=(SELECT maint FROM cf) AND result->'delivery'->'receipt'->>'entry_kind'='on_behalf'
 AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT admin_a FROM cf) AND result->'delivery'->'occurrence'->>'status'='in_progress' AND result->'delivery'->'occurrence'->>'execution_state'='failed'
 AND result->'delivery'->'receipt'->>'issue_id' IS NOT NULL FROM cf_results WHERE label='obs_gen2'),'a failed observation did not open an issue and leave the occurrence failed');
SELECT pg_temp.c_assert((SELECT status='open' AND issue_kind='failed_result' AND summary='Generator west failed to transfer' AND receipt_id=pg_temp.rid('r_gen2') AND task_instance_id=pg_temp.rid('occ_gen2_d0') FROM public.operation_issues WHERE id=pg_temp.rid('i_gen2')),'issue not bound to the source receipt');
SELECT pg_temp.c_expect($q$SELECT public.void_asset_observation_review(pg_temp.rid('o_gen2'),pg_temp.k('gen2-void-001'),'{}')$q$,'void reason is required');
INSERT INTO cf_results SELECT 'void_gen2',public.void_asset_observation_review(pg_temp.rid('o_gen2'),pg_temp.k('gen2-void-001'),'{"reason":"Logged against the wrong week"}');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='invalidated' AND (result->'delivery'->'event'->>'attention')::boolean AND result->'delivery'->'event'->>'event_kind'='voided'
 AND result->'delivery'->'receipt'->>'receipt_kind'='reversal' AND (result->'delivery'->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_gen2') AND result->'delivery'->'occurrence'->>'execution_state'='none'
 AND result->'delivery'->'occurrence'->>'status' IN('pending','missed') AND result->'record'->>'voided_at' IS NOT NULL AND result->'record'->>'void_reason'='Logged against the wrong week' AND (result->'record'->>'record_version')::int=1
 FROM cf_results WHERE label='void_gen2'),'a void did not reverse the source receipt');
SELECT pg_temp.c_assert((SELECT status='open' AND receipt_id=pg_temp.rid('r_gen2') FROM public.operation_issues WHERE id=pg_temp.rid('i_gen2')),'a void closed or unbound the issue');
SELECT pg_temp.c_assert((SELECT effective_receipt_id IS NULL AND performed_at IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_gen2_d0')) AND (SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_gen2_d0')),'void left a false completion or lost history');
INSERT INTO cf_results SELECT 'void_gen2_replay',public.void_asset_observation_review(pg_temp.rid('o_gen2'),pg_temp.k('gen2-void-001'),'{"reason":"Logged against the wrong week"}');
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND result->'delivery'->'event'->>'state'='invalidated' FROM cf_results WHERE label='void_gen2_replay'),'void replay drifted');
SELECT pg_temp.c_expect($q$SELECT public.void_asset_observation_review(pg_temp.rid('o_gen2'),pg_temp.k('gen2-void-002'),'{"reason":"Again"}')$q$,'already voided',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_asset_observation_review(pg_temp.rid('o_gen2'),pg_temp.k('gen2-cor-0001'),1,'{"reason":"Late fix","outcome":"pass"}')$q$,'Observation is voided',NULL,'P0001');
RESET ROLE;

-- 3. Corrections: readings supersede as a 344 chain; a stale expected version conflicts naming the current one; a no-op is refused; moving the record to the other generator invalidates the first occurrence and satisfies the second as a fresh chain.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0000'),1,'{"readings":{"started_ok":true,"run_minutes":30}}')$q$,'correction reason is required');
SELECT pg_temp.c_expect($q$SELECT public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0000'),1,'{"reason":"Nothing","readings":{"started_ok":true,"run_minutes":30}}')$q$,'must restate at least one field');
INSERT INTO cf_results SELECT 'cor_gen1',public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0001'),1,'{"reason":"Run time misread","readings":{"started_ok":true,"run_minutes":32}}');
INSERT INTO cf_ids SELECT 'r_gen1_v2',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_gen1';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='corrected' AND result->'delivery'->'event'->>'source_record_version'='2' AND (result->'delivery'->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_gen1')
 AND (result->'delivery'->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_gen1') AND (result->'delivery'->'receipt'->>'correction_seq')::int=1 AND result->'delivery'->'receipt'->'values'='{"started_ok":true,"run_minutes":32}'::jsonb
 AND result->'delivery'->'receipt'->>'entry_kind'='routine' AND (result->'record'->>'record_version')::int=2 AND result->'record'->>'correction_reason'='Run time misread' AND result->'delivery'->'occurrence'->>'status'='completed'
 FROM cf_results WHERE label='cor_gen1'),'a corrected observation did not supersede as a chain');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('r_gen1_v2') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_gen1')),'the corrected receipt was not superseded');
SELECT pg_temp.c_expect($q$SELECT public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0002'),1,'{"reason":"Stale","readings":{"started_ok":true,"run_minutes":33}}')$q$,'Record changed since it was read','current_record_version=2','P0001');
INSERT INTO cf_results SELECT 'cor_gen1_replay',public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0001'),1,'{"reason":"Run time misread","readings":{"started_ok":true,"run_minutes":32}}');
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'record'->>'record_version')::int=2 FROM cf_results WHERE label='cor_gen1_replay'),'correction replay drifted');
-- Moving the record to the other generator: gen2's occurrence is pending again after the void, so the record satisfies it and gen1's occurrence returns to pending.
INSERT INTO cf_results SELECT 'cor_gen1_move',public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('gen1-cor-0003'),2,jsonb_build_object('reason','Wrong generator selected','asset_id',(SELECT gen2 FROM cf)));
INSERT INTO cf_ids SELECT 'r_gen1_v3',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_gen1_move';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_gen2_d0') AND (result->'delivery'->'event'->>'subject_id')::uuid=(SELECT subj_gen2 FROM cf)
 AND (result->'delivery'->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_gen1_v3') AND result->'delivery'->'receipt'->>'source_record_version'='3' AND (result->'record'->>'asset_id')::uuid=(SELECT gen2 FROM cf) FROM cf_results WHERE label='cor_gen1_move'),'a moved record did not satisfy the other generator as a fresh chain');
SELECT pg_temp.c_assert((SELECT status IN('pending','missed') AND execution_state='none' AND effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_gen1_d0'))
 AND (SELECT superseded_by_receipt_id IS NOT NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_gen1_v2'))
 AND (SELECT correction_reason LIKE '%version 2 superseded by version 3 covering another occurrence' FROM public.operation_execution_receipts WHERE receipt_kind='reversal' AND corrects_receipt_id=pg_temp.rid('r_gen1_v2')),'the first generator kept the moved receipt');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(task_instance_id=pg_temp.rid('occ_gen2_d0')) FROM public.operation_execution_receipts WHERE source_record_id=pg_temp.rid('o_gen1')::text AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'one record holds two effective receipts');
RESET ROLE;

-- 4. Refusals by name write nothing: self-test, photo only, future, unstated late, failed without issue, wrong asset type, retired asset, another site's asset, stranger observer, malformed readings, unknown field.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE cf_before AS SELECT (SELECT count(*) FROM public.asset_observations) obs,(SELECT count(*) FROM public.operation_source_record_requests) req,(SELECT count(*) FROM public.operation_source_events) ev;
SELECT pg_temp.c_expect($q$SELECT public.record_asset_observation_review(pg_temp.k('ref-000001'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT gen1 FROM cf),'observation_kind','generator_test','observed_at',(SELECT recent FROM cf),'basis','automatic_self_test','outcome','pass'))$q$,'An automatic self-test is not a staff observation');
SELECT pg_temp.c_expect($q$SELECT public.record_asset_observation_review(pg_temp.k('ref-000002'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT gen1 FROM cf),'observation_kind','generator_test','observed_at',(SELECT recent FROM cf),'basis','photo_only','outcome','pass'))$q$,'A photo alone is not a staff observation');
SELECT pg_temp.c_expect($q$SELECT public.record_asset_observation_review(pg_temp.k('ref-000003'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT gen1 FROM cf),'observation_kind','generator_test','observed_at',(SELECT recent FROM cf),'outcome','pass'))$q$,'basis must be staff_observed');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000004',(SELECT gen1 FROM cf),'generator_test',clock_timestamp()+interval '1 day','pass')$q$,'Performed time cannot be in the future');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000005',(SELECT gen1 FROM cf),'generator_test',(SELECT past_due FROM cf),'pass')$q$,'must be entered as late with a reason');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000006',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'fail')$q$,'A failed outcome requires an issue summary');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000007',(SELECT co1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass')$q$,'A generator test is recorded against a generator');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000008',(SELECT gen1 FROM cf),'extinguisher_check',(SELECT recent FROM cf),'pass')$q$,'An extinguisher check is recorded against a fire extinguisher');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000009',(SELECT gen_ret FROM cf),'generator_test',(SELECT recent FROM cf),'pass')$q$,'Asset is not current at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000010',(SELECT gen_b FROM cf),'generator_test',(SELECT recent FROM cf),'pass')$q$,'Asset is not current at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000011',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{}',jsonb_build_object('observed_by',gen_random_uuid(),'entry_reason','x'))$q$,'Performer is not current staff at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000012',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{"Bad Key":1}')$q$,'readings must be keyed by input names');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000013',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{"nested":{"a":1}}')$q$,'readings must be scalar values');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000014',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{}','{"surprise":true}')$q$,'not editable');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('ref-000015',(SELECT gen1 FROM cf),'sniff_test',(SELECT recent FROM cf),'pass')$q$,'observation_kind must be');
SELECT pg_temp.c_expect($q$SELECT public.record_asset_observation_review('short',jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT gen1 FROM cf),'observation_kind','generator_test','observed_at',(SELECT recent FROM cf),'basis','staff_observed','outcome','pass'))$q$,'request key is required');
SELECT pg_temp.c_assert((SELECT obs=(SELECT count(*) FROM public.asset_observations) AND req=(SELECT count(*) FROM public.operation_source_record_requests) AND ev=(SELECT count(*) FROM public.operation_source_events) FROM cf_before),'a refused record wrote something');
-- A late observation with its reason is recorded as a late entry; an undefined reading is refused by the rule at delivery (recorded refusal, the record stays final and visible).
INSERT INTO cf_results SELECT 'obs_co1',pg_temp.obs('co1-000001',co1,'carbon_monoxide_check',past_due,'pass','{"co_ppm":0}','{"entry_reason":"Read at the walk-through, logged after the shift"}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'receipt'->>'entry_kind'='late' AND result->'delivery'->'receipt'->>'entry_reason'='Read at the walk-through, logged after the shift' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_co1_d0') FROM cf_results WHERE label='obs_co1'),'a late CO check was not recorded as late');
INSERT INTO cf_results SELECT 'obs_ext1',pg_temp.obs('ext1-000001',ext1,'extinguisher_check',recent,'pass','{"tag_current":true,"pressure":"green"}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='refused' AND result->'delivery'->'event'->>'reason'='statement_invalid' AND result->'delivery'->'event'->>'detail' LIKE '%pressure is not a defined input%'
 AND result->'record'->>'finalized_at' IS NOT NULL FROM cf_results WHERE label='obs_ext1'),'an undefined reading satisfied or hid the record');
SELECT pg_temp.c_assert((SELECT status='pending' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext1_d0')),'a refused reading touched the occurrence');
RESET ROLE;
-- 4a. The aide (outside the generator recorder list) records a generator test: the record is final, the delivery is refused with attention, nothing is hidden or satisfied.
SELECT pg_temp.c_login('aide');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'obs_aide',pg_temp.obs('aide-000001',gen1,'generator_test',recent,'pass','{"started_ok":true}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='refused' AND result->'delivery'->'event'->>'reason'='recorder_not_authorized' AND (result->'delivery'->'event'->>'attention')::boolean
 AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_gen1_d0') AND result->'record'->>'finalized_at' IS NOT NULL FROM cf_results WHERE label='obs_aide'),'an unauthorised recorder satisfied or was hidden');
SELECT pg_temp.c_assert((SELECT status IN('pending','missed') AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_gen1_d0')),'an unauthorised recorder touched the occurrence');
-- The aide is on the CO recorder list and records the same CO detector for the week: a conflict with the maintenance record, visible.
INSERT INTO cf_results SELECT 'obs_co1_aide',pg_temp.obs('aide-000002',co1,'carbon_monoxide_check',recent,'pass','{"co_ppm":1}') FROM cf;
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'detail' LIKE '%another source%' FROM cf_results WHERE label='obs_co1_aide'),'a second CO record was not a conflict');
RESET ROLE;

-- 5. Drill logs: a legacy draft cannot satisfy anything; finalizing it satisfies the fire-drill occurrence as awaiting verification while the separate review occurrence stays pending.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_ids SELECT 'dl_fire',pg_temp.drill('fire',d0,hh0,'{"notes":"Morning drill, east wing"}') FROM cf;
SELECT pg_temp.c_assert((SELECT record_version=1 AND finalized_at IS NULL AND voided_at IS NULL AND outcome='performed' AND readings='{}'::jsonb FROM public.drill_log WHERE id=pg_temp.rid('dl_fire')),'legacy insert is not a draft');
UPDATE public.drill_log SET notes='Morning drill, east wing, all clear' WHERE id=pg_temp.rid('dl_fire');
SELECT pg_temp.c_assert((SELECT record_version=2 AND finalized_at IS NULL FROM public.drill_log WHERE id=pg_temp.rid('dl_fire')),'a draft edit did not bump the version');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET finalized_at=now(),finalized_by=auth.uid(),version_recorded_at=now(),version_recorded_by=auth.uid() WHERE id=pg_temp.rid('dl_fire')$q$,'finality changes only through',NULL,'42501');
INSERT INTO cf_results SELECT 'del_draft',pg_temp.deliver('dl-draft-0001','drill-log',pg_temp.rid('dl_fire')::text,'2','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='source_not_final' AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_draft'),'a draft drill log satisfied an occurrence');
SELECT pg_temp.c_expect($q$SELECT public.finalize_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-fin-000001'),'{}')$q$,'must be entered as late with a reason');
SELECT pg_temp.c_expect($q$SELECT public.finalize_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-fin-000001'),'{"entry_reason":"Logged after the drill debrief","extra":1}')$q$,'not editable');
INSERT INTO cf_results SELECT 'fin_fire',public.finalize_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-fin-000001'),'{"entry_reason":"Logged after the drill debrief"}');
INSERT INTO cf_ids SELECT 'r_fire',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='fin_fire';
INSERT INTO cf_ids SELECT 'ev_fire',(result->'delivery'->'event'->>'id')::uuid FROM cf_results WHERE label='fin_fire';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fire_d0') AND result->'delivery'->'event'->>'source_record_version'='2'
 AND result->'delivery'->'receipt'->>'completion_state'='awaiting_verification' AND result->'delivery'->'receipt'->>'entry_kind'='late' AND result->'delivery'->'receipt'->>'performer_kind'='self' AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT admin_a FROM cf)
 AND (result->'delivery'->'receipt'->>'performed_at')::timestamptz=(SELECT past_due FROM cf) AND result->'delivery'->'receipt'->>'note'='Morning drill, east wing, all clear' AND result->'delivery'->'occurrence'->>'execution_state'='awaiting_verification'
 AND (result->'record'->>'record_version')::int=2 AND result->'record'->>'finalized_at' IS NOT NULL AND (result->'record'->>'finalized_by')::uuid=(SELECT admin_a FROM cf) AND result->'record'->>'entry_reason'='Logged after the drill debrief' FROM cf_results WHERE label='fin_fire'),'finalizing a fire drill did not satisfy as awaiting verification');
SELECT pg_temp.c_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_review_d0')),'the separate review occurrence was touched by the drill log');
SELECT pg_temp.c_assert((SELECT status='pending' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_elope_d0')),'the elopement occurrence was touched by a fire drill');
-- Finalize is not repeatable under a new key; a final row refuses direct content change, soft delete and hard delete; the legacy page can still edit a different draft.
SELECT pg_temp.c_expect($q$SELECT public.finalize_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-fin-000002'),'{}')$q$,'already final',NULL,'P0001');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET notes='edited after the fact' WHERE id=pg_temp.rid('dl_fire')$q$,'change only through a correction');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET deleted_at=now() WHERE id=pg_temp.rid('dl_fire')$q$,'voided with a reason');
SELECT pg_temp.c_expect($q$DELETE FROM public.drill_log WHERE id=pg_temp.rid('dl_fire')$q$,'retained history');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET facility_id=(SELECT site_b FROM cf) WHERE id=pg_temp.rid('dl_fire')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$INSERT INTO public.drill_log(organization_id,facility_id,drill_type,drill_date,drill_time,finalized_at,finalized_by,version_recorded_at,version_recorded_by) SELECT org,site_a,'fire',d0,'23:59',now(),admin_a,now(),admin_a FROM cf$q$,'recorded as a draft');
-- The review (by a different person) completes the occurrence; a correction reopens it; a stale expected version conflicts; a void reverses into retained history.
RESET ROLE;
SELECT pg_temp.c_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'ver_fire',public.verify_operation_work_review(pg_temp.rid('occ_fire_d0'),pg_temp.k('ver-fire-0001'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('r_fire'),'receipt_revision',pg_temp.rev('r_fire')));
SELECT pg_temp.c_assert((SELECT status='completed' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fire_d0')),'review did not complete the drill occurrence');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_fire',public.correct_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-cor-000001'),2,'{"reason":"Resident count corrected","residents_present_count":21}');
INSERT INTO cf_ids SELECT 'r_fire_v3',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_fire';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='corrected' AND (result->'delivery'->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_fire') AND result->'delivery'->'receipt'->>'entry_kind'='late'
 AND result->'delivery'->'receipt'->>'completion_state'='awaiting_verification' AND result->'delivery'->'occurrence'->>'status'='in_progress' AND (result->'record'->>'record_version')::int=3 AND (result->'record'->>'residents_present_count')::int=21
 AND result->'record'->>'correction_reason'='Resident count corrected' FROM cf_results WHERE label='cor_fire'),'a drill correction did not supersede and reopen review');
SELECT pg_temp.c_assert((SELECT verification_receipt_id IS NULL AND effective_receipt_id=pg_temp.rid('r_fire_v3') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fire_d0')),'review was not reopened by the correction');
SELECT pg_temp.c_expect($q$SELECT public.correct_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-cor-000002'),2,'{"reason":"Stale","notes":"x"}')$q$,'Record changed since it was read','current_record_version=3','P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-cor-000003'),3,'{"reason":"Future","drill_time":"23:59"}')$q$,'Corrected performed time cannot be after the original recording');
SELECT pg_temp.c_expect($q$SELECT public.correct_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-cor-000004'),3,'{"reason":"Bad","drill_date":"not-a-date"}')$q$,'invalid drill value');
INSERT INTO cf_results SELECT 'void_fire',public.void_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-void-00001'),'{"reason":"Drill was a false alarm response, not a drill"}');
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='invalidated' AND (result->'delivery'->'event'->>'attention')::boolean AND result->'delivery'->'receipt'->>'receipt_kind'='reversal' AND result->'delivery'->'occurrence'->>'status' IN('pending','missed')
 AND result->'record'->>'voided_at' IS NOT NULL FROM cf_results WHERE label='void_fire'),'a drill void did not reverse');
SELECT pg_temp.c_assert((SELECT count(*)=4 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_fire_d0')) AND (SELECT effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fire_d0')),'void lost drill history or left a completion');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET notes='after void' WHERE id=pg_temp.rid('dl_fire')$q$,'Voided drill logs are immutable');
SELECT pg_temp.c_expect($q$SELECT public.correct_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-cor-000005'),3,'{"reason":"After void","notes":"x"}')$q$,'Drill log is voided',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.void_drill_log_review(pg_temp.rid('dl_fire'),pg_temp.k('dl-void-00002'),'{"reason":"Again"}')$q$,'already voided',NULL,'P0001');
RESET ROLE;
-- 5a. An elopement drill by maintenance satisfies only its activity; a tornado drill is finalized without a delivery and a direct delivery of it is a recorded reader failure; a previous-period fire drill moves when its date is corrected.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_ids SELECT 'dl_elope',pg_temp.drill('elopement',d0,hh0,'{"notes":"Elopement drill, exit B"}') FROM cf;
INSERT INTO cf_results SELECT 'fin_elope',public.finalize_drill_log_review(pg_temp.rid('dl_elope'),pg_temp.k('dl-fin-elope-1'),'{"entry_reason":"Logged after the drill"}');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_elope_d0') AND result->'delivery'->'receipt'->>'completion_state'='completed' FROM cf_results WHERE label='fin_elope'),'an elopement drill did not satisfy its occurrence');
INSERT INTO cf_ids SELECT 'dl_tornado',pg_temp.drill('tornado',d0,hh0,'{"notes":"Tornado drill"}') FROM cf;
INSERT INTO cf_results SELECT 'fin_tornado',public.finalize_drill_log_review(pg_temp.rid('dl_tornado'),pg_temp.k('dl-fin-torn-01'),'{"entry_reason":"Logged after the drill"}');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND jsonb_typeof(result->'delivery')='null' AND result->>'link_reason'='no_checklist_activity' AND result->'record'->>'finalized_at' IS NOT NULL FROM cf_results WHERE label='fin_tornado'),'a tornado drill was delivered or not finalized');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['delivery','link_reason','linked','record','replayed'] FROM jsonb_object_keys(pg_temp.res('fin_tornado')) k),'tornado reply keys drifted');
INSERT INTO cf_results SELECT 'del_tornado',pg_temp.deliver('dl-torn-0001','drill-log',pg_temp.rid('dl_tornado')::text,'1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='reader_failed' AND (result->'event'->>'attention')::boolean AND result->'event'->>'detail' LIKE '%no checklist activity%' FROM cf_results WHERE label='del_tornado'),'a tornado delivery was not a recorded reader failure');
INSERT INTO cf_ids SELECT 'dl_fire_old',pg_temp.drill('fire',dold,'14:00','{"notes":"Fire drill, previous period"}') FROM cf;
INSERT INTO cf_results SELECT 'fin_fire_old',public.finalize_drill_log_review(pg_temp.rid('dl_fire_old'),pg_temp.k('dl-fin-old-001'),'{"entry_reason":"Paper log transcribed a week later"}');
INSERT INTO cf_ids SELECT 'r_fire_old',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='fin_fire_old';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fire_old') FROM cf_results WHERE label='fin_fire_old'),'the previous-period drill did not match the older occurrence');
INSERT INTO cf_results SELECT 'cor_fire_old',public.correct_drill_log_review(pg_temp.rid('dl_fire_old'),pg_temp.k('dl-cor-old-001'),1,jsonb_build_object('reason','Date was wrong on the paper log','drill_date',(SELECT to_char(d0,'YYYY-MM-DD') FROM cf),'drill_time','00:15'));
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fire_d0') AND (result->'delivery'->'receipt'->>'chain_id')::uuid=(result->'delivery'->'receipt'->>'id')::uuid
 FROM cf_results WHERE label='cor_fire_old'),'a corrected drill date did not move the receipt as a fresh chain');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NOT NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_fire_old')) AND (SELECT execution_state='none' AND effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fire_old')),'the older occurrence kept the moved drill');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE source_record_id=pg_temp.rid('dl_fire_old')::text AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'a drill log holds two effective receipts');
-- A draft cannot be corrected or voided; the finalize of a failed drill needs its issue summary and then opens an issue.
INSERT INTO cf_ids SELECT 'dl_draft2',pg_temp.drill('fire',d0,'00:05','{"notes":"Draft only"}') FROM cf;
SELECT pg_temp.c_expect($q$SELECT public.correct_drill_log_review(pg_temp.rid('dl_draft2'),pg_temp.k('dl-cor-draft-1'),1,'{"reason":"x","notes":"y"}')$q$,'is a draft',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.void_drill_log_review(pg_temp.rid('dl_draft2'),pg_temp.k('dl-void-draft1'),'{"reason":"x"}')$q$,'is a draft',NULL,'P0001');
INSERT INTO cf_ids SELECT 'dl_failed',pg_temp.drill('elopement',d0,'00:10','{"notes":"Elopement drill, slow response","outcome":"failed"}') FROM cf;
SELECT pg_temp.c_expect($q$SELECT public.finalize_drill_log_review(pg_temp.rid('dl_failed'),pg_temp.k('dl-fin-fail-01'),'{"entry_reason":"Logged after"}')$q$,'A failed outcome requires an issue summary');
UPDATE public.drill_log SET issue_summary='Exit B alarm did not sound' WHERE id=pg_temp.rid('dl_failed');
INSERT INTO cf_results SELECT 'fin_failed',public.finalize_drill_log_review(pg_temp.rid('dl_failed'),pg_temp.k('dl-fin-fail-01'),'{"entry_reason":"Logged after"}');
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'reason'='already_recorded' FROM cf_results WHERE label='fin_failed'),'a second elopement drill in the week was not a visible conflict');
RESET ROLE;

-- 6. Authority: the other site's administrator cannot finalize, correct, void or read site A's records; the request ledger and observations are site-scoped.
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.finalize_drill_log_review(pg_temp.rid('dl_draft2'),pg_temp.k('b-fin-000001'),'{}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.correct_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('b-cor-000001'),3,'{"reason":"x","note":"y"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.void_asset_observation_review(pg_temp.rid('o_gen1'),pg_temp.k('b-void-00001'),'{"reason":"x"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.record_asset_observation_review(pg_temp.k('b-rec-000001'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT gen1 FROM cf),'observation_kind','generator_test','observed_at',(SELECT recent FROM cf),'basis','staff_observed','outcome','pass'))$q$);
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.asset_observations) AND (SELECT count(*)=0 FROM public.operation_source_record_requests) AND (SELECT count(*)=0 FROM public.drill_log WHERE facility_id=(SELECT site_a FROM cf)),'the other site reads site A records');
-- Site B records its own generator; the site-A administrator sees none of it.
INSERT INTO cf_results SELECT 'obs_gen_b',public.record_asset_observation_review(pg_temp.k('b-rec-000002'),jsonb_build_object('facility_id',site_b,'asset_id',gen_b,'observation_kind','generator_test','observed_at',recent,'basis','staff_observed','outcome','pass')) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='unmatched' AND result->'delivery'->'event'->>'reason'='subject_not_enrolled' AND (result->>'linked')::boolean=false FROM cf_results WHERE label='obs_gen_b'),'site B record did not land as unmatched');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.asset_observations WHERE facility_id=(SELECT site_b FROM cf)) AND (SELECT count(*)>=6 FROM public.asset_observations) AND (SELECT count(*)>=10 FROM public.operation_source_record_requests),'site A cannot read its own records or reads site B');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_source_record_requests'),'generic audit payloads of the request ledger leaked');
RESET ROLE;

-- 7. Guards: no direct DML on observations or requests, no lifecycle writes on drill logs, with and without the forged setting; the owner-run definer with the real token cannot rewrite a voided or identity column.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$INSERT INTO public.asset_observations(organization_id,facility_id,asset_id,observation_kind,basis,observed_at,observed_by,outcome,finalized_at,finalized_by,version_recorded_at,version_recorded_by) SELECT org,site_a,gen1,'generator_test','staff_observed',now(),admin_a,'pass',now(),admin_a,now(),admin_a FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.asset_observations SET outcome='pass' WHERE id=pg_temp.rid('o_gen2')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.asset_observations WHERE id=pg_temp.rid('o_gen2')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.asset_observations$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_record_requests(organization_id,facility_id,request_key,request_hash,actor_id,actor_role,at,source_key,source_record_id,action,reply) SELECT org,site_a,'forged-0000001','x',admin_a,'facility_admin',now(),'drill-log','x','void','{}' FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_record_requests SET reply='{}' WHERE request_key=pg_temp.k('gen1-000001')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.operation_source_record_requests$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_source_record_approved()$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_source_read_drill_log('x')$q$);
SELECT set_config('haven.operation_source_record_command','approved',true);
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET voided_at=now(),voided_by=auth.uid(),void_reason='forged' WHERE id=pg_temp.rid('dl_elope')$q$,'finality changes only through',NULL,'42501');
SELECT pg_temp.c_denied($q$UPDATE public.asset_observations SET outcome='pass' WHERE id=pg_temp.rid('o_gen2')$q$);
SELECT set_config('haven.operation_source_record_command','',true);
RESET ROLE;
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.c_denied($q$UPDATE public.asset_observations SET outcome='pass' WHERE id=pg_temp.rid('o_gen2')$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_record_requests(organization_id,facility_id,request_key,request_hash,actor_id,actor_role,at,source_key,source_record_id,action,reply) SELECT org,site_a,'forged-0000003','x',admin_a,'facility_admin',now(),'drill-log','x','void','{}' FROM cf$q$);
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET finalized_at=NULL,finalized_by=NULL,version_recorded_at=NULL,version_recorded_by=NULL WHERE id=pg_temp.rid('dl_elope')$q$,'finality changes only through',NULL,'42501');
RESET ROLE;
SELECT pg_temp.c_clear();
DO $$ BEGIN PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.c_expect($q$UPDATE public.asset_observations SET outcome='pass' WHERE id=pg_temp.rid('o_gen2')$q$,'Voided observations are immutable');
SELECT pg_temp.c_expect($q$UPDATE public.asset_observations SET facility_id=(SELECT site_b FROM cf) WHERE id=pg_temp.rid('o_gen1')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.asset_observations SET deleted_at=now() WHERE id=pg_temp.rid('o_gen1')$q$,'voided, not deleted');
SELECT pg_temp.c_expect($q$UPDATE public.asset_observations SET note='silent restatement' WHERE id=pg_temp.rid('o_gen1')$q$,'records who restated');
SELECT pg_temp.c_expect($q$DELETE FROM public.asset_observations WHERE id=pg_temp.rid('o_gen1')$q$,'retained history');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET finalized_at=now()+interval '1 hour' WHERE id=pg_temp.rid('dl_elope')$q$,'recorded once');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET deleted_at=now() WHERE id=pg_temp.rid('dl_elope')$q$,'never delete');
SELECT pg_temp.c_expect($q$UPDATE public.drill_log SET notes='silent restatement' WHERE id=pg_temp.rid('dl_elope')$q$,'records who restated');
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_record_requests SET reply='{}' WHERE request_key=pg_temp.k('gen1-000001')$q$,'immutable');
SELECT set_config('haven.operation_source_record_command','',true);
SELECT pg_temp.c_service();
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'drill-log-2','facility','operation_source_read_drill_log' FROM cf$q$,'registered by migration only');
SELECT pg_temp.c_clear();

-- 8. A forced audit failure inside a command leaves no observation, request, delivery or receipt behind.
CREATE FUNCTION haven.col154_probe_audit_bomb() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='asset_observations' THEN RAISE EXCEPTION 'COL-154 forced audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER col154_probe_audit_bomb BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION haven.col154_probe_audit_bomb();
CREATE TEMP TABLE cf_bomb AS SELECT (SELECT count(*) FROM public.asset_observations) obs,(SELECT count(*) FROM public.operation_source_record_requests) req,(SELECT count(*) FROM public.operation_source_events) ev,(SELECT count(*) FROM public.operation_execution_receipts) rec;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('bomb-000001',(SELECT gen1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass','{"started_ok":true}')$q$,'forced audit failure');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT obs=(SELECT count(*) FROM public.asset_observations) AND req=(SELECT count(*) FROM public.operation_source_record_requests) AND ev=(SELECT count(*) FROM public.operation_source_events) AND rec=(SELECT count(*) FROM public.operation_execution_receipts) FROM cf_bomb),'a failed audit insert left a row behind');
DROP TRIGGER col154_probe_audit_bomb ON public.audit_log;
DROP FUNCTION haven.col154_probe_audit_bomb();

-- 9. Invariants: every observation is final and staff-observed; every request names its delivery when one happened; source receipts keep the four columns together; public RPCs are invokers; the 346 ledger is consistent.
SELECT pg_temp.c_assert((SELECT bool_and(finalized_at IS NOT NULL AND basis='staff_observed' AND record_version>=1) FROM public.asset_observations),'an observation is not final or not staff-observed');
SELECT pg_temp.c_assert((SELECT bool_and((reply->'delivery' IS NULL OR jsonb_typeof(reply->'delivery')='null')=(source_event_id IS NULL)) FROM public.operation_source_record_requests),'request rows lost their delivery');
SELECT pg_temp.c_assert((SELECT bool_and(num_nonnulls(source_event_id,source_key,source_record_id,source_record_version) IN(0,4)) FROM public.operation_execution_receipts),'receipt source columns not set together');
SELECT pg_temp.c_assert((SELECT count(*)=count(DISTINCT (organization_id,source_key,source_record_id)) FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'a record has more than one effective receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('record_asset_observation_review','correct_asset_observation_review','void_asset_observation_review','finalize_drill_log_review','correct_drill_log_review','void_drill_log_review') AND p.prosecdef),'public source record RPC is definer');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_kind='record_review'),'a record review activity became allowlisted');
SELECT 'COL-154 drill and generator source behavior PASS' result;
ROLLBACK;
