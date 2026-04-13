-- Migration 174: Dietary Command Deck — Core Tables
--
-- Creates the schema for the dedicated /dietary command deck (Lead Cook + Aide cockpit).
-- Tables:
--   1. diet_orders                    — one active row per resident
--   2. meal_services                  — scheduled meal periods per venue
--   3. tray_tickets                   — kanban card per resident per service
--   4. haccp_logs                     — append-only temperature records
--   5. meal_refusals                  — refusal log (also fed by caregiver charting)
--   6. fortification_recommendations  — weight-loss/low-intake driven add-ons
--
-- Role additions:
--   - dietary_aide added to app_role enum
--
-- Follows Haven conventions: org_id + facility_id, UUIDs, RLS with haven.* helpers,
-- soft deletes (where applicable), audit triggers on clinical tables, money in cents.

-- ============================================================
-- ROLE ENUM WIDENING
-- ============================================================
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'dietary_aide';


-- ============================================================
-- 1. DIET ORDERS
-- One active row per resident (enforced by partial unique index).
-- ============================================================
CREATE TABLE diet_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  resident_id      uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  diet_type        text NOT NULL CHECK (diet_type IN (
    'regular','mechanical_soft','puree','full_liquid','clear_liquid',
    'ncs','low_sodium','renal','gluten_free','lactose_free',
    'vegetarian','vegan','custom'
  )),
  iddsi_food_level   int CHECK (iddsi_food_level BETWEEN 0 AND 7),
  iddsi_liquid_level int CHECK (iddsi_liquid_level BETWEEN 0 AND 4),
  allergies        text[] NOT NULL DEFAULT '{}',
  dislikes         text[] NOT NULL DEFAULT '{}',
  preferences      text[] NOT NULL DEFAULT '{}',
  notes            text,
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_to     timestamptz,
  ordered_by       uuid REFERENCES auth.users(id),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_diet_orders_resident_active
  ON diet_orders(resident_id) WHERE active = true;

CREATE INDEX idx_diet_orders_facility
  ON diet_orders(facility_id, active) WHERE active = true;

CREATE INDEX idx_diet_orders_iddsi
  ON diet_orders(iddsi_food_level, iddsi_liquid_level);

ALTER TABLE diet_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Diet orders visible to dietary and clinical staff"
  ON diet_orders FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

CREATE POLICY "Clinical staff manage diet orders"
  ON diet_orders FOR ALL
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','manager','owner','org_admin','facility_admin')
  );

SELECT haven_capture_audit_log('diet_orders');


-- ============================================================
-- 2. MEAL SERVICES
-- One row per (facility, date, meal_period, venue) combination.
-- ============================================================
CREATE TABLE meal_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  service_date     date NOT NULL,
  meal_period      text NOT NULL CHECK (meal_period IN (
    'breakfast','lunch','dinner','snack_am','snack_pm','snack_hs'
  )),
  venue            text NOT NULL CHECK (venue IN (
    'main_dining','memory_care','room_trays','private_dining','event'
  )),
  scheduled_start  timestamptz NOT NULL,
  scheduled_end    timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','prep','plating','service','closed'
  )),
  expected_count   int NOT NULL DEFAULT 0,
  served_count     int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, service_date, meal_period, venue)
);

CREATE INDEX idx_meal_services_today
  ON meal_services(facility_id, service_date, scheduled_start);

ALTER TABLE meal_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Meal services visible to dietary and clinical staff"
  ON meal_services FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

CREATE POLICY "Dietary staff manage meal services"
  ON meal_services FOR ALL
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  );


-- ============================================================
-- 3. TRAY TICKETS
-- One per resident per service — the kanban card.
-- ============================================================
CREATE TABLE tray_tickets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  facility_id           uuid NOT NULL REFERENCES facilities(id),
  meal_service_id       uuid NOT NULL REFERENCES meal_services(id) ON DELETE CASCADE,
  resident_id           uuid NOT NULL REFERENCES residents(id),
  diet_order_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  menu_items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  fortification_items   jsonb NOT NULL DEFAULT '[]'::jsonb,
  substitutions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','prepping','plating','plated','passed','delivered',
    'refused','wasted','npo','hospital'
  )),
  iddsi_confirmed_food   boolean NOT NULL DEFAULT false,
  iddsi_confirmed_liquid boolean NOT NULL DEFAULT false,
  allergen_check_passed  boolean NOT NULL DEFAULT false,
  plated_by             uuid REFERENCES auth.users(id),
  plated_at             timestamptz,
  passed_by             uuid REFERENCES auth.users(id),
  passed_at             timestamptz,
  delivered_by          uuid REFERENCES auth.users(id),
  delivered_at          timestamptz,
  refusal_reason        text,
  refused_at            timestamptz,
  carb_count_g          numeric(5,1),
  sodium_mg             numeric(6,1),
  calorie_count         int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tray_tickets_service_status
  ON tray_tickets(meal_service_id, status);

CREATE INDEX idx_tray_tickets_resident_recent
  ON tray_tickets(resident_id, created_at DESC);

ALTER TABLE tray_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tray tickets visible to dietary and clinical staff"
  ON tray_tickets FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

CREATE POLICY "Dietary staff manage tray tickets"
  ON tray_tickets FOR ALL
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','nurse','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','nurse','manager','owner','org_admin','facility_admin')
  );

SELECT haven_capture_audit_log('tray_tickets');


-- ============================================================
-- 4. HACCP LOGS (append-only — no UPDATE/DELETE policies)
-- ============================================================
CREATE TABLE haccp_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  log_type         text NOT NULL CHECK (log_type IN (
    'hot_hold','cold_hold','cooking','cooling','reheating','receiving',
    'fridge_temp','freezer_temp','dishmachine','sanitizer'
  )),
  item             text NOT NULL,
  temperature_f    numeric(5,1) NOT NULL,
  in_safe_range    boolean NOT NULL,
  threshold_min_f  numeric(5,1),
  threshold_max_f  numeric(5,1),
  corrective_action text,
  voice_transcript text,
  logged_by        uuid NOT NULL REFERENCES auth.users(id),
  meal_service_id  uuid REFERENCES meal_services(id),
  logged_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_haccp_facility_recent
  ON haccp_logs(facility_id, logged_at DESC);

CREATE INDEX idx_haccp_out_of_range
  ON haccp_logs(facility_id, logged_at DESC) WHERE in_safe_range = false;

ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HACCP logs readable by dietary and clinical staff"
  ON haccp_logs FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

-- Insert only — dietary staff log temps, no updates or deletes allowed
CREATE POLICY "Dietary staff insert HACCP logs"
  ON haccp_logs FOR INSERT
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  );


-- ============================================================
-- 5. MEAL REFUSALS
-- ============================================================
CREATE TABLE meal_refusals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  resident_id      uuid NOT NULL REFERENCES residents(id),
  meal_service_id  uuid REFERENCES meal_services(id),
  tray_ticket_id   uuid REFERENCES tray_tickets(id),
  refused_items    text[] NOT NULL DEFAULT '{}',
  reason           text,
  reported_by      uuid NOT NULL REFERENCES auth.users(id),
  intake_estimate_pct int CHECK (intake_estimate_pct BETWEEN 0 AND 100),
  substitution_offered   boolean NOT NULL DEFAULT false,
  substitution_accepted  boolean,
  refused_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meal_refusals_resident_recent
  ON meal_refusals(resident_id, refused_at DESC);

CREATE INDEX idx_meal_refusals_facility_recent
  ON meal_refusals(facility_id, refused_at DESC);

ALTER TABLE meal_refusals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Meal refusals visible to dietary and clinical staff"
  ON meal_refusals FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','caregiver','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

CREATE POLICY "Dietary and caregivers insert refusals"
  ON meal_refusals FOR INSERT
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','caregiver','nurse','manager','owner',
      'org_admin','facility_admin'
    )
  );

SELECT haven_capture_audit_log('meal_refusals');


-- ============================================================
-- 6. FORTIFICATION RECOMMENDATIONS
-- ============================================================
CREATE TABLE fortification_recommendations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  resident_id      uuid NOT NULL REFERENCES residents(id),
  triggered_by     text NOT NULL CHECK (triggered_by IN (
    'weight_loss','low_intake','rd_order','manual'
  )),
  trigger_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_added_calories int,
  diet_compliant   boolean NOT NULL DEFAULT true,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','accepted','declined','superseded'
  )),
  applied_to_ticket_ids uuid[] DEFAULT '{}',
  reviewed_by_nurse uuid REFERENCES auth.users(id),
  nurse_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fortify_facility_pending
  ON fortification_recommendations(facility_id, status) WHERE status = 'pending';

CREATE INDEX idx_fortify_resident_status
  ON fortification_recommendations(resident_id, status);

ALTER TABLE fortification_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fortification recs visible to dietary and clinical staff"
  ON fortification_recommendations FOR SELECT
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

CREATE POLICY "Dietary and clinical staff manage fortification recs"
  ON fortification_recommendations FOR ALL
  USING (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','nurse','manager','owner','org_admin','facility_admin'
    )
  )
  WITH CHECK (
    facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','nurse','manager','owner','org_admin','facility_admin'
    )
  );

SELECT haven_capture_audit_log('fortification_recommendations');


-- ============================================================
-- RESIDENTS: dietary alert flags column
-- ============================================================
ALTER TABLE residents ADD COLUMN IF NOT EXISTS
  dietary_alert_flags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_residents_dietary_flags
  ON residents USING GIN (dietary_alert_flags);
