-- 107: Resident Assurance — missing FK indexes + RLS UPDATE policy for assignments

-- FK indexes on resident_observation_tasks
CREATE INDEX IF NOT EXISTS idx_obs_tasks_plan_id
  ON resident_observation_tasks (plan_id);
CREATE INDEX IF NOT EXISTS idx_obs_tasks_watch_instance_id
  ON resident_observation_tasks (watch_instance_id)
  WHERE watch_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_tasks_shift_assignment_id
  ON resident_observation_tasks (shift_assignment_id)
  WHERE shift_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_tasks_completed_log_id
  ON resident_observation_tasks (completed_log_id)
  WHERE completed_log_id IS NOT NULL;

-- FK indexes on resident_observation_exceptions
CREATE INDEX IF NOT EXISTS idx_obs_exceptions_log_id
  ON resident_observation_exceptions (log_id);

-- FK indexes on resident_observation_escalations
CREATE INDEX IF NOT EXISTS idx_obs_escalations_task_id
  ON resident_observation_escalations (task_id);

-- FK indexes on resident_observation_integrity_flags
CREATE INDEX IF NOT EXISTS idx_obs_integrity_log_id
  ON resident_observation_integrity_flags (log_id)
  WHERE log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_integrity_resident_id
  ON resident_observation_integrity_flags (resident_id)
  WHERE resident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_integrity_staff_id
  ON resident_observation_integrity_flags (staff_id)
  WHERE staff_id IS NOT NULL;

-- FK indexes on resident_watch_events
CREATE INDEX IF NOT EXISTS idx_watch_events_task_id
  ON resident_watch_events (task_id)
  WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_events_log_id
  ON resident_watch_events (log_id)
  WHERE log_id IS NOT NULL;

-- RLS: allow UPDATE on resident_observation_assignments for releasing (setting released_at)
CREATE POLICY roa_update_policy ON resident_observation_assignments
  FOR UPDATE
  USING (
    organization_id = (current_setting('request.jwt.claims', true)::json ->> 'organization_id')::uuid
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  )
  WITH CHECK (
    organization_id = (current_setting('request.jwt.claims', true)::json ->> 'organization_id')::uuid
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- Partial index for unique active assignment per task
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_assignments_active_per_task
  ON resident_observation_assignments (task_id, staff_id)
  WHERE released_at IS NULL;
