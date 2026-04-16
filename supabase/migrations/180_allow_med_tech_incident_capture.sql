-- Allow med-tech users to capture medication-related incidents from the cockpit

DROP POLICY IF EXISTS caregivers_plus_create_incidents ON incidents;
CREATE POLICY caregivers_plus_create_incidents ON incidents
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver', 'med_tech'));

DROP POLICY IF EXISTS caregivers_plus_insert_incident_photos ON incident_photos;
CREATE POLICY caregivers_plus_insert_incident_photos ON incident_photos
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver', 'med_tech'));
