-- RCA: operator attestation of investigation completeness (regulatory visibility; audit via completed_at/by + audit_log).

ALTER TABLE incident_rca
  ADD COLUMN investigation_status text NOT NULL DEFAULT 'draft'
    CONSTRAINT incident_rca_investigation_status_check
      CHECK (investigation_status IN ('draft', 'complete')),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by uuid REFERENCES auth.users (id);

COMMENT ON COLUMN incident_rca.investigation_status IS 'draft = in progress; complete = attested finished (not a legal determination).';
COMMENT ON COLUMN incident_rca.completed_at IS 'When investigation_status became complete.';
COMMENT ON COLUMN incident_rca.completed_by IS 'User who attested completion.';
