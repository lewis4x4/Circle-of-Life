-- Row level security (spec 00-foundation; helpers = haven.*)
-- Policy names are unquoted identifiers for tooling / JSON-safe deploys.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_their_own_organization ON organizations
  FOR SELECT
  USING (id = haven.organization_id ());

CREATE POLICY owners_can_update_organization ON organizations
  FOR UPDATE
  USING (id = haven.organization_id ()
    AND haven.app_role () = 'owner');

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_entities_in_their_organization ON entities
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

CREATE POLICY owner_org_admin_manage_entities ON entities
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_facilities_they_have_access_to ON facilities
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY owner_org_admin_manage_facilities ON facilities
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_units_in_accessible_facilities ON units
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY owner_org_admin_manage_units ON units
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_rooms_in_accessible_facilities ON rooms
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY owner_org_admin_manage_rooms ON rooms
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_beds_in_accessible_facilities ON beds
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY owner_org_admin_manage_beds ON beds
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_own_profile_row ON user_profiles
  FOR SELECT
  USING (id = auth.uid ());

CREATE POLICY users_see_profiles_in_their_organization ON user_profiles
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

CREATE POLICY users_update_own_profile ON user_profiles
  FOR UPDATE
  USING (id = auth.uid ());

CREATE POLICY owner_org_admin_manage_profiles ON user_profiles
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE user_facility_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_facility_access_grants ON user_facility_access
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND (user_id = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

CREATE POLICY admins_manage_facility_access_grants ON user_facility_access
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE family_resident_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_and_staff_see_resident_links ON family_resident_links
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND (user_id = auth.uid ()
      OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

CREATE POLICY admins_manage_family_resident_links ON family_resident_links
  FOR ALL
  USING (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
