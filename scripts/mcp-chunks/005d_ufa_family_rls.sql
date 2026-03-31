ALTER TABLE user_facility_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_facility_access_grants ON user_facility_access FOR SELECT USING (organization_id = haven.organization_id () AND (user_id = auth.uid () OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));
CREATE POLICY admins_manage_facility_access_grants ON user_facility_access FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));
ALTER TABLE family_resident_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_and_staff_see_resident_links ON family_resident_links FOR SELECT USING (organization_id = haven.organization_id () AND (user_id = auth.uid () OR haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')));
CREATE POLICY admins_manage_family_resident_links ON family_resident_links FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
