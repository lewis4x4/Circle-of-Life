-- Haven foundation: organizations → entities → facilities → units → rooms → beds

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
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_organizations_status ON organizations (status)
WHERE
  deleted_at IS NULL;

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  dba_name text,
  entity_type text,
  fein text,
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
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_entities_org ON entities (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_entities_status ON entities (organization_id, status)
WHERE
  deleted_at IS NULL;

CREATE TABLE facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
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
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_facilities_entity ON facilities (entity_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_facilities_org ON facilities (organization_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  floor_number integer DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_units_facility ON units (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  unit_id uuid REFERENCES units (id),
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
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_rooms_facility ON rooms (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_rooms_unit ON rooms (unit_id)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_rooms_number ON rooms (facility_id, room_number)
WHERE
  deleted_at IS NULL;

-- FK to residents added in a later migration (spec 03)
CREATE TABLE beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  bed_label text NOT NULL,
  bed_type bed_type NOT NULL DEFAULT 'alf_intermediate',
  status bed_status NOT NULL DEFAULT 'available',
  current_resident_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_beds_room ON beds (room_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_beds_facility ON beds (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_beds_status ON beds (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_beds_label ON beds (room_id, bed_label)
WHERE
  deleted_at IS NULL;
