-- Authenticated SQL behavior on disposable replay, not provider/browser acceptance.
BEGIN;
-- Match hosted Supabase service role bypass for the negative automation tests.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.hfo_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',msg; END IF; END $$;
CREATE FUNCTION pg_temp.hfo_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'Expected authority denial: %',stmt;
END $$;
CREATE TEMP TABLE authority_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() owner_actor,gen_random_uuid() owner_session,
 gen_random_uuid() nurse_actor,gen_random_uuid() nurse_session,gen_random_uuid() resident,gen_random_uuid() employee,gen_random_uuid() asset,
 gen_random_uuid() site_b,gen_random_uuid() subject_a,gen_random_uuid() subject_b,gen_random_uuid() subject_resident,gen_random_uuid() subject_employee,gen_random_uuid() subject_asset,
 gen_random_uuid() task_a,gen_random_uuid() task_b,gen_random_uuid() task_resident,gen_random_uuid() task_employee,gen_random_uuid() task_medical,gen_random_uuid() task_unknown,gen_random_uuid() task_evidence,gen_random_uuid() task_defer,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
GRANT SELECT ON authority_fixture TO authenticated,service_role;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@authority.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Site staff"}'::jsonb FROM authority_fixture
 UNION ALL SELECT owner_actor,owner_actor||'@authority.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}' FROM authority_fixture
 UNION ALL SELECT nurse_actor,nurse_actor||'@authority.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}' FROM authority_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@authority.invalid','Site staff','housekeeper'::public.app_role,org,true FROM authority_fixture
 UNION ALL SELECT owner_actor,owner_actor||'@authority.invalid','Corporate','owner'::public.app_role,org,true FROM authority_fixture
 UNION ALL SELECT nurse_actor,nurse_actor||'@authority.invalid','Nurse','nurse'::public.app_role,org,true FROM authority_fixture
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM authority_fixture UNION ALL SELECT owner_session,owner_actor FROM authority_fixture UNION ALL SELECT nurse_session,nurse_actor FROM authority_fixture;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Authority Site B','Test','Test','00000',1 FROM authority_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,site_a,org FROM authority_fixture UNION ALL SELECT owner_actor,site_a,org FROM authority_fixture UNION ALL SELECT nurse_actor,site_a,org FROM authority_fixture;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender) SELECT resident,org,site_a,'Protected','Resident','1940-01-01','female' FROM authority_fixture;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) SELECT employee,org,site_a,'Protected','Employee','resident_aide',current_date FROM authority_fixture;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset,org,site_b,'aed','Site B asset' FROM authority_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) SELECT subject_a,org,site_a,'facility' FROM authority_fixture UNION ALL SELECT subject_b,org,site_b,'facility' FROM authority_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subject_resident,org,site_a,'resident',resident FROM authority_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) SELECT subject_employee,org,site_a,'employee',employee FROM authority_fixture;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,assigned_to)
 SELECT task_a,org,site_a,subject_a,'facility','Site A duty','safety','on_demand',current_date,actor FROM authority_fixture
 UNION ALL SELECT task_b,org,site_b,subject_b,'facility','Site B secret','safety','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_resident,org,site_a,subject_resident,'resident','Protected resident secret','safety','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_employee,org,site_a,subject_employee,'employee_personnel','Protected personnel secret','staffing','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_medical,org,site_a,subject_employee,'employee_medical','Protected medical secret','staffing','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_unknown,org,site_a,NULL,'unclassified','Unclassified secret','safety','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_evidence,org,site_a,subject_a,'facility','Legacy evidence secret','safety','on_demand',current_date,NULL FROM authority_fixture
 UNION ALL SELECT task_defer,org,site_a,subject_a,'facility','Defer duty','safety','on_demand',current_date,NULL FROM authority_fixture;
-- Model immutable legacy bytes that predate COL-133. Only fixture creation bypasses
-- the new write guard; restore it before any operation or assertion.
ALTER TABLE public.operation_task_instances DISABLE TRIGGER zz_operation_current_authority;
UPDATE public.operation_task_instances SET completion_evidence_paths=ARRAY['employee-medical/private.pdf'] WHERE id=(SELECT task_evidence FROM authority_fixture);
ALTER TABLE public.operation_task_instances ENABLE TRIGGER zz_operation_current_authority;
INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,event_notes) SELECT org,site_b,task_b,'created','Site B audit secret' FROM authority_fixture;
-- Typed template references must not expose another site's native identifiers.
ALTER TABLE authority_fixture ADD COLUMN template_safe uuid DEFAULT gen_random_uuid(), ADD COLUMN template_foreign uuid DEFAULT gen_random_uuid(), ADD COLUMN unlinked_vendor uuid DEFAULT gen_random_uuid();
INSERT INTO public.vendors(id,organization_id,name) SELECT unlinked_vendor,org,'Unlinked vendor '||unlinked_vendor FROM authority_fixture;
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,activity_id,name,description,category,cadence_type)
 SELECT f.template_safe,f.org,f.site_a,a.id,'Safe facility template','Explicit fixture','safety','on_demand' FROM authority_fixture f
 CROSS JOIN LATERAL(SELECT id FROM public.operation_activities WHERE origin='admin_log' AND subject_kind='facility' LIMIT 1) a;
-- Preserve a pre-COL133 cross-site link fixture to verify reads quarantine it.
ALTER TABLE public.operation_task_templates DISABLE TRIGGER operation_template_links;
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,activity_id,name,description,category,cadence_type,asset_ref)
 SELECT f.template_foreign,f.org,f.site_a,a.id,'Foreign asset template','Legacy link fixture','safety','on_demand',f.asset FROM authority_fixture f
 CROSS JOIN LATERAL(SELECT id FROM public.operation_activities WHERE origin='admin_log' AND subject_kind='facility' LIMIT 1) a;
ALTER TABLE public.operation_task_templates ENABLE TRIGGER operation_template_links;
ALTER TABLE authority_fixture ADD COLUMN task_foreign_template uuid DEFAULT gen_random_uuid();
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_id,template_name,template_category,template_cadence_type,assigned_shift_date)
 SELECT task_foreign_template,org,site_a,subject_a,'facility',template_foreign,'Unsafe linked template secret','safety','on_demand',current_date FROM authority_fixture;
CREATE FUNCTION pg_temp.hfo_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f authority_fixture; u uuid; sess uuid; BEGIN
 SELECT * INTO f FROM authority_fixture;
 u:=CASE p_kind WHEN 'owner' THEN f.owner_actor WHEN 'nurse' THEN f.nurse_actor ELSE f.actor END;
 sess:=CASE p_kind WHEN 'owner' THEN f.owner_session WHEN 'nurse' THEN f.nurse_session ELSE f.actor_session END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',u,'session_id',sess,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u))::text,true);
END $$;
SELECT pg_temp.hfo_login('staff');
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_denied('SELECT * FROM public.operation_automation_tasks');
SELECT pg_temp.hfo_assert(public.haven_operation_facility_access((SELECT site_a FROM authority_fixture)),'Site A grant denied');
SELECT pg_temp.hfo_assert(NOT public.haven_operation_facility_access((SELECT site_b FROM authority_fixture)),'Site B facility leak');
SELECT pg_temp.hfo_assert((SELECT count(*)=1 FROM public.haven_operation_accessible_facility_ids()),'Accessible site count leaked');
SELECT pg_temp.hfo_assert((SELECT count(*)=2 FROM public.operation_task_instances WHERE id IN(SELECT task_a FROM authority_fixture UNION ALL SELECT task_defer FROM authority_fixture)),'Visible site tasks absent');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE template_name ILIKE '%secret%'),'Search/list/count leaked hidden subject');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id IN(SELECT task_b FROM authority_fixture UNION ALL SELECT task_resident FROM authority_fixture UNION ALL SELECT task_employee FROM authority_fixture UNION ALL SELECT task_medical FROM authority_fixture UNION ALL SELECT task_evidence FROM authority_fixture UNION ALL SELECT task_unknown FROM authority_fixture)),'Identifier/export rows leaked');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_audit_log WHERE task_instance_id=(SELECT task_b FROM authority_fixture)),'Task audit leak');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_task_instances' AND record_id=(SELECT task_b FROM authority_fixture)),'Generic audit leak');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.facility_assets WHERE id=(SELECT asset FROM authority_fixture)),'Native asset Site B leak');
SELECT pg_temp.hfo_denied('UPDATE public.operation_task_instances SET status=''completed'' WHERE id=(SELECT task_a FROM authority_fixture)');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_a,owner_actor,''owner'',''spoof'',''{}'') FROM authority_fixture');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_b,actor,''housekeeper'',''foreign'',''{}'') FROM authority_fixture');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_a,actor,''housekeeper'',''raw'',ARRAY[''foreign/file.pdf'']) FROM authority_fixture');
SELECT pg_temp.hfo_assert((SELECT public.complete_operation_task_review(task_a,actor,'housekeeper','real performer','{}')='completed' FROM authority_fixture),'Authorized completion failed');
SELECT pg_temp.hfo_assert((SELECT signed_by=(SELECT actor FROM authority_fixture) AND updated_by=(SELECT actor FROM authority_fixture) FROM public.operation_task_instances WHERE id=(SELECT task_a FROM authority_fixture)),'Server attribution lost');
RESET ROLE;
SELECT pg_temp.hfo_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert(NOT public.haven_operation_facility_access((SELECT site_b FROM authority_fixture)),'Owner bypassed explicit site grants');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT task_resident FROM authority_fixture)),'Owner bypassed resident scope');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_templates WHERE id=(SELECT template_foreign FROM authority_fixture)),'Legacy foreign template link leaked');
SELECT pg_temp.hfo_denied('SELECT public.publish_operation_template_review(template_safe,jsonb_build_object(''asset_ref'',asset)) FROM authority_fixture');
SELECT pg_temp.hfo_denied('SELECT public.publish_operation_template_review(template_safe,jsonb_build_object(''vendor_booking_ref'',unlinked_vendor)) FROM authority_fixture');
SELECT pg_temp.hfo_denied('SELECT public.publish_operation_template_review(template_safe,jsonb_build_object(''linked_document_id'',gen_random_uuid())) FROM authority_fixture');
SELECT pg_temp.hfo_assert((SELECT public.publish_operation_template_review(template_safe,'{"name":"Authorized typed revision"}'::jsonb)->>'name'='Authorized typed revision' FROM authority_fixture),'Safe typed publication failed');

RESET ROLE;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason) SELECT org,site_a,owner_actor,'resident',owner_actor,'Fixture explicit resident authority' FROM authority_fixture UNION ALL SELECT org,site_a,owner_actor,'employee_personnel',owner_actor,'Fixture explicit personnel authority' FROM authority_fixture UNION ALL SELECT org,site_a,nurse_actor,'employee_personnel',owner_actor,'Fixture grant cannot override native domain role' FROM authority_fixture UNION ALL SELECT org,site_a,owner_actor,'employee_medical',owner_actor,'Fixture medical requires native grant too' FROM authority_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT count(*)=1 FROM public.operation_task_instances WHERE id=(SELECT task_resident FROM authority_fixture)),'Explicit corporate resident grant denied');
SELECT pg_temp.hfo_assert((SELECT count(*)=1 FROM public.operation_task_instances WHERE id=(SELECT task_employee FROM authority_fixture)),'Explicit personnel grant denied');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT task_medical FROM authority_fixture)),'Medical native grant bypass');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_resident,owner_actor,''owner'',''read-only specialized grant'',''{}'') FROM authority_fixture');
RESET ROLE;
UPDATE public.operation_subject_access SET can_record=true WHERE user_id=(SELECT owner_actor FROM authority_fixture) AND scope='resident';
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT public.complete_operation_task_review(task_resident,owner_actor,'owner','Explicit specialized recorder','{}')='completed' FROM authority_fixture),'Explicit native-role recorder grant denied');
DO $$ DECLARE f authority_fixture; first_result jsonb; replay_result jsonb; k text; until_at timestamptz:=clock_timestamp()+interval '1 day'; BEGIN
 SELECT * INTO f FROM authority_fixture;
 k:=encode(sha256(convert_to('operation-defer-v1:'||f.owner_actor::text||':'||f.task_defer::text,'UTF8')),'hex');
 first_result:=public.defer_operation_task_review(f.task_defer,f.owner_actor,'owner',until_at,'Current authority defer',k);
 replay_result:=public.defer_operation_task_review(f.task_defer,f.owner_actor,'owner',until_at,'Current authority defer',k);
 PERFORM pg_temp.hfo_assert(first_result->>'new_task_id'=replay_result->>'new_task_id' AND (replay_result->>'replayed')::boolean,'Defer identity replay failed');
 PERFORM pg_temp.hfo_assert(EXISTS(SELECT 1 FROM public.operation_task_instances WHERE id=(first_result->>'new_task_id')::uuid AND subject_id=f.subject_a AND authority_class='facility' AND created_by=f.owner_actor),'Defer lost subject/actor authority');
END $$;
RESET ROLE;
SELECT pg_temp.hfo_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT task_employee FROM authority_fixture)),'Personnel native role bypass');
RESET ROLE;
SELECT pg_temp.hfo_login('owner');
UPDATE public.residents SET facility_id=(SELECT site_b FROM authority_fixture) WHERE id=(SELECT resident FROM authority_fixture);
UPDATE public.staff SET employment_status='terminated',termination_date=current_date WHERE id=(SELECT employee FROM authority_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id IN(SELECT task_resident FROM authority_fixture UNION ALL SELECT task_employee FROM authority_fixture)),'Transferred/terminated subject historical scope leak');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_resident,owner_actor,''owner'',''transferred'',''{}'') FROM authority_fixture');
RESET ROLE;
-- Current expiry uses wall clock, not the transaction timestamp.
UPDATE public.user_facility_access SET operation_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=(SELECT owner_actor FROM authority_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT task_a FROM authority_fixture)),'Expired temporary coverage remained readable');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_a,owner_actor,''owner'',''expired replay'',''{}'') FROM authority_fixture');
RESET ROLE;
SELECT pg_temp.hfo_login('staff');
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM authority_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_task_instances WHERE id=(SELECT task_a FROM authority_fixture)),'Revoked session remained readable');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_a,actor,''housekeeper'',''revoked replay'',''{}'') FROM authority_fixture');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.hfo_assert((SELECT count(*)=1 FROM public.operation_automation_tasks WHERE id=(SELECT task_a FROM authority_fixture)),'Service safe facility projection missing');
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_automation_tasks WHERE id IN(SELECT task_foreign_template FROM authority_fixture UNION ALL SELECT task_evidence FROM authority_fixture UNION ALL SELECT task_resident FROM authority_fixture)),'Service unsafe link/evidence/transferred protected subject leaked');
RESET ROLE;
-- A formerly valid asset link can move after publication: service aggregation
-- must omit the linked facility task on its next query as user reads already do.
UPDATE public.facility_assets SET facility_id=(SELECT site_a FROM authority_fixture) WHERE id=(SELECT asset FROM authority_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.hfo_assert((SELECT count(*)=1 FROM public.operation_automation_tasks WHERE id=(SELECT task_foreign_template FROM authority_fixture)),'Service current matching native asset link missing');
RESET ROLE;
UPDATE public.facility_assets SET facility_id=(SELECT site_b FROM authority_fixture) WHERE id=(SELECT asset FROM authority_fixture);
SET LOCAL ROLE service_role;
SELECT pg_temp.hfo_assert((SELECT count(*)=0 FROM public.operation_automation_tasks WHERE id=(SELECT task_foreign_template FROM authority_fixture)),'Service projection retained transferred asset link');
SELECT pg_temp.hfo_denied('SELECT public.complete_operation_task_review(task_a,actor,''housekeeper'',''service impersonation'',''{}'') FROM authority_fixture');
SELECT pg_temp.hfo_denied('UPDATE public.operation_task_instances SET status=''completed'' WHERE id=(SELECT task_defer FROM authority_fixture)');
RESET ROLE;
SELECT pg_temp.hfo_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('complete_operation_task_review','defer_operation_task_review','haven_operation_task_command','haven_operation_task_access','haven_operation_facility_access') AND p.prosecdef),'Public OCE RPC is definer');
SELECT 'COL-133 current authority behavior PASS' result;
ROLLBACK;
