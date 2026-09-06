-- Access changes are service commands. RLS still governs ordinary reads/edits.
REVOKE INSERT, DELETE ON public.user_profiles FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_facility_access FROM authenticated, anon;

CREATE OR REPLACE FUNCTION haven.guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND
    (to_jsonb(NEW) - ARRAY['full_name','phone','avatar_url','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['full_name','phone','avatar_url','updated_at']) THEN
    RAISE EXCEPTION 'Identity and access fields require the access management command' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_profile_identity BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION haven.guard_profile_identity();

CREATE OR REPLACE FUNCTION haven.guard_controlled_count_signatures()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.incoming_staff_id IS NOT NULL OR NEW.incoming_signed_at IS NOT NULL
         OR NEW.outgoing_staff_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'A count must start unsigned with the acting outgoing staff' USING ERRCODE = '42501';
      END IF;
      NEW.outgoing_signed_at := now();
    ELSE
      IF ROW(NEW.incoming_staff_id, NEW.incoming_signed_at, NEW.outgoing_staff_id, NEW.outgoing_signed_at,
             NEW.facility_id, NEW.organization_id, NEW.resident_medication_id)
         IS DISTINCT FROM ROW(OLD.incoming_staff_id, OLD.incoming_signed_at, OLD.outgoing_staff_id, OLD.outgoing_signed_at,
             OLD.facility_id, OLD.organization_id, OLD.resident_medication_id) THEN
        RAISE EXCEPTION 'Witness signatures require credential verification' USING ERRCODE = '42501';
      END IF;
      IF OLD.incoming_staff_id IS NOT NULL AND
         ROW(NEW.actual_count, NEW.expected_count, NEW.count_date, NEW.shift, NEW.count_type, NEW.deleted_at)
         IS DISTINCT FROM ROW(OLD.actual_count, OLD.expected_count, OLD.count_date, OLD.shift, OLD.count_type, OLD.deleted_at) THEN
        RAISE EXCEPTION 'A signed count cannot be rewritten' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_controlled_count_signatures BEFORE INSERT OR UPDATE ON public.controlled_substance_counts
FOR EACH ROW EXECUTE FUNCTION haven.guard_controlled_count_signatures();
REVOKE DELETE ON public.controlled_substance_counts FROM authenticated, anon;

-- One transaction locks every count, signs every count, and records every verified witness.
CREATE OR REPLACE FUNCTION public.complete_verified_controlled_counts(
  p_count_ids uuid[], p_outgoing_id uuid, p_incoming_id uuid, p_facility_id uuid, p_organization_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.controlled_substance_counts; matched integer := 0;
BEGIN
  IF p_incoming_id = p_outgoing_id OR cardinality(p_count_ids) IS NULL OR cardinality(p_count_ids) = 0 THEN
    RAISE EXCEPTION 'Two different staff and at least one count are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_incoming_id AND organization_id = p_organization_id
      AND app_role IN ('nurse', 'caregiver') AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Invalid witness';
  END IF;
  IF (SELECT count(*) FROM public.user_profiles u WHERE u.id IN (p_outgoing_id,p_incoming_id)
      AND u.organization_id=p_organization_id AND u.is_active AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.facilities f WHERE f.id=p_facility_id AND f.organization_id=p_organization_id AND f.deleted_at IS NULL
        AND (u.app_role IN ('owner','org_admin') OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id=u.id
          AND a.facility_id=f.id AND a.organization_id=p_organization_id AND a.revoked_at IS NULL)))) <> 2 THEN
    RAISE EXCEPTION 'Both staff must have active facility access';
  END IF;
  FOR c IN SELECT * FROM public.controlled_substance_counts WHERE id = ANY(p_count_ids) ORDER BY id FOR UPDATE LOOP
    IF c.organization_id <> p_organization_id OR c.facility_id <> p_facility_id OR c.outgoing_staff_id <> p_outgoing_id
       OR c.incoming_staff_id IS NOT NULL OR c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Count is no longer available for signing'; END IF;
    matched := matched + 1;
  END LOOP;
  IF matched <> cardinality(p_count_ids) THEN RAISE EXCEPTION 'Count list must contain unique existing counts'; END IF;
  UPDATE public.controlled_substance_counts SET incoming_staff_id = p_incoming_id, incoming_signed_at = now() WHERE id = ANY(p_count_ids);
  INSERT INTO public.audit_log(table_name, record_id, action, new_data, user_id, organization_id, facility_id)
    SELECT 'controlled_substance_counts', id, 'UPDATE', jsonb_build_object('event','incoming_co_sign_verified',
      'incoming_staff_id',p_incoming_id,'outgoing_staff_id',p_outgoing_id), p_incoming_id, p_organization_id, p_facility_id
    FROM public.controlled_substance_counts WHERE id = ANY(p_count_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_verified_controlled_counts(uuid[],uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_verified_controlled_counts(uuid[],uuid,uuid,uuid,uuid) TO service_role;

-- Browser callers cannot forge/rewrite the receipts used by service-role Undo.
REVOKE INSERT, UPDATE, DELETE ON public.flow_workflow_runs, public.flow_workflow_run_steps FROM authenticated, anon;

-- Domain change, audit triggers, action step and success receipt commit together.
CREATE OR REPLACE FUNCTION public.commit_grace_action(p_run_id uuid, p_table text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.flow_workflow_runs; row_json jsonb; result jsonb; columns_sql text; result_key text; handler text;
  actor public.user_profiles; facility uuid; expected_slug text;
BEGIN
  SELECT * INTO STRICT r FROM public.flow_workflow_runs WHERE id = p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF r.status = 'succeeded' THEN
    RETURN jsonb_build_object('result', r.result_payload, 'undo_handler', r.undo_handler, 'undo_deadline', r.undo_deadline);
  END IF;
  IF r.status <> 'running' OR r.metadata->>'receipt_version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Run requires reconciliation'; END IF;
  CASE p_table
    WHEN 'daily_logs' THEN result_key := 'daily_log_id'; handler := 'delete_daily_log'; expected_slug := 'log_daily_note';
    WHEN 'incidents' THEN result_key := 'incident_id'; handler := 'delete_incident'; expected_slug := 'report_incident';
    WHEN 'assessments' THEN result_key := 'assessment_id'; handler := 'delete_assessment'; expected_slug := 'schedule_assessment';
    ELSE RAISE EXCEPTION 'Unsupported Grace action';
  END CASE;
  IF r.metadata->>'flow_slug' IS DISTINCT FROM expected_slug THEN RAISE EXCEPTION 'Run action mismatch'; END IF;
  SELECT * INTO STRICT actor FROM public.user_profiles WHERE id = r.user_id AND organization_id = r.organization_id AND is_active AND deleted_at IS NULL;
  facility := (p_payload->>'facility_id')::uuid;
  IF (p_payload->>'organization_id')::uuid IS DISTINCT FROM r.organization_id
     OR (p_payload->>'created_by')::uuid IS DISTINCT FROM r.user_id THEN RAISE EXCEPTION 'Action identity mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = facility AND f.organization_id = r.organization_id AND f.deleted_at IS NULL
    AND (actor.app_role IN ('owner','org_admin') OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id = actor.id
      AND a.facility_id = f.id AND a.organization_id = r.organization_id AND a.revoked_at IS NULL))) THEN RAISE EXCEPTION 'Forbidden facility'; END IF;
  IF p_payload->>'resident_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.residents WHERE id = (p_payload->>'resident_id')::uuid
      AND organization_id = r.organization_id AND facility_id = facility AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Resident mismatch'; END IF;
  SELECT string_agg(format('%I', key), ',') INTO columns_sql FROM jsonb_object_keys(p_payload) AS key;
  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING to_jsonb(%I.*)',
    p_table, columns_sql, columns_sql, p_table, p_table) INTO row_json USING p_payload;
  result := jsonb_build_object(result_key, row_json->>'id', 'facility_id', facility, 'record_updated_at', row_json->>'updated_at');
  IF p_table = 'incidents' THEN result := result || jsonb_build_object('incident_number', row_json->>'incident_number'); END IF;
  INSERT INTO public.flow_workflow_run_steps(organization_id,run_id,step_index,step_type,action_key,params,status,result,started_at,finished_at)
    VALUES(r.organization_id,r.id,0,'action',expected_slug,r.slot_values,'succeeded',result,now(),now());
  UPDATE public.flow_workflow_runs SET status='succeeded', result_payload=result, undo_handler=handler,
    undo_deadline=now()+interval '60 seconds', finished_at=now(),updated_by=r.user_id WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('result', result, 'undo_handler', handler, 'undo_deadline', r.undo_deadline);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_grace_action(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_grace_action(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.undo_grace_action(p_run_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.flow_workflow_runs; actor public.user_profiles; target_table text; target_id uuid; row_json jsonb; facility uuid; log jsonb;
BEGIN
  SELECT * INTO STRICT actor FROM public.user_profiles WHERE id=p_actor_id AND is_active AND deleted_at IS NULL;
  SELECT * INTO STRICT r FROM public.flow_workflow_runs WHERE id=p_run_id AND organization_id=actor.organization_id AND deleted_at IS NULL FOR UPDATE;
  IF r.user_id <> p_actor_id AND actor.app_role NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF r.status <> 'succeeded' OR r.undo_deadline IS NULL OR r.undo_deadline < now() THEN RAISE EXCEPTION 'Run is not undoable'; END IF;
  CASE r.undo_handler
    WHEN 'delete_daily_log' THEN target_table := 'daily_logs'; target_id := (r.result_payload->>'daily_log_id')::uuid;
    WHEN 'delete_incident' THEN target_table := 'incidents'; target_id := (r.result_payload->>'incident_id')::uuid;
    WHEN 'delete_assessment' THEN target_table := 'assessments'; target_id := (r.result_payload->>'assessment_id')::uuid;
    ELSE RAISE EXCEPTION 'Unsupported undo handler';
  END CASE;
  EXECUTE format('SELECT to_jsonb(t.*) FROM public.%I t WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE', target_table)
    INTO row_json USING target_id, actor.organization_id;
  IF row_json IS NULL THEN RAISE EXCEPTION 'Target not found'; END IF;
  facility := (row_json->>'facility_id')::uuid;
  IF r.result_payload->>'facility_id' IS DISTINCT FROM facility::text
      OR r.result_payload->>'record_updated_at' IS NULL
      OR (row_json->>'updated_at')::timestamptz IS DISTINCT FROM (r.result_payload->>'record_updated_at')::timestamptz
      OR (row_json->>'created_by')::uuid IS DISTINCT FROM r.user_id THEN RAISE EXCEPTION 'Target changed; manual review required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id=facility AND f.organization_id=actor.organization_id AND f.deleted_at IS NULL
    AND (actor.app_role IN ('owner','org_admin') OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id=p_actor_id
      AND a.facility_id=facility AND a.organization_id=actor.organization_id AND a.revoked_at IS NULL))) THEN RAISE EXCEPTION 'Forbidden facility'; END IF;
  EXECUTE format('UPDATE public.%I SET deleted_at=now(),updated_by=$1 WHERE id=$2 AND organization_id=$3 AND facility_id=$4', target_table)
    USING p_actor_id,target_id,actor.organization_id,facility;
  log := jsonb_build_array(jsonb_build_object('step',r.undo_handler,'ok',true));
  UPDATE public.flow_workflow_runs SET status='undone',updated_by=p_actor_id,
    metadata=metadata||jsonb_build_object('compensation_log',log,'undone_at',now(),'undone_by',p_actor_id) WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'run_id',r.id,'compensation_log',log);
END;
$$;
REVOKE ALL ON FUNCTION public.undo_grace_action(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_grace_action(uuid,uuid) TO service_role;

REVOKE INSERT, UPDATE, DELETE ON public.witness_signatures FROM authenticated, anon;
ALTER TABLE public.witness_signatures DROP CONSTRAINT witness_signatures_signature_method_check;
ALTER TABLE public.witness_signatures ADD CONSTRAINT witness_signatures_signature_method_check
  CHECK (signature_method IN ('pin','biometric','nfc','password'));
CREATE OR REPLACE FUNCTION public.record_verified_med_pass_witness(p_pass_id uuid,p_actor_id uuid,p_witness_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE mp public.med_passes; sig_id uuid := gen_random_uuid();
BEGIN
  IF p_actor_id = p_witness_id THEN RAISE EXCEPTION 'Independent witness required'; END IF;
  SELECT * INTO STRICT mp FROM public.med_passes WHERE id=p_pass_id AND deleted_at IS NULL FOR UPDATE;
  IF mp.status NOT IN ('pending','overdue') OR mp.administered_by <> p_actor_id THEN RAISE EXCEPTION 'Pass unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE id=mp.shift_id AND user_id=p_actor_id AND status='active' AND deleted_at IS NULL
    AND facility_id=mp.facility_id AND organization_id=mp.organization_id) THEN RAISE EXCEPTION 'Active shift required'; END IF;
  IF (SELECT count(*) FROM public.user_profiles u WHERE u.id IN (p_actor_id,p_witness_id) AND u.is_active AND u.deleted_at IS NULL
    AND u.organization_id=mp.organization_id AND u.app_role IN ('nurse','caregiver')
    AND EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id=u.id AND a.facility_id=mp.facility_id
      AND a.organization_id=mp.organization_id AND a.revoked_at IS NULL)) <> 2 THEN RAISE EXCEPTION 'Both staff must have clinical facility access'; END IF;
  INSERT INTO public.witness_signatures(id,organization_id,facility_id,med_pass_id,witness_user_id,signature_method,signature_hash,device_id)
    VALUES(sig_id,mp.organization_id,mp.facility_id,mp.id,p_witness_id,'password',
      encode(sha256(convert_to(jsonb_build_object('receipt',sig_id,'pass',mp.id,'version',mp.updated_at,'actor',p_actor_id,'witness',p_witness_id)::text,'UTF8')),'hex'),
      'server-credential-verification');
  RETURN sig_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_med_pass_witness(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_med_pass_witness(uuid,uuid,uuid) TO service_role;
