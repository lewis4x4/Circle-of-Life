-- RLS for resident profile module (spec 03; helpers = haven.*)
-- assessment_templates: global reference rows — readable by authenticated, no tenant column

ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read_assessment_templates ON assessment_templates
  FOR SELECT TO authenticated
  USING (TRUE);

ALTER TABLE residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_residents_in_accessible_facilities ON residents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      (haven.app_role () != 'family'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
      OR (haven.app_role () = 'family'
        AND haven.can_access_resident (id))));

CREATE POLICY clinical_staff_insert_residents ON residents
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY clinical_staff_update_residents ON residents
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_care_plans_in_accessible_facilities ON care_plans
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () != 'family');

CREATE POLICY family_see_care_plans_for_linked_residents ON care_plans
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND haven.can_access_resident (resident_id));

CREATE POLICY nurse_plus_manage_care_plans ON care_plans
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE care_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_care_plan_items ON care_plan_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () != 'family');

CREATE POLICY family_see_care_plan_items_for_linked_residents ON care_plan_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND haven.can_access_resident (resident_id));

CREATE POLICY nurse_plus_manage_care_plan_items ON care_plan_items
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_assessments ON assessments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY clinical_staff_insert_assessments ON assessments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY clinical_staff_update_assessments ON assessments
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE resident_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_resident_photos ON resident_photos
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'dietary', 'maintenance_role'));

CREATE POLICY nurse_caregiver_insert_resident_photos ON resident_photos
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY nurse_caregiver_update_resident_photos ON resident_photos
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE resident_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_resident_contacts ON resident_contacts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY nurse_admin_manage_resident_contacts ON resident_contacts
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE resident_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_resident_documents ON resident_documents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('dietary', 'maintenance_role'));

CREATE POLICY nurse_admin_insert_resident_documents ON resident_documents
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY nurse_admin_update_resident_documents ON resident_documents
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
