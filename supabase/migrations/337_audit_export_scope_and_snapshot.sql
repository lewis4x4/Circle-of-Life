-- F01: a facility export must never become an organization-wide service query.
-- Materialize once in PostgreSQL so REST row caps and concurrent source changes
-- cannot silently truncate or change the downloaded evidence. This protects
-- application roles; independent recovery anchoring remains a separate gate.
BEGIN;

CREATE FUNCTION haven.can_export_audit_scope(p_organization_id uuid,p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(p_organization_id=haven.organization_id()
  AND haven.app_role() IN ('owner','org_admin','facility_admin')
  AND CASE WHEN p_facility_id IS NULL THEN haven.app_role() IN ('owner','org_admin')
      ELSE haven.has_facility_access(p_facility_id) END,false)
$$;
REVOKE ALL ON FUNCTION haven.can_export_audit_scope(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.can_export_audit_scope(uuid,uuid) TO authenticated;

DROP POLICY audit_log_select_facility_admin ON public.audit_log;
CREATE POLICY audit_log_select_facility_admin ON public.audit_log FOR SELECT TO authenticated
 USING(organization_id=(SELECT haven.organization_id())
  AND (SELECT haven.app_role())='facility_admin'
  AND facility_id IS NOT NULL AND haven.has_facility_access(facility_id));

DROP POLICY audit_log_export_jobs_select ON public.audit_log_export_jobs;
DROP POLICY audit_log_export_jobs_insert ON public.audit_log_export_jobs;
DROP POLICY audit_log_export_jobs_update ON public.audit_log_export_jobs;
ALTER TABLE public.audit_log_export_jobs ALTER COLUMN row_count TYPE bigint;
CREATE POLICY audit_log_export_jobs_select ON public.audit_log_export_jobs FOR SELECT TO authenticated
 USING(deleted_at IS NULL AND haven.can_export_audit_scope(organization_id,facility_id));
CREATE POLICY audit_log_export_jobs_insert ON public.audit_log_export_jobs FOR INSERT TO authenticated
 WITH CHECK(haven.can_export_audit_scope(organization_id,facility_id)
  AND requested_by=haven.authorized_user_id() AND status='pending' AND format='csv'
  AND storage_path IS NULL AND sha256_checksum IS NULL AND row_count IS NULL
  AND error_message IS NULL AND completed_at IS NULL AND deleted_at IS NULL
  AND (date_from IS NULL OR date_to IS NULL OR date_from<=date_to));
REVOKE ALL ON public.audit_log_export_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.audit_log_export_jobs TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

CREATE TABLE haven.audit_export_snapshots (
 job_id uuid PRIMARY KEY REFERENCES public.audit_log_export_jobs(id),
 csv_content text NOT NULL,
 sha256_checksum text NOT NULL CHECK(sha256_checksum ~ '^[0-9a-f]{64}$'),
 row_count bigint NOT NULL CHECK(row_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE haven.audit_export_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES public.audit_log_export_jobs(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 session_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('requested','materialized','retrieved')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE haven.audit_export_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.audit_export_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.audit_export_snapshots,haven.audit_export_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.reject_audit_export_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 RAISE EXCEPTION 'Audit export evidence is immutable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION haven.reject_audit_export_evidence_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_export_snapshots_immutable BEFORE UPDATE OR DELETE ON haven.audit_export_snapshots
 FOR EACH ROW EXECUTE FUNCTION haven.reject_audit_export_evidence_mutation();
CREATE TRIGGER audit_export_events_immutable BEFORE UPDATE OR DELETE ON haven.audit_export_events
 FOR EACH ROW EXECUTE FUNCTION haven.reject_audit_export_evidence_mutation();

-- Effective SQL role, not request settings, gates writes even if a future grant
-- accidentally restores UPDATE to an application or integration role.
CREATE FUNCTION haven.guard_audit_export_job() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' AND current_user IN ('anon','authenticated','service_role') THEN
  RAISE EXCEPTION 'Use an authorized audit export command' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','sha256_checksum','row_count','error_message','completed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','sha256_checksum','row_count','error_message','completed_at']) THEN
  RAISE EXCEPTION 'Audit export request is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN NEW.created_at:=clock_timestamp(); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_audit_export_job() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_export_job_guard BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log_export_jobs
 FOR EACH ROW EXECUTE FUNCTION haven.guard_audit_export_job();

CREATE FUNCTION haven.record_audit_export_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=haven.authorized_user_id();
BEGIN
 IF v_actor IS NULL OR NEW.requested_by<>v_actor OR NOT haven.can_export_audit_scope(NEW.organization_id,NEW.facility_id) THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 INSERT INTO haven.audit_export_events(job_id,actor_id,session_id,event_type)
 VALUES(NEW.id,v_actor,(auth.jwt()->>'session_id')::uuid,'requested');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.record_audit_export_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_export_requested AFTER INSERT ON public.audit_log_export_jobs
 FOR EACH ROW EXECUTE FUNCTION haven.record_audit_export_request();

CREATE FUNCTION haven.audit_export_csv_cell(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '"'||replace(CASE WHEN p_value ~ '^[[:space:]]*[-=+@]' OR p_value ~ E'^[\\t\\r\\n]'
  THEN ''''||p_value ELSE coalesce(p_value,'') END,'"','""')||'"'
$$;
REVOKE ALL ON FUNCTION haven.audit_export_csv_cell(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.materialize_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.audit_log_export_jobs%ROWTYPE; v_actor uuid:=haven.authorized_user_id();
 v_csv text; v_count bigint; v_hash text;
BEGIN
 SELECT * INTO v_job FROM public.audit_log_export_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_actor IS NULL OR v_job.requested_by<>v_actor OR v_job.deleted_at IS NOT NULL
   OR NOT haven.can_export_audit_scope(v_job.organization_id,v_job.facility_id) THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM haven.audit_export_snapshots WHERE job_id=p_job_id) THEN
  RETURN jsonb_build_object('job_id',p_job_id,'status','completed');
 END IF;
 IF v_job.status NOT IN ('pending','failed') OR v_job.format<>'csv'
  OR (v_job.date_from IS NOT NULL AND v_job.date_to IS NOT NULL AND v_job.date_from>v_job.date_to) THEN
  RAISE EXCEPTION 'Audit export request is not actionable' USING ERRCODE='22023';
 END IF;
 -- One SELECT sees one MVCC snapshot. No REST paging/caps or live cursor.
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
  AND (v_job.date_to IS NULL OR a.created_at<(v_job.date_to+1)::timestamp AT TIME ZONE 'UTC');
 v_hash:=encode(sha256(convert_to(v_csv,'UTF8')),'hex');
 -- Revalidate after expensive materialization; a revoked reader gets no bytes.
 IF NOT haven.can_export_audit_scope(v_job.organization_id,v_job.facility_id) OR haven.authorized_user_id() IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 INSERT INTO haven.audit_export_snapshots(job_id,csv_content,sha256_checksum,row_count) VALUES(p_job_id,v_csv,v_hash,v_count);
 UPDATE public.audit_log_export_jobs SET status='completed',sha256_checksum=v_hash,row_count=v_count,
  completed_at=clock_timestamp(),error_message=NULL WHERE id=p_job_id;
 INSERT INTO haven.audit_export_events(job_id,actor_id,session_id,event_type)
 VALUES(p_job_id,v_actor,(auth.jwt()->>'session_id')::uuid,'materialized');
 RETURN jsonb_build_object('job_id',p_job_id,'status','completed');
END $$;

CREATE FUNCTION haven.retrieve_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.audit_log_export_jobs%ROWTYPE; v_snapshot haven.audit_export_snapshots%ROWTYPE;
 v_actor uuid:=haven.authorized_user_id();
BEGIN
 SELECT * INTO v_job FROM public.audit_log_export_jobs WHERE id=p_job_id;
 IF NOT FOUND OR v_actor IS NULL OR v_job.requested_by<>v_actor OR v_job.deleted_at IS NOT NULL
  OR NOT haven.can_export_audit_scope(v_job.organization_id,v_job.facility_id) THEN
  RAISE EXCEPTION 'Audit export not authorized' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_snapshot FROM haven.audit_export_snapshots WHERE job_id=p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audit export snapshot is unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO haven.audit_export_events(job_id,actor_id,session_id,event_type)
 VALUES(p_job_id,v_actor,(auth.jwt()->>'session_id')::uuid,'retrieved');
 RETURN jsonb_build_object('job_id',p_job_id,'csv_content',v_snapshot.csv_content,'sha256_checksum',v_snapshot.sha256_checksum,'row_count',v_snapshot.row_count);
END $$;

CREATE FUNCTION public.materialize_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.materialize_audit_export(p_job_id) $$;
CREATE FUNCTION public.retrieve_audit_export(p_job_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.retrieve_audit_export(p_job_id) $$;
REVOKE ALL ON FUNCTION haven.materialize_audit_export(uuid),haven.retrieve_audit_export(uuid),
 public.materialize_audit_export(uuid),public.retrieve_audit_export(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.materialize_audit_export(uuid),haven.retrieve_audit_export(uuid),
 public.materialize_audit_export(uuid),public.retrieve_audit_export(uuid) TO authenticated;

COMMIT;
