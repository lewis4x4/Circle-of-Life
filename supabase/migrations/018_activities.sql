-- Activities, sessions, attendance (spec 04-daily-operations)

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  description text,
  default_day_of_week integer[],
  default_start_time time,
  default_duration_minutes integer,
  facilitator text,
  is_recurring boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  session_date date NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  facilitator_name text,
  notes text,
  cancelled boolean NOT NULL DEFAULT false,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE activity_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_session_id uuid NOT NULL REFERENCES activity_sessions (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  attended boolean NOT NULL DEFAULT true,
  engagement_level text,
  duration_minutes integer,
  notes text,
  logged_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_activity_att_session ON activity_attendance (activity_session_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_activity_att_resident ON activity_attendance (resident_id, created_at DESC)
WHERE
  deleted_at IS NULL;
