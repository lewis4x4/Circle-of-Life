-- S2-R3: retain the JavaScript String.prototype.trim whitespace contract in
-- pattern matching and required late-reason validation. Receipt payloads remain
-- verbatim; locks, thresholds, clinical writes, and audit evidence are unchanged.
BEGIN;

-- ECMAScript WhiteSpace + LineTerminator, including BOM but excluding NEL,
-- zero-width space, and the obsolete Mongolian vowel separator. An explicit
-- character set avoids database locale-dependent regular expression behavior.
CREATE FUNCTION haven.rounding_trim_text(p_text text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
REVOKE ALL ON FUNCTION haven.rounding_trim_text(text) FROM PUBLIC,anon,authenticated,service_role;

-- Replace the committed definitions through a forward migration. Only trim
-- calls change; normalization must never be applied to receipt equivalence.
CREATE OR REPLACE FUNCTION haven.rounding_pattern_signature(p jsonb) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
 'quick_status',p->>'quick_status',
 'resident_location',lower(haven.rounding_trim_text(coalesce(p->>'resident_location',''))),
 'resident_position',lower(haven.rounding_trim_text(coalesce(p->>'resident_position',''))),
 'resident_state',lower(haven.rounding_trim_text(coalesce(p->>'resident_state',''))),
 'distress_present',coalesce((p->>'distress_present')::boolean,false),
 'breathing_concern',coalesce((p->>'breathing_concern')::boolean,false),
 'pain_concern',coalesce((p->>'pain_concern')::boolean,false),
 'toileting_assisted',coalesce((p->>'toileting_assisted')::boolean,false),
 'hydration_offered',coalesce((p->>'hydration_offered')::boolean,false),
 'repositioned',coalesce((p->>'repositioned')::boolean,false),
 'skin_concern_observed',coalesce((p->>'skin_concern_observed')::boolean,false),
 'fall_hazard_observed',coalesce((p->>'fall_hazard_observed')::boolean,false),
 'refused_assistance',coalesce((p->>'refused_assistance')::boolean,false),
 'intervention_codes',coalesce((SELECT jsonb_agg(code ORDER BY code) FROM jsonb_array_elements_text(coalesce(p->'intervention_codes','[]')) code),'[]'))
$$;
REVOKE ALL ON FUNCTION haven.rounding_pattern_signature(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.complete_rounding_task_review(
 p_task_id uuid,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
 p_organization_id uuid,p_facility_id uuid,p_actual_staff_id uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request uuid:=(p_payload->>'request_id')::uuid;
 v_task public.resident_observation_tasks%ROWTYPE;
 v_receipt public.rounding_completion_receipts%ROWTYPE;
 v_actor jsonb; v_staff uuid; v_role text; v_has_assignment boolean; v_is_assignee boolean;
 v_payload jsonb; v_result jsonb; v_log uuid; v_observed timestamptz; v_entered timestamptz;
 v_mode text; v_status text; v_exception text; v_delay integer; v_severity text; v_flag text;
 v_late boolean:=false; v_pattern boolean:=false; v_minute integer; v_recent integer; v_residents integer;
BEGIN
 IF v_request IS NULL OR p_payload->>'observed_at' IS NULL THEN
  RAISE EXCEPTION 'A request identity and observation time are required' USING ERRCODE='22023';
 END IF;
 -- Same key is serialized even across distinct tasks/actors, then task and
 -- staff/facility locks serialize completion and pattern threshold detection.
 PERFORM pg_advisory_xact_lock(hashtextextended('rounding-request:'||v_request::text,0));
 SELECT * INTO v_task FROM public.resident_observation_tasks
 WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Observation task not found' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rounding-pattern:'||p_facility_id::text||':'||p_actual_staff_id::text,0));
 v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,p_organization_id,p_facility_id,false,true);
 v_staff:=(v_actor->>'staff_id')::uuid; v_role:=v_actor->>'role';
 IF v_staff IS DISTINCT FROM p_actual_staff_id THEN RAISE EXCEPTION 'Rounding actor staff identity changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.resident_observation_assignments a
 WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL
 ORDER BY a.id FOR SHARE;
 SELECT EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL),
 EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL AND a.staff_id=v_staff)
 INTO v_has_assignment,v_is_assignee;
 IF v_role NOT IN('owner','org_admin','facility_admin','nurse')
 AND (CASE WHEN v_has_assignment THEN v_is_assignee ELSE v_task.assigned_staff_id=v_staff END) IS NOT TRUE THEN
  RAISE EXCEPTION 'Rounding task assignee changed' USING ERRCODE='42501';
 END IF;
 v_observed:=(p_payload->>'observed_at')::timestamptz;
 IF NOT isfinite(v_observed) THEN RAISE EXCEPTION 'Invalid observation time' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(coalesce(p_payload->'intervention_codes','[]'))<>'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'intervention_codes','[]')) code WHERE jsonb_typeof(code)<>'string') THEN
  RAISE EXCEPTION 'Invalid intervention codes' USING ERRCODE='22023';
 END IF;
 v_exception:=coalesce(nullif(p_payload->>'exception_type',''),CASE
  WHEN p_payload->>'quick_status'='not_found' THEN 'resident_not_found'
  WHEN p_payload->>'quick_status'='refused' THEN 'resident_declined_interaction'
  WHEN coalesce((p_payload->>'fall_hazard_observed')::boolean,false) THEN 'environmental_hazard_present' END);
 v_payload:=jsonb_build_object(
  'observed_at',v_observed,'quick_status',p_payload->>'quick_status',
  'resident_location',p_payload->>'resident_location','resident_position',p_payload->>'resident_position','resident_state',p_payload->>'resident_state',
  'distress_present',coalesce((p_payload->>'distress_present')::boolean,false),'breathing_concern',coalesce((p_payload->>'breathing_concern')::boolean,false),
  'pain_concern',coalesce((p_payload->>'pain_concern')::boolean,false),'toileting_assisted',coalesce((p_payload->>'toileting_assisted')::boolean,false),
  'hydration_offered',coalesce((p_payload->>'hydration_offered')::boolean,false),'repositioned',coalesce((p_payload->>'repositioned')::boolean,false),
  'skin_concern_observed',coalesce((p_payload->>'skin_concern_observed')::boolean,false),'fall_hazard_observed',coalesce((p_payload->>'fall_hazard_observed')::boolean,false),
  'refused_assistance',coalesce((p_payload->>'refused_assistance')::boolean,false),
  'intervention_codes',coalesce((SELECT jsonb_agg(code ORDER BY code) FROM jsonb_array_elements_text(coalesce(p_payload->'intervention_codes','[]')) code),'[]'),
  'note',p_payload->>'note','late_reason',p_payload->>'late_reason','exception_type',v_exception,
  'exception_severity',coalesce(nullif(p_payload->>'exception_severity',''),'medium'),'exception_present',v_exception IS NOT NULL);
 SELECT * INTO v_receipt FROM public.rounding_completion_receipts WHERE id=v_request;
 IF FOUND THEN
  IF v_receipt.actor_id IS DISTINCT FROM p_actor_id OR v_receipt.task_id IS DISTINCT FROM p_task_id
    OR v_receipt.organization_id IS DISTINCT FROM p_organization_id OR v_receipt.facility_id IS DISTINCT FROM p_facility_id
    OR v_receipt.staff_id IS DISTINCT FROM v_staff OR v_receipt.payload IS DISTINCT FROM v_payload THEN
   RAISE EXCEPTION 'Completion request conflicts with an existing observation' USING ERRCODE='23505';
  END IF;
  RETURN v_receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF v_task.status IN('completed_on_time','completed_late','excused') OR v_task.completed_log_id IS NOT NULL THEN
  RAISE EXCEPTION 'Observation task is no longer completable' USING ERRCODE='P0001';
 END IF;
 v_entered:=clock_timestamp();
 IF v_observed>v_entered THEN RAISE EXCEPTION 'Observation time cannot be in the future' USING ERRCODE='22023'; END IF;
 v_mode:=CASE WHEN coalesce((p_payload->>'offline')::boolean,false) THEN 'offline_synced'
  WHEN v_observed<v_entered-interval '5 minutes' THEN 'late' ELSE 'live' END;
 IF v_mode='late' AND nullif(haven.rounding_trim_text(v_payload->>'late_reason'),'') IS NULL THEN
  RAISE EXCEPTION 'lateReason is required for late entries' USING ERRCODE='22023';
 END IF;
 v_status:=CASE WHEN v_observed<=v_task.grace_ends_at THEN 'completed_on_time' ELSE 'completed_late' END;
 v_result:=haven.complete_rounding_task_core(p_task_id,p_actor_id,p_actor_role,p_session_id,p_claim_version,p_organization_id,p_facility_id,v_staff,
  v_payload||jsonb_build_object('entered_at',v_entered,'entry_mode',v_mode,'completion_status',v_status));
 v_log:=(v_result->>'log_id')::uuid;
 IF v_mode='late' THEN
  v_delay:=greatest(1,round(extract(epoch FROM (v_entered-v_observed))/60)::integer);
  v_severity:=CASE WHEN v_delay>=240 THEN 'critical' WHEN v_delay>=60 THEN 'high' ELSE 'medium' END;
  IF v_exception IS NOT NULL AND v_severity='medium' THEN v_severity:='high'; END IF;
  IF v_exception IS NOT NULL AND v_severity='high' AND v_delay>=120 THEN v_severity:='critical'; END IF;
  v_flag:=CASE WHEN v_exception IS NOT NULL THEN 'late_entry_with_exception' WHEN v_delay>=240 THEN 'late_entry_over_4h' WHEN v_delay>=60 THEN 'late_entry_over_60m' ELSE 'late_entry_review' END;
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,v_flag,v_severity::public.resident_observation_severity,'open',
   format('Auto-created from a late observation entry (%s min after observation). Reason: %s',v_delay,btrim(v_payload->>'late_reason')),p_actor_id);
  v_late:=true;
 END IF;
 SELECT count(*) FILTER(WHERE entered_at>=date_trunc('minute',v_entered)),count(*) INTO v_minute,v_recent
 FROM public.resident_observation_logs WHERE organization_id=p_organization_id AND facility_id=p_facility_id AND staff_id=v_staff AND deleted_at IS NULL
 AND entered_at>=v_entered-interval '5 minutes' AND entered_at<=v_entered;
 IF v_minute>=3 OR v_recent>=8 THEN
  v_flag:=CASE WHEN v_recent>=8 THEN 'high_velocity_documentation' ELSE 'same_minute_batch_entry' END;
  v_severity:=CASE WHEN v_minute>=6 OR v_recent>=12 THEN 'critical' ELSE 'high' END;
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,v_flag,v_severity::public.resident_observation_severity,'open',
   format('Auto-created from a suspicious documentation pattern: %s entries in the same minute and %s entries in the last 5 minutes.',v_minute,v_recent),p_actor_id);
  v_pattern:=true;
 END IF;
 SELECT count(DISTINCT log.resident_id) INTO v_residents FROM public.resident_observation_logs log
 WHERE log.organization_id=p_organization_id AND log.facility_id=p_facility_id AND log.staff_id=v_staff AND log.deleted_at IS NULL
 AND log.entered_at>=v_entered-interval '15 minutes' AND log.entered_at<=v_entered
 AND haven.rounding_pattern_signature(to_jsonb(log))=haven.rounding_pattern_signature(v_payload);
 IF v_residents>=3 THEN
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,'identical_payload_multi_resident',
   (CASE WHEN v_residents>=5 THEN 'critical' ELSE 'high' END)::public.resident_observation_severity,'open',
   format('Auto-created from repeated identical payload signatures across %s residents within 15 minutes.',v_residents),p_actor_id);
  v_pattern:=true;
 END IF;
 v_result:=v_result||jsonb_build_object('integrityFlagCreated',v_late,'suspiciousPatternFlagCreated',v_pattern,'replayed',false);
 INSERT INTO public.rounding_completion_receipts(id,organization_id,facility_id,actor_id,staff_id,task_id,payload,result)
 VALUES(v_request,p_organization_id,p_facility_id,p_actor_id,v_staff,p_task_id,v_payload,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;

-- Rollback: use a reviewed forward migration; retain accepted receipts and logs.
