-- Clinical review: preserve individual observations and atomic operator work.
CREATE OR REPLACE FUNCTION public.append_caregiver_shift_note(p_resident_id uuid, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r residents%ROWTYPE; tz text; local_now timestamp; bucket shift_type; result uuid;
BEGIN
  IF auth.uid() IS NULL OR p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION 'A signed-in author and note are required'; END IF;
  SELECT * INTO STRICT r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL;
  SELECT timezone INTO tz FROM facilities WHERE id=r.facility_id AND deleted_at IS NULL;
  local_now := now() AT TIME ZONE coalesce(tz,'America/New_York');
  bucket := CASE WHEN extract(hour FROM local_now) BETWEEN 7 AND 14 THEN 'day'::shift_type WHEN extract(hour FROM local_now) BETWEEN 15 AND 22 THEN 'evening'::shift_type ELSE 'night'::shift_type END;
  INSERT INTO daily_logs(resident_id,facility_id,organization_id,log_date,shift,logged_by,general_notes,created_by)
  VALUES(r.id,r.facility_id,r.organization_id,local_now::date,bucket,auth.uid(),'['||to_char(local_now,'HH24:MI')||'] '||trim(p_note),auth.uid())
  ON CONFLICT(resident_id,log_date,shift,logged_by) WHERE deleted_at IS NULL
  DO UPDATE SET general_notes=concat_ws(E'\n',nullif(daily_logs.general_notes,''),EXCLUDED.general_notes),updated_by=auth.uid()
  RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.append_caregiver_shift_note(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.append_caregiver_shift_note(uuid,text) TO authenticated;

CREATE TABLE public.daily_vital_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id uuid NOT NULL REFERENCES daily_logs(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  observed_at timestamptz NOT NULL,
  measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='object' AND measurements <> '{}'::jsonb),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
ALTER TABLE public.daily_vital_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff read visible vital observations" ON public.daily_vital_observations FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM daily_logs d WHERE d.id=daily_log_id AND d.resident_id=daily_vital_observations.resident_id AND d.deleted_at IS NULL) AND deleted_at IS NULL);
CREATE POLICY "Authors append observations to their shift log" ON public.daily_vital_observations FOR INSERT TO authenticated
WITH CHECK(recorded_by=auth.uid() AND EXISTS(SELECT 1 FROM daily_logs d WHERE d.id=daily_log_id AND d.logged_by=auth.uid() AND d.resident_id=daily_vital_observations.resident_id AND d.facility_id=daily_vital_observations.facility_id AND d.organization_id=daily_vital_observations.organization_id AND d.deleted_at IS NULL));
GRANT SELECT,INSERT ON public.daily_vital_observations TO authenticated,service_role;
CREATE INDEX idx_daily_vital_observations_resident ON public.daily_vital_observations(resident_id,observed_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_daily_vital_observations_audit AFTER INSERT OR UPDATE OR DELETE ON public.daily_vital_observations FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION public.record_caregiver_vitals(p_resident_id uuid,p_measurements jsonb,p_observed_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r residents%ROWTYPE; tz text; local_now timestamp; bucket shift_type; result uuid; key text; value jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_observed_at IS NULL OR p_observed_at>now()+interval '1 minute' OR p_observed_at<now()-interval '24 hours' THEN RAISE EXCEPTION 'Invalid observation time'; END IF;
 IF p_measurements IS NULL OR jsonb_typeof(p_measurements)<>'object' OR p_measurements='{}'::jsonb THEN RAISE EXCEPTION 'Enter at least one measurement'; END IF;
 FOR key,value IN SELECT * FROM jsonb_each(p_measurements) LOOP
   IF key NOT IN ('temperature','blood_pressure_systolic','blood_pressure_diastolic','pulse') OR jsonb_typeof(value)<>'number' OR (value::text)::numeric<=0 THEN RAISE EXCEPTION 'Invalid measurement'; END IF;
 END LOOP;
 SELECT * INTO STRICT r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL;
 SELECT timezone INTO tz FROM facilities WHERE id=r.facility_id AND deleted_at IS NULL;
 local_now:=p_observed_at AT TIME ZONE coalesce(tz,'America/New_York');
 bucket:=CASE WHEN extract(hour FROM local_now) BETWEEN 7 AND 14 THEN 'day'::shift_type WHEN extract(hour FROM local_now) BETWEEN 15 AND 22 THEN 'evening'::shift_type ELSE 'night'::shift_type END;
 INSERT INTO daily_logs(resident_id,facility_id,organization_id,log_date,shift,logged_by,created_by)
 VALUES(r.id,r.facility_id,r.organization_id,local_now::date,bucket,auth.uid(),auth.uid())
 ON CONFLICT(resident_id,log_date,shift,logged_by) WHERE deleted_at IS NULL DO UPDATE SET updated_by=auth.uid() RETURNING id INTO result;
 UPDATE daily_logs SET temperature=coalesce((p_measurements->>'temperature')::numeric,temperature),
 blood_pressure_systolic=coalesce((p_measurements->>'blood_pressure_systolic')::integer,blood_pressure_systolic),
 blood_pressure_diastolic=coalesce((p_measurements->>'blood_pressure_diastolic')::integer,blood_pressure_diastolic),
 pulse=coalesce((p_measurements->>'pulse')::integer,pulse),updated_by=auth.uid() WHERE id=result;
 INSERT INTO daily_vital_observations(daily_log_id,resident_id,facility_id,organization_id,observed_at,measurements,recorded_by)
 VALUES(result,r.id,r.facility_id,r.organization_id,p_observed_at,p_measurements,auth.uid());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_caregiver_vitals(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_caregiver_vitals(uuid,jsonb,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_overdue_latest_assessments(p_today date,p_facility_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT count(*) FROM (SELECT DISTINCT ON(resident_id,assessment_type) next_due_date FROM assessments
 WHERE deleted_at IS NULL AND (p_facility_id IS NULL OR facility_id=p_facility_id)
 ORDER BY resident_id,assessment_type,assessment_date DESC,created_at DESC,id DESC) latest WHERE next_due_date<p_today;
$$;
REVOKE ALL ON FUNCTION public.count_overdue_latest_assessments(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.count_overdue_latest_assessments(date,uuid) TO authenticated;

-- The cockpit records the same durable MAR as other medication workflows.
CREATE POLICY "Med tech records own administered doses" ON public.emar_records FOR INSERT TO authenticated
WITH CHECK(haven.app_role()='med_tech' AND organization_id=haven.organization_id() AND facility_id IN(SELECT haven.accessible_facility_ids()) AND administered_by=auth.uid());
CREATE OR REPLACE FUNCTION public.complete_med_pass_review(p_pass_id uuid,p_status text,p_reason text,p_checks_confirmed boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE p med_passes%ROWTYPE; m resident_medications%ROWTYPE; result uuid; witness uuid; existing emar_records%ROWTYPE; scheduled timestamptz;
BEGIN
 IF auth.uid() IS NULL OR p_status NOT IN('given','refused','held') OR NOT coalesce(p_checks_confirmed,false) THEN RAISE EXCEPTION 'Confirm the resident, order and actual action'; END IF;
 SELECT * INTO STRICT p FROM med_passes WHERE id=p_pass_id AND deleted_at IS NULL FOR UPDATE;
 IF p.administered_by<>auth.uid() OR NOT EXISTS(SELECT 1 FROM med_tech_shifts s WHERE s.id=p.shift_id AND s.user_id=auth.uid() AND s.deleted_at IS NULL) THEN RAISE EXCEPTION 'Not your medication pass'; END IF;
 IF p.emar_record_id IS NOT NULL AND p.status=p_status THEN
  IF NOT EXISTS(SELECT 1 FROM emar_records WHERE id=p.emar_record_id AND coalesce(trim(notes),'')=coalesce(trim(p_reason),'')) THEN RAISE EXCEPTION 'This pass was already recorded with different notes. Refresh the MAR before correcting'; END IF;
  RETURN p.emar_record_id;
 END IF;
 IF p.status NOT IN('pending','overdue') THEN RAISE EXCEPTION 'This pass has already been resolved; refresh the queue'; END IF;
 SELECT * INTO STRICT m FROM resident_medications WHERE id=p.resident_medication_id AND resident_id=p.resident_id AND facility_id=p.facility_id AND organization_id=p.organization_id AND deleted_at IS NULL;
 IF m.status<>'active' THEN RAISE EXCEPTION 'The medication order is not active'; END IF;
 IF (p_status<>'given' OR m.frequency='prn') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'An indication or exception reason is required'; END IF;
 IF p_status='given' THEN
  IF EXISTS(SELECT 1 FROM pre_pass_holds h WHERE h.resident_id=p.resident_id AND h.active AND (h.resident_medication_id IS NULL OR h.resident_medication_id=m.id)) THEN RAISE EXCEPTION 'An active hold requires nurse resolution before administration'; END IF;
  IF p.witness_required OR m.witness_required OR p.controlled_substance OR m.controlled_schedule<>'non_controlled' THEN
   SELECT id INTO witness FROM witness_signatures WHERE med_pass_id=p.id AND signed_at>=p.updated_at AND signed_at>=now()-interval '5 minutes' AND witness_user_id<>auth.uid() AND facility_id=p.facility_id AND organization_id=p.organization_id ORDER BY signed_at DESC LIMIT 1;
   IF witness IS NULL THEN RAISE EXCEPTION 'An independent authenticated witness signature is required'; END IF;
  END IF;
 END IF;
 scheduled:=coalesce(p.scheduled_time,now());
 IF m.frequency<>'prn' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(m.id::text||'|'||extract(epoch FROM scheduled)::text,0));
  SELECT * INTO existing FROM emar_records WHERE resident_medication_id=m.id AND scheduled_time=scheduled AND NOT is_prn AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF existing.id IS NOT NULL AND existing.status<>'scheduled' THEN RAISE EXCEPTION 'This scheduled dose has already been resolved. Refresh the queue'; END IF;
 END IF;
 IF existing.id IS NOT NULL THEN
  UPDATE emar_records SET actual_time=now(),status=p_status::emar_status,administered_by=auth.uid(),refusal_reason=CASE WHEN p_status='refused' THEN trim(p_reason) END,hold_reason=CASE WHEN p_status='held' THEN trim(p_reason) END,notes=trim(p_reason),med_pass_id=p.id,witness_signature_id=witness,updated_by=auth.uid() WHERE id=existing.id RETURNING id INTO result;
 ELSE
 INSERT INTO emar_records(resident_id,resident_medication_id,facility_id,organization_id,scheduled_time,actual_time,status,administered_by,is_prn,prn_reason_given,refusal_reason,hold_reason,notes,created_by,med_pass_id,witness_signature_id)
 VALUES(p.resident_id,m.id,p.facility_id,p.organization_id,scheduled,now(),p_status::emar_status,auth.uid(),m.frequency='prn',CASE WHEN m.frequency='prn' THEN trim(p_reason) END,CASE WHEN p_status='refused' THEN trim(p_reason) END,CASE WHEN p_status='held' THEN trim(p_reason) END,trim(p_reason),auth.uid(),p.id,witness) RETURNING id INTO result;
 END IF;
 UPDATE med_passes SET status=p_status,emar_record_id=result,administered_time=now(),updated_by=auth.uid(),notes=trim(p_reason),pre_pass_sweep_result=jsonb_build_object('operator_confirmed',true,'confirmed_at',now()),witnessed_by=(SELECT witness_user_id FROM witness_signatures WHERE id=witness) WHERE id=p.id;
 INSERT INTO shift_tape_events(organization_id,facility_id,shift_id,resident_id,event_type,event_ref_table,event_ref_id,summary)
 VALUES(p.organization_id,p.facility_id,p.shift_id,p.resident_id,'med_pass','emar_records',result,m.medication_name||': '||p_status);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.complete_med_pass_review(uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_med_pass_review(uuid,text,text,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Serialize evaluation for a facility/group and derive totals from distinct linked records.
CREATE OR REPLACE FUNCTION public.evaluate_infection_outbreak_atomic(p_surveillance_id uuid,p_actor_id uuid,p_group text,p_types text[],p_checklist jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s infection_surveillance%ROWTYPE; o infection_outbreaks%ROWTYPE; related uuid[]; result text; item jsonb;
BEGIN
 SELECT * INTO STRICT s FROM infection_surveillance WHERE id=p_surveillance_id AND deleted_at IS NULL;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.facility_id::text||'|'||coalesce(s.unit_id::text,'')||'|'||p_group,0));
 SELECT * INTO STRICT s FROM infection_surveillance WHERE id=p_surveillance_id AND deleted_at IS NULL FOR UPDATE;
 IF s.outbreak_id IS NOT NULL THEN RETURN 'linked'; END IF;
 IF s.status NOT IN('suspected','confirmed') THEN RETURN 'none'; END IF;
 SELECT array_agg(id) INTO related FROM infection_surveillance WHERE facility_id=s.facility_id AND organization_id=s.organization_id AND unit_id IS NOT DISTINCT FROM s.unit_id AND infection_type=ANY(p_types) AND status IN('suspected','confirmed') AND abs(onset_date-s.onset_date)<=3 AND deleted_at IS NULL AND outbreak_id IS NULL;
 SELECT * INTO o FROM infection_outbreaks WHERE facility_id=s.facility_id AND organization_id=s.organization_id AND unit_id IS NOT DISTINCT FROM s.unit_id AND infection_type=p_group AND deleted_at IS NULL AND (status='active' OR (status='contained' AND contained_at>=now()-interval '14 days')) ORDER BY (status='active') DESC,created_at DESC LIMIT 1 FOR UPDATE;
 IF o.id IS NULL THEN
  IF coalesce(array_length(related,1),0)<2 THEN RETURN 'none'; END IF;
  INSERT INTO infection_outbreaks(facility_id,organization_id,unit_id,infection_type,status,detection_method,declared_by,initial_case_count,total_cases,created_by)
  VALUES(s.facility_id,s.organization_id,s.unit_id,p_group,'active','algorithmic',p_actor_id,array_length(related,1),array_length(related,1),p_actor_id) RETURNING * INTO o;
  FOR item IN SELECT * FROM jsonb_array_elements(p_checklist) LOOP
   INSERT INTO outbreak_actions(outbreak_id,facility_id,organization_id,action_type,title,priority,sort_order,status)
   VALUES(o.id,s.facility_id,s.organization_id,item->>'action_type',item->>'title',item->>'priority',(item->>'sort_order')::integer,'pending');
  END LOOP;
  result:='created';
 ELSE
  result:=CASE WHEN o.status='contained' THEN 'reopened' ELSE 'linked' END;
 END IF;
 UPDATE infection_surveillance SET outbreak_id=o.id,updated_by=p_actor_id WHERE id=ANY(coalesce(related,ARRAY[s.id])) AND outbreak_id IS NULL;
 UPDATE infection_outbreaks SET status='active',contained_at=NULL,total_cases=(SELECT count(*) FROM infection_surveillance WHERE outbreak_id=o.id AND deleted_at IS NULL),updated_by=p_actor_id WHERE id=o.id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.evaluate_infection_outbreak_atomic(uuid,uuid,text,text[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_infection_outbreak_atomic(uuid,uuid,text,text[],jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.require_complete_discharge_reconciliation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='complete' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.med_snapshot_json IS DISTINCT FROM NEW.med_snapshot_json) THEN
  IF NEW.pharmacist_reviewed_at IS NULL OR coalesce(NEW.pharmacist_npi,'') !~ '^[0-9]{10}$' OR nullif(trim(NEW.pharmacist_notes),'') IS NULL THEN RAISE EXCEPTION 'Pharmacist review evidence is required'; END IF;
  IF NEW.med_snapshot_json IS NULL OR jsonb_typeof(NEW.med_snapshot_json->'medications') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'A medication reconciliation snapshot is required'; END IF;
  IF jsonb_array_length(NEW.med_snapshot_json->'medications')=0 AND NOT coalesce((NEW.med_snapshot_json->>'no_medications_confirmed')::boolean,false) THEN RAISE EXCEPTION 'Confirm that there are no medications to reconcile'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.med_snapshot_json->'medications') m WHERE coalesce(m->>'decision','') NOT IN('continue','change','stop') OR nullif(trim(m->>'plan'),'') IS NULL) THEN RAISE EXCEPTION 'Every medication requires a decision and transition instructions'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_require_complete_discharge_reconciliation BEFORE INSERT OR UPDATE ON discharge_med_reconciliation FOR EACH ROW EXECUTE FUNCTION public.require_complete_discharge_reconciliation();

REVOKE INSERT, UPDATE, DELETE ON operation_task_instances FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON operation_task_instances TO service_role;
CREATE OR REPLACE FUNCTION public.complete_operation_task_review(p_task_id uuid,p_actor_id uuid,p_actor_role text,p_notes text,p_evidence text[] DEFAULT '{}')
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t operation_task_instances%ROWTYPE; target text; finalizer uuid;
BEGIN
 SELECT * INTO STRICT t FROM operation_task_instances WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
 IF t.status='completed' THEN RETURN 'completed'; END IF;
 IF t.status NOT IN('pending','in_progress','missed','deferred') THEN RAISE EXCEPTION 'Task cannot be completed from this state'; END IF;
 IF t.signed_by IS NOT NULL AND t.requires_dual_sign THEN
  IF t.signed_by=p_actor_id THEN RAISE EXCEPTION 'A different authorized staff member must verify this task'; END IF;
  target:='completed'; finalizer:=p_actor_id;
 ELSE
  target:=CASE WHEN t.requires_dual_sign THEN 'in_progress' ELSE 'completed' END;
  finalizer:=CASE WHEN t.requires_dual_sign THEN NULL ELSE p_actor_id END;
 END IF;
 UPDATE operation_task_instances SET status=target,signed_by=coalesce(t.signed_by,p_actor_id),signed_at=coalesce(t.signed_at,now()),second_sign_by=CASE WHEN t.requires_dual_sign THEN finalizer END,second_signed_at=CASE WHEN t.requires_dual_sign AND finalizer IS NOT NULL THEN now() END,completed_at=coalesce(t.completed_at,now()),
 completion_notes=CASE WHEN t.signed_by IS NULL THEN p_notes ELSE t.completion_notes END,
 completion_evidence_paths=CASE WHEN t.signed_by IS NULL THEN p_evidence ELSE t.completion_evidence_paths END,
 verified_by=finalizer,verified_at=CASE WHEN finalizer IS NOT NULL THEN now() END,
 sla_met=(t.due_at IS NULL OR t.due_at>=coalesce(t.completed_at,now())),updated_by=p_actor_id WHERE id=t.id;
 INSERT INTO operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,target,p_actor_id,p_actor_role,p_notes,jsonb_build_object('awaiting_second_verification',finalizer IS NULL,'independent_verification',t.signed_by IS NOT NULL));
 RETURN CASE WHEN target='in_progress' THEN 'awaiting_verification' ELSE target END;
END $$;
REVOKE ALL ON FUNCTION public.complete_operation_task_review(uuid,uuid,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_operation_task_review(uuid,uuid,text,text,text[]) TO service_role;
CREATE OR REPLACE FUNCTION public.require_dual_operation_verification() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user NOT IN('postgres','service_role') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status='completed' OR NEW.signed_by IS NOT NULL OR NEW.verified_by IS NOT NULL OR NEW.second_sign_by IS NOT NULL THEN RAISE EXCEPTION 'Operation signatures require the authenticated completion service' USING ERRCODE='42501'; END IF;
  ELSIF NEW.requires_dual_sign IS DISTINCT FROM OLD.requires_dual_sign OR NEW.signed_by IS DISTINCT FROM OLD.signed_by OR NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.second_sign_by IS DISTINCT FROM OLD.second_sign_by OR NEW.second_signed_at IS DISTINCT FROM OLD.second_signed_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at OR (NEW.status='completed' AND OLD.status<>'completed') THEN
   RAISE EXCEPTION 'Operation signatures require the authenticated completion service' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NEW.requires_dual_sign AND NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) AND (NEW.signed_by IS NULL OR NEW.verified_by IS NULL OR NEW.signed_by=NEW.verified_by OR NEW.verified_at IS NULL) THEN RAISE EXCEPTION 'Two independent staff signatures are required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_require_dual_operation_verification BEFORE INSERT OR UPDATE ON operation_task_instances FOR EACH ROW EXECUTE FUNCTION public.require_dual_operation_verification();

-- One transaction per bulk request; the same signature rules apply to every row.
DROP FUNCTION public.bulk_complete_operation_tasks(uuid[],uuid,text,text,timestamptz);
CREATE FUNCTION public.bulk_complete_operation_tasks(p_task_ids uuid[],p_actor_id uuid,p_actor_role text,p_completion_notes text,p_completed_at timestamptz DEFAULT now())
RETURNS TABLE(task_instance_id uuid,outcome text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE task_id uuid;
BEGIN
 FOR task_id IN SELECT DISTINCT unnest(p_task_ids) LOOP
  outcome:=public.complete_operation_task_review(task_id,p_actor_id,p_actor_role,p_completion_notes,'{}');
  task_instance_id:=task_id; RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.bulk_complete_operation_tasks(uuid[],uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_complete_operation_tasks(uuid[],uuid,text,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_operation_template_review(p_previous_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE previous operation_task_templates%ROWTYPE; replacement operation_task_templates%ROWTYPE;
BEGIN
 SELECT * INTO STRICT previous FROM operation_task_templates WHERE id=p_previous_id AND deleted_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM operation_task_templates WHERE previous_version_id=previous.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'A newer template version already exists. Reload before editing'; END IF;
 replacement:=jsonb_populate_record(previous,p_payload);
 replacement.id:=gen_random_uuid(); replacement.organization_id:=previous.organization_id; replacement.previous_version_id:=previous.id; replacement.version:=previous.version+1; replacement.created_at:=now(); replacement.updated_at:=now();
 UPDATE operation_task_templates SET is_active=false,updated_by=replacement.updated_by WHERE id=previous.id;
 INSERT INTO operation_task_templates SELECT replacement.*;
 RETURN to_jsonb(replacement);
END $$;
REVOKE ALL ON FUNCTION public.publish_operation_template_review(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_operation_template_review(uuid,jsonb) TO service_role;

-- An unanswered intake question is unknown, never a fabricated demographic answer.
ALTER TABLE residents ALTER COLUMN gender DROP NOT NULL;
ALTER TABLE residents ADD CONSTRAINT residents_gender_required_after_inquiry CHECK(status='inquiry' OR gender IS NOT NULL) NOT VALID;

ALTER TABLE admission_cases ADD COLUMN creation_request_hash text;
ALTER TABLE admission_cases ADD COLUMN create_request_id uuid;
CREATE UNIQUE INDEX idx_admission_case_creation_request ON admission_cases(create_request_id) WHERE create_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.create_admission_case_review(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE existing admission_cases%ROWTYPE; created admission_cases%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('admission:'||(p_payload->>'resident_id'),0));
 SELECT * INTO existing FROM admission_cases WHERE resident_id=(p_payload->>'resident_id')::uuid AND facility_id=(p_payload->>'facility_id')::uuid AND deleted_at IS NULL AND status::text NOT IN('cancelled','closed') ORDER BY created_at DESC LIMIT 1;
 IF existing.id IS NOT NULL THEN
  IF existing.create_request_id=(p_payload->>'create_request_id')::uuid AND existing.status::text=p_payload->>'status' AND existing.creation_request_hash=md5(p_payload::text) THEN RETURN to_jsonb(existing); END IF;
  RAISE EXCEPTION 'An admission case already exists (%). Open it to continue this intake',existing.id;
 END IF;
 created:=jsonb_populate_record(NULL::admission_cases,p_payload);
 created.id:=gen_random_uuid();created.created_at:=now();created.updated_at:=now();
 INSERT INTO admission_cases(creation_request_hash,create_request_id,id,organization_id,facility_id,resident_id,referral_lead_id,bed_id,target_move_in_date,notes,intake_program_type,medicaid_pipeline_stage,anticipated_payer_source,anticipated_payer_other,source,source_other,status,created_by,updated_by) VALUES(md5(p_payload::text),created.create_request_id,created.id,created.organization_id,created.facility_id,created.resident_id,created.referral_lead_id,created.bed_id,created.target_move_in_date,created.notes,created.intake_program_type,created.medicaid_pipeline_stage,created.anticipated_payer_source,created.anticipated_payer_other,created.source,created.source_other,created.status,created.created_by,created.updated_by) RETURNING * INTO created;
 RETURN to_jsonb(created);
END $$;
REVOKE ALL ON FUNCTION public.create_admission_case_review(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_admission_case_review(jsonb) TO service_role;

ALTER TABLE admission_cases ADD COLUMN actual_arrival_at timestamptz;
CREATE OR REPLACE FUNCTION public.confirm_admission_arrival_review(p_case_id uuid,p_actor_id uuid,p_arrival_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c admission_cases%ROWTYPE; r residents%ROWTYPE; b beds%ROWTYPE; today date;
BEGIN
 SELECT * INTO STRICT c FROM admission_cases WHERE id=p_case_id AND deleted_at IS NULL FOR UPDATE;
 SELECT (now() AT TIME ZONE coalesce(timezone,'America/New_York'))::date INTO today FROM facilities WHERE id=c.facility_id;
 IF c.actual_arrival_at IS NOT NULL THEN RETURN c.resident_id; END IF;
 IF c.status::text IN('cancelled','closed') THEN RAISE EXCEPTION 'A cancelled or closed admission cannot confirm arrival'; END IF;
 IF p_arrival_date IS NULL OR p_arrival_date>today THEN RAISE EXCEPTION 'Choose an actual arrival date, not a future date'; END IF;
 IF c.financial_clearance_at IS NULL OR c.physician_orders_received_at IS NULL OR c.bed_id IS NULL OR NOT EXISTS(SELECT 1 FROM admission_case_rate_terms WHERE admission_case_id=c.id) THEN RAISE EXCEPTION 'Complete financial, physician-order, bed and rate readiness first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT fr.* FROM form_1823_records fr WHERE fr.resident_id=c.resident_id AND fr.deleted_at IS NULL ORDER BY CASE WHEN fr.admission_case_id=c.id THEN 1 ELSE 0 END DESC,fr.updated_at DESC,fr.id DESC LIMIT 1) f JOIN admission_document_checklist_items d ON d.admission_case_id=c.id AND d.document_type='form_1823' WHERE f.resident_id=c.resident_id AND f.status='received' AND f.exam_date<=today AND f.expiration_date>=today AND nullif(trim(f.physician_name),'') IS NOT NULL AND d.received_at IS NOT NULL AND nullif(trim(d.notes),'') IS NOT NULL AND f.deleted_at IS NULL AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'Current Form 1823 and verified evidence are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=c.resident_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF r.gender IS NULL OR r.date_of_birth IS NULL THEN RAISE EXCEPTION 'Complete resident date of birth and gender before confirming arrival'; END IF;
 SELECT * INTO STRICT b FROM beds WHERE id=c.bed_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF b.reserved_for_admission_case_id IS NOT NULL AND b.reserved_for_admission_case_id<>c.id THEN RAISE EXCEPTION 'The selected bed is reserved for another admission'; END IF;
 IF b.current_resident_id IS NOT NULL AND b.current_resident_id<>r.id THEN RAISE EXCEPTION 'The selected bed is occupied by another resident'; END IF;
 IF b.status NOT IN('available','hold','occupied') THEN RAISE EXCEPTION 'The bed is unavailable for arrival'; END IF;
 UPDATE residents SET status='active',admission_date=p_arrival_date,bed_id=b.id,updated_by=p_actor_id WHERE id=r.id;
 UPDATE beds SET status='occupied',current_resident_id=r.id,reserved_for_admission_case_id=NULL,updated_by=p_actor_id WHERE id=b.id;
 UPDATE admission_cases SET status='move_in',actual_arrival_at=p_arrival_date::timestamptz,updated_by=p_actor_id WHERE id=c.id;
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date) TO service_role;

ALTER TABLE care_plans ADD COLUMN creation_request_hash text;
CREATE OR REPLACE FUNCTION public.create_care_plan_revision_review(p_id uuid,p_resident_id uuid,p_previous_id uuid,p_effective date,p_review date,p_notes text,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r residents%ROWTYPE; previous care_plans%ROWTYPE; item jsonb; position integer:=0;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Clinical plan author role required'; END IF;
 IF p_effective IS NULL OR p_review<p_effective OR p_review IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<1 THEN RAISE EXCEPTION 'Effective date, review date and care needs are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM care_plans WHERE id=p_id AND resident_id=r.id AND created_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM care_plans WHERE id=p_id AND creation_request_hash=md5(jsonb_build_object('resident',p_resident_id,'previous',p_previous_id,'effective',p_effective,'review',p_review,'notes',p_notes,'items',p_items)::text)) THEN RAISE EXCEPTION 'This care-plan request was saved with different content. Reload before revising'; END IF;
  RETURN p_id;
 END IF;
 IF p_previous_id IS NULL AND EXISTS(SELECT 1 FROM care_plans WHERE resident_id=r.id AND deleted_at IS NULL AND status<>'archived') THEN RAISE EXCEPTION 'Open the existing care plan to create a revision'; END IF;
 IF p_previous_id IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM care_plans WHERE id=p_previous_id AND resident_id=r.id AND deleted_at IS NULL;
  IF previous.status='archived' THEN RAISE EXCEPTION 'Open the current care-plan version to revise it'; END IF;
  IF EXISTS(SELECT 1 FROM care_plans WHERE previous_version_id=previous.id AND status IN('draft','under_review') AND deleted_at IS NULL) THEN RAISE EXCEPTION 'A revision is already awaiting clinical review'; END IF;
 END IF;
 INSERT INTO care_plans(id,resident_id,facility_id,organization_id,version,status,effective_date,review_due_date,notes,previous_version_id,created_by,creation_request_hash)
 VALUES(p_id,r.id,r.facility_id,r.organization_id,coalesce(previous.version,0)+1,'under_review',p_effective,p_review,p_notes,p_previous_id,auth.uid(),md5(jsonb_build_object('resident',p_resident_id,'previous',p_previous_id,'effective',p_effective,'review',p_review,'notes',p_notes,'items',p_items)::text));
 FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  IF nullif(trim(item->>'title'),'') IS NULL OR nullif(trim(item->>'description'),'') IS NULL THEN RAISE EXCEPTION 'Every care need requires a title and description'; END IF;
  INSERT INTO care_plan_items(care_plan_id,resident_id,facility_id,organization_id,category,title,description,assistance_level,frequency,goal,interventions,special_instructions,sort_order,created_by)
  VALUES(p_id,r.id,r.facility_id,r.organization_id,(item->>'category')::care_plan_item_category,item->>'title',item->>'description',(item->>'assistance_level')::assistance_level,item->>'frequency',item->>'goal',ARRAY(SELECT jsonb_array_elements_text(item->'interventions')),item->>'special_instructions',position,auth.uid());
  position:=position+1;
 END LOOP;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.create_care_plan_revision_review(uuid,uuid,uuid,date,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_care_plan_revision_review(uuid,uuid,uuid,date,date,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.archive_replaced_care_plan_review() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='active' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.previous_version_id IS NOT NULL THEN PERFORM 1 FROM residents WHERE id=NEW.resident_id FOR UPDATE; UPDATE care_plans SET status='archived',updated_by=NEW.approved_by WHERE resident_id=NEW.resident_id AND id<>NEW.id AND (status='active' OR id=NEW.previous_version_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_archive_replaced_care_plan_review BEFORE UPDATE ON care_plans FOR EACH ROW EXECUTE FUNCTION public.archive_replaced_care_plan_review();

ALTER TABLE emergency_checklist_items ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);
CREATE OR REPLACE FUNCTION public.complete_emergency_checklist_review(p_id uuid,p_item_id uuid,p_participants text[],p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE item emergency_checklist_items%ROWTYPE; today date;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 SELECT * INTO STRICT item FROM emergency_checklist_items WHERE id=p_item_id AND deleted_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM emergency_checklist_completions WHERE id=p_id AND completed_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM emergency_checklist_completions WHERE id=p_id AND checklist_item_id=p_item_id AND participants IS NOT DISTINCT FROM p_participants AND notes IS NOT DISTINCT FROM p_notes) THEN RAISE EXCEPTION 'Completion already recorded with different evidence. Reload before continuing'; END IF;
  RETURN p_id;
 END IF;
 SELECT (now() AT TIME ZONE coalesce(timezone,'America/New_York'))::date INTO today FROM facilities WHERE id=item.facility_id;
 INSERT INTO emergency_checklist_completions(id,checklist_item_id,facility_id,organization_id,completed_by,participants,notes) VALUES(p_id,item.id,item.facility_id,item.organization_id,auth.uid(),p_participants,p_notes);
 UPDATE emergency_checklist_items SET last_completed_at=now(),last_completed_by=auth.uid(),last_participants=p_participants,last_notes=p_notes,next_due_date=today+item.frequency_days WHERE id=item.id;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_emergency_checklist_review(uuid,uuid,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_emergency_checklist_review(uuid,uuid,text[],text) TO authenticated;

ALTER TABLE maintenance_task_completions ADD COLUMN resolves_ticket boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.complete_maintenance_work_review(p_id uuid,p_payload jsonb,p_resolve_ticket boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE completion maintenance_task_completions%ROWTYPE; ticket maintenance_tickets%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in again'; END IF;
 completion:=jsonb_populate_record(NULL::maintenance_task_completions,p_payload);
 IF EXISTS(SELECT 1 FROM maintenance_task_completions WHERE id=p_id AND created_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM maintenance_task_completions WHERE id=p_id AND facility_id=completion.facility_id AND organization_id=completion.organization_id AND task_type=completion.task_type AND notes IS NOT DISTINCT FROM completion.notes AND related_ticket_id IS NOT DISTINCT FROM completion.related_ticket_id AND completed_by_vendor IS NOT DISTINCT FROM completion.completed_by_vendor AND resolves_ticket=coalesce(p_resolve_ticket,false)) THEN RAISE EXCEPTION 'Maintenance completion already recorded with different evidence. Reload before continuing'; END IF;
  RETURN p_id;
 END IF;
 IF completion.related_ticket_id IS NOT NULL THEN
  SELECT * INTO STRICT ticket FROM maintenance_tickets WHERE id=completion.related_ticket_id AND facility_id=completion.facility_id AND organization_id=completion.organization_id AND deleted_at IS NULL FOR UPDATE;
  IF p_resolve_ticket AND ticket.status='cancelled' THEN RAISE EXCEPTION 'A cancelled ticket cannot be completed'; END IF;
 END IF;
 INSERT INTO maintenance_task_completions(id,facility_id,organization_id,task_type,completed_by_user_id,completed_by_vendor,notes,related_ticket_id,created_by,resolves_ticket)
 VALUES(p_id,completion.facility_id,completion.organization_id,completion.task_type,CASE WHEN completion.completed_by_vendor IS NULL THEN auth.uid() END,completion.completed_by_vendor,completion.notes,completion.related_ticket_id,auth.uid(),coalesce(p_resolve_ticket,false));
 IF p_resolve_ticket AND ticket.id IS NOT NULL THEN UPDATE maintenance_tickets SET status='completed',closed_at=now(),resolution_notes=completion.notes,updated_by=auth.uid() WHERE id=ticket.id; END IF;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_maintenance_work_review(uuid,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_maintenance_work_review(uuid,jsonb,boolean) TO authenticated;

ALTER TABLE resident_medications ADD COLUMN creation_request_hash text;
ALTER TABLE resident_medications ADD COLUMN previous_medication_id uuid REFERENCES resident_medications(id);
CREATE OR REPLACE FUNCTION public.save_medication_order_review(p_id uuid,p_resident_id uuid,p_previous_id uuid,p_action text,p_reason text,p_order jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r residents%ROWTYPE; previous resident_medications%ROWTYPE; m resident_medications%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Authorized clinical order role required'; END IF;
 IF nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Order evidence or change reason is required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=p_resident_id AND deleted_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM resident_medications WHERE id=p_id AND resident_id=r.id AND created_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM resident_medications WHERE id=p_id AND creation_request_hash=md5(jsonb_build_object('previous',p_previous_id,'action',p_action,'reason',p_reason,'order',p_order)::text)) THEN RAISE EXCEPTION 'This medication request was saved with different content. Reload the order before revising'; END IF;
  RETURN p_id;
 END IF;
 IF p_previous_id IS NOT NULL THEN SELECT * INTO STRICT previous FROM resident_medications WHERE id=p_previous_id AND resident_id=r.id AND deleted_at IS NULL FOR UPDATE; END IF;
 IF p_action='discontinue' THEN
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Choose an existing medication'; END IF;
  UPDATE resident_medications SET status='discontinued',discontinued_date=current_date,discontinued_reason=p_reason,discontinued_by=auth.uid(),updated_by=auth.uid() WHERE id=previous.id;
  RETURN previous.id;
 END IF;
 IF p_action<>'save' THEN RAISE EXCEPTION 'Unsupported order action'; END IF;
 IF previous.id IS NOT NULL AND previous.status<>'active' THEN RAISE EXCEPTION 'Refresh before revising this inactive order'; END IF;
 m:=jsonb_populate_record(previous,p_order);
 IF nullif(trim(m.medication_name),'') IS NULL OR nullif(trim(m.strength),'') IS NULL OR nullif(trim(m.prescriber_name),'') IS NULL OR nullif(trim(m.instructions),'') IS NULL OR m.order_date IS NULL OR m.start_date IS NULL THEN RAISE EXCEPTION 'Medication, dose/strength, instructions, prescriber and dates are required'; END IF;
 IF m.frequency<>'prn' AND coalesce(array_length(m.scheduled_times,1),0)=0 THEN RAISE EXCEPTION 'Scheduled orders require explicit administration times'; END IF;
 IF m.frequency='prn' AND nullif(trim(m.prn_max_frequency),'') IS NULL THEN RAISE EXCEPTION 'PRN order restrictions are required'; END IF;
 INSERT INTO resident_medications(id,resident_id,facility_id,organization_id,medication_name,generic_name,strength,form,route,frequency,frequency_detail,scheduled_times,instructions,indication,prescriber_name,prescriber_phone,pharmacy_name,order_date,start_date,end_date,controlled_schedule,status,order_source,order_document_id,prn_reason,prn_max_frequency,prn_effectiveness_check_minutes,previous_medication_id,created_by,witness_required,geofence_enforced,creation_request_hash)
 VALUES(p_id,r.id,r.facility_id,r.organization_id,m.medication_name,m.generic_name,m.strength,m.form,m.route,m.frequency,m.frequency_detail,m.scheduled_times,m.instructions,m.indication,m.prescriber_name,m.prescriber_phone,m.pharmacy_name,m.order_date,m.start_date,m.end_date,m.controlled_schedule,'active',p_reason,m.order_document_id,m.prn_reason,m.prn_max_frequency,m.prn_effectiveness_check_minutes,previous.id,auth.uid(),coalesce(m.witness_required,false) OR m.controlled_schedule<>'non_controlled',coalesce(m.geofence_enforced,true),md5(jsonb_build_object('previous',p_previous_id,'action',p_action,'reason',p_reason,'order',p_order)::text));
 IF previous.id IS NOT NULL THEN UPDATE resident_medications SET status='discontinued',discontinued_date=current_date,discontinued_reason='Superseded: '||p_reason,discontinued_by=auth.uid(),updated_by=auth.uid() WHERE id=previous.id; END IF;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_medication_order_review(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_medication_order_review(uuid,uuid,uuid,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_verbal_order_review(p_id uuid,p_action text,p_evidence text,p_signed_date date,p_medication_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE o verbal_orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse') OR nullif(trim(p_evidence),'') IS NULL THEN RAISE EXCEPTION 'Clinical authorization and evidence are required'; END IF;
 SELECT * INTO STRICT o FROM verbal_orders WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
 IF p_action='signature' THEN
  IF p_signed_date IS NULL OR p_signed_date>current_date THEN RAISE EXCEPTION 'An actual physician signature date is required'; END IF;
  UPDATE verbal_orders SET cosignature_status='signed',cosigned_by=auth.uid(),cosigned_at=now(),physician_signed_date=p_signed_date,implementation_notes=concat_ws(E'\n',implementation_notes,'Signature evidence: '||p_evidence),updated_by=auth.uid() WHERE id=o.id;
 ELSIF p_action='implementation' THEN
  IF o.order_type IN('new_medication','dose_change','frequency_change','discontinue') AND NOT EXISTS(SELECT 1 FROM resident_medications m WHERE m.id=p_medication_id AND m.resident_id=o.resident_id AND m.facility_id=o.facility_id AND m.deleted_at IS NULL AND ((o.order_type='discontinue' AND m.status='discontinued') OR (o.order_type<>'discontinue' AND m.status='active'))) THEN RAISE EXCEPTION 'Choose the resulting medication order in the expected state'; END IF;
  UPDATE verbal_orders SET implemented=true,implemented_by=auth.uid(),implemented_at=now(),linked_medication_id=p_medication_id,implementation_notes=concat_ws(E'\n',implementation_notes,'Implementation evidence: '||p_evidence),updated_by=auth.uid() WHERE id=o.id;
 ELSE RAISE EXCEPTION 'Unsupported order review action'; END IF;
 RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION public.record_verbal_order_review(uuid,text,text,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_verbal_order_review(uuid,text,text,date,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_caregiver_emar_review(p_request_id uuid,p_medication_id uuid,p_scheduled_at timestamptz,p_status text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE m resident_medications%ROWTYPE; existing emar_records%ROWTYPE; scheduled timestamptz; local_scheduled timestamp; tz text; result uuid;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse','caregiver','med_tech') OR p_status NOT IN('given','refused') THEN RAISE EXCEPTION 'Medication documentation authorization required'; END IF;
 SELECT * INTO STRICT m FROM resident_medications WHERE id=p_medication_id AND deleted_at IS NULL;
 IF m.status<>'active' THEN RAISE EXCEPTION 'The medication order is no longer active'; END IF;
 IF EXISTS(SELECT 1 FROM emar_records WHERE id=p_request_id AND administered_by=auth.uid()) THEN
  IF NOT EXISTS(SELECT 1 FROM emar_records WHERE id=p_request_id AND resident_medication_id=m.id AND status::text=p_status AND (m.frequency='prn' OR scheduled_time=p_scheduled_at) AND (p_status<>'refused' OR refusal_reason IS NOT DISTINCT FROM trim(p_reason)) AND (m.frequency<>'prn' OR prn_reason_given IS NOT DISTINCT FROM trim(p_reason))) THEN RAISE EXCEPTION 'This dose request was already saved with different content. Refresh the MAR before correcting'; END IF;
  RETURN p_request_id;
 END IF;
 IF (m.frequency='prn' OR p_status='refused') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'An indication or refusal reason is required'; END IF;
 IF p_status='given' THEN
  IF m.witness_required OR m.controlled_schedule<>'non_controlled' THEN RAISE EXCEPTION 'Use the witnessed medication pass with an authorized medication operator for this order'; END IF;
  IF EXISTS(SELECT 1 FROM pre_pass_holds h WHERE h.resident_id=m.resident_id AND h.active AND (h.resident_medication_id IS NULL OR h.resident_medication_id=m.id)) THEN RAISE EXCEPTION 'An active hold requires nurse resolution'; END IF;
 END IF;
 scheduled:=CASE WHEN m.frequency='prn' THEN now() ELSE p_scheduled_at END;
 IF scheduled IS NULL THEN RAISE EXCEPTION 'Scheduled administration time is required'; END IF;
 SELECT timezone INTO tz FROM facilities WHERE id=m.facility_id;
 local_scheduled:=scheduled AT TIME ZONE coalesce(tz,'America/New_York');
 IF m.frequency<>'prn' AND NOT EXISTS(SELECT 1 FROM emar_records WHERE resident_medication_id=m.id AND scheduled_time=scheduled AND status='scheduled' AND deleted_at IS NULL) THEN
  IF local_scheduled::date<m.start_date OR local_scheduled::date>(now() AT TIME ZONE coalesce(tz,'America/New_York'))::date OR (m.end_date IS NOT NULL AND local_scheduled::date>m.end_date) OR NOT coalesce(local_scheduled::time=ANY(m.scheduled_times),false) THEN RAISE EXCEPTION 'Scheduled time must match the prescribed medication schedule'; END IF;
  IF (m.frequency='weekly' AND (local_scheduled::date-m.start_date)%7<>0) OR (m.frequency='biweekly' AND (local_scheduled::date-m.start_date)%14<>0) OR (m.frequency='monthly' AND extract(day FROM local_scheduled)<>extract(day FROM m.start_date)) THEN RAISE EXCEPTION 'Scheduled date must match the prescribed medication frequency'; END IF;
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(m.id::text||'|'||extract(epoch FROM scheduled)::text,0));
 IF m.frequency<>'prn' THEN
  SELECT * INTO existing FROM emar_records WHERE resident_medication_id=m.id AND scheduled_time=scheduled AND NOT is_prn AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF existing.id IS NOT NULL AND existing.status<>'scheduled' THEN RAISE EXCEPTION 'This scheduled dose has already been resolved. Refresh the queue'; END IF;
 END IF;
 IF existing.id IS NOT NULL THEN
  UPDATE emar_records SET status=p_status::emar_status,actual_time=now(),administered_by=auth.uid(),refusal_reason=CASE WHEN p_status='refused' THEN trim(p_reason) END,updated_by=auth.uid() WHERE id=existing.id RETURNING id INTO result;
 ELSE
  INSERT INTO emar_records(id,resident_id,resident_medication_id,facility_id,organization_id,scheduled_time,actual_time,status,administered_by,is_prn,prn_reason_given,refusal_reason,created_by)
  VALUES(p_request_id,m.resident_id,m.id,m.facility_id,m.organization_id,scheduled,now(),p_status::emar_status,auth.uid(),m.frequency='prn',CASE WHEN m.frequency='prn' THEN trim(p_reason) END,CASE WHEN p_status='refused' THEN trim(p_reason) END,auth.uid()) RETURNING id INTO result;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_caregiver_emar_review(uuid,uuid,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_caregiver_emar_review(uuid,uuid,timestamptz,text,text) TO authenticated;

-- Every caller shares the medication safety boundary, including direct Data API writes.
CREATE OR REPLACE FUNCTION public.guard_emar_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE m resident_medications%ROWTYPE; local_scheduled timestamp; tz text; generated boolean:=false;
BEGIN
 SELECT * INTO STRICT m FROM resident_medications WHERE id=NEW.resident_medication_id AND deleted_at IS NULL;
 IF NEW.organization_id<>m.organization_id OR NEW.facility_id<>m.facility_id OR NEW.resident_id<>m.resident_id OR NEW.is_prn IS DISTINCT FROM (m.frequency='prn') THEN RAISE EXCEPTION 'Medication record scope does not match its order'; END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'scheduled' AND current_user NOT IN('postgres','service_role') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time OR NEW.resident_medication_id IS DISTINCT FROM OLD.resident_medication_id OR NEW.resident_id IS DISTINCT FROM OLD.resident_id OR NEW.administered_by IS DISTINCT FROM OLD.administered_by OR NEW.actual_time IS DISTINCT FROM OLD.actual_time OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.witness_signature_id IS DISTINCT FROM OLD.witness_signature_id) THEN RAISE EXCEPTION 'Resolved medication corrections require the authorized correction service' USING ERRCODE='42501'; END IF;
 IF NEW.status='scheduled' THEN
  IF current_user NOT IN('postgres','service_role') AND (TG_OP='INSERT' OR OLD.status<>'scheduled' OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time OR NEW.resident_medication_id IS DISTINCT FROM OLD.resident_medication_id) THEN RAISE EXCEPTION 'Scheduled doses must be generated from authorized orders'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.status=OLD.status AND NEW.scheduled_time=OLD.scheduled_time AND NEW.resident_medication_id=OLD.resident_medication_id AND NEW.resident_id=OLD.resident_id AND NEW.facility_id=OLD.facility_id AND NEW.organization_id=OLD.organization_id AND NEW.administered_by IS NOT DISTINCT FROM OLD.administered_by AND NEW.actual_time IS NOT DISTINCT FROM OLD.actual_time AND NEW.is_prn IS NOT DISTINCT FROM OLD.is_prn AND NEW.witness_signature_id IS NOT DISTINCT FROM OLD.witness_signature_id AND NEW.med_pass_id IS NOT DISTINCT FROM OLD.med_pass_id THEN RETURN NEW; END IF;

 IF NEW.administered_by IS NULL OR (current_user NOT IN('postgres','service_role') AND NEW.administered_by IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'Medication author must be the authenticated operator'; END IF;
 IF NEW.status='given' AND m.status<>'active' THEN RAISE EXCEPTION 'The medication order is not active'; END IF;
 IF NOT NEW.is_prn THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(m.id::text||'|'||extract(epoch FROM NEW.scheduled_time)::text,0));
  IF EXISTS(SELECT 1 FROM emar_records e WHERE e.resident_medication_id=m.id AND e.scheduled_time=NEW.scheduled_time AND NOT e.is_prn AND e.deleted_at IS NULL AND e.status<>'scheduled' AND e.id<>NEW.id) THEN RAISE EXCEPTION 'This scheduled dose has already been resolved. Refresh the queue'; END IF;
  IF TG_OP='UPDATE' THEN generated:=OLD.status='scheduled' AND OLD.scheduled_time=NEW.scheduled_time AND OLD.resident_medication_id=m.id; END IF;
  SELECT timezone INTO tz FROM facilities WHERE id=m.facility_id;
  local_scheduled:=NEW.scheduled_time AT TIME ZONE coalesce(tz,'America/New_York');
  IF NOT generated AND NOT coalesce(local_scheduled::time=ANY(m.scheduled_times),false) THEN RAISE EXCEPTION 'Scheduled time must match the prescribed medication schedule'; END IF;
 END IF;
 IF NEW.status='given' THEN
  IF EXISTS(SELECT 1 FROM pre_pass_holds WHERE resident_id=m.resident_id AND active AND (resident_medication_id IS NULL OR resident_medication_id=m.id)) THEN RAISE EXCEPTION 'An active hold requires nurse resolution'; END IF;
  IF m.witness_required OR m.controlled_schedule<>'non_controlled' THEN
   IF NOT EXISTS(SELECT 1 FROM witness_signatures w WHERE w.id=NEW.witness_signature_id AND w.med_pass_id=NEW.med_pass_id AND w.witness_user_id<>NEW.administered_by AND w.organization_id=m.organization_id AND w.facility_id=m.facility_id AND w.signed_at>=now()-interval '5 minutes') THEN RAISE EXCEPTION 'An independent authenticated witness signature is required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_emar_review BEFORE INSERT OR UPDATE ON emar_records FOR EACH ROW EXECUTE FUNCTION public.guard_emar_review();
CREATE POLICY "Med tech resolves pending medication records" ON emar_records FOR UPDATE TO authenticated
USING(haven.app_role()='med_tech' AND status='scheduled' AND organization_id=haven.organization_id() AND facility_id IN(SELECT haven.accessible_facility_ids()))
WITH CHECK(administered_by=auth.uid() AND organization_id=haven.organization_id() AND facility_id IN(SELECT haven.accessible_facility_ids()));

-- Reserving a case must reserve the actual bed in the same transaction.
ALTER TABLE beds ADD COLUMN reserved_for_admission_case_id uuid REFERENCES admission_cases(id);
CREATE OR REPLACE FUNCTION public.reserve_admission_bed_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target beds%ROWTYPE;
BEGIN
 IF OLD.bed_id IS NOT NULL AND (NEW.bed_id IS DISTINCT FROM OLD.bed_id OR NEW.status::text IN('cancelled','closed')) THEN
  UPDATE beds SET status='available',reserved_for_admission_case_id=NULL,updated_by=NEW.updated_by WHERE id=OLD.bed_id AND reserved_for_admission_case_id=OLD.id AND status='hold' AND current_resident_id IS NULL;
 END IF;
 IF NEW.status='bed_reserved' AND (OLD.status IS DISTINCT FROM NEW.status OR NEW.bed_id IS DISTINCT FROM OLD.bed_id) THEN
  IF NEW.actual_arrival_at IS NOT NULL THEN RAISE EXCEPTION 'Arrival already recorded; use the resident transfer workflow for bed changes'; END IF;
  IF NEW.bed_id IS NULL OR NEW.financial_clearance_at IS NULL OR NEW.physician_orders_received_at IS NULL THEN RAISE EXCEPTION 'Bed reservation requires financial and physician-order clearance'; END IF;
  SELECT * INTO STRICT target FROM beds WHERE id=NEW.bed_id AND facility_id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR UPDATE;
  IF target.current_resident_id IS NOT NULL OR (target.status<>'available' AND target.reserved_for_admission_case_id IS DISTINCT FROM NEW.id) THEN RAISE EXCEPTION 'This bed is no longer available for reservation'; END IF;
  UPDATE beds SET status='hold',reserved_for_admission_case_id=NEW.id,updated_by=NEW.updated_by WHERE id=target.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_reserve_admission_bed_review BEFORE UPDATE ON admission_cases FOR EACH ROW EXECUTE FUNCTION public.reserve_admission_bed_review();

CREATE OR REPLACE FUNCTION public.close_outbreak_review(p_id uuid,p_status text,p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE outbreak infection_outbreaks%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR coalesce(haven.app_role()::text,'') NOT IN('owner','org_admin','facility_admin','nurse') OR coalesce(p_status,'') NOT IN('contained','resolved') OR nullif(trim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Clinical review and evidence are required'; END IF;
 SELECT * INTO STRICT outbreak FROM infection_outbreaks WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
 IF p_status='resolved' AND (EXISTS(SELECT 1 FROM infection_surveillance WHERE outbreak_id=p_id AND status IN('suspected','confirmed') AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM outbreak_actions WHERE outbreak_id=p_id AND status IN('pending','in_progress') AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Resolve active cases and complete the outbreak action checklist before closing'; END IF;
 UPDATE infection_outbreaks SET status=p_status,contained_at=CASE WHEN p_status='contained' THEN now() ELSE contained_at END,resolved_at=CASE WHEN p_status='resolved' THEN now() ELSE resolved_at END,resolved_by=CASE WHEN p_status='resolved' THEN auth.uid() ELSE resolved_by END,notes=concat_ws(E'\n',notes,p_notes),updated_by=auth.uid() WHERE id=p_id;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.close_outbreak_review(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_outbreak_review(uuid,text,text) TO authenticated;
