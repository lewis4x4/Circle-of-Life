-- Spec 25A, D12 recovery. The generator often ticks before the shift roster is
-- published, writes cadence tasks with no assignee, and raises a staffing gap.
-- When the roster appears on a later tick, those rows must pick up the resolved
-- assignee and get a primary assignment row; ON CONFLICT DO NOTHING left them
-- unworkable for caregivers under SYS-001.
--
-- Idempotency for tasks that already name an assignee is unchanged: the UPDATE
-- arm runs only when the stored assignee is still null and the payload names one.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_cadence_observation_tasks (p_rows jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_inserted integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cadence observation task payload must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  WITH upserted AS (
    INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, shift_assignment_id, assigned_staff_id, scheduled_for, due_at, grace_ends_at, status)
    SELECT
      r.organization_id,
      r.entity_id,
      r.facility_id,
      r.resident_id,
      r.cadence_version_id,
      r.window_key,
      r.service_date,
      r.shift_assignment_id,
      r.assigned_staff_id,
      r.scheduled_for,
      r.due_at,
      r.grace_ends_at,
      COALESCE(r.status, 'upcoming')::public.resident_observation_task_status
    FROM
      jsonb_to_recordset(p_rows) AS r (organization_id uuid, entity_id uuid, facility_id uuid, resident_id uuid, cadence_version_id uuid, window_key text, service_date date, shift_assignment_id uuid, assigned_staff_id uuid, scheduled_for timestamptz, due_at timestamptz, grace_ends_at timestamptz, status text)
    ON CONFLICT (resident_id, window_key, service_date)
      WHERE deleted_at IS NULL AND window_key IS NOT NULL
      DO UPDATE SET
        shift_assignment_id = EXCLUDED.shift_assignment_id,
        assigned_staff_id = EXCLUDED.assigned_staff_id
      WHERE
        resident_observation_tasks.assigned_staff_id IS NULL
        AND EXCLUDED.assigned_staff_id IS NOT NULL
    RETURNING
      id, organization_id, entity_id, facility_id, resident_id, shift_assignment_id, assigned_staff_id
),
  assigned AS (
  INSERT INTO public.resident_observation_assignments (organization_id, entity_id, facility_id, resident_id, task_id, shift_assignment_id, staff_id, assignment_type)
  SELECT
    u.organization_id,
    u.entity_id,
    u.facility_id,
    u.resident_id,
    u.id,
    u.shift_assignment_id,
    u.assigned_staff_id,
    'primary'::public.resident_observation_assignment_type
  FROM
    upserted u
  WHERE
    u.assigned_staff_id IS NOT NULL
  ON CONFLICT (task_id, staff_id)
    WHERE released_at IS NULL
    DO NOTHING
  RETURNING
    id
)
  SELECT
    count(*)::integer INTO v_inserted
  FROM
    upserted;

  RETURN v_inserted;
END;
$func$;

COMMENT ON FUNCTION public.record_cadence_observation_tasks (jsonb) IS
  'Inserts generated facility cadence tasks, ignoring any that already exist for the same resident, window and service date unless the stored task still has no assignee and the payload names one, in which case it backfills shift_assignment_id and assigned_staff_id and writes the primary resident_observation_assignments row. A second generator run with the same assignees inserts nothing and assigns nothing. The assignment row is what lets a caregiver complete the check through the assignment path rather than only through assigned_staff_id.';

NOTIFY pgrst,
'reload schema';

COMMIT;
