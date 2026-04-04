# 03 — Care Planning Advanced (Phase 2)

**Dependencies:** 00-foundation, 03-resident-profile (Phase 1), 04-daily-operations, 07-incident-reporting
**Build Week:** 13-14
**Scope authority:** `PHASE2-SCOPE.md` (Module 7 — Core/Enhanced/Future tiers)

---

## Phase 1 Foundation (already built — do not recreate)

- `care_plans` — versioned plans with status, review dates, approval fields
- `care_plan_items` — 15 categories, assistance levels, frequencies, interventions
- `assessments` — jsonb scores, risk_level, next_due_date
- `assessment_templates` — 4 seeded (Katz ADL, Morse Fall, Braden, PHQ-9) with structured items + risk_thresholds
- `residents.acuity_level`, `residents.acuity_score` — fields exist, not yet computed
- Business rules for acuity mapping, care plan review schedule, assessment scoring definitions

This spec adds **new tables** and **new UI** that extend the Phase 1 schema. Existing tables are not recreated here.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- CARE PLAN TASKS (generated from active care_plan_items)
-- ============================================================
CREATE TABLE care_plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_item_id uuid NOT NULL REFERENCES care_plan_items(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Scheduling
  task_date date NOT NULL,                       -- the calendar date this task is for
  scheduled_time time,                           -- NULL if "anytime during shift"; from care_plan_items.specific_times
  shift shift_type,                              -- morning, afternoon, evening, night — derived from scheduled_time or frequency

  -- Content (denormalized from care_plan_item for mobile perf)
  category care_plan_item_category NOT NULL,
  title text NOT NULL,                           -- "Bathing Assistance", "Fall Prevention Check"
  description text,                              -- care instruction summary
  assistance_level assistance_level NOT NULL,

  -- Completion
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'skipped', 'unable')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  completion_notes text,
  skip_reason text,                              -- required when status = 'skipped' or 'unable'

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_cpt_resident_date ON care_plan_tasks(resident_id, task_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_facility_date ON care_plan_tasks(facility_id, task_date, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_assignee_date ON care_plan_tasks(facility_id, task_date, shift) WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_cpt_item ON care_plan_tasks(care_plan_item_id) WHERE deleted_at IS NULL;

-- ============================================================
-- CARE PLAN REVIEW ALERTS (system-generated review prompts)
-- ============================================================
CREATE TABLE care_plan_review_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES care_plans(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Trigger
  trigger_type text NOT NULL
    CHECK (trigger_type IN (
      'quarterly_due',          -- review_due_date approaching (14 days)
      'quarterly_overdue',      -- review_due_date passed
      'acuity_change',          -- assessment changed acuity level
      'fall_incident',          -- fall incident reported for this resident
      'hospital_return',        -- resident returned from hospital
      'condition_change',       -- significant condition change documented
      'assessment_threshold',   -- assessment score crossed risk threshold
      'family_request'          -- family/RP requested review
    )),
  trigger_detail text,           -- e.g., "Morse Fall score changed from 30 to 55 (standard → high)"
  trigger_source_id uuid,        -- FK to the assessment, incident, or condition_change that triggered this

  -- Resolution
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_cpra_facility_status ON care_plan_review_alerts(facility_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpra_resident ON care_plan_review_alerts(resident_id) WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX idx_cpra_care_plan ON care_plan_review_alerts(care_plan_id) WHERE deleted_at IS NULL;

-- Deduplicate: one open alert per care_plan + trigger_type at a time
CREATE UNIQUE INDEX idx_cpra_dedup ON care_plan_review_alerts(care_plan_id, trigger_type)
  WHERE deleted_at IS NULL AND status IN ('open', 'acknowledged');

-- ============================================================
-- DB-LEVEL ENFORCEMENT (additions to existing Phase 1 tables)
-- ============================================================

-- Only one active care plan per resident (prevents app-layer race conditions)
CREATE UNIQUE INDEX idx_care_plans_one_active_per_resident ON care_plans(resident_id)
  WHERE deleted_at IS NULL AND status = 'active';
```

---

## RLS POLICIES

```sql
-- CARE PLAN TASKS
ALTER TABLE care_plan_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_care_plan_tasks ON care_plan_tasks
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() NOT IN ('family', 'broker', 'dietary', 'maintenance_role')
  );

-- Operational staff complete tasks (caregiver + nurse mark care delivered)
CREATE POLICY operational_staff_complete_care_plan_tasks ON care_plan_tasks
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse', 'caregiver')
  );

-- Admin override (facility_admin+ can update for corrections, but audit trail preserves who)
CREATE POLICY admin_override_care_plan_tasks ON care_plan_tasks
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Tasks are system-generated (INSERT via Edge Function or application logic), not user-created.
-- INSERT policy restricted to service_role. No direct user INSERT.
-- NOTE: The UI only shows "Complete/Skip/Unable" to nurse + caregiver roles.
-- Admin override exists for data correction but is not surfaced as a primary workflow.

-- CARE PLAN REVIEW ALERTS
ALTER TABLE care_plan_review_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_see_review_alerts ON care_plan_review_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() NOT IN ('family', 'broker', 'dietary', 'maintenance_role')
  );

CREATE POLICY nurse_plus_manage_review_alerts ON care_plan_review_alerts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Alerts are system-generated. INSERT via service_role only.

-- ASSESSMENTS INSERT — tighten per PHASE2-SCOPE role map
-- Phase 1 allows all clinical staff to INSERT assessments.
-- Phase 2 restricts Braden and PHQ-9 to nurse+.
-- This is enforced at application level (not RLS) because the
-- assessment_templates.required_role field already declares who can
-- administer each type. The UI checks this before rendering the form.
-- RLS remains: caregiver CAN insert assessments (for Katz ADL).

-- Apply audit triggers
CREATE TRIGGER audit_care_plan_tasks AFTER INSERT OR UPDATE OR DELETE ON care_plan_tasks
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_review_alerts AFTER INSERT OR UPDATE OR DELETE ON care_plan_review_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Apply updated_at trigger
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_plan_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Assessment Entry & Auto-Scoring

1. **Template-driven forms.** The UI renders the assessment form from `assessment_templates.items` jsonb. Each item has a key, label, and options array with numeric values.

2. **Auto-scoring.** On submit, the application:
   - Sums item values → `assessments.total_score`
   - Looks up `assessment_templates.risk_thresholds` to determine `assessments.risk_level`
   - Computes `assessments.next_due_date` = `assessment_date` + `assessment_templates.default_frequency_days`

3. **Role enforcement.** The UI checks `assessment_templates.required_role` against the current user's `app_role`. If the user's role is not in the array, the assessment type is not offered. Katz ADL allows `caregiver`; Braden and PHQ-9 do not.

4. **Score-change triggers.** After saving an assessment, compare the new `risk_level` to the most recent prior assessment of the same type for the same resident:
   - If risk_level worsened → create a `care_plan_review_alerts` row with `trigger_type = 'assessment_threshold'`
   - If assessment type is `katz_adl` and score changed → recalculate acuity (see below)
   - If assessment type is `morse_fall` and score changed → update `residents.fall_risk_level`

### Acuity Composite Scoring

Phase 1 defined the Katz-based acuity mapping (spec `03-resident-profile.md`). Phase 2 extends this to a **weighted composite**:

```
acuity_score = (katz_score × 10) + (morse_modifier) + (braden_modifier)

Where:
  katz_score     = latest Katz ADL total (0-6)
  morse_modifier = 0 if low, 3 if standard, 6 if high fall risk
  braden_modifier = 0 if none/mild, 2 if moderate, 4 if high, 6 if very high pressure risk

acuity_level:
  0-19  → level_1
  20-39 → level_2
  40-78 → level_3
```

**When updated:** After any Katz ADL, Morse Fall, or Braden assessment is saved.
**What happens:** `residents.acuity_score` and `residents.acuity_level` are updated. If `acuity_level` changed, a `care_plan_review_alerts` row is created with `trigger_type = 'acuity_change'`.

### Care Plan Editing & Versioning

1. **Creating a new version.** When a nurse edits an active care plan:
   - The current plan's status changes to `'archived'`
   - A new `care_plans` row is created with `version = previous.version + 1`, `previous_version_id = previous.id`, `status = 'draft'`
   - All active `care_plan_items` from the previous version are copied to the new plan
   - The nurse edits items on the new draft

2. **Approval workflow.** Draft → under_review → active:
   - `under_review`: nurse marks plan ready for approval
   - `active`: facility_admin or nurse with approval authority sets `approved_by`, `approved_at`, `status = 'active'`
   - When a plan becomes active, its `review_due_date` is set to `effective_date + 90 days`

3. **Only one active plan per resident.** Constraint enforced at application level: before activating a new version, the previous active version is archived.

### Care Plan Task Generation

Active `care_plan_items` with a `frequency` value generate daily tasks in `care_plan_tasks`.

**Frequency parsing rules:**

| `frequency` value | Tasks generated per day | `scheduled_time` source |
|-------------------|------------------------|------------------------|
| `"daily"` | 1 | First entry in `specific_times[]`, or NULL |
| `"2x daily"` / `"bid"` | 2 | First 2 entries in `specific_times[]`, or 08:00/20:00 default |
| `"3x daily"` / `"tid"` | 3 | First 3 entries in `specific_times[]`, or 08:00/14:00/20:00 default |
| `"every shift"` | 3 (one per shift) | shift = morning/afternoon/night; no specific time |
| `"weekly"` | 1 on the first matching day of the week | Uses `specific_times[0]` |
| `"every other day"` | 1 on alternating days from care plan `effective_date` | Uses `specific_times[0]` |
| `"as needed"` / `"prn"` | 0 (no auto-generation) | — |
| Other/NULL | 0 (no auto-generation) | — |

**Generation window:** Tasks are generated 2 days ahead (today + tomorrow). A daily Edge Function job runs at 00:05 facility local time.

**Deduplication:** Before inserting, check that no task exists for the same `care_plan_item_id` + `task_date` + `scheduled_time` combination.

**Item deactivation:** When a `care_plan_item.is_active` is set to false, pending tasks for future dates are soft-deleted.

### Quarterly Review Workflow

1. **14 days before `review_due_date`**: Create `care_plan_review_alerts` with `trigger_type = 'quarterly_due'`.
2. **On `review_due_date`**: Update alert to `trigger_type = 'quarterly_overdue'` if not resolved.
3. **Review checklist** (displayed in UI when alert is opened):
   - [ ] Review all current assessments (dates and scores)
   - [ ] Review ADL log trends for past 90 days
   - [ ] Review incident history for past 90 days
   - [ ] Review medication changes for past 90 days
   - [ ] Update care plan items as needed
   - [ ] Set new review date
   - [ ] Obtain approval signature
4. **Resolution:** When the nurse marks the review complete, alert status → `'resolved'`, and the care plan's `reviewed_at` and `reviewed_by` are updated.

### Care Plan State Transitions

```
draft → under_review       (nurse submits for approval)
under_review → active      (facility_admin or nurse approves)
under_review → draft       (approver returns with feedback)
active → archived          (only when a new version is activated, or resident discharged)
archived → (terminal)      (archived plans are immutable — no further transitions)
```

**Invariants:**
- A plan CANNOT go from `active` back to `draft`. To edit, create a new version.
- `archived` is immutable. No updates to archived plan rows (enforced by application; the audit trail is the safety net).
- The DB unique index `idx_care_plans_one_active_per_resident` prevents two active plans for the same resident.

### Task Mutation After Plan Changes

| Scenario | What happens to existing tasks |
|----------|-------------------------------|
| Care plan item `frequency` changes | Pending tasks for future dates tied to that item are soft-deleted. New tasks generated on next cron run. Tasks for today are not deleted (in-progress shift). |
| Care plan item deactivated (`is_active = false`) | Pending tasks for future dates soft-deleted. Completed tasks preserved. |
| Active plan archived + new version activated | All pending tasks tied to old plan's items are soft-deleted. New cron run generates tasks from new version's items. |
| Care plan item `specific_times` changes | Same as frequency change — future pending tasks regenerated. |
| Facility timezone changes | Next cron run uses new timezone. No retroactive adjustment. |

**Key rule:** The task generation cron always reads from the current active plan. If items changed after tasks were generated for tomorrow, the cron's dedup check will skip items that already have tasks, and the soft-delete of obsolete tasks ensures the new items take effect.

### Duplicate Review Alert Prevention

Only **one open or acknowledged alert** per `(care_plan_id, trigger_type)` at a time — enforced by the `idx_cpra_dedup` unique index.

| Scenario | Behavior |
|----------|----------|
| Second fall incident while first alert still open | No new `fall_incident` alert. The existing one remains. Nurse should address it. |
| Assessment worsens again while `assessment_threshold` alert open | No new alert. `trigger_detail` is NOT updated (preserves original trigger context). |
| Quarterly due alert already open, then plan goes overdue | The `check-review-alerts` cron updates the existing alert's `trigger_type` from `quarterly_due` to `quarterly_overdue` (same row, no duplicate). |
| Alert resolved, then new triggering event occurs | New alert is allowed (previous resolved alert no longer matches the unique index). |

### Permissions Map

| Action | owner | org_admin | facility_admin | nurse | caregiver | family |
|--------|-------|-----------|----------------|-------|-----------|--------|
| Create assessment (Katz ADL) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Create assessment (Morse, Braden, PHQ-9) | ✓ | ✓ | ✓ | ✓ | — | — |
| View assessment results | ✓ | ✓ | ✓ | ✓ | ✓ (read) | summary only |
| Create/edit care plan items | ✓ | ✓ | ✓ | ✓ | — | — |
| Submit plan for review (draft → under_review) | ✓ | ✓ | ✓ | ✓ | — | — |
| Approve plan (under_review → active) | ✓ | ✓ | ✓ | ✓ | — | — |
| Return plan (under_review → draft) | ✓ | ✓ | ✓ | ✓ | — | — |
| Complete/skip care plan task | — | — | — | ✓ | ✓ | — |
| Resolve review alert | ✓ | ✓ | ✓ | ✓ | — | — |
| View care plan | ✓ | ✓ | ✓ | ✓ | ✓ (read) | simplified |
| View task queue | — | — | — | ✓ | ✓ | — |

**Note on approval authority:** In Phase 2, any nurse or facility_admin can approve. There is no separate "approval authority" flag. If this needs to be restricted to specific nurses (e.g., DON only), a `can_approve_care_plans` boolean on `staff` or `user_profiles` can be added later without schema changes to `care_plans`.

### Family Visibility of Assessment Data

Family members see a **simplified summary only** on `/family/care-plan`:

- Latest assessment date and risk level per type (e.g., "Fall Risk: Standard — assessed 2026-03-15")
- NO individual item scores, NO raw scoring data
- NO access to the `assessments` table directly — the family care plan view assembles the summary server-side from data the family role cannot SELECT via RLS

This is consistent with Phase 1's family care plan view which already shows care plan items but not clinical scoring detail.

### Cross-Module Event Triggers (per PHASE2-SCOPE Appendix B)

| Event | Source | Action |
|-------|--------|--------|
| Fall incident created (`category IN ('fall_with_injury', 'fall_without_injury')`) | Module 07 | Create review alert with `trigger_type = 'fall_incident'`, `trigger_source_id = incident.id`. Flag Morse Fall reassessment as overdue by setting a new alert. |
| Assessment score crosses risk threshold | This module | Create review alert with `trigger_type = 'assessment_threshold'`. |
| Care plan `review_due_date` within 14 days | This module | Create review alert with `trigger_type = 'quarterly_due'`. |
| Care plan `review_due_date` passed | This module | Appear on compliance dashboard (Module 08). |
| Assessment `next_due_date` passed | This module | Appear on compliance dashboard (Module 08). |

---

## EDGE FUNCTIONS

### `generate-care-plan-tasks` (daily cron, 00:05 facility local time)

**Purpose:** Generate `care_plan_tasks` rows for today + tomorrow from active care plan items.

**Logic:**
1. Query all facilities (to get timezone)
2. For each facility, query active `care_plan_items` joined to active `care_plans` where `care_plans.status = 'active'` and `care_plan_items.is_active = true`
3. For each item, parse `frequency` and `specific_times` per the rules above
4. For each target date (today, tomorrow in facility TZ), check for existing task (dedup)
5. Insert new `care_plan_tasks` rows via service_role

**Failure mode:** If the function fails, tasks for today still exist from yesterday's run (2-day window). Alert on consecutive failures.

### `check-review-alerts` (daily cron, 06:00 facility local time)

**Purpose:** Generate quarterly review alerts for care plans approaching or past review_due_date.

**Logic:**
1. Query active `care_plans` where `review_due_date` is within 14 days AND no open alert exists with `trigger_type IN ('quarterly_due', 'quarterly_overdue')` for that plan
2. Create alerts for approaching plans (`quarterly_due`)
3. Query active `care_plans` where `review_due_date < today` AND existing alert is `quarterly_due`
4. Update those alerts to `quarterly_overdue`
5. Query `assessments` where `next_due_date < today` — flag as overdue (surfaced on compliance dashboard via query, no separate alert table needed)

---

## UI SCREENS

### Admin Shell

#### Assessment Entry (`/admin/residents/[id]/assessments/new`)

- **Desktop-first.** Complex multi-item form.
- **Flow:**
  1. Select assessment type from available templates (filtered by user's role vs. `required_role`)
  2. Form renders items from template jsonb — each item as a radio/select group
  3. Running total score displayed as items are answered
  4. Risk level badge updates live based on `risk_thresholds`
  5. Optional notes field
  6. Submit → auto-score → save → redirect to assessment result view
- **Validation:** All items required. Assessment date defaults to today, editable.

#### Assessment History (`/admin/residents/[id]/assessments`)

- **Desktop-first.** Table of past assessments for this resident.
- Columns: Date, Type, Score, Risk Level, Assessed By
- Filter by assessment type
- Click row → view detail (read-only scored form)
- **Enhanced:** Score trend chart (line graph per type over time)

#### Care Plan Editor (`/admin/residents/[id]/care-plan/edit`)

- **Desktop-first.** Edit care plan items for the active (or draft) plan.
- **Flow:**
  1. If active plan exists: "Create New Version" button → archives current, creates draft copy
  2. If draft exists: edit directly
  3. Add/edit/remove care plan items (category, title, description, assistance_level, frequency, specific_times, goal, interventions)
  4. "Submit for Review" → status = `under_review`
  5. Approver sees "Approve" button → sets approved_by/approved_at, status = `active`
- **Item form fields:**
  - Category (select from 15 enum values)
  - Title (text)
  - Description (textarea)
  - Assistance level (select: independent → total_dependence)
  - Frequency (select: daily, 2x daily, 3x daily, every shift, weekly, every other day, as needed)
  - Specific times (time picker array, shown when frequency is time-specific)
  - Goal (textarea)
  - Interventions (tag-style multi-entry)

#### Review Alerts Dashboard (`/admin/care-plans/reviews-due`)

- **Existing page** — enhance with data from `care_plan_review_alerts`.
- Show open alerts grouped by urgency: overdue (red), due within 7 days (amber), due within 14 days (yellow)
- Each row: Resident name, alert type, trigger detail, days until/past due
- Click → opens review workflow with checklist

### Caregiver Shell

#### Task Queue (`/caregiver/tasks`)

- **Existing page** — wire to `care_plan_tasks` data.
- **Mobile-first.** Card-based queue sorted by: overdue first, then by scheduled_time.
- Each card: Resident name + room, task title, assistance level badge, scheduled time (or "anytime this shift")
- Tap card → expand: description, interventions list
- Actions: "Complete" (→ status = completed, records completed_by + completed_at), "Skip" (requires skip_reason), "Unable" (requires skip_reason)
- Filter: All / Pending / Completed
- Shift selector: Morning / Afternoon / Night (filters by task.shift)

#### Care Plan Read View (`/caregiver/resident/[id]`)

- **Existing page** — no changes to structure. Care plan items already displayed.
- Ensure task completion status visible: "3 of 5 tasks completed today" badge.

### Family Shell

#### Care Plan Summary (`/family/care-plan`)

- **Existing page** — no schema changes. Already shows simplified care plan view.
- **Enhanced:** If assessment trend views are built, add a "Recent Assessments" summary (score + risk level, no raw item data) — respects `can_view_financial`-style permission if needed.

---

## ENHANCED TIER (build if time allows)

These features have schema designed above but UI may be deferred:

### Assessment Trend Views

- Line chart per assessment type showing score over time for a resident
- X-axis: assessment dates; Y-axis: score with risk threshold bands highlighted
- Displayed on the assessment history page as a toggle (table ↔ chart)
- Uses existing `assessments` table data; no new tables needed

### Score-Threshold Care Plan Suggestions

- When a review alert is created with `trigger_type = 'assessment_threshold'`, include specific suggestions:
  - Morse Fall score increased → suggest adding/updating fall_prevention care plan items
  - Braden score decreased → suggest adding skin_integrity care plan items
  - PHQ-9 score ≥ 10 → suggest adding cognitive/behavioral care plan items
- Suggestions are text in `trigger_detail`; not auto-applied to the care plan

### Quarterly Review Narrative Draft

- When a nurse opens a quarterly review, generate a narrative summary from 90-day structured data:
  - Assessment scores and changes
  - ADL log completion rates
  - Incident count and types
  - Medication changes
  - Condition changes
- Output as editable text in a textarea; nurse reviews and modifies before saving to `care_plans.notes`
- This is **data assembly**, not AI generation — concatenates structured facts into sentences

### Assessment Overdue Alerts on Dashboard

- Admin dashboard (`/admin`) shows a widget: "X assessments overdue" with count
- Query: `assessments` grouped by resident where `next_due_date < today` and no newer assessment of that type exists
- Click → navigates to overdue assessments list (existing `/admin/assessments/overdue` page)

---

## EXPLICIT NON-GOALS (Phase 2)

- **No AI-generated care plan narratives** — the narrative draft is structured data assembly, not LLM
- **No automated care plan creation** from assessment data — humans create and approve plans
- **No wound photo intelligence** — photo timeline exists from Phase 1; no analysis layer added
- **No predictive hospitalization risk** — requires data volume and model training
- **No new assessment template types** — Phase 2 uses the 4 seeded templates; adding MMSE or others is a schema-compatible future addition

---

## MIGRATION CHECKLIST

New migration file: `035_care_planning_advanced.sql`

1. Create `care_plan_tasks` table with indexes
2. Create `care_plan_review_alerts` table with indexes and dedup unique index
3. Add partial unique index `idx_care_plans_one_active_per_resident` on existing `care_plans` table
4. Enable RLS on both new tables
5. Create RLS policies (5 total: 3 on tasks, 2 on alerts)
6. Create audit triggers on both tables
7. Create `set_updated_at` trigger on `care_plan_tasks`

**Changes to existing tables:** One new index on `care_plans` (one-active-per-resident constraint). No column changes. The `residents.acuity_score` and `residents.acuity_level` fields already exist and will be updated by application logic after assessment saves.
