# Haven Spec Deltas — v2 (Post-COL Response)

**Source:** COL annotations on the 2026-05-05 recap email (response received 2026-05-06).
**Status:** Supplements `HAVEN_SPEC_DELTAS_2026-05-05.md`. Apply both files together.
**Scope:** Schema additions, refinements, and new tables driven by Jessica/Milton's responses.

---

## 1. Schema Additions

### 1.1 NEW: `notification_recipients` config table

The COL response repeatedly named the same alert audience (Administrator, Assistant, Michelle, Jessica) for: Quickmar import misses, activities completion misses, employee compliance misses. Build this once, reuse everywhere.

```sql
CREATE TABLE notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),       -- nullable = org-wide recipient
  event_type TEXT NOT NULL,                          -- 'quickmar_import_missed', 'activity_count_below_threshold', 'employee_non_compliant', 'snack_log_missed', 'round_check_overdue'
  user_id UUID NOT NULL REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, event_type, user_id)
);

CREATE INDEX idx_notification_recipients_lookup
  ON notification_recipients(facility_id, event_type) WHERE active = true;
```

**Seed pattern (per facility):**
```sql
-- Standard 4-recipient alert audience (administrator + assistant resolved per facility)
INSERT INTO notification_recipients (org_id, facility_id, event_type, user_id)
SELECT
  '<org_id>',
  '<facility_id>',
  e.event_type,
  u.user_id
FROM (VALUES
  ('quickmar_import_missed'),
  ('activity_count_below_threshold'),
  ('employee_non_compliant'),
  ('snack_log_missed'),
  ('round_check_overdue')
) AS e(event_type)
CROSS JOIN (VALUES
  ('<facility_admin_id>'),
  ('<facility_assistant_id>'),
  ('<michelle_user_id>'),
  ('<jessica_user_id>')
) AS u(user_id);
```

### 1.2 MODIFY: `rooms` table — seed posted rates

```sql
-- Update Homewood rooms (posted rates confirmed by COL)
UPDATE rooms
SET posted_room_rate_cents = 555000  -- $5,550.00
WHERE facility_id = (SELECT id FROM facilities WHERE dba_name = 'Homewood Lodge, ALF')
  AND unit_type = 'private';

UPDATE rooms
SET posted_room_rate_cents = 400000  -- $4,000.00
WHERE facility_id = (SELECT id FROM facilities WHERE dba_name = 'Homewood Lodge, ALF')
  AND unit_type = 'companion';

-- Apply same defaults to all facilities until Jessica overrides per-facility
UPDATE rooms SET posted_room_rate_cents = 555000 WHERE unit_type = 'private' AND posted_room_rate_cents IS NULL;
UPDATE rooms SET posted_room_rate_cents = 400000 WHERE unit_type = 'companion' AND posted_room_rate_cents IS NULL;
```

### 1.3 MODIFY: `resident_status_history` — billable-day flag

```sql
ALTER TABLE resident_status_history
  ADD COLUMN is_billable_day BOOLEAN GENERATED ALWAYS AS (
    CASE
      WHEN status = 'active' THEN true
      WHEN status = 'bed_hold_hospital' THEN true   -- per Medicaid contract; verify per provider
      WHEN status = 'bed_hold_vacation' THEN true   -- per private-pay contract; verify
      WHEN status = 'discharged' THEN false
      ELSE false
    END
  ) STORED;
```

**TODO:** Replace generated column with a proper rules engine once Jessica confirms per-provider bed-hold billing rules. Some Medicaid providers do not pay full rate for hospital bed holds — this requires a `medicaid_providers.bed_hold_billing_policy` field (e.g., 'full_rate', 'reduced_rate', 'no_pay').

### 1.4 NEW: `medicaid_providers` — bed hold policy

```sql
ALTER TABLE medicaid_providers
  ADD COLUMN bed_hold_hospital_billing TEXT NOT NULL DEFAULT 'full_rate'
    CHECK (bed_hold_hospital_billing IN ('full_rate','reduced_rate','no_pay')),
  ADD COLUMN bed_hold_hospital_reduced_rate_cents INTEGER,
  ADD COLUMN bed_hold_max_days INTEGER;              -- e.g., Medicaid often caps at 7-10 days
```

### 1.5 MODIFY: `scheduled_activities` — completion attestation

```sql
ALTER TABLE scheduled_activities
  ADD COLUMN actual_start_time TIMESTAMPTZ,
  ADD COLUMN confirmed_by_initials TEXT,
  ADD COLUMN confirmed_by_user_id UUID REFERENCES users(id),
  ADD COLUMN confirmed_at TIMESTAMPTZ;
```

### 1.6 NEW: `daily_activity_completion_check` view

Drives the "fewer than 2 activities done today" alert.

```sql
CREATE OR REPLACE VIEW daily_activity_completion_check AS
SELECT
  facility_id,
  scheduled_at::date AS activity_date,
  COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS completed_count,
  COUNT(*) AS scheduled_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) < 2 THEN true
    ELSE false
  END AS below_minimum_threshold
FROM scheduled_activities
GROUP BY facility_id, scheduled_at::date;
```

### 1.7 NEW: `cart_assignments` table (rounds staff-division)

COL divides the resident roster across med-pass cart assignments and uses the **same division for rounds**. Build it once; rounds and meds reference it.

```sql
CREATE TABLE cart_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  shift_config_id UUID NOT NULL REFERENCES round_shift_configs(id),
  assignment_date DATE NOT NULL,
  staff_user_id UUID NOT NULL REFERENCES users(id),
  resident_ids UUID[] NOT NULL,                       -- array of resident_id this staff member covers
  cart_label TEXT,                                    -- 'Cart A', 'Cart B', 'East Wing', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, shift_config_id, assignment_date, staff_user_id)
);

CREATE INDEX idx_cart_assignments_lookup
  ON cart_assignments(facility_id, assignment_date);
```

### 1.8 SEED: `round_shift_configs` — per-facility cadence (4 of 5)

```sql
-- Oakridge / Rising Oaks / Grande Cypress: same cadence
WITH facilities_4 AS (
  SELECT id, dba_name FROM facilities
  WHERE dba_name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Grande Cypress')
)
INSERT INTO round_shift_configs (org_id, facility_id, shift_name, start_time, end_time, cadence_minutes, scheduled_times)
SELECT
  '<org_id>', id, 'Day Shift', '06:00', '18:00', 240,
  ARRAY['06:00','10:00','14:00','17:30']::time[]
FROM facilities_4
UNION ALL
SELECT
  '<org_id>', id, 'Night Shift', '18:00', '06:00', 240,
  ARRAY['18:00','22:00','05:30']::time[]
FROM facilities_4;

-- Homewood: same day cadence, every-2-hours night cadence
INSERT INTO round_shift_configs (org_id, facility_id, shift_name, start_time, end_time, cadence_minutes, scheduled_times)
SELECT '<org_id>', id, 'Day Shift', '06:00', '18:00', 240, ARRAY['06:00','10:00','14:00','17:30']::time[]
FROM facilities WHERE dba_name = 'Homewood Lodge, ALF';

INSERT INTO round_shift_configs (org_id, facility_id, shift_name, start_time, end_time, cadence_minutes, scheduled_times)
SELECT '<org_id>', id, 'Night Shift', '18:00', '06:00', 120, NULL
FROM facilities WHERE dba_name = 'Homewood Lodge, ALF';

-- Plantation: PENDING from Jessica
```

**Note:** Add `scheduled_times TIME[]` to `round_shift_configs` if not already present (allows discrete check times rather than purely interval-based cadence — more accurate to how COL operates).

```sql
ALTER TABLE round_shift_configs
  ADD COLUMN scheduled_times TIME[],                   -- explicit check times (preferred)
  ADD COLUMN grace_period_minutes INTEGER NOT NULL DEFAULT 30;
```

### 1.9 SEED: round_location_vocab + round_activity_vocab

```sql
-- Universal location vocabulary (all facilities)
INSERT INTO round_location_vocab (facility_id, value, display_order)
SELECT f.id, v.val, v.ord
FROM facilities f
CROSS JOIN (VALUES
  ('common_area', 1),
  ('dining_room', 2),
  ('resident_room', 3),
  ('front_porch', 4),
  ('back_porch', 5),
  ('oof_personal_errand', 6),
  ('oof_medical_appointment', 7),
  ('oof_family_friends', 8),
  ('oof_hospitalization', 9),
  ('oof_day_treatment', 10)
) AS v(val, ord);

-- Universal activity vocabulary
INSERT INTO round_activity_vocab (facility_id, value, display_order)
SELECT f.id, v.val, v.ord
FROM facilities f
CROSS JOIN (VALUES
  ('participating_facility_activity', 1),
  ('socializing_with_others', 2),
  ('watching_tv', 3),
  ('resting_in_bed', 4),
  ('sleeping', 5),
  ('individual_activity', 6)
) AS v(val, ord);
```

### 1.10 MODIFY: `family_notes` — delivery method tracking

```sql
CREATE TABLE family_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  authored_by UUID NOT NULL REFERENCES users(id),     -- enforced admin/assistant via RLS
  note_text TEXT NOT NULL,
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('portal_only','portal_and_email','portal_and_sms','portal_and_call')),
  authored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  family_acknowledged_at TIMESTAMPTZ                   -- read receipt
);

-- RLS: only admin + assistant can INSERT
CREATE POLICY family_notes_admin_only_insert ON family_notes FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT user_id FROM user_roles
      WHERE role IN ('administrator','assistant_administrator')
        AND facility_id = family_notes.facility_id
    )
  );
```

### 1.11 MODIFY: `compliance_inspection_schedule` — add menus + permits

```sql
-- No schema change needed; just expand inspection_type vocabulary
-- Add to seed data:
INSERT INTO compliance_inspection_schedule (facility_id, inspection_type, cadence, reminder_lead_days)
SELECT id, 'menu_review', 'annual', 30 FROM facilities;

INSERT INTO compliance_inspection_schedule (facility_id, inspection_type, cadence, reminder_lead_days)
SELECT id, 'occupational_license_renewal', 'annual', 60 FROM facilities;
```

### 1.12 MODIFY: `drill_log` — corrected drill counts

Earlier delta said 4 elopement drills/year; COL response confirms **2 elopement drills/year** (regulatory minimum, not over-compensation).

```sql
-- Drill_log unchanged structurally. Update validation/reporting target counts:
-- Annual targets:
--   fire: 6
--   elopement (lockdown): 2
--   tornado: 0 (not currently tracked)
```

Update annual drill compliance check function:
```sql
CREATE OR REPLACE FUNCTION drill_compliance_check(p_facility_id UUID, p_year INT)
RETURNS TABLE(drill_type TEXT, target INT, completed INT, deficit INT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.drill_type,
    CASE d.drill_type WHEN 'fire' THEN 6 WHEN 'lockdown' THEN 2 END AS target,
    COUNT(d.id)::INT AS completed,
    GREATEST(0, CASE d.drill_type WHEN 'fire' THEN 6 WHEN 'lockdown' THEN 2 END - COUNT(d.id))::INT AS deficit
  FROM drill_log d
  WHERE d.facility_id = p_facility_id
    AND EXTRACT(YEAR FROM d.drill_date) = p_year
    AND d.drill_type IN ('fire','lockdown')
  GROUP BY d.drill_type;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 1.13 MODIFY: `snack_logs` — required passer field

```sql
ALTER TABLE snack_logs
  ALTER COLUMN recorded_by SET NOT NULL,                -- "who passed snack"
  ADD COLUMN snack_description TEXT;                    -- nullable; deferred Phase 1+
```

### 1.14 NEW: `snack_log_reminders` config

```sql
CREATE TABLE snack_log_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  expected_snack_time TIME NOT NULL,                    -- e.g., 14:00
  reminder_lead_minutes INTEGER NOT NULL DEFAULT 15,
  alert_threshold_minutes INTEGER NOT NULL DEFAULT 60,  -- alert if no log this many min after expected
  active BOOLEAN NOT NULL DEFAULT true
);
```

### 1.15 NEW: Employee compliance lifecycle tables

```sql
CREATE TABLE employee_application_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  user_id UUID REFERENCES users(id),                    -- null until hired
  applicant_name TEXT NOT NULL,
  application_received_at TIMESTAMPTZ,
  background_check_status TEXT CHECK (background_check_status IN ('pending','passed','failed','not_required')),
  background_check_completed_at TIMESTAMPTZ,
  references_complete BOOLEAN NOT NULL DEFAULT false,
  references_completed_at TIMESTAMPTZ,
  hire_date DATE,
  stage TEXT NOT NULL DEFAULT 'application'
    CHECK (stage IN ('application','background_check','references','hired','onboarding','active','terminated','withdrawn'))
);

CREATE TABLE employee_compliance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  user_id UUID NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  -- Item types:
  -- Pre-service (must complete BEFORE working on floor):
  --   'resident_rights', 'infection_control', 'universal_precautions'
  -- Within 30 days of hire:
  --   'communicable_disease', 'tb_test', 'cpr_first_aid', 'in_service_general'
  -- Role-specific:
  --   'med_tech_training', 'med_tech_attestation'
  required_by_phase TEXT NOT NULL CHECK (required_by_phase IN ('pre_service','within_30_days','role_specific','annual')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  evidence_url TEXT,                                    -- certification PDF, etc.
  is_required BOOLEAN NOT NULL DEFAULT true,
  notes TEXT
);

CREATE INDEX idx_emp_compliance_user ON employee_compliance_items(user_id);
CREATE INDEX idx_emp_compliance_overdue
  ON employee_compliance_items(facility_id, due_date)
  WHERE completed_at IS NULL;

CREATE TABLE employee_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  attestation_type TEXT NOT NULL,
  -- 'training_completed', 'med_tech_self_attestation' (received training + understands regs + feels prepared)
  attestation_text TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signer_ip INET
);

-- Permanent out-of-compliance flag on user
ALTER TABLE users
  ADD COLUMN compliance_failure_at TIMESTAMPTZ,
  ADD COLUMN compliance_failure_reason TEXT;
```

### 1.16 MODIFY: `role_presets` — expanded role list

```sql
INSERT INTO role_presets (org_id, name, is_system_default)
VALUES
  ('<org_id>', 'Cook', true),
  ('<org_id>', 'Medication Technician', true),
  ('<org_id>', 'Housekeeping Aide', true)
ON CONFLICT (org_id, name) DO NOTHING;

-- Universal-worker flag on users
ALTER TABLE users
  ADD COLUMN is_universal_worker BOOLEAN NOT NULL DEFAULT true;
-- When true: user can hold multiple role presets and inherits union of permissions
-- When false: user locked to a single primary role preset
```

### 1.17 NEW: User → multiple role presets (universal worker support)

```sql
CREATE TABLE user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  preset_id UUID NOT NULL REFERENCES role_presets(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, preset_id)
);

CREATE INDEX idx_user_roles_lookup ON user_role_assignments(user_id);
```

### 1.18 MODIFY: `facilities` — required forms map

```sql
ALTER TABLE facilities
  ADD COLUMN requires_1823 BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN requires_service_plan BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN requires_community_support_plan BOOLEAN NOT NULL DEFAULT false;

-- Apply confirmed mapping
UPDATE facilities SET
  requires_1823 = true,
  requires_service_plan = false,
  requires_community_support_plan = false
WHERE dba_name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Grande Cypress', 'Homewood Lodge, ALF');

UPDATE facilities SET
  requires_1823 = true,
  requires_service_plan = true,
  requires_community_support_plan = true
WHERE dba_name LIKE 'Plantation%';
```

---

## 2. Edge Function Updates

### 2.1 NEW: `activity-completion-monitor`

**Trigger:** Cron daily at 21:00 ET (after typical activity windows close)
**Logic:**
1. For each facility, query `daily_activity_completion_check` view for today.
2. If `below_minimum_threshold = true`:
   - Pull recipient list from `notification_recipients` where event_type = 'activity_count_below_threshold'
   - Send alert email/SMS with deficit detail.

### 2.2 NEW: `employee-compliance-monitor`

**Trigger:** Cron daily at 06:00 ET
**Logic:**
1. Query `employee_compliance_items` where `completed_at IS NULL` and `due_date <= today + interval '7 days'`.
2. Categorize by deadline tier (pre-service overdue, within-30-days at 21/25/28 days from hire).
3. Alert recipients per `notification_recipients` event_type = 'employee_non_compliant'.
4. If `due_date < today`, mark `users.compliance_failure_at` (permanent flag).

### 2.3 MODIFY: `quickmar-import-watcher` — recipient list

Replace hardcoded recipient list with lookup against `notification_recipients` event_type = 'quickmar_import_missed'.

### 2.4 NEW: `snack-log-monitor`

**Trigger:** Cron every 15 min
**Logic:**
1. For each `snack_log_reminders` row active right now, check whether a `snack_logs` row exists in the `[expected_snack_time - reminder_lead, expected_snack_time + alert_threshold]` window.
2. If no log found and current time > expected + alert_threshold, alert.

### 2.5 NEW: `qb-sync-orchestrator` (planned)

**Trigger:** Cron hourly + on-demand
**Logic:**
1. Pull invoices, payments, statements via QB Online API per facility.
2. Generate aging report (current, 30, 60, 90+) per resident per facility.
3. Surface to Executive Intelligence dashboard.

**Blocked on:** Milton's QB Online migration sign-off.

---

## 3. Updated Open Dependencies

| Dependency | Owner | Status | Blocks |
|---|---|---|---|
| Plantation rounds cadence (day + night) | Jessica | OPEN | Plantation rounds module |
| Donna's DocuSign arbitration confirmation | Donna (via Jessica) | EMAILED 5/6 | DocuSign launch |
| Encrypted email provider name | Jessica | OPEN | Medicaid pipeline outbound |
| Homewood document dump (face sheets, AR, census, drills, contracts) | Jessica + William | OPEN | 90% data load milestone |
| Milton's QB Online migration sign-off | Milton | OPEN | QB sync build |
| Terell intake session for maintenance task catalog | Brian + Terell | NOT SCHEDULED | Maintenance module seed |
| Rising Oaks office site visit pre-sheet-rock | Brian | NOT SCHEDULED | Access control wiring |
| Per-Medicaid-provider bed-hold billing rules | Jessica | OPEN | Billable-day census report |
| Snack window cutoff per facility | Jessica | OPEN | Snack-log alert engine |
| Rounds-vs-Quickmar narrative duplication design | Brian | OPEN | Final rounds UX |
| Anthropic BAA status | Brian | OPEN | All AI subsystems |
| FL ALF facial recognition legality | Brian | OPEN | Phase 2 camera FR |

---

## 4. Resolved Items (Spec-Complete)

- ✅ Posted room rates: $5,550 private / $4,000 companion (org-wide default)
- ✅ Resident status enum (4-state) drives billable-day tracking
- ✅ Rounds cadence for 4 of 5 facilities seeded (`scheduled_times` array model)
- ✅ Round location + activity vocabulary (universal across all facilities)
- ✅ Activity completion attestation (start_time + initials + user_id)
- ✅ Activities daily-minimum alert (2 required)
- ✅ Standard alert recipient pattern (admin + assistant + Michelle + Jessica)
- ✅ Family Portal one-way scope + delivery_method tracking
- ✅ Annual compliance items: 6 fire drills + 2 elopement drills + menus + permits + occupational licenses
- ✅ Snack log fields (passer + time required; description deferred)
- ✅ Employee module full lifecycle (application → pre-service → 30-day → role-specific attestation)
- ✅ Med tech self-attestation requirement
- ✅ Role presets expanded to 9 (added Cook, Med Tech, Housekeeping)
- ✅ Universal-worker flag for cross-trained staff
- ✅ Forms inventory mapped per facility (4 facilities = 1823 only; Plantation = all 3)
- ✅ Cart assignment model (resident-list division reused for rounds + meds)
- ✅ QB integration preference: Path B (API integration) per Jessica

---

## 5. Files to Update in Spec Repo

In addition to the v1 file list, also update:

- `specs/phase1/schema.sql` — apply sections 1.1–1.18 from this file
- `specs/phase1/modules/employees.md` — NEW (full M4 lifecycle spec)
- `specs/phase1/modules/notifications.md` — NEW (notification_recipients pattern)
- `specs/phase1/modules/cart_assignments.md` — NEW
- `specs/phase1/integrations/qb_online.md` — NEW (Path B confirmed)
- `specs/phase1/modules/family_portal.md` — append RLS-enforced admin-only insert
- `specs/phase1/modules/rounds.md` — append per-facility seed cadence + grace period model
- `specs/phase1/modules/activities.md` — append confirmation attestation + 2-per-day alert
- `specs/phase1/modules/compliance_inspections.md` — add menus, permits, drill counts (6 fire / 2 elopement)
- `specs/HAVEN-DATA-MAP.md` — append v2 schema additions
- `specs/GAP-ANALYSIS.md` — close items in Section 4; add open items from Section 3
