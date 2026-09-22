-- COL-151 export probe reuses correction fixture -- COL-145: corrections, reversals and bound reviews on the disposable replay.
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
-- Take the later fault-trigger DDL lock before fixture writes: concurrent
-- ANALYZE otherwise holds the table while waiting for this transaction.
LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
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
INSERT INTO cf_results SELECT 'photo_fac1',pg_temp.photo('r_fac1','ph1',(SELECT maint FROM cf));
INSERT INTO cf_results SELECT 'photo_fac3',pg_temp.photo('r_fac3','ph3',(SELECT maint FROM cf));
SELECT pg_temp.c_assert((SELECT bool_and(result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'execution_state'='completed') FROM cf_results WHERE label LIKE 'photo\_%'),'fixture photos did not satisfy their receipts');
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
-- All fixture work is local, synthetic and rolled back. Populate beyond the API cap
-- through actual commands; now() ties creation times within this transaction.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f cf; n integer; BEGIN SELECT * INTO f FROM cf;
 FOR n IN 1..1001 LOOP
  PERFORM public.create_operation_manual_occurrence_review(f.act_asset,f.site_a,f.subj_asset1,'export-many-'||n,'{}');
 END LOOP;
END $$;
CREATE TEMP TABLE ex AS SELECT gen_random_uuid() request_id, public.create_operation_history_export(site_a,act_asset,gen_random_uuid()) result FROM cf;
GRANT ALL ON ex TO authenticated;
SELECT pg_temp.c_assert((SELECT (result->'manifest'->>'total')::int=1013 FROM ex),'export is capped or scope differs');
CREATE TEMP TABLE ex_before AS SELECT public.read_operation_history_export((result->>'export_id')::uuid,0,500) page FROM ex;
GRANT SELECT ON ex_before TO authenticated;
SELECT pg_temp.c_assert((SELECT jsonb_array_length(page->'rows')=500 AND (page->>'next_offset')::int=500 FROM ex_before),'page size/cursor');
SELECT pg_temp.c_assert((SELECT count(DISTINCT r->>'id')=1013 FROM ex CROSS JOIN LATERAL generate_series(0,1000,500) off
 CROSS JOIN LATERAL jsonb_array_elements(public.read_operation_history_export((result->>'export_id')::uuid,off,500)->'rows') r),'all tied rows reconcile');
-- New occurrence plus correction AFTER materialization cannot rewrite the export.
SELECT public.create_operation_manual_occurrence_review(act_asset,site_a,subj_asset1,'export-after-snapshot','{}') FROM cf;
SELECT public.correct_operation_work_review(pg_temp.rid('occ_a1_d1'),'export-correct-after',pg_temp.rid('r_a1'),pg_temp.rev('r_a1'),'{"reason":"Corrected battery","outcome":"performed","values":{"pads_ok":true,"battery_pct":75}}');
SELECT pg_temp.c_assert((SELECT public.read_operation_history_export((result->>'export_id')::uuid,0,500)=page FROM ex,ex_before),'snapshot changed after correction/write');
CREATE TEMP TABLE ex_after AS SELECT public.create_operation_history_export(site_a,act_asset,gen_random_uuid()) result FROM cf;
GRANT SELECT ON ex_after TO authenticated;
SELECT pg_temp.c_assert((SELECT (result->'manifest'->>'total')::int=1014 AND (result->'manifest'->>'receipt_total')::int=3 FROM ex_after),'fresh snapshot missed correction/new row');
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM ex_after CROSS JOIN LATERAL generate_series(0,1000,500) off CROSS JOIN LATERAL jsonb_array_elements(public.read_operation_history_export((result->>'export_id')::uuid,off,500)->'rows') t
 CROSS JOIN LATERAL jsonb_array_elements(t->'receipts') r WHERE t->>'id'=pg_temp.rid('occ_a1_d1')::text),'correction chain incomplete');
-- A retry with the same request is stable; key reuse for different filters conflicts.
UPDATE ex SET result=public.create_operation_history_export((SELECT site_a FROM cf),(SELECT act_asset FROM cf),request_id);
SELECT pg_temp.c_assert((SELECT public.create_operation_history_export((SELECT site_a FROM cf),(SELECT act_asset FROM cf),request_id)=result FROM ex),'same-key replay');
SELECT pg_temp.c_expect(format('SELECT public.create_operation_history_export(%L,%L,%L)',site_a,act_fac,(SELECT request_id FROM ex)),'conflict') FROM cf;
-- Evidence metadata includes the finalized checksum/version but excludes transport paths.
CREATE TEMP TABLE ex_files AS SELECT public.create_operation_history_export(site_a,act_fac,gen_random_uuid()) result FROM cf;
GRANT SELECT ON ex_files TO authenticated;
SELECT pg_temp.c_assert((SELECT (result->'manifest'->>'evidence_total')::int=2 FROM ex_files),'evidence references incomplete');
SELECT pg_temp.c_assert((SELECT public.read_operation_history_export((result->>'export_id')::uuid,0,500)::text NOT LIKE '%object_path%'
 AND public.read_operation_history_export((result->>'export_id')::uuid,0,500)::text NOT LIKE '%signedUrl%' FROM ex_files),'transport leaked');
RESET ROLE;
-- Native references are readable only while the native record remains accessible.
SELECT pg_temp.c_clear();
CREATE TEMP TABLE ex_doc AS SELECT gen_random_uuid() id;
GRANT SELECT ON ex_doc TO authenticated;
INSERT INTO public.facility_documents(id,facility_id,organization_id,document_category,document_name,file_path,uploaded_by,vault_series_id)
 SELECT d.id,f.site_a,f.org,'fire_inspections','Export fixture','private-vault/'||d.id,f.owner_actor,d.id FROM cf f,ex_doc d;
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT public.prepare_operation_evidence_review(pg_temp.rid('r_fac1'),'export-native-document',jsonb_build_object('kind','linked_record','linked_table','facility_documents','linked_record_id',(SELECT id FROM ex_doc)));
CREATE TEMP TABLE ex_native AS SELECT public.create_operation_history_export(site_a,act_fac,gen_random_uuid()) result FROM cf;
GRANT SELECT ON ex_native TO authenticated;
SELECT pg_temp.c_assert((SELECT (result->'manifest'->>'evidence_total')::int=3 FROM ex_native),'native reference omitted');
RESET ROLE; SELECT pg_temp.c_clear();
UPDATE public.facility_documents SET deleted_at=clock_timestamp() WHERE id=(SELECT id FROM ex_doc);
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied(format('SELECT public.read_operation_history_export(%L)',result->>'export_id')) FROM ex_native;
SELECT pg_temp.c_assert((public.create_operation_history_export(site_a,act_fac,gen_random_uuid())->'manifest'->>'evidence_total')::int=2,'native inaccessible metadata leaked') FROM cf;
RESET ROLE; SELECT pg_temp.c_clear();
-- Failed audit insertion rolls back snapshot creation.
CREATE TEMP TABLE ex_count AS SELECT count(*) n FROM haven.operation_history_exports;
CREATE FUNCTION pg_temp.ex_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.table_name='operation_history_exports' THEN RAISE EXCEPTION 'export audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER ex_fail_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.ex_fail_audit();
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.create_operation_history_export(%L,%L,%L)',site_a,act_asset,gen_random_uuid()),'export audit failure') FROM cf;
RESET ROLE; SELECT pg_temp.c_clear();
SELECT pg_temp.c_assert((SELECT count(*)=(SELECT n FROM ex_count) FROM haven.operation_history_exports),'failed creation left snapshot');
DROP TRIGGER ex_fail_audit ON public.audit_log;
SELECT pg_temp.c_expect('UPDATE haven.operation_history_exports SET rows=''[]''','immutable');
SELECT pg_temp.c_expect('DELETE FROM haven.operation_history_exports','immutable');
SELECT pg_temp.c_expect('TRUNCATE haven.operation_history_exports','immutable');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE table_name='operation_history_exports' AND (new_data ? 'rows' OR new_data ? 'filters' OR new_data ? 'total')),'audit contains source data');
-- Same-site other requester, other-site actor, revoked session and anonymous cannot retrieve.
SELECT pg_temp.c_login('maint'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied(format('SELECT public.read_operation_history_export(%L)',result->>'export_id')) FROM ex;
RESET ROLE;
SELECT pg_temp.c_login('admin_b'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied(format('SELECT public.create_operation_history_export(%L,%L,%L)',site_a,act_asset,gen_random_uuid())) FROM cf;
RESET ROLE; SELECT pg_temp.c_clear();
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT admin_a FROM cf);
SELECT pg_temp.c_login('admin_a'); SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied(format('SELECT public.read_operation_history_export(%L)',result->>'export_id')) FROM ex;
SELECT pg_temp.c_denied('SELECT * FROM haven.operation_history_exports');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.c_denied('SELECT public.read_operation_history_export(gen_random_uuid())');
RESET ROLE;
ROLLBACK;
