-- Family read-only calendar: activities + sessions at facilities where the user has a linked resident.
-- Also allow SELECT on those facilities (family is not in user_facility_access / accessible_facility_ids).

CREATE POLICY family_see_facilities_for_linked_residents ON facilities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND id IN (
      SELECT
        r.facility_id
      FROM
        public.residents r
        INNER JOIN public.family_resident_links frl ON frl.resident_id = r.id
      WHERE
        frl.user_id = auth.uid ()
        AND frl.revoked_at IS NULL
        AND r.deleted_at IS NULL));

CREATE POLICY family_see_activities_at_linked_facilities ON activities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND facility_id IN (
      SELECT
        r.facility_id
      FROM
        public.residents r
        INNER JOIN public.family_resident_links frl ON frl.resident_id = r.id
      WHERE
        frl.user_id = auth.uid ()
        AND frl.revoked_at IS NULL
        AND r.deleted_at IS NULL));

CREATE POLICY family_see_activity_sessions_at_linked_facilities ON activity_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND facility_id IN (
      SELECT
        r.facility_id
      FROM
        public.residents r
        INNER JOIN public.family_resident_links frl ON frl.resident_id = r.id
      WHERE
        frl.user_id = auth.uid ()
        AND frl.revoked_at IS NULL
        AND r.deleted_at IS NULL));
