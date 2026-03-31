-- Care plans and items (spec 03-resident-profile)

CREATE TABLE care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  version integer NOT NULL DEFAULT 1,
  status care_plan_status NOT NULL DEFAULT 'draft',
  effective_date date NOT NULL,
  review_due_date date NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users (id),
  notes text,
  previous_version_id uuid REFERENCES care_plans (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_care_plans_resident ON care_plans (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_care_plans_status ON care_plans (resident_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_care_plans_review_due ON care_plans (review_due_date)
WHERE
  status = 'active'
  AND deleted_at IS NULL;

CREATE TABLE care_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES care_plans (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  category care_plan_item_category NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  assistance_level assistance_level NOT NULL,
  frequency text,
  specific_times time[],
  special_instructions text,
  goal text,
  interventions text[],
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_cpi_care_plan ON care_plan_items (care_plan_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_cpi_resident ON care_plan_items (resident_id)
WHERE
  deleted_at IS NULL
  AND is_active = TRUE;

CREATE INDEX idx_cpi_category ON care_plan_items (resident_id, category)
WHERE
  deleted_at IS NULL
  AND is_active = TRUE;
