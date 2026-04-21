# Module 27 — Operations Cadence Engine (OCE)

**spec_id:** mod-27-operations-cadence-engine
**status:** FULL
**created:** 2026-04-21
**last_updated:** 2026-04-21

---

## Mission Alignment

**pass** — OCE generalizes the 9 COL admin logs (daily/weekly/monthly/quarterly/yearly rounds, audits, collections, employee file, mental health support plans) into a single event-driven workflow engine with shift-level granularity, escalation ladders, and staffing adequacy forecasting. This improves **staff clarity** and **regulatory readiness** by ensuring no operational task falls through the cracks.

---

## Overview

The Operations Cadence Engine (OCE) is a unified task management system that replaces COL's paper-based admin logs with a digital, role-gated, escalation-aware workflow. Every operational task is defined as a template with cadence (daily/weekly/monthly/quarterly/yearly), shift scope (all/day/evening/night), assignment rules, and escalation ladders. Templates are seeded from COL's existing admin log patterns but can be extended by operators.

COOs and facility administrators work their daily task queues via `/admin/operations` Today view. Shift-level tasks are surfaced to the appropriate shift (3–11, 11–7). Missed tasks trigger escalation via configured ladders (LPN supervisor 15 min → DON 30 min → Administrator 60 min → Owner SMS). Owner alerts fire for license-threatening misses.

OCE feeds into Module 28 (Financial Close) for collection workflows, Module 29 (Risk & Survey) for missed compliance tasks, and the Staffing Adequacy snapshot for capacity forecasting.

---

## Data Model

### New Tables

```sql
-- ============================================================================
-- 1. OPERATION TASK TEMPLATES
-- Defines every operational task across all cadences
-- ============================================================================

CREATE TABLE operation_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id), -- NULL = org-wide template

  -- Core identification
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'daily_rounds', 'weekly_rounds', 'monthly_rounds',
    'quarterly_rounds', 'yearly_rounds', 'audits',
    'collections', 'employee_file', 'mental_health_support',
    'safety', 'maintenance', 'compliance', 'financial',
    'staffing', 'vendor_management', 'document_review'
  )),

  -- Cadence configuration
  cadence_type TEXT NOT NULL CHECK (cadence_type IN (
    'daily', 'weekly', 'monthly', 'quarterly', 'yearly',
    'on_demand', 'event_driven'
  )),

  -- For daily: which shifts? For others: N/A or 'all'
  shift_scope TEXT CHECK (shift_scope IN ('all', 'day', 'evening', 'night')),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Monday, 7=Sunday
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year INTEGER CHECK (month_of_year BETWEEN 1 AND 12),

  -- Assignment rules
  assignee_role TEXT CHECK (assignee_role IN (
    'coo', 'facility_administrator', 'don', 'lpn_supervisor',
    'medication_aide', 'cna', 'dietary_manager', 'activities_director',
    'maintenance', 'housekeeping', 'staffing_coordinator',
    'compliance_officer', 'finance_manager', 'collections_manager',
    'hr_manager'
  )),
  required_role_fallback TEXT, -- If assignee_role absent/unavailable, who takes over?

  -- Escalation ladder: [{role, sla_minutes, channel, enabled}]
  -- Example: [{role: 'lpn_supervisor', sla_minutes: 15, channel: 'in_app', enabled: true},
  --          {role: 'don', sla_minutes: 30, channel: 'in_app', enabled: true},
  --          {role: 'administrator', sla_minutes: 60, channel: 'sms', enabled: true}]
  escalation_ladder JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Asset/vendor linkage
  asset_ref UUID, -- Links to facility_assets when applicable
  vendor_booking_ref UUID, -- Links to vendors when this is a booking confirmation task
  linked_document_id UUID REFERENCES facility_documents(id),

  -- Priority and risk flags
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  license_threatening BOOLEAN NOT NULL DEFAULT false,
  -- If true: missed task triggers owner_alert with legal-review path

  -- Compliance mapping
  compliance_requirement TEXT, -- Reference to AHCA rule or internal policy
  survey_readiness_impact BOOLEAN NOT NULL DEFAULT false,

  -- Time tracking
  estimated_minutes INTEGER CHECK (estimated_minutes >= 0),
  auto_complete_after_hours INTEGER, -- For low-risk tasks, auto-complete if not actioned

  -- Versioning for templates
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID REFERENCES operation_task_templates(id),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_ott_org_facility ON operation_task_templates(organization_id, facility_id)
  WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_ott_cadence ON operation_task_templates(cadence_type, shift_scope)
  WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_ott_assignee_role ON operation_task_templates(assignee_role)
  WHERE deleted_at IS NULL AND is_active = true;
CREATE INDEX idx_ott_category ON operation_task_templates(category)
  WHERE deleted_at IS NULL AND is_active = true;

ALTER TABLE operation_task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY ott_select ON operation_task_templates
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

CREATE POLICY ott_manage ON operation_task_templates
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'coo')
  );

CREATE POLICY ott_facility_read ON operation_task_templates
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('facility_administrator', 'don', 'lpn_supervisor')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- 2. OPERATION TASK INSTANCES
-- The actual tasks created from templates on schedules/events
-- ============================================================================

CREATE TABLE operation_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Template linkage
  template_id UUID REFERENCES operation_task_templates(id),
  template_name TEXT NOT NULL,
  template_category TEXT NOT NULL,
  template_cadence_type TEXT NOT NULL,

  -- Shift assignment
  assigned_shift_date DATE NOT NULL, -- The date this task is for
  assigned_shift TEXT CHECK (assigned_shift IN ('day', 'evening', 'night')),

  -- Assignment
  assigned_to UUID REFERENCES auth.users(id),
  assigned_role TEXT, -- Cached from template at creation time
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ,

  -- Execution tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'missed', 'deferred', 'cancelled'
  )),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  missed_at TIMESTAMPTZ,
  deferred_until TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Completion evidence
  completion_notes TEXT,
  completion_evidence_paths TEXT[], -- Array of Supabase Storage paths
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,

  -- Escalation tracking
  current_escalation_level INTEGER DEFAULT 0,
  escalation_triggered_at TIMESTAMPTZ,
  escalation_history JSONB DEFAULT '[]'::jsonb,

  -- Dual-sign requirement for compliance tasks
  requires_dual_sign BOOLEAN NOT NULL DEFAULT false,
  signed_by UUID REFERENCES auth.users(id),
  signed_at TIMESTAMPTZ,
  second_sign_by UUID REFERENCES auth.users(id),
  second_signed_at TIMESTAMPTZ,

  -- SLA tracking
  due_at TIMESTAMPTZ, -- Calculated from template escalation_ladder
  sla_met BOOLEAN, -- Set on completion
  sla_miss_reason TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_oti_facility_date ON operation_task_instances(facility_id, assigned_shift_date, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_oti_assigned_to ON operation_task_instances(assigned_to, status)
  WHERE deleted_at IS NULL AND status IN ('pending', 'in_progress');
CREATE INDEX idx_oti_status ON operation_task_instances(status, due_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_oti_template ON operation_task_instances(template_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_oti_missed ON operation_task_instances(status, missed_at)
  WHERE deleted_at IS NULL AND status = 'missed';

ALTER TABLE operation_task_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY oti_select ON operation_task_instances
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY oti_assign ON operation_task_instances
  FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY oti_update ON operation_task_instances
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      -- Can update if assigned to them
      assigned_to = auth.uid()
      -- COO/owner/org_admin can update all in accessible facilities
      OR haven.app_role() IN ('owner', 'org_admin', 'coo')
      -- Facility admins can update in their facility
      OR (
        haven.app_role() = 'facility_administrator'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

-- ============================================================================
-- 3. FACILITY ASSETS
-- Physical plant assets with service lifecycles
-- ============================================================================

CREATE TABLE facility_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Asset identification
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'generator', 'aed', 'fire_extinguisher', 'sprinkler_system',
    'hood_suppression', 'ac_unit', 'elevator', 'kitchen_equipment',
    'laundry_equipment', 'furniture', 'vehicle', 'other'
  )),
  asset_tag TEXT, -- Physical label/barcode on equipment
  serial_number TEXT,

  -- Description
  name TEXT NOT NULL,
  description TEXT,
  manufacturer TEXT,
  model TEXT,
  year_manufactured INTEGER CHECK (year_manufactured BETWEEN 1900 AND 2100),

  -- Installation and warranty
  install_date DATE,
  install_location TEXT, -- Where in the building?
  warranty_end_date DATE,

  -- Service lifecycle
  service_interval_days INTEGER CHECK (service_interval_days >= 0),
  last_service_at DATE,
  last_service_vendor_id UUID REFERENCES vendors(id),
  next_service_due_at DATE,
  service_notes TEXT,

  -- Replacement planning
  lifecycle_replace_by DATE,
  replacement_cost_estimate_cents INTEGER CHECK (replacement_cost_estimate_cents >= 0),
  replacement_justification TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'in_maintenance', 'out_of_service', 'retired', 'replacement_planned'
  )),
  retirement_date DATE,
  retirement_reason TEXT,

  -- Document linkage
  manual_id UUID REFERENCES facility_documents(id),
  inspection_report_id UUID REFERENCES facility_documents(id),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fa_facility_type ON facility_assets(facility_id, asset_type)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_fa_due_service ON facility_assets(next_service_due_at)
  WHERE deleted_at IS NULL AND status IN ('active', 'in_maintenance');
CREATE INDEX idx_fa_replace_on ON facility_assets(lifecycle_replace_by)
  WHERE deleted_at IS NULL AND lifecycle_replace_by IS NOT NULL;

ALTER TABLE facility_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY fa_select ON facility_assets
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY fa_manage ON facility_assets
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'coo', 'facility_administrator')
  );

-- ============================================================================
-- 4. STAFFING ADEQUACY SNAPSHOTS
-- Per-shift, per-facility adequacy computed from ratios + hours + task load
-- ============================================================================

CREATE TABLE staffing_adequacy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),

  -- Snapshot identity
  snapshot_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('day', 'evening', 'night')),
  snapshot_period_start TIMESTAMPTZ NOT NULL,
  snapshot_period_end TIMESTAMPTZ NOT NULL,

  -- Resident demand
  resident_count INTEGER NOT NULL,
  resident_acuity_weighted_count NUMERIC(8,2), -- level_2=1.5x, level_3=2x

  -- Staff supply
  scheduled_staff_count INTEGER NOT NULL,
  scheduled_hours DECIMAL(5,2) NOT NULL,
  scheduled_staff_by_role JSONB, -- {cna: 8, lpn: 2, don: 1, ...}

  -- Ratio compliance
  required_ratio DECIMAL(4,2) NOT NULL, -- From facility_ratio_rules
  actual_ratio DECIMAL(4,2) NOT NULL,
  is_compliant BOOLEAN NOT NULL,

  -- Task load factor
  pending_task_count INTEGER NOT NULL DEFAULT 0,
  high_priority_task_count INTEGER NOT NULL DEFAULT 0,
  estimated_completion_hours DECIMAL(5,2), -- Sum of template estimated_minutes

  -- Adequacy score
  adequacy_score INTEGER CHECK (adequacy_score BETWEEN 0 AND 100),
  adequacy_rating TEXT CHECK (adequacy_rating IN (
    'well_staffed', 'adequate', 'minimal', 'understaffed', 'critical_shortage'
  )),

  -- Forecast
  cannot_cover_count INTEGER DEFAULT 0, -- Tasks that cannot be completed with current staff
  float_pool_required BOOLEAN NOT NULL DEFAULT false,
  recommended_action TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE (facility_id, snapshot_date, shift_type)
);

CREATE INDEX idx_sas_facility_date ON staffing_adequacy_snapshots(facility_id, snapshot_date DESC)
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days';
CREATE INDEX idx_sas_adequacy ON staffing_adequacy_snapshots(adequacy_score, snapshot_date)
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days';

ALTER TABLE staffing_adequacy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY sas_select ON staffing_adequacy_snapshots
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- ============================================================================
-- 5. OPERATION AUDIT LOG
-- Tracks every task state change for compliance
-- ============================================================================

CREATE TABLE operation_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  facility_id UUID REFERENCES facilities(id),
  task_instance_id UUID REFERENCES operation_task_instances(id),

  -- Change details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'assigned', 'started', 'completed', 'missed', 'deferred',
    'cancelled', 'escalated', 'verified', 'signed', 'updated'
  )),
  from_status TEXT,
  to_status TEXT,

  -- Actor
  actor_id UUID REFERENCES auth.users(id),
  actor_role TEXT,

  -- Context
  event_notes TEXT,
  event_data JSONB,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oal_task ON operation_audit_log(task_instance_id, created_at DESC);
CREATE INDEX idx_oal_facility_date ON operation_audit_log(facility_id, created_at DESC)
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

ALTER TABLE operation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY oal_select ON operation_audit_log
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
  );
```

### Modified Tables

```sql
-- Add vendor_booking_flag to vendors for OCE integration
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS accepts_bookings BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS booking_confirmation_days_required INTEGER DEFAULT 0;

-- Add FK to facility_assets for service vendor
ALTER TABLE facility_assets ADD CONSTRAINT fa_service_vendor_fk
  FOREIGN KEY (last_service_vendor_id) REFERENCES vendors(id);

-- Add FK to operation_task_templates for asset/vendor references
ALTER TABLE operation_task_templates ADD CONSTRAINT ott_asset_fk
  FOREIGN KEY (asset_ref) REFERENCES facility_assets(id);

ALTER TABLE operation_task_templates ADD CONSTRAINT ott_vendor_fk
  FOREIGN KEY (vendor_booking_ref) REFERENCES vendors(id);
```

---

## Seed Data: COL Admin Log Templates

The following templates are seeded on migration. These represent COL's 9 admin log patterns.

### Daily Rounds (shift-scope)

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, shift_scope, assignee_role, escalation_ladder, priority, estimated_minutes) VALUES
-- Daily AM Rounds (7am-3pm)
  (NULL, NULL, 'Daily AM Rounds', 'Walk all resident rooms, check vitals board, verify call lights working, note any overnight incidents.', 'daily_rounds', 'daily', 'day', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "in_app", "enabled": true},
     {"role": "facility_administrator", "sla_minutes": 60, "channel": "sms", "enabled": true}]'::jsonb,
   'normal', 15),
-- Daily PM Rounds (3pm-11pm)
  (NULL, NULL, 'Daily PM Rounds', 'Walk all resident rooms, check call lights, note evening meds, verify evening activities completed.', 'daily_rounds', 'daily', 'evening', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', 15),
-- Daily Night Rounds (11pm-7am)
  (NULL, NULL, 'Daily Night Rounds', 'Night rounds check: elopement alarms, overnight vitals, any incident reports filed.', 'daily_rounds', 'daily', 'night', 'medication_aide',
   '[{"role": "lpn_supervisor", "sla_minutes": 15, "channel": "in_app", "enabled": true},
     {"role": "don", "sla_minutes": 30, "channel": "sms", "enabled": true}]'::jsonb,
   'normal', 15);

-- Daily Kitchen Check
  (NULL, NULL, 'Daily Kitchen Inspection', 'Check refrigerator temps, food safety logs, prep area cleanliness, stock levels.', 'daily_rounds', 'daily', 'day', 'dietary_manager', '[]'::jsonb, 'normal', 10);

-- Daily Laundry Check
  (NULL, NULL, 'Daily Linens Check', 'Verify clean linens available, soil linen collected, laundry schedule followed.', 'daily_rounds', 'daily', 'day', 'housekeeping', '[]'::jsonb, 'low', 5);
```

### Weekly Rounds

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, shift_scope, day_of_week, assignee_role, escalation_ladder, priority, estimated_minutes) VALUES
-- Weekly Fire Drill Check
  (NULL, NULL, 'Weekly Fire Drill Log Review', 'Review fire drill log from past week, confirm scheduled drill for next week completed.', 'weekly_rounds', 'weekly', NULL, 5, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 60, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', 5),
-- Weekly Medication Review
  (NULL, NULL, 'Weekly Medication Reconciliation', 'Review medication errors for past week, eMAR discrepancy report, pharmacy delivery verification.', 'weekly_rounds', 'weekly', NULL, 1, 'don',
   '[{"role": "coo", "sla_minutes": 60, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 20),
-- Weekly Staff Meeting Minutes
  (NULL, NULL, 'Weekly Staff Meeting', 'Conduct all-staff meeting, review incidents from past week, review upcoming events.', 'weekly_rounds', 'weekly', NULL, 3, 'facility_administrator',
   '[]'::jsonb, 'normal', 30),
-- Weekly Activity Schedule Review
  (NULL, NULL, 'Weekly Activity Schedule', 'Review and approve upcoming week activity calendar, ensure adequate staffing for events.', 'weekly_rounds', 'weekly', NULL, 4, 'activities_director',
   '[]'::jsonb, 'normal', 15);
```

### Monthly Rounds

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, shift_scope, day_of_month, assignee_role, escalation_ladder, priority, compliance_requirement, license_threatening, estimated_minutes) VALUES
-- Monthly Resident Council Notes
  (NULL, NULL, 'Monthly Resident Council', 'Conduct resident council meeting, document concerns raised, follow up on previous month items.', 'monthly_rounds', 'monthly', NULL, 15, 'facility_administrator',
   '[]'::jsonb, 'normal', NULL, false, 30),
-- Monthly Fire Safety Inspection
  (NULL, NULL, 'Monthly Fire Safety Check', 'Inspect all fire extinguishers, check alarm panel, test emergency lighting.', 'monthly_rounds', 'monthly', NULL, 1, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 48, "channel": "in_app", "enabled": true},
     {"role": "owner", "sla_minutes": 72, "channel": "sms", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.004(2)', true, 30),
-- Monthly Medication Storage Audit
  (NULL, NULL, 'Monthly Medication Storage Review', 'Audit controlled substance storage, verify lock integrity, check destruction logs.', 'monthly_rounds', 'monthly', NULL, 25, 'don',
   '[{"role": "coo", "sla_minutes": 48, "channel": "in_app", "enabled": true}]'::jsonb,
   'critical', 'AHCA 59A-36.007', true, 45);
```

### Quarterly Rounds

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, day_of_month, assignee_role, escalation_ladder, priority, compliance_requirement, license_threatening, estimated_minutes) VALUES
-- Quarterly Disaster Preparedness Review
  (NULL, NULL, 'Quarterly Disaster Preparedness', 'Review evacuation plan, check emergency supplies, test generator, update emergency contacts.', 'quarterly_rounds', 'quarterly', 1, 'facility_administrator',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.006', true, 60),
-- Quarterly Staff Competency Review
  (NULL, NULL, 'Quarterly Staff Competency Assessment', 'Review all staff certifications, identify expiring within 90 days, schedule renewal training.', 'quarterly_rounds', 'quarterly', 1, 'hr_manager',
   '[]'::jsonb, 'high', 'AHCA 59A-36.011', false, 120);
```

### Yearly Rounds

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, month_of_year, assignee_role, escalation_ladder, priority, compliance_requirement, license_threatening, estimated_minutes) VALUES
-- Yearly Physical Plant Inspection
  (NULL, NULL, 'Annual Building Inspection', 'Complete facility walkthrough, document maintenance needs, update 3-year capital plan.', 'yearly_rounds', 'yearly', 1, 'facility_administrator',
   '[{"role": "owner", "sla_minutes": 168, "channel": "in_app", "enabled": true}]'::jsonb,
   'normal', NULL, false, 180),
-- Yearly Policy Review
  (NULL, NULL, 'Annual Policy Handbook Review', 'Review and update resident handbook, employee handbook, all facility policies.', 'yearly_rounds', 'yearly', 2, 'coo',
   '[]'::jsonb, 'normal', 'AHCA 59A-36.001', false, 240);
```

### Audits

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, assignee_role, escalation_ladder, priority, compliance_requirement, requires_dual_sign, estimated_minutes) VALUES
-- AHCA Survey Preparation Audit
  (NULL, NULL, 'AHCA Survey Readiness Audit', 'Verify all 12-month compliance documentation complete, review survey responses, prepare staff for unannounced survey.', 'audits', 'on_demand', 'compliance_officer',
   '[{"role": "owner", "sla_minutes": 120, "channel": "sms", "enabled": true}]'::jsonb,
   'critical', 'AHCA Annual Survey Readiness', true, 180),
-- Monthly Incident Review Audit
  (NULL, NULL, 'Monthly Incident Trend Analysis', 'Review all incidents from past month, identify patterns, recommend corrective actions.', 'audits', 'monthly', 'compliance_officer',
   '[]'::jsonb, 'high', 'Quality Improvement Standard', false, 60);
```

### Collections (Module 28 integration point)

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, shift_scope, day_of_week, assignee_role, escalation_ladder, priority, survey_readiness_impact, estimated_minutes) VALUES
-- Weekly AR Aging Review
  (NULL, NULL, 'Weekly AR Aging Report', 'Review accounts receivable aging 30/60/90 buckets, identify follow-up actions.', 'collections', 'weekly', NULL, 1, 'collections_manager',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', true, 30),
-- Monthly Collection Call Cycle
  (NULL, NULL, 'Monthly Collection Outreach', 'Contact all accounts >30 days past due, document payment promises, update collection log.', 'collections', 'monthly', NULL, 15, 'collections_manager',
   '[]'::jsonb, 'normal', true, 120);
```

### Employee File

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, shift_scope, day_of_week, assignee_role, escalation_ladder, priority, compliance_requirement, estimated_minutes) VALUES
-- Weekly New Hire File Review
  (NULL, NULL, 'Weekly New Hire File Check', 'Verify all new hires from past week have complete HR files: background check, licensure, certifications.', 'employee_file', 'weekly', NULL, 5, 'hr_manager',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.011', 45);
-- Quarterly License Verification
  (NULL, NULL, 'Quarterly Staff License Audit', 'Verify all staff licenses current, no disciplinary actions pending, renewals on track.', 'employee_file', 'quarterly', NULL, 1, 'hr_manager',
   '[]'::jsonb, 'critical', 'AHCA 59A-36.011', 60);
```

### Mental Health Support Plans

```sql
INSERT INTO operation_task_templates (organization_id, facility_id, name, description, category, cadence_type, assignee_role, escalation_ladder, priority, compliance_requirement, estimated_minutes) VALUES
-- Monthly MHSP Review
  (NULL, NULL, 'Monthly Mental Health Support Plan Review', 'Review all active MHSPs, confirm behavior interventions documented, schedule BH provider follow-ups.', 'mental_health_support', 'monthly', 'don',
   '[{"role": "coo", "sla_minutes": 72, "channel": "in_app", "enabled": true}]'::jsonb,
   'high', 'AHCA 59A-36.010', 30);
```

---

## API Design

### Endpoints

**GET /api/admin/operations/tasks**
- **Purpose:** List tasks for a date range, filtered by facility/status/assignee
- **Authentication:** Any admin-eligible role
- **Query params:** `?facility_id=&date_from=&date_to=&status=&assignee_role=&shift=`
- **Response (success):**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "template_name": "Daily AM Rounds",
      "template_category": "daily_rounds",
      "assigned_shift_date": "2026-04-21",
      "assigned_shift": "day",
      "assigned_to": "uuid",
      "assigned_to_name": "Jane Doe",
      "status": "pending",
      "due_at": "2026-04-21T12:15:00Z",
      "priority": "normal",
      "license_threatening": false,
      "estimated_minutes": 15,
      "current_escalation_level": 0,
      "facility_id": "uuid",
      "facility_name": "Oakridge ALF"
    }
  ],
  "pagination": { "page": 1, "per_page": 50, "total": 245 }
}
```

**PATCH /api/admin/operations/tasks/:id/start**
- **Purpose:** User starts working on a task
- **Authentication:** Assigned user + admin roles
- **Response (success):** Updated task with `started_at`
- **Response (errors):** 403 if not assigned to user

**PATCH /api/admin/operations/tasks/:id/complete**
- **Purpose:** User marks task complete, optionally with notes/evidence
- **Authentication:** Assigned user + admin roles
- **Request:**
```json
{
  "completion_notes": "string — optional",
  "completion_evidence_paths": ["storage/path/1.jpg", "storage/path/2.pdf"]
}
```
- **Response (success):** Updated task with `completed_at`, `verified_at` (if auto-verify enabled)
- **Side effects:** Escalation ladder cleared, staffing adequacy recomputed

**PATCH /api/admin/operations/tasks/:id/defer**
- **Purpose:** Defer task to later date/time
- **Authentication:** Assigned user + admin roles
- **Request:** `{ "deferred_until": "2026-04-22T08:00:00Z", "cancellation_reason": "string" }`
- **Response (success):** Updated task with `deferred_until`, `status = 'deferred'`

**PATCH /api/admin/operations/tasks/:id/escalate**
- **Purpose:** Manual escalation (bypass SLA)
- **Authentication:** Any admin role
- **Request:** `{ "escalation_to_role": "don", "reason": "string" }`
- **Response (success):** Updated task with new assignee, escalation level incremented, history logged

**POST /api/admin/operations/tasks/bulk-complete**
- **Purpose:** Mark multiple tasks complete (shift handoff)
- **Authentication:** Assigned user + admin roles
- **Request:** `{ "task_ids": ["uuid1", "uuid2", ...], "completion_notes": "End of shift" }`

**GET /api/admin/operations/staffing-adequacy**
- **Purpose:** Get staffing adequacy snapshot for a shift
- **Query params:** `?facility_id=&date=&shift=`
- **Response (success):**
```json
{
  "adequacy_score": 85,
  "adequacy_rating": "adequate",
  "resident_count": 52,
  "acuity_weighted_count": 68.5,
  "scheduled_staff_count": 11,
  "scheduled_hours": 88.0,
  "scheduled_staff_by_role": { "cna": 8, "lpn": 2, "don": 1 },
  "pending_task_count": 12,
  "high_priority_task_count": 3,
  "estimated_completion_hours": 4.5,
  "required_ratio": 0.10,
  "actual_ratio": 0.08,
  "is_compliant": false,
  "cannot_cover_count": 2,
  "float_pool_required": true,
  "recommended_action": "Call float pool. 2 medication review tasks cannot be completed with current staffing."
}
```

**GET /api/admin/operations/templates**
- **Purpose:** List all templates (manage mode)
- **Authentication:** owner, org_admin, coo
- **Response (success):** Paginated template list with all fields

**POST /api/admin/operations/templates**
- **Purpose:** Create new task template
- **Authentication:** owner, org_admin, coo
- **Request body:** Full template object (see schema)

### Edge Functions

**Function: oce-task-scheduler**
- **Trigger:** Scheduled — runs daily at 00:05 ET
- **Logic summary:**
  1. Calculate today's shift boundaries based on facility timezone
  2. For each active template matching today's cadence:
     - For `daily` templates: Create instances for each shift (day/evening/night)
     - For `weekly` templates: Check `day_of_week` match
     - For `monthly` templates: Check `day_of_month` match (or closest if today > day_of_month)
     - For `quarterly` templates: Check month quarters
     - For `yearly` templates: Check `month_of_year` match
  3. Assign to `assignee_role` or `required_role_fallback` if primary unavailable
  4. Calculate `due_at` from escalation_ladder first step
  5. Write to `operation_task_instances`
- **Error handling:** Failed batch logged, COO notified

**Function: oce-escalation-scanner**
- **Trigger:** Scheduled — runs every 5 minutes
- **Logic summary:**
  1. Find all `pending`/`in_progress` tasks where `due_at < now()`
  2. For each overdue task:
     - Check escalation level against ladder
     - If next step available: Reassign to next role, send notification
     - If escalation exhausted: Send to owner via SMS/voice
  3. For license-threatening tasks: Always notify owner on escalation
- **Error handling:** Logs failures, notifies COO via in-app alert

**Function: oce-missed-task-detector**
- **Trigger:** Scheduled — runs every 30 minutes
- **Logic summary:**
  1. Find tasks where shift ended but not completed
  2. Mark as `missed` with `missed_at = now()`
  3. Trigger escalation ladder first step
  4. If `license_threatening = true`: Route to owner_alert
  5. Update risk_score_snapshot if Module 29 exists
- **Shift boundary detection:** Uses facility timezone + configured shift times

**Function: oce-staffing-adequacy-computer**
- **Trigger:** Scheduled — runs every 15 minutes during active hours, hourly overnight
- **Logic summary:**
  1. Get current shift, resident count, acuity distribution
  2. Get scheduled staff count by role
  3. Fetch required ratio from `facility_ratio_rules`
  4. Count pending/open tasks for this shift
  5. Compute `adequacy_score` = weighted formula
  6. If `cannot_cover_count > 0` OR `is_compliant = false`:
     - Write snapshot to `staffing_adequacy_snapshots`
     - Send alert to COO if below threshold
  7. Update `/admin/operations` Today view real-time adequacy badge

---

## Frontend Architecture

### New Routes

```
src/app/(admin)/admin/operations/
  ├── page.tsx                          — Today view (default)
  ├── week/page.tsx                      — Week view
  ├── month/page.tsx                     — Month view
  ├── quarter/page.tsx                    — Quarter view
  ├── year/page.tsx                      — Year view
  ├── overdue/page.tsx                    — Overdue/Missed view
  ├── assets/page.tsx                     — Asset register view
  ├── vendors/page.tsx                    — Vendor bookings view
  ├── calendar/page.tsx                    — Calendar view (shift grid)
  ├── pager/page.tsx                      — Mobile-first: top 3 must-act items
  └── templates/page.tsx                  — Template management (owner/coo only)

components/operations/
  ├── TaskCard.tsx                        — Single task display with status/assignee/priority
  ├── TaskList.tsx                        — Filterable/paginated task list
  ├── TaskDetailModal.tsx                   — Full task view with actions/start/complete/defer/escalate
  ├── BulkCompleteBar.tsx                  — "End of Shift" bulk action
  ├── AdequacyBadge.tsx                   — Green/Yellow/Red staffing score indicator
  ├── ShiftFilter.tsx                      — Day/Evening/Night toggle
  ├── CategoryFilter.tsx                   — Filter by template category
  ├── AssigneeSelector.tsx                 — Role or user picker
  ├── EscalationTimeline.tsx               — Show escalation history for task
  ├── CalendarGrid.tsx                     — Month view with task dots
  ├── AssetCard.tsx                       — Asset display with service due badge
  ├── VendorBookingCard.tsx                — Booking confirmation task
  ├── StatsBar.tsx                        — Today view: completed/pending/missed counts
  └── QuickCompleteButton.tsx             — One-tap complete for routine tasks

lib/operations/
  ├── operations-api.ts                    — API client functions
  ├── operations-queries.ts                 — React Query hooks
  ├── operations-types.ts                  — TypeScript types
  ├── operations-constants.ts               — Categories, priorities, cadences
  └── operations-utils.ts                  — Date/shift helpers
```

### Today View Design

**Header:**
- Facility selector (multi-facility view) or facility name (single)
- Current shift indicator with time: "Day Shift · 7AM–3PM (Oakridge ALF)"
- Adequacy badge: Green (85+) / Yellow (70–84) / Red (<70)
- Date picker with Today/Prev Day/Next Day shortcuts

**Quick Actions:**
- "End of Shift" button — bulk completes all pending tasks for current shift
- "Refresh Queue" button
- "Go to Pager" mobile shortcut

**Task List:**
- Grouped by status: Pending (top), In Progress, Overdue (red)
- Each task card shows:
  - Template name + category badge
  - Assignee avatar/role
  - Estimated time
  - Priority indicator (critical = red icon)
  - License-threatening flag (⚠️ visible for compliance tasks)
  - Quick actions: Start / Complete / Defer / Escalate

**Stats Bar (bottom):**
- Pending: 12
- In Progress: 3
- Completed today: 47
- Missed: 1
- Adequacy: 85%

### Pager View (Mobile First)

**Layout:** Single column, large touch targets

**Content:**
- Top 3 items that MUST be acted on now:
  1. [Red] Overdue critical task (license-threatening)
  2. [Yellow] High-priority task nearing SLA
  3. [Green] Low-priority task to free up queue

**Actions per item:**
- Large "Complete" button (full width)
- "Defer" and "Escalate" as smaller buttons below

**Navigation:**
- "View Full Queue" link to `/admin/operations`
- "Mark All Complete" bulk action

---

## Security Architecture

### Authorization Matrix

| Action | owner | org_admin | coo | facility_admin | manager | Staff |
|---------|-------|-----------|-----|----------------|--------|-------|
| View tasks (own facility) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View tasks (all facilities) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Start/complete assigned task | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bulk complete (shift handoff) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Defer/escalate task | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Reassign task | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View staffing adequacy | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View templates | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/edit template | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View assets | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage assets | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### Audit Logging

Every state change in `operation_task_instances` writes to `operation_audit_log`:
- Task created
- Task assigned
- Task started
- Task completed
- Task missed
- Task escalated
- Task deferred
- Task cancelled
- Dual-sign completed

---

## Performance Design

- **Expected load:** 5–15 concurrent staff per facility. ~100 tasks/day per facility.
- **Caching:** React Query with 30s stale time for task lists. Real-time updates via Supabase realtime subscription on `operation_task_instances`.
- **Query optimization:** Indexes on `facility_id + assigned_shift_date + status`. Staffing adequacy snapshots materialized every 15 min, not query-computed.
- **Pagination:** Cursor-based for task lists (high volume). Offset-based for templates (low volume).

---

## COL Alignment Notes

### Facility-Specific Context

- **5 facilities**, each in **America/New_York** timezone
- **Pilot**: Oakridge ALF — 52 beds, ~94% occupancy
- **Shift times** (approximate, configurable per facility):
  - Day: 7AM–3PM
  - Evening: 3PM–11PM
  - Night: 11PM–7AM

### Regulatory References

- **AHCA 59A-36.004(2)**: Monthly fire safety inspections (license-threatening)
- **AHCA 59A-36.007**: Monthly medication storage audit (license-threatening)
- **AHCA 59A-36.006**: Quarterly disaster preparedness review
- **AHCA 59A-36.011**: Quarterly staff competency assessment
- **AHCA 59A-36.001**: Annual policy handbook review

### Role Mappings

- **Michelle Norris** → COO (`coo` role). Templates use `assignee_role='coo'`, never user ID.
- **Baya** → External medication training partner. Medication competency tasks note Baya-issued certificates separately.
- **Chad Croft** → Unknown vendor. Yearly rounds reference "hood cleaning" with Chad's name as text; DO NOT create vendor record. Flag as `vendor_match_pending`.

---

## Mission Alignment

**pass** — OCE generalizes COL's 9 admin logs into a unified, escalation-aware, shift-level task engine. This directly improves **staff clarity** (each shift knows exactly what to do) and **regulatory readiness** (license-threatening tasks have clear escalation paths and owner alerts). The staffing adequacy snapshot provides operational visibility into capacity gaps before they become problems.

---

## Out of Scope (S1)

- Module 28 (Financial Close & Fiduciary Pack) — Collections templates here, but trust reconciliation, month-end close, DSO projection are S8/S9.
- Module 29 (Risk & Survey Command) — License-threatening tasks surface here, but nightly risk score, owner alerts, AHCA survey bundle are S10/S11.
- Shift scheduling (Module 11) — OCE reads staff ratios, doesn't write schedules.
- Vendor contract management (Module 19) — OCE references vendors for bookings, doesn't manage contracts.
- Offline PWA (S13) — Mobile-optimized Today view, but no service-worker sync yet.
