-- Staff management and scheduling schema (spec 11)

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date,
  ssn_last_four text,
  phone text,
  phone_alt text,
  email text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  staff_role staff_role NOT NULL,
  employment_status employment_status NOT NULL DEFAULT 'active',
  hire_date date NOT NULL,
  termination_date date,
  termination_reason text,
  hourly_rate integer,
  overtime_rate integer,
  is_full_time boolean NOT NULL DEFAULT true,
  is_float_pool boolean NOT NULL DEFAULT false,
  max_hours_per_week integer DEFAULT 40,
  photo_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_facility ON staff (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_org ON staff (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_role ON staff (facility_id, staff_role)
WHERE
  deleted_at IS NULL
  AND employment_status = 'active';

CREATE INDEX idx_staff_user ON staff (user_id)
WHERE
  deleted_at IS NULL
  AND user_id IS NOT NULL;

CREATE INDEX idx_staff_status ON staff (facility_id, employment_status)
WHERE
  deleted_at IS NULL;

CREATE TABLE staff_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  certification_type text NOT NULL,
  certification_name text NOT NULL,
  issuing_authority text,
  certificate_number text,
  issue_date date NOT NULL,
  expiration_date date,
  status certification_status NOT NULL DEFAULT 'active',
  document_id uuid REFERENCES resident_documents (id),
  storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_certs ON staff_certifications (staff_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_certs_type ON staff_certifications (staff_id, certification_type)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_staff_certs_expiration ON staff_certifications (expiration_date)
WHERE
  deleted_at IS NULL
  AND status = 'active'
  AND expiration_date IS NOT NULL;

CREATE INDEX idx_staff_certs_facility ON staff_certifications (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  week_start_date date NOT NULL,
  status schedule_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  published_by uuid REFERENCES auth.users (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_schedules_facility ON schedules (facility_id, week_start_date DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_schedules_unique ON schedules (facility_id, week_start_date)
WHERE
  deleted_at IS NULL;

CREATE TABLE shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  shift_date date NOT NULL,
  shift_type shift_type NOT NULL,
  custom_start_time time,
  custom_end_time time,
  unit_id uuid REFERENCES units (id),
  status shift_assignment_status NOT NULL DEFAULT 'assigned',
  assigned_resident_ids uuid[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_shift_assignments_schedule ON shift_assignments (schedule_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_staff ON shift_assignments (staff_id, shift_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_facility_date ON shift_assignments (facility_id, shift_date, shift_type)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_status ON shift_assignments (facility_id, shift_date, status)
WHERE
  deleted_at IS NULL;

CREATE TABLE time_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff (id),
  shift_assignment_id uuid REFERENCES shift_assignments (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  clock_in_method text NOT NULL,
  clock_out_method text,
  clock_in_latitude numeric(10, 7),
  clock_in_longitude numeric(10, 7),
  clock_out_latitude numeric(10, 7),
  clock_out_longitude numeric(10, 7),
  scheduled_hours numeric(5, 2),
  actual_hours numeric(5, 2),
  regular_hours numeric(5, 2),
  overtime_hours numeric(5, 2),
  break_minutes integer DEFAULT 0,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  discrepancy_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_time_records_staff ON time_records (staff_id, clock_in DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_time_records_facility ON time_records (facility_id, clock_in DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_time_records_unapproved ON time_records (facility_id)
WHERE
  deleted_at IS NULL
  AND approved = false
  AND clock_out IS NOT NULL;

CREATE TABLE shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_staff_id uuid NOT NULL REFERENCES staff (id),
  requesting_assignment_id uuid NOT NULL REFERENCES shift_assignments (id),
  covering_staff_id uuid REFERENCES staff (id),
  covering_assignment_id uuid REFERENCES shift_assignments (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  swap_type text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  claimed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users (id),
  denied_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_swap_requests_facility ON shift_swap_requests (facility_id)
WHERE
  deleted_at IS NULL
  AND status = 'pending';

CREATE INDEX idx_swap_requests_staff ON shift_swap_requests (requesting_staff_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE staffing_ratio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  residents_present integer NOT NULL,
  staff_on_duty integer NOT NULL,
  ratio numeric(5, 2) NOT NULL,
  required_ratio numeric(5, 2) NOT NULL,
  is_compliant boolean NOT NULL,
  staff_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staffing_snapshots ON staffing_ratio_snapshots (facility_id, snapshot_at DESC);

CREATE INDEX idx_staffing_noncompliant ON staffing_ratio_snapshots (facility_id)
WHERE
  is_compliant = false;
