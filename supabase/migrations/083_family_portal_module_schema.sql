-- Phase 5: Family Portal (spec 21-family-portal) — DDL + indexes

CREATE TYPE family_care_conference_status AS ENUM (
  'scheduled',
  'completed',
  'cancelled'
);

CREATE TYPE family_message_triage_status AS ENUM (
  'pending_review',
  'in_review',
  'resolved',
  'false_positive'
);

CREATE TABLE family_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  family_user_id uuid NOT NULL REFERENCES auth.users (id),
  consent_type text NOT NULL,
  document_version text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now (),
  ip_address inet,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_family_consent_records_resident ON family_consent_records (resident_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_family_consent_records_facility ON family_consent_records (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE family_message_triage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  family_portal_message_id uuid NOT NULL REFERENCES family_portal_messages (id) ON DELETE CASCADE,
  triage_status family_message_triage_status NOT NULL DEFAULT 'pending_review',
  matched_keywords text[] NOT NULL DEFAULT '{}',
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_family_message_triage_one_per_message ON family_message_triage_items (family_portal_message_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_family_message_triage_facility_status ON family_message_triage_items (facility_id, triage_status)
WHERE
  deleted_at IS NULL;

CREATE TABLE family_care_conference_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz,
  status family_care_conference_status NOT NULL DEFAULT 'scheduled',
  recording_consent boolean NOT NULL DEFAULT false,
  recording_consent_at timestamptz,
  recording_consent_by uuid REFERENCES auth.users (id),
  external_room_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_family_care_conference_facility ON family_care_conference_sessions (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_family_care_conference_resident ON family_care_conference_sessions (resident_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE family_consent_records IS 'Family attestations; RLS in 084.';

COMMENT ON TABLE family_message_triage_items IS 'Clinical triage queue for family portal messages; RLS in 084.';

COMMENT ON TABLE family_care_conference_sessions IS 'Care conference scheduling metadata; RLS in 084.';
