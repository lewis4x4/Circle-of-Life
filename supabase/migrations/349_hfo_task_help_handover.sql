BEGIN;
-- COL-153: supplemental guidance and explicit local duty handovers. No rule,
-- schedule, recorded performance, issue owner or historic recorder is changed.
CREATE TABLE public.operation_help_handover_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), activity_id uuid NOT NULL,
 command text NOT NULL CHECK(command IN('help','propose','accept')), duty_scope text NOT NULL DEFAULT '',
 payload jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 request_key text NOT NULL, request_hash text NOT NULL, previous_id uuid REFERENCES public.operation_help_handover_events(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 UNIQUE(activity_id,facility_id,actor_id,request_key)
);
CREATE INDEX operation_help_handover_scope_history ON public.operation_help_handover_events(activity_id,facility_id,duty_scope,created_at,id);
ALTER TABLE public.operation_help_handover_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_help_handover_read ON public.operation_help_handover_events FOR SELECT TO authenticated USING (
 organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id)
 AND haven.app_role()::text IN('housekeeper','owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role'));
REVOKE ALL ON public.operation_help_handover_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_help_handover_events TO authenticated;
CREATE FUNCTION haven.guard_operation_help_handover_event() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP<>'INSERT' OR current_setting('haven.operation_occurrence_command',true) IS DISTINCT FROM haven.operation_occurrence_token() THEN
 RAISE EXCEPTION 'Help and duty history is immutable' USING ERRCODE='42501'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_operation_help_handover_event BEFORE INSERT OR UPDATE OR DELETE ON public.operation_help_handover_events FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_help_handover_event();
CREATE TRIGGER guard_operation_help_handover_truncate BEFORE TRUNCATE ON public.operation_help_handover_events FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_help_handover_event();
REVOKE ALL ON FUNCTION haven.guard_operation_help_handover_event() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.lock_operation_help_handover(p_activity uuid,p_facility uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE org uuid; BEGIN
 -- Serialize the scope before checking current authority, including first writes.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_activity::text||':'||p_facility::text,153));
 SELECT organization_id INTO org FROM public.operation_activities WHERE id=p_activity AND (facility_id IS NULL OR facility_id=p_facility) AND (origin='admin_log' OR (subject_kind='facility' AND facility_id=p_facility AND EXISTS(SELECT 1 FROM public.operation_task_templates t WHERE t.activity_id=p_activity AND t.deleted_at IS NULL AND haven.operation_template_links_accessible(t.organization_id,t.facility_id,t.linked_document_id,t.asset_ref,t.vendor_booking_ref)))) FOR SHARE;
 PERFORM haven.lock_operation_recorder(org,p_facility);
 IF org IS NULL OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=org AND deleted_at IS NULL)
 OR haven.app_role()::text NOT IN('housekeeper','owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role') THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF; RETURN org;
END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_help_handover(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.write_operation_help_handover(p_activity_id uuid,p_facility_id uuid,p_command text,p_request_key text,p_expected_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; scope text:=''; hash text; e public.operation_help_handover_events; latest public.operation_help_handover_events; proposal public.operation_help_handover_events; k text; person uuid; backup uuid; role_name text; doc uuid; supplied_refs boolean:=coalesce(p_payload ? 'protected_document_ids',false);
BEGIN
 org:=haven.lock_operation_help_handover(p_activity_id,p_facility_id);
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_command IS NULL OR p_command NOT IN('help','propose','accept') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
 hash:=haven.operation_issue_request_hash(jsonb_build_object('command',p_command,'payload',p_payload));
 IF p_command<>'accept' AND haven.app_role()::text NOT IN('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_payload) LOOP
 IF (p_command='help' AND k NOT IN('how_to','examples','contact','protected_document_ids')) OR (p_command='propose' AND k NOT IN('duty_scope','owner_user_id','backup_user_id','effective_at','note')) OR (p_command='accept' AND k NOT IN('proposal_id','duty_role')) THEN RAISE EXCEPTION 'Invalid command field' USING ERRCODE='22023'; END IF; END LOOP;
 IF p_command='help' THEN
  IF NOT (p_payload ? 'protected_document_ids') THEN SELECT coalesce(payload->'protected_document_ids','[]'::jsonb) INTO latest.payload FROM public.operation_help_handover_events WHERE activity_id=p_activity_id AND facility_id=p_facility_id AND command='help' ORDER BY created_at DESC,id DESC LIMIT 1; p_payload:=p_payload||jsonb_build_object('protected_document_ids',coalesce(latest.payload,'[]'::jsonb)); END IF;
  IF haven.operation_issue_text(p_payload,'how_to',8000) IS NULL THEN RAISE EXCEPTION 'How-to is required' USING ERRCODE='22023'; END IF;
  PERFORM haven.operation_issue_text(p_payload,'examples',4000); PERFORM haven.operation_issue_text(p_payload,'contact',1000);
  IF jsonb_typeof(p_payload->'protected_document_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'protected_document_ids')>20 THEN RAISE EXCEPTION 'Invalid references' USING ERRCODE='22023'; END IF;
  FOR doc IN SELECT value::text::uuid FROM jsonb_array_elements_text(p_payload->'protected_document_ids') WHERE supplied_refs LOOP
   PERFORM 1 FROM public.facility_documents WHERE id=doc AND organization_id=org AND facility_id=p_facility_id AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Reference unavailable' USING ERRCODE='22023'; END IF;
  END LOOP;
 ELSIF p_command='propose' THEN
  scope:=haven.operation_issue_text(p_payload,'duty_scope',500); person:=haven.operation_issue_uuid(p_payload,'owner_user_id'); backup:=haven.operation_issue_uuid(p_payload,'backup_user_id');
  IF scope IS NULL OR person IS NULL OR p_payload->>'effective_at' IS NULL OR NOT isfinite((p_payload->>'effective_at')::timestamptz) OR haven.operation_issue_text(p_payload,'note',2000) IS NULL OR person=backup THEN RAISE EXCEPTION 'Duty, distinct recipients, effective time and handover note required' USING ERRCODE='22023'; END IF;
 ELSE
  SELECT * INTO proposal FROM public.operation_help_handover_events WHERE id=haven.operation_issue_uuid(p_payload,'proposal_id') AND activity_id=p_activity_id AND facility_id=p_facility_id AND command='propose';
  role_name:=p_payload->>'duty_role';
  IF proposal.id IS NULL OR role_name IS NULL OR role_name NOT IN('owner','backup') OR auth.uid() IS DISTINCT FROM (proposal.payload->>(role_name||'_user_id'))::uuid THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  scope:=proposal.duty_scope; person:=(proposal.payload->>'owner_user_id')::uuid; backup:=(proposal.payload->>'backup_user_id')::uuid;
 END IF;
 -- Lock recipients before currentness validation; acceptance never speaks for another person.
 IF p_command<>'help' THEN
  PERFORM 1 FROM public.user_profiles WHERE id IN(person,backup) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.user_facility_access WHERE user_id IN(person,backup) AND facility_id=p_facility_id ORDER BY user_id FOR SHARE;
  IF NOT coalesce(haven.operation_issue_user_current(person,org,p_facility_id),false) OR NOT haven.operation_issue_user_role_allowed(person) OR (backup IS NOT NULL AND (NOT coalesce(haven.operation_issue_user_current(backup,org,p_facility_id),false) OR NOT haven.operation_issue_user_role_allowed(backup))) THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO e FROM public.operation_help_handover_events WHERE activity_id=p_activity_id AND facility_id=p_facility_id AND actor_id=auth.uid() AND request_key=p_request_key;
 IF e.id IS NOT NULL THEN
  IF e.request_hash<>hash THEN RAISE EXCEPTION 'Request already saved with different content' USING ERRCODE='P0001'; END IF;
  PERFORM haven.lock_operation_help_handover(p_activity_id,p_facility_id); RETURN jsonb_build_object('event',to_jsonb(e)-'request_hash','replayed',true);
 END IF;
 SELECT * INTO latest FROM public.operation_help_handover_events WHERE activity_id=p_activity_id AND facility_id=p_facility_id AND duty_scope=scope AND (command='help')=(p_command='help') ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM p_expected_id THEN RAISE EXCEPTION 'Handover changed since it was read' USING ERRCODE='P0001'; END IF;
 IF p_command='accept' THEN
  IF proposal.id IS DISTINCT FROM (SELECT id FROM public.operation_help_handover_events WHERE activity_id=p_activity_id AND facility_id=p_facility_id AND duty_scope=scope AND command='propose' ORDER BY created_at DESC,id DESC LIMIT 1)
  OR EXISTS(SELECT 1 FROM public.operation_help_handover_events WHERE command='accept' AND payload->>'proposal_id'=proposal.id::text AND payload->>'duty_role'=role_name) THEN RAISE EXCEPTION 'Proposal replaced or already accepted' USING ERRCODE='P0001'; END IF;
 END IF;
 PERFORM haven.lock_operation_help_handover(p_activity_id,p_facility_id);
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.operation_help_handover_events(organization_id,facility_id,activity_id,command,duty_scope,payload,actor_id,request_key,request_hash,previous_id)
 VALUES(org,p_facility_id,p_activity_id,p_command,scope,p_payload,auth.uid(),p_request_key,hash,latest.id) RETURNING * INTO e;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_help_handover(p_activity_id,p_facility_id);
 IF p_command<>'accept' AND haven.app_role()::text NOT IN('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_command='help' AND supplied_refs THEN
  FOR doc IN SELECT value::text::uuid FROM jsonb_array_elements_text(p_payload->'protected_document_ids') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.facility_documents WHERE id=doc AND organization_id=org AND facility_id=p_facility_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Reference unavailable' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 IF p_command<>'help' AND (NOT EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=person AND haven.operation_issue_role_allowed(p.app_role)) OR (backup IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=backup AND haven.operation_issue_role_allowed(p.app_role)))) THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501'; END IF;
 IF p_command<>'help' AND (NOT coalesce(haven.operation_issue_user_current(person,org,p_facility_id),false) OR NOT haven.operation_issue_user_role_allowed(person) OR (backup IS NOT NULL AND (NOT coalesce(haven.operation_issue_user_current(backup,org,p_facility_id),false) OR NOT haven.operation_issue_user_role_allowed(backup)))) THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('event',to_jsonb(e)-'request_hash','replayed',false);
END $$;
CREATE FUNCTION public.write_operation_help_handover_review(p_activity_id uuid,p_facility_id uuid,p_command text,p_request_key text,p_expected_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.write_operation_help_handover(p_activity_id,p_facility_id,p_command,p_request_key,p_expected_id,p_payload) $$;
REVOKE ALL ON FUNCTION haven.write_operation_help_handover(uuid,uuid,text,text,uuid,jsonb),public.write_operation_help_handover_review(uuid,uuid,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.write_operation_help_handover(uuid,uuid,text,text,uuid,jsonb),public.write_operation_help_handover_review(uuid,uuid,text,text,uuid,jsonb) TO authenticated;
CREATE FUNCTION haven.operation_help_handover_people(p_activity_id uuid,p_facility_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ DECLARE org uuid; result jsonb; BEGIN
 org:=haven.lock_operation_help_handover(p_activity_id,p_facility_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) ORDER BY p.full_name,p.id),'[]'::jsonb) INTO result FROM public.user_profiles p
 WHERE p.organization_id=org AND haven.operation_issue_user_current(p.id,org,p_facility_id) AND haven.operation_issue_user_role_allowed(p.id);
 PERFORM haven.lock_operation_help_handover(p_activity_id,p_facility_id); RETURN result;
END $$;
CREATE FUNCTION public.operation_help_handover_people_review(p_activity_id uuid,p_facility_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_help_handover_people(p_activity_id,p_facility_id) $$;
REVOKE ALL ON FUNCTION haven.operation_help_handover_people(uuid,uuid),public.operation_help_handover_people_review(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_help_handover_people(uuid,uuid),public.operation_help_handover_people_review(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
