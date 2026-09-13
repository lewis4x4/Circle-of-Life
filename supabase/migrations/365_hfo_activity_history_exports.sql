BEGIN;
-- COL-151: durable immutable MVCC source snapshots, private to their requester.
-- No storage paths, bearer URLs, native file bytes, generic audit payloads or service access.
CREATE TABLE haven.operation_history_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 requested_by uuid NOT NULL,
 request_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 facility_id uuid NOT NULL,
 activity_id uuid NOT NULL,
 generated_at timestamptz NOT NULL,
 snapshot_id text NOT NULL,
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 UNIQUE(requested_by,request_id)
);
ALTER TABLE haven.operation_history_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.operation_history_exports FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.guard_operation_history_export() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Export snapshots are immutable' USING ERRCODE='23514'; END IF;
 -- Deliberately metadata-only: never audit rows, filters, subject identities or counts.
 INSERT INTO public.audit_log(table_name,record_id,action,new_data,user_id,organization_id,facility_id)
 VALUES('operation_history_exports',NEW.id,'INSERT',jsonb_build_object('event','snapshot_created','schema_version',1),
  NEW.requested_by,NEW.organization_id,NEW.facility_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_history_export() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_history_export_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.operation_history_exports
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_history_export();
CREATE TRIGGER operation_history_export_no_truncate BEFORE TRUNCATE ON haven.operation_history_exports
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_history_export();
CREATE FUNCTION haven.operation_history_export_current(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.operation_history_exports; item jsonb; ev jsonb; r public.operation_execution_receipts;
BEGIN
 SELECT * INTO s FROM haven.operation_history_exports WHERE id=p_id;
 IF NOT FOUND OR s.requested_by IS DISTINCT FROM haven.authorized_user_id()
 OR s.organization_id IS DISTINCT FROM haven.organization_id()
 OR NOT coalesce(haven.operation_facility_access(s.facility_id),false)
 OR NOT EXISTS(SELECT 1 FROM public.operation_activities a WHERE a.id=s.activity_id AND a.organization_id=s.organization_id
  AND (a.facility_id IS NULL OR a.facility_id=s.facility_id)) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(s.rows) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.operation_task_instances t WHERE t.id=(item->>'id')::uuid
   AND t.organization_id=s.organization_id AND t.facility_id=s.facility_id AND t.activity_id=s.activity_id
   AND t.subject_id IS NOT DISTINCT FROM (item->>'subject_id')::uuid
   AND t.authority_class=item->>'authority_class' AND t.deleted_at IS NULL
   AND haven.operation_task_readable(t.id)) THEN RETURN false; END IF;
  FOR ev IN SELECT value FROM jsonb_array_elements(item->'source_events') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.operation_source_events e WHERE e.id=(ev->>'id')::uuid AND haven.operation_source_event_readable(e)) THEN RETURN false; END IF;
  END LOOP;
  FOR ev IN SELECT value FROM jsonb_array_elements(item->'evidence') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.operation_evidence e WHERE e.id=(ev->>'id')::uuid
    AND e.task_instance_id=(item->>'id')::uuid AND (e.state='finalized' OR e.uploaded_by=auth.uid())) THEN RETURN false; END IF;
   IF ev->>'evidence_kind'='linked_record' THEN
    SELECT * INTO r FROM public.operation_execution_receipts WHERE id=(ev->>'receipt_id')::uuid;
    IF NOT FOUND OR NOT coalesce(haven.operation_evidence_linked_readable(ev->>'linked_table',(ev->>'linked_record_id')::uuid,r),false) THEN RETURN false; END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION haven.read_operation_history_export(p_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 250) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.operation_history_exports; page jsonb; receipts bigint; evidence bigint;
BEGIN
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF NOT haven.operation_history_export_current(p_id) THEN RAISE EXCEPTION 'Export not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM haven.operation_history_exports WHERE id=p_id;
 SELECT coalesce(sum(jsonb_array_length(value->'receipts')),0),coalesce(sum(jsonb_array_length(value->'evidence')),0)
 INTO receipts,evidence FROM jsonb_array_elements(s.rows);
 SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) INTO page
 FROM jsonb_array_elements(s.rows) WITH ORDINALITY a(value,ord) WHERE ord>p_offset AND ord<=p_offset+p_limit;
 RETURN jsonb_build_object('export_id',s.id,'manifest',jsonb_build_object('schema_version',1,'generated_at',s.generated_at,
  'snapshot_id',s.snapshot_id,'filters',jsonb_build_object('facility_id',s.facility_id,'activity_id',s.activity_id),
  'total',jsonb_array_length(s.rows),'receipt_total',receipts,'evidence_total',evidence,'complete',true,
  'source','Haven operation occurrence/receipt/evidence ledger',
  'coverage','Authorized non-deleted occurrences across all requirement versions; all correction and verification receipts; readable evidence metadata only; native files require their own authorization'),
  'offset',p_offset,'rows',page,'next_offset',CASE WHEN p_offset+jsonb_array_length(page)<jsonb_array_length(s.rows) THEN p_offset+jsonb_array_length(page) ELSE NULL END);
END $$;
CREATE FUNCTION haven.create_operation_history_export(p_facility uuid,p_activity uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=haven.authorized_user_id(); result_id uuid; old haven.operation_history_exports;
BEGIN
 IF actor IS NULL OR p_request IS NULL OR NOT coalesce(haven.operation_facility_access(p_facility),false)
 OR NOT EXISTS(SELECT 1 FROM public.operation_activities a WHERE a.id=p_activity AND a.organization_id=haven.organization_id()
 AND (a.facility_id IS NULL OR a.facility_id=p_facility)) THEN RAISE EXCEPTION 'Export scope not authorized' USING ERRCODE='42501'; END IF;
 -- Serialize only identical requester keys. Every retry then reads the same committed snapshot.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request::text,0));
 IF actor IS DISTINCT FROM haven.authorized_user_id() OR NOT coalesce(haven.operation_facility_access(p_facility),false)
 OR NOT EXISTS(SELECT 1 FROM public.operation_activities a WHERE a.id=p_activity AND a.organization_id=haven.organization_id()
 AND (a.facility_id IS NULL OR a.facility_id=p_facility)) THEN RAISE EXCEPTION 'Export not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM haven.operation_history_exports WHERE requested_by=actor AND request_id=p_request;
 IF FOUND THEN
  IF old.facility_id<>p_facility OR old.activity_id<>p_activity THEN RAISE EXCEPTION 'Request key scope conflict' USING ERRCODE='23505'; END IF;
  RETURN haven.read_operation_history_export(old.id,0,1)-'rows'-'offset'-'next_offset';
 END IF;
 -- ONE statement, ONE MVCC snapshot: source corrections, ties and new rows cannot
 -- move page boundaries. The transaction rolls back completely on any failure.
 INSERT INTO haven.operation_history_exports(requested_by,request_id,organization_id,facility_id,activity_id,generated_at,snapshot_id,rows)
 SELECT actor,p_request,haven.organization_id(),p_facility,p_activity,clock_timestamp(),pg_current_snapshot()::text,
 coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'subject_id',t.subject_id,'authority_class',t.authority_class,'activity_name',t.template_name,
  'status',t.status,'execution_state',t.execution_state,'created_at',t.created_at,'due_at',t.due_at,
  'requirement_version_id',t.requirement_version_id,'facility_requirement_id',t.facility_requirement_id,
  'effective_receipt_id',t.effective_receipt_id,'performed_at',t.performed_at,
  'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'receipt_kind',r.receipt_kind,
   'recorder_id',r.recorder_id,'recorded_at',r.recorded_at,'performed_at',r.performed_at,'performer_kind',r.performer_kind,
   'performer_user_id',r.performer_user_id,'performer_vendor_id',r.performer_vendor_id,'performer_label',r.performer_label,
   'entry_kind',r.entry_kind,'entry_reason',r.entry_reason,'outcome',r.outcome,'values',r.values,'note',r.note,
   'evidence_status',r.evidence_status,'evidence_status_current',r.evidence_status_current,'evidence_satisfied_at',r.evidence_satisfied_at,'completion_state',r.completion_state,'chain_id',r.chain_id,
   'corrects_receipt_id',r.corrects_receipt_id,'correction_reason',r.correction_reason,'correction_seq',r.correction_seq,
   'superseded_by_receipt_id',r.superseded_by_receipt_id,'superseded_at',r.superseded_at,
   'verifies_receipt_id',r.verifies_receipt_id,'verified_receipt_revision',r.verified_receipt_revision,
   'source_event_id',r.source_event_id,'source_key',r.source_key,'source_record_id',r.source_record_id,
   'source_record_version',r.source_record_version,'requirement_version_id',r.requirement_version_id) ORDER BY r.recorded_at,r.id)
   FROM public.operation_execution_receipts r WHERE r.task_instance_id=t.id),'[]'::jsonb),
  'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'receipt_id',e.receipt_id,'revision',e.revision,
   'evidence_kind',e.evidence_kind,'state',e.state,'rule_label',e.rule_label,'object_version',e.object_version,
   'checksum_verified',e.checksum_verified,'checksum_method',e.checksum_method,'object_etag',e.object_etag,
   'object_mime',e.object_mime,'object_size_bytes',e.object_size_bytes,'uploaded_by',e.uploaded_by,
   'prepared_at',e.prepared_at,'uploaded_at',e.uploaded_at,'finalized_at',e.finalized_at,'finalized_by',e.finalized_by,
   'linked_table',e.linked_table,'linked_record_id',e.linked_record_id) ORDER BY e.created_at,e.id)
   FROM public.operation_evidence e JOIN public.operation_execution_receipts r ON r.id=e.receipt_id
   WHERE e.task_instance_id=t.id AND (e.state='finalized' OR e.uploaded_by=actor)
   AND (e.evidence_kind<>'linked_record' OR haven.operation_evidence_linked_readable(e.linked_table,e.linked_record_id,r))),'[]'::jsonb),
  'source_events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'source_key',s.source_key,
   'source_record_id',s.source_record_id,'source_record_version',s.source_record_version,'event_kind',s.event_kind,
   'receipt_id',s.receipt_id,'delivered_at',s.delivered_at) ORDER BY s.delivered_at,s.id)
   FROM public.operation_source_events s WHERE s.task_instance_id=t.id AND haven.operation_source_event_readable(s)),'[]'::jsonb)
 ) ORDER BY t.created_at,t.id),'[]'::jsonb)
 FROM public.operation_task_instances t WHERE t.organization_id=haven.organization_id() AND t.facility_id=p_facility
 AND t.activity_id=p_activity AND t.occurrence_kind IS NOT NULL AND t.deleted_at IS NULL AND haven.operation_task_readable(t.id)
 RETURNING id INTO result_id;
 RETURN haven.read_operation_history_export(result_id,0,1)-'rows'-'offset'-'next_offset';
END $$;
REVOKE ALL ON FUNCTION haven.operation_history_export_current(uuid),haven.create_operation_history_export(uuid,uuid,uuid),haven.read_operation_history_export(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.create_operation_history_export(uuid,uuid,uuid),haven.read_operation_history_export(uuid,integer,integer) TO authenticated;
CREATE FUNCTION public.create_operation_history_export(p_facility uuid,p_activity uuid,p_request uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.create_operation_history_export(p_facility,p_activity,p_request) $$;
CREATE FUNCTION public.read_operation_history_export(p_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 250) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.read_operation_history_export(p_id,p_offset,p_limit) $$;
REVOKE ALL ON FUNCTION public.create_operation_history_export(uuid,uuid,uuid),public.read_operation_history_export(uuid,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_operation_history_export(uuid,uuid,uuid),public.read_operation_history_export(uuid,integer,integer) TO authenticated;
COMMIT;
