-- RLS for incident and risk management (spec 07; helpers = haven.*)

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_incidents_in_accessible_facilities ON incidents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'dietary', 'maintenance_role'));

CREATE POLICY family_see_incidents_for_linked_residents ON incidents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND resident_id IS NOT NULL
    AND haven.can_access_resident (resident_id));

CREATE POLICY caregivers_plus_create_incidents ON incidents
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY reporter_or_nurse_plus_update_incidents ON incidents
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (reported_by = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE incident_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_incident_followups ON incident_followups
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY clinical_staff_manage_incident_followups ON incident_followups
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE incident_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_incident_photos ON incident_photos
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'dietary', 'maintenance_role'));

CREATE POLICY caregivers_plus_insert_incident_photos ON incident_photos
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE incident_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_staff_see_incident_sequences ON incident_sequences
  FOR SELECT
  USING (
    facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        facilities f
      WHERE
        f.id = incident_sequences.facility_id
        AND f.organization_id = haven.organization_id ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_staff_manage_incident_sequences ON incident_sequences
  FOR ALL
  USING (
    facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        facilities f
      WHERE
        f.id = incident_sequences.facility_id
        AND f.organization_id = haven.organization_id ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
