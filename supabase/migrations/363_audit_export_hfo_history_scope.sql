-- Keep immutable Finance exports aligned with all HFO generic-audit restrictions
-- introduced after the initial authority reconcile. Generic payloads may include
-- evidence paths, draft arguments and protected subject data.
-- Future restrictive audit policies must extend this predicate and the full-RLS
-- parity probe before a definer export can include the new table.
BEGIN;
CREATE OR REPLACE FUNCTION haven.operation_audit_row_current(a public.audit_log) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT (CASE WHEN a.table_name='operation_task_instances' THEN haven.operation_task_readable(a.record_id)
   AND coalesce(a.new_data->>'authority_class','unclassified')<>'unclassified'
   AND (a.old_data IS NULL OR coalesce(a.old_data->>'authority_class','unclassified')<>'unclassified')
   AND coalesce(a.new_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
   AND coalesce(a.old_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
  WHEN a.table_name IN('operation_audit_log','operation_escalation_deliveries','operation_activity_subjects','operation_subject_access') THEN false
  WHEN a.table_name IN('meeting_action_items','workspace_cards') THEN false ELSE true END)
 AND a.table_name NOT IN('staffing_adequacy_snapshots','risk_score_snapshots','risk_owner_alert_deliveries','exec_alerts','operation_task_templates','operation_activities')
 AND a.table_name NOT IN('operation_execution_receipts','operation_issues','operation_activity_bindings','operation_occurrence_associations','operation_issue_events','operation_evidence','operation_evidence_events','operation_command_drafts','operation_source_events','operation_source_event_attempts','operation_source_adapters','operation_source_rules','operation_source_record_requests','operation_reminder_responses','operation_escalation_deliveries')
 AND (a.table_name<>'facility_assets' OR haven.operation_facility_access(a.facility_id))
$$;
REVOKE ALL ON FUNCTION haven.operation_audit_row_current(public.audit_log) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
