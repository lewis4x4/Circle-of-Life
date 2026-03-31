# 09 — Infection Control & Health Monitoring

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations, 07-incident-reporting, 11-staff-management
**Build Week:** 19-20
**Phase:** 2

The COVID-19/Pandemic Disease Exclusion endorsement (1166-PXX-00-0620) on COL's insurance policy means pandemic-related claims are NOT covered. Prevention is the only strategy. This module builds the surveillance, detection, and response infrastructure that makes infection outbreaks survivable — operationally and financially.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- INFECTIONS (individual infection events per resident)
-- ============================================================
CREATE TABLE infections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  infection_type text NOT NULL,                  -- "uti", "uri", "pneumonia", "gi", "skin_wound", "skin_cellulitis", "mrsa", "cdiff", "covid", "influenza", "scabies", "conjunctivitis", "other"
  onset_date date NOT NULL,
  reported_date date NOT NULL DEFAULT CURRENT_DATE,
  reported_by uuid NOT NULL REFERENCES auth.users(id),

  -- Symptoms
  symptoms text[] NOT NULL,                      -- ["fever", "cough", "diarrhea", "vomiting", "confusion", "dysuria", "frequency", "skin_redness", "wound_drainage"]
  symptom_onset_date date,
  temperature_at_onset numeric(5,2),

  -- Diagnosis
  confirmed boolean NOT NULL DEFAULT false,      -- suspected vs confirmed
  confirmation_method text,                      -- "lab_culture", "rapid_test", "clinical_diagnosis", "imaging"
  lab_results text,
  diagnosing_physician text,

  -- Treatment
  treatment_started boolean NOT NULL DEFAULT false,
  treatment_type text,                           -- "antibiotic_oral", "antibiotic_iv", "antiviral", "antifungal", "supportive", "isolation_only"
  antibiotic_name text,
  antibiotic_start_date date,
  antibiotic_end_date date,
  antibiotic_duration_days integer,

  -- Isolation/precautions
  isolation_required boolean NOT NULL DEFAULT false,
  isolation_type text,                           -- "contact", "droplet", "airborne", "enhanced_standard"
  isolation_start_date date,
  isolation_end_date date,

  -- Notifications
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  ahca_reportable boolean NOT NULL DEFAULT false,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  health_department_reportable boolean NOT NULL DEFAULT false,
  health_department_reported boolean NOT NULL DEFAULT false,

  -- Outcome
  status text NOT NULL DEFAULT 'active',         -- "active", "improving", "resolved", "hospitalized", "deceased"
  resolution_date date,
  outcome text,                                  -- "resolved_facility", "resolved_hospitalized_returned", "hospitalized_not_returned", "deceased"
  hospitalized boolean NOT NULL DEFAULT false,
  hospital_admission_date date,
  hospital_discharge_date date,

  linked_incident_id uuid,                       -- if this infection led to an incident report
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_infections_resident ON infections(resident_id, onset_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_infections_facility ON infections(facility_id, onset_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_infections_type ON infections(facility_id, infection_type, onset_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_infections_active ON infections(facility_id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_infections_antibiotic ON infections(facility_id) WHERE deleted_at IS NULL AND treatment_type LIKE 'antibiotic%';

-- ============================================================
-- OUTBREAK EVENTS (when infection pattern meets outbreak threshold)
-- ============================================================
CREATE TABLE outbreak_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  outbreak_type text NOT NULL,                   -- same as infection_type
  detected_at timestamptz NOT NULL DEFAULT now(),
  detection_method text NOT NULL,                -- "automated_surveillance" (system detected), "manual_report" (staff reported)

  -- Scope
  affected_unit_ids uuid[],
  affected_resident_ids uuid[],
  affected_resident_count integer NOT NULL,
  affected_staff_ids uuid[],
  affected_staff_count integer NOT NULL DEFAULT 0,

  -- Response
  status text NOT NULL DEFAULT 'active',         -- "active", "contained", "resolved"
  containment_measures text[],                   -- ["contact_isolation", "enhanced_cleaning", "visitor_restriction", "cohorting", "staff_screening", "ppe_enhanced"]
  incident_commander text,                       -- who is managing the response
  incident_commander_id uuid REFERENCES auth.users(id),

  -- Notifications
  administrator_notified_at timestamptz,
  owner_notified_at timestamptz,
  physician_notified_at timestamptz,
  ahca_notified boolean NOT NULL DEFAULT false,
  ahca_notified_at timestamptz,
  health_department_notified boolean NOT NULL DEFAULT false,
  health_department_notified_at timestamptz,
  families_notified boolean NOT NULL DEFAULT false,
  families_notified_at timestamptz,

  -- Timeline
  containment_date date,                         -- when new cases stopped
  resolution_date date,
  total_cases integer,
  total_hospitalizations integer DEFAULT 0,
  total_deaths integer DEFAULT 0,

  after_action_review text,                      -- post-outbreak lessons learned
  after_action_review_date date,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_outbreaks_facility ON outbreak_events(facility_id, detected_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_outbreaks_active ON outbreak_events(facility_id) WHERE deleted_at IS NULL AND status = 'active';

-- ============================================================
-- VITAL SIGN RECORDS (standalone vital sign documentation)
-- ============================================================
CREATE TABLE vital_sign_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  shift shift_type NOT NULL,

  temperature numeric(5,2),                      -- Fahrenheit
  blood_pressure_systolic integer,
  blood_pressure_diastolic integer,
  pulse integer,
  respiration integer,
  oxygen_saturation numeric(5,2),
  pain_level integer CHECK (pain_level >= 0 AND pain_level <= 10),
  blood_glucose integer,                         -- mg/dL

  -- Context
  position text,                                 -- "sitting", "standing", "lying"
  context text,                                  -- "routine", "post_fall", "change_of_condition", "physician_ordered", "pre_medication"

  -- Alert flags (auto-set by business rules)
  has_alert boolean NOT NULL DEFAULT false,
  alert_type text,                               -- "temperature_elevated", "bp_high", "bp_low", "pulse_abnormal", "o2_low", "glucose_high", "glucose_low"
  alert_acknowledged boolean DEFAULT false,
  alert_acknowledged_by uuid REFERENCES auth.users(id),
  alert_acknowledged_at timestamptz,

  notes text,
  linked_daily_log_id uuid REFERENCES daily_logs(id),  -- if documented as part of daily log

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_vitals_resident ON vital_sign_records(resident_id, recorded_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_vitals_facility ON vital_sign_records(facility_id, recorded_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_vitals_alerts ON vital_sign_records(facility_id) WHERE deleted_at IS NULL AND has_alert = true AND alert_acknowledged = false;
CREATE INDEX idx_vitals_temperature ON vital_sign_records(facility_id, recorded_at DESC) WHERE deleted_at IS NULL AND temperature IS NOT NULL;

-- ============================================================
-- VITAL SIGN THRESHOLDS (per-resident configurable alert thresholds)
-- ============================================================
CREATE TABLE vital_sign_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Thresholds (NULL = use facility default)
  temperature_high numeric(5,2) DEFAULT 100.4,
  temperature_low numeric(5,2) DEFAULT 96.0,
  bp_systolic_high integer DEFAULT 160,
  bp_systolic_low integer DEFAULT 90,
  bp_diastolic_high integer DEFAULT 100,
  bp_diastolic_low integer DEFAULT 60,
  pulse_high integer DEFAULT 100,
  pulse_low integer DEFAULT 50,
  respiration_high integer DEFAULT 24,
  respiration_low integer DEFAULT 12,
  o2_saturation_low numeric(5,2) DEFAULT 92.0,
  blood_glucose_high integer DEFAULT 250,
  blood_glucose_low integer DEFAULT 70,

  set_by uuid REFERENCES auth.users(id),
  physician_ordered boolean NOT NULL DEFAULT false,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_vital_thresholds_resident ON vital_sign_thresholds(resident_id) WHERE deleted_at IS NULL;

-- ============================================================
-- IMMUNIZATION RECORDS
-- ============================================================
CREATE TABLE immunization_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  immunization_type text NOT NULL,               -- "influenza", "pneumonia_ppsv23", "pneumonia_pcv13", "covid_primary", "covid_booster", "shingles", "tetanus_tdap", "hepatitis_b", "other"
  vaccine_name text,                             -- brand name
  lot_number text,
  manufacturer text,
  administration_date date NOT NULL,
  administered_by text,                          -- name of person who gave the vaccine
  administration_site text,                      -- "left_deltoid", "right_deltoid"
  dose_number integer,                           -- 1, 2, 3 for multi-dose series

  next_dose_due date,                            -- for multi-dose series
  consent_obtained boolean NOT NULL DEFAULT true,
  consent_document_id uuid,                      -- link to uploaded consent form
  declined boolean NOT NULL DEFAULT false,
  decline_reason text,
  decline_document_id uuid,                      -- link to uploaded declination form

  adverse_reaction boolean NOT NULL DEFAULT false,
  adverse_reaction_description text,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_immunizations_resident ON immunization_records(resident_id, administration_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_immunizations_facility ON immunization_records(facility_id, immunization_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_immunizations_due ON immunization_records(facility_id) WHERE deleted_at IS NULL AND next_dose_due IS NOT NULL AND next_dose_due <= CURRENT_DATE + INTERVAL '30 days';

-- ============================================================
-- STAFF ILLNESS LOG
-- ============================================================
CREATE TABLE staff_illness_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  illness_date date NOT NULL,
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  symptoms text[],
  illness_type text,                             -- "gi", "respiratory", "skin", "fever", "other", "unknown"

  excluded_from_work boolean NOT NULL DEFAULT false,
  exclusion_start_date date,
  exclusion_end_date date,
  return_to_work_clearance boolean DEFAULT false,
  return_to_work_cleared_by text,                -- physician name or "self-certification"
  return_to_work_date date,

  related_to_outbreak boolean NOT NULL DEFAULT false,
  outbreak_event_id uuid REFERENCES outbreak_events(id),

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_illness_facility ON staff_illness_logs(facility_id, illness_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_illness_active ON staff_illness_logs(facility_id) WHERE deleted_at IS NULL AND excluded_from_work = true AND return_to_work_clearance = false;

-- ============================================================
-- INFECTION SURVEILLANCE METRICS (daily facility-level metrics for trending)
-- ============================================================
CREATE TABLE infection_surveillance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  metric_date date NOT NULL,
  active_infections integer NOT NULL DEFAULT 0,
  new_infections_today integer NOT NULL DEFAULT 0,
  residents_on_isolation integer NOT NULL DEFAULT 0,
  residents_on_antibiotics integer NOT NULL DEFAULT 0,
  staff_excluded integer NOT NULL DEFAULT 0,
  active_outbreaks integer NOT NULL DEFAULT 0,

  infection_rate_per_1000_days numeric(8,2),     -- (active_infections / resident_days) * 1000
  resident_days integer NOT NULL,                -- census for this date

  -- By type
  infections_by_type jsonb NOT NULL DEFAULT '{}', -- {"uti": 2, "uri": 1, "gi": 0, ...}

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_surveillance_unique ON infection_surveillance_metrics(facility_id, metric_date);
CREATE INDEX idx_surveillance_facility ON infection_surveillance_metrics(facility_id, metric_date DESC);
```

---

## RLS POLICIES

```sql
ALTER TABLE infections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see infections" ON infections FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));
CREATE POLICY "Nurse+ manage infections" ON infections FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE outbreak_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see outbreaks" ON outbreak_events FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage outbreaks" ON outbreak_events FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE vital_sign_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see vitals" ON vital_sign_records FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role'));
-- Family can see vitals for their linked residents (limited view via API)
CREATE POLICY "Family see linked resident vitals" ON vital_sign_records FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND auth.app_role() = 'family' AND auth.can_access_resident(resident_id));
CREATE POLICY "Caregivers+ document vitals" ON vital_sign_records FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE vital_sign_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see thresholds" ON vital_sign_thresholds FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage thresholds" ON vital_sign_thresholds FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE immunization_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see immunizations" ON immunization_records FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('dietary', 'maintenance_role'));
CREATE POLICY "Nurse+ manage immunizations" ON immunization_records FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE staff_illness_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see staff illness" ON staff_illness_logs FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE infection_surveillance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see surveillance" ON infection_surveillance_metrics FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- Audit triggers
CREATE TRIGGER audit_infections AFTER INSERT OR UPDATE OR DELETE ON infections FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_outbreak_events AFTER INSERT OR UPDATE OR DELETE ON outbreak_events FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_vital_sign_records AFTER INSERT OR UPDATE OR DELETE ON vital_sign_records FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_immunization_records AFTER INSERT OR UPDATE OR DELETE ON immunization_records FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_staff_illness_logs AFTER INSERT OR UPDATE OR DELETE ON staff_illness_logs FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON infections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON outbreak_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON vital_sign_thresholds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON immunization_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_illness_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Vital Sign Alert Thresholds

When a vital_sign_record is created, compare each value against the resident's vital_sign_thresholds (or facility defaults):

| Vital | Default Alert Threshold | Alert Type |
|-------|------------------------|------------|
| Temperature | ≥100.4°F | `temperature_elevated` |
| Temperature | ≤96.0°F | `temperature_low` |
| Systolic BP | ≥160 | `bp_high` |
| Systolic BP | ≤90 | `bp_low` |
| Diastolic BP | ≥100 | `bp_high` |
| Diastolic BP | ≤60 | `bp_low` |
| Pulse | ≥100 | `pulse_abnormal` |
| Pulse | ≤50 | `pulse_abnormal` |
| Respiration | ≥24 | `respiration_abnormal` |
| Respiration | ≤12 | `respiration_abnormal` |
| O2 Saturation | ≤92% | `o2_low` |
| Blood Glucose | ≥250 | `glucose_high` |
| Blood Glucose | ≤70 | `glucose_low` |

**When alert triggers:**
1. Set has_alert=true, alert_type on the vital_sign_record
2. Generate notification to on-shift nurse
3. If temperature ≥100.4°F → also check: is this the 2nd+ resident on the same unit with elevated temperature in 72 hours? If yes → trigger outbreak detection logic.

### Outbreak Detection Algorithm

**Runs on every INSERT on infections AND every vital_sign_record with temperature alert.**

**Criteria for automated outbreak detection:**
- ≥2 residents on the same unit with the same infection_type category within a 72-hour window
- OR ≥3 residents at the same facility (any unit) with the same infection_type category within a 7-day window
- OR ≥2 residents on the same unit with temperature ≥100.4°F within a 48-hour window (even without confirmed infection — this is early detection)

**When outbreak threshold is met:**
1. Create outbreak_event with status='active'
2. Link all involved infections and/or vital sign records
3. Immediate notifications: administrator, owner, on-shift nurse
4. Generate containment recommendation based on infection_type:
   - GI (cdiff, norovirus-like): contact isolation, enhanced cleaning, hand hygiene audit, visitor restriction to affected unit
   - Respiratory (influenza, covid, URI cluster): droplet precautions, consider facility-wide mask requirement, visitor screening
   - Skin (scabies): contact isolation, laundry protocol change, all-resident skin check within 24 hours
5. Auto-flag as AHCA reportable if: ≥3 cases, any hospitalization from the infection, or any reportable disease type

### Antibiotic Stewardship Monitoring

**Monthly calculation (part of surveillance metrics):**
- Count residents currently on antibiotics
- Calculate antibiotic days per 1,000 resident-days for the month
- Flag facilities exceeding organizational average by >25%
- Track antibiotic courses by type and duration:
  - Courses >14 days flagged for review ("extended course — physician justification documented?")
  - >2 antibiotic courses for same resident in 90 days flagged ("recurrent infections — workup indicated?")

### Immunization Schedule Monitoring

| Immunization | Schedule | Alert If Missing |
|-------------|----------|-----------------|
| Influenza | Annually (Sept-March window) | After Oct 31 if no record for current season |
| Pneumonia (PCV13) | Once, then PPSV23 ≥1 year later | If no record on file |
| Pneumonia (PPSV23) | Per CDC schedule | If no record on file |
| COVID (current series) | Per current CDC guidance | If no record within recommended window |
| Shingles (Shingrix) | 2-dose series, ≥50 years old | If no record, age ≥50 |
| Tdap/Td | Every 10 years | If last dose >10 years ago |

**Declined immunizations:** Document declination with reason. Declination form required. Re-offer at next scheduled opportunity. Declination rate tracked as facility metric.

### Florida Reportable Diseases

The system auto-flags `health_department_reportable = true` for:
- COVID-19 (confirmed)
- Influenza (confirmed, with hospitalization or death)
- C. difficile
- MRSA (invasive)
- Norovirus (suspected outbreak)
- Scabies (institutional)
- Tuberculosis (suspected or confirmed)
- Hepatitis A, B
- Any unusual cluster of similar infections

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/residents/:id/infections` | Required | nurse, facility_admin | Infection history |
| POST | `/residents/:id/infections` | Required | nurse, facility_admin | Report infection |
| PUT | `/infections/:id` | Required | nurse, facility_admin | Update infection (treatment, status, outcome) |
| GET | `/facilities/:id/infections/active` | Required | nurse, facility_admin | Active infections across facility |
| GET | `/facilities/:id/outbreaks` | Required | facility_admin, owner | Outbreak events |
| POST | `/facilities/:id/outbreaks` | Required | facility_admin, nurse | Manually declare outbreak |
| PUT | `/outbreaks/:id` | Required | facility_admin | Update outbreak (containment, resolution) |
| GET | `/residents/:id/vitals` | Required | Clinical staff + family (limited) | Vital sign history. Params: `date_from`, `date_to` |
| POST | `/residents/:id/vitals` | Required | caregiver, nurse | Record vital signs |
| GET | `/facilities/:id/vitals/alerts` | Required | nurse, facility_admin | Unacknowledged vital sign alerts |
| PUT | `/vital-sign-records/:id/acknowledge-alert` | Required | nurse | Acknowledge alert |
| GET | `/residents/:id/vital-thresholds` | Required | nurse, facility_admin | Get resident's thresholds |
| PUT | `/residents/:id/vital-thresholds` | Required | nurse, facility_admin | Set/update thresholds |
| GET | `/residents/:id/immunizations` | Required | nurse, facility_admin | Immunization records |
| POST | `/residents/:id/immunizations` | Required | nurse | Record immunization or declination |
| GET | `/facilities/:id/immunizations/compliance` | Required | nurse, facility_admin | Immunization compliance rates by type |
| GET | `/facilities/:id/staff-illness` | Required | facility_admin | Staff illness log |
| POST | `/staff/:id/illness` | Required | facility_admin, nurse | Log staff illness |
| PUT | `/staff-illness-logs/:id` | Required | facility_admin | Update (return to work clearance) |
| GET | `/facilities/:id/infection-surveillance` | Required | facility_admin, nurse, owner | Surveillance dashboard data. Params: `date_from`, `date_to` |
| GET | `/organizations/infection-surveillance` | Required | owner, org_admin | Cross-facility surveillance comparison |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `vital-sign-alert-check` | INSERT on vital_sign_records | Compare values to resident thresholds. Set has_alert and alert_type. Generate nurse notification. Check for outbreak temperature pattern. |
| `outbreak-detection` | INSERT on infections, vital_sign_records with temperature alert | Run outbreak detection algorithm. Create outbreak_event if threshold met. |
| `infection-surveillance-daily` | Cron (midnight ET) | Calculate daily infection_surveillance_metrics for each facility: active infections, rates, antibiotic usage, etc. |
| `immunization-compliance-check` | Cron (weekly, Monday 7 AM ET) | Scan immunization_records for all active residents. Identify missing or overdue immunizations. Generate alerts for nurse/administrator. Calculate facility compliance rates. |
| `antibiotic-stewardship-alert` | Cron (monthly, 1st of month) | Calculate antibiotic usage metrics. Flag outliers. Generate stewardship report for each facility. |
| `staff-illness-outbreak-link` | INSERT on staff_illness_logs | Check if symptoms match any active outbreak. If yes, auto-link to outbreak_event, increment affected_staff_count. |

---

## UI SCREENS

### Web (Admin/Nurse)

| Screen | Route | Description |
|--------|-------|-------------|
| Infection Control Dashboard | `/facilities/:id/infection-control` | Active infections count (with type breakdown), active outbreaks (red alert if any), infection rate trend chart (last 90 days), antibiotic usage chart, immunization compliance rates, staff illness count. Feeds into compliance engine (Module 8 tag for infection control). |
| Infection Log | `/facilities/:id/infections` | Table: resident, infection type, onset date, status, treatment, isolation status. Filter by type, status. |
| Infection Detail | `/infections/:id` | Full record: symptoms, diagnosis, treatment timeline, isolation dates, notifications, outcome. Linked to outbreak if applicable. |
| Outbreak Management | `/outbreaks/:id` | Timeline view: detection → containment measures → case count progression → containment → resolution. Affected residents and staff listed. Notification log. After-action review section. |
| Vital Signs Dashboard | `/facilities/:id/vitals` | Unacknowledged alerts (priority queue). Recent vitals for all residents (sortable table). Trend sparklines per resident. |
| Resident Vital Trend | `/residents/:id/vitals` | Charts: temperature, BP, pulse, O2 over time. Alert threshold lines overlaid. Annotations for medication changes and incidents. |
| Immunization Tracker | `/facilities/:id/immunizations` | Grid: residents × immunization types. Green = current. Yellow = due. Red = overdue/declined. Click cell to record or view detail. Compliance percentage per immunization type. |
| Antibiotic Stewardship Report | `/facilities/:id/antibiotic-stewardship` | Current residents on antibiotics (list). Average course duration. Antibiotic days per 1,000 resident-days (trend). Flagged long courses. Flagged recurrent courses. |
| Org Infection Overview | `/organization/infection-control` | Cross-facility comparison: infection rates, active outbreaks, immunization compliance, antibiotic usage. |

### Mobile (Caregiver)

| Screen | Route | Description |
|--------|-------|-------------|
| Record Vitals | `/shift/residents/:id/vitals` | Large input fields for each vital. Auto-alert if threshold exceeded — screen turns warning color with clear message: "Temperature 101.2°F exceeds threshold. Nurse has been notified." |
| Infection Precautions Badge | Shown on resident card | If resident has active infection with isolation: prominent badge on their card in the shift dashboard showing isolation type and required precautions (e.g., "CONTACT ISOLATION — Gown and gloves required"). |

### Offline Behavior

| Operation | Offline | Sync |
|-----------|---------|------|
| Record vital signs | Yes (queued) | Submit on reconnect. Alert check runs on sync — if threshold exceeded, nurse notification fires at sync time, not local save time. Display "pending sync — alert check will run when online" if values appear abnormal. |
| View vital sign history | Yes (cached last 30 days) | Background refresh |
| Report infection | No (requires current outbreak data for context) | Show offline indicator |
