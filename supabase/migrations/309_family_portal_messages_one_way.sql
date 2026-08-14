-- Family Portal messages are one-way only (Haven → family).
-- COL owner decision 2026-08-14: families cannot create, reply to, or edit messages.

DROP POLICY IF EXISTS family_send_messages_for_linked_residents ON family_portal_messages;

DROP POLICY IF EXISTS staff_send_family_portal_messages ON family_portal_messages;

CREATE POLICY staff_send_family_portal_messages ON family_portal_messages
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND author_user_id = auth.uid ()
    AND author_kind = 'staff'
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'admin_assistant')
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
