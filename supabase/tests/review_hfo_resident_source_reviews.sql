-- COL155: native-RLS references are separate from clinical actions. Synthetic rollback-only proof.
BEGIN;
LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
-- Supabase native table grants; RLS remains enabled and unchanged.
GRANT SELECT ON public.resident_contacts,public.form_1823_records,public.admission_cases,public.admission_document_checklist_items,public.resident_observation_logs,public.resident_observation_tasks,public.daily_vital_observations,public.daily_logs TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL155 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END; RAISE EXCEPTION 'expected denial: %',stmt; END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'expected error: %',fragment; END $$;
-- FIXTURES-BEGIN
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,gen_random_uuid() mgr,gen_random_uuid() mgr_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_fac,gen_random_uuid() act_res,
 gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() res1,gen_random_uuid() vendor_ok,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,gen_random_uuid() meeting,gen_random_uuid() action_item,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 -- Versions, configurations and bindings take effect 23 hours ago (338 allows up to a day back); one occurrence fell due three hours ago with a two-hour grace.
 clock_timestamp()-interval '23 hours' since,date_trunc('minute',clock_timestamp()-interval '3 hours') past_due,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE cf ADD COLUMN d0 date,ADD COLUMN hh0 text,ADD COLUMN d2 date,ADD COLUMN d3 date,ADD COLUMN d4 date,ADD COLUMN d5 date;
UPDATE cf SET d0=(past_due AT TIME ZONE 'America/New_York')::date,hh0=to_char(past_due AT TIME ZONE 'America/New_York','HH24:MI'),d2=d1+7,d3=d1+14,d4=d1+21,d5=d1+28;
CREATE TEMP TABLE cf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE cf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON cf TO authenticated,service_role; GRANT ALL ON cf_ids,cf_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Correction Site B','Test','Test','00000',1 FROM cf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM cf
 UNION ALL SELECT admin_a,admin_a||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM cf
 UNION ALL SELECT admin_b,admin_b||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM cf
 UNION ALL SELECT maint,maint||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM cf
 UNION ALL SELECT nurse,nurse||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','med_tech'),'{"full_name":"Nurse"}'::jsonb FROM cf
 UNION ALL SELECT aide,aide||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM cf
 UNION ALL SELECT mgr,mgr||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Manager"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@correction.invalid','Corporate','owner'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_a,admin_a||'@correction.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_b,admin_b||'@correction.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT maint,maint||'@correction.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM cf
 UNION ALL SELECT nurse,nurse||'@correction.invalid','Nurse','med_tech'::public.app_role,org,true FROM cf
 UNION ALL SELECT aide,aide||'@correction.invalid','Aide','housekeeper'::public.app_role,org,true FROM cf
 UNION ALL SELECT mgr,mgr||'@correction.invalid','Manager','manager'::public.app_role,org,true FROM cf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM cf UNION ALL SELECT admin_a_session,admin_a FROM cf UNION ALL SELECT admin_b_session,admin_b FROM cf
 UNION ALL SELECT maint_session,maint FROM cf UNION ALL SELECT nurse_session,nurse FROM cf UNION ALL SELECT aide_session,aide FROM cf UNION ALL SELECT mgr_session,mgr FROM cf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM cf UNION ALL SELECT admin_a,site_a,org FROM cf UNION ALL SELECT admin_b,site_b,org FROM cf UNION ALL SELECT maint,site_a,org FROM cf
 UNION ALL SELECT nurse,site_a,org FROM cf UNION ALL SELECT aide,site_a,org FROM cf UNION ALL SELECT mgr,site_a,org FROM cf;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM cf
 UNION ALL SELECT org,site_a,owner_actor,'resident',owner_actor,'Fixture corporate resident reviewer',true FROM cf
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM cf;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-145-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM cf
 UNION ALL SELECT act_fac,org,NULL,'hfo-145-fixture:'||act_fac,'Generator weekly test','structured_observation','facility','admin_log' FROM cf
 UNION ALL SELECT act_res,org,NULL,'hfo-145-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM cf;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM cf UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM cf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM cf;
INSERT INTO public.vendors(id,organization_id,name) SELECT vendor_ok,org,'Linked generator service' FROM cf;
INSERT INTO public.vendor_facilities(organization_id,vendor_id,facility_id) SELECT org,vendor_ok,site_a FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM cf UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM cf;
CREATE FUNCTION pg_temp.c_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f cf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM cf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSIF p_kind='mgr' THEN u:=f.mgr; sess:=f.mgr_session; r:='manager';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='med_tech'; END IF;
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
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col145-'||p $$;
CREATE FUNCTION pg_temp.rid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM cf_ids WHERE label=p_label $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM cf_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.res(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT result FROM cf_results WHERE label=p_label $$;
-- As in the 343 probe: a prepare declares md5(filename) and a local upload writes the eTag Storage would (the quoted MD5 of the stored bytes) plus a Storage version.
CREATE FUNCTION pg_temp.obj(p_payload text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT p_payload::jsonb||jsonb_build_object('md5',md5(p_payload::jsonb->>'filename')) $$;
CREATE FUNCTION pg_temp.put(p_evidence uuid,p_owner uuid,p_size bigint,p_mime text) RETURNS uuid LANGUAGE sql AS $$
 INSERT INTO storage.objects(bucket_id,name,owner,metadata,version) SELECT 'operation-evidence',e.object_path,p_owner,jsonb_build_object('size',p_size,'mimetype',p_mime,'eTag','"'||md5(split_part(e.object_path,'/',3))||'"'),gen_random_uuid()::text
 FROM public.operation_evidence e WHERE e.id=p_evidence RETURNING id
$$;
-- Prepare, store and finalize one required panel photo for a receipt as its uploader; returns the finalize reply.
CREATE FUNCTION pg_temp.photo(p_receipt_label text,p_key text,p_owner uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE prep jsonb; ev uuid; BEGIN
 prep:=public.prepare_operation_evidence_review(pg_temp.rid(p_receipt_label),pg_temp.k(p_key),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":321}'));
 ev:=(prep->'evidence'->>'id')::uuid;
 PERFORM pg_temp.put(ev,p_owner,321,'image/jpeg');
 RETURN public.finalize_operation_evidence_review(ev,pg_temp.k(p_key||'-fin'),pg_temp.rev(p_receipt_label),'{}');
END $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.c_login(text),pg_temp.c_service(),pg_temp.c_clear(),pg_temp.k(text),pg_temp.rid(text),pg_temp.rev(text),pg_temp.res(text),pg_temp.obj(text),pg_temp.put(uuid,uuid,bigint,text),pg_temp.photo(text,text,uuid) TO authenticated,service_role;

-- Central versions (owner) and site configurations (site admin), in force since before the earliest occurrence.
SELECT pg_temp.c_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','pads_ok','label','Pads in date','type','boolean','required',true),jsonb_build_object('key','battery_pct','label','Battery','type','number','required',true,'min',0,'max',100)))) FROM cf;
INSERT INTO cf_results SELECT 'v_fac',public.save_operation_requirement_draft_review(act_fac,jsonb_build_object('title','Generator weekly test','wording','Run the generator.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin','housekeeper'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always')))) FROM cf;
INSERT INTO cf_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('med_tech','facility_admin'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'))) FROM cf;
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'v\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM cf_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb)) FROM cf;
INSERT INTO cf_results SELECT 'fr_fac',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_fac'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"08:00"}}'::jsonb)) FROM cf;
INSERT INTO cf_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM cf;
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'fr\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM cf_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO cf_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',since) FROM cf;
RESET ROLE;
-- Occurrences from the service generator: one past week (d0) and five future weeks for the AEDs.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_asset'),
 jsonb_build_array(pg_temp.occ(d0,'America/New_York',hh0,120),pg_temp.occ(d1,'America/New_York','10:00',120),pg_temp.occ(d2,'America/New_York','10:00',120),pg_temp.occ(d3,'America/New_York','10:00',120),pg_temp.occ(d4,'America/New_York','10:00',120),pg_temp.occ(d5,'America/New_York','10:00',120)),pg_temp.run('run-asset',d0,d5,pg_temp.rid('fr_asset'))) FROM cf;
INSERT INTO cf_results SELECT 'g_fac',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_fac'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','08:00'),pg_temp.occ(d2,'America/New_York','08:00'),pg_temp.occ(d3,'America/New_York','08:00'),pg_temp.occ(d4,'America/New_York','08:00')),pg_temp.run('run-fac',d1,d4,pg_temp.rid('fr_fac'))) FROM cf;
INSERT INTO cf_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_res'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','09:00'),pg_temp.occ(d2,'America/New_York','09:00'),pg_temp.occ(d3,'America/New_York','09:00')),pg_temp.run('run-res',d1,d3,pg_temp.rid('fr_res'))) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->'counts'->>'created')::int=12 FROM cf_results WHERE label='g_asset') AND (SELECT (result->'counts'->>'created')::int=4 FROM cf_results WHERE label='g_fac')
 AND (SELECT (result->'counts'->>'created')::int=3 FROM cf_results WHERE label='g_res'),'occurrences not generated');
INSERT INTO cf_ids SELECT 'occ_a1_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1),('d2',cf.d2),('d3',cf.d3),('d4',cf.d4),('d5',cf.d5)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_a2_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1),('d2',cf.d2),('d3',cf.d3),('d4',cf.d4),('d5',cf.d5)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_asset2 AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_fac_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d1',cf.d1),('d2',cf.d2),('d3',cf.d3),('d4',cf.d4)) x(n,d) JOIN public.operation_task_instances t ON t.activity_id=cf.act_fac AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_res_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d1',cf.d1),('d2',cf.d2),('d3',cf.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_res1 AND t.assigned_shift_date=x.d;
SELECT pg_temp.c_assert((SELECT count(*)=19 FROM cf_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
SELECT pg_temp.c_assert((SELECT grace_ends_at<clock_timestamp() AND status='pending' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'the past occurrence is not past its grace');
RESET ROLE;
-- A meeting action item linked to a managed occurrence (the meeting → task sync direction).
SELECT pg_temp.c_clear();
INSERT INTO public.meetings(id,organization_id,facility_id,title,scheduled_at) SELECT meeting,org,site_a,'Fixture standup',clock_timestamp() FROM cf;
INSERT INTO public.meeting_action_items(id,organization_id,facility_id,meeting_id,description,oce_task_instance_id) SELECT action_item,org,site_a,meeting,'Check the wing B AED',pg_temp.rid('occ_a2_d4') FROM cf;
-- Recordings the cases build on: a routine AED check, a photo-required generator test with its photo finalized, and a review-required weight review.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_a1',public.record_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('a1-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":90},"note":"Pads and battery fine"}');
INSERT INTO cf_results SELECT 'rec_a2',public.record_operation_work_review(pg_temp.rid('occ_a2_d1'),pg_temp.k('a2-000001'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":80}}');
INSERT INTO cf_results SELECT 'rec_fac1',public.record_operation_work_review(pg_temp.rid('occ_fac_d1'),pg_temp.k('fac1-000001'),'{"outcome":"performed","note":"Ran fine"}');
INSERT INTO cf_results SELECT 'rec_fac2',public.record_operation_work_review(pg_temp.rid('occ_fac_d2'),pg_temp.k('fac2-000001'),'{"outcome":"performed"}');
INSERT INTO cf_results SELECT 'rec_fac3',public.record_operation_work_review(pg_temp.rid('occ_fac_d3'),pg_temp.k('fac3-000001'),'{"outcome":"performed"}');
INSERT INTO cf_ids SELECT 'r_'||substr(label,5),(result->'receipt'->>'id')::uuid FROM cf_results WHERE label LIKE 'rec\_%';


RESET ROLE;
SELECT pg_temp.c_login('med_tech');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_res1',public.record_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('res1-000001'),'{"outcome":"performed","note":"Weight stable"}');
INSERT INTO cf_ids SELECT 'r_res1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_res1';
RESET ROLE;
SELECT pg_temp.c_assert((SELECT bool_and(chain_id=id AND correction_seq=0 AND corrects_receipt_id IS NULL AND superseded_by_receipt_id IS NULL AND superseded_at IS NULL) FROM public.operation_execution_receipts),'recordings are not their own chain roots');
-- Snapshot of every receipt's immutable facts before any correction.
CREATE TEMP TABLE cf_snapshot AS SELECT id receipt_id,to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at'] receipt_json FROM public.operation_execution_receipts r;
GRANT SELECT ON cf_snapshot TO authenticated;
-- FIXTURES-END
-- COL155-FIXTURE-BEGIN
RESET ROLE; SELECT pg_temp.c_clear();
CREATE TEMP TABLE rr AS SELECT gen_random_uuid() contact,gen_random_uuid() wrong_contact,gen_random_uuid() activity,
 (clock_timestamp() AT TIME ZONE 'America/New_York')::date today;
GRANT ALL ON rr TO authenticated;
INSERT INTO public.operation_activities(id,organization_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT activity,org,'hfo-col155-local-review','Synthetic contact review','record_review','resident','admin_log' FROM rr,cf;
-- Use the exact canonical key by choosing the existing catalog row, never rename it.
UPDATE rr SET activity=(SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-w07-01' AND organization_id=(SELECT org FROM cf));
INSERT INTO public.resident_contacts(id,resident_id,facility_id,organization_id,contact_type,name,created_by,updated_by)
 SELECT contact,res1,site_a,org,'family','Synthetic private contact',admin_a,admin_a FROM rr,cf;
SELECT pg_temp.c_login('owner'); SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_review',public.save_operation_requirement_draft_review(activity,'{"title":"Review contact metadata","wording":"Review available current source metadata","allowed_recorder_roles":["facility_admin"],"subject_kind":"resident"}') FROM rr;
INSERT INTO cf_ids SELECT 'v_review',(result->>'id')::uuid FROM cf_results WHERE label='v_review';
SELECT public.publish_operation_requirement_review(pg_temp.rid('v_review'),clock_timestamp()-interval '1 hour');
RESET ROLE; SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_review',public.save_operation_facility_requirement_draft_review(activity,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_review'),'schedule_status','needs_confirmation')) FROM rr,cf;
INSERT INTO cf_ids SELECT 'fr_review',(result->>'id')::uuid FROM cf_results WHERE label='fr_review';
SELECT public.publish_operation_facility_requirement_review(pg_temp.rid('fr_review'),clock_timestamp()-interval '30 minutes');
INSERT INTO cf_results SELECT 'manual_review',public.create_operation_manual_occurrence_review(activity,site_a,subj_res1,'col155-manual-001','{}') FROM rr,cf;
INSERT INTO cf_ids SELECT 'manual_review',(result->>'id')::uuid FROM cf_results WHERE label='manual_review';
CREATE TEMP TABLE rr_source AS SELECT haven.read_resident_review_source(pg_temp.rid('manual_review'),'resident_contact',contact,today-7,today-1) result FROM rr;
GRANT ALL ON rr_source TO authenticated;
SELECT pg_temp.c_assert((SELECT result IS NOT NULL FROM rr_source),'current contact review of prior period unavailable');
SELECT pg_temp.c_assert((SELECT result::text NOT LIKE '%Synthetic private contact%' FROM rr_source),'native contact contents copied');

RESET ROLE; SELECT pg_temp.c_clear();
CREATE TEMP TABLE rr_native AS SELECT gen_random_uuid() vital,gen_random_uuid() daily,gen_random_uuid() form,gen_random_uuid() admission,
 gen_random_uuid() plan,gen_random_uuid() native_task,gen_random_uuid() native_log,gen_random_uuid() staff;
GRANT ALL ON rr_native TO authenticated;
INSERT INTO public.daily_logs(id,resident_id,facility_id,organization_id,log_date,shift,logged_by)
 SELECT daily,res1,site_a,org,today-2,'day',admin_a FROM rr_native,rr,cf;
INSERT INTO public.daily_vital_observations(id,daily_log_id,resident_id,facility_id,organization_id,observed_at,measurements,recorded_by)
 SELECT vital,daily,res1,site_a,org,(today-2)::timestamp AT TIME ZONE 'America/New_York','{"pulse":80}',admin_a FROM rr_native,rr,cf;
INSERT INTO public.admission_cases(id,organization_id,facility_id,resident_id) SELECT admission,org,site_a,res1 FROM rr_native,cf;
INSERT INTO public.form_1823_records(id,organization_id,facility_id,resident_id,admission_case_id,physician_name,exam_date,expiration_date,status)
 SELECT form,org,site_a,res1,admission,'Synthetic physician',today-10,today,'received' FROM rr_native,rr,cf;
UPDATE public.admission_document_checklist_items SET received_at=clock_timestamp(),notes='Synthetic physical receipt' WHERE admission_case_id=(SELECT admission FROM rr_native) AND document_type='form_1823';
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT staff,org,site_a,'Synthetic','Observer','resident_aide',current_date FROM rr_native,cf;
INSERT INTO public.resident_observation_plans(id,organization_id,facility_id,resident_id,rationale) SELECT plan,org,site_a,res1,'Synthetic source review fixture with a recorded observation plan rationale for authorization testing only.' FROM rr_native,cf;
INSERT INTO public.resident_observation_tasks(id,organization_id,facility_id,resident_id,plan_id,scheduled_for,due_at,grace_ends_at,status)
 SELECT native_task,org,site_a,res1,plan,now()-interval '2 days',now()-interval '2 days',now()-interval '2 days','completed_on_time' FROM rr_native,cf;
INSERT INTO public.resident_observation_logs(id,organization_id,facility_id,resident_id,task_id,staff_id,observed_at,quick_status)
 SELECT native_log,org,site_a,res1,native_task,staff,now()-interval '2 days','awake' FROM rr_native,cf;
UPDATE public.resident_observation_tasks SET completed_log_id=(SELECT native_log FROM rr_native) WHERE id=(SELECT native_task FROM rr_native);
-- Build canonical review tasks through the same publication/manual commands.
SELECT pg_temp.c_login('owner'); SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_'||key,public.save_operation_requirement_draft_review(a.id,'{"title":"Synthetic source review","wording":"Review selected recorded metadata","allowed_recorder_roles":["facility_admin"],"subject_kind":"resident"}')
 FROM (VALUES('vital','hfo-al-d12-01'),('round','hfo-al-d07-01')) m(key,activity_key) JOIN public.operation_activities a USING(activity_key) WHERE a.organization_id=(SELECT org FROM cf);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label IN('v_vital','v_round');
SELECT public.publish_operation_requirement_review(id,clock_timestamp()-interval '1 hour') FROM cf_ids WHERE label IN('v_vital','v_round');
RESET ROLE; SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_'||key,public.save_operation_facility_requirement_draft_review(a.id,(SELECT site_a FROM cf),jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_'||key),'schedule_status','needs_confirmation'))
 FROM (VALUES('vital','hfo-al-d12-01'),('round','hfo-al-d07-01')) m(key,activity_key) JOIN public.operation_activities a USING(activity_key) WHERE a.organization_id=(SELECT org FROM cf);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label IN('fr_vital','fr_round');
SELECT public.publish_operation_facility_requirement_review(id,clock_timestamp()-interval '30 minutes') FROM cf_ids WHERE label IN('fr_vital','fr_round');
INSERT INTO cf_results SELECT 'manual_'||key,public.create_operation_manual_occurrence_review(a.id,(SELECT site_a FROM cf),(SELECT subj_res1 FROM cf),'col155-manual-'||key,'{}')
 FROM (VALUES('vital','hfo-al-d12-01'),('round','hfo-al-d07-01')) m(key,activity_key) JOIN public.operation_activities a USING(activity_key) WHERE a.organization_id=(SELECT org FROM cf);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label IN('manual_vital','manual_round');
SELECT pg_temp.c_assert(haven.read_resident_review_source(pg_temp.rid('manual_vital'),'vital_observation',(SELECT vital FROM rr_native),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr)) IS NOT NULL,'late-entered past vital not readable');
SELECT pg_temp.c_assert(haven.read_resident_review_source(pg_temp.rid('manual_round'),'rounding',(SELECT native_log FROM rr_native),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr)) IS NOT NULL,'completed native task/log not readable');
SELECT pg_temp.c_assert(haven.read_resident_review_source(pg_temp.rid('manual_review'),'form_1823',(SELECT form FROM rr_native),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr)) IS NOT NULL,'current document incorrectly tied to past log period');
INSERT INTO cf_results SELECT 'manual_form',public.create_operation_manual_occurrence_review(activity,site_a,subj_res1,'col155-manual-form','{}') FROM rr,cf;
INSERT INTO cf_ids SELECT 'manual_form',(result->>'id')::uuid FROM cf_results WHERE label='manual_form';
CREATE TEMP TABLE rr_form_result AS SELECT public.record_resident_source_review(pg_temp.rid('manual_form'),'col155-record-form',
 (SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_form')),today-7,today-1,
 jsonb_build_array(jsonb_build_object('family','form_1823','source_id',form,'source_version',haven.read_resident_review_source(pg_temp.rid('manual_form'),'form_1823',form,today-7,today-1)->>'source_version')),'{"outcome":"performed"}') result FROM rr,rr_native;
GRANT ALL ON rr_form_result TO authenticated;
CREATE TEMP TABLE rr_native_results AS SELECT key,public.record_resident_source_review(pg_temp.rid(task_label),'col155-record-'||key,
 (SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid(task_label)),today-7,today-1,
 jsonb_build_array(jsonb_build_object('family',family,'source_id',source_id,'source_version',haven.read_resident_review_source(pg_temp.rid(task_label),family,source_id,today-7,today-1)->>'source_version')),'{"outcome":"performed"}') result
 FROM rr CROSS JOIN rr_native CROSS JOIN LATERAL (VALUES('vital','manual_vital','vital_observation',vital),('round','manual_round','rounding',native_log)) x(key,task_label,family,source_id);
GRANT ALL ON rr_native_results TO authenticated;
RESET ROLE; SELECT pg_temp.c_clear();
SELECT pg_temp.c_expect($q$UPDATE public.resident_observation_logs SET note='Cannot silently correct immutable observation' WHERE id=(SELECT native_log FROM rr_native)$q$,'immutable');
UPDATE public.resident_observation_tasks SET completed_log_id=NULL WHERE id=(SELECT native_task FROM rr_native);
UPDATE public.form_1823_records SET expiration_date=(SELECT today-1 FROM rr) WHERE id=(SELECT form FROM rr_native);
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert(public.read_resident_source_reviews(pg_temp.rid('manual_round'))#>>'{reviews,0,references,0,current_state}'='unavailable' AND public.read_resident_source_reviews(pg_temp.rid('manual_round'))#>>'{reviews,0,references,0,source_id}'=(SELECT native_log::text FROM rr_native),'superseded readable observation citation lost');
SELECT pg_temp.c_assert(haven.resident_review_source_visible(pg_temp.rid('manual_review'),'form_1823',(SELECT form FROM rr_native)) AND haven.read_resident_review_source(pg_temp.rid('manual_review'),'form_1823',(SELECT form FROM rr_native),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr)) IS NULL,'expired document visibility/eligibility conflated');
SELECT pg_temp.c_assert(public.read_resident_source_reviews(pg_temp.rid('manual_form'))#>>'{reviews,0,references,0,current_state}'='unavailable' AND public.read_resident_source_reviews(pg_temp.rid('manual_form'))#>>'{reviews,0,references,0,source_id}'=(SELECT form::text FROM rr_native),'expired readable form lost original citation');
SELECT pg_temp.c_assert(haven.read_resident_review_source(pg_temp.rid('manual_review'),'resident_contact',gen_random_uuid(),(SELECT today-7 FROM rr),(SELECT today FROM rr)) IS NULL,'wrong source identifier leaked');
RESET ROLE; SELECT pg_temp.c_login('admin_b'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied(format('SELECT public.read_resident_source_reviews(%L)',pg_temp.rid('manual_review')));
RESET ROLE; SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
-- COL155-FIXTURE-END
SELECT pg_temp.c_expect($q$SELECT public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-stale-001',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_review')),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr),jsonb_build_array(jsonb_build_object('family','resident_contact','source_id',(SELECT contact FROM rr),'source_version',repeat('a',64))),'{"outcome":"performed"}')$q$,'source changed');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE request_key='col155-stale-001'),'stale review wrote receipt');
SELECT pg_temp.c_expect($q$SELECT public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-future-001',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_review')),(SELECT today FROM rr),(SELECT today+1 FROM rr),'[]','{"outcome":"performed"}')$q$,'period is invalid');
-- References are a single HFO transaction: an audit failure must leave no review receipt.
RESET ROLE; SELECT pg_temp.c_clear();
CREATE FUNCTION pg_temp.fail_resident_ref_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='resident_review_references' THEN RAISE EXCEPTION 'synthetic reference audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER col155_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_resident_ref_audit();
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-audit-fail-001',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_review')),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr),jsonb_build_array(jsonb_build_object('family','resident_contact','source_id',(SELECT contact FROM rr),'source_version',(SELECT result->>'source_version' FROM rr_source))),'{"outcome":"performed"}')$q$,'synthetic reference audit failure');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE request_key='col155-audit-fail-001'),'failed source reference left receipt');
RESET ROLE; SELECT pg_temp.c_clear(); DROP TRIGGER col155_audit_failure ON public.audit_log;
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE rr_result AS SELECT public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-record-001',
 (SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_review')),today-7,today-1,
 jsonb_build_array(jsonb_build_object('family','resident_contact','source_id',contact,'source_version',(SELECT result->>'source_version' FROM rr_source))),
 '{"outcome":"performed","note":"Explicit human review"}') result FROM rr;
GRANT ALL ON rr_result TO authenticated;
SELECT pg_temp.c_assert((SELECT result->'receipt_outcome'->'receipt'->>'recorder_id'=(SELECT admin_a::text FROM cf) FROM rr_result),'review actor lost');
SELECT pg_temp.c_assert((SELECT jsonb_array_length(public.read_resident_source_reviews(pg_temp.rid('manual_review'))->'reviews')=1),'review history missing');
SELECT pg_temp.c_assert((SELECT public.read_resident_source_reviews(pg_temp.rid('manual_review'))#>>'{reviews,0,references,0,current_state}'='current'),'initial source not current');
SELECT pg_temp.c_assert((public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-record-001',repeat('a',64),(SELECT today-7 FROM rr),(SELECT today-1 FROM rr),jsonb_build_array(jsonb_build_object('family','resident_contact','source_id',(SELECT contact FROM rr),'source_version',(SELECT result->>'source_version' FROM rr_source))),'{"outcome":"performed","note":"Explicit human review"}')->>'replayed')::boolean,'same-key replay failed');
SELECT pg_temp.c_expect($q$SELECT public.record_resident_source_review(pg_temp.rid('manual_review'),'col155-record-001',repeat('a',64),(SELECT today-6 FROM rr),(SELECT today-1 FROM rr),jsonb_build_array(jsonb_build_object('family','resident_contact','source_id',(SELECT contact FROM rr),'source_version',(SELECT result->>'source_version' FROM rr_source))),'{"outcome":"performed"}')$q$,'conflicts');
RESET ROLE; SELECT pg_temp.c_clear();
UPDATE public.resident_contacts SET phone='555-0100' WHERE id=(SELECT contact FROM rr);
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert(public.read_resident_source_reviews(pg_temp.rid('manual_review'))#>>'{reviews,0,references,0,current_state}'='changed','changed source not detected');
SELECT public.recheck_resident_source_review(pg_temp.rid('manual_review'),(SELECT (result->'references'->0->>'reference_id')::uuid FROM rr_result),'col155-recheck-001');
SELECT public.recheck_resident_source_review(pg_temp.rid('manual_review'),(SELECT (result->'references'->0->>'reference_id')::uuid FROM rr_result),'col155-recheck-001');
SELECT pg_temp.c_assert(jsonb_array_length(public.read_resident_source_reviews(pg_temp.rid('manual_review'))#>'{reviews,0,references,0,checks}')=1,'duplicate recheck');
RESET ROLE; SELECT pg_temp.c_clear();
-- Native RLS denial while HFO task/domain access still remains.
CREATE POLICY col155_contact_deny ON public.resident_contacts AS RESTRICTIVE FOR SELECT TO authenticated USING(false);
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert(haven.operation_task_readable(pg_temp.rid('manual_review')),'HFO access unexpectedly absent');
SELECT pg_temp.c_assert(public.read_resident_source_reviews(pg_temp.rid('manual_review'))#>>'{reviews,0,references,0,source_id}' IS NULL,'native denied citation leaked');
SELECT pg_temp.c_assert(public.read_resident_source_reviews(pg_temp.rid('manual_review'))#>>'{reviews,0,references,0,current_state}'='unavailable','native denial not unavailable');
SELECT public.recheck_resident_source_review(pg_temp.rid('manual_review'),(SELECT (result->'references'->0->>'reference_id')::uuid FROM rr_result),'col155-deniedcheck-001');
SELECT public.recheck_resident_source_review(pg_temp.rid('manual_review'),(SELECT (result->'references'->0->>'reference_id')::uuid FROM rr_result),'col155-deniedcheck-001');
SELECT pg_temp.c_denied('UPDATE haven.resident_review_references SET source_version=repeat(''a'',64)');
SELECT pg_temp.c_denied('DELETE FROM haven.resident_review_checks');
RESET ROLE; SELECT pg_temp.c_clear();
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE table_name IN('resident_review_references','resident_review_checks','resident_review_requests') AND haven.operation_audit_row_current(audit_log)),'generic audit exposure');
SELECT pg_temp.c_assert(haven.resident_review_document_current('received','2026-09-01','2026-09-13','2026-09-01T12:00Z','received paper','Physician','2026-09-13','2026-09-13T12:00Z') AND NOT haven.resident_review_document_current('received','2026-09-01','2026-09-13','2026-09-01T12:00Z','received paper','Physician','2026-09-14','2026-09-14T12:00Z'),'document clock expiry did not change readiness');
ROLLBACK;
