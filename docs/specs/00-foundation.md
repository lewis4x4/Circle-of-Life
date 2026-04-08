# 00 — Foundation: Multi-Tenant Schema, Auth, RBAC

## Supabase Project
- **Project URL:** https://manfqmasfqppukpobpld.supabase.co
- **Region:** Confirm us-east-1 (closest to North Florida)
- **Plan:** Must be Pro or above with signed BAA before any PHI enters

## Design Principles
1. Every table has RLS enabled. No exceptions.
2. Every table has `created_at`, `updated_at`, `created_by`, `updated_by` audit columns.
3. All timestamps are `timestamptz` stored in UTC. Frontend converts to America/New_York for display.
4. Soft deletes everywhere — `deleted_at timestamptz NULL`. No hard deletes of clinical or financial data.
5. UUIDs for all primary keys (`gen_random_uuid()`).
6. All text fields use `text` type (not `varchar`) unless there's a specific constraint reason.
7. Money stored as `integer` (cents) not `numeric` or `float`. $252,412.65 = 25241265 cents.
8. Enums defined as PostgreSQL enum types, not string columns.

---

## ENUM TYPES

```sql
-- Organization & Entity
CREATE TYPE org_status AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE entity_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE facility_status AS ENUM ('active', 'inactive', 'under_renovation', 'archived');

-- Beds & Rooms
CREATE TYPE bed_status AS ENUM ('available', 'occupied', 'hold', 'maintenance', 'offline');
CREATE TYPE room_type AS ENUM ('private', 'semi_private', 'shared');
CREATE TYPE bed_type AS ENUM ('alf_intermediate', 'memory_care', 'independent_living');

-- Residents
CREATE TYPE resident_status AS ENUM ('inquiry', 'pending_admission', 'active', 'hospital_hold', 'loa', 'discharged', 'deceased');
CREATE TYPE gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE payer_type AS ENUM ('private_pay', 'medicaid_oss', 'ltc_insurance', 'va_aid_attendance', 'other');
CREATE TYPE acuity_level AS ENUM ('level_1', 'level_2', 'level_3');
CREATE TYPE discharge_reason AS ENUM ('higher_level_of_care', 'hospital_permanent', 'another_alf', 'home', 'death', 'non_payment', 'behavioral', 'other');

-- Staff
CREATE TYPE staff_role AS ENUM ('cna', 'lpn', 'rn', 'administrator', 'activities_director', 'dietary_staff', 'dietary_manager', 'maintenance', 'housekeeping', 'driver', 'other');
CREATE TYPE employment_status AS ENUM ('active', 'on_leave', 'terminated', 'suspended');
CREATE TYPE shift_type AS ENUM ('day', 'evening', 'night', 'custom');

-- App Roles (for RBAC, not staff operational roles)
CREATE TYPE app_role AS ENUM ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver', 'dietary', 'maintenance_role', 'family', 'broker');

-- Incidents
CREATE TYPE incident_severity AS ENUM ('level_1', 'level_2', 'level_3', 'level_4');
CREATE TYPE incident_category AS ENUM (
  'fall_with_injury', 'fall_without_injury', 'fall_witnessed', 'fall_unwitnessed',
  'elopement', 'wandering',
  'medication_error', 'medication_refusal',
  'skin_integrity', 'pressure_injury', 'unexplained_bruise',
  'behavioral_resident_to_resident', 'behavioral_resident_to_staff', 'behavioral_self_harm',
  'abuse_allegation', 'neglect_allegation',
  'property_damage', 'property_loss',
  'environmental_fire', 'environmental_flood', 'environmental_power', 'environmental_pest',
  'infection',
  'other'
);
CREATE TYPE incident_status AS ENUM ('open', 'investigating', 'resolved', 'closed');

-- Care Plans
CREATE TYPE care_plan_status AS ENUM ('draft', 'active', 'under_review', 'archived');
CREATE TYPE care_plan_item_category AS ENUM (
  'mobility', 'bathing', 'dressing', 'grooming', 'toileting', 'eating',
  'medication_assistance', 'behavioral', 'fall_prevention', 'skin_integrity',
  'pain_management', 'cognitive', 'social', 'dietary', 'other'
);
CREATE TYPE assistance_level AS ENUM ('independent', 'supervision', 'limited_assist', 'extensive_assist', 'total_dependence');

-- Medications
CREATE TYPE medication_frequency AS ENUM ('daily', 'bid', 'tid', 'qid', 'qhs', 'qam', 'prn', 'weekly', 'biweekly', 'monthly', 'other');
CREATE TYPE medication_route AS ENUM ('oral', 'sublingual', 'topical', 'ophthalmic', 'otic', 'nasal', 'inhaled', 'rectal', 'transdermal', 'subcutaneous', 'intramuscular', 'other');
CREATE TYPE medication_status AS ENUM ('active', 'discontinued', 'on_hold', 'completed');
CREATE TYPE emar_status AS ENUM ('scheduled', 'given', 'refused', 'held', 'not_available', 'self_administered');
CREATE TYPE controlled_schedule AS ENUM ('ii', 'iii', 'iv', 'v', 'non_controlled');

-- Billing
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'partial', 'overdue', 'void', 'written_off');
CREATE TYPE payment_method AS ENUM ('check', 'ach', 'credit_card', 'cash', 'medicaid_payment', 'insurance_payment', 'other');

-- Certifications
CREATE TYPE certification_status AS ENUM ('active', 'expired', 'pending_renewal', 'revoked');

-- Schedule
CREATE TYPE schedule_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE shift_assignment_status AS ENUM ('assigned', 'confirmed', 'swap_requested', 'called_out', 'no_show', 'completed');
```

---

## CORE HIERARCHY TABLES

```sql
-- ============================================================
-- ORGANIZATIONS (top level — "Circle of Life Assisted Living Communities")
-- ============================================================
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  dba_name text,
  status org_status NOT NULL DEFAULT 'active',
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip text,
  timezone text NOT NULL DEFAULT 'America/New_York',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;

-- ============================================================
-- ENTITIES (legal entities — "Pine House, Inc.", "Smith & Sorensen LLC", etc.)
-- ============================================================
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,                          -- "Pine House, Inc."
  dba_name text,                               -- "Oakridge ALF"
  entity_type text,                            -- "LLC", "Inc.", "LLLC"
  fein text,                                   -- "59-3588292"
  status entity_status NOT NULL DEFAULT 'active',
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip text,
  years_ownership integer,
  years_management integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_entities_org ON entities(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entities_status ON entities(organization_id, status) WHERE deleted_at IS NULL;

-- ============================================================
-- FACILITIES (physical locations)
-- ============================================================
CREATE TABLE facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),  -- denormalized for RLS performance
  name text NOT NULL,                          -- "Oakridge ALF"
  license_number text,
  license_type bed_type NOT NULL DEFAULT 'alf_intermediate',
  status facility_status NOT NULL DEFAULT 'active',
  address_line_1 text NOT NULL,
  address_line_2 text,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'FL',
  zip text NOT NULL,
  county text,
  phone text,
  fax text,
  email text,
  administrator_name text,
  total_licensed_beds integer NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  settings jsonb NOT NULL DEFAULT '{}',        -- facility-specific config overrides
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_facilities_entity ON facilities(entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_facilities_org ON facilities(organization_id) WHERE deleted_at IS NULL;

-- ============================================================
-- UNITS (wings/halls within a facility)
-- ============================================================
CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,                          -- "Unit A", "East Wing", "Main Hall"
  floor_number integer DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_units_facility ON units(facility_id) WHERE deleted_at IS NULL;

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unit_id uuid REFERENCES units(id),
  room_number text NOT NULL,
  room_type room_type NOT NULL DEFAULT 'private',
  max_occupancy integer NOT NULL DEFAULT 1,
  floor_number integer DEFAULT 1,
  is_ada_accessible boolean NOT NULL DEFAULT false,
  near_nursing_station boolean NOT NULL DEFAULT false,
  has_bathroom boolean NOT NULL DEFAULT true,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_rooms_facility ON rooms(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_rooms_unit ON rooms(unit_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_rooms_number ON rooms(facility_id, room_number) WHERE deleted_at IS NULL;

-- ============================================================
-- BEDS
-- ============================================================
CREATE TABLE beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  bed_label text NOT NULL,                     -- "A", "B", or "1" for single rooms
  bed_type bed_type NOT NULL DEFAULT 'alf_intermediate',
  status bed_status NOT NULL DEFAULT 'available',
  current_resident_id uuid,                    -- FK added after residents table created
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_beds_room ON beds(room_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_beds_facility ON beds(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_beds_status ON beds(facility_id, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_beds_label ON beds(room_id, bed_label) WHERE deleted_at IS NULL;
```

---

## AUTH & RBAC

```sql
-- ============================================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  organization_id uuid REFERENCES organizations(id),  -- NULL for super admins
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  app_role app_role NOT NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_user_profiles_org ON user_profiles(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_profiles_role ON user_profiles(app_role) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_user_profiles_email ON user_profiles(email) WHERE deleted_at IS NULL;

-- ============================================================
-- USER FACILITY ACCESS (which facilities each user can access)
-- A user can access multiple facilities (float pool staff, org admins, owners)
-- ============================================================
CREATE TABLE user_facility_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  is_primary boolean NOT NULL DEFAULT false,    -- user's primary/home facility
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_ufa_user ON user_facility_access(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_ufa_facility ON user_facility_access(facility_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_ufa_unique ON user_facility_access(user_id, facility_id) WHERE revoked_at IS NULL;

-- ============================================================
-- FAMILY USER LINKS (family members linked to specific residents)
-- ============================================================
CREATE TABLE family_resident_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),       -- the family member's auth account
  resident_id uuid NOT NULL,                               -- FK added after residents table
  organization_id uuid NOT NULL REFERENCES organizations(id),
  relationship text NOT NULL,                              -- "daughter", "son", "spouse", "legal_guardian", "power_of_attorney"
  is_responsible_party boolean NOT NULL DEFAULT false,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  can_view_clinical boolean NOT NULL DEFAULT true,
  can_view_financial boolean NOT NULL DEFAULT false,
  can_make_decisions boolean NOT NULL DEFAULT false,        -- healthcare proxy / POA
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_frl_user ON family_resident_links(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_frl_resident ON family_resident_links(resident_id) WHERE revoked_at IS NULL;
```

---

## RLS HELPER FUNCTIONS

```sql
-- Get the current user's organization_id
CREATE OR REPLACE FUNCTION auth.organization_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT organization_id FROM user_profiles WHERE id = auth.uid()
$$;

-- Get the current user's app_role
CREATE OR REPLACE FUNCTION auth.app_role()
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT app_role FROM user_profiles WHERE id = auth.uid()
$$;

-- Check if user has access to a specific facility
CREATE OR REPLACE FUNCTION auth.has_facility_access(p_facility_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_facility_access
    WHERE user_id = auth.uid()
      AND facility_id = p_facility_id
      AND revoked_at IS NULL
  )
  OR auth.app_role() IN ('owner', 'org_admin')  -- owner/org_admin see all facilities in their org
$$;

-- Get all facility IDs the current user can access
CREATE OR REPLACE FUNCTION auth.accessible_facility_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- Owner and org_admin can access all facilities in their org
  SELECT f.id FROM facilities f
  WHERE f.organization_id = auth.organization_id()
    AND f.deleted_at IS NULL
    AND auth.app_role() IN ('owner', 'org_admin')
  UNION
  -- All other roles: only explicitly granted facilities
  SELECT ufa.facility_id FROM user_facility_access ufa
  WHERE ufa.user_id = auth.uid()
    AND ufa.revoked_at IS NULL
    AND auth.app_role() NOT IN ('owner', 'org_admin')
$$;

-- Check if a family user can access a specific resident
CREATE OR REPLACE FUNCTION auth.can_access_resident(p_resident_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    CASE
      -- Non-family roles: can access if they have facility access (resident's facility)
      WHEN auth.app_role() != 'family' THEN true  -- facility-level RLS handles the rest
      -- Family role: can only access linked residents
      ELSE EXISTS (
        SELECT 1 FROM family_resident_links
        WHERE user_id = auth.uid()
          AND resident_id = p_resident_id
          AND revoked_at IS NULL
      )
    END
$$;
```

---

## RLS POLICIES — CORE HIERARCHY

```sql
-- ORGANIZATIONS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own organization"
  ON organizations FOR SELECT
  USING (id = auth.organization_id());

CREATE POLICY "Only owners can update organization"
  ON organizations FOR UPDATE
  USING (id = auth.organization_id() AND auth.app_role() = 'owner');

-- ENTITIES
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see entities in their organization"
  ON entities FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL);

CREATE POLICY "Owner/org_admin can manage entities"
  ON entities FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin'));

-- FACILITIES
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see facilities they have access to"
  ON facilities FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND id IN (SELECT auth.accessible_facility_ids())
  );

CREATE POLICY "Owner/org_admin can manage facilities"
  ON facilities FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin'));

-- UNITS
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see units in accessible facilities"
  ON units FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

-- ROOMS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see rooms in accessible facilities"
  ON rooms FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

-- BEDS
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see beds in accessible facilities"
  ON beds FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

-- USER PROFILES
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see profiles in their organization"
  ON user_profiles FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL);

CREATE POLICY "Users can update their own profile"
  ON user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Owner/org_admin can manage all profiles"
  ON user_profiles FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin'));

-- USER FACILITY ACCESS
ALTER TABLE user_facility_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own access grants"
  ON user_facility_access FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND (user_id = auth.uid() OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin'))
  );

-- FAMILY RESIDENT LINKS
ALTER TABLE family_resident_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family sees their own links"
  ON family_resident_links FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND (user_id = auth.uid() OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  );
```

---

## AUDIT TRIGGER

```sql
-- Automatic updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to every table (example — repeat for all tables)
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON facilities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON beds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## AUDIT LOG TABLE

```sql
-- ============================================================
-- AUDIT LOG (immutable — tracks all data changes for HIPAA compliance)
-- ============================================================
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  user_id uuid REFERENCES auth.users(id),
  ip_address inet,
  user_agent text,
  organization_id uuid,
  facility_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- NO RLS on audit_log — accessed only via server-side functions
-- Indexes for querying
CREATE INDEX idx_audit_log_table ON audit_log(table_name, created_at DESC);
CREATE INDEX idx_audit_log_record ON audit_log(record_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
  _old_data jsonb;
  _new_data jsonb;
  _changed text[];
  _org_id uuid;
  _facility_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_data = to_jsonb(OLD);
    _new_data = NULL;
    _org_id = OLD.organization_id;
    _facility_id = CASE WHEN TG_TABLE_NAME IN ('facilities', 'units', 'rooms', 'beds') THEN OLD.facility_id ELSE NULL END;
  ELSIF TG_OP = 'UPDATE' THEN
    _old_data = to_jsonb(OLD);
    _new_data = to_jsonb(NEW);
    _org_id = NEW.organization_id;
    _facility_id = CASE WHEN TG_TABLE_NAME IN ('facilities', 'units', 'rooms', 'beds') THEN NEW.facility_id ELSE NULL END;
    -- Calculate changed fields
    SELECT array_agg(key) INTO _changed
    FROM jsonb_each(_new_data) n
    WHERE n.value IS DISTINCT FROM (_old_data -> n.key)
      AND n.key NOT IN ('updated_at', 'updated_by');
  ELSIF TG_OP = 'INSERT' THEN
    _old_data = NULL;
    _new_data = to_jsonb(NEW);
    _org_id = NEW.organization_id;
    _facility_id = CASE WHEN TG_TABLE_NAME IN ('facilities', 'units', 'rooms', 'beds') THEN NEW.facility_id ELSE NULL END;
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, organization_id, facility_id)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    _old_data,
    _new_data,
    _changed,
    auth.uid(),
    _org_id,
    _facility_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## SEED DATA — COL ORGANIZATION

```sql
-- Run after all tables are created

-- Organization
INSERT INTO organizations (id, name, dba_name, primary_contact_name, primary_contact_email, primary_contact_phone, address_line_1, city, state, zip)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Circle of Life Assisted Living Communities',
  'Circle of Life',
  'Milton Smith',
  'jessicamurphy@circleoflifecommunities.com',
  '386-339-1634',
  '426 SW Commerce Dr Ste 130D',
  'Lake City', 'FL', '32025'
);

-- Entities
INSERT INTO entities (id, organization_id, name, dba_name, entity_type, fein, years_ownership, years_management, address_line_1, city, state, zip) VALUES
('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Pine House, Inc.', 'Oakridge ALF', 'Inc.', '59-3588292', 12, 12, '297 SW Country Road 300', 'Mayo', 'FL', '32066'),
('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Smith & Sorensen LLC', 'Rising Oaks ALF', 'LLC', '47-5082758', 11, 11, '201 NW Ranchera Street', 'Live Oak', 'FL', '32064'),
('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Sorensen, Smith & Bay, LLLC', 'Homewood Lodge, ALF', 'LLLC', '47-1198264', 13, 13, '430 SE Mills Street', 'Mayo', 'FL', '32066'),
('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'The Plantation on Summers, LLC', 'Plantation ALF', 'LLC', '26-2147479', 9, 9, '1478 W Summers Lane', 'Lake City', 'FL', '32025'),
('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF LLC', NULL, 'LLC', '86-3065500', 5, 5, '970 SW Pinemount Rd', 'Lake City', 'FL', '32024');

-- Facilities
INSERT INTO facilities (id, entity_id, organization_id, name, license_type, address_line_1, city, state, zip, county, phone, email, total_licensed_beds) VALUES
('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Oakridge ALF', 'alf_intermediate', '297 SW Country Road 300', 'Mayo', 'FL', '32066', 'Lafayette', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 52),
('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Rising Oaks ALF', 'alf_intermediate', '201 NW Ranchera Street', 'Live Oak', 'FL', '32064', 'Suwannee', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 52),
('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Homewood Lodge ALF', 'alf_intermediate', '430 SE Mills Street', 'Mayo', 'FL', '32066', 'Lafayette', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 36),
('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Plantation ALF', 'alf_intermediate', '1478 W Summers Lane', 'Lake City', 'FL', '32025', 'Columbia', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 64),
('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Grande Cypress ALF', 'alf_intermediate', '970 SW Pinemount Rd', 'Lake City', 'FL', '32024', 'Columbia', '386-339-1634', 'jessicamurphy@circleoflifecommunities.com', 54);
```

---

## API ENDPOINTS — FOUNDATION

All endpoints prefixed with `/api/v1/`

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/organizations/current` | Required | All | Get current user's organization |
| PUT | `/organizations/current` | Required | owner | Update organization settings |
| GET | `/entities` | Required | owner, org_admin | List all entities in org |
| GET | `/entities/:id` | Required | owner, org_admin | Get entity details |
| GET | `/facilities` | Required | All | List facilities user can access |
| GET | `/facilities/:id` | Required | All (with access) | Get facility details |
| GET | `/facilities/:id/census` | Required | All (with access) | Get facility census summary |
| GET | `/facilities/:id/units` | Required | All (with access) | List units in facility |
| GET | `/facilities/:id/rooms` | Required | All (with access) | List rooms in facility |
| GET | `/facilities/:id/beds` | Required | All (with access) | List beds with status |
| GET | `/dashboard/org-summary` | Required | owner, org_admin | Org-level dashboard data |
| GET | `/dashboard/facility/:id` | Required | All (with access) | Facility-level dashboard data |

### Census Summary Response Shape
```json
{
  "facility_id": "uuid",
  "facility_name": "Oakridge ALF",
  "total_licensed_beds": 52,
  "total_rooms": 42,
  "occupied_beds": 49,
  "available_beds": 2,
  "hold_beds": 1,
  "maintenance_beds": 0,
  "occupancy_rate": 0.9423,
  "residents_by_acuity": {
    "level_1": 22,
    "level_2": 18,
    "level_3": 9
  },
  "residents_by_payer": {
    "private_pay": 31,
    "medicaid_oss": 14,
    "ltc_insurance": 3,
    "va_aid_attendance": 1
  },
  "pending_admissions": 1,
  "pending_discharges": 0,
  "hospital_holds": 1,
  "as_of": "2026-03-30T14:00:00Z"
}
```

---

## EDGE FUNCTIONS — FOUNDATION

| Function | Trigger | Purpose |
|----------|---------|---------|
| `on-user-created` | auth.users INSERT | Creates user_profile record, sends welcome email |
| `census-snapshot` | Cron (every 15 min) | Calculates and caches census for each facility |
| `daily-census-log` | Cron (midnight ET) | Logs end-of-day census to `census_daily_log` table for historical tracking |

---

## CENSUS DAILY LOG TABLE

```sql
CREATE TABLE census_daily_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  log_date date NOT NULL,
  total_licensed_beds integer NOT NULL,
  occupied_beds integer NOT NULL,
  available_beds integer NOT NULL,
  hold_beds integer NOT NULL,
  maintenance_beds integer NOT NULL,
  occupancy_rate numeric(5,4) NOT NULL,
  residents_by_acuity jsonb NOT NULL DEFAULT '{}',
  residents_by_payer jsonb NOT NULL DEFAULT '{}',
  admissions_today integer NOT NULL DEFAULT 0,
  discharges_today integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE census_daily_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see census for accessible facilities"
  ON census_daily_log FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
  );

CREATE UNIQUE INDEX idx_census_daily_facility_date ON census_daily_log(facility_id, log_date);
CREATE INDEX idx_census_daily_org_date ON census_daily_log(organization_id, log_date DESC);
```

## COL Alignment Notes

**COL organization seed data:** At org initialization, seed the following facilities (confirmed from wiki):
- Oakridge ALF — Lafayette County, FL — pilot facility (~52 beds)
- Rising Oaks ALF — Suwannee County, FL (~52 beds)
- Homewood Lodge ALF — Lafayette County, FL (~36 beds)
- Plantation ALF — Columbia County, FL (~64 beds)
- Grande Cypress ALF — Columbia County, FL (~54 beds)

All 5 facilities are under one organization (Circle of Life) with separate legal entities per facility. All are in the America/New_York timezone.

**RBAC role seeding for COL:** COL's operational roles map to Haven app_role enum as follows:
- Owner/executive → `owner`
- Administrator (per facility) → `facility_admin`
- Nurses / LPNs → `nurse`
- Caregivers / CNAs → `caregiver`
- Dietary staff → `dietary`
- Maintenance → `maintenance_role`
- Family members → `family`

**Audit log immutability:** COL's compliance history and the requirement to produce audit trails for AHCA surveyors makes audit_log immutability non-negotiable. Never add UPDATE or DELETE policies to audit_log under any circumstances.
