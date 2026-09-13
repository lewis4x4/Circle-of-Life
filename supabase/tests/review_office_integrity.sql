BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE office_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() reader,gen_random_uuid() reader_session,gen_random_uuid() manager,gen_random_uuid() manager_session,gen_random_uuid() outsider,gen_random_uuid() outsider_session,gen_random_uuid() meeting,gen_random_uuid() action,gen_random_uuid() failure_action,
 gen_random_uuid() team,gen_random_uuid() page,gen_random_uuid() file,gen_random_uuid() document,gen_random_uuid() requirement,
 f.id facility,f.organization_id org FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),jsonb_build_object('full_name','Review office') FROM office_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT reader,reader||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','caregiver'),jsonb_build_object('full_name','Review reader') FROM office_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Review office','owner',org,true FROM office_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT reader,reader||'@review.invalid','Review reader','caregiver',org,true FROM office_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT manager,manager||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),jsonb_build_object('full_name','Review manager') FROM office_fixture
 UNION ALL SELECT outsider,outsider||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),jsonb_build_object('full_name','Unscoped manager') FROM office_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT manager,manager||'@review.invalid','Review manager','manager'::public.app_role,org,true FROM office_fixture
 UNION ALL SELECT outsider,outsider||'@review.invalid','Unscoped manager','manager'::public.app_role,org,true FROM office_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT manager,facility,org FROM office_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT reader,facility,org FROM office_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM office_fixture;
INSERT INTO auth.sessions(id,user_id)
SELECT actor_session,actor FROM office_fixture
UNION ALL SELECT reader_session,reader FROM office_fixture
UNION ALL SELECT manager_session,manager FROM office_fixture
UNION ALL SELECT outsider_session,outsider FROM office_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM office_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.meetings(id,organization_id,facility_id,title,scheduled_at,created_by) SELECT meeting,org,facility,'Review meeting',now(),actor FROM office_fixture;
INSERT INTO public.workspace_pages(id,organization_id,owner_user_id,title,body) SELECT page,org,actor,'Original page','Original body' FROM office_fixture;
INSERT INTO public.workspace_files(id,organization_id,owner_user_id,name,original_filename,storage_path) SELECT file,org,actor,'Review file','review.txt',actor||'/'||file||'/review.txt' FROM office_fixture;

-- Model the deployed service role, while the actor remains an authenticated scoped manager.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public,auth,haven TO service_role;
GRANT SELECT ON public.user_profiles,public.facilities,public.user_facility_access TO service_role;
GRANT SELECT,UPDATE ON public.meetings TO service_role;
GRANT SELECT,INSERT ON public.operation_task_instances,public.meeting_action_items TO service_role;
GRANT SELECT ON office_fixture TO service_role;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.manager,'session_id',f.manager_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','manager','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','manager','organization_id',f.org))::text,true)
FROM office_fixture f JOIN public.user_profiles p ON p.id=f.manager;
SET LOCAL ROLE service_role;
DO $$ DECLARE f record; created_action uuid:=gen_random_uuid(); BEGIN SELECT * INTO f FROM office_fixture;
 -- COL-133 closes the unclassified legacy constructor, including service callers.
 BEGIN PERFORM public.create_meeting_action(created_action,f.meeting,'Unclassified manager action',f.manager,current_date,f.manager); RAISE EXCEPTION 'Unclassified service creation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.meeting_action_items WHERE id=created_action) OR EXISTS(SELECT 1 FROM public.operation_task_instances WHERE id=created_action) THEN RAISE EXCEPTION 'Denied creation left an orphan'; END IF;
 BEGIN PERFORM public.create_meeting_action(gen_random_uuid(),f.meeting,'Unauthorized manager',NULL,current_date,f.outsider); RAISE EXCEPTION 'Unscoped actor created task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.create_meeting_action(gen_random_uuid(),f.meeting,'Unauthorized role',NULL,current_date,f.reader); RAISE EXCEPTION 'Caregiver authored manager task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF has_function_privilege('authenticated','public.create_meeting_action(uuid,uuid,text,uuid,date,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Browser may forge meeting action actor'; END IF; END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM office_fixture f JOIN public.user_profiles p ON p.id=f.actor;

-- Trusted synthetic arrangement only: classify two facility tasks explicitly.
-- No guard is disabled and no revoked constructor is invoked with elevated grants.
-- These fixtures exercise the current authenticated completion command and its
-- meeting synchronization; they do not claim new meeting-action creation works.
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind)
 SELECT org,facility,'facility' FROM office_fixture ON CONFLICT DO NOTHING;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,
 template_name,template_category,template_cadence_type,assigned_shift_date,assigned_to,due_at)
 SELECT f.action,f.org,f.facility,s.id,'facility','Review action','meeting_action','event_driven',
 '2026-09-06'::date,f.actor,'2026-09-07 03:59:59Z'::timestamptz FROM office_fixture f
 JOIN public.operation_activity_subjects s ON s.organization_id=f.org AND s.facility_id=f.facility AND s.subject_kind='facility'
 UNION ALL
 SELECT f.failure_action,f.org,f.facility,s.id,'facility','Rollback action','meeting_action','event_driven',
 current_date,f.actor,now() FROM office_fixture f
 JOIN public.operation_activity_subjects s ON s.organization_id=f.org AND s.facility_id=f.facility AND s.subject_kind='facility';
INSERT INTO public.meeting_action_items(id,organization_id,facility_id,meeting_id,description,assigned_to,due_date,oce_task_instance_id,created_by,updated_by)
 SELECT action,org,facility,meeting,'Review action',actor,'2026-09-06'::date,action,actor,actor FROM office_fixture
 UNION ALL SELECT failure_action,org,facility,meeting,'Rollback action',actor,current_date,failure_action,actor,actor FROM office_fixture;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON office_fixture TO authenticated;
GRANT SELECT,UPDATE ON public.meeting_action_items TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; completed_at timestamptz; BEGIN SELECT * INTO f FROM office_fixture;
 IF public.complete_operation_task_review(f.action,f.actor,'owner','Reviewed facility work','{}')<>'completed' THEN RAISE EXCEPTION 'Authorized task completion failed'; END IF;
 SELECT i.completed_at INTO completed_at FROM public.operation_task_instances i WHERE id=f.action;
 IF public.complete_operation_task_review(f.action,f.actor,'owner','Reviewed facility work','{}')<>'completed' THEN RAISE EXCEPTION 'Authorized task replay failed'; END IF;
 IF (SELECT count(*) FROM public.meeting_action_items WHERE id=f.action)<>1
 OR (SELECT count(*) FROM public.operation_audit_log WHERE task_instance_id=f.action AND event_type='completed')<>1
 OR (SELECT i.completed_at FROM public.operation_task_instances i WHERE id=f.action) IS DISTINCT FROM completed_at
 OR (SELECT due_at FROM public.operation_task_instances WHERE id=f.action)<>'2026-09-07 03:59:59Z'::timestamptz THEN RAISE EXCEPTION 'Completion replay changed identity, audit, or existing deadline'; END IF;
 IF (SELECT status FROM public.meeting_action_items WHERE id=f.action)<>'completed' THEN RAISE EXCEPTION 'OCE completion did not reach meeting'; END IF;
 BEGIN UPDATE public.meeting_action_items SET status='open' WHERE id=f.action; RAISE EXCEPTION 'Minutes reopened completed task'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT status FROM public.operation_task_instances WHERE id=f.action)<>'completed'
 OR (SELECT status FROM public.meeting_action_items WHERE id=f.action)<>'completed'
 OR (SELECT i.completed_at FROM public.operation_task_instances i WHERE id=f.action) IS DISTINCT FROM completed_at THEN RAISE EXCEPTION 'Denied meeting change erased performance history'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM office_fixture;
 PERFORM public.save_workspace_page(f.page,1,'Saved title','Saved body');
 BEGIN PERFORM public.save_workspace_page(f.page,1,'Stale title','Stale body'); RAISE EXCEPTION 'Stale workspace save accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Page changed. Preserve your draft and reload before merging changes' THEN RAISE; END IF; END;
 IF (SELECT version FROM public.workspace_pages WHERE id=f.page)<>2 OR (SELECT count(*) FROM public.workspace_page_versions WHERE page_id=f.page)<>1 OR (SELECT body FROM public.workspace_pages WHERE id=f.page)<>'Saved body' THEN RAISE EXCEPTION 'Workspace version/page divergence'; END IF;
 PERFORM public.create_team_with_lead(f.team,'Review team','Review description');
 PERFORM public.create_team_with_lead(f.team,'Review team','Review description');
 IF (SELECT count(*) FROM public.team_space_members WHERE team_space_id=f.team AND user_id=f.actor AND space_role='lead')<>1 THEN RAISE EXCEPTION 'Team lead absent or duplicated'; END IF;
END $$;

CREATE FUNCTION pg_temp.office_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected office failure'; END $$;
CREATE TRIGGER office_item_fail BEFORE UPDATE ON public.meeting_action_items FOR EACH ROW EXECUTE FUNCTION pg_temp.office_fail();
CREATE TRIGGER office_lead_fail BEFORE INSERT ON public.team_space_members FOR EACH ROW EXECUTE FUNCTION pg_temp.office_fail();
CREATE TRIGGER office_page_fail BEFORE UPDATE ON public.workspace_pages FOR EACH ROW EXECUTE FUNCTION pg_temp.office_fail();
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM office_fixture;
 BEGIN PERFORM public.complete_operation_task_review(f.failure_action,f.actor,'owner','Injected completion failure','{}'); RAISE EXCEPTION 'Expected task/meeting synchronization failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected office failure' THEN RAISE; END IF; END;
 IF (SELECT status FROM public.operation_task_instances WHERE id=f.failure_action)<>'pending'
 OR (SELECT signed_by FROM public.operation_task_instances WHERE id=f.failure_action) IS NOT NULL
 OR (SELECT status FROM public.meeting_action_items WHERE id=f.failure_action)<>'open'
 OR EXISTS(SELECT 1 FROM public.operation_audit_log WHERE task_instance_id=f.failure_action AND event_type='completed') THEN RAISE EXCEPTION 'Task or audit survived failed meeting synchronization'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f record; team_id uuid:=gen_random_uuid(); BEGIN SELECT * INTO f FROM office_fixture;
 BEGIN PERFORM public.create_team_with_lead(team_id,'Failure team',NULL); RAISE EXCEPTION 'Expected lead failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected office failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.team_spaces WHERE id=team_id) THEN RAISE EXCEPTION 'Orphan team survived'; END IF;
 BEGIN PERFORM public.save_workspace_page(f.page,2,'Failure title','Failure body'); RAISE EXCEPTION 'Expected version failure'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected office failure' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.workspace_page_versions WHERE page_id=f.page AND version=3) THEN RAISE EXCEPTION 'Orphan version survived'; END IF;
END $$;
DROP TRIGGER office_item_fail ON public.meeting_action_items;
DROP TRIGGER office_lead_fail ON public.team_space_members;
DROP TRIGGER office_page_fail ON public.workspace_pages;

INSERT INTO public.documents(id,workspace_id,title,raw_text,status) SELECT document,org,'Issued policy','Issued version','published' FROM office_fixture;
INSERT INTO public.document_acknowledgment_requirements(id,organization_id,facility_id,document_id,document_title,required_roles,require_signature,created_by)
 SELECT requirement,org,facility,document,'Issued policy',ARRAY['owner','caregiver'],true,actor FROM office_fixture;
UPDATE public.documents SET raw_text='Later policy edit' WHERE id=(SELECT document FROM office_fixture);
INSERT INTO public.document_acknowledgments(organization_id,facility_id,requirement_id,document_id,user_id,signature_name,signer_role,created_by)
 SELECT org,facility,requirement,document,actor,'Review signer','owner',actor FROM office_fixture;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM office_fixture;
 IF (SELECT document_content_snapshot FROM public.document_acknowledgment_requirements WHERE id=f.requirement)<>'Issued version' OR (SELECT document_version_hash FROM public.document_acknowledgments WHERE requirement_id=f.requirement) IS DISTINCT FROM (SELECT document_version_hash FROM public.document_acknowledgment_requirements WHERE id=f.requirement) THEN RAISE EXCEPTION 'Signature lost issued version'; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON office_fixture TO authenticated;
GRANT SELECT,UPDATE ON public.workspace_files TO authenticated;
GRANT SELECT ON public.workspace_breakglass_grants TO authenticated;
SET LOCAL ROLE authenticated;
UPDATE public.workspace_files SET deleted_at=now() WHERE id=(SELECT file FROM office_fixture);
UPDATE public.workspace_files SET deleted_at=NULL WHERE id=(SELECT file FROM office_fixture);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.workspace_files WHERE id=(SELECT file FROM office_fixture) AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Owner could not restore trash'; END IF; END $$;
RESET ROLE;
GRANT SELECT ON public.document_acknowledgment_requirements TO authenticated;
GRANT SELECT,INSERT ON public.document_acknowledgments TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.reader,'session_id',f.reader_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','caregiver','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','caregiver','organization_id',f.org))::text,true)
FROM office_fixture f JOIN public.user_profiles p ON p.id=f.reader;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.document_acknowledgment_requirements WHERE id=(SELECT requirement FROM office_fixture) AND document_content_snapshot='Issued version') THEN RAISE EXCEPTION 'Floor reader cannot reach issued content'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_files WHERE id=(SELECT file FROM office_fixture)) THEN RAISE EXCEPTION 'Reader accessed another owner file'; END IF;
END $$;
INSERT INTO public.document_acknowledgments(organization_id,facility_id,requirement_id,document_id,user_id,signature_name,signer_role,created_by)
 SELECT org,facility,requirement,document,reader,'Review reader','owner',reader FROM office_fixture;
DO $$ BEGIN
 IF (SELECT signer_role FROM public.document_acknowledgments WHERE user_id=(SELECT reader FROM office_fixture))<>'caregiver' THEN RAISE EXCEPTION 'Caller forged signer role'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
