-- Migration 237: Restore Dietary Command Deck schema (174 remediation)
--
-- Context
-- -------
-- Migration 174 (`dietary_command_deck_tables`) was recorded in
-- `schema_migrations` as applied, but its DDL never ran against the
-- production database. As a result:
--   - The /dietary UI is broken: the 5 sibling tables (meal_services,
--     tray_tickets, haccp_logs, meal_refusals, fortification_recommendations)
--     do not exist, and seed 175 cannot land on the wrong-shape diet_orders.
--   - The live `public.diet_orders` table still carries the 089 schema
--     (status enum, allergy_constraints, deleted_at) — incompatible with
--     174's intended shape (diet_type CHECK, allergies/dislikes/preferences,
--     active boolean).
--   - The 233 audit-P1 patch correctly observed this drift (see header
--     comment in 233) and added family/caregiver SELECT policies keyed
--     on `deleted_at IS NULL` to match the live 089 schema. Those policies
--     must be re-asserted on the rebuilt table using `active = true`
--     semantics matching 174's design.
--
-- Strategy
-- --------
-- 1. Hard safety guard: refuse to run if diet_orders has any rows (it is
--    currently 0; verified). One-shot rebuild — not idempotent for the
--    diet_orders DROP+CREATE.
-- 2. DROP diet_orders CASCADE — removes the 089-shape table along with
--    its 5 dependent policies, indexes, and triggers in one motion.
-- 3. CREATE diet_orders with 174's full schema, indexes, RLS, triggers.
-- 4. CREATE the 5 sibling tables (`IF NOT EXISTS`) with their indexes,
--    RLS, and triggers exactly as 174 specified.
-- 5. ALTER residents to add `dietary_alert_flags` (IF NOT EXISTS) plus
--    its GIN index.
-- 6. Re-assert the 233 audit-P1 family + caregiver SELECT policies on
--    the rebuilt diet_orders, swapping the predicate
--      `deleted_at IS NULL`  ->  `active = true`
--    to match the new schema's active-row semantics. All other clauses
--    (organization scope, family_resident_links join, app_role checks)
--    are preserved verbatim from 233.
--
-- Notes
-- -----
-- * `dietary_aide` enum value is added BEFORE the transaction block — Postgres
--   forbids using a newly-added enum value within the same transaction. The
--   ADD VALUE statement uses IF NOT EXISTS and is idempotent on its own.
-- * Sibling tables, residents column, indexes, and policies all use
--   `IF NOT EXISTS` / `DROP ... IF EXISTS` guards so a partial re-apply
--   is safe; the diet_orders rebuild is the single one-shot piece.

-- ============================================================
-- PRE-TRANSACTION: extend app_role enum
-- (must run outside any explicit BEGIN — Postgres won't allow a newly
--  added enum value to be used inside the same transaction)
-- ============================================================
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'dietary_aide';

BEGIN;

-- ============================================================
-- SAFETY GUARD: diet_orders must be empty before drop
-- ============================================================
DO $$
BEGIN
  IF (SELECT count(*) FROM public.diet_orders) > 0 THEN
    RAISE EXCEPTION 'diet_orders has rows — refusing to DROP. Manual intervention required.';
  END IF;
END $$;


-- ============================================================
-- DROP existing diet_orders (089 shape) — CASCADE removes its
-- dependent policies, indexes, and triggers in one motion.
-- ============================================================
DROP TABLE IF EXISTS public.diet_orders CASCADE;


-- ============================================================
-- 1. DIET ORDERS (174 schema)
-- One active row per resident (enforced by partial unique index).
-- Supersedes the enum-based `diet_orders` from 089_dietary_nutrition.sql.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_diet_orders_resident_active
  ON diet_orders(resident_id) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_diet_orders_facility
  ON diet_orders(facility_id, active) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_diet_orders_iddsi
  ON diet_orders(iddsi_food_level, iddsi_liquid_level);

ALTER TABLE diet_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Diet orders visible to dietary and clinical staff" ON diet_orders;
CREATE POLICY "Diet orders visible to dietary and clinical staff"
  ON diet_orders FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

DROP POLICY IF EXISTS "Clinical staff manage diet orders" ON diet_orders;
CREATE POLICY "Clinical staff manage diet orders"
  ON diet_orders FOR ALL
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','manager','owner','org_admin','facility_admin')
  );

DROP TRIGGER IF EXISTS tr_diet_orders_set_updated_at ON diet_orders;
CREATE TRIGGER tr_diet_orders_set_updated_at
  BEFORE UPDATE ON diet_orders
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_diet_orders_audit ON diet_orders;
CREATE TRIGGER tr_diet_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON diet_orders
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();


-- ============================================================
-- 2. MEAL SERVICES
-- One row per (facility, date, meal_period, venue) combination.
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  service_date     date NOT NULL,
  meal_period      text NOT NULL CHECK (meal_period IN (
    'breakfast','lunch','dinner','snack_am','snack_pm','snack_hs'
  )),
  venue            text NOT NULL CHECK (venue IN (
    'main_dining','enhanced_alf','room_trays','private_dining','event'
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

CREATE INDEX IF NOT EXISTS idx_meal_services_today
  ON meal_services(facility_id, service_date, scheduled_start);

ALTER TABLE meal_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Meal services visible to dietary and clinical staff" ON meal_services;
CREATE POLICY "Meal services visible to dietary and clinical staff"
  ON meal_services FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

DROP POLICY IF EXISTS "Dietary staff manage meal services" ON meal_services;
CREATE POLICY "Dietary staff manage meal services"
  ON meal_services FOR ALL
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  );


-- ============================================================
-- 3. TRAY TICKETS
-- One per resident per service — the kanban card.
-- ============================================================
CREATE TABLE IF NOT EXISTS tray_tickets (
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

CREATE INDEX IF NOT EXISTS idx_tray_tickets_service_status
  ON tray_tickets(meal_service_id, status);

CREATE INDEX IF NOT EXISTS idx_tray_tickets_resident_recent
  ON tray_tickets(resident_id, created_at DESC);

ALTER TABLE tray_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tray tickets visible to dietary and clinical staff" ON tray_tickets;
CREATE POLICY "Tray tickets visible to dietary and clinical staff"
  ON tray_tickets FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

DROP POLICY IF EXISTS "Dietary staff manage tray tickets" ON tray_tickets;
CREATE POLICY "Dietary staff manage tray tickets"
  ON tray_tickets FOR ALL
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','nurse','manager','owner','org_admin','facility_admin')
  )
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','nurse','manager','owner','org_admin','facility_admin')
  );

DROP TRIGGER IF EXISTS tr_tray_tickets_set_updated_at ON tray_tickets;
CREATE TRIGGER tr_tray_tickets_set_updated_at
  BEFORE UPDATE ON tray_tickets
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_tray_tickets_audit ON tray_tickets;
CREATE TRIGGER tr_tray_tickets_audit
  AFTER INSERT OR UPDATE OR DELETE ON tray_tickets
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();


-- ============================================================
-- 4. HACCP LOGS (append-only — no UPDATE/DELETE policies)
-- ============================================================
CREATE TABLE IF NOT EXISTS haccp_logs (
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

CREATE INDEX IF NOT EXISTS idx_haccp_facility_recent
  ON haccp_logs(facility_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_haccp_out_of_range
  ON haccp_logs(facility_id, logged_at DESC) WHERE in_safe_range = false;

ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HACCP logs readable by dietary and clinical staff" ON haccp_logs;
CREATE POLICY "HACCP logs readable by dietary and clinical staff"
  ON haccp_logs FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

-- Insert only — dietary staff log temps, no updates or deletes allowed
DROP POLICY IF EXISTS "Dietary staff insert HACCP logs" ON haccp_logs;
CREATE POLICY "Dietary staff insert HACCP logs"
  ON haccp_logs FOR INSERT
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin')
  );


-- ============================================================
-- 5. MEAL REFUSALS
-- ============================================================
CREATE TABLE IF NOT EXISTS meal_refusals (
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

CREATE INDEX IF NOT EXISTS idx_meal_refusals_resident_recent
  ON meal_refusals(resident_id, refused_at DESC);

CREATE INDEX IF NOT EXISTS idx_meal_refusals_facility_recent
  ON meal_refusals(facility_id, refused_at DESC);

ALTER TABLE meal_refusals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Meal refusals visible to dietary and clinical staff" ON meal_refusals;
CREATE POLICY "Meal refusals visible to dietary and clinical staff"
  ON meal_refusals FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','caregiver','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

DROP POLICY IF EXISTS "Dietary and caregivers insert refusals" ON meal_refusals;
CREATE POLICY "Dietary and caregivers insert refusals"
  ON meal_refusals FOR INSERT
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','caregiver','nurse','manager','owner',
      'org_admin','facility_admin'
    )
  );

DROP TRIGGER IF EXISTS tr_meal_refusals_audit ON meal_refusals;
CREATE TRIGGER tr_meal_refusals_audit
  AFTER INSERT OR UPDATE OR DELETE ON meal_refusals
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();


-- ============================================================
-- 6. FORTIFICATION RECOMMENDATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS fortification_recommendations (
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

CREATE INDEX IF NOT EXISTS idx_fortify_facility_pending
  ON fortification_recommendations(facility_id, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fortify_resident_status
  ON fortification_recommendations(resident_id, status);

ALTER TABLE fortification_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fortification recs visible to dietary and clinical staff" ON fortification_recommendations;
CREATE POLICY "Fortification recs visible to dietary and clinical staff"
  ON fortification_recommendations FOR SELECT
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','dietary_aide','nurse','manager','owner',
      'org_admin','facility_admin','coordinator'
    )
  );

DROP POLICY IF EXISTS "Dietary and clinical staff manage fortification recs" ON fortification_recommendations;
CREATE POLICY "Dietary and clinical staff manage fortification recs"
  ON fortification_recommendations FOR ALL
  USING (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','nurse','manager','owner','org_admin','facility_admin'
    )
  )
  WITH CHECK (
    facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN (
      'dietary','nurse','manager','owner','org_admin','facility_admin'
    )
  );

DROP TRIGGER IF EXISTS tr_fortification_recommendations_set_updated_at ON fortification_recommendations;
CREATE TRIGGER tr_fortification_recommendations_set_updated_at
  BEFORE UPDATE ON fortification_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_fortification_recommendations_audit ON fortification_recommendations;
CREATE TRIGGER tr_fortification_recommendations_audit
  AFTER INSERT OR UPDATE OR DELETE ON fortification_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();


-- ============================================================
-- RESIDENTS: dietary alert flags column + GIN index
-- ============================================================
ALTER TABLE residents ADD COLUMN IF NOT EXISTS
  dietary_alert_flags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_residents_dietary_flags
  ON residents USING GIN (dietary_alert_flags);


-- ============================================================
-- 233 AUDIT-P1 PRESERVATION: re-assert family + caregiver SELECT
-- policies on the rebuilt diet_orders. The 233 patch keyed these
-- on `deleted_at IS NULL` to match the live 089 schema; with 174's
-- shape now in place we swap that predicate for `active = true`.
-- All other clauses (organization scope, family_resident_links
-- join, app_role checks) are preserved verbatim from 233.
-- ============================================================

DROP POLICY IF EXISTS diet_orders_select_family ON public.diet_orders;

CREATE POLICY diet_orders_select_family ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND active = true
    AND haven.app_role() = 'family'
    AND EXISTS (
      SELECT 1
      FROM public.family_resident_links frl
      WHERE frl.user_id = auth.uid()
        AND frl.resident_id = diet_orders.resident_id
        AND frl.revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS diet_orders_select_caregiver ON public.diet_orders;

CREATE POLICY diet_orders_select_caregiver ON public.diet_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND active = true
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() = 'caregiver'
  );

COMMENT ON POLICY diet_orders_select_family ON public.diet_orders IS
  'Family portal: active diet order for linked resident.';

COMMENT ON POLICY diet_orders_select_caregiver ON public.diet_orders IS
  'Caregiver shell: active diet orders in accessible facilities.';

COMMIT;
