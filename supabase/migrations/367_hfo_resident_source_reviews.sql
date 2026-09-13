BEGIN;
-- Explicit human review with version-pinned native references. No clinical
-- writer or native-table trigger is introduced by this migration.
CREATE FUNCTION haven.resident_review_families(p_activity uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE a.activity_key
  WHEN 'hfo-al-d07-01' THEN ARRAY['rounding'] WHEN 'hfo-al-a04-01' THEN ARRAY['rounding']
  WHEN 'hfo-al-d12-01' THEN ARRAY['vital_observation'] WHEN 'hfo-al-a05-02' THEN ARRAY['vital_observation']
  WHEN 'hfo-al-m03-01' THEN ARRAY['form_1823'] WHEN 'hfo-al-a03-01' THEN ARRAY['form_1823']
  WHEN 'hfo-al-w07-01' THEN ARRAY['form_1823','resident_contact']
  WHEN 'hfo-al-a05-01' THEN ARRAY['form_1823','resident_contact'] ELSE ARRAY[]::text[] END
 FROM public.operation_activities a WHERE a.id=p_activity AND a.activity_kind='record_review' AND a.subject_kind='resident'
$$;
REVOKE ALL ON FUNCTION haven.resident_review_families(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_families(uuid) TO authenticated;

-- HFO metadata only. This definer never reads a native clinical source table.
CREATE FUNCTION haven.resident_review_context(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; s public.operation_activity_subjects; tz text; families text[];
BEGIN
 IF haven.authorized_user_id() IS NULL OR NOT coalesce(haven.operation_task_readable(p_task),false) THEN
  RAISE EXCEPTION 'Review scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 SELECT coalesce(timezone,'America/New_York') INTO tz FROM public.facilities WHERE id=t.facility_id;
 families:=coalesce(haven.resident_review_families(t.activity_id),ARRAY[]::text[]);
 RETURN jsonb_build_object('task_id',t.id,'facility_id',t.facility_id,'organization_id',t.organization_id,
  'activity_id',t.activity_id,'subject_kind',s.subject_kind,'resident_id',s.resident_id,'timezone',tz,
  'eligible',t.occurrence_kind IS NOT NULL AND t.authority_class='resident' AND cardinality(families)>0,
  'families',families,'revision',t.occurrence_revision,'period_start',t.period_start_date,'period_end',t.period_end_date);
END $$;
REVOKE ALL ON FUNCTION haven.resident_review_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_context(uuid) TO authenticated;

CREATE FUNCTION haven.lock_resident_review_scope(p_task uuid,p_revision text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;
BEGIN
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 c:=haven.resident_review_context(p_task);
 IF NOT (c->>'eligible')::boolean THEN RAISE EXCEPTION 'This activity requires its native or manual pathway' USING ERRCODE='22023'; END IF;
 IF p_revision IS NULL OR p_revision IS DISTINCT FROM c->>'revision' THEN RAISE EXCEPTION 'Review occurrence changed' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION haven.lock_resident_review_scope(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.lock_resident_review_scope(uuid,text) TO authenticated;

CREATE FUNCTION haven.resident_review_period_valid(c jsonb,p_start date,p_end date) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT p_start IS NOT NULL AND p_end IS NOT NULL AND p_start<=p_end
 AND p_end<=(clock_timestamp() AT TIME ZONE (c->>'timezone'))::date
$$;
REVOKE ALL ON FUNCTION haven.resident_review_period_valid(jsonb,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_period_valid(jsonb,date,date) TO authenticated;

-- Pure native-readiness predicate. The reader supplies actual facility-today
-- and current time; caller review-period dates never govern document currency.
CREATE FUNCTION haven.resident_review_document_current(p_status text,p_exam date,p_expiry date,p_received timestamptz,p_notes text,p_physician text,p_today date,p_now timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(p_status='received' AND p_received IS NOT NULL AND p_received<=p_now
 AND nullif(btrim(p_notes),'') IS NOT NULL AND nullif(btrim(p_physician),'') IS NOT NULL
 AND p_exam<=p_today AND p_expiry>=p_today AND p_expiry>=p_exam,false)
$$;
REVOKE ALL ON FUNCTION haven.resident_review_document_current(text,date,date,timestamptz,text,text,date,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_document_current(text,date,date,timestamptz,text,text,date,timestamptz) TO authenticated;

-- All clinical SELECTs run as the actual authenticated invoker. Zero visible
-- rows and native permission denial are both generic unavailability.
CREATE FUNCTION haven.read_resident_review_source(p_task uuid,p_family text,p_source uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; resident uuid; site uuid; org uuid; tz text; raw jsonb; source_at timestamptz; label text; meaning text;
BEGIN
 c:=haven.resident_review_context(p_task);
 IF NOT coalesce((c->>'eligible')::boolean,false) OR NOT coalesce(c->'families' ? p_family,false)
  OR NOT coalesce(haven.resident_review_period_valid(c,p_start,p_end),false) THEN RETURN NULL; END IF;
 resident:=(c->>'resident_id')::uuid; site:=(c->>'facility_id')::uuid; org:=(c->>'organization_id')::uuid;
 tz:=c->>'timezone';
 IF p_family='rounding' THEN
  SELECT jsonb_build_object('log',to_jsonb(l),'task_id',t.id,'completed_log_id',t.completed_log_id,'status',t.status),l.observed_at
  INTO raw,source_at FROM public.resident_observation_logs l JOIN public.resident_observation_tasks t ON t.id=l.task_id AND t.completed_log_id=l.id
  WHERE l.id=p_source AND l.resident_id=resident AND t.resident_id=resident AND l.facility_id=site AND t.facility_id=site
   AND l.organization_id=org AND t.organization_id=org AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status IN('completed_on_time','completed_late')
   AND (l.observed_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end AND l.observed_at<=clock_timestamp()
   AND l.updated_at<=clock_timestamp();
  label:='Completed rounding task and log'; meaning:='A recorded observation attached to a completed native task. Administrative review is recorded separately.';
 ELSIF p_family='vital_observation' THEN
  SELECT to_jsonb(v),v.observed_at INTO raw,source_at FROM public.daily_vital_observations v JOIN public.daily_logs l ON l.id=v.daily_log_id
  WHERE v.id=p_source AND v.resident_id=resident AND l.resident_id=resident AND v.facility_id=site AND l.facility_id=site
   AND v.organization_id=org AND l.organization_id=org AND v.deleted_at IS NULL AND l.deleted_at IS NULL
   AND (v.observed_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end AND v.observed_at<=clock_timestamp() AND v.created_at<=clock_timestamp();
  label:='Recorded vital observation'; meaning:='A recorded measurement, not a diagnosis, normal result or completed clinical review.';
 ELSIF p_family='form_1823' THEN
  SELECT jsonb_build_object('record',to_jsonb(f),'document_receipt',to_jsonb(d)),f.updated_at INTO raw,source_at
  FROM public.form_1823_records f JOIN public.admission_cases a ON a.id=f.admission_case_id AND a.resident_id=f.resident_id
  JOIN public.admission_document_checklist_items d ON d.admission_case_id=a.id AND d.document_type='form_1823'
  WHERE f.id=p_source AND f.resident_id=resident AND f.facility_id=site AND f.organization_id=org
   AND a.facility_id=site AND a.organization_id=org AND d.facility_id=site AND d.organization_id=org
   AND f.deleted_at IS NULL AND a.deleted_at IS NULL AND d.deleted_at IS NULL
   AND haven.resident_review_document_current(f.status::text,f.exam_date,f.expiration_date,d.received_at,d.notes,f.physician_name,
    (clock_timestamp() AT TIME ZONE tz)::date,clock_timestamp())
   AND f.updated_at<=clock_timestamp() AND d.updated_at<=clock_timestamp()
  ORDER BY d.updated_at DESC,d.id DESC LIMIT 1;
  label:='Received Form 1823 metadata'; meaning:='Current received document metadata, independent of the log-period filter; no provider signature or accuracy is established.';
 ELSIF p_family='resident_contact' THEN
  SELECT to_jsonb(n),n.updated_at INTO raw,source_at FROM public.resident_contacts n
  WHERE n.id=p_source AND n.resident_id=resident AND n.facility_id=site AND n.organization_id=org AND n.deleted_at IS NULL AND n.updated_at<=clock_timestamp();
  label:='Recorded contact metadata'; meaning:='Current recorded contact metadata, not a historical snapshot, emergency-packet completeness or signature authority.';
 ELSE RETURN NULL;
 END IF;
 IF raw IS NULL THEN RETURN NULL; END IF;
 PERFORM haven.resident_review_context(p_task);
 RETURN jsonb_build_object('source_id',p_source,'source_version',encode(sha256(convert_to(raw::text,'UTF8')),'hex'),
  'source_at',source_at,'label',label,'evidence_meaning',meaning);
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.read_resident_review_source(uuid,text,uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.read_resident_review_source(uuid,text,uuid,date,date) TO authenticated;

CREATE FUNCTION public.list_resident_review_sources(p_task uuid,p_family text,p_start date,p_end date,p_cursor uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; ids uuid[]; source_id uuid; item jsonb; items jsonb:='[]'::jsonb; n integer:=0; last_id uuid; next_id uuid; resident uuid; site uuid; org uuid;
BEGIN
 c:=haven.resident_review_context(p_task);
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR NOT coalesce(haven.resident_review_period_valid(c,p_start,p_end),false) THEN
  RAISE EXCEPTION 'Review period or page is invalid' USING ERRCODE='22023'; END IF;
 IF NOT coalesce((c->>'eligible')::boolean,false) OR NOT coalesce(c->'families' ? p_family,false) THEN
  RETURN jsonb_build_object('task_id',p_task,'subject_kind',c->'subject_kind','eligible',false,'allowed_families',c->'families',
   'family',NULL,'period',jsonb_build_object('start_date',p_start,'end_date',p_end),'availability','unavailable',
   'reason','This component requires its existing native or manual pathway; a source row cannot stand in for the required action.',
   'items','[]'::jsonb,'next_cursor',NULL,'complete',true);
 END IF;
 resident:=(c->>'resident_id')::uuid; site:=(c->>'facility_id')::uuid; org:=(c->>'organization_id')::uuid;
 BEGIN
  IF p_family='rounding' THEN
   SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.resident_observation_logs WHERE resident_id=resident AND facility_id=site AND organization_id=org AND deleted_at IS NULL AND (p_cursor IS NULL OR id>p_cursor) ORDER BY id LIMIT p_limit+1) x;
  ELSIF p_family='vital_observation' THEN
   SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.daily_vital_observations WHERE resident_id=resident AND facility_id=site AND organization_id=org AND deleted_at IS NULL AND (p_cursor IS NULL OR id>p_cursor) ORDER BY id LIMIT p_limit+1) x;
  ELSIF p_family='form_1823' THEN
   SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.form_1823_records WHERE resident_id=resident AND facility_id=site AND organization_id=org AND deleted_at IS NULL AND (p_cursor IS NULL OR id>p_cursor) ORDER BY id LIMIT p_limit+1) x;
  ELSIF p_family='resident_contact' THEN
   SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.resident_contacts WHERE resident_id=resident AND facility_id=site AND organization_id=org AND deleted_at IS NULL AND (p_cursor IS NULL OR id>p_cursor) ORDER BY id LIMIT p_limit+1) x;
  END IF;
  FOREACH source_id IN ARRAY coalesce(ids,ARRAY[]::uuid[]) LOOP
   n:=n+1; IF n>p_limit THEN next_id:=last_id; EXIT; END IF;
   last_id:=source_id;
   item:=haven.read_resident_review_source(p_task,p_family,source_id,p_start,p_end);
   IF item IS NOT NULL THEN items:=items||jsonb_build_array(item); END IF;
  END LOOP;
 EXCEPTION WHEN insufficient_privilege THEN
  RETURN jsonb_build_object('task_id',p_task,'subject_kind',c->'subject_kind','eligible',true,'allowed_families',c->'families','family',p_family,
   'period',jsonb_build_object('start_date',p_start,'end_date',p_end),'availability','unavailable','reason','Native source access is unavailable. Use the authorized manual pathway.',
   'items','[]'::jsonb,'next_cursor',NULL,'complete',false);
 END;
 RETURN jsonb_build_object('task_id',p_task,'subject_kind',c->'subject_kind','eligible',true,'allowed_families',c->'families','family',p_family,
  'period',jsonb_build_object('start_date',p_start,'end_date',p_end),'availability','available','reason',
  CASE WHEN jsonb_array_length(items)=0 THEN 'No qualifying readable sources in this page. This is not a completeness statement about the clinical record.' ELSE NULL END,
  'items',items,'next_cursor',next_id,'complete',next_id IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.list_resident_review_sources(uuid,text,date,date,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_resident_review_sources(uuid,text,date,date,uuid,integer) TO authenticated;

-- Visibility is separate from source eligibility: expired/superseded records
-- retain their citations while the caller can still read the native row.
CREATE FUNCTION haven.resident_review_source_visible(p_task uuid,p_family text,p_source uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; resident uuid; site uuid; org uuid; visible boolean:=false;
BEGIN
 c:=haven.resident_review_context(p_task);
 resident:=(c->>'resident_id')::uuid; site:=(c->>'facility_id')::uuid; org:=(c->>'organization_id')::uuid;
 IF NOT coalesce(c->'families' ? p_family,false) THEN RETURN false; END IF;
 IF p_family='rounding' THEN
 SELECT EXISTS(SELECT 1 FROM public.resident_observation_logs l JOIN public.resident_observation_tasks t ON t.id=l.task_id
 WHERE l.id=p_source AND l.resident_id=resident AND t.resident_id=resident AND l.facility_id=site AND t.facility_id=site
 AND l.organization_id=org AND t.organization_id=org) INTO visible;
 ELSIF p_family='vital_observation' THEN
 SELECT EXISTS(SELECT 1 FROM public.daily_vital_observations v JOIN public.daily_logs l ON l.id=v.daily_log_id
 WHERE v.id=p_source AND v.resident_id=resident AND l.resident_id=resident AND v.facility_id=site AND l.facility_id=site
 AND v.organization_id=org AND l.organization_id=org) INTO visible;
 ELSIF p_family='form_1823' THEN
 SELECT EXISTS(SELECT 1 FROM public.form_1823_records f WHERE f.id=p_source AND f.resident_id=resident AND f.facility_id=site AND f.organization_id=org) INTO visible;
 ELSIF p_family='resident_contact' THEN
 SELECT EXISTS(SELECT 1 FROM public.resident_contacts n WHERE n.id=p_source AND n.resident_id=resident AND n.facility_id=site AND n.organization_id=org) INTO visible;
 END IF;
 RETURN visible;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION haven.resident_review_source_visible(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_source_visible(uuid,text,uuid) TO authenticated;

CREATE TABLE haven.resident_review_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid NOT NULL REFERENCES public.operation_execution_receipts(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 family text NOT NULL CHECK(family IN('rounding','vital_observation','form_1823','resident_contact')),
 source_id uuid NOT NULL, source_version text NOT NULL CHECK(source_version ~ '^[a-f0-9]{64}$'),
 period_start date NOT NULL, period_end date NOT NULL CHECK(period_start<=period_end),
 linked_by uuid NOT NULL REFERENCES public.user_profiles(id), linked_at timestamptz NOT NULL,
 UNIQUE(receipt_id,family,source_id)
);
ALTER TABLE haven.resident_review_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.resident_review_references FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.resident_review_references TO authenticated;
CREATE TABLE haven.resident_review_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_id uuid NOT NULL REFERENCES haven.resident_review_references(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 request_key text NOT NULL, checked_by uuid NOT NULL REFERENCES public.user_profiles(id), checked_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('current','changed','unavailable')), observed_version text,
 UNIQUE(checked_by,request_key)
);
ALTER TABLE haven.resident_review_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.resident_review_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.resident_review_checks TO authenticated;
CREATE TABLE haven.resident_review_requests (
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), request_key text PRIMARY KEY, receipt_id uuid NOT NULL UNIQUE REFERENCES public.operation_execution_receipts(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 task_id uuid NOT NULL REFERENCES public.operation_task_instances(id), actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 selection_hash text NOT NULL, created_at timestamptz NOT NULL
);
ALTER TABLE haven.resident_review_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.resident_review_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.resident_review_requests TO authenticated;

-- Sanitized private-ledger metadata only. No native source SELECT or source
-- identifier/hash/period is disclosed by this helper, including on denial.
CREATE FUNCTION haven.resident_review_reference_summary(p_reference uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE ref haven.resident_review_references; r public.operation_execution_receipts;
BEGIN
 SELECT * INTO ref FROM haven.resident_review_references WHERE id=p_reference;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=ref.receipt_id;
 IF NOT coalesce(haven.operation_task_readable(r.task_instance_id),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('reference_id',ref.id,'receipt_id',r.id,'task_id',r.task_instance_id,'organization_id',r.organization_id,'facility_id',r.facility_id,'linked_at',ref.linked_at,
  'checks',coalesce((SELECT jsonb_agg(jsonb_build_object('checked_at',c.checked_at,'checked_by',c.checked_by,'state',c.state) ORDER BY c.checked_at,c.id)
   FROM haven.resident_review_checks c WHERE c.reference_id=ref.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION haven.resident_review_reference_summary(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_reference_summary(uuid) TO authenticated;

CREATE POLICY resident_review_reference_read ON haven.resident_review_references FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.operation_execution_receipts r WHERE r.id=receipt_id AND haven.operation_task_readable(r.task_instance_id)
  AND haven.resident_review_source_visible(r.task_instance_id,family,source_id)));
CREATE POLICY resident_review_reference_insert ON haven.resident_review_references FOR INSERT TO authenticated WITH CHECK(
 linked_by=haven.authorized_user_id() AND EXISTS(SELECT 1 FROM public.operation_execution_receipts r WHERE r.id=receipt_id AND r.recorder_id=auth.uid()
  AND haven.operation_task_readable(r.task_instance_id)));
CREATE POLICY resident_review_check_read ON haven.resident_review_checks FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM haven.resident_review_references r WHERE r.id=reference_id));
CREATE POLICY resident_review_check_insert ON haven.resident_review_checks FOR INSERT TO authenticated WITH CHECK(
 checked_by=haven.authorized_user_id() AND haven.resident_review_reference_summary(reference_id) IS NOT NULL);
CREATE POLICY resident_review_request_read ON haven.resident_review_requests FOR SELECT TO authenticated USING(
 actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id));
CREATE POLICY resident_review_request_insert ON haven.resident_review_requests FOR INSERT TO authenticated WITH CHECK(
 actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id));

-- Only HFO receipt insertion is coupled to this private issuance witness.
-- Native clinical writers never touch this ledger.
CREATE TABLE haven.resident_review_receipt_issuance (
 receipt_id uuid PRIMARY KEY REFERENCES public.operation_execution_receipts(id), transaction_id xid8 NOT NULL
);
ALTER TABLE haven.resident_review_receipt_issuance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.resident_review_receipt_issuance FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.capture_resident_review_receipt_issuance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.authority_class='resident' AND cardinality(coalesce(haven.resident_review_families(NEW.activity_id),ARRAY[]::text[]))>0 THEN
 INSERT INTO haven.resident_review_receipt_issuance(receipt_id,transaction_id) VALUES(NEW.id,pg_current_xact_id());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.capture_resident_review_receipt_issuance() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER resident_review_receipt_issuance AFTER INSERT ON public.operation_execution_receipts
 FOR EACH ROW EXECUTE FUNCTION haven.capture_resident_review_receipt_issuance();
CREATE FUNCTION haven.resident_review_issued_now(p_receipt uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM haven.resident_review_receipt_issuance i JOIN public.operation_execution_receipts r ON r.id=i.receipt_id
 WHERE i.receipt_id=p_receipt AND i.transaction_id=pg_current_xact_id() AND r.recorder_id=haven.authorized_user_id())
$$;
REVOKE ALL ON FUNCTION haven.resident_review_issued_now(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_issued_now(uuid) TO authenticated;

CREATE FUNCTION haven.guard_resident_review_reference() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.operation_execution_receipts; current_source jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Resident review references are immutable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=NEW.receipt_id;
 IF NOT FOUND OR r.recorder_id IS DISTINCT FROM haven.authorized_user_id() OR r.authority_class<>'resident'
  OR r.receipt_kind<>'performance' OR r.performer_kind<>'self' OR r.entry_kind<>'routine'
  OR r.recorded_at<transaction_timestamp() OR r.recorded_at>clock_timestamp() OR r.created_at IS DISTINCT FROM transaction_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts x WHERE x.id=r.id AND haven.resident_review_issued_now(x.id))
  THEN RAISE EXCEPTION 'A current self review receipt from this transaction is required' USING ERRCODE='42501'; END IF;
 current_source:=haven.read_resident_review_source(r.task_instance_id,NEW.family,NEW.source_id,NEW.period_start,NEW.period_end);
 IF current_source IS NULL THEN RAISE EXCEPTION 'Native review source unavailable' USING ERRCODE='42501'; END IF;
 IF current_source->>'source_version' IS DISTINCT FROM NEW.source_version THEN RAISE EXCEPTION 'Native review source changed' USING ERRCODE='40001'; END IF;
 NEW.organization_id:=r.organization_id; NEW.facility_id:=r.facility_id;
 NEW.linked_by:=haven.authorized_user_id(); NEW.linked_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_review_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER resident_review_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.resident_review_references
 FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_review_reference();

CREATE FUNCTION haven.guard_resident_review_check() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE meta jsonb; ref haven.resident_review_references; current_source jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Resident review check history is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.request_key IS NULL OR NEW.request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Review request key is invalid' USING ERRCODE='22023'; END IF;
 meta:=haven.resident_review_reference_summary(NEW.reference_id);
 IF meta IS NULL THEN RAISE EXCEPTION 'Review reference unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO ref FROM haven.resident_review_references WHERE id=NEW.reference_id;
 IF FOUND THEN current_source:=haven.read_resident_review_source((meta->>'task_id')::uuid,ref.family,ref.source_id,ref.period_start,ref.period_end); END IF;
 NEW.state:=CASE WHEN current_source IS NULL THEN 'unavailable' WHEN current_source->>'source_version'=ref.source_version THEN 'current' ELSE 'changed' END;
 NEW.organization_id:=(meta->>'organization_id')::uuid; NEW.facility_id:=(meta->>'facility_id')::uuid;
 NEW.observed_version:=current_source->>'source_version'; NEW.checked_by:=haven.authorized_user_id(); NEW.checked_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_review_check() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER resident_review_check_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.resident_review_checks
 FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_review_check();

CREATE FUNCTION haven.resident_review_selection_hash(p_refs jsonb,p_start date,p_end date) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('period_start',p_start,'period_end',p_end,
 'references',(SELECT jsonb_agg(jsonb_build_object('family',x->>'family','source_id',(x->>'source_id')::uuid,'source_version',x->>'source_version') ORDER BY x->>'family',(x->>'source_id')::uuid) FROM jsonb_array_elements(p_refs) x))::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION haven.resident_review_selection_hash(jsonb,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_selection_hash(jsonb,date,date) TO authenticated;
CREATE FUNCTION haven.guard_resident_review_request() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.operation_execution_receipts; refs jsonb; start_day date; end_day date;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Resident review requests are immutable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=NEW.receipt_id;
 IF NOT FOUND OR r.request_key<>NEW.request_key OR r.recorder_id IS DISTINCT FROM haven.authorized_user_id()
  OR r.recorded_at<transaction_timestamp() OR r.recorded_at>clock_timestamp() OR r.created_at IS DISTINCT FROM transaction_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts x WHERE x.id=r.id AND haven.resident_review_issued_now(x.id))
  THEN RAISE EXCEPTION 'Current review request receipt required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_agg(jsonb_build_object('family',family,'source_id',source_id,'source_version',source_version)),min(period_start),min(period_end)
 INTO refs,start_day,end_day FROM haven.resident_review_references WHERE receipt_id=r.id;
 IF refs IS NULL OR EXISTS(SELECT 1 FROM haven.resident_review_references WHERE receipt_id=r.id AND (period_start<>start_day OR period_end<>end_day)) THEN
  RAISE EXCEPTION 'Complete review references required' USING ERRCODE='42501'; END IF;
 NEW.selection_hash:=haven.resident_review_selection_hash(refs,start_day,end_day); NEW.task_id:=r.task_instance_id;
 NEW.organization_id:=r.organization_id; NEW.facility_id:=r.facility_id;
 NEW.actor_id:=haven.authorized_user_id(); NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_review_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER resident_review_request_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.resident_review_requests
 FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_review_request();
CREATE TRIGGER resident_review_references_no_truncate BEFORE TRUNCATE ON haven.resident_review_references
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_review_reference();
CREATE TRIGGER resident_review_checks_no_truncate BEFORE TRUNCATE ON haven.resident_review_checks
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_review_check();
CREATE TRIGGER resident_review_requests_no_truncate BEFORE TRUNCATE ON haven.resident_review_requests
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_review_request();

CREATE FUNCTION public.record_resident_source_review(p_task uuid,p_request_key text,p_revision text,p_start date,p_end date,p_references jsonb,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; old haven.resident_review_requests; ref jsonb; k text; current_source jsonb; result jsonb; receipt uuid; refs jsonb; selection text;
BEGIN
 c:=haven.resident_review_context(p_task);
 IF NOT coalesce((c->>'eligible')::boolean,false) THEN RAISE EXCEPTION 'This activity requires its native or manual pathway' USING ERRCODE='22023'; END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  OR NOT coalesce(haven.resident_review_period_valid(c,p_start,p_end),false) THEN RAISE EXCEPTION 'Review request or period is invalid' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_payload ? 'performed_at'
  OR coalesce(p_payload->>'entry_kind','routine')<>'routine' OR coalesce(p_payload->'performer'->>'kind','self')<>'self' THEN
  RAISE EXCEPTION 'Current self review required; use the manual pathway for historical or on-behalf review' USING ERRCODE='22023'; END IF;
 IF p_references IS NULL OR jsonb_typeof(p_references)<>'array' OR jsonb_array_length(p_references) NOT BETWEEN 1 AND 32 THEN
  RAISE EXCEPTION 'Choose one to thirty-two source references' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*)<>count(DISTINCT (x->>'family',(x->>'source_id')::uuid)) FROM jsonb_array_elements(p_references) x) THEN
  RAISE EXCEPTION 'Choose each source only once' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('resident-source-review:'||p_request_key,0));
 c:=haven.resident_review_context(p_task);
 selection:=haven.resident_review_selection_hash(p_references,p_start,p_end);
 SELECT * INTO old FROM haven.resident_review_requests WHERE request_key=p_request_key;
 IF FOUND THEN
  IF old.task_id<>p_task OR old.selection_hash<>selection THEN RAISE EXCEPTION 'Review request conflicts with its saved content' USING ERRCODE='23505'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE request_key=p_request_key) THEN
   RAISE EXCEPTION 'Review request conflicts with its saved content' USING ERRCODE='23505'; END IF;
  PERFORM haven.lock_resident_review_scope(p_task,p_revision);
 END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_references) LOOP
  IF jsonb_typeof(ref)<>'object' THEN RAISE EXCEPTION 'Invalid review reference' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(ref) LOOP
   IF k NOT IN('family','source_id','source_version') THEN RAISE EXCEPTION 'Invalid review reference field' USING ERRCODE='22023'; END IF;
  END LOOP;
  current_source:=haven.read_resident_review_source(p_task,ref->>'family',(ref->>'source_id')::uuid,p_start,p_end);
  IF current_source IS NULL THEN RAISE EXCEPTION 'Native review source unavailable' USING ERRCODE='42501'; END IF;
  IF current_source->>'source_version' IS DISTINCT FROM ref->>'source_version' THEN RAISE EXCEPTION 'Native review source changed' USING ERRCODE='40001'; END IF;
 END LOOP;
 -- Existing command supplies current actor/server time and all governing
 -- statement, evidence, review and issue behavior. It writes HFO only.
 result:=public.record_operation_work_review(p_task,p_request_key,p_payload);
 receipt:=(result->'receipt'->>'id')::uuid;
 -- Native reads here and in the INSERT trigger still execute as the invoker,
 -- after the HFO definer and any authority/occurrence lock waits have returned.
 FOR ref IN SELECT value FROM jsonb_array_elements(p_references) LOOP
  current_source:=haven.read_resident_review_source(p_task,ref->>'family',(ref->>'source_id')::uuid,p_start,p_end);
  IF current_source IS NULL THEN RAISE EXCEPTION 'Native review source unavailable' USING ERRCODE='42501'; END IF;
  IF current_source->>'source_version' IS DISTINCT FROM ref->>'source_version' THEN RAISE EXCEPTION 'Native review source changed' USING ERRCODE='40001'; END IF;
  IF old.receipt_id IS NULL THEN
   INSERT INTO haven.resident_review_references(receipt_id,family,source_id,source_version,period_start,period_end)
   VALUES(receipt,ref->>'family',(ref->>'source_id')::uuid,ref->>'source_version',p_start,p_end);
  END IF;
 END LOOP;
 IF old.receipt_id IS NULL THEN INSERT INTO haven.resident_review_requests(request_key,receipt_id) VALUES(p_request_key,receipt); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('reference_id',id) ORDER BY id),'[]'::jsonb) INTO refs FROM haven.resident_review_references WHERE receipt_id=receipt;
 RETURN jsonb_build_object('receipt_outcome',result,'references',refs,'replayed',old.receipt_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.record_resident_source_review(uuid,text,text,date,date,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_resident_source_review(uuid,text,text,date,date,jsonb,jsonb) TO authenticated;

-- This sanitized discovery helper has no clinical reads; invoker history below
-- can see actual reference fields only through their native-RLS SELECT policy.
CREATE FUNCTION haven.resident_review_summaries(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE results jsonb;
BEGIN
 IF NOT coalesce(haven.operation_task_readable(p_task),false) THEN RAISE EXCEPTION 'Review scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receipt_id',r.id,'recorded_at',r.recorded_at,'recorder_id',r.recorder_id,
  'references',(SELECT jsonb_agg(haven.resident_review_reference_summary(x.id) ORDER BY x.linked_at,x.id) FROM haven.resident_review_references x WHERE x.receipt_id=r.id)) ORDER BY r.recorded_at,r.id),'[]'::jsonb)
 INTO results FROM public.operation_execution_receipts r WHERE r.task_instance_id=p_task AND EXISTS(SELECT 1 FROM haven.resident_review_references x WHERE x.receipt_id=r.id);
 RETURN results;
END $$;
REVOKE ALL ON FUNCTION haven.resident_review_summaries(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_summaries(uuid) TO authenticated;

CREATE FUNCTION public.read_resident_source_reviews(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE review jsonb; meta jsonb; ref haven.resident_review_references; current_source jsonb; visible boolean; state text; refs jsonb; reviews jsonb:='[]'::jsonb;
BEGIN
 FOR review IN SELECT value FROM jsonb_array_elements(haven.resident_review_summaries(p_task)) LOOP
  refs:='[]'::jsonb;
  FOR meta IN SELECT value FROM jsonb_array_elements(review->'references') LOOP
   current_source:=NULL; visible:=false;
   SELECT * INTO ref FROM haven.resident_review_references WHERE id=(meta->>'reference_id')::uuid;
   IF FOUND THEN visible:=true; current_source:=haven.read_resident_review_source(p_task,ref.family,ref.source_id,ref.period_start,ref.period_end); END IF;
   state:=CASE WHEN current_source IS NULL THEN 'unavailable' WHEN current_source->>'source_version'=ref.source_version THEN 'current' ELSE 'changed' END;
   refs:=refs||jsonb_build_array(jsonb_build_object('reference_id',meta->'reference_id','linked_at',meta->'linked_at',
    'family',CASE WHEN visible THEN ref.family END,'source_id',CASE WHEN visible THEN ref.source_id END,
    'source_version',CASE WHEN visible THEN ref.source_version END,
    'period',CASE WHEN visible THEN jsonb_build_object('start_date',ref.period_start,'end_date',ref.period_end) END,
    'current_state',state,'requires_review',state<>'current' OR EXISTS(SELECT 1 FROM jsonb_array_elements(meta->'checks') x WHERE x->>'state'='changed'),'checks',meta->'checks'));
  END LOOP;
  reviews:=reviews||jsonb_build_array(jsonb_build_object('receipt_id',review->'receipt_id','recorded_at',review->'recorded_at','recorder_id',review->'recorder_id','references',refs));
 END LOOP;
 PERFORM haven.resident_review_context(p_task);
 RETURN jsonb_build_object('task_id',p_task,'reviews',reviews);
END $$;
REVOKE ALL ON FUNCTION public.read_resident_source_reviews(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_resident_source_reviews(uuid) TO authenticated;

CREATE FUNCTION haven.resident_review_check_request(p_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c haven.resident_review_checks; task uuid;
BEGIN
 SELECT * INTO c FROM haven.resident_review_checks WHERE checked_by=haven.authorized_user_id() AND request_key=p_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.task_instance_id INTO task FROM haven.resident_review_references ref JOIN public.operation_execution_receipts r ON r.id=ref.receipt_id WHERE ref.id=c.reference_id;
 IF NOT coalesce(haven.operation_task_readable(task),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('reference_id',c.reference_id,'checked_at',c.checked_at,'state',c.state);
END $$;
REVOKE ALL ON FUNCTION haven.resident_review_check_request(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_review_check_request(text) TO authenticated;

CREATE FUNCTION public.recheck_resident_source_review(p_task uuid,p_reference uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE meta jsonb; old jsonb;
BEGIN
 meta:=haven.resident_review_reference_summary(p_reference);
 IF meta IS NULL OR meta->>'task_id' IS DISTINCT FROM p_task::text THEN RAISE EXCEPTION 'Review reference unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('resident-source-recheck:'||haven.authorized_user_id()::text||':'||p_request_key,0));
 meta:=haven.resident_review_reference_summary(p_reference);
 IF meta IS NULL OR meta->>'task_id' IS DISTINCT FROM p_task::text THEN RAISE EXCEPTION 'Review reference unavailable' USING ERRCODE='42501'; END IF;
 old:=haven.resident_review_check_request(p_request_key);
 IF old IS NOT NULL THEN
  IF old->>'reference_id'<>p_reference::text THEN RAISE EXCEPTION 'Review request conflicts with its saved content' USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO haven.resident_review_checks(reference_id,request_key) VALUES(p_reference,p_request_key);
 END IF;
 RETURN public.read_resident_source_reviews(p_task);
END $$;
REVOKE ALL ON FUNCTION public.recheck_resident_source_review(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.recheck_resident_source_review(uuid,uuid,text) TO authenticated;

CREATE TRIGGER resident_review_references_audit AFTER INSERT ON haven.resident_review_references FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER resident_review_checks_audit AFTER INSERT ON haven.resident_review_checks FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER resident_review_requests_audit AFTER INSERT ON haven.resident_review_requests FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE POLICY resident_review_generic_audit_private ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name NOT IN('resident_review_references','resident_review_checks','resident_review_requests'));
CREATE OR REPLACE FUNCTION haven.operation_audit_row_current(a public.audit_log) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT (CASE WHEN a.table_name='operation_task_instances' THEN haven.operation_task_readable(a.record_id)
   AND coalesce(a.new_data->>'authority_class','unclassified')<>'unclassified'
   AND (a.old_data IS NULL OR coalesce(a.old_data->>'authority_class','unclassified')<>'unclassified')
   AND coalesce(a.new_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
   AND coalesce(a.old_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
  WHEN a.table_name IN('operation_audit_log','operation_escalation_deliveries','operation_activity_subjects','operation_subject_access') THEN false
  WHEN a.table_name IN('meeting_action_items','workspace_cards') THEN false ELSE true END)
 AND a.table_name NOT IN('staffing_adequacy_snapshots','risk_score_snapshots','risk_owner_alert_deliveries','exec_alerts','operation_task_templates','operation_activities')
 AND a.table_name NOT IN('operation_execution_receipts','operation_issues','operation_activity_bindings','operation_occurrence_associations','operation_issue_events','operation_evidence','operation_evidence_events','operation_command_drafts','operation_source_events','operation_source_event_attempts','operation_source_adapters','operation_source_rules','operation_source_record_requests','operation_reminder_responses','operation_escalation_deliveries')
 AND a.table_name NOT IN('resident_review_references','resident_review_checks','resident_review_requests')
 AND (a.table_name<>'facility_assets' OR haven.operation_facility_access(a.facility_id))
$$;
REVOKE ALL ON FUNCTION haven.operation_audit_row_current(public.audit_log) FROM PUBLIC,anon,authenticated,service_role;


COMMIT;
