-- Resident medications + eMAR records (spec 04-daily-operations)

CREATE TABLE resident_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  medication_name text NOT NULL,
  generic_name text,
  strength text,
  form text,
  route medication_route NOT NULL,
  frequency medication_frequency NOT NULL,
  frequency_detail text,
  scheduled_times time[],
  instructions text,
  indication text,
  prescriber_name text,
  prescriber_phone text,
  pharmacy_name text,
  controlled_schedule controlled_schedule NOT NULL DEFAULT 'non_controlled',
  status medication_status NOT NULL DEFAULT 'active',
  start_date date NOT NULL,
  end_date date,
  discontinued_date date,
  discontinued_reason text,
  discontinued_by uuid REFERENCES auth.users (id),
  order_date date NOT NULL,
  order_source text,
  order_document_id uuid REFERENCES resident_documents (id),
  prn_reason text,
  prn_max_frequency text,
  prn_effectiveness_check_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_res_meds_resident ON resident_medications (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_res_meds_active ON resident_medications (resident_id, status)
WHERE
  deleted_at IS NULL
  AND status = 'active';

CREATE INDEX idx_res_meds_controlled ON resident_medications (facility_id, controlled_schedule)
WHERE
  deleted_at IS NULL
  AND status = 'active'
  AND controlled_schedule != 'non_controlled';

CREATE TABLE emar_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  daily_log_id uuid REFERENCES daily_logs (id),
  scheduled_time timestamptz NOT NULL,
  actual_time timestamptz,
  status emar_status NOT NULL DEFAULT 'scheduled',
  administered_by uuid REFERENCES auth.users (id),
  refusal_reason text,
  hold_reason text,
  not_available_reason text,
  is_prn boolean NOT NULL DEFAULT false,
  prn_reason_given text,
  prn_effectiveness_checked boolean DEFAULT false,
  prn_effectiveness_time timestamptz,
  prn_effectiveness_result text,
  prn_effectiveness_notes text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_emar_resident_date ON emar_records (resident_id, scheduled_time DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_emar_medication ON emar_records (resident_medication_id, scheduled_time DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_emar_status ON emar_records (facility_id, status, scheduled_time)
WHERE
  deleted_at IS NULL
  AND status = 'scheduled';

CREATE INDEX idx_emar_prn_pending ON emar_records (facility_id, prn_effectiveness_checked)
WHERE
  deleted_at IS NULL
  AND is_prn = TRUE
  AND status = 'given'
  AND prn_effectiveness_checked = FALSE;
