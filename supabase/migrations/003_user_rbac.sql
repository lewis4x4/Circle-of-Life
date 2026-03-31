-- Haven foundation: user_profiles, facility access, family links (resident FK in spec 03)

CREATE TABLE user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id),
  organization_id uuid REFERENCES organizations (id),
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

CREATE INDEX idx_user_profiles_org ON user_profiles (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_user_profiles_role ON user_profiles (app_role)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_user_profiles_email ON user_profiles (email)
WHERE
  deleted_at IS NULL;

CREATE TABLE user_facility_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  is_primary boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users (id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users (id)
);

CREATE INDEX idx_ufa_user ON user_facility_access (user_id)
WHERE
  revoked_at IS NULL;

CREATE INDEX idx_ufa_facility ON user_facility_access (facility_id)
WHERE
  revoked_at IS NULL;

CREATE UNIQUE INDEX idx_ufa_unique ON user_facility_access (user_id, facility_id)
WHERE
  revoked_at IS NULL;

-- resident_id → FK added with residents table (spec 03)
CREATE TABLE family_resident_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  resident_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  relationship text NOT NULL,
  is_responsible_party boolean NOT NULL DEFAULT false,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  can_view_clinical boolean NOT NULL DEFAULT true,
  can_view_financial boolean NOT NULL DEFAULT false,
  can_make_decisions boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users (id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users (id)
);

CREATE INDEX idx_frl_user ON family_resident_links (user_id)
WHERE
  revoked_at IS NULL;

CREATE INDEX idx_frl_resident ON family_resident_links (resident_id)
WHERE
  revoked_at IS NULL;
