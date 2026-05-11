# Haven Engineer Handoff v2 — Gap Analysis Against Existing Schema

**Replaces:** `HAVEN_ENGINEER_HANDOFF.md` (which assumed greenfield).
**Prepared:** 2026-05-11
**Database state when prepared:** 278 tables existing on Haven (`manfqmasfqppukpobpld`), mostly empty scaffolding from prior LLM passes. Only `organizations` (2 rows), `facilities` (6 rows), `user_profiles` (22 rows), and `documents` (23 rows) have data.

---

## Read this first — the situation has changed

The earlier handoff was wrong because I didn't inspect the existing schema. The Haven build is **already 80% scaffolded**. The job is now:

1. **VERIFY** — confirm the 6 facilities are the right 5 COL facilities (one is likely a test/duplicate)
2. **SEED** — populate empty tables with COL discovery data (rates, rooms, beds, staff, etc.)
3. **ADD** — add the small number of truly missing columns and tables for COL-specific concepts (Medicaid rate_unit, facility wings, resident contracts, BoldSign)
4. **DO NOT REBUILD** — the existing tables for rounds, activities, family portal, compliance, staff certifications, notifications are already well-modeled

---

## 0. Pre-flight — Verify and clean up

### 0.1 Confirm the 6 facilities

The database shows 6 facilities but COL has 5 (Homewood Lodge, Oakridge ALF, Rising Oaks ALF, Grande Cypress ALF, Plantation on Summers ALF). Run:

```sql
SELECT id, name, license_number, total_licensed_beds, status, created_at
FROM facilities
ORDER BY created_at;
```

If a 6th facility exists and is a test/duplicate, soft-delete it:

```sql
UPDATE facilities SET deleted_at = now() WHERE id = '<duplicate_facility_id>';
```

### 0.2 Capture facility IDs for seed scripts

Run and save output for downstream scripts:

```sql
SELECT name, id FROM facilities WHERE deleted_at IS NULL ORDER BY name;
```

---

## 1. Resident Status Enum — ADD NEW VALUES

**Existing enum `resident_status`:**
- inquiry, pending_admission, active, hospital_hold, loa, discharged, deceased

**COL discovery said we need:** active, bed_hold_hospital, bed_hold_vacation, discharged.

**Gap analysis:**
- `active` → maps to existing `active` ✅
- `bed_hold_hospital` → maps to existing `hospital_hold` ✅ (rename in UI only; don't change enum)
- `bed_hold_vacation` → maps to existing `loa` (Leave of Absence) ✅ (rename in UI only)
- `discharged` → maps to existing `discharged` ✅
- `deceased`, `inquiry`, `pending_admission` are bonuses we should preserve

**Action:** No enum changes needed. UI must surface `hospital_hold` as "Bed Hold — Hospital" and `loa` as "Bed Hold — Vacation/Family." That mapping is config, not schema.

```sql
-- Verification: confirm the enum values are usable
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'resident_status'::regtype ORDER BY enumsortorder;
```

**Billable-day logic:** No `is_billable_day` column exists yet. Decision: don't add a column — compute at query time via this view:

```sql
CREATE OR REPLACE VIEW resident_billable_status AS
SELECT
  id AS resident_id,
  status,
  CASE
    WHEN status IN ('active', 'hospital_hold', 'loa') THEN true
    WHEN status IN ('inquiry', 'pending_admission', 'discharged', 'deceased') THEN false
  END AS is_billable
FROM residents
WHERE deleted_at IS NULL;
```

**Per-provider bed-hold billing nuance (Jessica still owes us this):** Some Medicaid providers don't pay full rate during `hospital_hold`. Defer until Jessica provides per-provider policy. For now, treat all of (active, hospital_hold, loa) as billable.

---

## 2. Resident Status History — CHECK IF NEEDED

The existing schema does NOT have a `resident_status_history` table. The `residents` table has `admission_date`, `discharge_date`, `discharge_reason`, `discharge_destination` but no rolling history.

Census reports inspectors ask for require knowing day-by-day status for the prior 6 months. Either:

**Option A:** Add the history table (cleaner, matches inspector requirements):

```sql
CREATE TABLE resident_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  status resident_status NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_resident_status_history_resident
  ON resident_status_history(resident_id, effective_from);
CREATE INDEX idx_resident_status_history_facility_dates
  ON resident_status_history(facility_id, effective_from, effective_to);

ALTER TABLE resident_status_history ENABLE ROW LEVEL SECURITY;

-- Trigger to auto-write on resident.status change
CREATE OR REPLACE FUNCTION fn_resident_status_history_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE resident_status_history
      SET effective_to = now()
      WHERE resident_id = NEW.id AND effective_to IS NULL;
    INSERT INTO resident_status_history (organization_id, facility_id, resident_id, status, effective_from, created_by)
    VALUES (NEW.organization_id, NEW.facility_id, NEW.id, NEW.status, now(), auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_resident_status_history
  AFTER UPDATE ON residents
  FOR EACH ROW EXECUTE FUNCTION fn_resident_status_history_trigger();
```

**Option B:** Skip the history table. Use `census_daily_log` (which already exists) as the source of truth for per-day census. Engineer should inspect `census_daily_log` columns first to decide.

**Recommended:** Build Option A. The trigger guarantees no gaps. Run the inspection to be sure first:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'census_daily_log' ORDER BY ordinal_position;
```

---

## 3. Rate Model — USE EXISTING, ADD MINIMAL FIELDS

The existing schema is well-built:
- `rate_schedules` (facility-level) — already has `base_rate_private`, `base_rate_semi_private`, `care_surcharge_level_1/2/3`, `community_fee`, `pet_fee`, `bed_hold_daily_rate`
- `rate_schedule_versions` — versioning support
- `resident_payers` — already has `medicaid_rate`, `medicaid_recipient_id`, `medicaid_authorization_start/end`, `medicaid_patient_responsibility`, `payer_share_type`, `payer_fixed_amount`, `payer_percentage`
- `admission_case_rate_terms` — already has `quoted_base_rate_cents`, `quoted_care_surcharge_cents`, `accommodation_type`

**Gap 1: `rate_unit` (monthly vs daily Medicaid rate)** — Plantation MMA is $15.58/day. The `medicaid_rate` column on `resident_payers` is INTEGER without a unit. Add:

```sql
ALTER TABLE resident_payers
  ADD COLUMN medicaid_rate_unit TEXT NOT NULL DEFAULT 'monthly'
    CHECK (medicaid_rate_unit IN ('monthly', 'daily', 'per_billable_day'));
```

**Gap 2: Posted-rate enforcement** — there's no built-in trigger preventing (private contribution + medicaid payment) > posted room rate. Decision: keep this validation in application code (in the admission_case workflow), not in a DB trigger. Reason: the existing model uses `admission_case_rate_terms.quoted_base_rate_cents` as the source of truth, which engineers will already validate during clearance.

**Gap 3: Seed Plantation Medicaid rates** — `resident_payers` is per-resident, not a facility-level provider catalog. There's no `medicaid_providers` table. Two options:

**Option A:** Add a facility-level Medicaid provider catalog:

```sql
CREATE TABLE facility_medicaid_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('LTC', 'MMA', 'OTHER')),
  default_rate_cents INTEGER NOT NULL,
  rate_unit TEXT NOT NULL DEFAULT 'monthly'
    CHECK (rate_unit IN ('monthly', 'daily', 'per_billable_day')),
  bed_hold_hospital_billing TEXT NOT NULL DEFAULT 'full_rate'
    CHECK (bed_hold_hospital_billing IN ('full_rate', 'reduced_rate', 'no_pay')),
  bed_hold_hospital_reduced_rate_cents INTEGER,
  bed_hold_max_days INTEGER,
  contract_start_date DATE,
  contract_renewal_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (facility_id, provider_name, provider_type, active)
);

CREATE INDEX idx_facility_medicaid_providers_facility
  ON facility_medicaid_providers(facility_id) WHERE deleted_at IS NULL AND active = true;

ALTER TABLE facility_medicaid_providers ENABLE ROW LEVEL SECURITY;

-- Link resident_payers to the provider catalog
ALTER TABLE resident_payers
  ADD COLUMN facility_medicaid_provider_id UUID REFERENCES facility_medicaid_providers(id);
```

**Build Option A.** It saves Jessica from re-entering rates per resident.

**Seed Plantation:**

```sql
WITH plantation AS (
  SELECT id, organization_id FROM facilities
  WHERE name LIKE 'Plantation%' AND deleted_at IS NULL LIMIT 1
)
INSERT INTO facility_medicaid_providers (organization_id, facility_id, provider_name, provider_type, default_rate_cents, rate_unit)
SELECT p.organization_id, p.id, v.provider, v.ptype, v.rate, v.unit FROM plantation p
CROSS JOIN (VALUES
  ('Florida Community Care', 'LTC', 160000, 'monthly'),
  ('Simply Healthcare',      'LTC', 165000, 'monthly'),
  ('Sunshine Health',        'LTC', 135000, 'monthly'),
  ('Humana',                 'LTC', 120000, 'monthly'),
  ('United Healthcare',      'LTC', 160000, 'monthly'),
  ('Florida Community Care', 'MMA', 1558,   'daily'),
  ('Simply Healthcare',      'MMA', 1558,   'daily'),
  ('Sunshine Health',        'MMA', 1558,   'daily'),
  ('Humana',                 'MMA', 1558,   'daily'),
  ('United Healthcare',      'MMA', 1558,   'daily')
) AS v(provider, ptype, rate, unit);
```

---

## 4. Rooms / Beds / Units — USE EXISTING, EXTEND ENUMS

The existing model is **better** than what I proposed earlier:
- `units` (wings) → `rooms` (rooms within wings) → `beds` (beds within rooms) — three-level hierarchy already
- `rooms.room_type` enum: private, semi_private, shared
- `beds.bed_type` enum: alf_intermediate, memory_care, independent_living
- `beds.status` enum: available, occupied, hold, maintenance, offline

**Gap 1: "Companion" terminology** — COL uses "companion" not "semi_private". Decision: don't rename the enum value; configure UI to display `semi_private` as "Companion".

**Gap 2: Plantation wings** — `units` is the wing table. Already exists with `name`, `floor_number`, `sort_order`. Don't add a new `facility_wings` table.

**Gap 3: Posted room rate per room** — currently lives at `rate_schedules.base_rate_private` and `base_rate_semi_private` (facility-level). COL's posted rates differ per facility (standard 4 = $5,550/$4,000, Plantation = $3,843/$3,543). The existing model handles this via per-facility `rate_schedules`.

**Action:** Build Plantation wings via `units`, Homewood rooms + beds, Plantation rooms + beds.

### 4.1 Seed Homewood

```sql
-- Get Homewood facility ID
DO $$
DECLARE
  v_facility_id UUID;
  v_org_id UUID;
BEGIN
  SELECT id, organization_id INTO v_facility_id, v_org_id
  FROM facilities WHERE name = 'Homewood Lodge' AND deleted_at IS NULL LIMIT 1;
  -- Adjust the name match if actual name differs

  -- Homewood has no wings; single floor
  -- Rooms 1-4: private singles
  INSERT INTO rooms (organization_id, facility_id, room_number, room_type, max_occupancy, floor_number, sort_order)
  SELECT v_org_id, v_facility_id, n::TEXT, 'private', 1, 1, n
  FROM generate_series(1, 4) n;

  -- Rooms 5-20: companion doubles
  INSERT INTO rooms (organization_id, facility_id, room_number, room_type, max_occupancy, floor_number, sort_order)
  SELECT v_org_id, v_facility_id, n::TEXT, 'semi_private', 2, 1, n
  FROM generate_series(5, 20) n;

  -- Beds: 1 bed per private room, 2 beds per companion room
  INSERT INTO beds (organization_id, facility_id, room_id, bed_label, bed_type, status)
  SELECT v_org_id, v_facility_id, r.id, 'A', 'alf_intermediate', 'available'
  FROM rooms r
  WHERE r.facility_id = v_facility_id;

  INSERT INTO beds (organization_id, facility_id, room_id, bed_label, bed_type, status)
  SELECT v_org_id, v_facility_id, r.id, 'B', 'alf_intermediate', 'available'
  FROM rooms r
  WHERE r.facility_id = v_facility_id AND r.room_type = 'semi_private';
END $$;
```

### 4.2 Seed Plantation wings + rooms + beds

```sql
DO $$
DECLARE
  v_facility_id UUID;
  v_org_id UUID;
  v_wing_id UUID;
  wing_num INT;
  room_num TEXT;
BEGIN
  SELECT id, organization_id INTO v_facility_id, v_org_id
  FROM facilities WHERE name LIKE 'Plantation%' AND deleted_at IS NULL LIMIT 1;

  -- Create 6 wings (units)
  FOR wing_num IN 1..6 LOOP
    INSERT INTO units (organization_id, facility_id, name, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, 'Wing ' || wing_num, 1, wing_num);
  END LOOP;

  -- Wing 1 rooms 1-6
  FOR room_num IN SELECT generate_series(1, 6)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 1';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Wing 2 rooms 7-12
  FOR room_num IN SELECT generate_series(7, 12)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 2';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Wing 3 rooms 14-19 (room 13 skipped per Plantation map page 7)
  FOR room_num IN SELECT generate_series(14, 19)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 3';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Wing 4 rooms 20-25
  FOR room_num IN SELECT generate_series(20, 25)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 4';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Wing 5 rooms 26-29
  FOR room_num IN SELECT generate_series(26, 29)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 5';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Wing 6 rooms 30-33
  FOR room_num IN SELECT generate_series(30, 33)::TEXT LOOP
    SELECT id INTO v_wing_id FROM units
    WHERE facility_id = v_facility_id AND name = 'Wing 6';
    INSERT INTO rooms (organization_id, facility_id, unit_id, room_number, room_type, max_occupancy, floor_number, sort_order)
    VALUES (v_org_id, v_facility_id, v_wing_id, room_num, 'semi_private', 2, 1, room_num::INT);
  END LOOP;

  -- Beds A and B for every Plantation room
  INSERT INTO beds (organization_id, facility_id, room_id, bed_label, bed_type, status)
  SELECT v_org_id, v_facility_id, r.id, lbl.label, 'alf_intermediate', 'available'
  FROM rooms r
  CROSS JOIN (VALUES ('A'), ('B')) AS lbl(label)
  WHERE r.facility_id = v_facility_id;
END $$;
```

### 4.3 Seed posted rates via rate_schedules

```sql
-- Standard 4 facilities: $5,550 private / $4,000 semi_private
INSERT INTO rate_schedules (organization_id, facility_id, name, effective_date, base_rate_private, base_rate_semi_private)
SELECT
  organization_id, id,
  'Standard Posted Rates 2026',
  '2026-01-01',
  555000,  -- $5,550 in cents
  400000   -- $4,000 in cents
FROM facilities
WHERE name IN ('Homewood Lodge', 'Oakridge ALF', 'Rising Oaks ALF', 'Grande Cypress ALF')
  AND deleted_at IS NULL;
-- Adjust names to match actual

-- Plantation: $3,843 private / $3,543 semi_private
INSERT INTO rate_schedules (organization_id, facility_id, name, effective_date, base_rate_private, base_rate_semi_private)
SELECT
  organization_id, id,
  'Plantation Posted Rates 2026',
  '2026-01-01',
  384300,  -- $3,843 in cents
  354300   -- $3,543 in cents
FROM facilities
WHERE name LIKE 'Plantation%' AND deleted_at IS NULL;
```

---

## 5. Rounds — USE EXISTING `resident_observation_*` SYSTEM

This is already built. **Do NOT create new round tables.** Existing system:

- `resident_observation_templates` — preset definitions (JSONB schema)
- `resident_observation_plans` — per-resident or per-facility plan (effective_from/to, status, source_type)
- `resident_observation_plan_rules` — the cadence: `interval_type`, `interval_minutes`, `shift`, `daypart_start/end`, `days_of_week`, `grace_minutes`, `required_fields_schema` (JSONB), `escalation_policy_key`
- `resident_observation_tasks` — scheduled task instances with `scheduled_for`, `due_at`, `grace_ends_at`, status
- `resident_observation_logs` — completed observations with `resident_location`, `resident_position`, `resident_state`, distress flags, intervention_codes, note
- `resident_observation_assignments` — links staff to residents

**This model is MORE sophisticated than what I proposed.** It already handles per-shift daypart scheduling, grace periods, escalation policies, and per-resident overrides.

### 5.1 Seed observation plans for the 4 standard facilities (12-hour shifts)

```sql
-- Per facility, create a default observation plan
DO $$
DECLARE
  v_facility RECORD;
  v_plan_id UUID;
BEGIN
  FOR v_facility IN
    SELECT id, organization_id, name FROM facilities
    WHERE name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Grande Cypress ALF')
      AND deleted_at IS NULL
  LOOP
    INSERT INTO resident_observation_plans
      (organization_id, facility_id, resident_id, status, source_type, effective_from, rationale)
    VALUES
      (v_facility.organization_id, v_facility.id, NULL, 'active', 'facility_default', now(),
       'Default 12-hour shift rounds for ' || v_facility.name)
    RETURNING id INTO v_plan_id;
    -- NOTE: schema requires resident_id NOT NULL. If you intend facility-level defaults,
    -- check if the schema actually supports nullable resident_id, or store the template
    -- in `resident_observation_templates` instead and apply per-resident on admission.

    -- Day Shift rule: 6a, 10a, 2p, 5:30p with 30-min grace
    INSERT INTO resident_observation_plan_rules
      (plan_id, organization_id, facility_id, resident_id, interval_type,
       daypart_start, daypart_end, days_of_week, grace_minutes, required_fields_schema, active)
    VALUES
      (v_plan_id, v_facility.organization_id, v_facility.id, NULL,
       'fixed_times',  -- check actual enum values; may be 'fixed_schedule' or 'discrete_times'
       '06:00', '18:00', ARRAY[1,2,3,4,5,6,7], 30,
       '{"scheduled_times": ["06:00", "10:00", "14:00", "17:30"], "shift": "day"}'::jsonb,
       true);

    -- Night Shift rule: 6p, 10p, 5:30a
    INSERT INTO resident_observation_plan_rules
      (plan_id, organization_id, facility_id, resident_id, interval_type,
       daypart_start, daypart_end, days_of_week, grace_minutes, required_fields_schema, active)
    VALUES
      (v_plan_id, v_facility.organization_id, v_facility.id, NULL,
       'fixed_times',
       '18:00', '06:00', ARRAY[1,2,3,4,5,6,7], 30,
       '{"scheduled_times": ["18:00", "22:00", "05:30"], "shift": "night"}'::jsonb,
       true);
  END LOOP;
END $$;
```

**CRITICAL — engineer must verify before running:**

1. Check `resident_observation_plans.resident_id` — is it actually NOT NULL? If yes, facility-default plans can't live in this table. Use `resident_observation_templates` for facility-level defaults and apply per-resident on admission.
2. Inspect the `interval_type` enum (USER-DEFINED) — what values does it accept? `fixed_times`, `interval`, `daypart`, etc.
3. Inspect the `shift` enum on `plan_rules` — what values are valid?

```sql
-- Run this first
SELECT enumlabel FROM pg_enum WHERE enumtypid = (
  SELECT typname FROM pg_type WHERE typname LIKE '%interval%' OR typname LIKE '%shift%'
);
```

### 5.2 Homewood — different night cadence

Homewood night shift is every 2 hours, not 3 fixed times. Use:
```jsonb
{"interval_minutes": 120, "shift": "night"}
```
Set `interval_type = 'interval'` (verify enum value) and `interval_minutes = 120`.

### 5.3 Plantation — wing-based, 8-hour shifts

Plantation needs 6 separate plans/rules, one per wing. Strategy: create one observation plan template per wing (or per facility with wing scoping in `required_fields_schema`).

**Decision required from engineer:** does the existing schema support wing-scoped observations? Currently observations link to `resident_id`, not `unit_id`. Wing-based scheduling at Plantation means staff for Wing 1 covers residents 1A through 6B at specific times. This translates as:

- All Wing 1 residents share the same observation cadence (12a / 8a / 4p)
- All Wing 2 residents share the same observation cadence (12a / 8a / 4p)
- All Wing 3-4 residents: 3a / 11a / 7p
- All Wing 5-6 residents: 6a / 2p / 10p

Implementation: when a resident is admitted to a Plantation bed, look up the bed's room's unit (wing), and apply the wing-specific observation plan rule to that resident.

Build a helper function:

```sql
CREATE OR REPLACE FUNCTION apply_plantation_wing_observation_plan(p_resident_id UUID)
RETURNS UUID AS $$
DECLARE
  v_wing_name TEXT;
  v_facility_id UUID;
  v_org_id UUID;
  v_plan_id UUID;
  v_times TEXT[];
BEGIN
  -- Find the resident's wing via bed → room → unit
  SELECT u.name, r.facility_id, r.organization_id
  INTO v_wing_name, v_facility_id, v_org_id
  FROM residents r
  JOIN beds b ON r.bed_id = b.id
  JOIN rooms rm ON b.room_id = rm.id
  JOIN units u ON rm.unit_id = u.id
  WHERE r.id = p_resident_id;

  -- Map wing to round times
  v_times := CASE v_wing_name
    WHEN 'Wing 1' THEN ARRAY['00:00', '08:00', '16:00']
    WHEN 'Wing 2' THEN ARRAY['00:00', '08:00', '16:00']
    WHEN 'Wing 3' THEN ARRAY['03:00', '11:00', '19:00']
    WHEN 'Wing 4' THEN ARRAY['03:00', '11:00', '19:00']
    WHEN 'Wing 5' THEN ARRAY['06:00', '14:00', '22:00']
    WHEN 'Wing 6' THEN ARRAY['06:00', '14:00', '22:00']
  END;

  -- Create the plan
  INSERT INTO resident_observation_plans
    (organization_id, facility_id, resident_id, status, source_type, effective_from, rationale)
  VALUES
    (v_org_id, v_facility_id, p_resident_id, 'active', 'wing_default', now(),
     'Plantation ' || v_wing_name || ' default rounds')
  RETURNING id INTO v_plan_id;

  -- Create the rule
  INSERT INTO resident_observation_plan_rules
    (plan_id, organization_id, facility_id, resident_id, interval_type,
     daypart_start, daypart_end, days_of_week, grace_minutes, required_fields_schema, active)
  VALUES
    (v_plan_id, v_org_id, v_facility_id, p_resident_id,
     'fixed_times',
     '00:00', '23:59', ARRAY[1,2,3,4,5,6,7], 30,
     jsonb_build_object('scheduled_times', v_times, 'wing', v_wing_name),
     true);

  RETURN v_plan_id;
END;
$$ LANGUAGE plpgsql;
```

### 5.4 Round vocabulary

The existing `resident_observation_logs` has `resident_location TEXT` (free text, no vocab table). COL wants dropdown values. Two options:

**Option A:** Add a vocabulary lookup table:

```sql
CREATE TABLE observation_vocab (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),
  field_name TEXT NOT NULL,                  -- 'location', 'activity', 'state'
  value_code TEXT NOT NULL,
  display_label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_oof BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (facility_id, field_name, value_code)
);

-- Seed (universal across all facilities — facility_id = NULL means org-wide)
INSERT INTO observation_vocab (organization_id, facility_id, field_name, value_code, display_label, display_order, is_oof)
SELECT o.id, NULL, v.field, v.code, v.lbl, v.ord, v.oof
FROM organizations o
CROSS JOIN (VALUES
  -- Locations
  ('location', 'common_area',             'Common Area',             1, false),
  ('location', 'dining_room',             'Dining Room',             2, false),
  ('location', 'resident_room',           'Resident Room',           3, false),
  ('location', 'front_porch',             'Front Porch',             4, false),
  ('location', 'back_porch',              'Back Porch',              5, false),
  ('location', 'oof_personal_errand',     'OOF — Personal Errand',   6, true),
  ('location', 'oof_medical_appointment', 'OOF — Medical Appointment', 7, true),
  ('location', 'oof_family_friends',      'OOF — Family/Friends',    8, true),
  ('location', 'oof_hospitalization',     'OOF — Hospitalization',   9, true),
  ('location', 'oof_day_treatment',       'OOF — Day Treatment',     10, true),
  ('location', 'oof_baker_act',           'OOF — Baker Act',         11, true),
  -- Activities (resident_state field)
  ('state', 'participating_facility_activity', 'Participating in Facility Activity', 1, false),
  ('state', 'socializing_with_others',         'Socializing with Others',            2, false),
  ('state', 'watching_tv',                     'Watching TV',                        3, false),
  ('state', 'resting_in_bed',                  'Resting in Bed',                     4, false),
  ('state', 'sleeping',                        'Sleeping',                           5, false),
  ('state', 'individual_activity',             'Individual Activity',                6, false)
) AS v(field, code, lbl, ord, oof)
WHERE o.name = 'Circle of Life Communities';  -- adjust to actual org name
```

**Option B:** Stuff the vocabulary into JSONB and read from a config table.

**Build Option A.** Cleaner queries, easier UI binding.

---

## 6. Activities — USE EXISTING, ALREADY DONE

Existing tables:
- `activities` — catalog (name, description, default_day_of_week, default_start_time, facilitator, is_recurring)
- `activity_sessions` — scheduled instances (session_date, start_time, end_time, facilitator_name, cancelled)
- `activity_attendance` — per-resident attendance (attended, engagement_level, duration_minutes, notes, logged_by)

**Gap 1: Confirmation attestation** — `activity_sessions` doesn't have `confirmed_by_initials` or `confirmed_at` columns. COL wants staff to record start time + initials on completion. Add:

```sql
ALTER TABLE activity_sessions
  ADD COLUMN confirmed_by_user_id UUID REFERENCES user_profiles(id),
  ADD COLUMN confirmed_by_initials TEXT,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN provider_type TEXT CHECK (provider_type IN ('facility_staff', 'external')),
  ADD COLUMN provider_name TEXT;
```

**Gap 2: Below-minimum alert** — COL requires 2 activities/day minimum, alert if not met. Build a view + monitor cron:

```sql
CREATE OR REPLACE VIEW daily_activity_completion_check AS
SELECT
  facility_id,
  organization_id,
  session_date,
  COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS completed_count,
  COUNT(*) AS scheduled_count,
  (COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) < 2) AS below_minimum_threshold
FROM activity_sessions
WHERE deleted_at IS NULL
GROUP BY facility_id, organization_id, session_date;
```

---

## 7. Family Portal — USE EXISTING, ADD MINIMAL

Existing:
- `family_portal_messages` — has `author_kind` enum (verify values include `staff_admin`, `staff_assistant`, `family`)
- `family_resident_links` — already has `can_view_clinical`, `can_view_financial`, `can_make_decisions` for RLS
- `family_consent_records` — already supports digital consent with `signed_at`, `ip_address`

**Gap 1: One-way enforcement** — verify the `author_kind` enum. RLS policy should prevent `author_kind = 'family'` inserts:

```sql
-- First inspect the enum
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = (
  SELECT udt_name FROM information_schema.columns
  WHERE table_name = 'family_portal_messages' AND column_name = 'author_kind'
));

-- Then add RLS policy if not already present
CREATE POLICY family_portal_one_way ON family_portal_messages FOR INSERT
  WITH CHECK (
    author_kind IN ('staff_admin', 'staff_assistant')  -- adjust to actual enum values
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
        AND up.app_role IN ('administrator', 'assistant_administrator', 'corporate', 'owner')
    )
  );
```

**Gap 2: Delivery method tracking** — COL wants to track if note was also called/emailed/texted:

```sql
ALTER TABLE family_portal_messages
  ADD COLUMN delivery_method TEXT DEFAULT 'portal_only'
    CHECK (delivery_method IN ('portal_only', 'portal_and_email', 'portal_and_sms', 'portal_and_call')),
  ADD COLUMN family_acknowledged_at TIMESTAMPTZ;
```

---

## 8. Maintenance & Compliance — USE EXISTING SOPHISTICATED SYSTEM

Existing:
- `compliance_rules` (tag_number, tag_title, rule_description, check_query, severity, enabled) — **the check_query column suggests this is rule-engine driven, not a static catalog**
- `compliance_reminders` (reminder_type, title, next_send_at, frequency, context JSONB)
- `compliance_scans` + `compliance_scan_results` — execution layer
- `compliance_survey_visits`, `compliance_survey_visit_notes`, `survey_deficiencies`, `plans_of_correction` — survey lifecycle

**This is much bigger than what I proposed.** It's already an AHCA-compliant inspection management system.

**Gap 1: Maintenance work orders** — searching all 278 tables, I don't see a `maintenance_tickets` table. There's `facility_assets` but no work order ticketing. Add:

```sql
CREATE TABLE maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  asset_id UUID REFERENCES facility_assets(id),
  submitted_by UUID NOT NULL REFERENCES user_profiles(id),
  asset_description TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),
  assigned_type TEXT CHECK (assigned_type IN ('internal', 'external_vendor')),
  assigned_to_user_id UUID REFERENCES user_profiles(id),
  assigned_to_vendor_name TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
  resolution_notes TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_tickets_facility_status
  ON maintenance_tickets(facility_id, status);
ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
```

**Gap 2: Scheduled maintenance tasks** — separate from work orders. AC filters, grease traps, leak checks. Use the existing compliance_rules system:

```sql
-- Seed COL maintenance items via compliance_rules
INSERT INTO compliance_rules
  (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity, enabled)
SELECT
  f.organization_id, f.id,
  v.tag, v.title, v.descrip, v.query, v.sev, true
FROM facilities f
CROSS JOIN (VALUES
  ('COL-MAINT-001', 'Quarterly Grease Trap Cleaning',
   'Grease trap must be cleaned quarterly',
   'SELECT id FROM maintenance_task_completions WHERE task_type = ''grease_trap'' AND completed_at > now() - interval ''3 months''',
   'medium'),
  ('COL-MAINT-002', 'Monthly Leak Check',
   'Building leak inspection must be performed monthly',
   'SELECT id FROM maintenance_task_completions WHERE task_type = ''leak_check'' AND completed_at > now() - interval ''1 month''',
   'medium'),
  ('COL-MAINT-003', 'Monthly AC Filter Change',
   'AC filters must be changed monthly',
   'SELECT id FROM maintenance_task_completions WHERE task_type = ''ac_filter'' AND completed_at > now() - interval ''1 month''',
   'medium')
) AS v(tag, title, descrip, query, sev)
WHERE f.deleted_at IS NULL;
```

Plus a `maintenance_task_completions` table:

```sql
CREATE TABLE maintenance_task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  task_type TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by_user_id UUID REFERENCES user_profiles(id),
  completed_by_vendor TEXT,
  notes TEXT,
  evidence_url TEXT,
  related_ticket_id UUID REFERENCES maintenance_tickets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maint_completions_facility_type_date
  ON maintenance_task_completions(facility_id, task_type, completed_at DESC);
```

**Gap 3: Fire/elopement drill log** — Don't see this in 278 tables. Add:

```sql
CREATE TABLE drill_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  drill_type TEXT NOT NULL CHECK (drill_type IN ('fire', 'elopement', 'tornado')),
  drill_date DATE NOT NULL,
  drill_time TIME NOT NULL,
  pull_station_activated BOOLEAN NOT NULL DEFAULT false,
  staff_present_count INTEGER,
  residents_present_count INTEGER,
  conducted_by UUID REFERENCES user_profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compliance rules to enforce annual drill counts
INSERT INTO compliance_rules
  (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity, enabled)
SELECT
  f.organization_id, f.id,
  v.tag, v.title, v.descrip, v.query, 'high', true
FROM facilities f
CROSS JOIN (VALUES
  ('COL-DRILL-001', 'Annual Fire Drill Count (6 required)',
   'COL requires 6 fire drills per calendar year',
   'SELECT id FROM drill_log WHERE drill_type = ''fire'' AND EXTRACT(YEAR FROM drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) GROUP BY facility_id HAVING COUNT(*) < 6'),
  ('COL-DRILL-002', 'Annual Elopement Drill Count (2 required)',
   'COL requires 2 elopement drills per calendar year',
   'SELECT id FROM drill_log WHERE drill_type = ''elopement'' AND EXTRACT(YEAR FROM drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) GROUP BY facility_id HAVING COUNT(*) < 2')
) AS v(tag, title, descrip, query)
WHERE f.deleted_at IS NULL;
```

---

## 9. Meal Logs — ADD NEW TABLE

Don't see meal logging in existing tables. `diet_orders` exists for prescribed diets, but no per-meal status tracking.

```sql
CREATE TABLE meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  meal_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
  status TEXT NOT NULL CHECK (status IN ('ate', 'refused', 'out_of_facility')),
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES user_profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (resident_id, meal_date, meal_type)
);

CREATE INDEX idx_meal_logs_facility_date ON meal_logs(facility_id, meal_date);
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE snack_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  snack_at TIMESTAMPTZ NOT NULL,
  passed_by_user_id UUID NOT NULL REFERENCES user_profiles(id),
  snack_description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_snack_logs_facility_date ON snack_logs(facility_id, snack_at);
```

---

## 10. Employee Compliance — USE EXISTING `staff_*` SYSTEM

Existing tables already cover this:
- `staff` — base employee record (staff_role enum, employment_status enum, hire_date, termination_date)
- `staff_certifications` — certs with expiration_date, status, document_id
- `staff_training_completions` — training history with delivery_method, expires_at, evaluator_user_id
- `staff_background_checks` — clearinghouse_id, result, expires_at, document_storage_path
- `staff_illness_records`, `staff_discipline_records`, `staff_requisitions`
- `inservice_log_sessions` + `inservice_log_attendees` — in-service training tracking
- `training_programs` — training catalog

**This is already comprehensive.** What COL described as the employee module IS this set of tables.

**Gap 1: Application stage tracking** — `staff` jumps from non-existent to hired. Add an application_status field or use the existing `staff_requisitions` table (need to inspect — likely a job posting, not an applicant tracker).

```sql
-- Inspect first
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'staff_requisitions' ORDER BY ordinal_position;
```

If `staff_requisitions` is hiring requisitions (job postings), then add a new table or extend `staff`:

```sql
-- Extend staff with application stage
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS application_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS application_stage TEXT
    CHECK (application_stage IN ('application', 'background_check', 'references', 'hired', 'onboarding', 'active', 'terminated', 'withdrawn')),
  ADD COLUMN IF NOT EXISTS references_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS references_completed_at TIMESTAMPTZ;
```

**Gap 2: COL-specific compliance items as compliance rules** — Use the existing `compliance_rules` engine:

```sql
INSERT INTO compliance_rules
  (organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity, enabled)
SELECT
  f.organization_id, f.id,
  v.tag, v.title, v.descrip, v.query, v.sev, true
FROM facilities f
CROSS JOIN (VALUES
  ('COL-HR-001', 'Pre-Service: Resident Rights',
   'Employee must complete Resident Rights training before working on floor',
   'SELECT s.id FROM staff s WHERE s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_training_completions stc WHERE stc.staff_id = s.id AND stc.training_program_id IN (SELECT id FROM training_programs WHERE name ILIKE ''%resident rights%''))',
   'high'),
  ('COL-HR-002', 'Pre-Service: Infection Control',
   'Employee must complete Infection Control training before working on floor',
   'SELECT s.id FROM staff s WHERE s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_training_completions stc WHERE stc.staff_id = s.id AND stc.training_program_id IN (SELECT id FROM training_programs WHERE name ILIKE ''%infection control%''))',
   'high'),
  ('COL-HR-003', 'Pre-Service: Universal Precautions',
   'Employee must complete Universal Precautions training before working on floor',
   'SELECT s.id FROM staff s WHERE s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_training_completions stc WHERE stc.staff_id = s.id AND stc.training_program_id IN (SELECT id FROM training_programs WHERE name ILIKE ''%universal precautions%''))',
   'high'),
  ('COL-HR-004', '30-Day: Communicable Disease',
   'Employee must complete Communicable Disease training within 30 days of hire',
   'SELECT s.id FROM staff s WHERE s.hire_date < CURRENT_DATE - 30 AND s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_training_completions stc WHERE stc.staff_id = s.id AND stc.training_program_id IN (SELECT id FROM training_programs WHERE name ILIKE ''%communicable disease%''))',
   'high'),
  ('COL-HR-005', '30-Day: TB Test',
   'Employee must complete TB test within 30 days of hire',
   'SELECT s.id FROM staff s WHERE s.hire_date < CURRENT_DATE - 30 AND s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_certifications sc WHERE sc.staff_id = s.id AND sc.certification_type = ''tb_test'')',
   'high'),
  ('COL-HR-006', '30-Day: CPR & First Aid',
   'Employee must hold current CPR & First Aid certification within 30 days of hire',
   'SELECT s.id FROM staff s WHERE s.hire_date < CURRENT_DATE - 30 AND s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_certifications sc WHERE sc.staff_id = s.id AND sc.certification_type = ''cpr_first_aid'' AND sc.expiration_date > CURRENT_DATE)',
   'high'),
  ('COL-HR-007', 'Med Tech Attestation',
   'Medication technicians must attest to training and preparedness',
   'SELECT s.id FROM staff s WHERE s.staff_role = ''medication_technician'' AND s.employment_status = ''active'' AND NOT EXISTS (SELECT 1 FROM staff_attestations sa WHERE sa.staff_id = s.id AND sa.attestation_type = ''med_tech_self'')',
   'high')
) AS v(tag, title, descrip, query, sev)
WHERE f.deleted_at IS NULL;
```

**Note:** Some of those queries may reference tables/columns that don't exist yet (`training_programs.name`, `staff_attestations`). Engineer must verify and adjust the queries — but the pattern is right: use the existing `compliance_rules` engine, don't build a parallel system.

**Gap 3: Permanent out-of-compliance flag**:

```sql
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS compliance_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_failure_reason TEXT;
```

**Gap 4: Med tech / other attestations**:

```sql
CREATE TABLE staff_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  staff_id UUID NOT NULL REFERENCES staff(id),
  attestation_type TEXT NOT NULL,
  attestation_text TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signer_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 11. Notifications — USE EXISTING `notification_routes`

The existing `notification_routes` table is **better** than my proposed `notification_recipients`. It supports:
- Severity-based routing (`severity_min`)
- Multi-channel delivery (`channels` ARRAY: email, sms, push, in_app)
- Role-based targeting (`staff_role_targets` ARRAY) — references the `staff_role` enum
- Facility-scoped or org-wide (`facility_id` nullable)

**Plus `notification_subscriptions`** for Web Push device tokens per user.

**This eliminates the need for `notification_recipients`.** All COL alerts (Quickmar miss, activities below threshold, employee non-compliance, etc.) route through `notification_routes`.

### 11.1 Seed COL standard notification routes

```sql
-- Standard 4-recipient alert pattern: Administrator + Assistant Admin + COO (Michelle) + Operations (Jessica)
INSERT INTO notification_routes
  (organization_id, facility_id, name, severity_min, channels, staff_role_targets, is_active)
SELECT
  f.organization_id, f.id,
  v.name, v.sev::severity_level, v.channels::TEXT[], v.roles::TEXT[], true
FROM facilities f
CROSS JOIN (VALUES
  ('Quickmar Import Missed',          'high',   'email,sms',  'administrator,assistant_administrator,corporate,owner'),
  ('Activity Count Below Threshold',  'medium', 'email,in_app','administrator,assistant_administrator,corporate'),
  ('Employee Non-Compliant',          'high',   'email,sms',  'administrator,assistant_administrator,corporate,owner'),
  ('Snack Log Missed',                'low',    'in_app',     'administrator,assistant_administrator'),
  ('Round Check Overdue',             'medium', 'email,push', 'administrator,assistant_administrator'),
  ('Round Check 30 Min Overdue',      'high',   'sms,push',   'administrator,assistant_administrator'),
  ('Round Check 60 Min Overdue',      'critical','sms,push,call','administrator,assistant_administrator,corporate,owner'),
  ('Inspection Due Soon',             'medium', 'email',      'administrator,corporate'),
  ('Drill Count Below Annual Target', 'high',   'email',      'administrator,corporate,owner')
) AS v(name, sev, channels, roles)
WHERE f.deleted_at IS NULL;
```

**CRITICAL — engineer must verify before running:**
- What is the actual `severity_level` enum? Inspect:
```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = (
  SELECT atttypid FROM pg_attribute WHERE attrelid = 'notification_routes'::regclass AND attname = 'severity_min'
);
```
- What are the actual `staff_role` enum values? Adjust the seed accordingly:
```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'staff_role'::regtype;
```

---

## 12. Permissions — USE EXISTING `role_permissions` + `user_facility_access`

Existing tables:
- `role_permissions` (app_role, feature, permission_level, description) — feature-level RBAC
- `user_facility_access` — per-user facility access list
- `user_profiles.app_role` — assigns role to user

**This already covers the COL role/permission model.** Don't build a parallel `role_presets` + `role_preset_permissions` system.

### 12.1 Inspect existing `app_role` enum values

```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = (
  SELECT udt_name FROM information_schema.columns
  WHERE table_name = 'user_profiles' AND column_name = 'app_role'
);
```

### 12.2 Add COL-specific roles if missing

COL's 11 roles: Administrator, Assistant Administrator, Corporate Operations, Owner, Maintenance, Cook, Medication Technician, Medication Manager, Resident Service Coordinator, Resident Aide, Housekeeping Aide.

If the `app_role` enum is missing any of these, add them:

```sql
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'medication_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'resident_service_coordinator';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'cook';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'housekeeping_aide';
-- etc., for any missing values
```

### 12.3 Seed `role_permissions` for Resident Aide

```sql
INSERT INTO role_permissions (app_role, feature, permission_level, description)
VALUES
  ('resident_aide', 'rounds',                  'edit',  'Can perform and log resident rounds'),
  ('resident_aide', 'meal_logs',               'edit',  'Can log meal status'),
  ('resident_aide', 'activities_attendance',   'edit',  'Can log activity attendance'),
  ('resident_aide', 'residents',               'view',  'Can view assigned residents'),
  ('resident_aide', 'rates',                   'none',  'Cannot view rate information'),
  ('resident_aide', 'hr',                      'none',  'Cannot access HR'),
  ('resident_aide', 'crm',                     'none',  'Cannot access CRM'),
  ('resident_aide', 'financials',              'none',  'Cannot access financials'),
  ('resident_aide', 'permissions',             'none',  'Cannot manage permissions'),
  ('resident_aide', 'maintenance',             'view',  'Can submit work orders'),
  ('resident_aide', 'family_portal_admin',     'none',  'Cannot post family notes')
ON CONFLICT DO NOTHING;
-- Repeat similar blocks for each of the 11 roles
```

---

## 13. Resident Admission Contracts — ADD NEW TABLE

The existing `contracts` table is for VENDOR contracts (`vendor_id NOT NULL`). Resident admission contracts need a separate table.

```sql
CREATE TABLE resident_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  admission_case_id UUID REFERENCES admission_cases(id),
  contract_type TEXT NOT NULL,
  -- 'admission', 'arbitration', 'consent_treatment', 'financial_responsibility', 'hipaa_consent', 'photo_release'
  provider TEXT NOT NULL DEFAULT 'boldsign'
    CHECK (provider IN ('boldsign', 'docusign', 'manual')),
  provider_document_id TEXT,                    -- BoldSign document ID
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'completed', 'declined', 'voided')),
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signer_ip INET,
  signed_pdf_storage_path TEXT,
  audit_trail_storage_path TEXT,
  legal_basis_citation TEXT NOT NULL DEFAULT 'FL Stat. § 688.50(7) — UETA',
  counsel_approval_reference TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_resident_contracts_resident ON resident_contracts(resident_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_resident_contracts_status ON resident_contracts(status, sent_at) WHERE deleted_at IS NULL;

ALTER TABLE resident_contracts ENABLE ROW LEVEL SECURITY;
```

**Legal basis:** FL Stat. § 688.50(7) UETA. Confirmed by Donna J. Fudge, Esquire (Fudge Broadwater, P.A.) 2026-05-08. Store her email reference in `counsel_approval_reference`.

---

## 14. BoldSign Integration

**Decision:** BoldSign over DocuSign — 85-90% cost reduction, equivalent HIPAA/SOC 2/ESIGN compliance, modern REST API, embedded signing for tablet workflow, unlimited envelopes + users.

### 14.1 Supabase secrets to configure

```
BOLDSIGN_API_KEY            # production API key
BOLDSIGN_WEBHOOK_SECRET     # for HMAC-SHA256 webhook verification
BOLDSIGN_TEMPLATE_ADMISSION_ID            # template UUID for admission contract
BOLDSIGN_TEMPLATE_ARBITRATION_ID          # template UUID for arbitration agreement
BOLDSIGN_TEMPLATE_HIPAA_ID                # template UUID for HIPAA consent
```

### 14.2 Edge Functions

**`boldsign-send-contract`** (`POST /functions/v1/boldsign-send-contract`)

Input: `{ resident_id, contract_type, signer_email, signer_phone, tablet_embedded }`

Logic:
1. Look up resident + admission_case + facility data
2. Map contract_type to BoldSign template ID
3. Merge resident data into template
4. Call `POST https://api.boldsign.com/v1/template/send` with `X-API-KEY` header
5. Insert `resident_contracts` row with status='sent', provider_document_id from response
6. If `tablet_embedded = true`, call `POST /v1/document/embedSignLink` and return the URL
7. Otherwise return success — email will be sent by BoldSign

**`boldsign-webhook`** (`POST /functions/v1/boldsign-webhook`)

1. Verify HMAC-SHA256 signature with BOLDSIGN_WEBHOOK_SECRET
2. Parse event payload
3. Update `resident_contracts` row by `provider_document_id`:
   - 'Sent' → status='sent', sent_at=now()
   - 'Viewed' → status='viewed'
   - 'Signed' → status='signed', signed_at=now(), signer_ip from payload
   - 'Completed' → status='completed', download signed PDF + audit trail to Supabase Storage
   - 'Declined' → status='declined'
4. On 'Completed': fire `notification_routes` event for the facility's admin team

---

## 15. Encrypted Email — Verify Before Building

**Provider confirmed:** GoDaddy Advanced Email Security.

**Engineer must verify before building:** Does GoDaddy AES expose a programmable API for outbound encrypted send?

Steps:
1. Check https://www.godaddy.com/help/advanced-email-security-32337
2. Determine if there's a REST API for "send-as-encrypted"
3. If YES → build direct integration
4. If NO → fallback: Haven sends via SMTP to user's Gmail account with `[ENCRYPT]` subject tag, which triggers existing GoDaddy AES outbound policy rule

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS encrypted_email_provider TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_email_provider_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_email_credentials_secret_name TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_email_fallback_method TEXT;

UPDATE organizations
SET
  encrypted_email_provider = 'GoDaddy Advanced Email Security',
  encrypted_email_credentials_secret_name = 'godaddy_aes_creds',
  encrypted_email_fallback_method = 'gmail_relay_tagged'
WHERE name = 'Circle of Life Communities';

CREATE TABLE encrypted_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),
  sender_user_id UUID NOT NULL REFERENCES user_profiles(id),
  recipient_emails TEXT[] NOT NULL,
  subject TEXT NOT NULL,
  body_preview TEXT,
  related_entity_type TEXT,
  related_entity_id UUID,
  attachment_storage_paths TEXT[],
  send_method TEXT NOT NULL CHECK (send_method IN ('godaddy_api', 'gmail_relay_tagged', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'bounced', 'delivered')),
  sent_at TIMESTAMPTZ,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 16. Quickmar Import — ADD NEW TABLES

Doesn't exist yet. Build:

```sql
CREATE TABLE quickmar_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  source_filename TEXT NOT NULL,
  source_drive_path TEXT NOT NULL,
  imported_by UUID REFERENCES user_profiles(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_processed INTEGER NOT NULL,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_log JSONB,
  report_period_start DATE,
  report_period_end DATE
);

CREATE TABLE resident_med_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  med_name TEXT NOT NULL,
  dosage TEXT,
  administered_at TIMESTAMPTZ NOT NULL,
  administered_by_name TEXT,                    -- from Quickmar export — string, not FK
  notes TEXT,
  source_import_id UUID REFERENCES quickmar_imports(id),
  source TEXT NOT NULL DEFAULT 'quickmar' CHECK (source IN ('quickmar', 'haven_native')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_med_history_resident_date
  ON resident_med_history(resident_id, administered_at DESC);
```

**Note:** Existing `med_passes` and `emar_records` tables handle Haven-native medication administration. Quickmar data lives in `resident_med_history` with `source='quickmar'` so it's clearly differentiated.

**Edge Function `quickmar-import-watcher`:** poll Drive folder every 15 min OR receive webhook → parse Excel → match resident by name + facility_id → insert into resident_med_history → audit row in quickmar_imports → if no import in 26 hours, fire notification via existing notification_routes (event = "Quickmar Import Missed").

---

## 17. Onboarding Kanban — USE EXISTING `admission_cases`

Existing `admission_cases` table has:
- `status` enum: pending_clearance, bed_reserved, move_in, cancelled
- Links to resident_id, referral_lead_id, bed_id
- financial_clearance_at, financial_clearance_by, physician_orders_received_at

This IS the kanban backend. Don't build a parallel `onboarding_prospects` table.

**Gap 1: More granular Medicaid pipeline stages.** COL's kanban has: Prospect → Medicaid App Requested → Pending → Approved/Denied → Waitlist → Onboarding → Active.

The existing 4-state enum is too coarse. Two options:

**Option A:** Add more values to `admission_case_status`:

```sql
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'medicaid_app_requested';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'medicaid_pending';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'denied';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'waitlist';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'onboarding';
ALTER TYPE admission_case_status ADD VALUE IF NOT EXISTS 'active';
```

**Option B:** Add a substage field:

```sql
ALTER TABLE admission_cases
  ADD COLUMN medicaid_pipeline_stage TEXT
    CHECK (medicaid_pipeline_stage IN ('prospect', 'app_requested', 'pending', 'approved', 'denied', 'waitlist'));
```

**Build Option B.** It preserves the existing 4-state enum for system-level state and adds a per-case Medicaid sub-stage. Less risky than ALTER TYPE.

**Existing `referral_leads`** is the upstream prospect table. The kanban surface joins `referral_leads` + `admission_cases`.

---

## 18. Final Order of Operations for the Engineer

Run in this exact order:

| Step | Section | Action |
|---|---|---|
| 1 | 0.1 | Verify 6th facility, soft-delete if test/duplicate |
| 2 | 0.2 | Save facility IDs |
| 3 | 1 | Verify resident_status enum mapping (no change needed) |
| 4 | 2 | Inspect census_daily_log; build resident_status_history if needed |
| 5 | 3 | Add `medicaid_rate_unit` to resident_payers |
| 6 | 3 | CREATE `facility_medicaid_providers` |
| 7 | 3 | ALTER `resident_payers` ADD `facility_medicaid_provider_id` |
| 8 | 3 | Seed Plantation Medicaid providers |
| 9 | 4 | Seed Homewood: 20 rooms + beds |
| 10 | 4 | Seed Plantation: 6 wings (units) + rooms + beds |
| 11 | 4 | Seed rate_schedules (posted rates per facility) |
| 12 | 5 | Inspect observation enums; seed observation_vocab |
| 13 | 5 | Seed observation plans for 3 standard facilities (Oakridge, Rising Oaks, Grande Cypress) |
| 14 | 5 | Seed Homewood observation plan (day + every-2-hour night) |
| 15 | 5 | Build `apply_plantation_wing_observation_plan()` function |
| 16 | 6 | ALTER `activity_sessions` ADD attestation fields |
| 17 | 6 | CREATE view `daily_activity_completion_check` |
| 18 | 7 | Inspect `family_portal_messages.author_kind` enum |
| 19 | 7 | ADD `delivery_method` + `family_acknowledged_at` to family_portal_messages |
| 20 | 7 | Add one-way RLS policy |
| 21 | 8 | CREATE `maintenance_tickets` |
| 22 | 8 | CREATE `maintenance_task_completions` |
| 23 | 8 | Seed COL maintenance items via `compliance_rules` |
| 24 | 8 | CREATE `drill_log` |
| 25 | 8 | Seed drill annual-count compliance rules |
| 26 | 9 | CREATE `meal_logs` |
| 27 | 9 | CREATE `snack_logs` |
| 28 | 10 | Inspect `staff_requisitions` |
| 29 | 10 | ALTER `staff` ADD application_stage fields |
| 30 | 10 | CREATE `staff_attestations` |
| 31 | 10 | Seed COL HR compliance rules |
| 32 | 11 | Inspect severity_level and staff_role enums |
| 33 | 11 | Seed `notification_routes` for COL alert patterns |
| 34 | 12 | Inspect `app_role` enum, ALTER if missing COL roles |
| 35 | 12 | Seed `role_permissions` for all 11 COL roles |
| 36 | 13 | CREATE `resident_contracts` |
| 37 | 14 | Configure BoldSign secrets in Supabase |
| 38 | 14 | Build Edge Function `boldsign-send-contract` |
| 39 | 14 | Build Edge Function `boldsign-webhook` |
| 40 | 15 | Verify GoDaddy AES API capability |
| 41 | 15 | CREATE `encrypted_email_log` + organization config |
| 42 | 16 | CREATE `quickmar_imports` + `resident_med_history` |
| 43 | 16 | Build Edge Function `quickmar-import-watcher` |
| 44 | 17 | ALTER `admission_cases` ADD `medicaid_pipeline_stage` |

---

## 19. What You Are NOT Building

Do not build these — they already exist in the schema:
- `notification_recipients` (use `notification_routes`)
- `role_presets` / `role_preset_permissions` (use `role_permissions` + `app_role` enum)
- `round_shift_configs` / `round_observations` (use `resident_observation_plans` + `_plan_rules` + `_logs`)
- `cart_assignments` (use `med_tech_shifts` + `med_tech_shift_residents`)
- `activity_catalog` / `scheduled_activities` / `activity_attendance` (already exist as `activities` / `activity_sessions` / `activity_attendance`)
- `family_notes` (use `family_portal_messages`)
- `onboarding_prospects` / `onboarding_stage_history` (use `admission_cases` + `referral_leads`)
- `facility_wings` (use `units`)
- Custom rate tables (use `rate_schedules`, `rate_schedule_versions`, `resident_payers`, `admission_case_rate_terms`)

---

## 20. Things Still Open (Not For This Sprint)

Blocked on external input:

| Item | Owner | Why Blocked |
|---|---|---|
| GoDaddy AES direct API capability | Brian | Verify before building Section 15 |
| Plantation 63 named residents from page 7 map | Brian | Manual CSV parsing required |
| Other 4 facilities' Medicaid provider rates | Jessica | Need contract list from doc dump |
| Per-Medicaid-provider bed-hold billing policy | Jessica | Affects census + billing |
| Snack window cutoff per facility | Jessica | Affects snack-log alert config |
| QuickBooks Online migration | Milton | Sign-off pending |
| Anthropic BAA status | Brian | Affects AI subsystem build (Grace) |
| FL ALF facial recognition legality | Brian | Phase 2 |
| BoldSign attorney sanity check | Jessica → Donna | Forward BoldSign HIPAA + ESIGN docs to Donna |

---

## 21. Backup + Rollback

- Backup taken: `~/haven_backups/haven_pre_migration_20260511_123223.sql` (1.2MB schema dump)
- Project: `manfqmasfqppukpobpld` on Pro tier with auto-backups
- Rollback path: Supabase Dashboard → Database → Backups → Restore (or `psql < ~/haven_backups/haven_pre_migration_*.sql`)

Apply all sections to production directly — there is no separate staging. Engineer should:
1. Take a fresh dump immediately before starting (`supabase db dump --file pre_section_$N.sql`)
2. Run each Section transactionally where possible
3. After each Section, verify with the queries from acceptance criteria
4. STOP and report if any unexpected errors arise — do not paper over them

---

## END
