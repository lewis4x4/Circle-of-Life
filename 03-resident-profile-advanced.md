# 03-Advanced — Resident Profile & Care Planning (Advanced Features)

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations, 07-incident-reporting
**Build Week:** 13-14
**Phase:** 2

This spec extends Module 3 with features that require data from Modules 4 and 7 to exist. The core resident profile and care plan tables are already created in Phase 1. This phase adds: acuity auto-calculation, care plan task generation engine, assessment scheduling automation, decline trajectory detection, and the care plan review workflow with AI-generated draft support.

---

## DATABASE SCHEMA (New Tables)

```sql
-- ============================================================
-- CARE PLAN TASKS (auto-generated daily tasks from care plan items)
-- ============================================================
CREATE TABLE care_plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_item_id uuid NOT NULL REFERENCES care_plan_items(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  task_date date NOT NULL,
  shift shift_type NOT NULL,
  scheduled_time time,                           -- specific time if care plan item has specific_times
  task_type text NOT NULL,                       -- mirrors care_plan_item_category: "bathing", "mobility", "medication_assistance", etc.
  description text NOT NULL,                     -- human-readable: "Assist Mrs. Johnson with ambulation using rolling walker to dining room"
  assigned_to uuid REFERENCES auth.users(id),    -- caregiver assigned to this resident for this shift

  status text NOT NULL DEFAULT 'pending',        -- "pending", "completed", "refused", "skipped", "not_applicable"
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  completion_notes text,
  refused_reason text,
  skipped_reason text,

  linked_adl_log_id uuid REFERENCES adl_logs(id),          -- links to actual documentation
  linked_emar_record_id uuid REFERENCES emar_records(id),   -- for medication-related tasks

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_cpt_resident_date ON care_plan_tasks(resident_id, task_date, shift) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_assigned ON care_plan_tasks(assigned_to, task_date, shift) WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_cpt_facility_date ON care_plan_tasks(facility_id, task_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_incomplete ON care_plan_tasks(facility_id, task_date, shift) WHERE deleted_at IS NULL AND status = 'pending';

-- ============================================================
-- ASSESSMENT SCHEDULE (recurring assessment schedule per resident)
-- ============================================================
CREATE TABLE assessment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  assessment_type text NOT NULL,                 -- "katz_adl", "morse_fall", "braden", "phq9", "weight", "vitals"
  frequency_days integer NOT NULL,               -- 90 for quarterly, 30 for monthly, 7 for weekly
  last_completed_date date,
  next_due_date date NOT NULL,
  assigned_to uuid REFERENCES auth.users(id),    -- default assessor (usually primary nurse)
  is_active boolean NOT NULL DEFAULT true,

  -- Override frequency for specific residents
  override_reason text,                          -- "Increased frequency due to recent fall"
  overridden_by uuid REFERENCES auth.users(id),
  overridden_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_assess_sched_resident ON assessment_schedules(resident_id) WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_assess_sched_due ON assessment_schedules(facility_id, next_due_date) WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_assess_sched_overdue ON assessment_schedules(facility_id) WHERE deleted_at IS NULL AND is_active = true AND next_due_date < CURRENT_DATE;

-- ============================================================
-- ACUITY HISTORY (tracks acuity changes over time for trending)
-- ============================================================
CREATE TABLE acuity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  assessment_id uuid NOT NULL REFERENCES assessments(id),
  assessment_date date NOT NULL,
  katz_score integer NOT NULL,
  previous_katz_score integer,
  acuity_level acuity_level NOT NULL,
  previous_acuity_level acuity_level,
  level_changed boolean NOT NULL DEFAULT false,

  -- Decline detection
  is_decline boolean NOT NULL DEFAULT false,     -- true if score increased (more dependent)
  is_improvement boolean NOT NULL DEFAULT false,  -- true if score decreased (more independent)
  consecutive_decline_count integer NOT NULL DEFAULT 0,  -- how many consecutive assessments showed decline

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_acuity_history_resident ON acuity_history(resident_id, assessment_date DESC);
CREATE INDEX idx_acuity_history_decline ON acuity_history(facility_id) WHERE is_decline = true;

-- ============================================================
-- DECLINE TRAJECTORY ALERTS
-- ============================================================
CREATE TABLE decline_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  alert_type text NOT NULL,                      -- "acuity_decline", "weight_loss", "fall_frequency", "hospitalization_risk", "behavioral_escalation", "medication_refusal_pattern", "activity_withdrawal"
  severity text NOT NULL,                        -- "monitor", "intervene", "urgent"
  title text NOT NULL,                           -- "2 consecutive acuity declines detected"
  description text NOT NULL,                     -- detailed explanation with data points
  contributing_data jsonb NOT NULL DEFAULT '{}', -- the specific data points that triggered this alert
  -- Example: {"assessments": [{"date": "2026-01-15", "score": 3}, {"date": "2026-04-15", "score": 4}], "trend": "increasing_dependency"}

  recommended_actions text[],                    -- ["Schedule physician visit", "Update care plan", "Family conference"]
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  action_taken text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_decline_alerts_resident ON decline_alerts(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_decline_alerts_facility ON decline_alerts(facility_id) WHERE deleted_at IS NULL AND resolved = false;
CREATE INDEX idx_decline_alerts_unacked ON decline_alerts(facility_id) WHERE deleted_at IS NULL AND acknowledged = false;

-- ============================================================
-- CARE PLAN REVIEW QUEUE (structured review workflow)
-- ============================================================
CREATE TABLE care_plan_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES care_plans(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  review_type text NOT NULL,                     -- "quarterly", "30_day", "change_of_condition", "post_hospital", "post_fall", "family_request", "acuity_change", "decline_alert"
  trigger_source text,                           -- what triggered this review: "scheduled", "incident:uuid", "assessment:uuid", "decline_alert:uuid"
  due_date date NOT NULL,
  assigned_to uuid REFERENCES auth.users(id),

  status text NOT NULL DEFAULT 'pending',        -- "pending", "in_progress", "completed", "overdue"

  -- AI-generated draft (Phase 5 full AI, Phase 2 template-based)
  draft_changes jsonb,                           -- suggested care plan modifications based on data analysis
  -- Example: {"add_items": [{"category": "fall_prevention", "description": "..."}], "modify_items": [{"id": "uuid", "changes": {"assistance_level": "extensive_assist"}}], "remove_items": [], "rationale": "..."}

  -- Completion
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  review_notes text,
  new_care_plan_version_id uuid REFERENCES care_plans(id),  -- the care plan version created from this review

  -- Participants
  participants jsonb DEFAULT '[]',               -- [{"user_id": "uuid", "role": "nurse", "name": "..."}, {"name": "Family - Daughter", "attended": true}]
  family_participated boolean NOT NULL DEFAULT false,
  physician_consulted boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_cp_reviews_resident ON care_plan_reviews(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cp_reviews_facility ON care_plan_reviews(facility_id, due_date) WHERE deleted_at IS NULL AND status IN ('pending', 'in_progress');
CREATE INDEX idx_cp_reviews_assigned ON care_plan_reviews(assigned_to) WHERE deleted_at IS NULL AND status IN ('pending', 'in_progress');
CREATE INDEX idx_cp_reviews_overdue ON care_plan_reviews(facility_id) WHERE deleted_at IS NULL AND status = 'overdue';
```

---

## RLS POLICIES

```sql
ALTER TABLE care_plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see tasks in accessible facilities" ON care_plan_tasks FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));
CREATE POLICY "Caregivers complete tasks" ON care_plan_tasks FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE assessment_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see schedules" ON assessment_schedules FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Nurse+ manage schedules" ON assessment_schedules FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE acuity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see acuity history" ON acuity_history FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('family', 'dietary', 'maintenance_role'));

ALTER TABLE decline_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see decline alerts" ON decline_alerts FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage decline alerts" ON decline_alerts FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE care_plan_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see reviews" ON care_plan_reviews FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage reviews" ON care_plan_reviews FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- Audit triggers
CREATE TRIGGER audit_care_plan_tasks AFTER INSERT OR UPDATE OR DELETE ON care_plan_tasks FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_assessment_schedules AFTER INSERT OR UPDATE OR DELETE ON assessment_schedules FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_decline_alerts AFTER INSERT OR UPDATE OR DELETE ON decline_alerts FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_care_plan_reviews AFTER INSERT OR UPDATE OR DELETE ON care_plan_reviews FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_plan_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON assessment_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON decline_alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_plan_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Care Plan Task Generation Engine

**Trigger:** When a care_plan with status='active' exists, the task generation engine runs daily at midnight ET.

**Logic per active care plan item:**

1. Read the care_plan_item's `category`, `frequency`, `specific_times`, and `assistance_level`.
2. For each day in the next 7 days:
   - If `frequency` = "every shift" → generate 3 tasks (day, evening, night)
   - If `frequency` = "daily" → generate 1 task for day shift (or specific_times if defined)
   - If `frequency` = "3x daily" → generate tasks at the 3 specific_times, assigned to the shift each time falls in
   - If `frequency` = "as needed" → generate 1 reminder task per day shift (soft reminder, not required completion)
   - If `frequency` = "weekly" and today matches → generate 1 task
3. Assign each task to the caregiver assigned to that resident for that shift (from shift_assignments.assigned_resident_ids).
4. Skip generation if a task for that item+date+shift already exists.

**Task completion linking:**
- When a caregiver completes an ADL log (Module 4) for a resident, the system auto-matches it to pending care_plan_tasks by: resident_id + adl_type matching task_type + same date + same shift. If matched → update task status to 'completed', link the adl_log_id.
- When an eMAR record is documented (status='given'), match to medication_assistance care plan tasks similarly.
- Tasks not completed by end of shift → status remains 'pending', carried forward to shift handoff as "incomplete tasks."

**Caregiver shift dashboard integration:**
- The caregiver's shift dashboard (Module 4, Shell B) shows: pending care_plan_tasks for their assigned residents, sorted by scheduled_time (if defined) or by task_type priority (medication > fall_prevention > ADL > social).

### Assessment Scheduling Automation

**On admission:**
For every assessment_template in the system, create an assessment_schedule for the new resident:
- katz_adl: next_due = admission_date (immediate baseline), then every 90 days
- morse_fall: next_due = admission_date, then every 90 days
- braden: next_due = admission_date, then every 90 days
- phq9: next_due = admission_date + 14 days (allow adjustment period), then every 180 days
- weight: next_due = admission_date, then every 30 days (weekly if flagged at-risk)

**On assessment completion:**
When an assessment is created (INSERT on assessments):
1. Find the matching assessment_schedule
2. Set `last_completed_date` = assessment_date
3. Calculate `next_due_date` = assessment_date + frequency_days
4. If the assessment results trigger a risk level change → create new assessment_schedules with increased frequency:
   - Morse Fall score ≥45 (high risk) → fall reassessment every 30 days instead of 90
   - Braden score ≤12 (high risk) → skin assessment every 30 days instead of 90
   - Weight loss >5% in 30 days → weight check every 7 days instead of 30
   - PHQ-9 score ≥10 → rescreening every 30 days instead of 180

**On incident:**
When an incident is created (Module 7):
- Fall incident → force morse_fall reassessment next_due_date = incident_date + 1 day
- Skin integrity incident → force braden reassessment next_due_date = incident_date + 1 day

### Decline Trajectory Detection

**Runs daily at 5 AM ET.** For each active resident, evaluates:

**1. Acuity Decline:**
- Compare last 3 Katz ADL assessments
- IF 2 consecutive assessments show score increase (more dependency):
  - Generate decline_alert: type="acuity_decline", severity="monitor"
  - Recommended actions: ["Review current care plan", "Schedule physician visit"]
- IF 3 consecutive assessments show score increase:
  - Generate decline_alert: type="acuity_decline", severity="intervene"
  - Recommended actions: ["Immediate care plan review", "Physician evaluation required", "Family conference"]

**2. Weight Loss:**
- Compare last 3 weight measurements
- IF loss ≥5% in 30 days OR ≥10% in 180 days:
  - Generate decline_alert: type="weight_loss", severity="intervene"
  - Recommended actions: ["Dietary evaluation", "Physician notification", "Increase weight monitoring frequency to weekly", "Review medication side effects"]

**3. Fall Frequency:**
- Count falls (from incidents) in rolling 30-day and 90-day windows
- IF ≥2 falls in 30 days:
  - Generate decline_alert: type="fall_frequency", severity="intervene"
  - Recommended actions: ["Complete fall risk reassessment", "Review medications for fall risk", "Environmental assessment", "Consider PT referral", "Update fall prevention care plan"]
- IF ≥3 falls in 90 days:
  - severity="urgent"
  - Add: ["Physician evaluation required", "Family conference", "Consider higher level of care evaluation"]

**4. Behavioral Escalation:**
- Count behavioral_logs in rolling 30-day window
- IF frequency increased ≥50% compared to prior 30 days:
  - Generate decline_alert: type="behavioral_escalation", severity="monitor"
  - Recommended actions: ["Review behavioral care plan", "Assess for UTI or other medical cause", "Review recent medication changes"]
- IF frequency increased ≥100%:
  - severity="intervene"
  - Add: ["Physician evaluation for medical cause", "Psychiatric consultation consideration"]

**5. Medication Refusal Pattern:**
- Count emar_records with status='refused' in rolling 14-day window per medication
- IF same medication refused ≥3 times in 14 days:
  - Generate decline_alert: type="medication_refusal_pattern", severity="monitor"
  - Recommended actions: ["Assess reason for refusal", "Consider alternative formulation", "Physician notification"]

**6. Activity Withdrawal:**
- Compare activity_attendance in current 30-day window vs prior 30-day window
- IF attendance decreased ≥50%:
  - Generate decline_alert: type="activity_withdrawal", severity="monitor"
  - Recommended actions: ["Assess for depression (PHQ-9)", "Review functional status", "Encourage social engagement", "Consider activities modification"]

**7. Hospitalization Risk (composite):**
- IF a resident has ≥2 active decline_alerts of severity "intervene" or higher across any categories:
  - Generate decline_alert: type="hospitalization_risk", severity="urgent"
  - Recommended actions: ["Comprehensive reassessment", "Physician evaluation within 48 hours", "Family conference", "Review appropriateness of current care setting"]

### Care Plan Review Workflow

**Auto-generated reviews:**
| Trigger | Review Type | Due Date |
|---------|------------|----------|
| 30 days post-admission | `30_day` | admission_date + 30 |
| 90 days from last review | `quarterly` | last_review + 90 |
| Acuity level change | `acuity_change` | assessment_date + 7 |
| Return from hospital | `post_hospital` | return_date + 3 |
| Fall with injury | `post_fall` | incident_date + 1 |
| Decline alert severity "intervene" or "urgent" | `decline_alert` | alert_date + 3 |
| Family/responsible party request | `family_request` | request_date + 7 |
| Significant change of condition | `change_of_condition` | condition_change_date + 2 |

**Review process:**
1. Review created with status='pending', assigned to resident's primary nurse
2. Nurse opens review → status='in_progress'
3. System presents: current care plan, all assessments since last review, all incidents since last review, all decline_alerts, daily log trends, weight/vital sign trends, medication changes, activity attendance trends
4. Nurse modifies care plan items as needed (add, edit, deactivate)
5. Nurse documents review: notes, participants, whether family participated, whether physician was consulted
6. On completion → new care_plan version created, review linked to new version, task generation engine runs for updated plan, previous version archived

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/residents/:id/tasks` | Required | caregiver, nurse, facility_admin | Get care plan tasks. Params: `date`, `shift`, `status` |
| PUT | `/care-plan-tasks/:id/complete` | Required | caregiver, nurse | Complete a task |
| PUT | `/care-plan-tasks/:id/skip` | Required | caregiver, nurse | Skip with reason |
| GET | `/facilities/:id/tasks/incomplete` | Required | nurse, facility_admin | List incomplete tasks across facility for a shift |
| GET | `/residents/:id/assessment-schedule` | Required | nurse, facility_admin | Get assessment schedule |
| PUT | `/assessment-schedules/:id` | Required | nurse, facility_admin | Override frequency |
| GET | `/facilities/:id/assessments/overdue` | Required | nurse, facility_admin | List all overdue assessments |
| GET | `/facilities/:id/assessments/due-this-week` | Required | nurse, facility_admin | Assessments due in next 7 days |
| GET | `/residents/:id/acuity-history` | Required | nurse, facility_admin | Acuity trend data for charts |
| GET | `/residents/:id/decline-alerts` | Required | nurse, facility_admin | Active decline alerts for resident |
| GET | `/facilities/:id/decline-alerts` | Required | nurse, facility_admin, owner | All active decline alerts across facility |
| PUT | `/decline-alerts/:id/acknowledge` | Required | nurse, facility_admin | Acknowledge alert |
| PUT | `/decline-alerts/:id/resolve` | Required | nurse, facility_admin | Resolve alert with notes |
| GET | `/facilities/:id/care-plan-reviews` | Required | nurse, facility_admin | Review queue. Params: `status`, `review_type` |
| GET | `/care-plan-reviews/:id` | Required | nurse, facility_admin | Review detail with all supporting data |
| PUT | `/care-plan-reviews/:id/start` | Required | nurse | Begin review (status → in_progress) |
| PUT | `/care-plan-reviews/:id/complete` | Required | nurse, facility_admin | Complete review, create new care plan version |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `generate-care-plan-tasks` | Cron (midnight ET daily) | For each active care plan: read items, generate tasks for next 7 days per frequency rules. Assign to shift caregivers. |
| `auto-complete-care-plan-tasks` | INSERT on adl_logs, UPDATE on emar_records | Match to pending care_plan_tasks and auto-complete. |
| `assessment-schedule-manager` | INSERT on assessments | Update assessment_schedule.last_completed_date and next_due_date. Adjust frequency if risk level changed. |
| `assessment-schedule-incident-trigger` | INSERT on incidents WHERE category LIKE 'fall%' OR category = 'skin_integrity' | Force reassessment schedule for relevant assessment types. |
| `decline-trajectory-scan` | Cron (5 AM ET daily) | Run all 7 decline detection algorithms for every active resident. Generate/update decline_alerts. |
| `care-plan-review-generator` | Triggered by: assessment acuity change, incident creation, decline alert creation, scheduled cron | Create care_plan_review records per the trigger table. |
| `care-plan-review-overdue-check` | Cron (6 AM ET daily) | Scan care_plan_reviews where status IN ('pending', 'in_progress') AND due_date < CURRENT_DATE. Set status='overdue'. Alert facility_admin. |

---

## UI SCREENS

### Web (Admin/Nurse)

| Screen | Route | Description |
|--------|-------|-------------|
| Assessment Calendar | `/facilities/:id/assessment-calendar` | Calendar view showing all assessment due dates across all residents. Color-coded: green (completed), yellow (due this week), red (overdue). Click date → list of assessments due. |
| Decline Alert Dashboard | `/facilities/:id/decline-alerts` | Cards for each unresolved alert, sorted by severity. Each card shows: resident photo/name, alert type, severity badge, contributing data summary, recommended actions checklist, acknowledge/resolve buttons. |
| Care Plan Review Queue | `/facilities/:id/reviews` | Table: resident, review type, due date, assigned nurse, status. Filter by: pending, in_progress, overdue. Sort by due date. |
| Care Plan Review Workspace | `/care-plan-reviews/:id` | Split view: left panel = current care plan with edit capability, right panel = supporting data tabs (assessments, incidents, daily logs, weight chart, activity attendance, decline alerts). Bottom bar: participants, notes, complete button. |
| Resident Trend Dashboard | `/residents/:id/trends` | Charts: acuity score over time, weight over time, fall frequency (rolling 30-day), medication refusal rate, activity attendance rate, behavioral event frequency. Decline alert history overlay. |

### Mobile (Caregiver)

| Screen | Route | Description |
|--------|-------|-------------|
| My Tasks (enhanced) | `/shift/tasks` | Replaces basic shift dashboard task list. Grouped by resident, sorted by scheduled_time. Each task shows: description, scheduled time, category icon. Swipe right to complete, long-press for notes/skip. Completion counter at top: "14 of 23 tasks complete." |
| Task Detail | `/shift/tasks/:id` | Full task description from care plan item, resident context (relevant care plan highlights), complete/skip/refuse buttons with required fields. |
