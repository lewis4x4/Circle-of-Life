-- Allow clinical staff to INSERT care_plan_review_alerts when triggered from in-app workflows
-- (e.g. assessment threshold after save). Aligns with assessments INSERT roles.
-- Alerts created by Edge Functions / cron continue to use service_role (bypasses RLS).

CREATE POLICY clinical_staff_insert_care_plan_review_alerts ON care_plan_review_alerts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver'
    )
    AND EXISTS (
      SELECT
        1
      FROM
        care_plans cp
      WHERE
        cp.id = care_plan_id
        AND cp.organization_id = organization_id
        AND cp.resident_id = resident_id
        AND cp.facility_id = facility_id
        AND cp.deleted_at IS NULL));
