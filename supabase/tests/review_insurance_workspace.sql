-- Transactional disposable replay probes. Real current-actor helper + live session rows.
BEGIN;
GRANT USAGE ON SCHEMA auth,storage TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.insurance_policies TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(auth.jwt()->>'sub','')::uuid$$;
CREATE TEMP TABLE insurance_fixture AS SELECT gen_random_uuid() owner,gen_random_uuid() admin,gen_random_uuid() caregiver,gen_random_uuid() owner_session,gen_random_uuid() admin_session,gen_random_uuid() draft,gen_random_uuid() doc,gen_random_uuid() certificate,gen_random_uuid() cert_request,gen_random_uuid() run,gen_random_uuid() second_run,gen_random_uuid() hidden_facility,f.id facility,f.entity_id entity,f.organization_id org FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT owner,owner||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Insurance owner"}'::jsonb FROM insurance_fixture UNION ALL SELECT admin,admin||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Insurance facility"}'::jsonb FROM insurance_fixture UNION ALL SELECT caregiver,caregiver||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','caregiver'),'{"full_name":"Insurance caregiver"}'::jsonb FROM insurance_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT owner,owner||'@review.invalid','Insurance owner','owner'::public.app_role,org,true FROM insurance_fixture UNION ALL SELECT admin,admin||'@review.invalid','Insurance facility','facility_admin'::public.app_role,org,true FROM insurance_fixture UNION ALL SELECT caregiver,caregiver||'@review.invalid','Insurance caregiver','caregiver'::public.app_role,org,true FROM insurance_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner FROM insurance_fixture UNION ALL SELECT admin_session,admin FROM insurance_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT admin,facility,org FROM insurance_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT hidden_facility,entity,org,'Hidden insurance facility','Probe','Probe','00000',1 FROM insurance_fixture;
CREATE TEMP TABLE insurance_receipts(name text PRIMARY KEY,value jsonb);
GRANT SELECT ON insurance_fixture TO authenticated;
GRANT ALL ON insurance_receipts TO authenticated;
CREATE FUNCTION pg_temp.insurance_actor(p_admin boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE f record;uid uuid;sid uuid; BEGIN SELECT * INTO f FROM insurance_fixture;uid:=CASE WHEN p_admin THEN f.admin ELSE f.owner END;sid:=CASE WHEN p_admin THEN f.admin_session ELSE f.owner_session END;PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated','auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=uid))::text,true);END$$;
CREATE FUNCTION pg_temp.insurance_expect(q text,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE q;EXCEPTION WHEN OTHERS THEN IF position(msg IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'Expected rejection: %',msg;END$$;
CREATE FUNCTION pg_temp.insurance_payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('entity_id',entity,'policy_type','general_liability','carrier_name','Probe Carrier','policy_number','CORE-'||draft,'effective_date','2026-01-01','expiration_date','2026-12-31','premium_cents',12300,'aggregate_limit_cents',NULL,'occurrence_limit_cents',NULL,'deductible_cents',NULL,'shared_limit',true,'parties',jsonb_build_array(jsonb_build_object('entity_id',entity,'role','primary_named_insured','effective_from','2026-01-01','effective_to',NULL)),'facilities',jsonb_build_array(jsonb_build_object('facility_id',facility,'role','covered_location','effective_from','2026-01-01','effective_to',NULL),jsonb_build_object('facility_id',hidden_facility,'role','covered_location','effective_from','2026-01-01','effective_to',NULL))) FROM insurance_fixture $$;
CREATE FUNCTION pg_temp.insurance_evidence() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_object_agg(k,jsonb_build_object('source','manual','reason','Verified against retained source in review probe')) FROM unnest(ARRAY['entity_id','policy_type','carrier_name','policy_number','effective_date','expiration_date','premium_cents','shared_limit','change_effective_date','parties.0','facilities.0','facilities.1']) k$$;
SELECT pg_temp.insurance_actor(false);
SET LOCAL ROLE authenticated;
DO $$BEGIN IF has_function_privilege('authenticated','public.insurance_processing(text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','haven.insurance_processing_impl(text,jsonb)','EXECUTE') OR has_function_privilege('anon','public.insurance_workspace(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Processing grants unsafe';END IF;END$$;
SELECT pg_temp.insurance_expect('SELECT public.insurance_processing(''register_document'',''{}'')','permission denied');
SELECT pg_temp.insurance_expect('SELECT public.insurance_workspace(''register_document'',''{}'')','Unknown insurance command');
SELECT public.insurance_workspace('overview','{}');
INSERT INTO insurance_receipts SELECT 'draft',public.insurance_workspace('save_draft',jsonb_build_object('id',draft,'kind','new_policy','payload',pg_temp.insurance_payload(),'evidence',pg_temp.insurance_evidence())) FROM insurance_fixture;
DO $$DECLARE r jsonb;BEGIN SELECT public.insurance_workspace('save_draft',jsonb_build_object('id',draft,'kind','new_policy','payload',pg_temp.insurance_payload(),'evidence',pg_temp.insurance_evidence())) INTO r FROM insurance_fixture;IF r<>(SELECT value FROM insurance_receipts WHERE name='draft') THEN RAISE EXCEPTION 'Initial draft retry not idempotent';END IF;END$$;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',(SELECT draft FROM insurance_fixture),'revision',1,'confirm_evidence',false)),'Explicit evidence confirmation');
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''save_draft'',%L)',jsonb_build_object('id',(SELECT draft FROM insurance_fixture),'kind','new_policy','revision',0,'payload',pg_temp.insurance_payload(),'evidence',pg_temp.insurance_evidence())),'Stale draft revision');
INSERT INTO insurance_receipts SELECT 'approved',public.insurance_workspace('approve_draft',jsonb_build_object('id',draft,'revision',1,'confirm_evidence',true)) FROM insurance_fixture;
DO $$DECLARE r jsonb; BEGIN SELECT public.insurance_workspace('approve_draft',jsonb_build_object('id',draft,'revision',1,'confirm_evidence',true)) INTO r FROM insurance_fixture;IF r<>(SELECT value FROM insurance_receipts WHERE name='approved') THEN RAISE EXCEPTION 'Approval is not idempotent';END IF;IF (SELECT count(*) FROM public.insurance_policies WHERE id=(r->>'policy_id')::uuid)<>1 THEN RAISE EXCEPTION 'Published policy missing';END IF;IF (SELECT count(*) FROM public.insurance_work_items WHERE policy_id=(r->>'policy_id')::uuid)<>0 THEN RAISE EXCEPTION 'New table SELECT accidentally exposed';END IF;END$$;
SELECT set_config('haven.insurance_publish','true',true),set_config('app.insurance_processing','true',true);
SELECT pg_temp.insurance_expect(format('UPDATE public.insurance_policies SET premium_cents=1 WHERE id=%L',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='approved')),'Verified policy requires');
SELECT pg_temp.insurance_expect(format('DELETE FROM public.insurance_policies WHERE id=%L',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='approved')),'Verified policy requires');
SELECT pg_temp.insurance_expect(format('INSERT INTO public.insurance_policies(organization_id,entity_id,policy_type,carrier_name,policy_number,effective_date,expiration_date,verification_status,version) SELECT org,entity,''general_liability'',''Fake'',''Fake'',''2026-01-01'',''2026-12-31'',''verified'',1 FROM insurance_fixture'),'Verified policy requires');
INSERT INTO insurance_receipts SELECT 'overview',public.insurance_workspace('overview',jsonb_build_object('policy_id',value->>'policy_id')) FROM insurance_receipts WHERE name='approved';
DO $$DECLARE r jsonb;BEGIN SELECT value INTO r FROM insurance_receipts WHERE name='overview';IF jsonb_array_length(r->'versions')<>1 OR jsonb_array_length(r->'work_items')<>4 OR (r->'policies'->0->>'premium_cents')::integer<>12300 THEN RAISE EXCEPTION 'Publication history, premium, renewal tasks incomplete';END IF;END$$;
SELECT public.insurance_workspace('configure_renewal',jsonb_build_object('policy_id',value->>'policy_id','owner_id',(SELECT owner FROM insurance_fixture),'milestone_days',jsonb_build_array(120,90,60,30))) FROM insurance_receipts WHERE name='approved';
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''configure_renewal'',%L)',jsonb_build_object('policy_id',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='approved'),'owner_id',(SELECT caregiver FROM insurance_fixture),'milestone_days',jsonb_build_array(90))),'Invalid work owner');
DO $$BEGIN IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.insurance_workspace('overview','{}')->'owners') WHERE value->>'id' IN((SELECT caregiver::text FROM insurance_fixture),(SELECT admin::text FROM insurance_fixture))) THEN RAISE EXCEPTION 'Owner picker exposes users unable to manage insurance';END IF;END$$;
INSERT INTO insurance_receipts SELECT 'bad-money',public.insurance_workspace('save_draft',jsonb_build_object('kind','new_policy','payload',pg_temp.insurance_payload()||'{"premium_cents":2147483648}'::jsonb,'evidence',pg_temp.insurance_evidence()));
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',(SELECT value->>'id' FROM insurance_receipts WHERE name='bad-money'),'revision',1,'confirm_evidence',true)),'Invalid integer cents');
INSERT INTO insurance_receipts SELECT 'duplicate',public.insurance_workspace('save_draft',jsonb_build_object('kind','new_policy','payload',pg_temp.insurance_payload(),'evidence',pg_temp.insurance_evidence()));
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',(SELECT value->>'id' FROM insurance_receipts WHERE name='duplicate'),'revision',1,'confirm_evidence',true)),'duplicate key');
INSERT INTO insurance_receipts SELECT 'endorsement',public.insurance_workspace('save_draft',jsonb_build_object('kind','endorsement','policy_id',value->>'policy_id','expected_version',1,'payload',pg_temp.insurance_payload()||'{"change_effective_date":"2026-06-01","premium_cents":13000}'::jsonb,'evidence',pg_temp.insurance_evidence())) FROM insurance_receipts WHERE name='approved';
SELECT public.insurance_workspace('approve_draft',jsonb_build_object('id',value->>'id','revision',1,'confirm_evidence',true)) FROM insurance_receipts WHERE name='endorsement';
-- Verification keeps legacy primary key and relationships; coverage lines carry no premium.
INSERT INTO public.insurance_policies(organization_id,entity_id,policy_type,carrier_name,policy_number,effective_date,expiration_date,status) SELECT org,entity,'general_liability','Legacy Carrier','LEGACY-'||draft,'2026-01-01','2026-12-31','cancelled' FROM insurance_fixture;
INSERT INTO insurance_receipts SELECT 'legacy',to_jsonb(p) FROM public.insurance_policies p WHERE policy_number='LEGACY-'||(SELECT draft FROM insurance_fixture);
INSERT INTO insurance_receipts SELECT 'verification',public.insurance_workspace('save_draft',jsonb_build_object('kind','verification','policy_id',value->>'id','expected_version',0,'payload',pg_temp.insurance_payload()||jsonb_build_object('carrier_name','Legacy Carrier','policy_number',value->>'policy_number','coverages',jsonb_build_array(jsonb_build_object('coverage_type','general_liability','occurrence_limit_cents',100000000,'aggregate_limit_cents',200000000,'deductible_cents',NULL,'shared_limit_group','package'),jsonb_build_object('coverage_type','property','occurrence_limit_cents',NULL,'aggregate_limit_cents',NULL,'deductible_cents',NULL,'shared_limit_group',NULL))),'evidence',pg_temp.insurance_evidence()||jsonb_build_object('coverages.0',jsonb_build_object('source','manual','reason','CGL line verified'),'coverages.1',jsonb_build_object('source','manual','reason','Property limits unknown')))) FROM insurance_receipts WHERE name='legacy';
INSERT INTO insurance_receipts SELECT 'verified',public.insurance_workspace('approve_draft',jsonb_build_object('id',value->>'id','revision',1,'confirm_evidence',true)) FROM insurance_receipts WHERE name='verification';
DO $$DECLARE r jsonb;BEGIN
 IF (SELECT value->>'policy_id' FROM insurance_receipts WHERE name='verified')<>(SELECT value->>'id' FROM insurance_receipts WHERE name='legacy') THEN RAISE EXCEPTION 'Legacy verification changed primary key';END IF;
 r:=public.insurance_workspace('overview',jsonb_build_object('policy_id',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='verified')));
 IF r->'policies'->0->>'status'<>'cancelled' THEN RAISE EXCEPTION 'Verification reactivated cancelled legacy policy';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'work_items') WHERE value->>'status'='open') THEN RAISE EXCEPTION 'Cancelled verification created open default reminders';END IF;
 IF jsonb_array_length(r->'policies'->0->'coverages')<>2 OR (r->'policies'->0->>'premium_cents')::integer<>12300 THEN RAISE EXCEPTION 'Package coverages or single term premium lost';END IF;
END$$;
-- Historical intake records remain expired and never seed current renewal work.
DO $$DECLARE p jsonb;d jsonb;r jsonb;approved jsonb;BEGIN
 p:=pg_temp.insurance_payload()||jsonb_build_object('policy_number','HISTORICAL-'||(SELECT draft FROM insurance_fixture),'effective_date','2020-01-01','expiration_date','2020-12-31');
 p:=jsonb_set(p,'{parties}',(SELECT jsonb_agg(value||'{"effective_from":"2020-01-01","effective_to":null}'::jsonb) FROM jsonb_array_elements(p->'parties')));
 p:=jsonb_set(p,'{facilities}',(SELECT jsonb_agg(value||'{"effective_from":"2020-01-01","effective_to":null}'::jsonb) FROM jsonb_array_elements(p->'facilities')));
 d:=public.insurance_workspace('save_draft',jsonb_build_object('kind','new_policy','payload',p,'evidence',pg_temp.insurance_evidence()));
 approved:=public.insurance_workspace('approve_draft',jsonb_build_object('id',d->>'id','revision',1,'confirm_evidence',true));
 r:=public.insurance_workspace('overview',jsonb_build_object('policy_id',approved->>'policy_id'));
 IF r->'policies'->0->>'status'<>'expired' THEN RAISE EXCEPTION 'Historical new term incorrectly marked active';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'work_items') WHERE value->>'status'='open') THEN RAISE EXCEPTION 'Historical expired term created open default reminders';END IF;
END$$;
-- An explicitly re-added renewal milestone reopens only system-superseded work.
DO $$DECLARE p uuid;r jsonb;t jsonb;original uuid;BEGIN
 p:=(SELECT (value->>'policy_id')::uuid FROM insurance_receipts WHERE name='approved');
 r:=public.insurance_workspace('configure_renewal',jsonb_build_object('policy_id',p,'owner_id',(SELECT owner FROM insurance_fixture),'milestone_days',jsonb_build_array(90,60,30)));
 SELECT value INTO t FROM jsonb_array_elements(r) WHERE value->>'milestone_days'='90';original:=(t->>'id')::uuid;
 PERFORM public.insurance_workspace('update_work_item',jsonb_build_object('id',original,'version',(t->>'version')::integer,'status','completed','note','Completed milestone review'));
 PERFORM public.insurance_workspace('configure_renewal',jsonb_build_object('policy_id',p,'owner_id',(SELECT owner FROM insurance_fixture),'milestone_days',jsonb_build_array(30)));
 r:=public.insurance_workspace('configure_renewal',jsonb_build_object('policy_id',p,'owner_id',(SELECT owner FROM insurance_fixture),'milestone_days',jsonb_build_array(90,60,30)));
 IF (SELECT count(*) FROM jsonb_array_elements(r) WHERE value->>'milestone_days'='60' AND value->>'status'='open')<>1 THEN RAISE EXCEPTION 'Re-added milestone remains dismissed';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r) WHERE value->>'id'=original::text AND value->>'status'='completed') THEN RAISE EXCEPTION 'Reschedule reopened completed milestone';END IF;
END$$;
-- Whitespace cannot evade duplicate identity and create a second premium term.
INSERT INTO insurance_receipts SELECT 'spaced-duplicate',public.insurance_workspace('save_draft',jsonb_build_object('kind','new_policy','payload',pg_temp.insurance_payload()||jsonb_build_object('carrier_name','  Probe Carrier  ','policy_number','  '||(pg_temp.insurance_payload()->>'policy_number')||'  '),'evidence',pg_temp.insurance_evidence()));
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',(SELECT value->>'id' FROM insurance_receipts WHERE name='spaced-duplicate'),'revision',1,'confirm_evidence',true)),'duplicate key');
-- June endorsements cannot fill historical April/May gaps in expired Jan-Mar links.
DO $$DECLARE p jsonb;e jsonb;d jsonb;approved jsonb;bad jsonb;BEGIN
 p:=pg_temp.insurance_payload()||jsonb_build_object('policy_number','HIST-'||(SELECT draft FROM insurance_fixture));
 p:=jsonb_set(p,'{facilities,0,effective_to}','"2026-03-31"');
 p:=jsonb_set(p,'{parties}',(p->'parties')||jsonb_build_array(jsonb_build_object('entity_id',(SELECT entity FROM insurance_fixture),'role','additional_insured','effective_from','2026-01-01','effective_to','2026-03-31')));
 e:=pg_temp.insurance_evidence()||jsonb_build_object('parties.1',jsonb_build_object('source','manual','reason','Historical additional insured'));
 d:=public.insurance_workspace('save_draft',jsonb_build_object('kind','new_policy','payload',p,'evidence',e));
 approved:=public.insurance_workspace('approve_draft',jsonb_build_object('id',d->>'id','revision',1,'confirm_evidence',true));
 bad:=jsonb_set(p,'{facilities,0,effective_to}','"2026-12-31"')||'{"change_effective_date":"2026-06-01"}'::jsonb;
 d:=public.insurance_workspace('save_draft',jsonb_build_object('kind','endorsement','policy_id',approved->>'policy_id','expected_version',1,'payload',bad,'evidence',e));
 PERFORM pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',d->>'id','revision',1,'confirm_evidence',true)),'preserve prior facility intervals');
 bad:=jsonb_set(p,'{parties,1,effective_to}','"2026-12-31"')||'{"change_effective_date":"2026-06-01"}'::jsonb;
 d:=public.insurance_workspace('save_draft',jsonb_build_object('kind','endorsement','policy_id',approved->>'policy_id','expected_version',1,'payload',bad,'evidence',e));
 PERFORM pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''approve_draft'',%L)',jsonb_build_object('id',d->>'id','revision',1,'confirm_evidence',true)),'preserve prior party intervals');
END$$;
-- Legacy raw registers and their audit snapshots must not defeat summary privacy.
RESET ROLE;
CREATE TEMP TABLE insurance_private_rows(table_name text,id uuid);
GRANT SELECT ON insurance_private_rows TO authenticated;
DO $$DECLARE f record;pol uuid;claim uuid;x uuid;BEGIN SELECT * INTO f FROM insurance_fixture;pol:=(SELECT (value->>'policy_id')::uuid FROM insurance_receipts WHERE name='approved');
 INSERT INTO public.insurance_claims(organization_id,entity_id,insurance_policy_id,description) VALUES(f.org,f.entity,pol,'Restricted group claim') RETURNING id INTO claim;INSERT INTO insurance_private_rows VALUES('insurance_claims',claim);
 INSERT INTO public.claim_activities(organization_id,insurance_claim_id,activity_date,activity_type,description,performed_by) VALUES(f.org,claim,'2026-01-01','review','Restricted activity',f.owner) RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('claim_activities',x);
 INSERT INTO public.workers_comp_claims(organization_id,facility_id,injury_date,description) VALUES(f.org,f.facility,'2026-01-01','Restricted workplace matter') RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('workers_comp_claims',x);
 INSERT INTO public.insurance_renewals(organization_id,entity_id,insurance_policy_id,target_effective_date) VALUES(f.org,f.entity,pol,'2027-01-01') RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('insurance_renewals',x);
 INSERT INTO public.renewal_data_packages(organization_id,entity_id,insurance_policy_id,period_start,period_end,payload) VALUES(f.org,f.entity,pol,'2026-01-01','2026-12-31','{"restricted":"group financials"}') RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('renewal_data_packages',x);
 INSERT INTO public.loss_runs(organization_id,entity_id,period_start,period_end,payload) VALUES(f.org,f.entity,'2026-01-01','2026-12-31','{"restricted":"carrier losses"}') RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('loss_runs',x);
 INSERT INTO public.premium_allocations(organization_id,insurance_policy_id,facility_id,period_start,period_end,allocated_premium_cents) VALUES(f.org,pol,f.facility,'2026-01-01','2026-12-31',12300) RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('premium_allocations',x);
 INSERT INTO public.certificates_of_insurance(organization_id,entity_id,holder_name,carrier_name,effective_date,expiration_date,document_storage_path) VALUES(f.org,f.entity,'Restricted holder','Carrier','2026-01-01','2026-12-31','restricted/original.pdf') RETURNING id INTO x;INSERT INTO insurance_private_rows VALUES('certificates_of_insurance',x);
END$$;
SET LOCAL ROLE authenticated;
DO $$DECLARE t record;n integer;BEGIN FOR t IN SELECT * FROM insurance_private_rows LOOP EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1',t.table_name) INTO n USING t.id;IF n<>1 THEN RAISE EXCEPTION 'Manager lost legacy read: %',t.table_name;END IF;END LOOP;END$$;
SELECT pg_temp.insurance_actor(true);
DO $$DECLARE r jsonb;BEGIN
 IF EXISTS(SELECT 1 FROM public.insurance_policies WHERE id=(SELECT (value->>'policy_id')::uuid FROM insurance_receipts WHERE name='approved')) THEN RAISE EXCEPTION 'Raw facility policy leak';END IF;
 IF EXISTS(SELECT 1 FROM public.audit_log WHERE table_name LIKE 'insurance_%') THEN RAISE EXCEPTION 'Insurance audit leaks source snapshots';END IF;
 r:=public.insurance_workspace('overview',jsonb_build_object('as_of','2026-09-01','policy_id',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='approved')));
 IF jsonb_array_length(r->'policies')<>1 OR jsonb_array_length(r->'policies'->0->'facilities')<>1 OR (r->'policies'->0)?'premium_cents' OR (r->'policies'->0)?'parties' OR r->'drafts'<>'[]'::jsonb OR r->'documents'<>'[]'::jsonb OR r->'versions'<>'[]'::jsonb OR r->'owners'<>'[]'::jsonb THEN RAISE EXCEPTION 'Facility summary leaks manager data';END IF;
 IF (public.insurance_workspace('overview',jsonb_build_object('as_of','2027-01-01','policy_id',(SELECT value->>'policy_id' FROM insurance_receipts WHERE name='approved')))->'policies')<>'[]'::jsonb THEN RAISE EXCEPTION 'Facility summaries ignore effective intervals';END IF;
END$$;
DO $$DECLARE t record;n integer;BEGIN FOR t IN SELECT * FROM insurance_private_rows LOOP EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1',t.table_name) INTO n USING t.id;IF n<>0 THEN RAISE EXCEPTION 'Facility raw legacy leak: %',t.table_name;END IF;IF EXISTS(SELECT 1 FROM public.audit_log WHERE table_name=t.table_name AND record_id=t.id) THEN RAISE EXCEPTION 'Facility legacy audit leak: %',t.table_name;END IF;END LOOP;END$$;
SELECT pg_temp.insurance_expect('SELECT public.insurance_workspace(''get_document'',''{}'')','Insurance manager required');
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''overview'',%L)',jsonb_build_object('facility_id',(SELECT hidden_facility FROM insurance_fixture))),'Facility access forbidden');
INSERT INTO insurance_receipts SELECT 'request',public.insurance_workspace('create_certificate_request',jsonb_build_object('id',cert_request,'entity_id',entity,'facility_id',facility,'holder_name','Review holder','requirements','Review certificate limits')) FROM insurance_fixture;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''update_certificate_request'',%L)',jsonb_build_object('id',(SELECT cert_request FROM insurance_fixture),'version',1,'status','issued')),'Insurance manager required');
SELECT pg_temp.insurance_actor(false);
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''update_certificate_request'',%L)',jsonb_build_object('id',(SELECT cert_request FROM insurance_fixture),'version',1,'status','issued')),'requires stored certificate evidence');
RESET ROLE;
-- Service endpoint cannot trust stale/disabled acting profiles.
GRANT SELECT ON insurance_fixture TO service_role;
GRANT ALL ON insurance_receipts TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO insurance_receipts SELECT 'doc',public.insurance_processing('register_document',jsonb_build_object('id',doc,'actor_id',owner,'organization_id',org,'filename','source.pdf','sha256',repeat('a',64),'mime_type','application/pdf','byte_size',40,'family','policy')) FROM insurance_fixture;
RESET ROLE;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_processing(''finish_document'',%L)',jsonb_build_object('id',(SELECT doc FROM insurance_fixture),'actor_id',(SELECT owner FROM insurance_fixture),'organization_id',(SELECT org FROM insurance_fixture),'status','ready','scan_status','clean')),'Stored object');
INSERT INTO storage.objects(bucket_id,name) SELECT 'insurance-originals',value->>'storage_path' FROM insurance_receipts WHERE name='doc';
SELECT public.insurance_processing('finish_document',jsonb_build_object('id',doc,'actor_id',owner,'organization_id',org,'status','ready','scan_status','clean')) FROM insurance_fixture;
SELECT public.insurance_processing('start_extraction',jsonb_build_object('document_id',doc,'actor_id',owner,'organization_id',org,'run_id',run)) FROM insurance_fixture;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_processing(''finish_extraction'',%L)',jsonb_build_object('document_id',(SELECT doc FROM insurance_fixture),'actor_id',(SELECT owner FROM insurance_fixture),'organization_id',(SELECT org FROM insurance_fixture),'run_id',(SELECT second_run FROM insurance_fixture),'status','manual_review')),'Stale extraction run');
SELECT public.insurance_processing('finish_extraction',jsonb_build_object('document_id',doc,'actor_id',owner,'organization_id',org,'run_id',run,'status','review_required','payload',pg_temp.insurance_payload(),'evidence','{}'::jsonb,'extraction_metadata',jsonb_build_object('schema_version',1,'extractor_version','haven-insurance-v1','provider','restricted_adapter','configured_model',NULL))) FROM insurance_fixture;
SELECT public.insurance_processing('finish_extraction',jsonb_build_object('document_id',doc,'actor_id',owner,'organization_id',org,'run_id',run,'status','review_required','payload',pg_temp.insurance_payload(),'evidence','{}'::jsonb,'extraction_metadata',jsonb_build_object('schema_version',1,'extractor_version','haven-insurance-v1','provider','restricted_adapter','configured_model',NULL))) FROM insurance_fixture;
DO $$BEGIN IF (SELECT count(*) FROM public.insurance_drafts WHERE document_id=(SELECT doc FROM insurance_fixture))<>1 THEN RAISE EXCEPTION 'Retried extraction creates duplicate drafts';END IF;END$$;
-- Provenance is server-owned, persisted across manual fact corrections.
DO $$DECLARE d public.insurance_drafts;expected jsonb;BEGIN
 SELECT * INTO d FROM public.insurance_drafts WHERE document_id=(SELECT doc FROM insurance_fixture);
 expected:=jsonb_build_object('schema_version',1,'extractor_version','haven-insurance-v1','provider','restricted_adapter','configured_model',NULL);
 IF d.extraction_metadata<>expected THEN RAISE EXCEPTION 'Extraction provenance missing';END IF;
 PERFORM public.insurance_workspace('save_draft',jsonb_build_object('id',d.id,'revision',d.revision,'kind','new_policy','document_id',d.document_id,'payload',d.payload,'evidence',pg_temp.insurance_evidence(),'extraction_metadata',jsonb_build_object('provider','forged-manual-edit')));
 SELECT * INTO d FROM public.insurance_drafts WHERE id=d.id;
 IF d.extraction_metadata<>expected THEN RAISE EXCEPTION 'Manual edit changed trusted extraction provenance';END IF;
END$$;

INSERT INTO insurance_receipts SELECT 'certificate',public.insurance_processing('register_document',jsonb_build_object('id',certificate,'actor_id',owner,'organization_id',org,'filename','coi.pdf','sha256',repeat('b',64),'mime_type','application/pdf','byte_size',40,'family','certificate','facility_id',facility)) FROM insurance_fixture;
INSERT INTO storage.objects(bucket_id,name) SELECT 'insurance-originals',value->>'storage_path' FROM insurance_receipts WHERE name='certificate';
SELECT public.insurance_processing('finish_document',jsonb_build_object('id',certificate,'actor_id',owner,'organization_id',org,'status','quarantined','scan_status','quarantined')) FROM insurance_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''get_document'',%L)',jsonb_build_object('id',(SELECT certificate FROM insurance_fixture))),'Document not found or unavailable');
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''update_certificate_request'',%L)',jsonb_build_object('id',(SELECT cert_request FROM insurance_fixture),'version',1,'status','issued','document_id',(SELECT certificate FROM insurance_fixture))),'Certificate evidence unavailable');
RESET ROLE;
SELECT public.insurance_processing('finish_document',jsonb_build_object('id',certificate,'actor_id',owner,'organization_id',org,'status','ready','scan_status','clean')) FROM insurance_fixture;
SET LOCAL ROLE authenticated;
SELECT public.insurance_workspace('update_certificate_request',jsonb_build_object('id',cert_request,'version',1,'status','issued','document_id',certificate)) FROM insurance_fixture;
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_workspace(''update_certificate_request'',%L)',jsonb_build_object('id',(SELECT cert_request FROM insurance_fixture),'version',1,'status','issued')),'Stale certificate version');
RESET ROLE;
SELECT pg_temp.insurance_expect('UPDATE public.insurance_policy_versions SET evidence=''{}''','Approved insurance history is immutable');
SELECT pg_temp.insurance_expect('UPDATE public.insurance_drafts SET evidence=''{}'' WHERE status=''approved''','Finalized insurance draft is immutable');
SET LOCAL ROLE authenticated;
SELECT public.insurance_workspace('get_document',jsonb_build_object('id',doc)) FROM insurance_fixture;
DO $$BEGIN IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='insurance-originals') THEN RAISE EXCEPTION 'Browser storage originals leaked';END IF;END$$;
RESET ROLE;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.insurance_document_access WHERE document_id=(SELECT doc FROM insurance_fixture) AND actor_id=(SELECT owner FROM insurance_fixture)) THEN RAISE EXCEPTION 'Original access not audited';END IF;END$$;
-- Classified historical vault copies cannot bypass original custody controls.
INSERT INTO insurance_receipts VALUES('legacy_vault',jsonb_build_object('id',gen_random_uuid())),('ordinary_vault',jsonb_build_object('id',gen_random_uuid()));
INSERT INTO public.facility_documents(id,facility_id,organization_id,document_category,document_name,file_path,uploaded_by,vault_series_id)
 SELECT (r.value->>'id')::uuid,f.facility,f.org,CASE WHEN r.name='legacy_vault' THEN 'insurance_general_liability' ELSE 'other_misc' END,r.name,f.facility::text||'/'||r.name||'.txt',f.owner,(r.value->>'id')::uuid FROM insurance_receipts r CROSS JOIN insurance_fixture f WHERE r.name IN('legacy_vault','ordinary_vault');
INSERT INTO storage.objects(bucket_id,name) SELECT 'facility-documents',file_path FROM public.facility_documents WHERE id IN(SELECT (value->>'id')::uuid FROM insurance_receipts WHERE name IN('legacy_vault','ordinary_vault'));
SELECT pg_temp.insurance_actor(true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.facility_documents WHERE id=(SELECT (value->>'id')::uuid FROM insurance_receipts WHERE name='legacy_vault')) THEN RAISE EXCEPTION 'Legacy insurance vault metadata leaked';END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='facility-documents' AND name=(SELECT facility::text||'/legacy_vault.txt' FROM insurance_fixture)) THEN RAISE EXCEPTION 'Legacy insurance original leaked';END IF;
 IF EXISTS(SELECT 1 FROM public.facility_audit_log WHERE record_id=(SELECT (value->>'id')::uuid FROM insurance_receipts WHERE name='legacy_vault')) THEN RAISE EXCEPTION 'Legacy insurance vault audit leaked';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facility_documents WHERE id=(SELECT (value->>'id')::uuid FROM insurance_receipts WHERE name='ordinary_vault')) THEN RAISE EXCEPTION 'Ordinary facility document access removed';END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='facility-documents' AND name=(SELECT facility::text||'/ordinary_vault.txt' FROM insurance_fixture)) THEN RAISE EXCEPTION 'Ordinary facility original access removed';END IF;
END$$;
RESET ROLE;
SELECT pg_temp.insurance_actor(false);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.facility_documents WHERE id=(SELECT (value->>'id')::uuid FROM insurance_receipts WHERE name='legacy_vault')) OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='facility-documents' AND name=(SELECT facility::text||'/legacy_vault.txt' FROM insurance_fixture)) THEN RAISE EXCEPTION 'Manager lost legacy custody';END IF;
END$$;
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT owner FROM insurance_fixture);
SELECT pg_temp.insurance_expect(format('SELECT public.insurance_processing(''start_extraction'',%L)',jsonb_build_object('document_id',(SELECT doc FROM insurance_fixture),'actor_id',(SELECT owner FROM insurance_fixture),'organization_id',(SELECT org FROM insurance_fixture),'run_id',(SELECT second_run FROM insurance_fixture))),'Current insurance manager required');
SET LOCAL ROLE authenticated;
SELECT pg_temp.insurance_expect('SELECT public.insurance_workspace(''overview'',''{}'')','Authentication required');
RESET ROLE;
ROLLBACK;
