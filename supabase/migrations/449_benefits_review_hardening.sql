-- Created with supabase migration new; repository claim 449. COL-539 (review hardening of COL-504).
-- 1. Option, grant-subject and eligible-family lists are bounded by real access rows, with authority evaluated once per facility.
-- 2. A closed case accepts only an exact reopen payload.
-- 3. Waiving or verifying a pending signature is a review action.
-- 4. Assignees must be admins or hold an unexpired benefits grant.
BEGIN;
CREATE FUNCTION haven.benefits_assignable(p_user uuid,p_org uuid,p_facility uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.benefits_staff(p_user,p_org,p_facility) AND EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=p_user AND (p.app_role::text IN ('owner','org_admin')
 OR EXISTS(SELECT 1 FROM public.benefits_access_grants g WHERE g.user_id=p.id AND g.organization_id=p_org AND g.facility_id=p_facility AND g.revoked_at IS NULL AND g.expires_at>now() AND (g.can_write OR g.can_review))));
$$;
REVOKE ALL ON FUNCTION haven.benefits_assignable(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION haven.benefits_case_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed; refresh and retry' USING ERRCODE='P0409'; END IF;
 IF c.status='closed' AND (p_action<>'update_case' OR p_payload->>'status' IS DISTINCT FROM 'open' OR (p_payload-'closure_reason')<>'{"status":"open"}'::jsonb) THEN RAISE EXCEPTION 'Reopen the case before modifying' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'assigned_to' AND p_payload->>'assigned_to' IS NOT NULL AND NOT haven.benefits_assignable((p_payload->>'assigned_to')::uuid,c.organization_id,c.facility_id) THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='22023'; END IF;
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
  -- Waiving or verifying a pending signature is a distinct review, not ordinary evidence collection.
  IF FOUND AND req.signature_status='pending' AND coalesce(p_payload->>'signature_status','not_required')<>'pending' AND mode<>'review' THEN c:=haven.benefits_assert_case(p_case_id,'review'); mode:='review'; END IF;
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
CREATE OR REPLACE FUNCTION haven.benefits_options_internal(p_facility_id uuid DEFAULT NULL,p_query text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); facilities jsonb; read_sites uuid[]; write_sites uuid[]; BEGIN
 IF length(p_query)>200 THEN RAISE EXCEPTION 'Search too long' USING ERRCODE='22023'; END IF;
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 -- Authority is evaluated once per facility; every list below is bounded by those facilities and by actual access rows.
 SELECT coalesce(array_agg(f.id),'{}') INTO read_sites FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND (p_facility_id IS NULL OR f.id=p_facility_id) AND haven.benefits_permission(f.id);
 SELECT coalesce(array_agg(f.id),'{}') INTO write_sites FROM public.facilities f WHERE f.id=ANY(read_sites) AND haven.benefits_permission(f.id,'write');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name),'[]') INTO facilities FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id);
 IF jsonb_array_length(facilities)=0 THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('facilities',facilities,'can_manage_access',(a->>'admin')::boolean,
 'residents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.id,r.first_name||' '||r.last_name name,r.facility_id FROM public.residents r WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.facility_id=ANY(write_sites) AND (r.id::text=p_query OR (r.first_name||' '||r.last_name) ILIKE '%'||p_query||'%') ORDER BY r.last_name,r.id LIMIT 100) x),'[]'),
 'assignees',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT DISTINCT p.id,p.full_name name,f.id facility_id FROM public.facilities f
  JOIN LATERAL (
   SELECT g.user_id FROM public.benefits_access_grants g WHERE g.organization_id=(a->>'org')::uuid AND g.facility_id=f.id AND g.revoked_at IS NULL AND g.expires_at>now() AND (g.can_write OR g.can_review)
   UNION SELECT p2.id FROM public.user_profiles p2 WHERE p2.organization_id=(a->>'org')::uuid AND p2.is_active AND p2.deleted_at IS NULL AND p2.app_role::text IN ('owner','org_admin')
  ) c ON true JOIN public.user_profiles p ON p.id=c.user_id
  WHERE f.id=ANY(read_sites) AND haven.benefits_staff(p.id,(a->>'org')::uuid,f.id) ORDER BY p.full_name,f.id LIMIT 500) x),'[]'));
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_access_list_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF NOT (a->>'admin')::boolean THEN RAISE EXCEPTION 'Benefits grant administrator required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_manage',true,
 'grants',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('user_name',p.full_name,'facility_name',f.name) ORDER BY g.updated_at DESC) FROM public.benefits_access_grants g JOIN public.user_profiles p ON p.id=g.user_id JOIN public.facilities f ON f.id=g.facility_id WHERE g.organization_id=(a->>'org')::uuid),'[]'),
 -- Candidate grant subjects come from actual facility access rows (plus admins), not a profile x facility cross join.
 'users',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT DISTINCT p.id,p.full_name name,f.id facility_id FROM public.user_profiles p
  JOIN public.facilities f ON f.organization_id=p.organization_id AND f.deleted_at IS NULL
  WHERE p.organization_id=(a->>'org')::uuid AND p.is_active AND p.deleted_at IS NULL
  AND p.app_role::text IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse')
  AND (p.app_role::text IN ('owner','org_admin') OR EXISTS(SELECT 1 FROM public.user_facility_access u WHERE u.user_id=p.id AND u.facility_id=f.id AND u.organization_id=p.organization_id AND u.revoked_at IS NULL))
  AND haven.benefits_staff(p.id,p.organization_id,f.id) ORDER BY p.full_name,f.id LIMIT 1000) x),'[]'));
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_collection_list_internal(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases:=haven.benefits_assert_case(p_case_id,'read'); BEGIN
 RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('family_name',p.full_name) ORDER BY q.created_at DESC)
 FROM public.benefits_collection_requests q JOIN public.user_profiles p ON p.id=q.family_user_id WHERE q.case_id=c.id),'[]'),
 'eligible_family',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'can_make_decisions',haven.benefits_family_eligible(p.id,c,true)))
 FROM (SELECT DISTINCT l.user_id FROM public.family_resident_links l WHERE l.resident_id=c.resident_id AND l.organization_id=c.organization_id AND l.revoked_at IS NULL) x JOIN public.user_profiles p ON p.id=x.user_id WHERE haven.benefits_family_eligible(p.id,c,false)),'[]'));
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
