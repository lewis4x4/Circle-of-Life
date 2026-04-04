-- Fix RLS gaps R-1 and R-2 from Phase 1 acceptance audit (2026-04-04)
--
-- R-1: assessments SELECT allows dietary/maintenance to read clinical data
-- R-2: resident_contacts SELECT allows dietary/maintenance to read PII
--
-- Both policies currently filter by org + facility + deleted_at but have
-- no role restriction, so non-clinical staff (dietary, maintenance) can
-- read sensitive clinical assessments and emergency contact information.

-- R-1: Restrict assessments SELECT to clinical + admin roles
DROP POLICY IF EXISTS staff_see_assessments ON assessments;

CREATE POLICY staff_see_assessments ON assessments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'dietary', 'maintenance_role'));

-- R-2: Restrict resident_contacts SELECT to clinical + admin roles
DROP POLICY IF EXISTS staff_see_resident_contacts ON resident_contacts;

CREATE POLICY staff_see_resident_contacts ON resident_contacts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'dietary', 'maintenance_role'));
