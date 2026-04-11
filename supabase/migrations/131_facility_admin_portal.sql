-- ============================================================================
-- Migration 131: Facility Admin Portal
-- Blueprint: blueprint-col-facility-admin-portal-2026-04-10
--
-- Creates 9 new tables, adds columns to facilities/entities,
-- seeds building profiles, emergency contacts, and operational thresholds
-- for all 5 existing COL facilities.
--
-- PREREQUISITE: btree_gist extension (for EXCLUDE constraint on rates)
-- ============================================================================

-- 0. Enable btree_gist for date range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- 1. ALTER EXISTING TABLES
-- ============================================================================

-- facilities: new operational columns
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS care_services_offered text[]
  DEFAULT ARRAY['standard_alf'];
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS opening_date date;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS current_administrator_id uuid REFERENCES auth.users(id);
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS waitlist_count integer NOT NULL DEFAULT 0;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS target_occupancy_pct numeric(4,2) DEFAULT 0.95;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS last_survey_date date;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS last_survey_result text CHECK (last_survey_result IN (
  'no_citations', 'citations_issued', 'immediate_jeopardy', 'conditional'
));

-- entities: corporate registration tracking
ALTER TABLE entities ADD COLUMN IF NOT EXISTS registered_agent_name text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS sunbiz_document_number text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS formation_date date;

-- ============================================================================
-- 2. FACILITY EMERGENCY CONTACTS
-- ============================================================================
CREATE TABLE facility_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_category text NOT NULL CHECK (contact_category IN (
    'law_enforcement', 'fire_department', 'hospital', 'poison_control',
    'utility_electric', 'utility_water', 'utility_gas', 'utility_internet',
    'ahca_hotline', 'ombudsman', 'dcf_abuse_hotline', 'osha',
    'evacuation_partner', 'corporate_on_call', 'facility_on_call',
    'pharmacy_after_hours', 'elevator_service', 'fire_alarm_monitoring',
    'generator_service', 'hvac_emergency', 'plumbing_emergency',
    'locksmith', 'county_emergency_mgmt', 'county_health_dept',
    'county_bldg_zoning', 'city_government', 'gas_provider',
    'electric_maintenance', 'roofing', 'painter', 'transport', 'other'
  )),
  contact_name text NOT NULL,
  phone_primary text NOT NULL,
  phone_secondary text,
  address text,
  distance_miles numeric(5,1),
  drive_time_minutes integer,
  account_number text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_fec_facility ON facility_emergency_contacts(facility_id) WHERE deleted_at IS NULL;

ALTER TABLE facility_emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY fec_select ON facility_emergency_contacts
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fec_manage ON facility_emergency_contacts
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 3. FACILITY DOCUMENTS (Document Vault)
-- ============================================================================
CREATE TABLE facility_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  document_category text NOT NULL CHECK (document_category IN (
    'ahca_license', 'fire_inspection', 'elevator_inspection',
    'kitchen_license', 'insurance_certificate', 'survey_report',
    'poc_response', 'resident_handbook', 'employee_handbook',
    'building_permit', 'occupancy_certificate', 'generator_inspection',
    'backflow_prevention', 'fire_alarm_inspection', 'sprinkler_inspection',
    'pest_control_report', 'water_quality_report', 'radon_test',
    'ada_compliance', 'evacuation_plan', 'floor_plan',
    'photo_hero', 'photo_room', 'photo_dining', 'photo_activity',
    'vendor_contract', 'storm_preparedness', 'other'
  )),
  document_name text NOT NULL,
  file_path text NOT NULL,
  file_size_bytes bigint,
  mime_type text,
  expiration_date date,
  alert_yellow_days integer NOT NULL DEFAULT 60,
  alert_red_days integer NOT NULL DEFAULT 30,
  notes text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_fd_facility ON facility_documents(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_fd_expiration ON facility_documents(expiration_date)
  WHERE deleted_at IS NULL AND expiration_date IS NOT NULL;

ALTER TABLE facility_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY fd_select ON facility_documents
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fd_manage ON facility_documents
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 4. RATE SCHEDULE VERSIONS (Effective-Dated)
-- ============================================================================
CREATE TABLE rate_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  rate_type text NOT NULL CHECK (rate_type IN (
    'private_room', 'semi_private_room', 'respite_daily',
    'second_occupant', 'community_fee', 'admission_fee',
    'pet_fee_monthly', 'medicaid_oss', 'enhanced_alf_surcharge',
    'care_surcharge_level_1', 'care_surcharge_level_2', 'care_surcharge_level_3',
    'bed_hold_daily'
  )),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  effective_from date NOT NULL,
  effective_to date,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT no_overlapping_rates EXCLUDE USING gist (
    facility_id WITH =,
    rate_type WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (deleted_at IS NULL)
);

CREATE INDEX idx_rsv_facility_active ON rate_schedule_versions(facility_id, rate_type, effective_from)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_rsv_current ON rate_schedule_versions(facility_id, rate_type)
  WHERE deleted_at IS NULL AND effective_to IS NULL;

ALTER TABLE rate_schedule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY rsv_select ON rate_schedule_versions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY rsv_manage ON rate_schedule_versions
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 5. FACILITY OPERATIONAL THRESHOLDS
-- ============================================================================
CREATE TABLE facility_operational_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  threshold_type text NOT NULL CHECK (threshold_type IN (
    'occupancy_low_pct', 'occupancy_high_pct',
    'staffing_ratio_violation', 'license_expiry_days',
    'insurance_expiry_days', 'document_expiry_days',
    'background_check_expiry_days', 'training_overdue_days',
    'fire_drill_overdue_days', 'elopement_drill_overdue_days',
    'incident_spike_count', 'census_change_alert'
  )),
  yellow_threshold numeric NOT NULL,
  red_threshold numeric NOT NULL,
  notify_roles text[] NOT NULL DEFAULT ARRAY['owner', 'org_admin'],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (facility_id, threshold_type)
);

CREATE INDEX idx_fot_facility ON facility_operational_thresholds(facility_id) WHERE enabled = true;

ALTER TABLE facility_operational_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY fot_select ON facility_operational_thresholds
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fot_manage ON facility_operational_thresholds
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 6. FACILITY AUDIT LOG (Append-Only)
-- ============================================================================
CREATE TABLE facility_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  field_name text,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text
);

CREATE INDEX idx_fal_facility_time ON facility_audit_log(facility_id, changed_at DESC);
CREATE INDEX idx_fal_record ON facility_audit_log(table_name, record_id);

ALTER TABLE facility_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY fal_select ON facility_audit_log
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY fal_insert ON facility_audit_log
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
  );

-- ============================================================================
-- 7. FACILITY SURVEY HISTORY
-- ============================================================================
CREATE TABLE facility_survey_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  survey_date date NOT NULL,
  survey_type text NOT NULL CHECK (survey_type IN (
    'annual', 'complaint', 'follow_up', 'change_of_ownership', 'initial', 'abbreviated'
  )),
  result text NOT NULL CHECK (result IN (
    'no_citations', 'citations_issued', 'immediate_jeopardy', 'conditional'
  )),
  citation_count integer NOT NULL DEFAULT 0,
  citation_details jsonb,
  poc_submitted_date date,
  poc_accepted_date date,
  surveyor_names text[],
  document_id uuid REFERENCES facility_documents(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_fsh_facility ON facility_survey_history(facility_id, survey_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE facility_survey_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY fsh_select ON facility_survey_history
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fsh_manage ON facility_survey_history
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 8. FACILITY BUILDING PROFILES (1:1 with facilities)
-- ============================================================================
CREATE TABLE facility_building_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  -- Construction
  year_built integer CHECK (year_built >= 1900 AND year_built <= 2100),
  last_renovation_year integer,
  square_footage integer,
  number_of_floors integer NOT NULL DEFAULT 1,
  number_of_wings integer,
  construction_type text CHECK (construction_type IN (
    'wood_frame', 'masonry', 'steel_frame', 'concrete', 'mixed'
  )),
  -- Fire & Safety
  fire_suppression_type text CHECK (fire_suppression_type IN (
    'full_sprinkler', 'partial_sprinkler', 'extinguisher_only', 'none'
  )),
  fire_alarm_monitoring_company text,
  fire_alarm_account_number text,
  last_fire_inspection_date date,
  next_fire_inspection_date date,
  -- Generator
  has_generator boolean NOT NULL DEFAULT false,
  generator_fuel_type text CHECK (generator_fuel_type IN (
    'diesel', 'natural_gas', 'propane', 'dual_fuel'
  )),
  generator_capacity_kw integer,
  generator_last_test_date date,
  generator_next_service_date date,
  generator_service_vendor text,
  -- Kitchen
  kitchen_license_number text,
  kitchen_license_expiration date,
  last_kitchen_inspection_date date,
  meal_times jsonb DEFAULT '{
    "breakfast": "07:30",
    "lunch": "12:00",
    "dinner": "17:30",
    "snack_am": "10:00",
    "snack_pm": "14:30",
    "snack_evening": "19:30"
  }'::jsonb,
  dietary_capabilities text[] DEFAULT ARRAY[
    'regular', 'diabetic', 'low_sodium', 'pureed',
    'mechanical_soft', 'thickened_liquids'
  ],
  -- Elevator
  has_elevator boolean NOT NULL DEFAULT false,
  elevator_inspection_date date,
  elevator_service_company text,
  -- ADA
  ada_compliant boolean NOT NULL DEFAULT true,
  ada_notes text,
  -- Parking
  parking_spaces integer,
  handicap_spaces integer,
  -- Elopement Prevention
  door_alarm_system text,
  perimeter_description text,
  wander_guard_system text,
  nearest_crossroads text,
  -- Storm Preparedness
  evacuation_partner_facility text,
  evacuation_transport_capacity integer,
  shelter_in_place_capacity_days integer DEFAULT 3,
  emergency_water_supply_gallons integer,
  emergency_food_supply_expiration date,
  -- Utility Providers (stored here for building context)
  electric_provider text,
  electric_account_number text,
  electric_phone text,
  gas_provider text,
  gas_account_number text,
  gas_phone text,
  water_provider text,
  water_account_number text,
  water_phone text,
  internet_provider text,
  internet_account_number text,
  internet_phone text,
  --
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE facility_building_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY fbp_select ON facility_building_profiles
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fbp_manage ON facility_building_profiles
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 9. FACILITY COMMUNICATION SETTINGS (1:1 with facilities)
-- ============================================================================
CREATE TABLE facility_communication_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  -- Visitation
  visiting_hours_start time DEFAULT '09:00',
  visiting_hours_end time DEFAULT '20:00',
  visitor_check_in_required boolean NOT NULL DEFAULT true,
  visitor_screening_enabled boolean NOT NULL DEFAULT false,
  restricted_areas text[],
  -- Family Notifications
  auto_notify_incident_types text[] DEFAULT ARRAY[
    'falls', 'elopement', 'hospitalization', 'death'
  ],
  care_plan_update_notifications boolean NOT NULL DEFAULT true,
  photo_sharing_enabled boolean NOT NULL DEFAULT true,
  message_approval_required boolean NOT NULL DEFAULT false,
  -- Online Presence / Marketing
  google_business_profile_url text,
  yelp_listing_url text,
  caring_com_profile_url text,
  facebook_page_url text,
  facility_tagline text,
  key_differentiators text[],
  tour_available_days text[] DEFAULT ARRAY[
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday'
  ],
  tour_available_hours_start time DEFAULT '10:00',
  tour_available_hours_end time DEFAULT '16:00',
  --
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE facility_communication_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY fcs_select ON facility_communication_settings
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fcs_manage ON facility_communication_settings
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY fcs_facility_admin_update ON facility_communication_settings
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() = 'facility_admin'
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- 10. FACILITY TIMELINE EVENTS
-- ============================================================================
CREATE TABLE facility_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_date date NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'opened', 'ownership_change', 'administrator_change', 'renovation',
    'survey', 'license_renewal', 'insurance_renewal', 'capacity_change',
    'vendor_change', 'rate_change', 'policy_change', 'incident_major',
    'recognition', 'other'
  )),
  title text NOT NULL,
  description text,
  document_id uuid REFERENCES facility_documents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_fte_facility ON facility_timeline_events(facility_id, event_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE facility_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY fte_select ON facility_timeline_events
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fte_manage ON facility_timeline_events
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

-- ============================================================================
-- 11. AUDIT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION haven.facility_audit_trigger()
RETURNS trigger AS $$
DECLARE
  v_facility_id uuid;
  v_org_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_user_id uuid;
  col_name text;
  old_val jsonb;
  new_val jsonb;
BEGIN
  v_action := TG_OP;
  v_user_id := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_action = 'DELETE' THEN
    v_facility_id := OLD.facility_id;
    v_org_id := OLD.organization_id;
    INSERT INTO facility_audit_log (facility_id, organization_id, table_name, record_id, action, old_value, changed_by)
    VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), v_user_id);
    RETURN OLD;
  END IF;

  IF v_action = 'INSERT' THEN
    v_facility_id := NEW.facility_id;
    v_org_id := NEW.organization_id;
    INSERT INTO facility_audit_log (facility_id, organization_id, table_name, record_id, action, new_value, changed_by)
    VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), v_user_id);
    RETURN NEW;
  END IF;

  -- UPDATE: log each changed field separately
  v_facility_id := NEW.facility_id;
  v_org_id := NEW.organization_id;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOR col_name IN SELECT key FROM jsonb_each(v_new) LOOP
    IF col_name IN ('updated_at', 'updated_by') THEN CONTINUE; END IF;
    old_val := v_old -> col_name;
    new_val := v_new -> col_name;
    IF old_val IS DISTINCT FROM new_val THEN
      INSERT INTO facility_audit_log (facility_id, organization_id, table_name, record_id, action, field_name, old_value, new_value, changed_by)
      VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, NEW.id, 'UPDATE', col_name, old_val, new_val, v_user_id);
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Audit is non-blocking: log failure but don't abort the transaction
  RAISE WARNING 'facility_audit_trigger failed: %', SQLERRM;
  IF v_action = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers to all new facility config tables
CREATE TRIGGER trg_audit_fec AFTER INSERT OR UPDATE OR DELETE ON facility_emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fd AFTER INSERT OR UPDATE OR DELETE ON facility_documents
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_rsv AFTER INSERT OR UPDATE OR DELETE ON rate_schedule_versions
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fot AFTER INSERT OR UPDATE OR DELETE ON facility_operational_thresholds
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fsh AFTER INSERT OR UPDATE OR DELETE ON facility_survey_history
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fbp AFTER INSERT OR UPDATE OR DELETE ON facility_building_profiles
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fcs AFTER INSERT OR UPDATE OR DELETE ON facility_communication_settings
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

CREATE TRIGGER trg_audit_fte AFTER INSERT OR UPDATE OR DELETE ON facility_timeline_events
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger();

-- ============================================================================
-- 12. SEED DATA — Building Profiles
-- Source: Storm Preparedness Guidelines PDF (07.29.2025)
-- ============================================================================

-- Get facility IDs by name for seeding
DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_oakridge_id uuid;
  v_homewood_id uuid;
  v_rising_oaks_id uuid;
  v_plantation_id uuid;
  v_grande_cypress_id uuid;
BEGIN
  SELECT id INTO v_oakridge_id FROM facilities WHERE organization_id = v_org_id AND name ILIKE '%oakridge%' LIMIT 1;
  SELECT id INTO v_homewood_id FROM facilities WHERE organization_id = v_org_id AND name ILIKE '%homewood%' LIMIT 1;
  SELECT id INTO v_rising_oaks_id FROM facilities WHERE organization_id = v_org_id AND name ILIKE '%rising%oaks%' LIMIT 1;
  SELECT id INTO v_plantation_id FROM facilities WHERE organization_id = v_org_id AND name ILIKE '%plantation%' LIMIT 1;
  SELECT id INTO v_grande_cypress_id FROM facilities WHERE organization_id = v_org_id AND name ILIKE '%grande%cypress%' LIMIT 1;

  -- Update facilities with last_survey_result (all 5 confirmed no citations)
  UPDATE facilities SET last_survey_result = 'no_citations'
    WHERE organization_id = v_org_id AND id IN (v_oakridge_id, v_homewood_id, v_rising_oaks_id, v_plantation_id, v_grande_cypress_id);

  -- ── BUILDING PROFILES ──────────────────────────────────────────────────────

  -- Oakridge ALF (Lafayette County)
  INSERT INTO facility_building_profiles (
    facility_id, organization_id, number_of_floors,
    fire_alarm_monitoring_company, fire_alarm_account_number,
    has_generator, generator_fuel_type, generator_service_vendor,
    shelter_in_place_capacity_days,
    electric_provider, electric_account_number, electric_phone,
    gas_provider, gas_phone
  ) VALUES (
    v_oakridge_id, v_org_id, 1,
    'Security Safe', NULL,
    true, 'propane', 'Ring Power / ACF Generator Service',
    3,
    'Duke Energy', '8956675404', '1-800-228-8485',
    'J&J Gas (LP)', '386-294-1801'
  ) ON CONFLICT (facility_id) DO NOTHING;

  -- Homewood Lodge ALF (Lafayette County)
  INSERT INTO facility_building_profiles (
    facility_id, organization_id, number_of_floors,
    fire_alarm_monitoring_company,
    has_generator, generator_fuel_type, generator_service_vendor,
    shelter_in_place_capacity_days,
    electric_provider, electric_account_number, electric_phone,
    gas_provider, gas_phone
  ) VALUES (
    v_homewood_id, v_org_id, 1,
    'Security Safe',
    true, 'propane', 'Ring Power / ACF Generator Service',
    3,
    'Duke Energy', '2450847124', '1-800-228-8485',
    'J&J Gas (LP)', '386-294-1801'
  ) ON CONFLICT (facility_id) DO NOTHING;

  -- Rising Oaks ALF (Suwannee County)
  INSERT INTO facility_building_profiles (
    facility_id, organization_id, number_of_floors,
    fire_alarm_monitoring_company,
    has_generator, generator_fuel_type, generator_service_vendor,
    shelter_in_place_capacity_days,
    electric_provider, electric_account_number, electric_phone,
    gas_provider, gas_phone
  ) VALUES (
    v_rising_oaks_id, v_org_id, 1,
    'Security Safe',
    true, 'propane', 'Ring Power / ACF Generator Service',
    3,
    'Suwannee Valley Electric', '4469400', '386-362-2226',
    'J&J Gas (LP)', '386-294-1801'
  ) ON CONFLICT (facility_id) DO NOTHING;

  -- Plantation on Summers (Columbia County)
  INSERT INTO facility_building_profiles (
    facility_id, organization_id, number_of_floors,
    fire_alarm_monitoring_company,
    has_generator, generator_fuel_type, generator_service_vendor,
    shelter_in_place_capacity_days,
    electric_provider, electric_account_number, electric_phone,
    gas_provider, gas_phone
  ) VALUES (
    v_plantation_id, v_org_id, 1,
    'Security Safe',
    true, 'propane', 'Ring Power / ACF Generator Service',
    3,
    'FPL', '05962-76253', '1-800-468-8243',
    'GW Hunter', '386-752-5890'
  ) ON CONFLICT (facility_id) DO NOTHING;

  -- Grande Cypress ALF (Columbia County)
  INSERT INTO facility_building_profiles (
    facility_id, organization_id, number_of_floors,
    fire_alarm_monitoring_company,
    has_generator, generator_fuel_type, generator_service_vendor,
    shelter_in_place_capacity_days,
    electric_provider, electric_account_number, electric_phone,
    gas_provider, gas_phone
  ) VALUES (
    v_grande_cypress_id, v_org_id, 1,
    'Security Safe',
    true, 'propane', 'Ring Power / ACF Generator Service',
    3,
    'FPL', '7787590228', '1-800-468-8243',
    'GW Hunter', '386-752-5890'
  ) ON CONFLICT (facility_id) DO NOTHING;

  -- ── EMERGENCY CONTACTS ─────────────────────────────────────────────────────
  -- Oakridge ALF
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order) VALUES
    (v_oakridge_id, v_org_id, 'county_emergency_mgmt', 'Justin Hurst — Lafayette County EM', '386-294-1950', 1),
    (v_oakridge_id, v_org_id, 'law_enforcement', 'Lafayette County Sheriff', '386-294-1301', 2),
    (v_oakridge_id, v_org_id, 'county_health_dept', 'Lafayette County Health Dept', '386-294-1321', 3),
    (v_oakridge_id, v_org_id, 'city_government', 'Town of Mayo', '386-294-1551', 4),
    (v_oakridge_id, v_org_id, 'county_bldg_zoning', 'Lafayette County Bldg & Zoning', '386-294-3611', 5),
    (v_oakridge_id, v_org_id, 'utility_electric', 'Duke Energy', '1-800-228-8485', 6),
    (v_oakridge_id, v_org_id, 'gas_provider', 'J&J Gas (LP)', '386-294-1801', 7),
    (v_oakridge_id, v_org_id, 'fire_alarm_monitoring', 'Security Safe — Greg Bolkosky', '386-365-3713', 8),
    (v_oakridge_id, v_org_id, 'hvac_emergency', 'Mayo Heat & Air — Ron Mayo', '386-294-2574', 9),
    (v_oakridge_id, v_org_id, 'generator_service', 'Ring Power — Virgil', '904-219-4906', 10),
    (v_oakridge_id, v_org_id, 'hospital', 'RHA Clinic', '386-719-9000', 11);

  -- Homewood Lodge ALF
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order) VALUES
    (v_homewood_id, v_org_id, 'county_emergency_mgmt', 'Jason Long — Lafayette County EM', '386-294-1950', 1),
    (v_homewood_id, v_org_id, 'law_enforcement', 'Lafayette County Sheriff', '386-294-1301', 2),
    (v_homewood_id, v_org_id, 'county_health_dept', 'Lafayette County Health Dept', '386-294-1321', 3),
    (v_homewood_id, v_org_id, 'city_government', 'Town of Mayo', '386-294-1551', 4),
    (v_homewood_id, v_org_id, 'county_bldg_zoning', 'Lafayette County Bldg & Zoning', '386-294-3611', 5),
    (v_homewood_id, v_org_id, 'utility_electric', 'Duke Energy', '1-800-228-8485', 6),
    (v_homewood_id, v_org_id, 'gas_provider', 'J&J Gas (LP)', '386-294-1801', 7),
    (v_homewood_id, v_org_id, 'fire_alarm_monitoring', 'Security Safe — Greg Bolkosky', '386-365-3713', 8),
    (v_homewood_id, v_org_id, 'hvac_emergency', 'Mayo Heat & Air — Ron Mayo', '386-294-2574', 9),
    (v_homewood_id, v_org_id, 'generator_service', 'Ring Power — Virgil', '904-219-4906', 10),
    (v_homewood_id, v_org_id, 'hospital', 'RHA Clinic', '386-719-9000', 11);

  -- Rising Oaks ALF
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order) VALUES
    (v_rising_oaks_id, v_org_id, 'county_emergency_mgmt', 'Chris Voyles — Suwannee County EM', '386-364-3405', 1),
    (v_rising_oaks_id, v_org_id, 'law_enforcement', 'Suwannee County Sheriff', '386-362-2222', 2),
    (v_rising_oaks_id, v_org_id, 'county_health_dept', 'Suwannee County Health Dept', '386-364-2708', 3),
    (v_rising_oaks_id, v_org_id, 'city_government', 'City of Live Oak', '386-362-2876', 4),
    (v_rising_oaks_id, v_org_id, 'county_bldg_zoning', 'Suwannee County Bldg & Zoning', '386-364-3947', 5),
    (v_rising_oaks_id, v_org_id, 'utility_electric', 'Suwannee Valley Electric', '386-362-2226', 6),
    (v_rising_oaks_id, v_org_id, 'gas_provider', 'J&J Gas (LP)', '386-294-1801', 7),
    (v_rising_oaks_id, v_org_id, 'fire_alarm_monitoring', 'Security Safe — Greg Bolkosky', '386-365-3713', 8),
    (v_rising_oaks_id, v_org_id, 'hvac_emergency', 'ACE Heat & Air — Lonnie Bucchi', '386-365-7017', 9),
    (v_rising_oaks_id, v_org_id, 'generator_service', 'Ring Power — Virgil', '904-219-4906', 10),
    (v_rising_oaks_id, v_org_id, 'hospital', 'RHA Clinic', '386-719-9000', 11);

  -- Plantation on Summers
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order) VALUES
    (v_plantation_id, v_org_id, 'county_emergency_mgmt', 'Shane Morgan — Columbia County EM', '386-758-1125', 1),
    (v_plantation_id, v_org_id, 'law_enforcement', 'Lake City Police Dept', '386-752-4344', 2),
    (v_plantation_id, v_org_id, 'county_health_dept', 'Columbia County Health Dept', '386-758-1068', 3),
    (v_plantation_id, v_org_id, 'city_government', 'City of Lake City', '386-752-2031', 4),
    (v_plantation_id, v_org_id, 'county_bldg_zoning', 'Columbia County Bldg & Zoning', '386-758-1008', 5),
    (v_plantation_id, v_org_id, 'utility_electric', 'FPL', '1-800-468-8243', 6),
    (v_plantation_id, v_org_id, 'gas_provider', 'GW Hunter', '386-752-5890', 7),
    (v_plantation_id, v_org_id, 'fire_alarm_monitoring', 'Security Safe — Greg Bolkosky', '386-365-3713', 8),
    (v_plantation_id, v_org_id, 'hvac_emergency', 'ACE Heat & Air — Lonnie Bucchi', '386-365-7017', 9),
    (v_plantation_id, v_org_id, 'generator_service', 'Ring Power — Virgil', '904-219-4906', 10),
    (v_plantation_id, v_org_id, 'hospital', 'RHA Clinic', '386-719-9000', 11);

  -- Grande Cypress ALF
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order) VALUES
    (v_grande_cypress_id, v_org_id, 'county_emergency_mgmt', 'Shane Morgan — Columbia County EM', '386-758-1125', 1),
    (v_grande_cypress_id, v_org_id, 'law_enforcement', 'Columbia County Sheriff', '386-752-9212', 2),
    (v_grande_cypress_id, v_org_id, 'fire_department', 'Columbia County Fire Dept', '386-754-7063', 3),
    (v_grande_cypress_id, v_org_id, 'county_health_dept', 'Columbia County Health Dept', '386-758-1068', 4),
    (v_grande_cypress_id, v_org_id, 'city_government', 'City of Lake City', '386-752-2031', 5),
    (v_grande_cypress_id, v_org_id, 'county_bldg_zoning', 'Columbia County Bldg & Zoning', '386-758-1008', 6),
    (v_grande_cypress_id, v_org_id, 'utility_electric', 'FPL', '1-800-468-8243', 7),
    (v_grande_cypress_id, v_org_id, 'gas_provider', 'GW Hunter', '386-752-5890', 8),
    (v_grande_cypress_id, v_org_id, 'fire_alarm_monitoring', 'Security Safe — Greg Bolkosky', '386-365-3713', 9),
    (v_grande_cypress_id, v_org_id, 'hvac_emergency', 'ACE Heat & Air — Lonnie Bucchi', '386-365-7017', 10),
    (v_grande_cypress_id, v_org_id, 'generator_service', 'Ring Power — Virgil', '904-219-4906', 11),
    (v_grande_cypress_id, v_org_id, 'hospital', 'RHA Clinic', '386-719-9000', 12);

  -- ── SHARED VENDOR CONTACTS (all facilities) ────────────────────────────────
  -- These are corporate-level vendors used across facilities
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, phone_secondary, sort_order)
  SELECT f.id, v_org_id, cat, v.contact_label, phone1, phone2, srt
  FROM facilities f
  CROSS JOIN (VALUES
    ('electric_maintenance', 'Rainbolt Tech — Micah', '386-623-5801', '386-867-7878', 20),
    ('plumbing_emergency', 'Suwannee Valley Plumbing — Ron', '386-287-0250', NULL, 21),
    ('plumbing_emergency', 'Wolfe Plumbing — Scott', '386-935-0616', NULL, 22),
    ('plumbing_emergency', 'Hometown Plumbing — Don', '386-754-6140', NULL, 23),
    ('roofing', 'Keeler Roofing — Ben', '352-514-4930', '352-870-5247', 24),
    ('other', 'Caribbean Fire & Security (Sprinkler) — Michael Vidal', '239-280-8925', NULL, 25),
    ('other', 'Sam Santiago Sprinkler System', '386-266-7385', NULL, 26),
    ('generator_service', 'ACF Generator Service', '813-621-9671', NULL, 27)
  ) AS v(cat, contact_label, phone1, phone2, srt)
  WHERE f.organization_id = v_org_id
    AND f.id IN (v_oakridge_id, v_homewood_id, v_rising_oaks_id, v_plantation_id, v_grande_cypress_id);

  -- ── TRANSPORT VENDORS (all facilities) ─────────────────────────────────────
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, sort_order)
  SELECT f.id, v_org_id, 'transport', v.contact_label, v.phone_num, srt
  FROM facilities f
  CROSS JOIN (VALUES
    ('Alternative Transport — Kathy', '386-209-2770', 30),
    ('Jackson Transport — John', '386-697-5513', 31),
    ('Parrish Medivan — Hanah', '386-361-0712', 32),
    ('Peeler Transport — Carlene', '386-365-8999', 33),
    ('D''s Transport — Lavern', '912-266-2633', 34)
  ) AS v(contact_label, phone_num, srt)
  WHERE f.organization_id = v_org_id
    AND f.id IN (v_oakridge_id, v_homewood_id, v_rising_oaks_id, v_plantation_id, v_grande_cypress_id);

  -- Lafayette-only transport
  INSERT INTO facility_emergency_contacts (facility_id, organization_id, contact_category, contact_name, phone_primary, notes, sort_order)
  SELECT f.id, v_org_id, 'transport', 'Robbie Edwards — Lafayette County', '386-854-0281', 'Lafayette County facilities ONLY', 35
  FROM facilities f
  WHERE f.id IN (v_oakridge_id, v_homewood_id);

  -- ── OPERATIONAL THRESHOLDS (default for all 5) ─────────────────────────────
  INSERT INTO facility_operational_thresholds (facility_id, organization_id, threshold_type, yellow_threshold, red_threshold, notify_roles)
  SELECT f.id, v_org_id, t.threshold_type, t.yellow_val, t.red_val, t.roles
  FROM facilities f
  CROSS JOIN (VALUES
    ('occupancy_low_pct',              80,    70,  ARRAY['owner', 'org_admin']),
    ('occupancy_high_pct',             95,    98,  ARRAY['owner', 'org_admin']),
    ('license_expiry_days',            60,    30,  ARRAY['owner', 'org_admin', 'facility_admin']),
    ('insurance_expiry_days',          90,    30,  ARRAY['owner', 'org_admin']),
    ('document_expiry_days',           60,    30,  ARRAY['owner', 'org_admin']),
    ('background_check_expiry_days',   30,     0,  ARRAY['owner', 'org_admin', 'facility_admin']),
    ('training_overdue_days',          14,     0,  ARRAY['owner', 'org_admin', 'facility_admin']),
    ('fire_drill_overdue_days',        70,    60,  ARRAY['owner', 'org_admin', 'facility_admin']),
    ('elopement_drill_overdue_days',  200,   180,  ARRAY['owner', 'org_admin', 'facility_admin']),
    ('incident_spike_count',            5,    10,  ARRAY['owner', 'org_admin']),
    ('census_change_alert',             3,     5,  ARRAY['owner', 'org_admin'])
  ) AS t(threshold_type, yellow_val, red_val, roles)
  WHERE f.organization_id = v_org_id
    AND f.id IN (v_oakridge_id, v_homewood_id, v_rising_oaks_id, v_plantation_id, v_grande_cypress_id)
  ON CONFLICT (facility_id, threshold_type) DO NOTHING;

  -- ── COMMUNICATION SETTINGS (defaults for all 5) ────────────────────────────
  INSERT INTO facility_communication_settings (facility_id, organization_id)
  SELECT f.id, v_org_id
  FROM facilities f
  WHERE f.organization_id = v_org_id
    AND f.id IN (v_oakridge_id, v_homewood_id, v_rising_oaks_id, v_plantation_id, v_grande_cypress_id)
  ON CONFLICT (facility_id) DO NOTHING;

END $$;

-- ============================================================================
-- 13. SUPABASE STORAGE BUCKET for facility documents
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'facility-documents',
  'facility-documents',
  false,
  26214400, -- 25MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
) ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only org members with facility access can read/write
CREATE POLICY storage_fd_select ON storage.objects FOR SELECT USING (
  bucket_id = 'facility-documents'
  AND (storage.foldername(name))[1]::uuid IN (SELECT haven.accessible_facility_ids())
);

CREATE POLICY storage_fd_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'facility-documents'
  AND haven.app_role() IN ('owner', 'org_admin')
  AND (storage.foldername(name))[1]::uuid IN (SELECT haven.accessible_facility_ids())
);

CREATE POLICY storage_fd_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'facility-documents'
  AND haven.app_role() IN ('owner', 'org_admin')
);
