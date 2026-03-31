-- Daily logs + ADL logs (spec 04-daily-operations)

CREATE TABLE daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  log_date date NOT NULL,
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users (id),
  general_notes text,
  mood text,
  behavior_notes text,
  temperature numeric(5, 2),
  blood_pressure_systolic integer,
  blood_pressure_diastolic integer,
  pulse integer,
  respiration integer,
  oxygen_saturation numeric(5, 2),
  weight_lbs numeric(6, 2),
  sleep_quality text,
  times_awakened integer,
  sleep_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_daily_logs_resident_date ON daily_logs (resident_id, log_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_daily_logs_facility_date ON daily_logs (facility_id, log_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_daily_logs_logged_by ON daily_logs (logged_by, log_date DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_daily_logs_unique ON daily_logs (resident_id, log_date, shift, logged_by)
WHERE
  deleted_at IS NULL;

CREATE TABLE adl_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  daily_log_id uuid REFERENCES daily_logs (id),
  log_date date NOT NULL,
  log_time timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users (id),
  adl_type text NOT NULL,
  assistance_level assistance_level NOT NULL,
  refused boolean NOT NULL DEFAULT false,
  refusal_reason text,
  detail_data jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_adl_logs_resident_date ON adl_logs (resident_id, log_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_adl_logs_daily ON adl_logs (daily_log_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_adl_logs_type ON adl_logs (resident_id, adl_type, log_date DESC)
WHERE
  deleted_at IS NULL;
