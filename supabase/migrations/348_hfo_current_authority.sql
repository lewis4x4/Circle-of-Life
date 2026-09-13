BEGIN;

-- COL-133: explicit, current authority. These grants do not activate schedules,
-- approve unknown source classifications, or create evidence receipts.
ALTER TABLE public.user_facility_access ADD COLUMN operation_expires_at timestamptz;
CREATE TABLE public.operation_subject_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 user_id uuid NOT NULL REFERENCES public.user_profiles(id),
 scope text NOT NULL CHECK(scope IN('resident','employee_personnel','employee_medical','financial')),
 granted_by uuid NOT NULL REFERENCES public.user_profiles(id),
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 can_record boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX operation_subject_access_current ON public.operation_subject_access(user_id,facility_id,scope) WHERE revoked_at IS NULL;
ALTER TABLE public.operation_subject_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_subject_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.operation_subject_access TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.operation_subject_access TO service_role;
CREATE POLICY operation_subject_access_self ON public.operation_subject_access FOR SELECT TO authenticated USING(user_id=auth.uid() AND organization_id=haven.organization_id());
CREATE TRIGGER operation_subject_access_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_subject_access FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE FUNCTION haven.operation_facility_access(p_facility uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM haven.current_authorized_actor() a
 JOIN public.user_facility_access g ON g.user_id=a.actor_user_id AND g.organization_id=a.actor_organization_id
 JOIN public.facilities f ON f.id=g.facility_id AND f.organization_id=a.actor_organization_id
 WHERE a.actor_is_managed AND a.actor_app_role::text IN('housekeeper','owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
 AND g.facility_id=p_facility AND g.revoked_at IS NULL
 AND (g.operation_expires_at IS NULL OR g.operation_expires_at>clock_timestamp()) AND f.deleted_at IS NULL)
$$;
CREATE FUNCTION haven.operation_domain_access(p_org uuid,p_facility uuid,p_class text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_org=haven.organization_id() AND haven.operation_facility_access(p_facility)
 AND CASE WHEN p_class IN('facility','asset') THEN true
 WHEN p_class IN('resident','employee_personnel','employee_medical','financial') THEN EXISTS(
 SELECT 1 FROM public.operation_subject_access g WHERE g.user_id=auth.uid() AND g.organization_id=p_org
 AND g.facility_id=p_facility AND g.scope=p_class AND g.revoked_at IS NULL
 AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()))
 AND (p_class<>'employee_medical' OR haven.employee_medical_reader(p_org,p_facility))
 ELSE false END
$$;
CREATE FUNCTION haven.operation_subject_current(p_subject uuid,p_org uuid,p_facility uuid,p_class text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.operation_activity_subjects s
 JOIN public.facilities f ON f.id=s.facility_id AND f.organization_id=s.organization_id AND f.deleted_at IS NULL
 WHERE s.id=p_subject AND s.organization_id=p_org AND s.facility_id=p_facility
 AND CASE s.subject_kind
 WHEN 'facility' THEN p_class IN('facility','financial')
 WHEN 'resident' THEN p_class='resident' AND EXISTS(SELECT 1 FROM public.residents r WHERE r.id=s.resident_id AND r.organization_id=s.organization_id AND r.facility_id=s.facility_id AND r.deleted_at IS NULL)
 WHEN 'employee' THEN p_class IN('employee_personnel','employee_medical') AND EXISTS(SELECT 1 FROM public.staff e WHERE e.id=s.employee_id AND e.organization_id=s.organization_id AND e.facility_id=s.facility_id AND e.deleted_at IS NULL AND e.employment_status IN('active','on_leave') AND (e.termination_date IS NULL OR e.termination_date>current_date))
 WHEN 'asset' THEN p_class='asset' AND EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=s.asset_id AND a.organization_id=s.organization_id AND a.facility_id=s.facility_id AND a.deleted_at IS NULL AND a.status<>'retired')
 ELSE false END)
$$;
CREATE FUNCTION haven.operation_subject_accessible(p_subject uuid,p_org uuid,p_facility uuid,p_class text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.operation_domain_access(p_org,p_facility,p_class)
 AND haven.operation_subject_current(p_subject,p_org,p_facility,p_class)
 AND (p_class<>'employee_personnel' OR haven.employee_manager() OR EXISTS(SELECT 1 FROM public.operation_activity_subjects s JOIN public.staff e ON e.id=s.employee_id WHERE s.id=p_subject AND e.user_id=auth.uid()))
 AND (p_class<>'financial' OR haven.app_role()::text IN('owner','org_admin'))
$$;
ALTER TABLE public.operation_task_instances
 ADD COLUMN subject_id uuid REFERENCES public.operation_activity_subjects(id),
 ADD COLUMN authority_class text NOT NULL DEFAULT 'unclassified' CHECK(authority_class IN('unclassified','facility','resident','employee_personnel','employee_medical','asset','financial'));
CREATE INDEX operation_instances_subject ON public.operation_task_instances(subject_id);
-- Only catalog identities already explicitly typed as facility can be reconciled.
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind)
 SELECT DISTINCT i.organization_id,i.facility_id,'facility' FROM public.operation_task_instances i
 JOIN public.operation_activities a ON a.id=i.activity_id WHERE a.subject_kind='facility'
 ON CONFLICT DO NOTHING;
UPDATE public.operation_task_instances i SET subject_id=s.id,authority_class='facility'
 FROM public.operation_activity_subjects s,public.operation_activities a
 WHERE a.id=i.activity_id AND a.subject_kind='facility' AND s.facility_id=i.facility_id AND s.organization_id=i.organization_id AND s.subject_kind='facility';

-- Template links are subject data too. Documents await classified evidence;
-- assets and vendor bookings require current native links to the exact site.
CREATE FUNCTION haven.operation_template_links_current(p_org uuid,p_facility uuid,p_document uuid,p_asset uuid,p_vendor uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_document IS NULL
 AND (p_asset IS NULL OR EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=p_asset AND a.organization_id=p_org AND a.facility_id=p_facility AND a.deleted_at IS NULL AND a.status<>'retired'))
 AND (p_vendor IS NULL OR EXISTS(SELECT 1 FROM public.vendors v JOIN public.vendor_facilities vf ON vf.vendor_id=v.id AND vf.organization_id=v.organization_id WHERE v.id=p_vendor AND v.organization_id=p_org AND v.deleted_at IS NULL AND vf.facility_id=p_facility AND vf.deleted_at IS NULL))
$$;
CREATE FUNCTION haven.operation_template_links_accessible(p_org uuid,p_facility uuid,p_document uuid,p_asset uuid,p_vendor uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_org=haven.organization_id() AND haven.operation_facility_access(p_facility)
 AND haven.operation_template_links_current(p_org,p_facility,p_document,p_asset,p_vendor)
$$;
REVOKE ALL ON FUNCTION haven.operation_template_links_current(uuid,uuid,uuid,uuid,uuid),haven.operation_template_links_accessible(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_template_links_accessible(uuid,uuid,uuid,uuid,uuid) TO authenticated;
CREATE FUNCTION haven.operation_task_readable(p_task uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.operation_task_instances t WHERE t.id=p_task AND t.deleted_at IS NULL
 AND haven.operation_subject_accessible(t.subject_id,t.organization_id,t.facility_id,t.authority_class)
 -- Raw legacy paths have no immutable classification; never expose their names or bytes.
 AND coalesce(cardinality(t.completion_evidence_paths),0)=0
 AND (t.template_id IS NULL OR EXISTS(SELECT 1 FROM public.operation_task_templates linked WHERE linked.id=t.template_id AND haven.operation_template_links_current(linked.organization_id,t.facility_id,linked.linked_document_id,linked.asset_ref,linked.vendor_booking_ref))))
$$;
CREATE FUNCTION haven.operation_task_mutable(p_task uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.operation_task_readable(p_task) AND EXISTS(SELECT 1 FROM public.operation_task_instances t WHERE t.id=p_task
 AND (t.authority_class IN('facility','asset') OR EXISTS(SELECT 1 FROM public.operation_subject_access g
 WHERE g.user_id=auth.uid() AND g.organization_id=t.organization_id AND g.facility_id=t.facility_id AND g.scope=t.authority_class AND g.can_record AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))
 AND (t.authority_class<>'resident' OR haven.app_role()::text IN('owner','org_admin','facility_admin','nurse'))
 AND (t.assigned_to=auth.uid() OR (t.assigned_to IS NULL AND t.assigned_role=haven.app_role()::text)
 OR haven.app_role()::text IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')))
$$;
CREATE FUNCTION public.haven_operation_facility_access(p_facility_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_facility_access(p_facility_id) $$;
CREATE FUNCTION haven.operation_accessible_facility_ids() RETURNS SETOF uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT f.id FROM public.facilities f WHERE haven.operation_facility_access(f.id)
$$;
REVOKE ALL ON FUNCTION haven.operation_accessible_facility_ids() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_accessible_facility_ids() TO authenticated;
CREATE FUNCTION public.haven_operation_accessible_facility_ids() RETURNS SETOF uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM haven.operation_accessible_facility_ids() $$;
CREATE FUNCTION public.haven_operation_task_access(p_task_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_task_mutable(p_task_id) $$;

CREATE FUNCTION haven.operation_activity_is_facility(p_activity uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.operation_activities WHERE id=p_activity AND organization_id=haven.organization_id() AND subject_kind='facility' AND (facility_id IS NULL OR haven.operation_facility_access(facility_id)))
$$;
REVOKE ALL ON FUNCTION haven.operation_activity_is_facility(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_activity_is_facility(uuid) TO authenticated;
-- Restrictive boundaries apply even when an older permissive policy is added.
CREATE POLICY operation_task_current_read ON public.operation_task_instances AS RESTRICTIVE FOR SELECT TO authenticated USING(haven.operation_task_readable(id));
CREATE POLICY operation_subject_current_read ON public.operation_activity_subjects FOR SELECT TO authenticated USING(
 haven.operation_subject_accessible(id,organization_id,facility_id,CASE subject_kind WHEN 'employee' THEN 'employee_personnel' ELSE subject_kind END));
GRANT SELECT ON public.operation_activity_subjects TO authenticated;
CREATE POLICY operation_audit_current_read ON public.operation_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(task_instance_id IS NOT NULL AND haven.operation_task_readable(task_instance_id));
CREATE POLICY operation_template_current_read ON public.operation_task_templates AS RESTRICTIVE FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND facility_id IS NOT NULL AND haven.operation_facility_access(facility_id)
 AND haven.operation_activity_is_facility(activity_id)
 AND haven.operation_template_links_accessible(organization_id,facility_id,linked_document_id,asset_ref,vendor_booking_ref));
CREATE POLICY operation_activity_current_read ON public.operation_activities AS RESTRICTIVE FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND (origin='admin_log' OR (subject_kind='facility' AND facility_id IS NOT NULL AND haven.operation_facility_access(facility_id))));
REVOKE INSERT,UPDATE,DELETE ON public.operation_task_instances,public.operation_audit_log FROM authenticated;
REVOKE DELETE ON public.operation_task_instances,public.operation_audit_log FROM service_role;
GRANT SELECT ON public.operation_task_instances,public.operation_audit_log,public.operation_task_templates,public.facility_assets TO authenticated;
REVOKE DELETE ON public.facility_assets,public.operation_task_templates FROM authenticated;

-- Acquire target/subject/grant locks before the final live actor snapshot.
-- All checks run in VOLATILE functions so a lock wait cannot reuse an old snapshot.
CREATE FUNCTION haven.lock_operation_authority(p_task uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; s public.operation_activity_subjects; linked public.operation_task_templates; actor record;
BEGIN
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF t.template_id IS NOT NULL THEN
 SELECT * INTO linked FROM public.operation_task_templates WHERE id=t.template_id FOR SHARE;
 IF linked.asset_ref IS NOT NULL THEN PERFORM 1 FROM public.facility_assets WHERE id=linked.asset_ref FOR SHARE; END IF;
 IF linked.vendor_booking_ref IS NOT NULL THEN
 PERFORM 1 FROM public.vendors WHERE id=linked.vendor_booking_ref FOR SHARE;
 PERFORM 1 FROM public.vendor_facilities WHERE vendor_id=linked.vendor_booking_ref AND facility_id=t.facility_id FOR SHARE;
 END IF;
 END IF;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 IF s.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=s.resident_id FOR SHARE;
 ELSIF s.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=s.employee_id FOR SHARE;
 ELSIF s.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=s.asset_id FOR SHARE; END IF;
 PERFORM 1 FROM public.facilities WHERE id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.employee_medical_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
 JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
 WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 SELECT * INTO actor FROM haven.current_authorized_actor();
 IF actor.actor_is_managed IS NOT TRUE OR NOT haven.operation_task_mutable(p_task) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION haven.guard_operation_current_authority() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.subject_id,NEW.authority_class) IS DISTINCT FROM (OLD.subject_id,OLD.authority_class) THEN
 RAISE EXCEPTION 'Operation subject classification is immutable; reconcile through an approved migration' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.authority_class<>'unclassified' AND NEW.activity_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.operation_activities a JOIN public.operation_activity_subjects subject ON subject.id=NEW.subject_id
 WHERE a.id=NEW.activity_id AND a.subject_kind IS NOT NULL AND a.subject_kind<>subject.subject_kind) THEN
 RAISE EXCEPTION 'Operation subject type does not match activity' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.authority_class<>'unclassified' AND NOT haven.operation_subject_current(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL THEN
 -- Only trusted service provisioning may supply a typed subject/classification;
 -- browser DML is revoked. Existing schedulers default to unclassified.
 -- Service jobs may create unclassified occurrences and update facility/asset
 -- scheduling, never assert human performance or complete protected subjects.
 IF (TG_OP='INSERT' AND (NEW.created_by IS NOT NULL OR NEW.updated_by IS NOT NULL OR NEW.status='completed' OR NEW.signed_by IS NOT NULL OR NEW.second_sign_by IS NOT NULL OR NEW.verified_by IS NOT NULL OR coalesce(cardinality(NEW.completion_evidence_paths),0)>0))
 OR (TG_OP='UPDATE' AND ((NEW.created_by,NEW.updated_by,NEW.signed_by,NEW.second_sign_by,NEW.verified_by,NEW.completion_notes,NEW.completion_evidence_paths,NEW.completed_at) IS DISTINCT FROM (OLD.created_by,OLD.updated_by,OLD.signed_by,OLD.second_sign_by,OLD.verified_by,OLD.completion_notes,OLD.completion_evidence_paths,OLD.completed_at) OR NEW.status='completed' OR NEW.authority_class NOT IN('unclassified','facility','asset'))) THEN
 RAISE EXCEPTION 'Authenticated operation actor required' USING ERRCODE='42501'; END IF;
 IF NEW.authority_class IN('facility','asset') AND NOT haven.operation_subject_current(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN PERFORM haven.lock_operation_authority(OLD.id);
 ELSIF NOT haven.operation_subject_accessible(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 NEW.updated_by:=auth.uid(); IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); END IF;
 IF coalesce(cardinality(NEW.completion_evidence_paths),0)>0 THEN RAISE EXCEPTION 'Classified evidence command required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_operation_current_authority BEFORE INSERT OR UPDATE ON public.operation_task_instances FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_current_authority();

CREATE OR REPLACE FUNCTION haven.complete_operation_task_review(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_notes text,p_evidence text[] DEFAULT '{}'
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  target text;
  finalizer uuid;
  v_current_role text;
  v_current_organization uuid;
BEGIN
  PERFORM haven.lock_operation_authority(p_task_id);
  IF p_actor_id IS DISTINCT FROM auth.uid() OR p_actor_role IS DISTINCT FROM haven.app_role()::text THEN
    RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  SELECT profile.app_role::text,profile.organization_id
  INTO v_current_role,v_current_organization
  FROM public.user_profiles AS profile
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
  FOR SHARE;
  IF v_current_role IS NULL OR v_current_organization IS DISTINCT FROM t.organization_id
     OR v_current_role IS DISTINCT FROM p_actor_role
     OR (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=t.facility_id AND facility.organization_id=v_current_organization AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
    END IF;
  END IF;
  IF coalesce(cardinality(p_evidence),0)>0 THEN RAISE EXCEPTION 'Classified evidence command required' USING ERRCODE='42501'; END IF;
  IF t.status='completed' THEN RETURN 'completed'; END IF;
  IF t.status NOT IN('pending','in_progress','missed','deferred') THEN RAISE EXCEPTION 'Task cannot be completed from this state'; END IF;
  IF t.signed_by IS NOT NULL AND t.requires_dual_sign THEN
    IF t.signed_by=p_actor_id THEN RAISE EXCEPTION 'A different authorized staff member must verify this task'; END IF;
    target:='completed'; finalizer:=p_actor_id;
  ELSE
    target:=CASE WHEN t.requires_dual_sign THEN 'in_progress' ELSE 'completed' END;
    finalizer:=CASE WHEN t.requires_dual_sign THEN NULL ELSE p_actor_id END;
  END IF;
  UPDATE public.operation_task_instances SET status=target,signed_by=coalesce(t.signed_by,p_actor_id),
    signed_at=coalesce(t.signed_at,now()),second_sign_by=CASE WHEN t.requires_dual_sign THEN finalizer END,
    second_signed_at=CASE WHEN t.requires_dual_sign AND finalizer IS NOT NULL THEN now() END,
    completed_at=coalesce(t.completed_at,now()),
    completion_notes=CASE WHEN t.signed_by IS NULL THEN p_notes ELSE t.completion_notes END,
    completion_evidence_paths=CASE WHEN t.signed_by IS NULL THEN p_evidence ELSE t.completion_evidence_paths END,
    verified_by=finalizer,verified_at=CASE WHEN finalizer IS NOT NULL THEN now() END,
    sla_met=(t.due_at IS NULL OR t.due_at>=coalesce(t.completed_at,now())),updated_by=p_actor_id
  WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,target,p_actor_id,v_current_role,p_notes,
    jsonb_build_object('awaiting_second_verification',finalizer IS NULL,'independent_verification',t.signed_by IS NOT NULL));
  PERFORM haven.lock_operation_authority(p_task_id);
  RETURN CASE WHEN target='in_progress' THEN 'awaiting_verification' ELSE target END;
END $$;

CREATE OR REPLACE FUNCTION haven.defer_operation_task_review(
  p_task_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_deferred_until timestamptz,
  p_cancellation_reason text,
  p_request_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  v_current_role text;
  v_current_organization uuid;
  v_reason text;
  v_request_hash text;
  v_expected_key text;
  v_replacement_id uuid;
  v_shift_date date;
  v_shift text;
BEGIN
  PERFORM haven.lock_operation_authority(p_task_id);
  IF p_actor_id IS DISTINCT FROM auth.uid() OR p_actor_role IS DISTINCT FROM haven.app_role()::text THEN
    RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;

  SELECT profile.app_role::text,profile.organization_id
  INTO v_current_role,v_current_organization
  FROM public.user_profiles AS profile
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
  FOR SHARE;
  IF v_current_role IS NULL OR v_current_organization IS DISTINCT FROM t.organization_id
     OR v_current_role IS DISTINCT FROM p_actor_role
     OR (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=t.facility_id AND facility.organization_id=v_current_organization AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  END IF;

  v_reason:=coalesce(nullif(trim(p_cancellation_reason),''),'Deferred to a later queue date');
  v_expected_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||p_actor_id::text||':'||p_task_id::text,'UTF8'
  )),'hex');
  IF p_request_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'Invalid defer request key' USING ERRCODE='22023';
  END IF;
  v_request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'task_id',p_task_id,'actor_id',p_actor_id,'deferred_until',p_deferred_until,'reason',v_reason
  )::text,'UTF8')),'hex');

  IF t.defer_request_key IS NOT NULL THEN
    IF t.defer_request_key=p_request_key AND t.defer_request_hash=v_request_hash
       AND t.deferred_replacement_task_id IS NOT NULL THEN
      RETURN jsonb_build_object('new_task_id',t.deferred_replacement_task_id,'replayed',true);
    END IF;
    RAISE EXCEPTION 'This defer request was already saved with different content. Refresh the task before retrying';
  END IF;
  IF p_deferred_until IS NULL OR p_deferred_until<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Deferred time must be in the future';
  END IF;
  IF t.status NOT IN('pending','in_progress','missed') THEN
    RAISE EXCEPTION 'Task cannot be deferred from this state';
  END IF;

  v_shift_date:=(p_deferred_until AT TIME ZONE 'America/New_York')::date;
  v_shift:=CASE
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 7 AND 14 THEN 'day'
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 15 AND 22 THEN 'evening'
    ELSE 'night'
  END;
  INSERT INTO public.operation_task_instances(
    organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,
    assigned_shift_date,assigned_shift,assigned_to,assigned_role,status,priority,license_threatening,
    estimated_minutes,requires_dual_sign,due_at,created_by,updated_by,subject_id,authority_class
  ) VALUES(
    t.organization_id,t.facility_id,t.template_id,t.template_name,t.template_category,t.template_cadence_type,
    v_shift_date,v_shift,t.assigned_to,t.assigned_role,'pending',t.priority,t.license_threatening,
    t.estimated_minutes,t.requires_dual_sign,p_deferred_until,p_actor_id,p_actor_id,t.subject_id,t.authority_class
  ) RETURNING id INTO v_replacement_id;

  UPDATE public.operation_task_instances SET
    status='deferred',deferred_until=p_deferred_until,cancellation_reason=v_reason,
    defer_request_key=p_request_key,defer_request_hash=v_request_hash,
    deferred_replacement_task_id=v_replacement_id,updated_at=now(),updated_by=p_actor_id
  WHERE id=t.id;

  INSERT INTO public.operation_audit_log(
    organization_id,facility_id,task_instance_id,event_type,from_status,to_status,
    actor_id,actor_role,event_notes,event_data
  ) VALUES(
    t.organization_id,t.facility_id,t.id,'deferred',t.status,'deferred',
    p_actor_id,v_current_role,v_reason,jsonb_build_object(
      'deferred_to',p_deferred_until,'new_task_id',v_replacement_id,'source','admin-operations',
      'request_key',p_request_key,'request_hash',v_request_hash,'receipt_version',1
    )
  );
  PERFORM haven.lock_operation_authority(p_task_id);
  RETURN jsonb_build_object('new_task_id',v_replacement_id,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.complete_operation_task_review(p_task_id uuid,p_actor_id uuid,p_actor_role text,p_notes text,p_evidence text[] DEFAULT '{}')
RETURNS text LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT haven.complete_operation_task_review(p_task_id,p_actor_id,p_actor_role,p_notes,p_evidence)
$$;
CREATE OR REPLACE FUNCTION public.defer_operation_task_review(p_task_id uuid,p_actor_id uuid,p_actor_role text,p_deferred_until timestamptz,p_cancellation_reason text,p_request_key text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT haven.defer_operation_task_review(p_task_id,p_actor_id,p_actor_role,p_deferred_until,p_cancellation_reason,p_request_key)
$$;
CREATE FUNCTION haven.operation_task_command(p_task_id uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; new_status text; event text;
BEGIN
 PERFORM haven.lock_operation_authority(p_task_id);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task_id;
 IF p_action='start' AND t.status='pending' THEN new_status:='in_progress'; event:='started';
 ELSIF p_action='reinstate' AND t.status IN('missed','deferred') THEN new_status:='pending'; event:='updated';
 ELSIF p_action='escalate' THEN RAISE EXCEPTION 'Manual escalation requires classified delivery authority' USING ERRCODE='P0001';
 ELSE RAISE EXCEPTION 'Task cannot transition from this state' USING ERRCODE='P0001'; END IF;
 UPDATE public.operation_task_instances SET status=new_status,started_at=CASE WHEN p_action='start' THEN clock_timestamp() ELSE started_at END,
 updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes)
 VALUES(t.organization_id,t.facility_id,t.id,event,t.status,new_status,auth.uid(),haven.app_role()::text,p_payload->>'reason');
 PERFORM haven.lock_operation_authority(p_task_id);
 RETURN jsonb_build_object('success',true,'status',new_status);
END $$;
CREATE FUNCTION public.haven_operation_task_command(p_task_id uuid,p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_task_command(p_task_id,p_action,p_payload) $$;

-- Linked descriptions, cached cards, deliveries and generic audit are alternate
-- identifier/count/search paths and inherit the same current task boundary.
CREATE POLICY operation_meeting_current_read ON public.meeting_action_items AS RESTRICTIVE FOR ALL TO authenticated USING(oce_task_instance_id IS NULL OR haven.operation_task_readable(oce_task_instance_id));
CREATE POLICY operation_card_current_read ON public.workspace_cards AS RESTRICTIVE FOR ALL TO authenticated USING(source_oce_instance_id IS NULL OR haven.operation_task_readable(source_oce_instance_id));
CREATE FUNCTION haven.guard_operation_link_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='workspace_cards' THEN
 IF OLD.source_oce_instance_id IS NOT NULL AND NEW.source_oce_instance_id IS DISTINCT FROM OLD.source_oce_instance_id THEN RAISE EXCEPTION 'Operation source link is immutable' USING ERRCODE='23514'; END IF;
 ELSE
 IF OLD.oce_task_instance_id IS NOT NULL AND NEW.oce_task_instance_id IS DISTINCT FROM OLD.oce_task_instance_id THEN RAISE EXCEPTION 'Operation source link is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_link_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_card_source_identity BEFORE UPDATE ON public.workspace_cards FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_link_identity();
CREATE TRIGGER operation_meeting_source_identity BEFORE UPDATE ON public.meeting_action_items FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_link_identity();
REVOKE INSERT,UPDATE,DELETE ON public.operation_escalation_deliveries FROM authenticated;
CREATE POLICY operation_delivery_current_read ON public.operation_escalation_deliveries AS RESTRICTIVE FOR SELECT TO authenticated USING(haven.operation_task_readable(task_instance_id));
CREATE POLICY operation_generic_audit_current_read ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(
 CASE WHEN table_name='operation_task_instances' THEN haven.operation_task_readable(record_id)
 AND coalesce(new_data->>'authority_class','unclassified')<>'unclassified'
 AND (old_data IS NULL OR coalesce(old_data->>'authority_class','unclassified')<>'unclassified')
 AND coalesce(new_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
 AND coalesce(old_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
 WHEN table_name IN('operation_audit_log','operation_escalation_deliveries','operation_activity_subjects','operation_subject_access') THEN false
 WHEN table_name IN('meeting_action_items','workspace_cards') THEN false ELSE true END);
CREATE POLICY operation_staffing_current_site ON public.staffing_adequacy_snapshots AS RESTRICTIVE FOR SELECT TO authenticated USING(haven.operation_facility_access(facility_id));

-- Meeting status synchronization must not turn its broader minutes role into a
-- task completion path or clear a task's historical performance facts.
CREATE OR REPLACE FUNCTION haven.sync_meeting_action_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='operation_task_instances' THEN
 UPDATE public.meeting_action_items SET status=CASE WHEN NEW.status='completed' THEN 'completed' WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END,
 updated_by=NEW.updated_by WHERE oce_task_instance_id=NEW.id AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND deleted_at IS NULL;
 ELSIF NEW.oce_task_instance_id IS NOT NULL THEN
 PERFORM haven.lock_operation_authority(NEW.oce_task_instance_id);
 RAISE EXCEPTION 'Use the authorized operations command for linked task status' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

-- Owner role alone never grants a site; lock current authority for legacy
-- template writers after lineage waits as well.
CREATE OR REPLACE FUNCTION haven.assert_operation_catalog_actor(p_org uuid,p_facility uuid,p_template boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
 JOIN auth.sessions s ON s.user_id=p.id AND s.id=nullif(auth.jwt()->>'session_id','')::uuid WHERE p.id=auth.uid() FOR SHARE OF p,u,s;
 IF p_org IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(p_facility)
 OR (p_template AND haven.app_role()::text NOT IN('owner','org_admin')) THEN RAISE EXCEPTION 'Operation catalog actor is no longer authorized' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION haven.guard_operation_template_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN PERFORM haven.assert_operation_catalog_actor(NEW.organization_id,NEW.facility_id,true); NEW.updated_by:=auth.uid(); IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); END IF; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION haven.guard_operation_template_links() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.linked_document_id,NEW.asset_ref,NEW.vendor_booking_ref) IS NOT DISTINCT FROM (OLD.linked_document_id,OLD.asset_ref,OLD.vendor_booking_ref) AND auth.uid() IS NULL THEN RETURN NEW; END IF;
 -- Pin native links before the final authority check so transfers/revocations
 -- cannot race a successful publication. Do not disclose which link failed.
 IF NEW.asset_ref IS NOT NULL THEN PERFORM 1 FROM public.facility_assets WHERE id=NEW.asset_ref FOR SHARE; END IF;
 IF NEW.vendor_booking_ref IS NOT NULL THEN
 PERFORM 1 FROM public.vendors WHERE id=NEW.vendor_booking_ref FOR SHARE;
 PERFORM 1 FROM public.vendor_facilities WHERE vendor_id=NEW.vendor_booking_ref AND facility_id=NEW.facility_id FOR SHARE;
 END IF;
 IF NOT haven.operation_template_links_current(NEW.organization_id,NEW.facility_id,NEW.linked_document_id,NEW.asset_ref,NEW.vendor_booking_ref) THEN RAISE EXCEPTION 'Template link classification required' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NOT NULL THEN PERFORM haven.assert_operation_catalog_actor(NEW.organization_id,NEW.facility_id,true); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_template_links() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_template_links BEFORE INSERT OR UPDATE ON public.operation_task_templates FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_template_links();
CREATE TRIGGER zz_operation_template_authority BEFORE INSERT OR UPDATE ON public.operation_task_templates FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_template_authority();
CREATE TRIGGER zz_operation_template_final_authority AFTER INSERT OR UPDATE ON public.operation_task_templates FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_template_authority();

REVOKE ALL ON FUNCTION public.complete_operation_task_review(uuid,uuid,text,text,text[]),public.defer_operation_task_review(uuid,uuid,text,timestamptz,text,text),
 public.bulk_complete_operation_tasks(uuid[],uuid,text,text,timestamptz),public.publish_operation_template_review(uuid,jsonb),public.create_meeting_action(uuid,uuid,text,uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Bulk recording, unclassified meeting creation, and template publication stay
-- closed until their own approved scope/version command can supply authority.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='haven' AND p.proname IN('operation_facility_access','operation_domain_access','operation_subject_current','operation_subject_accessible','operation_task_readable','operation_task_mutable','lock_operation_authority','guard_operation_current_authority','complete_operation_task_review','defer_operation_task_review','operation_task_command','guard_operation_template_authority'))
 OR (n.nspname='public' AND p.proname IN('haven_operation_facility_access','haven_operation_accessible_facility_ids','haven_operation_task_access','haven_operation_task_command')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC,anon,authenticated,service_role',fn.nspname,fn.proname,fn.args);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION haven.operation_facility_access(uuid),haven.operation_task_readable(uuid),haven.operation_task_mutable(uuid),haven.operation_subject_accessible(uuid,uuid,uuid,text),
 haven.complete_operation_task_review(uuid,uuid,text,text,text[]),haven.defer_operation_task_review(uuid,uuid,text,timestamptz,text,text),haven.operation_task_command(uuid,text,jsonb),
 public.haven_operation_facility_access(uuid),public.haven_operation_accessible_facility_ids(),public.haven_operation_task_access(uuid),public.haven_operation_task_command(uuid,text,jsonb),
 public.complete_operation_task_review(uuid,uuid,text,text,text[]),public.defer_operation_task_review(uuid,uuid,text,timestamptz,text,text) TO authenticated;

-- Assets remain native records; their old FOR ALL policy must not bypass site authority.
CREATE FUNCTION haven.attribute_operation_asset_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NOT NULL THEN NEW.updated_by:=auth.uid(); IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); END IF; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.attribute_operation_asset_actor() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_asset_actor BEFORE INSERT OR UPDATE ON public.facility_assets FOR EACH ROW EXECUTE FUNCTION haven.attribute_operation_asset_actor();
CREATE POLICY operation_assets_current_scope ON public.facility_assets AS RESTRICTIVE FOR ALL TO authenticated
 USING(haven.operation_facility_access(facility_id)) WITH CHECK(haven.operation_facility_access(facility_id));
CREATE FUNCTION haven.guard_operation_asset_authority() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.facilities WHERE id=NEW.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=NEW.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
 JOIN auth.sessions s ON s.user_id=p.id AND s.id=nullif(auth.jwt()->>'session_id','')::uuid WHERE p.id=auth.uid() FOR SHARE OF p,u,s;
 IF NOT haven.operation_facility_access(NEW.facility_id) OR NEW.organization_id IS DISTINCT FROM haven.organization_id()
 OR haven.app_role()::text NOT IN('owner','org_admin','facility_admin','manager','maintenance_role') THEN
 RAISE EXCEPTION 'Asset unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_asset_authority() FROM PUBLIC,anon,authenticated,service_role;
-- AFTER runs after row/FK waits; any denial rolls back the whole mutation/audit.
CREATE TRIGGER zz_operation_asset_authority AFTER INSERT OR UPDATE ON public.facility_assets FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_asset_authority();

ALTER TABLE public.staffing_adequacy_snapshots ADD COLUMN operation_authority_version integer;
ALTER TABLE public.risk_score_snapshots ADD COLUMN operation_authority_version integer;
ALTER TABLE public.exec_alerts ADD COLUMN operation_authority_version integer;
ALTER TABLE public.risk_owner_alert_deliveries ADD COLUMN operation_authority_version integer;
CREATE POLICY operation_staffing_current_version ON public.staffing_adequacy_snapshots AS RESTRICTIVE FOR SELECT TO authenticated USING(operation_authority_version=1 AND haven.app_role()::text IN('owner','org_admin','facility_admin','manager','nurse'));
CREATE POLICY operation_risk_current_version ON public.risk_score_snapshots AS RESTRICTIVE FOR SELECT TO authenticated USING(operation_authority_version=1 AND haven.operation_facility_access(facility_id) AND haven.app_role()::text IN('owner','org_admin','facility_admin','manager','nurse'));
CREATE POLICY operation_exec_alert_current_version ON public.exec_alerts AS RESTRICTIVE FOR SELECT TO authenticated USING(category::text<>'risk_command' OR (operation_authority_version=1 AND haven.operation_facility_access(facility_id) AND haven.app_role()::text IN('owner','org_admin','facility_admin','manager','nurse')));
CREATE POLICY operation_risk_delivery_current_version ON public.risk_owner_alert_deliveries AS RESTRICTIVE FOR SELECT TO authenticated USING(operation_authority_version=1 AND haven.operation_facility_access(facility_id) AND haven.app_role()::text IN('owner','org_admin','facility_admin','manager','nurse'));
-- Older aggregate audit payloads can still contain broad task counts.
CREATE POLICY operation_aggregate_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(
 table_name NOT IN('staffing_adequacy_snapshots','risk_score_snapshots','risk_owner_alert_deliveries','exec_alerts','operation_task_templates','operation_activities')
 AND (table_name<>'facility_assets' OR haven.operation_facility_access(facility_id)));

-- Preserve publication only for an explicitly facility-typed catalog identity.
CREATE FUNCTION haven.publish_operation_template_current(p_previous_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.operation_task_templates; replacement public.operation_task_templates;
BEGIN
 SELECT * INTO previous FROM public.operation_task_templates WHERE id=p_previous_id AND deleted_at IS NULL FOR UPDATE;
 IF previous.id IS NULL OR NOT haven.operation_activity_is_facility(previous.activity_id) THEN RAISE EXCEPTION 'Template classification required' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_catalog_actor(previous.organization_id,previous.facility_id,true);
 IF EXISTS(SELECT 1 FROM public.operation_task_templates WHERE previous_version_id=previous.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'A newer template version already exists. Reload before editing'; END IF;
 replacement:=jsonb_populate_record(previous,p_payload);
 replacement.id:=gen_random_uuid(); replacement.organization_id:=previous.organization_id; replacement.facility_id:=previous.facility_id;
 replacement.activity_id:=previous.activity_id; replacement.previous_version_id:=previous.id; replacement.version:=previous.version+1;
 replacement.created_at:=clock_timestamp(); replacement.updated_at:=clock_timestamp(); replacement.created_by:=auth.uid(); replacement.updated_by:=auth.uid();
 UPDATE public.operation_task_templates SET is_active=false,updated_by=auth.uid() WHERE id=previous.id;
 INSERT INTO public.operation_task_templates SELECT replacement.*;
 PERFORM haven.assert_operation_catalog_actor(previous.organization_id,previous.facility_id,true);
 RETURN to_jsonb(replacement);
END $$;
CREATE OR REPLACE FUNCTION public.publish_operation_template_review(p_previous_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.publish_operation_template_current(p_previous_id,p_payload) $$;
REVOKE ALL ON FUNCTION haven.publish_operation_template_current(uuid,jsonb),public.publish_operation_template_review(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.publish_operation_template_current(uuid,jsonb),public.publish_operation_template_review(uuid,jsonb) TO authenticated;

-- Export jobs retain workflow state, never a reusable authority grant to a file.
CREATE POLICY operation_export_job_current ON public.audit_log_export_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING(
 requested_by=auth.uid() AND status IN('pending','processing','failed') AND storage_path IS NULL AND row_count IS NULL
 AND (facility_id IS NULL OR haven.operation_facility_access(facility_id)));
CREATE POLICY operation_export_job_insert_current ON public.audit_log_export_jobs AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(
 requested_by=auth.uid() AND status='pending' AND storage_path IS NULL AND row_count IS NULL AND sha256_checksum IS NULL
 AND (facility_id IS NULL OR haven.operation_facility_access(facility_id)));
REVOKE UPDATE ON public.audit_log_export_jobs FROM authenticated;
CREATE FUNCTION haven.complete_audit_export_job(p_job_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.audit_log_export_jobs;
BEGIN
 SELECT * INTO j FROM public.audit_log_export_jobs WHERE id=p_job_id AND deleted_at IS NULL FOR UPDATE;
 IF j.id IS NULL OR j.requested_by IS DISTINCT FROM auth.uid() OR j.status NOT IN('pending','processing','failed') OR j.storage_path IS NOT NULL THEN RAISE EXCEPTION 'Export unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND (j.facility_id IS NULL OR facility_id=j.facility_id) FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN auth.sessions sess ON sess.user_id=p.id AND sess.id=nullif(auth.jwt()->>'session_id','')::uuid WHERE p.id=auth.uid() FOR SHARE OF p,u,sess;
 IF haven.organization_id() IS DISTINCT FROM j.organization_id OR haven.app_role()::text NOT IN('owner','org_admin','facility_admin') OR (j.facility_id IS NOT NULL AND NOT haven.operation_facility_access(j.facility_id)) THEN RAISE EXCEPTION 'Export unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.audit_log_export_jobs SET status='completed',completed_at=clock_timestamp(),storage_path=NULL,sha256_checksum=NULL,row_count=NULL,error_message=NULL WHERE id=j.id;
 RETURN true;
END $$;
CREATE FUNCTION public.haven_complete_audit_export_job(p_job_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.complete_audit_export_job(p_job_id) $$;
REVOKE ALL ON FUNCTION haven.complete_audit_export_job(uuid),public.haven_complete_audit_export_job(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.complete_audit_export_job(uuid),public.haven_complete_audit_export_job(uuid) TO authenticated;

-- Shared service input for conservative facility-only derived aggregates.
-- Callers compare against the raw population separately and must not label a
-- filtered subset as complete coverage. This projection is not user authority.
CREATE VIEW public.operation_automation_tasks WITH (security_invoker=true) AS
 SELECT t.* FROM public.operation_task_instances t
 WHERE t.deleted_at IS NULL AND t.authority_class='facility'
 AND coalesce(cardinality(t.completion_evidence_paths),0)=0
 AND haven.operation_subject_current(t.subject_id,t.organization_id,t.facility_id,t.authority_class)
 AND (t.template_id IS NULL OR EXISTS(SELECT 1 FROM public.operation_task_templates linked
 WHERE linked.id=t.template_id AND linked.organization_id=t.organization_id AND linked.deleted_at IS NULL
 AND (linked.facility_id IS NULL OR linked.facility_id=t.facility_id) AND linked.activity_id=t.activity_id
 AND haven.operation_template_links_current(linked.organization_id,t.facility_id,linked.linked_document_id,linked.asset_ref,linked.vendor_booking_ref)));
REVOKE ALL ON public.operation_automation_tasks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.operation_automation_tasks,public.operation_task_templates TO service_role;
GRANT EXECUTE ON FUNCTION haven.operation_subject_current(uuid,uuid,uuid,text),haven.operation_template_links_current(uuid,uuid,uuid,uuid,uuid) TO service_role;

COMMENT ON COLUMN public.operation_task_instances.authority_class IS 'Current COL-133 access classification. Legacy unknowns remain unclassified and hidden until explicitly reconciled; not evidence approval.';
COMMENT ON COLUMN public.user_facility_access.operation_expires_at IS 'HFO-only temporary coverage expiry; checked with wall clock for each read/command. NULL preserves explicit existing site grant.';
NOTIFY pgrst,'reload schema';
COMMIT;
