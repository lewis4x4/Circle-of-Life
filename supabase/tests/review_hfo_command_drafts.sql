-- COL-146: interrupted-save drafts on the disposable replay. Proves that a
-- draft is the exact arguments of one command stored under the actor with
-- its request key (replay by key and content; changed content conflicts;
-- another actor's key is unavailable and nothing is disclosed); that only the
-- owner under current site and subject authority can read, reconcile, resume
-- or discard it (the other actor sees nothing; a revoked site grant hides the
-- owner's own draft); that reconciliation answers from the record under the
-- key (unsaved before the command, saved with the receipt or issue after it,
-- expired on touch, discarded); that a resume executes the stored command
-- once, replays the one record after a lost-but-committed answer, propagates
-- the command's own refusal unchanged with the draft still pending, and is
-- refused for expired and discarded drafts; that direct DML, DELETE and
-- TRUNCATE are refused with or without the forged setting; and that drafts
-- are immutable and forward-only even under the owner token. Authenticated
-- SQL behaviour with synthetic fixtures; not hosted, browser or staff
-- acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.d_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-146 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.d_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-146 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.d_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR coalesce(d,'')=detail_fragment) AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-146 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations drafts, records or reports anything.
SELECT pg_temp.d_assert(NOT EXISTS(SELECT 1 FROM public.operation_command_drafts),'a migration created a draft');
SELECT pg_temp.d_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts) AND NOT EXISTS(SELECT 1 FROM public.operation_issues),'a migration created a receipt or issue');

-- FIXTURES-BEGIN
CREATE TEMP TABLE df AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_res,gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() res1,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 -- Versions, configurations and bindings take effect 23 hours ago (338 allows up to a day back).
 clock_timestamp()-interval '23 hours' since,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE df ADD COLUMN d2 date,ADD COLUMN d3 date,ADD COLUMN d4 date,ADD COLUMN d5 date;
UPDATE df SET d2=d1+7,d3=d1+14,d4=d1+21,d5=d1+28;
CREATE TEMP TABLE df_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE df_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON df TO authenticated,service_role; GRANT ALL ON df_ids,df_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Draft Site B','Test','Test','00000',1 FROM df;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM df
 UNION ALL SELECT admin_a,admin_a||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM df
 UNION ALL SELECT admin_b,admin_b||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM df
 UNION ALL SELECT maint,maint||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM df
 UNION ALL SELECT nurse,nurse||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM df
 UNION ALL SELECT aide,aide||'@draft.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM df;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@draft.invalid','Corporate','owner'::public.app_role,org,true FROM df
 UNION ALL SELECT admin_a,admin_a||'@draft.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM df
 UNION ALL SELECT admin_b,admin_b||'@draft.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM df
 UNION ALL SELECT maint,maint||'@draft.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM df
 UNION ALL SELECT nurse,nurse||'@draft.invalid','Nurse','nurse'::public.app_role,org,true FROM df
 UNION ALL SELECT aide,aide||'@draft.invalid','Aide','housekeeper'::public.app_role,org,true FROM df
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM df UNION ALL SELECT admin_a_session,admin_a FROM df UNION ALL SELECT admin_b_session,admin_b FROM df
 UNION ALL SELECT maint_session,maint FROM df UNION ALL SELECT nurse_session,nurse FROM df UNION ALL SELECT aide_session,aide FROM df;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM df UNION ALL SELECT admin_a,site_a,org FROM df UNION ALL SELECT admin_b,site_b,org FROM df UNION ALL SELECT maint,site_a,org FROM df
 UNION ALL SELECT nurse,site_a,org FROM df UNION ALL SELECT aide,site_a,org FROM df;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM df
 UNION ALL SELECT org,site_a,owner_actor,'resident',owner_actor,'Fixture corporate resident reviewer',true FROM df
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM df;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-146-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM df
 UNION ALL SELECT act_res,org,NULL,'hfo-146-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM df;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM df UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM df;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM df;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM df UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM df;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM df;
CREATE FUNCTION pg_temp.d_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f df; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM df;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.d_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.d_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col146-'||p $$;
CREATE FUNCTION pg_temp.rid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM df_ids WHERE label=p_label $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM df_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.res(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT result FROM df_results WHERE label=p_label $$;
-- The command arguments exactly as the route would send them.
CREATE FUNCTION pg_temp.rec(p_batt int,p_note text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('payload',jsonb_build_object('outcome','performed','values',jsonb_build_object('pads_ok',true,'battery_pct',p_batt),'note',p_note)) $$;
CREATE FUNCTION pg_temp.draft(p_command text,p_target uuid,p_arguments jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('command',p_command,'target_id',p_target,'arguments',p_arguments) $$;
CREATE FUNCTION pg_temp.save(p_label text,p_key text,p_payload jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 r:=public.save_operation_command_draft_review(pg_temp.k(p_key),p_payload);
 INSERT INTO df_results VALUES('save_'||p_label,r);
 INSERT INTO df_ids VALUES(p_label,(r->'draft'->>'id')::uuid);
END $$;
CREATE FUNCTION pg_temp.row_of(p_label text) RETURNS public.operation_command_drafts LANGUAGE sql AS $$ SELECT d FROM public.operation_command_drafts d WHERE id=(SELECT id FROM df_ids WHERE label=p_label) $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.d_login(text),pg_temp.d_service(),pg_temp.d_clear(),pg_temp.k(text),pg_temp.rid(text),pg_temp.rev(text),pg_temp.res(text),
 pg_temp.rec(int,text),pg_temp.draft(text,uuid,jsonb),pg_temp.save(text,text,jsonb),pg_temp.row_of(text) TO authenticated,service_role;

-- Central versions (owner) and site configurations (site admin), in force since before the earliest occurrence.
SELECT pg_temp.d_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO df_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','pads_ok','label','Pads in date','type','boolean','required',true),jsonb_build_object('key','battery_pct','label','Battery','type','number','required',true,'min',0,'max',100)))) FROM df;
INSERT INTO df_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'))) FROM df;
INSERT INTO df_ids SELECT label,(result->>'id')::uuid FROM df_results WHERE label LIKE 'v\_%';
INSERT INTO df_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,(SELECT since FROM df)) FROM df_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.d_assert((SELECT count(*)=2 FROM df_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.d_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO df_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb)) FROM df;
INSERT INTO df_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM df;
INSERT INTO df_ids SELECT label,(result->>'id')::uuid FROM df_results WHERE label LIKE 'fr\_%';
INSERT INTO df_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,(SELECT since FROM df)) FROM df_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.d_assert((SELECT count(*)=2 FROM df_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO df_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',since) FROM df;
INSERT INTO df_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',since) FROM df;
INSERT INTO df_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',since) FROM df;
RESET ROLE;
-- Occurrences from the service generator: five future weeks for the AEDs, three for the weight review.
SELECT pg_temp.d_service();
SET LOCAL ROLE service_role;
INSERT INTO df_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_asset'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00',120),pg_temp.occ(d2,'America/New_York','10:00',120),pg_temp.occ(d3,'America/New_York','10:00',120),pg_temp.occ(d4,'America/New_York','10:00',120),pg_temp.occ(d5,'America/New_York','10:00',120)),pg_temp.run('run-asset',d1,d5,pg_temp.rid('fr_asset'))) FROM df;
INSERT INTO df_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_res'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','09:00'),pg_temp.occ(d2,'America/New_York','09:00'),pg_temp.occ(d3,'America/New_York','09:00')),pg_temp.run('run-res',d1,d3,pg_temp.rid('fr_res'))) FROM df;
SELECT pg_temp.d_assert((SELECT (result->'counts'->>'created')::int=10 FROM df_results WHERE label='g_asset') AND (SELECT (result->'counts'->>'created')::int=3 FROM df_results WHERE label='g_res'),'occurrences not generated');
INSERT INTO df_ids SELECT 'occ_a1_'||n,t.id FROM df CROSS JOIN LATERAL (VALUES('d1',df.d1),('d2',df.d2),('d3',df.d3),('d4',df.d4),('d5',df.d5)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=df.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO df_ids SELECT 'occ_a2_'||n,t.id FROM df CROSS JOIN LATERAL (VALUES('d1',df.d1),('d2',df.d2),('d3',df.d3),('d4',df.d4),('d5',df.d5)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=df.subj_asset2 AND t.assigned_shift_date=x.d;
INSERT INTO df_ids SELECT 'occ_res_'||n,t.id FROM df CROSS JOIN LATERAL (VALUES('d1',df.d1),('d2',df.d2),('d3',df.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=df.subj_res1 AND t.assigned_shift_date=x.d;
SELECT pg_temp.d_assert((SELECT count(*)=13 FROM df_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;
SELECT pg_temp.d_clear();
-- FIXTURES-END

-- Shape: every refusal is a 22023 with an actionable wording and writes nothing.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review('short',pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'x')))$q$,'A request key is required',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),'"x"'::jsonb)$q$,'Draft payload must be an object',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'x'))||'{"extra":1}')$q$,'Draft payload field extra is invalid',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('nope',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'x')))$q$,'Command must be record_work, verify_work, correct_work, reverse_work or report_issue',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),'{"command":"record_work","target_id":"x","arguments":{"payload":{}}}')$q$,'Target must be a uuid',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),'{"command":"record_work","target_id":7,"arguments":{"payload":{}}}')$q$,'Target must be a uuid',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),'{"command":"record_work","arguments":{"payload":{}}}')$q$,'Target is required',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'x'))||jsonb_build_object('facility_id',(SELECT site_a FROM df)))$q$,'Facility must be omitted when a target is given',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),'[]'::jsonb))$q$,'Arguments must be an object',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),'{}'::jsonb))$q$,'Arguments payload must be an object',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),'{"payload":{},"extra":1}'::jsonb))$q$,'Arguments must carry payload only',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('correct_work',pg_temp.rid('occ_a1_d1'),'{"payload":{}}'::jsonb))$q$,'Arguments must carry expected_receipt_id, expected_receipt_revision and payload',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('correct_work',pg_temp.rid('occ_a1_d1'),jsonb_build_object('payload','{}'::jsonb,'expected_receipt_id','x','expected_receipt_revision',repeat('a',64))))$q$,'Arguments expected_receipt_id must be a uuid',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('reverse_work',pg_temp.rid('occ_a1_d1'),jsonb_build_object('payload','{}'::jsonb,'expected_receipt_id',gen_random_uuid(),'expected_receipt_revision','short')))$q$,'Arguments expected_receipt_revision must be 64 hex characters',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,repeat('x',70000))))$q$,'Arguments must be at most 64 KiB',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',pg_temp.rid('occ_a1_d1'),jsonb_build_object('payload',jsonb_build_object('task_instance_id',pg_temp.rid('occ_a1_d2'),'summary','x'))))$q$,'Target must be the issue payload task_instance_id',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('task_instance_id',pg_temp.rid('occ_a1_d2'),'summary','x'))))$q$,'Target must be the issue payload task_instance_id',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',pg_temp.rid('occ_a1_d1'),jsonb_build_object('payload',jsonb_build_object('task_instance_id',pg_temp.rid('occ_a1_d1'),'summary','x')))||jsonb_build_object('facility_id',(SELECT site_a FROM df)))$q$,'Facility must be omitted when a target is given',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('facility_id',(SELECT site_a FROM df),'summary','x'))))$q$,'Facility is required for a scoped issue report',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('facility_id',(SELECT site_a FROM df),'summary','x')))||jsonb_build_object('facility_id',(SELECT site_b FROM df)))$q$,'Facility must be the issue payload facility_id',NULL,'22023');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000001'),pg_temp.draft('report_issue',pg_temp.rid('occ_a1_d1'),jsonb_build_object('payload',jsonb_build_object('summary','x')))||jsonb_build_object('facility_id',(SELECT site_a FROM df)))$q$,'Target must be omitted for a scoped issue report',NULL,'22023');
-- Authority before disclosure: an unknown or foreign target and a site not held are unavailable.
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000002'),pg_temp.draft('record_work',gen_random_uuid(),pg_temp.rec(90,'x')))$q$);
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000002'),pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('facility_id',(SELECT site_b FROM df),'summary','x')))||jsonb_build_object('facility_id',(SELECT site_b FROM df)))$q$);
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000002'),pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('facility_id','00000000-0000-4000-8000-000000000146','summary','x')))||'{"facility_id":"00000000-0000-4000-8000-000000000146"}')$q$);
RESET ROLE;
SELECT pg_temp.d_assert(NOT EXISTS(SELECT 1 FROM public.operation_command_drafts),'a refused save created a draft');
SELECT pg_temp.d_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('shape-000003'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'x')))$q$);
RESET ROLE;

-- Save: a pending draft under the actor with the key, the site derived from the target, a 24-hour expiry and a server-derived fingerprint.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d1','d1-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'Pads and battery fine')));
SELECT pg_temp.d_assert((SELECT (result->>'replayed')::boolean=false AND result->'draft'->>'state'='pending' AND (result->'draft'->>'actor_id')::uuid=(SELECT maint FROM df) AND (result->'draft'->>'actor_session_id')::uuid=(SELECT maint_session FROM df)
 AND (result->'draft'->>'organization_id')::uuid=(SELECT org FROM df) AND (result->'draft'->>'facility_id')::uuid=(SELECT site_a FROM df) AND (result->'draft'->>'target_id')::uuid=pg_temp.rid('occ_a1_d1')
 AND result->'draft'->>'command'='record_work' AND result->'draft'->>'request_key'=pg_temp.k('d1-000001') AND result->'draft'->'arguments'=pg_temp.rec(90,'Pads and battery fine')
 AND (result->'draft'->>'expires_at')::timestamptz=(result->'draft'->>'created_at')::timestamptz+interval '24 hours' AND result->'draft'->>'arguments_hash' ~ '^[0-9a-f]{64}$' AND result->'draft'->>'revision' ~ '^[0-9a-f]{64}$'
 AND result->'draft'->>'reconciled_at' IS NULL AND jsonb_typeof(result->'draft'->'reconciled_record')='null' AND result->'draft'->>'discarded_at' IS NULL FROM df_results WHERE label='save_d1'),'save reply is not a pending draft under the actor');
SELECT pg_temp.d_assert((SELECT to_jsonb(d)=pg_temp.res('save_d1')->'draft' FROM public.operation_command_drafts d WHERE id=pg_temp.rid('d1')),'the stored draft differs from the reply');
-- Replay by key: same content returns the one draft; changed content conflicts; nothing new is written.
INSERT INTO df_results SELECT 'replay_d1',public.save_operation_command_draft_review(pg_temp.k('d1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'Pads and battery fine')));
SELECT pg_temp.d_assert((SELECT (result->>'replayed')::boolean AND (result->'draft'->>'id')::uuid=pg_temp.rid('d1') AND result->'draft'=pg_temp.res('save_d1')->'draft' FROM df_results WHERE label='replay_d1'),'replay did not return the same draft');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('d1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(91,'Pads and battery fine')))$q$,'This request was already saved with different content',NULL,'P0001');
SELECT pg_temp.d_expect($q$SELECT public.save_operation_command_draft_review(pg_temp.k('d1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d2'),pg_temp.rec(90,'Pads and battery fine')))$q$,'This request was already saved with different content',NULL,'P0001');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM public.operation_command_drafts),'a replay or conflict created a draft');
RESET ROLE;
SELECT pg_temp.d_assert((SELECT arguments_hash=haven.operation_command_draft_hash(actor_id,command,target_id,arguments) FROM public.operation_command_drafts WHERE id=pg_temp.rid('d1')),'fingerprint not derived from actor, command, target and arguments');
-- Another actor: the key is unavailable, the draft is invisible, and reconcile, resume and discard are unavailable; an unknown id is absent.
SELECT pg_temp.d_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('d1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'Pads and battery fine')))$q$);
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_command_drafts),'another actor can read the draft');
SELECT pg_temp.d_denied($q$SELECT public.reconcile_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_expect($q$SELECT public.reconcile_operation_command_draft_review(gen_random_uuid())$q$,'Draft not found',NULL,'P0002');
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(gen_random_uuid())$q$,'Draft not found',NULL,'P0002');
SELECT pg_temp.d_expect($q$SELECT public.discard_operation_command_draft_review(NULL)$q$,'Draft not found',NULL,'P0002');
RESET ROLE;
SELECT pg_temp.d_assert((SELECT state='pending' AND revision=pg_temp.res('save_d1')->'draft'->>'revision' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d1')) AND (SELECT count(*)=0 FROM public.operation_execution_receipts),'another actor changed the draft or recorded');
-- A revoked site grant hides the owner's own draft and refuses every command on it.
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT maint FROM df);
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_command_drafts),'a revoked owner can read the draft');
SELECT pg_temp.d_denied($q$SELECT public.reconcile_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('d1'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review(pg_temp.k('d1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d1'),pg_temp.rec(90,'Pads and battery fine')))$q$);
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT maint FROM df);
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d1')) AND (SELECT count(*)=0 FROM public.operation_execution_receipts),'a revoked owner moved the draft or recorded');

-- Reconcile: unsaved before the command; saved with the receipt once the command committed under the same key; idempotent; a resume of a reconciled draft replays.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO df_results SELECT 'rec_d1_unsaved',public.reconcile_operation_command_draft_review(pg_temp.rid('d1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' AND result->'draft'->>'state'='pending' AND NOT (result ? 'record') AND (result->'draft'->>'id')::uuid=pg_temp.rid('d1') FROM df_results WHERE label='rec_d1_unsaved'),'reconcile before the command is not unsaved');
INSERT INTO df_results SELECT 'cmd_d1',public.record_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('d1-000001'),pg_temp.rec(90,'Pads and battery fine')->'payload');
INSERT INTO df_ids SELECT 'r1',(result->'receipt'->>'id')::uuid FROM df_results WHERE label='cmd_d1';
SELECT pg_temp.d_assert((SELECT (result->>'replayed')::boolean=false AND result->'receipt'->>'completion_state'='completed' FROM df_results WHERE label='cmd_d1'),'the drafted command did not record');
INSERT INTO df_results SELECT 'rec_d1_saved',public.reconcile_operation_command_draft_review(pg_temp.rid('d1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=jsonb_build_object('kind','receipt','id',pg_temp.rid('r1'),'replayed',true) AND result->'record'=result->'draft'->'reconciled_record'
 AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(result->'record') k)=ARRAY['id','kind','replayed']
 AND result->'draft'->>'state'='reconciled' AND result->'draft'->>'reconciled_at' IS NOT NULL AND result->'draft'->'reconciled_record'=jsonb_build_object('kind','receipt','id',pg_temp.rid('r1'),'replayed',true)
 AND result->'draft'->>'revision'<>pg_temp.res('save_d1')->'draft'->>'revision' AND result->'draft'->>'discarded_at' IS NULL FROM df_results WHERE label='rec_d1_saved'),'reconcile after the command is not saved with the receipt');
INSERT INTO df_results SELECT 'rec_d1_again',public.reconcile_operation_command_draft_review(pg_temp.rid('d1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=pg_temp.res('rec_d1_saved')->'record' AND result->'draft'=pg_temp.res('rec_d1_saved')->'draft' FROM df_results WHERE label='rec_d1_again'),'reconcile is not idempotent');
SELECT pg_temp.d_assert((SELECT request_key=pg_temp.k('d1-000001') AND recorder_id=(SELECT maint FROM df) FROM public.operation_execution_receipts WHERE id=(pg_temp.res('rec_d1_saved')->'record'->>'id')::uuid),'the named record is not the actor''s receipt under the key');
INSERT INTO df_results SELECT 'res_d1',public.resume_operation_command_draft_review(pg_temp.rid('d1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND (result->'reply'->>'replayed')::boolean AND (result->'reply'->'receipt'->>'id')::uuid=pg_temp.rid('r1') AND result->'draft'=pg_temp.res('rec_d1_saved')->'draft' FROM df_results WHERE label='res_d1'),'resume of a reconciled draft did not replay the receipt');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1')),'a replayed resume created a second receipt');
SELECT pg_temp.d_expect($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('d1'))$q$,'Draft is not pending',NULL,'P0001');
-- Resume of an unsaved draft executes the command once and marks the draft reconciled; a second resume replays.
SELECT pg_temp.save('d2','d2-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a2_d1'),pg_temp.rec(80,'Wing B fine')));
INSERT INTO df_results SELECT 'res_d2',public.resume_operation_command_draft_review(pg_temp.rid('d2'));
INSERT INTO df_ids SELECT 'r2',(result->'reply'->'receipt'->>'id')::uuid FROM df_results WHERE label='res_d2';
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND (result->'reply'->>'replayed')::boolean=false AND result->'reply'->'receipt'->>'completion_state'='completed' AND result->'reply'->'receipt'->>'request_key'=pg_temp.k('d2-000001')
 AND (result->'reply'->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM df) AND result->'reply'->'receipt'->'values'='{"pads_ok":true,"battery_pct":80}'::jsonb AND result->'reply'->'occurrence'->>'status'='completed'
 AND result->'draft'->>'state'='reconciled' AND result->'draft'->'reconciled_record'=jsonb_build_object('kind','receipt','id',pg_temp.rid('r2'),'replayed',false) FROM df_results WHERE label='res_d2'),'resume did not execute the drafted command');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a2_d1')) AND (SELECT status='completed' AND effective_receipt_id=pg_temp.rid('r2') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d1')),'resumed command left the occurrence unrecorded');
INSERT INTO df_results SELECT 'res_d2_again',public.resume_operation_command_draft_review(pg_temp.rid('d2'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND (result->'reply'->>'replayed')::boolean AND (result->'reply'->'receipt'->>'id')::uuid=pg_temp.rid('r2') AND result->'draft'=pg_temp.res('res_d2')->'draft'
 AND (result->'draft'->'reconciled_record'->>'id')::uuid=(result->'reply'->'receipt'->>'id')::uuid FROM df_results WHERE label='res_d2_again') AND (SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a2_d1')),'a resume after the draft was reconciled by an earlier resume did not replay the same record');
-- Resume after the command had committed: the one receipt is replayed and the draft records the replay.
SELECT pg_temp.save('d3','d3-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a1_d2'),pg_temp.rec(70,'Second week')));
INSERT INTO df_results SELECT 'cmd_d3',public.record_operation_work_review(pg_temp.rid('occ_a1_d2'),pg_temp.k('d3-000001'),pg_temp.rec(70,'Second week')->'payload');
INSERT INTO df_results SELECT 'res_d3',public.resume_operation_command_draft_review(pg_temp.rid('d3'));
SELECT pg_temp.d_assert((SELECT (result->'reply'->>'replayed')::boolean AND result->'reply'->'receipt'->>'id'=pg_temp.res('cmd_d3')->'receipt'->>'id' AND result->'draft'->>'state'='reconciled' AND (result->'draft'->'reconciled_record'->>'replayed')::boolean FROM df_results WHERE label='res_d3'),'resume after a committed answer did not replay');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d2')),'resume after a committed answer created a second receipt');
RESET ROLE;
SELECT pg_temp.d_assert((SELECT count(*)=3 FROM public.operation_audit_log WHERE event_type='completed' AND actor_id=(SELECT maint FROM df)),'resumed commands did not write their audit rows');
-- A key reused on another occurrence never reconciles the draft as saved, and the resume is the command's own key conflict with the draft still pending.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d3b','d3b-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a2_d5'),pg_temp.rec(65,'Reused key')));
INSERT INTO df_results SELECT 'cmd_d3b_other',public.record_operation_work_review(pg_temp.rid('occ_a1_d5'),pg_temp.k('d3b-000001'),pg_temp.rec(65,'Reused key')->'payload');
SELECT pg_temp.d_assert((SELECT (result->>'replayed')::boolean=false AND (result->'receipt'->>'task_instance_id')::uuid=pg_temp.rid('occ_a1_d5') FROM df_results WHERE label='cmd_d3b_other'),'the other occurrence was not recorded under the reused key');
INSERT INTO df_results SELECT 'rec_d3b',public.reconcile_operation_command_draft_review(pg_temp.rid('d3b'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' AND result->'draft'->>'state'='pending' AND NOT (result ? 'record') FROM df_results WHERE label='rec_d3b'),'a key reused on another occurrence reconciled the draft as saved');
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d3b'))$q$,'This request was already saved with different content',NULL,'P0001');
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d3b')) AND (SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a2_d5')),'a reused key resumed onto the drafted occurrence');
RESET ROLE;

-- Corrections and reversals: a stale expected revision is the correction conflict and the draft stays pending; the current one resumes; the arguments are never edited.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d4','d4-000001',pg_temp.draft('correct_work',pg_temp.rid('occ_a1_d1'),jsonb_build_object('expected_receipt_id',pg_temp.rid('r1'),'expected_receipt_revision',pg_temp.rev('r1'),'payload',jsonb_build_object('reason','Battery misread','outcome','performed','values',jsonb_build_object('pads_ok',true,'battery_pct',75)))));
INSERT INTO df_results SELECT 'cor_direct',public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-direct-0001'),pg_temp.rid('r1'),pg_temp.rev('r1'),'{"reason":"Corrected on another device","outcome":"performed","values":{"pads_ok":true,"battery_pct":85}}');
INSERT INTO df_ids SELECT 'c1',(result->'receipt'->>'id')::uuid FROM df_results WHERE label='cor_direct';
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d4'))$q$,'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c1')||';current_receipt_revision='||pg_temp.rev('c1'),'P0001');
SELECT pg_temp.d_assert((SELECT state='pending' AND reconciled_record IS NULL AND revision=pg_temp.res('save_d4')->'draft'->>'revision' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d4')),'a refused resume moved the draft');
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_execution_receipts WHERE request_key=pg_temp.k('d4-000001')) AND (SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1')),'a refused resume wrote a receipt');
INSERT INTO df_results SELECT 'rec_d4',public.reconcile_operation_command_draft_review(pg_temp.rid('d4'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' FROM df_results WHERE label='rec_d4'),'a refused resume reads as saved');
SELECT pg_temp.save('d5','d5-000001',pg_temp.draft('correct_work',pg_temp.rid('occ_a1_d1'),jsonb_build_object('expected_receipt_id',pg_temp.rid('c1'),'expected_receipt_revision',pg_temp.rev('c1'),'payload',jsonb_build_object('reason','Battery misread again','outcome','performed','values',jsonb_build_object('pads_ok',true,'battery_pct',75)))));
INSERT INTO df_results SELECT 'res_d5',public.resume_operation_command_draft_review(pg_temp.rid('d5'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND (result->'reply'->>'replayed')::boolean=false AND (result->'reply'->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('c1') AND (result->'reply'->'corrected'->>'id')::uuid=pg_temp.rid('c1')
 AND result->'reply'->'receipt'->>'correction_reason'='Battery misread again' AND (result->'reply'->'receipt'->>'correction_seq')::int=2 AND result->'draft'->>'state'='reconciled' AND result->'draft'->'reconciled_record'->>'kind'='receipt' FROM df_results WHERE label='res_d5'),'resumed correction did not supersede the current receipt');
SELECT pg_temp.save('d6','d6-000001',pg_temp.draft('reverse_work',pg_temp.rid('occ_a2_d1'),jsonb_build_object('expected_receipt_id',pg_temp.rid('r2'),'expected_receipt_revision',pg_temp.rev('r2'),'payload',jsonb_build_object('reason','Wrong unit'))));
INSERT INTO df_results SELECT 'res_d6',public.resume_operation_command_draft_review(pg_temp.rid('d6'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'reply'->'receipt'->>'receipt_kind'='reversal' AND (result->'reply'->'reversed'->>'id')::uuid=pg_temp.rid('r2') AND result->'reply'->'occurrence'->>'status'='pending' AND result->'draft'->>'state'='reconciled' FROM df_results WHERE label='res_d6'),'resumed reversal did not reverse');
SELECT pg_temp.d_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d1')),'reversal did not return the occurrence');
RESET ROLE;

-- Verification: the recorder's own verify draft is refused by the command (42501, draft pending); an independent reviewer's draft resumes and reconciles.
SELECT pg_temp.d_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO df_results SELECT 'rec_res1',public.record_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('res1-000001'),'{"outcome":"performed","note":"Weight stable"}');
INSERT INTO df_ids SELECT 'rr',(result->'receipt'->>'id')::uuid FROM df_results WHERE label='rec_res1';
SELECT pg_temp.d_assert((SELECT result->'receipt'->>'completion_state'='awaiting_verification' FROM df_results WHERE label='rec_res1'),'weight review not awaiting verification');
SELECT pg_temp.save('d7','d7-000001',pg_temp.draft('verify_work',pg_temp.rid('occ_res_d1'),jsonb_build_object('payload',jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('rr'),'receipt_revision',pg_temp.rev('rr')))));
SELECT pg_temp.d_denied($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d7'))$q$);
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d7')) AND (SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d1')),'a non-reviewer verified through a draft');
INSERT INTO df_results SELECT 'rec_d7',public.reconcile_operation_command_draft_review(pg_temp.rid('d7'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' FROM df_results WHERE label='rec_d7'),'a refused verify draft reads as saved');
RESET ROLE;
SELECT pg_temp.d_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_command_drafts),'the reviewer can read other actors'' drafts');
-- The recorder's own review is the command's refusal, verbatim, and leaves the draft pending.
INSERT INTO df_results SELECT 'rec_res2',public.record_operation_work_review(pg_temp.rid('occ_res_d2'),pg_temp.k('res2-000001'),'{"outcome":"performed","note":"Weight stable"}');
INSERT INTO df_ids SELECT 'rr2',(result->'receipt'->>'id')::uuid FROM df_results WHERE label='rec_res2';
SELECT pg_temp.save('d8b','d8b-000001',pg_temp.draft('verify_work',pg_temp.rid('occ_res_d2'),jsonb_build_object('payload',jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('rr2'),'receipt_revision',pg_temp.rev('rr2')))));
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d8b'))$q$,'A different authorized staff member must verify this task',NULL,'42501');
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d8b')) AND (SELECT execution_state='awaiting_verification' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d2')),'the recorder verified their own work through a draft');
SELECT pg_temp.save('d8','d8-000001',pg_temp.draft('verify_work',pg_temp.rid('occ_res_d1'),jsonb_build_object('payload',jsonb_build_object('decision','verified','note','Reviewed','receipt_id',pg_temp.rid('rr'),'receipt_revision',pg_temp.rev('rr')))));
INSERT INTO df_results SELECT 'res_d8',public.resume_operation_command_draft_review(pg_temp.rid('d8'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'reply'->'receipt'->>'receipt_kind'='verification' AND (result->'reply'->'receipt'->>'verifies_receipt_id')::uuid=pg_temp.rid('rr') AND result->'reply'->'occurrence'->>'status'='completed'
 AND result->'draft'->>'state'='reconciled' FROM df_results WHERE label='res_d8'),'resumed verification did not verify');
INSERT INTO df_results SELECT 'rec_d8',public.reconcile_operation_command_draft_review(pg_temp.rid('d8'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=jsonb_build_object('kind','receipt','id',(pg_temp.res('res_d8')->'reply'->'receipt'->>'id')::uuid,'replayed',false) FROM df_results WHERE label='rec_d8')
 AND (SELECT receipt_kind='verification' AND recorder_id=(SELECT admin_a FROM df) FROM public.operation_execution_receipts WHERE id=(pg_temp.res('rec_d8')->'record'->>'id')::uuid),'reconciled verification record wrong');
RESET ROLE;

-- A non-recorder may draft a readable occurrence, but the command refuses the resume and the draft stays pending.
SELECT pg_temp.d_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d9','d9-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a2_d2'),pg_temp.rec(60,'Aide attempt')));
SELECT pg_temp.d_denied($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d9'))$q$);
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d9')) AND (SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a2_d2')),'a non-recorder recorded through a draft');
INSERT INTO df_results SELECT 'rec_d9',public.reconcile_operation_command_draft_review(pg_temp.rid('d9'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' AND result->'draft'->>'state'='pending' FROM df_results WHERE label='rec_d9'),'a refused resume reads as saved');
RESET ROLE;

-- Issue reports: an occurrence-linked draft and a scoped draft resume into issues and reconcile by the reporter.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d10','d10-000001',pg_temp.draft('report_issue',pg_temp.rid('occ_a2_d3'),jsonb_build_object('payload',jsonb_build_object('task_instance_id',pg_temp.rid('occ_a2_d3'),'kind','help_request','summary','Need a ladder for the wing B unit'))));
SELECT pg_temp.d_assert((SELECT result->'draft'->>'facility_id'=(SELECT site_a::text FROM df) AND (result->'draft'->>'target_id')::uuid=pg_temp.rid('occ_a2_d3') FROM df_results WHERE label='save_d10'),'issue draft did not derive its site from the occurrence');
INSERT INTO df_results SELECT 'res_d10',public.resume_operation_command_draft_review(pg_temp.rid('d10'));
INSERT INTO df_ids SELECT 'i1',(result->'reply'->'issue'->>'id')::uuid FROM df_results WHERE label='res_d10';
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND (result->'reply'->>'replayed')::boolean=false AND result->'reply'->'issue'->>'summary'='Need a ladder for the wing B unit' AND (result->'reply'->'issue'->>'task_instance_id')::uuid=pg_temp.rid('occ_a2_d3')
 AND result->'draft'->'reconciled_record'=jsonb_build_object('kind','issue','id',pg_temp.rid('i1'),'replayed',false) FROM df_results WHERE label='res_d10'),'resumed issue report did not report');
INSERT INTO df_results SELECT 'rec_d10',public.reconcile_operation_command_draft_review(pg_temp.rid('d10'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=jsonb_build_object('kind','issue','id',pg_temp.rid('i1'),'replayed',false) FROM df_results WHERE label='rec_d10')
 AND (SELECT reported_by=(SELECT maint FROM df) AND request_key=pg_temp.k('d10-000001') FROM public.operation_issues WHERE id=pg_temp.rid('i1')),'issue reconciliation wrong');
SELECT pg_temp.d_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d3')),'an issue draft performed the work');
RESET ROLE;
SELECT pg_temp.d_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('d11','d11-000001',pg_temp.draft('report_issue',NULL,jsonb_build_object('payload',jsonb_build_object('activity_id',(SELECT act_res FROM df),'facility_id',(SELECT site_a FROM df),'subject_id',(SELECT subj_res1 FROM df),'kind','problem','summary','Scale reads inconsistently')))||jsonb_build_object('facility_id',(SELECT site_a FROM df)));
SELECT pg_temp.d_assert((SELECT result->'draft'->>'target_id' IS NULL AND (result->'draft'->>'facility_id')::uuid=(SELECT site_a FROM df) AND result->'draft'->>'state'='pending' FROM df_results WHERE label='save_d11'),'scoped issue draft wrong');
INSERT INTO df_results SELECT 'rec_d11_unsaved',public.reconcile_operation_command_draft_review(pg_temp.rid('d11'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='unsaved' FROM df_results WHERE label='rec_d11_unsaved'),'scoped issue draft reads as saved before the command');
INSERT INTO df_results SELECT 'res_d11',public.resume_operation_command_draft_review(pg_temp.rid('d11'));
INSERT INTO df_ids SELECT 'i2',(result->'reply'->'issue'->>'id')::uuid FROM df_results WHERE label='res_d11';
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'reply'->'issue'->>'task_instance_id' IS NULL AND (result->'reply'->'issue'->>'subject_id')::uuid=(SELECT subj_res1 FROM df) AND result->'reply'->'issue'->>'authority_class'='resident'
 AND result->'draft'->>'state'='reconciled' AND result->'draft'->'reconciled_record'->>'kind'='issue' FROM df_results WHERE label='res_d11'),'resumed scoped issue report did not report');
INSERT INTO df_results SELECT 'rec_d11',public.reconcile_operation_command_draft_review(pg_temp.rid('d11'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=jsonb_build_object('kind','issue','id',pg_temp.rid('i2'),'replayed',false) AND result->'record'=result->'draft'->'reconciled_record' FROM df_results WHERE label='rec_d11'),'scoped issue reconciliation wrong');
SELECT pg_temp.d_assert((SELECT count(*)=2 FROM public.operation_command_drafts) AND (SELECT array_agg(id ORDER BY created_at DESC)=ARRAY[pg_temp.rid('d11'),pg_temp.rid('d7')] FROM public.operation_command_drafts),'the nurse does not see exactly their own drafts newest first');
-- Discard: pending becomes discarded and stays refused; idempotent; reconcile answers discarded.
INSERT INTO df_results SELECT 'dis_d7',public.discard_operation_command_draft_review(pg_temp.rid('d7'));
SELECT pg_temp.d_assert((SELECT result->'draft'->>'state'='discarded' AND result->'draft'->>'discarded_at' IS NOT NULL AND result->'draft'->>'reconciled_at' IS NULL AND NOT (result ? 'outcome') FROM df_results WHERE label='dis_d7'),'discard reply wrong');
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d7'))$q$,'Draft was discarded',NULL,'P0001');
INSERT INTO df_results SELECT 'rec_d7_discarded',public.reconcile_operation_command_draft_review(pg_temp.rid('d7'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='discarded' AND result->'draft'=pg_temp.res('dis_d7')->'draft' FROM df_results WHERE label='rec_d7_discarded'),'reconcile of a discarded draft wrong');
INSERT INTO df_results SELECT 'dis_d7_again',public.discard_operation_command_draft_review(pg_temp.rid('d7'));
SELECT pg_temp.d_assert((SELECT result->'draft'=pg_temp.res('dis_d7')->'draft' FROM df_results WHERE label='dis_d7_again'),'discard is not idempotent');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d1') AND receipt_kind='verification'),'a discarded draft produced a record');
RESET ROLE;

-- Expiry: a pending draft past its expiry is refused for resume and discard, marked expired on reconcile, and stays refused; a record under the key still wins.
DO $$ BEGIN
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,actor_session_id,command,target_id,request_key,arguments,created_at)
  SELECT org,site_a,maint,maint_session,'record_work',pg_temp.rid('occ_a1_d3'),pg_temp.k('e1-000001'),pg_temp.rec(50,'Aged one'),clock_timestamp()-interval '25 hours' FROM df
  UNION ALL SELECT org,site_a,maint,maint_session,'record_work',pg_temp.rid('occ_a1_d4'),pg_temp.k('e2-000001'),pg_temp.rec(55,'Aged two'),clock_timestamp()-interval '25 hours' FROM df;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
INSERT INTO df_ids SELECT 'e1',id FROM public.operation_command_drafts WHERE request_key=pg_temp.k('e1-000001');
INSERT INTO df_ids SELECT 'e2',id FROM public.operation_command_drafts WHERE request_key=pg_temp.k('e2-000001');
SELECT pg_temp.d_assert((SELECT bool_and(state='pending' AND expires_at<clock_timestamp() AND expires_at=created_at+interval '24 hours' AND arguments_hash=haven.operation_command_draft_hash(actor_id,command,target_id,arguments)) FROM public.operation_command_drafts WHERE id IN(pg_temp.rid('e1'),pg_temp.rid('e2'))),'aged drafts not pending past expiry');
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('e1'))$q$,'Draft has expired',NULL,'P0001');
SELECT pg_temp.d_expect($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('e1'))$q$,'Draft has expired',NULL,'P0001');
SELECT pg_temp.d_assert((SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('e1')) AND (SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d3')),'an expired draft was resumed or moved by a refusal');
INSERT INTO df_results SELECT 'rec_e1',public.reconcile_operation_command_draft_review(pg_temp.rid('e1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='expired' AND result->'draft'->>'state'='expired' AND NOT (result ? 'record') AND result->'draft'->>'reconciled_at' IS NULL AND result->'draft'->>'discarded_at' IS NULL FROM df_results WHERE label='rec_e1'),'reconcile did not mark the aged draft expired');
SELECT pg_temp.d_assert((SELECT state='expired' FROM public.operation_command_drafts WHERE id=pg_temp.rid('e1')),'expiry on touch not persisted');
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('e1'))$q$,'Draft has expired',NULL,'P0001');
SELECT pg_temp.d_expect($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('e1'))$q$,'Draft has expired',NULL,'P0001');
INSERT INTO df_results SELECT 'rec_e1_again',public.reconcile_operation_command_draft_review(pg_temp.rid('e1'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='expired' AND result->'draft'=pg_temp.res('rec_e1')->'draft' FROM df_results WHERE label='rec_e1_again'),'reconcile of an expired draft is not idempotent');
INSERT INTO df_results SELECT 'replay_e1',public.save_operation_command_draft_review(pg_temp.k('e1-000001'),pg_temp.draft('record_work',pg_temp.rid('occ_a1_d3'),pg_temp.rec(50,'Aged one')));
SELECT pg_temp.d_assert((SELECT (result->>'replayed')::boolean AND result->'draft'->>'state'='expired' FROM df_results WHERE label='replay_e1'),'save replay of an expired key did not return the expired draft');
INSERT INTO df_results SELECT 'cmd_e2',public.record_operation_work_review(pg_temp.rid('occ_a1_d4'),pg_temp.k('e2-000001'),pg_temp.rec(55,'Aged two')->'payload');
INSERT INTO df_results SELECT 'rec_e2',public.reconcile_operation_command_draft_review(pg_temp.rid('e2'));
SELECT pg_temp.d_assert((SELECT result->>'outcome'='saved' AND result->'record'=jsonb_build_object('kind','receipt','id',(pg_temp.res('cmd_e2')->'receipt'->>'id')::uuid,'replayed',true) AND result->'draft'->>'state'='reconciled' FROM df_results WHERE label='rec_e2'),'a committed record under an expired key was not reported saved');
-- Discard of a fresh pending draft; nothing is ever produced from it.
SELECT pg_temp.save('d12','d12-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a2_d4'),pg_temp.rec(40,'To discard')));
INSERT INTO df_results SELECT 'dis_d12',public.discard_operation_command_draft_review(pg_temp.rid('d12'));
SELECT pg_temp.d_assert((SELECT result->'draft'->>'state'='discarded' AND result->'draft'->>'revision'<>pg_temp.res('save_d12')->'draft'->>'revision' FROM df_results WHERE label='dis_d12'),'discard did not move the draft');
SELECT pg_temp.d_expect($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d12'))$q$,'Draft was discarded',NULL,'P0001');
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a2_d4')),'a discarded draft produced a receipt');
-- The owner lists exactly their own drafts newest first; pending is the only resumable state left.
SELECT pg_temp.d_assert((SELECT count(*)=11 FROM public.operation_command_drafts) AND (SELECT bool_and(actor_id=(SELECT maint FROM df)) FROM public.operation_command_drafts),'the owner does not see exactly their own drafts');
SELECT pg_temp.d_assert((SELECT (array_agg(id ORDER BY created_at DESC))[1]=pg_temp.rid('d12') FROM public.operation_command_drafts),'newest draft not first');
SELECT pg_temp.d_assert((SELECT array_agg(id ORDER BY created_at)=ARRAY[pg_temp.rid('d3b'),pg_temp.rid('d4')] FROM public.operation_command_drafts WHERE state='pending'),'pending list wrong');
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_command_drafts'),'generic audit payloads of drafts leaked to the owner');
RESET ROLE;
SELECT pg_temp.d_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_command_drafts),'the other site sees drafts');
RESET ROLE;
SELECT pg_temp.d_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_assert((SELECT count(*)=0 FROM public.operation_command_drafts) AND (SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_command_drafts'),'corporate sees other actors'' drafts');
RESET ROLE;
SELECT pg_temp.d_assert((SELECT count(*)=16 FROM public.operation_command_drafts) AND (SELECT count(*)>=16 FROM public.audit_log WHERE table_name='operation_command_drafts'),'draft rows or their audit trail drifted');

-- Direct DML is refused before any trigger for authenticated and service_role, with or without the forged setting.
SELECT pg_temp.d_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.d_denied($q$INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,target_id,request_key,arguments) SELECT org,site_a,maint,'record_work',pg_temp.rid('occ_a2_d5'),'forged-000001','{"payload":{}}' FROM df$q$);
SELECT pg_temp.d_denied($q$UPDATE public.operation_command_drafts SET state='pending' WHERE id=pg_temp.rid('d12')$q$);
SELECT pg_temp.d_denied($q$UPDATE public.operation_command_drafts SET arguments='{"payload":{"outcome":"performed"}}' WHERE id=pg_temp.rid('d4')$q$);
SELECT pg_temp.d_denied($q$DELETE FROM public.operation_command_drafts WHERE id=pg_temp.rid('d12')$q$);
SELECT pg_temp.d_denied($q$TRUNCATE public.operation_command_drafts$q$);
SELECT pg_temp.d_denied($q$DELETE FROM public.audit_log WHERE table_name='operation_command_drafts'$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.d_denied($q$UPDATE public.operation_command_drafts SET state='pending' WHERE id=pg_temp.rid('d12')$q$);
SELECT pg_temp.d_denied($q$INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,target_id,request_key,arguments) SELECT org,site_a,maint,'record_work',pg_temp.rid('occ_a2_d5'),'forged-000001','{"payload":{}}' FROM df$q$);
SELECT pg_temp.d_denied($q$SELECT haven.operation_occurrence_token()$q$);
SELECT pg_temp.d_denied($q$SELECT haven.lock_operation_command_draft(pg_temp.rid('d4'))$q$);
SELECT pg_temp.d_denied($q$SELECT haven.operation_command_draft_hash(gen_random_uuid(),'record_work',NULL,'{}')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
RESET ROLE;
SELECT pg_temp.d_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.d_denied($q$SELECT count(*) FROM public.operation_command_drafts$q$);
SELECT pg_temp.d_denied($q$INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,target_id,request_key,arguments) SELECT org,site_a,maint,'record_work',pg_temp.rid('occ_a2_d5'),'forged-000002','{"payload":{}}' FROM df$q$);
SELECT pg_temp.d_denied($q$UPDATE public.operation_command_drafts SET state='discarded',discarded_at=now() WHERE id=pg_temp.rid('d4')$q$);
SELECT pg_temp.d_denied($q$DELETE FROM public.operation_command_drafts WHERE id=pg_temp.rid('d12')$q$);
SELECT pg_temp.d_denied($q$TRUNCATE public.operation_command_drafts$q$);
SELECT pg_temp.d_denied($q$SELECT public.save_operation_command_draft_review('svc-000001',pg_temp.draft('record_work',pg_temp.rid('occ_a2_d5'),pg_temp.rec(1,'svc')))$q$);
SELECT pg_temp.d_denied($q$SELECT public.resume_operation_command_draft_review(pg_temp.rid('d4'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.reconcile_operation_command_draft_review(pg_temp.rid('d4'))$q$);
SELECT pg_temp.d_denied($q$SELECT public.discard_operation_command_draft_review(pg_temp.rid('d4'))$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.d_denied($q$UPDATE public.operation_command_drafts SET state='discarded',discarded_at=now() WHERE id=pg_temp.rid('d4')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
RESET ROLE;
SELECT pg_temp.d_clear();
SELECT pg_temp.d_assert((SELECT count(*)=16 FROM public.operation_command_drafts) AND (SELECT state='pending' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d4')) AND (SELECT state='discarded' FROM public.operation_command_drafts WHERE id=pg_temp.rid('d12')),'a refused DML changed a draft');
-- Not even the owner token rewrites a draft's identity, moves a state backwards or sideways, trusts a supplied state, fingerprint or expiry, or deletes history.
DO $$ BEGIN PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET actor_id=(SELECT nurse FROM df) WHERE id=pg_temp.rid('d4')$q$,'Draft identity is immutable',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET arguments='{"payload":{"outcome":"performed"}}' WHERE id=pg_temp.rid('d4')$q$,'Draft identity is immutable',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET expires_at=expires_at+interval '1 day' WHERE id=pg_temp.rid('d4')$q$,'Draft identity is immutable',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET request_key='rewritten-0001' WHERE id=pg_temp.rid('d4')$q$,'Draft identity is immutable',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET target_id=pg_temp.rid('occ_a2_d5') WHERE id=pg_temp.rid('d4')$q$,'Draft identity is immutable',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET state='pending',discarded_at=NULL WHERE id=pg_temp.rid('d12')$q$,'Draft state moves forward only',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET state='reconciled',reconciled_at=now(),reconciled_record='{"kind":"receipt"}',discarded_at=NULL WHERE id=pg_temp.rid('d12')$q$,'Draft state moves forward only',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET state='pending' WHERE id=pg_temp.rid('e1')$q$,'Draft state moves forward only',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET reconciled_at=now() WHERE id=pg_temp.rid('d4')$q$,'Draft state moves forward only',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET state='discarded' WHERE id=pg_temp.rid('d4')$q$,'violates check constraint',NULL,'23514');
SELECT pg_temp.d_expect($q$UPDATE public.operation_command_drafts SET state='reconciled',reconciled_at=now() WHERE id=pg_temp.rid('d4')$q$,'violates check constraint',NULL,'23514');
SELECT pg_temp.d_expect($q$DELETE FROM public.operation_command_drafts WHERE id=pg_temp.rid('d12')$q$,'Drafts are immutable history',NULL,'23514');
SELECT pg_temp.d_expect($q$TRUNCATE public.operation_command_drafts$q$,'truncate');
SELECT pg_temp.d_expect($q$INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,target_id,request_key,arguments) SELECT org,site_a,maint,'record_work',pg_temp.rid('occ_a2_d5'),'short','{"payload":{}}' FROM df$q$,'violates check constraint',NULL,'23514');
SELECT pg_temp.d_expect($q$INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,request_key,arguments) SELECT org,site_a,maint,'record_work','forged-000003','{"payload":{}}' FROM df$q$,'violates check constraint',NULL,'23514');
-- A supplied state, expiry, fingerprint and reconciliation on insert are ignored: the row is pending, server-fingerprinted and expires 24 hours after creation.
INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,command,target_id,request_key,arguments,arguments_hash,state,expires_at,reconciled_at,reconciled_record,discarded_at,revision)
 SELECT org,site_a,maint,'record_work',pg_temp.rid('occ_a2_d5'),'forged-000004','{"payload":{}}',repeat('f',64),'reconciled',now()+interval '10 days',now(),'{"kind":"receipt"}',now(),repeat('f',64) FROM df;
SELECT pg_temp.d_assert((SELECT state='pending' AND reconciled_at IS NULL AND reconciled_record IS NULL AND discarded_at IS NULL AND expires_at=created_at+interval '24 hours' AND revision<>repeat('f',64)
 AND arguments_hash=haven.operation_command_draft_hash(actor_id,command,target_id,arguments) FROM public.operation_command_drafts WHERE request_key='forged-000004'),'a supplied state, expiry or fingerprint was trusted');
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.d_assert((SELECT count(*)=17 FROM public.operation_command_drafts) AND (SELECT count(*)=0 FROM public.operation_command_drafts WHERE (state='reconciled')<>(reconciled_at IS NOT NULL) OR (state='discarded')<>(discarded_at IS NOT NULL)),'draft shape drifted');

-- Posture: the public commands are invokers granted to authenticated only; the helpers are executable by no client role.
SELECT pg_temp.d_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%\_operation\_command\_draft\_review' AND p.prosecdef)
 AND (SELECT count(*)=4 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%\_operation\_command\_draft\_review'),'public draft RPC is definer or missing');
SELECT pg_temp.d_assert(has_function_privilege('authenticated','public.save_operation_command_draft_review(text,jsonb)','EXECUTE') AND has_function_privilege('authenticated','public.resume_operation_command_draft_review(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.save_operation_command_draft_review(text,jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.save_operation_command_draft_review(text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.reconcile_operation_command_draft_review(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.discard_operation_command_draft_review(uuid)','EXECUTE'),'draft command grants wrong');
SELECT pg_temp.d_assert((SELECT bool_and(NOT has_function_privilege(r,f,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
 'haven.lock_operation_command_draft(uuid)','haven.lock_operation_command_draft_authority(public.operation_command_drafts)','haven.operation_command_draft_record(public.operation_command_drafts)',
 'haven.operation_command_draft_record_kind(public.operation_command_drafts)','haven.operation_command_draft_hash(uuid,text,uuid,jsonb)','haven.guard_operation_command_draft()']) f),'a draft helper is executable by a client role');
SELECT pg_temp.d_assert(NOT has_table_privilege('service_role','public.operation_command_drafts','SELECT') AND NOT has_table_privilege('authenticated','public.operation_command_drafts','INSERT')
 AND NOT has_table_privilege('authenticated','public.operation_command_drafts','UPDATE') AND NOT has_table_privilege('authenticated','public.operation_command_drafts','DELETE') AND NOT has_table_privilege('anon','public.operation_command_drafts','SELECT'),'draft table grants wrong');
SELECT pg_temp.d_assert((SELECT count(*)=1 FROM pg_policies WHERE tablename='audit_log' AND policyname='operation_command_draft_audit_current' AND permissive='RESTRICTIVE'),'generic audit read not restricted for drafts');
SELECT 'COL-146 draft behavior PASS' result;
ROLLBACK;
