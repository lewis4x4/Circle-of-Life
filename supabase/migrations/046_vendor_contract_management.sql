-- Module 19 — Vendor & Contract Management (spec 19-vendor-contract-management)
-- Depends on: organizations, entities, facilities, certificates_of_insurance (044)
-- RLS: haven.organization_id(), haven.accessible_facility_ids(), haven.app_role()
-- Triggers: public.haven_set_updated_at, public.haven_capture_audit_log (006)

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE vendor_category AS ENUM (
  'maintenance',
  'medical_supply',
  'pharmacy',
  'food_service',
  'staffing_agency',
  'consulting',
  'technology',
  'other'
);

CREATE TYPE vendor_status AS ENUM (
  'draft',
  'active',
  'inactive',
  'blocked'
);

CREATE TYPE contract_type AS ENUM (
  'service',
  'lease',
  'license',
  'subscription',
  'maintenance',
  'other'
);

CREATE TYPE contract_alert_type AS ENUM (
  'renewal',
  'termination_notice',
  'auto_renew',
  'price_escalation',
  'coi_expiration',
  'other'
);

CREATE TYPE contract_alert_status AS ENUM (
  'pending',
  'acknowledged',
  'resolved',
  'dismissed'
);

CREATE TYPE po_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'partially_received',
  'received',
  'closed',
  'cancelled'
);

CREATE TYPE vendor_invoice_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'matched',
  'paid',
  'voided'
);

-- ============================================================
-- VENDOR PO SEQUENCES (org + year → monotonic number)
-- ============================================================
CREATE TABLE vendor_po_sequences (
  organization_id uuid NOT NULL REFERENCES organizations (id),
  year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);

ALTER TABLE vendor_po_sequences ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- VENDORS
-- ============================================================
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL,
  category vendor_category NOT NULL DEFAULT 'other',
  status vendor_status NOT NULL DEFAULT 'active',
  tax_id text,
  remit_to_address text,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_vendors_org_name ON vendors (organization_id, lower(name))
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_vendors_org ON vendors (organization_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR ↔ FACILITIES
-- ============================================================
CREATE TABLE vendor_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities (id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_vendor_facilities_unique ON vendor_facilities (vendor_id, facility_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CONTRACTS
-- ============================================================
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  contract_type contract_type NOT NULL DEFAULT 'service',
  title text NOT NULL,
  effective_date date NOT NULL,
  expiration_date date,
  auto_renew boolean NOT NULL DEFAULT false,
  termination_notice_days integer CHECK (termination_notice_days IS NULL OR termination_notice_days >= 0),
  total_value_cents bigint,
  payment_terms text,
  document_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT contracts_expiry_after_effective CHECK (
    expiration_date IS NULL
    OR expiration_date >= effective_date
  )
);

CREATE INDEX idx_contracts_vendor ON contracts (vendor_id, expiration_date)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_contracts_expiry ON contracts (organization_id, expiration_date)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CONTRACT TERMS
-- ============================================================
CREATE TABLE contract_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  contract_id uuid NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  price_escalation_percent numeric(8, 4),
  sla_response_hours integer,
  insurance_requirements text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

-- ============================================================
-- CONTRACT ALERTS
-- ============================================================
CREATE TABLE contract_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  contract_id uuid NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
  alert_type contract_alert_type NOT NULL,
  alert_date date NOT NULL,
  status contract_alert_status NOT NULL DEFAULT 'pending',
  title text NOT NULL,
  description text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_contract_alerts_due ON contract_alerts (organization_id, alert_date)
WHERE
  deleted_at IS NULL
  AND status = 'pending';

-- ============================================================
-- PURCHASE ORDERS
-- ============================================================
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  po_number text NOT NULL,
  status po_status NOT NULL DEFAULT 'draft',
  order_date date NOT NULL,
  expected_date date,
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_po_number ON purchase_orders (organization_id, po_number)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_po_facility ON purchase_orders (facility_id, order_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- PO LINE ITEMS
-- ============================================================
CREATE TABLE po_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  line_number integer NOT NULL,
  description text NOT NULL,
  quantity numeric(12, 4) NOT NULL DEFAULT 1,
  unit_cost_cents integer NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents integer NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  received_quantity numeric(12, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_po_lines_po ON po_line_items (purchase_order_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR INVOICES
-- ============================================================
CREATE TABLE vendor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  purchase_order_id uuid REFERENCES purchase_orders (id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  status vendor_invoice_status NOT NULL DEFAULT 'draft',
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  document_storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT vendor_invoices_due_after_invoice CHECK (due_date >= invoice_date)
);

CREATE INDEX idx_vendor_invoices_vendor ON vendor_invoices (vendor_id, invoice_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR INVOICE LINES
-- ============================================================
CREATE TABLE vendor_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  vendor_invoice_id uuid NOT NULL REFERENCES vendor_invoices (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),
  po_line_item_id uuid REFERENCES po_line_items (id),
  line_number integer NOT NULL,
  description text NOT NULL,
  quantity numeric(12, 4) NOT NULL DEFAULT 1,
  unit_cost_cents integer NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents integer NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

-- ============================================================
-- VENDOR PAYMENTS
-- ============================================================
CREATE TABLE vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  payment_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL,
  reference_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_vendor_payments_vendor ON vendor_payments (vendor_id, payment_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR PAYMENT APPLICATIONS
-- ============================================================
CREATE TABLE vendor_payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_payment_id uuid NOT NULL REFERENCES vendor_payments (id) ON DELETE CASCADE,
  vendor_invoice_id uuid NOT NULL REFERENCES vendor_invoices (id),
  applied_amount_cents bigint NOT NULL CHECK (applied_amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_vpa_payment ON vendor_payment_applications (vendor_payment_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_vpa_invoice ON vendor_payment_applications (vendor_invoice_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR INSURANCE
-- ============================================================
CREATE TABLE vendor_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  certificate_of_insurance_id uuid REFERENCES certificates_of_insurance (id),
  insurance_type text NOT NULL,
  carrier_name text,
  policy_number text,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  additional_insured boolean NOT NULL DEFAULT false,
  compliant boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT vendor_insurance_expiry_after_effective CHECK (expiration_date >= effective_date)
);

CREATE INDEX idx_vendor_insurance_expiry ON vendor_insurance (vendor_id, expiration_date)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR SCORECARDS
-- ============================================================
CREATE TABLE vendor_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),
  review_period_start date NOT NULL,
  review_period_end date NOT NULL,
  quality_score integer CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)),
  timeliness_score integer CHECK (timeliness_score IS NULL OR (timeliness_score >= 0 AND timeliness_score <= 100)),
  cost_score integer CHECK (cost_score IS NULL OR (cost_score >= 0 AND cost_score <= 100)),
  compliance_score integer CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)),
  reviewer_notes text,
  reviewed_by uuid REFERENCES auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT vendor_scorecards_period_order CHECK (review_period_end >= review_period_start)
);

CREATE INDEX idx_vendor_scorecards_vendor ON vendor_scorecards (vendor_id, review_period_end DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- ROLE GUARDS — purchase_orders
-- ============================================================
CREATE OR REPLACE FUNCTION public.haven_vendor_guard_purchase_order ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF haven.app_role () = 'facility_admin' THEN
    IF NEW.status = 'approved'::po_status AND (OLD.status IS DISTINCT FROM NEW.status) THEN
      RAISE EXCEPTION 'facility_admin cannot approve purchase orders';
    END IF;
    IF NEW.status = 'cancelled'::po_status AND (OLD.status IS DISTINCT FROM NEW.status) THEN
      RAISE EXCEPTION 'facility_admin cannot cancel purchase orders';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'facility_admin cannot set PO approval fields';
    END IF;
  END IF;
  RETURN NEW;
END
$func$;

CREATE TRIGGER tr_purchase_orders_guard
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_vendor_guard_purchase_order ();

-- ============================================================
-- ROLE GUARDS — vendor_invoices
-- ============================================================
CREATE OR REPLACE FUNCTION public.haven_vendor_guard_vendor_invoice ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF haven.app_role () = 'facility_admin' THEN
    IF NEW.status IN (
      'approved'::vendor_invoice_status,
      'matched'::vendor_invoice_status,
      'paid'::vendor_invoice_status,
      'voided'::vendor_invoice_status
    )
    AND (OLD.status IS DISTINCT FROM NEW.status) THEN
      RAISE EXCEPTION 'facility_admin cannot approve or finalize vendor invoices';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'facility_admin cannot set vendor invoice approval fields';
    END IF;
  END IF;
  RETURN NEW;
END
$func$;

CREATE TRIGGER tr_vendor_invoices_guard
  BEFORE UPDATE ON vendor_invoices
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_vendor_guard_vendor_invoice ();

-- ============================================================
-- PAYMENT APPLICATION TOTALS
-- ============================================================
CREATE OR REPLACE FUNCTION public.haven_validate_vendor_payment_application_total ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  inv_total bigint;
  applied bigint;
  inv_id uuid;
BEGIN
  inv_id := COALESCE(NEW.vendor_invoice_id, OLD.vendor_invoice_id);
  SELECT
    total_cents INTO inv_total
  FROM
    vendor_invoices
  WHERE
    id = inv_id
    AND deleted_at IS NULL;
  IF inv_total IS NULL THEN
    RAISE EXCEPTION 'vendor invoice not found';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT
      COALESCE(sum(applied_amount_cents), 0) + NEW.applied_amount_cents INTO applied
    FROM
      vendor_payment_applications
    WHERE
      vendor_invoice_id = inv_id
      AND deleted_at IS NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT
      COALESCE(sum(applied_amount_cents), 0) - OLD.applied_amount_cents + NEW.applied_amount_cents INTO applied
    FROM
      vendor_payment_applications
    WHERE
      vendor_invoice_id = inv_id
      AND deleted_at IS NULL;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF applied > inv_total THEN
    RAISE EXCEPTION 'payment applications exceed vendor invoice total';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$func$;

CREATE TRIGGER tr_vendor_payment_applications_total_ins
  BEFORE INSERT ON vendor_payment_applications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_validate_vendor_payment_application_total ();

CREATE TRIGGER tr_vendor_payment_applications_total_upd
  BEFORE UPDATE ON vendor_payment_applications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_validate_vendor_payment_application_total ();

-- ============================================================
-- ALLOCATE PO NUMBER
-- ============================================================
CREATE OR REPLACE FUNCTION public.allocate_vendor_po_number (p_organization_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
DECLARE
  v_year text;
  v_next integer;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_organization_id IS DISTINCT FROM haven.organization_id () THEN
    RAISE EXCEPTION 'organization mismatch';
  END IF;
  IF NOT (haven.app_role () = ANY (ARRAY['owner'::app_role, 'org_admin'::app_role, 'facility_admin'::app_role])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_year := to_char(timezone ('America/New_York', now()), 'YYYY');
  INSERT INTO vendor_po_sequences (organization_id, year, last_number)
    VALUES (p_organization_id, v_year, 0)
  ON CONFLICT (organization_id, year)
    DO NOTHING;
  UPDATE
    vendor_po_sequences
  SET
    last_number = last_number + 1
  WHERE
    organization_id = p_organization_id
    AND year = v_year
  RETURNING
    last_number INTO v_next;
  RETURN format('PO-%s-%s', v_year, lpad(v_next::text, 5, '0'));
END
$func$;

REVOKE ALL ON FUNCTION public.allocate_vendor_po_number (uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.allocate_vendor_po_number (uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.allocate_vendor_po_number (uuid) TO service_role;

-- ============================================================
-- RLS — vendors
-- ============================================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_select ON vendors
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendors.id
            AND vf.organization_id = haven.organization_id ()
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendors_insert ON vendors
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendors_update ON vendors
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendors_delete ON vendors
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_facilities
-- ============================================================
ALTER TABLE vendor_facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_facilities_select ON vendor_facilities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY vendor_facilities_insert ON vendor_facilities
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_facilities_update ON vendor_facilities
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_facilities_delete ON vendor_facilities
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — contracts (+ facility_admin read via vendor link)
-- ============================================================
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_select ON contracts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = contracts.vendor_id
            AND vf.organization_id = haven.organization_id ()
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY contracts_insert ON contracts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contracts_update ON contracts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contracts_delete ON contracts
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — contract_terms
-- ============================================================
ALTER TABLE contract_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_terms_select ON contract_terms
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            contracts c
            JOIN vendor_facilities vf ON vf.vendor_id = c.vendor_id
              AND vf.organization_id = c.organization_id
          WHERE
            c.id = contract_terms.contract_id
            AND c.deleted_at IS NULL
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY contract_terms_insert ON contract_terms
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contract_terms_update ON contract_terms
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contract_terms_delete ON contract_terms
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — contract_alerts
-- ============================================================
ALTER TABLE contract_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_alerts_select ON contract_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            contracts c
            JOIN vendor_facilities vf ON vf.vendor_id = c.vendor_id
              AND vf.organization_id = c.organization_id
          WHERE
            c.id = contract_alerts.contract_id
            AND c.deleted_at IS NULL
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY contract_alerts_insert ON contract_alerts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contract_alerts_update ON contract_alerts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY contract_alerts_delete ON contract_alerts
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — purchase_orders
-- ============================================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_select ON purchase_orders
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = purchase_orders.vendor_id
            AND vf.facility_id = purchase_orders.facility_id
            AND vf.organization_id = purchase_orders.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY purchase_orders_insert ON purchase_orders
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = purchase_orders.vendor_id
            AND vf.facility_id = purchase_orders.facility_id
            AND vf.organization_id = purchase_orders.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY purchase_orders_update ON purchase_orders
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = purchase_orders.vendor_id
            AND vf.facility_id = purchase_orders.facility_id
            AND vf.organization_id = purchase_orders.organization_id
            AND vf.deleted_at IS NULL))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = purchase_orders.vendor_id
            AND vf.facility_id = purchase_orders.facility_id
            AND vf.organization_id = purchase_orders.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY purchase_orders_delete ON purchase_orders
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — po_line_items
-- ============================================================
ALTER TABLE po_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_line_items_select ON po_line_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        purchase_orders po
      WHERE
        po.id = po_line_items.purchase_order_id
        AND po.organization_id = haven.organization_id ()
        AND po.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND po.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY po_line_items_insert ON po_line_items
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        purchase_orders po
      WHERE
        po.id = po_line_items.purchase_order_id
        AND po.organization_id = haven.organization_id ()
        AND po.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND po.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY po_line_items_update ON po_line_items
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        purchase_orders po
      WHERE
        po.id = po_line_items.purchase_order_id
        AND po.organization_id = haven.organization_id ()
        AND po.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND po.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        purchase_orders po
      WHERE
        po.id = po_line_items.purchase_order_id
        AND po.organization_id = haven.organization_id ()
        AND po.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND po.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY po_line_items_delete ON po_line_items
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_invoices
-- ============================================================
ALTER TABLE vendor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_invoices_select ON vendor_invoices
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_invoices.vendor_id
            AND vf.facility_id = vendor_invoices.facility_id
            AND vf.organization_id = vendor_invoices.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY vendor_invoices_insert ON vendor_invoices
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_invoices.vendor_id
            AND vf.facility_id = vendor_invoices.facility_id
            AND vf.organization_id = vendor_invoices.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY vendor_invoices_update ON vendor_invoices
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_invoices.vendor_id
            AND vf.facility_id = vendor_invoices.facility_id
            AND vf.organization_id = vendor_invoices.organization_id
            AND vf.deleted_at IS NULL))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_invoices.vendor_id
            AND vf.facility_id = vendor_invoices.facility_id
            AND vf.organization_id = vendor_invoices.organization_id
            AND vf.deleted_at IS NULL))));

CREATE POLICY vendor_invoices_delete ON vendor_invoices
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_invoice_lines
-- ============================================================
ALTER TABLE vendor_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_invoice_lines_select ON vendor_invoice_lines
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_invoices vi
      WHERE
        vi.id = vendor_invoice_lines.vendor_invoice_id
        AND vi.organization_id = haven.organization_id ()
        AND vi.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vi.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_invoice_lines_insert ON vendor_invoice_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_invoices vi
      WHERE
        vi.id = vendor_invoice_lines.vendor_invoice_id
        AND vi.organization_id = haven.organization_id ()
        AND vi.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vi.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_invoice_lines_update ON vendor_invoice_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_invoices vi
      WHERE
        vi.id = vendor_invoice_lines.vendor_invoice_id
        AND vi.organization_id = haven.organization_id ()
        AND vi.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vi.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_invoices vi
      WHERE
        vi.id = vendor_invoice_lines.vendor_invoice_id
        AND vi.organization_id = haven.organization_id ()
        AND vi.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vi.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_invoice_lines_delete ON vendor_invoice_lines
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_payments
-- ============================================================
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_payments_select ON vendor_payments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY vendor_payments_insert ON vendor_payments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY vendor_payments_update ON vendor_payments
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))));

CREATE POLICY vendor_payments_delete ON vendor_payments
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_payment_applications
-- ============================================================
ALTER TABLE vendor_payment_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_payment_applications_select ON vendor_payment_applications
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_payments vp
      WHERE
        vp.id = vendor_payment_applications.vendor_payment_id
        AND vp.organization_id = haven.organization_id ()
        AND vp.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vp.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_payment_applications_insert ON vendor_payment_applications
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_payments vp
      WHERE
        vp.id = vendor_payment_applications.vendor_payment_id
        AND vp.organization_id = haven.organization_id ()
        AND vp.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vp.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_payment_applications_update ON vendor_payment_applications
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_payments vp
      WHERE
        vp.id = vendor_payment_applications.vendor_payment_id
        AND vp.organization_id = haven.organization_id ()
        AND vp.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vp.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        vendor_payments vp
      WHERE
        vp.id = vendor_payment_applications.vendor_payment_id
        AND vp.organization_id = haven.organization_id ()
        AND vp.deleted_at IS NULL
        AND (
          haven.app_role () IN ('owner', 'org_admin')
          OR (
            haven.app_role () = 'facility_admin'
            AND vp.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_payment_applications_delete ON vendor_payment_applications
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_insurance
-- ============================================================
ALTER TABLE vendor_insurance ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_insurance_select ON vendor_insurance
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_insurance.vendor_id
            AND vf.organization_id = haven.organization_id ()
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_insurance_insert ON vendor_insurance
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_insurance_update ON vendor_insurance
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_insurance_delete ON vendor_insurance
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- RLS — vendor_scorecards
-- ============================================================
ALTER TABLE vendor_scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_scorecards_select ON vendor_scorecards
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        haven.app_role () = 'facility_admin'
        AND EXISTS (
          SELECT
            1
          FROM
            vendor_facilities vf
          WHERE
            vf.vendor_id = vendor_scorecards.vendor_id
            AND vf.organization_id = haven.organization_id ()
            AND vf.deleted_at IS NULL
            AND vf.facility_id IN (
              SELECT
                haven.accessible_facility_ids ())))));

CREATE POLICY vendor_scorecards_insert ON vendor_scorecards
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_scorecards_update ON vendor_scorecards
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY vendor_scorecards_delete ON vendor_scorecards
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin'));

-- ============================================================
-- TRIGGERS — updated_at + audit
-- ============================================================
CREATE TRIGGER tr_vendors_set_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vendors_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendors
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_facilities_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_facilities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_contracts_set_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_contracts_audit
  AFTER INSERT OR UPDATE OR DELETE ON contracts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_contract_terms_set_updated_at
  BEFORE UPDATE ON contract_terms
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_contract_terms_audit
  AFTER INSERT OR UPDATE OR DELETE ON contract_terms
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_contract_alerts_set_updated_at
  BEFORE UPDATE ON contract_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_contract_alerts_audit
  AFTER INSERT OR UPDATE OR DELETE ON contract_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_purchase_orders_set_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_purchase_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_po_line_items_set_updated_at
  BEFORE UPDATE ON po_line_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_po_line_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON po_line_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_invoices_set_updated_at
  BEFORE UPDATE ON vendor_invoices
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vendor_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_invoices
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_invoice_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_invoice_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_payments_set_updated_at
  BEFORE UPDATE ON vendor_payments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vendor_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_payments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_payment_applications_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_payment_applications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_insurance_set_updated_at
  BEFORE UPDATE ON vendor_insurance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vendor_insurance_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_insurance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_vendor_scorecards_set_updated_at
  BEFORE UPDATE ON vendor_scorecards
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_vendor_scorecards_audit
  AFTER INSERT OR UPDATE OR DELETE ON vendor_scorecards
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

COMMENT ON TABLE vendors IS 'Module 19: enterprise vendor master.';
COMMENT ON COLUMN journal_entries.source_type IS 'Includes vendor_payment (app-posted from Module 19 vendor_payments).';
