BEGIN;
-- Read-only native employee evidence inputs with explicit HFO refresh history.
-- No native employee/clinical trigger or employment action is introduced.
CREATE FUNCTION haven.employee_source_context(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; s public.operation_activity_subjects; a public.operation_activities; tz text;
BEGIN
 IF haven.authorized_user_id() IS NULL OR NOT coalesce(haven.operation_task_readable(p_task),false) THEN RAISE EXCEPTION 'Employee source scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 SELECT * INTO a FROM public.operation_activities WHERE id=t.activity_id;
 SELECT coalesce(timezone,'America/New_York') INTO tz FROM public.facilities WHERE id=t.facility_id;
 IF a.activity_key NOT IN('hfo-al-d13-01','hfo-al-d15-01','hfo-al-w02-01','hfo-al-w06-01','hfo-al-w06-02','hfo-al-a10-01','hfo-al-a11-01','hfo-al-a11-02','hfo-al-e01-01','hfo-al-e02-01','hfo-al-e03-01','hfo-al-e04-01','hfo-al-e05-01','hfo-al-e06-01','hfo-al-e07-01','hfo-al-e08-01','hfo-al-e09-01','hfo-al-e10-01','hfo-al-e11-01','hfo-al-e12-01','hfo-al-e13-01','hfo-al-e14-01') THEN RAISE EXCEPTION 'Employee source scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('task_id',t.id,'activity_key',a.activity_key,'employee_id',CASE WHEN s.subject_kind='employee' THEN s.employee_id END,
 'organization_id',t.organization_id,'facility_id',t.facility_id,'timezone',tz,
 'can_medical',coalesce(haven.operation_domain_access(t.organization_id,t.facility_id,'employee_medical') AND haven.employee_medical_reader(t.organization_id,t.facility_id),false));
END $$;
REVOKE ALL ON FUNCTION haven.employee_source_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.employee_source_context(uuid) TO authenticated;

CREATE FUNCTION public.read_employee_operation_source_input(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; s record; medical boolean; today date; requirements jsonb; records jsonb; signatures jsonb; source_hash text; state_hash text;
BEGIN
 c:=haven.employee_source_context(p_task); today:=(clock_timestamp() AT TIME ZONE (c->>'timezone'))::date;
 SELECT p.*,(c->>'organization_id')::uuid organization_id INTO s FROM public.haven_employee_file_staff((c->>'employee_id')::uuid) p WHERE p.id=(c->>'employee_id')::uuid AND p.facility_id=(c->>'facility_id')::uuid;
 IF NOT FOUND OR NOT (haven.employee_manager() OR s.user_id=haven.authorized_user_id() OR haven.employee_medical_reader(s.organization_id,s.facility_id)) THEN
  RETURN jsonb_build_object('task_id',p_task,'activity_key',c->>'activity_key','employee_id',NULL,'as_of',today,'availability','unavailable','reason','This component has no currently readable employee source. Keep the native/manual workflow and unresolved mapping.',
  'can_medical',false,'can_open_employee_file',false,'source_version',NULL,'state_version',NULL,'staff',NULL,'requirements','[]'::jsonb,'records','[]'::jsonb,'history','[]'::jsonb,'complete',false);
 END IF;
 medical:=coalesce((c->>'can_medical')::boolean,false);
 -- Native SELECT/RLS plus explicit sensitivity union; draft category labels
 -- cannot downgrade TB/communicable-disease information to personnel access.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'code',q.code,'title',q.title,'version',q.version,'category',q.category,
 'source_file',q.source_file,'source_page',q.source_page,'source_excerpt','','content','','review_status',q.review_status,'review_note',NULL,
 'due_days',q.due_days,'recurrence_months',q.recurrence_months,'recurrence_status',q.recurrence_status,'duty',q.duty,'required_signers',q.required_signers,
 'applies_to_staff_roles',q.applies_to_staff_roles,'minimum_completions',q.minimum_completions,'minimum_distinct_days',q.minimum_distinct_days) ORDER BY q.code,q.version),'[]'::jsonb)
 INTO requirements FROM public.employee_file_requirements q WHERE q.organization_id=s.organization_id AND q.facility_id=s.facility_id AND q.deleted_at IS NULL
 AND (medical OR (q.category<>'medical' AND q.code NOT IN('TRN-25','TRN-26','DOC-037','DOC-038','DOC-039','DOC-040')));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'requirement_id',r.requirement_id,'staff_id',r.staff_id,'status',r.status,
 'completed_on',r.completed_on,'expires_on',r.expires_on,'notes',NULL,'evidence_reference',NULL,'storage_path',NULL,
 'created_at',r.created_at,'reviewed_by',r.reviewed_by,'review_note',NULL) ORDER BY r.id),'[]'::jsonb) INTO records
 FROM public.employee_file_records r JOIN public.employee_file_requirements q ON q.id=r.requirement_id
 WHERE r.staff_id=s.id AND r.organization_id=s.organization_id AND r.facility_id=s.facility_id AND r.deleted_at IS NULL AND q.deleted_at IS NULL
 AND haven.employee_record_readable(r.id) AND (medical OR (q.category<>'medical' AND q.code NOT IN('TRN-25','TRN-26','DOC-037','DOC-038','DOC-039','DOC-040')));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',sig.id,'record_id',sig.record_id,'purpose',sig.functional_role,'snapshot',sig.record_snapshot_hash) ORDER BY sig.id),'[]'::jsonb)
 INTO signatures FROM public.employee_file_signatures sig WHERE sig.record_id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(records) x);
 source_hash:=encode(sha256(convert_to(jsonb_build_object('requirements',requirements,'records',records,'signatures',signatures,'role',s.staff_role,'hire',s.hire_date,'employment',s.employment_status)::text,'UTF8')),'hex');
 state_hash:=encode(sha256(convert_to(jsonb_build_object('source',source_hash,'medical',medical,
 'dates',(SELECT jsonb_agg(jsonb_build_object('id',x->>'id','completed',coalesce((x->>'completed_on')::date<=today,false),'expired',coalesce((x->>'expires_on')::date<today,false)) ORDER BY x->>'id') FROM jsonb_array_elements(records) x),
 'due',(SELECT jsonb_agg(jsonb_build_object('id',x->>'id','past_due',CASE WHEN x->>'due_days' IS NOT NULL THEN s.hire_date+(x->>'due_days')::integer<today ELSE false END) ORDER BY x->>'id') FROM jsonb_array_elements(requirements) x))::text,'UTF8')),'hex');
 c:=haven.employee_source_context(p_task);
 IF medical IS DISTINCT FROM (c->>'can_medical')::boolean OR s.id IS DISTINCT FROM (c->>'employee_id')::uuid
 OR s.facility_id IS DISTINCT FROM (c->>'facility_id')::uuid OR s.organization_id IS DISTINCT FROM (c->>'organization_id')::uuid THEN RAISE EXCEPTION 'Employee medical scope changed' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('task_id',p_task,'activity_key',c->>'activity_key','employee_id',s.id,'as_of',today,'availability','available','reason',CASE WHEN NOT medical THEN 'Medical source values are unavailable without both current medical scopes.' END,
 'can_medical',medical,'can_open_employee_file',true,'source_version',source_hash,'state_version',state_hash,
 'staff',jsonb_build_object('id',s.id,'first_name','','last_name','','staff_role',s.staff_role,'hire_date',s.hire_date,'employment_status',s.employment_status,'facility_id',s.facility_id,'user_id',s.user_id),
 'requirements',requirements,'records',records,'history','[]'::jsonb,'complete',true);
END $$;
REVOKE ALL ON FUNCTION public.read_employee_operation_source_input(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_employee_operation_source_input(uuid) TO authenticated;

CREATE TABLE haven.employee_source_transitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id), medical_scope boolean NOT NULL,
 source_version text NOT NULL, state_version text NOT NULL, observed_at timestamptz NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY,
 UNIQUE(task_id,actor_id,medical_scope,sequence)
);
CREATE TABLE haven.employee_source_requests (
 request_key text NOT NULL,actor_id uuid NOT NULL REFERENCES public.user_profiles(id),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 transition_id uuid NOT NULL REFERENCES haven.employee_source_transitions(id),PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE haven.employee_source_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.employee_source_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.employee_source_transitions,haven.employee_source_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.employee_source_transitions,haven.employee_source_requests TO authenticated;
CREATE POLICY employee_source_transition_select ON haven.employee_source_transitions FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id)
 AND medical_scope=coalesce((public.read_employee_operation_source_input(task_id)->>'can_medical')::boolean,false)
 AND public.read_employee_operation_source_input(task_id)->>'availability'='available');
CREATE POLICY employee_source_transition_insert ON haven.employee_source_transitions FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id));
CREATE POLICY employee_source_request_select ON haven.employee_source_requests FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id));
CREATE POLICY employee_source_request_insert ON haven.employee_source_requests FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND EXISTS(SELECT 1 FROM haven.employee_source_transitions t WHERE t.id=transition_id AND t.task_id=employee_source_requests.task_id));

CREATE FUNCTION haven.guard_employee_source_transition() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb; previous haven.employee_source_transitions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Employee source history is immutable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('employee-source:'||NEW.task_id::text||':'||haven.authorized_user_id()::text,0));
 input:=public.read_employee_operation_source_input(NEW.task_id);
 IF input->>'availability'<>'available' THEN RAISE EXCEPTION 'Employee source unavailable' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=haven.authorized_user_id(); NEW.medical_scope:=(input->>'can_medical')::boolean;
 NEW.source_version:=input->>'source_version'; NEW.state_version:=input->>'state_version'; NEW.observed_at:=clock_timestamp();
 SELECT * INTO previous FROM haven.employee_source_transitions WHERE task_id=NEW.task_id AND actor_id=NEW.actor_id AND medical_scope=NEW.medical_scope ORDER BY sequence DESC LIMIT 1;
 IF FOUND AND previous.state_version=NEW.state_version THEN RETURN NULL; END IF;
 NEW.sequence:=coalesce(previous.sequence,0)+1;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_employee_source_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER employee_source_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.employee_source_transitions FOR EACH ROW EXECUTE FUNCTION haven.guard_employee_source_transition();
CREATE TRIGGER employee_source_transition_no_truncate BEFORE TRUNCATE ON haven.employee_source_transitions FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_employee_source_transition();
CREATE FUNCTION haven.guard_employee_source_request() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb; latest haven.employee_source_transitions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Employee source request history is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('employee-source:'||NEW.task_id::text||':'||haven.authorized_user_id()::text,0));
 input:=public.read_employee_operation_source_input(NEW.task_id);
 SELECT * INTO latest FROM haven.employee_source_transitions WHERE task_id=NEW.task_id AND actor_id=haven.authorized_user_id()
 AND medical_scope=(input->>'can_medical')::boolean ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR input->>'availability'<>'available' OR latest.state_version IS DISTINCT FROM input->>'state_version' THEN RAISE EXCEPTION 'Current source transition required' USING ERRCODE='42501'; END IF;
 NEW.transition_id:=latest.id; NEW.actor_id:=haven.authorized_user_id(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_employee_source_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER employee_source_request_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.employee_source_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_employee_source_request();
CREATE TRIGGER employee_source_request_no_truncate BEFORE TRUNCATE ON haven.employee_source_requests FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_employee_source_request();

CREATE FUNCTION public.employee_operation_source_snapshot(p_task uuid,p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb; prior haven.employee_source_requests; transition uuid; history jsonb;
BEGIN
 IF p_request_key IS NOT NULL THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('employee-source-request:'||haven.authorized_user_id()::text||':'||p_request_key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('employee-source:'||p_task::text||':'||haven.authorized_user_id()::text,0));
 END IF;
 input:=public.read_employee_operation_source_input(p_task);
 IF p_request_key IS NOT NULL THEN
  IF input->>'availability'<>'available' THEN RAISE EXCEPTION 'Employee source unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM haven.employee_source_requests WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
  IF FOUND THEN
   IF prior.task_id<>p_task THEN RAISE EXCEPTION 'Request key scope conflict' USING ERRCODE='23505'; END IF;
  ELSE
   INSERT INTO haven.employee_source_transitions(task_id) VALUES(p_task) RETURNING id INTO transition;
   IF transition IS NULL THEN SELECT id INTO transition FROM haven.employee_source_transitions WHERE task_id=p_task AND actor_id=haven.authorized_user_id() AND medical_scope=(input->>'can_medical')::boolean ORDER BY sequence DESC LIMIT 1; END IF;
   INSERT INTO haven.employee_source_requests(request_key,task_id,transition_id) VALUES(p_request_key,p_task,transition);
  END IF;
 END IF;
 input:=public.read_employee_operation_source_input(p_task);
 IF p_request_key IS NOT NULL AND prior.transition_id IS NULL AND NOT EXISTS(SELECT 1 FROM haven.employee_source_transitions t WHERE t.id=transition AND t.state_version=input->>'state_version') THEN RAISE EXCEPTION 'Employee source changed during refresh' USING ERRCODE='40001'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'observed_at',observed_at,'source_version',source_version,'changed',true) ORDER BY sequence),'[]'::jsonb) INTO history FROM haven.employee_source_transitions WHERE task_id=p_task;
 RETURN input||jsonb_build_object('history',history);
END $$;
REVOKE ALL ON FUNCTION public.employee_operation_source_snapshot(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.employee_operation_source_snapshot(uuid,text) TO authenticated;
COMMIT;
