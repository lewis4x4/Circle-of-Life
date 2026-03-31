-- Resident profile (spec 03-resident-profile) — core residents + bed/family FKs

CREATE TABLE residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  bed_id uuid REFERENCES beds (id),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date NOT NULL,
  gender gender NOT NULL,
  ssn_last_four text,
  photo_url text,
  status resident_status NOT NULL DEFAULT 'inquiry',
  acuity_level acuity_level,
  acuity_score numeric(5, 2),
  admission_date date,
  admission_source text,
  referral_source_id uuid,
  discharge_date date,
  discharge_reason discharge_reason,
  discharge_destination text,
  discharge_notes text,
  primary_physician_name text,
  primary_physician_phone text,
  primary_physician_fax text,
  primary_diagnosis text,
  diagnosis_list text[],
  allergy_list text[],
  diet_order text,
  diet_restrictions text[],
  code_status text NOT NULL DEFAULT 'full_code',
  advance_directive_on_file boolean NOT NULL DEFAULT false,
  advance_directive_type text,
  ambulatory boolean NOT NULL DEFAULT true,
  assistive_device text,
  fall_risk_level text DEFAULT 'standard',
  elopement_risk boolean NOT NULL DEFAULT false,
  wandering_risk boolean NOT NULL DEFAULT false,
  smoking_status text DEFAULT 'non_smoker',
  primary_payer payer_type NOT NULL DEFAULT 'private_pay',
  secondary_payer payer_type,
  monthly_base_rate integer,
  monthly_care_surcharge integer DEFAULT 0,
  monthly_total_rate integer,
  rate_effective_date date,
  responsible_party_name text,
  responsible_party_relationship text,
  responsible_party_phone text,
  responsible_party_email text,
  responsible_party_address text,
  emergency_contact_1_name text,
  emergency_contact_1_relationship text,
  emergency_contact_1_phone text,
  emergency_contact_2_name text,
  emergency_contact_2_relationship text,
  emergency_contact_2_phone text,
  preferred_wake_time time,
  preferred_bed_time time,
  preferred_shower_days text[],
  food_preferences text,
  activity_preferences text,
  religious_preference text,
  special_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_residents_facility ON residents (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_residents_org ON residents (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_residents_status ON residents (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_residents_bed ON residents (bed_id)
WHERE
  deleted_at IS NULL
  AND bed_id IS NOT NULL;

CREATE INDEX idx_residents_name ON residents (last_name, first_name)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_residents_acuity ON residents (facility_id, acuity_level)
WHERE
  deleted_at IS NULL
  AND status = 'active';

ALTER TABLE beds
  ADD CONSTRAINT fk_beds_resident FOREIGN KEY (current_resident_id) REFERENCES residents (id);

ALTER TABLE family_resident_links
  ADD CONSTRAINT fk_frl_resident FOREIGN KEY (resident_id) REFERENCES residents (id);
