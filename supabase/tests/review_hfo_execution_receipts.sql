-- COL-142: atomic, idempotent execution receipts on the disposable replay.
-- Proves one attributable receipt per click on a managed occurrence: session
-- recorder and server recorded-at, distinct performed-at that is never in the
-- future, explicit late and on-behalf entries, values validated against the
-- governing versions, missing required evidence saved as performed but never
-- completed, independent verification, atomic issue creation, replay by key
-- and content, conflicts that name the current receipt, and legacy paths kept
-- for legacy rows. Authenticated SQL behaviour with synthetic fixtures; not
-- hosted, browser or staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.r_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-142 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.r_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-142 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.r_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR position(detail_fragment IN coalesce(d,''))>0) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-142 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations records work, creates an issue, binds a subject or confirms a schedule.
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts),'a migration created a receipt');
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM public.operation_issues),'a migration created an issue');
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM public.operation_task_instances WHERE occurrence_kind IS NOT NULL OR execution_state IS NOT NULL),'a migration created a managed occurrence');
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM public.operation_activity_bindings),'a migration created a binding');
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_status='confirmed' OR schedule_rule IS NOT NULL),'a migration stored or confirmed a schedule');

-- FIXTURES-BEGIN
CREATE TEMP TABLE rf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,gen_random_uuid() former,gen_random_uuid() former_session,gen_random_uuid() mgr,gen_random_uuid() mgr_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_fac,gen_random_uuid() act_res,gen_random_uuid() act_emp,
 gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() res1,gen_random_uuid() emp1,gen_random_uuid() vendor_ok,gen_random_uuid() vendor_no,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,gen_random_uuid() subj_emp1,gen_random_uuid() legacy_task,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE rf ADD COLUMN d2 date,ADD COLUMN d3 date,ADD COLUMN d4 date,ADD COLUMN d5 date,ADD COLUMN d6 date;
UPDATE rf SET d2=d1+7,d3=d1+14,d4=d1+21,d5=d1+28,d6=d1+35;
CREATE TEMP TABLE rf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE rf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON rf TO authenticated,service_role; GRANT ALL ON rf_ids,rf_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Receipt Site B','Test','Test','00000',1 FROM rf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM rf
 UNION ALL SELECT admin_a,admin_a||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM rf
 UNION ALL SELECT admin_b,admin_b||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM rf
 UNION ALL SELECT maint,maint||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM rf
 UNION ALL SELECT nurse,nurse||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM rf
 UNION ALL SELECT aide,aide||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM rf
 UNION ALL SELECT former,former||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Former aide"}'::jsonb FROM rf
 UNION ALL SELECT mgr,mgr||'@receipt.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Manager"}'::jsonb FROM rf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@receipt.invalid','Corporate','owner'::public.app_role,org,true FROM rf
 UNION ALL SELECT admin_a,admin_a||'@receipt.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM rf
 UNION ALL SELECT admin_b,admin_b||'@receipt.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM rf
 UNION ALL SELECT maint,maint||'@receipt.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM rf
 UNION ALL SELECT nurse,nurse||'@receipt.invalid','Nurse','nurse'::public.app_role,org,true FROM rf
 UNION ALL SELECT aide,aide||'@receipt.invalid','Aide','housekeeper'::public.app_role,org,true FROM rf
 UNION ALL SELECT former,former||'@receipt.invalid','Former aide','housekeeper'::public.app_role,org,true FROM rf
 UNION ALL SELECT mgr,mgr||'@receipt.invalid','Manager','manager'::public.app_role,org,true FROM rf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM rf UNION ALL SELECT admin_a_session,admin_a FROM rf UNION ALL SELECT admin_b_session,admin_b FROM rf
 UNION ALL SELECT maint_session,maint FROM rf UNION ALL SELECT nurse_session,nurse FROM rf UNION ALL SELECT aide_session,aide FROM rf UNION ALL SELECT former_session,former FROM rf UNION ALL SELECT mgr_session,mgr FROM rf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at)
 SELECT owner_actor,site_a,org,NULL::timestamptz FROM rf UNION ALL SELECT admin_a,site_a,org,NULL::timestamptz FROM rf UNION ALL SELECT admin_b,site_b,org,NULL::timestamptz FROM rf UNION ALL SELECT maint,site_a,org,NULL::timestamptz FROM rf
 UNION ALL SELECT nurse,site_a,org,NULL::timestamptz FROM rf UNION ALL SELECT aide,site_a,org,NULL::timestamptz FROM rf UNION ALL SELECT mgr,site_a,org,NULL::timestamptz FROM rf UNION ALL SELECT former,site_a,org,clock_timestamp()-interval '1 day' FROM rf;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM rf
 UNION ALL SELECT org,site_a,admin_a,'employee_personnel',owner_actor,'Fixture personnel authority',true FROM rf
 UNION ALL SELECT org,site_a,owner_actor,'employee_personnel',owner_actor,'Fixture corporate personnel reviewer',true FROM rf
 UNION ALL SELECT org,site_a,owner_actor,'resident',owner_actor,'Fixture corporate resident reviewer',true FROM rf
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM rf;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-142-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM rf
 UNION ALL SELECT act_fac,org,NULL,'hfo-142-fixture:'||act_fac,'Generator weekly test','structured_observation','facility','admin_log' FROM rf
 UNION ALL SELECT act_res,org,NULL,'hfo-142-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM rf
 UNION ALL SELECT act_emp,org,NULL,'hfo-142-fixture:'||act_emp,'Employee file review','record_review','employee','admin_log' FROM rf;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM rf UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM rf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM rf;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT emp1,org,site_a,'Protected','Employee','resident_aide',current_date FROM rf;
INSERT INTO public.vendors(id,organization_id,name) SELECT vendor_ok,org,'Linked generator service' FROM rf UNION ALL SELECT vendor_no,org,'Unlinked vendor' FROM rf;
INSERT INTO public.vendor_facilities(organization_id,vendor_id,facility_id) SELECT org,vendor_ok,site_a FROM rf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM rf UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM rf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM rf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) SELECT subj_emp1,org,site_a,'employee',emp1 FROM rf;
CREATE FUNCTION pg_temp.r_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f rf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM rf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSIF p_kind='mgr' THEN u:=f.mgr; sess:=f.mgr_session; r:='manager';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.r_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.r_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,p_shift text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb,'shift',p_shift)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col142-'||p $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.r_login(text),pg_temp.r_service(),pg_temp.r_clear(),pg_temp.k(text) TO authenticated,service_role;

-- Central versions with input, evidence and review rules (owner) and site configurations (site admin).
SELECT pg_temp.r_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','pads_ok','label','Pads in date','type','boolean','required',true),jsonb_build_object('key','battery_pct','label','Battery','type','number','required',true,'min',0,'max',100),
  jsonb_build_object('key','condition','label','Condition','type','choice','required',false,'choices',jsonb_build_array('good','worn')),
  jsonb_build_object('key','notes','label','Notes','type','text','required',false),jsonb_build_object('key','checked_at','label','Checked at','type','datetime','required',false)))) FROM rf;
INSERT INTO rf_results SELECT 'v_fac',public.save_operation_requirement_draft_review(act_fac,jsonb_build_object('title','Generator weekly test','wording','Run the generator.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin','housekeeper'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always')))) FROM rf;
INSERT INTO rf_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','reading','label','Weight reading','min_count',1,'when','on_failure')))) FROM rf;
INSERT INTO rf_results SELECT 'v_emp',public.save_operation_requirement_draft_review(act_emp,jsonb_build_object('title','Employee file review','wording','Review the personnel file.','allowed_recorder_roles',jsonb_build_array('facility_admin','owner'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','document','label','Signed checklist','min_count',1,'when','always')))) FROM rf;
INSERT INTO rf_ids SELECT label,(result->>'id')::uuid FROM rf_results WHERE label LIKE 'v\_%';
INSERT INTO rf_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,clock_timestamp()) FROM rf_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.r_assert((SELECT count(*)=4 FROM rf_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM rf_ids WHERE label='v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb)) FROM rf;
INSERT INTO rf_results SELECT 'fr_fac',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM rf_ids WHERE label='v_fac'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"08:00"}}'::jsonb)) FROM rf;
INSERT INTO rf_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM rf_ids WHERE label='v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM rf;
-- The site list governs recording here: only the site administrator records employee reviews.
INSERT INTO rf_results SELECT 'fr_emp',public.save_operation_facility_requirement_draft_review(act_emp,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM rf_ids WHERE label='v_emp'),
 'local_allowed_recorder_roles',jsonb_build_array('facility_admin'),'override_source','facility_policy','applicability_reason','Site administrator reviews personnel files',
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM rf;
INSERT INTO rf_ids SELECT label,(result->>'id')::uuid FROM rf_results WHERE label LIKE 'fr\_%';
INSERT INTO rf_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM rf_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.r_assert((SELECT count(*)=4 FROM rf_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO rf_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',clock_timestamp()) FROM rf;
INSERT INTO rf_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',clock_timestamp()) FROM rf;
INSERT INTO rf_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',clock_timestamp()) FROM rf;
INSERT INTO rf_results SELECT 'b_emp1',public.enroll_operation_binding_review(act_emp,site_a,subj_emp1,'employee_personnel',NULL,'{"source":"admin_log","reason":"Personnel file roster"}',clock_timestamp()) FROM rf;
RESET ROLE;
-- Occurrences for four weeks from the service generator.
SELECT pg_temp.r_service();
SET LOCAL ROLE service_role;
INSERT INTO rf_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,(SELECT id FROM rf_ids WHERE label='fr_asset'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00',NULL,120),pg_temp.occ(d2,'America/New_York','10:00',NULL,120),pg_temp.occ(d3,'America/New_York','10:00',NULL,120),pg_temp.occ(d4,'America/New_York','10:00',NULL,120),pg_temp.occ(d5,'America/New_York','10:00',NULL,120),pg_temp.occ(d6,'America/New_York','10:00',NULL,120)),pg_temp.run('run-asset',d1,d6,(SELECT id FROM rf_ids WHERE label='fr_asset'))) FROM rf;
INSERT INTO rf_results SELECT 'g_fac',public.generate_operation_occurrences_service(site_a,(SELECT id FROM rf_ids WHERE label='fr_fac'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','08:00',NULL),pg_temp.occ(d2,'America/New_York','08:00',NULL),pg_temp.occ(d3,'America/New_York','08:00',NULL)),pg_temp.run('run-fac',d1,d3,(SELECT id FROM rf_ids WHERE label='fr_fac'))) FROM rf;
INSERT INTO rf_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,(SELECT id FROM rf_ids WHERE label='fr_res'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','09:00',NULL),pg_temp.occ(d2,'America/New_York','09:00',NULL),pg_temp.occ(d3,'America/New_York','09:00',NULL)),pg_temp.run('run-res',d1,d3,(SELECT id FROM rf_ids WHERE label='fr_res'))) FROM rf;
INSERT INTO rf_results SELECT 'g_emp',public.generate_operation_occurrences_service(site_a,(SELECT id FROM rf_ids WHERE label='fr_emp'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','09:00',NULL)),pg_temp.run('run-emp',d1,d1,(SELECT id FROM rf_ids WHERE label='fr_emp'))) FROM rf;
SELECT pg_temp.r_assert((SELECT (result->'counts'->>'created')::int=12 FROM rf_results WHERE label='g_asset'),'asset occurrences not generated');
SELECT pg_temp.r_assert((SELECT (result->'counts'->>'created')::int=3 FROM rf_results WHERE label='g_fac'),'facility occurrences not generated');
SELECT pg_temp.r_assert((SELECT (result->'counts'->>'created')::int=3 FROM rf_results WHERE label='g_res'),'resident occurrences not generated');
SELECT pg_temp.r_assert((SELECT (result->'counts'->>'created')::int=1 FROM rf_results WHERE label='g_emp'),'employee occurrence not generated');
INSERT INTO rf_ids SELECT 'occ_a1_'||n,t.id FROM rf CROSS JOIN LATERAL (VALUES('d1',rf.d1),('d2',rf.d2),('d3',rf.d3),('d4',rf.d4),('d5',rf.d5),('d6',rf.d6)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=rf.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO rf_ids SELECT 'occ_a2_'||n,t.id FROM rf CROSS JOIN LATERAL (VALUES('d1',rf.d1),('d2',rf.d2),('d3',rf.d3),('d4',rf.d4),('d5',rf.d5),('d6',rf.d6)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=rf.subj_asset2 AND t.assigned_shift_date=x.d;
INSERT INTO rf_ids SELECT 'occ_fac_'||n,t.id FROM rf CROSS JOIN LATERAL (VALUES('d1',rf.d1),('d2',rf.d2),('d3',rf.d3)) x(n,d) JOIN public.operation_task_instances t ON t.activity_id=rf.act_fac AND t.assigned_shift_date=x.d;
INSERT INTO rf_ids SELECT 'occ_res_'||n,t.id FROM rf CROSS JOIN LATERAL (VALUES('d1',rf.d1),('d2',rf.d2),('d3',rf.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=rf.subj_res1 AND t.assigned_shift_date=x.d;
INSERT INTO rf_ids SELECT 'occ_emp_d1',t.id FROM rf JOIN public.operation_task_instances t ON t.subject_id=rf.subj_emp1 AND t.assigned_shift_date=rf.d1;
SELECT pg_temp.r_assert((SELECT count(*)=19 FROM rf_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
SELECT pg_temp.r_assert((SELECT bool_and(execution_state='none' AND effective_receipt_id IS NULL AND performed_at IS NULL) FROM public.operation_task_instances WHERE id IN(SELECT id FROM rf_ids WHERE label LIKE 'occ\_%')),'generated occurrences did not start with no execution');
RESET ROLE;
-- A legacy facility row (no managed identity) keeps the legacy completion path.
SELECT pg_temp.r_clear();
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,assigned_role)
 SELECT legacy_task,org,site_a,s.id,'facility','Legacy duty','safety','on_demand',current_date,'maintenance_role' FROM rf JOIN public.operation_activity_subjects s ON s.facility_id=rf.site_a AND s.subject_kind='facility';
SELECT pg_temp.r_assert((SELECT execution_state IS NULL AND occurrence_kind IS NULL FROM public.operation_task_instances WHERE id=(SELECT legacy_task FROM rf)),'legacy row acquired an execution state');
-- FIXTURES-END

-- Routine self record: one attributable receipt, server times, mirrors, audit.
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_a1',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d1'),pg_temp.k('a1-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":90},"note":"Pads and battery fine"}');
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean=false AND result->'receipt'->>'receipt_kind'='performance' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM rf) AND result->'receipt'->>'recorder_role'='maintenance_role'
 AND result->'receipt'->>'performer_kind'='self' AND result->'receipt'->>'entry_kind'='routine' AND result->'receipt'->>'outcome'='performed' AND result->'receipt'->>'evidence_status'='not_required'
 AND result->'receipt'->>'completion_state'='completed' AND (result->'receipt'->>'recorded_at')::timestamptz BETWEEN clock_timestamp()-interval '1 minute' AND clock_timestamp()
 AND abs(extract(epoch FROM (result->'receipt'->>'recorded_at')::timestamptz-(result->'receipt'->>'performed_at')::timestamptz))<5
 AND result->'receipt'->'values'='{"pads_ok":true,"battery_pct":90}'::jsonb AND result->'receipt'->>'revision' IS NOT NULL AND jsonb_typeof(result->'issue')='null'
 AND result->'occurrence'->>'status'='completed' AND result->'occurrence'->>'execution_state'='completed' FROM rf_results WHERE label='rec_a1'),'routine receipt is not attributable or complete');
INSERT INTO rf_ids SELECT 'r_a1',(result->'receipt'->>'id')::uuid FROM rf_results WHERE label='rec_a1';
SELECT pg_temp.r_assert((SELECT status='completed' AND execution_state='completed' AND effective_receipt_id=(SELECT id FROM rf_ids WHERE label='r_a1') AND signed_by=(SELECT maint FROM rf) AND verified_by=(SELECT maint FROM rf)
 AND completed_at IS NOT NULL AND performed_at IS NOT NULL AND sla_met=true AND completion_notes='Pads and battery fine' AND verification_receipt_id IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a1_d1')),'occurrence mirrors not set on completion');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_a1_d1') AND event_type='completed' AND actor_id=(SELECT maint FROM rf)
 AND (event_data->>'receipt_id')::uuid=(SELECT id FROM rf_ids WHERE label='r_a1') AND event_data->>'completion_state'='completed'),'completion audit row missing');
SET LOCAL ROLE authenticated;
-- Replay: same key and content returns the same receipt; changed content conflicts; a different key on a recorded occurrence names the current receipt.
INSERT INTO rf_results SELECT 'rec_a1_replay',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d1'),pg_temp.k('a1-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":90},"note":"Pads and battery fine"}');
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean AND (result->'receipt'->>'id')::uuid=(SELECT id FROM rf_ids WHERE label='r_a1') FROM rf_results WHERE label='rec_a1_replay'),'replay did not return the same receipt');
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_a1_d1')),'replay created a second receipt');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d1'),pg_temp.k('a1-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":91}}')$q$,'already saved with different content');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d1'),pg_temp.k('a1-000002'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":90}}')$q$,'already recorded for this occurrence','current_receipt_id='||(SELECT id FROM rf_ids WHERE label='r_a1'));
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_execution_receipts),'a rejected record created a receipt');
-- Performed-at is distinct from recorded-at and never in the future; early work needs an explicit late entry.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d1'),pg_temp.k('a2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":80}'::jsonb,'performed_at',clock_timestamp()+interval '1 hour'))$q$,'cannot be in the future');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d1'),pg_temp.k('a2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":80}'::jsonb,'performed_at',clock_timestamp()-interval '2 hours'))$q$,'must be entered as late');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d1'),pg_temp.k('a2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":80}'::jsonb,'performed_at',clock_timestamp()-interval '2 hours','entry_kind','late'))$q$,'entry_reason is required');
INSERT INTO rf_results SELECT 'rec_a2',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d1'),pg_temp.k('a2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":80}'::jsonb,'performed_at',clock_timestamp()-interval '2 hours','entry_kind','late','entry_reason','Recorded after the round'));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'entry_kind'='late' AND result->'receipt'->>'entry_reason'='Recorded after the round' AND (result->'receipt'->>'recorded_at')::timestamptz-(result->'receipt'->>'performed_at')::timestamptz BETWEEN interval '119 minutes' AND interval '121 minutes'
 AND result->'occurrence'->>'status'='completed' FROM rf_results WHERE label='rec_a2'),'late entry did not keep the actual performance time');
SELECT pg_temp.r_assert((SELECT performed_at<completed_at-interval '119 minutes' FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d1')),'occurrence did not keep performed and recorded instants apart');
-- Values against the versioned inputs.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"battery_pct":50}}')$q$,'input pads_ok is required');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":"full"}}')$q$,'input battery_pct must be a number');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":150}}')$q$,'input battery_pct must be at most 100');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50,"extra":1}}')$q$,'value extra is not a defined input');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50,"condition":"rusty"}}')$q$,'input condition must be one of the listed choices');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":{"pads_ok":"yes","battery_pct":50}}')$q$,'input pads_ok must be true or false');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","values":[1]}')$q$,'values must be an object');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"done"}')$q$,'outcome must be performed, failed or not_performed');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),'{"outcome":"performed","recorder_id":"x"}')$q$,'not editable');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),'short','{"outcome":"performed"}')$q$,'request key is required');
SELECT pg_temp.r_assert((SELECT count(*)=2 FROM public.operation_execution_receipts),'a rejected record created a receipt');
-- On behalf of another performer: current site staff, a linked vendor, or an explicit unknown historical performer.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'performer',jsonb_build_object('kind','other_staff','user_id',(SELECT aide FROM rf))))$q$,'must be entered on behalf');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Aide performed the check','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT former FROM rf))))$q$,'not current staff at this site');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Aide performed the check','performer',jsonb_build_object('kind','other_staff')))$q$,'other_staff requires user_id');
INSERT INTO rf_results SELECT 'rec_a1_d2',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Aide performed the check','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT aide FROM rf))));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'performer_kind'='other_staff' AND (result->'receipt'->>'performer_user_id')::uuid=(SELECT aide FROM rf) AND (result->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM rf) AND result->'receipt'->>'entry_kind'='on_behalf' FROM rf_results WHERE label='rec_a1_d2'),'on-behalf receipt lost the performer or recorder');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d2'),pg_temp.k('a2d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Aide performed the check','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT aide FROM rf),'label','Aide')))$q$,'A staff performer carries no label');
-- Replay stays idempotent after validation drifts: the performer's site access is revoked, the same request still returns the receipt.
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT aide FROM rf);
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_a1_d2_replay',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d2'),pg_temp.k('a1d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Aide performed the check','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT aide FROM rf))));
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean AND result->'receipt'->>'id'=(SELECT result->'receipt'->>'id' FROM rf_results WHERE label='rec_a1_d2') FROM rf_results WHERE label='rec_a1_d2_replay'),'replay after performer drift was not idempotent');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT aide FROM rf);
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d2'),pg_temp.k('a2d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Vendor serviced','performer',jsonb_build_object('kind','vendor','vendor_id',(SELECT vendor_no FROM rf))))$q$,'not linked to this site');
INSERT INTO rf_results SELECT 'rec_a2_d2',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d2'),pg_temp.k('a2d2-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Vendor serviced','performer',jsonb_build_object('kind','vendor','vendor_id',(SELECT vendor_ok FROM rf))));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'performer_kind'='vendor' AND (result->'receipt'->>'performer_vendor_id')::uuid=(SELECT vendor_ok FROM rf) AND result->'receipt'->>'performer_label'='Linked generator service' FROM rf_results WHERE label='rec_a2_d2'),'vendor receipt lost the vendor');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d3'),pg_temp.k('a1d3-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Paper log','performer',jsonb_build_object('kind','unknown_historical','label','Paper log entry')))$q$,'requires a late entry');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d3'),pg_temp.k('a1d3-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','late','entry_reason','Paper log','performed_at',clock_timestamp()-interval '2 days','performer',jsonb_build_object('kind','unknown_historical')))$q$,'requires a label');
INSERT INTO rf_results SELECT 'rec_a1_d3',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d3'),pg_temp.k('a1d3-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','late','entry_reason','Paper log','performed_at',clock_timestamp()-interval '2 days','performer',jsonb_build_object('kind','unknown_historical','label','Paper log entry')));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'performer_kind'='unknown_historical' AND result->'receipt'->>'performer_label'='Paper log entry' AND result->'receipt'->>'entry_kind'='late' FROM rf_results WHERE label='rec_a1_d3'),'unknown historical receipt not recorded');
-- Lateness applies to every entry kind; an on-behalf entry performed days ago is a late entry.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d5'),pg_temp.k('a1d5-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'performer',jsonb_build_object('kind','self','label','Me')))$q$,'A staff performer carries no label');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d5'),pg_temp.k('a1d5-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','on_behalf','entry_reason','Nurse did it','performed_at',clock_timestamp()-interval '3 days','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT nurse FROM rf))))$q$,'must be entered as late');
INSERT INTO rf_results SELECT 'rec_a1_d5',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d5'),pg_temp.k('a1d5-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":50}'::jsonb,'entry_kind','late','entry_reason','Nurse did it three days ago','performed_at',clock_timestamp()-interval '3 days','performer',jsonb_build_object('kind','other_staff','user_id',(SELECT nurse FROM rf))));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'entry_kind'='late' AND result->'receipt'->>'performer_kind'='other_staff' AND (result->'receipt'->>'performer_user_id')::uuid=(SELECT nurse FROM rf) FROM rf_results WHERE label='rec_a1_d5'),'late on-behalf entry not recorded');
-- Text, datetime and lower-bound inputs; a JSON-null optional value; an issue supplied with a performed outcome.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d5'),pg_temp.k('a2d5-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50,"notes":""}}')$q$,'input notes must be text');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d5'),pg_temp.k('a2d5-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50,"checked_at":"yesterday"}}')$q$,'input checked_at must be a timestamp');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d5'),pg_temp.k('a2d5-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":-1}}')$q$,'input battery_pct must be at least 0');
INSERT INTO rf_results SELECT 'rec_a2_d5',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d5'),pg_temp.k('a2d5-000001'),jsonb_build_object('outcome','performed','values',jsonb_build_object('pads_ok',true,'battery_pct',0,'condition',NULL,'notes','Cabinet latch loose','checked_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'issue',jsonb_build_object('kind','problem','summary','Cabinet latch loose')));
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='completed' AND result->'issue'->>'issue_kind'='problem' AND (result->'receipt'->>'issue_id')::uuid=(result->'issue'->>'id')::uuid AND result->'receipt'->'values'->>'notes'='Cabinet latch loose' AND result->'occurrence'->>'status'='completed' FROM rf_results WHERE label='rec_a2_d5'),'performed outcome with an issue not recorded');
-- The governing recorder list decides, not the legacy assignment: a listed housekeeper records; an unlisted manager with a site grant is denied.
RESET ROLE;
SELECT pg_temp.r_login('mgr');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d3'),pg_temp.k('facd3-000009'),'{"outcome":"performed"}')$q$);
RESET ROLE;
SELECT pg_temp.r_login('aide');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_fac_d3',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d3'),pg_temp.k('facd3-000001'),'{"outcome":"performed"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'recorder_role'='housekeeper' AND result->'receipt'->>'completion_state'='performed_missing_evidence' FROM rf_results WHERE label='rec_fac_d3'),'listed housekeeper could not record');
SELECT pg_temp.r_assert((SELECT assigned_role='maintenance_role' AND signed_by=(SELECT aide FROM rf) FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_fac_d3')),'assignment still decided recording');
RESET ROLE;
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
-- Missing required evidence: saved as performed, never completed; on_failure evidence applies only to failed outcomes.
INSERT INTO rf_results SELECT 'rec_fac',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d1'),pg_temp.k('fac-000001'),'{"outcome":"performed"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'receipt'->>'evidence_status'='missing' AND result->'receipt'->'missing_evidence'->0->>'label'='Panel photo'
 AND result->'occurrence'->>'status'='in_progress' AND result->'occurrence'->>'execution_state'='performed_missing_evidence' FROM rf_results WHERE label='rec_fac'),'missing evidence reported complete');
SELECT pg_temp.r_assert((SELECT status='in_progress' AND completed_at IS NULL AND verified_by IS NULL AND performed_at IS NOT NULL AND effective_receipt_id IS NOT NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_fac_d1')),'missing-evidence occurrence was completed');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_fac_d1') AND event_type='recorded' AND event_data->>'completion_state'='performed_missing_evidence'),'recorded audit row missing');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_fac_replay',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d1'),pg_temp.k('fac-000001'),'{"outcome":"performed"}');
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean AND result->'occurrence'->>'execution_state'='performed_missing_evidence' FROM rf_results WHERE label='rec_fac_replay'),'missing-evidence replay failed');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d1'),pg_temp.k('fac-000009'),'{"outcome":"performed"}')$q$,'already recorded for this occurrence');
-- Failed outcome creates its issue atomically; not_performed needs a reason.
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d3'),pg_temp.k('a2d3-000001'),'{"outcome":"failed","values":{"pads_ok":false,"battery_pct":10}}')$q$,'requires an issue');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d3'),pg_temp.k('a2d3-000001'),'{"outcome":"failed","values":{"pads_ok":false,"battery_pct":10},"issue":{"summary":""}}')$q$,'issue summary must be text');
INSERT INTO rf_results SELECT 'rec_a2_d3',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d3'),pg_temp.k('a2d3-000001'),'{"outcome":"failed","values":{"pads_ok":false,"battery_pct":10},"issue":{"summary":"Pads expired and battery low","severity":"high"}}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='failed' AND result->'issue'->>'issue_kind'='failed_result' AND result->'issue'->>'status'='open' AND result->'issue'->>'severity'='high'
 AND (result->'issue'->>'receipt_id')::uuid=(result->'receipt'->>'id')::uuid AND (result->'receipt'->>'issue_id')::uuid=(result->'issue'->>'id')::uuid AND result->'occurrence'->>'status'='in_progress' FROM rf_results WHERE label='rec_a2_d3'),'failed outcome did not create a linked open issue');
INSERT INTO rf_ids SELECT 'issue_a2_d3',(result->'issue'->>'id')::uuid FROM rf_results WHERE label='rec_a2_d3';
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_issues WHERE id=(SELECT id FROM rf_ids WHERE label='issue_a2_d3') AND task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_a2_d3') AND reported_by=(SELECT maint FROM rf)),'issue not readable by its reporter');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_a2_d3') AND event_type='issue_reported' AND (event_data->>'issue_id')::uuid=(SELECT id FROM rf_ids WHERE label='issue_a2_d3')),'issue audit row missing');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d2'),pg_temp.k('facd2-000001'),'{"outcome":"not_performed"}')$q$,'not_performed requires entry_reason');
INSERT INTO rf_results SELECT 'rec_fac_d2',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_fac_d2'),pg_temp.k('facd2-000001'),'{"outcome":"not_performed","entry_reason":"Generator out for repair"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='not_performed' AND result->'receipt'->>'evidence_status'='not_required' AND result->'occurrence'->>'status'='in_progress' FROM rf_results WHERE label='rec_fac_d2'),'not_performed did not record');
RESET ROLE;
-- Review-required work: performance waits for an independent verification; the verifier cannot be the recorder or the performer.
SELECT pg_temp.r_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_res',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('res-000001'),'{"outcome":"performed","note":"Weight stable"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='awaiting_verification' AND result->'receipt'->>'evidence_status'='not_required' AND result->'occurrence'->>'status'='in_progress' AND result->'occurrence'->>'execution_state'='awaiting_verification' FROM rf_results WHERE label='rec_res'),'review-required work did not wait for verification');
SELECT pg_temp.r_assert((SELECT signed_by=(SELECT nurse FROM rf) AND second_sign_by IS NULL AND verified_by IS NULL AND completed_at IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_res_d1')),'awaiting verification mirrors wrong');
SELECT pg_temp.r_denied($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000001'),'{"decision":"verified"}')$q$);
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_res_d1') AND event_type='signed'),'signed audit row missing');
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000002'),'{"decision":"verified"}')$q$);
RESET ROLE;
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000003'),'{"decision":"rejected"}')$q$,'decision must be verified');
SELECT pg_temp.r_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d2'),pg_temp.k('resv-000004'),'{"decision":"verified"}')$q$,'not awaiting verification');
INSERT INTO rf_results SELECT 'ver_res',public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000003'),'{"decision":"verified","note":"Reviewed"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'receipt_kind'='verification' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT admin_a FROM rf) AND result->'receipt'->>'completion_state'='completed' AND result->'occurrence'->>'status'='completed' AND (result->>'replayed')::boolean=false FROM rf_results WHERE label='ver_res'),'verification did not complete the occurrence');
SELECT pg_temp.r_assert((SELECT status='completed' AND execution_state='completed' AND second_sign_by=(SELECT admin_a FROM rf) AND verified_by=(SELECT admin_a FROM rf) AND signed_by=(SELECT nurse FROM rf) AND verification_receipt_id=(SELECT (result->'receipt'->>'id')::uuid FROM rf_results WHERE label='ver_res') AND completed_at IS NOT NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_res_d1')),'verification mirrors wrong');
INSERT INTO rf_results SELECT 'ver_res_replay',public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000003'),'{"decision":"verified","note":"Reviewed"}');
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean AND result->'receipt'->>'id'=(SELECT result->'receipt'->>'id' FROM rf_results WHERE label='ver_res') FROM rf_results WHERE label='ver_res_replay'),'verification replay failed');
SELECT pg_temp.r_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d1'),pg_temp.k('resv-000005'),'{"decision":"verified"}')$q$,'not awaiting verification');
SELECT pg_temp.r_assert((SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_res_d1')),'verification created an extra receipt');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_res_d1') AND event_type='verified') AND (SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM rf_ids WHERE label='occ_res_d1') AND event_type='completed' AND (event_data->>'independent_verification')::boolean),'verification audit rows missing');
-- Review-required with missing evidence: never awaiting verification, never completed; the site list governs who records.
SELECT pg_temp.r_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_emp_d1'),pg_temp.k('emp-000001'),'{"outcome":"performed"}')$q$);
RESET ROLE;
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_emp',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_emp_d1'),pg_temp.k('emp-000001'),'{"outcome":"performed"}');
SELECT pg_temp.r_assert((SELECT result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'occurrence'->>'status'='in_progress' FROM rf_results WHERE label='rec_emp'),'missing evidence did not take precedence over review');
RESET ROLE;
SELECT pg_temp.r_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_emp_d1'),pg_temp.k('empv-000001'),'{"decision":"verified"}')$q$,'not awaiting verification');
RESET ROLE;
-- Recorded work is never hidden by cancellation, and a cancelled occurrence cannot be verified.
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM rf_ids WHERE label='occ_a1_d1'),'Trying to hide it','cancel-a1d1-000001')$q$,'Occurrence has recorded work');
SELECT pg_temp.r_expect($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM rf_ids WHERE label='occ_fac_d1'),'Trying to hide it','cancel-facd1-000001')$q$,'Occurrence has recorded work');
RESET ROLE;
SELECT pg_temp.r_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_res_d3',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d3'),pg_temp.k('resd3-000001'),'{"outcome":"performed"}');
SELECT pg_temp.r_assert((SELECT result->'occurrence'->>'execution_state'='awaiting_verification' FROM rf_results WHERE label='rec_res_d3'),'resident record did not wait for verification');
RESET ROLE;
SELECT pg_temp.r_clear();
-- No command cancels recorded work; the fixture models a pre-existing cancelled row with the owner token and the 337 actor guard paused.
ALTER TABLE public.operation_task_instances DISABLE TRIGGER zz_operation_current_authority;
SELECT set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
UPDATE public.operation_task_instances SET status='cancelled',cancellation_reason='fixture cancellation of recorded work' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_res_d3');
SELECT set_config('haven.operation_occurrence_command','',true);
ALTER TABLE public.operation_task_instances ENABLE TRIGGER zz_operation_current_authority;
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d3'),pg_temp.k('resd3v-000001'),'{"decision":"verified"}')$q$,'Occurrence is cancelled');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT status='cancelled' AND execution_state='awaiting_verification' AND verification_receipt_id IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_res_d3')),'cancelled occurrence was verified');
-- Standalone issue reports perform nothing and change no occurrence.
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'iss_a1',public.report_operation_issue_review(pg_temp.k('iss-000001'),jsonb_build_object('task_instance_id',(SELECT id FROM rf_ids WHERE label='occ_a1_d4'),'kind','help_request','summary','Need a ladder for the wing B unit'));
SELECT pg_temp.r_assert((SELECT result->'issue'->>'status'='open' AND result->'issue'->>'issue_kind'='help_request' AND (result->'issue'->>'task_instance_id')::uuid=(SELECT id FROM rf_ids WHERE label='occ_a1_d4') AND result->'issue'->>'receipt_id' IS NULL AND (result->>'replayed')::boolean=false FROM rf_results WHERE label='iss_a1'),'standalone issue not created');
SELECT pg_temp.r_assert((SELECT status='pending' AND execution_state='none' AND effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a1_d4')),'issue report changed the occurrence');
INSERT INTO rf_results SELECT 'iss_a1_replay',public.report_operation_issue_review(pg_temp.k('iss-000001'),jsonb_build_object('task_instance_id',(SELECT id FROM rf_ids WHERE label='occ_a1_d4'),'kind','help_request','summary','Need a ladder for the wing B unit'));
SELECT pg_temp.r_assert((SELECT (result->>'replayed')::boolean AND result->'issue'->>'id'=(SELECT result->'issue'->>'id' FROM rf_results WHERE label='iss_a1') FROM rf_results WHERE label='iss_a1_replay'),'issue replay failed');
SELECT pg_temp.r_expect($q$SELECT public.report_operation_issue_review(pg_temp.k('iss-000001'),jsonb_build_object('task_instance_id',(SELECT id FROM rf_ids WHERE label='occ_a1_d4'),'kind','help_request','summary','Changed'))$q$,'already saved with different content');
SELECT pg_temp.r_expect($q$SELECT public.report_operation_issue_review(pg_temp.k('iss-000002'),jsonb_build_object('task_instance_id',(SELECT id FROM rf_ids WHERE label='occ_a1_d4'),'kind','problem'))$q$,'issue summary must be text');
SELECT pg_temp.r_expect($q$SELECT public.report_operation_issue_review(pg_temp.k('iss-000002'),jsonb_build_object('kind','problem','summary','No target'))$q$,'are required uuids');
RESET ROLE;
SELECT pg_temp.r_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'iss_res',public.report_operation_issue_review(pg_temp.k('iss-000003'),jsonb_build_object('activity_id',(SELECT act_res FROM rf),'facility_id',(SELECT site_a FROM rf),'subject_id',(SELECT subj_res1 FROM rf),'kind','problem','summary','Scale reads inconsistently'));
SELECT pg_temp.r_assert((SELECT result->'issue'->>'authority_class'='resident' AND result->'issue'->>'task_instance_id' IS NULL FROM rf_results WHERE label='iss_res'),'subject-scoped issue not created');
RESET ROLE;
SELECT pg_temp.r_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.report_operation_issue_review(pg_temp.k('iss-000004'),jsonb_build_object('activity_id',(SELECT act_res FROM rf),'facility_id',(SELECT site_a FROM rf),'subject_id',(SELECT subj_res1 FROM rf),'kind','problem','summary','Foreign site'))$q$);
SELECT pg_temp.r_denied($q$SELECT public.report_operation_issue_review(pg_temp.k('iss-000004'),jsonb_build_object('activity_id',(SELECT act_res FROM rf),'facility_id',(SELECT site_a FROM rf),'subject_id',gen_random_uuid(),'kind','problem','summary','Foreign site'))$q$);
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d4'),pg_temp.k('b-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50}}')$q$);
SELECT pg_temp.r_assert((SELECT count(*)=0 FROM public.operation_execution_receipts) AND (SELECT count(*)=0 FROM public.operation_issues),'the other site can read receipts or issues');
RESET ROLE;
-- Legacy paths: the legacy completion command refuses managed rows and still completes legacy rows.
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.complete_operation_task_review((SELECT id FROM rf_ids WHERE label='occ_a2_d4'),(SELECT maint FROM rf),'maintenance_role','legacy click','{}')$q$,'recorded through the receipt command');
SELECT pg_temp.r_assert((SELECT public.complete_operation_task_review(legacy_task,maint,'maintenance_role','legacy duty done','{}')='completed' FROM rf),'legacy completion path broken');
SELECT pg_temp.r_assert((SELECT status='completed' AND execution_state IS NULL FROM public.operation_task_instances WHERE id=(SELECT legacy_task FROM rf)),'legacy row acquired an execution state');
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT legacy_task FROM rf),pg_temp.k('legacy-000001'),'{"outcome":"performed"}')$q$,'Legacy tasks use the existing completion command');
-- Direct writes: no client DML; the service cannot move performance columns or status without the token; receipts and issues are immutable.
SELECT pg_temp.r_denied($q$UPDATE public.operation_task_instances SET status='completed' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')$q$);
SELECT pg_temp.r_denied($q$UPDATE public.operation_execution_receipts SET note='forged' WHERE id=(SELECT id FROM rf_ids WHERE label='r_a1')$q$);
SELECT pg_temp.r_denied($q$DELETE FROM public.operation_execution_receipts WHERE id=(SELECT id FROM rf_ids WHERE label='r_a1')$q$);
SELECT pg_temp.r_denied($q$INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision)
 SELECT org,site_a,(SELECT id FROM rf_ids WHERE label='occ_a2_d4'),act_asset,subj_asset2,'asset',(SELECT id FROM rf_ids WHERE label='v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000001','x','x' FROM rf$q$);
SELECT pg_temp.r_denied($q$UPDATE public.operation_issues SET status='open',summary='forged' WHERE id=(SELECT id FROM rf_ids WHERE label='issue_a2_d3')$q$);
RESET ROLE;
SELECT pg_temp.r_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.r_denied($q$UPDATE public.operation_task_instances SET status='completed' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')$q$);
SELECT pg_temp.r_denied($q$UPDATE public.operation_task_instances SET completed_at=now(),execution_state='completed' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.r_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')$q$);
SELECT pg_temp.r_denied($q$UPDATE public.operation_execution_receipts SET note='forged' WHERE id=(SELECT id FROM rf_ids WHERE label='r_a1')$q$);
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d4'),pg_temp.k('svc-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50}}')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.r_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')),'service moved a managed occurrence');
RESET ROLE;
-- The ordinary start still works on a managed row without the token; cancelled work cannot be recorded.
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_assert((SELECT public.haven_operation_task_command((SELECT id FROM rf_ids WHERE label='occ_a2_d4'),'start','{}')->>'status'='in_progress'),'start refused on a managed row');
RESET ROLE;
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'cancel_a1_d4',public.cancel_operation_occurrence_review((SELECT id FROM rf_ids WHERE label='occ_a1_d6'),'Unit removed for service','cancel-a1d4-000001');
RESET ROLE;
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_expect($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d6'),pg_temp.k('a1d4-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50}}')$q$,'Occurrence is cancelled');
RESET ROLE;
-- A missed occurrence accepts a late entry and keeps its missed fact.
SELECT pg_temp.r_clear();
SELECT set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
UPDATE public.operation_task_instances SET status='missed',missed_at=clock_timestamp()-interval '1 day' WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4');
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO rf_results SELECT 'rec_a2_d4',public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a2_d4'),pg_temp.k('a2d4-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":70}'::jsonb,'entry_kind','late','entry_reason','Found the paper entry','performed_at',clock_timestamp()-interval '3 hours'));
SELECT pg_temp.r_assert((SELECT result->'occurrence'->>'status'='completed' FROM rf_results WHERE label='rec_a2_d4'),'missed occurrence refused a late entry');
SELECT pg_temp.r_assert((SELECT missed_at IS NOT NULL AND status='completed' AND performed_at<completed_at FROM public.operation_task_instances WHERE id=(SELECT id FROM rf_ids WHERE label='occ_a2_d4')),'late entry erased the missed fact');
RESET ROLE;
-- Revoked recording authority and a revoked session deny before any row.
UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT nurse FROM rf) AND scope='resident';
SELECT pg_temp.r_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_res_d2'),pg_temp.k('res-000003'),'{"outcome":"performed"}')$q$);
RESET ROLE;
DELETE FROM auth.sessions WHERE id=(SELECT maint_session FROM rf);
SELECT pg_temp.r_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_denied($q$SELECT public.record_operation_work_review((SELECT id FROM rf_ids WHERE label='occ_a1_d4'),pg_temp.k('a1d4-000009'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":50}}')$q$);
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id IN(SELECT id FROM rf_ids WHERE label IN('occ_res_d2','occ_a1_d4'))),'a denied record created a receipt');
-- Reads: the site administrator sees every receipt and issue of the site; generic audit payloads stay hidden.
SELECT pg_temp.r_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r_assert((SELECT count(*)=16 FROM public.operation_execution_receipts),'site administrator cannot read the site receipts');
SELECT pg_temp.r_assert((SELECT count(*)=4 FROM public.operation_issues),'site administrator cannot read the site issues');
SELECT pg_temp.r_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name IN('operation_execution_receipts','operation_issues')),'generic audit payloads of receipts leaked');
RESET ROLE;
SELECT pg_temp.r_assert((SELECT count(*)=16 FROM public.operation_execution_receipts),'receipt count drifted');
SELECT pg_temp.r_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('record_operation_work_review','verify_operation_work_review','report_operation_issue_review') AND p.prosecdef),'public receipt RPC is definer');
SELECT 'COL-142 execution receipt behavior PASS' result;
ROLLBACK;
