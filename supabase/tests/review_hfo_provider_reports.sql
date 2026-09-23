-- Synthetic native intake/report behavior only; no actual Storage server here.
BEGIN;
GRANT USAGE ON SCHEMA auth,storage TO authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT,UPDATE ON public.resident_contacts,public.resident_documents TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
REVOKE UPDATE,DELETE ON storage.objects FROM authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE pp AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() site,gen_random_uuid() other_site,gen_random_uuid() resident,gen_random_uuid() other_resident,gen_random_uuid() activity,gen_random_uuid() subject,NULL::uuid task,NULL::uuid contact,NULL::uuid expectation,NULL::uuid version,NULL::uuid revision;
CREATE TEMP TABLE pa AS SELECT role,gen_random_uuid() id,gen_random_uuid() session FROM unnest(ARRAY['owner','nurse','manager','housekeeper','cook','maintenance_role']) role;
CREATE TEMP TABLE pr(label text PRIMARY KEY,reply jsonb);GRANT ALL ON pp,pa,pr TO authenticated,service_role;
INSERT INTO public.organizations(id,name) SELECT org,'COL158 synthetic' FROM pp;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'COL158 synthetic' FROM pp;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) SELECT site,org,entity,'COL158 synthetic','Test','Test','00000',2,'America/New_York' FROM pp UNION ALL SELECT other_site,org,entity,'COL158 other','Test','Test','00000',2,'America/New_York' FROM pp;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@col158.invalid',jsonb_build_object('organization_id',org,'app_role',role),'{}'::jsonb FROM pa,pp;
INSERT INTO public.user_profiles(id,organization_id,full_name,email,app_role,is_active) SELECT id,org,'COL158 synthetic '||role,id||'@col158.invalid',role::public.app_role,true FROM pa,pp ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM pa;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT id,site,org FROM pa,pp;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) SELECT org,site,id,'resident',id,'Synthetic report scope',true FROM pa,pp;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender) SELECT resident,org,site,'COL158','Synthetic',DATE '1940-01-01','female'::public.gender FROM pp UNION ALL SELECT other_resident,org,other_site,'Other','Synthetic',DATE '1940-01-01','female'::public.gender FROM pp;
INSERT INTO public.operation_activities(id,organization_id,activity_key,name,activity_kind,subject_kind,origin) SELECT activity,org,'hfo-al-h01-01','Synthetic support plan','record_review','resident','admin_log' FROM pp;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subject,org,site,'resident',resident FROM pp;
CREATE FUNCTION pg_temp.pp_login(p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a record;BEGIN SELECT pa.*,p.auth_claim_version INTO a FROM pa JOIN public.user_profiles p USING(id) WHERE pa.role=p_role;PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated','app_role',p_role,'organization_id',(SELECT org FROM pp),'auth_claim_version',a.auth_claim_version,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true);END $$;
CREATE FUNCTION pg_temp.pp_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL158 %',msg;END IF;END $$;
CREATE FUNCTION pg_temp.pp_error(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'Expected denial: %',fragment;END $$;
SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
INSERT INTO pr VALUES('rule',public.save_operation_requirement_draft_review((SELECT activity FROM pp),'{"title":"Synthetic support plan review","wording":"Administrative report context only","allowed_recorder_roles":["owner","nurse"],"subject_kind":"resident"}'));
SELECT public.publish_operation_requirement_review((SELECT (reply->>'id')::uuid FROM pr WHERE label='rule'),clock_timestamp()-interval '1 hour');
INSERT INTO pr VALUES('site',public.save_operation_facility_requirement_draft_review((SELECT activity FROM pp),(SELECT site FROM pp),jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT reply->>'id' FROM pr WHERE label='rule'),'schedule_status','needs_confirmation')));
SELECT public.publish_operation_facility_requirement_review((SELECT (reply->>'id')::uuid FROM pr WHERE label='site'),clock_timestamp()-interval '30 minutes');
INSERT INTO pr VALUES('task',public.create_operation_manual_occurrence_review((SELECT activity FROM pp),(SELECT site FROM pp),(SELECT subject FROM pp),'col158-manual-001','{}'));
UPDATE pp SET task=(SELECT (reply->>'id')::uuid FROM pr WHERE label='task');
INSERT INTO pr SELECT 'contact',public.create_provider_contact(task,'col158-contact-001','Synthetic Caseworker','caseworker') FROM pp;
UPDATE pp SET contact=(SELECT (reply#>>'{contact,id}')::uuid FROM pr WHERE label='contact');
SELECT pg_temp.pp_assert((SELECT public.create_provider_contact(task,'col158-contact-001','Synthetic Caseworker','caseworker')#>>'{contact,id}'=contact::text FROM pp),'contact retry duplicated');
INSERT INTO pr SELECT 'expectation',public.provider_report_command(task,'col158-expect-001','create',jsonb_build_object('contact_id',contact,'document_type','support_plan','expected_version','First received plan','service_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date-1,'service_provenance','Operator observed service; no provider attestation claimed')) FROM pp;
UPDATE pp SET expectation=(SELECT (reply#>>'{expectations,0,id}')::uuid FROM pr WHERE label='expectation');
-- SETUP_END: reusable isolated fixture; all following operations are assertions.
SELECT pg_temp.pp_assert((SELECT reply#>>'{expectations,0,due_state}'='unknown' AND reply#>>'{expectations,0,overdue}'='false' AND reply#>>'{expectations,0,current_version_id}' IS NULL AND reply#>>'{expectations,0,service_at}' IS NULL FROM pr WHERE label='expectation'),'service or date-only evidence manufactured report/deadline/clocktime');
INSERT INTO pr SELECT 'intake',public.prepare_provider_document(task,'col158-intake-001',jsonb_build_object('document_type','support_plan','title','Synthetic support plan','declared_mime','application/pdf','declared_size_bytes',12,'declared_sha256',encode(sha256(convert_to('%PDF-1.7 abc','UTF8')),'hex'))) FROM pp;
UPDATE pp SET version=(SELECT (reply#>>'{version,id}')::uuid FROM pr WHERE label='intake'),revision=(SELECT (reply#>>'{version,revision}')::uuid FROM pr WHERE label='intake');
SELECT pg_temp.pp_assert(NOT EXISTS(SELECT 1 FROM public.resident_documents WHERE resident_id=(SELECT resident FROM pp)),'prepare claimed native uploaded document');
SELECT pg_temp.pp_error($q$SELECT public.finalize_provider_document(task,version,'col158-finalize-001',revision) FROM pp$q$,'Server-verified native bytes required');
SELECT pg_temp.pp_assert(NOT EXISTS(SELECT 1 FROM public.resident_documents WHERE resident_id=(SELECT resident FROM pp)),'failed finalization left native document');
SELECT pg_temp.pp_error($q$SELECT public.attest_resident_document_bytes(version,gen_random_uuid(),'v1',repeat('a',32),12,'application/pdf',repeat('a',64),repeat('a',32),(SELECT id FROM pa WHERE role='owner')) FROM pp$q$,'permission denied');
INSERT INTO storage.objects(bucket_id,name,owner,version,metadata) SELECT 'resident-documents',reply#>>'{version,object_path}',(SELECT id FROM pa WHERE role='owner'),'native-fixture-v1',jsonb_build_object('size',12,'mimetype','application/pdf','eTag',md5('%PDF-1.7 abc')) FROM pr WHERE label='intake';
CREATE TEMP TABLE byte_args AS SELECT v.id version_id,o.id object_id,o.version object_version,v.uploaded_by FROM public.resident_document_versions v JOIN storage.objects o ON o.name=v.object_path WHERE v.id=(SELECT version FROM pp);
GRANT SELECT ON byte_args TO service_role;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
SELECT public.attest_resident_document_bytes(version_id,object_id,object_version,md5('%PDF-1.7 abc'),12,'application/pdf',encode(sha256(convert_to('%PDF-1.7 abc','UTF8')),'hex'),md5('%PDF-1.7 abc'),uploaded_by) FROM byte_args;
RESET ROLE;SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
INSERT INTO pr SELECT 'finalized',public.finalize_provider_document(task,version,'col158-finalize-001',revision) FROM pp;
SELECT pg_temp.pp_assert((SELECT public.finalize_provider_document(task,version,'col158-finalize-001',revision)#>>'{version,state}'='finalized' FROM pp),'lost final response cannot replay');
SELECT pg_temp.pp_assert((SELECT count(*)=1 FROM public.resident_documents WHERE resident_id=(SELECT resident FROM pp)),'native document duplicated');

CREATE FUNCTION pg_temp.pp_revision(p_task uuid,p_expect uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT (x->>'revision')::uuid FROM jsonb_array_elements(haven.provider_report_headers(p_task)) x WHERE x->>'id'=p_expect::text $$;
INSERT INTO pr SELECT 'receipt-payload',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task,expectation),'version_id',version,'received_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date,'receipt_provenance','Actual paper report received; date only') FROM pp;
INSERT INTO pr SELECT 'receipt',public.provider_report_command(task,'col158-receipt-001','attach_receipt',(SELECT reply FROM pr WHERE label='receipt-payload')) FROM pp;
SELECT pg_temp.pp_assert((SELECT public.provider_report_command(task,'col158-receipt-001','attach_receipt',(SELECT reply FROM pr WHERE label='receipt-payload'))#>>'{expectations,0,current_version_id}'=version::text FROM pp),'receipt retry lost native version');
SELECT pg_temp.pp_assert((SELECT reply#>>'{expectations,0,received_at}' IS NULL AND reply#>>'{expectations,0,received_on}' IS NOT NULL AND reply#>>'{expectations,0,review_state}'='not_reviewed' FROM pr WHERE label='receipt'),'receipt invented clock/review');
SELECT public.provider_report_command(task,'col158-due-001','set_due',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task,expectation),'due_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date-1,'approval_reference','Cited operator-observed approval','approver_label','Actual source approver','approved_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date-2,'effective_date',(clock_timestamp() AT TIME ZONE 'America/New_York')::date+1,'source_version_id',version)) FROM pp;
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task)#>>'{expectations,0,due_state}'='documented_approval_pending_effective' AND public.provider_report_snapshot(task)#>>'{expectations,0,overdue}'='false' FROM pp),'future-effective due activated early');
SELECT public.provider_report_command(task,'testsign','signature_observation',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task,expectation),'version_id',version,'signer_role','caseworker','signer_label','Observed actual caseworker','page',2,'signed_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date-1,'source_provenance','Observed signature on exact native PDF version')) FROM pp;
SELECT pg_temp.pp_assert((SELECT details->>'verification'='operator_observed' AND details->>'page_status'='operator_reported_unverified' AND details->>'signed_at' IS NULL AND details->>'signed_on' IS NOT NULL FROM haven.provider_report_events WHERE request_key='testsign'),'signature/date precision promoted to verified crypto/page/time');
SELECT public.provider_report_command(task,'col158-review-001','review',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task,expectation),'version_id',version,'result','reviewed','findings','Administrative receipt and signature evidence reviewed')) FROM pp;
SELECT pg_temp.pp_assert((SELECT count(*)=0 FROM public.operation_execution_receipts WHERE task_instance_id=(SELECT task FROM pp)),'administrative event manufactured HFO performance');
UPDATE public.resident_contacts SET name='Corrected current contact name' WHERE id=(SELECT contact FROM pp);
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task)#>>'{expectations,0,contact_label}'='Synthetic Caseworker' AND public.provider_report_snapshot(task)#>>'{expectations,0,contact_current}'='false' FROM pp),'contact edit rewrote original service attribution');
-- A second current H01 task reuses the same six-month plan and expectation.
RESET ROLE;ALTER TABLE pp ADD COLUMN task2 uuid;SET LOCAL ROLE authenticated;
INSERT INTO pr SELECT 'task2',public.create_operation_manual_occurrence_review(activity,site,subject,'col158-manual-002','{}') FROM pp;
UPDATE pp SET task2=(SELECT (reply->>'id')::uuid FROM pr WHERE label='task2');
SELECT pg_temp.pp_assert((SELECT jsonb_array_length(public.provider_report_snapshot(task2)->'expectations')=1 AND jsonb_array_length(public.provider_report_snapshot(task2)->'versions')=1 AND public.provider_report_snapshot(task2)#>>'{expectations,0,review_state}'='not_reviewed' AND public.provider_report_snapshot(task2)#>>'{expectations,0,last_review,task_id}'=task::text FROM pp),'new monthly task copied source or inherited review completion');
SELECT pg_temp.pp_assert((SELECT public.provider_document_target(task2,version)->>'task_id'=task2::text FROM pp),'new monthly task cannot read existing plan');
SELECT public.provider_report_command(task2,'col158-review-002','review',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',version,'result','reviewed','findings','Distinct second monthly administrative review')) FROM pp;
SELECT pg_temp.pp_assert((SELECT count(*)=1 FROM haven.provider_report_expectations WHERE resident_id=(SELECT resident FROM pp)) AND (SELECT count(*)=1 FROM public.resident_documents WHERE resident_id=(SELECT resident FROM pp)),'monthly review required duplicate service/file');
SELECT pg_temp.pp_assert((SELECT task_id=(SELECT task2 FROM pp) FROM haven.provider_report_events WHERE request_key='col158-review-002'),'monthly review lost current task provenance');
-- Generic chase writes no clinical source fields to the broader issue ledger.
SELECT public.provider_report_command(task2,'col158-chase-001','create_chase',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation))) FROM pp;
SELECT pg_temp.pp_assert((SELECT summary='Follow-up required' FROM public.operation_issues WHERE id=(public.provider_report_snapshot((SELECT task2 FROM pp))#>>'{expectations,0,chase_issue_id}')::uuid),'chase copied clinical details');
-- Actual native writer changes to linked headers invalidate currentness.
UPDATE public.resident_documents SET title='Changed native header' WHERE id=(SELECT (reply#>>'{version,document_id}')::uuid FROM pr WHERE label='intake');
SELECT pg_temp.pp_error($q$SELECT public.provider_document_target(task2,version) FROM pp$q$,'header or object changed');
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task2)#>>'{versions,0,native_current}'='false' FROM pp),'native header change hidden by old verified hash');
UPDATE public.resident_documents SET title='Synthetic support plan' WHERE id=(SELECT (reply#>>'{version,document_id}')::uuid FROM pr WHERE label='intake');
RESET ROLE;
UPDATE storage.objects SET version='replaced-same-bytes' WHERE name=(SELECT reply#>>'{version,object_path}' FROM pr WHERE label='intake');
SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_error($q$SELECT public.provider_document_target(task2,version) FROM pp$q$,'header or object changed');
RESET ROLE;UPDATE storage.objects SET version='native-fixture-v1' WHERE name=(SELECT reply#>>'{version,object_path}' FROM pr WHERE label='intake');
-- Native read and write roles stay distinct even with the same HFO grant.
SELECT pg_temp.pp_login('manager');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task2)->>'can_manage'='false' FROM pp),'manager gained native write');
SELECT pg_temp.pp_error($q$SELECT public.create_provider_contact(task2,'col158-denied-contact','Not allowed','provider') FROM pp$q$,'Current native and HFO');
RESET ROLE;SELECT pg_temp.pp_login('housekeeper');SET LOCAL ROLE authenticated;
-- COL-627 (Brian, 2026-09-23): housekeepers see resident name, room and logs only, so the
-- resident-scoped provider report is refused like any other resident record.
SELECT pg_temp.pp_error($q$SELECT public.provider_report_snapshot(task2) FROM pp$q$,'Current native and HFO');
RESET ROLE;SELECT pg_temp.pp_login('cook');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_error($q$SELECT public.provider_report_snapshot(task2) FROM pp$q$,'Current native and HFO');
RESET ROLE;SELECT pg_temp.pp_login('maintenance_role');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_error($q$SELECT public.provider_report_snapshot(task2) FROM pp$q$,'Current native and HFO');
RESET ROLE;SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_error($q$DELETE FROM haven.provider_report_events$q$,'permission denied');
SELECT pg_temp.pp_error($q$UPDATE storage.objects SET metadata='{}' WHERE bucket_id='resident-documents'$q$,'permission denied');

-- Other signature roles remain independent observations, never a signer-set approval.
SELECT public.provider_report_command(task2,'col158-signature-resident','signature_observation',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',version,'signer_role','resident','signer_label','Observed resident signature','page',1,'source_provenance','Observed separate resident signature; date unknown')) FROM pp;
SELECT public.provider_report_command(task2,'col158-signature-admin','signature_observation',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',version,'signer_role','administrator','signer_label','Observed administrator signature','page',1,'source_provenance','Observed separate administrator signature; date unknown')) FROM pp;
SELECT pg_temp.pp_assert((SELECT count(DISTINCT details->>'signer_role')=3 FROM haven.provider_report_events WHERE kind='signature_observation') AND (SELECT public.provider_report_snapshot(task2)#>>'{expectations,0,required_signers}'='unknown' FROM pp),'three observations fabricated signer policy');
SELECT public.provider_report_command(task2,'testcorrect','signature_observation',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',version,'signer_role','caseworker','signer_label','Corrected observed caseworker label','page',2,'source_provenance','Corrected documentary observation, same native version','corrects_event_id',(SELECT id FROM haven.provider_report_events WHERE request_key='testsign'))) FROM pp;
INSERT INTO pr SELECT 'intake2',public.prepare_provider_document(task2,'col158-intake-002',jsonb_build_object('document_type','support_plan','title','Superseding native support plan','declared_mime','application/pdf','declared_size_bytes',12,'declared_sha256',encode(sha256(convert_to('%PDF-1.7 xyz','UTF8')),'hex'),'supersedes_version_id',version)) FROM pp;
INSERT INTO storage.objects(bucket_id,name,owner,version,metadata) SELECT 'resident-documents',reply#>>'{version,object_path}',(SELECT id FROM pa WHERE role='owner'),'native-fixture-v2',jsonb_build_object('size',12,'mimetype','application/pdf','eTag',md5('%PDF-1.7 xyz')) FROM pr WHERE label='intake2';
CREATE TEMP TABLE byte_args2 AS SELECT v.id version_id,o.id object_id,o.version object_version,v.uploaded_by FROM public.resident_document_versions v JOIN storage.objects o ON o.name=v.object_path WHERE v.id=(SELECT (reply#>>'{version,id}')::uuid FROM pr WHERE label='intake2');GRANT SELECT ON byte_args2 TO service_role;
RESET ROLE;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
SELECT public.attest_resident_document_bytes(version_id,object_id,object_version,md5('%PDF-1.7 xyz'),12,'application/pdf',encode(sha256(convert_to('%PDF-1.7 xyz','UTF8')),'hex'),md5('%PDF-1.7 xyz'),uploaded_by) FROM byte_args2;
RESET ROLE;SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
SELECT public.finalize_provider_document(task2,(SELECT (reply#>>'{version,id}')::uuid FROM pr WHERE label='intake2'),'col158-finalize-002',(SELECT (reply#>>'{version,revision}')::uuid FROM pr WHERE label='intake2')) FROM pp;
SELECT public.provider_report_command(task2,'col158-receipt-002','attach_receipt',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',(SELECT reply#>>'{version,id}' FROM pr WHERE label='intake2'),'received_on',(clock_timestamp() AT TIME ZONE 'America/New_York')::date,'receipt_provenance','Actual superseding plan received')) FROM pp;
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task2)#>>'{expectations,0,review_state}'='not_reviewed' AND public.provider_report_snapshot(task2)#>>'{expectations,0,current_version_id}'=(SELECT reply#>>'{version,id}' FROM pr WHERE label='intake2') FROM pp),'new version inherited old review');
SELECT pg_temp.pp_assert((SELECT count(*)=4 FROM haven.provider_report_events WHERE kind='signature_observation' AND reference_version_id=(SELECT version FROM pp)) AND NOT EXISTS(SELECT 1 FROM haven.provider_report_events WHERE kind='signature_observation' AND reference_version_id=(SELECT (reply#>>'{version,id}')::uuid FROM pr WHERE label='intake2')),'signatures copied or old observations lost');
SELECT pg_temp.pp_assert((SELECT count(*)=2 FROM public.resident_documents WHERE resident_id=(SELECT resident FROM pp)) AND (SELECT count(*)=1 FROM haven.provider_report_expectations WHERE resident_id=(SELECT resident FROM pp)),'supersession copied service expectation');
-- Retiring a native document hides its direct native-version metadata/history details.
RESET ROLE;
-- Controlled native retirement; this test does not grant a new clinical archive command.
UPDATE public.resident_documents SET deleted_at=clock_timestamp() WHERE id=(SELECT reply#>>'{version,document_id}' FROM pr WHERE label='intake2')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_assert(NOT EXISTS(SELECT 1 FROM public.resident_document_versions WHERE id=(SELECT (reply#>>'{version,id}')::uuid FROM pr WHERE label='intake2')),'retired native metadata leaked through version table');
SELECT pg_temp.pp_assert((SELECT public.provider_report_snapshot(task2)->>'complete'='false' FROM pp),'hidden native history appeared complete');

-- The same actor may access another resident/site, but cannot cross-bind reports.
RESET ROLE;ALTER TABLE pp ADD COLUMN other_subject uuid DEFAULT gen_random_uuid(),ADD COLUMN other_task uuid;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT (SELECT id FROM pa WHERE role='owner'),other_site,org FROM pp;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) SELECT org,other_site,(SELECT id FROM pa WHERE role='owner'),'resident',(SELECT id FROM pa WHERE role='owner'),'Synthetic other resident scope',true FROM pp;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT other_subject,org,other_site,'resident',other_resident FROM pp;
SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
INSERT INTO pr SELECT 'other-site-rule',public.save_operation_facility_requirement_draft_review(activity,other_site,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT reply->>'id' FROM pr WHERE label='rule'),'schedule_status','needs_confirmation')) FROM pp;
SELECT public.publish_operation_facility_requirement_review((SELECT (reply->>'id')::uuid FROM pr WHERE label='other-site-rule'),clock_timestamp()-interval '30 minutes');
INSERT INTO pr SELECT 'other-task',public.create_operation_manual_occurrence_review(activity,other_site,other_subject,'col158-other-task','{}') FROM pp;
UPDATE pp SET other_task=(SELECT (reply->>'id')::uuid FROM pr WHERE label='other-task');
SELECT pg_temp.pp_assert((SELECT jsonb_array_length(public.provider_report_snapshot(other_task)->'expectations')=0 AND jsonb_array_length(public.provider_report_snapshot(other_task)->'versions')=0 FROM pp),'same actor crossed resident source scope');
SELECT pg_temp.pp_error($q$SELECT public.provider_document_target(other_task,version) FROM pp$q$,'Native document unavailable');
SELECT pg_temp.pp_error($q$SELECT public.provider_report_command(other_task,'col158-wrong-review','review',jsonb_build_object('expectation_id',expectation,'expected_revision',pg_temp.pp_revision(task2,expectation),'version_id',version,'result','reviewed','findings','Wrong patient')) FROM pp$q$,'Report expectation unavailable');
SELECT pg_temp.pp_error($q$SELECT public.create_provider_contact(other_task,'col158-contact-001','Synthetic Caseworker','caseworker') FROM pp$q$,'Contact request scope/content conflict');
RESET ROLE;UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE facility_id=(SELECT other_site FROM pp) AND user_id=(SELECT id FROM pa WHERE role='owner');SELECT pg_temp.pp_login('owner');SET LOCAL ROLE authenticated;
SELECT pg_temp.pp_error($q$SELECT public.provider_report_snapshot(other_task) FROM pp$q$,'Provider report scope unavailable');
SELECT 'COL158 native report primary PASS' result;
ROLLBACK;
