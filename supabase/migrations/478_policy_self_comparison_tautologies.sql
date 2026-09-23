-- COL-680: four INSERT policies compared a column with itself.
--
-- Each was written with unqualified column names inside an EXISTS subquery
-- (`cp.organization_id = organization_id`). Postgres resolves the bare name to
-- the nearest scope, the subquery's own table, so the check read
-- `cp.organization_id = cp.organization_id`: always true. Migration 468 restated
-- them verbatim from pg_policies, which made the tautology visible. Effects:
--   * time_records: an administrator could key a punch for a staff id from
--     another organization or building (payroll reads these rows);
--   * care_plan_acknowledgements / care_plan_review_alerts: a row could name a
--     care plan from another organization, building or resident;
--   * operation_audit_log: a row could name another organization's building.
-- Production had zero rows in all four tables on 2026-09-23, so nothing written
-- under the tautology needs repair.
--
-- time_records also drops med_tech from the administrators' manual-punch
-- policy: Brian's COL-627 ruling withdrew staff data from med-techs, and
-- migration 475's restrictive policy already confines them to their own rows,
-- which staff_clock_in_out covers.
--
-- supabase/tests/review_policy_self_comparisons.sql fails the replay on any
-- public policy that compares a column with itself.
BEGIN;

ALTER POLICY admin_insert_time_records ON public.time_records
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = time_records.staff_id
        AND s.organization_id = time_records.organization_id
        AND s.facility_id = time_records.facility_id
        AND s.deleted_at IS NULL
    )
  );

ALTER POLICY clinical_staff_record_care_plan_acknowledgements ON public.care_plan_acknowledgements
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'med_tech')
    AND recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.care_plans cp
      WHERE cp.id = care_plan_acknowledgements.care_plan_id
        AND cp.organization_id = care_plan_acknowledgements.organization_id
        AND cp.facility_id = care_plan_acknowledgements.facility_id
        AND cp.resident_id = care_plan_acknowledgements.resident_id
        AND cp.status = 'active'
        AND cp.deleted_at IS NULL
    )
  );

ALTER POLICY clinical_staff_insert_care_plan_review_alerts ON public.care_plan_review_alerts
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'med_tech')
    AND EXISTS (
      SELECT 1 FROM public.care_plans cp
      WHERE cp.id = care_plan_review_alerts.care_plan_id
        AND cp.organization_id = care_plan_review_alerts.organization_id
        AND cp.resident_id = care_plan_review_alerts.resident_id
        AND cp.facility_id = care_plan_review_alerts.facility_id
        AND cp.deleted_at IS NULL
    )
  );

ALTER POLICY oal_insert ON public.operation_audit_log
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND (
      facility_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.facilities f
        WHERE f.id = operation_audit_log.facility_id
          AND f.organization_id = operation_audit_log.organization_id
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
