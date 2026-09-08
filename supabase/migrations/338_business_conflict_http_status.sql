-- Deliberate business conflicts must not trigger PostgREST serialization retries.
-- Only SQLSTATE changes from committed335/336; signatures, authority, locks, history and results are preserved.
BEGIN;

CREATE OR REPLACE FUNCTION public.haven_publish_standup_import(
  p_organization_id uuid, p_file_sha256 text, p_file_name text, p_rows jsonb,
  p_expected_versions jsonb, p_correction_reason text, p_definition_reference text, p_expected_context jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_row jsonb;
  v_definition public.exec_standup_metric_definitions%ROWTYPE;
  v_snapshot public.exec_standup_snapshots%ROWTYPE;
  v_week date;
  v_receipt public.exec_standup_import_receipts%ROWTYPE;
  v_payload jsonb;
  v_result jsonb;
  v_snapshots jsonb := '[]';
  v_expected bigint;
  v_present bigint;
  v_facilities bigint;
  v_completeness numeric;
  v_version integer;
  v_coverage jsonb;
  v_context jsonb;
  v_receipt_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_previous_flag text := current_setting('haven.standup_import_active', true);
BEGIN
  IF p_organization_id IS NULL OR p_file_sha256 IS NULL OR p_file_sha256 !~ '^[a-f0-9]{64}$'
    OR nullif(btrim(p_file_name), '') IS NULL OR nullif(btrim(p_definition_reference), '') IS NULL
    OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0
    OR jsonb_typeof(p_expected_versions) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_expected_context) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A file fingerprint, rows, expected versions and definition review reference are required' USING ERRCODE = '22023';
  END IF;
  -- Row locking the organization also serializes first publications with no snapshot yet.
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown organization' USING ERRCODE = '22023'; END IF;
  v_payload := jsonb_build_object('rows', p_rows, 'definition_reference', p_definition_reference, 'expected_context',p_expected_context);
  SELECT * INTO v_receipt FROM public.exec_standup_import_receipts
    WHERE organization_id = p_organization_id AND file_sha256 = p_file_sha256;
  IF FOUND THEN
    IF v_receipt.payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'File fingerprint was previously used for different content or definitions' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result_json || jsonb_build_object('duplicate', true);
  END IF;
  -- Lock reference rows so scope and definition validity remain stable through publication.
  PERFORM 1 FROM public.facilities WHERE organization_id = p_organization_id FOR SHARE;
  PERFORM 1 FROM public.exec_standup_metric_definitions WHERE organization_id = p_organization_id FOR SHARE;
  v_context := jsonb_build_object('facility_ids',
    (SELECT coalesce(jsonb_agg(f.id ORDER BY f.id),'[]'::jsonb) FROM public.facilities f
      WHERE f.organization_id=p_organization_id AND f.status='active' AND f.deleted_at IS NULL),
    'metric_definitions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.key COLLATE "C"),'[]'::jsonb) FROM public.exec_standup_metric_definitions d
      WHERE d.organization_id=p_organization_id AND d.active AND d.deleted_at IS NULL));
  IF v_context IS DISTINCT FROM p_expected_context THEN
    RAISE EXCEPTION 'Definition or active facility scope changed since preview' USING ERRCODE = 'PT409';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
      OR NOT (v_row ?& ARRAY['week_of','facility_id','metric_key','metric_label','section_key','value_numeric','value_text','source_row','source_cells'])
      OR jsonb_typeof(v_row->'week_of') IS DISTINCT FROM 'string' OR (v_row->>'week_of') !~ '^\d{4}-\d{2}-\d{2}$'
      OR jsonb_typeof(v_row->'facility_id') NOT IN ('string','null')
      OR jsonb_typeof(v_row->'metric_key') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_row->'metric_label') IS DISTINCT FROM 'string' OR nullif(btrim(v_row->>'metric_label'),'') IS NULL
      OR jsonb_typeof(v_row->'section_key') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_row->'value_numeric') NOT IN ('number','null')
      OR jsonb_typeof(v_row->'value_text') NOT IN ('string','null')
      OR jsonb_typeof(v_row->'source_row') IS DISTINCT FROM 'number' OR (v_row->>'source_row') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(v_row->'source_cells') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Malformed import row' USING ERRCODE = '22023';
    END IF;
    v_week := (v_row->>'week_of')::date;
    IF to_char(v_week, 'YYYY-MM-DD') <> v_row->>'week_of' THEN
      RAISE EXCEPTION 'Invalid import date' USING ERRCODE = '22023';
    END IF;
    IF v_row->>'facility_id' IS NOT NULL AND NOT ((v_context->'facility_ids') ? (v_row->>'facility_id')) THEN
      RAISE EXCEPTION 'Facility is outside active organization scope' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_definition FROM jsonb_populate_recordset(NULL::public.exec_standup_metric_definitions,v_context->'metric_definitions') d
      WHERE d.key = v_row->>'metric_key';
    IF NOT FOUND OR v_definition.section_key <> v_row->>'section_key'
      OR (v_row->>'facility_id' IS NULL AND NOT v_definition.total_scope)
      OR (v_row->>'facility_id' IS NOT NULL AND NOT v_definition.facility_scope)
      OR (v_definition.value_type = 'text' AND v_row->>'value_numeric' IS NOT NULL)
      OR (v_definition.value_type <> 'text' AND v_row->>'value_text' IS NOT NULL) THEN
      RAISE EXCEPTION 'Metric does not match active definition, scope or value type' USING ERRCODE = '22023';
    END IF;
    -- Fail instead of silently rounding the destination numeric(14,2).
    IF v_row->>'value_numeric' IS NOT NULL AND ((v_row->>'value_numeric')::numeric <> round((v_row->>'value_numeric')::numeric, 2)
        OR abs((v_row->>'value_numeric')::numeric) >= 1000000000000
        OR (v_definition.value_type IN ('count','currency') AND (v_row->>'value_numeric')::numeric <> trunc((v_row->>'value_numeric')::numeric))) THEN
      RAISE EXCEPTION 'Numeric value exceeds supported precision' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'week_of', (r->>'facility_id')::uuid, r->>'metric_key' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate week/facility/metric row' USING ERRCODE = '22023';
  END IF;
  v_facilities := jsonb_array_length(v_context->'facility_ids');
  SELECT coalesce(sum(CASE WHEN (d->>'facility_scope')::boolean THEN v_facilities ELSE 0 END
    + CASE WHEN (d->>'total_scope')::boolean THEN 1 ELSE 0 END),0)
    INTO v_expected FROM jsonb_array_elements(v_context->'metric_definitions') d;
  v_coverage := jsonb_build_object('coverage_basis','current_active_registry',
    'expected_facility_ids',v_context->'facility_ids','metric_definitions',v_context->'metric_definitions');
  PERFORM set_config('haven.standup_import_active', 'on', true);
  FOR v_week IN SELECT DISTINCT (r->>'week_of')::date FROM jsonb_array_elements(p_rows) r ORDER BY 1 LOOP
    SELECT * INTO v_snapshot FROM public.exec_standup_snapshots
      WHERE organization_id = p_organization_id AND week_of = v_week AND deleted_at IS NULL FOR UPDATE;
    IF jsonb_typeof(p_expected_versions->v_week::text) IS DISTINCT FROM 'number'
      OR (p_expected_versions->>v_week::text) !~ '^(0|[1-9][0-9]*)$'
      OR (p_expected_versions->>v_week::text)::numeric <> coalesce(v_snapshot.published_version, 0) THEN
      RAISE EXCEPTION 'Stale or missing preview version for week %', v_week USING ERRCODE = 'PT409';
    END IF;
    v_version := coalesce(v_snapshot.published_version, 0) + 1;
    IF v_snapshot.id IS NOT NULL THEN
      IF nullif(btrim(p_correction_reason),'') IS NULL THEN
        RAISE EXCEPTION 'Replacing a week requires a correction reason' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.exec_standup_snapshot_versions(organization_id,snapshot_id,published_version,header_json,metrics_json,correction_reason,replacement_file_sha256)
      SELECT p_organization_id,v_snapshot.id,v_snapshot.published_version,to_jsonb(v_snapshot),
        coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb),p_correction_reason,p_file_sha256
      FROM public.exec_standup_snapshot_metrics m WHERE m.snapshot_id=v_snapshot.id;
      UPDATE public.exec_standup_snapshot_metrics SET deleted_at=v_now WHERE snapshot_id=v_snapshot.id AND deleted_at IS NULL;
    ELSE
      INSERT INTO public.exec_standup_snapshots(organization_id,week_of) VALUES(p_organization_id,v_week) RETURNING * INTO v_snapshot;
    END IF;
    INSERT INTO public.exec_standup_snapshot_metrics(snapshot_id,organization_id,facility_id,section_key,metric_key,metric_label,value_numeric,value_text,
      source_mode,confidence_band,totals_included,freshness_at,source_ref_json)
    SELECT v_snapshot.id,p_organization_id,(r->>'facility_id')::uuid,r->>'section_key',r->>'metric_key',r->>'metric_label',
      (r->>'value_numeric')::numeric,r->>'value_text','manual','low',(r->>'facility_id' IS NULL),NULL,
      jsonb_build_array(jsonb_build_object('file_sha256',p_file_sha256,'file_name',p_file_name,'source_row',r->'source_row',
        'source_cells',r->'source_cells','definition_reference',p_definition_reference,'source_as_of',NULL,'calculated_at',v_now))
    FROM jsonb_array_elements(p_rows) r WHERE (r->>'week_of')::date=v_week;
    SELECT count(*) INTO v_present FROM public.exec_standup_snapshot_metrics WHERE snapshot_id=v_snapshot.id AND deleted_at IS NULL
      AND (value_numeric IS NOT NULL OR nullif(btrim(value_text),'') IS NOT NULL);
    v_completeness := CASE WHEN v_expected=0 THEN 0 ELSE round(100.0*v_present/v_expected,2) END;
    UPDATE public.exec_standup_snapshots SET status='published',published_version=v_version,confidence_band='low',completeness_pct=v_completeness,
      published_at=v_now,generated_at=v_now,published_by=NULL,generated_by=NULL,pdf_attachment_path=NULL,
      summary_json=jsonb_build_object('file_sha256',p_file_sha256,'file_name',p_file_name,'definition_reference',p_definition_reference,
        'correction_reason',p_correction_reason,'source_as_of',NULL,'calculated_at',v_now,'expected_metric_count',v_expected,'present_metric_count',v_present,
        'missing_metric_count',v_expected-v_present,'receipt_id',v_receipt_id) || v_coverage
      WHERE id=v_snapshot.id;
    v_snapshots := v_snapshots || jsonb_build_array(jsonb_build_object('id',v_snapshot.id,'week_of',v_week,'published_version',v_version,'completeness_pct',v_completeness));
  END LOOP;
  v_result := jsonb_build_object('receipt_id',v_receipt_id,'duplicate',false,'snapshots',v_snapshots,
    'imported_week_count',jsonb_array_length(v_snapshots),'imported_metric_count',jsonb_array_length(p_rows));
  INSERT INTO public.exec_standup_import_receipts(id,organization_id,file_sha256,file_name,payload,result_json)
    VALUES(v_receipt_id,p_organization_id,p_file_sha256,p_file_name,v_payload,v_result);
  INSERT INTO public.exec_standup_import_jobs(organization_id,source_file_name,source_kind,status,imported_week_count,imported_metric_count,source_ref_json,result_json,started_at,finished_at)
    VALUES(p_organization_id,p_file_name,CASE WHEN lower(p_file_name) LIKE '%.csv' THEN 'csv' ELSE 'xlsx' END,'completed',
      jsonb_array_length(v_snapshots),jsonb_array_length(p_rows),jsonb_build_object('file_sha256',p_file_sha256,'receipt_id',v_receipt_id),v_result,v_now,clock_timestamp());
  PERFORM set_config('haven.standup_import_active',coalesce(v_previous_flag,''),true);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_resolve_return_document_followup(p_followup_id uuid,p_form_id uuid,p_review_note text,p_form_updated_at timestamptz) RETURNS jsonb
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
  RAISE EXCEPTION 'Follow-up already completed with different evidence' USING ERRCODE='PT409';
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

COMMIT;
