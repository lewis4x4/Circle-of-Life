-- Rollback-only HCOL-08 command, read, recovery and retention proof.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- Preserve the intended receipt boundary even under native fixture grants.
REVOKE SELECT ON public.referral_next_action_receipts FROM authenticated;
GRANT UPDATE ON public.referral_leads TO authenticated;
CREATE TEMP TABLE na_fixture AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() facility,gen_random_uuid() other_facility,gen_random_uuid() request_id;
INSERT INTO public.organizations(id,name) SELECT org,'Next action fixture' FROM na_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Next action fixture' FROM na_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity,org,'Action facility','Fixture','Fixture','00000',1 FROM na_fixture UNION ALL SELECT other_facility,entity,org,'Other action facility','Fixture','Fixture','00000',1 FROM na_fixture;
CREATE TEMP TABLE na_actors AS SELECT tag,gen_random_uuid() id,gen_random_uuid() session_id FROM unnest(ARRAY['actor','primary','backup','reader','outsider']) tag;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@next-action.invalid','{}','{}' FROM na_actors;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT a.id,f.org,a.id||'@next-action.invalid','Fixture '||a.tag,CASE a.tag WHEN 'actor' THEN 'owner' WHEN 'backup' THEN 'facility_admin' WHEN 'reader' THEN 'caregiver' ELSE 'nurse' END::public.app_role,true FROM na_actors a CROSS JOIN na_fixture f;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM na_actors WHERE tag<>'primary';
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT a.id,CASE WHEN a.tag='outsider' THEN f.other_facility ELSE f.facility END,f.org FROM na_actors a CROSS JOIN na_fixture f;
CREATE TEMP TABLE na_leads AS SELECT tag,gen_random_uuid() id FROM unnest(ARRAY['normal','rollback','other']) tag;
INSERT INTO public.referral_leads(id,organization_id,facility_id,first_name,last_name)
 SELECT l.id,f.org,CASE WHEN l.tag='other' THEN f.other_facility ELSE f.facility END,'Synthetic',l.tag FROM na_leads l CROSS JOIN na_fixture f;
GRANT SELECT ON na_fixture,na_actors,na_leads TO authenticated;
CREATE FUNCTION pg_temp.na_claim(p_tag text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session_id,'role','authenticated','auth_claim_version',p.auth_claim_version)::text,true)::void
 FROM na_actors a JOIN public.user_profiles p ON p.id=a.id WHERE a.tag=p_tag
$$;
CREATE FUNCTION pg_temp.na_terms() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action_text','Confirm transport plan','owner_id',(SELECT id FROM na_actors WHERE tag='primary'),
 'backup_id',(SELECT id FROM na_actors WHERE tag='backup'),'due_at',NULL,'waiting_condition','Awaiting family response','dependency_text','Transport availability') $$;
CREATE FUNCTION pg_temp.na_id() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.referral_next_actions WHERE lead_id=(SELECT id FROM na_leads WHERE tag='normal') AND status='open' $$;
CREATE FUNCTION pg_temp.na_command(p_command text,p_payload jsonb,p_version integer DEFAULT NULL,p_request uuid DEFAULT NULL,p_action uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.haven_command_referral_next_action(coalesce(p_request,gen_random_uuid()),(SELECT id FROM na_leads WHERE tag='normal'),CASE WHEN p_command='create' THEN NULL ELSE coalesce(p_action,pg_temp.na_id()) END,
 coalesce(p_version,CASE WHEN p_command='create' THEN 0 ELSE (SELECT version FROM public.referral_next_actions WHERE id=coalesce(p_action,pg_temp.na_id())) END),p_command,p_payload)
$$;
CREATE FUNCTION pg_temp.na_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',p_label; END IF; RAISE NOTICE 'PASS: %',p_label;
END $$;
CREATE FUNCTION pg_temp.na_reject(p_sql text,p_code text,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_code THEN RAISE EXCEPTION 'FAIL: % expected %, got %: %',p_label,p_code,SQLSTATE,SQLERRM; END IF;
  RAISE NOTICE 'PASS: %',p_label; RETURN;
 END; RAISE EXCEPTION 'FAIL: % did not reject',p_label;
END $$;
UPDATE public.user_profiles SET full_name='  ' WHERE id IN(SELECT id FROM na_actors WHERE tag IN('actor','primary','backup'));
SELECT pg_temp.na_claim('actor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('create',pg_temp.na_terms()||'{"waiting_condition":null}')$q$,'22023','Due date or waiting condition is required');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('create',pg_temp.na_terms()||'{"due_at":"tomorrow"}')$q$,'22023','No implicit due instant');
SELECT pg_temp.na_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(public.haven_list_referral_next_action_assignees((SELECT facility FROM na_fixture))->'items') x WHERE x->>'id'=(SELECT id::text FROM na_actors WHERE tag='primary')), 'Offline candidate without session is eligible');
SELECT pg_temp.na_command('create',pg_temp.na_terms(),0,(SELECT request_id FROM na_fixture));
SELECT pg_temp.na_assert((public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items'->0->>'owner_name')='User '||(SELECT left(id::text,8) FROM na_actors WHERE tag='primary')
 AND (public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items'->0->>'backup_name')='User '||(SELECT left(id::text,8) FROM na_actors WHERE tag='backup'),'Blank names use stable owner and backup identity');
SELECT pg_temp.na_assert((SELECT actor_name='User '||(SELECT left(id::text,8) FROM na_actors WHERE tag='actor') FROM public.referral_next_action_events WHERE lead_id=(SELECT id FROM na_leads WHERE tag='normal')),'Blank actor name remains identifiable in history');

SELECT pg_temp.na_assert((pg_temp.na_command('create',pg_temp.na_terms(),0,(SELECT request_id FROM na_fixture))->'action'->>'version')='1','Exact duplicate returns original result');
SELECT pg_temp.na_assert((SELECT count(*)=1 FROM public.referral_next_action_events WHERE lead_id=(SELECT id FROM na_leads WHERE tag='normal')), 'Duplicate creates one history event');
SELECT pg_temp.na_assert(public.haven_get_referral_next_action_receipt((SELECT request_id FROM na_fixture),(SELECT id FROM na_leads WHERE tag='normal')) IS NOT NULL,'Same actor recovers exact receipt');
SELECT pg_temp.na_assert(public.haven_get_referral_next_action_receipt(gen_random_uuid(),(SELECT id FROM na_leads WHERE tag='normal')) IS NULL,'Missing receipt is unconfirmed');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('create',pg_temp.na_terms()||'{"action_text":"Changed"}',0,(SELECT request_id FROM na_fixture))$q$,'22023','Changed request payload rejects');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('create',pg_temp.na_terms())$q$,'PT409','One open action per lead');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('acknowledge','{"acknowledgment_note":null}')$q$,'42501','Writer cannot acknowledge for owner');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('complete','{"completion_evidence":" "}')$q$,'22023','Completion evidence required');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('complete','{"completion_evidence":"Done"}',0)$q$,'PT409','Stale completion preserves work');
UPDATE public.referral_leads SET notes='Normal notes change',tour_scheduled_for=now(),status='converted' WHERE id=(SELECT id FROM na_leads WHERE tag='normal');
UPDATE public.referral_leads SET status='lost' WHERE id=(SELECT id FROM na_leads WHERE tag='normal');
SELECT pg_temp.na_assert((SELECT status='open' FROM public.referral_next_actions WHERE id=pg_temp.na_id()), 'Conversion and loss retain open work');
SELECT pg_temp.na_reject($q$UPDATE public.referral_leads SET status='merged' WHERE id=(SELECT id FROM na_leads WHERE tag='normal')$q$,'55000','Merge status blocked while work is open');
SELECT pg_temp.na_reject($q$UPDATE public.referral_leads SET deleted_at=now() WHERE id=(SELECT id FROM na_leads WHERE tag='normal')$q$,'55000','Soft delete blocked while open');
SELECT pg_temp.na_reject($q$UPDATE public.referral_leads SET facility_id=(SELECT other_facility FROM na_fixture) WHERE id=(SELECT id FROM na_leads WHERE tag='normal')$q$,'55000','Facility move blocked while open');
SELECT pg_temp.na_reject($q$UPDATE public.referral_next_actions SET action_text='Bypass' WHERE id=pg_temp.na_id()$q$,'42501','Direct table mutation denied');
RESET ROLE;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM na_actors WHERE tag='primary';
SELECT pg_temp.na_claim('primary');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert((pg_temp.na_command('acknowledge','{"acknowledgment_note":"Accepted"}')->'action'->>'owner_acknowledged')::boolean,'Owner explicitly acknowledges current terms');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('create',pg_temp.na_terms(),0,(SELECT request_id FROM na_fixture))$q$,'42501','Another actor cannot replay receipt');
SELECT pg_temp.na_assert(public.haven_get_referral_next_action_receipt((SELECT request_id FROM na_fixture),(SELECT id FROM na_leads WHERE tag='normal')) IS NULL,'Receipt lookup does not expose another actor result');
RESET ROLE;
SELECT pg_temp.na_claim('backup');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert((pg_temp.na_command('accept_backup','{"acceptance_note":null}')->'action'->>'backup_accepted')::boolean,'Backup explicitly accepts');
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT id FROM na_actors WHERE tag='primary');
SELECT pg_temp.na_claim('backup');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert((public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items'->0->>'backup_accepted')::boolean
 AND NOT (public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items'->0->>'owner_eligible')::boolean,'Accepted backup survives owner absence');
RESET ROLE;
UPDATE public.user_profiles SET is_active=true WHERE id=(SELECT id FROM na_actors WHERE tag='primary');
SELECT pg_temp.na_claim('actor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert(NOT (pg_temp.na_command('update',pg_temp.na_terms()||'{"action_text":"Confirm updated transport plan","change_note":"Family changed timing"}')->'action'->>'owner_acknowledged')::boolean,'Substantive update resets owner acceptance');
SELECT pg_temp.na_assert((SELECT backup_accepted_at IS NULL AND terms_version=2 FROM public.referral_next_actions WHERE id=pg_temp.na_id()), 'Substantive update resets backup acceptance');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('update',pg_temp.na_terms()||'{"change_note":"Stale"}',1)$q$,'PT409','Stale update preserves current terms');
SELECT pg_temp.na_assert(jsonb_array_length(public.haven_list_referral_next_action_events((SELECT id FROM na_leads WHERE tag='normal'),NULL,NULL,NULL,1)->'items')=1
 AND public.haven_list_referral_next_action_events((SELECT id FROM na_leads WHERE tag='normal'),NULL,NULL,NULL,1)->'next_cursor'<>'null'::jsonb,'History is cursor paginated');
RESET ROLE;
SELECT pg_temp.na_claim('reader');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert(jsonb_array_length(public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items')=1
 AND NOT (public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))->'items'->0->>'can_manage')::boolean,'Existing nonwriter lead audience can read without write permissions');
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('complete','{"completion_evidence":"Attempt"}')$q$,'42501','Nonwriter cannot complete');
RESET ROLE;
SELECT pg_temp.na_claim('outsider');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_reject($q$SELECT public.haven_list_referral_next_actions((SELECT facility FROM na_fixture))$q$,'42501','Cross facility list denied');
SELECT pg_temp.na_reject($q$SELECT public.haven_list_referral_next_action_events((SELECT id FROM na_leads WHERE tag='normal'))$q$,'42501','Cross facility history denied');
RESET ROLE;
-- Receiving merge targets must be in current scope before any target lock/action lookup.
CREATE TEMP TABLE na_foreign AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() facility,gen_random_uuid() lead;
INSERT INTO public.organizations(id,name) SELECT org,'Foreign action fixture' FROM na_foreign;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Foreign fixture' FROM na_foreign;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity,org,'Foreign facility','Fixture','Fixture','00000',1 FROM na_foreign;
INSERT INTO public.referral_leads(id,organization_id,facility_id,first_name,last_name) SELECT lead,org,facility,'Foreign','Lead' FROM na_foreign;
GRANT SELECT ON na_foreign TO authenticated;
SELECT pg_temp.na_claim('backup');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_reject($q$UPDATE public.referral_leads SET merged_into_lead_id=(SELECT id FROM na_leads WHERE tag='other') WHERE id=(SELECT id FROM na_leads WHERE tag='rollback')$q$,'42501','Inaccessible same-organization merge target denied');
SELECT pg_temp.na_reject($q$UPDATE public.referral_leads SET merged_into_lead_id=(SELECT lead FROM na_foreign) WHERE id=(SELECT id FROM na_leads WHERE tag='rollback')$q$,'42501','Foreign organization merge target denied');
RESET ROLE;
-- Receipt failure must roll back both state and appended event.
CREATE FUNCTION pg_temp.na_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt failure'; END $$;
CREATE TRIGGER zz_na_receipt_failure BEFORE INSERT ON public.referral_next_action_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.na_receipt_failure();
SELECT pg_temp.na_claim('actor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('complete','{"completion_evidence":"Receipt rollback"}')$q$,'P0001','Receipt failure rolls command back');
SELECT pg_temp.na_assert((SELECT status='open' AND version=4 FROM public.referral_next_actions WHERE id=pg_temp.na_id()), 'Receipt failure preserves original version');
RESET ROLE;
DROP TRIGGER zz_na_receipt_failure ON public.referral_next_action_receipts;
CREATE FUNCTION pg_temp.na_history_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure'; END $$;
CREATE TRIGGER zz_na_history_failure BEFORE INSERT ON public.referral_next_action_events FOR EACH ROW EXECUTE FUNCTION pg_temp.na_history_failure();
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_reject($q$SELECT pg_temp.na_command('complete','{"completion_evidence":"History rollback"}')$q$,'P0001','History failure rolls command back');
SELECT pg_temp.na_assert((SELECT status='open' AND version=4 FROM public.referral_next_actions WHERE id=pg_temp.na_id())
 AND (SELECT count(*)=4 FROM public.referral_next_action_events WHERE lead_id=(SELECT id FROM na_leads WHERE tag='normal')),'History failure preserves state and existing events');
RESET ROLE;
DROP TRIGGER zz_na_history_failure ON public.referral_next_action_events;

SELECT pg_temp.na_reject($q$DELETE FROM public.referral_leads WHERE id=(SELECT id FROM na_leads WHERE tag='normal')$q$,'55000','Hard delete blocked with open work');
SET LOCAL ROLE authenticated;
SELECT pg_temp.na_assert((pg_temp.na_command('supersede',jsonb_build_object('replacement',pg_temp.na_terms(),'supersede_evidence','New transport task replaces earlier plan'))->'previous_action'->>'status')='superseded','Supersede retains old action and creates replacement');
SELECT pg_temp.na_assert((pg_temp.na_command('complete','{"completion_evidence":"Reviewed transport confirmation"}')->'action'->>'completed_by')=(SELECT id::text FROM na_actors WHERE tag='actor'),'Existing writer may complete with evidence without owner acknowledgment');
RESET ROLE;
SELECT pg_temp.na_reject($q$DELETE FROM public.referral_next_action_events WHERE lead_id=(SELECT id FROM na_leads WHERE tag='normal')$q$,'42501','History immutable even for database owner');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.na_reject($q$TRUNCATE public.referral_next_action_receipts CASCADE$q$,'42501','Receipt truncation denied');
SELECT pg_temp.na_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.haven_command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb)'::regprocedure),'Public command is invoker');
SELECT pg_temp.na_assert(NOT has_function_privilege('anon','public.haven_command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.haven_command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb)','EXECUTE'),'No anonymous or service command grant');
ROLLBACK;
