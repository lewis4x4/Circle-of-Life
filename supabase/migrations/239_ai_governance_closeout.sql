-- =============================================================================
-- KB-NEXT-03 — AI governance closeout
-- =============================================================================
--
-- Closes governance gaps surfaced by the KB-NEXT audit:
--   - KB infra #5: compliance_knowledge_repository has no RLS.
--   - Structured-data #2: ar_aging_facility_daily matview is queryable by any
--     authenticated user (RLS does not apply to materialized views).
--   - KB-NEXT-03 §D: per-org daily token budget for AI surfaces (defends
--     cost-blowout pre-mortem scenario 3).
--
-- Intentionally NOT changed in this migration:
--   - role_permissions SELECT USING (true): the audit suggested tightening to
--     `organization_id = haven.organization_id() OR organization_id IS NULL`,
--     but role_permissions is a *global RBAC matrix* (no organization_id
--     column — see 122_role_permissions_audit_log.sql lines 8-23). The
--     existing policy is correct for its design: every authenticated user can
--     read the role × feature × permission matrix to drive UI gating.
--
-- All write paths to ai_token_budgets are service_role only; the SECURITY
-- DEFINER helper `_ai_token_budget_check` resets daily usage at America/New_York
-- midnight and atomically reserves the requested cost when allowed.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. RLS on compliance_knowledge_repository (KB infra gap #5)
-- -----------------------------------------------------------------------------
-- The table was created in 136_kb_compliance_integration.sql but RLS was never
-- enabled. Without RLS, any authenticated user could read every tenant's
-- compliance KB rows via direct PostgREST queries.

ALTER TABLE public.compliance_knowledge_repository ENABLE ROW LEVEL SECURITY;

-- NOTE: app_role enum values (001_enum_types.sql:50-60) are:
-- owner, org_admin, facility_admin, nurse, caregiver, dietary,
-- maintenance_role, family, broker.
-- We map "clinical/admin tier" to owner + org_admin + facility_admin + nurse,
-- and "admin tier" to owner + org_admin + facility_admin.

DROP POLICY IF EXISTS compliance_kb_select ON public.compliance_knowledge_repository;
CREATE POLICY compliance_kb_select ON public.compliance_knowledge_repository
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  );

DROP POLICY IF EXISTS compliance_kb_insert ON public.compliance_knowledge_repository;
CREATE POLICY compliance_kb_insert ON public.compliance_knowledge_repository
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin','facility_admin')
  );

DROP POLICY IF EXISTS compliance_kb_update ON public.compliance_knowledge_repository;
CREATE POLICY compliance_kb_update ON public.compliance_knowledge_repository
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin','facility_admin')
  )
  WITH CHECK (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin','facility_admin')
  );

DROP POLICY IF EXISTS compliance_kb_delete ON public.compliance_knowledge_repository;
CREATE POLICY compliance_kb_delete ON public.compliance_knowledge_repository
  FOR DELETE
  TO authenticated
  USING (
    workspace_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  );

COMMENT ON POLICY compliance_kb_select ON public.compliance_knowledge_repository
  IS 'Compliance KB: read for clinical/admin tiers within the caller org.';
COMMENT ON POLICY compliance_kb_insert ON public.compliance_knowledge_repository
  IS 'Compliance KB: insert restricted to admin tier within the caller org.';
COMMENT ON POLICY compliance_kb_update ON public.compliance_knowledge_repository
  IS 'Compliance KB: update restricted to admin tier within the caller org.';
COMMENT ON POLICY compliance_kb_delete ON public.compliance_knowledge_repository
  IS 'Compliance KB: delete restricted to owner/org_admin within the caller org.';


-- -----------------------------------------------------------------------------
-- B. Wrap ar_aging_facility_daily matview safely (structured-data red-flag #2)
-- -----------------------------------------------------------------------------
-- Materialized views ignore RLS. The matview was reachable by anyone with
-- the `authenticated` role via direct PostgREST queries (`select * from
-- ar_aging_facility_daily`). Revoke it from authenticated and ship a safe
-- view that re-checks invoice access.

REVOKE SELECT ON TABLE public.ar_aging_facility_daily FROM authenticated;
REVOKE SELECT ON TABLE public.ar_aging_facility_daily FROM anon;

CREATE OR REPLACE VIEW public.vw_ar_aging_facility_daily_safe
WITH (security_invoker = true)
AS
SELECT *
FROM public.ar_aging_facility_daily
WHERE organization_id = haven.organization_id()
  AND facility_id IN (SELECT haven.accessible_facility_ids());

GRANT SELECT ON public.vw_ar_aging_facility_daily_safe TO authenticated;

COMMENT ON VIEW public.vw_ar_aging_facility_daily_safe IS
  'AR aging daily — RLS-safe wrapper around ar_aging_facility_daily. The matview itself is revoked from authenticated; query this view instead.';


-- -----------------------------------------------------------------------------
-- C. ai_token_budgets table (pre-mortem scenario 3: cost blowout)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_token_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
  daily_limit_usd numeric(10, 4) NOT NULL DEFAULT 50.0,
  soft_threshold_pct integer NOT NULL DEFAULT 80,
  daily_usage_usd numeric(10, 4) NOT NULL DEFAULT 0.0,
  reset_at timestamptz NOT NULL DEFAULT date_trunc('day', now() AT TIME ZONE 'America/New_York'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_token_budgets_limit_nonnegative CHECK (daily_limit_usd >= 0),
  CONSTRAINT ai_token_budgets_usage_nonnegative CHECK (daily_usage_usd >= 0),
  CONSTRAINT ai_token_budgets_soft_threshold_pct_range CHECK (soft_threshold_pct BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_ai_token_budgets_reset
  ON public.ai_token_budgets (organization_id, reset_at);

ALTER TABLE public.ai_token_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_token_budgets_select ON public.ai_token_budgets;
CREATE POLICY ai_token_budgets_select ON public.ai_token_budgets
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
  );
-- No INSERT/UPDATE/DELETE policies: writes are service-role only via the
-- haven-ai-router and the _ai_token_budget_check helper below.

DROP TRIGGER IF EXISTS tr_ai_token_budgets_set_updated_at ON public.ai_token_budgets;
CREATE TRIGGER tr_ai_token_budgets_set_updated_at
  BEFORE UPDATE ON public.ai_token_budgets
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- Backfill one row per active organization.
INSERT INTO public.ai_token_budgets (organization_id)
SELECT o.id FROM public.organizations o WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id) DO NOTHING;

COMMENT ON TABLE public.ai_token_budgets IS
  'Per-org daily LLM token spend cap. Router enforces via _ai_token_budget_check.';


-- -----------------------------------------------------------------------------
-- D. SECURITY DEFINER helper: _ai_token_budget_check
-- -----------------------------------------------------------------------------
-- Resets daily_usage_usd when crossing America/New_York midnight, then atomically
-- reserves p_cost_usd by incrementing daily_usage_usd if and only if the post-
-- increment value would not exceed daily_limit_usd. Returns a JSON receipt so
-- the router can decide whether to call the model and whether to alert.

CREATE OR REPLACE FUNCTION public._ai_token_budget_check(
  p_organization_id uuid,
  p_cost_usd numeric DEFAULT 0.0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'America/New_York');
  v_limit numeric;
  v_usage numeric;
  v_soft_pct integer;
  v_post numeric;
  v_allowed boolean;
  v_soft boolean;
BEGIN
  -- Ensure a row exists for this org (defensive — backfill ran above, but new
  -- orgs created after this migration won't have one until first invocation).
  INSERT INTO public.ai_token_budgets (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- Lock the row and reset if we've crossed the daily boundary.
  SELECT daily_limit_usd, daily_usage_usd, soft_threshold_pct
    INTO v_limit, v_usage, v_soft_pct
    FROM public.ai_token_budgets
   WHERE organization_id = p_organization_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'soft_alert', false, 'remaining_usd', 50.0, 'daily_limit', 50.0, 'daily_usage', 0.0);
  END IF;

  IF v_today_start > (
    SELECT reset_at FROM public.ai_token_budgets WHERE organization_id = p_organization_id
  ) THEN
    UPDATE public.ai_token_budgets
       SET daily_usage_usd = 0.0,
           reset_at = v_today_start
     WHERE organization_id = p_organization_id;
    v_usage := 0.0;
  END IF;

  v_post := v_usage + GREATEST(0.0, COALESCE(p_cost_usd, 0.0));
  v_allowed := v_post <= v_limit;
  v_soft := v_post >= v_limit * (v_soft_pct::numeric / 100.0);

  IF v_allowed AND p_cost_usd > 0 THEN
    UPDATE public.ai_token_budgets
       SET daily_usage_usd = v_post
     WHERE organization_id = p_organization_id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'soft_alert', v_soft,
    'remaining_usd', GREATEST(0.0, v_limit - v_usage),
    'daily_limit', v_limit,
    'daily_usage', CASE WHEN v_allowed THEN v_post ELSE v_usage END
  );
END;
$func$;

REVOKE ALL ON FUNCTION public._ai_token_budget_check(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._ai_token_budget_check(uuid, numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_token_budget_check(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public._ai_token_budget_check(uuid, numeric) TO service_role;

COMMENT ON FUNCTION public._ai_token_budget_check(uuid, numeric) IS
  'Atomic per-org daily token budget check. Resets at America/New_York midnight.';
