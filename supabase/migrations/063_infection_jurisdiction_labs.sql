-- Phase 3.5-D: infection-jurisdiction-labs (Module 09)

CREATE TABLE infection_threshold_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  name text NOT NULL DEFAULT 'default',
  thresholds_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_infection_threshold_org_default ON infection_threshold_profiles (organization_id)
WHERE
  deleted_at IS NULL
  AND facility_id IS NULL;

CREATE UNIQUE INDEX idx_infection_threshold_org_facility ON infection_threshold_profiles (organization_id, facility_id)
WHERE
  deleted_at IS NULL
  AND facility_id IS NOT NULL;

ALTER TABLE staff_illness_records
  ADD COLUMN return_to_work_clearance_at timestamptz;

ALTER TABLE staff_illness_records
  ADD COLUMN clearing_provider text;

COMMENT ON COLUMN staff_illness_records.return_to_work_clearance_at IS 'Clinical clearance to return (distinct from cleared_at documentation).';

CREATE TABLE lab_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  resident_id uuid REFERENCES residents (id),
  staff_id uuid REFERENCES staff (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  observed_at timestamptz NOT NULL DEFAULT now (),
  lab_name text,
  loinc text,
  result_text text,
  result_numeric numeric,
  unit text,
  abnormal boolean NOT NULL DEFAULT false,
  source_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_lab_obs_facility ON lab_observations (facility_id, observed_at DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE integration_inbound_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  source_system text NOT NULL,
  message_type text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_integration_queue_pending ON integration_inbound_queue (organization_id, created_at)
WHERE
  status = 'pending';

ALTER TABLE infection_threshold_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY infection_thresholds_admin ON infection_threshold_profiles
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE lab_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY lab_obs_clinical ON lab_observations
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE integration_inbound_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_queue_admin ON integration_inbound_queue
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_infection_threshold_profiles_set_updated_at
  BEFORE UPDATE ON infection_threshold_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();
