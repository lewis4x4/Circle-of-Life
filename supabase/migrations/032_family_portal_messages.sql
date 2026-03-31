-- Phase 1 family ↔ care team messaging (minimal thread = resident + facility)

CREATE TYPE family_message_author AS ENUM ('family', 'staff');

CREATE TABLE family_portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  author_user_id uuid NOT NULL REFERENCES auth.users (id),
  author_kind family_message_author NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_family_portal_messages_resident_created ON family_portal_messages (resident_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_family_portal_messages_facility_created ON family_portal_messages (facility_id, created_at DESC)
WHERE
  deleted_at IS NULL;

ALTER TABLE family_portal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_read_messages_for_linked_residents ON family_portal_messages
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND EXISTS (
      SELECT
        1
      FROM
        public.family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = family_portal_messages.resident_id
        AND frl.revoked_at IS NULL));

CREATE POLICY family_send_messages_for_linked_residents ON family_portal_messages
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () = 'family'
    AND author_user_id = auth.uid ()
    AND author_kind = 'family'
    AND EXISTS (
      SELECT
        1
      FROM
        public.family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = family_portal_messages.resident_id
        AND frl.revoked_at IS NULL));

CREATE POLICY staff_read_family_portal_messages ON family_portal_messages
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE POLICY staff_send_family_portal_messages ON family_portal_messages
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND author_user_id = auth.uid ()
    AND author_kind = 'staff'
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
    AND EXISTS (
      SELECT
        1
      FROM
        public.residents r
      WHERE
        r.id = family_portal_messages.resident_id
        AND r.facility_id = family_portal_messages.facility_id
        AND r.organization_id = family_portal_messages.organization_id
        AND r.deleted_at IS NULL));

CREATE TRIGGER tr_family_portal_messages_set_updated_at
  BEFORE UPDATE ON family_portal_messages
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_family_portal_messages_audit
  AFTER INSERT OR UPDATE OR DELETE ON family_portal_messages
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
