-- COL-145: corrections, reversals and bound reviews on the disposable replay.
-- Proves that recorded work changes only by appending: a correction restates
-- the work in full, supersedes the exact receipt the corrector read (a stale
-- revision, a wrong id or an already superseded receipt conflicts naming the
-- current receipt) and leaves the corrected receipt verbatim; finalized
-- evidence counts across the chain and never across a reversal; a correction
-- reopens review when the rule requires it and a review binds to the receipt
-- and revision it reviewed; a reversal returns the occurrence to unrecorded
-- (pending or missed by its deadline) with the reversed chain readable; every
-- legacy writer is refused on managed rows without a partial write; a forced
-- audit failure leaves receipts and occurrence untouched; direct DML, DELETE
-- and TRUNCATE are refused. Authenticated SQL behaviour with synthetic
-- fixtures; not hosted, browser or staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-145 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-145 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR coalesce(d,'')=detail_fragment) AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-145 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations corrects, reverses or reviews anything, and every receipt is its own chain root.
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts),'a migration created a receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE chain_id<>id OR corrects_receipt_id IS NOT NULL OR superseded_by_receipt_id IS NOT NULL OR superseded_at IS NOT NULL OR receipt_kind='reversal'),'a migration corrected or reversed a receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_audit_log WHERE event_type IN('corrected','reversed')),'a migration wrote a correction event');

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
 UNION ALL SELECT nurse,nurse||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM cf
 UNION ALL SELECT aide,aide||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM cf
 UNION ALL SELECT mgr,mgr||'@correction.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Manager"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@correction.invalid','Corporate','owner'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_a,admin_a||'@correction.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_b,admin_b||'@correction.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT maint,maint||'@correction.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM cf
 UNION ALL SELECT nurse,nurse||'@correction.invalid','Nurse','nurse'::public.app_role,org,true FROM cf
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
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
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
INSERT INTO cf_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'),
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
INSERT INTO cf_results SELECT 'photo_fac1',pg_temp.photo('r_fac1','ph1',(SELECT maint FROM cf));
INSERT INTO cf_results SELECT 'photo_fac3',pg_temp.photo('r_fac3','ph3',(SELECT maint FROM cf));
SELECT pg_temp.c_assert((SELECT bool_and(result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'execution_state'='completed') FROM cf_results WHERE label LIKE 'photo\_%'),'fixture photos did not satisfy their receipts');
RESET ROLE;
SELECT pg_temp.c_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_res1',public.record_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('res1-000001'),'{"outcome":"performed","note":"Weight stable"}');
INSERT INTO cf_ids SELECT 'r_res1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_res1';
RESET ROLE;
SELECT pg_temp.c_assert((SELECT bool_and(chain_id=id AND correction_seq=0 AND corrects_receipt_id IS NULL AND superseded_by_receipt_id IS NULL AND superseded_at IS NULL) FROM public.operation_execution_receipts),'recordings are not their own chain roots');
-- Snapshot of every receipt's immutable facts before any correction.
CREATE TEMP TABLE cf_snapshot AS SELECT id receipt_id,to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at'] receipt_json FROM public.operation_execution_receipts r;
GRANT SELECT ON cf_snapshot TO authenticated;
-- FIXTURES-END

-- Correct with the right id and revision: a new effective receipt in the same chain; the corrected receipt verbatim except its supersession.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_a1',public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000001'),pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Battery was misread","outcome":"performed","values":{"pads_ok":true,"battery_pct":75},"note":"Battery at 75"}');
INSERT INTO cf_ids SELECT 'c_a1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_a1';
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'receipt'->>'receipt_kind'='performance' AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_a1') AND (result->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_a1')
 AND (result->'receipt'->>'correction_seq')::int=1 AND result->'receipt'->>'correction_reason'='Battery was misread' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM cf) AND result->'receipt'->>'superseded_by_receipt_id' IS NULL
 AND result->'receipt'->'values'='{"pads_ok":true,"battery_pct":75}'::jsonb AND result->'receipt'->>'completion_state'='completed' AND result->'receipt'->>'evidence_status'='not_required' AND result->'receipt'->>'revision'<>pg_temp.rev('r_a1')
 AND (result->'corrected'->>'id')::uuid=pg_temp.rid('r_a1') AND (result->'corrected'->>'superseded_by_receipt_id')::uuid=pg_temp.rid('c_a1') AND result->'corrected'->>'superseded_at' IS NOT NULL
 AND result->'occurrence'->>'status'='completed' AND result->'occurrence'->>'execution_state'='completed' AND jsonb_typeof(result->'issue')='null' AND jsonb_typeof(result->'verification_superseded_receipt_id')='null'
 FROM cf_results WHERE label='cor_a1'),'correction reply is not a chained restatement');
-- The reply carries exactly these top-level keys (the route contract), on the first call and on a replay.
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['corrected','issue','occurrence','receipt','replayed','verification_superseded_receipt_id'] FROM jsonb_object_keys(pg_temp.res('cor_a1')) k),'correction reply keys drifted');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['execution_state','id','occurrence_revision','performed_at','status'] FROM jsonb_object_keys(pg_temp.res('cor_a1')->'occurrence') k),'correction reply occurrence keys drifted');
SELECT pg_temp.c_assert((SELECT to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at']=s.receipt_json FROM public.operation_execution_receipts r JOIN cf_snapshot s ON s.receipt_id=r.id WHERE r.id=pg_temp.rid('r_a1')),'the corrected receipt was rewritten');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('c_a1') AND superseded_at IS NOT NULL AND revision=pg_temp.rev('r_a1') AND recorder_id=(SELECT maint FROM cf) AND performed_at=(pg_temp.res('rec_a1')->'receipt'->>'performed_at')::timestamptz AND recorded_at=(pg_temp.res('rec_a1')->'receipt'->>'recorded_at')::timestamptz
 FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1')),'the corrected receipt lost its performer, performed-at or recorded-at');
SELECT pg_temp.c_assert((SELECT effective_receipt_id=pg_temp.rid('c_a1') AND status='completed' AND execution_state='completed' AND signed_by=(SELECT maint FROM cf) AND verified_by=(SELECT maint FROM cf) AND completed_at IS NOT NULL AND completion_notes='Battery at 75'
 AND performed_at=(pg_temp.res('cor_a1')->'receipt'->>'performed_at')::timestamptz AND sla_met=true FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d1')),'occurrence projection not moved to the correction');
-- A correction that omits performed_at keeps the corrected receipt's performed instant (never the correction clock) and the occurrence's SLA fact.
SELECT pg_temp.c_assert((SELECT (pg_temp.res('cor_a1')->'receipt'->>'performed_at')::timestamptz=(pg_temp.res('rec_a1')->'receipt'->>'performed_at')::timestamptz
 AND (pg_temp.res('cor_a1')->'receipt'->>'recorded_at')::timestamptz>(pg_temp.res('rec_a1')->'receipt'->>'recorded_at')::timestamptz),'a correction without performed_at moved the performed instant');
SELECT pg_temp.c_assert((SELECT performed_at=(pg_temp.res('rec_a1')->'receipt'->>'performed_at')::timestamptz AND sla_met=true FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d1')),'occurrence performed instant or SLA fact changed by a correction without performed_at');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1') AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'more than one effective performance receipt');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_a1_d1') AND event_type='corrected' AND actor_id=(SELECT maint FROM cf) AND event_notes='Battery was misread'
 AND (event_data->>'receipt_id')::uuid=pg_temp.rid('c_a1') AND (event_data->>'corrected_receipt_id')::uuid=pg_temp.rid('r_a1') AND (event_data->>'chain_id')::uuid=pg_temp.rid('r_a1') AND (event_data->>'correction_seq')::int=1
 AND event_data->>'previous_execution_state'='completed' AND event_data->>'request_key'=pg_temp.k('cor-a1-000001') AND event_data ? 'request_hash'),'corrected audit row missing');
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_a1_d1') AND event_type='completed'),'completed audit row for the correction missing');
SET LOCAL ROLE authenticated;
-- Replay: same key and content returns the same correction; changed content conflicts; nothing new is written.
INSERT INTO cf_results SELECT 'cor_a1_replay',public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000001'),pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Battery was misread","outcome":"performed","values":{"pads_ok":true,"battery_pct":75},"note":"Battery at 75"}');
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'receipt'->>'id')::uuid=pg_temp.rid('c_a1') AND (result->'corrected'->>'id')::uuid=pg_temp.rid('r_a1') FROM cf_results WHERE label='cor_a1_replay'),'correction replay did not return the same receipt');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['corrected','issue','occurrence','receipt','replayed','verification_superseded_receipt_id'] FROM jsonb_object_keys(pg_temp.res('cor_a1_replay')) k),'correction replay reply keys drifted');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000001'),pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Battery was misread","outcome":"performed","values":{"pads_ok":true,"battery_pct":76}}')$q$,'already saved with different content');
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1')),'a replay or conflict created a receipt');
-- Conflicts name the current receipt: a stale revision, a wrong id and a second correction of the superseded receipt.
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000002'),pg_temp.rid('c_a1'),repeat('a',64),'{"reason":"Again","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c_a1')||';current_receipt_revision='||pg_temp.rev('c_a1'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000002'),pg_temp.rid('r_a2'),pg_temp.rev('r_a2'),'{"reason":"Again","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c_a1')||';current_receipt_revision='||pg_temp.rev('c_a1'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000002'),pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Again","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c_a1')||';current_receipt_revision='||pg_temp.rev('c_a1'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('rev-a1-000002'),pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Again"}')$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c_a1')||';current_receipt_revision='||pg_temp.rev('c_a1'),'P0001');
-- Shape: reason, expected receipt and revision are required; the statement rules are the record rules.
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),'{"outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,'A correction reason is required');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),'{"reason":"  ","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,'reason must be text');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),NULL,pg_temp.rev('c_a1'),'{"reason":"x","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,'An expected receipt is required');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),pg_temp.rid('c_a1'),'nope','{"reason":"x","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,'An expected receipt revision is required');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),'{"reason":"x","outcome":"performed","values":{"pads_ok":true,"battery_pct":170}}')$q$,'input battery_pct must be at most 100');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000003'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),'{"reason":"x","outcome":"performed","values":{"pads_ok":true,"battery_pct":70},"recorder_id":"x"}')$q$,'not editable');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),'short',pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),'{"reason":"x","outcome":"performed","values":{"pads_ok":true,"battery_pct":70}}')$q$,'request key is required');
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1')),'a refused correction created a receipt');
-- The late rule anchors on the chain root's recording: a corrected performed time never follows it, and one earlier than fifteen minutes before it is a late entry that may take the correction reason.
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000004'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),jsonb_build_object('reason','Time fix','outcome','performed','values','{"pads_ok":true,"battery_pct":70}'::jsonb,'performed_at',(SELECT recorded_at FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1'))+interval '5 minutes'))$q$,'Corrected performed time cannot be after the original recording');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000004'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),jsonb_build_object('reason','Time fix','outcome','performed','values','{"pads_ok":true,"battery_pct":70}'::jsonb,'performed_at',(SELECT recorded_at FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1'))-interval '2 hours'))$q$,'must be entered as late');
INSERT INTO cf_results SELECT 'cor_a1_late',public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000004'),pg_temp.rid('c_a1'),pg_temp.rev('c_a1'),jsonb_build_object('reason','The check was done two hours before it was typed in','entry_kind','late','outcome','performed','values','{"pads_ok":true,"battery_pct":75}'::jsonb,'performed_at',(SELECT recorded_at FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1'))-interval '2 hours'));
INSERT INTO cf_ids SELECT 'c_a1_late',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_a1_late';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'entry_kind'='late' AND result->'receipt'->>'entry_reason'='The check was done two hours before it was typed in' AND (result->'receipt'->>'correction_seq')::int=2 AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_a1')
 AND (result->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('c_a1') AND (result->'corrected'->>'superseded_by_receipt_id')::uuid=pg_temp.rid('c_a1_late') FROM cf_results WHERE label='cor_a1_late'),'late correction did not take the correction reason or extend the chain');
SELECT pg_temp.c_assert((SELECT performed_at<(SELECT recorded_at FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1'))-interval '119 minutes' AND effective_receipt_id=pg_temp.rid('c_a1_late') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d1')),'occurrence did not take the corrected performed instant');
SELECT pg_temp.c_assert((SELECT array_agg(coalesce(corrects_receipt_id::text,'root') ORDER BY correction_seq)=ARRAY['root',pg_temp.rid('r_a1')::text,pg_temp.rid('c_a1')::text] FROM public.operation_execution_receipts WHERE chain_id=pg_temp.rid('r_a1')),'chain history is not readable in order');
-- The inherited performed instant is the one the late rule judges: correcting the late receipt without performed_at is still a late entry, and an explicit instant past the root recording is refused.
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000005'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"Routine restatement of a late entry","outcome":"performed","values":{"pads_ok":true,"battery_pct":75}}')$q$,'must be entered as late');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-a1-000005'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),jsonb_build_object('reason','Move it later','entry_kind','late','outcome','performed','values','{"pads_ok":true,"battery_pct":75}'::jsonb,'performed_at',(SELECT recorded_at FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1'))+interval '3 minutes'))$q$,'Corrected performed time cannot be after the original recording',NULL,'22023');
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM public.operation_execution_receipts WHERE chain_id=pg_temp.rid('r_a1')) AND (SELECT effective_receipt_id=pg_temp.rid('c_a1_late') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d1')),'a refused time correction wrote something');
-- A correction to failed requires and creates its issue in the same transaction.
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a2_d1'),pg_temp.k('cor-a2-000001'),pg_temp.rid('r_a2'),pg_temp.rev('r_a2'),'{"reason":"Pads were actually expired","outcome":"failed","values":{"pads_ok":false,"battery_pct":80}}')$q$,'requires an issue');
INSERT INTO cf_results SELECT 'cor_a2',public.correct_operation_work_review(pg_temp.rid('occ_a2_d1'),pg_temp.k('cor-a2-000001'),pg_temp.rid('r_a2'),pg_temp.rev('r_a2'),'{"reason":"Pads were actually expired","outcome":"failed","values":{"pads_ok":false,"battery_pct":80},"issue":{"summary":"Pads expired","severity":"high"}}');
INSERT INTO cf_ids SELECT 'c_a2',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_a2';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'completion_state'='failed' AND result->'issue'->>'issue_kind'='failed_result' AND (result->'issue'->>'receipt_id')::uuid=pg_temp.rid('c_a2') AND (result->'receipt'->>'issue_id')::uuid=(result->'issue'->>'id')::uuid
 AND result->'occurrence'->>'status'='in_progress' AND result->'occurrence'->>'execution_state'='failed' FROM cf_results WHERE label='cor_a2'),'failed correction did not create a linked issue');
SELECT pg_temp.c_assert((SELECT status='in_progress' AND execution_state='failed' AND completed_at IS NULL AND verified_by IS NULL AND effective_receipt_id=pg_temp.rid('c_a2') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d1')),'occurrence did not follow the failed correction');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_a2_d1') AND event_type='issue_reported' AND (event_data->>'receipt_id')::uuid=pg_temp.rid('c_a2')),'issue audit row for the correction missing');

-- Evidence across the chain: the photo finalized on the original satisfies the correction; new evidence attaches to the effective receipt only.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_fac1',public.correct_operation_work_review(pg_temp.rid('occ_fac_d1'),pg_temp.k('cor-fac1-000001'),pg_temp.rid('r_fac1'),pg_temp.rev('r_fac1'),'{"reason":"Note was wrong","outcome":"performed","note":"Ran fine, transfer switch tested"}');
INSERT INTO cf_ids SELECT 'c_fac1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_fac1';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'evidence_status'='complete' AND result->'receipt'->>'evidence_status_current'='complete' AND result->'receipt'->'missing_evidence'='[]'::jsonb AND result->'receipt'->>'completion_state'='completed' AND result->'occurrence'->>'status'='completed' FROM cf_results WHERE label='cor_fac1'),'finalized evidence on the original did not satisfy the correction');
SELECT pg_temp.c_assert((SELECT bool_and(receipt_id=pg_temp.rid('r_fac1')) FROM public.operation_evidence WHERE task_instance_id=pg_temp.rid('occ_fac_d1')),'evidence rows moved off their receipt');
SELECT pg_temp.c_expect($q$SELECT public.prepare_operation_evidence_review(pg_temp.rid('r_fac1'),pg_temp.k('prep-old-0001'),pg_temp.obj('{"kind":"photo","filename":"late.jpg","mime":"image/jpeg","size_bytes":10}'))$q$,'Evidence attaches to the effective performance receipt');
INSERT INTO cf_results SELECT 'prep_c_fac1',public.prepare_operation_evidence_review(pg_temp.rid('c_fac1'),pg_temp.k('prep-new-0001'),pg_temp.obj('{"kind":"photo","filename":"extra.jpg","mime":"image/jpeg","size_bytes":10}'));
SELECT pg_temp.c_assert((SELECT result->'evidence'->>'state'='prepared' AND (result->'evidence'->>'receipt_id')::uuid=pg_temp.rid('c_fac1') FROM cf_results WHERE label='prep_c_fac1'),'supplementary evidence did not attach to the correction');
-- A correction of work still missing its evidence stays performed-with-missing-evidence, and a photo finalized against the correction satisfies it once.
INSERT INTO cf_results SELECT 'cor_fac2',public.correct_operation_work_review(pg_temp.rid('occ_fac_d2'),pg_temp.k('cor-fac2-000001'),pg_temp.rid('r_fac2'),pg_temp.rev('r_fac2'),'{"reason":"Add the note","outcome":"performed","note":"Load test 30 minutes"}');
INSERT INTO cf_ids SELECT 'c_fac2',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_fac2';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'evidence_status'='missing' AND result->'receipt'->'missing_evidence'->0->>'label'='Panel photo' AND result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'occurrence'->>'execution_state'='performed_missing_evidence' FROM cf_results WHERE label='cor_fac2'),'a correction without evidence reported complete');
INSERT INTO cf_results SELECT 'photo_c_fac2',pg_temp.photo('c_fac2','ph2',(SELECT maint FROM cf));
SELECT pg_temp.c_assert((SELECT result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'execution_state'='completed' FROM cf_results WHERE label='photo_c_fac2'),'evidence finalized against the correction did not satisfy it');
SELECT pg_temp.c_assert((SELECT evidence_status_current='complete' AND evidence_satisfied_at IS NOT NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('c_fac2')) AND (SELECT evidence_status_current='missing' FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_fac2')),'satisfaction landed on the wrong receipt');
SELECT pg_temp.c_assert((SELECT effective_receipt_id=pg_temp.rid('c_fac2') AND status='completed' AND signed_by=(SELECT maint FROM cf) FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fac_d2')),'occurrence did not complete on the corrected chain');
RESET ROLE;
-- Authority: a non-recorder for the activity and the other site are denied before any write; a random receipt id on a readable occurrence conflicts, never discloses.
SELECT pg_temp.c_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-nurse-0001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"Not mine","outcome":"performed","values":{"pads_ok":true,"battery_pct":75}}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('rev-nurse-0001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"Not mine"}')$q$);
RESET ROLE;
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-b-000001'),pg_temp.rid('c_a1_late'),repeat('a',64),'{"reason":"Other site","outcome":"performed","values":{"pads_ok":true,"battery_pct":75}}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('rev-b-000001'),pg_temp.rid('c_a1_late'),repeat('a',64),'{"reason":"Other site"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.correct_operation_work_review(gen_random_uuid(),pg_temp.k('cor-b-000002'),gen_random_uuid(),repeat('a',64),'{"reason":"Other site","outcome":"performed"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-b-000001'),'{"decision":"verified"}')$q$);
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_execution_receipts),'the other site can read receipts');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_execution_receipts WHERE recorder_id IN(SELECT nurse FROM cf UNION ALL SELECT admin_b FROM cf) AND receipt_kind<>'performance' OR corrects_receipt_id IS NOT NULL AND recorder_id IN(SELECT nurse FROM cf UNION ALL SELECT admin_b FROM cf)),'a denied correction wrote a receipt');

-- Review binding: the review names the receipt and revision it reviewed; a correction supersedes it and the occurrence awaits review again.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000001'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('r_a1'),'receipt_revision',pg_temp.rev('r_res1')))$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('r_res1')||';current_receipt_revision='||pg_temp.rev('r_res1'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000001'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('r_res1'),'receipt_revision',repeat('b',64)))$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('r_res1')||';current_receipt_revision='||pg_temp.rev('r_res1'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000001'),'{"decision":"verified","receipt_id":"not-a-uuid"}')$q$,'receipt_id must be a uuid');
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000001'),'{"decision":"verified","receipt_revision":"short"}')$q$,'receipt_revision must be 64 hex characters');
INSERT INTO cf_results SELECT 'ver_res1',public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000001'),jsonb_build_object('decision','verified','note','Reviewed','receipt_id',pg_temp.rid('r_res1'),'receipt_revision',pg_temp.rev('r_res1')));
INSERT INTO cf_ids SELECT 'v_res1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='ver_res1';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'receipt_kind'='verification' AND (result->'receipt'->>'verifies_receipt_id')::uuid=pg_temp.rid('r_res1') AND result->'receipt'->>'verified_receipt_revision'=pg_temp.rev('r_res1') AND result->'occurrence'->>'status'='completed' FROM cf_results WHERE label='ver_res1'),'review did not bind to the reviewed receipt');
SELECT pg_temp.c_assert((SELECT verification_receipt_id=pg_temp.rid('v_res1') AND second_sign_by=(SELECT admin_a FROM cf) AND execution_state='completed' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d1')),'verification mirrors wrong');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d1') AND event_type='verified' AND (event_data->>'performance_receipt_id')::uuid=pg_temp.rid('r_res1') AND event_data->>'verified_receipt_revision'=pg_temp.rev('r_res1')),'verified audit row does not name the receipt and revision');
SELECT pg_temp.c_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_res1',public.correct_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('cor-res1-000001'),pg_temp.rid('r_res1'),pg_temp.rev('r_res1'),'{"reason":"Weight was entered for the wrong week","outcome":"performed","note":"Weight down 2 lb"}');
INSERT INTO cf_ids SELECT 'c_res1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_res1';
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'completion_state'='awaiting_verification' AND (result->>'verification_superseded_receipt_id')::uuid=pg_temp.rid('v_res1') AND result->'occurrence'->>'status'='in_progress' AND result->'occurrence'->>'execution_state'='awaiting_verification' FROM cf_results WHERE label='cor_res1'),'correction did not reopen review');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('c_res1') AND superseded_at IS NOT NULL AND verifies_receipt_id=pg_temp.rid('r_res1') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('v_res1')),'the review was not superseded with its receipt');
SELECT pg_temp.c_assert((SELECT verification_receipt_id IS NULL AND second_sign_by IS NULL AND second_signed_at IS NULL AND verified_by IS NULL AND completed_at IS NULL AND signed_by=(SELECT nurse FROM cf) AND effective_receipt_id=pg_temp.rid('c_res1') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d1')),'review mirrors not cleared on correction');
SELECT pg_temp.c_denied($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-nurse'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('c_res1'),'receipt_revision',pg_temp.rev('c_res1')))$q$);
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d1') AND event_type='corrected' AND (event_data->>'superseded_verification_receipt_id')::uuid=pg_temp.rid('v_res1') AND event_data->>'completion_state'='awaiting_verification'),'corrected audit row does not name the superseded review');
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000002'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('r_res1'),'receipt_revision',pg_temp.rev('r_res1')))$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('c_res1')||';current_receipt_revision='||pg_temp.rev('c_res1'),'P0001');
INSERT INTO cf_results SELECT 'ver_res1_again',public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000002'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('c_res1'),'receipt_revision',pg_temp.rev('c_res1')));
INSERT INTO cf_ids SELECT 'v_res1_again',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='ver_res1_again';
SELECT pg_temp.c_assert((SELECT (result->'receipt'->>'verifies_receipt_id')::uuid=pg_temp.rid('c_res1') AND result->'receipt'->>'verified_receipt_revision'=pg_temp.rev('c_res1') AND result->'occurrence'->>'status'='completed' FROM cf_results WHERE label='ver_res1_again'),'second review did not bind to the correction');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d1') AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL) AND (SELECT count(*)=4 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d1')),'review history wrong');
SELECT pg_temp.c_expect($q$SELECT public.verify_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('ver-res1-000003'),'{"decision":"verified"}')$q$,'not awaiting verification');
RESET ROLE;

-- Reversal: the occurrence returns to unrecorded, missed or pending by its deadline; started_at stays; a new recording starts a new chain; the reversed chain stays readable; its evidence counts for nothing.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT public.haven_operation_task_command(pg_temp.rid('occ_a1_d0'),'start','{}')->>'status'='in_progress'),'start refused on the past occurrence');
INSERT INTO cf_results SELECT 'rec_a1_d0',public.record_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('a1d0-000001'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":60}'::jsonb,'entry_kind','late','entry_reason','Found the paper entry','performed_at',clock_timestamp()-interval '30 minutes'));
INSERT INTO cf_ids SELECT 'r_a1_d0',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_a1_d0';
SELECT pg_temp.c_assert((SELECT status='completed' AND started_at IS NOT NULL AND sla_met=false FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'past occurrence not recorded');
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('rev-a1d0-000001'),pg_temp.rid('r_a1_d0'),pg_temp.rev('r_a1_d0'),'{"reason":"x","outcome":"performed"}')$q$,'Reversal payload field is not editable');
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('rev-a1d0-000001'),pg_temp.rid('r_a1_d0'),pg_temp.rev('r_a1_d0'),'{}')$q$,'A reversal reason is required');
INSERT INTO cf_results SELECT 'rev_a1_d0',public.reverse_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('rev-a1d0-000001'),pg_temp.rid('r_a1_d0'),pg_temp.rev('r_a1_d0'),'{"reason":"The paper entry belonged to the other unit"}');
INSERT INTO cf_ids SELECT 'x_a1_d0',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rev_a1_d0';
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'receipt'->>'receipt_kind'='reversal' AND result->'receipt'->>'completion_state'='reversed' AND result->'receipt'->>'outcome' IS NULL AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_a1_d0')
 AND (result->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_a1_d0') AND (result->'receipt'->>'correction_seq')::int=1 AND result->'receipt'->>'correction_reason'='The paper entry belonged to the other unit'
 AND (result->'receipt'->>'recorded_at')=(result->'receipt'->>'performed_at') AND (result->'reversed'->>'superseded_by_receipt_id')::uuid=pg_temp.rid('x_a1_d0')
 AND result->'occurrence'->>'status'='missed' AND result->'occurrence'->>'execution_state'='none' AND result->'occurrence'->>'performed_at' IS NULL AND jsonb_typeof(result->'verification_superseded_receipt_id')='null' FROM cf_results WHERE label='rev_a1_d0'),'reversal reply wrong');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['occurrence','receipt','replayed','reversed','verification_superseded_receipt_id'] FROM jsonb_object_keys(pg_temp.res('rev_a1_d0')) k),'reversal reply keys drifted');
SELECT pg_temp.c_assert((SELECT status='missed' AND missed_at IS NOT NULL AND execution_state='none' AND effective_receipt_id IS NULL AND verification_receipt_id IS NULL AND performed_at IS NULL AND completed_at IS NULL AND signed_by IS NULL AND signed_at IS NULL
 AND second_sign_by IS NULL AND verified_by IS NULL AND verified_at IS NULL AND sla_met IS NULL AND completion_notes IS NULL AND started_at IS NOT NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'reversal did not return the past occurrence to missed and unrecorded');
SELECT pg_temp.c_assert((SELECT to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at']=(pg_temp.res('rec_a1_d0')->'receipt')-ARRAY['superseded_by_receipt_id','superseded_at'] FROM public.operation_execution_receipts r WHERE r.id=pg_temp.rid('r_a1_d0')),'the reversed receipt was rewritten');
-- Replay of the reversal; a reversal is never corrected or reversed; nothing to reverse afterwards.
INSERT INTO cf_results SELECT 'rev_a1_d0_replay',public.reverse_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('rev-a1d0-000001'),pg_temp.rid('r_a1_d0'),pg_temp.rev('r_a1_d0'),'{"reason":"The paper entry belonged to the other unit"}');
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'receipt'->>'id')::uuid=pg_temp.rid('x_a1_d0') AND (result->'reversed'->>'id')::uuid=pg_temp.rid('r_a1_d0') FROM cf_results WHERE label='rev_a1_d0_replay'),'reversal replay failed');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['occurrence','receipt','replayed','reversed','verification_superseded_receipt_id'] FROM jsonb_object_keys(pg_temp.res('rev_a1_d0_replay')) k),'reversal replay reply keys drifted');
-- A reversal is never corrected or reversed: naming it as the expected receipt is the one wording, P0001, with no partial write.
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('rev-a1d0-000002'),pg_temp.rid('x_a1_d0'),pg_temp.rev('x_a1_d0'),'{"reason":"Reverse the reversal"}')$q$,'Occurrence has no recorded work',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('cor-a1d0-000002'),pg_temp.rid('x_a1_d0'),pg_temp.rev('x_a1_d0'),'{"reason":"Correct the reversal","outcome":"performed","values":{"pads_ok":true,"battery_pct":60}}')$q$,'Occurrence has no recorded work',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a2_d3'),pg_temp.k('rev-a2d3-000001'),pg_temp.rid('r_a2'),pg_temp.rev('r_a2'),'{"reason":"Nothing recorded"}')$q$,'Occurrence has no recorded work');
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d0')),'a refused reversal created a receipt');
-- Recording again starts a new chain, and the reversal or an old receipt as the expected one conflicts naming the new receipt.
INSERT INTO cf_results SELECT 'rec_a1_d0_again',public.record_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('a1d0-000002'),jsonb_build_object('outcome','performed','values','{"pads_ok":true,"battery_pct":65}'::jsonb,'entry_kind','late','entry_reason','Checked again today','performed_at',clock_timestamp()-interval '1 hour'));
INSERT INTO cf_ids SELECT 'r_a1_d0_again',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_a1_d0_again';
SELECT pg_temp.c_assert((SELECT (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_a1_d0_again') AND (result->'receipt'->>'correction_seq')::int=0 AND result->'receipt'->>'corrects_receipt_id' IS NULL AND result->'occurrence'->>'status'='completed' FROM cf_results WHERE label='rec_a1_d0_again'),'re-recording did not start a new chain');
SELECT pg_temp.c_assert((SELECT missed_at IS NOT NULL AND status='completed' AND effective_receipt_id=pg_temp.rid('r_a1_d0_again') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'re-recording erased the missed fact');
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('cor-a1d0-000003'),pg_temp.rid('x_a1_d0'),pg_temp.rev('x_a1_d0'),'{"reason":"Correct the reversal","outcome":"performed","values":{"pads_ok":true,"battery_pct":60}}')$q$,
 'Receipt changed since it was read','current_receipt_id='||pg_temp.rid('r_a1_d0_again')||';current_receipt_revision='||pg_temp.rev('r_a1_d0_again'),'P0001');
SELECT pg_temp.c_assert((SELECT array_agg(receipt_kind ORDER BY recorded_at)=ARRAY['performance','reversal','performance'] AND count(DISTINCT chain_id)=2 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d0')),'reversed chain not readable in history');
-- A future occurrence returns to pending; a photo-satisfied generator test reversed and re-recorded is missing its evidence again (the old chain's evidence counts for nothing).
INSERT INTO cf_results SELECT 'rev_a2',public.reverse_operation_work_review(pg_temp.rid('occ_a2_d1'),pg_temp.k('rev-a2-000001'),pg_temp.rid('c_a2'),pg_temp.rev('c_a2'),'{"reason":"Wrong unit entirely"}');
SELECT pg_temp.c_assert((SELECT result->'occurrence'->>'status'='pending' AND result->'occurrence'->>'execution_state'='none' AND (result->'receipt'->>'correction_seq')::int=2 AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_a2') FROM cf_results WHERE label='rev_a2'),'reversal of a corrected chain did not return to pending');
SELECT pg_temp.c_assert((SELECT status='pending' AND missed_at IS NULL AND completed_at IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d1')),'future occurrence not pending after reversal');
SELECT pg_temp.c_assert((SELECT status='open' AND receipt_id=pg_temp.rid('c_a2') FROM public.operation_issues WHERE id=(pg_temp.res('cor_a2')->'issue'->>'id')::uuid),'reversal touched the issue');
INSERT INTO cf_results SELECT 'rev_fac3',public.reverse_operation_work_review(pg_temp.rid('occ_fac_d3'),pg_temp.k('rev-fac3-000001'),pg_temp.rid('r_fac3'),pg_temp.rev('r_fac3'),'{"reason":"Photo shows the wrong panel"}');
INSERT INTO cf_results SELECT 'rec_fac3_again',public.record_operation_work_review(pg_temp.rid('occ_fac_d3'),pg_temp.k('fac3-000002'),'{"outcome":"performed"}');
SELECT pg_temp.c_assert((SELECT result->'receipt'->>'evidence_status'='missing' AND result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'occurrence'->>'status'='in_progress' FROM cf_results WHERE label='rec_fac3_again'),'evidence of a reversed chain counted for the new recording');
SELECT pg_temp.c_assert((SELECT state='finalized' AND receipt_id=pg_temp.rid('r_fac3') FROM public.operation_evidence WHERE task_instance_id=pg_temp.rid('occ_fac_d3')),'reversed chain evidence was touched');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM public.operation_audit_log WHERE event_type='reversed' AND actor_id=(SELECT maint FROM cf) AND event_data ? 'reversed_receipt_id' AND event_data ? 'previous_execution_state'),'reversed audit rows missing');
-- The ordinary start still works on the reverted managed row without the token and leaves every receipt untouched.
CREATE TEMP TABLE cf_receipts_before AS SELECT to_jsonb(r) j FROM public.operation_execution_receipts r;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT public.haven_operation_task_command(pg_temp.rid('occ_a2_d1'),'start','{}')->>'status'='in_progress'),'start refused on a reverted managed row');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM (SELECT to_jsonb(r) j FROM public.operation_execution_receipts r EXCEPT SELECT j FROM cf_receipts_before) x) AND (SELECT count(*)=(SELECT count(*) FROM cf_receipts_before) FROM public.operation_execution_receipts),'start touched a receipt');
SELECT pg_temp.c_assert((SELECT status='in_progress' AND execution_state='none' AND started_at IS NOT NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d1')),'start did not move the reverted row');

-- Legacy writers on managed rows: each is refused with the trusted message, and nothing is written.
CREATE TEMP TABLE cf_tasks_before AS SELECT to_jsonb(t) j FROM public.operation_task_instances t WHERE occurrence_kind IS NOT NULL;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.complete_operation_task_review(pg_temp.rid('occ_a2_d4'),(SELECT maint FROM cf),'maintenance_role','legacy click','{}')$q$,'Managed occurrences are recorded through the receipt command');
SELECT pg_temp.c_expect($q$SELECT public.complete_operation_task_review(pg_temp.rid('occ_a1_d0'),(SELECT maint FROM cf),'maintenance_role','legacy click','{}')$q$,'Managed occurrences are recorded through the receipt command');
SELECT pg_temp.c_expect($q$SELECT public.defer_operation_task_review(pg_temp.rid('occ_a2_d4'),(SELECT maint FROM cf),'maintenance_role',clock_timestamp()+interval '1 day','later','any-key')$q$,'Managed occurrences cannot be deferred by the legacy command');
SELECT pg_temp.c_expect($q$SELECT public.haven_operation_task_command(pg_temp.rid('occ_a1_d0'),'reinstate','{}')$q$,'Managed occurrences cannot be reinstated by the legacy command');
SELECT pg_temp.c_expect($q$SELECT public.haven_operation_task_command(pg_temp.rid('occ_a2_d4'),'escalate','{}')$q$,'Manual escalation requires classified delivery authority');
-- Direct session DML on the occurrence, receipts and audit trail is refused before any trigger; the forged setting changes nothing.
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed' WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='pending',completed_at=NULL,effective_receipt_id=NULL,execution_state='none',performed_at=NULL,signed_by=NULL WHERE id=pg_temp.rid('occ_a1_d1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET deleted_at=now() WHERE id=pg_temp.rid('occ_a1_d1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=NULL,superseded_at=NULL WHERE id=pg_temp.rid('r_a1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_execution_receipts SET chain_id=id WHERE id=pg_temp.rid('c_a1')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.operation_execution_receipts WHERE id=pg_temp.rid('x_a1_d0')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.operation_execution_receipts$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision,chain_id)
 SELECT org,site_a,pg_temp.rid('occ_a2_d4'),act_asset,subj_asset2,'asset',pg_temp.rid('v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000001','x','x',gen_random_uuid() FROM cf$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.operation_audit_log WHERE event_type='corrected'$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed' WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=NULL,superseded_at=NULL WHERE id=pg_temp.rid('r_a1')$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_occurrence_token()$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
RESET ROLE;
-- The service role holds UPDATE on the occurrence but the 341 fence refuses performance columns, status moves and removal, and a generic reset, with or without the forged setting.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed' WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET completed_at=now(),execution_state='completed',effective_receipt_id=pg_temp.rid('c_a1') WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='pending',completed_at=NULL,effective_receipt_id=NULL,verification_receipt_id=NULL,execution_state='none',performed_at=NULL,signed_by=NULL,signed_at=NULL,verified_by=NULL,verified_at=NULL,sla_met=NULL,completion_notes=NULL WHERE id=pg_temp.rid('occ_a1_d1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET deleted_at=now() WHERE id=pg_temp.rid('occ_a1_d1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='missed' WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=NULL,superseded_at=NULL WHERE id=pg_temp.rid('r_a1')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.operation_execution_receipts WHERE id=pg_temp.rid('x_a1_d0')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.operation_execution_receipts$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='pending',completed_at=NULL,effective_receipt_id=NULL,execution_state='none',performed_at=NULL,signed_by=NULL WHERE id=pg_temp.rid('occ_a1_d1')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed' WHERE id=pg_temp.rid('occ_a2_d4')$q$);
SELECT pg_temp.c_denied($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-svc-00001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"svc","outcome":"performed","values":{"pads_ok":true,"battery_pct":75}}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('rev-svc-00001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"svc"}')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
RESET ROLE;
-- Revoked commands are executable by no role, and the meeting → task direction of the sync refuses a linked managed task with no partial write to either table.
SELECT pg_temp.c_assert((SELECT bool_and(p.proacl IS NOT NULL AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE' AND (a.grantee=0 OR a.grantee IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated','service_role')))))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('bulk_complete_operation_tasks','create_meeting_action')) AND (SELECT count(*)=2 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('bulk_complete_operation_tasks','create_meeting_action')),'a revoked legacy writer is executable');
SELECT pg_temp.c_login('admin_a');
SELECT pg_temp.c_expect($q$UPDATE public.meeting_action_items SET status='completed' WHERE id=(SELECT action_item FROM cf)$q$,'Use the authorized operations command for linked task status');
SELECT pg_temp.c_clear();
SELECT pg_temp.c_assert((SELECT status='open' AND updated_by IS NULL FROM public.meeting_action_items WHERE id=(SELECT action_item FROM cf)),'the meeting item moved despite the refusal');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM (SELECT to_jsonb(t) j FROM public.operation_task_instances t WHERE occurrence_kind IS NOT NULL EXCEPT SELECT j FROM cf_tasks_before) x),'a legacy writer changed a managed occurrence');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM (SELECT to_jsonb(r) j FROM public.operation_execution_receipts r EXCEPT SELECT j FROM cf_receipts_before) x),'a legacy writer changed a receipt');
-- Not even the owner token rewrites a receipt, supersedes twice, points outside the occurrence, trusts a chain, corrects a live receipt or deletes history.
DO $$ BEGIN PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET note='rewritten' WHERE id=pg_temp.rid('r_a1')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET revision=repeat('c',64) WHERE id=pg_temp.rid('c_a1_late')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_a1_late'),superseded_at=now() WHERE id=pg_temp.rid('r_a1')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=NULL,superseded_at=NULL WHERE id=pg_temp.rid('r_a1')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_a2'),superseded_at=now() WHERE id=pg_temp.rid('c_a1_late')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_a2') WHERE id=pg_temp.rid('c_a1_late')$q$,'immutable');
-- A review is superseded only by the correction or reversal of the receipt it reviewed: pointing it at that receipt itself, or at a correction of another receipt, is refused.
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_res1'),superseded_at=now() WHERE id=pg_temp.rid('v_res1_again')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_a1_late'),superseded_at=now() WHERE id=pg_temp.rid('v_res1_again')$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=pg_temp.rid('c_a1'),superseded_at=now() WHERE id=pg_temp.rid('c_a1_late')$q$,'immutable');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('v_res1_again')) AND (SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('c_a1_late')),'a refused supersession stuck');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET chain_id=pg_temp.rid('r_a2') WHERE id=pg_temp.rid('c_a1_late')$q$,'immutable');
SELECT pg_temp.c_expect($q$DELETE FROM public.operation_execution_receipts WHERE id=pg_temp.rid('x_a1_d0')$q$,'immutable');
SELECT pg_temp.c_expect($q$TRUNCATE public.operation_execution_receipts$q$,'truncate');
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision,corrects_receipt_id,correction_reason,correction_seq)
 SELECT org,site_a,pg_temp.rid('occ_a1_d1'),act_asset,subj_asset1,'asset',pg_temp.rid('v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000002','x',repeat('d',64),pg_temp.rid('c_a1_late'),'forged',9 FROM cf$q$,'A correction supersedes the effective performance receipt of its own occurrence');
-- With the pointer check deferred, a superseded pointer to a fresh id cannot be paired with a plain recording inserted under that id.
SELECT pg_temp.c_expect($q$DO $$ DECLARE fresh uuid:=gen_random_uuid(); BEGIN
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRED;
 UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=fresh,superseded_at=now() WHERE id=pg_temp.rid('r_a1_d0_again');
 INSERT INTO public.operation_execution_receipts(id,organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision)
  SELECT fresh,org,site_a,pg_temp.rid('occ_a1_d0'),act_asset,subj_asset1,'asset',pg_temp.rid('v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000006','x',repeat('d',64) FROM cf;
END $$$q$,'Supersession stays within one act of work');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_a1_d0_again')) AND NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE request_key='forged-000006'),'an unpaired supersession stuck');
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision,superseded_by_receipt_id,superseded_at)
 SELECT org,site_a,pg_temp.rid('occ_a2_d4'),act_asset,subj_asset2,'asset',pg_temp.rid('v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000003','x',repeat('d',64),pg_temp.rid('c_a1_late'),now() FROM cf$q$,'A new receipt is never superseded');
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision,verifies_receipt_id,verified_receipt_revision)
 SELECT org,site_a,pg_temp.rid('occ_res_d1'),act_res,subj_res1,'resident',pg_temp.rid('v_res'),'verification',owner_actor,'owner',now(),now(),'self','routine',NULL,'not_required','completed','forged-000004','x',repeat('d',64),pg_temp.rid('r_res1'),pg_temp.rev('r_res1') FROM cf$q$,'A review binds to the effective performance receipt of its own occurrence');
-- A chain supplied on a plain recording is ignored: the row is its own root.
INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,receipt_kind,recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,evidence_status,completion_state,request_key,request_hash,revision,chain_id,correction_seq)
 SELECT org,site_a,pg_temp.rid('occ_a2_d5'),act_asset,subj_asset2,'asset',pg_temp.rid('v_asset'),'performance',maint,'maintenance_role',now(),now(),'self','routine','performed','not_required','completed','forged-000005','x',repeat('d',64),pg_temp.rid('r_a1'),7 FROM cf;
SELECT pg_temp.c_assert((SELECT chain_id=id AND correction_seq=0 FROM public.operation_execution_receipts WHERE request_key='forged-000005'),'a supplied chain or sequence was trusted');
SELECT set_config('haven.operation_occurrence_command','',true);

-- A forced audit-insert failure inside a savepoint leaves receipts and the occurrence exactly as they were.
CREATE FUNCTION haven.col145_probe_audit_bomb() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN('corrected','reversed') THEN RAISE EXCEPTION 'COL-145 forced audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER col145_probe_audit_bomb BEFORE INSERT ON public.operation_audit_log FOR EACH ROW EXECUTE FUNCTION haven.col145_probe_audit_bomb();
CREATE TEMP TABLE cf_bomb_receipts AS SELECT to_jsonb(r) j FROM public.operation_execution_receipts r;
CREATE TEMP TABLE cf_bomb_tasks AS SELECT to_jsonb(t) j FROM public.operation_task_instances t WHERE id IN(pg_temp.rid('occ_a1_d1'),pg_temp.rid('occ_res_d1'));
CREATE TEMP TABLE cf_bomb_issues AS SELECT to_jsonb(i) j FROM public.operation_issues i;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('cor-bomb-00001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"Bomb","entry_kind":"late","outcome":"failed","values":{"pads_ok":false,"battery_pct":10},"issue":{"summary":"Bomb issue"}}')$q$,'forced audit failure');
SELECT pg_temp.c_expect($q$SELECT public.reverse_operation_work_review(pg_temp.rid('occ_a1_d1'),pg_temp.k('rev-bomb-00001'),pg_temp.rid('c_a1_late'),pg_temp.rev('c_a1_late'),'{"reason":"Bomb"}')$q$,'forced audit failure');
RESET ROLE;
SELECT pg_temp.c_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.correct_operation_work_review(pg_temp.rid('occ_res_d1'),pg_temp.k('cor-bomb-00002'),pg_temp.rid('c_res1'),pg_temp.rev('c_res1'),'{"reason":"Bomb","outcome":"performed"}')$q$,'forced audit failure');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM (SELECT to_jsonb(r) j FROM public.operation_execution_receipts r EXCEPT SELECT j FROM cf_bomb_receipts) x) AND (SELECT count(*)=(SELECT count(*) FROM cf_bomb_receipts) FROM public.operation_execution_receipts),'a failed audit insert left a receipt behind');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM (SELECT to_jsonb(t) j FROM public.operation_task_instances t WHERE id IN(pg_temp.rid('occ_a1_d1'),pg_temp.rid('occ_res_d1')) EXCEPT SELECT j FROM cf_bomb_tasks) x),'a failed audit insert moved an occurrence');
SELECT pg_temp.c_assert((SELECT count(*)=(SELECT count(*) FROM cf_bomb_issues) FROM public.operation_issues) AND (SELECT count(*)=0 FROM public.operation_audit_log WHERE event_data->>'request_key' LIKE pg_temp.k('%bomb%')),'a failed audit insert left an issue or event behind');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('c_a1_late')) AND (SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('v_res1_again')),'a failed command superseded a receipt');
DROP TRIGGER col145_probe_audit_bomb ON public.operation_audit_log;
DROP FUNCTION haven.col145_probe_audit_bomb();

-- Reads: the site administrator sees the whole history in order; the other site sees nothing; generic audit payloads stay hidden; the public RPCs are invokers.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=21 FROM public.operation_execution_receipts),'site administrator cannot read the site receipts');
SELECT pg_temp.c_assert((SELECT array_agg(receipt_kind||':'||correction_seq ORDER BY recorded_at)=ARRAY['performance:0','performance:1','performance:2'] FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d1')),'correction history not readable in recorded order');
SELECT pg_temp.c_assert((SELECT array_agg(receipt_kind ORDER BY recorded_at)=ARRAY['performance','verification','performance','verification'] FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d1')),'review history not readable');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_execution_receipts'),'generic audit payloads of receipts leaked');
RESET ROLE;
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_execution_receipts) AND (SELECT count(*)=0 FROM public.operation_evidence),'the other site sees receipts or evidence');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=21 FROM public.operation_execution_receipts) AND (SELECT count(*)=6 FROM public.operation_execution_receipts WHERE corrects_receipt_id IS NOT NULL AND receipt_kind='performance') AND (SELECT count(*)=3 FROM public.operation_execution_receipts WHERE receipt_kind='reversal'),'receipt counts drifted');
SELECT pg_temp.c_assert((SELECT bool_and((superseded_by_receipt_id IS NULL)=(superseded_at IS NULL)) FROM public.operation_execution_receipts),'supersession columns not set together');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('correct_operation_work_review','reverse_operation_work_review','verify_operation_work_review') AND p.prosecdef),'public correction RPC is definer');
SELECT 'COL-145 correction behavior PASS' result;
ROLLBACK;
