BEGIN;
-- COL-140: prepare unresolved drafts only. Never publish, overwrite an existing
-- draft, clone defaults from a published rule, or infer a schedule/recorder.
CREATE FUNCTION haven.prepare_operation_profile_drafts(p_facility uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.operation_activities; central public.operation_requirement_versions; site public.operation_facility_requirements;
 provenance jsonb; mapped boolean; cstate text; fstate text; result jsonb; rows jsonb:='[]'; made integer:=0; kept integer:=0; unresolved integer:=0; org uuid:=haven.organization_id();
BEGIN
 PERFORM haven.assert_operation_requirement_actor(org,NULL);
 PERFORM haven.assert_operation_requirement_actor(org,p_facility);
 IF NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 FOR a IN SELECT t.* FROM public.operation_activities t WHERE t.organization_id=org AND (t.facility_id IS NULL OR t.facility_id=p_facility)
 AND EXISTS(SELECT 1 FROM public.operation_activity_source_mappings m WHERE m.activity_id=t.id AND m.organization_id=org)
 ORDER BY t.id FOR UPDATE OF t LOOP
  -- Existing central/site writers take SHARE on this same activity before
  -- reading a draft. The exclusive lock closes the read/create race with them.
  PERFORM haven.assert_operation_requirement_actor(org,NULL);
  PERFORM haven.assert_operation_requirement_actor(org,p_facility);
  SELECT jsonb_agg(jsonb_build_object('source_id',s.source_item_id,'source_file',s.source_file,'source_sha256',s.source_sha256,'intake_version',s.intake_version) ORDER BY s.source_item_id),
   bool_and(coalesce(s.source_payload->>'disposition','needs_confirmation')='mapped')
  INTO provenance,mapped FROM public.operation_activity_source_mappings m JOIN public.operation_activity_source_items s ON s.id=m.source_item_id AND s.organization_id=m.organization_id
  WHERE m.activity_id=a.id AND m.organization_id=org;
  IF NOT coalesce(mapped,false) OR a.subject_kind IS NULL THEN
   unresolved:=unresolved+1; rows:=rows||jsonb_build_array(jsonb_build_object('activity_id',a.id,'central','unresolved_mapping','facility','unresolved_mapping')); CONTINUE;
  END IF;
  SELECT * INTO central FROM public.operation_requirement_versions WHERE activity_id=a.id AND organization_id=org AND status IN('draft','published') ORDER BY (status='draft') DESC,version DESC LIMIT 1;
  IF FOUND THEN cstate:=CASE central.status WHEN 'draft' THEN 'existing_draft' ELSE 'existing_published' END;
  ELSE
   result:=haven.save_operation_requirement_draft(a.id,jsonb_build_object('title',a.name,'allowed_recorder_roles','[]'::jsonb,
    'source_authority',jsonb_build_object('kind','unapproved_profile_preparation','sources',provenance,'answer_id',NULL,'approver_id',NULL,'effective_from',NULL)));
   SELECT * INTO central FROM public.operation_requirement_versions WHERE id=(result->>'id')::uuid; cstate:='prepared';
  END IF;
  SELECT * INTO site FROM public.operation_facility_requirements WHERE activity_id=a.id AND facility_id=p_facility AND organization_id=org AND status IN('draft','published') ORDER BY (status='draft') DESC,version DESC LIMIT 1;
  IF FOUND THEN fstate:=CASE site.status WHEN 'draft' THEN 'existing_draft' ELSE 'existing_published' END;
  ELSE
   result:=haven.save_operation_facility_requirement_draft(a.id,p_facility,jsonb_build_object('requirement_version_id',CASE WHEN central.status='published' THEN central.id ELSE NULL END,
    'applicability','needs_confirmation','schedule_status','needs_confirmation','schedule_rule',NULL,'override_source','admin_log'));
   fstate:='prepared';
  END IF;
  IF cstate='prepared' OR fstate='prepared' THEN made:=made+1; ELSE kept:=kept+1; END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('activity_id',a.id,'central',cstate,'facility',fstate));
 END LOOP;
 PERFORM haven.assert_operation_requirement_actor(org,NULL);
 PERFORM haven.assert_operation_requirement_actor(org,p_facility);
 RETURN jsonb_build_object('prepared',made,'preserved',kept,'unresolved',unresolved,'results',rows);
END $$;
REVOKE ALL ON FUNCTION haven.prepare_operation_profile_drafts(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.prepare_operation_profile_drafts(uuid) TO authenticated;
CREATE FUNCTION public.prepare_operation_profile_drafts(p_facility uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.prepare_operation_profile_drafts(p_facility) $$;
REVOKE ALL ON FUNCTION public.prepare_operation_profile_drafts(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_operation_profile_drafts(uuid) TO authenticated;
COMMENT ON FUNCTION public.prepare_operation_profile_drafts(uuid) IS 'COL-140 creates missing unresolved drafts through existing commands. Existing drafts and published versions are preserved; no activation or approval is inferred.';
COMMIT;
