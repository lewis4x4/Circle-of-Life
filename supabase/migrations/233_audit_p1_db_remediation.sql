-- Migration 233: Post-build audit P1 — RLS remediation
--
-- 1. diet_orders: restore family + caregiver SELECT lost when migration 174
--    recreated the table (089 had both; 174 only staff policies).
-- 2. operation_audit_log: tighten INSERT so facility_id must be accessible and
--    belong to the caller's organization (parity with SELECT).

-- =============================================================================
-- diet_orders — family read (Module 21 / spec 14)
-- =============================================================================

CREATE POLICY diet_orders_select_family ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND active = true
    AND haven.app_role() = 'family'
    AND EXISTS (
      SELECT 1
      FROM public.family_resident_links frl
      WHERE frl.user_id = auth.uid()
        AND frl.resident_id = diet_orders.resident_id
        AND frl.revoked_at IS NULL
    )
  );

-- =============================================================================
-- diet_orders — caregiver read (parity with 089 diet_orders_select_staff)
-- =============================================================================

CREATE POLICY diet_orders_select_caregiver ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND active = true
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() = 'caregiver'
  );

-- =============================================================================
-- operation_audit_log — INSERT scoped like SELECT
-- =============================================================================

DROP POLICY IF EXISTS oal_insert ON public.operation_audit_log;

CREATE POLICY oal_insert ON public.operation_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
    AND (
      facility_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.facilities f
        WHERE f.id = facility_id
          AND f.organization_id = organization_id
      )
    )
  );

COMMENT ON POLICY diet_orders_select_family ON public.diet_orders IS
  'Family portal: active diet order for linked resident (restored after 174).';

COMMENT ON POLICY diet_orders_select_caregiver ON public.diet_orders IS
  'Caregiver shell: active diet orders in accessible facilities (restored after 174).';
