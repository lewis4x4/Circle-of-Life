CREATE OR REPLACE FUNCTION public.bulk_complete_operation_tasks(
  p_task_ids uuid[],
  p_actor_id uuid,
  p_actor_role text,
  p_completion_notes text,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS TABLE(task_instance_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH input_ids AS (
    SELECT DISTINCT unnest(p_task_ids) AS id
  ),
  candidates AS (
    SELECT
      oti.id,
      oti.organization_id,
      oti.facility_id,
      oti.status,
      (oti.due_at IS NULL OR oti.due_at >= p_completed_at) AS sla_met
    FROM operation_task_instances oti
    INNER JOIN input_ids ids ON ids.id = oti.id
    WHERE oti.deleted_at IS NULL
  ),
  audit_insert AS (
    INSERT INTO operation_audit_log AS oal (
      organization_id,
      facility_id,
      task_instance_id,
      event_type,
      from_status,
      to_status,
      actor_id,
      actor_role,
      event_notes,
      event_data,
      created_at
    )
    SELECT
      c.organization_id,
      c.facility_id,
      c.id,
      'completed',
      c.status,
      'completed',
      p_actor_id,
      p_actor_role,
      COALESCE(NULLIF(p_completion_notes, ''), 'Bulk completed (end of shift)'),
      jsonb_build_object('bulk_complete', true, 'sla_met', c.sla_met),
      p_completed_at
    FROM candidates c
    RETURNING oal.task_instance_id
  ),
  updated AS (
    UPDATE operation_task_instances oti
    SET
      status = 'completed',
      completed_at = p_completed_at,
      completion_notes = COALESCE(NULLIF(p_completion_notes, ''), 'End of shift bulk complete'),
      verified_by = p_actor_id,
      verified_at = p_completed_at,
      sla_met = c.sla_met,
      sla_miss_reason = CASE WHEN c.sla_met THEN NULL ELSE 'Completed after due time' END,
      updated_at = p_completed_at,
      updated_by = p_actor_id
    FROM candidates c
    INNER JOIN audit_insert ai ON ai.task_instance_id = c.id
    WHERE oti.id = c.id
    RETURNING oti.id
  )
  SELECT updated.id AS task_instance_id
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_complete_operation_tasks(uuid[], uuid, text, text, timestamptz) TO service_role;
