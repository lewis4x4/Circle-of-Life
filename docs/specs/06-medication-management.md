# 06 — Medication Management Advanced (Phase 2)

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations (Phase 1 eMAR), 07-incident-reporting
**Build Week:** 15-16
**Scope authority:** `PHASE2-SCOPE.md` (Module 8 — Core/Enhanced/Future tiers)

---

## Phase 1 Foundation (already built — do not recreate)

- `resident_medications` — full prescription model with controlled_schedule, PRN fields, status lifecycle
- `emar_records` — Given/Refused/Held with PRN effectiveness tracking fields
- eMAR queue UI in caregiver shell with one-tap Given/Refused
- Edge Functions defined: `generate-emar-schedule`, `emar-missed-dose-check`, `prn-effectiveness-check`
- Business rules: 1-hour admin window, 2-hour missed-dose flag, PRN effectiveness timing
- Controlled substance count fields exist conceptually; no count table or verification workflow

This spec adds **new tables** for verbal orders, medication errors, and controlled substance counts, plus **new UI** for PRN follow-up prompts and admin medication oversight.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- VERBAL ORDERS (phone/verbal orders requiring co-signature)
-- ============================================================
CREATE TABLE verbal_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Order content
  order_type text NOT NULL
    CHECK (order_type IN ('new_medication', 'dose_change', 'frequency_change', 'discontinue', 'diet_change', 'activity_restriction', 'lab_order', 'other')),
  order_text text NOT NULL,                      -- verbatim order as received
  indication text,                               -- clinical reason for the order
  prescriber_name text NOT NULL,                 -- physician/NP/PA who gave the order
  prescriber_phone text,

  -- Receipt
  received_by uuid NOT NULL REFERENCES auth.users(id),  -- nurse who took the order
  received_at timestamptz NOT NULL DEFAULT now(),
  read_back_confirmed boolean NOT NULL DEFAULT false,    -- nurse read back the order

  -- Co-signature (required within 48 hours per Florida regulation)
  -- NOTE: The physician does NOT log into Haven. A staff member records receipt
  -- of the physician's external signature (fax, portal, in-person).
  cosignature_status text NOT NULL DEFAULT 'pending'
    CHECK (cosignature_status IN ('pending', 'signed', 'expired')),
  cosigned_by uuid REFERENCES auth.users(id),    -- staff user who RECORDED the co-signature receipt (not the physician)
  cosigned_at timestamptz,                        -- when the staff member recorded the receipt
  physician_signed_date date,                     -- the date on the physician's actual signature (may differ from cosigned_at)
  cosignature_due_at timestamptz NOT NULL,        -- received_at + 48 hours

  -- Linked medication change (if order_type involves medication)
  linked_medication_id uuid REFERENCES resident_medications(id),

  -- Resolution
  implemented boolean NOT NULL DEFAULT false,
  implemented_by uuid REFERENCES auth.users(id),
  implemented_at timestamptz,
  implementation_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_verbal_orders_resident ON verbal_orders(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_verbal_orders_facility_pending ON verbal_orders(facility_id, cosignature_status)
  WHERE deleted_at IS NULL AND cosignature_status = 'pending';
CREATE INDEX idx_verbal_orders_due ON verbal_orders(cosignature_due_at)
  WHERE deleted_at IS NULL AND cosignature_status = 'pending';

-- ============================================================
-- MEDICATION ERRORS (structured error capture for trending)
-- ============================================================
CREATE TABLE medication_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Classification
  error_type text NOT NULL
    CHECK (error_type IN (
      'wrong_medication',
      'wrong_dose',
      'wrong_time',
      'wrong_resident',
      'wrong_route',
      'omission',
      'unauthorized_medication',
      'documentation_error',
      'other'
    )),
  severity text NOT NULL DEFAULT 'near_miss'
    CHECK (severity IN ('near_miss', 'no_harm', 'minor_harm', 'moderate_harm', 'severe_harm')),

  -- Context
  emar_record_id uuid REFERENCES emar_records(id),
  resident_medication_id uuid REFERENCES resident_medications(id),
  linked_incident_id uuid,                       -- FK to incidents if harm occurred (Module 07)
  occurred_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  discovered_by uuid NOT NULL REFERENCES auth.users(id),

  -- Description
  description text NOT NULL,                     -- what happened
  contributing_factors text[],                   -- ["transcription", "communication", "distraction", "staffing", "similar_packaging", "similar_names", "workflow_interruption"]
  immediate_actions text NOT NULL,               -- what was done to address it

  -- Follow-up
  root_cause text,                               -- determined during review
  corrective_actions text,                       -- what will prevent recurrence
  reviewed_by uuid REFERENCES auth.users(id),    -- nurse who reviewed the error
  reviewed_at timestamptz,

  -- Physician notification (required if harm occurred)
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_med_errors_facility ON medication_errors(facility_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_resident ON medication_errors(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_type ON medication_errors(facility_id, error_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_med_errors_severity ON medication_errors(facility_id, severity) WHERE deleted_at IS NULL AND severity NOT IN ('near_miss', 'no_harm');

-- ============================================================
-- CONTROLLED SUBSTANCE COUNTS (shift-to-shift reconciliation)
-- ============================================================
CREATE TABLE controlled_substance_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Count context
  count_date date NOT NULL,
  shift shift_type NOT NULL,                     -- shift being ended (outgoing)
  count_type text NOT NULL DEFAULT 'shift_change'
    CHECK (count_type IN ('shift_change', 'initial_receipt', 'destruction', 'discrepancy_recount')),

  -- Quantities
  expected_count integer NOT NULL,               -- system-calculated from last count minus doses given
  actual_count integer NOT NULL,                 -- physically counted
  discrepancy integer NOT NULL DEFAULT 0,        -- actual - expected (0 = balanced)

  -- Signatures (dual-signature required)
  outgoing_staff_id uuid NOT NULL REFERENCES auth.users(id),
  outgoing_signed_at timestamptz NOT NULL DEFAULT now(),
  incoming_staff_id uuid REFERENCES auth.users(id),       -- NULL until incoming signs
  incoming_signed_at timestamptz,

  -- Discrepancy resolution
  discrepancy_resolved boolean DEFAULT true,     -- false when discrepancy != 0
  resolution_notes text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_csc_medication ON controlled_substance_counts(resident_medication_id, count_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_csc_facility_date ON controlled_substance_counts(facility_id, count_date, shift) WHERE deleted_at IS NULL;
CREATE INDEX idx_csc_discrepancy ON controlled_substance_counts(facility_id)
  WHERE deleted_at IS NULL AND discrepancy != 0 AND discrepancy_resolved = false;
```

---

## RLS POLICIES

```sql
-- VERBAL ORDERS
ALTER TABLE verbal_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_verbal_orders ON verbal_orders
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY nurse_plus_create_verbal_orders ON verbal_orders
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY nurse_plus_update_verbal_orders ON verbal_orders
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- MEDICATION ERRORS
ALTER TABLE medication_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_medication_errors ON medication_errors
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Reporters can see their own submitted errors (for follow-up context)
CREATE POLICY reporter_see_own_medication_errors ON medication_errors
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND discovered_by = auth.uid()
  );

CREATE POLICY clinical_staff_create_medication_errors ON medication_errors
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

CREATE POLICY nurse_plus_update_medication_errors ON medication_errors
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- CONTROLLED SUBSTANCE COUNTS
ALTER TABLE controlled_substance_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_counts ON controlled_substance_counts
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

-- Only med-pass-capable roles can originate counts (actual med-cart workflow)
CREATE POLICY med_staff_create_counts ON controlled_substance_counts
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse', 'caregiver')
  );

CREATE POLICY nurse_plus_update_counts ON controlled_substance_counts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Audit triggers
CREATE TRIGGER audit_verbal_orders AFTER INSERT OR UPDATE OR DELETE ON verbal_orders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_medication_errors AFTER INSERT OR UPDATE OR DELETE ON medication_errors
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_controlled_substance_counts AFTER INSERT OR UPDATE OR DELETE ON controlled_substance_counts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON verbal_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON medication_errors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Verbal Order Workflow

1. **Capture.** Nurse receives verbal/phone order from physician. Opens verbal order form:
   - Selects resident, order type, types verbatim order text
   - Records prescriber name, indication
   - Confirms read-back (`read_back_confirmed = true`)
   - `cosignature_due_at` auto-set to `received_at + 48 hours`

2. **Implementation.** After capturing:
   - If `order_type = 'new_medication'`: nurse creates a new `resident_medications` row and links via `linked_medication_id`
   - If `order_type = 'dose_change'` or `'frequency_change'`: nurse updates the existing medication and links it
   - If `order_type = 'discontinue'`: nurse sets medication to `status = 'discontinued'`
   - Marks `implemented = true` with timestamp

3. **Co-signature countdown.**
   - At 24 hours: alert to facility_admin + nurse ("Verbal order #X unsigned — 24 hours remaining")
   - At 48 hours: if still pending, set `cosignature_status = 'expired'`. Alert to facility_admin ("Verbal order #X expired without physician co-signature — regulatory risk")
   - Co-signature is tracked in this system (facility_admin records that the physician signed the faxed/portal copy) — the physician does not log into Haven directly

4. **Regulatory context.** Florida requires physician co-signature of verbal/telephone orders within a timeframe defined by facility policy (typically 48 hours). Failure to obtain timely co-signature is a survey deficiency.

### PRN Effectiveness Follow-Up (Phase 2 enhancement of Phase 1 rule)

Phase 1 defined the rule; Phase 2 adds the caregiver-facing prompt.

1. **Trigger.** When a PRN eMAR record is created with `status = 'given'` and the medication has `prn_effectiveness_check_minutes` set:
   - The caregiver shell displays a pending follow-up card on `/caregiver/prn-followup` at `actual_time + prn_effectiveness_check_minutes`

2. **Prompt.** The card shows:
   - Resident name, medication name, time given, reason given
   - Time since administration (live countdown/up)
   - Three-option response: Effective / Partially Effective / Not Effective
   - Notes field
   - Submit → updates `emar_records`: `prn_effectiveness_checked = true`, `prn_effectiveness_time`, `prn_effectiveness_result`, `prn_effectiveness_notes`

3. **Overdue escalation.** If not documented within `prn_effectiveness_check_minutes + 30 minutes`:
   - Alert to nurse on duty: "PRN follow-up overdue for [Resident] — [Medication] given at [time]"
   - The existing `prn-effectiveness-check` Edge Function (Phase 1) handles this cron

### Medication Error Capture & Classification

1. **Reporting.** Any clinical staff (caregiver, nurse, admin) can report an error via a structured form:
   - Select resident, error type (from enum), severity
   - Link to specific eMAR record if applicable
   - Describe what happened, immediate actions taken
   - Select contributing factors (multi-select from predefined list)
   - If severity is `moderate_harm` or `severe_harm`: physician notification is required (checkbox + timestamp)

2. **Review.** Nurse reviews the error:
   - Adds root cause analysis
   - Documents corrective actions
   - Marks as reviewed (`reviewed_by`, `reviewed_at`)
   - If harm occurred, links to an incident report (`linked_incident_id`)

3. **Trending.** Admin dashboard shows:
   - Errors per month by type (bar chart)
   - Errors by shift (morning/afternoon/night distribution)
   - Top contributing factors (frequency count)
   - Severity distribution
   - Filter by facility, date range

4. **No-blame culture note.** Error reports are for quality improvement. Individual caregiver names are visible to nurse + admin for follow-up but are NOT displayed on trending dashboards. The trending view shows aggregate patterns only.

### Controlled Substance Count Workflow

This is the highest-complexity workflow in this module. See PHASE2-SCOPE.md "hidden complexity" callout.

1. **When counts happen.** At every shift change for each active controlled substance medication:
   - Outgoing staff initiates count
   - System calculates `expected_count` = last count's `actual_count` minus doses given (from `emar_records`) since last count
   - Outgoing staff enters `actual_count` (physical count of pills/patches/vials)
   - System calculates `discrepancy = actual_count - expected_count`

2. **Dual-signature flow.** This happens on a single device at the med cart:
   - **Step 1:** Outgoing staff logs in, selects "Controlled Substance Count"
   - **Step 2:** System lists all controlled meds for the facility with expected counts
   - **Step 3:** Outgoing staff enters actual count for each, signs (outgoing_staff_id + outgoing_signed_at recorded)
   - **Step 4:** Incoming staff authenticates on the same screen (enters their credentials — NOT a session switch, just a credential verification via Supabase `signInWithPassword` that returns the incoming user's ID without disrupting the current session)
   - **Step 5:** `incoming_staff_id` and `incoming_signed_at` recorded. Count is complete.

3. **Discrepancy handling.**
   - If `discrepancy = 0` for all meds: count completes normally
   - If `discrepancy != 0`: `discrepancy_resolved = false`. Level 3 alert to facility_admin + nurse
   - Resolution: facility_admin or nurse investigates, documents `resolution_notes`, sets `discrepancy_resolved = true`
   - Common resolutions: "Dose given but not documented — eMAR updated", "Pill dropped — witnessed destruction", "Count error — recount confirmed balance"

4. **UX constraint.** This must work on mobile (med cart tablet). The dual-signature step is the tricky part — incoming staff must be able to authenticate without logging out the outgoing staff. Implementation: a modal that collects email + password, validates via a service-role RPC that returns the authenticated user_id without creating a session.

### Incoming Co-Sign Credential Verification — Safety Requirements

The controlled-substance dual-signature flow requires a second user to authenticate without disrupting the outgoing user's session. This is the **highest-risk implementation area** in this module. The following constraints are mandatory:

**What the RPC endpoint MUST do:**
1. Accept email + password
2. Call `supabase.auth.signInWithPassword()` server-side (Edge Function or service-role RPC)
3. Verify the returned user has `app_role IN ('nurse', 'caregiver')` and has facility access for the current facility
4. Return ONLY: `{ verified: true, user_id: uuid, display_name: text }` on success, or `{ verified: false }` on failure
5. Do NOT return a session token, JWT, or refresh token to the client

**What the RPC endpoint MUST NOT do:**
- Store the incoming user's password anywhere (not in logs, not in the request body beyond the auth call)
- Create a persistent session for the incoming user
- Return any auth token to the client
- Allow roles other than nurse/caregiver to co-sign (admin can resolve discrepancies, not perform counts)
- Accept the outgoing user's own credentials as the incoming co-sign

**Client-side constraints:**
- The credential modal collects email + password in a form that is NOT persisted to state or localStorage
- After the RPC returns, the password field is cleared immediately
- The outgoing user's session remains active throughout
- If the RPC fails (wrong password, wrong role, wrong facility), show a clear error and allow retry

**Alternative implementation (if Supabase auth patterns make the above impractical):**
- Use a PIN-based verification: each staff member sets a 4-6 digit PIN in their profile
- Co-sign flow collects staff email + PIN instead of full password
- PIN verified against a hashed value in `user_profiles` or `staff`
- This avoids touching Supabase auth entirely and may be simpler to implement safely
- Decision deferred to implementation, but either approach must meet the safety constraints above

### Controlled Substance Eligibility Rules

**Which medications require the count workflow:**
- All `resident_medications` where `controlled_schedule != 'non_controlled'` AND `status = 'active'`
- Includes Schedule II through V (opioids, benzodiazepines, stimulants, etc.)

**Form factor handling in Phase 2:**
- **Tablets/capsules:** Count individual units
- **Liquid medications:** Record volume remaining (mL) — entered as a numeric value, not a unit count
- **Patches:** Count patches on hand (unused) — applied patches tracked via eMAR
- **Other forms:** Record quantity on hand with unit description in notes

**Phase 2 assumptions (edge cases deferred unless encountered):**
- Late charting after a count: if an eMAR record is backdated to before the most recent count, the expected count on the NEXT count will self-correct (it always recomputes from last count minus documented doses)
- Voided/corrected eMAR records: corrections flow through the audit trail; the expected count formula reads current eMAR records (not deleted ones), so corrections auto-adjust
- Newly received medications mid-shift: recorded as a `controlled_substance_counts` row with `count_type = 'initial_receipt'` and `actual_count` = quantity received
- Partial-dose waste: documented in eMAR `notes` field ("0.5mg wasted, witnessed by [name]"); count decrements by 1 full unit. Formal waste log is Enhanced tier.
- Destruction events: `count_type = 'destruction'`, `actual_count = 0`, requires dual signature

### Verbal Order State Transitions

```
pending → signed          (staff records receipt of physician co-signature)
pending → expired         (48 hours elapsed without co-signature)
expired → signed          (late co-signature received — allowed, but flagged in audit)
```

**Implementation status is independent of co-signature status:**
- An order can be `implemented = true` while `cosignature_status = 'pending'` (nurse implements the order immediately, physician co-signs later)
- An order can be `cosignature_status = 'signed'` while `implemented = false` (physician signed but nurse hasn't updated the medication list yet — should be rare)
- Both `implemented` and `cosigned` are required for the order to be fully resolved

### Medication Error Reporter Visibility

- **Reporters (caregiver) can see their own submitted errors** — enforced by `reporter_see_own_medication_errors` RLS policy using `discovered_by = auth.uid()`
- **Reporters cannot edit after submission** — no UPDATE policy for caregiver role on medication_errors
- **Reporters can provide follow-up context** by messaging the reviewing nurse (via existing family-messages or direct communication — no new messaging channel needed)
- **Nurse review is the edit point** — root cause, corrective actions, and classification are nurse+ only

### Cross-Module Event Triggers (per PHASE2-SCOPE Appendix B)

| Event | Source | Action |
|-------|--------|--------|
| PRN eMAR record created (`is_prn = true`, `status = 'given'`) | This module | Schedule follow-up prompt at `actual_time + prn_effectiveness_check_minutes` |
| PRN effectiveness = 'not_effective' (2nd occurrence, same resident + medication, within 24hr) | This module | Alert to nurse (Enhanced tier) |
| Verbal order created | This module | Start 48-hour co-signature countdown; alert at 24hr and 48hr |
| Controlled substance count discrepancy (`discrepancy != 0`) | This module | Level 3 alert to facility_admin + nurse |
| Medication error with `severity IN ('moderate_harm', 'severe_harm')` | This module | Increment error count on compliance dashboard (Module 08) |

---

## EDGE FUNCTIONS

Phase 1 already defines these cron functions — Phase 2 does not add new Edge Functions. The existing Phase 1 functions cover all required automation:

| Function | Phase 1 spec | Phase 2 change |
|----------|-------------|----------------|
| `generate-emar-schedule` | Midnight daily | No change |
| `emar-missed-dose-check` | Every 30 min | No change |
| `prn-effectiveness-check` | Every 15 min | No change — already generates reminder + escalation |

**Verbal order co-signature alerts** are handled by the `check-review-alerts` Edge Function from Module 03 Advanced, extended to also query `verbal_orders WHERE cosignature_status = 'pending'` and check against 24hr/48hr thresholds. This avoids creating a separate cron for one query.

---

## UI SCREENS

### Admin Shell

#### Medication Profile (`/admin/residents/[id]/medications`)

- **Desktop-first.** Full medication list for a resident.
- **Existing data** from Phase 1 `resident_medications` — this adds the UI.
- Tabs: Active | Discontinued | All
- Table columns: Medication, Strength/Form, Route, Frequency, Scheduled Times, Controlled (badge), Prescriber, Start Date
- Row click → detail view with order history
- "Add Verbal Order" button → opens verbal order form (nurse+ only)
- "Discontinue" action on each row (nurse+ only)

#### Verbal Orders Queue (`/admin/medications/verbal-orders`)

- **Desktop-first.** List of pending verbal orders across the facility.
- Columns: Resident, Order, Prescriber, Received By, Received At, Co-Sig Due, Status
- Urgency badges: green (>24hr remaining), amber (≤24hr remaining), red (expired)
- Click → detail with implementation status and co-signature controls
- Filter: Pending | Signed | Expired

#### Medication Error Entry (`/admin/medications/errors/new`)

- **Desktop-first.** Structured error report form.
- Fields: Resident (select), Error Type (select), Severity (select), linked eMAR record (optional search), Description (textarea), Immediate Actions (textarea), Contributing Factors (multi-select checkboxes), Physician Notified (checkbox + timestamp)
- Submit → saves, routes to confirmation

#### Medication Error Dashboard (`/admin/medications/errors`)

- **Desktop-first.** Trending and analysis.
- Summary cards: Total errors this month, errors by severity, most common type
- Charts: Errors per month (bar), errors by shift (pie), contributing factors (horizontal bar)
- Table: Recent errors with filters (date range, type, severity, facility)
- Click row → error detail with review status
- **No individual caregiver names on trending views** — aggregate only

#### Controlled Substance Report (`/admin/medications/controlled`)

- **Desktop-first.** Audit trail view.
- List of all controlled substance counts, filterable by date, medication, shift
- Highlights discrepancies in red
- Click → count detail with signatures and resolution

### Caregiver Shell

#### PRN Follow-Up Queue (`/caregiver/prn-followup`)

- **Mobile-first.** Existing page — wire to real data.
- Cards for each PRN dose given where `prn_effectiveness_checked = false`:
  - Resident name, medication name + strength, time given, reason
  - Time since administration (live)
  - Due indicator: "Check now" (past check time), "Due in X min" (approaching)
- Tap card → expand with response options:
  - Effective / Partially Effective / Not Effective (radio)
  - Notes (textarea)
  - Submit → updates eMAR record

#### Controlled Substance Count (`/caregiver/clock` or `/caregiver/controlled-count`)

- **Mobile-first.** Accessed during shift handoff, typically at the med cart.
- **Flow:**
  1. System lists all controlled substances for the facility with `expected_count`
  2. For each medication: resident name, medication name, schedule, expected count, input field for actual count
  3. Outgoing staff enters counts, taps "Sign & Submit"
  4. "Incoming Staff Verification" modal appears:
     - Email + password fields
     - "Verify & Co-Sign" button
     - Validates credentials via RPC (does NOT create a session)
     - Records `incoming_staff_id` + `incoming_signed_at`
  5. If all counts balance: success screen, return to clock
  6. If discrepancy: red alert banner, discrepancy rows highlighted, count still saved, alert fired to facility_admin

### Enhanced Medication Profile (`/caregiver/resident/[id]`)

- **Mobile.** Existing resident profile page.
- Add "Medications" section showing active medication count and list (name + schedule only, not full detail)
- Tap "Open eMAR" navigates to `/caregiver/meds` (existing)

---

## ENHANCED TIER (build if time allows)

### PRN Ineffectiveness Escalation

- When `prn_effectiveness_result = 'not_effective'` is recorded for the same resident + medication for a second time within 24 hours:
  - Auto-generate alert to nurse: "PRN [medication] ineffective for second time in 24hr for [Resident] — consider physician notification"
- Application-level logic: query recent eMAR records on effectiveness save

### Med-Pass Exception Handling

- Improve eMAR queue UI for statuses beyond Given/Refused:
  - "Held" (with hold_reason select: NPO, physician hold, other)
  - "Not Available" (with reason: awaiting pharmacy, out of stock)
  - "Self-Administered" (witnessed + documented)
- These status options exist in the Phase 1 schema but have no UI

### Refusal/Late-Pass/Error Dashboards

- Admin dashboard widgets:
  - Refusal rate by medication type (which meds are most refused?)
  - Late administration rate by shift
  - Medication error rate per 1,000 doses administered

### Medication Destruction Log

- When a medication is discontinued or resident is discharged:
  - Optional "Destruction" flow: what drug, quantity destroyed, destruction method (flush, sharps, return to pharmacy), two witnesses
  - Stored as a `controlled_substance_counts` row with `count_type = 'destruction'` and `actual_count = 0`

---

## EXPLICIT NON-GOALS (Phase 2)

- **No pharmacy integration** — no electronic orders, no refill tracking, no external vendor connection
- **No drug-drug interaction checking** — no drug database, no contraindication screening
- **No barcode scanning** — no medication packaging barcode infrastructure
- **No dosing validation** — no age/weight/renal function-based dose checking
- **No electronic prescribing** — physicians do not log into Haven; orders are captured by nurses

---

## MIGRATION CHECKLIST

New migration file: `037_medication_management_advanced.sql` (repo uses `036` for care plan alerts; use next free prefix at implementation time)

1. Create `verbal_orders` table with indexes
2. Create `medication_errors` table with indexes
3. Create `controlled_substance_counts` table with indexes
4. Enable RLS on all 3 tables
5. Create RLS policies (10 total: 3 verbal_orders, 4 medication_errors, 3 controlled_substance_counts)
6. Create audit triggers on all 3 tables using **`public.haven_capture_audit_log`** and **`public.haven_set_updated_at`** (not `audit_trigger_function` / `set_updated_at` placeholders)
7. Create `updated_at` triggers on `verbal_orders` and `medication_errors` via Haven helpers; add `updated_by` columns where `haven_set_updated_at` applies

No changes to existing `resident_medications` or `emar_records` tables — the Phase 1 schema already has all needed fields.

## COL Alignment Notes

**Baya partnership — critical integration point:** COL uses Baya as an external medication management oversight and training partner (active contract confirmed). The medication management spec models an in-house medication program. Key points for COL alignment:
- Baya may review medication orders or provide oversight — clarify whether Baya has any role in the Haven medication workflow (order review, MAR audit) or is purely a training vendor.
- If Baya has an API or data export, Module 06 should accept Baya training completion data to update staff medication competency status in Module 12.
- Collect the full Baya contract scope of services before finalizing the medication oversight workflow.

**COL medication forms mapped to spec:**
- `Medication Order Form.pdf` → physician_orders table
- `Medication Order Form Cover Sheet.pdf` → order transmittal tracking
- `Back of MOR.pdf` → MAR reverse-side documentation (notes, refusals, initials)
- `Narcotic Count Log.pdf` → controlled_substance_counts table
- `Disposal Log.Pharmacy.pdf` → medication_destructions (pharmacy return)
- `Disposal Log.Onsite.pdf` → medication_destructions (on-site disposal)

All six forms should be fully digitalized by Module 06. Staff should not need to maintain paper versions after Haven deployment.

**Medication audit tool:** COL uses a `Medication Audit.xlsx` for periodic compliance auditing of medication management. Module 06's compliance reporting should produce an equivalent digital audit view so administrators can run medication audits from Haven without maintaining a separate spreadsheet.
