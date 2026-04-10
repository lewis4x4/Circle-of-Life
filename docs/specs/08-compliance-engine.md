# 08 — Compliance Engine (Phase 2)

**Dependencies:** ALL Phase 1 modules (00, 03, 04, 07, 11, 16), ALL Phase 2 modules (03-adv, 06, 09)
**Build Week:** 19-20
**Scope authority:** `PHASE2-SCOPE.md` (Module 10 — Core/Enhanced/Future tiers)

---

## Design Principle

The compliance engine is a **cross-cutting read layer** over existing operational data. It does NOT duplicate data from other modules. It adds tables for: deficiency tracking, plans of correction, policy documents, and compliance rules. Dashboard views are computed from queries across the full schema.

This module has the **highest scope-creep risk** in Phase 2. The spec deliberately limits Core scope to what can be built in 2 weeks. See explicit non-goals.

---

## Phase 1 + Phase 2 Foundation (data this module reads)

| Source | What compliance reads | How |
|--------|---------------------|-----|
| `assessments` | Overdue assessments (next_due_date < today) | Query |
| `care_plans` | Overdue reviews (review_due_date < today, status = active) | Query |
| `care_plan_review_alerts` | Open review alerts | Query |
| `incidents` | Open follow-ups past due | Join `incident_followups` |
| `infection_surveillance` | Active infection count | Query |
| `infection_outbreaks` | Active outbreak count | Query |
| `staff_certifications` | Expiring within 30 days | Query |
| `verbal_orders` | Unsigned past 48hr | Query |
| `medication_errors` | Error count (current period) | Query |
| `emar_records` | PRN effectiveness compliance rate | Query |

No changes to any of these tables. Compliance reads them directly.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- SURVEY DEFICIENCIES (citations from state/federal surveys)
-- ============================================================
CREATE TABLE survey_deficiencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Survey context
  survey_date date NOT NULL,
  survey_type text NOT NULL
    CHECK (survey_type IN ('routine', 'complaint', 'follow_up', 'change_of_ownership', 'other')),
  surveyor_name text,
  surveyor_agency text NOT NULL DEFAULT 'AHCA',  -- "AHCA", "CMS", "fire_marshal", "other"

  -- Deficiency
  tag_number text NOT NULL,                      -- AHCA Form 3020 tag, e.g., "Tag 220", "Tag 417"
  tag_description text NOT NULL,                 -- "Personal Care", "Adequate Care"
  severity text NOT NULL
    CHECK (severity IN ('minor', 'standard', 'serious', 'immediate_jeopardy')),
  scope text NOT NULL DEFAULT 'isolated'
    CHECK (scope IN ('isolated', 'pattern', 'widespread')),
  description text NOT NULL,                     -- specific finding

  -- NOTE: No poc_id here. The relationship lives on plans_of_correction.deficiency_id only.
  -- One canonical FK direction avoids circular references.
  -- To find the POC for a deficiency: JOIN plans_of_correction ON deficiency_id.

  -- Status
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'poc_submitted', 'poc_accepted', 'corrected', 'verified', 'recited')),
  corrected_at timestamptz,
  verified_at timestamptz,                       -- follow-up survey confirmed correction

  -- Follow-up
  follow_up_survey_date date,
  follow_up_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_deficiencies_facility ON survey_deficiencies(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_deficiencies_status ON survey_deficiencies(facility_id, status) WHERE deleted_at IS NULL AND status NOT IN ('verified', 'corrected');
CREATE INDEX idx_deficiencies_tag ON survey_deficiencies(tag_number) WHERE deleted_at IS NULL;

-- ============================================================
-- PLANS OF CORRECTION (formal regulatory response)
-- ============================================================
CREATE TABLE plans_of_correction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deficiency_id uuid NOT NULL REFERENCES survey_deficiencies(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Plan content
  corrective_action text NOT NULL,               -- what was changed
  policy_changes text,                           -- policies updated
  monitoring_plan text,                          -- how ongoing compliance will be monitored
  responsible_party text NOT NULL,               -- name/title of person accountable
  monitoring_frequency text,                     -- "weekly chart audits for 90 days", "daily for 30 days"

  -- Timeline
  submission_due_date date NOT NULL,             -- typically survey_date + 10 calendar days
  submitted_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id),
  completion_target_date date NOT NULL,          -- when corrective action will be fully implemented

  -- Review
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected', 'revised')),
  reviewer_notes text,                           -- AHCA feedback if rejected
  accepted_at timestamptz,

  -- Evidence
  evidence_description text,                     -- what evidence was provided
  evidence_document_ids uuid[],                  -- FKs to policy_documents or resident_documents

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_poc_deficiency ON plans_of_correction(deficiency_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_poc_facility_status ON plans_of_correction(facility_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_poc_due ON plans_of_correction(submission_due_date) WHERE deleted_at IS NULL AND status = 'draft';

-- One active POC per deficiency (revisions create new rows with status='revised' on the old one)
CREATE UNIQUE INDEX idx_poc_one_active_per_deficiency ON plans_of_correction(deficiency_id)
  WHERE deleted_at IS NULL AND status NOT IN ('rejected', 'revised');

-- ============================================================
-- POLICY DOCUMENTS (versioned facility policies)
-- ============================================================
CREATE TABLE policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Document
  title text NOT NULL,                           -- "Medication Administration Policy"
  category text NOT NULL
    CHECK (category IN (
      'resident_rights',
      'admission',
      'care_delivery',
      'medication',
      'incident_reporting',
      'infection_control',
      'emergency_preparedness',
      'staffing',
      'dietary',
      'maintenance',
      'privacy_hipaa',
      'grievance',
      'other'
    )),
  content text NOT NULL,                         -- Markdown or plain text body
  version integer NOT NULL DEFAULT 1,
  previous_version_id uuid REFERENCES policy_documents(id),

  -- Lifecycle
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),

  -- Acknowledgment requirement
  requires_acknowledgment boolean NOT NULL DEFAULT true,
  acknowledgment_due_days integer NOT NULL DEFAULT 10,  -- days after publish to acknowledge

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_policy_docs_facility ON policy_documents(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_policy_docs_category ON policy_documents(facility_id, category) WHERE deleted_at IS NULL AND status = 'published';

-- ============================================================
-- POLICY ACKNOWLEDGMENTS (staff sign-off on policies)
-- ============================================================
CREATE TABLE policy_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_document_id uuid NOT NULL REFERENCES policy_documents(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  acknowledged_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_policy_ack_unique ON policy_acknowledgments(policy_document_id, user_id);
CREATE INDEX idx_policy_ack_user ON policy_acknowledgments(user_id);
CREATE INDEX idx_policy_ack_document ON policy_acknowledgments(policy_document_id);

-- ============================================================
-- SURVEY VISIT SESSIONS (one row per survey visit)
-- ============================================================
CREATE TABLE survey_visit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Session lifecycle
  activated_by uuid NOT NULL REFERENCES auth.users(id),  -- owner or facility_admin only
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users(id),

  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_svs_facility ON survey_visit_sessions(facility_id, activated_at DESC);
-- Only one active session per facility at a time
CREATE UNIQUE INDEX idx_svs_one_active ON survey_visit_sessions(facility_id)
  WHERE deactivated_at IS NULL;

-- ============================================================
-- SURVEY VISIT LOG ENTRIES (each document accessed during a visit)
-- ============================================================
CREATE TABLE survey_visit_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES survey_visit_sessions(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- What was accessed
  accessed_by uuid NOT NULL REFERENCES auth.users(id),  -- admin or nurse who pulled the record
  accessed_at timestamptz NOT NULL DEFAULT now(),
  record_type text NOT NULL
    CHECK (record_type IN ('resident_chart', 'staff_record', 'policy_document', 'incident', 'medication', 'assessment', 'care_plan', 'daily_logs', 'other')),
  record_id uuid,                                -- FK to the accessed record (polymorphic)
  record_description text NOT NULL,              -- human-readable: "Eleanor Martinez — Care Plan v3"

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_svle_session ON survey_visit_log_entries(session_id);
CREATE INDEX idx_svle_facility ON survey_visit_log_entries(facility_id, accessed_at DESC);
```

### Implementation note (repository)

- **Canonical survey visit model:** `survey_visit_sessions` plus `survey_visit_log_entries` (one row per access, append-only). Any older single-table sketch with a JSONB `documents_accessed` array is superseded; this split model is the **canonical** implementation for auditability and concurrency.
- **Active POC (uniqueness):** `idx_poc_one_active_per_deficiency` applies to rows whose `status` is **`draft`, `submitted`, or `accepted`** (rows with `rejected` or `revised` are excluded so multiple historical rejected POCs may exist; resubmission creates a new row per workflow rules above).
- **Triggers in shipped migrations:** Use `public.haven_capture_audit_log()` and `public.haven_set_updated_at()` from `006_audit_triggers.sql`, not generic `audit_trigger_function` / `set_updated_at` placeholders.

---

## RLS POLICIES

```sql
-- SURVEY DEFICIENCIES
ALTER TABLE survey_deficiencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_deficiencies ON survey_deficiencies
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY admin_manage_deficiencies ON survey_deficiencies
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Nurse can view deficiencies (read-only for clinical awareness)
CREATE POLICY nurse_see_deficiencies ON survey_deficiencies
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() = 'nurse'
  );

-- PLANS OF CORRECTION
ALTER TABLE plans_of_correction ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_poc ON plans_of_correction
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY admin_manage_poc ON plans_of_correction
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- POLICY DOCUMENTS
ALTER TABLE policy_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY all_staff_see_published_policies ON policy_documents
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      status = 'published'
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
    )
  );

CREATE POLICY admin_manage_policies ON policy_documents
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- POLICY ACKNOWLEDGMENTS
ALTER TABLE policy_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_own_acknowledgments ON policy_acknowledgments
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND (user_id = auth.uid() OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin'))
  );

CREATE POLICY staff_create_own_acknowledgments ON policy_acknowledgments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND user_id = auth.uid()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- Admin can view all acknowledgments for compliance reporting
CREATE POLICY admin_see_all_acknowledgments ON policy_acknowledgments
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- SURVEY VISIT SESSIONS
ALTER TABLE survey_visit_sessions ENABLE ROW LEVEL SECURITY;

-- Only admin can activate/deactivate sessions
CREATE POLICY admin_manage_visit_sessions ON survey_visit_sessions
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Nurse can see sessions (knows when survey mode is active)
CREATE POLICY nurse_see_visit_sessions ON survey_visit_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() = 'nurse'
  );

-- SURVEY VISIT LOG ENTRIES
ALTER TABLE survey_visit_log_entries ENABLE ROW LEVEL SECURITY;

-- Admin + nurse can see and create log entries (nurses assist during surveys)
CREATE POLICY admin_nurse_see_log_entries ON survey_visit_log_entries
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY admin_nurse_create_log_entries ON survey_visit_log_entries
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    AND accessed_by = auth.uid()
  );

-- Log entries are append-only — no UPDATE or DELETE policies for anyone.

-- Audit + updated_at triggers (Haven: public.haven_capture_audit_log / public.haven_set_updated_at)
CREATE TRIGGER tr_survey_deficiencies_set_updated_at
  BEFORE UPDATE ON survey_deficiencies
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
CREATE TRIGGER tr_survey_deficiencies_audit
  AFTER INSERT OR UPDATE OR DELETE ON survey_deficiencies
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE TRIGGER tr_plans_of_correction_set_updated_at
  BEFORE UPDATE ON plans_of_correction
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
CREATE TRIGGER tr_plans_of_correction_audit
  AFTER INSERT OR UPDATE OR DELETE ON plans_of_correction
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE TRIGGER tr_policy_documents_set_updated_at
  BEFORE UPDATE ON policy_documents
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
CREATE TRIGGER tr_policy_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON policy_documents
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE TRIGGER tr_policy_acknowledgments_audit
  AFTER INSERT ON policy_acknowledgments
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE TRIGGER tr_survey_visit_sessions_audit
  AFTER INSERT OR UPDATE ON survey_visit_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE TRIGGER tr_survey_visit_log_entries_audit
  AFTER INSERT ON survey_visit_log_entries
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
```

---

## BUSINESS RULES

### Compliance Dashboard Tiles

The dashboard is the primary deliverable. It aggregates operational data into a single view. **Minimum tiles required for Phase 2 success criteria:**

| Tile | Data source | Query logic |
|------|-------------|-------------|
| **Overdue Assessments** | `assessments` | Count distinct (resident_id, assessment_type) where `next_due_date < today` and no newer assessment of that type exists. Group by type. |
| **Overdue Care Plan Reviews** | `care_plans` | Count where `status = 'active'` and `review_due_date < today`. |
| **Open Incident Follow-Ups** | `incident_followups` | Count where `status != 'completed'` and `due_date < today`. |
| **Active Infections** | `infection_surveillance` | Count where `status IN ('suspected', 'confirmed')`. Red badge if outbreak active. |
| **Expiring Staff Certifications** | `staff_certifications` | Count where `expiration_date` is within 30 days and `deleted_at IS NULL`. |
| **Open Deficiencies** | `survey_deficiencies` | Count where `status NOT IN ('verified', 'corrected')`. |

Each tile: count + trend indicator (up/down vs. last period) + click to drill-down list.

### Deficiency Tracking Workflow

1. **Entry.** After a survey, facility_admin enters deficiency citations:
   - Survey date, type, surveyor info
   - For each citation: tag number, description, severity, scope, specific finding

2. **Plan of Correction.** For each deficiency:
   - `submission_due_date` auto-set to `survey_date + 10 calendar days`
   - Admin drafts: corrective action, policy changes, monitoring plan, responsible party, completion target date
   - Draft → submitted (to AHCA, tracked in system) → accepted/rejected
   - If rejected: admin revises and resubmits

3. **Monitoring.** After POC accepted:
   - System tracks monitoring activities against the stated plan
   - When corrective action fully implemented: mark deficiency `corrected`
   - After follow-up survey confirms: mark `verified`
   - If recited on follow-up: mark `recited` (triggers new deficiency)

### Deficiency & POC State Transitions

**Deficiency lifecycle:**

```
open → poc_submitted       (POC drafted and submitted to AHCA)
poc_submitted → poc_accepted   (AHCA accepts the plan)
poc_submitted → open           (AHCA rejects POC — admin must revise; old POC marked 'rejected')
poc_accepted → corrected       (facility implements correction; corrected_at set)
corrected → verified           (follow-up survey confirms; verified_at set)
corrected → recited            (follow-up survey re-cites the same tag — creates a NEW deficiency row linked to the follow-up survey)
verified → (terminal)          (verified deficiencies are immutable)
```

**POC revision rules:**
- A deficiency has at most **one active POC** (enforced by `idx_poc_one_active_per_deficiency`)
- If AHCA rejects a POC: set its status to `'rejected'`, then create a new `plans_of_correction` row with `status = 'draft'` for the same deficiency
- The old rejected POC is preserved for audit trail
- If a deficiency is `recited`: a new `survey_deficiencies` row is created for the new survey. The original deficiency remains at `recited` status. This is intentional — each survey citation is its own record.

**Invariants:**
- `corrected` cannot go back to `open` (to re-open, create a new deficiency)
- `verified` is terminal
- A deficiency's status should reflect the latest POC status: `poc_submitted` when the active POC is submitted, etc.

### Policy Acknowledgment Eligibility

**Who must acknowledge:** All users with an active `user_facility_access` row for the facility where the policy is published AND whose `app_role` is not `family` or `broker`.

**Specifically:**
- Staff with roles: owner, org_admin, facility_admin, nurse, caregiver, dietary, maintenance_role
- NOT family or broker (they are not staff and should not see internal policies)

**Multi-facility staff:** If a policy is published at Facility A, only staff with access to Facility A are required to acknowledge. Staff who also have access to Facility B are not double-counted.

**Acknowledgment tracking:** The dashboard shows `X of Y acknowledged` where Y = count of eligible users at the facility at time of query (not a frozen snapshot — staff changes are reflected live).

**Overdue determination:** A policy acknowledgment is overdue if `published_at + acknowledgment_due_days < today` AND no `policy_acknowledgments` row exists for that user + policy.

### Survey Visit Mode Permissions

| Action | Permitted roles | Notes |
|--------|----------------|-------|
| Activate session | owner, facility_admin | High-privilege; logged with `activated_by` |
| Search and retrieve records | owner, facility_admin, nurse | Nurse assists admin during survey |
| Log entries auto-created | owner, facility_admin, nurse | Each record pull creates a `survey_visit_log_entries` row with `accessed_by = auth.uid()` |
| Deactivate session | owner, facility_admin | Same roles as activation |
| View session history | owner, org_admin, facility_admin | Post-survey audit trail |

**Nurses cannot activate or deactivate** survey visit mode. They can use the search interface while it's active and their access is logged. This keeps activation as an admin-level decision while allowing nurses to assist with the actual chart pulls.

### Survey Visit Mode The core UX challenge is fast, cross-table search under pressure.

1. **Activation.** Owner or facility_admin activates via a prominent button on the compliance dashboard.
   - Creates `survey_visit_sessions` row
   - System enters "survey mode" — a session-level flag stored in the facility store
   - Only one active session per facility at a time (enforced by `idx_svs_one_active`)

2. **Search interface.** When active, a search overlay appears on the admin shell:
   - **Resident search:** Type name → autocomplete → select → immediate access to:
     - Care plan (current + history)
     - Assessment history (all types)
     - Medication list (active + discontinued)
     - eMAR records (last 90 days)
     - Daily logs (last 90 days)
     - Incident history
     - Behavioral logs
     - Condition changes
   - **Staff search:** Type name → access to:
     - Certifications + expiration dates
     - Training records (Phase 2 does not have training module — show certs only)
     - Time records
   - **Policy search:** Type title or category → pull published policy with acknowledgment status
   - **Date-range search:** Pull all documentation for a date range across a resident or facility

3. **Performance target.** p95 < 3 seconds for any single-resident chart retrieval on local dev. Each search creates a `survey_visit_log_entries` row for audit trail (append-only, no UPDATE/DELETE).

4. **Deactivation.** Admin deactivates when surveyor leaves. `deactivated_at` and `deactivated_by` recorded on the session.

### Policy & Procedure Library

1. **Creation.** Facility_admin creates a policy document:
   - Title, category, content (Markdown), version
   - Status: draft → published
   - When published: `published_at` set, acknowledgment clock starts

2. **Versioning.** To update a published policy:
   - Create new version (previous version archived, `previous_version_id` linked)
   - New version published → new acknowledgment cycle starts

3. **Acknowledgment.**
   - After publish, all staff at the facility must acknowledge within `acknowledgment_due_days`
   - Staff see a banner/notification: "New policy: [Title] — read and acknowledge"
   - Staff reads content, taps "I have read and understood this policy" → creates `policy_acknowledgments` row
   - Dashboard tracks: X of Y staff have acknowledged. Overdue acknowledgments highlighted.

4. **Survey readiness.** When surveyor asks for a policy:
   - Survey visit mode search → finds by title or category
   - Shows: current version, publish date, acknowledgment status (X/Y staff)

### Cross-Module Event Triggers (per PHASE2-SCOPE Appendix B)

All triggers flow **into** this module (compliance reads, doesn't write to other modules):

| Event | Source | Action on compliance dashboard |
|-------|--------|-------------------------------|
| Assessment overdue | 03-adv | Increment overdue assessments tile |
| Care plan review overdue | 03-adv | Increment overdue reviews tile |
| Active infection count change | 09 | Update infections tile |
| Staff certification expiring | 11 (Phase 1) | Increment expiring certs tile |
| Incident follow-up past due | 07 (Phase 1) | Increment open follow-ups tile |
| Medication error recorded | 06 | Increment errors tile (Enhanced) |
| Verbal order unsigned past 48hr | 06 | Surface on compliance alerts (Enhanced) |

---

## EDGE FUNCTIONS

No dedicated Edge Functions for this module. All data is computed on page load from existing tables. The `check-review-alerts` cron from Module 03 Advanced already surfaces assessment and care plan overdue items.

If compliance dashboard load performance becomes an issue, a materialized view or periodic aggregation cron can be added. This is an optimization, not a Core requirement.

---

## UI SCREENS

### Admin Shell

#### Compliance Dashboard (`/admin/compliance`)

- **Desktop-first.** Primary compliance overview.
- **6 summary tiles** (see Business Rules above) with counts, trend arrows, and drill-down links
- **Active deficiencies section:** Table of open deficiencies with tag, severity, status, POC due date
- **Survey visit mode button:** Prominent activation control (red when active)
- **Quick links:** Policy library, deficiency entry, staff cert report

#### Deficiency Entry (`/admin/compliance/deficiencies/new`)

- **Desktop-first.** Multi-deficiency entry form for post-survey data entry.
- Survey header: date, type, surveyor name/agency
- Add deficiency rows: tag number (with autocomplete for common tags), description, severity, scope, finding text
- Submit → creates `survey_deficiencies` rows, auto-generates POC shell with due dates

#### Deficiency Detail (`/admin/compliance/deficiencies/[id]`)

- **Desktop-first.** Full deficiency record with Plan of Correction.
- Shows: tag, finding, severity/scope, survey context
- POC section: draft/edit corrective action, policy changes, monitoring plan, responsible party, timeline
- Status progression: open → poc_submitted → poc_accepted → corrected → verified
- Evidence attachment: link to policy documents or other records

#### Policy Library (`/admin/compliance/policies`)

- **Desktop-first** for management; **mobile-friendly** for read + acknowledge.
- List of published policies grouped by category
- Each row: title, category, version, published date, acknowledgment status (X/Y staff)
- Click → full policy content with "Acknowledge" button (if not yet acknowledged)
- Admin actions: Create New, Edit (creates new version), Archive

#### Policy Editor (`/admin/compliance/policies/new` or `/admin/compliance/policies/[id]/edit`)

- **Desktop-first.** Markdown editor for policy content.
- Fields: title, category, content (rich text or Markdown), acknowledgment required (toggle), due days
- Preview mode before publish
- Publish → archives previous version, starts acknowledgment clock

#### Survey Visit Mode Overlay

- **Desktop-first.** When active, adds a persistent search bar to the admin shell header.
- Search input with type selector: Resident / Staff / Policy / Date Range
- Results appear in a panel below with links to relevant records
- Each access logged as a `survey_visit_log_entries` row (append-only)
- Deactivate button in the overlay header

### Caregiver/Staff Shell

#### Policy Acknowledgment (`/caregiver/me` or via notification)

- **Mobile.** Banner on `/caregiver/me` if pending acknowledgments exist.
- "X policies need your review"
- Tap → list of unacknowledged policies
- Tap policy → read content → "I have read and understood this policy" button → acknowledge

---

## ENHANCED TIER ✅ IMPLEMENTED

### Rule-Based Compliance Scoring (10-15 high-value AHCA tags) ✅

- ✅ Define `compliance_rules` for a focused set of commonly cited tags:
  - Tag 220 (Personal Care): are ADL care plans current? Are daily ADL logs present for assigned residents?
  - Tag 417 (Adequate Care): PRN effectiveness documented? Condition changes reported within timeframe?
  - Tag 502 (Infection Control): infection surveillance records present? Staff illness tracking active?
  - Tag 201 (Resident Rights): rights violations documented and addressed
  - Tag 205 (Grievance): grievances logged and resolved
  - Tag 309 (Staffing): staffing ratios maintained
  - Tag 314 (Staff Training): training records current
  - Tag 325 (Background Screening): background screenings current
  - Tag 404 (Resident Assessment): assessments completed on schedule
  - Tag 409 (Care Plan Updates): care plans reviewed and updated
  - Tag 501 (Medication Admin): medication administration documented
  - Tag 504 (Medication Errors): error rate below threshold
  - Tag 601 (Physical Plant): facility maintenance current
  - Tag 602 (Emergency Prep): emergency drills and checks completed
  - Tag 701 (Dietary): dietary assessments and needs met
- ✅ Each rule: tag number, description, SQL query that returns pass/fail, severity if failing
- ✅ RPC function `execute_compliance_rule()` safely executes queries server-side
- ✅ Dashboard shows: pass/fail per tag with drill-down to specific non-compliant records

**Migrations:**
- `124_compliance_rules.sql` - Core schema and 3 initial rules
- `127_compliance_rule_executor.sql` - RPC function for safe query execution
- `128_compliance_rules_expanded.sql` - 9 additional AHCA tag rules

### Compliance Reminders & Task Generation ✅

- ✅ Weekly digest: "3 assessments overdue, 2 care plan reviews due, 1 POC submission due Friday"
- ✅ Surface on admin dashboard as an action card with links
- ✅ Reminder types: weekly_digest, poc_due, assessment_overdue, care_plan_review_due, policy_acknowledgment_overdue
- ✅ Dismiss functionality for pending reminders

**Files:**
- `src/lib/compliance-reminders.ts` - Reminder generation and management functions
- `src/app/(admin)/admin/compliance/page.tsx` - Reminder UI cards on dashboard

### Historical Deficiency Analysis ✅

- ✅ Chart: deficiency count by tag over time (which tags get cited most?)
- ✅ Recurrence tracking: was this tag cited before? When was it corrected? How long was the gap?
- ✅ LineChart for trend analysis by tag over time
- ✅ BarChart for most-cited tags
- ✅ Table showing recurrence details with gap tracking

**Files:**
- `src/lib/deficiency-analysis.ts` - Analysis functions (already existed)
- `src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx` - Analysis UI with charts

### Emergency Preparedness Checklist ✅

- ✅ Structured tracking: generator tests (monthly), fire drills (quarterly), evacuation drills
- ✅ Each with date, participants, notes, next due date
- ✅ Dashboard widget: "Next fire drill due in X days"

**Migrations:**
- `125_emergency_preparedness.sql` - Emergency checklist tables and seed data

**Files:**
- `src/app/(admin)/admin/compliance/emergency-preparedness/page.tsx` - Full emergency checklist UI

### Bug Fixes ✅

Three bugs in migration 124 have been fixed:

**Migration 129_compliance_bugfixes.sql:**
- ✅ Fixed index on `compliance_scans` that referenced non-existent `deleted_at` column
- ✅ Fixed RLS policy on `compliance_reminders` that referenced non-existent `user_id` column
- ✅ Added `updated_at` column to `compliance_scans` table for trigger compatibility

---

## EXPLICIT NON-GOALS (Phase 2)

- **No exhaustive AHCA Form 3020 tag mapping** — focus on 10-15 high-value tags if Enhanced tier is reached, not 100+
- **No AI mock survey engine** — requires deep compliance mapping maturity first
- **No AI-generated Plans of Correction** — admin writes POCs; system provides data
- **No regulatory change monitoring** — no automated tracking of Florida Administrative Code updates
- **No automated compliance narratives** — dashboard shows data; human interprets

---

## MIGRATION CHECKLIST

New migration file: `039_compliance_engine.sql` (after `038_infection_control.sql`)

1. Create `survey_deficiencies` table with indexes (no `poc_id` column — relationship lives on POC side)
2. Create `plans_of_correction` table with indexes + unique constraint (`idx_poc_one_active_per_deficiency`)
3. Create `policy_documents` table with indexes
4. Create `policy_acknowledgments` table with unique index
5. Create `survey_visit_sessions` table with indexes + unique constraint (`idx_svs_one_active`)
6. Create `survey_visit_log_entries` table with indexes (append-only)
7. Enable RLS on all 6 tables
8. Create RLS policies (15 total: 3 deficiencies, 2 POC, 2 policy_documents, 3 policy_acknowledgments, 3 survey_visit_sessions, 2 survey_visit_log_entries)
9. Create audit triggers using `public.haven_capture_audit_log()` on all 6 tables (see `006_audit_triggers.sql`)
10. Create `public.haven_set_updated_at()` triggers on `survey_deficiencies`, `plans_of_correction`, `policy_documents`

---

## COL Alignment Notes

**AHCA license seeding required at launch:** COL has 5 facilities, each with an AHCA Assisted Living Facility license. These license numbers, expiration dates, and facility-specific license categories (standard, limited nursing, extended congregate care) must be seeded into the compliance engine's facility configuration at Oakridge ALF pilot launch. License documents are NOT yet in the wiki — they must be collected from COL before this module can be initialized correctly.

**Survey history gap:** COL's most recent AHCA survey reports (Statement of Deficiencies) and any open Plans of Correction are not in the wiki. The compliance engine's baseline score cannot be set without this historical deficiency data. Before the pilot, request: (1) last 3 years of SOD reports for Oakridge ALF, (2) any currently open POC for any facility.

**Florida AHCA tag set:** The spec already seeds Florida AHCA survey tags. Verify the tag set matches the current AHCA ALF survey protocol (AHCA Form 3020) — the applicable regulatory chapter is FL §429 and FAC 59A-36. The compliance engine tag library should be reviewed against COL's most recent survey findings to ensure the tags they've historically been cited under are present.

**Master Quality Assurance Tool:** COL uses a `Master Quality Assurance Tool.xlsx` for internal QA audits across all 5 facilities. The compliance engine's mock survey feature should be able to export results in a format compatible with COL's existing QA review process. Consider adding a QA export that maps Haven compliance scores to COL's existing audit categories.
