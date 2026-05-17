-- Migration 233: Post-build audit P1 — RLS remediation
--
-- Production schema note (2026-05-17):
--   The live `diet_orders` table uses the 089 schema (status enum,
--   allergy_constraints, deleted_at). Migration 174 was recorded as
--   applied but its DROP+rebuild of `diet_orders` never took effect,
--   so policies here align with 089's `deleted_at IS NULL` predicate,
--   not 174's `active = true`. See follow-up Track A drift-audit task.
--
-- Changes:
--   1. diet_orders: refresh family + caregiver SELECT policies with
--      explicit DROP IF EXISTS guards (089's family policy is already
--      live; this brings caregiver to parity and re-affirms family).
--   2. operation_audit_log: tighten INSERT so facility_id must be in
--      accessible facilities AND belong to caller's organization
--      (parity with SELECT). Closes a cross-tenant write hole where
--      the old WITH CHECK only required organization_id match.

-- =============================================================================
-- diet_orders — family read (Module 21 / spec 14)
-- =============================================================================

DROP POLICY IF EXISTS diet_orders_select_family ON public.diet_orders;

CREATE POLICY diet_orders_select_family ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
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

DROP POLICY IF EXISTS diet_orders_select_caregiver ON public.diet_orders;

CREATE POLICY diet_orders_select_caregiver ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
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
  'Family portal: non-deleted diet order for linked resident.';

COMMENT ON POLICY diet_orders_select_caregiver ON public.diet_orders IS
  'Caregiver shell: non-deleted diet orders in accessible facilities.';
