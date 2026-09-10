-- COL-139: subject-scoped occurrences on the disposable replay. Proves the
-- database-owned identity (activity + site + typed subject + period/shift or
-- source event), explicit bindings, convergent service generation with
-- pinned governing versions, conflict reporting, catch-up and retirement
-- without lost history, manual work without an invented period, and audited
-- association. Authenticated SQL behaviour with synthetic fixtures; not
-- hosted, browser or staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.o_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-139 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.o_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-139 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.o_expect(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-139 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations binds a subject, creates a managed occurrence or an association.
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM public.operation_activity_bindings),'a migration created a binding');
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM public.operation_task_instances WHERE occurrence_kind IS NOT NULL),'a migration created a managed occurrence');
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM public.operation_occurrence_associations),'a migration created an association');
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_status='confirmed' OR schedule_rule IS NOT NULL),'a migration stored or confirmed a schedule');

-- FIXTURES-BEGIN
CREATE TEMP TABLE of AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_res,gen_random_uuid() act_emp,gen_random_uuid() act_fac,gen_random_uuid() act_na,gen_random_uuid() act_ev,
 gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() asset_b,gen_random_uuid() res1,gen_random_uuid() emp1,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_asset_b,gen_random_uuid() subj_res1,gen_random_uuid() subj_emp1,gen_random_uuid() subj_fac,gen_random_uuid() legacy_task,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE of ADD COLUMN d2 date,ADD COLUMN d3 date,ADD COLUMN d4 date;
UPDATE of SET d2=d1+7,d3=d1+14,d4=d1+21;
CREATE TEMP TABLE of_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE of_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON of TO authenticated,service_role; GRANT ALL ON of_ids,of_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Occurrence Site B','Test','Test','00000',1 FROM of;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@occurrence.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM of
 UNION ALL SELECT admin_a,admin_a||'@occurrence.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM of
 UNION ALL SELECT admin_b,admin_b||'@occurrence.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM of
 UNION ALL SELECT maint,maint||'@occurrence.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM of
 UNION ALL SELECT nurse,nurse||'@occurrence.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM of;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@occurrence.invalid','Corporate','owner'::public.app_role,org,true FROM of
 UNION ALL SELECT admin_a,admin_a||'@occurrence.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM of
 UNION ALL SELECT admin_b,admin_b||'@occurrence.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM of
 UNION ALL SELECT maint,maint||'@occurrence.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM of
 UNION ALL SELECT nurse,nurse||'@occurrence.invalid','Nurse','nurse'::public.app_role,org,true FROM of
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM of UNION ALL SELECT admin_a_session,admin_a FROM of UNION ALL SELECT admin_b_session,admin_b FROM of
 UNION ALL SELECT maint_session,maint FROM of UNION ALL SELECT nurse_session,nurse FROM of;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM of UNION ALL SELECT admin_a,site_a,org FROM of UNION ALL SELECT admin_b,site_b,org FROM of UNION ALL SELECT maint,site_a,org FROM of UNION ALL SELECT nurse,site_a,org FROM of;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority for enrolment',true FROM of
 UNION ALL SELECT org,site_a,admin_a,'employee_personnel',owner_actor,'Fixture personnel authority for enrolment',true FROM of
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM of;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-139-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM of
 UNION ALL SELECT act_res,org,NULL,'hfo-139-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM of
 UNION ALL SELECT act_emp,org,NULL,'hfo-139-fixture:'||act_emp,'Employee file review','record_review','employee','admin_log' FROM of
 UNION ALL SELECT act_fac,org,NULL,'hfo-139-fixture:'||act_fac,'Generator weekly test','structured_observation','facility','admin_log' FROM of
 UNION ALL SELECT act_na,org,NULL,'hfo-139-fixture:'||act_na,'Elevator inspection','attestation','facility','admin_log' FROM of
 UNION ALL SELECT act_ev,org,NULL,'hfo-139-fixture:'||act_ev,'Admission packet check','event_checklist','facility','admin_log' FROM of;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM of UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM of UNION ALL SELECT asset_b,org,site_b,'aed','AED site B' FROM of;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM of;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT emp1,org,site_a,'Protected','Employee','resident_aide',current_date FROM of;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM of UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM of UNION ALL SELECT subj_asset_b,org,site_b,'asset',asset_b FROM of;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM of;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) SELECT subj_emp1,org,site_a,'employee',emp1 FROM of;
-- No facility subject is pre-created: generation must create it on demand.
DELETE FROM public.operation_task_instances WHERE facility_id=(SELECT site_a FROM of) AND subject_id IN(SELECT id FROM public.operation_activity_subjects WHERE facility_id=(SELECT site_a FROM of) AND subject_kind='facility');
ALTER TABLE public.operation_activity_subjects DISABLE TRIGGER operation_activity_subject_scope;
DELETE FROM public.operation_activity_subjects WHERE facility_id=(SELECT site_a FROM of) AND subject_kind='facility';
ALTER TABLE public.operation_activity_subjects ENABLE TRIGGER operation_activity_subject_scope;
CREATE FUNCTION pg_temp.o_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f of; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM of;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.o_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.o_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
-- Hand-built evaluator outputs for a weekly rule: period = date..date+6.
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,p_shift text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb,'shift',p_shift)
$$;
-- The run carries the rule the "evaluator" used: by default the stored rule of the configuration.
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid,p_kind text DEFAULT 'scheduled',p_rule jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',coalesce(p_rule,(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config)),'occurrence_kind',p_kind))
$$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,text,int),pg_temp.run(text,date,date,uuid,text,jsonb),pg_temp.o_login(text),pg_temp.o_service(),pg_temp.o_clear() TO authenticated,service_role;

-- Central versions (owner) and site configurations (site admin) through the 135/137 commands.
SELECT pg_temp.o_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,'{"title":"AED monthly check","wording":"Check the AED pads and battery.","allowed_recorder_roles":["maintenance_role","facility_admin"]}') FROM of;
INSERT INTO of_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,'{"title":"Resident weight review","wording":"Review the monthly weight.","allowed_recorder_roles":["nurse","facility_admin"]}') FROM of;
INSERT INTO of_results SELECT 'v_emp',public.save_operation_requirement_draft_review(act_emp,'{"title":"Employee file review","wording":"Review the personnel file.","allowed_recorder_roles":["facility_admin"]}') FROM of;
INSERT INTO of_results SELECT 'v_fac',public.save_operation_requirement_draft_review(act_fac,'{"title":"Generator weekly test","wording":"Run the generator.","allowed_recorder_roles":["maintenance_role","facility_admin"]}') FROM of;
INSERT INTO of_results SELECT 'v_na',public.save_operation_requirement_draft_review(act_na,'{"title":"Elevator inspection","wording":"Inspect the elevator.","allowed_recorder_roles":["facility_admin"]}') FROM of;
INSERT INTO of_results SELECT 'v_ev',public.save_operation_requirement_draft_review(act_ev,'{"title":"Admission packet check","wording":"Check the packet on admission.","allowed_recorder_roles":["facility_admin"]}') FROM of;
INSERT INTO of_ids SELECT label,(result->>'id')::uuid FROM of_results WHERE label LIKE 'v\_%';
INSERT INTO of_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,clock_timestamp()) FROM of_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.o_assert((SELECT count(*)=6 FROM of_results WHERE label LIKE 'pub\_%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'fr_asset1',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}'::jsonb)) FROM of;
INSERT INTO of_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM of;
INSERT INTO of_results SELECT 'fr_emp',public.save_operation_facility_requirement_draft_review(act_emp,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_emp'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM of;
INSERT INTO of_results SELECT 'fr_fac',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_fac'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"08:00"}}'::jsonb)) FROM of;
INSERT INTO of_results SELECT 'fr_na',public.save_operation_facility_requirement_draft_review(act_na,site_a,jsonb_build_object('applicability','not_applicable','applicability_reason','No elevator at this site per interview','override_source','interview','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_na'))) FROM of;
INSERT INTO of_results SELECT 'fr_ev',public.save_operation_facility_requirement_draft_review(act_ev,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM of_ids WHERE label='v_ev'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"event","event_key":"admission"},"deadline":{"time":"17:00","day_offset":1}}'::jsonb)) FROM of;
INSERT INTO of_ids SELECT label,(result->>'id')::uuid FROM of_results WHERE label LIKE 'fr\_%';
INSERT INTO of_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM of_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.o_assert((SELECT count(*)=6 FROM of_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
-- FIXTURES-END

-- Bindings: explicit, typed, site-scoped; registry existence enrols nobody.
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM public.operation_activity_bindings),'registry existence enrolled a subject');
INSERT INTO of_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed in the fire safety log"}',clock_timestamp()) FROM of;
INSERT INTO of_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',clock_timestamp()) FROM of;
INSERT INTO of_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"facility_policy","reason":"Monthly weights for every resident"}',clock_timestamp()) FROM of;
INSERT INTO of_results SELECT 'b_emp1',public.enroll_operation_binding_review(act_emp,site_a,subj_emp1,'employee_personnel',NULL,'{"source":"regulator","reason":"Annual personnel file review"}',clock_timestamp()) FROM of;
INSERT INTO of_ids SELECT label,(result->>'id')::uuid FROM of_results WHERE label LIKE 'b\_%';
SELECT pg_temp.o_assert((SELECT count(*)=4 FROM public.operation_activity_bindings WHERE effective_to IS NULL),'bindings not created');
SELECT pg_temp.o_assert((SELECT (result->>'created_by')::uuid=(SELECT admin_a FROM of) FROM of_results WHERE label='b_asset1'),'binding actor not server-owned');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'asset',NULL,'{"source":"admin_log","reason":"again"}',clock_timestamp())$q$,'already exists');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_fac FROM of),(SELECT site_a FROM of),(SELECT subj_fac FROM of),'facility',NULL,'{"source":"admin_log","reason":"site"}',clock_timestamp())$q$,'need no binding');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_res1 FROM of),'resident',NULL,'{"source":"admin_log","reason":"wrong kind"}',clock_timestamp())$q$,'must match the activity subject');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'resident','day','{"source":"admin_log","reason":"wrong class"}',clock_timestamp())$q$,'does not fit');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'asset','day','{"source":"admin_log"}',clock_timestamp())$q$,'source and a reason');
SELECT pg_temp.o_expect($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'asset','day','{"source":"admin_log","reason":"back-dated"}',clock_timestamp()-interval '3 days')$q$,'rewrite history');
SELECT pg_temp.o_denied($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_b FROM of),(SELECT subj_asset_b FROM of),'asset',NULL,'{"source":"admin_log","reason":"other site"}',clock_timestamp())$q$);
SELECT pg_temp.o_denied($q$INSERT INTO public.operation_activity_bindings(organization_id,facility_id,activity_id,subject_id,authority_class,provenance,effective_from,created_by) SELECT org,site_a,act_asset,subj_asset1,'asset','{"source":"admin_log","reason":"direct"}',clock_timestamp(),admin_a FROM of$q$);
SELECT pg_temp.o_denied($q$UPDATE public.operation_activity_bindings SET shift='day' WHERE id=(SELECT id FROM of_ids WHERE label='b_asset1')$q$);
RESET ROLE;
-- Another site's administrator can neither enrol here nor see these bindings.
SELECT pg_temp.o_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'asset',NULL,'{"source":"admin_log","reason":"foreign admin"}',clock_timestamp())$q$);
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_activity_bindings),'other site admin read bindings');
RESET ROLE;
-- The resident scope is needed to enrol a resident: the nurse holds it but is not a site administrator; the owner is an administrator without the scope.
SELECT pg_temp.o_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.enroll_operation_binding_review((SELECT act_res FROM of),(SELECT site_a FROM of),(SELECT subj_res1 FROM of),'resident','day','{"source":"admin_log","reason":"no scope"}',clock_timestamp())$q$);
RESET ROLE;

-- Service generation: two same-type assets receive two distinct occurrences; replay converges.
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g1',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00',NULL)),
 pg_temp.run('run-1',d1,d1,(SELECT id FROM of_ids WHERE label='fr_asset1'),'scheduled','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}'::jsonb)) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=2 AND (result->'counts'->>'existing')::int=0 FROM of_results WHERE label='g1'),'two assets did not receive two occurrences');
SELECT pg_temp.o_assert((SELECT count(DISTINCT subject_id)=2 AND count(*)=2 AND bool_and(occurrence_kind='scheduled' AND status='pending' AND created_by IS NULL AND period_key=to_char((SELECT d1 FROM of),'YYYY-MM-DD')
 AND period_end_date=(SELECT d1+6 FROM of) AND facility_requirement_id=(SELECT id FROM of_ids WHERE label='fr_asset1') AND requirement_version_id=(SELECT id FROM of_ids WHERE label='v_asset')
 AND governing_at=due_at AND binding_id IS NOT NULL AND authority_class='asset' AND schedule_snapshot->>'evaluator_version'='hfo-evaluator/1' AND schedule_snapshot->>'timezone'='America/New_York' AND template_id IS NULL AND occurrence_revision IS NOT NULL)
 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d1 FROM of)),'generated rows lack identity or snapshot');
RESET ROLE;
SELECT pg_temp.o_assert((SELECT count(*)=2 FROM public.operation_audit_log a JOIN public.operation_task_instances t ON t.id=a.task_instance_id WHERE a.event_type='generated' AND a.actor_id IS NULL AND a.event_data->>'run_id'='run-1' AND t.activity_id=(SELECT act_asset FROM of)),'generated audit rows missing');
SET LOCAL ROLE service_role;
INSERT INTO of_ids SELECT 'occ_a1_d1',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d1 FROM of);
INSERT INTO of_ids SELECT 'occ_a2_d1',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset2 FROM of) AND assigned_shift_date=(SELECT d1 FROM of);
INSERT INTO of_results SELECT 'g1b',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00',NULL)),pg_temp.run('run-1-retry',d1,d1,(SELECT id FROM of_ids WHERE label='fr_asset1'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'existing')::int=2 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g1b'),'retry did not converge');
SELECT pg_temp.o_assert((SELECT bool_and((o->>'existing_task_id')::uuid IN(SELECT id FROM of_ids WHERE label IN('occ_a1_d1','occ_a2_d1'))) FROM of_results,jsonb_array_elements(result->'outcomes') o WHERE label='g1b'),'retry did not report the same identities');
SELECT pg_temp.o_assert((SELECT count(*)=2 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d1 FROM of)),'retry created a duplicate');
-- Whole-call contract: wrong rule, unpublished configuration, unsupported evaluator, bad range, unknown fields.
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),'scheduled','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"monday"},"deadline":{"time":"10:00"}}'::jsonb))$q$,'does not match the stored schedule rule');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'))-'rule')$q$,'must carry the evaluated rule');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_na'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_na')))$q$,'confirmed valid schedule');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'))||'{"evaluator_version":"hfo-evaluator/2"}')$q$,'supported evaluator version');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1-1 FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1')))$q$,'range is invalid');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_b FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','10:00',NULL)),pg_temp.run('run-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1')))$q$,'configuration unavailable');
-- Per-item contract: invalid items are reported, never dated; a reversed period, wrong timezone or out-of-range date never inserts.
INSERT INTO of_results SELECT 'g_invalid',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(
 pg_temp.occ(d2,'America/Chicago','10:00',NULL),jsonb_build_object('occurrence_date',to_char(d2,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d2+1,'YYYY-MM-DD'),'end_date',to_char(d2,'YYYY-MM-DD')),'due_at','x','timezone','America/New_York'),
 pg_temp.occ(d2+40,'America/New_York','10:00',NULL),'"text"'::jsonb),pg_temp.run('run-invalid',d2,d2+7,(SELECT id FROM of_ids WHERE label='fr_asset1'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'invalid')::int=4 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g_invalid'),'invalid items were not all reported');
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date>(SELECT d1 FROM of)),'invalid items produced rows');
-- Facility-kind activity: the site is the subject; no binding is needed and the facility subject is created on demand.
INSERT INTO of_results SELECT 'g_fac',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_fac'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','08:00',NULL)),pg_temp.run('run-fac',d1,d1,(SELECT id FROM of_ids WHERE label='fr_fac'))) FROM of;
RESET ROLE;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=1 FROM of_results WHERE label='g_fac'),'facility occurrence not generated');
SELECT pg_temp.o_assert((SELECT count(*)=1 FROM public.operation_activity_subjects WHERE facility_id=(SELECT site_a FROM of) AND subject_kind='facility'),'facility subject not created on demand');
UPDATE of SET subj_fac=(SELECT id FROM public.operation_activity_subjects s WHERE s.facility_id=of.site_a AND s.subject_kind='facility');
SELECT pg_temp.o_assert((SELECT binding_id IS NULL AND subject_id=(SELECT subj_fac FROM of) AND authority_class='facility' FROM public.operation_task_instances WHERE activity_id=(SELECT act_fac FROM of)),'facility occurrence carries a binding or wrong subject');
-- A legacy row keeps the 337 paths (deferred below); unmanaged service inserts are unchanged.
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date)
 SELECT legacy_task,org,site_a,subj_fac,'facility','Legacy duty','safety','on_demand',current_date FROM of;
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g_fac2',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_fac'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','08:00',NULL)),pg_temp.run('run-fac-2',d1,d1,(SELECT id FROM of_ids WHERE label='fr_fac'))) FROM of;
RESET ROLE;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'existing')::int=1 FROM of_results WHERE label='g_fac2') AND (SELECT count(*)=1 FROM public.operation_activity_subjects WHERE facility_id=(SELECT site_a FROM of) AND subject_kind='facility'),'facility subject duplicated on replay');
SET LOCAL ROLE service_role;
-- Event occurrences: identity is the source event, distinct events are distinct rows, the same event converges.
INSERT INTO of_results SELECT 'g_ev',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_ev'),jsonb_build_array(
 pg_temp.occ(d1,'America/New_York','17:00',NULL)||jsonb_build_object('source_event_key','admission','source_event_id','adm-1001','source_event_at',((d1::timestamp+time '09:30') AT TIME ZONE 'America/New_York')),
 pg_temp.occ(d1,'America/New_York','17:00',NULL)||jsonb_build_object('source_event_key','admission','source_event_id','adm-1002','source_event_at',((d1::timestamp+time '11:30') AT TIME ZONE 'America/New_York')),
 pg_temp.occ(d1,'America/New_York','17:00',NULL)||jsonb_build_object('source_event_key','admission','source_event_id','adm-1001','source_event_at',((d1::timestamp+time '09:30') AT TIME ZONE 'America/New_York'))),
 pg_temp.run('run-ev',d1,d1,(SELECT id FROM of_ids WHERE label='fr_ev'),'event')) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=2 AND (result->'counts'->>'existing')::int=1 FROM of_results WHERE label='g_ev'),'event identities not distinct/convergent');
SELECT pg_temp.o_assert((SELECT count(*)=2 AND bool_and(occurrence_kind='event' AND period_key LIKE 'admission:adm-%' AND governing_at=source_event_at) FROM public.operation_task_instances WHERE activity_id=(SELECT act_ev FROM of)),'event rows lack source identity');
SELECT pg_temp.o_expect($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_ev'),jsonb_build_array(pg_temp.occ((SELECT d1 FROM of),'America/New_York','17:00',NULL)),pg_temp.run('run-ev-x',(SELECT d1 FROM of),(SELECT d1 FROM of),(SELECT id FROM of_ids WHERE label='fr_ev')))$q$,'kind does not match the rule');
INSERT INTO of_results SELECT 'g_ev_bad',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_ev'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','17:00',NULL)||'{"source_event_key":"admission","source_event_id":"bad id!","source_event_at":"2026-01-01T00:00:00Z"}'::jsonb),pg_temp.run('run-ev-bad',d1,d1,(SELECT id FROM of_ids WHERE label='fr_ev'),'event')) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'invalid')::int=1 FROM of_results WHERE label='g_ev_bad'),'invalid source event identity accepted');
-- Direct service insert of a managed identity is refused; the legacy service insert path still works.
SELECT pg_temp.o_denied($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,activity_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,occurrence_kind,period_key,period_start_date,period_end_date,governing_at,due_at,schedule_snapshot,requirement_version_id,facility_requirement_id,binding_id,occurrence_revision)
 SELECT org,site_a,act_asset,subj_asset1,'asset','Direct','compliance','scheduled',d3,'scheduled',to_char(d3,'YYYY-MM-DD'),d3,d3+6,clock_timestamp(),clock_timestamp(),'{}',(SELECT id FROM of_ids WHERE label='v_asset'),(SELECT id FROM of_ids WHERE label='fr_asset1'),(SELECT id FROM of_ids WHERE label='b_asset1'),'x' FROM of$q$);
INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date)
 SELECT org,site_a,subj_fac,'facility','Legacy service duty','safety','on_demand',current_date FROM of;
SELECT pg_temp.o_denied($q$UPDATE public.operation_task_instances SET status='cancelled' WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')$q$);
-- A forged approval setting is worthless: the commands use a per-transaction token derived from an owner-only secret.
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.o_denied($q$SELECT haven.operation_occurrence_token()$q$);
SELECT pg_temp.o_denied($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,activity_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,occurrence_kind,period_key,period_start_date,period_end_date,governing_at,due_at,schedule_snapshot,requirement_version_id,facility_requirement_id,binding_id,occurrence_revision)
 SELECT org,site_a,act_asset,subj_asset1,'asset','Forged','compliance','scheduled',d3,'scheduled',to_char(d3,'YYYY-MM-DD'),d3,d3+6,clock_timestamp(),clock_timestamp(),'{}',(SELECT id FROM of_ids WHERE label='v_asset'),(SELECT id FROM of_ids WHERE label='fr_asset1'),(SELECT id FROM of_ids WHERE label='b_asset1'),'x' FROM of$q$);
SELECT pg_temp.o_denied($q$UPDATE public.operation_task_instances SET status='cancelled' WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')$q$);
SELECT pg_temp.o_denied($q$UPDATE public.operation_task_instances SET deleted_at=clock_timestamp() WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')$q$);
SELECT pg_temp.o_denied($q$SELECT * FROM haven.operation_command_secrets$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.o_assert((SELECT status='pending' AND deleted_at IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')),'forged flag mutated a managed row');
SELECT pg_temp.o_denied($q$SELECT public.enroll_operation_binding_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'asset','day','{"source":"admin_log","reason":"service"}',clock_timestamp())$q$);
SELECT pg_temp.o_denied($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d1'),'service','service-cancel-1')$q$);
RESET ROLE;
-- The session cannot call the service commands.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.generate_operation_occurrences_service((SELECT site_a FROM of),(SELECT id FROM of_ids WHERE label='fr_asset1'),'[]','{}')$q$);
SELECT pg_temp.o_denied($q$SELECT public.reconcile_operation_occurrences_service((SELECT site_a FROM of),'{"run_id":"x"}')$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.o_denied($q$SELECT haven.operation_occurrence_token()$q$);
SELECT pg_temp.o_denied($q$UPDATE public.operation_task_instances SET deleted_at=clock_timestamp() WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')$q$);
SELECT pg_temp.o_denied($q$INSERT INTO public.operation_occurrence_associations(organization_id,facility_id,occurrence_task_id,work_task_id,association_kind,expected_revision,request_key,request_hash,reason,created_by) SELECT org,site_a,(SELECT id FROM of_ids WHERE label='occ_a1_d1'),legacy_task,'late','x','forged-assoc-1','x','forged',admin_a FROM of$q$);
SELECT set_config('haven.operation_occurrence_command','',true);

-- Revised configuration in the same period: no duplicate, original governing versions retained; the timezone change keeps the period identity.
INSERT INTO of_results SELECT 'fr_asset2',public.save_operation_facility_requirement_draft_review(act_asset,site_a,'{"schedule_rule":{"rule_version":1,"timezone":"America/Chicago","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}}'::jsonb) FROM of;
INSERT INTO of_ids SELECT 'fr_asset2',(result->>'id')::uuid FROM of_results WHERE label='fr_asset2';
INSERT INTO of_results SELECT 'pub_fr_asset2',public.publish_operation_facility_requirement_review(id,clock_timestamp()+interval '1 minute') FROM of_ids WHERE label='fr_asset2';
SELECT pg_temp.o_assert((SELECT result->>'status'='published' AND (result->>'version')::int=2 FROM of_results WHERE label='pub_fr_asset2'),'revised configuration not published');
RESET ROLE;
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g1c',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset1'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00',NULL)),pg_temp.run('run-1-old',d1,d1,(SELECT id FROM of_ids WHERE label='fr_asset1'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'configuration_not_in_force')::int=1 FROM of_results WHERE label='g1c'),'closed configuration still generated');
INSERT INTO of_results SELECT 'g2',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset2'),jsonb_build_array(pg_temp.occ(d1,'America/Chicago','10:00',NULL),pg_temp.occ(d2,'America/Chicago','10:00',NULL)),pg_temp.run('run-2',d1,d2,(SELECT id FROM of_ids WHERE label='fr_asset2'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'existing')::int=2 AND (result->'counts'->>'created')::int=2 FROM of_results WHERE label='g2'),'revised configuration duplicated or skipped the period');
SELECT pg_temp.o_assert((SELECT bool_and(facility_requirement_id=(SELECT id FROM of_ids WHERE label='fr_asset1') AND schedule_snapshot->>'timezone'='America/New_York' AND due_at=((SELECT d1 FROM of)::timestamp+time '10:00') AT TIME ZONE 'America/New_York')
 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d1 FROM of)),'original governing configuration was rewritten');
SELECT pg_temp.o_assert((SELECT bool_and(facility_requirement_id=(SELECT id FROM of_ids WHERE label='fr_asset2') AND schedule_snapshot->>'timezone'='America/Chicago' AND due_at=((SELECT d2 FROM of)::timestamp+time '10:00') AT TIME ZONE 'America/Chicago')
 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d2 FROM of)),'new period did not snapshot the revised configuration');
RESET ROLE;
-- Same-day cutover: a third configuration effective at noon on d3 governs only the occurrence due after noon.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'fr_asset3',public.save_operation_facility_requirement_draft_review(act_asset,site_a,'{"schedule_rule":{"rule_version":1,"timezone":"America/Chicago","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":60}}}'::jsonb) FROM of;
INSERT INTO of_ids SELECT 'fr_asset3',(result->>'id')::uuid FROM of_results WHERE label='fr_asset3';
INSERT INTO of_results SELECT 'pub_fr_asset3',public.publish_operation_facility_requirement_review(id,((SELECT d3 FROM of)::timestamp+time '12:00') AT TIME ZONE 'America/Chicago') FROM of_ids WHERE label='fr_asset3';
SELECT pg_temp.o_assert((SELECT result->>'status'='published' FROM of_results WHERE label='pub_fr_asset3'),'cutover configuration not published');
RESET ROLE;
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g3a',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset2'),jsonb_build_array(pg_temp.occ(d3,'America/Chicago','08:00','day'),pg_temp.occ(d3,'America/Chicago','16:00','evening')),pg_temp.run('run-3a',d3,d3,(SELECT id FROM of_ids WHERE label='fr_asset2'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=2 AND (result->'counts'->>'configuration_not_in_force')::int=1 FROM of_results WHERE label='g3a'),'pre-cutover configuration governed the wrong instant');
INSERT INTO of_results SELECT 'g3b',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset3'),jsonb_build_array(pg_temp.occ(d3,'America/Chicago','08:00','day'),pg_temp.occ(d3,'America/Chicago','16:00','evening',60)),pg_temp.run('run-3b',d3,d3,(SELECT id FROM of_ids WHERE label='fr_asset3'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=2 AND (result->'counts'->>'configuration_not_in_force')::int=1 FROM of_results WHERE label='g3b'),'post-cutover configuration governed the wrong instant');
SELECT pg_temp.o_assert((SELECT bool_and(CASE assigned_shift WHEN 'day' THEN facility_requirement_id=(SELECT id FROM of_ids WHERE label='fr_asset2') AND grace_ends_at IS NULL ELSE facility_requirement_id=(SELECT id FROM of_ids WHERE label='fr_asset3') AND grace_ends_at=due_at+interval '60 minutes' END)
 AND count(*)=4 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d3 FROM of)),'same-day cutover chose the wrong version');
-- Overlap: an unshifted occurrence against shifted ones, and an overlapping different period, are conflicts, never a second active occurrence.
INSERT INTO of_results SELECT 'g3c',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset3'),jsonb_build_array(pg_temp.occ(d3,'America/Chicago','16:00',NULL,60),pg_temp.occ(d3+1,'America/Chicago','16:00',NULL,60)),pg_temp.run('run-3c',d3,d3+1,(SELECT id FROM of_ids WHERE label='fr_asset3'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'conflict')::int=4 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g3c'),'overlapping periods were not reported as conflicts');
SELECT pg_temp.o_assert((SELECT bool_and((o->>'conflict_task_id')::uuid IN(SELECT id FROM public.operation_task_instances WHERE assigned_shift_date=(SELECT d3 FROM of))) FROM of_results,jsonb_array_elements(result->'outcomes') o WHERE label='g3c'),'conflict did not name the existing occurrence');
SELECT pg_temp.o_assert((SELECT count(*)=4 FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date>=(SELECT d3 FROM of)),'conflict created a row');
RESET ROLE;

-- Retirement before the governing instant, and a subject no longer current, generate nothing and lose nothing.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'b_asset2_retired',public.retire_operation_binding_review(id,clock_timestamp(),'AED wing B removed from service') FROM of_ids WHERE label='b_asset2';
SELECT pg_temp.o_assert((SELECT result->>'effective_to' IS NOT NULL AND (result->>'retired_by')::uuid=(SELECT admin_a FROM of) FROM of_results WHERE label='b_asset2_retired'),'binding not retired');
SELECT pg_temp.o_expect($q$SELECT public.retire_operation_binding_review((SELECT id FROM of_ids WHERE label='b_asset2'),clock_timestamp(),'again')$q$,'already retired');
SELECT pg_temp.o_denied($q$UPDATE public.operation_activity_bindings SET effective_to=NULL,retired_at=NULL,retirement_reason=NULL,retired_by=NULL WHERE id=(SELECT id FROM of_ids WHERE label='b_asset2')$q$);
INSERT INTO of_results SELECT 'b_res1_retired',public.retire_operation_binding_review(id,clock_timestamp(),'Resident enrolment closed') FROM of_ids WHERE label='b_res1';
-- A shift-specific binding matches only a shifted item.
INSERT INTO of_results SELECT 'b_asset2_evening',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset','evening','{"source":"facility_policy","reason":"Wing B unit is checked on the evening shift"}',clock_timestamp()) FROM of;
INSERT INTO of_ids SELECT 'b_asset2_evening',(result->>'id')::uuid FROM of_results WHERE label='b_asset2_evening';
RESET ROLE;
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g_emp0',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_emp'),jsonb_build_array(pg_temp.occ(d2,'America/New_York','09:00',NULL)),pg_temp.run('run-emp-0',d2,d2,(SELECT id FROM of_ids WHERE label='fr_emp'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=1 FROM of_results WHERE label='g_emp0'),'employee occurrence not generated');
INSERT INTO of_ids SELECT 'occ_emp_d2',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_emp1 FROM of);
SELECT pg_temp.o_assert((SELECT authority_class='employee_personnel' AND binding_id=(SELECT id FROM of_ids WHERE label='b_emp1') FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_emp_d2')),'employee occurrence lacks its class or binding');
RESET ROLE;
SELECT pg_temp.o_clear();
UPDATE public.staff SET employment_status='terminated',termination_date=current_date WHERE id=(SELECT emp1 FROM of);
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g4',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset3'),jsonb_build_array(pg_temp.occ(d4,'America/Chicago','10:00',NULL,60)),pg_temp.run('run-4',d4,d4,(SELECT id FROM of_ids WHERE label='fr_asset3'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=1 FROM of_results WHERE label='g4'),'retired asset still generated');
SELECT pg_temp.o_assert((SELECT count(*)=1 AND bool_and(subject_id=(SELECT subj_asset1 FROM of)) FROM public.operation_task_instances WHERE activity_id=(SELECT act_asset FROM of) AND assigned_shift_date=(SELECT d4 FROM of)),'retired asset received an occurrence');
INSERT INTO of_results SELECT 'g4e',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset3'),jsonb_build_array(pg_temp.occ(d4,'America/Chicago','16:00','evening',60)),pg_temp.run('run-4-evening',d4,d4,(SELECT id FROM of_ids WHERE label='fr_asset3'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'created')::int=1 AND (result->'counts'->>'conflict')::int=1 FROM of_results WHERE label='g4e'),'shift-specific binding did not match the shifted item');
SELECT pg_temp.o_assert((SELECT count(*)=1 AND bool_and(binding_id=(SELECT id FROM of_ids WHERE label='b_asset2_evening') AND assigned_shift='evening') FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset2 FROM of) AND assigned_shift_date=(SELECT d4 FROM of)),'shifted occurrence lacks its shift binding');
INSERT INTO of_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_res'),jsonb_build_array(pg_temp.occ(d2,'America/New_York','09:00',NULL)),pg_temp.run('run-res',d2,d2,(SELECT id FROM of_ids WHERE label='fr_res'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'no_binding')::int=1 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g_res'),'retired resident binding still generated');
INSERT INTO of_results SELECT 'g_emp',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_emp'),jsonb_build_array(pg_temp.occ(d2,'America/New_York','09:00',NULL)),pg_temp.run('run-emp',d2,d2,(SELECT id FROM of_ids WHERE label='fr_emp'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'binding_not_current')::int=1 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g_emp'),'terminated employee still generated');
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE activity_id=(SELECT act_res FROM of)) AND (SELECT count(*)=1 FROM public.operation_task_instances WHERE activity_id=(SELECT act_emp FROM of)),'protected subjects received occurrences after retirement');
RESET ROLE;

-- Cancellation keeps identity and evidence; replay after cancellation or removal never recreates the period.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'c1',public.cancel_operation_occurrence_review(id,'Unit replaced before the check','cancel-a1-d1') FROM of_ids WHERE label='occ_a1_d1';
SELECT pg_temp.o_assert((SELECT result->>'status'='cancelled' AND (result->>'replayed')::boolean=false FROM of_results WHERE label='c1'),'cancellation failed');
INSERT INTO of_results SELECT 'c1b',public.cancel_operation_occurrence_review(id,'Unit replaced before the check','cancel-a1-d1') FROM of_ids WHERE label='occ_a1_d1';
SELECT pg_temp.o_assert((SELECT (result->>'replayed')::boolean FROM of_results WHERE label='c1b'),'cancellation replay not idempotent');
SELECT pg_temp.o_expect($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d1'),'other','cancel-a1-d1-other')$q$,'already cancelled');
SELECT pg_temp.o_expect($q$SELECT public.cancel_operation_occurrence_review((SELECT legacy_task FROM of),'legacy','cancel-legacy-1')$q$,'Only managed occurrences');
SELECT pg_temp.o_assert((SELECT period_key IS NOT NULL AND schedule_snapshot IS NOT NULL AND due_at IS NOT NULL AND cancellation_reason='Unit replaced before the check' AND updated_by=(SELECT admin_a FROM of) FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')),'cancellation rewrote identity');
SELECT pg_temp.o_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM of_ids WHERE label='occ_a1_d1') AND event_type='cancelled' AND event_data->>'request_key'='cancel-a1-d1'),'cancellation audit missing');
RESET ROLE;
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g1d',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset2'),jsonb_build_array(pg_temp.occ(d1,'America/Chicago','10:00',NULL)),pg_temp.run('run-1-after-cancel',d1,d1,(SELECT id FROM of_ids WHERE label='fr_asset2'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'existing')::int=1 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g1d'),'replay after cancellation recreated the period');
RESET ROLE;
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'c1r',public.cancel_operation_occurrence_review(id,'Unit replaced before the check','cancel-a1-d1',true) FROM of_ids WHERE label='occ_a1_d1';
SELECT pg_temp.o_assert((SELECT (result->>'removed')::boolean FROM of_results WHERE label='c1r'),'removal failed');
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')),'removed occurrence still listed');
INSERT INTO of_results SELECT 'c1r2',public.cancel_operation_occurrence_review(id,'Unit replaced before the check','cancel-a1-d1',true) FROM of_ids WHERE label='occ_a1_d1';
SELECT pg_temp.o_assert((SELECT (result->>'replayed')::boolean AND (result->>'removed')::boolean FROM of_results WHERE label='c1r2'),'cancel replay after removal not idempotent');
SELECT pg_temp.o_denied($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d1'),'other','cancel-a1-d1-late')$q$);
RESET ROLE;
SELECT pg_temp.o_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.cancel_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d1'),'Unit replaced before the check','cancel-a1-d1',true)$q$);
RESET ROLE;
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
RESET ROLE;
SELECT pg_temp.o_assert((SELECT deleted_at IS NOT NULL AND status='cancelled' AND period_key IS NOT NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d1')),'removal released identity');
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'g1e',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset2'),jsonb_build_array(pg_temp.occ(d1,'America/Chicago','10:00',NULL)),pg_temp.run('run-1-after-remove',d1,d1,(SELECT id FROM of_ids WHERE label='fr_asset2'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'existing')::int=1 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g1e'),'replay after removal recreated the period');
SELECT pg_temp.o_assert((SELECT count(*)=1 FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d1 FROM of)),'removal replay created a row');
RESET ROLE;

-- Manual unscheduled work: no period, no deadline, a labelled queue date; idempotent by request key; the recorder rule and applicability govern.
SELECT pg_temp.o_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO of_results SELECT 'm1',public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset1,'manual-m1-000001','{"note":"Checked after the alarm"}') FROM of;
SELECT pg_temp.o_assert((SELECT result->>'occurrence_kind'='manual' AND result->>'period_key' IS NULL AND result->>'due_at' IS NULL AND result->>'period_start_date' IS NULL AND result->>'binding_id' IS NULL
 AND (result->'schedule_snapshot'->>'queue_date_is_compatibility_only')::boolean AND result->>'status'='pending' AND (result->>'created_by')::uuid=(SELECT maint FROM of) AND result->>'request_key'='manual-m1-000001'
 AND (result->>'requirement_version_id')::uuid=(SELECT id FROM of_ids WHERE label='v_asset') AND (result->>'facility_requirement_id')::uuid=(SELECT id FROM of_ids WHERE label='fr_asset1') AND (result->>'replayed')::boolean=false FROM of_results WHERE label='m1'),'manual occurrence invented a period or lost attribution');
INSERT INTO of_ids SELECT 'm1',(result->>'id')::uuid FROM of_results WHERE label='m1';
INSERT INTO of_results SELECT 'm1b',public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset1,'manual-m1-000001','{"note":"Checked after the alarm"}') FROM of;
SELECT pg_temp.o_assert((SELECT (result->>'replayed')::boolean AND (result->>'id')::uuid=(SELECT id FROM of_ids WHERE label='m1') FROM of_results WHERE label='m1b'),'manual replay not idempotent');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-m1-000001','{"note":"Different note"}')$q$,'different content');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-m1-000002','{"due_at":"2026-01-01"}')$q$,'not editable');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'short','{}')$q$,'request key is required');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_na FROM of),(SELECT site_a FROM of),(SELECT subj_fac FROM of),'manual-na-000001','{}')$q$,'not applicable');
INSERT INTO of_results SELECT 'm_q',public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset1,'manual-mq-000001',jsonb_build_object('queue_date',to_char(current_date,'YYYY-MM-DD'),'note','Queued explicitly for today')) FROM of;
SELECT pg_temp.o_assert((SELECT (result->>'assigned_shift_date')::date=current_date AND result->'schedule_snapshot'->>'queue_date'=to_char(current_date,'YYYY-MM-DD') AND result->>'due_at' IS NULL FROM of_results WHERE label='m_q'),'explicit queue date not kept as a labelled compatibility date');
-- The in-force configuration closes at the revision cutover, so tomorrow lies outside its window.
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-mq-000004',jsonb_build_object('queue_date',to_char(current_date+1,'YYYY-MM-DD')))$q$,'outside the governing configuration window');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-mq-000002',jsonb_build_object('queue_date',to_char(current_date+400,'YYYY-MM-DD')))$q$,'within a year of today');
SELECT pg_temp.o_expect($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-mq-000003','{"queue_date":"not-a-date"}')$q$,'must be a calendar date');
INSERT INTO of_results SELECT 'm2',public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset2,'manual-m2-000001','{"note":"Wing B unit tested","shift":"evening"}') FROM of;
INSERT INTO of_ids SELECT 'm2',(result->>'id')::uuid FROM of_results WHERE label='m2';
INSERT INTO of_results SELECT 'm3',public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset1,'manual-m3-000001','{"note":"Third check"}') FROM of;
INSERT INTO of_ids SELECT 'm3',(result->>'id')::uuid FROM of_results WHERE label='m3';
SELECT pg_temp.o_assert((SELECT count(*)=4 FROM public.operation_audit_log WHERE event_type='created' AND event_data->>'occurrence_kind'='manual' AND actor_id=(SELECT maint FROM of)),'manual creation audit missing');
RESET ROLE;
SELECT pg_temp.o_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-nurse-00001','{}')$q$);
RESET ROLE;
SELECT pg_temp.o_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-adminb-0001','{}')$q$);
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE occurrence_kind IS NOT NULL),'other site admin read managed occurrences');
RESET ROLE;

-- Association: immutable, audited, one work row to one occurrence, expected revision enforced, no status change.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO of_ids SELECT 'occ_a1_d2',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d2 FROM of);
INSERT INTO of_ids SELECT 'occ_a2_d2',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset2 FROM of) AND assigned_shift_date=(SELECT d2 FROM of);
INSERT INTO of_results SELECT 'rev_a1_d2',jsonb_build_object('revision',occurrence_revision) FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d2');
SELECT pg_temp.o_expect($q$SELECT public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d2'),(SELECT id FROM of_ids WHERE label='m1'),'late','stale','Done early during the alarm','assoc-m1-000001')$q$,'changed since it was read');
INSERT INTO of_results SELECT 'as1',public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d2'),(SELECT id FROM of_ids WHERE label='m1'),'early',(SELECT result->>'revision' FROM of_results WHERE label='rev_a1_d2'),'Done early during the alarm','assoc-m1-000001') FROM of;
SELECT pg_temp.o_assert((SELECT result->>'association_kind'='early' AND (result->>'replayed')::boolean=false AND (result->>'created_by')::uuid=(SELECT admin_a FROM of) FROM of_results WHERE label='as1'),'association failed');
INSERT INTO of_results SELECT 'as1b',public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d2'),(SELECT id FROM of_ids WHERE label='m1'),'early',(SELECT result->>'revision' FROM of_results WHERE label='rev_a1_d2'),'Done early during the alarm','assoc-m1-000001') FROM of;
SELECT pg_temp.o_assert((SELECT (result->>'replayed')::boolean AND result->>'id'=(SELECT result->>'id' FROM of_results WHERE label='as1') FROM of_results WHERE label='as1b'),'association replay not idempotent');
SELECT pg_temp.o_expect($q$SELECT public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d2'),(SELECT id FROM of_ids WHERE label='m1'),'late',(SELECT result->>'revision' FROM of_results WHERE label='rev_a1_d2'),'Changed','assoc-m1-000001')$q$,'different content');
INSERT INTO of_ids SELECT 'occ_a1_d3_day',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d3 FROM of) AND assigned_shift='day';
SELECT pg_temp.o_expect($q$SELECT public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d3_day'),(SELECT id FROM of_ids WHERE label='m1'),'late',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d3_day')),'Second target','assoc-m1-000002')$q$,'already associated');
SELECT pg_temp.o_assert((SELECT status='pending' AND occurrence_revision=(SELECT result->>'revision' FROM of_results WHERE label='rev_a1_d2') FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d2')),'association changed the occurrence');
SELECT pg_temp.o_assert((SELECT status='pending' FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='m1')),'association changed the work');
SELECT pg_temp.o_assert((SELECT count(*)=2 FROM public.operation_audit_log WHERE event_type='associated' AND event_data->>'association_id'=(SELECT result->>'id' FROM of_results WHERE label='as1')),'association audit rows missing');
-- To a completed occurrence: allowed, implies nothing about completion of the work.
SELECT pg_temp.o_assert((SELECT public.complete_operation_task_review(id,(SELECT admin_a FROM of),'facility_admin','Checked on the day','{}')='completed' FROM of_ids WHERE label='occ_a2_d2'),'completion of a managed occurrence failed');
INSERT INTO of_results SELECT 'as2',public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a2_d2'),(SELECT id FROM of_ids WHERE label='m2'),'late',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a2_d2')),'Late receipt reconciled','assoc-m2-000001') FROM of;
SELECT pg_temp.o_assert((SELECT result->>'association_kind'='late' FROM of_results WHERE label='as2'),'association to a completed occurrence failed');
SELECT pg_temp.o_assert((SELECT status='completed' AND signed_by=(SELECT admin_a FROM of) FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a2_d2')),'completed facts changed');
SELECT pg_temp.o_assert((SELECT status='pending' FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='m2')),'late association implied completion of the work');
-- Not to a cancelled occurrence, not across subjects, not work-to-work.
SELECT pg_temp.o_expect($q$SELECT public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a2_d2'),(SELECT id FROM of_ids WHERE label='m3'),'late','x','Wrong subject','assoc-m3-000001')$q$,'same activity, site and subject');
SELECT pg_temp.o_expect($q$SELECT public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='m1'),(SELECT id FROM of_ids WHERE label='m3'),'late','x','Work to work','assoc-m3-000002')$q$,'must be a scheduled occurrence');
INSERT INTO of_results SELECT 'as3',public.associate_operation_occurrence_review((SELECT id FROM of_ids WHERE label='occ_a1_d3_day'),(SELECT id FROM of_ids WHERE label='m3'),'unscheduled',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d3_day')),'Extra check recorded against the period','assoc-m3-000003') FROM of;
SELECT pg_temp.o_assert((SELECT result->>'association_kind'='unscheduled' FROM of_results WHERE label='as3'),'unscheduled association failed');
SELECT pg_temp.o_denied($q$UPDATE public.operation_occurrence_associations SET association_kind='late'$q$);
SELECT pg_temp.o_denied($q$DELETE FROM public.operation_occurrence_associations$q$);
SELECT pg_temp.o_assert((SELECT count(*)=3 FROM public.operation_occurrence_associations),'site admin cannot read its associations');
-- Legacy defer and reinstate refuse managed rows; the legacy row still defers.
SELECT pg_temp.o_expect($q$SELECT public.defer_operation_task_review((SELECT id FROM of_ids WHERE label='occ_a1_d2'),(SELECT admin_a FROM of),'facility_admin',clock_timestamp()+interval '1 day','later',encode(sha256(convert_to('operation-defer-v1:'||(SELECT admin_a FROM of)::text||':'||(SELECT id FROM of_ids WHERE label='occ_a1_d2')::text,'UTF8')),'hex'))$q$,'cannot be deferred by the legacy command');
SELECT pg_temp.o_expect($q$SELECT public.haven_operation_task_command((SELECT id FROM of_ids WHERE label='occ_a1_d2'),'reinstate','{}')$q$,'cannot be reinstated by the legacy command');
SELECT pg_temp.o_assert((SELECT (public.haven_operation_task_command(id,'start','{}')->>'status')='in_progress' FROM of_ids WHERE label='occ_a1_d2'),'start of a managed occurrence failed');
SELECT pg_temp.o_assert((SELECT occurrence_revision<>(SELECT result->>'revision' FROM of_results WHERE label='rev_a1_d2') FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d2')),'revision did not change on update');
SELECT pg_temp.o_assert((SELECT (public.defer_operation_task_review(legacy_task,admin_a,'facility_admin',clock_timestamp()+interval '1 day','legacy defer',encode(sha256(convert_to('operation-defer-v1:'||admin_a::text||':'||legacy_task::text,'UTF8')),'hex'))->>'new_task_id') IS NOT NULL FROM of),'legacy defer no longer works');
SELECT pg_temp.o_assert((SELECT count(*)=1 FROM public.operation_task_instances WHERE deferred_replacement_task_id IS NULL AND template_name='Legacy duty' AND status='pending' AND occurrence_kind IS NULL AND id<>(SELECT legacy_task FROM of)),'legacy replacement row changed shape');
RESET ROLE;
-- A revoked session denies the recorder command before any row.
SELECT pg_temp.o_login('maint');
DELETE FROM auth.sessions WHERE id=(SELECT maint_session FROM of);
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_denied($q$SELECT public.create_operation_manual_occurrence_review((SELECT act_asset FROM of),(SELECT site_a FROM of),(SELECT subj_asset1 FROM of),'manual-revoked-0001','{}')$q$);
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE request_key='manual-revoked-0001'),'revoked session created work');
RESET ROLE;

-- Service reconciliation of a native retirement: closes the binding, cancels only future pending work, keeps every executed fact.
SELECT pg_temp.o_clear();
UPDATE public.facility_assets SET status='retired' WHERE id=(SELECT asset1 FROM of);
INSERT INTO of_ids SELECT 'occ_a1_d3',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d3 FROM of) AND assigned_shift='day';
INSERT INTO of_ids SELECT 'occ_a1_d4',id FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date=(SELECT d4 FROM of);
SELECT pg_temp.o_service();
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'rec',public.reconcile_operation_occurrences_service(site_a,'{"run_id":"run-rec"}') FROM of;
SELECT pg_temp.o_assert((SELECT result->'bindings_closed' ? (SELECT id::text FROM of_ids WHERE label='b_asset1') AND result->'bindings_closed' ? (SELECT id::text FROM of_ids WHERE label='b_emp1') FROM of_results WHERE label='rec'),'reconciliation did not close retired bindings');
SELECT pg_temp.o_assert((SELECT effective_to IS NOT NULL AND retired_by IS NULL AND retirement_reason='subject no longer current' FROM public.operation_activity_bindings WHERE id=(SELECT id FROM of_ids WHERE label='b_asset1')),'service closure misattributed');
SELECT pg_temp.o_assert((SELECT bool_and(status='cancelled' AND cancellation_reason='subject retired before the period' AND period_key IS NOT NULL) FROM public.operation_task_instances WHERE id IN(SELECT id FROM of_ids WHERE label IN('occ_a1_d3','occ_a1_d4'))),'future pending work of a retired asset not cancelled');
SELECT pg_temp.o_assert((SELECT status='cancelled' AND updated_by IS NULL AND authority_class='employee_personnel' AND signed_by IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_emp_d2')),'protected-class future work of a terminated employee not cancelled by the service');
SELECT pg_temp.o_assert((SELECT status='in_progress' FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a1_d2')),'reconciliation touched in-progress work');
SELECT pg_temp.o_assert((SELECT status='completed' AND signed_by IS NOT NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM of_ids WHERE label='occ_a2_d2')),'reconciliation touched completed work');
RESET ROLE;
SELECT pg_temp.o_assert((SELECT count(*)=4 FROM public.operation_audit_log WHERE event_type='reconciled' AND event_data->>'run_id'='run-rec'),'reconciliation audit missing');
SELECT pg_temp.o_assert((SELECT count(*)=3 AND bool_and(status='cancelled') FROM public.operation_task_instances WHERE subject_id=(SELECT subj_asset1 FROM of) AND assigned_shift_date>=(SELECT d3 FROM of)),'future pending work count changed');
SET LOCAL ROLE service_role;
INSERT INTO of_results SELECT 'rec2',public.reconcile_operation_occurrences_service(site_a,'{"run_id":"run-rec-2"}') FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'bindings_closed')::int=0 AND (result->'counts'->>'occurrences_cancelled')::int=0 FROM of_results WHERE label='rec2'),'reconciliation replay was not a no-op');
INSERT INTO of_results SELECT 'g4b',public.generate_operation_occurrences_service(site_a,(SELECT id FROM of_ids WHERE label='fr_asset3'),jsonb_build_array(pg_temp.occ(d4,'America/Chicago','10:00',NULL,60)),pg_temp.run('run-4-after-retire',d4,d4,(SELECT id FROM of_ids WHERE label='fr_asset3'))) FROM of;
SELECT pg_temp.o_assert((SELECT (result->'counts'->>'no_binding')::int=1 AND (result->'counts'->>'created')::int=0 FROM of_results WHERE label='g4b'),'catch-up after retirement generated or recreated work');
RESET ROLE;
-- Site A's administrator keeps reading its history; the other site sees nothing.
SELECT pg_temp.o_login('admin_a');
SET LOCAL ROLE authenticated;
-- Retired or transferred subjects stay hidden from the session (COL-133); current subjects keep their binding history.
SELECT pg_temp.o_assert((SELECT count(*)=3 FROM public.operation_activity_bindings WHERE subject_id IN(SELECT subj_asset2 FROM of UNION ALL SELECT subj_res1 FROM of)),'site admin lost binding history');
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_activity_bindings WHERE subject_id IN(SELECT subj_asset1 FROM of UNION ALL SELECT subj_emp1 FROM of)),'retired subject binding readable');
SELECT pg_temp.o_assert((SELECT count(*)>=1 FROM public.operation_task_instances WHERE occurrence_kind='manual'),'site admin lost manual work');
RESET ROLE;
SELECT pg_temp.o_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.o_assert((SELECT count(*)=0 FROM public.operation_activity_bindings) AND (SELECT count(*)=0 FROM public.operation_occurrence_associations) AND (SELECT count(*)=0 FROM public.operation_task_instances WHERE occurrence_kind IS NOT NULL),'other site read occurrence history');
RESET ROLE;
SELECT pg_temp.o_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('enroll_operation_binding_review','retire_operation_binding_review','create_operation_manual_occurrence_review','associate_operation_occurrence_review','cancel_operation_occurrence_review','generate_operation_occurrences_service','reconcile_operation_occurrences_service') AND p.prosecdef),'Public occurrence RPC is definer');
SELECT 'COL-139 occurrence behavior PASS' result;
ROLLBACK;
