# 16 — Resident Billing & Collections

**Dependencies:** 00-foundation, 03-resident-profile
**Build Week:** 11-12

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- RATE SCHEDULES (facility-level rate configuration)
-- ============================================================
CREATE TABLE rate_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,                            -- "2026 Standard Rates", "Medicaid OSS Rates"
  effective_date date NOT NULL,
  end_date date,                                 -- NULL = current
  base_rate_private integer NOT NULL,            -- cents per month, private room
  base_rate_semi_private integer,                -- cents per month, semi-private
  care_surcharge_level_1 integer NOT NULL DEFAULT 0, -- cents per month
  care_surcharge_level_2 integer NOT NULL,
  care_surcharge_level_3 integer NOT NULL,
  community_fee integer DEFAULT 0,               -- one-time admission fee (cents)
  pet_fee integer DEFAULT 0,                     -- monthly (cents)
  second_occupant_fee integer DEFAULT 0,         -- monthly for couples (cents)
  respite_daily_rate integer,                    -- cents per day for short-term stays
  bed_hold_daily_rate integer,                   -- cents per day during hospitalization
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_rate_schedules_facility ON rate_schedules(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_rate_schedules_current ON rate_schedules(facility_id, effective_date DESC) WHERE deleted_at IS NULL AND end_date IS NULL;

-- ============================================================
-- RESIDENT PAYER CONFIGURATIONS
-- ============================================================
CREATE TABLE resident_payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  payer_type payer_type NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  payer_name text,                               -- "Medicaid", "Genworth LTC", "VA"
  policy_number text,
  group_number text,
  payer_phone text,
  payer_contact_name text,

  -- Coverage details
  monthly_benefit_amount integer,                -- cents (for LTC insurance with defined benefit)
  daily_benefit_amount integer,                  -- cents
  elimination_period_days integer,               -- LTC insurance: days before benefits start
  elimination_period_start_date date,
  benefit_period_months integer,                 -- LTC insurance: total months of benefits
  benefits_used_months integer DEFAULT 0,
  remaining_benefits_months integer,

  -- Medicaid specific
  medicaid_recipient_id text,
  medicaid_authorization_start date,
  medicaid_authorization_end date,
  medicaid_rate integer,                         -- cents per month (OSS rate)
  medicaid_patient_responsibility integer,       -- cents per month (resident's share)

  -- Share of cost / split
  payer_share_type text NOT NULL DEFAULT 'full', -- "full", "fixed_amount", "percentage", "remainder"
  payer_fixed_amount integer,                    -- cents (if fixed_amount)
  payer_percentage numeric(5,2),                 -- if percentage
  effective_date date NOT NULL,
  end_date date,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_resident_payers_resident ON resident_payers(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_payers_type ON resident_payers(facility_id, payer_type) WHERE deleted_at IS NULL AND end_date IS NULL;
CREATE INDEX idx_resident_payers_medicaid ON resident_payers(facility_id) WHERE deleted_at IS NULL AND payer_type = 'medicaid_oss' AND end_date IS NULL;

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_id uuid NOT NULL REFERENCES entities(id), -- legal entity for accounting

  invoice_number text NOT NULL,                  -- "OAK-2026-04-001"
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  period_start date NOT NULL,                    -- billing period
  period_end date NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',

  -- Amounts (all in cents)
  subtotal integer NOT NULL,
  adjustments integer NOT NULL DEFAULT 0,        -- discounts, credits
  tax integer NOT NULL DEFAULT 0,
  total integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  balance_due integer NOT NULL,

  payer_type payer_type,                         -- who this invoice is billed to
  payer_name text,

  notes text,
  sent_at timestamptz,
  sent_method text,                              -- "email", "portal", "mail", "hand_delivered"
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  voided_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_invoices_resident ON invoices(resident_id, invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_facility ON invoices(facility_id, invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_entity ON invoices(entity_id, invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_status ON invoices(facility_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_overdue ON invoices(facility_id, due_date) WHERE deleted_at IS NULL AND status IN ('sent', 'partial', 'overdue');
CREATE UNIQUE INDEX idx_invoices_number ON invoices(invoice_number);

-- ============================================================
-- INVOICE LINE ITEMS
-- ============================================================
CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  line_type text NOT NULL,                       -- "base_rent", "care_surcharge", "community_fee", "pet_fee", "ancillary", "bed_hold", "respite", "adjustment", "credit", "late_fee"
  description text NOT NULL,
  quantity numeric(8,2) NOT NULL DEFAULT 1,
  unit_price integer NOT NULL,                   -- cents
  total integer NOT NULL,                        -- cents (quantity × unit_price)
  prorate_days integer,                          -- if pro-rated: number of days
  prorate_total_days integer,                    -- total days in the month

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_lines ON invoice_line_items(invoice_id);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  invoice_id uuid REFERENCES invoices(id),       -- NULL for unapplied payments

  payment_date date NOT NULL,
  amount integer NOT NULL,                       -- cents
  payment_method payment_method NOT NULL,
  reference_number text,                         -- check number, transaction ID
  payer_name text,                               -- who actually paid
  payer_type payer_type,

  deposited boolean NOT NULL DEFAULT false,
  deposited_date date,
  deposited_by uuid REFERENCES auth.users(id),

  refunded boolean NOT NULL DEFAULT false,
  refund_amount integer,
  refund_date date,
  refund_reason text,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_payments_resident ON payments(resident_id, payment_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_invoice ON payments(invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_facility ON payments(facility_id, payment_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_entity ON payments(entity_id, payment_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_undeposited ON payments(facility_id) WHERE deleted_at IS NULL AND deposited = false;

-- ============================================================
-- COLLECTION ACTIVITIES (AR aging action log)
-- ============================================================
CREATE TABLE collection_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  invoice_id uuid REFERENCES invoices(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  activity_type text NOT NULL,                   -- "statement_sent", "phone_call", "email", "portal_notice", "demand_letter", "payment_plan_offered", "payment_plan_accepted", "discharge_warning", "sent_to_collections"
  activity_date date NOT NULL,
  performed_by uuid NOT NULL REFERENCES auth.users(id),
  description text NOT NULL,
  outcome text,                                  -- "no_answer", "promised_payment", "dispute", "payment_received", "no_response"
  follow_up_date date,
  follow_up_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_collection_resident ON collection_activities(resident_id, activity_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_collection_followup ON collection_activities(follow_up_date) WHERE deleted_at IS NULL AND follow_up_date IS NOT NULL;

-- ============================================================
-- INVOICE SEQUENCE COUNTER
-- ============================================================
CREATE TABLE invoice_sequences (
  facility_id uuid NOT NULL REFERENCES facilities(id),
  year_month text NOT NULL,                      -- "2026-04"
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, year_month)
);
```

---

## RLS POLICIES

```sql
ALTER TABLE rate_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see rates" ON rate_schedules FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));
CREATE POLICY "Admin manage rates" ON rate_schedules FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE resident_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see payers" ON resident_payers FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage payers" ON resident_payers FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see invoices" ON invoices FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));
CREATE POLICY "Family see own invoices" ON invoices FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND auth.app_role() = 'family' AND auth.can_access_resident(resident_id) AND EXISTS (SELECT 1 FROM family_resident_links WHERE user_id = auth.uid() AND resident_id = invoices.resident_id AND can_view_financial = true AND revoked_at IS NULL));

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Linked to invoice access" ON invoice_line_items FOR SELECT
  USING (organization_id = auth.organization_id() AND invoice_id IN (SELECT id FROM invoices WHERE organization_id = auth.organization_id()));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see payments" ON payments FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));
CREATE POLICY "Family see own payments" ON payments FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND auth.app_role() = 'family' AND auth.can_access_resident(resident_id) AND EXISTS (SELECT 1 FROM family_resident_links WHERE user_id = auth.uid() AND resident_id = payments.resident_id AND can_view_financial = true AND revoked_at IS NULL));

ALTER TABLE collection_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see collections" ON collection_activities FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

-- Audit + updated_at
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_resident_payers AFTER INSERT OR UPDATE OR DELETE ON resident_payers FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rate_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON resident_payers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Invoice Generation (Monthly)
- Triggered by cron on the 25th of each month for the upcoming month (April invoices generated March 25).
- For each active resident:
  1. Determine applicable rate_schedule (current, matching facility)
  2. Calculate base rent line item:
     - Full month if resident was active on the 1st
     - Pro-rated if admission_date falls within the billing month: `base_rate × (days_remaining / days_in_month)`
     - Pro-rated if planned discharge falls within: `base_rate × (days_present / days_in_month)`
  3. Calculate care surcharge based on current acuity_level
  4. Add any recurring ancillary charges (pet fee, second occupant)
  5. Apply bed hold rate if resident is in hospital_hold status
  6. Determine payer split from resident_payers:
     - If single payer (private_pay): one invoice
     - If split payer (e.g., Medicaid + patient responsibility): two invoices — one to Medicaid, one to responsible party for patient responsibility amount
  7. Generate invoice with line items, set status = 'draft'

### Invoice Numbering
- Format: `{FACILITY_CODE}-{YYYY}-{MM}-{SEQUENCE}`
- Example: OAK-2026-04-001

### AR Aging Automation
| Days Past Due | Auto-Action |
|--------------|-------------|
| 1 day | Status changes to 'overdue'. Shown on AR aging report. |
| 15 days | Auto-generate statement (PDF). Email/portal notification to responsible party. Create collection_activity record. |
| 30 days | Generate phone call task for facility_admin. Create collection_activity record. |
| 45 days | Second statement with past-due notice. |
| 60 days | Generate demand letter template. Alert owner. |
| 90 days | Trigger discharge evaluation workflow. Flag account for review. Alert owner. |

### Payment Application
- WHEN a payment is recorded against an invoice:
  1. Update `invoices.amount_paid` += payment amount
  2. Update `invoices.balance_due` = total - amount_paid
  3. If balance_due = 0: status → 'paid'
  4. If balance_due > 0 and amount_paid > 0: status → 'partial'
  5. Update `residents` financial standing indicator

### Rate Change Process
- Rate changes take effect on a future date (minimum 30-day notice in most jurisdictions)
- WHEN a new rate_schedule is created with a future effective_date:
  1. Set previous schedule's end_date = new effective_date - 1 day
  2. Generate notification to all affected residents' responsible parties
  3. Update resident monthly_total_rate on effective_date (via scheduled Edge Function)

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/rate-schedules` | Required | facility_admin+ | List rate schedules. Param: `facility_id` |
| POST | `/rate-schedules` | Required | facility_admin+ | Create rate schedule |
| PUT | `/rate-schedules/:id` | Required | facility_admin+ | Update rate schedule |
| GET | `/residents/:id/payers` | Required | facility_admin+ | List payer configurations |
| POST | `/residents/:id/payers` | Required | facility_admin+ | Add payer |
| PUT | `/resident-payers/:id` | Required | facility_admin+ | Update payer |
| GET | `/invoices` | Required | facility_admin+ or family (own) | List invoices. Params: `facility_id`, `resident_id`, `status`, `date_from`, `date_to` |
| GET | `/invoices/:id` | Required | facility_admin+ or family (own) | Get invoice with line items |
| POST | `/invoices/generate` | Required | facility_admin+ | Generate monthly invoices for a facility |
| PUT | `/invoices/:id` | Required | facility_admin+ | Update invoice (before sent) |
| POST | `/invoices/:id/send` | Required | facility_admin+ | Mark as sent, trigger notification |
| POST | `/invoices/:id/void` | Required | facility_admin, owner | Void invoice |
| GET | `/payments` | Required | facility_admin+ or family (own) | List payments. Params: `facility_id`, `resident_id`, `date_from`, `date_to` |
| POST | `/payments` | Required | facility_admin+ | Record payment |
| PUT | `/payments/:id` | Required | facility_admin+ | Update payment |
| GET | `/facilities/:id/ar-aging` | Required | facility_admin, owner, org_admin | AR aging report |
| GET | `/organizations/ar-aging` | Required | owner, org_admin | Org-wide AR aging |
| GET | `/facilities/:id/revenue-summary` | Required | facility_admin, owner, org_admin | Revenue summary: MTD, YTD, by payer type |
| GET | `/collection-activities` | Required | facility_admin+ | Collection activity log. Param: `resident_id` |
| POST | `/collection-activities` | Required | facility_admin+ | Log collection activity |

### AR Aging Response Shape
```json
{
  "facility_id": "uuid",
  "facility_name": "Oakridge ALF",
  "as_of": "2026-03-30",
  "summary": {
    "current": 125000,
    "past_due_1_30": 45000,
    "past_due_31_60": 12000,
    "past_due_61_90": 0,
    "past_due_over_90": 8500,
    "total_outstanding": 190500
  },
  "by_payer_type": {
    "private_pay": {"current": 95000, "past_due_1_30": 35000, "past_due_31_60": 12000, "past_due_61_90": 0, "past_due_over_90": 8500},
    "medicaid_oss": {"current": 30000, "past_due_1_30": 10000, "past_due_31_60": 0, "past_due_61_90": 0, "past_due_over_90": 0}
  },
  "residents_past_due": [
    {
      "resident_id": "uuid",
      "resident_name": "Johnson, Margaret",
      "room": "114",
      "payer_type": "private_pay",
      "total_due": 15000,
      "oldest_invoice_date": "2026-01-01",
      "days_oldest": 89,
      "last_payment_date": "2026-01-15",
      "last_collection_activity": "2026-03-15",
      "collection_status": "demand_letter_sent"
    }
  ]
}
```

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `generate-monthly-invoices` | Cron (25th of month at 6 AM ET) OR manual trigger | For each facility: iterate active residents, calculate charges per business rules, create invoice + line items as 'draft'. Notify facility_admin that invoices are ready for review. |
| `ar-aging-check` | Cron (daily at 8 AM ET) | Scan invoices where status IN ('sent', 'partial') AND due_date < now(). Update status to 'overdue'. Generate actions per the AR aging automation table. |
| `payment-applied` | INSERT on payments | Update linked invoice amounts. Update invoice status. Recalculate resident financial standing. |
| `rate-change-effective` | Cron (daily at midnight ET) | Check for rate_schedules where effective_date = today. Update all affected residents' monthly rates. |
| `medicaid-authorization-expiring` | Cron (daily) | Flag Medicaid authorizations expiring within 30 days. Alert facility_admin. |

---

## UI SCREENS

Route and shell conventions follow `docs/specs/FRONTEND-CONTRACT.md`.

### Web (Admin Dashboard)

| Screen | Route | Description |
|--------|-------|-------------|
| Rate Management | `/admin/billing/rates` | Current and historical rate schedules. Edit/create. |
| Resident Billing Setup | `/admin/residents/:id/billing` | Payer configuration, current rates, rate history |
| Invoice List | `/admin/billing/invoices` | Filter by status, month, resident. Bulk actions: send, print. |
| Invoice Detail | `/admin/billing/invoices/:id` | Line items, payment history, collection log. Send/void buttons. Print to PDF. |
| Invoice Generation | `/admin/billing/invoices/generate` | Preview monthly invoice batch. Review, edit, approve, generate. |
| Payment Entry | `/admin/billing/payments/new` | Record payment: resident, amount, method, reference. Apply to invoice. |
| AR Aging Report | `/admin/billing/ar-aging` | Aging buckets, drill-down to resident, collection activity log |
| Org AR Summary | `/admin/billing/org-ar-aging` | Cross-facility AR aging. Total outstanding by facility. |
| Revenue Dashboard | `/admin/billing/revenue` | MTD/YTD revenue, by payer type, per-bed revenue, occupancy correlation |

### Family Portal (limited billing view)

| Screen | Route | Description |
|--------|-------|-------------|
| My Invoices | `/family/invoices` | List of invoices for linked resident. View detail. |
| Billing Summary | `/family/billing` | Read-only billing summary and current balance for linked resident. |
| Payment History | `/family/payments` | List of posted payments and receipts. |
