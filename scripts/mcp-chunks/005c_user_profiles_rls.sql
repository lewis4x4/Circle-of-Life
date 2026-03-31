ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_own_profile_row ON user_profiles FOR SELECT USING (id = auth.uid ());
CREATE POLICY users_see_profiles_in_their_organization ON user_profiles FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL);
CREATE POLICY users_update_own_profile ON user_profiles FOR UPDATE USING (id = auth.uid ());
CREATE POLICY owner_org_admin_manage_profiles ON user_profiles FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin'));
