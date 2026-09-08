-- Source-backed employee requirements and evidence. Draft packet interpretations never grant readiness.
-- Mutations are caller-authenticated commands; confidential payloads never enter general audit_log.
CREATE TABLE public.employee_file_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 code text NOT NULL CHECK(length(trim(code))>0), title text NOT NULL CHECK(length(trim(title))>0), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 category text NOT NULL CHECK(category IN('policy','application','payroll','benefit','consent','job_description','orientation','training','screening','medical')),
 source_file text NOT NULL, source_page integer CHECK(source_page>0), source_excerpt text NOT NULL DEFAULT '',
 review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN('draft','approved','retired')), review_note text, reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz,
 due_days integer CHECK(due_days>=0), recurrence_months integer CHECK(recurrence_months>0), recurrence_status text NOT NULL DEFAULT 'unknown' CHECK(recurrence_status IN('unknown','one_time','recurring')),
 duty text CHECK(duty IN('resident_interaction','personal_care','medication')), required_signers text[] NOT NULL DEFAULT '{}', content text NOT NULL DEFAULT '',
 document_id uuid REFERENCES public.documents(id), training_program_id uuid REFERENCES public.training_programs(id),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(facility_id,code,version), CHECK(required_signers <@ ARRAY['employee','supervisor','witness','trainer','administrator','provider']::text[]),
 CHECK((recurrence_status='recurring' AND recurrence_months IS NOT NULL) OR (recurrence_status<>'recurring' AND recurrence_months IS NULL))
);
CREATE TABLE public.employee_medical_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 granted_by uuid NOT NULL REFERENCES auth.users(id), granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 grant_reason text NOT NULL DEFAULT '', revocation_reason text
);
CREATE UNIQUE INDEX employee_medical_access_live ON public.employee_medical_access(user_id,facility_id) WHERE revoked_at IS NULL;
CREATE TABLE public.employee_file_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id), staff_id uuid NOT NULL REFERENCES public.staff(id), requirement_id uuid NOT NULL REFERENCES public.employee_file_requirements(id),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','verified','rejected')), completed_on date, expires_on date, notes text, storage_path text, evidence_reference text,
 review_note text, reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CHECK(expires_on IS NULL OR (completed_on IS NOT NULL AND expires_on>=completed_on)), CHECK(storage_path IS NULL OR storage_path LIKE id::text||'/%')
);
CREATE INDEX employee_file_records_staff ON public.employee_file_records(staff_id,requirement_id);
CREATE TABLE public.employee_file_signatures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES public.employee_file_records(id), user_id uuid NOT NULL REFERENCES auth.users(id),
 functional_role text NOT NULL CHECK(functional_role IN('employee','supervisor','witness','trainer','administrator')), signature_name text NOT NULL CHECK(length(trim(signature_name))>=3),
 signed_at timestamptz NOT NULL DEFAULT now(), record_snapshot_hash text NOT NULL, UNIQUE(record_id,functional_role)
);
CREATE TABLE public.employee_duty_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES public.staff(id), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 duty text NOT NULL CHECK(duty IN('resident_interaction','personal_care','medication')), occurred_at timestamptz NOT NULL, evidence_note text NOT NULL,
 recorded_by uuid NOT NULL REFERENCES auth.users(id), readiness_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately contains identifiers only, never employee notes, medical values or signature text.
CREATE TABLE public.employee_file_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL, entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_attendance_events
 ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN('pending','counted','excluded')),
 ADD COLUMN review_reason text, ADD COLUMN reviewed_by uuid REFERENCES auth.users(id), ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN minutes_deviation integer CHECK(minutes_deviation>=0), ADD COLUMN notification_method text,
 ADD COLUMN notification_minutes_before integer;
ALTER TABLE public.staff_discipline_records
 ADD COLUMN attendance_event_id uuid REFERENCES public.staff_attendance_events(id),
 ADD COLUMN coaching_form_document_id uuid REFERENCES public.documents(id), ADD COLUMN copy_given_to_employee_at timestamptz,
 ADD COLUMN retracted_at timestamptz, ADD COLUMN retracted_by uuid REFERENCES auth.users(id), ADD COLUMN retraction_approved_by uuid REFERENCES auth.users(id),
 ADD COLUMN retraction_reason text, ADD COLUMN employee_requested_at timestamptz, ADD COLUMN review_meeting_at timestamptz,
 ADD COLUMN qualifying_period_start date, ADD COLUMN qualifying_period_end date;

CREATE FUNCTION haven.employee_scope(p_org uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_org=haven.organization_id() AND p_facility IN(SELECT haven.accessible_facility_ids())
 AND EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=p_facility AND f.organization_id=p_org AND f.deleted_at IS NULL)
$$;
CREATE FUNCTION haven.employee_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(haven.app_role()::text IN('owner','org_admin','facility_admin','manager'),false)
$$;
CREATE FUNCTION haven.employee_medical_reader(p_org uuid,p_facility uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.employee_scope(p_org,p_facility) AND EXISTS(SELECT 1 FROM public.employee_medical_access a WHERE a.user_id=auth.uid() AND a.organization_id=p_org AND a.facility_id=p_facility AND a.revoked_at IS NULL)
$$;
CREATE FUNCTION haven.employee_record_readable(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.employee_file_records r JOIN public.employee_file_requirements q ON q.id=r.requirement_id JOIN public.staff s ON s.id=r.staff_id
 WHERE r.id=p_id AND r.deleted_at IS NULL AND s.deleted_at IS NULL AND haven.employee_scope(r.organization_id,r.facility_id)
 AND CASE WHEN q.category='medical' THEN s.user_id=auth.uid() OR haven.employee_medical_reader(r.organization_id,r.facility_id)
 ELSE s.user_id=auth.uid() OR haven.employee_manager()
 OR (haven.app_role()::text='nurse' AND q.required_signers && ARRAY['trainer','witness']::text[])
 OR (haven.app_role()::text='coordinator' AND 'witness'=ANY(q.required_signers)) END)
$$;
CREATE FUNCTION haven.employee_storage_access(p_bucket text,p_name text,p_write boolean) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.employee_file_records%ROWTYPE; q public.employee_file_requirements%ROWTYPE; v_id uuid;
BEGIN
 BEGIN v_id:=split_part(p_name,'/',1)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 IF p_name NOT LIKE v_id::text||'/%' OR split_part(p_name,'/',2)='' OR array_length(string_to_array(p_name,'/'),1)<>2 THEN RETURN false; END IF;
 SELECT * INTO r FROM public.employee_file_records WHERE id=v_id FOR UPDATE;
 IF NOT FOUND OR NOT haven.employee_record_readable(r.id) THEN RETURN false; END IF;
 SELECT * INTO q FROM public.employee_file_requirements WHERE id=r.requirement_id;
 IF p_bucket IS DISTINCT FROM (CASE WHEN q.category='medical' THEN 'employee-medical' ELSE 'employee-personnel' END) THEN RETURN false; END IF;
 IF NOT p_write THEN RETURN r.storage_path=p_name OR (r.storage_path IS NULL AND r.created_by=auth.uid() AND r.status='submitted' AND NOT EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=r.id)); END IF;
 RETURN r.status='submitted' AND r.created_by=auth.uid() AND (r.storage_path IS NULL OR r.storage_path=p_name)
 AND NOT EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=r.id);
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_file_requirements','employee_medical_access','employee_file_records','employee_file_signatures','employee_duty_events','employee_file_audit_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE POLICY employee_requirements_read ON public.employee_file_requirements FOR SELECT TO authenticated USING(deleted_at IS NULL AND haven.employee_scope(organization_id,facility_id));
CREATE POLICY employee_medical_grants_read ON public.employee_medical_access FOR SELECT TO authenticated USING(haven.employee_scope(organization_id,facility_id) AND (user_id=auth.uid() OR haven.app_role()::text IN('owner','org_admin')));
CREATE POLICY employee_records_read ON public.employee_file_records FOR SELECT TO authenticated USING(haven.employee_record_readable(id));
CREATE POLICY employee_signatures_read ON public.employee_file_signatures FOR SELECT TO authenticated USING(haven.employee_record_readable(record_id));
CREATE POLICY employee_duty_read ON public.employee_duty_events FOR SELECT TO authenticated USING(haven.employee_scope(organization_id,facility_id) AND (haven.employee_manager() OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=staff_id AND s.user_id=auth.uid() AND s.deleted_at IS NULL)));
CREATE POLICY employee_audit_read ON public.employee_file_audit_events FOR SELECT TO authenticated USING(haven.employee_scope(organization_id,facility_id) AND haven.app_role()::text IN('owner','org_admin'));
-- Existing unrestricted discipline UPDATE policy and attendance FOR ALL must not bypass review commands.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN('staff_attendance_events','staff_discipline_records') LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.staff_attendance_events,public.staff_discipline_records FROM authenticated,anon;
GRANT SELECT ON public.staff_attendance_events,public.staff_discipline_records TO authenticated;
-- Keep the already deployed staffing console working during rollout and frontend rollback.
-- The definer helper checks identity without granting managers the private staff table.
CREATE FUNCTION haven.employee_attendance_insert_scope(p_staff uuid,p_org uuid,p_facility uuid,p_shift uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.employee_manager() AND haven.employee_scope(p_org,p_facility)
 AND EXISTS(SELECT 1 FROM public.staff s WHERE s.id=p_staff AND s.organization_id=p_org AND s.facility_id=p_facility AND s.deleted_at IS NULL)
 AND (p_shift IS NULL OR EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.id=p_shift AND a.staff_id=p_staff AND a.facility_id=p_facility))
$$;
REVOKE ALL ON FUNCTION haven.employee_attendance_insert_scope(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.employee_attendance_insert_scope(uuid,uuid,uuid,uuid) TO authenticated;
GRANT INSERT ON public.staff_attendance_events TO authenticated;
CREATE POLICY employee_attendance_legacy_insert ON public.staff_attendance_events FOR INSERT TO authenticated WITH CHECK(
 haven.employee_attendance_insert_scope(staff_id,organization_id,facility_id,shift_assignment_id)
 AND created_by=auth.uid() AND updated_by=auth.uid() AND deleted_at IS NULL AND occurred_at<=now()
 AND review_status='pending' AND review_reason IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL
);
CREATE POLICY employee_attendance_read ON public.staff_attendance_events FOR SELECT TO authenticated USING(deleted_at IS NULL AND haven.employee_scope(organization_id,facility_id) AND (haven.employee_manager() OR haven.app_role()::text='nurse' OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=staff_id AND s.user_id=auth.uid())));
CREATE POLICY employee_discipline_read ON public.staff_discipline_records FOR SELECT TO authenticated USING(deleted_at IS NULL AND haven.employee_scope(organization_id,facility_id) AND (haven.employee_manager() OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=staff_id AND s.user_id=auth.uid())));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('employee-personnel','employee-personnel',false,20971520,ARRAY['application/pdf','image/jpeg','image/png']),
 ('employee-medical','employee-medical',false,20971520,ARRAY['application/pdf','image/jpeg','image/png']);
CREATE POLICY employee_file_storage_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN('employee-personnel','employee-medical') AND haven.employee_storage_access(bucket_id,name,false));
CREATE POLICY employee_file_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id IN('employee-personnel','employee-medical') AND haven.employee_storage_access(bucket_id,name,true));
ALTER TABLE public.employee_file_requirements ADD COLUMN applies_to_staff_roles text[] NOT NULL DEFAULT '{}', ADD COLUMN applicability_note text,
 ADD COLUMN minimum_completions integer DEFAULT 1 CHECK(minimum_completions>0),
 ADD COLUMN minimum_distinct_days integer DEFAULT 1 CHECK(minimum_distinct_days>0),
 ADD CONSTRAINT employee_requirement_minimum_days CHECK(minimum_distinct_days<=minimum_completions);
-- Restrictive policies prevent generic existing storage grants from exposing these two buckets.
CREATE POLICY employee_file_storage_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id NOT IN('employee-personnel','employee-medical') OR haven.employee_storage_access(bucket_id,name,false));
CREATE POLICY employee_file_storage_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id NOT IN('employee-personnel','employee-medical') OR haven.employee_storage_access(bucket_id,name,true));
CREATE POLICY employee_file_storage_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id NOT IN('employee-personnel','employee-medical')) WITH CHECK(bucket_id NOT IN('employee-personnel','employee-medical'));
CREATE POLICY employee_file_storage_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id NOT IN('employee-personnel','employee-medical'));

CREATE FUNCTION public.haven_employee_requirement_command(p_facility_id uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_id uuid; q public.employee_file_requirements%ROWTYPE; v_result jsonb; v_user uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.facilities WHERE id=p_facility_id AND deleted_at IS NULL;
 IF auth.uid() IS NULL OR NOT coalesce(haven.employee_scope(v_org,p_facility_id),false) OR NOT haven.employee_manager() THEN RAISE EXCEPTION 'Employee requirement management unavailable' USING ERRCODE='42501'; END IF;
 IF p_action IN('grant_medical','revoke_medical') THEN
  IF haven.app_role()::text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Medical access requires organization administrator' USING ERRCODE='42501'; END IF;
  v_user:=(p_payload->>'user_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=v_user AND organization_id=v_org AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Active organization user required'; END IF;
  IF p_action='grant_medical' THEN
   INSERT INTO public.employee_medical_access(user_id,organization_id,facility_id,granted_by,grant_reason) VALUES(v_user,v_org,p_facility_id,auth.uid(),coalesce(p_payload->>'review_note','')) RETURNING id,to_jsonb(employee_medical_access.*) INTO v_id,v_result;
  ELSE
   UPDATE public.employee_medical_access SET revoked_at=now(),revocation_reason=p_payload->>'review_note' WHERE user_id=v_user AND facility_id=p_facility_id AND revoked_at IS NULL RETURNING id,to_jsonb(employee_medical_access.*) INTO v_id,v_result;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active grant unavailable'; END IF;
  END IF;
 ELSIF p_action='create' THEN
  IF p_payload->>'document_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=(p_payload->>'document_id')::uuid AND workspace_id=v_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization document required'; END IF;
  IF p_payload->>'training_program_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.training_programs WHERE id=(p_payload->>'training_program_id')::uuid AND organization_id=v_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization training program required'; END IF;
  INSERT INTO public.employee_file_requirements(organization_id,facility_id,code,title,version,category,source_file,source_page,source_excerpt,due_days,recurrence_months,recurrence_status,duty,required_signers,content,document_id,training_program_id,created_by,applies_to_staff_roles,applicability_note,minimum_completions,minimum_distinct_days)
  VALUES(v_org,p_facility_id,p_payload->>'code',p_payload->>'title',coalesce((p_payload->>'version')::integer,1),p_payload->>'category',coalesce(p_payload->>'source_file',''),(p_payload->>'source_page')::integer,coalesce(p_payload->>'source_excerpt',''),(p_payload->>'due_days')::integer,(p_payload->>'recurrence_months')::integer,coalesce(p_payload->>'recurrence_status','unknown'),nullif(p_payload->>'duty',''),ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'required_signers','[]'))),coalesce(p_payload->>'content',''),(p_payload->>'document_id')::uuid,(p_payload->>'training_program_id')::uuid,auth.uid(),ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'applies_to_staff_roles','[]'))),p_payload->>'applicability_note',CASE WHEN p_payload?'minimum_completions' THEN (p_payload->>'minimum_completions')::integer ELSE 1 END,CASE WHEN p_payload?'minimum_distinct_days' THEN (p_payload->>'minimum_distinct_days')::integer ELSE 1 END) RETURNING * INTO q;
  v_id:=q.id; v_result:=to_jsonb(q);
 ELSIF p_action IN('approve','retire') THEN
  SELECT * INTO q FROM public.employee_file_requirements WHERE id=(p_payload->>'id')::uuid AND organization_id=v_org AND facility_id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requirement unavailable'; END IF;
  IF length(trim(coalesce(p_payload->>'review_note','')))=0 THEN RAISE EXCEPTION 'Review note required'; END IF;
  IF p_action='approve' THEN
   IF q.review_status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be approved'; END IF;
   IF cardinality(q.applies_to_staff_roles)=0 OR length(trim(q.source_file))=0 OR q.source_page IS NULL OR length(trim(q.source_excerpt))=0 OR length(trim(q.content))=0 THEN RAISE EXCEPTION 'Approval requires role applicability, source page, excerpt and content'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(q.applies_to_staff_roles) x WHERE x<>'*' AND NOT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='staff_role' AND e.enumlabel=x)) THEN RAISE EXCEPTION 'Invalid staff applicability role'; END IF;
  ELSIF q.review_status='retired' THEN RAISE EXCEPTION 'Requirement already retired'; END IF;
  UPDATE public.employee_file_requirements SET review_status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'retired' END,review_note=p_payload->>'review_note',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() WHERE id=q.id RETURNING * INTO q;
  v_id:=q.id; v_result:=to_jsonb(q);
 ELSE RAISE EXCEPTION 'Unsupported requirement command'; END IF;
 INSERT INTO public.employee_file_audit_events(organization_id,facility_id,actor_id,action,entity_id) VALUES(v_org,p_facility_id,auth.uid(),p_action,v_id);
 RETURN v_result;
END $$;

CREATE FUNCTION public.haven_employee_file_command(p_staff_id uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.staff%ROWTYPE; q public.employee_file_requirements%ROWTYPE; r public.employee_file_records%ROWTYPE; a public.staff_attendance_events%ROWTYPE; d public.staff_discipline_records%ROWTYPE;
 v_manager boolean; v_self boolean; v_id uuid; v_result jsonb; v_role text; v_hash text; v_signed boolean; v_requested timestamptz; v_meeting timestamptz;
BEGIN
 SELECT * INTO s FROM public.staff WHERE id=p_staff_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(haven.employee_scope(s.organization_id,s.facility_id),false) THEN RAISE EXCEPTION 'Staff unavailable' USING ERRCODE='42501'; END IF;
 v_manager:=haven.employee_manager(); v_self:=coalesce(s.user_id=auth.uid(),false);
 IF p_action='record_export' THEN
  IF NOT (v_self OR v_manager OR haven.employee_medical_reader(s.organization_id,s.facility_id) OR haven.app_role()::text IN('nurse','coordinator')) THEN RAISE EXCEPTION 'Employee export access required' USING ERRCODE='42501'; END IF;
  v_id:=s.id; v_result:=jsonb_build_object('scope','personnel_checklist','requested_at',now());
 ELSIF p_action='record_download' THEN
  SELECT * INTO r FROM public.employee_file_records WHERE id=(p_payload->>'id')::uuid AND staff_id=s.id;
  IF NOT FOUND OR NOT haven.employee_record_readable(r.id) THEN RAISE EXCEPTION 'Document access required' USING ERRCODE='42501'; END IF;
  v_id:=r.id; v_result:=jsonb_build_object('scope','document_download_request','requested_at',now());
 ELSIF p_action IN('submit_record','attach_record','review_record','sign_record') THEN
  IF p_action='submit_record' THEN
   SELECT * INTO q FROM public.employee_file_requirements WHERE id=(p_payload->>'requirement_id')::uuid AND organization_id=s.organization_id AND facility_id=s.facility_id AND deleted_at IS NULL;
   IF NOT FOUND OR q.review_status<>'approved' OR NOT ('*'=ANY(q.applies_to_staff_roles) OR s.staff_role::text=ANY(q.applies_to_staff_roles)) THEN RAISE EXCEPTION 'Approved applicable requirement required'; END IF;
  ELSE
   SELECT * INTO r FROM public.employee_file_records WHERE id=(p_payload->>'id')::uuid AND staff_id=s.id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Employee record unavailable'; END IF;
   SELECT * INTO q FROM public.employee_file_requirements WHERE id=r.requirement_id;
  END IF;
  IF q.category='medical' THEN
   IF NOT (v_self OR haven.employee_medical_reader(s.organization_id,s.facility_id)) THEN RAISE EXCEPTION 'Confidential medical access required' USING ERRCODE='42501'; END IF;
  ELSIF NOT(v_self OR v_manager OR (p_action='sign_record' AND haven.app_role()::text IN('nurse','coordinator'))) THEN RAISE EXCEPTION 'Employee record access required' USING ERRCODE='42501'; END IF;
  IF p_action='submit_record' THEN
   IF (p_payload->>'completed_on')::date>(now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Completion cannot be in the future'; END IF;
   INSERT INTO public.employee_file_records(id,organization_id,facility_id,staff_id,requirement_id,completed_on,expires_on,notes,evidence_reference,created_by)
   VALUES(coalesce((p_payload->>'id')::uuid,gen_random_uuid()),s.organization_id,s.facility_id,s.id,q.id,(p_payload->>'completed_on')::date,(p_payload->>'expires_on')::date,p_payload->>'notes',nullif(trim(p_payload->>'evidence_reference'),''),auth.uid()) RETURNING * INTO r;
   v_id:=r.id; v_result:=to_jsonb(r);
  ELSE
   IF r.status<>'submitted' THEN RAISE EXCEPTION 'Reviewed records are immutable; submit new evidence'; END IF;
   SELECT EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=r.id) INTO v_signed;
   IF p_action='attach_record' THEN
    IF r.created_by<>auth.uid() OR v_signed OR r.storage_path IS NOT NULL THEN RAISE EXCEPTION 'Attachment is immutable or not owned by caller'; END IF;
    IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=CASE WHEN q.category='medical' THEN 'employee-medical' ELSE 'employee-personnel' END AND o.name=p_payload->>'storage_path' AND o.name LIKE r.id::text||'/%') THEN RAISE EXCEPTION 'Uploaded record attachment required'; END IF;
    UPDATE public.employee_file_records SET storage_path=p_payload->>'storage_path',updated_at=now() WHERE id=r.id RETURNING * INTO r;
    v_id:=r.id; v_result:=to_jsonb(r);
   ELSIF p_action='sign_record' THEN
    v_role:=p_payload->>'functional_role';
    IF NOT coalesce(v_role=ANY(q.required_signers),false) THEN RAISE EXCEPTION 'Signer purpose not required'; END IF;
    IF v_role='provider' THEN RAISE EXCEPTION 'Provider signature requires source evidence and authorized review'; END IF;
    IF v_role='employee' THEN
     IF NOT v_self THEN RAISE EXCEPTION 'Employee must sign for themselves'; END IF;
    ELSE
     IF v_self OR NOT(haven.app_role()::text IN('owner','org_admin','facility_admin','manager','nurse','coordinator')) THEN RAISE EXCEPTION 'Independent authorized countersigner required'; END IF;
     IF v_role IN('administrator','supervisor') AND NOT v_manager THEN RAISE EXCEPTION 'Manager signer required for supervisor or administrator'; END IF;
     IF v_role='trainer' AND NOT(v_manager OR haven.app_role()::text='nurse') THEN RAISE EXCEPTION 'Authorized trainer required'; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=r.id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'A signer cannot fulfill multiple purposes on one record'; END IF;
    v_hash:=encode(sha256(convert_to(jsonb_build_object('record_id',r.id,'requirement_id',q.id,'version',q.version,'content',q.content,'completed_on',r.completed_on,'expires_on',r.expires_on,'notes',r.notes,'storage_path',r.storage_path,'evidence_reference',r.evidence_reference)::text,'UTF8')),'hex');
    INSERT INTO public.employee_file_signatures(record_id,user_id,functional_role,signature_name,record_snapshot_hash) VALUES(r.id,auth.uid(),v_role,p_payload->>'signature_name',v_hash) RETURNING id,to_jsonb(employee_file_signatures.*) INTO v_id,v_result;
   ELSE
    IF q.category='medical' THEN
     IF NOT haven.employee_medical_reader(s.organization_id,s.facility_id) OR v_self THEN RAISE EXCEPTION 'Independent medical reviewer grant required'; END IF;
    ELSIF NOT v_manager OR v_self THEN RAISE EXCEPTION 'Independent manager review required'; END IF;
    IF p_payload->>'status' NOT IN('verified','rejected') OR p_payload->>'status' IS NULL THEN RAISE EXCEPTION 'Review status required'; END IF;
    IF length(trim(coalesce(p_payload->>'review_note','')))=0 THEN RAISE EXCEPTION 'Review note required'; END IF;
    IF p_payload->>'status'='verified' THEN
     IF r.completed_on IS NULL OR r.completed_on>(now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Actual completion date required'; END IF;
     IF q.review_status<>'approved' THEN RAISE EXCEPTION 'Requirement no longer approved'; END IF;
     IF EXISTS(SELECT 1 FROM unnest(q.required_signers) purpose WHERE NOT EXISTS(SELECT 1 FROM public.employee_file_signatures sig WHERE sig.record_id=r.id AND sig.functional_role=purpose)) AND nullif(trim(r.evidence_reference),'') IS NULL THEN RAISE EXCEPTION 'Required signatures or documented signed source evidence required'; END IF;
    END IF;
    UPDATE public.employee_file_records SET status=p_payload->>'status',review_note=p_payload->>'review_note',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() WHERE id=r.id RETURNING * INTO r;
    v_id:=r.id; v_result:=to_jsonb(r);
   END IF;
  END IF;
 ELSIF p_action='record_duty' THEN
  IF NOT v_manager THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
  IF (p_payload->>'occurred_at')::timestamptz>now() OR length(trim(coalesce(p_payload->>'evidence_note','')))=0 THEN RAISE EXCEPTION 'Actual event and evidence note required'; END IF;
  INSERT INTO public.employee_duty_events(staff_id,organization_id,facility_id,duty,occurred_at,evidence_note,recorded_by,readiness_snapshot) VALUES(s.id,s.organization_id,s.facility_id,p_payload->>'duty',(p_payload->>'occurred_at')::timestamptz,p_payload->>'evidence_note',auth.uid(),haven.employee_duty_readiness_snapshot(s.id,p_payload->>'duty')) RETURNING id,to_jsonb(employee_duty_events.*) INTO v_id,v_result;
 ELSIF p_action='record_attendance' THEN
  IF NOT v_manager THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
  IF (p_payload->>'occurred_at')::timestamptz>now() THEN RAISE EXCEPTION 'Attendance cannot be in future'; END IF;
  IF p_payload->>'shift_assignment_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shift_assignments WHERE id=(p_payload->>'shift_assignment_id')::uuid AND staff_id=s.id AND facility_id=s.facility_id) THEN RAISE EXCEPTION 'Staff shift required'; END IF;
  INSERT INTO public.staff_attendance_events(staff_id,organization_id,facility_id,event_type,occurred_at,shift_assignment_id,reason,notes,minutes_deviation,notification_method,notification_minutes_before,created_by,updated_by)
  VALUES(s.id,s.organization_id,s.facility_id,(p_payload->>'event_type')::public.staff_attendance_event_type,(p_payload->>'occurred_at')::timestamptz,(p_payload->>'shift_assignment_id')::uuid,p_payload->>'reason',p_payload->>'notes',(p_payload->>'minutes_deviation')::integer,p_payload->>'notification_method',(p_payload->>'notification_minutes_before')::integer,auth.uid(),auth.uid()) RETURNING * INTO a;
  v_id:=a.id; v_result:=to_jsonb(a);
 ELSIF p_action='review_attendance' THEN
  IF NOT v_manager OR v_self THEN RAISE EXCEPTION 'Independent manager required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.staff_attendance_events WHERE id=(p_payload->>'id')::uuid AND staff_id=s.id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR a.review_status<>'pending' THEN RAISE EXCEPTION 'Pending attendance event required'; END IF;
  IF p_payload->>'review_status' NOT IN('counted','excluded') OR p_payload->>'review_status' IS NULL OR length(trim(coalesce(p_payload->>'review_reason','')))=0 THEN RAISE EXCEPTION 'Review classification and reason required'; END IF;
  UPDATE public.staff_attendance_events SET review_status=p_payload->>'review_status',review_reason=p_payload->>'review_reason',reviewed_by=auth.uid(),reviewed_at=now(),updated_by=auth.uid() WHERE id=a.id RETURNING * INTO a;
  v_id:=a.id; v_result:=to_jsonb(a);
 ELSIF p_action='record_corrective_action' THEN
  IF NOT v_manager OR v_self THEN RAISE EXCEPTION 'Independent manager required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.staff_attendance_events WHERE id=(p_payload->>'attendance_event_id')::uuid AND staff_id=s.id AND deleted_at IS NULL;
  IF NOT FOUND OR a.review_status<>'counted' THEN RAISE EXCEPTION 'Reviewed counted occurrence required'; END IF;
  IF length(trim(coalesce(p_payload->>'notes','')))=0 OR (p_payload->>'effective_date')::date>(now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Documented decision and actual effective date required'; END IF;
  IF p_payload->>'coaching_form_document_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=(p_payload->>'coaching_form_document_id')::uuid AND workspace_id=s.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization coaching document required'; END IF;
  INSERT INTO public.staff_discipline_records(organization_id,facility_id,staff_id,action,absence_count_at_action,tardy_count_at_action,notes,effective_date,attendance_event_id,coaching_form_document_id,copy_given_to_employee_at,created_by,updated_by)
  VALUES(s.organization_id,s.facility_id,s.id,(p_payload->>'action')::public.discipline_action,coalesce((p_payload->>'absence_count_at_action')::integer,0),coalesce((p_payload->>'tardy_count_at_action')::integer,0),p_payload->>'notes',coalesce((p_payload->>'effective_date')::date,(now() AT TIME ZONE 'America/New_York')::date),a.id,(p_payload->>'coaching_form_document_id')::uuid,(p_payload->>'copy_given_to_employee_at')::timestamptz,auth.uid(),auth.uid()) RETURNING * INTO d;
  v_id:=d.id; v_result:=to_jsonb(d);
 ELSIF p_action='retract_corrective_action' THEN
  IF haven.app_role()::text NOT IN('owner','org_admin') OR v_self THEN RAISE EXCEPTION 'Independent organization approver required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.staff_discipline_records WHERE id=(p_payload->>'id')::uuid AND staff_id=s.id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR d.retracted_at IS NOT NULL THEN RAISE EXCEPTION 'Unretracted corrective action required'; END IF;
  v_requested:=(p_payload->>'employee_requested_at')::timestamptz; v_meeting:=(p_payload->>'review_meeting_at')::timestamptz;
  IF length(trim(coalesce(p_payload->>'retraction_reason','')))=0 OR v_requested IS NULL OR v_meeting IS NULL OR v_requested>v_meeting OR v_meeting>now() THEN RAISE EXCEPTION 'Retraction reason, actual request and review meeting required'; END IF;
  UPDATE public.staff_discipline_records SET retracted_at=now(),retracted_by=auth.uid(),retraction_approved_by=auth.uid(),retraction_reason=p_payload->>'retraction_reason',employee_requested_at=v_requested,review_meeting_at=v_meeting,qualifying_period_start=(p_payload->>'qualifying_period_start')::date,qualifying_period_end=(p_payload->>'qualifying_period_end')::date,updated_by=auth.uid() WHERE id=d.id RETURNING * INTO d;
  v_id:=d.id; v_result:=to_jsonb(d);
 ELSE RAISE EXCEPTION 'Unsupported employee file command'; END IF;
 INSERT INTO public.employee_file_audit_events(organization_id,facility_id,actor_id,action,entity_id) VALUES(s.organization_id,s.facility_id,auth.uid(),p_action,v_id);
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb), public.haven_employee_requirement_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb), public.haven_employee_requirement_command(uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION haven.employee_scope(uuid,uuid),haven.employee_manager(),haven.employee_medical_reader(uuid,uuid),haven.employee_record_readable(uuid),haven.employee_storage_access(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.employee_scope(uuid,uuid),haven.employee_manager(),haven.employee_medical_reader(uuid,uuid),haven.employee_record_readable(uuid),haven.employee_storage_access(text,text,boolean) TO authenticated;

-- Preserve signed content and factual history even if a privileged integration writes directly.
CREATE FUNCTION public.haven_employee_immutable_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Employee history cannot be deleted'; END IF;
 IF TG_TABLE_NAME IN('employee_file_signatures','employee_duty_events','employee_file_audit_events') THEN RAISE EXCEPTION 'Employee history is immutable'; END IF;
 IF TG_TABLE_NAME='employee_file_requirements' AND (to_jsonb(OLD)->>'review_status')<>'draft' THEN
  IF (to_jsonb(NEW)-ARRAY['review_status','review_note','reviewed_by','reviewed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['review_status','review_note','reviewed_by','reviewed_at','updated_at'])
   OR (to_jsonb(OLD)->>'review_status')='retired' OR (to_jsonb(NEW)->>'review_status')<>'retired' THEN RAISE EXCEPTION 'Approved requirements are immutable; issue a new version'; END IF;
 END IF;
 IF TG_TABLE_NAME='employee_file_records' THEN
  IF (to_jsonb(OLD)->>'status')<>'submitted' THEN RAISE EXCEPTION 'Reviewed records are immutable; submit new evidence'; END IF;
  IF EXISTS(SELECT 1 FROM public.employee_file_signatures WHERE record_id=OLD.id) AND
   (to_jsonb(NEW)-ARRAY['status','review_note','reviewed_by','reviewed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','review_note','reviewed_by','reviewed_at','updated_at']) THEN RAISE EXCEPTION 'Signed evidence is immutable'; END IF;
 END IF;
 IF TG_TABLE_NAME='staff_attendance_events' AND (to_jsonb(OLD)->>'review_status')<>'pending' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Reviewed attendance is immutable'; END IF;
 IF TG_TABLE_NAME='staff_discipline_records' THEN
  IF (to_jsonb(OLD)->>'retracted_at') IS NOT NULL OR (to_jsonb(NEW)-ARRAY['retracted_at','retracted_by','retraction_approved_by','retraction_reason','employee_requested_at','review_meeting_at','qualifying_period_start','qualifying_period_end','updated_at','updated_by']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['retracted_at','retracted_by','retraction_approved_by','retraction_reason','employee_requested_at','review_meeting_at','qualifying_period_start','qualifying_period_end','updated_at','updated_by']) THEN RAISE EXCEPTION 'Corrective history is immutable except approved retraction'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_file_requirements','employee_file_records','employee_file_signatures','employee_duty_events','employee_file_audit_events','staff_attendance_events','staff_discipline_records'] LOOP
  EXECUTE format('CREATE TRIGGER employee_preserve_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_employee_immutable_history()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.haven_employee_immutable_history() FROM PUBLIC,anon,authenticated;

-- Staff table contains payroll and personal details. Expose only the identity needed
-- to authorize employee-file navigation, without broadening its existing SELECT RLS.
CREATE FUNCTION public.haven_employee_file_staff(p_staff_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,first_name text,last_name text,staff_role text,hire_date date,employment_status text,facility_id uuid,user_id uuid,facility_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.id,s.first_name,s.last_name,s.staff_role::text,s.hire_date,s.employment_status::text,s.facility_id,s.user_id,f.name
 FROM public.staff s JOIN public.facilities f ON f.id=s.facility_id AND f.organization_id=s.organization_id
 WHERE s.deleted_at IS NULL AND f.deleted_at IS NULL AND haven.employee_scope(s.organization_id,s.facility_id)
 AND CASE WHEN p_staff_id IS NULL THEN
   s.user_id=auth.uid() OR haven.employee_medical_reader(s.organization_id,s.facility_id)
 ELSE s.id=p_staff_id AND (s.user_id=auth.uid() OR haven.employee_manager()
   OR haven.app_role()::text IN('nurse','coordinator') OR haven.employee_medical_reader(s.organization_id,s.facility_id)) END
$$;
REVOKE ALL ON FUNCTION public.haven_employee_file_staff(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.haven_employee_file_staff(uuid) TO authenticated;

-- This is current evidence at recording, not a reconstruction of historical policy.
-- Only aggregate status leaves the helper; no medical requirement labels or values.
CREATE FUNCTION haven.employee_duty_readiness_snapshot(p_staff_id uuid,p_duty text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.staff%ROWTYPE; q public.employee_file_requirements%ROWTYPE; v_duties text[]; v_configured text[]:='{}';
 v_today date:=(now() AT TIME ZONE 'America/New_York')::date; v_missing integer:=0; v_count integer; v_days integer; v_unconfigured integer; v_status text;
BEGIN
 SELECT * INTO s FROM public.staff WHERE id=p_staff_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT coalesce(haven.employee_scope(s.organization_id,s.facility_id),false) OR NOT haven.employee_manager() THEN RAISE EXCEPTION 'Staff duty assessment unavailable' USING ERRCODE='42501'; END IF;
 v_duties:=CASE p_duty WHEN 'resident_interaction' THEN ARRAY['resident_interaction'] WHEN 'personal_care' THEN ARRAY['resident_interaction','personal_care'] WHEN 'medication' THEN ARRAY['resident_interaction','personal_care','medication'] ELSE NULL END;
 IF v_duties IS NULL THEN RAISE EXCEPTION 'Supported duty required'; END IF;
 FOR q IN SELECT latest.* FROM (
  SELECT DISTINCT ON (code) r.* FROM public.employee_file_requirements r
  WHERE r.organization_id=s.organization_id AND r.facility_id=s.facility_id AND r.deleted_at IS NULL AND r.review_status<>'draft'
  ORDER BY code,version DESC
 ) latest WHERE latest.review_status='approved' AND latest.duty=ANY(v_duties)
  AND ('*'=ANY(latest.applies_to_staff_roles) OR s.staff_role::text=ANY(latest.applies_to_staff_roles)) LOOP
  v_configured:=array_append(v_configured,q.duty);
  SELECT count(*),count(DISTINCT completed_on) INTO v_count,v_days FROM public.employee_file_records r
   WHERE r.staff_id=s.id AND r.requirement_id=q.id AND r.organization_id=s.organization_id AND r.facility_id=s.facility_id
   AND r.deleted_at IS NULL AND r.status='verified' AND r.completed_on<=v_today
   AND (r.expires_on IS NULL OR r.expires_on>=v_today)
   AND (q.recurrence_status<>'recurring' OR r.expires_on IS NOT NULL);
  IF q.recurrence_status='unknown' OR q.minimum_completions IS NULL OR q.minimum_distinct_days IS NULL
   OR v_count<q.minimum_completions OR v_days<q.minimum_distinct_days THEN v_missing:=v_missing+1; END IF;
 END LOOP;
 SELECT count(*) INTO v_unconfigured FROM unnest(v_duties) needed WHERE NOT(needed=ANY(v_configured));
 v_status:=CASE WHEN s.employment_status<>'active' OR s.hire_date>v_today THEN 'blocked'
  WHEN v_unconfigured>0 THEN 'not_configured' WHEN v_missing>0 THEN 'blocked' ELSE 'ready' END;
 RETURN jsonb_build_object('assessed_at',now(),'basis','current_requirements_at_recording','status',v_status,'requires_review',v_status<>'ready','missing_count',v_missing+v_unconfigured);
END $$;
REVOKE ALL ON FUNCTION haven.employee_duty_readiness_snapshot(uuid,text) FROM PUBLIC,anon,authenticated;
