BEGIN;
-- COL-160 forward correction: a missing site's JSON null is not an expectation object.
-- Preserve migration 371, existing function grants, and every immutable historical capture.
-- Rollback changes future projection behavior only; never rewrite captured history.

CREATE OR REPLACE FUNCTION haven.corporate_meeting_projection(p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE site jsonb;expectation jsonb;current_version jsonb;projected_sites jsonb:='[]';result jsonb;
BEGIN
 IF jsonb_typeof(p_snapshot->'sites')<>'array' OR jsonb_array_length(p_snapshot->'sites')>100 OR p_snapshot->'coverage' IS NULL THEN RAISE EXCEPTION 'Bounded complete meeting source required' USING ERRCODE='54000';END IF;
 FOR site IN SELECT value FROM jsonb_array_elements(p_snapshot->'sites') LOOP
  expectation:=nullif(site->'expectation','null'::jsonb);current_version:=NULL;
  IF expectation IS NOT NULL AND expectation->>'current_version_id' IS NOT NULL THEN SELECT jsonb_build_object('id',v.id,'version',v.version,'task_id',v.task_id,'source_family',v.source_family,'source_version',v.source_version,'prepared_at',v.prepared_at,'captured',v.captured) INTO current_version FROM haven.corporate_submission_versions v WHERE v.id=(expectation->>'current_version_id')::uuid AND v.expectation_id=(expectation->>'id')::uuid;END IF;
  projected_sites:=projected_sites||jsonb_build_array(jsonb_build_object('facility_id',site->'facility_id','facility_label',(SELECT name FROM public.facilities WHERE id=(site->>'facility_id')::uuid),'status',site->>'status','expectation',CASE WHEN expectation IS NULL THEN NULL ELSE jsonb_build_object('id',expectation->'id','component_key',expectation->>'component_key','subject_kind',expectation->>'subject_kind','resident_id',expectation->'resident_id','current_state',expectation->>'current_state','current_version_id',expectation->'current_version_id','current_version',current_version,'recipient_label',expectation->'recipient_label','backup_label',expectation->'backup_label','due_on',expectation->'due_on','follow_up',expectation->'follow_up') END));
 END LOOP;
 result:=jsonb_build_object('schema_version',1,'activity_key',p_snapshot->>'activity_key','component_label',p_snapshot->>'component_label','period_start',p_snapshot->'period_start','period_end',p_snapshot->'period_end','coverage',p_snapshot->'coverage','sites',projected_sites,'front_office_boundary','standup_weekly_allowlist_only');
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'Meeting capture exceeds one MiB bound before mutation' USING ERRCODE='54000';END IF;
 RETURN result;
END $$;
COMMIT;
