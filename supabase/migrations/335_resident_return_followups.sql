-- Persist the existing hospital-return document reminder with the presence event.
-- This records workflow follow-up, never physician approval or admission clearance.
CREATE TABLE public.resident_return_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 resident_id uuid NOT NULL REFERENCES public.residents(id),
 history_id uuid NOT NULL UNIQUE REFERENCES public.resident_status_history(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 target_forms jsonb NOT NULL CHECK(jsonb_typeof(target_forms)='array'),
 observed_forms jsonb NOT NULL CHECK(jsonb_typeof(observed_forms)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid REFERENCES public.user_profiles(id),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 last_attempt_at timestamptz,
 last_attempt_by uuid REFERENCES public.user_profiles(id),
 result_code text NOT NULL DEFAULT 'not_attempted',
 result_json jsonb NOT NULL DEFAULT '{}',
 completed_at timestamptz,
 completed_by uuid REFERENCES public.user_profiles(id),
 completion_kind text CHECK(completion_kind IN ('automatic_renewal','human_review')),
 completion_evidence jsonb,
 CHECK((status='pending' AND completed_at IS NULL AND completed_by IS NULL AND completion_kind IS NULL AND completion_evidence IS NULL)
   OR (status='completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL AND completion_kind IS NOT NULL AND completion_evidence IS NOT NULL))
);
CREATE INDEX resident_return_followups_pending ON public.resident_return_followups(facility_id,resident_id,created_at DESC) WHERE status='pending';
ALTER TABLE public.resident_return_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resident_return_followups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.resident_return_followups TO authenticated;
CREATE POLICY resident_return_followups_read ON public.resident_return_followups FOR SELECT TO authenticated USING (
 organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids())
 AND (SELECT haven.app_role())<>'family'
 AND EXISTS(SELECT 1 FROM public.residents r WHERE r.id=resident_return_followups.resident_id AND r.organization_id=resident_return_followups.organization_id
   AND r.facility_id=resident_return_followups.facility_id AND r.deleted_at IS NULL)
);
CREATE FUNCTION haven.guard_return_followup() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN
  RAISE EXCEPTION 'Resident return follow-up evidence cannot be deleted' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','attempt_count','last_attempt_at','last_attempt_by','result_code','result_json','completed_at','completed_by','completion_kind','completion_evidence'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','last_attempt_at','last_attempt_by','result_code','result_json','completed_at','completed_by','completion_kind','completion_evidence'])
     OR OLD.status='completed') THEN
  RAISE EXCEPTION 'Return identity, captured targets and completed evidence are immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_return_followup() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_return_followup_guard BEFORE UPDATE OR DELETE ON public.resident_return_followups
 FOR EACH ROW EXECUTE FUNCTION haven.guard_return_followup();
CREATE TRIGGER tr_return_followup_no_truncate BEFORE TRUNCATE ON public.resident_return_followups
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_return_followup();
CREATE TRIGGER tr_return_followup_audit AFTER INSERT OR UPDATE ON public.resident_return_followups
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE FUNCTION haven.capture_resident_return_followup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_history uuid; v_targets jsonb; v_observed jsonb;
BEGIN
 IF OLD.status='hospital_hold' AND NEW.status='active' AND NEW.deleted_at IS NULL THEN
  SELECT h.id INTO v_history FROM public.resident_status_history h
   WHERE h.resident_id=NEW.id AND h.organization_id=NEW.organization_id AND h.facility_id=NEW.facility_id
    AND h.status='active' AND h.effective_to IS NULL AND h.deleted_at IS NULL;
  IF v_history IS NULL THEN RAISE EXCEPTION 'Return status history was not captured'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id) FILTER(WHERE d.status IN ('received','pending','renewal_due')),'[]'),
   coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) INTO v_targets,v_observed FROM public.form_1823_records d
   WHERE d.resident_id=NEW.id AND d.organization_id=NEW.organization_id AND d.facility_id=NEW.facility_id
    AND d.deleted_at IS NULL;
  INSERT INTO public.resident_return_followups(organization_id,facility_id,resident_id,history_id,target_forms,observed_forms,created_by)
   VALUES(NEW.organization_id,NEW.facility_id,NEW.id,v_history,v_targets,v_observed,haven.authorized_user_id());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.capture_resident_return_followup() FROM PUBLIC,anon,authenticated,service_role;
-- PostgreSQL runs same-event triggers alphabetically: status history first.
CREATE TRIGGER tr_residents_status_return_followup AFTER UPDATE OF status ON public.residents
 FOR EACH ROW EXECUTE FUNCTION haven.capture_resident_return_followup();

-- Lock live authorization records, then resolve the signed actor again after waits.
-- Clinical roles are intentionally narrower than the legacy document UPDATE policy.
CREATE FUNCTION haven.assert_return_followup_actor(p_org uuid,p_facility uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor record; v_session uuid;
BEGIN
 SELECT * INTO v_actor FROM haven.current_authorized_actor();
 IF v_actor.actor_user_id IS NULL THEN RAISE EXCEPTION 'Current clinical authorization required' USING ERRCODE='42501'; END IF;
 v_session:=(auth.jwt()->>'session_id')::uuid;
 PERFORM 1 FROM public.facilities f WHERE f.id=p_facility AND f.organization_id=p_org AND f.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current facility authorization required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_facility_access a WHERE a.user_id=v_actor.actor_user_id AND a.organization_id=p_org AND a.facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN auth.sessions s ON s.user_id=p.id
  WHERE p.id=v_actor.actor_user_id AND s.id=v_session FOR SHARE OF p,u,s;
 SELECT * INTO v_actor FROM haven.current_authorized_actor();
 IF v_actor.actor_user_id IS NULL OR v_actor.actor_organization_id IS DISTINCT FROM p_org
   OR v_actor.actor_role_text NOT IN ('owner','org_admin','facility_admin','nurse')
   OR NOT EXISTS(SELECT 1 FROM haven.accessible_facility_ids() id WHERE id=p_facility) THEN
  RAISE EXCEPTION 'Current clinical facility authorization required' USING ERRCODE='42501';
 END IF;
 RETURN v_actor.actor_user_id;
END $$;
REVOKE ALL ON FUNCTION haven.assert_return_followup_actor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.return_followup_result(p public.resident_return_followups,p_outcome text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'status',p.status,'outcome',p_outcome,'code',p.result_code,
  'attempt_count',p.attempt_count,'completion_kind',p.completion_kind,'completion_evidence',p.completion_evidence)
$$;
REVOKE ALL ON FUNCTION haven.return_followup_result(public.resident_return_followups,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.haven_retry_return_document_followup(p_followup_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_followup public.resident_return_followups%ROWTYPE; v_resident public.residents%ROWTYPE;
 v_actor uuid; v_target jsonb; v_doc public.form_1823_records%ROWTYPE; v_code text; v_sqlstate text; v_evidence jsonb; v_updated integer;
BEGIN
 SELECT * INTO v_followup FROM public.resident_return_followups WHERE id=p_followup_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Return follow-up unavailable' USING ERRCODE='42501'; END IF;
 -- Precheck prevents unauthorized callers from holding clinical row locks.
 PERFORM 1 FROM haven.current_authorized_actor() a WHERE a.actor_organization_id=v_followup.organization_id
  AND a.actor_role_text IN ('owner','org_admin','facility_admin','nurse')
  AND EXISTS(SELECT 1 FROM haven.accessible_facility_ids() id WHERE id=v_followup.facility_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Current clinical facility authorization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_resident FROM public.residents WHERE id=v_followup.resident_id FOR UPDATE;
 SELECT * INTO v_followup FROM public.resident_return_followups WHERE id=p_followup_id FOR UPDATE;
 PERFORM 1 FROM public.form_1823_records d WHERE d.resident_id=v_followup.resident_id ORDER BY d.id FOR UPDATE;
 v_actor:=haven.assert_return_followup_actor(v_followup.organization_id,v_followup.facility_id);
 IF v_resident.deleted_at IS NOT NULL OR v_resident.organization_id<>v_followup.organization_id OR v_resident.facility_id<>v_followup.facility_id THEN
  RAISE EXCEPTION 'Resident no longer in authorized scope' USING ERRCODE='42501';
 END IF;
 IF v_followup.status='completed' THEN RETURN haven.return_followup_result(v_followup,'completed'); END IF;
 IF v_resident.status<>'active' OR NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.id=v_followup.history_id AND h.resident_id=v_followup.resident_id
   AND h.organization_id=v_followup.organization_id AND h.facility_id=v_followup.facility_id AND h.status='active' AND h.effective_to IS NULL AND h.deleted_at IS NULL) THEN
  v_code:='return_episode_changed';
 ELSIF jsonb_array_length(v_followup.target_forms)=0 THEN v_code:='no_eligible_forms';
 ELSE
  FOR v_target IN SELECT value FROM jsonb_array_elements(v_followup.target_forms) LOOP
   SELECT * INTO v_doc FROM public.form_1823_records WHERE id=(v_target->>'id')::uuid;
   IF NOT FOUND OR v_doc.deleted_at IS NOT NULL THEN v_code:='target_missing'; EXIT;
   ELSIF to_jsonb(v_doc) IS DISTINCT FROM v_target THEN v_code:='target_changed'; EXIT;
   END IF;
  END LOOP;
  IF v_code IS NULL AND EXISTS(SELECT 1 FROM public.form_1823_records d WHERE d.resident_id=v_followup.resident_id AND d.deleted_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_followup.observed_forms) o WHERE o->>'id'=d.id::text)) THEN v_code:='newer_document_present'; END IF;
  IF v_code IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_followup.observed_forms) o
   WHERE NOT EXISTS(SELECT 1 FROM public.form_1823_records d WHERE d.id=(o->>'id')::uuid AND to_jsonb(d)=o)) THEN
   v_code:='observed_document_changed';
  END IF;
 END IF;
 UPDATE public.resident_return_followups SET attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),last_attempt_by=v_actor
  WHERE id=p_followup_id RETURNING * INTO v_followup;
 IF v_code IS NOT NULL THEN
  UPDATE public.resident_return_followups SET result_code=v_code,result_json=jsonb_build_object('outcome','needs_review')
   WHERE id=p_followup_id RETURNING * INTO v_followup;
  RETURN haven.return_followup_result(v_followup,'needs_review');
 END IF;
 BEGIN
  UPDATE public.form_1823_records SET status='renewal_due',updated_by=v_actor
   WHERE id IN (SELECT (t->>'id')::uuid FROM jsonb_array_elements(v_followup.target_forms) t);
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>jsonb_array_length(v_followup.target_forms) THEN RAISE EXCEPTION 'Not all captured forms were updated'; END IF;
  IF EXISTS(SELECT 1 FROM public.form_1823_records d WHERE d.id IN(SELECT (t->>'id')::uuid FROM jsonb_array_elements(v_followup.target_forms) t)
   AND (d.status<>'renewal_due' OR d.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'Captured form renewal state was not preserved'; END IF;
  SELECT jsonb_build_object('forms',jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'updated_at',d.updated_at) ORDER BY d.id),
    'meaning','Existing hospital-return renewal reminder; not clinical approval') INTO v_evidence
   FROM public.form_1823_records d WHERE d.id IN(SELECT (t->>'id')::uuid FROM jsonb_array_elements(v_followup.target_forms) t);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE;
  UPDATE public.resident_return_followups SET result_code='document_update_failed',result_json=jsonb_build_object('outcome','retryable_error','sqlstate',v_sqlstate)
   WHERE id=p_followup_id RETURNING * INTO v_followup;
  RETURN haven.return_followup_result(v_followup,'retryable_error');
 END;
 UPDATE public.resident_return_followups SET status='completed',result_code='renewal_marked',result_json=jsonb_build_object('outcome','completed'),
  completed_at=clock_timestamp(),completed_by=v_actor,completion_kind='automatic_renewal',completion_evidence=v_evidence
  WHERE id=p_followup_id RETURNING * INTO v_followup;
 RETURN haven.return_followup_result(v_followup,'completed');
END $$;

CREATE FUNCTION public.haven_resolve_return_document_followup(p_followup_id uuid,p_form_id uuid,p_review_note text,p_form_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_followup public.resident_return_followups%ROWTYPE; v_resident public.residents%ROWTYPE;
 v_doc public.form_1823_records%ROWTYPE; v_actor uuid;
BEGIN
 IF p_form_updated_at IS NULL OR nullif(haven.rounding_trim_text(p_review_note),'') IS NULL THEN RAISE EXCEPTION 'A human review note is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_followup FROM public.resident_return_followups WHERE id=p_followup_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Return follow-up unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM haven.current_authorized_actor() a WHERE a.actor_organization_id=v_followup.organization_id
  AND a.actor_role_text IN ('owner','org_admin','facility_admin','nurse')
  AND EXISTS(SELECT 1 FROM haven.accessible_facility_ids() id WHERE id=v_followup.facility_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Current clinical facility authorization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_resident FROM public.residents WHERE id=v_followup.resident_id FOR UPDATE;
 SELECT * INTO v_followup FROM public.resident_return_followups WHERE id=p_followup_id FOR UPDATE;
 SELECT * INTO v_doc FROM public.form_1823_records WHERE id=p_form_id AND resident_id=v_followup.resident_id AND organization_id=v_followup.organization_id AND facility_id=v_followup.facility_id FOR UPDATE;
 v_actor:=haven.assert_return_followup_actor(v_followup.organization_id,v_followup.facility_id);
 IF v_resident.deleted_at IS NOT NULL OR v_resident.organization_id<>v_followup.organization_id OR v_resident.facility_id<>v_followup.facility_id THEN
  RAISE EXCEPTION 'Resident no longer in authorized scope' USING ERRCODE='42501';
 END IF;
 IF v_followup.status='completed' THEN
  IF v_followup.completion_kind='human_review'
   AND v_followup.completion_evidence->>'form_id'=p_form_id::text
   AND (v_followup.completion_evidence->>'form_updated_at')::timestamptz=p_form_updated_at
   AND v_followup.completion_evidence->>'review_note'=haven.rounding_trim_text(p_review_note) THEN
   RETURN haven.return_followup_result(v_followup,'completed');
  END IF;
  RAISE EXCEPTION 'Follow-up already completed with different evidence' USING ERRCODE='40001';
 END IF;
 IF v_doc.id IS NULL OR v_doc.deleted_at IS NOT NULL OR v_doc.resident_id<>v_followup.resident_id
   OR v_doc.organization_id<>v_followup.organization_id OR v_doc.facility_id<>v_followup.facility_id
   OR v_doc.updated_at<v_followup.created_at OR v_doc.updated_at IS DISTINCT FROM p_form_updated_at THEN
  RAISE EXCEPTION 'Select a current resident form updated since this return' USING ERRCODE='22023';
 END IF;
 UPDATE public.resident_return_followups SET status='completed',attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),last_attempt_by=v_actor,
  result_code='human_review_recorded',result_json=jsonb_build_object('outcome','completed'),completed_at=clock_timestamp(),completed_by=v_actor,completion_kind='human_review',
  completion_evidence=jsonb_build_object('form_id',v_doc.id,'form_updated_at',v_doc.updated_at,'form_status',v_doc.status,'review_note',haven.rounding_trim_text(p_review_note),
   'meaning','Human document follow-up attestation; not automatic clinical approval or admission clearance')
  WHERE id=p_followup_id RETURNING * INTO v_followup;
 RETURN haven.return_followup_result(v_followup,'completed');
END $$;
REVOKE ALL ON FUNCTION public.haven_retry_return_document_followup(uuid),public.haven_resolve_return_document_followup(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.haven_retry_return_document_followup(uuid),public.haven_resolve_return_document_followup(uuid,uuid,text,timestamptz) TO authenticated;
