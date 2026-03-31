# 06 — Medication Management (Advanced)

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations (resident_medications + emar_records already exist)
**Build Week:** 15-16
**Phase:** 2

Phase 1 created `resident_medications` and `emar_records` for basic medication assistance documentation. This spec adds: medication interaction database, three-way reconciliation, controlled substance full lifecycle, medication error formal reporting, physician order workflow, and pharmacy integration preparation.

---

## DATABASE SCHEMA (New Tables)

```sql
-- ============================================================
-- MEDICATION INTERACTIONS (reference data — seeded, not user-generated)
-- ============================================================
CREATE TABLE medication_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_a text NOT NULL,                          -- generic name, lowercase
  drug_b text NOT NULL,                          -- generic name, lowercase
  severity text NOT NULL,                        -- "high", "moderate", "low"
  interaction_type text NOT NULL,                -- "drug_drug", "drug_food", "drug_condition", "duplicate_class"
  description text NOT NULL,                     -- clinical description of the interaction
  clinical_effect text,                          -- "Increased bleeding risk", "Reduced drug effectiveness"
  management text,                               -- "Monitor INR closely", "Separate by 2 hours"
  source text,                                   -- "FDA", "Lexicomp", "Micromedex"
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_med_interactions_drug_a ON medication_interactions(drug_a);
CREATE INDEX idx_med_interactions_drug_b ON medication_interactions(drug_b);
CREATE INDEX idx_med_interactions_severity ON medication_interactions(severity);

-- ============================================================
-- MEDICATION INTERACTION ALERTS (generated per resident when interactions detected)
-- ============================================================
CREATE TABLE medication_interaction_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  medication_a_id uuid NOT NULL REFERENCES resident_medications(id),
  medication_b_id uuid NOT NULL REFERENCES resident_medications(id),
  interaction_id uuid NOT NULL REFERENCES medication_interactions(id),
  severity text NOT NULL,
  description text NOT NULL,
  clinical_effect text,
  management text,

  status text NOT NULL DEFAULT 'active',         -- "active", "acknowledged", "resolved", "overridden"
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  override_reason text,                          -- if overridden: "Physician aware, benefit outweighs risk"
  overridden_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,                       -- auto-resolved when one medication is discontinued

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_mia_resident ON medication_interaction_alerts(resident_id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_mia_facility ON medication_interaction_alerts(facility_id) WHERE deleted_at IS NULL AND status = 'active';

-- ============================================================
-- MEDICATION RECONCILIATION (three-way: physician orders vs facility MAR vs pharmacy dispensing)
-- ============================================================
CREATE TABLE medication_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  reconciliation_date date NOT NULL,
  reconciliation_type text NOT NULL,             -- "admission", "hospital_return", "quarterly", "physician_visit", "pharmacy_refill"
  performed_by uuid NOT NULL REFERENCES auth.users(id),

  status text NOT NULL DEFAULT 'in_progress',    -- "in_progress", "completed", "discrepancy_found"
  discrepancies jsonb DEFAULT '[]',
  -- [{"medication": "Metformin 500mg", "issue": "Physician order says BID, MAR shows TID", "resolution": "Updated MAR to BID per physician confirmation", "resolved_by": "uuid", "resolved_at": "..."}]

  notes text,
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_med_recon_resident ON medication_reconciliations(resident_id, reconciliation_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_recon_facility ON medication_reconciliations(facility_id, reconciliation_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_recon_open ON medication_reconciliations(facility_id) WHERE deleted_at IS NULL AND status = 'discrepancy_found';

-- ============================================================
-- CONTROLLED SUBSTANCE COUNTS (shift-to-shift count verification)
-- ============================================================
CREATE TABLE controlled_substance_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  count_date date NOT NULL,
  shift shift_type NOT NULL,
  count_type text NOT NULL,                      -- "shift_change", "admission", "destruction", "discrepancy_recount"

  expected_count integer NOT NULL,
  actual_count integer NOT NULL,
  discrepancy integer NOT NULL DEFAULT 0,        -- actual - expected (negative = missing)
  is_discrepancy boolean NOT NULL DEFAULT false,

  outgoing_staff_id uuid NOT NULL REFERENCES auth.users(id),
  incoming_staff_id uuid REFERENCES auth.users(id),  -- NULL for non-shift-change counts

  discrepancy_explanation text,
  discrepancy_resolved boolean DEFAULT true,
  discrepancy_resolved_by uuid REFERENCES auth.users(id),
  discrepancy_resolved_at timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_cs_counts_medication ON controlled_substance_counts(resident_medication_id, count_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_cs_counts_facility ON controlled_substance_counts(facility_id, count_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_cs_discrepancies ON controlled_substance_counts(facility_id) WHERE deleted_at IS NULL AND is_discrepancy = true AND discrepancy_resolved = false;

-- ============================================================
-- MEDICATION ERRORS (formal error reporting — distinct from eMAR refusal/hold)
-- ============================================================
CREATE TABLE medication_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  resident_medication_id uuid REFERENCES resident_medications(id),
  emar_record_id uuid REFERENCES emar_records(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  error_date date NOT NULL,
  error_time timestamptz NOT NULL,
  shift shift_type NOT NULL,
  discovered_by uuid NOT NULL REFERENCES auth.users(id),

  error_type text NOT NULL,                      -- "wrong_medication", "wrong_dose", "wrong_time", "wrong_resident", "wrong_route", "omission", "unauthorized_medication", "documentation_error", "other"
  severity text NOT NULL,                        -- "near_miss" (caught before reaching resident), "no_harm" (reached resident, no adverse effect), "minor_harm", "moderate_harm", "major_harm"
  description text NOT NULL,
  medication_involved text NOT NULL,
  dose_involved text,
  what_happened text NOT NULL,                   -- detailed narrative
  what_should_have_happened text NOT NULL,

  -- Involved staff
  involved_staff_id uuid REFERENCES auth.users(id),
  involved_staff_role staff_role,

  -- Contributing factors
  contributing_factors text[],                   -- ["similar_packaging", "interruption", "high_workload", "new_staff", "unclear_order", "system_error", "communication_failure", "staffing_shortage"]

  -- Response
  resident_assessed boolean NOT NULL DEFAULT false,
  resident_assessment_findings text,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  physician_orders text,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  administrator_notified boolean NOT NULL DEFAULT false,

  -- Root cause
  root_cause_analysis text,
  corrective_actions text[],
  training_triggered boolean NOT NULL DEFAULT false,
  policy_change_triggered boolean NOT NULL DEFAULT false,

  -- Insurance linkage
  linked_incident_id uuid,                       -- FK to incidents table if this error generates a formal incident
  insurance_reported boolean NOT NULL DEFAULT false,

  -- Resolution
  status text NOT NULL DEFAULT 'open',           -- "open", "investigating", "corrective_action", "closed"
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_med_errors_resident ON medication_errors(resident_id, error_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_facility ON medication_errors(facility_id, error_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_type ON medication_errors(facility_id, error_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_staff ON medication_errors(involved_staff_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_open ON medication_errors(facility_id) WHERE deleted_at IS NULL AND status != 'closed';

-- ============================================================
-- MEDICATION DESTRUCTION LOG
-- ============================================================
CREATE TABLE medication_destructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  destruction_date date NOT NULL,
  reason text NOT NULL,                          -- "discharge", "death", "discontinued", "expired", "damaged"
  medication_name text NOT NULL,
  medication_strength text,
  quantity_destroyed text NOT NULL,              -- "14 tablets", "1 bottle (120ml)"
  destruction_method text NOT NULL,              -- "pharmacy_return", "witnessed_disposal", "reverse_distribution"

  witnessed_by_1 uuid NOT NULL REFERENCES auth.users(id),
  witnessed_by_2 uuid NOT NULL REFERENCES auth.users(id),
  is_controlled boolean NOT NULL DEFAULT false,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_med_destructions_resident ON medication_destructions(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_destructions_facility ON medication_destructions(facility_id, destruction_date DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- PHYSICIAN ORDERS (order management workflow)
-- ============================================================
CREATE TABLE physician_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  order_date date NOT NULL,
  order_type text NOT NULL,                      -- "new_medication", "medication_change", "medication_discontinue", "lab", "imaging", "therapy", "diet_change", "activity_restriction", "other"
  physician_name text NOT NULL,
  physician_phone text,

  order_source text NOT NULL,                    -- "written", "verbal", "fax", "electronic", "hospital_discharge"
  verbal_order boolean NOT NULL DEFAULT false,
  verbal_order_read_back boolean,                -- required for verbal orders
  verbal_order_received_by uuid REFERENCES auth.users(id),
  cosignature_required boolean NOT NULL DEFAULT false,
  cosignature_received boolean DEFAULT false,
  cosignature_received_at timestamptz,
  cosignature_due_date date,                     -- verbal orders must be co-signed within regulatory timeframe (typically 72 hours in FL)

  order_text text NOT NULL,                      -- the actual order text
  transcribed boolean NOT NULL DEFAULT false,    -- has this been transcribed to the MAR/care plan
  transcribed_at timestamptz,
  transcribed_by uuid REFERENCES auth.users(id),

  linked_medication_id uuid REFERENCES resident_medications(id),  -- if this order created/modified a medication
  linked_document_id uuid REFERENCES resident_documents(id),      -- scanned order document

  status text NOT NULL DEFAULT 'received',       -- "received", "transcribed", "implemented", "cosign_pending", "completed", "cancelled"
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_phys_orders_resident ON physician_orders(resident_id, order_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_phys_orders_facility ON physician_orders(facility_id, order_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_phys_orders_cosign ON physician_orders(facility_id) WHERE deleted_at IS NULL AND cosignature_required = true AND cosignature_received = false;
CREATE INDEX idx_phys_orders_untranscribed ON physician_orders(facility_id) WHERE deleted_at IS NULL AND transcribed = false AND status = 'received';
```

---

## RLS POLICIES

```sql
-- Medication interactions is reference data — all authenticated users can read
ALTER TABLE medication_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated users read interactions" ON medication_interactions FOR SELECT USING (true);

ALTER TABLE medication_interaction_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see interaction alerts" ON medication_interaction_alerts FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage interaction alerts" ON medication_interaction_alerts FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE medication_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see reconciliations" ON medication_reconciliations FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage reconciliations" ON medication_reconciliations FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE controlled_substance_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see CS counts" ON controlled_substance_counts FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Caregivers+ create CS counts" ON controlled_substance_counts FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE medication_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin+ see medication errors" ON medication_errors FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage medication errors" ON medication_errors FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE medication_destructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see destructions" ON medication_destructions FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Nurse+ create destructions" ON medication_destructions FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE physician_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see orders" ON physician_orders FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Nurse+ manage orders" ON physician_orders FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- Audit triggers
CREATE TRIGGER audit_med_interaction_alerts AFTER INSERT OR UPDATE OR DELETE ON medication_interaction_alerts FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_med_reconciliations AFTER INSERT OR UPDATE OR DELETE ON medication_reconciliations FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_cs_counts AFTER INSERT OR UPDATE OR DELETE ON controlled_substance_counts FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_med_errors AFTER INSERT OR UPDATE OR DELETE ON medication_errors FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_med_destructions AFTER INSERT OR UPDATE OR DELETE ON medication_destructions FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_physician_orders AFTER INSERT OR UPDATE OR DELETE ON physician_orders FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON medication_interaction_alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON medication_reconciliations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON medication_errors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON physician_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Medication Interaction Checking

**Trigger:** INSERT or UPDATE on resident_medications WHERE status = 'active'

**Logic:**
1. Get all active medications for the resident
2. For each pair of active medications, query medication_interactions where (drug_a = med1.generic_name AND drug_b = med2.generic_name) OR (drug_a = med2.generic_name AND drug_b = med1.generic_name)
3. For each match found:
   - Check if a medication_interaction_alert already exists for this resident + this medication pair
   - If not → create new alert
   - If yes and status='resolved' (because one was previously discontinued and restarted) → create new alert
4. When a medication is discontinued: check all active alerts involving that medication → set status='resolved', resolved_at=now()

**Severity handling:**
- HIGH severity interaction → immediate alert to nurse + administrator. Block eMAR documentation with a warning (override available with nurse PIN).
- MODERATE → alert to nurse. eMAR shows warning but does not block.
- LOW → informational note on medication profile. No alert generated.

### Controlled Substance Count — Shift Change Protocol

**Trigger:** shift_handoffs being generated (Module 4 Edge Function `generate-shift-handoff`)

**Logic:**
1. Query all resident_medications at the facility where controlled_schedule != 'non_controlled' AND status = 'active'
2. For each controlled medication:
   - Calculate expected_count: last known count - doses administered since last count (from emar_records)
   - Generate controlled_substance_counts record with status pending (expected_count filled, actual_count blank)
3. Both outgoing and incoming staff must enter the actual_count
4. If actual_count ≠ expected_count → is_discrepancy = true → immediate Level 3 alert to administrator and nurse
5. Count cannot be completed (shift handoff cannot be acknowledged) until all controlled substance counts are reconciled

### Medication Error Categorization Auto-Rules

| Error Type | Auto-Severity Assessment |
|-----------|------------------------|
| wrong_resident | Minimum "no_harm" — always investigate regardless of outcome |
| wrong_medication | Minimum "no_harm" — check for adverse effects |
| wrong_dose (>2x ordered) | Minimum "minor_harm" — physician notification required |
| wrong_route | Minimum "minor_harm" |
| omission (missed dose) | "near_miss" if discovered within window, "no_harm" if discovered after |
| wrong_time (>2 hours off) | "near_miss" |
| documentation_error | "near_miss" |

### Verbal Order Co-Signature Tracking

- Florida requires verbal orders to be co-signed by the ordering physician within a defined timeframe
- Default: 72 hours (configurable per facility)
- cosignature_due_date = order_date + 3 days
- Alert at 48 hours if not received
- Alert at 72 hours (due date) — escalate to administrator
- Overdue co-signatures flagged on compliance dashboard (feeds Module 8)

### Medication Reconciliation Triggers

| Event | Reconciliation Type | Due |
|-------|-------------------|-----|
| New admission | `admission` | Within 24 hours of admission |
| Return from hospital | `hospital_return` | Within 24 hours of return |
| Quarterly care plan review | `quarterly` | At care plan review |
| After physician visit with order changes | `physician_visit` | Within 48 hours |

### Pharmacy Integration Preparation

Phase 2 does NOT include live pharmacy integration. It prepares the data model:
- `resident_medications.pharmacy_name` field already exists
- Add pharmacy reference table for future integration:

```sql
CREATE TABLE pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  address text,
  phone text,
  fax text,
  email text,
  contact_name text,
  system_type text,                              -- "FrameworkLTC", "PharMerica", "Omnicare", "other"
  integration_status text DEFAULT 'none',        -- "none", "pending", "active"
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE resident_medications ADD COLUMN pharmacy_id uuid REFERENCES pharmacies(id);
```

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/residents/:id/interaction-alerts` | Required | nurse, facility_admin | Active interaction alerts for resident |
| GET | `/facilities/:id/interaction-alerts` | Required | nurse, facility_admin | All active interaction alerts across facility |
| PUT | `/interaction-alerts/:id/acknowledge` | Required | nurse | Acknowledge alert |
| PUT | `/interaction-alerts/:id/override` | Required | nurse, facility_admin | Override with documented reason |
| GET | `/residents/:id/reconciliations` | Required | nurse, facility_admin | Reconciliation history |
| POST | `/residents/:id/reconciliations` | Required | nurse | Start reconciliation |
| PUT | `/reconciliations/:id` | Required | nurse | Update reconciliation (add discrepancies, complete) |
| GET | `/facilities/:id/controlled-counts/pending` | Required | caregiver, nurse | Pending controlled substance counts for current shift change |
| POST | `/controlled-substance-counts` | Required | caregiver, nurse | Submit count |
| GET | `/facilities/:id/controlled-counts/discrepancies` | Required | nurse, facility_admin | Unresolved discrepancies |
| GET | `/facilities/:id/medication-errors` | Required | nurse, facility_admin | Medication error list |
| POST | `/medication-errors` | Required | nurse, facility_admin | Report medication error |
| PUT | `/medication-errors/:id` | Required | nurse, facility_admin | Update (add root cause, corrective actions, close) |
| POST | `/residents/:id/medication-destructions` | Required | nurse | Document medication destruction |
| GET | `/residents/:id/physician-orders` | Required | nurse, caregiver | Physician order history |
| POST | `/residents/:id/physician-orders` | Required | nurse | Enter physician order |
| PUT | `/physician-orders/:id` | Required | nurse | Update (transcribe, record co-signature) |
| GET | `/facilities/:id/physician-orders/cosign-pending` | Required | nurse, facility_admin | Orders awaiting co-signature |
| GET | `/facilities/:id/physician-orders/untranscribed` | Required | nurse | Orders not yet transcribed to MAR |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `medication-interaction-check` | INSERT/UPDATE on resident_medications WHERE status='active' | Run interaction check for resident's full active medication list. Generate/resolve alerts. |
| `medication-interaction-resolve` | UPDATE on resident_medications WHERE status='discontinued' | Resolve any active interaction alerts involving this medication. |
| `controlled-substance-count-generate` | Called by `generate-shift-handoff` (Module 4) | Generate pending count records for all controlled medications at the facility. |
| `verbal-order-cosign-check` | Cron (8 AM ET daily) | Find physician_orders where verbal_order=true AND cosignature_required=true AND cosignature_received=false. Alert at 48h, escalate at 72h. |
| `medication-error-escalation` | INSERT on medication_errors | Based on severity → generate notifications (nurse, administrator, physician, owner). If severity ≥ "minor_harm" → auto-create incident record (Module 7) and link. |
| `reconciliation-trigger` | INSERT on admissions, UPDATE on residents WHERE status changed from 'hospital_hold' to 'active', care_plan_review completed | Generate medication_reconciliation record with appropriate type and due timeframe. |

---

## SEED DATA — MEDICATION INTERACTIONS

The medication_interactions table needs to be seeded with common drug interactions relevant to geriatric populations. Minimum viable dataset (200+ interactions):

**Priority drug classes for ALF populations:**
- Anticoagulants (warfarin) — interacts with nearly everything
- Diabetes medications (metformin, insulin, sulfonylureas)
- Antihypertensives (ACE inhibitors, ARBs, beta-blockers, calcium channel blockers, diuretics)
- Psychotropics (SSRIs, benzodiazepines, antipsychotics, mood stabilizers)
- Pain medications (acetaminophen, NSAIDs, tramadol, gabapentin)
- Cardiovascular (statins, digoxin, amiodarone)
- GI medications (PPIs, H2 blockers)
- Thyroid medications (levothyroxine)
- Osteoporosis medications (bisphosphonates, calcium)
- Antibiotics (common courses: fluoroquinolones, macrolides, penicillins)

**Source:** Use FDA's publicly available drug interaction data or a licensed interaction database. For Phase 2 MVP, manually curate the top 200 most clinically significant interactions in geriatric populations. Plan to integrate a commercial interaction database (Lexicomp, First Databank, Micromedex) in a later phase.

---

## UI SCREENS

### Web (Admin/Nurse)

| Screen | Route | Description |
|--------|-------|-------------|
| Medication Profile | `/residents/:id/medications` | Enhanced from Phase 1: now shows interaction alerts (red/yellow badges), reconciliation status, controlled substance count history. Linked physician orders. |
| Interaction Alert Dashboard | `/facilities/:id/medication-alerts` | All active interaction alerts across facility. Grouped by severity. Acknowledge/override actions. |
| Medication Reconciliation | `/residents/:id/reconciliation` | Side-by-side comparison: physician orders vs. facility MAR. Checkboxes for matching items. Flag discrepancies with resolution workflow. |
| Controlled Substance Dashboard | `/facilities/:id/controlled-substances` | Current inventory by medication. Count history. Unresolved discrepancies (red alert). |
| Medication Error Report | `/medication-errors/new` | Structured form: involved resident, medication, error type, severity, narrative fields, contributing factor checkboxes. |
| Medication Error Dashboard | `/facilities/:id/medication-errors` | Error list with filters. Trend chart: errors per month by type. Contributing factor analysis (which factors appear most frequently). |
| Physician Order Queue | `/facilities/:id/physician-orders` | Two tabs: "Untranscribed" (orders received but not yet on MAR) and "Co-Sign Pending" (verbal orders awaiting physician signature). |
| Medication Destruction Log | `/facilities/:id/medication-destructions` | Destruction records with dual-witness signatures. Filterable by date, resident, controlled status. |

### Mobile (Caregiver)

| Screen | Route | Description |
|--------|-------|-------------|
| Controlled Substance Count | `/shift/cs-count` | List of controlled medications needing count. Enter actual count per medication. Dual-signature requirement (both outgoing and incoming staff must complete). Discrepancy flagged immediately with required explanation field. |
| Interaction Warning (modal) | Appears in eMAR flow | When caregiver documents a medication with an active HIGH severity interaction → modal warning with interaction details and "Contact Nurse" button. Cannot dismiss without nurse override PIN for HIGH severity. |
