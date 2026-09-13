BEGIN;
-- COL-150: read-only coverage projection. No assignment or reminder is activated.
CREATE FUNCTION haven.operation_attention_ownership(p_task_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; fr public.operation_facility_requirements;
 owner_id uuid; backup_id uuid; owner_current boolean; backup_current boolean;
BEGIN
 -- A guessed task id must reveal neither candidate identity nor eligibility.
 IF NOT coalesce(haven.operation_task_readable(p_task_id),false) THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task_id AND deleted_at IS NULL AND occurrence_kind IS NOT NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id AND organization_id=t.organization_id AND facility_id=t.facility_id AND activity_id=t.activity_id;
 owner_id:=coalesce(t.assigned_to,fr.owner_user_id);
 backup_id:=fr.backup_user_id;
 owner_current:=coalesce(haven.operation_reminder_recipient_current(owner_id,t.id),false);
 backup_current:=coalesce(haven.operation_reminder_recipient_current(backup_id,t.id),false);
 IF NOT coalesce(haven.operation_task_readable(p_task_id),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('owner_user_id',owner_id,'owner_role',coalesce(t.assigned_role,fr.owner_role::text),
  'owner_current',owner_current,'backup_user_id',backup_id,'backup_current',backup_current,
  'recipient_user_id',CASE WHEN owner_current THEN owner_id WHEN backup_current THEN backup_id ELSE NULL END,
  'coverage_current',owner_current OR backup_current,
  'coverage_source',CASE WHEN owner_current THEN 'primary' WHEN backup_current THEN 'approved_backup' ELSE 'none' END);
END $$;
REVOKE ALL ON FUNCTION haven.operation_attention_ownership(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_attention_ownership(uuid) TO authenticated;
CREATE FUNCTION public.haven_operation_attention_ownership(p_task_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_attention_ownership(p_task_id) $$;
REVOKE ALL ON FUNCTION public.haven_operation_attention_ownership(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.haven_operation_attention_ownership(uuid) TO authenticated;
CREATE VIEW public.operation_attention_occurrences WITH (security_invoker=true) AS
 SELECT t.*, public.haven_operation_attention_ownership(t.id) AS attention_ownership
 FROM public.operation_task_instances t WHERE t.deleted_at IS NULL AND t.occurrence_kind IS NOT NULL;
REVOKE ALL ON public.operation_attention_occurrences FROM PUBLIC,anon,service_role;
GRANT SELECT ON public.operation_attention_occurrences TO authenticated;
COMMENT ON VIEW public.operation_attention_occurrences IS 'COL-150: current authorized occurrences with primary/approved-backup eligibility from the existing reminder contract. A role alone never chooses a named person. No state changes.';
COMMIT;
