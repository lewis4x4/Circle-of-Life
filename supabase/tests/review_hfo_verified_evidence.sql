-- COL-143: scoped verified evidence on the disposable replay. Proves that
-- evidence is an immutable metadata identity owned by one performance
-- receipt, that only the uploader may write or finalize its own prepared
-- path, that wrong-site, wrong-subject, unowned, unfinalized or foreign
-- objects never satisfy a rule, that a failed required upload leaves the
-- receipt performed-with-missing-evidence while a failed supplementary upload
-- never appears attached, that a later valid finalization satisfies the same
-- performance once through an appended event with the original attribution
-- unchanged, that a stale receipt revision conflicts, that the declared MD5
-- is verified against the object's eTag at upload marking and again at
-- finalization (a mismatch or a changed object fails the row durably, a
-- non-MD5 eTag never finalizes), and that direct DML is refused. Local
-- storage.objects rows stand in for uploads with eTags computed as the MD5 of
-- known bytes; no byte moves and no hosted bucket is proven here.
-- Authenticated SQL behaviour with synthetic fixtures; not hosted, browser or
-- staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
-- Supabase grants table SELECT by default; the replay stubs omit it and other buckets' storage policies read public tables. RLS stays enabled.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.e_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-143 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.e_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-143 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.e_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR position(detail_fragment IN coalesce(d,''))>0) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-143 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations creates evidence, an event or an object, and every receipt's current status equals its recorded one.
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM public.operation_evidence),'a migration created evidence');
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM public.operation_evidence_events),'a migration created an evidence event');
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='operation-evidence'),'a migration stored an object');
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE evidence_status_current IS DISTINCT FROM evidence_status OR evidence_satisfied_at IS NOT NULL),'a migration satisfied a receipt');
SELECT pg_temp.e_assert((SELECT public AND file_size_limit=20971520 FROM storage.buckets WHERE id='operation-evidence') IS FALSE,'the evidence bucket is public or unbounded');

-- FIXTURES-BEGIN
CREATE TEMP TABLE ef AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_fac,gen_random_uuid() act_emp,gen_random_uuid() act_link,
 gen_random_uuid() asset1,gen_random_uuid() emp1,gen_random_uuid() subj_asset1,gen_random_uuid() subj_emp1,gen_random_uuid() doc_a,gen_random_uuid() doc_b,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE ef ADD COLUMN d2 date,ADD COLUMN d3 date,ADD COLUMN d4 date;
UPDATE ef SET d2=d1+7,d3=d1+14,d4=d1+21;
CREATE TEMP TABLE ef_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE ef_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON ef TO authenticated,service_role; GRANT ALL ON ef_ids,ef_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Evidence Site B','Test','Test','00000',1 FROM ef;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM ef
 UNION ALL SELECT admin_a,admin_a||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM ef
 UNION ALL SELECT admin_b,admin_b||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM ef
 UNION ALL SELECT maint,maint||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM ef
 UNION ALL SELECT nurse,nurse||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM ef
 UNION ALL SELECT aide,aide||'@evidence.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM ef;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@evidence.invalid','Corporate','owner'::public.app_role,org,true FROM ef
 UNION ALL SELECT admin_a,admin_a||'@evidence.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM ef
 UNION ALL SELECT admin_b,admin_b||'@evidence.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM ef
 UNION ALL SELECT maint,maint||'@evidence.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM ef
 UNION ALL SELECT nurse,nurse||'@evidence.invalid','Nurse','nurse'::public.app_role,org,true FROM ef
 UNION ALL SELECT aide,aide||'@evidence.invalid','Aide','housekeeper'::public.app_role,org,true FROM ef
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM ef UNION ALL SELECT admin_a_session,admin_a FROM ef UNION ALL SELECT admin_b_session,admin_b FROM ef
 UNION ALL SELECT maint_session,maint FROM ef UNION ALL SELECT nurse_session,nurse FROM ef UNION ALL SELECT aide_session,aide FROM ef;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM ef UNION ALL SELECT admin_a,site_a,org FROM ef UNION ALL SELECT admin_b,site_b,org FROM ef UNION ALL SELECT maint,site_a,org FROM ef
 UNION ALL SELECT nurse,site_a,org FROM ef UNION ALL SELECT aide,site_a,org FROM ef;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'employee_personnel',owner_actor,'Fixture personnel authority',true FROM ef
 UNION ALL SELECT org,site_a,owner_actor,'employee_personnel',owner_actor,'Fixture corporate personnel reviewer',true FROM ef;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-143-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM ef
 UNION ALL SELECT act_fac,org,NULL,'hfo-143-fixture:'||act_fac,'Generator weekly test','structured_observation','facility','admin_log' FROM ef
 UNION ALL SELECT act_emp,org,NULL,'hfo-143-fixture:'||act_emp,'Employee file review','record_review','employee','admin_log' FROM ef
 UNION ALL SELECT act_link,org,NULL,'hfo-143-fixture:'||act_link,'Fire inspection filing','record_review','facility','admin_log' FROM ef;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM ef;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT emp1,org,site_a,'Protected','Employee','resident_aide',current_date FROM ef;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM ef;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) SELECT subj_emp1,org,site_a,'employee',emp1 FROM ef;
-- Native employee file records: personnel and medical for the reviewed employee, personnel for another employee.
ALTER TABLE ef ADD COLUMN emp2 uuid DEFAULT gen_random_uuid(),ADD COLUMN req_pers uuid DEFAULT gen_random_uuid(),ADD COLUMN req_med uuid DEFAULT gen_random_uuid(),
 ADD COLUMN rec_emp1_pers uuid DEFAULT gen_random_uuid(),ADD COLUMN rec_emp2_pers uuid DEFAULT gen_random_uuid(),ADD COLUMN rec_emp1_med uuid DEFAULT gen_random_uuid();
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT emp2,org,site_a,'Other','Employee','resident_aide',current_date FROM ef;
INSERT INTO public.employee_file_requirements(id,organization_id,facility_id,code,title,category,source_file,created_by,review_status)
 SELECT req_pers,org,site_a,'HFO143-P','Orientation checklist','orientation','fixture',owner_actor,'approved' FROM ef
 UNION ALL SELECT req_med,org,site_a,'HFO143-M','Health statement','medical','fixture',owner_actor,'approved' FROM ef;
INSERT INTO public.employee_file_records(id,organization_id,facility_id,staff_id,requirement_id,created_by)
 SELECT rec_emp1_pers,org,site_a,emp1,req_pers,owner_actor FROM ef UNION ALL SELECT rec_emp2_pers,org,site_a,emp2,req_pers,owner_actor FROM ef UNION ALL SELECT rec_emp1_med,org,site_a,emp1,req_med,owner_actor FROM ef;
-- Native vault documents: one at site A (readable there), one at site B.
INSERT INTO public.facility_documents(id,facility_id,organization_id,document_category,document_name,file_path,uploaded_by,vault_series_id)
 SELECT doc_a,site_a,org,'fire_inspections','Fire inspection 2026','vault/'||doc_a||'.pdf',owner_actor,doc_a FROM ef
 UNION ALL SELECT doc_b,site_b,org,'fire_inspections','Site B inspection','vault/'||doc_b||'.pdf',owner_actor,doc_b FROM ef;
CREATE FUNCTION pg_temp.e_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f ef; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM ef;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.e_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.e_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',NULL,'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col143-'||p $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label=p_label) $$;
-- The known bytes of a fixture upload are its filename; an object-kind payload
-- declares md5(filename) and a local upload writes the eTag Storage would
-- (the quoted MD5 of the stored bytes) unless other bytes or another eTag are
-- given, plus a Storage version.
CREATE FUNCTION pg_temp.obj(p_payload text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT p_payload::jsonb||jsonb_build_object('md5',md5(p_payload::jsonb->>'filename')) $$;
CREATE FUNCTION pg_temp.put(p_evidence uuid,p_owner uuid,p_size bigint,p_mime text,p_bytes text DEFAULT NULL,p_etag text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
 INSERT INTO storage.objects(bucket_id,name,owner,metadata,version) SELECT 'operation-evidence',e.object_path,p_owner,
  jsonb_build_object('size',p_size,'mimetype',p_mime,'eTag',coalesce(p_etag,'"'||md5(coalesce(p_bytes,split_part(e.object_path,'/',3)))||'"')),gen_random_uuid()::text
 FROM public.operation_evidence e WHERE e.id=p_evidence RETURNING id
$$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text),pg_temp.run(text,date,date,uuid),pg_temp.e_login(text),pg_temp.e_service(),pg_temp.e_clear(),pg_temp.k(text),pg_temp.rev(text),pg_temp.obj(text),pg_temp.put(uuid,uuid,bigint,text,text,text) TO authenticated,service_role;

-- Versions (owner): no evidence, a required photo, a required document with review, a required linked record.
SELECT pg_temp.e_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'))) FROM ef;
INSERT INTO ef_results SELECT 'v_fac',public.save_operation_requirement_draft_review(act_fac,jsonb_build_object('title','Generator weekly test','wording','Run the generator.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin','housekeeper'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always')))) FROM ef;
INSERT INTO ef_results SELECT 'v_emp',public.save_operation_requirement_draft_review(act_emp,jsonb_build_object('title','Employee file review','wording','Review the personnel file.','allowed_recorder_roles',jsonb_build_array('facility_admin','owner'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','document','label','Signed checklist','min_count',1,'when','always')))) FROM ef;
INSERT INTO ef_results SELECT 'v_link',public.save_operation_requirement_draft_review(act_link,jsonb_build_object('title','Fire inspection filing','wording','File the inspection report in the vault.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','linked_record','label','Vault document','min_count',1,'when','always')))) FROM ef;
INSERT INTO ef_ids SELECT label,(result->>'id')::uuid FROM ef_results WHERE label LIKE 'v\_%';
INSERT INTO ef_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,clock_timestamp()) FROM ef_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.e_assert((SELECT count(*)=4 FROM ef_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.e_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ef_ids WHERE label='v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}'::jsonb)) FROM ef;
INSERT INTO ef_results SELECT 'fr_fac',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ef_ids WHERE label='v_fac'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"08:00"}}'::jsonb)) FROM ef;
INSERT INTO ef_results SELECT 'fr_emp',public.save_operation_facility_requirement_draft_review(act_emp,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ef_ids WHERE label='v_emp'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM ef;
INSERT INTO ef_results SELECT 'fr_link',public.save_operation_facility_requirement_draft_review(act_link,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ef_ids WHERE label='v_link'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"11:00"}}'::jsonb)) FROM ef;
INSERT INTO ef_ids SELECT label,(result->>'id')::uuid FROM ef_results WHERE label LIKE 'fr\_%';
INSERT INTO ef_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM ef_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.e_assert((SELECT count(*)=4 FROM ef_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO ef_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',clock_timestamp()) FROM ef;
INSERT INTO ef_results SELECT 'b_emp1',public.enroll_operation_binding_review(act_emp,site_a,subj_emp1,'employee_personnel',NULL,'{"source":"admin_log","reason":"Personnel file roster"}',clock_timestamp()) FROM ef;
RESET ROLE;
-- Occurrences from the service generator.
SELECT pg_temp.e_service();
SET LOCAL ROLE service_role;
INSERT INTO ef_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ef_ids WHERE label='fr_asset'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','10:00')),pg_temp.run('run-asset',d1,d1,(SELECT id FROM ef_ids WHERE label='fr_asset'))) FROM ef;
INSERT INTO ef_results SELECT 'g_fac',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ef_ids WHERE label='fr_fac'),
 jsonb_build_array(pg_temp.occ(d1,'America/New_York','08:00'),pg_temp.occ(d2,'America/New_York','08:00'),pg_temp.occ(d3,'America/New_York','08:00'),pg_temp.occ(d4,'America/New_York','08:00')),pg_temp.run('run-fac',d1,d4,(SELECT id FROM ef_ids WHERE label='fr_fac'))) FROM ef;
INSERT INTO ef_results SELECT 'g_emp',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ef_ids WHERE label='fr_emp'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','09:00')),pg_temp.run('run-emp',d1,d1,(SELECT id FROM ef_ids WHERE label='fr_emp'))) FROM ef;
INSERT INTO ef_results SELECT 'g_link',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ef_ids WHERE label='fr_link'),jsonb_build_array(pg_temp.occ(d1,'America/New_York','11:00'),pg_temp.occ(d2,'America/New_York','11:00')),pg_temp.run('run-link',d1,d2,(SELECT id FROM ef_ids WHERE label='fr_link'))) FROM ef;
SELECT pg_temp.e_assert((SELECT (result->'counts'->>'created')::int=1 FROM ef_results WHERE label='g_asset') AND (SELECT (result->'counts'->>'created')::int=4 FROM ef_results WHERE label='g_fac')
 AND (SELECT (result->'counts'->>'created')::int=1 FROM ef_results WHERE label='g_emp') AND (SELECT (result->'counts'->>'created')::int=2 FROM ef_results WHERE label='g_link'),'occurrences not generated');
INSERT INTO ef_ids SELECT 'occ_a1_d1',t.id FROM ef JOIN public.operation_task_instances t ON t.subject_id=ef.subj_asset1 AND t.assigned_shift_date=ef.d1;
INSERT INTO ef_ids SELECT 'occ_fac_'||n,t.id FROM ef CROSS JOIN LATERAL (VALUES('d1',ef.d1),('d2',ef.d2),('d3',ef.d3),('d4',ef.d4)) x(n,d) JOIN public.operation_task_instances t ON t.activity_id=ef.act_fac AND t.assigned_shift_date=x.d;
INSERT INTO ef_ids SELECT 'occ_emp_d1',t.id FROM ef JOIN public.operation_task_instances t ON t.subject_id=ef.subj_emp1 AND t.assigned_shift_date=ef.d1;
INSERT INTO ef_ids SELECT 'occ_link_'||n,t.id FROM ef CROSS JOIN LATERAL (VALUES('d1',ef.d1),('d2',ef.d2)) x(n,d) JOIN public.operation_task_instances t ON t.activity_id=ef.act_link AND t.assigned_shift_date=x.d;
SELECT pg_temp.e_assert((SELECT count(*)=8 FROM ef_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;
-- Receipts: photo-required work recorded by maintenance (missing evidence), a
-- document-with-review employee record by the site admin (missing evidence),
-- a routine AED check with no rule (completed), and a linked-record filing.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'rec_fac1',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_fac_d1'),pg_temp.k('fac1-000001'),'{"outcome":"performed","note":"Ran fine"}');
INSERT INTO ef_results SELECT 'rec_fac2',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_fac_d2'),pg_temp.k('fac2-000001'),'{"outcome":"performed"}');
INSERT INTO ef_results SELECT 'rec_fac3',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_fac_d3'),pg_temp.k('fac3-000001'),'{"outcome":"performed"}');
INSERT INTO ef_results SELECT 'rec_fac4',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_fac_d4'),pg_temp.k('fac4-000001'),'{"outcome":"performed"}');
INSERT INTO ef_results SELECT 'rec_a1',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_a1_d1'),pg_temp.k('a1-000001'),'{"outcome":"performed"}');
INSERT INTO ef_results SELECT 'rec_link1',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_link_d1'),pg_temp.k('link1-000001'),'{"outcome":"performed"}');
INSERT INTO ef_results SELECT 'rec_link2',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_link_d2'),pg_temp.k('link2-000001'),'{"outcome":"performed"}');
RESET ROLE;
SELECT pg_temp.e_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'rec_emp1',public.record_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_emp_d1'),pg_temp.k('emp1-000001'),'{"outcome":"performed"}');
RESET ROLE;
INSERT INTO ef_ids SELECT 'r_'||substr(label,5),(result->'receipt'->>'id')::uuid FROM ef_results WHERE label LIKE 'rec\_%';
SELECT pg_temp.e_assert((SELECT bool_and(result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'receipt'->>'evidence_status'='missing' AND result->'occurrence'->>'status'='in_progress') FROM ef_results WHERE label IN('rec_fac1','rec_fac2','rec_fac3','rec_fac4','rec_emp1','rec_link1','rec_link2')),'evidence-requiring receipts did not record as performed with missing evidence');
SELECT pg_temp.e_assert((SELECT result->'receipt'->>'completion_state'='completed' FROM ef_results WHERE label='rec_a1'),'routine receipt without a rule did not complete');
SELECT pg_temp.e_assert((SELECT bool_and(evidence_status_current=evidence_status AND evidence_satisfied_at IS NULL) FROM public.operation_execution_receipts),'receipts did not start with their recorded evidence status');
-- Snapshot of the immutable receipt facts and the occurrence's attribution before any evidence.
CREATE TEMP TABLE ef_snapshot AS SELECT r.id receipt_id,to_jsonb(r)-ARRAY['evidence_status_current','evidence_satisfied_at'] receipt_json,
 jsonb_build_object('performed_at',t.performed_at,'signed_by',t.signed_by,'signed_at',t.signed_at,'effective_receipt_id',t.effective_receipt_id) occurrence_json
 FROM public.operation_execution_receipts r JOIN public.operation_task_instances t ON t.id=r.task_instance_id;
GRANT SELECT ON ef_snapshot TO authenticated;
-- FIXTURES-END

-- Prepare: a required photo for the generator receipt by its recorder.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'prep1',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000001'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":1234,"sha256":"1111111111111111111111111111111111111111111111111111111111111111"}'));
INSERT INTO ef_ids SELECT 'ev1',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep1';
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean=false AND result->'evidence'->>'state'='prepared' AND result->'evidence'->>'evidence_kind'='photo' AND result->'evidence'->>'rule_label'='Panel photo'
 AND result->'evidence'->>'object_path'=(SELECT site_a::text FROM ef)||'/'||(result->'evidence'->>'id')||'/panel.jpg' AND result->'evidence'->>'bucket_id'='operation-evidence'
 AND (result->'evidence'->>'uploaded_by')::uuid=(SELECT maint FROM ef) AND (result->'evidence'->>'checksum_verified')::boolean=false AND result->'event'->>'event_kind'='prepared' AND jsonb_typeof(result->'satisfaction')='null'
 AND result->'evidence'->>'declared_md5'=md5('panel.jpg') AND result->'evidence'->>'checksum_method' IS NULL AND result->'evidence'->>'checksum_verified_at' IS NULL AND result->'evidence'->>'object_version' IS NULL AND result->>'outcome'='prepared'
 FROM ef_results WHERE label='prep1'),'prepared evidence is not an owned, classified identity');
SELECT pg_temp.e_assert((SELECT organization_id=(SELECT org FROM ef) AND facility_id=(SELECT site_a FROM ef) AND activity_id=(SELECT act_fac FROM ef) AND authority_class='facility' AND task_instance_id=(SELECT id FROM ef_ids WHERE label='occ_fac_d1') FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev1')),'evidence did not copy the receipt scope');
-- Replay: same key and content returns the same evidence; changed content conflicts.
INSERT INTO ef_results SELECT 'prep1_replay',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000001'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":1234,"sha256":"1111111111111111111111111111111111111111111111111111111111111111"}'));
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND (result->'evidence'->>'id')::uuid=(SELECT id FROM ef_ids WHERE label='ev1') FROM ef_results WHERE label='prep1_replay'),'prepare replay did not return the same evidence');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000001'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel2.jpg","mime":"image/jpeg","size_bytes":1234}'))$q$,'already saved with different content');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence),'a replay or conflict created evidence');
-- Shape and rule refusals create nothing.
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"document","rule_label":"Panel photo","filename":"panel.pdf","mime":"application/pdf","size_bytes":10}'))$q$,'kind does not match the rule');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","rule_label":"Missing rule","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$,'does not apply to this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","filename":"panel.gif","mime":"image/gif","size_bytes":10}'))$q$,'mime must be');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":20971521}'))$q$,'size_bytes must be');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","filename":"../panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$,'filename must be');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10,"linked_table":"facility_documents"}'))$q$,'carries no linked record');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),pg_temp.obj('{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10,"uploaded_by":"x"}'))$q$,'not editable');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),'ab',pg_temp.obj('{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$,'request key is required');
-- An object kind declares the MD5 of its bytes; a linked record carries none.
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),'{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}')$q$,'md5 is required');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000002'),'{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10,"md5":"0123456789ABCDEF0123456789ABCDEF"}')$q$,'md5 must be');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000002'),jsonb_build_object('kind','linked_record','linked_table','facility_documents','linked_record_id',(SELECT doc_a FROM ef),'md5',md5('x')))$q$,'carries no object');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence),'a refused prepare created evidence');
RESET ROLE;
-- Authority before any receipt fact: a non-recorder for the activity, the other site's admin and a random receipt share one wording.
SELECT pg_temp.e_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-nurse-01'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$);
RESET ROLE;
SELECT pg_temp.e_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-b-000001'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$);
SELECT pg_temp.e_denied($q$SELECT public.prepare_operation_evidence_review(gen_random_uuid(),pg_temp.k('prep-b-000002'),pg_temp.obj('{"kind":"photo","filename":"panel.jpg","mime":"image/jpeg","size_bytes":10}'))$q$);
SELECT pg_temp.e_denied($q$SELECT public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('up-b-000001'))$q$);
SELECT pg_temp.e_denied($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-b-000001'),repeat('a',64),'{}')$q$);
SELECT pg_temp.e_assert((SELECT count(*)=0 FROM public.operation_evidence)
 AND (SELECT count(*)=0 FROM public.operation_evidence_events),'the other site can read evidence or events');
RESET ROLE;
SELECT pg_temp.e_assert((SELECT count(*)=0 FROM public.operation_evidence_events WHERE actor_id IN(SELECT nurse FROM ef UNION ALL SELECT admin_b FROM ef)),'a denied command wrote an event');

-- Storage access: only the uploader writes its own prepared path; nobody else reads it before finalization; no client update or delete.
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$INSERT INTO storage.objects(bucket_id,name,owner,metadata) SELECT 'operation-evidence',site_a||'/'||(SELECT id FROM ef_ids WHERE label='ev1')||'/panel.jpg',aide,'{"size":1234,"mimetype":"image/jpeg"}'::jsonb FROM ef$q$);
SELECT pg_temp.e_assert(NOT haven.operation_evidence_storage_access('operation-evidence',(SELECT site_a||'/'||(SELECT id FROM ef_ids WHERE label='ev1')||'/panel.jpg' FROM ef),true),'another recorder may write the uploader''s path');
SELECT pg_temp.e_assert(NOT haven.operation_evidence_storage_access('operation-evidence',(SELECT site_b||'/'||(SELECT id FROM ef_ids WHERE label='ev1')||'/panel.jpg' FROM ef),true),'a wrong-site path is writable');
SELECT pg_temp.e_assert(NOT haven.operation_evidence_storage_access('operation-evidence','not/a/path',false) AND NOT haven.operation_evidence_storage_access('operation-evidence',(SELECT id FROM ef_ids WHERE label='ev1')||'/panel.jpg',false),'a malformed path is readable');
RESET ROLE;
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_assert(haven.operation_evidence_storage_access('operation-evidence',(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev1')),true),'the uploader cannot write its prepared path');
SELECT pg_temp.e_assert((SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev1'),(SELECT maint FROM ef),1234,'image/jpeg')) IS NOT NULL,'the uploader could not store its object');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='operation-evidence'),'the uploader cannot see its own in-flight object');
UPDATE storage.objects SET name=name||'.moved' WHERE bucket_id='operation-evidence';
DELETE FROM storage.objects WHERE bucket_id='operation-evidence';
RESET ROLE;
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='operation-evidence' AND name=(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev1'))),'a client moved or deleted an evidence object');
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='operation-evidence') AND (SELECT count(*)=0 FROM public.operation_evidence),'another recorder sees an unfinalized object or its metadata');
RESET ROLE;

-- Upload marking: the object must exist under the prepared path, be owned by the uploader and match the declared size and type.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'prep2',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac2'),pg_temp.k('prep-000010'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.png","mime":"image/png","size_bytes":500}'));
INSERT INTO ef_ids SELECT 'ev2',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep2';
SELECT pg_temp.e_expect($q$SELECT public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('up-000010'))$q$,'Uploaded object not found');
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev2'),(SELECT maint FROM ef),501,'image/png');
SELECT pg_temp.e_expect($q$SELECT public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('up-000010'))$q$,'does not match the prepared evidence');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('fin-000010'),pg_temp.rev('r_fac2'),'{}')$q$,'does not match the prepared evidence');
SELECT pg_temp.e_assert((SELECT state='prepared' FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev2')),'a mismatched object changed the evidence state');
INSERT INTO ef_results SELECT 'up1',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('up-000001'));
SELECT pg_temp.e_assert((SELECT result->'evidence'->>'state'='uploaded' AND (result->'evidence'->>'object_size_bytes')::bigint=1234 AND result->'evidence'->>'object_mime'='image/jpeg' AND result->'evidence'->>'object_etag'='"'||md5('panel.jpg')||'"' AND result->'evidence'->>'object_id' IS NOT NULL AND result->'event'->>'event_kind'='uploaded' FROM ef_results WHERE label='up1'),'upload marking did not record the object facts');
-- The declared MD5 was verified against the eTag: method, instant and Storage version recorded; the reply names the outcome.
SELECT pg_temp.e_assert((SELECT (result->'evidence'->>'checksum_verified')::boolean AND result->'evidence'->>'checksum_method'='storage_etag_md5' AND result->'evidence'->>'checksum_verified_at' IS NOT NULL AND result->'evidence'->>'object_version' IS NOT NULL
 AND result->>'outcome'='uploaded' AND (result->'event'->'details'->>'checksum_verified')::boolean AND result->'event'->'details'->>'etag_kind'='md5' FROM ef_results WHERE label='up1'),'upload marking did not verify the checksum');
INSERT INTO ef_results SELECT 'up1_replay',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('up-000001'));
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->>'outcome'='uploaded' FROM ef_results WHERE label='up1_replay'),'upload replay did not replay');
SELECT pg_temp.e_expect($q$SELECT public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('up-000002'))$q$,'already uploaded');
RESET ROLE;
-- Another recorder for the activity cannot upload or finalize someone else's prepared evidence.
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-aide-0001'),pg_temp.rev('r_fac1'),'{}')$q$,'belongs to another uploader');
RESET ROLE;

-- Finalize: the receipt revision the uploader saw must still stand; then the rule is met and the same performance is satisfied once.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000001'),repeat('a',64),'{}')$q$,'Receipt changed since it was read');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000001'),'nope','{}')$q$,'expected receipt revision is required');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000001'),pg_temp.rev('r_fac1'),'{"sha256":"2222222222222222222222222222222222222222222222222222222222222222"}')$q$,'sha256 does not match');
SELECT pg_temp.e_assert((SELECT evidence_status_current='missing' AND evidence_satisfied_at IS NULL FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac1')) AND (SELECT execution_state='performed_missing_evidence' FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_fac_d1')),'an uploaded but unfinalized object satisfied the rule');
INSERT INTO ef_results SELECT 'fin1',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000001'),pg_temp.rev('r_fac1'),'{}');
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean=false AND result->'evidence'->>'state'='finalized' AND (result->'evidence'->>'finalized_by')::uuid=(SELECT maint FROM ef) AND result->'event'->>'event_kind'='finalized'
 AND result->'event'->>'expected_receipt_revision'=pg_temp.rev('r_fac1') AND result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'status'='completed'
 AND result->'satisfaction'->'occurrence'->>'execution_state'='completed' AND result->>'outcome'='finalized' AND (result->'evidence'->>'checksum_verified')::boolean AND result->'event'->'details'->>'checksum_method'='storage_etag_md5'
 FROM ef_results WHERE label='fin1'),'finalization did not satisfy the receipt');
SELECT pg_temp.e_assert((SELECT evidence_status_current='complete' AND evidence_satisfied_at IS NOT NULL AND evidence_status='missing' AND missing_evidence<>'[]'::jsonb FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac1')),'receipt current evidence status not complete or recorded list rewritten');
SELECT pg_temp.e_assert((SELECT to_jsonb(r)-ARRAY['evidence_status_current','evidence_satisfied_at']=s.receipt_json FROM public.operation_execution_receipts r JOIN ef_snapshot s ON s.receipt_id=r.id WHERE r.id=(SELECT id FROM ef_ids WHERE label='r_fac1')),'satisfaction rewrote an immutable receipt fact');
SELECT pg_temp.e_assert((SELECT status='completed' AND execution_state='completed' AND completed_at IS NOT NULL AND verified_by=(SELECT maint FROM ef) AND verified_at IS NOT NULL AND verification_receipt_id IS NULL
 AND jsonb_build_object('performed_at',performed_at,'signed_by',signed_by,'signed_at',signed_at,'effective_receipt_id',effective_receipt_id)=(SELECT occurrence_json FROM ef_snapshot WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac1'))
 FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_fac_d1')),'occurrence did not complete with its original attribution intact');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=(SELECT id FROM ef_ids WHERE label='occ_fac_d1')),'satisfaction created a second receipt');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac1') AND event_kind='satisfied' AND evidence_id IS NULL),'satisfaction event missing');
SELECT pg_temp.e_assert((SELECT array_agg(event_kind ORDER BY event_seq)=ARRAY['prepared','uploaded','finalized','satisfied'] FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac1')),'evidence history out of order');
INSERT INTO ef_results SELECT 'fin1_replay',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000001'),pg_temp.rev('r_fac1'),'{}');
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->'event'->>'event_kind'='finalized' FROM ef_results WHERE label='fin1_replay'),'finalize replay did not replay');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev1'),pg_temp.k('fin-000002'),pg_temp.rev('r_fac1'),'{}')$q$,'already finalized');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac1'),pg_temp.k('prep-000003'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"again.jpg","mime":"image/jpeg","size_bytes":10}'))$q$,'already satisfied');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence_events WHERE event_kind='satisfied'),'a replay satisfied twice');
RESET ROLE;
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=(SELECT id FROM ef_ids WHERE label='occ_fac_d1') AND event_type='completed' AND event_notes='required evidence finalized'
 AND (event_data->>'receipt_id')::uuid=(SELECT id FROM ef_ids WHERE label='r_fac1') AND event_data->>'evidence_satisfied_at' IS NOT NULL),'completion audit for the satisfied receipt missing');
-- After finalization, another recorder with access to the occurrence reads the object and the metadata; the other site still sees nothing.
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='operation-evidence' AND name=(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev1'))),'finalized object not readable with the occurrence');
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence WHERE state='finalized') AND (SELECT count(*)=0 FROM public.operation_evidence WHERE state<>'finalized'),'finalized metadata not readable or in-flight metadata leaked');
SELECT pg_temp.e_assert((SELECT count(*)=4 FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac1')),'finalized history not readable');
RESET ROLE;
SELECT pg_temp.e_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='operation-evidence') AND (SELECT count(*)=0 FROM public.operation_evidence) AND (SELECT count(*)=0 FROM public.operation_evidence_events),'the other site sees evidence');
RESET ROLE;

-- A failed required upload leaves the performance evidence-incomplete; a retry satisfies once; the same bytes never finalize twice.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('fail-000010'),'{"reason":""}')$q$,'reason must be');
INSERT INTO ef_results SELECT 'fail2',public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('fail-000010'),'{"reason":"Upload timed out"}');
SELECT pg_temp.e_assert((SELECT result->'evidence'->>'state'='failed' AND result->'evidence'->>'failure_reason'='Upload timed out' AND result->'event'->>'event_kind'='failed' FROM ef_results WHERE label='fail2'),'failure not recorded');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev2'),pg_temp.k('fin-000011'),pg_temp.rev('r_fac2'),'{}')$q$,'has failed');
SELECT pg_temp.e_assert((SELECT evidence_status_current='missing' AND evidence_satisfied_at IS NULL FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac2'))
 AND (SELECT execution_state='performed_missing_evidence' AND status='in_progress' FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_fac_d2')),'a failed required upload completed or satisfied anything');
INSERT INTO ef_results SELECT 'prep3',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac2'),pg_temp.k('prep-000011'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-retry.png","mime":"image/png","size_bytes":500,"sha256":"3333333333333333333333333333333333333333333333333333333333333333"}'));
INSERT INTO ef_ids SELECT 'ev3',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep3';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev3'),(SELECT maint FROM ef),500,'image/png');
-- Finalization straight from prepared runs the object check itself.
INSERT INTO ef_results SELECT 'fin3',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev3'),pg_temp.k('fin-000012'),pg_temp.rev('r_fac2'),'{"sha256":"3333333333333333333333333333333333333333333333333333333333333333"}');
SELECT pg_temp.e_assert((SELECT result->'evidence'->>'state'='finalized' AND result->'evidence'->>'uploaded_at' IS NOT NULL AND result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'execution_state'='completed' FROM ef_results WHERE label='fin3'),'retry after failure did not satisfy once');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac2'),pg_temp.k('prep-000012'),pg_temp.obj('{"kind":"photo","filename":"dup.png","mime":"image/png","size_bytes":500,"sha256":"3333333333333333333333333333333333333333333333333333333333333333"}'))$q$,'already finalized for these bytes','evidence_id='||(SELECT id FROM ef_ids WHERE label='ev3'));
SELECT pg_temp.e_assert((SELECT count(*)=1 FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac2') AND event_kind='satisfied'),'retry satisfied more than once');
-- A failed supplementary upload never appears attached; a finalized supplementary one is attached but counts toward no rule.
INSERT INTO ef_results SELECT 'prep_sup',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_a1'),pg_temp.k('prep-000020'),pg_temp.obj('{"kind":"document","filename":"receipt.pdf","mime":"application/pdf","size_bytes":9}'));
INSERT INTO ef_ids SELECT 'ev_sup',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_sup';
INSERT INTO ef_results SELECT 'fail_sup',public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_sup'),pg_temp.k('fail-000020'),'{"reason":"Cancelled by user"}');
INSERT INTO ef_results SELECT 'prep_sup2',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_a1'),pg_temp.k('prep-000021'),pg_temp.obj('{"kind":"document","filename":"receipt.pdf","mime":"application/pdf","size_bytes":9}'));
INSERT INTO ef_ids SELECT 'ev_sup2',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_sup2';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_sup2'),(SELECT maint FROM ef),9,'application/pdf');
-- An informational SHA-256 offered only at finalization is accepted and changes nothing on the immutable row.
INSERT INTO ef_results SELECT 'fin_sup2',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_sup2'),pg_temp.k('fin-000021'),pg_temp.rev('r_a1'),'{"sha256":"4444444444444444444444444444444444444444444444444444444444444444"}');
SELECT pg_temp.e_assert((SELECT jsonb_typeof(result->'satisfaction')='null' AND result->'evidence'->>'state'='finalized' AND result->'evidence'->>'declared_sha256' IS NULL FROM ef_results WHERE label='fin_sup2'),'supplementary evidence produced a satisfaction or rewrote its identity');
SELECT pg_temp.e_assert((SELECT evidence_status_current='not_required' AND evidence_satisfied_at IS NULL FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_a1')),'supplementary evidence changed a receipt without rules');
RESET ROLE;
SELECT pg_temp.e_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_assert((SELECT array_agg(state ORDER BY state) FROM public.operation_evidence WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_a1'))=ARRAY['finalized'],'a failed supplementary upload appears attached to another reader');
RESET ROLE;

-- An object owned by someone else under the uploader's path never counts.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'prep4',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac3'),pg_temp.k('prep-000030'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel.webp","mime":"image/webp","size_bytes":77}'));
INSERT INTO ef_ids SELECT 'ev4',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep4';
RESET ROLE;
-- Modelled foreign object: written outside the client policy (the way a misrouted service upload would arrive).
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev4'),(SELECT aide FROM ef),77,'image/webp');
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev4'),pg_temp.k('fin-000030'),pg_temp.rev('r_fac3'),'{}')$q$,'Uploaded object not found');
SELECT pg_temp.e_assert((SELECT state='prepared' FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')) AND (SELECT execution_state='performed_missing_evidence' FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_fac_d3')),'an unowned object satisfied evidence');
RESET ROLE;
-- Failure is the uploader's act: a governing recorder who is not the uploader is refused by wording, a non-recorder by authority, and neither reply carries the path.
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev4'),pg_temp.k('fail-aide-0001'),'{"reason":"Not mine"}')$q$,'belongs to another uploader');
SELECT pg_temp.e_assert((SELECT count(*)=0 FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')),'another recorder can read an in-flight path');
RESET ROLE;
SELECT pg_temp.e_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$SELECT public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev4'),pg_temp.k('fail-nurse-001'),'{"reason":"Not mine"}')$q$);
RESET ROLE;
SELECT pg_temp.e_assert((SELECT state='prepared' FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')),'a non-uploader failed someone else''s evidence');

-- Checksum verification: the declared MD5 is checked against the object's eTag when the upload is marked and again at finalization.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
-- Mismatch at upload marking: the row fails durably (checksum_mismatch) with both values on the event and nothing raised; the failed row can neither be marked nor finalized; the receipt stays missing.
INSERT INTO ef_results SELECT 'prep_c1',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000080'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c1.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c1',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c1';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c1'),(SELECT maint FROM ef),64,'image/jpeg','other bytes');
INSERT INTO ef_results SELECT 'up_c1',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c1'),pg_temp.k('up-000080'));
SELECT pg_temp.e_assert((SELECT result->>'outcome'='checksum_mismatch' AND (result->>'replayed')::boolean=false AND result->'evidence'->>'state'='failed' AND result->'evidence'->>'failure_reason'='checksum_mismatch' AND result->'evidence'->>'failed_at' IS NOT NULL
 AND (result->'evidence'->>'checksum_verified')::boolean=false AND result->'evidence'->>'object_id' IS NULL AND result->'event'->>'event_kind'='failed' AND result->'event'->'details'->>'failure_kind'='checksum_mismatch'
 AND result->'event'->'details'->>'declared_md5'=md5('panel-c1.jpg') AND result->'event'->'details'->>'observed_md5'=md5('other bytes') AND result->'event'->'details'->>'observed_etag'='"'||md5('other bytes')||'"'
 FROM ef_results WHERE label='up_c1'),'a checksum mismatch did not fail the row durably with both values');
SELECT pg_temp.e_assert((SELECT state='failed' AND failure_reason='checksum_mismatch' FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_c1')),'the mismatch failure was not durable');
INSERT INTO ef_results SELECT 'up_c1_replay',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c1'),pg_temp.k('up-000080'));
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->>'outcome'='checksum_mismatch' FROM ef_results WHERE label='up_c1_replay'),'mismatch replay did not report the same outcome');
SELECT pg_temp.e_expect($q$SELECT public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c1'),pg_temp.k('up-000081'))$q$,'has failed');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c1'),pg_temp.k('fin-000080'),pg_temp.rev('r_fac4'),'{}')$q$,'has failed');
SELECT pg_temp.e_assert((SELECT evidence_status_current='missing' AND evidence_satisfied_at IS NULL FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac4'))
 AND (SELECT execution_state='performed_missing_evidence' FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_fac_d4')),'a mismatched upload satisfied anything');
-- Multipart eTag: uploaded but unverified; finalization refuses and the row stays uploaded; the uploader fails it explicitly.
INSERT INTO ef_results SELECT 'prep_c2',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000082'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c2.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c2',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c2';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c2'),(SELECT maint FROM ef),64,'image/jpeg',NULL,'"'||md5('panel-c2.jpg')||'-3"');
INSERT INTO ef_results SELECT 'up_c2',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c2'),pg_temp.k('up-000082'));
SELECT pg_temp.e_assert((SELECT result->>'outcome'='checksum_unverifiable' AND result->'evidence'->>'state'='uploaded' AND (result->'evidence'->>'checksum_verified')::boolean=false AND result->'evidence'->>'checksum_method' IS NULL AND result->'evidence'->>'checksum_verified_at' IS NULL
 AND result->'evidence'->>'object_id' IS NOT NULL AND result->'event'->>'event_kind'='uploaded' AND result->'event'->'details'->>'etag_kind'='multipart' FROM ef_results WHERE label='up_c2'),'a multipart eTag did not leave the row uploaded and unverified');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c2'),pg_temp.k('fin-000082'),pg_temp.rev('r_fac4'),'{}')$q$,'checksum could not be verified from the stored object');
SELECT pg_temp.e_assert((SELECT state='uploaded' AND NOT checksum_verified FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_c2')),'a refused finalization moved an unverified row');
INSERT INTO ef_results SELECT 'fail_c2',public.fail_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c2'),pg_temp.k('fail-000082'),'{"reason":"Storage returned a multipart eTag"}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='failed' AND result->'evidence'->>'state'='failed' AND result->'event'->'details'->>'previous_state'='uploaded' FROM ef_results WHERE label='fail_c2'),'explicit failure of an unverified upload did not work');
-- The object changed between upload marking and finalization (its eTag moved): object_changed, durable, with the recorded and observed facts on the event; nothing satisfied.
INSERT INTO ef_results SELECT 'prep_c3',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000083'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c3.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c3',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c3';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c3'),(SELECT maint FROM ef),64,'image/jpeg');
INSERT INTO ef_results SELECT 'up_c3',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c3'),pg_temp.k('up-000083'));
SELECT pg_temp.e_assert((SELECT result->>'outcome'='uploaded' AND (result->'evidence'->>'checksum_verified')::boolean FROM ef_results WHERE label='up_c3'),'a matching upload was not verified');
RESET ROLE;
-- Bytes replaced outside any client policy (no client may update the bucket): the stored eTag moves under the same object id.
UPDATE storage.objects SET metadata=metadata||jsonb_build_object('eTag','"'||md5('replaced bytes')||'"') WHERE bucket_id='operation-evidence' AND name=(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_c3'));
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'fin_c3',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c3'),pg_temp.k('fin-000083'),pg_temp.rev('r_fac4'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='object_changed' AND (result->>'replayed')::boolean=false AND result->'evidence'->>'state'='failed' AND result->'evidence'->>'failure_reason'='object_changed' AND jsonb_typeof(result->'satisfaction')='null'
 AND result->'event'->>'event_kind'='failed' AND result->'event'->'details'->>'failure_kind'='object_changed' AND result->'event'->>'expected_receipt_revision'=pg_temp.rev('r_fac4')
 AND result->'event'->'details'->'recorded'->>'object_etag'='"'||md5('panel-c3.jpg')||'"' AND result->'event'->'details'->'observed'->>'object_etag'='"'||md5('replaced bytes')||'"'
 FROM ef_results WHERE label='fin_c3'),'a changed object did not fail finalization durably');
INSERT INTO ef_results SELECT 'fin_c3_replay',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c3'),pg_temp.k('fin-000083'),pg_temp.rev('r_fac4'),'{}');
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->>'outcome'='object_changed' FROM ef_results WHERE label='fin_c3_replay'),'object_changed replay did not report the same outcome');
SELECT pg_temp.e_assert((SELECT evidence_status_current='missing' FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac4')),'a changed object satisfied the receipt');
-- The object row replaced under the same path (new id, same eTag and owner): object_changed.
INSERT INTO ef_results SELECT 'prep_c4',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000084'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c4.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c4',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c4';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c4'),(SELECT maint FROM ef),64,'image/jpeg');
INSERT INTO ef_results SELECT 'up_c4',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c4'),pg_temp.k('up-000084'));
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='operation-evidence' AND name=(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_c4'));
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c4'),(SELECT maint FROM ef),64,'image/jpeg');
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'fin_c4',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c4'),pg_temp.k('fin-000084'),pg_temp.rev('r_fac4'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='object_changed' AND result->'evidence'->>'state'='failed' AND result->'event'->'details'->'observed'->>'object_id'<>result->'event'->'details'->'recorded'->>'object_id' FROM ef_results WHERE label='fin_c4'),'a replaced object row finalized');
-- The Storage version moved under the same id and eTag: object_changed.
INSERT INTO ef_results SELECT 'prep_c5',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000085'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c5.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c5',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c5';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c5'),(SELECT maint FROM ef),64,'image/jpeg');
INSERT INTO ef_results SELECT 'up_c5',public.mark_operation_evidence_uploaded_review((SELECT id FROM ef_ids WHERE label='ev_c5'),pg_temp.k('up-000085'));
RESET ROLE;
UPDATE storage.objects SET version=gen_random_uuid()::text WHERE bucket_id='operation-evidence' AND name=(SELECT object_path FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_c5'));
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'fin_c5',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c5'),pg_temp.k('fin-000085'),pg_temp.rev('r_fac4'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='object_changed' AND result->'evidence'->>'state'='failed' FROM ef_results WHERE label='fin_c5'),'a moved Storage version finalized');
-- eTag normalisation: a weak, quoted, upper-case MD5 verifies; finalization straight from prepared verifies once and satisfies the same performance once after every failure above.
INSERT INTO ef_results SELECT 'prep_c6',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000086'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"panel-c6.jpg","mime":"image/jpeg","size_bytes":64}'));
INSERT INTO ef_ids SELECT 'ev_c6',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c6';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c6'),(SELECT maint FROM ef),64,'image/jpeg',NULL,'W/"'||upper(md5('panel-c6.jpg'))||'"');
INSERT INTO ef_results SELECT 'fin_c6',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c6'),pg_temp.k('fin-000086'),pg_temp.rev('r_fac4'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='finalized' AND result->'evidence'->>'state'='finalized' AND (result->'evidence'->>'checksum_verified')::boolean AND result->'evidence'->>'checksum_method'='storage_etag_md5' AND result->'evidence'->>'uploaded_at' IS NOT NULL
 AND result->'evidence'->>'object_etag'='W/"'||upper(md5('panel-c6.jpg'))||'"' AND result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'execution_state'='completed' FROM ef_results WHERE label='fin_c6'),'a normalised eTag did not verify and satisfy');
SELECT pg_temp.e_assert((SELECT array_agg(event_kind ORDER BY event_seq)=ARRAY['prepared','uploaded','finalized'] FROM public.operation_evidence_events WHERE evidence_id=(SELECT id FROM ef_ids WHERE label='ev_c6'))
 AND (SELECT count(*)=1 FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac4') AND event_kind='satisfied'),'finalization from prepared did not record the upload once and satisfy once');
SELECT pg_temp.e_assert((SELECT array_agg(state ORDER BY prepared_at)=ARRAY['failed','failed','failed','failed','failed','finalized'] FROM public.operation_evidence WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_fac4')),'the receipt''s evidence history is not five durable failures and one finalization');
-- The same bytes (by MD5) never finalize twice on one receipt: a later preparation replays the existing id.
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac4'),pg_temp.k('prep-000087'),pg_temp.obj('{"kind":"photo","filename":"panel-c6.jpg","mime":"image/jpeg","size_bytes":64}'))$q$,'already finalized for these bytes','evidence_id='||(SELECT id FROM ef_ids WHERE label='ev_c6'));
-- Finalization straight from prepared runs under the upload rules: a mismatch fails the row under the finalize request's own key; an unverifiable eTag leaves it uploaded and the next finalize refuses.
INSERT INTO ef_results SELECT 'prep_c7',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link2'),pg_temp.k('prep-000088'),pg_temp.obj('{"kind":"document","filename":"note-c7.pdf","mime":"application/pdf","size_bytes":12}'));
INSERT INTO ef_ids SELECT 'ev_c7',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c7';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c7'),(SELECT maint FROM ef),12,'application/pdf','other bytes');
INSERT INTO ef_results SELECT 'fin_c7',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c7'),pg_temp.k('fin-000088'),pg_temp.rev('r_link2'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='checksum_mismatch' AND result->'evidence'->>'state'='failed' AND result->'evidence'->>'failure_reason'='checksum_mismatch' AND result->'event'->>'event_kind'='failed' AND result->'event'->>'request_key'=pg_temp.k('fin-000088') FROM ef_results WHERE label='fin_c7'),'finalization from prepared did not fail a mismatch durably');
-- The failed event of a finalization names the receipt revision it was made under; the same failure at upload marking carries none.
SELECT pg_temp.e_assert((SELECT result->'event'->>'expected_receipt_revision'=pg_temp.rev('r_link2') FROM ef_results WHERE label='fin_c7') AND (SELECT result->'event'->>'expected_receipt_revision' IS NULL FROM ef_results WHERE label='up_c1'),'the finalize-path mismatch event did not carry the expected receipt revision');
INSERT INTO ef_results SELECT 'fin_c7_replay',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c7'),pg_temp.k('fin-000088'),pg_temp.rev('r_link2'),'{}');
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->>'outcome'='checksum_mismatch' FROM ef_results WHERE label='fin_c7_replay'),'finalize mismatch replay did not report the same outcome');
INSERT INTO ef_results SELECT 'prep_c8',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link2'),pg_temp.k('prep-000089'),pg_temp.obj('{"kind":"document","filename":"note-c8.pdf","mime":"application/pdf","size_bytes":12}'));
INSERT INTO ef_ids SELECT 'ev_c8',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_c8';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_c8'),(SELECT maint FROM ef),12,'application/pdf',NULL,'"'||md5('note-c8.pdf')||'-2"');
INSERT INTO ef_results SELECT 'fin_c8',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c8'),pg_temp.k('fin-000089'),pg_temp.rev('r_link2'),'{}');
SELECT pg_temp.e_assert((SELECT result->>'outcome'='checksum_unverifiable' AND result->'evidence'->>'state'='uploaded' AND (result->'evidence'->>'checksum_verified')::boolean=false AND result->'event'->>'event_kind'='uploaded' AND result->'event'->>'request_key'=pg_temp.k('fin-000089') FROM ef_results WHERE label='fin_c8'),'finalization from prepared did not leave an unverifiable upload uploaded');
INSERT INTO ef_results SELECT 'fin_c8_replay',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c8'),pg_temp.k('fin-000089'),pg_temp.rev('r_link2'),'{}');
SELECT pg_temp.e_assert((SELECT (result->>'replayed')::boolean AND result->>'outcome'='checksum_unverifiable' FROM ef_results WHERE label='fin_c8_replay'),'unverifiable finalize replay did not report the same outcome');
SELECT pg_temp.e_expect($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_c8'),pg_temp.k('fin-000090'),pg_temp.rev('r_link2'),'{}')$q$,'checksum could not be verified from the stored object');
SELECT pg_temp.e_assert((SELECT evidence_status_current='missing' FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_link2')) AND (SELECT count(*)=0 FROM public.operation_evidence WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_link2') AND state='finalized'),'an unverified or mismatched object attached to the receipt');
RESET ROLE;

-- Review-required work: finalized evidence moves the occurrence to awaiting verification, and only an independent reviewer completes it.
SELECT pg_temp.e_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'prep_emp',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_emp1'),pg_temp.k('prep-000040'),pg_temp.obj('{"kind":"document","rule_label":"Signed checklist","filename":"checklist.pdf","mime":"application/pdf","size_bytes":4096}'));
INSERT INTO ef_ids SELECT 'ev_emp',(result->'evidence'->>'id')::uuid FROM ef_results WHERE label='prep_emp';
SELECT pg_temp.put((SELECT id FROM ef_ids WHERE label='ev_emp'),(SELECT admin_a FROM ef),4096,'application/pdf');
SELECT pg_temp.e_expect($q$SELECT public.verify_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_emp_d1'),pg_temp.k('ver-000040'),'{"decision":"verified"}')$q$,'not awaiting verification');
INSERT INTO ef_results SELECT 'fin_emp',public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev_emp'),pg_temp.k('fin-000040'),pg_temp.rev('r_emp1'),'{}');
SELECT pg_temp.e_assert((SELECT result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'status'='in_progress' AND result->'satisfaction'->'occurrence'->>'execution_state'='awaiting_verification' FROM ef_results WHERE label='fin_emp'),'review-required work completed without a verifier');
SELECT pg_temp.e_assert((SELECT signed_by=(SELECT admin_a FROM ef) AND verified_by IS NULL AND completed_at IS NULL FROM public.operation_task_instances WHERE id=(SELECT id FROM ef_ids WHERE label='occ_emp_d1')),'awaiting verification mirrors wrong');
SELECT pg_temp.e_denied($q$SELECT public.verify_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_emp_d1'),pg_temp.k('ver-000041'),'{"decision":"verified"}')$q$);
RESET ROLE;
SELECT pg_temp.e_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO ef_results SELECT 'ver_emp',public.verify_operation_work_review((SELECT id FROM ef_ids WHERE label='occ_emp_d1'),pg_temp.k('ver-000042'),'{"decision":"verified"}');
SELECT pg_temp.e_assert((SELECT result->'receipt'->>'receipt_kind'='verification' AND result->'receipt'->>'evidence_status'='complete' AND result->'occurrence'->>'status'='completed' AND result->'occurrence'->>'execution_state'='completed' FROM ef_results WHERE label='ver_emp'),'verification after finalized evidence did not complete');
RESET ROLE;

-- Linked native record: readable at the site finalizes at once and satisfies; an unreadable or other-site record is refused.
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000050'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','facility_documents','linked_record_id',(SELECT doc_b FROM ef)))$q$,'not readable for this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000050'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','facility_documents','linked_record_id',gen_random_uuid()))$q$,'not readable for this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000050'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','residents','linked_record_id',(SELECT doc_a FROM ef)))$q$,'linked_table must be');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000050'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','facility_documents','linked_record_id',(SELECT doc_a FROM ef),'filename','x.pdf'))$q$,'carries no object');
INSERT INTO ef_results SELECT 'link1',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link1'),pg_temp.k('prep-000051'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','facility_documents','linked_record_id',(SELECT doc_a FROM ef)));
SELECT pg_temp.e_assert((SELECT result->'evidence'->>'state'='finalized' AND result->'evidence'->>'object_path' IS NULL AND result->'evidence'->>'linked_table'='facility_documents' AND result->'satisfaction'->>'receipt_evidence_status'='complete' AND result->'satisfaction'->'occurrence'->>'status'='completed' FROM ef_results WHERE label='link1'),'linked record did not finalize and satisfy');
SELECT pg_temp.e_assert((SELECT array_agg(event_kind ORDER BY event_seq)=ARRAY['prepared','finalized','satisfied'] FROM public.operation_evidence_events WHERE receipt_id=(SELECT id FROM ef_ids WHERE label='r_link1')),'linked record history wrong');
RESET ROLE;
-- A linked record must belong to the receipt's subject: another employee's file, a medical file on a personnel receipt and a vault document on an employee receipt are refused with one wording; the employee's own personnel file links.
SELECT pg_temp.e_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_emp1'),pg_temp.k('prep-000070'),jsonb_build_object('kind','linked_record','linked_table','employee_file_records','linked_record_id',(SELECT rec_emp2_pers FROM ef)))$q$,'not readable for this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_emp1'),pg_temp.k('prep-000070'),jsonb_build_object('kind','linked_record','linked_table','employee_file_records','linked_record_id',(SELECT rec_emp1_med FROM ef)))$q$,'not readable for this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_emp1'),pg_temp.k('prep-000070'),jsonb_build_object('kind','linked_record','linked_table','facility_documents','linked_record_id',(SELECT doc_a FROM ef)))$q$,'not readable for this receipt');
INSERT INTO ef_results SELECT 'link_emp',public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_emp1'),pg_temp.k('prep-000071'),jsonb_build_object('kind','linked_record','linked_table','employee_file_records','linked_record_id',(SELECT rec_emp1_pers FROM ef)));
SELECT pg_temp.e_assert((SELECT result->'evidence'->>'state'='finalized' AND result->'evidence'->>'rule_label' IS NULL AND jsonb_typeof(result->'satisfaction')='null' FROM ef_results WHERE label='link_emp'),'the employee''s own personnel file did not link as supplementary evidence');
RESET ROLE;
SELECT pg_temp.e_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link2'),pg_temp.k('prep-000072'),jsonb_build_object('kind','linked_record','rule_label','Vault document','linked_table','employee_file_records','linked_record_id',(SELECT rec_emp1_pers FROM ef)))$q$,'not readable for this receipt');
SELECT pg_temp.e_expect($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_link2'),pg_temp.k('prep-000073'),pg_temp.obj('{"kind":"photo","filename":"fraction.jpg","mime":"image/jpeg","size_bytes":1234.5}'))$q$,'size_bytes must be');
RESET ROLE;

-- Direct DML and forged settings are refused; evidence and events are immutable; states move only forward.
SELECT pg_temp.e_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$UPDATE public.operation_evidence SET state='finalized' WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')$q$);
SELECT pg_temp.e_denied($q$INSERT INTO public.operation_evidence(organization_id,facility_id,activity_id,subject_id,authority_class,receipt_id,task_instance_id,evidence_kind,state,uploaded_by,prepared_at,request_key,request_hash,revision,linked_table,linked_record_id,finalized_at,finalized_by)
 SELECT organization_id,facility_id,activity_id,subject_id,authority_class,id,task_instance_id,'linked_record','finalized',recorder_id,now(),'forged-000001','x','y','facility_documents',(SELECT doc_a FROM ef),now(),recorder_id FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac3')$q$);
SELECT pg_temp.e_denied($q$DELETE FROM public.operation_evidence_events$q$);
SELECT pg_temp.e_denied($q$UPDATE public.operation_execution_receipts SET evidence_status_current='complete' WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac3')$q$);
SELECT pg_temp.e_denied($q$SELECT haven.operation_occurrence_token()$q$);
RESET ROLE;
SELECT pg_temp.e_service();
SET LOCAL ROLE service_role;
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.e_denied($q$UPDATE public.operation_evidence SET state='finalized',finalized_at=now(),finalized_by=uploaded_by,uploaded_at=now(),object_id=gen_random_uuid(),object_size_bytes=77,object_mime='image/webp' WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')$q$);
SELECT pg_temp.e_denied($q$UPDATE public.operation_execution_receipts SET evidence_status_current='complete',evidence_satisfied_at=now() WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac3')$q$);
SELECT pg_temp.e_denied($q$INSERT INTO public.operation_evidence_events(organization_id,facility_id,receipt_id,event_kind,actor_id,actor_role,request_key,request_hash) SELECT organization_id,facility_id,id,'satisfied',recorder_id,'x','forged-000002','h' FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac3')$q$);
SELECT pg_temp.e_denied($q$SELECT public.finalize_operation_evidence_review((SELECT id FROM ef_ids WHERE label='ev4'),'svc-000001',repeat('a',64),'{}')$q$);
RESET ROLE;
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.e_assert((SELECT state='prepared' FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev4')) AND (SELECT evidence_status_current='missing' FROM public.operation_execution_receipts WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac3')),'forged writes changed evidence or receipt state');
-- Even the owner token cannot rewrite identity, move a state backwards, delete history or move a receipt past complete.
DO $$ BEGIN PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.e_expect($q$UPDATE public.operation_evidence SET object_path=(SELECT site_b FROM ef)||'/'||id||'/panel.jpg' WHERE id=(SELECT id FROM ef_ids WHERE label='ev1')$q$,'identity is immutable');
SELECT pg_temp.e_expect($q$UPDATE public.operation_evidence SET state='prepared',finalized_at=NULL,finalized_by=NULL,uploaded_at=NULL,object_id=NULL,object_size_bytes=NULL,object_mime=NULL,object_etag=NULL WHERE id=(SELECT id FROM ef_ids WHERE label='ev1')$q$,'moves only forward');
SELECT pg_temp.e_expect($q$DELETE FROM public.operation_evidence WHERE id=(SELECT id FROM ef_ids WHERE label='ev_sup')$q$,'immutable history');
SELECT pg_temp.e_expect($q$UPDATE public.operation_evidence_events SET details='{}'::jsonb$q$,'immutable history');
SELECT pg_temp.e_expect($q$UPDATE public.operation_execution_receipts SET evidence_status_current='missing',evidence_satisfied_at=NULL WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac1')$q$,'immutable');
SELECT pg_temp.e_expect($q$UPDATE public.operation_execution_receipts SET note='rewritten' WHERE id=(SELECT id FROM ef_ids WHERE label='r_fac1')$q$,'immutable');
SELECT set_config('haven.operation_occurrence_command','',true);

-- A revoked session denies before any row; receipts and the task list carry no object path.
SELECT pg_temp.e_login('maint');
DELETE FROM auth.sessions WHERE id=(SELECT maint_session FROM ef);
SET LOCAL ROLE authenticated;
SELECT pg_temp.e_denied($q$SELECT public.prepare_operation_evidence_review((SELECT id FROM ef_ids WHERE label='r_fac3'),pg_temp.k('prep-000060'),pg_temp.obj('{"kind":"photo","rule_label":"Panel photo","filename":"late.jpg","mime":"image/jpeg","size_bytes":10}'))$q$);
RESET ROLE;
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN('operation_execution_receipts','operation_task_instances') AND column_name IN('object_path','filename')),'a receipt or task row carries an object path');
SELECT pg_temp.e_assert((SELECT count(*)=17 FROM public.operation_evidence) AND (SELECT count(*)=5 FROM public.operation_evidence_events WHERE event_kind='satisfied'),'unexpected evidence or satisfaction count');
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM public.operation_evidence WHERE state='finalized' AND evidence_kind<>'linked_record' AND NOT (checksum_verified AND checksum_method='storage_etag_md5' AND checksum_verified_at IS NOT NULL)),'an object finalized without a verified checksum');
SELECT pg_temp.e_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%operation_evidence%' AND p.prosecdef),'a public evidence RPC is definer');
SELECT 'COL-143 verified evidence behavior PASS' result;
ROLLBACK;
