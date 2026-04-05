# 19 — Vendor & Contract Management (Phase 3)

**Dependencies:** `00-foundation`, `16-billing` (optional spend alignment), `17-entity-facility-finance` (vendor payment GL posting), `18-insurance-risk-finance` (COI cross-reference — FK on `certificates_of_insurance`)  
**Build weeks (target):** 25–26 (Core slice 1)  
**Migration sequence:** `046_*` (first migration for this module; follows `045_*` date-integrity patch from Module 18)

---

## Implementation note (repo migrations vs spec SQL)

- Spec snippets use `auth.organization_id()`, `auth.accessible_facility_ids()`, `auth.app_role()` for readability.
- **Migrations in this repo** implement equivalent policies using **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`** in schema `haven` (see [README.md](README.md)).
- Trigger functions: **`public.haven_set_updated_at()`** and **`public.haven_capture_audit_log()`**.
- **Overlap with Module 13 (future maintenance):** `vendors` is the **enterprise vendor master**; maintenance work orders may reference the same `vendors.id` when Module 13 is spec’d — Core assumes **one vendor table** shared by category flags.

---

## Purpose and operator value

**Vendor & Contract Management** gives operators a **single vendor master**, **contract lifecycle** with alerts, **purchase order** workflow, **vendor invoice** intake with **three-way match** against POs, **vendor payments** with GL hooks, **vendor insurance** compliance (link to Module 18 COI when applicable), and **spend analytics** by category, facility, and vendor.

**Operator outcomes (Core):**

- Register vendors once; **assign to facilities** they serve.
- Store **contracts** with effective/expiry, auto-renew flags, termination notice windows, and document storage reference.
- **Alerts** for renewal, termination notice, auto-renew, price escalation, COI expiration.
- **POs** from draft → approved → received → closed; **vendor invoices** matched to PO lines and receipts.
- **Payments** recorded in cents; optional GL posting via Module 17.

**Non-goals (Core):** No vendor self-service portal; no RFP/RFQ bidding; no AI PDF extraction.

### Control plane (Core) — create vs approve

| Artifact | `facility_admin` | `owner` / `org_admin` |
|----------|------------------|------------------------|
| Vendor master & facility links | Read vendors linked to their facilities | Full CRUD |
| Contracts & terms | Read (vendor-scoped) | Full CRUD |
| PO | Create/edit **draft** and **submitted**; receive (**approved** → **received** / **partially_received**); cannot **approve**, **cancel**, or close books | Approve PO (**submitted** → **approved**), **cancel**, set **closed** when appropriate |
| Vendor invoice | Create/edit **draft** / **submitted**; cannot set **matched**, **paid**, **voided** | Approve to **matched**; mark **paid** / **void** |
| Vendor payment & applications | Read/create payments for **their facilities** (when Enhanced allows); Core UI may restrict payments to org_admin — see RLS | Full CRUD |

**PO numbers:** Core allocates monotonic display numbers per org/year via `public.allocate_vendor_po_number(uuid)` (SECURITY DEFINER) and `vendor_po_sequences` — avoids collisions and manual entry drift.

**Documents:** `document_storage_path` holds the **object key** (or path) for a future Supabase Storage bucket (e.g. `vendor-contracts/{org_id}/...`). Core does not require Storage wiring to ship; UI may accept a pasted path for traceability.

---

## Scope tiers

### Core

- Tables: `vendors`, `vendor_facilities`, `contracts`, `contract_terms`, `contract_alerts`, `purchase_orders`, `po_line_items`, `vendor_invoices`, `vendor_invoice_lines`, `vendor_payments`, `vendor_insurance`, `vendor_scorecards`.
- RLS: `owner`, `org_admin` full CRUD where noted; `facility_admin` SELECT + create/update POs for **their** facilities only.
- **GL:** `journal_entries.source_type = 'vendor_payment'` with `source_id` = `vendor_payments.id` (application-layer posting; no triggers on vendor tables in Core).

### Enhanced

- AI-assisted **contract term extraction** from uploaded PDF (human review required before persisting structured `contract_terms`).
- **Vendor risk score** (rule-based from scorecards + late payments + COI gaps).

### Future

- RFP/RFQ workflows; competitive bidding; vendor portal for invoice upload; punch-out catalog integrations.

---

## Relationship to Module 18

| Concept | Module 18 | Module 19 |
|---------|-----------|-----------|
| COI | `certificates_of_insurance` (holder may be vendor) | `vendor_insurance` may reference `certificates_of_insurance.id` OR store parallel summary for vendor-only compliance |

**Core:** `vendor_insurance.certificate_of_insurance_id uuid NULL REFERENCES certificates_of_insurance(id)` optional.

---

## DATABASE SCHEMA

```sql
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
  deleted_at timestamptz
);

CREATE INDEX idx_contracts_vendor ON contracts (vendor_id, expiration_date)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_contracts_expiry ON contracts (organization_id, expiration_date)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CONTRACT TERMS (structured)
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
  deleted_at timestamptz
);

CREATE INDEX idx_vendor_invoices_vendor ON vendor_invoices (vendor_id, invoice_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- VENDOR INVOICE LINES (three-way match)
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
-- VENDOR PAYMENT APPLICATIONS (invoice allocation)
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

-- ============================================================
-- VENDOR INSURANCE (compliance)
-- ============================================================
CREATE TABLE vendor_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  vendor_id uuid NOT NULL REFERENCES vendors (id),

  certificate_of_insurance_id uuid,

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
  deleted_at timestamptz
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
  deleted_at timestamptz
);

CREATE INDEX idx_vendor_scorecards_vendor ON vendor_scorecards (vendor_id, review_period_end DESC)
WHERE
  deleted_at IS NULL;
```

**FK:** In migration `046_*`, `vendor_insurance.certificate_of_insurance_id uuid NULL REFERENCES certificates_of_insurance(id)` (Module 18 is a prerequisite in this repo).

### PO sequence (implementation)

```sql
CREATE TABLE vendor_po_sequences (
  organization_id uuid NOT NULL REFERENCES organizations (id),
  year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);
-- RLS: deny direct access; bumps happen only inside allocate_vendor_po_number (SECURITY DEFINER).
```

---

## Business rules

- **PO total** must equal sum of `po_line_items.line_total_cents` (app validation; optional DB deferred constraint).
- **Three-way match:** `vendor_invoice_lines` quantities/costs should align with PO line receipts; status `matched` only for **owner/org_admin** (enforced in RLS + triggers).
- **Vendor payments:** `vendor_payment_applications` sum per `vendor_invoice_id` must not exceed invoice `total_cents` (DB trigger on `vendor_payment_applications`).
- **Money:** all amounts **integer cents** on monetary fields.
- **DB triggers (Core):** `facility_admin` cannot set `purchase_orders.status` to `approved` or `cancelled`; cannot set `vendor_invoices.status` to `matched`, `approved`, `paid`, or `voided`.

---

## RLS POLICIES (policy intent)

| Role | vendors | contracts | POs / invoices / payments |
|------|---------|-------------|---------------------------|
| `owner`, `org_admin` | Full CRUD within org | Full CRUD | Full CRUD |
| `facility_admin` | SELECT vendors linked to their facilities via `vendor_facilities` | SELECT contracts for vendors they can see | INSERT/UPDATE/SELECT POs and invoices **only** where `facility_id` in accessible facilities |
| Others | No access | No access | No access |

---

## Audit and updated_at

- All tables: `haven_set_updated_at` on mutable rows; `haven_capture_audit_log` on financial and contract tables.

---

## Admin UI (routes)

| Route | Purpose |
|-------|---------|
| `/admin/vendors` | Hub: vendor count, open contract alerts, MTD spend |
| `/admin/vendors/directory` | Vendor list + create |
| `/admin/vendors/[id]` | Vendor profile: facilities, contracts, POs, invoices, scorecards, insurance |
| `/admin/vendors/contracts` | Contract list with filters |
| `/admin/vendors/contracts/[id]` | Contract detail + terms + alerts |
| `/admin/vendors/purchase-orders` | PO list |
| `/admin/vendors/purchase-orders/new` | Create PO |
| `/admin/vendors/purchase-orders/[id]` | PO detail + lines + receive |
| `/admin/vendors/invoices` | Vendor invoice inbox |
| `/admin/vendors/invoices/[id]` | Invoice detail + match UI |
| `/admin/vendors/payments` | Payment list + record payment |
| `/admin/vendors/spend` | Spend analytics + CSV export |

---

## Acceptance criteria (Core)

1. Migration `046_*` creates enums, tables (including `vendor_po_sequences`), `allocate_vendor_po_number`, indexes, RLS, status-guard triggers, payment-application total trigger, audit/`updated_at` triggers.
2. **owner** / **org_admin** can manage full vendor lifecycle; **facility_admin** is scoped per matrix above.
3. `npm run migrations:check` and `npm run migrations:verify:pg` pass.
4. `npm run check:admin-shell` passes (`/vendors` in `ADMIN_SHELL_SEGMENTS`).
5. `npm run segment:gates -- --segment "module-19-vendor-contract-management" --ui` passes (design review + a11y use default routes unless `DESIGN_REVIEW_ROUTES` is set in CI).

---

## Spec summary (for handoff)

**Vendor & Contract Management** delivers **vendor master**, **contracts**, **alerts**, **POs**, **vendor invoices**, **payments** with application lines, **vendor insurance** compliance, and **scorecards**, with **GL-ready** vendor payment hooks to Module 17.
