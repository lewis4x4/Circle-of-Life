-- COL-135: versioned central requirements and facility applicability on the
-- disposable replay. Authenticated SQL behaviour with synthetic fixtures; not
-- hosted, browser or staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.a_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-135 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.a_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-135 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.a_expect(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-135 expected rejection containing "%": %',fragment,stmt;
END $$;
CREATE TEMP TABLE af AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() site_b,gen_random_uuid() act_fac,gen_random_uuid() subject_a,
 gen_random_uuid() task_plain,gen_random_uuid() task_snap,f.id site_a,f.organization_id org,f.entity_id entity
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
CREATE TEMP TABLE af_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE af_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON af TO authenticated,service_role; GRANT ALL ON af_ids,af_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Applicability Site B','Test','Test','00000',1 FROM af;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@applicability.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM af
 UNION ALL SELECT admin_a,admin_a||'@applicability.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM af
 UNION ALL SELECT admin_b,admin_b||'@applicability.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM af;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@applicability.invalid','Corporate','owner'::public.app_role,org,true FROM af
 UNION ALL SELECT admin_a,admin_a||'@applicability.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM af
 UNION ALL SELECT admin_b,admin_b||'@applicability.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM af
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM af UNION ALL SELECT admin_a_session,admin_a FROM af UNION ALL SELECT admin_b_session,admin_b FROM af;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM af UNION ALL SELECT admin_a,site_a,org FROM af UNION ALL SELECT admin_b,site_b,org FROM af;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_fac,org,NULL,'hfo-135-fixture:'||act_fac,'Generator weekly observation','structured_observation','facility','admin_log' FROM af;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) SELECT subject_a,org,site_a,'facility' FROM af;
ALTER TABLE af ADD COLUMN act_legacy uuid DEFAULT gen_random_uuid();
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,origin) SELECT act_legacy,org,site_a,'hfo-135-legacy:'||act_legacy,'Unclassified legacy duty','legacy_template' FROM af;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,assigned_to)
 SELECT task_plain,org,site_a,subject_a,'facility','Plain duty','safety','on_demand',current_date,owner_actor FROM af;
CREATE FUNCTION pg_temp.a_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f af; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM af;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSE u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;

-- Central requirement: draft, invalid rule, preview problems, publish, immutability.
SELECT pg_temp.a_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO af_results SELECT 'draft1',public.save_operation_requirement_draft_review(act_fac,'{"title":"Generator weekly observation"}') FROM af;
SELECT pg_temp.a_assert(result->>'status'='draft' AND (result->>'version')::int=1 AND result->>'subject_kind'='facility','draft was not created as version 1') FROM af_results WHERE label='draft1';
INSERT INTO af_ids SELECT 'v1',(result->>'id')::uuid FROM af_results WHERE label='draft1';
SELECT pg_temp.a_expect($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{"required_inputs":[{"key":"Bad Key","label":"x","type":"number","required":true}]}')$q$,'invalid rule');
SELECT pg_temp.a_expect($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{"required_evidence":[{"kind":"photo","label":"Same","min_count":1,"when":"always"},{"kind":"document","label":"Same","min_count":1,"when":"always"}]}')$q$,'invalid rule');
SELECT pg_temp.a_expect($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{"status":"published"}')$q$,'not editable');
SELECT pg_temp.a_expect($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{"subject_kind":"resident"}')$q$,'must match the activity subject');
INSERT INTO af_results SELECT 'preview1',public.preview_operation_requirement_review(id,clock_timestamp()) FROM af_ids WHERE label='v1';
SELECT pg_temp.a_assert((result->>'publishable')::boolean=false AND result->'problems' ? 'requirement wording is required' AND result->'problems' ? 'at least one recorder role is required','incomplete draft previewed as publishable') FROM af_results WHERE label='preview1';
SELECT pg_temp.a_expect($q$SELECT public.publish_operation_requirement_review((SELECT id FROM af_ids WHERE label='v1'),clock_timestamp())$q$,'not publishable');
SELECT pg_temp.a_assert((SELECT status FROM public.operation_requirement_versions WHERE id=(SELECT id FROM af_ids WHERE label='v1'))='draft','failed publication changed draft state');
INSERT INTO af_results SELECT 'draft1b',public.save_operation_requirement_draft_review(act_fac,jsonb_build_object('wording','Observe the weekly generator test run and record run minutes.','procedure','Stand clear; read the panel.',
 'source_authority',jsonb_build_object('source_item_ids',jsonb_build_array('AL-W01')),'allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','run_minutes','label','Run minutes','type','number','required',true,'min',0)),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always')))) FROM af;
SELECT pg_temp.a_assert((result->>'id')::uuid=(SELECT id FROM af_ids WHERE label='v1'),'second save created a second draft') FROM af_results WHERE label='draft1b';
INSERT INTO af_results SELECT 'preview1b',public.preview_operation_requirement_review(id,clock_timestamp()) FROM af_ids WHERE label='v1';
SELECT pg_temp.a_assert((result->>'publishable')::boolean AND (result->>'next_version')::int=1 AND result->>'latest_version_id' IS NULL AND result->>'in_force_version_id' IS NULL,'complete draft not publishable') FROM af_results WHERE label='preview1b';
INSERT INTO af_results SELECT 'pub1',public.publish_operation_requirement_review(id,clock_timestamp()) FROM af_ids WHERE label='v1';
SELECT pg_temp.a_assert(result->>'status'='published' AND (result->>'version')::int=1 AND (result->>'published_by')::uuid=(SELECT owner_actor FROM af) AND result->>'effective_from' IS NOT NULL AND result->>'effective_to' IS NULL,'publication did not record version, approver and effective time') FROM af_results WHERE label='pub1';
-- An unclassified legacy activity can be drafted but never published until its subject is classified.
INSERT INTO af_results SELECT 'legacy',public.save_operation_requirement_draft_review(act_legacy,'{"title":"Legacy duty","wording":"Do the legacy duty.","subject_kind":"facility","allowed_recorder_roles":["housekeeper"]}') FROM af;
SELECT pg_temp.a_expect($q$SELECT public.publish_operation_requirement_review((SELECT (result->>'id')::uuid FROM af_results WHERE label='legacy'),clock_timestamp())$q$,'subject classification is required');
SELECT pg_temp.a_denied($q$UPDATE public.operation_requirement_versions SET wording='forged' WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$);
SELECT pg_temp.a_denied($q$INSERT INTO public.operation_requirement_versions(organization_id,activity_id,version,created_by) SELECT org,act_fac,9,owner_actor FROM af$q$);
SELECT pg_temp.a_denied($q$DELETE FROM public.operation_requirement_versions WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$);
SELECT pg_temp.a_denied($q$UPDATE public.operation_facility_requirements SET applicability='applicable'$q$);
RESET ROLE;
SELECT pg_temp.a_expect($q$UPDATE public.operation_requirement_versions SET wording='rewritten history' WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$,'immutable');
SELECT pg_temp.a_expect($q$UPDATE public.operation_requirement_versions SET status='draft' WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$,'immutable');
SELECT pg_temp.a_expect($q$UPDATE public.operation_requirement_versions SET effective_to=now() WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$,'immutable');
SELECT pg_temp.a_expect($q$DELETE FROM public.operation_requirement_versions WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$,'immutable');
SELECT pg_temp.a_expect($q$TRUNCATE public.operation_requirement_versions CASCADE$q$,'cannot be truncated');
SELECT pg_temp.a_assert((SELECT count(*) FROM public.audit_log WHERE table_name='operation_requirement_versions' AND record_id=(SELECT id FROM af_ids WHERE label='v1'))>=2,'requirement publication was not audited');
-- The service identity has no direct write path either, even with the publication setting.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT set_config('haven.operation_requirement_publish','approved',true);
SELECT pg_temp.a_denied($q$UPDATE public.operation_requirement_versions SET effective_to=now() WHERE id=(SELECT id FROM af_ids WHERE label='v1')$q$);
SELECT pg_temp.a_denied($q$DELETE FROM public.operation_facility_requirements$q$);
SELECT pg_temp.a_denied($q$TRUNCATE public.operation_facility_requirements$q$);
SELECT pg_temp.a_denied($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{}')$q$);
SELECT pg_temp.a_denied($q$SELECT public.publish_operation_requirement_review((SELECT id FROM af_ids WHERE label='v1'),clock_timestamp())$q$);
SELECT set_config('haven.operation_requirement_publish','',true);
RESET ROLE;

-- Facility configuration: needs_confirmation stays an explicit, auditable state;
-- not applicable and local overrides need reasons; local rules only constrain.
SELECT pg_temp.a_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_requirement_versions WHERE activity_id=(SELECT act_fac FROM af))=1,'site admin cannot read the published central version');
INSERT INTO af_results SELECT 'fr1',public.save_operation_facility_requirement_draft_review(act_fac,site_a,'{}') FROM af;
SELECT pg_temp.a_assert(result->>'applicability'='needs_confirmation' AND result->>'schedule_status'='needs_confirmation' AND result->>'override_source'='central' AND (result->>'version')::int=1,'unknown values did not stay needs_confirmation') FROM af_results WHERE label='fr1';
INSERT INTO af_ids SELECT 'fr1',(result->>'id')::uuid FROM af_results WHERE label='fr1';
INSERT INTO af_results SELECT 'frpub1',public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM af_ids WHERE label='fr1';
SELECT pg_temp.a_assert(result->>'status'='published' AND result->>'applicability'='needs_confirmation' AND (result->>'approved_by')::uuid=(SELECT admin_a FROM af),'needs_confirmation configuration was not published as its own state') FROM af_results WHERE label='frpub1';
INSERT INTO af_results SELECT 'fr2',public.save_operation_facility_requirement_draft_review(act_fac,site_a,'{"applicability":"not_applicable"}') FROM af;
INSERT INTO af_ids SELECT 'fr2',(result->>'id')::uuid FROM af_results WHERE label='fr2';
SELECT pg_temp.a_expect($q$SELECT public.publish_operation_facility_requirement_review((SELECT id FROM af_ids WHERE label='fr2'),clock_timestamp()+interval '1 minute')$q$,'requires a reason');
INSERT INTO af_results SELECT 'fr2b',public.save_operation_facility_requirement_draft_review(act_fac,site_a,'{"applicability_reason":"No generator installed at this site per interview","override_source":"interview"}') FROM af;
INSERT INTO af_results SELECT 'frpub2',public.publish_operation_facility_requirement_review(id,clock_timestamp()+interval '1 minute') FROM af_ids WHERE label='fr2';
SELECT pg_temp.a_assert(result->>'status'='published' AND result->>'applicability'='not_applicable' AND (result->>'version')::int=2 AND result->>'override_source'='interview' AND (result->>'approved_by')::uuid=(SELECT admin_a FROM af),'not applicable with reason and source was not published') FROM af_results WHERE label='frpub2';
SELECT pg_temp.a_assert((SELECT status='published' AND effective_to IS NOT NULL AND applicability='needs_confirmation' FROM public.operation_facility_requirements WHERE id=(SELECT id FROM af_ids WHERE label='fr1')),'previous site configuration was not closed intact');
-- Local rules can only constrain the central rule.
SELECT pg_temp.a_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act_fac FROM af),(SELECT site_a FROM af),jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM af_ids WHERE label='v1'),'local_allowed_recorder_roles',jsonb_build_array('owner'),'override_source','facility_policy','applicability_reason','Only the owner records here'))$q$,'subset of the central roles');
SELECT pg_temp.a_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act_fac FROM af),(SELECT site_a FROM af),jsonb_build_object('requirement_version_id',(SELECT id FROM af_ids WHERE label='v1'),'local_required_evidence','[]'::jsonb,'override_source','facility_policy','applicability_reason','Drop the photo'))$q$,'keep every central evidence requirement');
SELECT pg_temp.a_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act_fac FROM af),(SELECT site_a FROM af),'{"approved_by":"00000000-0000-0000-0000-000000000000"}')$q$,'not editable');
INSERT INTO af_results SELECT 'fr3',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM af_ids WHERE label='v1'),'local_allowed_recorder_roles',jsonb_build_array('maintenance_role'),
 'local_required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always'),jsonb_build_object('kind','photo','label','Fuel gauge','min_count',1,'when','always')),
 'override_source','facility_policy','applicability_reason','Maintenance records the weekly run','owner_role','maintenance_role','backup_user_id',(SELECT admin_a FROM af))) FROM af;
INSERT INTO af_ids SELECT 'fr3',(result->>'id')::uuid FROM af_results WHERE label='fr3';
INSERT INTO af_results SELECT 'frprev3',public.preview_operation_facility_requirement_review(id,clock_timestamp()+interval '2 minutes') FROM af_ids WHERE label='fr3';
SELECT pg_temp.a_assert((result->>'publishable')::boolean AND result->>'latest_applicability'='not_applicable' AND result->>'proposed_applicability'='applicable','site preview did not show the applicability change') FROM af_results WHERE label='frprev3';
INSERT INTO af_results SELECT 'frpub3',public.publish_operation_facility_requirement_review(id,clock_timestamp()+interval '2 minutes') FROM af_ids WHERE label='fr3';
SELECT pg_temp.a_assert(result->>'status'='published' AND result->>'applicability'='applicable' AND (result->>'version')::int=3,'applicable configuration was not published') FROM af_results WHERE label='frpub3';
-- Schedule confirmation is independent, needs a rule to draft, and cannot be published yet.
SELECT pg_temp.a_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act_fac FROM af),(SELECT site_a FROM af),'{"schedule_status":"confirmed"}')$q$,'a confirmed schedule requires a rule');
INSERT INTO af_results SELECT 'fr4',public.save_operation_facility_requirement_draft_review(act_fac,site_a,'{"schedule_status":"confirmed","schedule_rule":{"kind":"weekly","weekday":"tuesday"}}') FROM af;
INSERT INTO af_ids SELECT 'fr4',(result->>'id')::uuid FROM af_results WHERE label='fr4';
SELECT pg_temp.a_assert(result->>'status'='draft' AND result->>'schedule_status'='confirmed' AND result->>'applicability'='applicable' AND (result->>'version')::int=4,'new site draft did not start from the latest configuration') FROM af_results WHERE label='fr4';
SELECT pg_temp.a_expect($q$SELECT public.publish_operation_facility_requirement_review((SELECT id FROM af_ids WHERE label='fr4'),clock_timestamp()+interval '3 minutes')$q$,'schedule confirmation is not available');
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_facility_requirements WHERE facility_id=(SELECT site_a FROM af) AND status='draft')=1,'site admin cannot see own site draft');
RESET ROLE;
SELECT pg_temp.a_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE status='published' AND schedule_status='confirmed'),'a schedule was confirmed by publication');
SELECT pg_temp.a_assert((SELECT count(*) FROM public.audit_log WHERE table_name='operation_facility_requirements' AND record_id=(SELECT id FROM af_ids WHERE label='fr2'))>=2,'site configuration publication was not audited');

-- Site B admin: no authority at site A, no visibility of site A, own site works, no central authority.
SELECT pg_temp.a_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.a_denied($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act_fac FROM af),(SELECT site_a FROM af),'{}')$q$);
SELECT pg_temp.a_denied($q$SELECT public.publish_operation_facility_requirement_review((SELECT id FROM af_ids WHERE label='fr4'),clock_timestamp())$q$);
SELECT pg_temp.a_denied($q$SELECT public.preview_operation_facility_requirement_review((SELECT id FROM af_ids WHERE label='fr4'),clock_timestamp())$q$);
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_facility_requirements WHERE facility_id=(SELECT site_a FROM af))=0,'site B admin can read site A configurations');
SELECT pg_temp.a_denied($q$SELECT public.save_operation_requirement_draft_review((SELECT act_fac FROM af),'{"title":"x"}')$q$);
INSERT INTO af_results SELECT 'frb',public.save_operation_facility_requirement_draft_review(act_fac,site_b,'{}') FROM af;
SELECT pg_temp.a_assert(result->>'applicability'='needs_confirmation' AND result->>'schedule_status'='needs_confirmation','site B draft did not default to needs_confirmation') FROM af_results WHERE label='frb';
RESET ROLE;

-- A second central version, effective tomorrow, preserves the snapshot already
-- governing an occurrence and does not govern anything until it is in force.
SELECT pg_temp.a_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO af_results SELECT 'draft2',public.save_operation_requirement_draft_review(act_fac,'{"wording":"Observe the weekly generator test run, record run minutes and fuel level."}') FROM af;
INSERT INTO af_ids SELECT 'v2',(result->>'id')::uuid FROM af_results WHERE label='draft2';
SELECT pg_temp.a_assert((result->>'version')::int=2 AND result->>'title'='Generator weekly observation' AND result->'allowed_recorder_roles' ? 'maintenance_role' AND result->>'status'='draft','new draft did not start from the latest published version') FROM af_results WHERE label='draft2';
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_requirement_versions WHERE activity_id=(SELECT act_fac FROM af) AND status='draft')=1,'owner cannot see the central draft');
RESET ROLE;
SELECT pg_temp.a_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_requirement_versions WHERE activity_id=(SELECT act_fac FROM af) AND status='draft')=0,'central draft leaked to a site admin');
RESET ROLE;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,assigned_to,requirement_version_id,facility_requirement_id)
 SELECT task_snap,org,site_a,subject_a,'facility','Snapshot duty','safety','on_demand',current_date+7,owner_actor,(SELECT id FROM af_ids WHERE label='v1'),(SELECT id FROM af_ids WHERE label='fr3') FROM af;
SELECT pg_temp.a_assert((SELECT activity_id=(SELECT act_fac FROM af) FROM public.operation_task_instances WHERE id=(SELECT task_snap FROM af)),'version-backed occurrence did not receive its activity identity');
SELECT pg_temp.a_expect($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,requirement_version_id) SELECT org,site_a,subject_a,'facility','Bad','safety','on_demand',current_date,(SELECT id FROM af_ids WHERE label='v2') FROM af$q$,'published version');
SELECT pg_temp.a_expect($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,requirement_version_id,facility_requirement_id) SELECT org,site_b,subject_a,'facility','Bad','safety','on_demand',current_date,(SELECT id FROM af_ids WHERE label='v1'),(SELECT id FROM af_ids WHERE label='fr3') FROM af$q$,'own activity and site');
SELECT pg_temp.a_expect($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,requirement_version_id,facility_requirement_id) SELECT org,site_a,subject_a,'facility','Bad','safety','on_demand',current_date-30,(SELECT id FROM af_ids WHERE label='v1'),(SELECT id FROM af_ids WHERE label='fr3') FROM af$q$,'in force on its date');
SELECT pg_temp.a_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO af_results SELECT 'preview2',public.preview_operation_requirement_review(id,clock_timestamp()+interval '1 day') FROM af_ids WHERE label='v2';
SELECT pg_temp.a_assert((result->>'publishable')::boolean AND (result->>'future_occurrences_keeping_latest_snapshot')::int=1 AND (result->'facility_configurations'->>'applicable')::int=1 AND (result->>'facility_role_conflicts')::int=0,'preview did not report retained snapshots and site configurations') FROM af_results WHERE label='preview2';
SELECT pg_temp.a_expect($q$SELECT public.publish_operation_requirement_review((SELECT id FROM af_ids WHERE label='v2'),clock_timestamp()-interval '3 days')$q$,'rewrite history');
INSERT INTO af_results SELECT 'pub2',public.publish_operation_requirement_review(id,clock_timestamp()+interval '1 day') FROM af_ids WHERE label='v2';
SELECT pg_temp.a_assert(result->>'status'='published' AND (result->>'version')::int=2 AND (result->>'previous_version_id')::uuid=(SELECT id FROM af_ids WHERE label='v1'),'second version not published with lineage') FROM af_results WHERE label='pub2';
-- Until tomorrow, v1 is still the version in force; v2 is scheduled.
SELECT pg_temp.a_assert((SELECT current_version=1 AND scheduled_version=2 FROM public.operation_activity_requirements WHERE activity_id=(SELECT act_fac FROM af)),'catalog view conflated published with in force');
RESET ROLE;
SELECT pg_temp.a_assert((SELECT status='published' AND effective_to IS NOT NULL AND wording='Observe the weekly generator test run and record run minutes.' FROM public.operation_requirement_versions WHERE id=(SELECT id FROM af_ids WHERE label='v1')),'closed version lost its wording or end time');
SELECT pg_temp.a_assert((SELECT requirement_version_id=(SELECT id FROM af_ids WHERE label='v1') AND facility_requirement_id=(SELECT id FROM af_ids WHERE label='fr3') FROM public.operation_task_instances WHERE id=(SELECT task_snap FROM af)),'occurrence snapshot was rewritten by publication');
SELECT pg_temp.a_expect($q$UPDATE public.operation_task_instances SET requirement_version_id=(SELECT id FROM af_ids WHERE label='v2') WHERE id=(SELECT task_snap FROM af)$q$,'snapshot is immutable');
-- A tomorrow occurrence must snapshot v2, and its site configuration must agree.
SELECT pg_temp.a_expect($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,requirement_version_id) SELECT org,site_a,subject_a,'facility','Bad','safety','on_demand',current_date+2,(SELECT id FROM af_ids WHERE label='v1') FROM af$q$,'in force on its date');
SELECT pg_temp.a_expect($q$INSERT INTO public.operation_task_instances(organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date,requirement_version_id,facility_requirement_id) SELECT org,site_a,subject_a,'facility','Bad','safety','on_demand',current_date+2,(SELECT id FROM af_ids WHERE label='v2'),(SELECT id FROM af_ids WHERE label='fr3') FROM af$q$,'must agree with its central version');
-- A site draft still claiming v1 for a time when v2 is in force is not publishable as applicable.
SELECT pg_temp.a_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO af_results SELECT 'prev4',public.preview_operation_facility_requirement_review(id,clock_timestamp()+interval '1 day') FROM af_ids WHERE label='fr4';
SELECT pg_temp.a_assert((result->>'publishable')::boolean=false AND result->'problems' ? 'applicable must reference the central version in force at the effective time' AND result->'problems' ? 'schedule confirmation is not available until the evaluator defines rule shapes','stale central reference previewed as publishable') FROM af_results WHERE label='prev4';
RESET ROLE;

-- Actual work stays recordable within current permissions, with or without a version.
SELECT pg_temp.a_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.a_assert((SELECT public.complete_operation_task_review(task_plain,owner_actor,'owner','Recorded under current permissions','{}') FROM af)='completed','recording blocked without a requirement version');
SELECT pg_temp.a_assert((SELECT public.complete_operation_task_review(task_snap,owner_actor,'owner','Recorded under a closed snapshot','{}') FROM af)='completed','recording blocked for an occurrence with a closed snapshot');
SELECT pg_temp.a_assert((SELECT count(*) FROM public.operation_activity_requirements WHERE activity_id=(SELECT act_fac FROM af) AND current_version=1 AND scheduled_version=2)=1,'catalog view did not expose in-force and scheduled versions to a session');
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000001') THEN
 IF (SELECT count(*) FROM public.operation_activity_requirements WHERE organization_id='00000000-0000-0000-0000-000000000001' AND source_disposition='needs_confirmation')=0 THEN RAISE EXCEPTION 'COL-135 needs_confirmation dispositions not exposed'; END IF;
 IF (SELECT count(*) FROM public.operation_activity_requirements WHERE organization_id='00000000-0000-0000-0000-000000000001' AND source_disposition='mapped')=0 THEN RAISE EXCEPTION 'COL-135 mapped dispositions not exposed'; END IF;
END IF; END $$;
SELECT 'COL-135 versioned applicability, evidence rules and local procedures PASS' AS result;
ROLLBACK;
