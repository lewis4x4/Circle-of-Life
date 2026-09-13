-- Integration reconcile for two independently reviewed protections on audit
-- export: Finance F01 (337_audit_export_scope_and_snapshot) materializes one
-- immutable CSV snapshot inside PostgreSQL, and COL-133 (344_hfo_current_authority)
-- restricts which audit_log rows a current actor may read and requires an
-- explicit, unexpired current site grant. The F01 materialization reads
-- public.audit_log as a definer, which would silently bypass the COL-133
-- restrictive policies and its site-grant model. This migration keeps both:
-- the snapshot contains exactly the rows the requesting actor could read under
-- the live RLS at materialization time, and every export step requires the
-- COL-133 current site grant in addition to the F01 scope check. The COL-133
-- Edge-side completion RPC is superseded by the snapshot path and can no
-- longer mark a job completed without evidence.
BEGIN;

-- Same predicate as the two COL-133 RESTRICTIVE policies on public.audit_log
-- (operation_generic_audit_current_read, operation_aggregate_audit_current).
-- review_audit_export_current_authority.sql asserts equivalence against RLS.
CREATE FUNCTION haven.operation_audit_row_current(a public.audit_log) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT (CASE WHEN a.table_name='operation_task_instances' THEN haven.operation_task_readable(a.record_id)
   AND coalesce(a.new_data->>'authority_class','unclassified')<>'unclassified'
   AND (a.old_data IS NULL OR coalesce(a.old_data->>'authority_class','unclassified')<>'unclassified')
   AND coalesce(a.new_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
   AND coalesce(a.old_data->'completion_evidence_paths','null'::jsonb) IN('null'::jsonb,'[]'::jsonb)
  WHEN a.table_name IN('operation_audit_log','operation_escalation_deliveries','operation_activity_subjects','operation_subject_access') THEN false
  WHEN a.table_name IN('meeting_action_items','workspace_cards') THEN false ELSE true END)
 AND a.table_name NOT IN('staffing_adequacy_snapshots','risk_score_snapshots','risk_owner_alert_deliveries','exec_alerts','operation_task_templates','operation_activities')
 AND (a.table_name<>'facility_assets' OR haven.operation_facility_access(a.facility_id))
$$;
REVOKE ALL ON FUNCTION haven.operation_audit_row_current(public.audit_log) FROM PUBLIC,anon,authenticated,service_role;

-- F01 scope (organization, role, legacy site access) AND COL-133 current site grant.
CREATE FUNCTION haven.can_export_audit_scope_current(p_organization_id uuid,p_facility_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT haven.can_export_audit_scope(p_organization_id,p_facility_id)
  AND (p_facility_id IS NULL OR haven.operation_facility_access(p_facility_id))
$$;
REVOKE ALL ON FUNCTION haven.can_export_audit_scope_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION haven.materialize_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.audit_log_export_jobs%ROWTYPE; v_actor uuid:=haven.authorized_user_id();
 v_csv text; v_count bigint; v_hash text;
BEGIN
 SELECT * INTO v_job FROM public.audit_log_export_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_actor IS NULL OR v_job.requested_by<>v_actor OR v_job.deleted_at IS NOT NULL
   OR NOT haven.can_export_audit_scope_current(v_job.organization_id,v_job.facility_id) THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM haven.audit_export_snapshots WHERE job_id=p_job_id) THEN
  RETURN jsonb_build_object('job_id',p_job_id,'status','completed');
 END IF;
 IF v_job.status NOT IN ('pending','failed') OR v_job.format<>'csv'
  OR (v_job.date_from IS NOT NULL AND v_job.date_to IS NOT NULL AND v_job.date_from>v_job.date_to) THEN
  RAISE EXCEPTION 'Audit export request is not actionable' USING ERRCODE='22023';
 END IF;
 -- One SELECT sees one MVCC snapshot. Rows are limited to what the requesting
 -- actor could read under the current RLS, including the COL-133 restrictions.
 SELECT count(*),
  'id,table_name,record_id,action,user_id,organization_id,facility_id,created_at,old_data,new_data,changed_fields,ip_address,user_agent'||E'\r\n'||
  coalesce(string_agg(
   haven.audit_export_csv_cell(a.id::text)||','||haven.audit_export_csv_cell(a.table_name)||','||
   haven.audit_export_csv_cell(a.record_id::text)||','||haven.audit_export_csv_cell(a.action)||','||
   haven.audit_export_csv_cell(a.user_id::text)||','||haven.audit_export_csv_cell(a.organization_id::text)||','||
   haven.audit_export_csv_cell(a.facility_id::text)||','||haven.audit_export_csv_cell(to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))||','||
   haven.audit_export_csv_cell(a.old_data::text)||','||haven.audit_export_csv_cell(a.new_data::text)||','||
   haven.audit_export_csv_cell(to_jsonb(a.changed_fields)::text)||','||haven.audit_export_csv_cell(a.ip_address::text)||','||
   haven.audit_export_csv_cell(a.user_agent)||E'\r\n','' ORDER BY a.created_at,a.id),'')
 INTO v_count,v_csv FROM public.audit_log a
 WHERE a.organization_id=v_job.organization_id
  AND (v_job.facility_id IS NULL OR a.facility_id=v_job.facility_id)
  AND (v_job.date_from IS NULL OR a.created_at>=v_job.date_from::timestamp AT TIME ZONE 'UTC')
  AND (v_job.date_to IS NULL OR a.created_at<(v_job.date_to+1)::timestamp AT TIME ZONE 'UTC')
  AND haven.operation_audit_row_current(a);
 v_hash:=encode(sha256(convert_to(v_csv,'UTF8')),'hex');
 -- Revalidate after expensive materialization; a revoked reader gets no bytes.
 IF NOT haven.can_export_audit_scope_current(v_job.organization_id,v_job.facility_id) OR haven.authorized_user_id() IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 INSERT INTO haven.audit_export_snapshots(job_id,csv_content,sha256_checksum,row_count) VALUES(p_job_id,v_csv,v_hash,v_count);
 UPDATE public.audit_log_export_jobs SET status='completed',sha256_checksum=v_hash,row_count=v_count,
  completed_at=clock_timestamp(),error_message=NULL WHERE id=p_job_id;
 INSERT INTO haven.audit_export_events(job_id,actor_id,session_id,event_type)
 VALUES(p_job_id,v_actor,(auth.jwt()->>'session_id')::uuid,'materialized');
 RETURN jsonb_build_object('job_id',p_job_id,'status','completed');
END $$;

CREATE OR REPLACE FUNCTION haven.retrieve_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.audit_log_export_jobs%ROWTYPE; v_snapshot haven.audit_export_snapshots%ROWTYPE;
 v_actor uuid:=haven.authorized_user_id();
BEGIN
 SELECT * INTO v_job FROM public.audit_log_export_jobs WHERE id=p_job_id;
 IF NOT FOUND OR v_actor IS NULL OR v_job.requested_by<>v_actor OR v_job.deleted_at IS NOT NULL
  OR NOT haven.can_export_audit_scope_current(v_job.organization_id,v_job.facility_id) THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_snapshot FROM haven.audit_export_snapshots WHERE job_id=p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audit export snapshot is unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO haven.audit_export_events(job_id,actor_id,session_id,event_type)
 VALUES(p_job_id,v_actor,(auth.jwt()->>'session_id')::uuid,'retrieved');
 RETURN jsonb_build_object('job_id',p_job_id,'csv_content',v_snapshot.csv_content,'sha256_checksum',v_snapshot.sha256_checksum,'row_count',v_snapshot.row_count);
END $$;

-- The snapshot path is the only completion path. The COL-133 Edge-side
-- completion command would otherwise mark a job completed with no evidence.
REVOKE EXECUTE ON FUNCTION haven.complete_audit_export_job(uuid),public.haven_complete_audit_export_job(uuid) FROM authenticated;

COMMIT;
