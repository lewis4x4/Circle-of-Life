-- Care Planning Advanced (Phase 2, spec 03-resident-profile-advanced)
-- New tables: care_plan_tasks, care_plan_review_alerts
-- New index: one active care plan per resident (DB enforcement)

-- ============================================================
-- CARE PLAN TASKS (generated from active care_plan_items)
-- ============================================================
CREATE TABLE care_plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  care_plan_item_id uuid NOT NULL REFERENCES care_plan_items (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  -- Scheduling
  task_date date NOT NULL,
  scheduled_time time,
  shift shift_type,

  -- Content (denormalized from care_plan_item for mobile perf)
  category care_plan_item_category NOT NULL,
  title text NOT NULL,
  description text,
  assistance_level assistance_level NOT NULL,

  -- Completion
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'skipped', 'unable')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users (id),
  completion_notes text,
  skip_reason text,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_cpt_resident_date ON care_plan_tasks (resident_id, task_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_facility_date ON care_plan_tasks (facility_id, task_date, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_cpt_assignee_date ON care_plan_tasks (facility_id, task_date, shift)
  WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_cpt_item ON care_plan_tasks (care_plan_item_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- CARE PLAN REVIEW ALERTS (system-generated review prompts)
-- ============================================================
CREATE TABLE care_plan_review_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  care_plan_id uuid NOT NULL REFERENCES care_plans (id),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  -- Trigger
  trigger_type text NOT NULL
    CHECK (trigger_type IN (
      'quarterly_due',
      'quarterly_overdue',
      'acuity_change',
      'fall_incident',
      'hospital_return',
      'condition_change',
      'assessment_threshold',
      'family_request'
    )),
  trigger_detail text,
  trigger_source_id uuid,

  -- Resolution
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_by uuid REFERENCES auth.users (id),
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolved_at timestamptz,
  resolution_notes text,

  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_cpra_facility_status ON care_plan_review_alerts (facility_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_cpra_resident ON care_plan_review_alerts (resident_id)
  WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX idx_cpra_care_plan ON care_plan_review_alerts (care_plan_id)
  WHERE deleted_at IS NULL;

-- Deduplicate: one open alert per care_plan + trigger_type at a time
CREATE UNIQUE INDEX idx_cpra_dedup ON care_plan_review_alerts (care_plan_id, trigger_type)
  WHERE deleted_at IS NULL AND status IN ('open', 'acknowledged');

-- ============================================================
-- DB-LEVEL ENFORCEMENT on existing care_plans table
-- ============================================================

-- Only one active care plan per resident
CREATE UNIQUE INDEX idx_care_plans_one_active_per_resident ON care_plans (resident_id)
  WHERE deleted_at IS NULL AND status = 'active';

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE care_plan_tasks ENABLE ROW LEVEL SECURITY;

-- Clinical staff can see tasks in accessible facilities
CREATE POLICY staff_see_care_plan_tasks ON care_plan_tasks
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'broker', 'dietary', 'maintenance_role'));

-- Operational staff (nurse + caregiver) complete tasks
CREATE POLICY operational_staff_complete_care_plan_tasks ON care_plan_tasks
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('nurse', 'caregiver'));

-- Admin override for data corrections (not surfaced as primary workflow)
CREATE POLICY admin_override_care_plan_tasks ON care_plan_tasks
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

-- Tasks are system-generated: INSERT via service_role only (no user INSERT policy)

ALTER TABLE care_plan_review_alerts ENABLE ROW LEVEL SECURITY;

-- Clinical staff can see review alerts
CREATE POLICY staff_see_review_alerts ON care_plan_review_alerts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () NOT IN ('family', 'broker', 'dietary', 'maintenance_role'));

-- Nurse+ can manage (acknowledge/resolve/dismiss) review alerts
CREATE POLICY nurse_plus_manage_review_alerts ON care_plan_review_alerts
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- Alerts are system-generated: INSERT via service_role only

-- ============================================================
-- AUDIT + updated_at (Haven helpers from 006_audit_triggers.sql)
-- ============================================================

CREATE TRIGGER tr_care_plan_tasks_set_updated_at
  BEFORE UPDATE ON care_plan_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_care_plan_tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON care_plan_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_care_plan_review_alerts_audit
  AFTER INSERT OR UPDATE OR DELETE ON care_plan_review_alerts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
