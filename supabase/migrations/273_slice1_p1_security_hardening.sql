-- Slice 1 P1 hardening: DB/RLS/function security

CREATE OR REPLACE FUNCTION haven.has_facility_access(p_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT CASE
    WHEN haven.app_role() IN ('owner', 'org_admin') THEN EXISTS (
      SELECT 1
      FROM public.facilities f
      WHERE f.id = p_facility_id
        AND f.organization_id = haven.organization_id()
        AND f.deleted_at IS NULL
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.user_facility_access ufa
      JOIN public.facilities f ON f.id = ufa.facility_id
      WHERE ufa.user_id = auth.uid()
        AND ufa.facility_id = p_facility_id
        AND ufa.revoked_at IS NULL
        AND f.organization_id = haven.organization_id()
        AND f.deleted_at IS NULL
    )
  END
$func$;

CREATE OR REPLACE FUNCTION public.execute_compliance_rule(
  p_rule_id uuid,
  p_facility_id uuid
)
RETURNS TABLE (
  passed boolean,
  non_compliant_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_check_query text;
  v_result boolean;
  v_count integer;
  v_query text;
  v_org_id uuid;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := COALESCE(auth.role() = 'service_role', false);

  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT v_is_service_role AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  IF p_rule_id IS NULL OR p_facility_id IS NULL THEN
    RAISE EXCEPTION 'Rule ID and facility ID cannot be NULL' USING ERRCODE = '22004';
  END IF;

  IF NOT v_is_service_role AND NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Facility access denied' USING ERRCODE = '42501';
  END IF;

  SELECT f.organization_id
  INTO v_org_id
  FROM public.facilities f
  WHERE f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org_id IS NULL OR (NOT v_is_service_role AND v_org_id <> haven.organization_id()) THEN
    RAISE EXCEPTION 'Invalid facility for organization' USING ERRCODE = '42501';
  END IF;

  SELECT cr.check_query INTO v_check_query
  FROM public.compliance_rules cr
  WHERE cr.id = p_rule_id
    AND cr.organization_id = v_org_id
    AND (cr.facility_id IS NULL OR cr.facility_id = p_facility_id)
    AND cr.deleted_at IS NULL
    AND cr.enabled = true;

  IF v_check_query IS NULL THEN
    RAISE EXCEPTION 'Rule not found or not enabled';
  END IF;

  v_query := replace(
    v_check_query,
    '(SELECT id FROM facilities LIMIT 1)',
    quote_literal(p_facility_id::text) || '::uuid'
  );

  BEGIN
    v_query := regexp_replace(v_query, 'SELECT COUNT\(\*\) = 0 FROM', 'SELECT COUNT(*) as count FROM');

    EXECUTE format('SELECT (count = 0) as passed, count as non_compliant_count FROM (%s) AS result', v_query)
      INTO v_result, v_count;
  EXCEPTION WHEN OTHERS THEN
    v_result := false;
    v_count := 0;
  END;

  RETURN QUERY SELECT v_result, v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_compliance_rule_status(
  p_rule_id uuid,
  p_facility_id uuid
)
RETURNS TABLE (
  rule_id uuid,
  tag_number text,
  tag_title text,
  rule_description text,
  severity text,
  enabled boolean,
  last_scan_at timestamptz,
  last_passed boolean,
  last_non_compliant_count integer,
  trend text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_org_id uuid;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := COALESCE(auth.role() = 'service_role', false);

  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT v_is_service_role AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  IF p_rule_id IS NULL OR p_facility_id IS NULL THEN
    RAISE EXCEPTION 'Rule ID and facility ID cannot be NULL' USING ERRCODE = '22004';
  END IF;

  IF NOT v_is_service_role AND NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Facility access denied' USING ERRCODE = '42501';
  END IF;

  SELECT f.organization_id
  INTO v_org_id
  FROM public.facilities f
  WHERE f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_org_id IS NULL OR (NOT v_is_service_role AND v_org_id <> haven.organization_id()) THEN
    RAISE EXCEPTION 'Invalid facility for organization' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    cr.id as rule_id,
    cr.tag_number,
    cr.tag_title,
    cr.rule_description,
    cr.severity,
    cr.enabled,
    MAX(cs.scanned_at) as last_scan_at,
    (SELECT csr.passed
     FROM public.compliance_scan_results csr
     JOIN public.compliance_scans cs2 ON csr.scan_id = cs2.id
     WHERE csr.rule_id = cr.id
       AND cs2.facility_id = p_facility_id
     ORDER BY cs2.scanned_at DESC
     LIMIT 1) as last_passed,
    (SELECT csr.non_compliant_count
     FROM public.compliance_scan_results csr
     JOIN public.compliance_scans cs2 ON csr.scan_id = cs2.id
     WHERE csr.rule_id = cr.id
       AND cs2.facility_id = p_facility_id
     ORDER BY cs2.scanned_at DESC
     LIMIT 1) as last_non_compliant_count,
    CASE
      WHEN (SELECT COUNT(*)
            FROM public.compliance_scan_results csr
            JOIN public.compliance_scans cs2 ON csr.scan_id = cs2.id
            WHERE csr.rule_id = cr.id
              AND cs2.facility_id = p_facility_id) < 2
      THEN 'unknown'
      WHEN (SELECT csr.passed
            FROM public.compliance_scan_results csr
            JOIN public.compliance_scans cs2 ON csr.scan_id = cs2.id
            WHERE csr.rule_id = cr.id
              AND cs2.facility_id = p_facility_id
            ORDER BY cs2.scanned_at DESC
            LIMIT 1) = true
      THEN 'stable'
      ELSE 'declining'
    END as trend
  FROM public.compliance_rules cr
  LEFT JOIN public.compliance_scans cs
    ON cs.facility_id = p_facility_id
   AND cs.organization_id = v_org_id
  WHERE cr.id = p_rule_id
    AND (cr.facility_id = p_facility_id OR cr.facility_id IS NULL)
    AND cr.organization_id = v_org_id
    AND cr.deleted_at IS NULL
  GROUP BY cr.id, cr.tag_number, cr.tag_title, cr.rule_description, cr.severity, cr.enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_compliance_rule(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_compliance_rule_status(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_compliance_rule(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_compliance_rule_status(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_compliance_rule(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_compliance_rule_status(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_compliance_rule_query_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role() = 'service_role', false) OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.check_query IS NOT NULL THEN
    RAISE EXCEPTION 'Compliance rule SQL is migration-owned and cannot be inserted by clients'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.check_query IS DISTINCT FROM OLD.check_query THEN
    RAISE EXCEPTION 'Compliance rule SQL is migration-owned and cannot be changed by clients'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_prevent_compliance_rule_query_mutation ON public.compliance_rules;
CREATE TRIGGER tr_prevent_compliance_rule_query_mutation
  BEFORE INSERT OR UPDATE OF check_query ON public.compliance_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_compliance_rule_query_mutation();

REVOKE ALL ON FUNCTION public.prevent_compliance_rule_query_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_plantation_wing_observation_plan(p_resident_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_org_id uuid;
  v_entity_id uuid;
  v_facility_id uuid;
  v_wing_name text;
  v_plan_id uuid;
  v_existing_plan_id uuid;
  v_times time[];
  v_time time;
  v_sort_order integer := 0;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := COALESCE(auth.role() = 'service_role', false);
  SELECT
    res.organization_id,
    fac.entity_id,
    res.facility_id,
    unit.name
  INTO v_org_id, v_entity_id, v_facility_id, v_wing_name
  FROM public.residents res
  JOIN public.beds bed ON bed.id = res.bed_id AND bed.deleted_at IS NULL
  JOIN public.rooms room ON room.id = bed.room_id AND room.deleted_at IS NULL
  JOIN public.units unit ON unit.id = room.unit_id AND unit.deleted_at IS NULL
  JOIN public.facilities fac ON fac.id = res.facility_id AND fac.deleted_at IS NULL
  WHERE res.id = p_resident_id
    AND res.deleted_at IS NULL
    AND fac.organization_id = '00000000-0000-0000-0000-000000000001'
    AND fac.name = 'Plantation ALF';

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'Resident % is not assigned to an active Plantation wing bed', p_resident_id
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT v_is_service_role AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin', 'nurse') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_service_role AND NOT haven.has_facility_access(v_facility_id) THEN
    RAISE EXCEPTION 'Facility access denied' USING ERRCODE = '42501';
  END IF;

  v_times := CASE v_wing_name
    WHEN 'Wing 1' THEN ARRAY['00:00'::time, '08:00'::time, '16:00'::time]
    WHEN 'Wing 2' THEN ARRAY['00:00'::time, '08:00'::time, '16:00'::time]
    WHEN 'Wing 3' THEN ARRAY['03:00'::time, '11:00'::time, '19:00'::time]
    WHEN 'Wing 4' THEN ARRAY['03:00'::time, '11:00'::time, '19:00'::time]
    WHEN 'Wing 5' THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    WHEN 'Wing 6' THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    ELSE NULL
  END;

  IF v_times IS NULL THEN
    RAISE EXCEPTION 'Unsupported Plantation wing % for resident %', v_wing_name, p_resident_id
      USING ERRCODE = '22023';
  END IF;

  SELECT id
    INTO v_existing_plan_id
  FROM public.resident_observation_plans
  WHERE resident_id = p_resident_id
    AND facility_id = v_facility_id
    AND status = 'active'::public.resident_observation_plan_status
    AND source_type = 'policy'::public.resident_observation_source_type
    AND rationale = 'COL Plantation ' || v_wing_name || ' default rounds'
    AND deleted_at IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_existing_plan_id IS NOT NULL THEN
    RETURN v_existing_plan_id;
  END IF;

  INSERT INTO public.resident_observation_plans (
    organization_id,
    entity_id,
    facility_id,
    resident_id,
    status,
    source_type,
    effective_from,
    rationale,
    created_by
  ) VALUES (
    v_org_id,
    v_entity_id,
    v_facility_id,
    p_resident_id,
    'active'::public.resident_observation_plan_status,
    'policy'::public.resident_observation_source_type,
    now(),
    'COL Plantation ' || v_wing_name || ' default rounds',
    auth.uid()
  )
  RETURNING id INTO v_plan_id;

  FOREACH v_time IN ARRAY v_times LOOP
    v_sort_order := v_sort_order + 1;

    INSERT INTO public.resident_observation_plan_rules (
      plan_id,
      organization_id,
      entity_id,
      facility_id,
      resident_id,
      interval_type,
      interval_minutes,
      daypart_start,
      daypart_end,
      days_of_week,
      grace_minutes,
      required_fields_schema,
      escalation_policy_key,
      sort_order,
      active
    ) VALUES (
      v_plan_id,
      v_org_id,
      v_entity_id,
      v_facility_id,
      p_resident_id,
      'daypart'::public.resident_observation_interval_type,
      NULL,
      v_time,
      v_time + interval '5 minutes',
      ARRAY[1,2,3,4,5,6,7],
      30,
      jsonb_build_object(
        'scheduled_time', to_char(v_time, 'HH24:MI'),
        'wing', v_wing_name,
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      ),
      'resident-assurance-standard',
      v_sort_order,
      true
    );
  END LOOP;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS storage_fd_delete ON storage.objects;
CREATE POLICY storage_fd_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'facility-documents'
  AND haven.app_role() IN ('owner', 'org_admin')
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND (storage.foldername(name))[1]::uuid IN (SELECT haven.accessible_facility_ids())
);

ALTER TABLE public.fl_statutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fl_statutes_select ON public.fl_statutes;
CREATE POLICY fl_statutes_select ON public.fl_statutes
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS fl_statutes_admin_insert ON public.fl_statutes;
CREATE POLICY fl_statutes_admin_insert ON public.fl_statutes
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS fl_statutes_admin_update ON public.fl_statutes;
CREATE POLICY fl_statutes_admin_update ON public.fl_statutes
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS fl_statutes_admin_delete ON public.fl_statutes;
CREATE POLICY fl_statutes_admin_delete ON public.fl_statutes
  FOR DELETE
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );
