-- Phase 3.5-A: platform-regulatory-jurisdiction

ALTER TABLE facilities
  ADD COLUMN license_authority text;

ALTER TABLE facilities
  ADD COLUMN alf_license_type text;

ALTER TABLE facilities
  ADD COLUMN cms_certification_number text;

ALTER TABLE facilities
  ADD COLUMN medicaid_provider_id text;

CREATE TABLE ratio_rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  description text,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_ratio_rule_sets_org ON ratio_rule_sets (organization_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE facilities
  ADD COLUMN facility_ratio_rule_set_id uuid REFERENCES ratio_rule_sets (id);

CREATE INDEX idx_facilities_ratio_rule ON facilities (facility_ratio_rule_set_id)
WHERE
  deleted_at IS NULL;

CREATE TYPE shift_classification AS ENUM (
  'regular',
  'on_call',
  'agency',
  'training',
  'other'
);

ALTER TABLE shift_assignments
  ADD COLUMN shift_classification shift_classification NOT NULL DEFAULT 'regular';

ALTER TABLE ratio_rule_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY ratio_rule_sets_all ON ratio_rule_sets
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE TRIGGER tr_ratio_rule_sets_set_updated_at
  BEFORE UPDATE ON ratio_rule_sets
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_ratio_rule_sets_audit
  AFTER INSERT OR UPDATE OR DELETE ON ratio_rule_sets
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
