-- COL-291: one authority for drill logs at the database.
--
-- Two authorities governed a drill log and they disagreed. The operations route
-- gate, haven.operation_facility_access (348), honours
-- user_facility_access.operation_expires_at and the operations role list. The
-- 220 row-level policy on public.drill_log reads haven.accessible_facility_ids()
-- (redefined by 326), which checks only revoked_at and admits owner/org_admin
-- org-wide without a grant row. An expired operations grant was therefore
-- refused by GET /api/admin/operations/drill-logs and admitted by any session
-- read that skipped the gate — a server component, a direct query, or the
-- legacy emergency-preparedness form.
--
-- Ruling (docs/specs/27-facility-operations-authority.md, "Ruling — COL-291"):
-- a drill log is an operations record, so the operations authority governs it
-- at the database, not only at the route. This follows the 348 pattern already
-- applied to facility_assets, staffing_adequacy_snapshots and
-- risk_score_snapshots: a RESTRICTIVE policy that ANDs the gate onto the
-- existing 220 policy. haven.accessible_facility_ids() itself is unchanged —
-- spec 27 says operation_expires_at "limits operations coverage without
-- changing unrelated domain access", and that function backs RLS across the
-- whole domain.
--
-- Effect: reading or writing a drill log now needs a current, unexpired site
-- grant in an operations role. Owners and org_admins need a grant row like
-- everyone else (spec 27: "No corporate site grants are synthesized"), which
-- is what the route already required. Roles outside the operations list
-- (caregiver, med_tech, family) lose drill_log entirely; none of them had a
-- surface that wrote one. Existing rows are untouched.
--
-- Proof: supabase/tests/review_hfo_drill_log_reader.sql section 5 now asserts
-- the expired grant reads nothing, and
-- supabase/tests/review_hfo_operations_reader_authority.sql asserts every
-- site-scoped table the operations routes read carries a gate policy.
--
-- Rollback: DROP POLICY operation_drill_log_current_scope ON public.drill_log;
-- reopens the divergence and must flip the probe back with it.
BEGIN;

CREATE POLICY operation_drill_log_current_scope ON public.drill_log AS RESTRICTIVE FOR ALL TO authenticated
 USING(haven.operation_facility_access(facility_id)) WITH CHECK(haven.operation_facility_access(facility_id));

COMMIT;
