# 04 — Daily Operations & Logging

**Dependencies:** 00-foundation, 03-resident-profile
**Build Week:** 5-6

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- DAILY LOGS (one entry per resident per shift per caregiver)
-- ============================================================
CREATE TABLE daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  log_date date NOT NULL,
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users(id),

  -- General
  general_notes text,
  mood text,                                    -- "happy", "calm", "anxious", "agitated", "sad", "confused", "withdrawn"
  behavior_notes text,

  -- Vitals (when ordered)
  temperature numeric(5,2),                     -- Fahrenheit
  blood_pressure_systolic integer,
  blood_pressure_diastolic integer,
  pulse integer,
  respiration integer,
  oxygen_saturation numeric(5,2),
  weight_lbs numeric(6,2),                      -- only if weigh-in occurred this shift

  -- Sleep (night shift)
  sleep_quality text,                           -- "good", "fair", "poor", "awake_most_of_night"
  times_awakened integer,
  sleep_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_daily_logs_resident_date ON daily_logs(resident_id, log_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_daily_logs_facility_date ON daily_logs(facility_id, log_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_daily_logs_logged_by ON daily_logs(logged_by, log_date DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_daily_logs_unique ON daily_logs(resident_id, log_date, shift, logged_by) WHERE deleted_at IS NULL;

-- ============================================================
-- ADL LOGS (individual ADL assistance events)
-- ============================================================
CREATE TABLE adl_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  daily_log_id uuid REFERENCES daily_logs(id),
  log_date date NOT NULL,
  log_time timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users(id),

  adl_type text NOT NULL,                       -- "bathing", "dressing", "grooming", "toileting", "eating", "mobility", "transfer"
  assistance_level assistance_level NOT NULL,
  refused boolean NOT NULL DEFAULT false,
  refusal_reason text,

  -- Type-specific fields (stored in detail_data for flexibility)
  detail_data jsonb NOT NULL DEFAULT '{}',
  -- bathing: {"shower_or_bath": "shower", "skin_observations": "bruise on left forearm noted", "body_areas_assisted": ["back", "feet"]}
  -- eating: {"meal": "breakfast", "percent_consumed": 75, "fluid_intake_ml": 240, "diet_followed": true, "assistance_type": "setup_only"}
  -- toileting: {"continent": true, "brief_changed": false}
  -- mobility: {"assistive_device": "walker", "distance": "room to dining room", "supervision_level": "contact_guard"}

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_adl_logs_resident_date ON adl_logs(resident_id, log_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_adl_logs_daily ON adl_logs(daily_log_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_adl_logs_type ON adl_logs(resident_id, adl_type, log_date DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- eMar MEDICATIONS (master medication list per resident — active orders)
-- ============================================================
CREATE TABLE resident_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  medication_name text NOT NULL,
  generic_name text,
  strength text,                                -- "500mg", "10mg/5ml"
  form text,                                    -- "tablet", "capsule", "liquid", "cream", "patch", "inhaler"
  route medication_route NOT NULL,
  frequency medication_frequency NOT NULL,
  frequency_detail text,                        -- "Every 8 hours", "With meals", custom text
  scheduled_times time[],                       -- [08:00, 12:00, 18:00, 22:00]
  instructions text,                            -- "Take with food", "Do not crush"
  indication text,                              -- "Hypertension", "Diabetes Type 2"
  prescriber_name text,
  prescriber_phone text,
  pharmacy_name text,
  controlled_schedule controlled_schedule NOT NULL DEFAULT 'non_controlled',

  status medication_status NOT NULL DEFAULT 'active',
  start_date date NOT NULL,
  end_date date,                                -- NULL = ongoing
  discontinued_date date,
  discontinued_reason text,
  discontinued_by uuid REFERENCES auth.users(id),

  order_date date NOT NULL,
  order_source text,                            -- "physician_order", "hospital_discharge", "pharmacy_refill"
  order_document_id uuid REFERENCES resident_documents(id),

  prn_reason text,                              -- for PRN meds: "pain", "anxiety", "nausea", "insomnia"
  prn_max_frequency text,                       -- "every 4 hours", "3x daily max"
  prn_effectiveness_check_minutes integer,      -- 30, 60 — how long after administration to check effectiveness

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_res_meds_resident ON resident_medications(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_meds_active ON resident_medications(resident_id, status) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_res_meds_controlled ON resident_medications(facility_id, controlled_schedule) WHERE deleted_at IS NULL AND status = 'active' AND controlled_schedule != 'non_controlled';

-- ============================================================
-- eMar RECORDS (individual medication assistance events)
-- ============================================================
CREATE TABLE emar_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  resident_medication_id uuid NOT NULL REFERENCES resident_medications(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  daily_log_id uuid REFERENCES daily_logs(id),

  scheduled_time timestamptz NOT NULL,
  actual_time timestamptz,
  status emar_status NOT NULL DEFAULT 'scheduled',
  administered_by uuid REFERENCES auth.users(id),

  -- Refusal/hold details
  refusal_reason text,
  hold_reason text,                             -- "NPO for lab", "physician hold"
  not_available_reason text,                    -- "awaiting pharmacy delivery"

  -- PRN specific
  is_prn boolean NOT NULL DEFAULT false,
  prn_reason_given text,                        -- why was PRN given this time
  prn_effectiveness_checked boolean DEFAULT false,
  prn_effectiveness_time timestamptz,
  prn_effectiveness_result text,                -- "effective", "partially_effective", "not_effective"
  prn_effectiveness_notes text,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_emar_resident_date ON emar_records(resident_id, scheduled_time DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_emar_medication ON emar_records(resident_medication_id, scheduled_time DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_emar_status ON emar_records(facility_id, status, scheduled_time) WHERE deleted_at IS NULL AND status = 'scheduled';
CREATE INDEX idx_emar_prn_pending ON emar_records(facility_id, prn_effectiveness_checked) WHERE deleted_at IS NULL AND is_prn = true AND status = 'given' AND prn_effectiveness_checked = false;

-- ============================================================
-- BEHAVIORAL LOGS (ABC documentation)
-- ============================================================
CREATE TABLE behavioral_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  daily_log_id uuid REFERENCES daily_logs(id),

  occurred_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  logged_by uuid NOT NULL REFERENCES auth.users(id),

  antecedent text,                              -- what happened before the behavior
  behavior text NOT NULL,                       -- the behavior observed
  behavior_type text NOT NULL,                  -- "verbal_aggression", "physical_aggression", "wandering", "exit_seeking", "sundowning", "refusal_of_care", "self_harm", "sexually_inappropriate", "other"
  consequence text,                             -- what happened after / intervention used
  intervention_used text[],                     -- ["redirection", "de_escalation", "one_on_one", "prn_medication", "separated_from_trigger"]
  intervention_effective boolean,
  duration_minutes integer,
  involved_residents uuid[],                    -- other residents involved
  involved_staff uuid[],                        -- staff involved
  injury_occurred boolean NOT NULL DEFAULT false,
  injury_details text,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_behavioral_resident ON behavioral_logs(resident_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_behavioral_facility ON behavioral_logs(facility_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_behavioral_type ON behavioral_logs(resident_id, behavior_type) WHERE deleted_at IS NULL;

-- ============================================================
-- CONDITION CHANGES (documented changes from baseline)
-- ============================================================
CREATE TABLE condition_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  reported_at timestamptz NOT NULL DEFAULT now(),
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  shift shift_type NOT NULL,

  change_type text NOT NULL,                    -- "cognitive", "physical", "behavioral", "appetite", "sleep", "pain", "skin", "other"
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'moderate',    -- "mild", "moderate", "significant"

  -- Response chain
  nurse_notified boolean NOT NULL DEFAULT false,
  nurse_notified_at timestamptz,
  nurse_notified_by uuid REFERENCES auth.users(id),
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  physician_response text,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,

  -- Follow-up
  care_plan_review_triggered boolean NOT NULL DEFAULT false,
  linked_incident_id uuid,                      -- if this led to an incident report
  resolved_at timestamptz,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_condition_changes_resident ON condition_changes(resident_id, reported_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_condition_changes_facility ON condition_changes(facility_id, reported_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_condition_changes_unresolved ON condition_changes(facility_id) WHERE deleted_at IS NULL AND resolved_at IS NULL;

-- ============================================================
-- SHIFT HANDOFFS
-- ============================================================
CREATE TABLE shift_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unit_id uuid REFERENCES units(id),

  handoff_date date NOT NULL,
  outgoing_shift shift_type NOT NULL,
  incoming_shift shift_type NOT NULL,

  outgoing_staff_id uuid NOT NULL REFERENCES auth.users(id),
  incoming_staff_id uuid REFERENCES auth.users(id),   -- NULL until incoming acknowledges

  -- Auto-generated summary from shift's documentation
  auto_summary jsonb NOT NULL DEFAULT '{}',
  -- {
  --   "residents_with_events": [{"resident_id": "uuid", "name": "...", "events": ["fell at 10am", "refused lunch"]}],
  --   "new_admissions": [],
  --   "discharges": [],
  --   "hospital_transfers": [],
  --   "medication_changes": [],
  --   "condition_changes": [],
  --   "open_items": ["Resident 14 needs weight check", "Room 207 maintenance request pending"]
  -- }

  outgoing_notes text,                          -- additional verbal/written notes from outgoing
  incoming_acknowledged boolean NOT NULL DEFAULT false,
  incoming_acknowledged_at timestamptz,
  incoming_notes text,                          -- incoming staff's notes/questions

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_handoffs_facility_date ON shift_handoffs(facility_id, handoff_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_handoffs_outgoing ON shift_handoffs(outgoing_staff_id, handoff_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_handoffs_unacknowledged ON shift_handoffs(facility_id) WHERE deleted_at IS NULL AND incoming_acknowledged = false;

-- ============================================================
-- ACTIVITY ATTENDANCE
-- ============================================================
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,                           -- "Morning Exercise", "Bingo", "Music Therapy"
  description text,
  default_day_of_week integer[],                -- [1, 3, 5] = Mon, Wed, Fri (ISO 8601)
  default_start_time time,
  default_duration_minutes integer,
  facilitator text,
  is_recurring boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_date date NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  facilitator_name text,
  notes text,
  cancelled boolean NOT NULL DEFAULT false,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE activity_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_session_id uuid NOT NULL REFERENCES activity_sessions(id),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  attended boolean NOT NULL DEFAULT true,
  engagement_level text,                        -- "active", "passive", "minimal", "refused"
  duration_minutes integer,
  notes text,
  logged_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_activity_att_session ON activity_attendance(activity_session_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_activity_att_resident ON activity_attendance(resident_id, created_at DESC) WHERE deleted_at IS NULL;
```

---

## RLS POLICIES

```sql
-- All Module 4 tables follow the same pattern: facility-scoped access

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see daily logs in accessible facilities"
  ON daily_logs FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));
CREATE POLICY "Caregivers+ can create daily logs"
  ON daily_logs FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Caregivers can update own logs within shift"
  ON daily_logs FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND (logged_by = auth.uid() OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE adl_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see ADL logs" ON adl_logs FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));
CREATE POLICY "Caregivers+ can create ADL logs" ON adl_logs FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE resident_medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see medications" ON resident_medications FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role'));
CREATE POLICY "Nurse+ can manage medications" ON resident_medications FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE emar_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see eMAR" ON emar_records FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role', 'family'));
CREATE POLICY "Caregivers+ can document eMAR" ON emar_records FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Caregivers can update own eMAR entries" ON emar_records FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND (administered_by = auth.uid() OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE behavioral_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see behavioral logs" ON behavioral_logs FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role', 'family'));
CREATE POLICY "Caregivers+ can create behavioral logs" ON behavioral_logs FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE condition_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see condition changes" ON condition_changes FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role'));
CREATE POLICY "Caregivers+ can report condition changes" ON condition_changes FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE shift_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see handoffs" ON shift_handoffs FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see activities" ON activities FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));

ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see sessions" ON activity_sessions FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));

ALTER TABLE activity_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see attendance" ON activity_attendance FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));

-- Audit triggers for all tables
CREATE TRIGGER audit_daily_logs AFTER INSERT OR UPDATE OR DELETE ON daily_logs FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_adl_logs AFTER INSERT OR UPDATE OR DELETE ON adl_logs FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_resident_medications AFTER INSERT OR UPDATE OR DELETE ON resident_medications FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_emar_records AFTER INSERT OR UPDATE OR DELETE ON emar_records FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_behavioral_logs AFTER INSERT OR UPDATE OR DELETE ON behavioral_logs FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_condition_changes AFTER INSERT OR UPDATE OR DELETE ON condition_changes FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON daily_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON resident_medications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON emar_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shift_handoffs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### eMAR Scheduling
- WHEN a resident_medication with status='active' has scheduled_times defined, THEN the system generates emar_records with status='scheduled' for each scheduled_time for each day, 7 days in advance.
- Scheduled records are generated by a daily cron Edge Function at midnight ET.
- PRN medications do NOT generate scheduled records. They are created ad-hoc when administered.

### eMAR Documentation Windows
- A scheduled medication can be documented as 'given' within a 1-hour window (30 min before, 30 min after scheduled_time).
- Outside the window: the system flags as "late administration" in the notes automatically.
- If not documented within 2 hours after scheduled_time: status auto-changes to 'scheduled' with a missed-dose alert generated.

### PRN Effectiveness Check
- WHEN a PRN emar_record is created with status='given', AND the resident_medication has prn_effectiveness_check_minutes defined:
  - Generate a timed alert to the administering caregiver for effectiveness check
  - If not documented within prn_effectiveness_check_minutes + 30 minutes → escalate to nurse
  - This is a critical survey compliance item

### Shift Handoff Auto-Generation
- WHEN an outgoing shift ends (7am, 3pm, 11pm ET), the system auto-generates a shift_handoff record:
  - Queries all daily_logs, adl_logs, emar_records, behavioral_logs, condition_changes for that shift+facility
  - Builds the auto_summary JSON
  - Assigns to the outgoing caregiver for review/additions
  - Incoming caregiver must acknowledge receipt (incoming_acknowledged = true) before their shift documentation begins

### Condition Change Escalation
| Severity | Auto-Actions |
|----------|-------------|
| mild | Log only. Show on handoff summary. |
| moderate | Alert nurse. Show on handoff summary. Generate care plan review suggestion if >2 moderate changes in 7 days for same resident. |
| significant | Alert nurse immediately. Alert administrator. Auto-generate physician notification template. Alert family (per care plan preferences). Trigger care plan review within 48 hours. |

### Controlled Substance Count
- WHEN a medication with controlled_schedule != 'non_controlled' has an emar_record created with status='given':
  - The system requires a count verification field: remaining quantity
  - At shift change, the system generates a count verification task requiring outgoing AND incoming caregiver signatures
  - Any discrepancy (expected count ≠ actual count) generates an immediate Level 3 alert

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/residents/:id/daily-logs` | Required | Staff | List daily logs. Params: `date_from`, `date_to`, `shift` |
| POST | `/residents/:id/daily-logs` | Required | caregiver, nurse, facility_admin | Create/update daily log for current shift |
| PUT | `/daily-logs/:id` | Required | Author or nurse+ | Update daily log |
| POST | `/residents/:id/adl-logs` | Required | caregiver, nurse | Log ADL event |
| GET | `/residents/:id/emar` | Required | Clinical staff | Get eMAR. Params: `date`, `status` |
| POST | `/residents/:id/emar` | Required | caregiver, nurse | Document medication event |
| PUT | `/emar-records/:id` | Required | Author or nurse | Update eMAR record (e.g., PRN effectiveness) |
| GET | `/facilities/:id/emar/pending` | Required | caregiver, nurse | List pending/overdue medications for facility/shift |
| POST | `/residents/:id/behavioral-logs` | Required | caregiver, nurse | Log behavioral event |
| POST | `/residents/:id/condition-changes` | Required | caregiver, nurse | Report condition change |
| PUT | `/condition-changes/:id` | Required | nurse, facility_admin | Update condition change (add notifications, resolution) |
| GET | `/facilities/:id/shift-handoff` | Required | Staff | Get handoff for current shift transition |
| PUT | `/shift-handoffs/:id/acknowledge` | Required | Incoming staff | Acknowledge handoff receipt |
| GET | `/residents/:id/medications` | Required | Clinical staff | List active medications |
| POST | `/residents/:id/medications` | Required | nurse, facility_admin | Add medication order |
| PUT | `/resident-medications/:id` | Required | nurse, facility_admin | Update medication (discontinue, modify) |
| POST | `/facilities/:id/activities/sessions` | Required | Staff | Create activity session |
| POST | `/activity-sessions/:id/attendance` | Required | Staff | Log attendance batch |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `generate-emar-schedule` | Cron (midnight ET daily) | For each active resident_medication with scheduled_times, generate emar_records for the next 7 days. Skip dates that already have records. |
| `emar-missed-dose-check` | Cron (every 30 min) | Find emar_records where status='scheduled' AND scheduled_time < now() - interval '2 hours'. Generate missed-dose alert. |
| `prn-effectiveness-check` | Cron (every 15 min) | Find emar_records where is_prn=true AND status='given' AND prn_effectiveness_checked=false AND actual_time < now() - interval from prn_effectiveness_check_minutes. Generate reminder alert to administering caregiver. |
| `generate-shift-handoff` | Cron (6:45am, 2:45pm, 10:45pm ET) | 15 min before shift change: compile auto_summary from shift documentation, create shift_handoff record. |
| `condition-change-escalation` | INSERT on condition_changes | Evaluate severity, trigger notification chain per business rules. |
| `controlled-substance-count` | INSERT on emar_records WHERE controlled | Verify count consistency, generate discrepancy alert if needed. |

---

## UI SCREENS — MOBILE (Primary Interface for Caregivers)

Route and shell conventions follow `docs/specs/FRONTEND-CONTRACT.md`.

| Screen | Route | Description |
|--------|-------|-------------|
| Shift Dashboard | `/caregiver` | Current shift, assigned residents, pending tasks (meds due, assessments due, care plan tasks), cognitive load indicator (Phase 5), unacknowledged handoff alert |
| Medication Pass | `/caregiver/meds` | List of all medications due in current window across assigned residents. Tap resident → see their meds → tap each to document. Barcode scan option. |
| Resident Daily Log | `/caregiver/resident/:id/log` | Single-screen daily documentation: mood, ADLs completed, meals, notes. Tabs for vitals if ordered. |
| ADL Quick-Log | `/caregiver/resident/:id/adl` | Quick-entry buttons: Bathing ✓, Dressing ✓, Toileting ✓, etc. Tap to log with timestamp. Long-press for detail entry. |
| Behavioral Event | `/caregiver/resident/:id/behavior` | ABC form: antecedent, behavior type picker, description, intervention checkboxes, outcome. |
| Condition Change | `/caregiver/resident/:id/condition-change` | Guided form: change type, description, severity picker. Auto-shows notification chain based on severity. |
| Shift Handoff | `/caregiver/handoff` | View auto-generated summary. Add notes. Submit. Incoming: view outgoing summary, acknowledge. |
| PRN Effectiveness | `/caregiver/prn-followup` | List of PRN meds given that need effectiveness checks. Tap to document result. |

### Offline Behavior — Module 4

| Operation | Offline | Sync |
|-----------|---------|------|
| View medication schedule | Yes (cached 7 days) | Background refresh |
| Document eMAR (give/refuse/hold) | Yes (queued with local timestamp) | Submit on reconnect. If timestamp conflict (same med documented twice), alert nurse for resolution. |
| Log ADLs | Yes (queued) | Submit on reconnect |
| Log behavioral event | Yes (queued) | Submit on reconnect |
| Report condition change | Yes (queued) | Submit on reconnect. Severity-based notifications fire on sync, not on local save. Display "pending sync" badge. |
| View/acknowledge handoff | No (requires current data) | Show offline indicator |

## COL Alignment Notes

**Activity log alignment:** COL uses an `Activity Log.pdf` to track resident activity participation. The `activity_sessions` and `activity_attendance` tables cover this workflow. The activity category taxonomy in Haven should match COL's existing activity types (social, recreational, therapeutic, religious, educational, etc.) as documented in their activity logs.

**Night shift procedure docs:** COL has separate `Night Shift Employee 1.pdf` and `Night Shift Employee 2.pdf` procedure documents — these are large (indicating extensive content) and likely define the overnight care tasks that should appear in the daily_logs checklist for night shift staff. Before finalizing the daily log task checklist, review COL's night shift procedure documents to ensure Haven captures all required overnight care tasks.

**24-Hour Communication Sheet:** COL uses a `24-Hour Communication Sheet.xlsx` as the primary shift-to-shift handoff tool. The `shift_handoffs` table in Module 04 digitalizes this. At Oakridge pilot launch, run parallel (paper + Haven) for 30 days before retiring the paper form.

**Housekeeping & laundry checklist:** COL has a `Day Shift Housekeeping & Laundry.pdf` checklist. Consider adding a `housekeeping_logs` table or integrating housekeeping tasks into the daily_logs framework so environmental services compliance (room cleanliness, linen change frequency) is tracked alongside care tasks.

**Physician visit documentation:** COL uses a `Physician Visits Form.pdf` to document doctor visits and resulting orders. This maps to the condition_changes and physician_orders workflows. Ensure the daily operations UI includes a "Physician Visit" log entry type that captures: physician name, visit date/time, reason, verbal/written orders resulting, follow-up required.
