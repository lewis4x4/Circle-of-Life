-- Created with supabase migration new; repository claim 445. COL-504.
BEGIN;
CREATE TABLE public.benefits_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), user_id uuid NOT NULL REFERENCES public.user_profiles(id),
 can_write boolean NOT NULL, can_review boolean NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), granted_by uuid NOT NULL REFERENCES public.user_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(facility_id,user_id)
);
CREATE TABLE public.benefits_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), resident_id uuid NOT NULL REFERENCES public.residents(id),
 admission_case_id uuid REFERENCES public.admission_cases(id), program text NOT NULL CHECK(program IN ('smmc_ltc','oss','other')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting','closed')), revision integer NOT NULL DEFAULT 1,
 next_action text CHECK(length(next_action)<=4000), assigned_to uuid REFERENCES public.user_profiles(id), due_date date,
 closure_reason text, screening jsonb NOT NULL DEFAULT '{}', funding jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'closed' OR coalesce(length(btrim(closure_reason)),0)>0)
);
CREATE UNIQUE INDEX benefits_case_active ON public.benefits_cases(resident_id,program) WHERE status<>'closed';
CREATE INDEX benefits_case_queue ON public.benefits_cases(facility_id,status,due_date);
CREATE TABLE public.benefits_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255 AND filename !~ '[/\\]'),
 mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 15728640), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','ready')),
 document_type text NOT NULL CHECK(length(document_type) BETWEEN 1 AND 200), template_version text CHECK(length(template_version)<=200),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), stage text NOT NULL CHECK(stage IN ('screening','referral','assessment','application','funding','renewal')),
 status text NOT NULL CHECK(status IN ('missing','requested','received','accepted','rejected','not_applicable')),
 assigned_to uuid REFERENCES public.user_profiles(id), due_date date, notes text CHECK(length(notes)<=4000), document_id uuid REFERENCES public.benefits_documents(id),
 review_reason text CHECK(length(review_reason)<=4000), signature_status text NOT NULL CHECK(signature_status IN ('not_required','pending','verified')),
 reviewed_by uuid REFERENCES public.user_profiles(id), reviewed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'accepted' OR (document_id IS NOT NULL AND reviewed_by IS NOT NULL AND signature_status<>'pending')),
 CHECK(status<>'not_applicable' OR (coalesce(length(btrim(review_reason)),0)>0 AND reviewed_by IS NOT NULL))
);
CREATE TABLE public.benefits_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 payload jsonb NOT NULL, manifest jsonb NOT NULL, created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 submission_id uuid NOT NULL REFERENCES public.benefits_submissions(id), payload jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 action text NOT NULL, payload jsonb NOT NULL, revision integer NOT NULL,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, case_id uuid NOT NULL REFERENCES public.benefits_cases(id), action text NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.benefits_access_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id uuid NOT NULL REFERENCES public.benefits_access_grants(id),
 payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX benefits_requirements_case ON public.benefits_requirements(case_id);
CREATE INDEX benefits_documents_case ON public.benefits_documents(case_id);
CREATE INDEX benefits_events_case ON public.benefits_events(case_id,created_at);
CREATE INDEX benefits_submissions_case ON public.benefits_submissions(case_id,created_at);
CREATE INDEX benefits_receipts_case ON public.benefits_receipts(case_id,created_at);
CREATE INDEX benefits_history_case ON public.benefits_history(case_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['benefits_access_grants','benefits_cases','benefits_documents','benefits_requirements','benefits_events','benefits_submissions','benefits_receipts','benefits_history','benefits_requests','benefits_access_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('benefits-documents','benefits-documents',false,15728640,ARRAY['application/pdf','image/jpeg','image/png']);
-- Restrictive policies defeat any existing permissive blanket storage policies.
CREATE POLICY benefits_no_direct_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'benefits-documents') WITH CHECK(bucket_id<>'benefits-documents');

CREATE FUNCTION haven.benefits_actor() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_role_text NOT IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse')
 OR EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=a.actor_user_id AND coalesce(p.settings->>'must_change_password','false')<>'false') THEN
 RAISE EXCEPTION 'Benefits actor unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',a.actor_user_id,'org',a.actor_organization_id,'admin',a.actor_role_text IN ('owner','org_admin'));
END $$;
CREATE FUNCTION haven.benefits_staff(p_user uuid,p_org uuid,p_facility uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=p_user AND p.organization_id=p_org AND p.is_active AND p.deleted_at IS NULL AND u.deleted_at IS NULL
 AND (u.banned_until IS NULL OR u.banned_until<=now()) AND p.app_role::text IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse')
 AND coalesce(p.settings->>'must_change_password','false')='false'
 AND (p.app_role::text IN ('owner','org_admin') OR (
 EXISTS(SELECT 1 FROM public.user_facility_access a WHERE a.user_id=p.id AND a.facility_id=p_facility AND a.organization_id=p_org AND a.revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.staff s WHERE s.user_id=p.id AND s.organization_id=p_org AND s.deleted_at IS NULL AND s.employment_status='active'
 AND (s.termination_date IS NULL OR s.termination_date>current_date) AND (s.facility_id=p_facility OR EXISTS(
 SELECT 1 FROM public.staff_facility_assignments x WHERE x.staff_id=s.id AND x.organization_id=p_org AND x.facility_id=p_facility AND x.deleted_at IS NULL AND x.start_date<=current_date AND (x.end_date IS NULL OR x.end_date>=current_date)))))));
$$;
CREATE FUNCTION haven.benefits_permission(p_facility uuid,p_mode text DEFAULT 'read') RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF NOT haven.has_facility_access(p_facility) OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=p_facility AND f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL) THEN RETURN false; END IF;
 IF (a->>'admin')::boolean THEN RETURN true; END IF;
 RETURN haven.benefits_staff((a->>'id')::uuid,(a->>'org')::uuid,p_facility) AND EXISTS(
 SELECT 1 FROM public.benefits_access_grants g WHERE g.user_id=(a->>'id')::uuid AND g.organization_id=(a->>'org')::uuid AND g.facility_id=p_facility AND g.revoked_at IS NULL AND g.expires_at>now()
 AND (p_mode='read' OR p_mode='write' AND g.can_write OR p_mode='review' AND g.can_review));
END $$;
CREATE FUNCTION haven.benefits_assert_case(p_case uuid,p_mode text DEFAULT 'read') RETURNS public.benefits_cases LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases; BEGIN
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case;
 IF c.id IS NULL OR NOT haven.benefits_permission(c.facility_id,p_mode) OR NOT EXISTS(
 SELECT 1 FROM public.residents r WHERE r.id=c.resident_id AND r.organization_id=c.organization_id AND r.facility_id=c.facility_id AND r.deleted_at IS NULL) THEN
 RAISE EXCEPTION 'Benefits case unavailable' USING ERRCODE='42501'; END IF;
 RETURN c;
END $$;
CREATE FUNCTION haven.benefits_case_json(c public.benefits_cases) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(c)||jsonb_build_object('resident_name',r.first_name||' '||r.last_name,'facility_name',f.name,'assignee_name',u.full_name)
 FROM public.residents r JOIN public.facilities f ON f.id=c.facility_id LEFT JOIN public.user_profiles u ON u.id=c.assigned_to WHERE r.id=c.resident_id;
$$;
CREATE FUNCTION haven.benefits_keys(p jsonb,keys text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT k=ANY(keys)) OR length(p::text)>65536 THEN
 RAISE EXCEPTION 'Invalid benefits payload' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION haven.benefits_document_check(p_case uuid,p_document uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF p_document IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.benefits_documents d WHERE d.id=p_document AND d.case_id=p_case AND d.status='ready' AND d.verified_object IS NOT NULL AND d.verified_object=haven.benefits_object(d.storage_path)) THEN
 RAISE EXCEPTION 'Document unavailable for this case' USING ERRCODE='22023'; END IF; END $$;
CREATE FUNCTION haven.benefits_lock_authority(p_facility uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 PERFORM 1 FROM public.user_profiles WHERE id=(a->>'id')::uuid FOR SHARE;
 PERFORM 1 FROM auth.users WHERE id=(a->>'id')::uuid FOR SHARE;
 PERFORM 1 FROM auth.sessions WHERE id=(auth.jwt()->>'session_id')::uuid AND user_id=(a->>'id')::uuid FOR SHARE;
 PERFORM 1 FROM public.facilities WHERE id=p_facility FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=(a->>'id')::uuid AND facility_id=p_facility AND revoked_at IS NULL FOR SHARE;
 PERFORM 1 FROM public.benefits_access_grants WHERE user_id=(a->>'id')::uuid AND facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.staff WHERE user_id=(a->>'id')::uuid FOR SHARE;
 PERFORM 1 FROM public.staff_facility_assignments WHERE staff_id IN (SELECT id FROM public.staff WHERE user_id=(a->>'id')::uuid) AND facility_id=p_facility FOR SHARE;
END $$;
CREATE FUNCTION haven.benefits_case_create_internal(p_resident_id uuid,p_admission_case_id uuid,p_program text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; c public.benefits_cases; existing public.benefits_requests; payload jsonb; result jsonb; BEGIN
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL FOR SHARE;
 PERFORM haven.benefits_lock_authority(r.facility_id);
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_program IS NULL OR p_program NOT IN ('smmc_ltc','oss','other') THEN RAISE EXCEPTION 'Invalid case' USING ERRCODE='22023'; END IF;
 IF p_admission_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admission_cases ac WHERE ac.id=p_admission_case_id AND ac.resident_id=r.id AND ac.facility_id=r.facility_id AND ac.organization_id=r.organization_id AND ac.deleted_at IS NULL) THEN RAISE EXCEPTION 'Admission unavailable' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('resident_id',p_resident_id,'admission_case_id',p_admission_case_id,'program',p_program);
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 SELECT * INTO existing FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF existing.actor_id<>(a->>'id')::uuid OR existing.action<>'create_case' OR existing.payload<>payload THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 PERFORM haven.benefits_assert_case(existing.case_id,'write'); RETURN existing.result; END IF;
 INSERT INTO public.benefits_cases(organization_id,facility_id,resident_id,admission_case_id,program,created_by)
 VALUES(r.organization_id,r.facility_id,r.id,p_admission_case_id,p_program,(a->>'id')::uuid) RETURNING * INTO c;
 UPDATE public.benefits_cases SET next_action='Review screening facts and confirm required evidence' WHERE id=c.id;
 IF p_program='smmc_ltc' THEN
  INSERT INTO public.benefits_requirements(case_id,title,stage,status,signature_status,notes)
  SELECT c.id,t.title,t.stage,'missing',t.signature_status,'Jessica source checklist; verify applicability and current form version. Not applicable requires reviewer reason.'
  FROM (VALUES
   ('Signed intake and financial screening','referral','pending'),
   ('AHCA 3008 medical certification','assessment','pending'),
   ('Current medication list','assessment','not_required'),
   ('Signed ACCESS application','application','pending'),
   ('Financial information release','application','pending'),
   ('Elder Options release','application','pending'),
   ('Designated representative appointment','application','pending'),
   ('Admission letter','application','not_required'),
   ('Photo identification','application','not_required'),
   ('Social Security card','application','not_required'),
   ('Medicare and other insurance cards','application','not_required'),
   ('Three months of bank statements: all accounts and pages','application','not_required'),
   ('Income verification','application','not_required'),
   ('Life insurance policy face and cash values','application','not_required'),
   ('Burial contract and funding evidence','application','not_required'),
   ('Property and other asset evidence','application','not_required'),
   ('Power of attorney or other representative authority','application','not_required'),
   ('Spouse financial and supporting documents','application','not_required')
  ) t(title,stage,signature_status);
 END IF;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'create_case',payload,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'create_case',payload,result);
 RETURN result;
END $$;
ALTER TABLE public.benefits_documents ADD COLUMN verified_object jsonb, ADD COLUMN verified_at timestamptz;
CREATE FUNCTION haven.benefits_object(p_path text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',o.id,'version',o.version,'etag',o.metadata->>'eTag','size_bytes',(o.metadata->>'size')::bigint,'mime_type',o.metadata->>'mimetype')
 FROM storage.objects o WHERE o.bucket_id='benefits-documents' AND o.name=p_path;
$$;
CREATE FUNCTION haven.benefits_document_target_internal(p_case_id uuid,p_document_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.benefits_documents; obj jsonb; BEGIN
 PERFORM haven.benefits_assert_case(p_case_id,'read');
 SELECT * INTO d FROM public.benefits_documents WHERE id=p_document_id AND case_id=p_case_id;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='42501'; END IF;
 obj:=haven.benefits_object(d.storage_path);
 IF d.status='ready' AND (d.verified_object IS NULL OR obj IS DISTINCT FROM d.verified_object) THEN RAISE EXCEPTION 'Document bytes changed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('document',to_jsonb(d),'object',obj);
END $$;
CREATE FUNCTION haven.benefits_document_attest_internal(p_document_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text,p_object_id uuid,p_object_version text,p_etag text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.benefits_documents; obj jsonb; BEGIN
 SELECT * INTO d FROM public.benefits_documents WHERE id=p_document_id FOR UPDATE;
 obj:=haven.benefits_object(d.storage_path);
 IF d.id IS NULL OR d.status<>'reserved' OR d.sha256 IS DISTINCT FROM p_sha256 OR d.size_bytes IS DISTINCT FROM p_size_bytes OR d.mime_type IS DISTINCT FROM p_mime_type
 OR obj IS NULL OR (obj->>'id')::uuid IS DISTINCT FROM p_object_id OR obj->>'version' IS DISTINCT FROM p_object_version OR obj->>'etag' IS DISTINCT FROM p_etag
 OR (obj->>'size_bytes')::bigint IS DISTINCT FROM p_size_bytes OR obj->>'mime_type' IS DISTINCT FROM p_mime_type THEN
 RAISE EXCEPTION 'Document attestation mismatch' USING ERRCODE='55000'; END IF;
 UPDATE public.benefits_documents SET verified_object=obj,verified_at=now() WHERE id=d.id;
END $$;
CREATE FUNCTION haven.benefits_case_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; old public.benefits_requests; result jsonb; v_id uuid; doc public.benefits_documents; req public.benefits_requirements; k text; v jsonb; manifest jsonb; mode text:='write'; stored_payload jsonb; BEGIN
 IF p_action='upsert_requirement' AND (p_payload->>'status' IN ('accepted','rejected','not_applicable') OR p_payload->>'signature_status'='verified') OR p_action='update_case' AND p_payload#>>'{funding,status}'='reviewed' OR p_action='record_event' AND coalesce((p_payload->>'formal_decision')::boolean,false) THEN mode:='review'; END IF;
 c:=haven.benefits_assert_case(p_case_id,mode);
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_action IS NULL THEN RAISE EXCEPTION 'Missing command identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored_payload:=jsonb_build_object('payload',p_payload,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>p_case_id OR old.action<>p_action OR old.payload<>stored_payload THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 RETURN old.result; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM haven.benefits_lock_authority(c.facility_id);
 PERFORM 1 FROM public.residents WHERE id=c.resident_id FOR SHARE;
 c:=haven.benefits_assert_case(p_case_id,mode);
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed; refresh and retry' USING ERRCODE='40001'; END IF;
 IF c.status='closed' AND p_action<>'update_case' THEN RAISE EXCEPTION 'Reopen the case before modifying' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'assigned_to' AND p_payload->>'assigned_to' IS NOT NULL AND NOT haven.benefits_staff((p_payload->>'assigned_to')::uuid,c.organization_id,c.facility_id) THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_payload) LOOP
  IF k IN ('due_date','occurred_on') AND p_payload->>k IS NOT NULL AND p_payload->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END IF;
  IF k IN ('sent_at','received_at') AND p_payload->>k IS NOT NULL AND p_payload->>k !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'Invalid timestamp' USING ERRCODE='22023'; END IF;
  IF k IN ('notes','source_reference','external_reference','review_reason','closure_reason','next_action') AND (length(p_payload->>k)>4000 OR jsonb_typeof(p_payload->k) NOT IN ('string','null')) THEN RAISE EXCEPTION 'Invalid benefits text' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_action<>'finalize_document' AND p_payload ? 'document_id' THEN PERFORM haven.benefits_document_check(c.id,(p_payload->>'document_id')::uuid); END IF;
 CASE p_action
 WHEN 'update_case' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['status','next_action','assigned_to','due_date','closure_reason','screening','funding']);
  IF p_payload ? 'screening' THEN
   v:=p_payload->'screening'; PERFORM haven.benefits_keys(v,ARRAY['income_cents','assets_cents','income_basis','property','life_insurance','burial','power_of_attorney','married','notes','rule_reference']);
   FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF k IN ('income_cents','assets_cents') AND v->>k IS NOT NULL AND (jsonb_typeof(v->k)<>'number' OR v->>k !~ '^[0-9]+$' OR (v->>k)::numeric>999999999999) THEN RAISE EXCEPTION 'Invalid screening amount' USING ERRCODE='22023'; END IF;
    IF k IN ('notes','rule_reference') AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>4000) THEN RAISE EXCEPTION 'Invalid screening text' USING ERRCODE='22023'; END IF;
    IF k IN ('property','life_insurance','burial','power_of_attorney','married') AND coalesce(v->>k,'') NOT IN ('yes','no','unknown') THEN RAISE EXCEPTION 'Invalid knowledge state' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF v ? 'income_basis' AND coalesce(v->>'income_basis','') NOT IN ('gross','countable','unknown') THEN RAISE EXCEPTION 'Invalid income basis' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'funding' THEN
   v:=p_payload->'funding'; PERFORM haven.benefits_keys(v,ARRAY['plan','reference','coverage_start','coverage_end','renewal_date','resident_contribution_cents','expected_benefit_cents','status','evidence_event_ids','notes']);
   FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF k IN ('resident_contribution_cents','expected_benefit_cents') AND v->>k IS NOT NULL AND (jsonb_typeof(v->k)<>'number' OR v->>k !~ '^[0-9]+$' OR (v->>k)::numeric>999999999999) THEN RAISE EXCEPTION 'Invalid funding amount' USING ERRCODE='22023'; END IF;
    IF k IN ('coverage_start','coverage_end','renewal_date') AND v->>k IS NOT NULL THEN
     IF v->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid funding date' USING ERRCODE='22023'; END IF;
     PERFORM (v->>k)::date; END IF;
    IF k IN ('plan','reference') AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>200) OR k='notes' AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>4000) THEN RAISE EXCEPTION 'Invalid funding text' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF v ? 'status' AND coalesce(v->>'status','') NOT IN ('unverified','reviewed') THEN RAISE EXCEPTION 'Invalid funding review state' USING ERRCODE='22023'; END IF;
   IF (v->>'coverage_end')::date < (v->>'coverage_start')::date THEN RAISE EXCEPTION 'Coverage ends before start' USING ERRCODE='22023'; END IF;
   IF v ? 'evidence_event_ids' THEN
    IF jsonb_typeof(v->'evidence_event_ids')<>'array' OR jsonb_array_length(v->'evidence_event_ids')>30 THEN RAISE EXCEPTION 'Invalid funding evidence' USING ERRCODE='22023'; END IF;
    FOR k IN SELECT jsonb_array_elements_text(v->'evidence_event_ids') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.id=k::uuid AND e.case_id=c.id AND (e.payload->>'formal_decision')::boolean) THEN RAISE EXCEPTION 'Funding evidence unavailable' USING ERRCODE='22023'; END IF;
    END LOOP;
   END IF;
   IF v->>'status'='reviewed' AND (coalesce(jsonb_array_length(v->'evidence_event_ids'),0)=0 OR nullif(btrim(v->>'plan'),'') IS NULL OR nullif(btrim(v->>'reference'),'') IS NULL OR v->>'coverage_start' IS NULL) THEN RAISE EXCEPTION 'Reviewed funding needs plan, reference, start and agency evidence' USING ERRCODE='22023'; END IF;
   IF v->>'status'='reviewed' THEN
    IF NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='dcf' AND e.payload->>'event_type'='eligibility' AND lower(btrim(e.payload->>'outcome')) IN ('approved','eligible')) THEN RAISE EXCEPTION 'Reviewed funding needs approved DCF eligibility evidence' USING ERRCODE='22023'; END IF;
    IF c.program='smmc_ltc' AND (
      NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='cares' AND e.payload->>'event_type' IN ('assessment','eligibility') AND lower(btrim(e.payload->>'outcome')) IN ('approved','eligible'))
      OR NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='enrollment' AND lower(btrim(e.payload->>'outcome')) IN ('approved','enrolled','active','completed'))
      OR NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='authorization' AND lower(btrim(e.payload->>'outcome')) IN ('approved','authorized','active'))
    ) THEN RAISE EXCEPTION 'Reviewed LTC funding needs approved CARES, plan enrollment and authorization evidence' USING ERRCODE='22023'; END IF;
   END IF;
  END IF;
  UPDATE public.benefits_cases SET status=CASE WHEN p_payload?'status' THEN p_payload->>'status' ELSE status END,
   next_action=CASE WHEN p_payload?'next_action' THEN p_payload->>'next_action' ELSE next_action END,
   assigned_to=CASE WHEN p_payload?'assigned_to' THEN (p_payload->>'assigned_to')::uuid ELSE assigned_to END,
   due_date=CASE WHEN p_payload?'due_date' THEN (p_payload->>'due_date')::date ELSE due_date END,
   closure_reason=CASE WHEN p_payload?'closure_reason' THEN p_payload->>'closure_reason' ELSE closure_reason END,
   screening=CASE WHEN p_payload?'screening' THEN p_payload->'screening' ELSE screening END,
   funding=CASE WHEN p_payload?'funding' THEN p_payload->'funding' ELSE funding END WHERE id=c.id;
 WHEN 'upsert_requirement' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['id','title','stage','status','assigned_to','due_date','notes','document_id','review_reason','signature_status']);
  v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  SELECT * INTO req FROM public.benefits_requirements WHERE benefits_requirements.id=v_id;
  IF FOUND AND req.case_id<>c.id THEN RAISE EXCEPTION 'Requirement unavailable' USING ERRCODE='22023'; END IF;
  IF req.status IN ('accepted','not_applicable') AND mode<>'review' AND NOT haven.benefits_permission(c.facility_id,'review') THEN RAISE EXCEPTION 'Review permission required to change reviewed evidence' USING ERRCODE='42501'; END IF;
  INSERT INTO public.benefits_requirements(id,case_id,title,stage,status,assigned_to,due_date,notes,document_id,review_reason,signature_status,reviewed_by,reviewed_at)
  VALUES(v_id,c.id,p_payload->>'title',p_payload->>'stage',p_payload->>'status',(p_payload->>'assigned_to')::uuid,(p_payload->>'due_date')::date,p_payload->>'notes',(p_payload->>'document_id')::uuid,p_payload->>'review_reason',coalesce(p_payload->>'signature_status','not_required'),CASE WHEN mode='review' THEN (a->>'id')::uuid END,CASE WHEN mode='review' THEN now() END)
  ON CONFLICT ON CONSTRAINT benefits_requirements_pkey DO UPDATE SET title=excluded.title,stage=excluded.stage,status=excluded.status,assigned_to=excluded.assigned_to,due_date=excluded.due_date,notes=excluded.notes,document_id=excluded.document_id,review_reason=excluded.review_reason,signature_status=excluded.signature_status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now();
 WHEN 'record_event' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['agency','event_type','outcome','occurred_on','notes','source_reference','document_id','due_date','formal_decision']);
  IF coalesce(p_payload->>'agency','') NOT IN ('elder_options','cares','dcf','plan','other') OR coalesce(p_payload->>'event_type','') NOT IN ('screening','waitlist','assessment','application','eligibility','enrollment','authorization','correspondence','denial','appeal','renewal','notice_review','note') OR length(coalesce(btrim(p_payload->>'outcome'),'')) NOT BETWEEN 1 AND 200 OR p_payload->>'occurred_on' IS NULL THEN RAISE EXCEPTION 'Invalid agency event' USING ERRCODE='22023'; END IF;
  PERFORM (p_payload->>'occurred_on')::date; PERFORM (p_payload->>'due_date')::date;
  IF coalesce((p_payload->>'formal_decision')::boolean,false) THEN
   IF NOT haven.benefits_permission(c.facility_id,'review') THEN RAISE EXCEPTION 'Review permission required' USING ERRCODE='42501'; END IF;
   IF p_payload->>'document_id' IS NULL AND nullif(btrim(p_payload->>'source_reference'),'') IS NULL THEN RAISE EXCEPTION 'Formal decision requires attributable source' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,p_payload,(a->>'id')::uuid) RETURNING benefits_events.id INTO v_id;
 WHEN 'record_submission' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['stage','destination','method','sent_at','external_reference','document_ids','notes']);
  IF coalesce(p_payload->>'stage','') NOT IN ('screening','referral','assessment','application','funding','renewal') OR length(coalesce(btrim(p_payload->>'destination'),'')) NOT BETWEEN 1 AND 300 OR coalesce(p_payload->>'method','') NOT IN ('fax','portal','mail','secure_email','in_person') OR p_payload->>'sent_at' IS NULL OR jsonb_typeof(p_payload->'document_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission' USING ERRCODE='22023'; END IF;
  PERFORM (p_payload->>'sent_at')::timestamptz;
  IF jsonb_array_length(p_payload->'document_ids')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'document_ids')) THEN RAISE EXCEPTION 'Duplicate submission documents' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_payload->'document_ids') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Submission requires documents' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.stage=p_payload->>'stage') OR EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.stage=p_payload->>'stage' AND (r.status NOT IN ('accepted','not_applicable') OR r.status='accepted' AND NOT (p_payload->'document_ids' ? r.document_id::text))) THEN RAISE EXCEPTION 'Submission stage has unmet requirements' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_array_elements_text(p_payload->'document_ids') LOOP
   PERFORM haven.benefits_document_check(c.id,k::uuid);
   IF NOT EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.document_id=k::uuid AND r.status='accepted' AND r.signature_status<>'pending') THEN RAISE EXCEPTION 'Submission contains unreviewed document' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('id',d.id,'sha256',d.sha256,'filename',d.filename,'template_version',d.template_version) ORDER BY d.id) INTO manifest FROM public.benefits_documents d WHERE d.case_id=c.id AND p_payload->'document_ids' ? d.id::text;
  INSERT INTO public.benefits_submissions(case_id,payload,manifest,created_by) VALUES(c.id,p_payload,manifest,(a->>'id')::uuid) RETURNING benefits_submissions.id INTO v_id;
 WHEN 'record_receipt' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['submission_id','received_at','source_reference','document_id','notes']);
  IF NOT EXISTS(SELECT 1 FROM public.benefits_submissions s WHERE s.id=(p_payload->>'submission_id')::uuid AND s.case_id=c.id) OR p_payload->>'received_at' IS NULL OR (p_payload->>'document_id' IS NULL AND nullif(btrim(p_payload->>'source_reference'),'') IS NULL) THEN RAISE EXCEPTION 'Receipt needs submission and source' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'received_at')::timestamptz < (SELECT (s.payload->>'sent_at')::timestamptz FROM public.benefits_submissions s WHERE s.id=(p_payload->>'submission_id')::uuid) THEN RAISE EXCEPTION 'Receipt precedes submission' USING ERRCODE='22023'; END IF;
  INSERT INTO public.benefits_receipts(case_id,submission_id,payload,created_by) VALUES(c.id,(p_payload->>'submission_id')::uuid,p_payload,(a->>'id')::uuid) RETURNING benefits_receipts.id INTO v_id;
 WHEN 'prepare_document' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['filename','mime_type','size_bytes','sha256','document_type','template_version']);
  v_id:=gen_random_uuid();
  INSERT INTO public.benefits_documents(id,case_id,filename,mime_type,size_bytes,sha256,storage_path,document_type,template_version,created_by)
  VALUES(v_id,c.id,p_payload->>'filename',p_payload->>'mime_type',(p_payload->>'size_bytes')::bigint,p_payload->>'sha256',c.organization_id||'/'||c.id||'/'||v_id,p_payload->>'document_type',p_payload->>'template_version',(a->>'id')::uuid) RETURNING * INTO doc;
 WHEN 'finalize_document' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['document_id']);
  SELECT * INTO doc FROM public.benefits_documents WHERE benefits_documents.id=(p_payload->>'document_id')::uuid AND case_id=c.id FOR UPDATE;
  IF doc.id IS NULL OR doc.status<>'reserved' OR doc.created_by<>(a->>'id')::uuid OR doc.verified_at IS NULL OR doc.verified_object IS NULL OR haven.benefits_object(doc.storage_path) IS DISTINCT FROM doc.verified_object THEN RAISE EXCEPTION 'Verified document bytes unavailable' USING ERRCODE='55000'; END IF;
  UPDATE public.benefits_documents SET status='ready' WHERE benefits_documents.id=doc.id RETURNING * INTO doc;
 ELSE RAISE EXCEPTION 'Unsupported benefits command' USING ERRCODE='22023';
 END CASE;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE benefits_cases.id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'record_id',v_id);
 IF doc.id IS NOT NULL THEN result:=result||jsonb_build_object('document',to_jsonb(doc)); END IF;
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,p_action,p_payload,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,p_action,stored_payload,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.benefits_case_detail_internal(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases:=haven.benefits_assert_case(p_case_id); a jsonb:=haven.benefits_actor(); BEGIN
 RETURN jsonb_build_object('case',haven.benefits_case_json(c),
 'permissions',jsonb_build_object('can_write',haven.benefits_permission(c.facility_id,'write'),'can_review',haven.benefits_permission(c.facility_id,'review'),'can_manage_access',(a->>'admin')::boolean),
 'requirements',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.stage,r.title) FROM public.benefits_requirements r WHERE r.case_id=c.id),'[]'),
 'documents',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC) FROM public.benefits_documents d WHERE d.case_id=c.id),'[]'),
 'events',coalesce((SELECT jsonb_agg((to_jsonb(e)-'payload')||e.payload ORDER BY e.created_at DESC) FROM public.benefits_events e WHERE e.case_id=c.id),'[]'),
 'submissions',coalesce((SELECT jsonb_agg((to_jsonb(s)-'payload')||s.payload ORDER BY s.created_at DESC) FROM public.benefits_submissions s WHERE s.case_id=c.id),'[]'),
 'receipts',coalesce((SELECT jsonb_agg((to_jsonb(r)-'payload')||r.payload ORDER BY r.created_at DESC) FROM public.benefits_receipts r WHERE r.case_id=c.id),'[]'),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.revision DESC) FROM (SELECT * FROM public.benefits_history WHERE case_id=c.id ORDER BY revision DESC LIMIT 200) h),'[]'),
 'history_has_more',(SELECT count(*)>200 FROM public.benefits_history WHERE case_id=c.id));
END $$;
CREATE FUNCTION haven.benefits_case_list_internal(p_filters jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); rows jsonb; lim integer:=coalesce((p_filters->>'limit')::integer,50); cursor uuid; BEGIN
 PERFORM haven.benefits_keys(p_filters,ARRAY['facility_id','resident_id','status','before','limit']);
 IF lim NOT BETWEEN 1 AND 100 OR p_filters?'status' AND p_filters->>'status' NOT IN ('open','waiting','closed') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 IF p_filters->>'facility_id' IS NOT NULL AND NOT haven.benefits_permission((p_filters->>'facility_id')::uuid) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(haven.benefits_case_json(q::public.benefits_cases) ORDER BY q.id DESC),'[]') INTO rows FROM (
 SELECT c.* FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id AND r.facility_id=c.facility_id AND r.organization_id=c.organization_id AND r.deleted_at IS NULL
 WHERE c.organization_id=(a->>'org')::uuid AND haven.benefits_permission(c.facility_id)
 AND (p_filters->>'facility_id' IS NULL OR c.facility_id=(p_filters->>'facility_id')::uuid)
 AND (p_filters->>'resident_id' IS NULL OR c.resident_id=(p_filters->>'resident_id')::uuid)
 AND (p_filters->>'status' IS NULL OR c.status=p_filters->>'status')
 AND (p_filters->>'before' IS NULL OR c.id<(p_filters->>'before')::uuid) ORDER BY c.id DESC LIMIT lim+1) q;
 IF jsonb_array_length(rows)>lim THEN cursor:=(rows->(lim-1)->>'id')::uuid; rows:=rows-lim; END IF;
 RETURN jsonb_build_object('cases',rows,'next_cursor',cursor);
END $$;
CREATE FUNCTION haven.benefits_options_internal(p_facility_id uuid DEFAULT NULL,p_query text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); facilities jsonb; BEGIN
 IF length(p_query)>200 THEN RAISE EXCEPTION 'Search too long' USING ERRCODE='22023'; END IF;
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name),'[]') INTO facilities FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id);
 IF jsonb_array_length(facilities)=0 THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('facilities',facilities,'can_manage_access',(a->>'admin')::boolean,
 'residents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.id,r.first_name||' '||r.last_name name,r.facility_id FROM public.residents r WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND haven.benefits_permission(r.facility_id,'write') AND (p_facility_id IS NULL OR r.facility_id=p_facility_id) AND (r.id::text=p_query OR (r.first_name||' '||r.last_name) ILIKE '%'||p_query||'%') ORDER BY r.last_name,r.id LIMIT 100) x),'[]'),
 'assignees',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT p.id,p.full_name name,f.id facility_id FROM public.user_profiles p JOIN public.facilities f ON f.organization_id=p.organization_id AND f.deleted_at IS NULL WHERE p.organization_id=(a->>'org')::uuid AND haven.benefits_permission(f.id) AND (p_facility_id IS NULL OR f.id=p_facility_id) AND haven.benefits_staff(p.id,p.organization_id,f.id) AND (p.app_role::text IN ('owner','org_admin') OR EXISTS(SELECT 1 FROM public.benefits_access_grants g WHERE g.user_id=p.id AND g.facility_id=f.id AND g.revoked_at IS NULL AND g.expires_at>now() AND (g.can_write OR g.can_review))) ORDER BY p.full_name,f.id LIMIT 500) x),'[]'));
END $$;
CREATE FUNCTION haven.benefits_access_list_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF NOT (a->>'admin')::boolean THEN RAISE EXCEPTION 'Benefits grant administrator required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_manage',true,
 'grants',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('user_name',p.full_name,'facility_name',f.name) ORDER BY g.updated_at DESC) FROM public.benefits_access_grants g JOIN public.user_profiles p ON p.id=g.user_id JOIN public.facilities f ON f.id=g.facility_id WHERE g.organization_id=(a->>'org')::uuid),'[]'),
 'users',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT p.id,p.full_name name,f.id facility_id FROM public.user_profiles p JOIN public.facilities f ON f.organization_id=p.organization_id AND f.deleted_at IS NULL WHERE p.organization_id=(a->>'org')::uuid AND haven.benefits_staff(p.id,p.organization_id,f.id) ORDER BY p.full_name,f.id LIMIT 1000) x),'[]'));
END $$;
CREATE FUNCTION haven.benefits_access_set_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); g public.benefits_access_grants; facility uuid:=(p_payload->>'facility_id')::uuid; user_id uuid:=(p_payload->>'user_id')::uuid; BEGIN
 PERFORM haven.benefits_keys(p_payload,ARRAY['facility_id','user_id','can_write','can_review','expires_at','revoked','reason']);
 IF NOT (a->>'admin')::boolean OR NOT haven.has_facility_access(facility) THEN RAISE EXCEPTION 'Benefits grant administrator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=user_id AND p.organization_id=(a->>'org')::uuid) THEN RAISE EXCEPTION 'Grant subject unavailable' USING ERRCODE='22023'; END IF;
 IF NOT coalesce((p_payload->>'revoked')::boolean,false) AND (NOT haven.benefits_staff(user_id,(a->>'org')::uuid,facility) OR (p_payload->>'expires_at')::timestamptz<=now()) THEN RAISE EXCEPTION 'Grant requires current staff and future expiry' USING ERRCODE='22023'; END IF;
 INSERT INTO public.benefits_access_grants(organization_id,facility_id,user_id,can_write,can_review,expires_at,revoked_at,reason,granted_by)
 VALUES((a->>'org')::uuid,facility,user_id,(p_payload->>'can_write')::boolean,(p_payload->>'can_review')::boolean,(p_payload->>'expires_at')::timestamptz,CASE WHEN (p_payload->>'revoked')::boolean THEN now() END,p_payload->>'reason',(a->>'id')::uuid)
 ON CONFLICT ON CONSTRAINT benefits_access_grants_facility_id_user_id_key DO UPDATE SET can_write=excluded.can_write,can_review=excluded.can_review,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at,reason=excluded.reason,granted_by=excluded.granted_by,updated_at=now() RETURNING * INTO g;
 INSERT INTO public.benefits_access_history(grant_id,payload,created_by) VALUES(g.id,p_payload,(a->>'id')::uuid);
 RETURN to_jsonb(g);
END $$;
-- Immutable evidence survives closure and reviews. Byte metadata can only gain a
-- verified snapshot before finalization; finalized evidence cannot be rewritten.
CREATE FUNCTION haven.benefits_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Benefits history is immutable' USING ERRCODE='55000'; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['benefits_events','benefits_submissions','benefits_receipts','benefits_history','benefits_requests','benefits_access_history'] LOOP
 EXECUTE format('CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable()',t);
END LOOP; END $$;
CREATE FUNCTION haven.benefits_document_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='ready' OR (to_jsonb(NEW)-ARRAY['status','verified_at','verified_object']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','verified_at','verified_object']) THEN RAISE EXCEPTION 'Document evidence is immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER benefits_document_immutable BEFORE UPDATE OR DELETE ON public.benefits_documents FOR EACH ROW EXECUTE FUNCTION haven.benefits_document_immutable();

DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='haven' AND p.proname LIKE 'benefits_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig); END LOOP; END $$;
CREATE FUNCTION public.benefits_case_create(p_resident_id uuid,p_admission_case_id uuid,p_program text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_case_create_internal(p_resident_id,p_admission_case_id,p_program,p_request_id); $$;
REVOKE ALL ON FUNCTION public.benefits_case_create(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_case_create(uuid,uuid,text,uuid), haven.benefits_case_create_internal(uuid,uuid,text,uuid) TO authenticated;
CREATE FUNCTION public.benefits_case_command(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_case_command_internal(p_case_id,p_action,p_payload,p_expected_revision,p_request_id); $$;
REVOKE ALL ON FUNCTION public.benefits_case_command(uuid,text,jsonb,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_case_command(uuid,text,jsonb,integer,uuid), haven.benefits_case_command_internal(uuid,text,jsonb,integer,uuid) TO authenticated;
CREATE FUNCTION public.benefits_case_detail(p_case_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_case_detail_internal(p_case_id); $$;
REVOKE ALL ON FUNCTION public.benefits_case_detail(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_case_detail(uuid), haven.benefits_case_detail_internal(uuid) TO authenticated;
CREATE FUNCTION public.benefits_case_list(p_filters jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_case_list_internal(p_filters); $$;
REVOKE ALL ON FUNCTION public.benefits_case_list(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_case_list(jsonb), haven.benefits_case_list_internal(jsonb) TO authenticated;
CREATE FUNCTION public.benefits_options(p_facility_id uuid DEFAULT NULL,p_query text DEFAULT '') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_options_internal(p_facility_id,p_query); $$;
REVOKE ALL ON FUNCTION public.benefits_options(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_options(uuid,text), haven.benefits_options_internal(uuid,text) TO authenticated;
CREATE FUNCTION public.benefits_access_list() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_access_list_internal(); $$;
REVOKE ALL ON FUNCTION public.benefits_access_list() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_access_list(), haven.benefits_access_list_internal() TO authenticated;
CREATE FUNCTION public.benefits_access_set(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_access_set_internal(p_payload); $$;
REVOKE ALL ON FUNCTION public.benefits_access_set(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_access_set(jsonb), haven.benefits_access_set_internal(jsonb) TO authenticated;
CREATE FUNCTION public.benefits_document_target(p_case_id uuid,p_document_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_document_target_internal(p_case_id,p_document_id); $$;
REVOKE ALL ON FUNCTION public.benefits_document_target(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_document_target(uuid,uuid), haven.benefits_document_target_internal(uuid,uuid) TO authenticated;
CREATE FUNCTION public.benefits_document_attest(p_document_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text,p_object_id uuid,p_object_version text,p_etag text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_document_attest_internal(p_document_id,p_sha256,p_size_bytes,p_mime_type,p_object_id,p_object_version,p_etag); $$;
REVOKE ALL ON FUNCTION public.benefits_document_attest(uuid,text,bigint,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_document_attest(uuid,text,bigint,text,uuid,text,text), haven.benefits_document_attest_internal(uuid,text,bigint,text,uuid,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
