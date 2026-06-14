-- ============================================================================
-- 305_drive_cutover.sql
-- Module 36 (Employee Workspace) — F5-2 Cutover
--
-- Immutable attestation that Google Drive has been set read-only for a
-- facility on the F0-5 cutoff date (2026-07-01) and Haven is system of record.
-- Insert-only audit record; the actual Drive read-only flip is a Google
-- Workspace admin action performed by the owner outside Haven.
-- ============================================================================

CREATE TABLE IF NOT EXISTS drive_cutover_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  cutoff_date date NOT NULL,
  drive_set_readonly boolean NOT NULL DEFAULT false,
  notes text,

  attested_by uuid NOT NULL REFERENCES auth.users(id),
  attested_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_drive_cutover_attestations_facility
  ON drive_cutover_attestations(facility_id, attested_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- RLS — admin/office read; owner/org_admin/facility_admin may attest. Insert-only.
-- ----------------------------------------------------------------------------

ALTER TABLE drive_cutover_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see cutover attestations in accessible facilities"
  ON drive_cutover_attestations FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')
  );

CREATE POLICY "Senior admins record cutover attestations"
  ON drive_cutover_attestations FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND attested_by = auth.uid()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- No UPDATE/DELETE policies: attestations are immutable.

CREATE TRIGGER drive_cutover_attestations_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON drive_cutover_attestations
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

COMMENT ON TABLE drive_cutover_attestations IS
  'Immutable sign-off that Google Drive is read-only and Haven is system of record (F0-5). Module 36 F5-2.';
