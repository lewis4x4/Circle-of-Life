-- COL v2 Slice 4: operational execution logs missing from the existing OCE/compliance modules.
-- Existing operation_task_templates/instances remain the cadence engine; these tables capture work orders and evidence logs.

CREATE TABLE IF NOT EXISTS public.maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  asset_id uuid REFERENCES public.facility_assets(id),
  submitted_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id),
  asset_description text NOT NULL,
  issue_description text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  assigned_type text CHECK (assigned_type IN ('internal', 'external_vendor')),
  assigned_to_user_id uuid REFERENCES public.user_profiles(id),
  assigned_to_vendor_name text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
  resolution_notes text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CHECK (
    (assigned_type IS NULL AND assigned_to_user_id IS NULL AND assigned_to_vendor_name IS NULL)
    OR (assigned_type = 'internal' AND assigned_to_user_id IS NOT NULL AND assigned_to_vendor_name IS NULL)
    OR (assigned_type = 'external_vendor' AND assigned_to_user_id IS NULL AND assigned_to_vendor_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_facility_status
  ON public.maintenance_tickets(facility_id, status, opened_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_assigned_user
  ON public.maintenance_tickets(assigned_to_user_id, status)
  WHERE deleted_at IS NULL AND assigned_to_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.maintenance_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  task_type text NOT NULL CHECK (task_type ~ '^[a-z0-9_]+$'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by_user_id uuid REFERENCES public.user_profiles(id),
  completed_by_vendor text,
  notes text,
  evidence_url text,
  evidence_storage_path text,
  related_ticket_id uuid REFERENCES public.maintenance_tickets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (completed_by_user_id IS NOT NULL OR completed_by_vendor IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_maint_completions_facility_type_date
  ON public.maintenance_task_completions(facility_id, task_type, completed_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.drill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  drill_type text NOT NULL CHECK (drill_type IN ('fire', 'elopement', 'tornado')),
  drill_date date NOT NULL,
  drill_time time NOT NULL,
  pull_station_activated boolean NOT NULL DEFAULT false,
  staff_present_count integer CHECK (staff_present_count IS NULL OR staff_present_count >= 0),
  residents_present_count integer CHECK (residents_present_count IS NULL OR residents_present_count >= 0),
  conducted_by uuid REFERENCES public.user_profiles(id),
  notes text,
  evidence_url text,
  evidence_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  UNIQUE (facility_id, drill_type, drill_date, drill_time)
);

CREATE INDEX IF NOT EXISTS idx_drill_log_facility_type_date
  ON public.drill_log(facility_id, drill_type, drill_date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.meal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  meal_date date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
  status text NOT NULL CHECK (status IN ('ate', 'partial', 'refused', 'out_of_facility', 'not_observed')),
  intake_percent integer CHECK (intake_percent IS NULL OR intake_percent BETWEEN 0 AND 100),
  notes text,
  recorded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  UNIQUE (resident_id, meal_date, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_logs_facility_date
  ON public.meal_logs(facility_id, meal_date DESC, meal_type)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.snack_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  snack_at timestamptz NOT NULL,
  passed_by_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id),
  snack_description text,
  residents_offered_count integer CHECK (residents_offered_count IS NULL OR residents_offered_count >= 0),
  residents_accepted_count integer CHECK (residents_accepted_count IS NULL OR residents_accepted_count >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (
    residents_offered_count IS NULL
    OR residents_accepted_count IS NULL
    OR residents_accepted_count <= residents_offered_count
  )
);

CREATE INDEX IF NOT EXISTS idx_snack_logs_facility_date
  ON public.snack_logs(facility_id, snack_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drill_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snack_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_tickets_select ON public.maintenance_tickets;
CREATE POLICY maintenance_tickets_select ON public.maintenance_tickets
  FOR SELECT TO authenticated
  USING (organization_id = haven.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS maintenance_tickets_insert ON public.maintenance_tickets;
CREATE POLICY maintenance_tickets_insert ON public.maintenance_tickets
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS maintenance_tickets_update ON public.maintenance_tickets;
CREATE POLICY maintenance_tickets_update ON public.maintenance_tickets
  FOR UPDATE TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (submitted_by = auth.uid() OR assigned_to_user_id = auth.uid() OR haven.app_role() IN ('owner','org_admin','facility_admin','manager','maintenance_role'))
  )
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS maintenance_task_completions_access ON public.maintenance_task_completions;
CREATE POLICY maintenance_task_completions_access ON public.maintenance_task_completions
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS drill_log_access ON public.drill_log;
CREATE POLICY drill_log_access ON public.drill_log
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS meal_logs_access ON public.meal_logs;
CREATE POLICY meal_logs_access ON public.meal_logs
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DROP POLICY IF EXISTS snack_logs_access ON public.snack_logs;
CREATE POLICY snack_logs_access ON public.snack_logs
  FOR ALL TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids()));

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['maintenance_tickets','maintenance_task_completions','drill_log','meal_logs','snack_logs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_set_updated_at ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at()', v_table, v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_audit ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log()', v_table, v_table);
  END LOOP;
END $$;

WITH rule_seed AS (
  SELECT
    f.organization_id,
    f.id AS facility_id,
    v.tag_number,
    v.tag_title,
    v.rule_description,
    v.check_query,
    v.severity
  FROM public.facilities f
  CROSS JOIN (VALUES
    ('COL-MAINT-001', 'Quarterly Grease Trap Cleaning', 'Grease trap cleaning evidence must be logged at least quarterly.', 'SELECT id FROM maintenance_task_completions WHERE facility_id = {facility_id} AND task_type = ''grease_trap'' AND completed_at > now() - interval ''3 months'' AND deleted_at IS NULL', 'standard'),
    ('COL-MAINT-002', 'Monthly Leak Check', 'Building leak inspection evidence must be logged monthly.', 'SELECT id FROM maintenance_task_completions WHERE facility_id = {facility_id} AND task_type = ''leak_check'' AND completed_at > now() - interval ''1 month'' AND deleted_at IS NULL', 'standard'),
    ('COL-MAINT-003', 'Monthly AC Filter Change', 'AC filter change evidence must be logged monthly.', 'SELECT id FROM maintenance_task_completions WHERE facility_id = {facility_id} AND task_type = ''ac_filter'' AND completed_at > now() - interval ''1 month'' AND deleted_at IS NULL', 'standard'),
    ('COL-DRILL-001', 'Annual Fire Drill Count', 'Facility should maintain at least 6 fire drills in the current calendar year.', 'SELECT facility_id FROM drill_log WHERE facility_id = {facility_id} AND drill_type = ''fire'' AND EXTRACT(YEAR FROM drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) AND deleted_at IS NULL GROUP BY facility_id HAVING COUNT(*) >= 6', 'serious'),
    ('COL-DRILL-002', 'Annual Elopement Drill Count', 'Facility should maintain at least 2 elopement drills in the current calendar year.', 'SELECT facility_id FROM drill_log WHERE facility_id = {facility_id} AND drill_type = ''elopement'' AND EXTRACT(YEAR FROM drill_date) = EXTRACT(YEAR FROM CURRENT_DATE) AND deleted_at IS NULL GROUP BY facility_id HAVING COUNT(*) >= 2', 'serious')
  ) AS v(tag_number, tag_title, rule_description, check_query, severity)
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
)
INSERT INTO public.compliance_rules (
  organization_id,
  facility_id,
  tag_number,
  tag_title,
  rule_description,
  check_query,
  severity,
  enabled
)
SELECT organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity, true
FROM rule_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.compliance_rules cr
  WHERE cr.facility_id = s.facility_id
    AND cr.tag_number = s.tag_number
    AND cr.deleted_at IS NULL
);

COMMENT ON TABLE public.maintenance_tickets IS 'COL maintenance work-order tickets. OCE handles scheduled cadence; this table captures ad hoc issues and assignment/resolution evidence.';
COMMENT ON TABLE public.maintenance_task_completions IS 'Evidence log for scheduled maintenance completions such as grease trap, leak checks, and AC filters.';
COMMENT ON TABLE public.drill_log IS 'Fire, elopement, and tornado drill evidence log for launch/readiness compliance.';
COMMENT ON TABLE public.meal_logs IS 'Per-resident meal observation log for dietary intake/refusal/out-of-facility status.';
COMMENT ON TABLE public.snack_logs IS 'Facility-level snack pass log for operational proof that snack rounds occurred.';
