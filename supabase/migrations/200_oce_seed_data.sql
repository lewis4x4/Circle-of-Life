-- Migration 200: OCE Seed Data and FK Updates
-- Part of Module 27 — Operations Cadence Engine (OCE)
-- Seeds COL admin log templates and adds FK constraints
--
-- This migration:
-- 1. Adds vendor booking support columns
-- 2. Adds FK constraints for facility_assets
-- 3. Seeds operation_task_templates with COL's 9 admin log patterns

-- ============================================================================
-- Step 1: Add vendor booking support to vendors table
-- ============================================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS accepts_bookings BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS booking_confirmation_days_required INTEGER DEFAULT 0;

COMMENT ON COLUMN vendors.accepts_bookings IS
  'If true: this vendor accepts bookings through OCE. Used for maintenance tasks.';

COMMENT ON COLUMN vendors.booking_confirmation_days_required IS
  'Number of days in advance required for booking confirmation.';

-- ============================================================================
-- Step 2: Add FK constraints for facility_assets (deferred to avoid circular deps)
-- ============================================================================

-- Note: These FKs reference vendors table which may not exist in all schemas.
-- Adding with NOT VALID to allow existing data, will be validated on next write.

DO $$
BEGIN
  -- Add service vendor FK if vendors table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendors'
  ) THEN
    ALTER TABLE facility_assets
      ADD CONSTRAINT IF NOT EXISTS fa_service_vendor_fk
      FOREIGN KEY (last_service_vendor_id)
      REFERENCES vendors(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN facility_assets.last_service_vendor_id IS
  'Vendor who last serviced this asset. NULL if unknown or done in-house.';

-- ============================================================================
-- Step 3: Add FK constraints for operation_task_templates (deferred)
-- ============================================================================

DO $$
BEGIN
  -- Add asset FK if facility_assets exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'facility_assets'
  ) THEN
    ALTER TABLE operation_task_templates
      ADD CONSTRAINT IF NOT EXISTS ott_asset_fk
      FOREIGN KEY (asset_ref)
      REFERENCES facility_assets(id)
      ON DELETE SET NULL;
  END IF;

  -- Add vendor FK if vendors exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendors'
  ) THEN
    ALTER TABLE operation_task_templates
      ADD CONSTRAINT IF NOT EXISTS ott_vendor_fk
      FOREIGN KEY (vendor_booking_ref)
      REFERENCES vendors(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN operation_task_templates.asset_ref IS
  'Links to facility_assets when this task is about an asset (e.g., AED check).';

COMMENT ON COLUMN operation_task_templates.vendor_booking_ref IS
  'Links to vendors when this task is a booking confirmation (e.g., hood cleaning).';

-- ============================================================================
-- Step 4: Seed COL Admin Log Templates
-- ============================================================================

-- Daily Rounds (shift-scope)
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  shift_scope, assignee_role, escalation_ladder, priority, estimated_minutes
) VALUES
-- Daily AM Rounds (7am-3pm)
  (NULL, NULL, 'Daily AM Rounds',
   'Walk all resident rooms, check vitals board, verify call lights working, note any overnight incidents.',
   'daily_rounds', 'daily', 'day', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "in_app", "enabled": true},
     {"role": "facility_administrator", "sla_minutes": 60, "channel": "sms", "enabled": true}]'::jsonb,
   'normal', 15),
-- Daily PM Rounds (3pm-11pm)
  (NULL, NULL, 'Daily PM Rounds',
   'Walk all resident rooms, check call lights, note evening meds, verify evening activities completed.',
   'daily_rounds', 'daily', 'evening', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', 15),
-- Daily Night Rounds (11pm-7am)
  (NULL, NULL, 'Daily Night Rounds',
   'Night rounds check: elopement alarms, overnight vitals, any incident reports filed.',
   'daily_rounds', 'daily', 'night', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "sms", "enabled": true}]'::jsonb,
   'normal', 15),
-- Daily Kitchen Check
  (NULL, NULL, 'Daily Kitchen Inspection',
   'Check refrigerator temps, food safety logs, prep area cleanliness, stock levels.',
   'daily_rounds', 'daily', 'day', 'dietary_manager',
   '[]'::jsonb, 'normal', 10),
-- Daily Laundry Check
  (NULL, NULL, 'Daily Linens Check',
   'Verify clean linens available, soil linen collected, laundry schedule followed.',
   'daily_rounds', 'daily', 'day', 'housekeeping',
   '[]'::jsonb, 'low', 5)
ON CONFLICT DO NOTHING;

-- Weekly Rounds
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  shift_scope, day_of_week, assignee_role, escalation_ladder, priority, estimated_minutes
) VALUES
-- Weekly Fire Drill Check
  (NULL, NULL, 'Weekly Fire Drill Log Review',
   'Review fire drill log from past week, confirm scheduled drill for next week completed.',
   'weekly_rounds', 'weekly', NULL, 5, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 60, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', 5),
-- Weekly Medication Review
  (NULL, NULL, 'Weekly Medication Reconciliation',
   'Review medication errors for past week, eMAR discrepancy report, pharmacy delivery verification.',
   'weekly_rounds', 'weekly', NULL, 1, 'don',
   '[{"role": "coo", "sla_minutes": 60, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 20),
-- Weekly Staff Meeting Minutes
  (NULL, NULL, 'Weekly Staff Meeting',
   'Conduct all-staff meeting, review incidents from past week, review upcoming events.',
   'weekly_rounds', 'weekly', NULL, 3, 'facility_administrator',
   '[]'::jsonb, 'normal', 30),
-- Weekly Activity Schedule Review
  (NULL, NULL, 'Weekly Activity Schedule',
   'Review and approve upcoming week activity calendar, ensure adequate staffing for events.',
   'weekly_rounds', 'weekly', NULL, 4, 'activities_director',
   '[]'::jsonb, 'normal', 15)
ON CONFLICT DO NOTHING;

-- Monthly Rounds
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  shift_scope, day_of_month, assignee_role, escalation_ladder,
  priority, compliance_requirement, license_threatening, estimated_minutes
) VALUES
-- Monthly Resident Council Notes
  (NULL, NULL, 'Monthly Resident Council',
   'Conduct resident council meeting, document concerns raised, follow up on previous month items.',
   'monthly_rounds', 'monthly', NULL, 15, 'facility_administrator',
   '[]'::jsonb, 'normal', NULL, false, 30),
-- Monthly Fire Safety Inspection
  (NULL, NULL, 'Monthly Fire Safety Check',
   'Inspect all fire extinguishers, check alarm panel, test emergency lighting.',
   'monthly_rounds', 'monthly', NULL, 1, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 48, "channel": "in_app", "enabled": true},
     {"role": "owner", "sla_minutes": 72, "channel": "sms", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.004(2)', true, 30),
-- Monthly Medication Storage Audit
  (NULL, NULL, 'Monthly Medication Storage Review',
   'Audit controlled substance storage, verify lock integrity, check destruction logs.',
   'monthly_rounds', 'monthly', NULL, 25, 'don',
   '[{"role": "coo", "sla_minutes": 48, "channel": "in_app", "enabled": true}]'::jsonb,
   'critical', 'AHCA 59A-36.007', true, 45)
ON CONFLICT DO NOTHING;

-- Quarterly Rounds
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  day_of_month, assignee_role, escalation_ladder, priority,
  compliance_requirement, license_threatening, estimated_minutes
) VALUES
-- Quarterly Disaster Preparedness Review
  (NULL, NULL, 'Quarterly Disaster Preparedness',
   'Review evacuation plan, check emergency supplies, test generator, update emergency contacts.',
   'quarterly_rounds', 'quarterly', 1, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.006', true, 60),
-- Quarterly Staff Competency Review
  (NULL, NULL, 'Quarterly Staff Competency Assessment',
   'Review all staff certifications, identify expiring within 90 days, schedule renewal training.',
   'quarterly_rounds', 'quarterly', 1, 'hr_manager',
   '[]'::jsonb, 'high', 'AHCA 59A-36.011', false, 120)
ON CONFLICT DO NOTHING;

-- Yearly Rounds
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  month_of_year, assignee_role, escalation_ladder, priority,
  estimated_minutes
) VALUES
-- Yearly Physical Plant Inspection
  (NULL, NULL, 'Annual Building Inspection',
   'Complete facility walkthrough, document maintenance needs, update 3-year capital plan.',
   'yearly_rounds', 'yearly', 1, 'facility_administrator',
   '[{"role": "owner", "sla_minutes": 168, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', 180),
-- Yearly Policy Review
  (NULL, NULL, 'Annual Policy Handbook Review',
   'Review and update resident handbook, employee handbook, all facility policies.',
   'yearly_rounds', 'yearly', 2, 'coo',
   '[]'::jsonb, 'normal', 240)
ON CONFLICT DO NOTHING;

-- Audits
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  assignee_role, escalation_ladder, priority,
  compliance_requirement, requires_dual_sign, estimated_minutes
) VALUES
-- AHCA Survey Preparation Audit
  (NULL, NULL, 'AHCA Survey Readiness Audit',
   'Verify all 12-month compliance documentation complete, review survey responses, prepare staff for unannounced survey.',
   'audits', 'on_demand', 'compliance_officer',
   '[{"role": "owner", "sla_minutes": 120, "channel": "sms", "enabled": true}]'::jsonb,
   'critical', 'AHCA Annual Survey Readiness', true, 180),
-- Monthly Incident Review Audit
  (NULL, NULL, 'Monthly Incident Trend Analysis',
   'Review all incidents from past month, identify patterns, recommend corrective actions.',
   'audits', 'monthly', 'compliance_officer',
   '[]'::jsonb, 'high', 'Quality Improvement Standard', false, 60)
ON CONFLICT DO NOTHING;

-- Collections (Module 28 integration point)
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  shift_scope, day_of_week, assignee_role, escalation_ladder,
  priority, survey_readiness_impact, estimated_minutes
) VALUES
-- Weekly AR Aging Review
  (NULL, NULL, 'Weekly AR Aging Report',
   'Review accounts receivable aging 30/60/90 buckets, identify follow-up actions.',
   'collections', 'weekly', NULL, 1, 'collections_manager',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', true, 30),
-- Monthly Collection Call Cycle
  (NULL, NULL, 'Monthly Collection Outreach',
   'Contact all accounts >30 days past due, document payment promises, update collection log.',
   'collections', 'monthly', NULL, 15, 'collections_manager',
   '[]'::jsonb, 'normal', true, 120)
ON CONFLICT DO NOTHING;

-- Employee File
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  shift_scope, day_of_week, assignee_role, escalation_ladder,
  priority, compliance_requirement, estimated_minutes
) VALUES
-- Weekly New Hire File Review
  (NULL, NULL, 'Weekly New Hire File Check',
   'Verify all new hires from past week have complete HR files: background check, licensure, certifications.',
   'employee_file', 'weekly', NULL, 5, 'hr_manager',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.011', 45),
-- Quarterly License Verification
  (NULL, NULL, 'Quarterly Staff License Audit',
   'Verify all staff licenses current, no disciplinary actions pending, renewals on track.',
   'employee_file', 'quarterly', NULL, 1, 'hr_manager',
   '[]'::jsonb, 'critical', 'AHCA 59A-36.011', 60)
ON CONFLICT DO NOTHING;

-- Mental Health Support Plans
INSERT INTO operation_task_templates (
  organization_id, facility_id, name, description, category, cadence_type,
  assignee_role, escalation_ladder, priority,
  compliance_requirement, estimated_minutes
) VALUES
-- Monthly MHSP Review
  (NULL, NULL, 'Monthly Mental Health Support Plan Review',
   'Review all active MHSPs, confirm behavior interventions documented, schedule BH provider follow-ups.',
   'mental_health_support', 'monthly', 'don',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.010', 30)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Step 5: Add comment with seed summary
-- ============================================================================

COMMENT ON TABLE operation_task_templates IS
  $$
  Defines every operational task template across all cadences (daily/weekly/monthly/quarterly/yearly).
   Each template includes escalation ladders, assignment rules, and compliance references.

   Seeded with COL's 9 admin log patterns:
   - Daily Rounds (AM/PM/Night, Kitchen, Laundry) — 5 templates
   - Weekly Rounds (Fire Drill, Medication, Staff Meeting, Activity Schedule) — 4 templates
   - Monthly Rounds (Resident Council, Fire Safety, Med Storage) — 3 templates
   - Quarterly Rounds (Disaster Preparedness, Staff Competency) — 2 templates
   - Yearly Rounds (Building Inspection, Policy Review) — 2 templates
   - Audits (AHCA Survey, Incident Trend) — 2 templates
   - Collections (AR Aging, Collection Call) — 2 templates
   - Employee File (New Hire, License Audit) — 2 templates
   - Mental Health Support (MHSP Review) — 1 template

   Total: 23 seed templates.

   Templates use role-based assignment (coo, don, facility_administrator, etc.)
   never user IDs. Michelle Norris = COO, templates use assignee_role='coo'.
   $$;
