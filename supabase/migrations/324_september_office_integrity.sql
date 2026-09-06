-- Office review: retain one task identity and atomic state/history writes.
DROP FUNCTION IF EXISTS public.create_meeting_action(uuid,uuid,text,uuid,date);
CREATE OR REPLACE FUNCTION public.create_meeting_action(p_id uuid,p_meeting_id uuid,p_description text,p_assigned_to uuid,p_due_date date,p_actor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor public.user_profiles%ROWTYPE; v_meeting public.meetings%ROWTYPE; v_existing public.meeting_action_items%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_id IS NULL OR p_due_date IS NULL OR length(trim(coalesce(p_description,'')))=0 THEN RAISE EXCEPTION 'Actor, description and due date required'; END IF;
  SELECT * INTO v_meeting FROM public.meetings WHERE id=p_meeting_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meeting unavailable'; END IF;
  SELECT * INTO v_actor FROM public.user_profiles WHERE id=p_actor_id AND is_active AND deleted_at IS NULL;
  IF NOT FOUND OR v_actor.organization_id<>v_meeting.organization_id OR coalesce(v_actor.app_role::text,'') NOT IN('owner','org_admin','facility_admin','manager','coordinator','nurse') THEN RAISE EXCEPTION 'Meeting action author is not authorized' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=v_meeting.facility_id AND organization_id=v_actor.organization_id AND deleted_at IS NULL) OR (v_actor.app_role NOT IN('owner','org_admin') AND NOT EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=p_actor_id AND facility_id=v_meeting.facility_id AND organization_id=v_actor.organization_id AND revoked_at IS NULL)) THEN RAISE EXCEPTION 'Meeting facility access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_existing FROM public.meeting_action_items WHERE id=p_id;
  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM p_actor_id OR v_existing.meeting_id<>p_meeting_id OR v_existing.description<>trim(p_description) OR v_existing.assigned_to IS DISTINCT FROM p_assigned_to OR v_existing.due_date<>p_due_date THEN RAISE EXCEPTION 'Action identity already saved with different values'; END IF;
    RETURN p_id;
  END IF;
  IF p_assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_facility_access a JOIN public.user_profiles p ON p.id=a.user_id WHERE a.user_id=p_assigned_to AND a.facility_id=v_meeting.facility_id AND a.revoked_at IS NULL AND p.organization_id=v_meeting.organization_id AND p.is_active AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'Assignee unavailable in meeting facility'; END IF;
  INSERT INTO public.operation_task_instances(id,organization_id,facility_id,template_name,template_category,template_cadence_type,priority,assigned_shift_date,assigned_to,assigned_by,assigned_at,status,due_at,created_by)
    VALUES(p_id,v_meeting.organization_id,v_meeting.facility_id,'Meeting action: '||left(trim(p_description),160),'meeting_action','event_driven','normal',p_due_date,p_assigned_to,p_actor_id,now(),'pending',(p_due_date+time '23:59:59') AT TIME ZONE 'America/New_York',p_actor_id);
  INSERT INTO public.meeting_action_items(id,organization_id,facility_id,meeting_id,description,assigned_to,due_date,oce_task_instance_id,created_by,updated_by)
    VALUES(p_id,v_meeting.organization_id,v_meeting.facility_id,p_meeting_id,trim(p_description),p_assigned_to,p_due_date,p_id,p_actor_id,p_actor_id);
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.create_meeting_action(uuid,uuid,text,uuid,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_meeting_action(uuid,uuid,text,uuid,date,uuid) TO service_role;
GRANT SELECT,UPDATE ON public.meetings TO service_role;
GRANT SELECT,INSERT ON public.meeting_action_items TO service_role;

-- A task assignee may complete OCE without permission to edit meeting minutes.
-- Private, trigger-only definer synchronizes only the same-org/facility linked row.
CREATE OR REPLACE FUNCTION haven.sync_meeting_action_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='operation_task_instances' THEN
    UPDATE public.meeting_action_items SET status=CASE WHEN NEW.status='completed' THEN 'completed' WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END,
      updated_by=coalesce(NEW.updated_by,NEW.assigned_to)
      WHERE oce_task_instance_id=NEW.id AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND deleted_at IS NULL;
  ELSE
    UPDATE public.operation_task_instances SET status=CASE WHEN NEW.status='completed' THEN 'completed' WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'pending' END,
      completed_at=CASE WHEN NEW.status='completed' THEN now() ELSE NULL END,updated_by=NEW.updated_by
      WHERE id=NEW.oce_task_instance_id AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.sync_meeting_action_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_meeting_from_task AFTER UPDATE OF status ON public.operation_task_instances FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION haven.sync_meeting_action_status();
CREATE TRIGGER sync_task_from_meeting AFTER UPDATE OF status ON public.meeting_action_items FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION haven.sync_meeting_action_status();

CREATE OR REPLACE FUNCTION public.save_workspace_page(p_id uuid,p_expected_version integer,p_title text,p_body text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_page public.workspace_pages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO v_page FROM public.workspace_pages WHERE id=p_id AND owner_user_id=auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned page unavailable'; END IF;
  IF v_page.version<>p_expected_version THEN RAISE EXCEPTION 'Page changed. Preserve your draft and reload before merging changes'; END IF;
  INSERT INTO public.workspace_page_versions(organization_id,page_id,owner_user_id,version,title,body,created_by)
    VALUES(v_page.organization_id,p_id,auth.uid(),p_expected_version+1,coalesce(nullif(trim(p_title),''),'Untitled'),coalesce(p_body,''),auth.uid());
  UPDATE public.workspace_pages SET title=coalesce(nullif(trim(p_title),''),'Untitled'),body=coalesce(p_body,''),version=p_expected_version+1,updated_by=auth.uid() WHERE id=p_id;
  RETURN p_expected_version+1;
END $$;
REVOKE ALL ON FUNCTION public.save_workspace_page(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_workspace_page(uuid,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_team_with_lead(p_id uuid,p_name text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_team public.team_spaces%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_id IS NULL OR length(trim(coalesce(p_name,'')))=0 THEN RAISE EXCEPTION 'Team name and authenticated actor required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO v_team FROM public.team_spaces WHERE id=p_id;
  IF FOUND THEN
    IF v_team.created_by<>auth.uid() OR v_team.name<>trim(p_name) OR v_team.description IS DISTINCT FROM p_description THEN RAISE EXCEPTION 'Team identity already used'; END IF;
    RETURN p_id;
  END IF;
  INSERT INTO public.team_spaces(id,organization_id,name,description,created_by,updated_by) VALUES(p_id,haven.organization_id(),trim(p_name),p_description,auth.uid(),auth.uid());
  INSERT INTO public.team_space_members(organization_id,team_space_id,user_id,space_role,created_by) VALUES(haven.organization_id(),p_id,auth.uid(),'lead',auth.uid());
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.create_team_with_lead(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_team_with_lead(uuid,text,text) TO authenticated;

-- Trash keeps private bytes and exposes deleted metadata only to its owner.
CREATE POLICY "Owners see their own trashed workspace files" ON public.workspace_files FOR SELECT TO authenticated
 USING(organization_id=haven.organization_id() AND owner_user_id=auth.uid() AND deleted_at IS NOT NULL);

-- O04: one immutable issued document version and signature contract for all roles.
ALTER TABLE public.document_acknowledgment_requirements ADD COLUMN document_version_hash text, ADD COLUMN document_content_snapshot text;
ALTER TABLE public.document_acknowledgments ADD COLUMN document_version_hash text;
CREATE OR REPLACE FUNCTION public.haven_snapshot_acknowledgment_requirement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_document public.documents%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.required_roles IS DISTINCT FROM OLD.required_roles OR NEW.facility_id IS DISTINCT FROM OLD.facility_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.document_version_hash IS DISTINCT FROM OLD.document_version_hash OR NEW.document_content_snapshot IS DISTINCT FROM OLD.document_content_snapshot THEN RAISE EXCEPTION 'Issue a new requirement for a new document version'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_document FROM public.documents WHERE id=NEW.document_id AND workspace_id=NEW.organization_id AND status='published' AND deleted_at IS NULL;
  IF NOT FOUND OR length(trim(coalesce(v_document.raw_text,'')))=0 THEN RAISE EXCEPTION 'Published readable document required'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(NEW.required_roles) AS required_role WHERE NOT public.document_role_can_view_audience(v_document.audience,required_role)) THEN RAISE EXCEPTION 'Document audience does not allow every required role'; END IF;
  NEW.document_title:=v_document.title;
  NEW.document_content_snapshot:=v_document.raw_text;
  NEW.document_version_hash:=md5(v_document.id::text||':'||v_document.updated_at::text||':'||v_document.raw_text);
  RETURN NEW;
END $$;
CREATE TRIGGER snapshot_acknowledgment_requirement BEFORE INSERT OR UPDATE ON public.document_acknowledgment_requirements FOR EACH ROW EXECUTE FUNCTION public.haven_snapshot_acknowledgment_requirement();
CREATE OR REPLACE FUNCTION public.haven_validate_document_acknowledgment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_requirement public.document_acknowledgment_requirements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id<>auth.uid() THEN RAISE EXCEPTION 'Sign only for yourself'; END IF;
  SELECT * INTO v_requirement FROM public.document_acknowledgment_requirements WHERE id=NEW.requirement_id AND is_active AND deleted_at IS NULL;
  IF NOT FOUND OR v_requirement.organization_id<>NEW.organization_id OR v_requirement.facility_id<>NEW.facility_id OR NOT(haven.app_role()::text=ANY(v_requirement.required_roles)) THEN RAISE EXCEPTION 'Requirement does not apply to this user and facility'; END IF;
  IF v_requirement.document_version_hash IS NULL THEN RAISE EXCEPTION 'This requirement needs a published content snapshot. Ask an administrator to reissue it'; END IF;
  IF v_requirement.require_signature AND length(trim(coalesce(NEW.signature_name,'')))<3 THEN RAISE EXCEPTION 'Typed signature required'; END IF;
  NEW.document_id:=v_requirement.document_id; NEW.document_version_hash:=v_requirement.document_version_hash;
  NEW.signer_role:=haven.app_role()::text; NEW.acknowledged_at:=now(); NEW.created_by:=auth.uid(); NEW.updated_by:=auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER validate_document_acknowledgment BEFORE INSERT ON public.document_acknowledgments FOR EACH ROW EXECUTE FUNCTION public.haven_validate_document_acknowledgment();

DROP POLICY "Staff see acknowledgment requirements in accessible facilities" ON public.document_acknowledgment_requirements;
CREATE POLICY "Staff see acknowledgment requirements in accessible facilities" ON public.document_acknowledgment_requirements FOR SELECT TO authenticated
 USING(organization_id=haven.organization_id() AND deleted_at IS NULL AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (haven.app_role()::text=ANY(required_roles) OR haven.app_role() IN('owner','org_admin','facility_admin','manager','coordinator')));
