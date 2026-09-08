-- Reviewed file publication is one transaction. Receipts and prior versions are append-only.
CREATE TABLE public.exec_standup_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  file_name text NOT NULL,
  payload jsonb NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, file_sha256)
);
CREATE TABLE public.exec_standup_snapshot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  snapshot_id uuid NOT NULL REFERENCES public.exec_standup_snapshots(id),
  published_version integer NOT NULL,
  header_json jsonb NOT NULL,
  metrics_json jsonb NOT NULL,
  correction_reason text NOT NULL CHECK (length(btrim(correction_reason)) > 0),
  replacement_file_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, published_version)
);
ALTER TABLE public.exec_standup_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exec_standup_snapshot_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exec_standup_import_receipts, public.exec_standup_snapshot_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exec_standup_import_receipts, public.exec_standup_snapshot_versions TO authenticated;
GRANT SELECT, INSERT ON public.exec_standup_import_receipts, public.exec_standup_snapshot_versions TO service_role;
CREATE POLICY exec_standup_receipts_read ON public.exec_standup_import_receipts FOR SELECT TO authenticated
  USING (organization_id = haven.organization_id() AND haven.app_role() IN ('owner', 'org_admin'));
CREATE POLICY exec_standup_versions_read ON public.exec_standup_snapshot_versions FOR SELECT TO authenticated
  USING (organization_id = haven.organization_id() AND haven.app_role() IN ('owner', 'org_admin'));
-- Portfolio JSON must not leak through the general facility-admin audit policy.
CREATE POLICY exec_standup_import_audit_scope ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (table_name NOT IN ('exec_standup_import_receipts', 'exec_standup_snapshot_versions', 'exec_standup_import_jobs')
    OR (organization_id = haven.organization_id() AND haven.app_role() IN ('owner', 'org_admin')));
-- Existing jobs contain portfolio provenance too. Only the publisher writes them.
DROP POLICY IF EXISTS exec_standup_import_jobs_org_admin_write ON public.exec_standup_import_jobs;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exec_standup_import_jobs FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.haven_standup_immutable_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Standup publication history is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.haven_standup_immutable_record() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER exec_standup_receipts_immutable BEFORE UPDATE OR DELETE ON public.exec_standup_import_receipts
  FOR EACH ROW EXECUTE FUNCTION public.haven_standup_immutable_record();
CREATE TRIGGER exec_standup_versions_immutable BEFORE UPDATE OR DELETE ON public.exec_standup_snapshot_versions
  FOR EACH ROW EXECUTE FUNCTION public.haven_standup_immutable_record();
CREATE TRIGGER exec_standup_receipts_no_truncate BEFORE TRUNCATE ON public.exec_standup_import_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION public.haven_standup_immutable_record();
CREATE TRIGGER exec_standup_versions_no_truncate BEFORE TRUNCATE ON public.exec_standup_snapshot_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.haven_standup_immutable_record();
CREATE TRIGGER exec_standup_receipts_audit AFTER INSERT ON public.exec_standup_import_receipts
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER exec_standup_versions_audit AFTER INSERT ON public.exec_standup_snapshot_versions
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Direct editor writes also invalidate previews. Security-invoker triggers prevent
-- an authenticated caller from spoofing the definer-only intermediate-write flag.
CREATE FUNCTION public.haven_standup_header_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT (current_user = pg_get_userbyid((SELECT proowner FROM pg_proc
      WHERE oid = 'public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb)'::regprocedure))
      AND coalesce(current_setting('haven.standup_import_active', true), '') = 'on') THEN
    NEW.published_version := OLD.published_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.haven_standup_metric_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_snapshot_id uuid;
BEGIN
  -- Lock both parents deterministically if an existing metric is moved.
  FOR v_snapshot_id IN
    SELECT DISTINCT s FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.snapshot_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.snapshot_id END]) AS s WHERE s IS NOT NULL ORDER BY s
  LOOP
    PERFORM 1 FROM public.exec_standup_snapshots WHERE id = v_snapshot_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Metric mutation requires a writable parent snapshot' USING ERRCODE = '42501';
    END IF;
    IF NOT (current_user = pg_get_userbyid((SELECT proowner FROM pg_proc
        WHERE oid = 'public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb)'::regprocedure))
        AND coalesce(current_setting('haven.standup_import_active', true), '') = 'on') THEN
      UPDATE public.exec_standup_snapshots SET published_version = published_version + 1 WHERE id = v_snapshot_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Metric mutation must invalidate the parent preview' USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.haven_standup_header_version(), public.haven_standup_metric_version() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.haven_publish_standup_import(
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
    RAISE EXCEPTION 'Definition or active facility scope changed since preview' USING ERRCODE = '40001';
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
      RAISE EXCEPTION 'Stale or missing preview version for week %', v_week USING ERRCODE = '40001';
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
REVOKE ALL ON FUNCTION public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.haven_publish_standup_import(uuid,text,text,jsonb,jsonb,text,text,jsonb) TO service_role;
CREATE TRIGGER exec_standup_header_version BEFORE UPDATE ON public.exec_standup_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.haven_standup_header_version();
CREATE TRIGGER exec_standup_metric_version BEFORE INSERT OR UPDATE OR DELETE ON public.exec_standup_snapshot_metrics
  FOR EACH ROW EXECUTE FUNCTION public.haven_standup_metric_version();
