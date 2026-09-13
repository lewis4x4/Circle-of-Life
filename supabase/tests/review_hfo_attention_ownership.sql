-- COL-150 synthetic authenticated read-only ownership probe.
-- Fixture setup follows the existing reminder probe; all state rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.i_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-150 fixture %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.i_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-150 fixture expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.i_expect(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-150 fixture expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations assigned, resolved or linked an issue, recorded work, bound a subject or confirmed a schedule.
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issue_events),'a migration created an issue event');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issues),'a migration created an issue');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts),'a migration created a receipt');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_activity_bindings),'a migration created a binding');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_status='confirmed' OR schedule_rule IS NOT NULL),'a migration stored or confirmed a schedule');

-- FIXTURES-BEGIN
CREATE TEMP TABLE ifx AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,gen_random_uuid() aide2,gen_random_uuid() aide2_session,gen_random_uuid() former,gen_random_uuid() former_session,
 gen_random_uuid() mgr,gen_random_uuid() mgr_session,gen_random_uuid() mgr2,gen_random_uuid() mgr2_session,gen_random_uuid() fam,gen_random_uuid() fam_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_res,gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() res1,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE ifx ADD COLUMN d2 date,ADD COLUMN d3 date;
UPDATE ifx SET d2=d1+7,d3=d1+14;
CREATE TEMP TABLE ifx_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE ifx_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE ifx_snap(label text PRIMARY KEY,row_json jsonb);
CREATE TEMP TABLE ifx_payload(label text PRIMARY KEY,payload jsonb);
GRANT SELECT ON ifx TO authenticated,service_role; GRANT ALL ON ifx_ids,ifx_results,ifx_snap,ifx_payload TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Issue Site B','Test','Test','00000',1 FROM ifx;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM ifx
 UNION ALL SELECT admin_a,admin_a||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM ifx
 UNION ALL SELECT admin_b,admin_b||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM ifx
 UNION ALL SELECT maint,maint||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM ifx
 UNION ALL SELECT nurse,nurse||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM ifx
 UNION ALL SELECT aide,aide||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM ifx
 UNION ALL SELECT aide2,aide2||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Second aide"}'::jsonb FROM ifx
 UNION ALL SELECT former,former||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Former aide"}'::jsonb FROM ifx
 UNION ALL SELECT mgr,mgr||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Manager"}'::jsonb FROM ifx
 UNION ALL SELECT mgr2,mgr2||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Second manager"}'::jsonb FROM ifx
 UNION ALL SELECT fam,fam||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','family'),'{"full_name":"Family member"}'::jsonb FROM ifx;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@issue.invalid','Corporate','owner'::public.app_role,org,true FROM ifx
 UNION ALL SELECT admin_a,admin_a||'@issue.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM ifx
 UNION ALL SELECT admin_b,admin_b||'@issue.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM ifx
 UNION ALL SELECT maint,maint||'@issue.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM ifx
 UNION ALL SELECT nurse,nurse||'@issue.invalid','Nurse','nurse'::public.app_role,org,true FROM ifx
 UNION ALL SELECT aide,aide||'@issue.invalid','Aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT aide2,aide2||'@issue.invalid','Second aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT former,former||'@issue.invalid','Former aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT mgr,mgr||'@issue.invalid','Manager','manager'::public.app_role,org,true FROM ifx
 UNION ALL SELECT mgr2,mgr2||'@issue.invalid','Second manager','manager'::public.app_role,org,true FROM ifx
 UNION ALL SELECT fam,fam||'@issue.invalid','Family member','family'::public.app_role,org,true FROM ifx
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM ifx UNION ALL SELECT admin_a_session,admin_a FROM ifx UNION ALL SELECT admin_b_session,admin_b FROM ifx
 UNION ALL SELECT maint_session,maint FROM ifx UNION ALL SELECT nurse_session,nurse FROM ifx UNION ALL SELECT aide_session,aide FROM ifx UNION ALL SELECT aide2_session,aide2 FROM ifx
 UNION ALL SELECT former_session,former FROM ifx UNION ALL SELECT mgr_session,mgr FROM ifx UNION ALL SELECT mgr2_session,mgr2 FROM ifx UNION ALL SELECT fam_session,fam FROM ifx;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at)
 SELECT owner_actor,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT admin_a,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT admin_b,site_b,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT maint,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT nurse,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT aide,site_a,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT aide2,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT mgr,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT mgr2,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT fam,site_a,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT former,site_a,org,clock_timestamp()-interval '1 day' FROM ifx;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM ifx
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM ifx
 UNION ALL SELECT org,site_a,mgr,'resident',owner_actor,'Fixture manager resident reader',false FROM ifx;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-144-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM ifx
 UNION ALL SELECT act_res,org,NULL,'hfo-144-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM ifx;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM ifx UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM ifx;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM ifx;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM ifx UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM ifx;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM ifx;
CREATE FUNCTION pg_temp.i_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f ifx; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM ifx;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSIF p_kind='aide2' THEN u:=f.aide2; sess:=f.aide2_session; r:='housekeeper';
 ELSIF p_kind='mgr' THEN u:=f.mgr; sess:=f.mgr_session; r:='manager';
 ELSIF p_kind='mgr2' THEN u:=f.mgr2; sess:=f.mgr2_session; r:='manager';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.i_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.i_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,hh text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE 'America/New_York'),'grace_ends_at',NULL,'remind_at',NULL,'timezone','America/New_York','adjustments','[]'::jsonb,'shift',NULL)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col144-'||p $$;
-- The revision the current session may read for an issue (NULL when the issue is hidden).
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT issue_revision FROM public.operation_issues WHERE id=(SELECT id FROM ifx_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.iid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ifx_ids WHERE label=p_label $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text),pg_temp.run(text,date,date,uuid),pg_temp.i_login(text),pg_temp.i_service(),pg_temp.i_clear(),pg_temp.k(text),pg_temp.rev(text),pg_temp.iid(text) TO authenticated,service_role;

-- Central versions (owner), site configurations and bindings (site admin), occurrences (service).
SELECT pg_temp.i_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'))) FROM ifx;
INSERT INTO ifx_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'))) FROM ifx;
INSERT INTO ifx_ids SELECT label,(result->>'id')::uuid FROM ifx_results WHERE label LIKE 'v\_%';
INSERT INTO ifx_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,clock_timestamp()) FROM ifx_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.i_assert((SELECT count(*)=2 FROM ifx_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.i_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ifx_ids WHERE label='v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}'::jsonb)) FROM ifx;
INSERT INTO ifx_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ifx_ids WHERE label='v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM ifx;
INSERT INTO ifx_ids SELECT label,(result->>'id')::uuid FROM ifx_results WHERE label LIKE 'fr\_%';
INSERT INTO ifx_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM ifx_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.i_assert((SELECT count(*)=2 FROM ifx_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO ifx_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',clock_timestamp()) FROM ifx;
INSERT INTO ifx_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',clock_timestamp()) FROM ifx;
INSERT INTO ifx_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',clock_timestamp()) FROM ifx;
RESET ROLE;
SELECT pg_temp.i_service();
SET LOCAL ROLE service_role;
INSERT INTO ifx_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ifx_ids WHERE label='fr_asset'),
 jsonb_build_array(pg_temp.occ(d1,'10:00'),pg_temp.occ(d2,'10:00'),pg_temp.occ(d3,'10:00')),pg_temp.run('run-asset',d1,d3,(SELECT id FROM ifx_ids WHERE label='fr_asset'))) FROM ifx;
INSERT INTO ifx_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ifx_ids WHERE label='fr_res'),
 jsonb_build_array(pg_temp.occ(d1,'09:00')),pg_temp.run('run-res',d1,d1,(SELECT id FROM ifx_ids WHERE label='fr_res'))) FROM ifx;
SELECT pg_temp.i_assert((SELECT (result->'counts'->>'created')::int=6 FROM ifx_results WHERE label='g_asset'),'asset occurrences not generated');
SELECT pg_temp.i_assert((SELECT (result->'counts'->>'created')::int=1 FROM ifx_results WHERE label='g_res'),'resident occurrence not generated');
INSERT INTO ifx_ids SELECT 'occ_a1_'||n,t.id FROM ifx CROSS JOIN LATERAL (VALUES('d1',ifx.d1),('d2',ifx.d2),('d3',ifx.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO ifx_ids SELECT 'occ_a2_'||n,t.id FROM ifx CROSS JOIN LATERAL (VALUES('d1',ifx.d1),('d2',ifx.d2),('d3',ifx.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_asset2 AND t.assigned_shift_date=x.d;
INSERT INTO ifx_ids SELECT 'occ_res_d1',t.id FROM ifx JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_res1 AND t.assigned_shift_date=ifx.d1;
SELECT pg_temp.i_assert((SELECT count(*)=7 FROM ifx_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;

-- Set exact synthetic ownership; no hosted or production rows are touched.
SELECT pg_temp.i_clear();
ALTER TABLE public.operation_task_instances DISABLE TRIGGER USER;
UPDATE public.operation_task_instances SET assigned_to=(SELECT maint FROM ifx) WHERE id=pg_temp.iid('occ_a1_d1');
UPDATE public.operation_task_instances SET assigned_to=(SELECT mgr FROM ifx) WHERE id=pg_temp.iid('occ_res_d1');
ALTER TABLE public.operation_task_instances ENABLE TRIGGER USER;
ALTER TABLE public.operation_facility_requirements DISABLE TRIGGER USER;
UPDATE public.operation_facility_requirements SET owner_user_id=(SELECT maint FROM ifx),backup_user_id=(SELECT admin_a FROM ifx) WHERE id=pg_temp.iid('fr_asset');
UPDATE public.operation_facility_requirements SET owner_user_id=(SELECT mgr FROM ifx),backup_user_id=(SELECT nurse FROM ifx) WHERE id=pg_temp.iid('fr_res');
ALTER TABLE public.operation_facility_requirements ENABLE TRIGGER USER;
SELECT pg_temp.i_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert((public.haven_operation_attention_ownership(pg_temp.iid('occ_a1_d1'))->>'coverage_source')='primary','current explicit primary unavailable');
SELECT pg_temp.i_assert((public.haven_operation_attention_ownership(pg_temp.iid('occ_a2_d1'))->>'owner_user_id')::uuid=(SELECT maint FROM ifx),'pinned configuration owner not reused');
SELECT pg_temp.i_assert((public.haven_operation_attention_ownership(pg_temp.iid('occ_res_d1'))->>'coverage_source')='approved_backup','ineligible resident reader did not fall back to approved nurse');
SELECT pg_temp.i_assert((SELECT count(*)=7 FROM public.operation_attention_occurrences WHERE id IN(SELECT id FROM ifx_ids WHERE label LIKE 'occ\_%')),'authorized view lost occurrences');
SELECT pg_temp.i_assert(public.haven_operation_attention_ownership(gen_random_uuid()) IS NULL,'guessed id exposed ownership');
RESET ROLE; SELECT pg_temp.i_login('admin_b'); SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert(public.haven_operation_attention_ownership(pg_temp.iid('occ_a1_d1')) IS NULL,'cross-site ownership exposed');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_attention_occurrences WHERE id=pg_temp.iid('occ_a1_d1')),'cross-site view exposed row');
RESET ROLE; SELECT pg_temp.i_clear();
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT maint FROM ifx) AND facility_id=(SELECT site_a FROM ifx);
SELECT pg_temp.i_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert((public.haven_operation_attention_ownership(pg_temp.iid('occ_a1_d1'))->>'coverage_source')='approved_backup','revoked primary retained eligibility');
RESET ROLE; SELECT pg_temp.i_clear();
UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT admin_a FROM ifx) AND scope='resident';
SELECT pg_temp.i_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert(public.haven_operation_attention_ownership(pg_temp.iid('occ_res_d1')) IS NULL,'revoked subject grant exposed ownership');
RESET ROLE; SELECT pg_temp.i_clear();
UPDATE public.facility_assets SET status='retired' WHERE id=(SELECT asset1 FROM ifx);
SELECT pg_temp.i_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert(public.haven_operation_attention_ownership(pg_temp.iid('occ_a1_d1')) IS NULL,'retired native subject exposed ownership');
RESET ROLE;
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_escalation_deliveries WHERE reminder_state IS NOT NULL),'read projection activated reminder');
SELECT pg_temp.i_assert(NOT has_function_privilege('anon','public.haven_operation_attention_ownership(uuid)','EXECUTE'),'anonymous wrapper granted');
SELECT pg_temp.i_assert(NOT has_function_privilege('authenticated','haven.operation_reminder_recipient_current(uuid,uuid)','EXECUTE'),'raw arbitrary-user helper exposed');
SELECT pg_temp.i_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.haven_operation_attention_ownership(uuid)'::regprocedure),'public wrapper must be invoker');
SELECT pg_temp.i_assert((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.operation_attention_occurrences'::regclass),'view must be invoker');
ROLLBACK;
