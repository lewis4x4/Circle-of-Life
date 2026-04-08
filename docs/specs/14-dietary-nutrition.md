# 14 — Dietary & Nutrition Management (Phase 6)

**Module:** Structured diet orders with IDDSI food/fluid levels, allergy and texture constraints, HACCP compliance logging (kitchen temp, meal logs), dietary staff credential tracking, documentation hooks for aspiration review vs medications  
**Dependencies:** [`009_residents.sql`](../../supabase/migrations/009_residents.sql) (`residents`), [`11-staff-management.md`](11-staff-management.md) (`staff`), [`06-medication-management.md`](06-medication-management.md) (cross-check automation is Enhanced)  
**Migration:** `089_dietary_nutrition.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/dietary`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## COL Operational Context

Circle of Life operates food service operations across five facilities, each subject to Florida Department of Health food safety requirements (FAC 64E-11) and AHCA ALF standards. COL's current food service compliance system consists of paper forms:

- **Food Service Daily checklist** — opening/closing kitchen tasks
- **Kitchen Temp Log** — HACCP temperature monitoring (all cooling/heating equipment, per meal)
- **Dinner Meal Log** — daily menu tracking and meal service documentation
- **HACCP guidance charts** — hand washing, food storage, cutting board color coding, potentially hazardous foods, refrigerator storage

Florida requires each ALF to maintain a food handler certification for dietary staff (FAC 64E-11.003). COL tracks this via the employee file system. Haven must integrate dietary staff credential status with the Module 11 staff certification model.

Dietary is also a linchpin for clinical risk: IDDSI texture levels must align with physician orders and medication administration (e.g., a resident on thickened fluids cannot receive pills that must be swallowed whole). This cross-check is Enhanced but the data model must support it from Core.

---

## Purpose (Core)

- **`diet_orders`:** One active clinical row per resident per workflow lifecycle. Captures IDDSI food texture level, IDDSI fluid viscosity, allergy and texture constraint arrays, and free-text aspiration/medication cross-check notes. Physician-ordered, facility-staff-maintained.
- **`kitchen_temp_logs`:** HACCP temperature monitoring. Per-reading record: equipment identifier, temperature, time, staff recorder, pass/fail against threshold. Digitalizes COL's paper Kitchen Temp Log.
- **`meal_service_logs`:** Daily meal service documentation. Per-meal-per-facility record: date, meal (breakfast/lunch/dinner/snack), menu description, head count, any substitutions or refusals noted. Digitalizes COL's Dinner Meal Log.
- **`dietary_staff_credentials`:** Bridges dietary staff → food handler certification. References `staff_certifications` but adds food-safety-specific fields (certifying body, permit number, FL-required renewal cadence).

**Non-goals (Core):** Automated rule engine checking `resident_medications` against fluid level; kitchen production tallies; nutrient/caloric analysis; tray ticket printing; recipe management.

---

## Scope Tiers

### Core

- Four tables + enums.
- RLS: facility-scoped clinical roles + family read for linked residents (diet_orders only).
- Admin hub: diet order list + create/update; HACCP log entry form; meal service log.
- Dietary staff credential status viewable from both `/admin/dietary` and `/admin/staff/:id`.

### Enhanced (defer)

- Edge Function: flag solid-dose medications vs. fluid viscosity level (cross-check with `resident_medications`).
- Tray ticket generation with resident name, diet order, room/bed.
- Menu planning calendar with nutritional targets.
- Automated HACCP alert if temperature reading fails threshold.
- Recipe and ingredient tracking with allergen flags.

---

## Schema (Core)

```sql
-- ── Enums ──────────────────────────────────────────────────────────────────

-- IDDSI Framework — International Dysphagia Diet Standardisation Initiative
CREATE TYPE iddsi_food_level AS ENUM (
  'level_7_regular',        -- Regular, Easy to Chew
  'level_6_soft_bite',      -- Soft and Bite-Sized
  'level_5_minced_moist',   -- Minced and Moist
  'level_4_pureed',         -- Pureed
  'level_3_liquidised',     -- Liquidised
  'level_2_mildly_thick',   -- not a food level per IDDSI, but used clinically
  'not_applicable'          -- e.g., tube feeding
);

CREATE TYPE iddsi_fluid_level AS ENUM (
  'level_0_thin',           -- Water, juice, coffee
  'level_1_slightly_thick',
  'level_2_mildly_thick',   -- Nectar consistency
  'level_3_moderately_thick', -- Honey consistency
  'level_4_extremely_thick', -- Pudding consistency
  'not_applicable'
);

CREATE TYPE diet_order_status AS ENUM (
  'draft',
  'active',
  'superseded',  -- replaced by a newer order
  'discontinued'
);

CREATE TYPE meal_type AS ENUM (
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'supplement'
);

CREATE TYPE temp_reading_result AS ENUM (
  'pass',
  'fail',
  'corrective_action_taken'
);

-- ── diet_orders ────────────────────────────────────────────────────────────
CREATE TABLE diet_orders (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id),
  facility_id                   uuid NOT NULL REFERENCES facilities(id),
  resident_id                   uuid NOT NULL REFERENCES residents(id),
  ordered_by_user_id            uuid REFERENCES user_profiles(user_id),   -- nurse who transcribed order
  physician_name                text,
  order_date                    date NOT NULL,
  effective_date                date NOT NULL,
  status                        diet_order_status NOT NULL DEFAULT 'draft',
  food_level                    iddsi_food_level NOT NULL DEFAULT 'level_7_regular',
  fluid_level                   iddsi_fluid_level NOT NULL DEFAULT 'level_0_thin',
  diet_type                     text,                    -- "Diabetic", "Low-sodium", "Renal", "Regular"
  caloric_target                integer,                 -- kcal/day; null = standard
  allergy_constraints           text[] NOT NULL DEFAULT '{}',
  texture_constraints           text[] NOT NULL DEFAULT '{}',
  supplement_ordered            text,                    -- "Ensure", "Boost", etc.
  supplement_frequency          text,
  medication_texture_review_notes text,                  -- human note: "resident on thickened fluids — confirm pill form OK with pharmacist"
  aspiration_risk_level         text,                    -- "none", "low", "moderate", "high"
  aspiration_precautions        text,
  notes                         text,
  superseded_by                 uuid REFERENCES diet_orders(id),
  discontinued_at               timestamptz,
  discontinued_by               uuid REFERENCES user_profiles(user_id),
  discontinued_reason           text,
  created_by                    uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

CREATE INDEX idx_diet_orders_resident ON diet_orders(resident_id, status);
CREATE INDEX idx_diet_orders_facility ON diet_orders(facility_id, order_date DESC);

ALTER TABLE diet_orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON diet_orders
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON diet_orders
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── kitchen_temp_logs ─────────────────────────────────────────────────────
-- Digitalizes COL's HACCP Kitchen Temp Log form.
CREATE TABLE kitchen_temp_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  recorded_by         uuid NOT NULL REFERENCES user_profiles(user_id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  meal_service        meal_type NOT NULL,
  equipment_name      text NOT NULL,  -- "Walk-in cooler", "Steam table 1", "Oven A", "Reach-in fridge"
  equipment_type      text NOT NULL,  -- "refrigerator", "freezer", "hot_hold", "cooking", "dishwasher"
  temp_fahrenheit     numeric(5,1) NOT NULL,
  min_threshold_f     numeric(5,1),  -- null = use default for equipment_type
  max_threshold_f     numeric(5,1),
  result              temp_reading_result NOT NULL,
  corrective_action   text,          -- required when result = corrective_action_taken
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kitchen_temp_facility ON kitchen_temp_logs(facility_id, recorded_at DESC);

ALTER TABLE kitchen_temp_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON kitchen_temp_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON kitchen_temp_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- HACCP thresholds by equipment_type (seed data reference):
-- refrigerator: max 41°F
-- freezer: max 0°F
-- hot_hold: min 135°F
-- cooking (poultry): min 165°F internal
-- cooking (ground meat): min 155°F internal
-- cooking (whole cuts, fish): min 145°F internal
-- dishwasher rinse: min 180°F (or sanitizer concentration checked)

-- ── meal_service_logs ─────────────────────────────────────────────────────
-- Digitalizes COL's Dinner Meal Log; extended to cover all meals.
CREATE TABLE meal_service_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  facility_id           uuid NOT NULL REFERENCES facilities(id),
  recorded_by           uuid NOT NULL REFERENCES user_profiles(user_id),
  service_date          date NOT NULL,
  meal_type             meal_type NOT NULL,
  menu_description      text NOT NULL,    -- what was served
  resident_count        integer NOT NULL, -- census at meal time
  meals_served          integer,
  meals_refused         integer DEFAULT 0,
  supplement_served     text,
  notes                 text,             -- substitutions, special preparations
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, service_date, meal_type)  -- one record per meal per day
);

ALTER TABLE meal_service_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meal_service_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

-- ── dietary_staff_credentials ─────────────────────────────────────────────
-- FL food handler certification tracking for dietary staff.
-- Supplements staff_certifications in Module 11 with dietary-specific detail.
CREATE TABLE dietary_staff_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  staff_id            uuid NOT NULL REFERENCES staff(id),
  credential_type     text NOT NULL DEFAULT 'food_handler_certification',
  certifying_body     text,           -- "FL DBPR", "ServSafe", "National Registry"
  permit_number       text,
  issued_at           date,
  expires_at          date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE dietary_staff_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON dietary_staff_credentials
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
```

---

## RLS Policies

```sql
-- diet_orders
CREATE POLICY "Facility clinical staff see diet orders"
  ON diet_orders FOR SELECT
  USING (organization_id = haven.organization_id()
    AND (
      facility_id = ANY(haven.accessible_facility_ids())
      OR EXISTS (
        SELECT 1 FROM family_resident_links
        WHERE resident_id = diet_orders.resident_id
          AND family_user_id = auth.uid()
          AND consent_active = true
      )
    ));

CREATE POLICY "Nurses and dietary staff manage diet orders"
  ON diet_orders FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse','dietary'));

-- kitchen_temp_logs
CREATE POLICY "Facility dietary/admin staff see temp logs"
  ON kitchen_temp_logs FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Dietary and admin manage temp logs"
  ON kitchen_temp_logs FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse','dietary'));

-- meal_service_logs (same pattern)
CREATE POLICY "Facility staff see meal logs"
  ON meal_service_logs FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Dietary staff manage meal logs"
  ON meal_service_logs FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse','dietary'));
```

---

## Business Rules

1. **One active diet order per resident.** When a new diet order is created for a resident with an existing active order, the previous order status must be set to `superseded` and `superseded_by` must reference the new order ID.

2. **Aspiration risk requires precautions.** If `aspiration_risk_level` is `moderate` or `high`, `aspiration_precautions` must be non-null (API-level validation).

3. **HACCP temp failures require corrective action.** If `result = corrective_action_taken`, `corrective_action` must be non-null. The AHCA surveyor pattern is to check whether facilities acted on failed readings — this text field is the audit trail.

4. **Food handler certification tracked per FL law.** Dietary staff must hold a valid food handler permit (FAC 64E-11.003). `dietary_staff_credentials` with `expires_at` is surfaced in the Module 12 compliance snapshot for dietary role staff.

5. **Meal count integrity.** `meals_served` must be ≤ `resident_count`. `meals_refused` must be ≤ `meals_served`. API enforces.

---

## HACCP Reference (Seed Data)

The following temperature thresholds are seeded into the application constants (not a DB table — enforced at API level):

| Equipment Type | Safe Range |
|----------------|------------|
| Refrigerator | ≤ 41°F |
| Freezer | ≤ 0°F |
| Hot hold | ≥ 135°F |
| Cooking — poultry | ≥ 165°F |
| Cooking — ground meat | ≥ 155°F |
| Cooking — whole cuts / fish | ≥ 145°F |
| Dishwasher rinse | ≥ 180°F |

---

## UI Screens (Core)

### `/admin/dietary` — Dietary Hub
- **Diet Orders tab:** Resident list with active diet order summary (food level, fluid level, allergies). Filter by IDDSI level, allergy, facility.
- **Diet order detail:** Full order with history (superseded orders visible). Edit / discontinue flows.
- **HACCP Logs tab:** Date-range picker + facility filter. Table of readings with pass/fail color coding. "Add Reading" form: equipment picker (seeded list per facility), temp entry, result, corrective action if failed.
- **Meal Logs tab:** Calendar or list view. "Log Today's Meal" form: select meal type, enter menu, resident count, any notes.
- **Dietary Staff tab:** Staff with `dietary` role showing food handler cert status (expired = red).

### Resident profile integration
- `/residents/:id` clinical tab must surface active diet order summary and link to full order.

---

## Document Gaps — Needed from COL

The following documents from COL's wiki should be obtained before finalizing Enhanced features:

- **Menu planning format** — COL's current meal planning process (weekly or monthly menus?). Determines whether `meal_service_logs.menu_description` is free text or structured.
- **Dietary policies** — COL's P&P for dietary management (special diet protocols, texture modification procedures, aspiration precaution protocols).
- **Nutritional assessment process** — How COL conducts dietary assessments at admission and periodically. Determines if a separate `dietary_assessments` table is needed.
- **IDDSI order workflow** — Who orders texture modifications (physician, SLP, nurse-practitioner)? Determines `ordered_by` role constraints.

---

## Definition of Done

- Migration `089` applies cleanly; TypeScript types updated.
- Diet order lifecycle works: create → activate → supersede → discontinue.
- HACCP temp log entry works with corrective action capture for failed readings.
- Meal service log records per meal per facility per day.
- Segment gates **PASS** with dietary route in `DESIGN_REVIEW_ROUTES` when UI ships.
