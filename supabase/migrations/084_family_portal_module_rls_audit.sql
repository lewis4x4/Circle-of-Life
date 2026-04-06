-- Phase 5: Family Portal (spec 21-family-portal) — RLS + audit + updated_at

-- family_consent_records
ALTER TABLE family_consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_consent_records_select ON family_consent_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      (
        haven.app_role () = 'family'
        AND family_user_id = auth.uid ()
        AND EXISTS (
          SELECT
            1
          FROM
            public.family_resident_links frl
          WHERE
            frl.user_id = auth.uid ()
            AND frl.resident_id = family_consent_records.resident_id
            AND frl.revoked_at IS NULL))
      OR (
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))));

CREATE POLICY family_consent_records_insert_family ON family_consent_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'family'
    AND family_user_id = auth.uid ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = family_consent_records.resident_id
        AND frl.revoked_at IS NULL));

CREATE POLICY family_consent_records_insert_staff ON family_consent_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY family_consent_records_update_staff ON family_consent_records
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- family_message_triage_items (staff clinical queue only)
ALTER TABLE family_message_triage_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_message_triage_select_staff ON family_message_triage_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY family_message_triage_insert_staff ON family_message_triage_items
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY family_message_triage_update_staff ON family_message_triage_items
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- family_care_conference_sessions
ALTER TABLE family_care_conference_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_care_conference_select ON family_care_conference_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      (
        haven.app_role () = 'family'
        AND EXISTS (
          SELECT
            1
          FROM
            public.family_resident_links frl
          WHERE
            frl.user_id = auth.uid ()
            AND frl.resident_id = family_care_conference_sessions.resident_id
            AND frl.revoked_at IS NULL))
      OR (
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))));

CREATE POLICY family_care_conference_insert_staff ON family_care_conference_sessions
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY family_care_conference_update_staff ON family_care_conference_sessions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_family_consent_records_set_updated_at
  BEFORE UPDATE ON family_consent_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_family_consent_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON family_consent_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_family_message_triage_set_updated_at
  BEFORE UPDATE ON family_message_triage_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_family_message_triage_audit
  AFTER INSERT OR UPDATE OR DELETE ON family_message_triage_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_family_care_conference_set_updated_at
  BEFORE UPDATE ON family_care_conference_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_family_care_conference_audit
  AFTER INSERT OR UPDATE OR DELETE ON family_care_conference_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
