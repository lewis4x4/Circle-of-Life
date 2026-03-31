-- RLS for staff management and scheduling (spec 11; helpers = haven.*)

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_see_staff_in_accessible_facilities ON staff
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY staff_see_own_record ON staff
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND user_id = auth.uid ());

CREATE POLICY admin_can_manage_staff ON staff
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE staff_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_see_staff_certifications ON staff_certifications
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY staff_see_own_certifications ON staff_certifications
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        staff s
      WHERE
        s.id = staff_certifications.staff_id
        AND s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY admin_manage_staff_certifications ON staff_certifications
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_published_schedules ON schedules
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (status = 'published'
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

CREATE POLICY admin_nurse_manage_schedules ON schedules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_shift_assignments ON shift_assignments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

CREATE POLICY admin_nurse_manage_shift_assignments ON shift_assignments
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE time_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_own_time_records ON time_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

CREATE POLICY staff_clock_in_out ON time_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY staff_update_own_open_time_records ON time_records
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

ALTER TABLE shift_swap_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_shift_swap_requests ON shift_swap_requests
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (requesting_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR covering_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
      OR status = 'pending'));

CREATE POLICY staff_create_shift_swap_requests ON shift_swap_requests
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND requesting_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL));

CREATE POLICY staff_update_shift_swap_requests ON shift_swap_requests
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (requesting_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR covering_staff_id IN (
      SELECT
        s.id
      FROM
        staff s
      WHERE
        s.user_id = auth.uid ()
        AND s.deleted_at IS NULL)
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE staffing_ratio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY admins_see_staffing_ratio_snapshots ON staffing_ratio_snapshots
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
