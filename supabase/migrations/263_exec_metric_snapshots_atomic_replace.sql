-- Slice 3B: atomically replace executive KPI snapshot rows and normalized metric rows.

CREATE OR REPLACE FUNCTION public.replace_exec_kpi_snapshot_run(
  p_organization_id uuid,
  p_snapshot_date date,
  p_kpi_rows jsonb,
  p_metric_rows jsonb
)
RETURNS TABLE(
  kpi_inserted_count integer,
  kpi_soft_deleted_count integer,
  metric_inserted_count integer,
  metric_soft_deleted_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kpi_inserted_count integer := 0;
  v_kpi_soft_deleted_count integer := 0;
  v_metric_inserted_count integer := 0;
  v_metric_soft_deleted_count integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot_date IS NULL THEN
    RAISE EXCEPTION 'p_snapshot_date is required' USING ERRCODE = '22023';
  END IF;

  IF p_kpi_rows IS NULL THEN
    RAISE EXCEPTION 'p_kpi_rows is required' USING ERRCODE = '22023';
  END IF;

  p_metric_rows := COALESCE(p_metric_rows, '[]'::jsonb);

  IF jsonb_typeof(p_kpi_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_kpi_rows must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_kpi_rows) = 0 THEN
    RAISE EXCEPTION 'p_kpi_rows must not be empty' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_metric_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_metric_rows must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_organization_id::text),
    hashtext(p_snapshot_date::text)
  );

  UPDATE public.exec_kpi_snapshots eks
     SET deleted_at = now()
   WHERE eks.organization_id = p_organization_id
     AND eks.snapshot_date = p_snapshot_date
     AND eks.deleted_at IS NULL;

  GET DIAGNOSTICS v_kpi_soft_deleted_count = ROW_COUNT;

  INSERT INTO public.exec_kpi_snapshots (
    organization_id,
    scope_type,
    scope_id,
    snapshot_date,
    metrics_version,
    metrics,
    lineage,
    computed_by
  )
  SELECT
    p_organization_id,
    row.scope_type::public.exec_snapshot_scope,
    row.scope_id,
    p_snapshot_date,
    row.metrics_version,
    COALESCE(row.metrics, '{}'::jsonb),
    COALESCE(row.lineage, '[]'::jsonb),
    COALESCE(row.computed_by, 'edge:exec-kpi-snapshot')
  FROM jsonb_to_recordset(p_kpi_rows) AS row(
    scope_type text,
    scope_id uuid,
    metrics_version integer,
    metrics jsonb,
    lineage jsonb,
    computed_by text
  );

  GET DIAGNOSTICS v_kpi_inserted_count = ROW_COUNT;

  UPDATE public.exec_metric_snapshots ems
     SET deleted_at = now()
   WHERE ems.organization_id = p_organization_id
     AND ems.snapshot_date = p_snapshot_date
     AND ems.deleted_at IS NULL;

  GET DIAGNOSTICS v_metric_soft_deleted_count = ROW_COUNT;

  IF jsonb_array_length(p_metric_rows) > 0 THEN
    INSERT INTO public.exec_metric_snapshots (
      organization_id,
      metric_code,
      entity_id,
      facility_id,
      snapshot_date,
      period_type,
      metric_value_numeric,
      status_color,
      source_version
    )
    SELECT
      p_organization_id,
      row.metric_code,
      row.entity_id,
      row.facility_id,
      p_snapshot_date,
      row.period_type,
      row.metric_value_numeric,
      row.status_color,
      row.source_version
    FROM jsonb_to_recordset(p_metric_rows) AS row(
      metric_code text,
      entity_id uuid,
      facility_id uuid,
      period_type text,
      metric_value_numeric numeric,
      status_color text,
      source_version integer
    );

    GET DIAGNOSTICS v_metric_inserted_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT
    v_kpi_inserted_count,
    v_kpi_soft_deleted_count,
    v_metric_inserted_count,
    v_metric_soft_deleted_count;
END;
$$;

COMMENT ON FUNCTION public.replace_exec_kpi_snapshot_run(uuid, date, jsonb, jsonb)
  IS 'Atomically soft-deletes active executive KPI snapshots and normalized metric snapshots for a run, then inserts replacements.';

REVOKE ALL ON FUNCTION public.replace_exec_kpi_snapshot_run(uuid, date, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_exec_kpi_snapshot_run(uuid, date, jsonb, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_exec_kpi_snapshot_run(uuid, date, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_exec_kpi_snapshot_run(uuid, date, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
