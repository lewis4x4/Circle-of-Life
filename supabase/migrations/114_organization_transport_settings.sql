-- Module 15 — Organization-level mileage reimbursement rate (Track D10)
-- One row per organization; lazy-created from admin UI. RLS: read for transport roles; write owner/org_admin.

CREATE TABLE organization_transport_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  mileage_reimbursement_rate_cents integer NOT NULL DEFAULT 70
    CHECK (
      mileage_reimbursement_rate_cents >= 1
      AND mileage_reimbursement_rate_cents <= 1000
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id)
);

COMMENT ON TABLE organization_transport_settings IS 'Per-org mileage rate for staff personal vehicle reimbursement (Module 15); rate snapshotted on mileage_logs at insert.';
COMMENT ON COLUMN organization_transport_settings.mileage_reimbursement_rate_cents IS 'Cents per mile (e.g. 70 = $0.70/mi).';

ALTER TABLE organization_transport_settings ENABLE ROW LEVEL SECURITY;

-- Read: same broad org access as resident transport requests (operators need rate when logging trips)
CREATE POLICY organization_transport_settings_select ON organization_transport_settings
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver',
      'dietary',
      'maintenance_role'
    ));

-- Write: org policy owners (finance-grade)
CREATE POLICY organization_transport_settings_insert ON organization_transport_settings
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY organization_transport_settings_update ON organization_transport_settings
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE TRIGGER tr_organization_transport_settings_set_updated_at
  BEFORE UPDATE ON organization_transport_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_organization_transport_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON organization_transport_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
