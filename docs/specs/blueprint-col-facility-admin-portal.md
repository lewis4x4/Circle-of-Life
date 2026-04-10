# Blueprint: Facility Admin Portal

**blueprint_id:** blueprint-col-facility-admin-portal-2026-04-10
**spec_reference:** docs/specs/17-entity-facility-finance.md, HAVEN-COL-TECHNICAL-HANDOFF.md
**client_id:** circle-of-life
**status:** DRAFT
**version:** 1.0
**created:** 2026-04-10
**last_updated:** 2026-04-10

---

## Architecture Summary

The Facility Admin Portal is a centralized configuration hub at `/admin/facilities/` where owner/org_admin users manage every operational dimension of each ALF location — licensing, rates, staffing config, vendor assignments, emergency contacts, physical plant, compliance calendars, insurance, documents, and operational thresholds. Facility admins get read-only access with limited write permissions on day-to-day operational fields. The portal consolidates data that currently lives across 12+ tables into a single, tabbed interface with real-time validation, effective-dated rate scheduling, document vault with expiration tracking, and a full audit trail. Every field change is logged, and expiration-sensitive fields (licenses, insurance, certifications) drive automated alerts to the compliance engine.

---

## System Context

**Affected services:** facilities, entities, rate_schedules, beds/rooms/units, facility_ratio_rules, insurance_policies, vendors, vendor_facilities, compliance dashboard, billing engine, staff management, family portal settings
**New services:** facility_audit_log (new table), facility_documents (new table), facility_emergency_contacts (new table), facility_utility_accounts (new table), facility_operational_thresholds (new table), rate_schedule_history (new table)
**Service boundaries:** This portal OWNS facility-level configuration. It DELEGATES resident-level data to care modules, financial transactions to Module 17 GL, and staff records to Module 11. It FEEDS configuration into billing (rate schedules), compliance (license expirations, drill calendars), and staffing (ratio rules).
**Dependency map:**
- Upstream: organizations, entities (must exist before facility)
- Downstream: billing engine (reads rate_schedules), compliance engine (reads license/insurance expirations), staffing module (reads ratio rules), family portal (reads visitation/communication settings), incident reporting (reads emergency contacts)

---

## What You Asked For vs What You're Missing

### Brian's List (✅ Covered)
1. AHCA license numbers & expirations
2. Pharmacy vendor & phone
3. Facility address & phone
4. Default rates with change capability
5. Care type selection (Standard ALF / Enhanced ALF Services)
6. Role-gated access (admin/management/owner only)

### What You're Missing (🚀 Moonshot Additions)

**Licensing & Compliance**
7. **Survey history timeline** — Every AHCA survey date, result, citations, POC status. Not just "current license" but the full regulatory history. When AHCA walks in, your administrator pulls up Homewood and sees every survey going back to opening day.
8. **License renewal countdown** — Auto-calculated days-to-expiration with YELLOW (60 days) and RED (30 days) alerts pushed to the compliance dashboard.
9. **Compliance calendar per facility** — Fire drill schedule (every 2 months), elopement drills (every 6 months), training deadlines, all auto-generated from facility creation date and configurable per site.

**Rate Management**
10. **Effective-dated rate schedules** — Not just "the current rate" but rate tables with effective_from/effective_to dates. When rates change July 1, you enter the new rate with a future effective date. Billing engine auto-switches. Old rates preserved for historical invoices and Medicaid reconciliation.
11. **Rate type matrix** — Private room, semi-private room, respite (daily), second occupant discount, community fee, admission fee, pet fee — all configurable per facility because Plantation charges different rates than Oakridge.
12. **Medicaid rate tracking** — OSS (Optional State Supplementation) rate per facility, Medicaid co-pay calculation formula, payer mix targets.

**Physical Plant**
13. **Building profile** — Year built, last renovation, square footage, number of wings/units, fire suppression type (sprinkler/extinguisher), generator (Y/N + fuel type + last test date), ADA compliance notes. Insurance underwriters ask for this. AHCA asks for this. You should have it in one place.
14. **Bed/unit configuration** — Visual bed map: Wing → Unit → Room → Bed with status (available/occupied/hold/maintenance/offline). This is the census engine. Occupancy % auto-calculates from this, not from a manually entered number.
15. **Kitchen license & dietary config** — Kitchen inspection dates, food service license number, meal times (breakfast/lunch/dinner/snack), dietary accommodation capabilities (diabetic, low sodium, pureed, mechanical soft, thickened liquids). AHCA surveys this.

**Emergency & Safety**
16. **Emergency contact directory per facility** — Local PD (Lafayette County Sheriff vs Lake City PD — varies by county), fire department, nearest hospital + distance/drive time, poison control, utility provider emergency line, AHCA survey hotline. Pre-populated from county but editable.
17. **Storm preparedness config** — Generator status, evacuation facility partner, evacuation transport capacity, shelter-in-place supply levels, emergency food/water stockpile expiration dates. You already have a Storm Preparedness document — this digitizes it per facility.
18. **Elopement risk config** — Door alarm system type, perimeter description, search area map upload, local law enforcement direct line, nearest crossroads for 911 dispatch.

**Vendors**
19. **Full vendor roster per facility** — Not just pharmacy. Medical supplies, laundry service, pest control, waste management, elevator maintenance, fire alarm monitoring, HVAC service, landscaping. Each with contract dates, account numbers, emergency contact, and renewal alerts.
20. **Pharmacy deep config** — Delivery schedule (daily? M/W/F?), after-hours emergency phone, e-prescribing integration status, controlled substance delivery protocol, return/destruction pickup schedule.

**Insurance**
21. **Insurance policy dashboard per entity** — GL, property, workers comp, auto, umbrella, professional liability, cyber, EPLI, D&O. Policy number, carrier, effective dates, premium, limits, deductibles, agent contact. Auto-alerts at 90/60/30 days before expiration. This is per ENTITY (not per facility) because COL's 5 entities each have separate policies.

**Staffing Configuration**
22. **Staffing ratio rules per facility** — Required staff-to-resident ratios by shift (day/evening/night), by role (CNA, med tech, dietary). Florida requires specific minimums — this enforces them and feeds the scheduling module.
23. **Administrator & key personnel assignments** — Who is the administrator, assistant admin, dietary manager, activities director for THIS facility. With effective dates so you track when Jackie took over Homewood.
24. **On-call rotation config** — Corporate maintenance on-call, facility administrator on-call, nursing on-call. Phone numbers and escalation order.

**Documents**
25. **Document vault per facility** — Upload and manage: AHCA license copy, fire inspection certificate, elevator inspection, kitchen license, insurance certificates, survey reports, POC responses, resident handbook, employee handbook. Each with upload date, expiration date (if applicable), uploaded by, and document category tags. Expiring documents trigger compliance alerts.

**Operational Thresholds & Alerts**
26. **Configurable alert thresholds** — Occupancy below X% → alert owner. Staffing ratio violated → alert administrator. License expiring within X days → alert compliance. Insurance expiring → alert CFO. These are per-facility and editable by owner/org_admin.
27. **Occupancy targets** — Target occupancy % (not just current). Variance tracking. Waitlist count. Marketing referral pipeline integration point.

**Communication & Family Portal**
28. **Visitation policy per facility** — Visiting hours, check-in requirements, restricted areas, COVID/illness screening rules. Displayed on family portal.
29. **Family communication settings** — What incident types auto-notify families, message approval workflow, photo sharing permissions, care plan update notifications.

**Reputation & Marketing**
30. **Online presence links** — Google Business Profile URL, Yelp listing, Caring.com profile, Facebook page. Feed into Module 23 reputation monitoring.
31. **Marketing collateral config** — Facility photos (hero, rooms, dining, activities), tagline, key differentiators, tour availability schedule.

**Audit & History**
32. **Full audit log** — Every field change on the facility record: who changed it, when, old value, new value. Filterable by field, user, date range. Exportable for compliance audits.
33. **Facility timeline** — Major events: opening date, ownership changes, renovations, AHCA surveys, administrator changes, license renewals, insurance renewals. A chronological story of the facility.

---

## Data Model

### New Tables

```sql
-- ============================================================================
-- 1. FACILITY EMERGENCY CONTACTS
-- One-to-many: each facility has multiple emergency contacts by category
-- ============================================================================
CREATE TABLE facility_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  contact_category TEXT NOT NULL CHECK (contact_category IN (
    'law_enforcement', 'fire_department', 'hospital', 'poison_control',
    'utility_electric', 'utility_water', 'utility_gas', 'utility_internet',
    'ahca_hotline', 'ombudsman', 'dcf_abuse_hotline', 'osha',
    'evacuation_partner', 'corporate_on_call', 'facility_on_call',
    'pharmacy_after_hours', 'elevator_service', 'fire_alarm_monitoring',
    'generator_service', 'hvac_emergency', 'plumbing_emergency',
    'locksmith', 'other'
  )),
  contact_name TEXT NOT NULL,
  phone_primary TEXT NOT NULL,
  phone_secondary TEXT,
  address TEXT,
  distance_miles NUMERIC(5,1),
  drive_time_minutes INTEGER,
  account_number TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fec_facility ON facility_emergency_contacts(facility_id) WHERE deleted_at IS NULL;
-- Justification: filtered lookup by facility on emergency contact pages and incident response

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
-- 2. FACILITY DOCUMENTS (Document Vault)
-- Upload, categorize, and track expiration of facility-level documents
-- ============================================================================
CREATE TABLE facility_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  document_category TEXT NOT NULL CHECK (document_category IN (
    'ahca_license', 'fire_inspection', 'elevator_inspection',
    'kitchen_license', 'insurance_certificate', 'survey_report',
    'poc_response', 'resident_handbook', 'employee_handbook',
    'building_permit', 'occupancy_certificate', 'generator_inspection',
    'backflow_prevention', 'fire_alarm_inspection', 'sprinkler_inspection',
    'pest_control_report', 'water_quality_report', 'radon_test',
    'ada_compliance', 'evacuation_plan', 'floor_plan',
    'photo_hero', 'photo_room', 'photo_dining', 'photo_activity',
    'vendor_contract', 'other'
  )),
  document_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type TEXT,
  expiration_date DATE,
  -- Alert thresholds: days before expiration to trigger YELLOW/RED
  alert_yellow_days INTEGER NOT NULL DEFAULT 60,
  alert_red_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fd_facility ON facility_documents(facility_id) WHERE deleted_at IS NULL;
-- Justification: document vault listing per facility
CREATE INDEX idx_fd_expiration ON facility_documents(expiration_date) WHERE deleted_at IS NULL AND expiration_date IS NOT NULL;
-- Justification: compliance engine scans for expiring documents across all facilities

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
-- 3. RATE SCHEDULE HISTORY (Effective-Dated Rate Management)
-- Replaces single-value rate fields with time-series rate table
-- ============================================================================
CREATE TABLE rate_schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  rate_type TEXT NOT NULL CHECK (rate_type IN (
    'private_room', 'semi_private_room', 'respite_daily',
    'second_occupant', 'community_fee', 'admission_fee',
    'pet_fee_monthly', 'medicaid_oss', 'enhanced_alf_surcharge'
  )),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE, -- NULL = currently active
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  -- Prevent overlapping date ranges for same facility + rate_type
  CONSTRAINT no_overlapping_rates EXCLUDE USING gist (
    facility_id WITH =,
    rate_type WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (deleted_at IS NULL)
);

CREATE INDEX idx_rsv_facility_active ON rate_schedule_versions(facility_id, rate_type, effective_from)
  WHERE deleted_at IS NULL;
-- Justification: billing engine lookups — "what is the private_room rate for facility X on invoice date Y?"
CREATE INDEX idx_rsv_current ON rate_schedule_versions(facility_id, rate_type)
  WHERE deleted_at IS NULL AND effective_to IS NULL;
-- Justification: fast lookup of current active rates for facility config display

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
-- 4. FACILITY OPERATIONAL THRESHOLDS (Alert Configuration)
-- Per-facility configurable alert thresholds
-- ============================================================================
CREATE TABLE facility_operational_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  threshold_type TEXT NOT NULL CHECK (threshold_type IN (
    'occupancy_low_pct', 'occupancy_high_pct',
    'staffing_ratio_violation', 'license_expiry_days',
    'insurance_expiry_days', 'document_expiry_days',
    'background_check_expiry_days', 'training_overdue_days',
    'fire_drill_overdue_days', 'elopement_drill_overdue_days',
    'incident_spike_count', 'census_change_alert'
  )),
  yellow_threshold NUMERIC NOT NULL,
  red_threshold NUMERIC NOT NULL,
  notify_roles TEXT[] NOT NULL DEFAULT ARRAY['owner', 'org_admin'],
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (facility_id, threshold_type)
);

CREATE INDEX idx_fot_facility ON facility_operational_thresholds(facility_id) WHERE enabled = true;
-- Justification: compliance engine evaluates thresholds per facility on heartbeat

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
-- 5. FACILITY AUDIT LOG
-- Immutable append-only log of every configuration change
-- ============================================================================
CREATE TABLE facility_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  field_name TEXT, -- NULL for INSERT/DELETE, specific field for UPDATE
  old_value JSONB,
  new_value JSONB,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_fal_facility_time ON facility_audit_log(facility_id, changed_at DESC);
-- Justification: audit log viewer filtered by facility, sorted newest first
CREATE INDEX idx_fal_record ON facility_audit_log(table_name, record_id);
-- Justification: "show me all changes to this specific record"

ALTER TABLE facility_audit_log ENABLE ROW LEVEL SECURITY;

-- Audit log is append-only. No UPDATE or DELETE policies.
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
-- 6. FACILITY SURVEY HISTORY
-- AHCA survey results, citations, POC tracking
-- ============================================================================
CREATE TABLE facility_survey_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  survey_date DATE NOT NULL,
  survey_type TEXT NOT NULL CHECK (survey_type IN (
    'annual', 'complaint', 'follow_up', 'change_of_ownership', 'initial', 'abbreviated'
  )),
  result TEXT NOT NULL CHECK (result IN (
    'no_citations', 'citations_issued', 'immediate_jeopardy', 'conditional'
  )),
  citation_count INTEGER NOT NULL DEFAULT 0,
  citation_details JSONB, -- Array of {tag, description, severity, poc_due_date, poc_status}
  poc_submitted_date DATE,
  poc_accepted_date DATE,
  surveyor_names TEXT[],
  document_id UUID REFERENCES facility_documents(id), -- Link to uploaded survey report
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fsh_facility ON facility_survey_history(facility_id, survey_date DESC)
  WHERE deleted_at IS NULL;
-- Justification: compliance timeline view sorted newest first

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
-- 7. FACILITY BUILDING PROFILE
-- Physical plant details — insurance, AHCA, safety
-- ============================================================================
CREATE TABLE facility_building_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  year_built INTEGER CHECK (year_built >= 1900 AND year_built <= 2100),
  last_renovation_year INTEGER,
  square_footage INTEGER,
  number_of_floors INTEGER NOT NULL DEFAULT 1,
  number_of_wings INTEGER,
  construction_type TEXT CHECK (construction_type IN (
    'wood_frame', 'masonry', 'steel_frame', 'concrete', 'mixed'
  )),
  -- Fire & Safety
  fire_suppression_type TEXT CHECK (fire_suppression_type IN (
    'full_sprinkler', 'partial_sprinkler', 'extinguisher_only', 'none'
  )),
  fire_alarm_monitoring_company TEXT,
  fire_alarm_account_number TEXT,
  last_fire_inspection_date DATE,
  next_fire_inspection_date DATE,
  -- Generator
  has_generator BOOLEAN NOT NULL DEFAULT false,
  generator_fuel_type TEXT CHECK (generator_fuel_type IN ('diesel', 'natural_gas', 'propane', 'dual_fuel')),
  generator_capacity_kw INTEGER,
  generator_last_test_date DATE,
  generator_next_service_date DATE,
  -- Kitchen
  kitchen_license_number TEXT,
  kitchen_license_expiration DATE,
  last_kitchen_inspection_date DATE,
  meal_times JSONB DEFAULT '{"breakfast": "07:30", "lunch": "12:00", "dinner": "17:30", "snack_am": "10:00", "snack_pm": "14:30", "snack_evening": "19:30"}'::jsonb,
  dietary_capabilities TEXT[] DEFAULT ARRAY['regular', 'diabetic', 'low_sodium', 'pureed', 'mechanical_soft', 'thickened_liquids'],
  -- Elevator
  has_elevator BOOLEAN NOT NULL DEFAULT false,
  elevator_inspection_date DATE,
  elevator_service_company TEXT,
  -- ADA
  ada_compliant BOOLEAN NOT NULL DEFAULT true,
  ada_notes TEXT,
  -- Parking
  parking_spaces INTEGER,
  handicap_spaces INTEGER,
  -- Elopement prevention
  door_alarm_system TEXT,
  perimeter_description TEXT,
  wander_guard_system TEXT,
  nearest_crossroads TEXT, -- For 911 dispatch
  -- Storm preparedness
  evacuation_partner_facility TEXT,
  evacuation_transport_capacity INTEGER,
  shelter_in_place_capacity_days INTEGER DEFAULT 3,
  emergency_water_supply_gallons INTEGER,
  emergency_food_supply_expiration DATE,
  --
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- No index needed beyond PK + unique(facility_id) — 1:1 relationship, always looked up by facility

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
-- 8. FACILITY COMMUNICATION SETTINGS
-- Family portal, notifications, visitation
-- ============================================================================
CREATE TABLE facility_communication_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  -- Visitation
  visiting_hours_start TIME DEFAULT '09:00',
  visiting_hours_end TIME DEFAULT '20:00',
  visitor_check_in_required BOOLEAN NOT NULL DEFAULT true,
  visitor_screening_enabled BOOLEAN NOT NULL DEFAULT false,
  restricted_areas TEXT[],
  -- Family notifications
  auto_notify_incident_types TEXT[] DEFAULT ARRAY['falls', 'elopement', 'hospitalization', 'death'],
  care_plan_update_notifications BOOLEAN NOT NULL DEFAULT true,
  photo_sharing_enabled BOOLEAN NOT NULL DEFAULT true,
  message_approval_required BOOLEAN NOT NULL DEFAULT false,
  -- Marketing
  google_business_profile_url TEXT,
  yelp_listing_url TEXT,
  caring_com_profile_url TEXT,
  facebook_page_url TEXT,
  facility_tagline TEXT,
  key_differentiators TEXT[],
  tour_available_days TEXT[] DEFAULT ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  tour_available_hours_start TIME DEFAULT '10:00',
  tour_available_hours_end TIME DEFAULT '16:00',
  --
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
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

-- facility_admin can update visitation and family notification settings only
CREATE POLICY fcs_facility_admin_update ON facility_communication_settings
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() = 'facility_admin'
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- 9. FACILITY TIMELINE EVENTS
-- Chronological major events for institutional memory
-- ============================================================================
CREATE TABLE facility_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'opened', 'ownership_change', 'administrator_change', 'renovation',
    'survey', 'license_renewal', 'insurance_renewal', 'capacity_change',
    'vendor_change', 'rate_change', 'policy_change', 'incident_major',
    'recognition', 'other'
  )),
  title TEXT NOT NULL,
  description TEXT,
  document_id UUID REFERENCES facility_documents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fte_facility ON facility_timeline_events(facility_id, event_date DESC)
  WHERE deleted_at IS NULL;
-- Justification: timeline view sorted newest first

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
```

### Modified Tables

```sql
-- facilities table: add new columns for enhanced config
-- (Some already added by migration 101; these are the remaining gaps)

-- Add care_services_type to replace ambiguous license_type for UI display
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS care_services_offered TEXT[]
  DEFAULT ARRAY['standard_alf'];
-- Valid values: 'standard_alf', 'enhanced_alf_services', 'respite_care', 'adult_day_services'
-- NEVER 'memory_care' — COL uses 'enhanced_alf_services' for compliance reasons

-- Add operational metadata
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS opening_date DATE;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS current_administrator_id UUID REFERENCES auth.users(id);
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS waitlist_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS target_occupancy_pct NUMERIC(4,2) DEFAULT 0.95;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS last_survey_date DATE;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS last_survey_result TEXT CHECK (last_survey_result IN (
  'no_citations', 'citations_issued', 'immediate_jeopardy', 'conditional'
));

-- entities table: add insurance tracking fields
ALTER TABLE entities ADD COLUMN IF NOT EXISTS registered_agent_name TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS sunbiz_document_number TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS formation_date DATE;
```

### Rollback DDL

```sql
-- Reverse in dependency order (children first)
DROP POLICY IF EXISTS fte_manage ON facility_timeline_events;
DROP POLICY IF EXISTS fte_select ON facility_timeline_events;
DROP INDEX IF EXISTS idx_fte_facility;
DROP TABLE IF EXISTS facility_timeline_events;

DROP POLICY IF EXISTS fcs_facility_admin_update ON facility_communication_settings;
DROP POLICY IF EXISTS fcs_manage ON facility_communication_settings;
DROP POLICY IF EXISTS fcs_select ON facility_communication_settings;
DROP TABLE IF EXISTS facility_communication_settings;

DROP POLICY IF EXISTS fbp_manage ON facility_building_profiles;
DROP POLICY IF EXISTS fbp_select ON facility_building_profiles;
DROP TABLE IF EXISTS facility_building_profiles;

DROP POLICY IF EXISTS fsh_manage ON facility_survey_history;
DROP POLICY IF EXISTS fsh_select ON facility_survey_history;
DROP INDEX IF EXISTS idx_fsh_facility;
DROP TABLE IF EXISTS facility_survey_history;

DROP POLICY IF EXISTS fal_insert ON facility_audit_log;
DROP POLICY IF EXISTS fal_select ON facility_audit_log;
DROP INDEX IF EXISTS idx_fal_record;
DROP INDEX IF EXISTS idx_fal_facility_time;
DROP TABLE IF EXISTS facility_audit_log;

DROP POLICY IF EXISTS fot_manage ON facility_operational_thresholds;
DROP POLICY IF EXISTS fot_select ON facility_operational_thresholds;
DROP INDEX IF EXISTS idx_fot_facility;
DROP TABLE IF EXISTS facility_operational_thresholds;

DROP POLICY IF EXISTS rsv_manage ON rate_schedule_versions;
DROP POLICY IF EXISTS rsv_select ON rate_schedule_versions;
DROP INDEX IF EXISTS idx_rsv_current;
DROP INDEX IF EXISTS idx_rsv_facility_active;
DROP TABLE IF EXISTS rate_schedule_versions;

DROP POLICY IF EXISTS fd_manage ON facility_documents;
DROP POLICY IF EXISTS fd_select ON facility_documents;
DROP INDEX IF EXISTS idx_fd_expiration;
DROP INDEX IF EXISTS idx_fd_facility;
DROP TABLE IF EXISTS facility_documents;

DROP POLICY IF EXISTS fec_manage ON facility_emergency_contacts;
DROP POLICY IF EXISTS fec_select ON facility_emergency_contacts;
DROP INDEX IF EXISTS idx_fec_facility;
DROP TABLE IF EXISTS facility_emergency_contacts;

-- Reverse column additions
ALTER TABLE facilities DROP COLUMN IF EXISTS care_services_offered;
ALTER TABLE facilities DROP COLUMN IF EXISTS opening_date;
ALTER TABLE facilities DROP COLUMN IF EXISTS current_administrator_id;
ALTER TABLE facilities DROP COLUMN IF EXISTS waitlist_count;
ALTER TABLE facilities DROP COLUMN IF EXISTS target_occupancy_pct;
ALTER TABLE facilities DROP COLUMN IF EXISTS last_survey_date;
ALTER TABLE facilities DROP COLUMN IF EXISTS last_survey_result;

ALTER TABLE entities DROP COLUMN IF EXISTS registered_agent_name;
ALTER TABLE entities DROP COLUMN IF EXISTS sunbiz_document_number;
ALTER TABLE entities DROP COLUMN IF EXISTS formation_date;
```

### Migration Strategy

- **Order of operations:** (1) ALTER TABLE facilities/entities for new columns, (2) Create independent tables in any order (no cross-FKs except facility_documents referenced by facility_survey_history and facility_timeline_events), (3) Create facility_audit_log last (it references all other tables conceptually), (4) Seed default operational thresholds for existing 5 facilities, (5) Seed emergency contacts from county data
- **Backfill required:** Yes — seed `facility_operational_thresholds` with default values for all 5 existing facilities. Seed `facility_building_profiles` with known data from Storm Preparedness doc. Seed `facility_emergency_contacts` from county-specific emergency numbers.
- **Backward compatible:** Yes — all new columns are nullable or have defaults. New tables don't affect existing queries.

---

## API Design

### Endpoints

**GET /api/admin/facilities**
- **Purpose:** List all facilities the user can access, with summary stats (occupancy, census, alert count)
- **Authentication:** Any admin-eligible role
- **Response (success):**
```json
{
  "facilities": [
    {
      "id": "uuid",
      "name": "string",
      "status": "active|inactive|under_renovation|archived",
      "licensed_beds": 52,
      "occupied_beds": 49,
      "occupancy_pct": 0.94,
      "administrator_name": "string",
      "city": "string",
      "county": "string",
      "alert_count": { "red": 0, "yellow": 2 },
      "last_survey_result": "no_citations",
      "entity_name": "string"
    }
  ]
}
```
- **Response (errors):**
  - `401` — Not authenticated
  - `403` — Role not admin-eligible

**GET /api/admin/facilities/:id**
- **Purpose:** Full facility detail with all tabs' data
- **Authentication:** admin-eligible role + facility access
- **Request query params:** `?tab=overview|licensing|rates|building|emergency|vendors|documents|staffing|communication|thresholds|audit|timeline`
- **Response (success):** Tab-specific payload (see Frontend Architecture for tab breakdown)
- **Response (errors):**
  - `401` — Not authenticated
  - `403` — No access to this facility
  - `404` — Facility not found

**PUT /api/admin/facilities/:id**
- **Purpose:** Update facility core fields
- **Authentication:** owner, org_admin
- **Request:**
```json
{
  "name": "string — optional",
  "phone": "string — optional",
  "address_line_1": "string — optional",
  "care_services_offered": "string[] — optional",
  "pharmacy_vendor": "string — optional",
  "target_occupancy_pct": "number — optional",
  "current_administrator_id": "uuid — optional"
}
```
- **Response (success):** Updated facility object
- **Response (errors):**
  - `400` — Invalid field values
  - `401` — Not authenticated
  - `403` — Role insufficient (must be owner/org_admin)
  - `404` — Facility not found
  - `422` — Validation failure (e.g., invalid care_services_offered value)

**POST /api/admin/facilities/:id/rates**
- **Purpose:** Create new rate schedule version with effective date
- **Authentication:** owner, org_admin
- **Request:**
```json
{
  "rate_type": "private_room|semi_private_room|respite_daily|...",
  "amount_cents": 550000,
  "effective_from": "2026-07-01",
  "notes": "string — optional"
}
```
- **Response (success):** Created rate version (system auto-closes previous version's effective_to)
- **Response (errors):**
  - `400` — Missing required fields
  - `403` — Role insufficient
  - `409` — Overlapping date range conflict
  - `422` — Invalid rate_type or negative amount

**POST /api/admin/facilities/:id/documents**
- **Purpose:** Upload facility document
- **Authentication:** owner, org_admin
- **Request:** multipart/form-data with file + metadata
- **Response (success):** Created document record with file_path
- **Response (errors):**
  - `400` — Missing file or category
  - `403` — Role insufficient
  - `413` — File too large (limit: 25MB)
  - `415` — Unsupported file type

**GET /api/admin/facilities/:id/audit-log**
- **Purpose:** Paginated audit log for facility
- **Authentication:** owner, org_admin only
- **Request query params:** `?field=&user_id=&from=&to=&page=&per_page=`
- **Response (success):** Paginated audit entries
- **Response (errors):**
  - `401` — Not authenticated
  - `403` — Must be owner/org_admin

**PUT /api/admin/facilities/:id/building-profile**
- **Purpose:** Update building profile
- **Authentication:** owner, org_admin
- **Response (errors):**
  - `403` — Role insufficient
  - `404` — Facility not found

**PUT /api/admin/facilities/:id/communication-settings**
- **Purpose:** Update communication/visitation settings
- **Authentication:** owner, org_admin, facility_admin (facility_admin limited to visitation + notification fields)
- **Response (errors):**
  - `403` — Role insufficient or attempting to modify marketing fields as facility_admin

**CRUD /api/admin/facilities/:id/emergency-contacts**
- **Purpose:** Manage emergency contacts for facility
- **Authentication:** owner, org_admin
- Standard CRUD responses

**CRUD /api/admin/facilities/:id/surveys**
- **Purpose:** Manage survey history records
- **Authentication:** owner, org_admin
- Standard CRUD responses

**CRUD /api/admin/facilities/:id/thresholds**
- **Purpose:** Manage operational alert thresholds
- **Authentication:** owner, org_admin
- Standard CRUD responses

**CRUD /api/admin/facilities/:id/timeline**
- **Purpose:** Manage facility timeline events
- **Authentication:** owner, org_admin
- Standard CRUD responses

### Edge Functions

**Function: facility-expiration-scanner**
- **Trigger:** Scheduled — runs daily at 06:00 ET
- **Logic summary:** Scans facility_documents, insurance_policies, rate_schedule_versions, and facilities (AHCA license expiration) for items approaching or past expiration. Compares against facility_operational_thresholds. Generates alerts/notifications for items in yellow or red zones.
- **Input validation:** N/A (scheduled, no user input)
- **Error handling:** Logs failures to edge function logs. Sends Slack/email alert to owner if scan itself fails.

**Function: facility-audit-trigger**
- **Trigger:** Database trigger on INSERT/UPDATE/DELETE for all facility config tables
- **Logic summary:** Captures old/new row values, extracts changed fields, writes to facility_audit_log. Uses `auth.uid()` for changed_by.
- **Input validation:** Trigger-based — always has valid row context
- **Error handling:** If audit write fails, the triggering transaction still succeeds (audit is non-blocking) but failure is logged.

---

## Frontend Architecture

### New Components

```
app/(admin)/admin/facilities/
  ├── page.tsx                        — Facility list/grid view (card per facility with health indicators)
  └── [facilityId]/
      ├── page.tsx                    — Facility detail shell with tab navigation
      └── layout.tsx                  — Shared layout with facility header + breadcrumb

components/admin/facilities/
  ├── FacilityCard.tsx                — Summary card for list view (name, occupancy gauge, alert badges, admin name)
  ├── FacilityHeader.tsx              — Detail page header (name, status badge, entity name, quick stats bar)
  ├── FacilityTabNav.tsx              — Tab navigation component
  ├── tabs/
  │   ├── OverviewTab.tsx             — Dashboard: occupancy gauge, census snapshot, recent alerts, key contacts, survey status
  │   ├── LicensingTab.tsx            — AHCA license, care types, survey history timeline, compliance calendar
  │   ├── RatesTab.tsx                — Rate schedule table with effective dates, add new rate modal, rate history accordion
  │   ├── BuildingTab.tsx             — Physical plant form: construction, fire safety, generator, kitchen, ADA, elopement
  │   ├── EmergencyTab.tsx            — Emergency contacts directory, sortable/categorized, storm prep summary
  │   ├── VendorsTab.tsx              — Vendor roster for this facility with contract dates + renewal alerts
  │   ├── DocumentsTab.tsx            — Document vault: upload, categorize, expiration tracking, filterable grid
  │   ├── StaffingTab.tsx             — Key personnel assignments, ratio rules config, on-call rotation
  │   ├── CommunicationTab.tsx        — Visitation settings, family notification config, online presence links, marketing
  │   ├── ThresholdsTab.tsx           — Alert threshold configuration table with yellow/red inputs + role targeting
  │   ├── AuditTab.tsx                — Audit log viewer: filterable by field, user, date range. Exportable.
  │   └── TimelineTab.tsx             — Chronological event timeline with event type filters
  ├── forms/
  │   ├── RateScheduleForm.tsx        — Add/edit rate with effective date, amount, notes
  │   ├── EmergencyContactForm.tsx    — Add/edit emergency contact
  │   ├── DocumentUploadForm.tsx      — File upload with category, expiration, notes
  │   ├── SurveyHistoryForm.tsx       — Add survey record with citations, POC tracking
  │   └── TimelineEventForm.tsx       — Add timeline event
  └── shared/
      ├── OccupancyGauge.tsx          — Circular or bar gauge showing occupied/total with color coding
      ├── ExpirationBadge.tsx         — Color-coded badge (green/yellow/red) based on days to expiration
      ├── AlertCountBadge.tsx         — Red/yellow count badges for facility cards
      └── FieldAuditTooltip.tsx       — Hover tooltip showing last change date + who changed it

hooks/
  ├── useFacility.ts                  — React Query: single facility detail by ID
  ├── useFacilities.ts                — React Query: facility list with summary stats
  ├── useFacilityRates.ts             — React Query: rate schedules for facility
  ├── useFacilityDocuments.ts         — React Query: document vault for facility
  ├── useFacilityAuditLog.ts          — React Query: paginated audit log
  └── useFacilityAlerts.ts            — React Query: active alerts/expirations for facility

lib/admin/facilities/
  ├── facility-api.ts                 — API client functions for all facility endpoints
  ├── facility-validation.ts          — Zod schemas for all facility forms
  └── facility-constants.ts           — Rate types, document categories, contact categories, threshold types
```

### State Management

- **Server state:** React Query for all facility data. Queries keyed by `['facility', facilityId, tabName]`. Stale time: 30s for overview, 5min for building profile, 1min for rates.
- **Client state:** `useState` for active tab, form modals, filter state. No global store needed — each tab is independently data-fetched.

### Routing

- **New routes:**
  - `/admin/facilities` — Facility list (owner, org_admin, facility_admin, manager)
  - `/admin/facilities/[facilityId]` — Facility detail (owner, org_admin, facility_admin for their assigned facilities, manager for their assigned facilities)
- **Modified routes:**
  - `/admin` dashboard — Add "Facilities" card/link to command center
  - Admin sidebar — Add "Facilities" nav item under Settings or as top-level

### Responsive Requirements

- **Desktop (1440):** Two-column layout on overview tab (stats left, alerts right). Full-width tables on rates/documents/audit tabs. Tab nav horizontal.
- **Laptop (1024):** Same as desktop, slightly compressed.
- **Tablet (768):** Single column. Tab nav becomes scrollable horizontal strip. Tables become cards on mobile-critical tabs.
- **Mobile (375):** Tab nav becomes dropdown selector. Forms stack vertically. Document vault switches to list view. Audit log simplified to key fields.

---

## Security Architecture

### Authorization Matrix

| Action | owner | org_admin | facility_admin | manager | Other Staff |
|--------|-------|-----------|----------------|---------|-------------|
| View facility list | ✅ all | ✅ all | ✅ assigned | ✅ assigned | ❌ |
| View facility detail | ✅ all | ✅ all | ✅ assigned | ✅ assigned (limited tabs) | ❌ |
| Edit facility core fields | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage rates | ✅ | ✅ | ❌ | ❌ | ❌ |
| Upload documents | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit building profile | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit emergency contacts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit communication settings | ✅ | ✅ | ✅ (visitation/notification only) | ❌ | ❌ |
| Edit thresholds | ✅ | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Export audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Add survey history | ✅ | ✅ | ❌ | ❌ | ❌ |
| Add timeline events | ✅ | ✅ | ❌ | ❌ | ❌ |

### PII Handling

- **Fields containing PII:** administrator phone numbers, emergency contact phone numbers
- **Access restrictions:** Only visible to roles with facility access. Phone numbers masked in audit logs (last 4 digits only).
- **Encryption:** All data encrypted at rest via Supabase (AES-256). In transit via TLS 1.3.

### Audit Logging

- **Actions logged:** Every INSERT, UPDATE, DELETE on all facility config tables
- **Log schema:** `{ facility_id, table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, ip_address }`
- **Retention:** Audit logs are never hard-deleted. No `deleted_at` column. Append-only.

---

## Performance Design

- **Expected load:** 1-5 concurrent admin users per organization. Negligible in terms of requests/second. No horizontal scaling needed.
- **Caching strategy:** React Query client-side caching with stale-while-revalidate. No server-side cache needed at this scale.
- **Query optimization:** All list queries filter by `facility_id` with appropriate indexes. Audit log paginated server-side (50 per page default). Document vault lazy-loads file previews.
- **Pagination:** Cursor-based for audit log (high volume). Offset-based for everything else (low volume per facility).
- **Lazy loading:** Tab data fetched on tab activation, not on page load. Only Overview tab loads by default. Document file previews loaded on scroll.

---

## Error Handling Strategy

### Failure Scenarios

| Scenario | User Impact | System Behavior | User Message |
|----------|-------------|-----------------|--------------|
| Rate overlap conflict | Cannot save new rate | 409 returned | "A rate of this type already exists for the selected date range. Adjust the effective date or edit the existing rate." |
| Document upload fails (size) | Cannot upload | 413 returned | "File exceeds 25MB limit. Compress or split the document." |
| Audit trigger fails | Audit gap | Transaction succeeds, failure logged | No user-facing message. Ops alert sent. |
| Facility not found | 404 page | Redirect to facility list | "Facility not found. It may have been archived." |
| RLS blocks access | Cannot view facility | 403 returned | "You don't have access to this facility. Contact your administrator." |
| Expiration scanner fails | Missed alerts | Edge function logged | Owner notified via backup email channel |

### Graceful Degradation

- **If Supabase storage is down:** Document upload disabled, existing document metadata still visible (file download fails gracefully with retry button).
- **If audit trigger fails:** Non-blocking. The config change succeeds. A background job retries audit writes from WAL.
- **If expiration scanner fails:** Manual "Scan Now" button on thresholds tab as fallback. Previous scan results remain visible.

---

## Event Tracking

| Event Name | Trigger | Payload | Actor |
|------------|---------|---------|-------|
| facility.viewed | User opens facility detail | `{ facility_id, tab }` | Any admin role |
| facility.updated | Core fields changed | `{ facility_id, fields_changed[] }` | owner/org_admin |
| facility.rate_created | New rate schedule added | `{ facility_id, rate_type, amount, effective_from }` | owner/org_admin |
| facility.document_uploaded | File uploaded to vault | `{ facility_id, category, has_expiration }` | owner/org_admin |
| facility.alert_triggered | Threshold breached | `{ facility_id, threshold_type, severity, current_value }` | system |
| facility.survey_recorded | Survey history added | `{ facility_id, survey_type, result, citation_count }` | owner/org_admin |

---

## Decisions and Tradeoffs (ADRs)

### ADR-1: Effective-Dated Rates with Exclusion Constraint vs Simple Current Rate

- **Context:** Rates change over time. Billing needs historical rates for past invoices. Medicaid reconciliation needs to know what rate was active on a specific date.
- **Options considered:** (A) Single `rate` column on facilities, overwrite on change. (B) Rate schedule table with effective_from/effective_to and EXCLUDE constraint.
- **Chosen:** (B) — Time-series rate table with GiST exclusion constraint preventing overlapping date ranges.
- **Tradeoffs accepted:** More complex queries (must filter by date range). Requires btree_gist extension. Worth it for auditability and billing correctness.
- **Revisit trigger:** If we ever need sub-day rate changes (unlikely for ALF).

### ADR-2: Separate Building Profile Table vs JSONB on Facilities

- **Context:** Building details are 30+ fields that most queries don't need. Putting them on the facilities table bloats every facility SELECT.
- **Options considered:** (A) Add columns to facilities. (B) JSONB column on facilities. (C) Separate 1:1 table.
- **Chosen:** (C) — Separate `facility_building_profiles` table with 1:1 relationship.
- **Tradeoffs accepted:** Extra JOIN on building tab load. Trivial performance cost for clean schema separation.
- **Revisit trigger:** If we need building data in facility list queries (then consider a materialized view).

### ADR-3: Append-Only Audit Log vs Supabase Audit Extension

- **Context:** Need audit trail for compliance. Supabase has `pgaudit` extension but it captures ALL queries, not just facility config changes.
- **Options considered:** (A) pgaudit extension. (B) Custom trigger → audit table. (C) Application-level audit logging.
- **Chosen:** (B) — Database triggers writing to `facility_audit_log`. Captures exactly what we need (field-level diffs), nothing more. Queryable by facility.
- **Tradeoffs accepted:** Must maintain triggers when schema changes. Triggers add ~1ms per write. Acceptable.
- **Revisit trigger:** If audit volume exceeds 1M rows (then partition by month).

### ADR-4: "Enhanced ALF Services" vs "Memory Care" Terminology

- **Context:** COL provides enhanced services for memory-impaired residents but does NOT hold a Memory Care license. Using "Memory Care" in any compliance-facing output is a regulatory violation.
- **Options considered:** (A) Use "Memory Care" with a disclaimer. (B) Use "Enhanced ALF Services" everywhere. (C) Make it configurable.
- **Chosen:** (B) + (C) — The `care_services_offered` array uses `enhanced_alf_services` as the enum value. UI displays "Enhanced ALF Services." The value "memory_care" is intentionally excluded from the CHECK constraint. A validation rule prevents it from ever being inserted.
- **Tradeoffs accepted:** Marketing materials may need different language than compliance outputs. Marketing tab allows free-text tagline/differentiators for that purpose.
- **Revisit trigger:** If COL obtains a Memory Care license (LMH designation from AHCA).

### ADR-5: Document Storage — Supabase Storage vs External (S3/R2)

- **Context:** Facility documents (licenses, surveys, inspection reports) need durable storage with access control.
- **Options considered:** (A) Supabase Storage (built-in, RLS-integrated). (B) Cloudflare R2 (cheaper at scale). (C) AWS S3.
- **Chosen:** (A) — Supabase Storage. Already integrated with auth. RLS policies on storage buckets align with existing facility access model. Volume is low (dozens of documents per facility, not thousands).
- **Tradeoffs accepted:** 1GB free tier may need upgrade if many large PDFs. Acceptable for 5 facilities.
- **Revisit trigger:** If document volume exceeds 5GB or if we need CDN-level delivery for family portal documents.

---

## Out of Scope (Technical)

- **Resident-level data** — Census counts are derived from beds/occupancy, but individual resident records are not managed here. That's Module 03.
- **Financial transactions** — Rate configuration lives here, but actual invoices, payments, and GL entries are Module 16/17.
- **Staff scheduling** — Ratio rules are configured here, but actual shift scheduling is Module 11.
- **Vendor contract negotiation workflow** — Vendor assignments and contract dates are tracked, but no approval workflow for new vendor contracts.
- **Multi-organization** — This blueprint assumes single-org (Circle of Life). Multi-org facility management deferred.
- **Facility creation wizard** — This blueprint covers managing existing facilities. A "Create New Facility" wizard with guided setup is a separate blueprint.
- **Bed management drag-and-drop** — Bed/room/unit CRUD exists in the schema already. A visual bed map editor is a separate UX project.

---

## Open Technical Questions

1. ~~**btree_gist extension**~~ — **RESOLVED:** Available on project `zymenlnwyzpnohljwifx` but not installed. Migration will include `CREATE EXTENSION IF NOT EXISTS btree_gist;` before rate_schedule_versions table creation.
2. ~~**Supabase Storage bucket**~~ — **RESOLVED:** Will create `facility-documents` bucket with RLS policies matching facility access during migration. Current plan has sufficient storage for 5 facilities.
3. ~~**Audit trigger scope**~~ — **RESOLVED:** Start with new facility config tables only. Expand to existing tables (beds, rooms, units, insurance_policies, vendor_facilities) in a follow-up migration after portal is stable.
4. ~~**Rate approval workflow**~~ — **RESOLVED (2026-04-10 per Brian):** No two-person approval. Owner/org_admin entry is sufficient. Rate becomes active on effective_from date automatically.
5. ~~**Notification delivery**~~ — **RESOLVED:** Both in-app and email. In-app for day-to-day visibility, email as backup for critical RED alerts (license/insurance expiration). Aligns with existing notification infrastructure.
6. ~~**COL-specific seed data**~~ — **RESOLVED (2026-04-10 per Brian):** Yes, auto-seed building profiles and emergency contacts from Storm Preparedness doc data for all 5 existing facilities during migration.

---

## Engineering Effort Estimate

- **Size:** L
- **Hours:** 80–110
- **Breakdown:**
  - Database (9 tables, triggers, RLS, seed data): 16–20 hrs
  - Backend (API routes, validation, file upload, Edge Functions): 20–28 hrs
  - Frontend (12 tab components, forms, list view, hooks): 32–42 hrs
  - Integration (expiration scanner, audit triggers, compliance feed): 8–12 hrs
  - Tests (unit + integration for rate overlap logic, RLS, audit): 8–12 hrs
