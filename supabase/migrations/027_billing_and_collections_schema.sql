-- Resident billing and collections schema (spec 16)

CREATE TABLE rate_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  effective_date date NOT NULL,
  end_date date,
  base_rate_private integer NOT NULL,
  base_rate_semi_private integer,
  care_surcharge_level_1 integer NOT NULL DEFAULT 0,
  care_surcharge_level_2 integer NOT NULL,
  care_surcharge_level_3 integer NOT NULL,
  community_fee integer DEFAULT 0,
  pet_fee integer DEFAULT 0,
  second_occupant_fee integer DEFAULT 0,
  respite_daily_rate integer,
  bed_hold_daily_rate integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_rate_schedules_facility ON rate_schedules (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_rate_schedules_current ON rate_schedules (facility_id, effective_date DESC)
WHERE
  deleted_at IS NULL
  AND end_date IS NULL;

CREATE TABLE resident_payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  payer_type payer_type NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  payer_name text,
  policy_number text,
  group_number text,
  payer_phone text,
  payer_contact_name text,
  monthly_benefit_amount integer,
  daily_benefit_amount integer,
  elimination_period_days integer,
  elimination_period_start_date date,
  benefit_period_months integer,
  benefits_used_months integer DEFAULT 0,
  remaining_benefits_months integer,
  medicaid_recipient_id text,
  medicaid_authorization_start date,
  medicaid_authorization_end date,
  medicaid_rate integer,
  medicaid_patient_responsibility integer,
  payer_share_type text NOT NULL DEFAULT 'full',
  payer_fixed_amount integer,
  payer_percentage numeric(5, 2),
  effective_date date NOT NULL,
  end_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_payers_resident ON resident_payers (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_resident_payers_type ON resident_payers (facility_id, payer_type)
WHERE
  deleted_at IS NULL
  AND end_date IS NULL;

CREATE INDEX idx_resident_payers_medicaid ON resident_payers (facility_id)
WHERE
  deleted_at IS NULL
  AND payer_type = 'medicaid_oss'
  AND end_date IS NULL;

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  subtotal integer NOT NULL,
  adjustments integer NOT NULL DEFAULT 0,
  tax integer NOT NULL DEFAULT 0,
  total integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  balance_due integer NOT NULL,
  payer_type payer_type,
  payer_name text,
  notes text,
  sent_at timestamptz,
  sent_method text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  voided_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_invoices_resident ON invoices (resident_id, invoice_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_invoices_facility ON invoices (facility_id, invoice_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_invoices_entity ON invoices (entity_id, invoice_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_invoices_status ON invoices (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_invoices_overdue ON invoices (facility_id, due_date)
WHERE
  deleted_at IS NULL
  AND status IN ('sent', 'partial', 'overdue');

CREATE UNIQUE INDEX idx_invoices_number ON invoices (invoice_number);

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  line_type text NOT NULL,
  description text NOT NULL,
  quantity numeric(8, 2) NOT NULL DEFAULT 1,
  unit_price integer NOT NULL,
  total integer NOT NULL,
  prorate_days integer,
  prorate_total_days integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_lines ON invoice_line_items (invoice_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  invoice_id uuid REFERENCES invoices (id),
  payment_date date NOT NULL,
  amount integer NOT NULL,
  payment_method payment_method NOT NULL,
  reference_number text,
  payer_name text,
  payer_type payer_type,
  deposited boolean NOT NULL DEFAULT false,
  deposited_date date,
  deposited_by uuid REFERENCES auth.users (id),
  refunded boolean NOT NULL DEFAULT false,
  refund_amount integer,
  refund_date date,
  refund_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_payments_resident ON payments (resident_id, payment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_payments_invoice ON payments (invoice_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_payments_facility ON payments (facility_id, payment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_payments_entity ON payments (entity_id, payment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_payments_undeposited ON payments (facility_id)
WHERE
  deleted_at IS NULL
  AND deposited = false;

CREATE TABLE collection_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  invoice_id uuid REFERENCES invoices (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  activity_type text NOT NULL,
  activity_date date NOT NULL,
  performed_by uuid NOT NULL REFERENCES auth.users (id),
  description text NOT NULL,
  outcome text,
  follow_up_date date,
  follow_up_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_collection_resident ON collection_activities (resident_id, activity_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_collection_followup ON collection_activities (follow_up_date)
WHERE
  deleted_at IS NULL
  AND follow_up_date IS NOT NULL;

CREATE TABLE invoice_sequences (
  facility_id uuid NOT NULL REFERENCES facilities (id),
  year_month text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, year_month)
);
