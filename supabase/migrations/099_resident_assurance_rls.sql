-- Resident Assurance Engine (Module 25) — RLS

CREATE OR REPLACE FUNCTION haven.current_staff_ids ()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    s.id
  FROM
    public.staff s
  WHERE
    s.user_id = auth.uid ()
    AND s.deleted_at IS NULL
    AND s.facility_id IN (
      SELECT
        haven.accessible_facility_ids ());
$func$;

CREATE OR REPLACE FUNCTION haven.can_manage_observation_facility (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
    AND p_facility_id IN (
      SELECT
        haven.accessible_facility_ids ());
$func$;

CREATE OR REPLACE FUNCTION haven.can_complete_observation_task (p_task_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.resident_observation_tasks t
      WHERE
        t.id = p_task_id
        AND t.deleted_at IS NULL
        AND t.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND (
          t.assigned_staff_id IN (
            SELECT
              haven.current_staff_ids ())
          OR EXISTS (
            SELECT
              1
            FROM
              public.resident_observation_assignments a
            WHERE
              a.task_id = t.id
              AND a.released_at IS NULL
              AND a.staff_id IN (
                SELECT
                  haven.current_staff_ids ()))));
$func$;

GRANT EXECUTE ON FUNCTION haven.current_staff_ids () TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.can_manage_observation_facility (uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION haven.can_complete_observation_task (uuid) TO authenticated, service_role;

ALTER TABLE resident_observation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_plans_select ON resident_observation_plans
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_plans_insert ON resident_observation_plans
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_observation_plans_update ON resident_observation_plans
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_manage_observation_facility (facility_id))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_observation_plan_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_plan_rules_select ON resident_observation_plan_rules
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_plan_rules_insert ON resident_observation_plan_rules
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_observation_plan_rules_update ON resident_observation_plan_rules
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_manage_observation_facility (facility_id))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_watch_protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_watch_protocols_select ON resident_watch_protocols
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_watch_protocols_insert ON resident_watch_protocols
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_watch_protocols_update ON resident_watch_protocols
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_manage_observation_facility (facility_id))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_watch_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_watch_instances_select ON resident_watch_instances
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_watch_instances_insert ON resident_watch_instances
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_watch_instances_update ON resident_watch_instances
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_manage_observation_facility (facility_id))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_observation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_tasks_select ON resident_observation_tasks
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL
    AND (
      haven.can_manage_observation_facility (facility_id)
      OR haven.can_complete_observation_task (id)));

CREATE POLICY resident_observation_tasks_insert ON resident_observation_tasks
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_observation_tasks_update ON resident_observation_tasks
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (
      haven.can_manage_observation_facility (facility_id)
      OR haven.can_complete_observation_task (id)))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE resident_observation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_logs_select ON resident_observation_logs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_logs_insert ON resident_observation_logs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (
      haven.can_manage_observation_facility (facility_id)
      OR (
        staff_id IN (
          SELECT
            haven.current_staff_ids ())
        AND haven.can_complete_observation_task (task_id))));

CREATE POLICY resident_observation_logs_update ON resident_observation_logs
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND (
      haven.can_manage_observation_facility (facility_id)
      OR created_by = auth.uid ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE resident_observation_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_exceptions_select ON resident_observation_exceptions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_exceptions_insert ON resident_observation_exceptions
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY resident_observation_exceptions_update ON resident_observation_exceptions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE resident_observation_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_assignments_select ON resident_observation_assignments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY resident_observation_assignments_insert ON resident_observation_assignments
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_observation_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_escalations_select ON resident_observation_escalations
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_escalations_insert ON resident_observation_escalations
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY resident_observation_escalations_update ON resident_observation_escalations
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE resident_observation_integrity_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_integrity_flags_select ON resident_observation_integrity_flags
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_integrity_flags_insert ON resident_observation_integrity_flags
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

CREATE POLICY resident_observation_integrity_flags_update ON resident_observation_integrity_flags
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_manage_observation_facility (facility_id))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.can_manage_observation_facility (facility_id));

ALTER TABLE resident_observation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_observation_templates_select ON resident_observation_templates
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ()))
    AND deleted_at IS NULL);

CREATE POLICY resident_observation_templates_insert ON resident_observation_templates
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      facility_id IS NULL
      OR haven.can_manage_observation_facility (facility_id)));

CREATE POLICY resident_observation_templates_update ON resident_observation_templates
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR haven.can_manage_observation_facility (facility_id)))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND (
      facility_id IS NULL
      OR haven.can_manage_observation_facility (facility_id)));

ALTER TABLE resident_watch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY resident_watch_events_select ON resident_watch_events
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY resident_watch_events_insert ON resident_watch_events
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));
