# 07 — Incident & Risk Management

**Dependencies:** 00-foundation, 03-resident-profile, 04-daily-operations
**Build Week:** 7-8

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- INCIDENTS
-- ============================================================
CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid REFERENCES residents(id),     -- NULL for environmental incidents not involving specific residents
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Classification
  incident_number text NOT NULL,                 -- auto-generated: "OAK-2026-0042" (facility code-year-sequence)
  category incident_category NOT NULL,
  severity incident_severity NOT NULL,
  status incident_status NOT NULL DEFAULT 'open',

  -- When/Where
  occurred_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  location_description text NOT NULL,            -- "Resident room 114", "Hallway near dining room", "Bathroom"
  location_type text,                            -- "resident_room", "bathroom", "hallway", "dining_room", "common_area", "outdoor", "other"
  unit_id uuid REFERENCES units(id),
  room_id uuid REFERENCES rooms(id),

  -- Description
  description text NOT NULL,                     -- factual description of what happened
  immediate_actions text NOT NULL,               -- what was done immediately after
  contributing_factors text[],                   -- ["medication_change", "new_footwear", "wet_floor", "lighting", "unfamiliar_environment", "cognitive_decline", "rushing", "staffing"]

  -- Fall-specific fields
  fall_witnessed boolean,
  fall_type text,                                -- "mechanical" (tripped, slipped), "physiological" (faint, dizzy, seizure), "unknown"
  fall_activity text,                            -- "ambulating", "transferring", "toileting", "reaching", "standing", "unknown"
  fall_assistive_device_used boolean,
  fall_footwear text,                            -- "non_skid", "slippers", "socks_only", "barefoot", "shoes"
  fall_bed_rails text,                           -- "up_per_care_plan", "down_per_care_plan", "not_applicable"
  fall_call_light_accessible boolean,

  -- Injury
  injury_occurred boolean NOT NULL DEFAULT false,
  injury_description text,
  injury_severity text,                          -- "none", "minor" (bruise, scrape), "moderate" (laceration, sprain), "major" (fracture, head injury), "fatal"
  injury_body_location text,                     -- anatomical location
  injury_treatment text,                         -- "first_aid", "physician_exam", "er_visit", "hospitalization"

  -- Elopement-specific
  elopement_last_seen_at timestamptz,
  elopement_last_seen_location text,
  elopement_found_at timestamptz,
  elopement_found_location text,
  elopement_law_enforcement_called boolean,
  elopement_law_enforcement_called_at timestamptz,
  elopement_outcome text,                        -- "returned_safely", "injured", "hospitalized", "deceased"

  -- Reporter
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  witness_names text[],
  witness_statements text[],

  -- Notifications (tracked with timestamps)
  nurse_notified boolean NOT NULL DEFAULT false,
  nurse_notified_at timestamptz,
  nurse_notified_by uuid REFERENCES auth.users(id),
  administrator_notified boolean NOT NULL DEFAULT false,
  administrator_notified_at timestamptz,
  owner_notified boolean NOT NULL DEFAULT false,
  owner_notified_at timestamptz,
  physician_notified boolean NOT NULL DEFAULT false,
  physician_notified_at timestamptz,
  physician_orders_received text,
  family_notified boolean NOT NULL DEFAULT false,
  family_notified_at timestamptz,
  family_notified_by uuid REFERENCES auth.users(id),
  family_notified_method text,                   -- "phone", "portal", "in_person"
  ahca_reportable boolean NOT NULL DEFAULT false,
  ahca_reported boolean NOT NULL DEFAULT false,
  ahca_reported_at timestamptz,
  insurance_reportable boolean NOT NULL DEFAULT false,
  insurance_reported boolean NOT NULL DEFAULT false,
  insurance_reported_at timestamptz,

  -- Resolution
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text,
  care_plan_updated boolean NOT NULL DEFAULT false,
  care_plan_update_notes text,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_incidents_resident ON incidents(resident_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_incidents_facility ON incidents(facility_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_incidents_org ON incidents(organization_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_incidents_category ON incidents(facility_id, category, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_incidents_severity ON incidents(facility_id, severity) WHERE deleted_at IS NULL AND status != 'closed';
CREATE INDEX idx_incidents_status ON incidents(facility_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_incidents_number ON incidents(incident_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_incidents_number_unique ON incidents(incident_number);

-- ============================================================
-- INCIDENT FOLLOW-UPS (post-incident protocol tasks)
-- ============================================================
CREATE TABLE incident_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  resident_id uuid REFERENCES residents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  task_type text NOT NULL,                       -- "vitals_check", "neuro_check", "physician_followup", "fall_risk_reassessment", "care_plan_review", "environment_assessment", "family_followup", "72hr_monitoring", "root_cause_analysis", "staff_retraining", "equipment_check"
  description text NOT NULL,
  due_at timestamptz NOT NULL,
  assigned_to uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  completion_notes text,
  overdue_alert_sent boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_followups_incident ON incident_followups(incident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_followups_assigned ON incident_followups(assigned_to) WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX idx_followups_overdue ON incident_followups(due_at) WHERE deleted_at IS NULL AND completed_at IS NULL;

-- ============================================================
-- INCIDENT PHOTOS
-- ============================================================
CREATE TABLE incident_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  storage_path text NOT NULL,
  description text,
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_incident_photos ON incident_photos(incident_id);

-- ============================================================
-- INCIDENT SEQUENCE COUNTER (per facility per year)
-- ============================================================
CREATE TABLE incident_sequences (
  facility_id uuid NOT NULL REFERENCES facilities(id),
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, year)
);
```

---

## RLS POLICIES

```sql
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see incidents in accessible facilities"
  ON incidents FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() NOT IN ('family', 'dietary', 'maintenance_role')
  );

-- Family can see incidents involving their linked resident (limited fields via API, not RLS)
CREATE POLICY "Family see incidents for linked residents"
  ON incidents FOR SELECT
  USING (
    organization_id = auth.organization_id()
    AND deleted_at IS NULL
    AND auth.app_role() = 'family'
    AND resident_id IS NOT NULL
    AND auth.can_access_resident(resident_id)
  );

CREATE POLICY "Caregivers+ can create incidents"
  ON incidents FOR INSERT
  WITH CHECK (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver')
  );

CREATE POLICY "Nurse+ can update incidents"
  ON incidents FOR UPDATE
  USING (
    organization_id = auth.organization_id()
    AND facility_id IN (SELECT auth.accessible_facility_ids())
    AND (
      reported_by = auth.uid()  -- reporter can update their own
      OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    )
  );

ALTER TABLE incident_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see followups" ON incident_followups FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));
CREATE POLICY "Clinical staff manage followups" ON incident_followups FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'caregiver'));

ALTER TABLE incident_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff see photos" ON incident_photos FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() NOT IN ('family', 'dietary', 'maintenance_role'));

-- Audit triggers
CREATE TRIGGER audit_incidents AFTER INSERT OR UPDATE OR DELETE ON incidents FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_incident_followups AFTER INSERT OR UPDATE OR DELETE ON incident_followups FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON incident_followups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Incident Number Generation
- Format: `{FACILITY_CODE}-{YEAR}-{SEQUENCE}`
- Facility codes: OAK (Oakridge), RIS (Rising Oaks), HOM (Homewood Lodge), PLA (Plantation), GRA (Grande Cypress)
- Sequence resets annually: OAK-2026-0001, OAK-2026-0002, etc.
- Generated atomically using `incident_sequences` table with `UPDATE ... RETURNING`

### Severity Classification & Auto-Actions

| Severity | Criteria | Auto-Notifications | Auto-Follow-ups |
|----------|----------|-------------------|-----------------|
| Level 1 | No injury. No elopement. No abuse allegation. Minor behavioral event. | Log only. Show on shift handoff. | None required. |
| Level 2 | Minor injury (bruise, scrape). Medication refusal (not error). Repeated behavioral event. Unwitnessed fall without injury. | Alert nurse. Alert administrator. | 72-hour monitoring if fall. Fall risk reassessment within 24h. |
| Level 3 | Moderate injury (laceration needing treatment, sprain). Medication error. Witnessed fall with injury. Abuse/neglect allegation. Elopement (resolved safely). | Alert nurse (immediate). Alert administrator (immediate). Alert owner. Alert physician. Alert family. | 72-hour neuro checks (head involvement). Fall risk reassessment within 24h. Care plan review within 48h. Root cause analysis within 72h. Environment assessment within 24h. |
| Level 4 | Major injury (fracture, head injury). Elopement with injury. Hospitalization required. Death. Any incident requiring AHCA reporting. | All Level 3 notifications + AHCA reporting trigger + Insurance carrier notification trigger. | All Level 3 follow-ups + AHCA report preparation. Formal root cause analysis. Staff debriefing. |

### Post-Fall Protocol (Auto-Generated Follow-ups)
WHEN an incident with category LIKE 'fall_%' is created:

| Task | Due | Assigned To |
|------|-----|-------------|
| Vital signs check | Immediately (0 hours) | Reporting caregiver |
| Vital signs recheck | +4 hours | On-shift caregiver |
| Vital signs recheck | +8 hours | On-shift caregiver |
| Neuro check (if head involvement) | Every 2 hours for 24 hours | On-shift nurse/caregiver |
| Physician notification | Within 1 hour of discovery | Nurse |
| Family notification | Within 2 hours of discovery | Nurse or administrator |
| Fall risk reassessment (Morse) | Within 24 hours | Nurse |
| Environment assessment | Within 24 hours | Nurse or administrator |
| Care plan review | Within 48 hours | Nurse |
| 72-hour enhanced monitoring | 72 hours from incident | All shift caregivers |
| Root cause analysis | Within 72 hours | Administrator |

### AHCA Reportable Events (Florida-Specific)
The system flags `ahca_reportable = true` when:
- Resident death under unusual/suspicious circumstances
- Abuse or neglect allegation (any)
- Elopement from facility
- Injury requiring ER visit or hospitalization
- Sexual misconduct allegation
- Any event meeting Florida Statute 429.23 reporting requirements

### Insurance Reporting Threshold
The system flags `insurance_reportable = true` when:
- Severity Level 3 or 4
- Injury requiring medical treatment beyond first aid
- Any abuse/neglect allegation
- Any elopement
- Any event that could reasonably result in a claim exceeding the $25,000 per-event deductible

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/incidents` | Required | Clinical staff | List incidents. Params: `facility_id`, `resident_id`, `category`, `severity`, `status`, `date_from`, `date_to` |
| GET | `/incidents/:id` | Required | Clinical staff | Get incident full detail |
| POST | `/incidents` | Required | caregiver, nurse, facility_admin | Create incident |
| PUT | `/incidents/:id` | Required | Reporter or nurse+ | Update incident |
| POST | `/incidents/:id/photos` | Required | caregiver, nurse | Upload incident photo |
| GET | `/incidents/:id/followups` | Required | Clinical staff | List follow-up tasks |
| PUT | `/incident-followups/:id/complete` | Required | Assigned staff or nurse+ | Complete follow-up task |
| GET | `/facilities/:id/incidents/dashboard` | Required | facility_admin, nurse, owner, org_admin | Incident dashboard: open incidents, overdue follow-ups, trend data |
| GET | `/organizations/incidents/trends` | Required | owner, org_admin | Cross-facility incident trends |
| GET | `/incidents/overdue-followups` | Required | nurse, facility_admin | List overdue follow-up tasks across facility |

### Incident Creation Request
```json
{
  "resident_id": "uuid",
  "facility_id": "uuid",
  "category": "fall_with_injury",
  "severity": "level_2",
  "occurred_at": "2026-03-30T14:30:00-04:00",
  "shift": "day",
  "location_description": "Resident room 114, between bed and bathroom",
  "location_type": "resident_room",
  "room_id": "uuid",
  "description": "Resident found on floor beside bed. States she was trying to reach the bathroom. Alert and oriented.",
  "immediate_actions": "Assisted resident to seated position. Assessed for injury. Vital signs taken. Ice applied to right hip.",
  "injury_occurred": true,
  "injury_description": "Bruise forming on right hip. No deformity. Full range of motion. Denies severe pain.",
  "injury_severity": "minor",
  "injury_body_location": "right_hip",
  "fall_witnessed": false,
  "fall_type": "unknown",
  "fall_activity": "transferring",
  "fall_assistive_device_used": false,
  "fall_footwear": "socks_only",
  "fall_call_light_accessible": true,
  "contributing_factors": ["rushing", "improper_footwear"]
}
```

### Incident Dashboard Response
```json
{
  "facility_id": "uuid",
  "period": "current_month",
  "open_incidents": 3,
  "overdue_followups": 1,
  "incidents_by_category": {
    "fall_with_injury": 2,
    "fall_without_injury": 3,
    "medication_error": 1,
    "behavioral_resident_to_resident": 1
  },
  "incidents_by_severity": {
    "level_1": 4,
    "level_2": 2,
    "level_3": 1,
    "level_4": 0
  },
  "fall_rate_per_1000_days": 4.2,
  "comparison_prior_month": {
    "fall_rate_per_1000_days": 3.8,
    "change_percent": 10.5
  },
  "recent_incidents": [...]
}
```

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `incident-created` | INSERT on incidents | Generate incident_number. Evaluate severity → create auto-notifications (email/SMS). Create auto-follow-up tasks per post-fall/post-elopement protocol. Flag ahca_reportable and insurance_reportable. |
| `incident-followup-overdue-check` | Cron (every 30 min) | Scan incident_followups where due_at < now() AND completed_at IS NULL AND overdue_alert_sent = false. Generate alert to assigned_to and facility_admin. Set overdue_alert_sent = true. |
| `incident-trend-calculator` | Cron (daily at 5 AM ET) | Calculate fall rate, medication error rate, behavioral incident rate per 1,000 resident-days for each facility. Store in a trends cache table for dashboard performance. |

---

## UI SCREENS

Route and shell conventions follow `docs/specs/FRONTEND-CONTRACT.md`.

### Mobile (Caregiver — Primary Incident Reporting Interface)

| Screen | Route | Description |
|--------|-------|-------------|
| Report Incident | `/caregiver/incident-draft` | Step-through guided form: 1) Resident (or "Environmental"), 2) Category picker (large icons), 3) When/where, 4) Description, 5) Fall-specific fields (conditional), 6) Injury assessment, 7) Immediate actions, 8) Photos, 9) Review & submit |
| My Follow-ups | `/caregiver/followups` | List of assigned follow-up tasks: due time, resident, task type. Tap to complete with notes. |

### Web (Admin/Nurse Dashboard)

| Screen | Route | Description |
|--------|-------|-------------|
| Incident Dashboard | `/admin/incidents` | Open incidents, overdue follow-ups, monthly trends chart, incident rate metrics |
| Incident Detail | `/admin/incidents/:id` | Full incident record, photo gallery, follow-up task checklist, notification log, linked care plan changes |
| Org Incident Trends | `/admin/incidents/trends` | Cross-facility comparison: fall rates, incident rates by category, severity distribution. Date range selector. |
| Root Cause Analysis | `/admin/incidents/:id/rca` | Structured RCA form: contributing factors checklist, environmental factors, medication factors, staffing factors, corrective actions planned |

### Offline Behavior

| Operation | Offline | Sync |
|-----------|---------|------|
| Create incident report | Yes (queued with local timestamp and photos stored locally) | Submit on reconnect. Severity-based notifications fire on sync. Incident number assigned on sync. |
| Complete follow-up task | Yes (queued) | Submit on reconnect |
| View incident list | Yes (cached) | Background refresh |
| Upload photos | Yes (stored locally) | Upload on reconnect |
