-- incident_rca: authoritative persisted RCA workspace (spec 07; waiver W-RCA-01).
-- One row per incident (UNIQUE incident_id). Compliance history via audit_log on this table, not a revision table (v1).

CREATE TABLE incident_rca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  contributing_factor_tags text[] NOT NULL DEFAULT '{}',
  root_cause_narrative text NOT NULL DEFAULT '',
  corrective_actions text NOT NULL DEFAULT '',
  preventative_actions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  CONSTRAINT incident_rca_one_per_incident UNIQUE (incident_id)
);

CREATE INDEX idx_incident_rca_facility ON incident_rca (facility_id);

CREATE INDEX idx_incident_rca_org ON incident_rca (organization_id);

COMMENT ON TABLE incident_rca IS 'Authoritative RCA checklist and narrative; incidents table holds operational incident state only.';

ALTER TABLE incident_rca ENABLE ROW LEVEL SECURITY;

-- Mirror incident_followups: staff read; clinical roles manage.
CREATE POLICY staff_see_incident_rca ON incident_rca
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY clinical_staff_manage_incident_rca ON incident_rca
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

CREATE TRIGGER tr_incident_rca_set_updated_at
  BEFORE UPDATE ON incident_rca
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_incident_rca_audit
  AFTER INSERT OR UPDATE OR DELETE ON incident_rca
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
