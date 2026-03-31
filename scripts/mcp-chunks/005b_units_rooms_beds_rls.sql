ALTER TABLE units ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_units_in_accessible_facilities ON units FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids ()));
CREATE POLICY owner_org_admin_manage_units ON units FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin') AND facility_id IN (SELECT haven.accessible_facility_ids ()));
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_rooms_in_accessible_facilities ON rooms FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids ()));
CREATE POLICY owner_org_admin_manage_rooms ON rooms FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin') AND facility_id IN (SELECT haven.accessible_facility_ids ()));
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_see_beds_in_accessible_facilities ON beds FOR SELECT USING (organization_id = haven.organization_id () AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids ()));
CREATE POLICY owner_org_admin_manage_beds ON beds FOR ALL USING (organization_id = haven.organization_id () AND haven.app_role () IN ('owner', 'org_admin') AND facility_id IN (SELECT haven.accessible_facility_ids ()));
