-- Phase 6: Dietary & Nutrition (spec 14-dietary-nutrition) — diet_orders + RLS + audit

CREATE TYPE diet_order_status AS ENUM (
  'draft',
  'active',
  'discontinued'
);

CREATE TYPE iddsi_food_level AS ENUM (
  'not_assessed',
  'level_3_liquidized',
  'level_4_pureed',
  'level_5_minced_moist',
  'level_6_soft_bite_sized',
  'level_7_regular_easy_chew'
);

CREATE TYPE iddsi_fluid_level AS ENUM (
  'not_assessed',
  'level_0_thin',
  'level_1_slightly_thick',
  'level_2_mildly_thick',
  'level_3_moderately_thick',
  'level_4_extremely_thick'
);

CREATE TABLE diet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  status diet_order_status NOT NULL DEFAULT 'draft',
  iddsi_food_level iddsi_food_level NOT NULL DEFAULT 'not_assessed',
  iddsi_fluid_level iddsi_fluid_level NOT NULL DEFAULT 'not_assessed',
  allergy_constraints text[] NOT NULL DEFAULT '{}',
  texture_constraints text[] NOT NULL DEFAULT '{}',
  aspiration_notes text,
  medication_texture_review_notes text,
  requires_swallow_eval boolean NOT NULL DEFAULT false,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT diet_orders_effective_chk CHECK (
    effective_to IS NULL
    OR effective_from IS NULL
    OR effective_to >= effective_from)
);

CREATE INDEX idx_diet_orders_facility ON diet_orders (facility_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_diet_orders_resident ON diet_orders (resident_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE diet_orders IS 'IDDSI diet orders; RLS clinical + family read; spec 14.';

ALTER TABLE diet_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY diet_orders_select_staff ON diet_orders
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN (
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'caregiver',
      'dietary'));

CREATE POLICY diet_orders_select_family ON diet_orders
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND EXISTS (
      SELECT
        1
      FROM
        public.family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = diet_orders.resident_id
        AND frl.revoked_at IS NULL));

CREATE POLICY diet_orders_insert ON diet_orders
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'dietary'));

CREATE POLICY diet_orders_update ON diet_orders
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse', 'dietary'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_diet_orders_set_updated_at
  BEFORE UPDATE ON diet_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_diet_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON diet_orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
