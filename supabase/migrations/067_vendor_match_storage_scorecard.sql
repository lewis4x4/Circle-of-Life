-- Phase 3.5-E: vendor-match-storage-scorecard (Module 19)

CREATE TABLE invoice_match_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  vendor_id uuid REFERENCES vendors (id),
  name text NOT NULL,
  tolerance_cents integer NOT NULL DEFAULT 0 CHECK (tolerance_cents >= 0),
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_invoice_match_rules_org ON invoice_match_rules (organization_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE vendor_scorecard_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  vendor_id uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  signal_date date NOT NULL DEFAULT CURRENT_DATE,
  signal_key text NOT NULL,
  signal_value numeric,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT vendor_scorecard_signals_vendor_key_date UNIQUE (vendor_id, signal_key, signal_date)
);

CREATE INDEX idx_vendor_scorecard_signals_vendor ON vendor_scorecard_signals (vendor_id, signal_date DESC);

ALTER TABLE invoice_match_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_match_rules_admin ON invoice_match_rules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ());

ALTER TABLE vendor_scorecard_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_scorecard_signals_select ON vendor_scorecard_signals
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY vendor_scorecard_signals_service ON vendor_scorecard_signals
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_invoice_match_rules_set_updated_at
  BEFORE UPDATE ON invoice_match_rules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

COMMENT ON TABLE vendor_scorecard_signals IS 'Nightly job inserts; RLS allows org admins to read.';
