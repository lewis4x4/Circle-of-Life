# 09 — Infection Control & Health Monitoring (Phase 2)

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations, 07-incident-reporting, 11-staff-management
**Build Week:** 17-18
**Scope authority:** `PHASE2-SCOPE.md` (Module 9 — Core/Enhanced/Future tiers)

---

## Phase 1 Foundation (already built — do not recreate)

- `daily_logs` — captures temperature, BP, pulse, respiration, O2 sat, weight per shift
- `condition_changes` — acute change documentation with severity and notification chain
- `incidents` — 27 categories including infection-related, with `ahca_reportable` flag
- `staff` + `time_records` — staff roster and shift records
- `residents` — full profile with diagnosis_list, allergy_list

This spec adds **new tables** for infection surveillance, outbreak management, vital sign alerts, and staff illness tracking.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- INFECTION SURVEILLANCE (individual infection case records)
-- ============================================================
CREATE TABLE infection_surveillance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unit_id uuid REFERENCES units(id),

  -- Classification
  infection_type text NOT NULL
    CHECK (infection_type IN (
      'uti',
      'respiratory_upper',
      'respiratory_lower',       -- pneumonia, bronchitis
      'gi',                      -- norovirus, c_diff, diarrhea
      'skin_wound',              -- MRSA, cellulitis, wound infection
      'skin_fungal',
      'eye',                     -- conjunctivitis
      'bloodstream',
      'covid',
      'influenza',
      'other'
    )),
  status text NOT NULL DEFAULT 'suspected'
    CHECK (status IN ('suspected', 'confirmed', 'resolved', 'hospitalized', 'deceased')),

  -- Timeline
  onset_date date NOT NULL,
  identified_at timestamptz NOT NULL DEFAULT now(),
  identified_by uuid NOT NULL REFERENCES auth.users(id),
  resolved_date date,

  -- Symptoms
  symptoms text[] NOT NULL,                      -- ["fever", "cough", "dysuria", "confusion", "diarrhea", "wound_drainage"]
  temperature_at_onset numeric(5,2),             -- Fahrenheit, if taken

  -- Diagnosis & Treatment
  lab_ordered boolean NOT NULL DEFAULT false,
  lab_type text,                                 -- "urine_culture", "blood_culture", "wound_culture", "rapid_test", "pcr"
  lab_result text,                               -- "positive", "negative", "pending", "not_applicable"
  organism text,                                 -- "e_coli", "mrsa", "c_diff", "norovirus", "sars_cov_2", etc.
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  treatment_type text,                           -- "antibiotic", "antiviral", "antifungal", "supportive", "hospitalization"
  antibiotic_name text,                          -- if applicable
  antibiotic_start_date date,
  antibiotic_end_date date,
  treatment_notes text,

  -- Outcome
  outcome text
    CHECK (outcome IS NULL OR outcome IN ('resolved', 'chronic', 'hospitalized', 'deceased')),
  outcome_date date,
  outcome_notes text,

  -- Reporting
  ahca_reportable boolean NOT NULL DEFAULT false,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,

  -- Link to outbreak if part of one
  outbreak_id uuid,                              -- FK added after outbreak table created

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_inf_surv_facility ON infection_surveillance(facility_id, onset_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_inf_surv_resident ON infection_surveillance(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_inf_surv_type ON infection_surveillance(facility_id, infection_type, onset_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_inf_surv_active ON infection_surveillance(facility_id, unit_id, infection_type)
  WHERE deleted_at IS NULL AND status IN ('suspected', 'confirmed');

-- ============================================================
-- INFECTION OUTBREAKS (facility-level outbreak events)
-- ============================================================
CREATE TABLE infection_outbreaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  unit_id uuid REFERENCES units(id),             -- NULL if facility-wide

  -- Classification
  infection_type text NOT NULL,                  -- matches infection_surveillance.infection_type
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'contained', 'resolved')),
  detection_method text NOT NULL DEFAULT 'algorithmic'
    CHECK (detection_method IN ('algorithmic', 'manual')),

  -- Timeline
  detected_at timestamptz NOT NULL DEFAULT now(),
  declared_by uuid NOT NULL REFERENCES auth.users(id),
  contained_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),

  -- Scope
  initial_case_count integer NOT NULL DEFAULT 2,
  peak_case_count integer,
  total_cases integer,

  -- Reporting
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  ahca_report_notes text,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_outbreaks_facility ON infection_outbreaks(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_outbreaks_active ON infection_outbreaks(facility_id)
  WHERE deleted_at IS NULL AND status = 'active';

-- Add FK from infection_surveillance to outbreaks
ALTER TABLE infection_surveillance
  ADD CONSTRAINT fk_infection_outbreak
  FOREIGN KEY (outbreak_id) REFERENCES infection_outbreaks(id);

-- ============================================================
-- OUTBREAK ACTIONS (checklist items for outbreak management)
-- ============================================================
CREATE TABLE outbreak_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbreak_id uuid NOT NULL REFERENCES infection_outbreaks(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Action
  action_type text NOT NULL
    CHECK (action_type IN (
      'isolation_cohorting',
      'enhanced_ppe',
      'visitor_restriction',
      'staff_screening',
      'environmental_cleaning',
      'physician_notification',
      'ahca_notification',
      'family_notification',
      'testing_protocol',
      'treatment_protocol',
      'other'
    )),
  title text NOT NULL,                           -- human-readable action description
  instructions text,                             -- detailed steps
  priority text NOT NULL DEFAULT 'standard'
    CHECK (priority IN ('immediate', 'standard', 'when_possible')),

  -- Assignment & completion
  assigned_to uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'not_applicable')),
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  completion_notes text,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_outbreak_actions_outbreak ON outbreak_actions(outbreak_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_outbreak_actions_pending ON outbreak_actions(outbreak_id, status)
  WHERE deleted_at IS NULL AND status IN ('pending', 'in_progress');

-- ============================================================
-- VITAL SIGN ALERT THRESHOLDS (per-resident configurable baselines)
-- ============================================================
CREATE TABLE vital_sign_alert_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Thresholds (NULL = use facility default or no alert)
  temperature_high numeric(5,2),                 -- e.g., 100.4
  temperature_low numeric(5,2),                  -- e.g., 95.0
  bp_systolic_high integer,                      -- e.g., 160
  bp_systolic_low integer,                       -- e.g., 90
  bp_diastolic_high integer,                     -- e.g., 100
  bp_diastolic_low integer,                      -- e.g., 50
  pulse_high integer,                            -- e.g., 110
  pulse_low integer,                             -- e.g., 50
  respiration_high integer,                      -- e.g., 24
  respiration_low integer,                       -- e.g., 10
  oxygen_saturation_low numeric(5,2),            -- e.g., 92.0
  weight_change_lbs numeric(6,2),                -- alert if weight changes by more than this in 7 days

  -- Configuration
  configured_by uuid NOT NULL REFERENCES auth.users(id),
  configured_at timestamptz NOT NULL DEFAULT now(),
  notes text,                                    -- "Post-hospitalization monitoring — tighter thresholds per Dr. Smith"

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_vsat_resident ON vital_sign_alert_thresholds(resident_id) WHERE deleted_at IS NULL;

-- ============================================================
-- VITAL SIGN ALERTS (triggered when thresholds exceeded)
-- ============================================================
CREATE TABLE vital_sign_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  daily_log_id uuid NOT NULL REFERENCES daily_logs(id),  -- the log entry that triggered the alert

  -- Alert details
  vital_type text NOT NULL
    CHECK (vital_type IN ('temperature', 'bp_systolic', 'bp_diastolic', 'pulse', 'respiration', 'oxygen_saturation', 'weight_change')),
  recorded_value numeric(8,2) NOT NULL,
  threshold_value numeric(8,2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('above', 'below')),

  -- Resolution
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_vsa_facility_open ON vital_sign_alerts(facility_id)
  WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX idx_vsa_resident ON vital_sign_alerts(resident_id, created_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- STAFF ILLNESS RECORDS
-- ============================================================
CREATE TABLE staff_illness_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Illness details
  reported_date date NOT NULL,
  illness_type text NOT NULL
    CHECK (illness_type IN ('respiratory', 'gi', 'covid', 'influenza', 'skin', 'other', 'personal')),
  symptoms text[],                               -- ["fever", "cough", "vomiting", "diarrhea"]

  -- Absence tracking
  absent_from date NOT NULL,
  absent_to date,                                -- NULL = still out
  shifts_missed integer,

  -- Return to work
  return_cleared boolean NOT NULL DEFAULT false,
  cleared_by uuid REFERENCES auth.users(id),     -- nurse or admin who cleared
  cleared_at timestamptz,
  clearance_type text
    CHECK (clearance_type IS NULL OR clearance_type IN ('self_certification', 'occupational_health', 'physician_note', 'negative_test')),
  clearance_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_sir_staff ON staff_illness_records(staff_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sir_facility_date ON staff_illness_records(facility_id, reported_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sir_active ON staff_illness_records(facility_id)
  WHERE deleted_at IS NULL AND absent_to IS NULL;
```

---

## RLS POLICIES

```sql
-- INFECTION SURVEILLANCE
ALTER TABLE infection_surveillance ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_infections ON infection_surveillance
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY admin_nurse_manage_infections ON infection_surveillance
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- INFECTION OUTBREAKS
ALTER TABLE infection_outbreaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_outbreaks ON infection_outbreaks
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY admin_nurse_manage_outbreaks ON infection_outbreaks
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- OUTBREAK ACTIONS
ALTER TABLE outbreak_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_staff_see_outbreak_actions ON outbreak_actions
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

CREATE POLICY admin_nurse_manage_outbreak_actions ON outbreak_actions
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY caregiver_complete_outbreak_actions ON outbreak_actions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() = 'caregiver'
    AND assigned_to = auth.uid()
  );

-- VITAL SIGN ALERT THRESHOLDS
ALTER TABLE vital_sign_alert_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_thresholds ON vital_sign_alert_thresholds
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY admin_nurse_manage_thresholds ON vital_sign_alert_thresholds
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- VITAL SIGN ALERTS
ALTER TABLE vital_sign_alerts ENABLE ROW LEVEL SECURITY;

-- Admin + nurse see all vital alerts in accessible facilities
CREATE POLICY admin_nurse_see_vital_alerts ON vital_sign_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Caregivers see alerts ONLY for residents they have charted for (daily_logs)
-- in the current shift. This avoids exposing all facility alerts to every caregiver.
CREATE POLICY caregiver_see_own_resident_vital_alerts ON vital_sign_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() = 'caregiver'
    AND resident_id IN (
      SELECT dl.resident_id FROM daily_logs dl
      WHERE dl.logged_by = auth.uid()
        AND dl.facility_id IN (SELECT haven.accessible_facility_ids())
        AND dl.deleted_at IS NULL
        AND dl.log_date >= CURRENT_DATE - interval '1 day'
    )
  );

CREATE POLICY admin_nurse_manage_vital_alerts ON vital_sign_alerts
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- STAFF ILLNESS RECORDS
ALTER TABLE staff_illness_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_illness_records ON staff_illness_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY staff_see_own_illness ON staff_illness_records
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid() AND s.deleted_at IS NULL)
  );

CREATE POLICY admin_nurse_manage_illness ON staff_illness_records
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Staff can self-report illness (matches /caregiver/me UI flow)
CREATE POLICY staff_self_report_illness ON staff_illness_records
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND staff_id IN (SELECT s.id FROM staff s WHERE s.user_id = auth.uid() AND s.deleted_at IS NULL)
  );

-- Audit triggers
CREATE TRIGGER audit_infection_surveillance AFTER INSERT OR UPDATE OR DELETE ON infection_surveillance
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_infection_outbreaks AFTER INSERT OR UPDATE OR DELETE ON infection_outbreaks
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_outbreak_actions AFTER INSERT OR UPDATE OR DELETE ON outbreak_actions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_vital_sign_alerts AFTER INSERT OR UPDATE OR DELETE ON vital_sign_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_staff_illness_records AFTER INSERT OR UPDATE OR DELETE ON staff_illness_records
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON infection_surveillance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON infection_outbreaks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON outbreak_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON vital_sign_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_illness_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Infection Surveillance Entry

1. **Who creates.** Nurse or admin creates an infection surveillance record when a resident presents symptoms suggestive of infection.
2. **Caregiver role.** Caregivers do not create surveillance records directly. They flag symptoms via `condition_changes` (Phase 1). A nurse reviews condition changes and creates surveillance records when clinically warranted.
3. **Workflow.** Suspected → lab ordered (optional) → confirmed/resolved. Status tracks the progression. Treatment details captured when initiated.

### Outbreak Detection Rules

This is a **hidden complexity area** per PHASE2-SCOPE.md.

**Algorithmic detection:**

1. When a new `infection_surveillance` record is created with `status IN ('suspected', 'confirmed')`:
   - Query: count of infection_surveillance records with the **same `infection_type`** AND **same `unit_id`** (or same `facility_id` if unit is NULL) where `onset_date` is within 72 hours of the new record's `onset_date` AND `status IN ('suspected', 'confirmed')`
   - If count ≥ 2: trigger outbreak detection

2. **What "same type" means** (disambiguation):
   - Exact `infection_type` match required (e.g., `uti` matches `uti`, not `respiratory_lower`)
   - Exception: `covid` and `influenza` each stand alone (no cross-matching)
   - `respiratory_upper` and `respiratory_lower` are treated as the **same category** for outbreak detection purposes

3. **When triggered:**
   - Check if an active outbreak already exists for this facility + unit + infection_type
   - If yes: link the new surveillance record to the existing outbreak, increment `total_cases`
   - If no: create new `infection_outbreaks` row, link both triggering cases, generate outbreak action checklist (see below)

**Manual detection:** A nurse or facility_admin can manually declare an outbreak at any time, even if algorithmic thresholds are not met.

### Outbreak Action Checklist Generation

When an outbreak is created, auto-generate these `outbreak_actions` rows:

| Order | Type | Title | Priority |
|-------|------|-------|----------|
| 1 | `isolation_cohorting` | Isolate/cohort affected residents on the unit | immediate |
| 2 | `enhanced_ppe` | Implement enhanced PPE for unit staff (type based on infection) | immediate |
| 3 | `physician_notification` | Notify attending physicians for all affected residents | immediate |
| 4 | `family_notification` | Notify families of affected residents about the outbreak | standard |
| 5 | `visitor_restriction` | Post visitor restriction notices; notify regular visitors | standard |
| 6 | `staff_screening` | Implement daily staff symptom screening before shift | standard |
| 7 | `environmental_cleaning` | Escalate cleaning protocol (frequency + disinfectant) | standard |
| 8 | `testing_protocol` | Determine testing scope: unit-wide or facility-wide | standard |
| 9 | `ahca_notification` | Report to AHCA if required (≥3 cases or specific organism) | standard |
| 10 | `treatment_protocol` | Establish treatment protocol with facility physician | when_possible |

The checklist is a starting point. Nurse/admin can add, modify, or mark items as `not_applicable`.

### Normalized Infection Grouping for Outbreak Detection

The `infection_type` field stores the specific type, but outbreak detection uses a **normalized group** for matching:

| Stored `infection_type` | Outbreak detection group |
|------------------------|------------------------|
| `uti` | `uti` |
| `respiratory_upper` | `respiratory` |
| `respiratory_lower` | `respiratory` |
| `gi` | `gi` |
| `skin_wound` | `skin` |
| `skin_fungal` | `skin` |
| `eye` | `eye` |
| `bloodstream` | `bloodstream` |
| `covid` | `covid` |
| `influenza` | `influenza` |
| `other` | `other` |

**Implementation:** The grouping is a pure application-level mapping (a lookup object), not a database column. The outbreak detection query uses `WHERE infection_type IN (...)` with the group's members.

The `infection_outbreaks.infection_type` field stores the **group name** (e.g., `respiratory`), not the specific subtype. Individual case subtypes are visible on the linked `infection_surveillance` records.

### Outbreak Deduplication & State Transitions

**Deduplication rules:**

| Scenario | Behavior |
|----------|----------|
| New case matches an existing **active** outbreak (same facility + unit + group) | Link the case to the existing outbreak; increment `total_cases`. Do NOT create a new outbreak. |
| New case matches an existing **contained** outbreak (same facility + unit + group, within 14 days of containment) | Reopen: set outbreak status back to `active`, link case, increment count. |
| New case matches a **resolved** outbreak | Create a new outbreak. Resolved outbreaks are terminal. |
| Suspected case is reclassified to a different type after linking to an outbreak | Unlink from the outbreak (`outbreak_id = NULL`). If this drops the outbreak below 2 cases, the outbreak remains but is flagged for nurse review. |
| Suspected case resolves as negative (lab result) | Update surveillance record `status = 'resolved'`. If linked to outbreak, unlink. Same below-threshold flagging. |

**State transitions:**

```
active → contained       (nurse/facility_admin declares containment — no new cases for 72hr)
active → resolved        (allowed for single-event outbreaks that resolve quickly)
contained → active       (new case linked during 14-day monitoring window)
contained → resolved     (14-day monitoring window passes with no new cases)
resolved → (terminal)    (resolved outbreaks are immutable — new cases create a new outbreak)
```

**Invariant:** Only one **active or contained** outbreak per `(facility_id, unit_id, infection_group)` at a time. Enforced at application level (check before creating a new outbreak).

### Implementation Decision: Trigger Mechanism

**Decision (locked for Phase 2 build):** Outbreak detection and vital sign alert checking are both implemented as **application-level logic** triggered after the relevant INSERT/save operation completes.

**Rationale:**
- Postgres triggers add hidden side effects to INSERTs, making debugging harder and creating implicit dependencies
- Application logic is easier to test, log, and modify
- The latency requirement (real-time for vitals, near-real-time for outbreaks) is met by running the check synchronously after the save

**Pattern:**
1. Client saves daily_log or infection_surveillance record via Supabase
2. On success, client calls a check function (or the server-side save handler does)
3. Check function runs the threshold/outbreak query and creates alerts if needed
4. Alerts are visible on next page load or via realtime subscription

### Vital Sign Alert Threshold Checking

1. **When checked.** After each `daily_logs` INSERT or UPDATE that includes vital sign data (any of: temperature, BP, pulse, respiration, O2 sat, weight).

2. **How checked.** Application logic (not a database trigger — avoids perf concerns):
   - Fetch `vital_sign_alert_thresholds` for the resident
   - If no row exists: no alerts (thresholds are opt-in per resident)
   - Compare each non-NULL vital in the daily log against the corresponding threshold
   - If any threshold is exceeded: create a `vital_sign_alerts` row

3. **Weight change detection.** Compare current weight to the weight recorded 7 days ago (most recent `daily_logs.weight_lbs` where `log_date` is within 7 days). If absolute difference exceeds `weight_change_lbs`: alert.

4. **Alert latency.** Alerts appear immediately after the daily log is saved. The caregiver who entered the vitals sees the alert. Nurse sees it on the admin infection control dashboard.

### Staff Illness Tracking

1. **Entry.** Two paths:
   - **Admin/nurse entry:** Admin or nurse records when a staff member calls out sick or presents symptoms.
   - **Self-report:** Staff member reports via `/caregiver/me` → creates their own `staff_illness_records` row (INSERT policy: `staff_self_report_illness`, scoped to own `staff_id`). Admin/nurse reviews and manages from there.
2. **Return clearance.** Before returning to work after illness, staff must be cleared:
   - Self-certification (for minor illness, per facility policy)
   - Occupational health clearance
   - Physician note
   - Negative test result (for COVID/influenza during outbreak)
3. **Staffing impact.** Staff illness records link to `staff` table. The admin dashboard can show: "X staff currently out sick" as a staffing impact indicator.

### Cross-Module Event Triggers (per PHASE2-SCOPE Appendix B)

| Event | Source | Action |
|-------|--------|--------|
| Daily log saved with vitals exceeding threshold | 04 Daily Ops → This module | Create `vital_sign_alerts` row; alert to nurse (mobile) |
| 2+ infection records, same unit, same type, within 72hr | This module | Trigger outbreak detection; generate checklist |
| Outbreak activated | This module | Generate outbreak_actions checklist; notify facility_admin |
| Active infection count changes | This module | Update compliance dashboard tile (Module 08) |

---

## EDGE FUNCTIONS

### `check-outbreak-detection` (on infection_surveillance INSERT — application-level, not cron)

This is NOT a cron job. It runs as application logic after each infection surveillance record is created:
1. Count matching records by type + unit + 72-hour window
2. If threshold met: create or update outbreak
3. Generate checklist if new outbreak

**Alternative implementation:** A Postgres trigger function that runs on INSERT to `infection_surveillance`. This avoids a round-trip but adds complexity to the migration. Decision deferred to implementation — either approach satisfies the business rule.

### `check-vital-alerts` (on daily_log save — application-level)

Runs after daily log save. Not a cron — real-time is important for vital sign alerts.

---

## UI SCREENS

### Admin Shell

#### Infection Control Dashboard (`/admin/infection-control`)

- **Desktop-first.** Overview of infection status across the facility.
- **Summary cards:** Active infections (count), Active outbreaks (count with red badge if any), Staff currently out sick, Vital sign alerts open
- **Active infections table:** Resident, Type, Status, Onset Date, Unit, Treatment, Days Active
- **Outbreak banner:** If active outbreak exists, prominent alert banner at top with link to outbreak detail
- Filter by infection type, unit, date range

#### Infection Surveillance Entry (`/admin/infection-control/new`)

- **Desktop-first.** Structured form for new infection record.
- Fields: Resident (select), Infection Type (select), Onset Date, Symptoms (multi-select checkboxes), Temperature at Onset, Lab Ordered (toggle), Lab Type, Physician Notified (toggle + timestamp)
- Submit → saves; runs outbreak detection logic

#### Infection Surveillance Detail (`/admin/infection-control/[id]`)

- **Desktop-first.** Full record with timeline.
- Shows: classification, symptoms, lab results, treatment, outcome
- Edit capabilities for nurse+: update status, add lab results, add treatment, resolve

#### Outbreak Management (`/admin/infection-control/outbreaks/[id]`)

- **Desktop-first.** Outbreak dashboard with checklist.
- Header: infection type, unit, status, case count, timeline (detected → contained → resolved)
- **Case list:** Linked infection surveillance records with status
- **Action checklist:** Sortable by priority; each row has status, assigned staff, completion controls
- Buttons: "Add Case" (link another surveillance record), "Contain Outbreak" (→ contained), "Resolve Outbreak" (→ resolved)

#### Vitals Trending (`/admin/residents/[id]/vitals`)

- **Desktop-first.** Per-resident vital sign history.
- Line charts: Temperature, BP (systolic/diastolic), Pulse, O2 Sat, Weight over selected date range
- Threshold lines shown on charts (dashed horizontal lines from `vital_sign_alert_thresholds`)
- Alert markers on chart where thresholds were exceeded
- Table view toggle: date, shift, all vital values, alerts triggered

#### Vital Sign Alert Configuration (`/admin/residents/[id]/vitals/thresholds`)

- **Desktop-first.** Configure per-resident alert thresholds.
- Form with fields for each vital sign: high/low thresholds
- Defaults shown as placeholders (standard clinical ranges)
- Notes field for context ("Post-surgical monitoring per Dr. Smith")
- Save → creates or updates `vital_sign_alert_thresholds` row

#### Staff Illness Log (`/admin/infection-control/staff-illness`)

- **Desktop-first.** List of staff illness records.
- Columns: Staff Member, Illness Type, Absent From, Absent To (or "Still Out"), Return Cleared
- Filter: Currently out | Cleared | All
- Click → detail with clearance workflow

### Caregiver Shell

#### Vital Sign Alert Banner (`/caregiver/resident/[id]`)

- **Mobile.** Existing resident profile page.
- Add alert banner at top if any open `vital_sign_alerts` exist for this resident:
  - Red banner: "[Vital] is [value] — exceeds threshold of [threshold]. Notify nurse."
  - Tap → acknowledge (nurse must resolve)

#### Outbreak Checklist (`/caregiver` dashboard)

- **Mobile.** If an active outbreak exists for the caregiver's facility:
  - Alert card on shift brief: "Active [type] outbreak on [unit]. [X] checklist items assigned to you."
  - Tap → list of assigned `outbreak_actions` with completion buttons

#### Staff Illness Self-Report (`/caregiver/me`)

- **Mobile.** Existing profile/session page.
- Add "Report Illness" button → simple form: illness type, symptoms, expected return date
- Submit → creates `staff_illness_records` row (admin reviews)

---

## ENHANCED TIER (build if time allows)

### Immunization Tracking

- New table `immunizations` (resident_id, vaccine_type, administration_date, lot_number, consent_on_file, declination_on_file, declination_reason, next_due_date)
- Vaccine types: flu, pneumococcal_pcv, pneumococcal_ppsv23, covid, zoster, tetanus
- Admin UI: `/admin/residents/[id]/immunizations` — list + entry form
- Dashboard widget: "X% of residents have current flu vaccine"

### Antibiotic Stewardship Dashboard

- Query `infection_surveillance` where `antibiotic_name IS NOT NULL`
- Metrics: courses per resident per year, culture-confirmed vs. empiric treatment ratio, average duration of therapy
- Flag: residents with >3 antibiotic courses in 12 months

### Infection Rate Calculations

- Compute: infections per 1,000 resident-days = (infection count / total resident-days) × 1,000
- By type, by unit, by month
- Trend chart on infection control dashboard

---

## EXPLICIT NON-GOALS (Phase 2)

- **No predictive outbreak detection** — no AI/ML early warning from subtle vital patterns
- **No automated AHCA outbreak reporting** — admin manually reports using system-generated data; system tracks that it was done
- **No external lab result integration** — lab results are manually entered after verbal or fax receipt
- **No public health system integration** — no automated reporting to DOH or CDC
- **No automated visitor restriction notifications** — checklist reminds admin to do it manually

---

## MIGRATION CHECKLIST

**Implemented migration file:** `038_infection_control.sql` (sequence after `037_medication_management_advanced.sql`).

Use **`haven_capture_audit_log()`** and **`haven_set_updated_at()`** (not the illustrative `audit_trigger_function` / `set_updated_at` names in the SQL blocks above). Add **`updated_by`** on tables that use `haven_set_updated_at` (e.g. `outbreak_actions`, `vital_sign_alert_thresholds`).

**Caregiver `vital_sign_alerts` SELECT (normative):** caregivers may see alerts only for residents they have charted in `daily_logs` as `logged_by = auth.uid()`, same org/facility, `log_date >= CURRENT_DATE - interval '1 day'` (least privilege; not facility-wide).

**Outbreak deduplication:** a **contained** outbreak may **reopen to active** when a new case matches within **14 days** of `contained_at` (see §Outbreak Deduplication).

1. Create `infection_surveillance` table with indexes
2. Create `infection_outbreaks` table with indexes
3. Add FK from `infection_surveillance.outbreak_id` to `infection_outbreaks`
4. Create `outbreak_actions` table with indexes
5. Create `vital_sign_alert_thresholds` table with unique index
6. Create `vital_sign_alerts` table with indexes (optional unique partial index on open alerts per `daily_log_id` + `vital_type` for idempotency)
7. Create `staff_illness_records` table with indexes
8. Enable RLS on all 6 tables
9. Create RLS policies (17 total: 2 infection_surveillance, 2 infection_outbreaks, 3 outbreak_actions, 2 vital_sign_alert_thresholds, 3 vital_sign_alerts, 5 staff_illness_records)
10. Create audit triggers on all 6 tables (except `vital_sign_alert_thresholds` — config, not clinical data)
11. Create `haven_set_updated_at` triggers on tables with `updated_at` (+ `updated_by` where applicable)

---

## COL Alignment Notes

**Infection control plan missing:** COL does not have a documented Infection Control Plan in the wiki. FL §429.41 requires a written infection control plan for each facility. The Module 09 outbreak thresholds, case definitions, and response procedures must align with the plan when it is collected. Before pilot: request COL's current written infection control plan from each facility administrator.

**COVID P&P is outdated:** COL's documented COVID-19 procedures are from July 2021 (COVID - P&P Updated July 2021.docx). The infection control module's policy library will surface this document; it should be flagged as requiring review/update before being made active in Haven.

**Staff illness tracking:** COL has a `Staff Illness Log` pattern reflected in their HR forms. The Module 09 `staff_illness_logs` table aligns with this — verify the illness category taxonomy (respiratory, GI, skin/wound, conjunctivitis) matches COL's existing tracking categories.

**Facilities COVID vaccination tracking:** COL tracked COVID vaccination and supply information via `Circle of Life Vaccination & Supply Information.xlsx`. The immunization tracking component of Module 09 should support both resident and staff immunization records (flu, COVID, pneumococcal) consistent with COL's existing tracking structure.
