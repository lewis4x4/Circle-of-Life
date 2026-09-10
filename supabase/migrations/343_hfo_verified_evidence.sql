BEGIN;

-- COL-143 / HFO-07: scoped verified evidence for execution receipts. A piece
-- of evidence is an immutable metadata identity that belongs to one
-- performance receipt: site, subject and authority class copied from the
-- receipt, a kind, the evidence rule it is meant to satisfy, an owned object
-- path in one private bucket, declared type and size, the uploader, and a
-- state that moves only forward (prepared, uploaded, finalized or failed).
-- Only the uploader may upload to or finalize the prepared path; only a
-- finalized object is readable by anyone else with access to the receipt's
-- occurrence; wrong-site, wrong-subject, unowned, unfinalized or foreign
-- objects never satisfy a rule. When every required rule that applies to the
-- receipt's outcome is met by finalized evidence, a satisfaction event is
-- appended against the same performance and the occurrence moves on without a
-- second completion click; the original performer, performed-at, recorded-at
-- and the receipt's recorded missing-evidence list are never rewritten.
-- This migration transfers no byte, proves no hosted bucket, corrects no
-- receipt (HFO-08), satisfies no reading rule, links no native record for any
-- real subject and decides nothing about Q10 or Q23.

-- ---------------------------------------------------------------------------
-- Evidence metadata identity.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 activity_id uuid NOT NULL,
 subject_id uuid NOT NULL REFERENCES public.operation_activity_subjects(id),
 authority_class text NOT NULL CHECK(authority_class IN('facility','resident','employee_personnel','employee_medical','asset','financial')),
 receipt_id uuid NOT NULL REFERENCES public.operation_execution_receipts(id),
 task_instance_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 evidence_kind text NOT NULL CHECK(evidence_kind IN('document','photo','signature','linked_record')),
 rule_label text CHECK(rule_label IS NULL OR length(btrim(rule_label)) BETWEEN 1 AND 200),
 state text NOT NULL CHECK(state IN('prepared','uploaded','finalized','failed')),
 bucket_id text CHECK(bucket_id IS NULL OR bucket_id='operation-evidence'),
 object_path text,
 declared_mime text CHECK(declared_mime IS NULL OR declared_mime IN('application/pdf','image/jpeg','image/png','image/webp')),
 declared_size_bytes bigint CHECK(declared_size_bytes IS NULL OR declared_size_bytes BETWEEN 1 AND 20971520),
 declared_sha256 text CHECK(declared_sha256 IS NULL OR declared_sha256 ~ '^[0-9a-f]{64}$'),
 -- The client declares the MD5 of the bytes it uploads; the database verifies
 -- it against the Storage service's eTag (the one content fingerprint the
 -- client did not write) when the upload is marked and again at finalization.
 -- The SHA-256 stays optional and informational.
 declared_md5 text CHECK(declared_md5 IS NULL OR declared_md5 ~ '^[0-9a-f]{32}$'),
 checksum_verified boolean NOT NULL DEFAULT false,
 checksum_method text CHECK(checksum_method IS NULL OR checksum_method='storage_etag_md5'),
 checksum_verified_at timestamptz,
 object_id uuid,
 object_etag text,
 object_version text,
 object_size_bytes bigint,
 object_mime text,
 linked_table text CHECK(linked_table IS NULL OR linked_table IN('facility_documents','employee_file_records')),
 linked_record_id uuid,
 uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 prepared_at timestamptz NOT NULL,
 uploaded_at timestamptz,
 finalized_at timestamptz,
 finalized_by uuid REFERENCES public.user_profiles(id),
 failed_at timestamptz,
 failure_reason text CHECK(failure_reason IS NULL OR length(btrim(failure_reason)) BETWEEN 1 AND 2000),
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 -- Object kinds carry a path in the bucket; a linked record carries a native reference and no object.
 CHECK((evidence_kind<>'linked_record' AND bucket_id='operation-evidence' AND object_path IS NOT NULL AND declared_mime IS NOT NULL AND declared_size_bytes IS NOT NULL AND declared_md5 IS NOT NULL AND linked_table IS NULL AND linked_record_id IS NULL
   AND object_path=facility_id::text||'/'||id::text||'/'||split_part(object_path,'/',3) AND split_part(object_path,'/',3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' AND array_length(string_to_array(object_path,'/'),1)=3)
  OR (evidence_kind='linked_record' AND bucket_id IS NULL AND object_path IS NULL AND declared_mime IS NULL AND declared_size_bytes IS NULL AND declared_sha256 IS NULL AND declared_md5 IS NULL AND linked_table IS NOT NULL AND linked_record_id IS NOT NULL
   AND object_id IS NULL AND object_etag IS NULL AND object_version IS NULL AND object_size_bytes IS NULL AND object_mime IS NULL AND NOT checksum_verified AND state IN('finalized'))),
 -- A verified checksum names its method and instant against an observed object; an unverified one names neither.
 CHECK((checksum_verified AND checksum_method IS NOT NULL AND checksum_verified_at IS NOT NULL AND object_id IS NOT NULL) OR (NOT checksum_verified AND checksum_method IS NULL AND checksum_verified_at IS NULL)),
 -- Only a verified, identical object finalizes.
 CHECK(state<>'finalized' OR evidence_kind='linked_record' OR checksum_verified),
 -- State shape: object facts arrive with the upload, finalization names who and when, failure names why.
 CHECK((state='prepared' AND uploaded_at IS NULL AND object_id IS NULL AND finalized_at IS NULL AND finalized_by IS NULL AND failed_at IS NULL AND failure_reason IS NULL)
  OR (state='uploaded' AND uploaded_at IS NOT NULL AND object_id IS NOT NULL AND object_size_bytes IS NOT NULL AND object_mime IS NOT NULL AND finalized_at IS NULL AND finalized_by IS NULL AND failed_at IS NULL AND failure_reason IS NULL)
  OR (state='finalized' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND failed_at IS NULL AND failure_reason IS NULL
   AND (evidence_kind='linked_record' OR (uploaded_at IS NOT NULL AND object_id IS NOT NULL AND object_size_bytes IS NOT NULL AND object_mime IS NOT NULL)))
  OR (state='failed' AND failed_at IS NOT NULL AND failure_reason IS NOT NULL AND finalized_at IS NULL AND finalized_by IS NULL)),
 CHECK(state<>'uploaded' OR (object_size_bytes=declared_size_bytes AND object_mime=declared_mime)),
 CHECK(state<>'finalized' OR evidence_kind='linked_record' OR (object_size_bytes=declared_size_bytes AND object_mime=declared_mime))
);
-- A retry with the same bytes deduplicates once finalized (by either fingerprint).
CREATE UNIQUE INDEX operation_evidence_finalized_bytes ON public.operation_evidence(receipt_id,declared_sha256) WHERE state='finalized' AND declared_sha256 IS NOT NULL;
CREATE UNIQUE INDEX operation_evidence_finalized_md5 ON public.operation_evidence(receipt_id,declared_md5) WHERE state='finalized' AND declared_md5 IS NOT NULL;
CREATE INDEX idx_operation_evidence_receipt ON public.operation_evidence(receipt_id,state);
CREATE INDEX idx_operation_evidence_task ON public.operation_evidence(task_instance_id);
CREATE INDEX idx_operation_evidence_uploader ON public.operation_evidence(uploaded_by) WHERE state IN('prepared','uploaded');

-- ---------------------------------------------------------------------------
-- Immutable evidence and satisfaction events.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_evidence_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 receipt_id uuid NOT NULL REFERENCES public.operation_execution_receipts(id),
 evidence_id uuid REFERENCES public.operation_evidence(id),
 event_kind text NOT NULL CHECK(event_kind IN('prepared','uploaded','finalized','failed','satisfied')),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_role text NOT NULL,
 expected_receipt_revision text,
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 event_seq bigint GENERATED ALWAYS AS IDENTITY,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((event_kind='satisfied')=(evidence_id IS NULL))
);
CREATE INDEX idx_operation_evidence_events_receipt ON public.operation_evidence_events(receipt_id,event_seq);
CREATE INDEX idx_operation_evidence_events_evidence ON public.operation_evidence_events(evidence_id) WHERE evidence_id IS NOT NULL;

ALTER TABLE public.operation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_evidence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_evidence,public.operation_evidence_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_evidence,public.operation_evidence_events TO authenticated,service_role;
-- Evidence is readable with its occurrence (COL-133 boundary) once finalized;
-- an in-flight row is visible only to its uploader. Events follow the same rule.
CREATE POLICY operation_evidence_read ON public.operation_evidence FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.operation_task_readable(task_instance_id) AND (state='finalized' OR uploaded_by=auth.uid()));
CREATE POLICY operation_evidence_events_read ON public.operation_evidence_events FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id()
 AND EXISTS(SELECT 1 FROM public.operation_execution_receipts r WHERE r.id=receipt_id AND haven.operation_task_readable(r.task_instance_id))
 AND (evidence_id IS NULL OR EXISTS(SELECT 1 FROM public.operation_evidence e WHERE e.id=evidence_id AND (e.state='finalized' OR e.uploaded_by=auth.uid()))));
CREATE TRIGGER operation_evidence_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_evidence
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_evidence_events_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_evidence_events
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_evidence_no_truncate BEFORE TRUNCATE ON public.operation_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_evidence_events_no_truncate BEFORE TRUNCATE ON public.operation_evidence_events
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
-- Generic audit payloads would carry object paths and filenames; the evidence
-- events are the readable history.
CREATE POLICY operation_evidence_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(
 table_name NOT IN('operation_evidence','operation_evidence_events'));

-- Only the evidence commands write; identity never changes; state moves forward.
CREATE FUNCTION haven.guard_operation_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Evidence is immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the evidence commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.activity_id,NEW.subject_id,NEW.authority_class,NEW.receipt_id,NEW.task_instance_id,NEW.evidence_kind,NEW.rule_label,NEW.bucket_id,NEW.object_path,
      NEW.declared_mime,NEW.declared_size_bytes,NEW.declared_sha256,NEW.declared_md5,NEW.linked_table,NEW.linked_record_id,NEW.uploaded_by,NEW.prepared_at,NEW.request_key,NEW.request_hash,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.activity_id,OLD.subject_id,OLD.authority_class,OLD.receipt_id,OLD.task_instance_id,OLD.evidence_kind,OLD.rule_label,OLD.bucket_id,OLD.object_path,
      OLD.declared_mime,OLD.declared_size_bytes,OLD.declared_sha256,OLD.declared_md5,OLD.linked_table,OLD.linked_record_id,OLD.uploaded_by,OLD.prepared_at,OLD.request_key,OLD.request_hash,OLD.created_at) THEN
   RAISE EXCEPTION 'Evidence identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.state='prepared' AND NEW.state IN('uploaded','finalized','failed')) OR (OLD.state='uploaded' AND NEW.state IN('finalized','failed'))) THEN
   RAISE EXCEPTION 'Evidence state moves only forward' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.revision:=haven.operation_occurrence_revision();
 RETURN NEW;
END $$;
CREATE FUNCTION haven.guard_operation_evidence_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Evidence events are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the evidence commands' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_evidence(),haven.guard_operation_evidence_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_evidence
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_evidence();
CREATE TRIGGER operation_evidence_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_evidence_events
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_evidence_event();

-- ---------------------------------------------------------------------------
-- The receipt keeps its recorded missing-evidence list; a current evidence
-- status and the satisfaction instant are the only columns the evidence
-- commands may move, under the token. The 341 guard body is otherwise kept.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_execution_receipts
 ADD COLUMN evidence_status_current text CHECK(evidence_status_current IS NULL OR evidence_status_current IN('not_required','complete','missing')),
 ADD COLUMN evidence_satisfied_at timestamptz;
CREATE OR REPLACE FUNCTION haven.guard_operation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the receipt commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.evidence_status_current:=NEW.evidence_status; NEW.evidence_satisfied_at:=NULL;
  RETURN NEW;
 END IF;
 -- COL-143: the only permitted change is missing → complete with its instant.
 IF to_jsonb(NEW)-ARRAY['evidence_status_current','evidence_satisfied_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['evidence_status_current','evidence_satisfied_at']
  OR NOT (OLD.evidence_status='missing' AND OLD.evidence_status_current='missing' AND OLD.evidence_satisfied_at IS NULL
          AND NEW.evidence_status_current='complete' AND NEW.evidence_satisfied_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_execution_receipts SET evidence_status_current=evidence_status WHERE evidence_status_current IS NULL;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
ALTER TABLE public.operation_execution_receipts ALTER COLUMN evidence_status_current SET NOT NULL;
ALTER TABLE public.operation_execution_receipts ADD CONSTRAINT operation_receipt_evidence_current_shape CHECK(
 (evidence_status<>'missing' AND evidence_status_current=evidence_status AND evidence_satisfied_at IS NULL)
 OR (evidence_status='missing' AND ((evidence_status_current='missing' AND evidence_satisfied_at IS NULL) OR (evidence_status_current='complete' AND evidence_satisfied_at IS NOT NULL))));

-- ---------------------------------------------------------------------------
-- Storage: one private bucket; the evidence id owns the path. Only the
-- uploader may write its own prepared path; a finalized object is readable
-- with the receipt's occurrence; nobody updates or deletes through a client.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('operation-evidence','operation-evidence',false,20971520,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
 ON CONFLICT (id) DO NOTHING;
CREATE FUNCTION haven.operation_evidence_storage_access(p_bucket text,p_name text,p_write boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.operation_evidence; parts text[]; eid uuid; fid uuid;
BEGIN
 IF auth.uid() IS NULL OR p_bucket IS DISTINCT FROM 'operation-evidence' THEN RETURN false; END IF;
 parts:=string_to_array(coalesce(p_name,''),'/');
 IF array_length(parts,1)<>3 THEN RETURN false; END IF;
 BEGIN fid:=parts[1]::uuid; eid:=parts[2]::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 -- No row lock here: an other-site caller must never hold a lock on someone's
 -- evidence, and finalization re-checks the object under its own lock.
 SELECT * INTO e FROM public.operation_evidence WHERE id=eid;
 IF NOT FOUND OR e.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_task_readable(e.task_instance_id) THEN RETURN false; END IF;
 IF e.facility_id<>fid OR e.object_path IS DISTINCT FROM p_name THEN RETURN false; END IF;
 IF p_write THEN RETURN e.state='prepared' AND e.uploaded_by=auth.uid(); END IF;
 RETURN e.state='finalized' OR (e.uploaded_by=auth.uid() AND e.state IN('prepared','uploaded'));
END $$;
REVOKE ALL ON FUNCTION haven.operation_evidence_storage_access(text,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_evidence_storage_access(text,text,boolean) TO authenticated;
CREATE POLICY operation_evidence_storage_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='operation-evidence' AND haven.operation_evidence_storage_access(bucket_id,name,false));
CREATE POLICY operation_evidence_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='operation-evidence' AND haven.operation_evidence_storage_access(bucket_id,name,true));
-- Restrictive boundaries keep generic storage grants away from this bucket.
CREATE POLICY operation_evidence_storage_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'operation-evidence' OR haven.operation_evidence_storage_access(bucket_id,name,false));
CREATE POLICY operation_evidence_storage_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'operation-evidence' OR haven.operation_evidence_storage_access(bucket_id,name,true));
CREATE POLICY operation_evidence_storage_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'operation-evidence') WITH CHECK(bucket_id<>'operation-evidence');
CREATE POLICY operation_evidence_storage_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'operation-evidence');

-- ---------------------------------------------------------------------------
-- Helpers: governing evidence rules of a receipt, whether a rule is met by
-- finalized evidence, the readability of a native linked record for the
-- caller (a boolean only), request shape, replay, event append and reply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_receipt_evidence_rules(r public.operation_execution_receipts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT haven.operation_receipt_missing_evidence(
  coalesce((SELECT fr.local_required_evidence FROM public.operation_facility_requirements fr WHERE fr.id=r.facility_requirement_id),
           (SELECT v.required_evidence FROM public.operation_requirement_versions v WHERE v.id=r.requirement_version_id)),r.outcome)
$$;
CREATE FUNCTION haven.operation_evidence_rule_met(p_receipt uuid,p_rule jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (SELECT count(*) FROM public.operation_evidence e WHERE e.receipt_id=p_receipt AND e.state='finalized' AND e.rule_label=p_rule->>'label' AND e.evidence_kind=p_rule->>'kind')
  >= greatest((p_rule->>'min_count')::int,1)
$$;
CREATE FUNCTION haven.operation_receipt_evidence_unmet(r public.operation_execution_receipts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'label'),'[]'::jsonb) FROM jsonb_array_elements(haven.operation_receipt_evidence_rules(r)) x
 WHERE NOT haven.operation_evidence_rule_met(r.id,x)
$$;
-- A linked native record must belong to the receipt's own site and subject:
-- a vault document to the receipt's site for a facility or asset receipt; an
-- employee file record to the receipt's employee, with a medical-category
-- record only on an employee_medical receipt and any other category only on
-- an employee_personnel receipt; and it must be readable by the caller under
-- the record's own access. A boolean only; no fact about the record leaks.
CREATE FUNCTION haven.operation_evidence_linked_readable(p_table text,p_id uuid,r public.operation_execution_receipts) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
  WHEN r.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(r.facility_id) THEN false
  WHEN p_table='facility_documents' THEN r.authority_class IN('facility','asset')
   AND EXISTS(SELECT 1 FROM public.facility_documents d WHERE d.id=p_id AND d.organization_id=r.organization_id AND d.facility_id=r.facility_id AND d.deleted_at IS NULL)
  WHEN p_table='employee_file_records' THEN r.authority_class IN('employee_personnel','employee_medical')
   AND EXISTS(SELECT 1 FROM public.employee_file_records rec JOIN public.employee_file_requirements q ON q.id=rec.requirement_id
     JOIN public.operation_activity_subjects s ON s.id=r.subject_id AND s.subject_kind='employee' AND s.employee_id=rec.staff_id
     WHERE rec.id=p_id AND rec.organization_id=r.organization_id AND rec.facility_id=r.facility_id AND rec.deleted_at IS NULL
      AND ((q.category='medical' AND r.authority_class='employee_medical') OR (q.category<>'medical' AND r.authority_class='employee_personnel')))
   AND haven.employee_record_readable(p_id)
  ELSE false END
$$;
CREATE FUNCTION haven.operation_evidence_request_problem(p_request_key text,p_payload jsonb,p_keys text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RETURN 'A request key is required'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN 'Evidence payload must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF NOT (k=ANY(p_keys)) THEN RETURN 'Evidence payload field is not editable'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION haven.operation_evidence_request_hash(p_canonical jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_canonical)::text,'UTF8')),'hex')
$$;
-- Replay: the same key with the same content, receipt and actor returns the
-- existing event; anything else under that key is a conflict. NULL when unseen.
CREATE FUNCTION haven.operation_evidence_replay(p_receipt uuid,p_request_key text,p_request_hash text) RETURNS public.operation_evidence_events
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e public.operation_evidence_events;
BEGIN
 SELECT * INTO e FROM public.operation_evidence_events WHERE request_key=p_request_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF e.receipt_id=p_receipt AND e.request_hash=p_request_hash AND e.actor_id=auth.uid() THEN RETURN e; END IF;
 RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION haven.write_operation_evidence_event(r public.operation_execution_receipts,p_evidence uuid,p_kind text,p_request_key text,p_request_hash text,p_expected_revision text,p_details jsonb) RETURNS public.operation_evidence_events
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e public.operation_evidence_events;
BEGIN
 BEGIN
  INSERT INTO public.operation_evidence_events(organization_id,facility_id,receipt_id,evidence_id,event_kind,actor_id,actor_role,expected_receipt_revision,request_key,request_hash,details)
  VALUES(r.organization_id,r.facility_id,r.id,p_evidence,p_kind,auth.uid(),haven.app_role()::text,p_expected_revision,p_request_key,p_request_hash,coalesce(p_details,'{}'::jsonb)) RETURNING * INTO e;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 RETURN e;
END $$;
-- The outcome of the request that wrote (or replayed) the event: prepared,
-- uploaded, finalized, failed, or the checksum outcomes checksum_mismatch,
-- checksum_unverifiable and object_changed, read from the event itself so a
-- replay reports the same outcome as the original request.
CREATE FUNCTION haven.operation_evidence_outcome(ev public.operation_evidence,e public.operation_evidence_events) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE e.event_kind
  WHEN 'prepared' THEN CASE WHEN ev.evidence_kind='linked_record' THEN 'finalized' ELSE 'prepared' END
  WHEN 'uploaded' THEN CASE WHEN coalesce((e.details->>'checksum_verified')::boolean,false) THEN 'uploaded' ELSE 'checksum_unverifiable' END
  WHEN 'failed' THEN coalesce(e.details->>'failure_kind','failed')
  ELSE e.event_kind END
$$;
CREATE FUNCTION haven.operation_evidence_reply(ev public.operation_evidence,e public.operation_evidence_events,p_replayed boolean,p_satisfaction jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('evidence',to_jsonb(ev),'event',to_jsonb(e),'replayed',p_replayed,'satisfaction',p_satisfaction,'outcome',haven.operation_evidence_outcome(ev,e))
$$;
REVOKE ALL ON FUNCTION haven.operation_receipt_evidence_rules(public.operation_execution_receipts),haven.operation_evidence_rule_met(uuid,jsonb),haven.operation_receipt_evidence_unmet(public.operation_execution_receipts),
 haven.operation_evidence_linked_readable(text,uuid,public.operation_execution_receipts),haven.operation_evidence_request_problem(text,jsonb,text[]),haven.operation_evidence_request_hash(jsonb),
 haven.operation_evidence_replay(uuid,text,text),haven.write_operation_evidence_event(public.operation_execution_receipts,uuid,text,text,text,text,jsonb),
 haven.operation_evidence_outcome(public.operation_evidence,public.operation_evidence_events),
 haven.operation_evidence_reply(public.operation_evidence,public.operation_evidence_events,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Receipt authority: the receipt is read without a lock only to find its
-- occurrence; the work-authority lock (COL-133 locks on the occurrence first,
-- governing recorder list) runs before any receipt fact is disclosed, and
-- only then is the receipt row itself locked and returned. Every evidence
-- command therefore takes locks in one order (occurrence → receipt →
-- evidence), so overlapping commands on one receipt queue instead of
-- deadlocking. Missing and denied share one wording.
CREATE FUNCTION haven.lock_operation_evidence_authority(p_receipt uuid,p_with_roles boolean) RETURNS public.operation_execution_receipts
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.operation_execution_receipts; v public.operation_requirement_versions; fr public.operation_facility_requirements; roles public.app_role[];
BEGIN
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=p_receipt;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_with_roles THEN
  SELECT * INTO v FROM public.operation_requirement_versions WHERE id=r.requirement_version_id;
  SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=r.facility_requirement_id;
  roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
  PERFORM haven.lock_operation_work_authority(r.task_instance_id,roles);
 ELSE
  PERFORM haven.lock_operation_work_authority(r.task_instance_id,NULL);
 END IF;
 IF v.id IS NOT NULL THEN PERFORM 1 FROM public.operation_requirement_versions WHERE id=v.id FOR SHARE; END IF;
 IF fr.id IS NOT NULL THEN PERFORM 1 FROM public.operation_facility_requirements WHERE id=fr.id FOR SHARE; END IF;
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=p_receipt FOR NO KEY UPDATE;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_evidence_authority(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Satisfaction: when every applicable required rule is met by finalized
-- evidence, mark the receipt complete, append the satisfaction event and let
-- the occurrence move on exactly as a receipt with complete evidence would
-- have at record time. Nothing else on the receipt or occurrence changes.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.satisfy_operation_receipt_evidence(p_receipt uuid,p_request_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE r public.operation_execution_receipts; t public.operation_task_instances; v public.operation_requirement_versions; unmet jsonb; now_at timestamptz; state text; new_status text; e public.operation_evidence_events;
BEGIN
 SELECT * INTO r FROM public.operation_execution_receipts WHERE id=p_receipt FOR UPDATE;
 IF r.evidence_status_current<>'missing' THEN RETURN NULL; END IF;
 unmet:=haven.operation_receipt_evidence_unmet(r);
 IF jsonb_array_length(unmet)>0 THEN RETURN jsonb_build_object('receipt_evidence_status','missing','unmet',unmet,'occurrence',NULL); END IF;
 now_at:=clock_timestamp();
 UPDATE public.operation_execution_receipts SET evidence_status_current='complete',evidence_satisfied_at=now_at WHERE id=r.id RETURNING * INTO r;
 e:=haven.write_operation_evidence_event(r,NULL,'satisfied',p_request_key||'|satisfied',p_request_hash,r.revision,
  jsonb_build_object('rules',haven.operation_receipt_evidence_rules(r),'satisfied_at',now_at));
 SELECT * INTO t FROM public.operation_task_instances WHERE id=r.task_instance_id FOR UPDATE;
 IF t.execution_state='performed_missing_evidence' AND t.effective_receipt_id=r.id AND t.status<>'cancelled' AND t.deleted_at IS NULL THEN
  SELECT * INTO v FROM public.operation_requirement_versions WHERE id=r.requirement_version_id;
  state:=CASE WHEN v.review_required THEN 'awaiting_verification' ELSE 'completed' END;
  new_status:=CASE WHEN state='completed' THEN 'completed' ELSE 'in_progress' END;
  UPDATE public.operation_task_instances SET status=new_status,execution_state=state,
   completed_at=CASE WHEN state='completed' THEN now_at END,
   verified_by=CASE WHEN state='completed' THEN r.recorder_id END,verified_at=CASE WHEN state='completed' THEN now_at END,
   sla_met=CASE WHEN t.due_at IS NULL THEN NULL ELSE r.performed_at<=coalesce(t.grace_ends_at,t.due_at) END,
   updated_at=now_at,updated_by=auth.uid()
  WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,CASE WHEN state='completed' THEN 'completed' ELSE 'signed' END,t.status,new_status,auth.uid(),haven.app_role()::text,'required evidence finalized',
   jsonb_build_object('receipt_id',r.id,'completion_state',state,'evidence_event_id',e.id,'evidence_satisfied_at',now_at,'performed_at',r.performed_at,'recorded_at',r.recorded_at,'recorder_id',r.recorder_id,'request_key',p_request_key));
  SELECT * INTO t FROM public.operation_task_instances WHERE id=t.id;
 END IF;
 RETURN jsonb_build_object('receipt_evidence_status','complete','unmet','[]'::jsonb,'satisfied_event_id',e.id,
  'occurrence',CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'status',t.status,'execution_state',t.execution_state) END);
END $$;
REVOKE ALL ON FUNCTION haven.satisfy_operation_receipt_evidence(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- The Storage eTag, normalised: surrounding quotes and a weak prefix removed,
-- lower-cased. A 32-hex value is the MD5 of the stored bytes (single-request
-- upload); a value with a -N suffix is a multipart fingerprint; anything else
-- is unknown. Only an MD5 verifies a declared checksum.
CREATE FUNCTION haven.operation_evidence_etag(p_etag text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT nullif(lower(btrim(regexp_replace(btrim(coalesce(p_etag,'')),'^[Ww]/',''),'"')),'')
$$;
-- Observation of the object under the owned path: presence, owner, size,
-- type, eTag (raw and normalised), Storage version and the eTag kind. Never
-- raises and writes nothing; the commands decide what an observation means.
CREATE FUNCTION haven.operation_evidence_object(ev public.operation_evidence) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE obj jsonb; etag text;
BEGIN
 SELECT to_jsonb(s) INTO obj FROM storage.objects s WHERE s.bucket_id=ev.bucket_id AND s.name=ev.object_path;
 IF NOT FOUND THEN RETURN jsonb_build_object('present',false); END IF;
 etag:=haven.operation_evidence_etag(obj->'metadata'->>'eTag');
 RETURN jsonb_build_object('present',true,'object_id',obj->>'id','owner',obj->>'owner',
  'object_size_bytes',nullif(obj->'metadata'->>'size','')::bigint,'object_mime',obj->'metadata'->>'mimetype',
  'object_etag',obj->'metadata'->>'eTag','object_version',obj->>'version',
  'etag_md5',CASE WHEN etag ~ '^[0-9a-f]{32}$' THEN etag END,
  'etag_kind',CASE WHEN etag IS NULL THEN 'missing' WHEN etag ~ '^[0-9a-f]{32}$' THEN 'md5' WHEN etag ~ '^[0-9a-f]{32}-[0-9]+$' THEN 'multipart' ELSE 'unknown' END);
END $$;
-- Upload check shared by upload marking and finalization from prepared (the
-- caller holds the locks and the token; the row is prepared). The object must
-- exist under the prepared path, be owned by the uploader and match the
-- declared size and type (refused otherwise, nothing written). Then the
-- checksum: an MD5 eTag different from the declared MD5 moves the row to
-- failed (checksum_mismatch) with a failed event carrying both values, so the
-- failure is durable and the command returns it; a matching MD5 records the
-- object facts with checksum_verified, method and instant; an eTag that is
-- not an MD5 records the object facts with the checksum unverified. Returns
-- the event written. When finalizing, a verified upload's event takes a
-- derived key so the finalized event keeps the request key, and a failed
-- event carries the expected receipt revision the finalization was made under.
CREATE FUNCTION haven.record_operation_evidence_upload(r public.operation_execution_receipts,ev public.operation_evidence,p_request_key text,p_request_hash text,p_finalizing boolean,p_expected_revision text,p_now timestamptz) RETURNS public.operation_evidence_events
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE obs jsonb; verified boolean; e public.operation_evidence_events;
BEGIN
 obs:=haven.operation_evidence_object(ev);
 IF NOT (obs->>'present')::boolean OR (obs->>'owner')::uuid IS DISTINCT FROM ev.uploaded_by THEN RAISE EXCEPTION 'Uploaded object not found for this evidence' USING ERRCODE='P0001'; END IF;
 IF (obs->>'object_size_bytes')::bigint IS DISTINCT FROM ev.declared_size_bytes OR (obs->>'object_mime') IS DISTINCT FROM ev.declared_mime THEN
  RAISE EXCEPTION 'Uploaded object does not match the prepared evidence' USING ERRCODE='P0001';
 END IF;
 IF obs->>'etag_kind'='md5' AND obs->>'etag_md5'<>ev.declared_md5 THEN
  UPDATE public.operation_evidence SET state='failed',failed_at=p_now,failure_reason='checksum_mismatch' WHERE id=ev.id;
  RETURN haven.write_operation_evidence_event(r,ev.id,'failed',p_request_key,p_request_hash,p_expected_revision,jsonb_build_object('failure_kind','checksum_mismatch','reason','checksum_mismatch','rule_label',ev.rule_label,'previous_state','prepared',
   'declared_md5',ev.declared_md5,'observed_md5',obs->>'etag_md5','observed_etag',obs->>'object_etag','object_id',obs->>'object_id','object_version',obs->>'object_version','object_size_bytes',(obs->>'object_size_bytes')::bigint,'object_mime',obs->>'object_mime'));
 END IF;
 verified:=obs->>'etag_kind'='md5';
 UPDATE public.operation_evidence SET state='uploaded',uploaded_at=p_now,object_id=(obs->>'object_id')::uuid,object_etag=obs->>'object_etag',object_version=obs->>'object_version',
  object_size_bytes=(obs->>'object_size_bytes')::bigint,object_mime=obs->>'object_mime',
  checksum_verified=verified,checksum_method=CASE WHEN verified THEN 'storage_etag_md5' END,checksum_verified_at=CASE WHEN verified THEN p_now END WHERE id=ev.id;
 RETURN haven.write_operation_evidence_event(r,ev.id,'uploaded',CASE WHEN p_finalizing AND verified THEN p_request_key||'|uploaded' ELSE p_request_key END,p_request_hash,NULL,
  jsonb_build_object('object_id',obs->>'object_id','object_size_bytes',(obs->>'object_size_bytes')::bigint,'object_mime',obs->>'object_mime','object_etag',obs->>'object_etag','object_version',obs->>'object_version',
   'etag_kind',obs->>'etag_kind','checksum_verified',verified,'checksum_method',CASE WHEN verified THEN 'storage_etag_md5' END,'declared_md5',ev.declared_md5));
END $$;
REVOKE ALL ON FUNCTION haven.operation_evidence_etag(text),haven.operation_evidence_object(public.operation_evidence),
 haven.record_operation_evidence_upload(public.operation_execution_receipts,public.operation_evidence,text,text,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Commands (session). Order in each: shape → lock → replay → state and drift
-- checks → write under the token → re-lock → reply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.prepare_operation_evidence(p_receipt uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.operation_execution_receipts; problem text; kind text; rule_label text; filename text; mime text; size_bytes bigint; sha text; md5_hex text; linked_table text; linked_id uuid;
 rules jsonb; rule jsonb; canonical jsonb; request_hash text; prior public.operation_evidence_events; ev public.operation_evidence; e public.operation_evidence_events; existing public.operation_evidence;
 new_id uuid; now_at timestamptz; satisfaction jsonb; path text;
BEGIN
 problem:=haven.operation_evidence_request_problem(p_request_key,p_payload,ARRAY['kind','rule_label','filename','mime','size_bytes','md5','sha256','linked_table','linked_record_id']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 kind:=p_payload->>'kind';
 IF kind IS NULL OR kind NOT IN('document','photo','signature','linked_record') THEN RAISE EXCEPTION 'kind must be document, photo, signature or linked_record' USING ERRCODE='22023'; END IF;
 rule_label:=nullif(btrim(coalesce(p_payload->>'rule_label','')),'');
 IF length(coalesce(rule_label,''))>200 THEN RAISE EXCEPTION 'rule_label must be at most 200 characters' USING ERRCODE='22023'; END IF;
 IF kind='linked_record' THEN
  IF p_payload ? 'filename' OR p_payload ? 'mime' OR p_payload ? 'size_bytes' OR p_payload ? 'md5' OR p_payload ? 'sha256' THEN RAISE EXCEPTION 'A linked record carries no object' USING ERRCODE='22023'; END IF;
  linked_table:=p_payload->>'linked_table';
  IF linked_table IS NULL OR linked_table NOT IN('facility_documents','employee_file_records') THEN RAISE EXCEPTION 'linked_table must be facility_documents or employee_file_records' USING ERRCODE='22023'; END IF;
  BEGIN linked_id:=(p_payload->>'linked_record_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'linked_record_id must be a uuid' USING ERRCODE='22023'; END;
  IF linked_id IS NULL THEN RAISE EXCEPTION 'linked_record_id must be a uuid' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_payload ? 'linked_table' OR p_payload ? 'linked_record_id' THEN RAISE EXCEPTION 'An object kind carries no linked record' USING ERRCODE='22023'; END IF;
  filename:=p_payload->>'filename';
  IF filename IS NULL OR filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' THEN RAISE EXCEPTION 'filename must be 1 to 120 safe characters' USING ERRCODE='22023'; END IF;
  mime:=p_payload->>'mime';
  IF mime IS NULL OR mime NOT IN('application/pdf','image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'mime must be application/pdf, image/jpeg, image/png or image/webp' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_payload->'size_bytes') IS DISTINCT FROM 'number' OR (p_payload->>'size_bytes') !~ '^[0-9]{1,9}$'
   OR (p_payload->>'size_bytes')::numeric<1 OR (p_payload->>'size_bytes')::numeric>20971520 THEN RAISE EXCEPTION 'size_bytes must be a whole number of bytes up to 20 MiB' USING ERRCODE='22023'; END IF;
  size_bytes:=((p_payload->>'size_bytes')::numeric)::bigint;
  md5_hex:=nullif(p_payload->>'md5','');
  IF md5_hex IS NULL THEN RAISE EXCEPTION 'md5 is required for an object kind' USING ERRCODE='22023'; END IF;
  IF md5_hex !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'md5 must be 32 lowercase hex characters' USING ERRCODE='22023'; END IF;
  sha:=nullif(p_payload->>'sha256','');
  IF sha IS NOT NULL AND sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'sha256 must be 64 hex characters' USING ERRCODE='22023'; END IF;
 END IF;
 -- Authority before any receipt fact: the receipt's occurrence, subject, grants
 -- and session are locked and the actor must be a recorder for the activity.
 r:=haven.lock_operation_evidence_authority(p_receipt,true);
 canonical:=jsonb_build_object('receipt',p_receipt,'kind',kind,'rule_label',rule_label,'filename',filename,'mime',mime,'size_bytes',size_bytes,'md5',md5_hex,'sha256',sha,'linked_table',linked_table,'linked_record_id',linked_id);
 request_hash:=haven.operation_evidence_request_hash(canonical);
 prior:=haven.operation_evidence_replay(r.id,p_request_key,request_hash);
 IF prior.id IS NOT NULL THEN
  SELECT * INTO ev FROM public.operation_evidence WHERE id=prior.evidence_id;
  RETURN haven.operation_evidence_reply(ev,prior,true,NULL);
 END IF;
 IF r.receipt_kind<>'performance' OR r.superseded_by_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Evidence attaches to the effective performance receipt' USING ERRCODE='P0001'; END IF;
 IF rule_label IS NOT NULL THEN
  rules:=haven.operation_receipt_evidence_rules(r);
  SELECT x INTO rule FROM jsonb_array_elements(rules) x WHERE x->>'label'=rule_label;
  IF rule IS NULL THEN RAISE EXCEPTION 'Evidence rule does not apply to this receipt' USING ERRCODE='22023'; END IF;
  IF rule->>'kind'<>kind THEN RAISE EXCEPTION 'Evidence kind does not match the rule' USING ERRCODE='22023'; END IF;
  IF haven.operation_evidence_rule_met(r.id,rule) THEN RAISE EXCEPTION 'Evidence rule is already satisfied' USING ERRCODE='P0001'; END IF;
 END IF;
 IF kind<>'linked_record' THEN
  SELECT * INTO existing FROM public.operation_evidence WHERE receipt_id=r.id AND state='finalized' AND (declared_md5=md5_hex OR (sha IS NOT NULL AND declared_sha256=sha)) ORDER BY finalized_at LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Evidence already finalized for these bytes' USING ERRCODE='P0001',DETAIL='evidence_id='||existing.id; END IF;
 END IF;
 IF kind='linked_record' AND NOT haven.operation_evidence_linked_readable(linked_table,linked_id,r) THEN
  RAISE EXCEPTION 'Linked record is not readable for this receipt' USING ERRCODE='P0001';
 END IF;
 now_at:=clock_timestamp(); new_id:=gen_random_uuid();
 path:=CASE WHEN kind='linked_record' THEN NULL ELSE r.facility_id::text||'/'||new_id::text||'/'||filename END;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_evidence(id,organization_id,facility_id,activity_id,subject_id,authority_class,receipt_id,task_instance_id,evidence_kind,rule_label,state,bucket_id,object_path,
   declared_mime,declared_size_bytes,declared_sha256,declared_md5,linked_table,linked_record_id,uploaded_by,prepared_at,finalized_at,finalized_by,request_key,request_hash,revision)
  VALUES(new_id,r.organization_id,r.facility_id,r.activity_id,r.subject_id,r.authority_class,r.id,r.task_instance_id,kind,rule_label,CASE WHEN kind='linked_record' THEN 'finalized' ELSE 'prepared' END,
   CASE WHEN kind='linked_record' THEN NULL ELSE 'operation-evidence' END,path,mime,size_bytes,sha,md5_hex,linked_table,linked_id,auth.uid(),now_at,
   CASE WHEN kind='linked_record' THEN now_at END,CASE WHEN kind='linked_record' THEN auth.uid() END,p_request_key,request_hash,haven.operation_occurrence_revision()) RETURNING * INTO ev;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 e:=haven.write_operation_evidence_event(r,ev.id,'prepared',p_request_key,request_hash,NULL,jsonb_build_object('kind',kind,'rule_label',rule_label,'declared_mime',mime,'declared_size_bytes',size_bytes,'declared_md5',md5_hex,'linked_table',linked_table));
 IF kind='linked_record' THEN
  PERFORM haven.write_operation_evidence_event(r,ev.id,'finalized',p_request_key||'|finalized',request_hash,r.revision,jsonb_build_object('linked_table',linked_table,'linked_record_id',linked_id));
  satisfaction:=haven.satisfy_operation_receipt_evidence(r.id,p_request_key,request_hash);
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_evidence_authority(p_receipt,true);
 SELECT * INTO ev FROM public.operation_evidence WHERE id=ev.id;
 RETURN haven.operation_evidence_reply(ev,e,false,satisfaction);
END $$;

CREATE FUNCTION haven.mark_operation_evidence_uploaded(p_evidence uuid,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.operation_evidence; r public.operation_execution_receipts; request_hash text; prior public.operation_evidence_events; e public.operation_evidence_events; now_at timestamptz;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 r:=haven.lock_operation_evidence_authority(ev.receipt_id,true);
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence FOR UPDATE;
 request_hash:=haven.operation_evidence_request_hash(jsonb_build_object('evidence',p_evidence,'command','uploaded'));
 prior:=haven.operation_evidence_replay(r.id,p_request_key,request_hash);
 IF prior.id IS NOT NULL THEN RETURN haven.operation_evidence_reply(ev,prior,true,NULL); END IF;
 IF ev.uploaded_by<>auth.uid() THEN RAISE EXCEPTION 'Evidence belongs to another uploader' USING ERRCODE='P0001'; END IF;
 IF ev.state='failed' THEN RAISE EXCEPTION 'Evidence has failed' USING ERRCODE='P0001'; END IF;
 IF ev.state<>'prepared' THEN RAISE EXCEPTION 'Evidence is already uploaded' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 -- Object present, owned and as declared, then the checksum against the eTag:
 -- uploaded (verified), uploaded with the checksum unverifiable, or failed
 -- with checksum_mismatch; the reply's outcome names which.
 e:=haven.record_operation_evidence_upload(r,ev,p_request_key,request_hash,false,NULL,now_at);
 SELECT * INTO ev FROM public.operation_evidence WHERE id=ev.id;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_evidence_authority(ev.receipt_id,true);
 RETURN haven.operation_evidence_reply(ev,e,false,NULL);
END $$;

CREATE FUNCTION haven.finalize_operation_evidence(p_evidence uuid,p_request_key text,p_expected_receipt_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.operation_evidence; r public.operation_execution_receipts; problem text; sha text; request_hash text; prior public.operation_evidence_events; e public.operation_evidence_events; now_at timestamptz; satisfaction jsonb; obs jsonb;
BEGIN
 problem:=haven.operation_evidence_request_problem(p_request_key,coalesce(p_payload,'{}'::jsonb),ARRAY['sha256']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 IF p_expected_receipt_revision IS NULL OR p_expected_receipt_revision !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'An expected receipt revision is required' USING ERRCODE='22023'; END IF;
 sha:=nullif(coalesce(p_payload,'{}'::jsonb)->>'sha256','');
 IF sha IS NOT NULL AND sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'sha256 must be 64 hex characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 r:=haven.lock_operation_evidence_authority(ev.receipt_id,true);
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence FOR UPDATE;
 request_hash:=haven.operation_evidence_request_hash(jsonb_build_object('evidence',p_evidence,'command','finalize','sha256',sha));
 prior:=haven.operation_evidence_replay(r.id,p_request_key,request_hash);
 IF prior.id IS NOT NULL THEN RETURN haven.operation_evidence_reply(ev,prior,true,NULL); END IF;
 IF ev.uploaded_by<>auth.uid() THEN RAISE EXCEPTION 'Evidence belongs to another uploader' USING ERRCODE='P0001'; END IF;
 IF ev.state='failed' THEN RAISE EXCEPTION 'Evidence has failed' USING ERRCODE='P0001'; END IF;
 IF ev.state='finalized' THEN RAISE EXCEPTION 'Evidence is already finalized' USING ERRCODE='P0001'; END IF;
 IF sha IS NOT NULL AND ev.declared_sha256 IS NOT NULL AND ev.declared_sha256<>sha THEN RAISE EXCEPTION 'sha256 does not match the prepared evidence' USING ERRCODE='P0001'; END IF;
 -- The receipt the uploader saw must still be the receipt. Receipt revisions
 -- are immutable (the guard permits only the two evidence-status columns to
 -- move), so the expected revision proves the caller read this receipt's
 -- current fingerprint; a concurrent correction (HFO-08) does not move it but
 -- supersedes the receipt, and the superseded check below is what conflicts.
 IF r.revision<>p_expected_receipt_revision THEN RAISE EXCEPTION 'Receipt changed since it was read' USING ERRCODE='P0001'; END IF;
 IF r.receipt_kind<>'performance' OR r.superseded_by_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Evidence attaches to the effective performance receipt' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 IF ev.state='prepared' THEN
  -- Straight from prepared: the upload check runs first under the same rules
  -- as upload marking; a checksum mismatch (failed) or an unverifiable
  -- checksum (uploaded, unverified) ends the command with that outcome.
  e:=haven.record_operation_evidence_upload(r,ev,p_request_key,request_hash,true,p_expected_receipt_revision,now_at);
  SELECT * INTO ev FROM public.operation_evidence WHERE id=ev.id;
  IF ev.state='failed' OR NOT ev.checksum_verified THEN
   PERFORM set_config('haven.operation_occurrence_command','',true);
   PERFORM haven.lock_operation_evidence_authority(ev.receipt_id,true);
   RETURN haven.operation_evidence_reply(ev,e,false,NULL);
  END IF;
 ELSE
  -- An unverified checksum never finalizes; the uploader may fail the row explicitly.
  IF NOT ev.checksum_verified THEN RAISE EXCEPTION 'Evidence checksum could not be verified from the stored object' USING ERRCODE='P0001'; END IF;
  -- The stored object must still be the one that was verified: same id,
  -- eTag, version (when recorded), owner, size and type, and its MD5 must
  -- still equal the declared one. Any difference fails the row durably.
  obs:=haven.operation_evidence_object(ev);
  IF NOT (obs->>'present')::boolean OR (obs->>'object_id')::uuid IS DISTINCT FROM ev.object_id OR (obs->>'owner')::uuid IS DISTINCT FROM ev.uploaded_by
   OR haven.operation_evidence_etag(obs->>'object_etag') IS DISTINCT FROM haven.operation_evidence_etag(ev.object_etag) OR obs->>'etag_md5' IS DISTINCT FROM ev.declared_md5
   OR (ev.object_version IS NOT NULL AND obs->>'object_version' IS DISTINCT FROM ev.object_version)
   OR (obs->>'object_size_bytes')::bigint IS DISTINCT FROM ev.declared_size_bytes OR obs->>'object_mime' IS DISTINCT FROM ev.declared_mime THEN
   UPDATE public.operation_evidence SET state='failed',failed_at=now_at,failure_reason='object_changed' WHERE id=ev.id RETURNING * INTO ev;
   e:=haven.write_operation_evidence_event(r,ev.id,'failed',p_request_key,request_hash,p_expected_receipt_revision,jsonb_build_object('failure_kind','object_changed','reason','object_changed','rule_label',ev.rule_label,'previous_state','uploaded',
    'declared_md5',ev.declared_md5,'recorded',jsonb_build_object('object_id',ev.object_id,'object_etag',ev.object_etag,'object_version',ev.object_version,'object_size_bytes',ev.object_size_bytes,'object_mime',ev.object_mime),
    'observed',CASE WHEN (obs->>'present')::boolean THEN obs-'present'-'etag_md5'-'etag_kind' ELSE jsonb_build_object('present',false) END));
   PERFORM set_config('haven.operation_occurrence_command','',true);
   PERFORM haven.lock_operation_evidence_authority(ev.receipt_id,true);
   RETURN haven.operation_evidence_reply(ev,e,false,NULL);
  END IF;
 END IF;
 BEGIN
  UPDATE public.operation_evidence SET state='finalized',finalized_at=now_at,finalized_by=auth.uid() WHERE id=ev.id RETURNING * INTO ev;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Evidence already finalized for these bytes' USING ERRCODE='P0001';
 END;
 e:=haven.write_operation_evidence_event(r,ev.id,'finalized',p_request_key,request_hash,p_expected_receipt_revision,jsonb_build_object('object_id',ev.object_id,'object_etag',ev.object_etag,'object_version',ev.object_version,
  'declared_md5',ev.declared_md5,'checksum_method',ev.checksum_method,'checksum_verified_at',ev.checksum_verified_at,'declared_sha256',ev.declared_sha256,'rule_label',ev.rule_label));
 satisfaction:=haven.satisfy_operation_receipt_evidence(r.id,p_request_key,request_hash);
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_evidence_authority(ev.receipt_id,true);
 RETURN haven.operation_evidence_reply(ev,e,false,satisfaction);
END $$;

CREATE FUNCTION haven.fail_operation_evidence(p_evidence uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.operation_evidence; r public.operation_execution_receipts; problem text; reason text; request_hash text; prior public.operation_evidence_events; e public.operation_evidence_events; now_at timestamptz;
BEGIN
 problem:=haven.operation_evidence_request_problem(p_request_key,p_payload,ARRAY['reason']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
 IF reason IS NULL OR length(reason)>2000 THEN RAISE EXCEPTION 'reason must be text of at most 2000 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 r:=haven.lock_operation_evidence_authority(ev.receipt_id,true);
 SELECT * INTO ev FROM public.operation_evidence WHERE id=p_evidence FOR UPDATE;
 request_hash:=haven.operation_evidence_request_hash(jsonb_build_object('evidence',p_evidence,'command','fail','reason',reason));
 prior:=haven.operation_evidence_replay(r.id,p_request_key,request_hash);
 IF prior.id IS NOT NULL THEN RETURN haven.operation_evidence_reply(ev,prior,true,NULL); END IF;
 -- Only the uploader records the failure; another recorder never sees the path.
 IF ev.uploaded_by<>auth.uid() THEN RAISE EXCEPTION 'Evidence belongs to another uploader' USING ERRCODE='P0001'; END IF;
 IF ev.state='finalized' THEN RAISE EXCEPTION 'Evidence is already finalized' USING ERRCODE='P0001'; END IF;
 IF ev.state='failed' THEN RAISE EXCEPTION 'Evidence has failed' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_evidence SET state='failed',failed_at=now_at,failure_reason=reason WHERE id=ev.id RETURNING * INTO ev;
 e:=haven.write_operation_evidence_event(r,ev.id,'failed',p_request_key,request_hash,NULL,jsonb_build_object('reason',reason,'rule_label',ev.rule_label,'previous_state',CASE WHEN ev.uploaded_at IS NULL THEN 'prepared' ELSE 'uploaded' END));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_evidence_authority(ev.receipt_id,true);
 RETURN haven.operation_evidence_reply(ev,e,false,NULL);
END $$;

-- ---------------------------------------------------------------------------
-- Verification keeps its 341 body; required evidence counts as present when
-- the receipt's current evidence status is complete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.verify_operation_work(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; k text; note text; now_at timestamptz;
 perf public.operation_execution_receipts; existing public.operation_execution_receipts; r public.operation_execution_receipts; i public.operation_issues; request_hash text; missing jsonb;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Verification payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('decision','note') THEN RAISE EXCEPTION 'Verification payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_payload->>'decision' IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'decision must be verified' USING ERRCODE='22023'; END IF;
 note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF length(coalesce(note,''))>4000 THEN RAISE EXCEPTION 'note must be text of at most 4000 characters' USING ERRCODE='22023'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',jsonb_build_object('decision','verified','note',note))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task THEN RETURN haven.operation_receipt_reply(existing,t,NULL::public.operation_issues,true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 now_at:=clock_timestamp();
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL FOR SHARE;
 IF NOT FOUND OR t.execution_state<>'awaiting_verification' THEN RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
 IF auth.uid()=perf.recorder_id OR auth.uid() IS NOT DISTINCT FROM perf.performer_user_id THEN
  RAISE EXCEPTION 'A different authorized staff member must verify this task' USING ERRCODE='42501'; END IF;
 -- COL-143: finalized evidence satisfies the receipt's rules.
 missing:=CASE WHEN perf.evidence_status_current='complete' THEN '[]'::jsonb ELSE haven.operation_receipt_missing_evidence(coalesce(fr.local_required_evidence,v.required_evidence),perf.outcome) END;
 IF jsonb_array_length(missing)>0 THEN RAISE EXCEPTION 'Required evidence is missing' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,values,note,evidence_status,missing_evidence,completion_state,request_key,request_hash,revision)
  VALUES(t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'verification',
   auth.uid(),haven.app_role()::text,now_at,now_at,'self','routine',NULL,'{}'::jsonb,note,perf.evidence_status_current,'[]'::jsonb,'completed',p_request_key,request_hash,haven.operation_occurrence_revision())
  RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL) THEN
   RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 UPDATE public.operation_task_instances SET status='completed',execution_state='completed',verification_receipt_id=r.id,completed_at=now_at,
  second_sign_by=auth.uid(),second_signed_at=now_at,verified_by=auth.uid(),verified_at=now_at,updated_at=now_at,updated_by=auth.uid() WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'verified',t.status,'completed',auth.uid(),haven.app_role()::text,note,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'completion_state','completed','request_key',p_request_key,'request_hash',request_hash,'receipt_version',1)),
 (t.organization_id,t.facility_id,t.id,'completed',t.status,'completed',auth.uid(),haven.app_role()::text,NULL,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'independent_verification',true));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN haven.operation_receipt_reply(r,t,NULL::public.operation_issues,false);
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.prepare_operation_evidence_review(p_receipt uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.prepare_operation_evidence(p_receipt,p_request_key,p_payload) $$;
CREATE FUNCTION public.mark_operation_evidence_uploaded_review(p_evidence uuid,p_request_key text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.mark_operation_evidence_uploaded(p_evidence,p_request_key) $$;
CREATE FUNCTION public.finalize_operation_evidence_review(p_evidence uuid,p_request_key text,p_expected_receipt_revision text,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finalize_operation_evidence(p_evidence,p_request_key,p_expected_receipt_revision,p_payload) $$;
CREATE FUNCTION public.fail_operation_evidence_review(p_evidence uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.fail_operation_evidence(p_evidence,p_request_key,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.prepare_operation_evidence(uuid,text,jsonb),haven.mark_operation_evidence_uploaded(uuid,text),haven.finalize_operation_evidence(uuid,text,text,jsonb),haven.fail_operation_evidence(uuid,text,jsonb),
 public.prepare_operation_evidence_review(uuid,text,jsonb),public.mark_operation_evidence_uploaded_review(uuid,text),public.finalize_operation_evidence_review(uuid,text,text,jsonb),public.fail_operation_evidence_review(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.prepare_operation_evidence(uuid,text,jsonb),haven.mark_operation_evidence_uploaded(uuid,text),haven.finalize_operation_evidence(uuid,text,text,jsonb),haven.fail_operation_evidence(uuid,text,jsonb),
 public.prepare_operation_evidence_review(uuid,text,jsonb),public.mark_operation_evidence_uploaded_review(uuid,text),public.finalize_operation_evidence_review(uuid,text,text,jsonb),public.fail_operation_evidence_review(uuid,text,jsonb)
 TO authenticated;

-- No evidence exists before this migration is applied anywhere, and every
-- receipt carries a current evidence status equal to its recorded one.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_evidence) OR EXISTS(SELECT 1 FROM public.operation_evidence_events)
  OR EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE evidence_status_current IS DISTINCT FROM evidence_status OR evidence_satisfied_at IS NOT NULL) THEN
  RAISE EXCEPTION 'COL-143: evidence or a satisfied receipt exists before the migration; repair before applying';
 END IF;
END $$;

COMMENT ON TABLE public.operation_evidence IS 'COL-143: immutable evidence metadata for one performance receipt (kind, rule, owned object path in the operation-evidence bucket or a linked native record, declared and observed type and size, declared MD5 verified against the Storage eTag, uploader, prepared/uploaded/finalized/failed). Only a finalized, checksum-verified object owned by the evidence satisfies a rule; nothing here transfers bytes.';
COMMENT ON COLUMN public.operation_evidence.declared_md5 IS 'COL-143: MD5 of the bytes the uploader declared at preparation; verified against storage.objects.metadata->>''eTag'' (checksum_method storage_etag_md5) when the upload is marked and again at finalization. A mismatch fails the row (checksum_mismatch); a non-MD5 eTag leaves it unverified and it never finalizes.';
COMMENT ON TABLE public.operation_evidence_events IS 'COL-143: immutable evidence history (prepared, uploaded, finalized, failed) and receipt-level satisfaction events with the expected receipt revision and request fingerprint.';
COMMENT ON COLUMN public.operation_execution_receipts.evidence_status_current IS 'COL-143: the receipt''s evidence status now (missing until every applicable required rule is met by finalized evidence, then complete); evidence_status keeps what was recorded at the click.';
COMMENT ON FUNCTION haven.finalize_operation_evidence(uuid,text,text,jsonb) IS 'COL-143: finalize an uploaded object as evidence under the uploader''s current authority and the expected receipt revision; appends the satisfaction event and moves the occurrence on when the receipt''s rules are met, without a second performance.';
NOTIFY pgrst,'reload schema';
COMMIT;
