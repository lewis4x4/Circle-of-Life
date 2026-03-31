ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_their_own_organization ON organizations FOR SELECT USING (id = haven.organization_id ());
CREATE POLICY owners_can_update_organization ON organizations FOR UPDATE USING (id = haven.organization_id () AND haven.app_role () = 'owner');
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_entities_in_their_organization ON entities FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL);
CREATE POLICY owner_org_admin_manage_entities ON entities FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin'));
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_facilities_they_have_access_to ON facilities FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL AND id IN (SELECT haven.accessible_facility_ids ()));
CREATE POLICY owner_org_admin_manage_facilities ON facilities FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin'));
