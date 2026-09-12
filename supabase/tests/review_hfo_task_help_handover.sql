-- COL-153 behavioral authorization and immutable handover proof. Synthetic only.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-153 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,state text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=state THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Expected % for %',state,stmt; END $$;
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_help_handover_events),'migration seeded assignments');
-- FIXTURES-BEGIN
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() doc,gen_random_uuid() site_b,gen_random_uuid() local_activity,gen_random_uuid() actor,gen_random_uuid() replacement,gen_random_uuid() backup,gen_random_uuid() actor_session,gen_random_uuid() replacement_session,gen_random_uuid() backup_session,
 f.id site,f.organization_id org,(SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-d03-01' AND organization_id=f.organization_id) activity FROM public.facilities f WHERE f.id='00000000-0000-0000-0002-000000000003';
CREATE TEMP TABLE cf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON cf TO authenticated; GRANT ALL ON cf_results TO authenticated;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@handover.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Manager"}'::jsonb FROM cf
 UNION ALL SELECT replacement,replacement||'@handover.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Replacement"}'::jsonb FROM cf
 UNION ALL SELECT backup,backup||'@handover.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Backup"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@handover.invalid','Manager','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT replacement,replacement||'@handover.invalid','Replacement','housekeeper'::public.app_role,org,true FROM cf
 UNION ALL SELECT backup,backup||'@handover.invalid','Backup','housekeeper'::public.app_role,org,true FROM cf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM cf UNION ALL SELECT replacement_session,replacement FROM cf UNION ALL SELECT backup_session,backup FROM cf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,site,org FROM cf UNION ALL SELECT replacement,site,org FROM cf UNION ALL SELECT backup,site,org FROM cf;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT cf.site_b,cf.org,f.entity_id,'Synthetic second site','Test','Test','00000',1 FROM cf JOIN public.facilities f ON f.id=cf.site;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin) SELECT local_activity,org,site_b,'col153-local-'||local_activity,'Local only','attestation','facility','admin_log' FROM cf;
INSERT INTO public.facility_documents(id,organization_id,facility_id,document_category,document_name,file_path,uploaded_by,vault_series_id) SELECT doc,org,site,'fire_inspections','Synthetic guide','probe/guide.pdf',actor,gen_random_uuid() FROM cf;
-- FIXTURES-END
SET LOCAL ROLE authenticated;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),'app_role','facility_admin','organization_id',org)::text,true) FROM cf;
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.operation_help_handover_people_review(%L,%L)',local_activity,site),'42501') FROM cf;
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,NULL,%L)',activity,site,'help','foreign-doc1',jsonb_build_object('how_to','Guide','examples','','contact','','protected_document_ids',jsonb_build_array(gen_random_uuid()))),'22023') FROM cf;
INSERT INTO cf_results SELECT 'help',public.write_operation_help_handover_review(activity,site,'help','help-test-0001',NULL,'{"how_to":"Check mailbox","examples":"Routine example","contact":"Local contact unconfirmed","protected_document_ids":[]}') FROM cf;
INSERT INTO cf_results SELECT 'proposal',public.write_operation_help_handover_review(activity,site,'propose','duty-test-0001',NULL,jsonb_build_object('duty_scope','Mailbox check','owner_user_id',replacement,'backup_user_id',backup,'effective_at',clock_timestamp(),'note','Synthetic local split')) FROM cf;
SELECT pg_temp.c_assert((SELECT count(*)=2 FROM public.operation_help_handover_events),'proposal did not retain independent help');
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,NULL,%L)',activity,site,'accept','accept-wrong',jsonb_build_object('proposal_id',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),'duty_role','owner')),'42501') FROM cf;
SELECT pg_temp.c_expect(format('UPDATE public.operation_help_handover_events SET payload=%L','{}'),'42501');
SELECT pg_temp.c_expect('TRUNCATE public.operation_help_handover_events','42501');
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',replacement,'role','authenticated','session_id',replacement_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=replacement),'app_role','housekeeper','organization_id',org)::text,true) FROM cf;
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,NULL,%L)',activity,site,'help','not-manager1','{"how_to":"Bad","examples":"","contact":"","protected_document_ids":[]}'),'42501') FROM cf;
INSERT INTO cf_results SELECT 'accept-owner',public.write_operation_help_handover_review(activity,site,'accept','accept-owner1',(SELECT (result->'event'->>'id')::uuid FROM cf_results WHERE label='proposal'),jsonb_build_object('proposal_id',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),'duty_role','owner')) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'actor_id'=(SELECT replacement::text FROM cf) FROM cf_results WHERE label='accept-owner'),'acceptance attributed to another person');
SELECT pg_temp.c_assert((public.write_operation_help_handover_review(activity,site,'accept','accept-owner1',(SELECT (result->'event'->>'id')::uuid FROM cf_results WHERE label='proposal'),jsonb_build_object('proposal_id',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),'duty_role','owner'))->>'replayed')::boolean,'exact acceptance did not replay') FROM cf;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',backup,'role','authenticated','session_id',backup_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=backup),'app_role','housekeeper','organization_id',org)::text,true) FROM cf;
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,%L,%L)',activity,site,'accept','stale-backup1',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),jsonb_build_object('proposal_id',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),'duty_role','backup')),'P0001') FROM cf;
INSERT INTO cf_results SELECT 'accept-backup',public.write_operation_help_handover_review(activity,site,'accept','accept-backup1',(SELECT (result->'event'->>'id')::uuid FROM cf_results WHERE label='accept-owner'),jsonb_build_object('proposal_id',(SELECT result->'event'->>'id' FROM cf_results WHERE label='proposal'),'duty_role','backup')) FROM cf;
SELECT pg_temp.c_assert((SELECT count(*)=4 FROM public.operation_help_handover_events),'history not append-only');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT backup FROM cf);
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.operation_help_handover_people_review(%L,%L)',activity,site),'42501') FROM cf;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_help_handover_events),'revoked user reads history');
RESET ROLE;
-- A dependent trigger changing only the nominated person's role or a chosen
-- document must roll the entire command back, not merely alter its reply.
CREATE FUNCTION pg_temp.hfo153_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.payload->>'note'='role-race' THEN UPDATE public.user_profiles SET app_role='family' WHERE id=(NEW.payload->>'owner_user_id')::uuid; END IF;
 IF NEW.payload->>'how_to'='document-race' THEN UPDATE public.facility_documents SET deleted_at=clock_timestamp() WHERE id=(NEW.payload->'protected_document_ids'->>0)::uuid; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hfo153_invalidate AFTER INSERT ON public.operation_help_handover_events FOR EACH ROW EXECUTE FUNCTION pg_temp.hfo153_invalidate();
SET LOCAL ROLE authenticated;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor),'app_role','facility_admin','organization_id',org)::text,true) FROM cf;
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,NULL,%L)',activity,site,'propose','role-race-01',jsonb_build_object('duty_scope','Synthetic role race','owner_user_id',replacement,'effective_at',clock_timestamp(),'note','role-race')),'42501') FROM cf;
SELECT pg_temp.c_expect(format('SELECT public.write_operation_help_handover_review(%L,%L,%L,%L,%L,%L)',activity,site,'help','doc-race-001',(SELECT result->'event'->>'id' FROM cf_results WHERE label='help'),jsonb_build_object('how_to','document-race','examples','','contact','','protected_document_ids',jsonb_build_array(doc))),'22023') FROM cf;
RESET ROLE;
SELECT pg_temp.c_assert((SELECT app_role='housekeeper' FROM public.user_profiles WHERE id=(SELECT replacement FROM cf)),'recipient role race did not roll back');
SELECT pg_temp.c_assert((SELECT deleted_at IS NULL FROM public.facility_documents WHERE id=(SELECT doc FROM cf)),'document race did not roll back');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'help-with-ref',public.write_operation_help_handover_review(activity,site,'help','help-ref-001',(SELECT (result->'event'->>'id')::uuid FROM cf_results WHERE label='help'),jsonb_build_object('how_to','Version two','examples','Example','contact','Local contact unknown','protected_document_ids',jsonb_build_array(doc))) FROM cf;
RESET ROLE;
UPDATE public.facility_documents SET deleted_at=clock_timestamp() WHERE id=(SELECT doc FROM cf);
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'help-preserve',public.write_operation_help_handover_review(activity,site,'help','help-preserve1',(SELECT (result->'event'->>'id')::uuid FROM cf_results WHERE label='help-with-ref'),jsonb_build_object('how_to','Version three','examples','Example','contact','Local contact unknown')) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->'payload'->'protected_document_ids'=jsonb_build_array((SELECT doc FROM cf)) FROM cf_results WHERE label='help-preserve'),'omitted references silently detached historical document');
SELECT pg_temp.c_assert((SELECT result->'event'->>'previous_id'=(SELECT result->'event'->>'id' FROM cf_results WHERE label='help-with-ref') FROM cf_results WHERE label='help-preserve'),'help versions lost previous version');
RESET ROLE;
-- Query shapes used by the HTTP projection must exist on this actual replay.
SELECT id,template_name,status,assigned_to,due_at FROM public.operation_task_instances LIMIT 0;
SELECT id,title,wording,procedure,version FROM public.operation_requirement_versions LIMIT 0;
SELECT id,local_procedure,version,applicability,schedule_status FROM public.operation_facility_requirements LIMIT 0;
SELECT pg_temp.c_assert((SELECT count(*)=6 FROM public.operation_help_handover_events),'denied commands changed history');
ROLLBACK;
