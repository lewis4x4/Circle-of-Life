-- Phase 3.5-D: care-plan-billing-version-lock (Module 03 Advanced)

ALTER TABLE care_plans
  ADD COLUMN billing_snapshot_hash text;

COMMENT ON COLUMN care_plans.billing_snapshot_hash IS 'Hash of rate terms used for billing alignment when plan changes.';

CREATE TABLE care_plan_change_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  care_plan_id uuid NOT NULL REFERENCES care_plans (id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  trigger_assessment_id uuid REFERENCES assessments (id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  title text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_care_plan_change_tasks_plan ON care_plan_change_tasks (care_plan_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE care_plan_change_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY care_plan_change_tasks_clinical ON care_plan_change_tasks
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ());

CREATE TRIGGER tr_care_plan_change_tasks_set_updated_at
  BEFORE UPDATE ON care_plan_change_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_care_plan_change_tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON care_plan_change_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
