-- =============================================================================
-- KB-NEXT-02 — AI tool layer v1 (Tier-1 SECURITY DEFINER RPCs)
-- =============================================================================
--
-- These RPCs are the *only* sanctioned data path for the `haven-ai-router`
-- Edge Function (KB-NEXT-01). They exist because the router runs with the
-- Supabase service-role key, and the standard `haven.organization_id()` /
-- `haven.accessible_facility_ids()` helpers depend on `auth.uid()` — which
-- is NULL under service-role. Without these RPCs the router would either:
--   (a) bypass tenancy entirely (PHI leak risk — pre-mortem scenario 1), or
--   (b) re-implement RLS predicates ad-hoc in TypeScript (drift risk).
--
-- Security model for every RPC in this migration:
--   * SECURITY DEFINER (so service-role can call without auth.uid())
--   * SET search_path = public  (pattern from 006_audit_triggers.sql)
--   * STABLE                    (no writes)
--   * Caller context passed in as the first four parameters:
--       p_caller_organization_id uuid    — caller's tenant
--       p_caller_user_id         uuid    — caller's auth.users.id
--       p_caller_role            text    — caller's normalized app_role string
--       p_caller_facility_ids    uuid[]  — pre-resolved accessible facility ids
--     The router computes these once per request and passes them on every call.
--   * Body re-asserts `organization_id = p_caller_organization_id` on the
--     primary table; facility scopes via `p_caller_facility_ids` or via a
--     `p_facility_id` parameter that is itself checked against the array.
--   * `deleted_at IS NULL` everywhere.
--   * Role gate via public._ai_tool_role_allowed(p_caller_role, '<gate>');
--     raises `role_denied` (P0001) when the gate is not met.
--   * PHI-tier RPCs additionally check public._ai_tool_phi_allowed(org);
--     raises `phi_blocked` (P0001) when the org's policy disallows PHI.
--   * GRANT EXECUTE only to service_role. REVOKE ALL from PUBLIC, authenticated,
--     anon — these RPCs MUST NOT be reachable from authenticated end-user JWTs.
--
-- Returns: every RPC returns `jsonb` so the router TS layer can dispatch
-- uniformly without per-RPC TypeScript wrappers.
--
-- Schema adaptations (where the spec column name differs from reality):
--   * residents has `advance_directive_on_file boolean` (not `advance_directive_flag`).
--     `room` is derived via beds → rooms.room_number.
--   * incidents has `category` (not `incident_type`) and no `title` column;
--     we emit `category` and a truncated `description` as `title`.
--   * incident_followups has `due_at timestamptz` (not `due_date`) and
--     `task_type` text; "open" = completed_at IS NULL.
--   * invoices uses `balance_due` (cents, integer) and `invoice_date date`.
--     We treat statuses NOT IN ('paid','void','written_off') with balance_due > 0
--     as the AR universe.
--   * facility_medicaid_providers uses `provider_name`, `provider_type`,
--     `active boolean`, `contract_start_date`, `contract_renewal_date`. We
--     surface `mco_name` ← provider_name, `provider_id` ← id, `status` ←
--     active, `contract_start` ← contract_start_date, `contract_end` ←
--     contract_renewal_date.
--   * resident_medications has `strength`+`form` (no single `dose`),
--     `prescriber_name` (not `ordered_by_name`), and `prn_reason text` (the
--     boolean is derived: prn_reason IS NOT NULL).
--   * No `next_survey_window` table exists; ai_tool_compliance_status returns
--     `null` for that field with a future-work note.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helper: role gate
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ai_tool_role_allowed(p_role text, p_gate text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT CASE p_gate
    WHEN 'any' THEN true
    WHEN 'staff' THEN p_role = ANY(ARRAY['caregiver','clinical','clinical_admin','administrator','org_admin','owner'])
    WHEN 'clinical' THEN p_role = ANY(ARRAY['clinical','clinical_admin','administrator','org_admin','owner'])
    WHEN 'admin' THEN p_role = ANY(ARRAY['administrator','clinical_admin','org_admin','owner'])
    WHEN 'family_or_clinical' THEN p_role = ANY(ARRAY['family','clinical','clinical_admin','administrator','org_admin','owner'])
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public._ai_tool_role_allowed(text, text) IS
  'Role-gate helper for AI tool RPCs. Gates: any, staff, clinical, admin, family_or_clinical.';


-- -----------------------------------------------------------------------------
-- Helper: PHI policy gate
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ai_tool_phi_allowed(p_organization_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT COALESCE((SELECT allow_phi FROM public.ai_invocation_policies WHERE organization_id = p_organization_id), false);
$$;

COMMENT ON FUNCTION public._ai_tool_phi_allowed(uuid) IS
  'PHI-gate helper for AI tool RPCs. Reads ai_invocation_policies.allow_phi for the caller org.';

REVOKE ALL ON FUNCTION public._ai_tool_role_allowed(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._ai_tool_role_allowed(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_tool_role_allowed(text, text) FROM anon;
REVOKE ALL ON FUNCTION public._ai_tool_phi_allowed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._ai_tool_phi_allowed(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_tool_phi_allowed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._ai_tool_role_allowed(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._ai_tool_phi_allowed(uuid) TO service_role;


-- =============================================================================
-- 1. ai_tool_facility_directory
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_facility_directory(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'any') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NOT NULL AND NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'entity_name', e.name,
      'administrator_name', COALESCE(
        f.administrator_name,
        (SELECT TRIM(CONCAT(s.first_name, ' ', s.last_name))
           FROM public.staff s
          WHERE s.facility_id = f.id
            AND s.organization_id = p_caller_organization_id
            AND s.staff_role = 'administrator'
            AND s.deleted_at IS NULL
          ORDER BY s.hire_date ASC NULLS LAST
          LIMIT 1)
      ),
      'assistant_administrator_name', (
        SELECT TRIM(CONCAT(s.first_name, ' ', s.last_name))
          FROM public.staff s
         WHERE s.facility_id = f.id
           AND s.organization_id = p_caller_organization_id
           AND s.staff_role = 'assistant_administrator'
           AND s.deleted_at IS NULL
         ORDER BY s.hire_date ASC NULLS LAST
         LIMIT 1
      ),
      'address', NULLIF(
        TRIM(BOTH ', ' FROM CONCAT_WS(', ',
          NULLIF(TRIM(f.address_line_1), ''),
          NULLIF(TRIM(f.city), ''),
          NULLIF(TRIM(CONCAT_WS(' ', f.state, f.zip)), '')
        )),
        ''
      ),
      'phone', NULLIF(TRIM(f.phone), ''),
      'email', NULLIF(TRIM(f.email), ''),
      'licensed_beds', f.total_licensed_beds,
      'medicaid_provider_count', (
        SELECT COUNT(*)::int
          FROM public.facility_medicaid_providers fmp
         WHERE fmp.facility_id = f.id
           AND fmp.organization_id = p_caller_organization_id
           AND fmp.deleted_at IS NULL
           AND fmp.active = true
      )
    ) AS row
    FROM public.facilities f
    LEFT JOIN public.entities e
      ON e.id = f.entity_id
      AND e.organization_id = p_caller_organization_id
      AND e.deleted_at IS NULL
    WHERE f.organization_id = p_caller_organization_id
      AND f.deleted_at IS NULL
      AND f.id = ANY(p_caller_facility_ids)
      AND (p_facility_id IS NULL OR f.id = p_facility_id)
    ORDER BY f.name
    LIMIT 30
  ) sub;

  RETURN jsonb_build_object('facilities', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_facility_directory(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: facility directory (administrators, address, Medicaid counts). Role gate: any. PHI tier: none.';

REVOKE ALL ON FUNCTION public.ai_tool_facility_directory(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_facility_directory(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_facility_directory(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_facility_directory(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 2. ai_tool_staff_directory
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_staff_directory(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid,
  p_role text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'staff') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- Emits public-safe identity + role columns ONLY. Never DOB, SSN, hourly_rate.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'first_name', s.first_name,
      'last_name', s.last_name,
      'staff_role', s.staff_role::text,
      'hire_date', s.hire_date,
      'termination_date', s.termination_date,
      'email', NULLIF(TRIM(s.email), ''),
      'phone', NULLIF(TRIM(s.phone), ''),
      'employment_status', s.employment_status::text
    ) AS row
    FROM public.staff s
    WHERE s.organization_id = p_caller_organization_id
      AND s.facility_id = p_facility_id
      AND s.deleted_at IS NULL
      AND (p_role IS NULL OR s.staff_role::text = p_role)
    ORDER BY s.last_name, s.first_name
    LIMIT 200
  ) sub;

  RETURN jsonb_build_object('staff', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_staff_directory(uuid, uuid, text, uuid[], uuid, text) IS
  'AI tool: staff roster for a facility. Excludes DOB/SSN/hourly_rate. Role gate: staff. PHI tier: limited.';

REVOKE ALL ON FUNCTION public.ai_tool_staff_directory(uuid, uuid, text, uuid[], uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_staff_directory(uuid, uuid, text, uuid[], uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_staff_directory(uuid, uuid, text, uuid[], uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_staff_directory(uuid, uuid, text, uuid[], uuid, text) TO service_role;


-- =============================================================================
-- 3. ai_tool_org_chart
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_org_chart(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_org jsonb;
  v_entities jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'any') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object('id', o.id, 'name', o.name)
    INTO v_org
  FROM public.organizations o
  WHERE o.id = p_caller_organization_id
    AND o.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('organization', NULL, 'entities', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(ent), '[]'::jsonb)
    INTO v_entities
  FROM (
    SELECT jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'facilities', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', f.id,
          'name', f.name,
          'administrator_name', f.administrator_name
        )), '[]'::jsonb)
        FROM public.facilities f
        WHERE f.entity_id = e.id
          AND f.organization_id = p_caller_organization_id
          AND f.deleted_at IS NULL
          AND f.id = ANY(p_caller_facility_ids)
      )
    ) AS ent
    FROM public.entities e
    WHERE e.organization_id = p_caller_organization_id
      AND e.deleted_at IS NULL
    ORDER BY e.name
  ) sub;

  RETURN jsonb_build_object('organization', v_org, 'entities', v_entities);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_org_chart(uuid, uuid, text, uuid[]) IS
  'AI tool: organization → entities → facilities tree (administrator names only). Role gate: any. PHI tier: none.';

REVOKE ALL ON FUNCTION public.ai_tool_org_chart(uuid, uuid, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_org_chart(uuid, uuid, text, uuid[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_org_chart(uuid, uuid, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_org_chart(uuid, uuid, text, uuid[]) TO service_role;


-- =============================================================================
-- 4. ai_tool_resident_summary  (PHI-tier)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_resident_summary(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_resident_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'family_or_clinical') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._ai_tool_phi_allowed(p_caller_organization_id) THEN
    RAISE EXCEPTION 'phi_blocked' USING ERRCODE = 'P0001';
  END IF;

  IF p_caller_role = 'family' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.family_resident_links frl
       WHERE frl.user_id = p_caller_user_id
         AND frl.resident_id = p_resident_id
         AND frl.organization_id = p_caller_organization_id
         AND frl.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'family_not_linked' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Emits only minimal identity, room (via bed→room), primary diagnosis,
  -- primary payer, advance-directive flag, and facility. Excludes DOB, SSN,
  -- full chart, allergies, contacts, etc.
  SELECT jsonb_build_object(
    'id', r.id,
    'first_name', r.first_name,
    'last_name', r.last_name,
    'room', (
      SELECT rm.room_number
        FROM public.beds b
        JOIN public.rooms rm
          ON rm.id = b.room_id
         AND rm.organization_id = p_caller_organization_id
         AND rm.facility_id = b.facility_id
         AND rm.deleted_at IS NULL
       WHERE b.id = r.bed_id
         AND b.organization_id = p_caller_organization_id
         AND b.facility_id = r.facility_id
         AND b.deleted_at IS NULL
       LIMIT 1
    ),
    'primary_diagnosis', NULLIF(TRIM(r.primary_diagnosis), ''),
    'primary_payer', r.primary_payer::text,
    'advance_directive_flag', r.advance_directive_on_file,
    'facility_id', r.facility_id,
    'facility_name', (
      SELECT f.name FROM public.facilities f
       WHERE f.id = r.facility_id
         AND f.organization_id = p_caller_organization_id
         AND f.deleted_at IS NULL
    )
  )
    INTO v_payload
  FROM public.residents r
  WHERE r.id = p_resident_id
    AND r.organization_id = p_caller_organization_id
    AND r.facility_id = ANY(p_caller_facility_ids)
    AND r.deleted_at IS NULL;

  RETURN jsonb_build_object('resident', v_payload);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_resident_summary(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: resident summary (minimal PHI). Role gate: family_or_clinical. PHI tier: phi. Family requires family_resident_links.';

REVOKE ALL ON FUNCTION public.ai_tool_resident_summary(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_resident_summary(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_resident_summary(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_resident_summary(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 5. ai_tool_med_orders  (PHI-tier)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_med_orders(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_resident_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'clinical') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._ai_tool_phi_allowed(p_caller_organization_id) THEN
    RAISE EXCEPTION 'phi_blocked' USING ERRCODE = 'P0001';
  END IF;

  -- Implicit resident scope: caller's facility must contain the resident.
  IF NOT EXISTS (
    SELECT 1 FROM public.residents r
     WHERE r.id = p_resident_id
       AND r.organization_id = p_caller_organization_id
       AND r.facility_id = ANY(p_caller_facility_ids)
       AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', m.id,
      'medication_name', m.medication_name,
      'dose', NULLIF(TRIM(CONCAT_WS(' ', m.strength, m.form)), ''),
      'route', m.route::text,
      'frequency', m.frequency::text,
      'prn', (m.prn_reason IS NOT NULL AND TRIM(m.prn_reason) <> ''),
      'indication', NULLIF(TRIM(m.indication), ''),
      'start_date', m.start_date,
      'end_date', m.end_date,
      'ordered_by_name', NULLIF(TRIM(m.prescriber_name), '')
    ) AS row
    FROM public.resident_medications m
    WHERE m.resident_id = p_resident_id
      AND m.organization_id = p_caller_organization_id
      AND m.facility_id = ANY(p_caller_facility_ids)
      AND m.deleted_at IS NULL
      AND m.status = 'active'
    ORDER BY m.start_date DESC NULLS LAST
    LIMIT 100
  ) sub;

  RETURN jsonb_build_object('medications', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_med_orders(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: active medication orders for a resident. Role gate: clinical. PHI tier: phi.';

REVOKE ALL ON FUNCTION public.ai_tool_med_orders(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_med_orders(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_med_orders(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_med_orders(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 6. ai_tool_incident_summary
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_incident_summary(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid,
  p_days integer DEFAULT 30
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_window integer := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_window);
  v_counts jsonb;
  v_recent jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'staff') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_object_agg(severity, cnt), '{}'::jsonb)
    INTO v_counts
  FROM (
    SELECT i.severity::text AS severity, COUNT(*)::int AS cnt
      FROM public.incidents i
     WHERE i.organization_id = p_caller_organization_id
       AND i.facility_id = p_facility_id
       AND i.deleted_at IS NULL
       AND i.occurred_at >= v_since
     GROUP BY i.severity
  ) g;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'id', i.id,
      'occurred_at', i.occurred_at,
      'severity', i.severity::text,
      'incident_type', i.category::text,
      'title', LEFT(COALESCE(NULLIF(TRIM(i.description), ''), i.category::text), 140)
    ) AS row
    FROM public.incidents i
    WHERE i.organization_id = p_caller_organization_id
      AND i.facility_id = p_facility_id
      AND i.deleted_at IS NULL
      AND i.occurred_at >= v_since
    ORDER BY i.occurred_at DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'window_days', v_window,
    'counts_by_severity', v_counts,
    'recent', v_recent
  );
END;
$$;

COMMENT ON FUNCTION public.ai_tool_incident_summary(uuid, uuid, text, uuid[], uuid, integer) IS
  'AI tool: incident counts by severity + 5 most recent within p_days. Role gate: staff. PHI tier: limited.';

REVOKE ALL ON FUNCTION public.ai_tool_incident_summary(uuid, uuid, text, uuid[], uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_incident_summary(uuid, uuid, text, uuid[], uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_incident_summary(uuid, uuid, text, uuid[], uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_incident_summary(uuid, uuid, text, uuid[], uuid, integer) TO service_role;


-- =============================================================================
-- 7. ai_tool_compliance_status
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_compliance_status(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_open jsonb;
  v_poc jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'admin') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_open
  FROM (
    SELECT jsonb_build_object(
      'id', d.id,
      'tag_number', d.tag_number,
      'tag_description', d.tag_description,
      'severity', d.severity,
      'scope', d.scope,
      'survey_date', d.survey_date,
      'survey_type', d.survey_type,
      'status', d.status,
      'follow_up_survey_date', d.follow_up_survey_date
    ) AS row
    FROM public.survey_deficiencies d
    WHERE d.organization_id = p_caller_organization_id
      AND d.facility_id = p_facility_id
      AND d.deleted_at IS NULL
      AND d.status NOT IN ('verified', 'corrected')
    ORDER BY d.survey_date DESC
    LIMIT 30
  ) sub;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_poc
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'deficiency_id', p.deficiency_id,
      'status', p.status,
      'submission_due_date', p.submission_due_date,
      'submitted_at', p.submitted_at,
      'completion_target_date', p.completion_target_date,
      'accepted_at', p.accepted_at,
      'responsible_party', p.responsible_party
    ) AS row
    FROM public.plans_of_correction p
    WHERE p.organization_id = p_caller_organization_id
      AND p.facility_id = p_facility_id
      AND p.deleted_at IS NULL
      AND p.status NOT IN ('rejected', 'revised')
    ORDER BY p.submission_due_date ASC
    LIMIT 30
  ) sub;

  -- next_survey_window: no canonical table tracking scheduled future surveys
  -- exists yet; surveys are recorded only after they occur via
  -- survey_visit_sessions. Surface null with a note for the model.
  RETURN jsonb_build_object(
    'open_deficiencies', v_open,
    'plan_of_correction_status', v_poc,
    'next_survey_window', NULL,
    'note', 'next_survey_window not modeled in schema as of migration 234'
  );
END;
$$;

COMMENT ON FUNCTION public.ai_tool_compliance_status(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: open survey deficiencies + active PoC status. Role gate: admin. PHI tier: none.';

REVOKE ALL ON FUNCTION public.ai_tool_compliance_status(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_compliance_status(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_compliance_status(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_compliance_status(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 8. ai_tool_ar_aging_by_facility
--    NOTE: reads invoices DIRECTLY. Does NOT read ar_aging_facility_daily.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_ar_aging_by_facility(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_current_cents bigint := 0;
  v_30_60_cents bigint := 0;
  v_60_90_cents bigint := 0;
  v_90_plus_cents bigint := 0;
  v_oldest_age integer;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'admin') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- Bucket open invoice balances by age. Reads invoices directly (red flag #2
  -- mitigation pending KB-NEXT-03 matview wrap).
  SELECT
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 0 AND 30 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) > 90 THEN i.balance_due ELSE 0 END), 0)
    INTO v_current_cents, v_30_60_cents, v_60_90_cents, v_90_plus_cents
  FROM public.invoices i
  WHERE i.organization_id = p_caller_organization_id
    AND i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.voided_at IS NULL
    AND i.status NOT IN ('paid', 'void', 'written_off')
    AND i.balance_due > 0;

  SELECT MAX(v_today - i.invoice_date)
    INTO v_oldest_age
  FROM public.invoices i
  WHERE i.organization_id = p_caller_organization_id
    AND i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.voided_at IS NULL
    AND i.status NOT IN ('paid', 'void', 'written_off')
    AND i.balance_due > 0;

  RETURN jsonb_build_object(
    'buckets', jsonb_build_object(
      'current_cents', v_current_cents,
      'days_30_60_cents', v_30_60_cents,
      'days_60_90_cents', v_60_90_cents,
      'days_90_plus_cents', v_90_plus_cents,
      'total_cents', v_current_cents + v_30_60_cents + v_60_90_cents + v_90_plus_cents
    ),
    'oldest_invoice_age_days', v_oldest_age
  );
END;
$$;

COMMENT ON FUNCTION public.ai_tool_ar_aging_by_facility(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: AR aging buckets for a facility. Reads invoices directly (NOT the ar_aging_facility_daily matview). Role gate: admin.';

REVOKE ALL ON FUNCTION public.ai_tool_ar_aging_by_facility(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_ar_aging_by_facility(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_ar_aging_by_facility(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_ar_aging_by_facility(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 9. ai_tool_facility_medicaid_providers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_facility_medicaid_providers(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'admin') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- Schema adaptation: provider_name → mco_name, id → provider_id,
  -- active boolean → status, contract_start_date → contract_start,
  -- contract_renewal_date → contract_end.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', fmp.id,
      'mco_name', fmp.provider_name,
      'provider_id', fmp.id,
      'provider_type', fmp.provider_type,
      'status', CASE WHEN fmp.active THEN 'active' ELSE 'inactive' END,
      'contract_start', fmp.contract_start_date,
      'contract_end', fmp.contract_renewal_date,
      'default_rate_cents', fmp.default_rate_cents,
      'rate_unit', fmp.rate_unit
    ) AS row
    FROM public.facility_medicaid_providers fmp
    WHERE fmp.organization_id = p_caller_organization_id
      AND fmp.facility_id = p_facility_id
      AND fmp.deleted_at IS NULL
    ORDER BY fmp.active DESC, fmp.provider_name ASC
    LIMIT 30
  ) sub;

  RETURN jsonb_build_object('providers', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_facility_medicaid_providers(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: facility Medicaid (MCO) provider enrollment list. Role gate: admin. PHI tier: none.';

REVOKE ALL ON FUNCTION public.ai_tool_facility_medicaid_providers(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_facility_medicaid_providers(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_facility_medicaid_providers(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_facility_medicaid_providers(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 10. ai_tool_active_alerts
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_active_alerts(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => 30);
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'staff') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NOT NULL AND NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'severity', a.severity::text,
      'title', a.title,
      'body', LEFT(COALESCE(a.body, ''), 240),
      'source_module', a.source_module::text,
      'facility_id', a.facility_id,
      'facility_name', (
        SELECT f.name FROM public.facilities f
         WHERE f.id = a.facility_id
           AND f.organization_id = p_caller_organization_id
           AND f.deleted_at IS NULL
      ),
      'created_at', a.created_at
    ) AS row
    FROM public.exec_alerts a
    WHERE a.organization_id = p_caller_organization_id
      AND a.deleted_at IS NULL
      AND a.resolved_at IS NULL
      AND a.created_at >= v_since
      AND (a.facility_id IS NULL OR a.facility_id = ANY(p_caller_facility_ids))
      AND (p_facility_id IS NULL OR a.facility_id = p_facility_id)
    ORDER BY a.created_at DESC
    LIMIT 20
  ) sub;

  RETURN jsonb_build_object('alerts', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_active_alerts(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: open exec_alerts in last 30 days. Role gate: staff. PHI tier: none.';

REVOKE ALL ON FUNCTION public.ai_tool_active_alerts(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_active_alerts(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_active_alerts(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_active_alerts(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 11. ai_tool_certifications_expiring
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_certifications_expiring(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid,
  p_days integer DEFAULT 30
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_window integer := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + v_window;
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'admin') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', sc.id,
      'staff_id', sc.staff_id,
      'staff_name', TRIM(CONCAT(s.first_name, ' ', s.last_name)),
      'certification_type', sc.certification_type,
      'certification_name', sc.certification_name,
      'expiration_date', sc.expiration_date,
      'days_until_expiry', (sc.expiration_date - v_today)::int
    ) AS row
    FROM public.staff_certifications sc
    JOIN public.staff s ON s.id = sc.staff_id
      AND s.organization_id = p_caller_organization_id
      AND s.deleted_at IS NULL
    WHERE sc.organization_id = p_caller_organization_id
      AND sc.facility_id = p_facility_id
      AND sc.deleted_at IS NULL
      AND sc.status = 'active'
      AND sc.expiration_date IS NOT NULL
      AND sc.expiration_date >= v_today
      AND sc.expiration_date <= v_horizon
    ORDER BY sc.expiration_date ASC
    LIMIT 100
  ) sub;

  RETURN jsonb_build_object('certifications', v_rows, 'window_days', v_window);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_certifications_expiring(uuid, uuid, text, uuid[], uuid, integer) IS
  'AI tool: staff certifications expiring within p_days at a facility. Role gate: admin. PHI tier: limited.';

REVOKE ALL ON FUNCTION public.ai_tool_certifications_expiring(uuid, uuid, text, uuid[], uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_certifications_expiring(uuid, uuid, text, uuid[], uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_certifications_expiring(uuid, uuid, text, uuid[], uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_certifications_expiring(uuid, uuid, text, uuid[], uuid, integer) TO service_role;


-- =============================================================================
-- 12. ai_tool_open_followups
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_open_followups(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'staff') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- Open + overdue incident follow-ups. "Open" = completed_at IS NULL; the
  -- table has no `status` column. "Overdue" = due_at < now().
  -- assigned_to references auth.users; we look up the display name via
  -- public.user_profiles (full_name) to avoid touching auth schema directly.
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', f.id,
      'incident_id', f.incident_id,
      'task_type', f.task_type,
      'description', LEFT(COALESCE(f.description, ''), 240),
      'due_date', f.due_at,
      'days_overdue', GREATEST(0, EXTRACT(DAY FROM (now() - f.due_at))::int),
      'assigned_to_name', (
        SELECT up.full_name FROM public.user_profiles up
         WHERE up.id = f.assigned_to
           AND up.organization_id = p_caller_organization_id
           AND up.deleted_at IS NULL
         LIMIT 1
      )
    ) AS row
    FROM public.incident_followups f
    WHERE f.organization_id = p_caller_organization_id
      AND f.facility_id = p_facility_id
      AND f.deleted_at IS NULL
      AND f.completed_at IS NULL
      AND f.due_at < now()
    ORDER BY f.due_at ASC
    LIMIT 50
  ) sub;

  RETURN jsonb_build_object('followups', v_rows);
END;
$$;

COMMENT ON FUNCTION public.ai_tool_open_followups(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: overdue + open incident follow-ups for a facility. Role gate: staff. PHI tier: limited.';

REVOKE ALL ON FUNCTION public.ai_tool_open_followups(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_open_followups(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_open_followups(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_open_followups(uuid, uuid, text, uuid[], uuid) TO service_role;


-- =============================================================================
-- 13. ai_tool_pilot_facility_snapshot
--     Meta-tool: composes the same SQL the per-domain RPCs use, in one call.
--     Does NOT call other RPCs (avoids recursive SECURITY DEFINER chains).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_tool_pilot_facility_snapshot(
  p_caller_organization_id uuid,
  p_caller_user_id uuid,
  p_caller_role text,
  p_caller_facility_ids uuid[],
  p_facility_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + 30;
  v_since timestamptz := now() - make_interval(days => 30);
  v_facility jsonb;
  v_licensed integer;
  v_occupied integer;
  v_ar_total bigint := 0;
  v_ar_buckets jsonb;
  v_open_incidents integer;
  v_open_med_errors_mtd integer;
  v_open_deficiencies integer;
  v_certs_30d integer;
  v_outbreaks integer;
  v_alerts jsonb;
  v_current_cents bigint := 0;
  v_30_60_cents bigint := 0;
  v_60_90_cents bigint := 0;
  v_90_plus_cents bigint := 0;
  v_mtd_start date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  IF NOT public._ai_tool_role_allowed(p_caller_role, 'staff') THEN
    RAISE EXCEPTION 'role_denied' USING ERRCODE = 'P0001';
  END IF;

  IF p_facility_id IS NULL OR NOT (p_facility_id = ANY(p_caller_facility_ids)) THEN
    RAISE EXCEPTION 'facility_access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'id', f.id,
    'name', f.name,
    'entity_name', e.name,
    'licensed_beds', f.total_licensed_beds,
    'administrator_name', f.administrator_name,
    'city', f.city,
    'state', f.state
  )
    INTO v_facility
  FROM public.facilities f
  LEFT JOIN public.entities e
    ON e.id = f.entity_id
    AND e.organization_id = p_caller_organization_id
    AND e.deleted_at IS NULL
  WHERE f.id = p_facility_id
    AND f.organization_id = p_caller_organization_id
    AND f.deleted_at IS NULL;

  v_licensed := COALESCE((v_facility ->> 'licensed_beds')::int, 0);

  SELECT COUNT(*)::int
    INTO v_occupied
  FROM public.residents r
  WHERE r.organization_id = p_caller_organization_id
    AND r.facility_id = p_facility_id
    AND r.deleted_at IS NULL
    AND r.status IN ('active', 'hospital_hold', 'loa');

  SELECT
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 0 AND 30 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (v_today - i.invoice_date) > 90 THEN i.balance_due ELSE 0 END), 0)
    INTO v_current_cents, v_30_60_cents, v_60_90_cents, v_90_plus_cents
  FROM public.invoices i
  WHERE i.organization_id = p_caller_organization_id
    AND i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.voided_at IS NULL
    AND i.status NOT IN ('paid', 'void', 'written_off')
    AND i.balance_due > 0;

  v_ar_total := v_current_cents + v_30_60_cents + v_60_90_cents + v_90_plus_cents;
  v_ar_buckets := jsonb_build_object(
    'current_cents', v_current_cents,
    'days_30_60_cents', v_30_60_cents,
    'days_60_90_cents', v_60_90_cents,
    'days_90_plus_cents', v_90_plus_cents,
    'total_cents', v_ar_total
  );

  SELECT COUNT(*)::int
    INTO v_open_incidents
  FROM public.incidents i
  WHERE i.organization_id = p_caller_organization_id
    AND i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.status IN ('open', 'investigating');

  SELECT COUNT(*)::int
    INTO v_open_med_errors_mtd
  FROM public.medication_errors me
  WHERE me.organization_id = p_caller_organization_id
    AND me.facility_id = p_facility_id
    AND me.deleted_at IS NULL
    AND me.occurred_at >= v_mtd_start::timestamptz;

  SELECT COUNT(*)::int
    INTO v_open_deficiencies
  FROM public.survey_deficiencies d
  WHERE d.organization_id = p_caller_organization_id
    AND d.facility_id = p_facility_id
    AND d.deleted_at IS NULL
    AND d.status IN ('open', 'poc_submitted', 'poc_accepted', 'recited');

  SELECT COUNT(*)::int
    INTO v_certs_30d
  FROM public.staff_certifications sc
  WHERE sc.organization_id = p_caller_organization_id
    AND sc.facility_id = p_facility_id
    AND sc.deleted_at IS NULL
    AND sc.status = 'active'
    AND sc.expiration_date IS NOT NULL
    AND sc.expiration_date >= v_today
    AND sc.expiration_date <= v_horizon;

  SELECT COUNT(*)::int
    INTO v_outbreaks
  FROM public.infection_outbreaks io
  WHERE io.organization_id = p_caller_organization_id
    AND io.facility_id = p_facility_id
    AND io.deleted_at IS NULL
    AND io.resolved_at IS NULL;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb)
    INTO v_alerts
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'severity', a.severity::text,
      'title', a.title,
      'created_at', a.created_at
    ) AS row
    FROM public.exec_alerts a
    WHERE a.organization_id = p_caller_organization_id
      AND a.deleted_at IS NULL
      AND a.resolved_at IS NULL
      AND a.created_at >= v_since
      AND (a.facility_id = p_facility_id OR a.facility_id IS NULL)
    ORDER BY a.created_at DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'facility', v_facility,
    'occupancy', jsonb_build_object(
      'licensed_beds', v_licensed,
      'occupied_residents', v_occupied,
      'occupancy_pct', CASE WHEN v_licensed > 0
        THEN round((v_occupied::numeric / v_licensed) * 1000) / 10
        ELSE NULL
      END
    ),
    'ar', v_ar_buckets,
    'open_incidents', v_open_incidents,
    'open_med_errors_mtd', v_open_med_errors_mtd,
    'open_survey_deficiencies', v_open_deficiencies,
    'certifications_expiring_30d', v_certs_30d,
    'active_outbreaks', v_outbreaks,
    'recent_alerts', v_alerts
  );
END;
$$;

COMMENT ON FUNCTION public.ai_tool_pilot_facility_snapshot(uuid, uuid, text, uuid[], uuid) IS
  'AI tool: one-page facility snapshot (occupancy, AR, incidents, compliance, certs, outbreaks, alerts). Role gate: staff. PHI tier: limited.';

REVOKE ALL ON FUNCTION public.ai_tool_pilot_facility_snapshot(uuid, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tool_pilot_facility_snapshot(uuid, uuid, text, uuid[], uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_tool_pilot_facility_snapshot(uuid, uuid, text, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_pilot_facility_snapshot(uuid, uuid, text, uuid[], uuid) TO service_role;
