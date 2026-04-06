-- Phase 6: Referral CRM (spec 22-referral-crm) — HL7 ADT inbound queue

CREATE TYPE referral_hl7_inbound_status AS ENUM (
  'pending',
  'processed',
  'failed',
  'ignored'
);

CREATE TABLE referral_hl7_inbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  message_control_id text,
  trigger_event text,
  raw_message text NOT NULL,
  status referral_hl7_inbound_status NOT NULL DEFAULT 'pending',
  parse_error text,
  linked_referral_lead_id uuid REFERENCES referral_leads (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_referral_hl7_inbound_facility_status ON referral_hl7_inbound (facility_id, status, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_referral_hl7_inbound_dedupe_control ON referral_hl7_inbound (organization_id, message_control_id)
WHERE
  deleted_at IS NULL
  AND message_control_id IS NOT NULL;

COMMENT ON TABLE referral_hl7_inbound IS 'HL7 v2 ADT inbound queue; RLS spec 22.';

ALTER TABLE referral_hl7_inbound ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_hl7_inbound_select ON referral_hl7_inbound
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY referral_hl7_inbound_insert ON referral_hl7_inbound
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY referral_hl7_inbound_update ON referral_hl7_inbound
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_referral_hl7_inbound_set_updated_at
  BEFORE UPDATE ON referral_hl7_inbound
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_referral_hl7_inbound_audit
  AFTER INSERT OR UPDATE OR DELETE ON referral_hl7_inbound
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
