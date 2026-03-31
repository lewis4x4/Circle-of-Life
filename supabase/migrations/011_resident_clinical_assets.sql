-- Assessments, photos, contacts, documents (spec 03-resident-profile)
-- linked_incident_id: incidents table not in Phase 1 yet — no FK

CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  assessment_type text NOT NULL,
  assessment_date date NOT NULL,
  total_score numeric(8, 2),
  risk_level text,
  scores jsonb NOT NULL DEFAULT '{}',
  notes text,
  assessed_by uuid NOT NULL REFERENCES auth.users (id),
  next_due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_assessments_resident ON assessments (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_assessments_type ON assessments (resident_id, assessment_type, assessment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_assessments_due ON assessments (next_due_date)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_assessments_facility_date ON assessments (facility_id, assessment_date DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  photo_type text NOT NULL,
  storage_path text NOT NULL,
  description text,
  anatomical_location text,
  wound_stage text,
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid NOT NULL REFERENCES auth.users (id),
  linked_incident_id uuid,
  linked_assessment_id uuid REFERENCES assessments (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_photos_resident ON resident_photos (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_resident_photos_type ON resident_photos (resident_id, photo_type, taken_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  contact_type text NOT NULL,
  name text NOT NULL,
  relationship text,
  phone text,
  phone_alt text,
  email text,
  fax text,
  address text,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  is_healthcare_proxy boolean NOT NULL DEFAULT false,
  is_power_of_attorney boolean NOT NULL DEFAULT false,
  notification_preference text DEFAULT 'phone',
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_contacts_resident ON resident_contacts (resident_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE resident_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  document_type text NOT NULL,
  title text NOT NULL,
  storage_path text NOT NULL,
  file_type text,
  file_size integer,
  uploaded_by uuid NOT NULL REFERENCES auth.users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expiration_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_docs_resident ON resident_documents (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_resident_docs_type ON resident_documents (resident_id, document_type)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_resident_docs_expiration ON resident_documents (expiration_date)
WHERE
  deleted_at IS NULL
  AND expiration_date IS NOT NULL;
