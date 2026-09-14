BEGIN;
-- COL-160: immutable corporate packet and meeting history. Nothing here sends
-- email, calls Front Office, approves source records or activates a schedule.

CREATE FUNCTION haven.corporate_deliverable_token() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(sha256(convert_to('COL-160:'||current_database()||':corporate-deliverable-command','UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION haven.corporate_deliverable_token() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.corporate_deliverable_write_approved() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(current_setting('haven.corporate_deliverable_command',true)=haven.corporate_deliverable_token(),false)
$$;
REVOKE ALL ON FUNCTION haven.corporate_deliverable_write_approved() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_deliverable_context(p_task uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances;s public.operation_activity_subjects;a public.operation_activities;label text;expected_kind text;
BEGIN
 IF haven.authorized_user_id() IS NULL OR NOT coalesce(haven.operation_task_readable(p_task),false) THEN RAISE EXCEPTION 'Corporate deliverable scope unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;SELECT * INTO a FROM public.operation_activities WHERE id=t.activity_id;
 label:=CASE a.activity_key WHEN 'hfo-al-m09-01' THEN 'Census EOM review' WHEN 'hfo-al-m09-02' THEN 'FPC EOM review' WHEN 'hfo-al-m09-03' THEN 'Trust EOM review' WHEN 'hfo-al-q01-01' THEN 'Mail trust statement' WHEN 'hfo-al-c08-01' THEN 'Contract copy to confirmed recipient' END;
 expected_kind:=CASE WHEN a.activity_key IN('hfo-al-m09-01','hfo-al-m09-03') THEN 'facility' WHEN a.activity_key IN('hfo-al-q01-01','hfo-al-c08-01') THEN 'resident' WHEN a.activity_key='hfo-al-m09-02' THEN 'unconfirmed' END;
 IF label IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>=366 THEN RAISE EXCEPTION 'Corporate deliverable task and bounded period required' USING ERRCODE='22023';END IF;
 IF expected_kind<>'unconfirmed' AND s.subject_kind<>expected_kind THEN RAISE EXCEPTION 'Corporate deliverable subject does not match its component' USING ERRCODE='42501';END IF;
 IF expected_kind='resident' AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=s.resident_id AND r.organization_id=t.organization_id AND r.facility_id=t.facility_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'Current native resident required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('task_id',t.id,'activity_key',a.activity_key,'component_label',label,'organization_id',t.organization_id,'facility_id',t.facility_id,'subject_id',t.subject_id,'subject_kind',expected_kind,'resident_id',CASE WHEN expected_kind='resident' THEN s.resident_id END,'period_start',p_start,'period_end',p_end,'can_manage',haven.operation_task_mutable(p_task) AND haven.app_role() IN('owner','org_admin'));
END $$;
REVOKE ALL ON FUNCTION haven.corporate_deliverable_context(uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.corporate_deliverable_context(uuid,date,date) TO authenticated;

CREATE TABLE haven.corporate_coverage_sets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),component_key text NOT NULL CHECK(component_key IN('hfo-al-m09-01','hfo-al-m09-02','hfo-al-m09-03','hfo-al-q01-01','hfo-al-c08-01')),
 subject_kind text NOT NULL CHECK(subject_kind IN('facility','resident','unconfirmed')),resident_id uuid REFERENCES public.residents(id),period_start date NOT NULL,period_end date NOT NULL,version integer NOT NULL,revision uuid NOT NULL DEFAULT gen_random_uuid(),facility_ids jsonb NOT NULL,provenance text NOT NULL,actor_id uuid NOT NULL REFERENCES public.user_profiles(id),recorded_at timestamptz NOT NULL,
 UNIQUE NULLS NOT DISTINCT(organization_id,component_key,subject_kind,resident_id,period_start,period_end,version),CHECK((subject_kind='resident')=(resident_id IS NOT NULL)),CHECK(period_end>=period_start),CHECK(jsonb_typeof(facility_ids)='array')
);
CREATE TABLE haven.corporate_submission_expectations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origin_task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),organization_id uuid NOT NULL REFERENCES public.organizations(id),facility_id uuid NOT NULL REFERENCES public.facilities(id),component_key text NOT NULL CHECK(component_key IN('hfo-al-m09-01','hfo-al-m09-02','hfo-al-m09-03','hfo-al-q01-01','hfo-al-c08-01')),
 subject_kind text NOT NULL CHECK(subject_kind IN('facility','resident','unconfirmed')),resident_id uuid REFERENCES public.residents(id),period_start date NOT NULL,period_end date NOT NULL,period_provenance text NOT NULL,mapping_state text NOT NULL CHECK(mapping_state IN('mapped','unconfirmed')),created_by uuid NOT NULL REFERENCES public.user_profiles(id),created_at timestamptz NOT NULL,
 UNIQUE NULLS NOT DISTINCT(organization_id,facility_id,component_key,period_start,period_end,subject_kind,resident_id),CHECK((subject_kind='resident')=(resident_id IS NOT NULL)),CHECK(period_end>=period_start)
);
CREATE TABLE haven.corporate_submission_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expectation_id uuid NOT NULL REFERENCES haven.corporate_submission_expectations(id),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),version integer NOT NULL,source_family text NOT NULL CHECK(source_family IN('census','trust','stand_up','resident_document')),source_version text NOT NULL,captured jsonb NOT NULL,prepared_by uuid NOT NULL REFERENCES public.user_profiles(id),prepared_at timestamptz NOT NULL,
 UNIQUE(expectation_id,version),CHECK(jsonb_typeof(captured)='object')
);
CREATE TABLE haven.corporate_submission_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expectation_id uuid NOT NULL REFERENCES haven.corporate_submission_expectations(id),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),kind text NOT NULL CHECK(kind IN('configured','prepared','sent','received','accepted','rejected','follow_up_linked')),version_id uuid REFERENCES haven.corporate_submission_versions(id),details jsonb NOT NULL,sequence bigint NOT NULL,actor_id uuid NOT NULL REFERENCES public.user_profiles(id),recorded_at timestamptz NOT NULL,
 UNIQUE(expectation_id,sequence),CHECK(jsonb_typeof(details)='object')
);
CREATE TABLE haven.corporate_meeting_captures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),component_key text NOT NULL,subject_kind text NOT NULL CHECK(subject_kind IN('facility','resident','unconfirmed')),resident_id uuid REFERENCES public.residents(id),period_start date NOT NULL,period_end date NOT NULL,coverage_revision uuid NOT NULL,captured_at timestamptz NOT NULL,captured_by uuid NOT NULL REFERENCES public.user_profiles(id),presented_at timestamptz,presented_on date,presentation_provenance text,snapshot jsonb NOT NULL,CHECK((subject_kind='resident')=(resident_id IS NOT NULL)),CHECK((presented_at IS NULL OR presented_on IS NULL) AND ((presented_at IS NOT NULL OR presented_on IS NOT NULL)=(presentation_provenance IS NOT NULL))),CHECK(jsonb_typeof(snapshot)='object')
);
CREATE TABLE haven.corporate_deliverable_requests(
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),request_key text NOT NULL,task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),action text NOT NULL,request_hash text NOT NULL,period_start date NOT NULL,period_end date NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE haven.corporate_coverage_sets ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.corporate_submission_expectations ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.corporate_submission_versions ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.corporate_submission_events ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.corporate_meeting_captures ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.corporate_deliverable_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.corporate_coverage_sets,haven.corporate_submission_expectations,haven.corporate_submission_versions,haven.corporate_submission_events,haven.corporate_meeting_captures,haven.corporate_deliverable_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.guard_corporate_deliverable_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF TG_OP<>'INSERT' OR NOT haven.corporate_deliverable_write_approved() THEN RAISE EXCEPTION 'Corporate deliverable history is immutable and command-only' USING ERRCODE='42501';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION haven.guard_corporate_deliverable_history() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER corporate_coverage_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_coverage_sets FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_expectation_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_submission_expectations FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_version_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_submission_versions FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_event_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_submission_events FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_meeting_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_meeting_captures FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_request_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.corporate_deliverable_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_coverage_no_truncate BEFORE TRUNCATE ON haven.corporate_coverage_sets FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_expectation_no_truncate BEFORE TRUNCATE ON haven.corporate_submission_expectations FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_version_no_truncate BEFORE TRUNCATE ON haven.corporate_submission_versions FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_event_no_truncate BEFORE TRUNCATE ON haven.corporate_submission_events FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_meeting_no_truncate BEFORE TRUNCATE ON haven.corporate_meeting_captures FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();
CREATE TRIGGER corporate_request_no_truncate BEFORE TRUNCATE ON haven.corporate_deliverable_requests FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_corporate_deliverable_history();

CREATE FUNCTION haven.corporate_expectation_revision(p_expectation uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT id FROM haven.corporate_submission_events WHERE expectation_id=p_expectation ORDER BY sequence DESC LIMIT 1),(SELECT id FROM haven.corporate_submission_expectations WHERE id=p_expectation))
$$;
REVOKE ALL ON FUNCTION haven.corporate_expectation_revision(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_issue_json(p_issue uuid,p_org uuid,p_site uuid,p_subject uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues;owner_current boolean;backup_current boolean;
BEGIN
 SELECT * INTO i FROM public.operation_issues WHERE id=p_issue AND organization_id=p_org AND facility_id=p_site AND subject_id IS NOT DISTINCT FROM p_subject;
 IF NOT FOUND THEN RETURN NULL;END IF;
 owner_current:=haven.operation_issue_owner_current(i.owner_user_id,i.owner_role,i.organization_id,i.facility_id);backup_current:=haven.operation_issue_owner_current(i.backup_user_id,i.backup_role,i.organization_id,i.facility_id);
 RETURN jsonb_build_object('id',i.id,'status',i.status,'owner_user_id',i.owner_user_id,'owner_role',i.owner_role,'backup_user_id',i.backup_user_id,'backup_role',i.backup_role,'owner_current',owner_current,'backup_current',backup_current,'follow_up_at',i.follow_up_at,'next_action',CASE WHEN i.status='resolved' THEN 'Resolved issue history; packet receipt or acceptance remains separate' WHEN NOT owner_current THEN 'Assign a current owner' WHEN i.status='waiting' THEN 'Follow up at the recorded time; resolve separately when corrected' ELSE 'Owner to complete the recorded next action' END);
END $$;
REVOKE ALL ON FUNCTION haven.corporate_issue_json(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.lock_corporate_issue_ownership(p_issue uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues;
BEGIN
 SELECT * INTO i FROM public.operation_issues WHERE id=p_issue FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_profiles p WHERE p.id IN(i.owner_user_id,i.backup_user_id) ORDER BY p.id FOR SHARE;
 PERFORM 1 FROM auth.users u WHERE u.id IN(i.owner_user_id,i.backup_user_id) ORDER BY u.id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access g WHERE g.facility_id=i.facility_id AND g.user_id IN(i.owner_user_id,i.backup_user_id) ORDER BY g.user_id FOR SHARE;
 IF i.owner_role IS NOT NULL OR i.backup_role IS NOT NULL THEN
  PERFORM 1 FROM public.user_profiles p WHERE p.organization_id=i.organization_id AND p.app_role IN(i.owner_role,i.backup_role) ORDER BY p.id FOR SHARE;
  PERFORM 1 FROM public.user_facility_access g JOIN public.user_profiles p ON p.id=g.user_id WHERE g.organization_id=i.organization_id AND g.facility_id=i.facility_id AND p.app_role IN(i.owner_role,i.backup_role) ORDER BY g.user_id FOR SHARE OF g,p;
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.lock_corporate_issue_ownership(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_evidence_before(p_new jsonb,p_new_at text,p_new_on text,p_old jsonb,p_old_at text,p_old_on text,p_timezone text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_new->>p_new_at IS NOT NULL AND p_old->>p_old_at IS NOT NULL THEN RETURN (p_new->>p_new_at)::timestamptz<(p_old->>p_old_at)::timestamptz;END IF;
 RETURN coalesce((p_new->>p_new_on)::date,((p_new->>p_new_at)::timestamptz AT TIME ZONE p_timezone)::date)<coalesce((p_old->>p_old_on)::date,((p_old->>p_old_at)::timestamptz AT TIME ZONE p_timezone)::date);
END $$;
REVOKE ALL ON FUNCTION haven.corporate_evidence_before(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.assert_corporate_source_capture_bound(p_capture jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN IF octet_length(p_capture::text)>524288 THEN RAISE EXCEPTION 'Corporate source capture exceeds 512 KiB bound before mutation' USING ERRCODE='54000';END IF;END $$;
REVOKE ALL ON FUNCTION haven.assert_corporate_source_capture_bound(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_expectation_json(p_expectation uuid,p_include_payload boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE e haven.corporate_submission_expectations;v haven.corporate_submission_versions;historical_version haven.corporate_submission_versions;configuration jsonb;events jsonb;versions jsonb;state_event haven.corporate_submission_events;follow_event haven.corporate_submission_events;issue jsonb;native jsonb;context jsonb;
BEGIN
 SELECT * INTO e FROM haven.corporate_submission_expectations WHERE id=p_expectation;
 IF NOT FOUND OR haven.organization_id()<>e.organization_id OR haven.app_role() NOT IN('owner','org_admin') OR NOT haven.has_facility_access(e.facility_id) THEN RETURN NULL;END IF;
 IF e.subject_kind='resident' AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=e.resident_id AND r.organization_id=e.organization_id AND r.facility_id=e.facility_id AND r.deleted_at IS NULL) THEN RETURN NULL;END IF;
 FOR historical_version IN SELECT * FROM haven.corporate_submission_versions WHERE expectation_id=e.id ORDER BY version LOOP
  IF NOT haven.operation_task_readable(historical_version.task_id) THEN RETURN NULL;END IF;
  IF historical_version.source_family IN('census','trust') THEN
   context:=haven.finance_source_context(historical_version.task_id,e.period_start,e.period_end);
   IF NOT coalesce((context->>'native_site')::boolean,false) OR (historical_version.source_family='census' AND NOT coalesce((context->>'native_census')::boolean,false)) OR (historical_version.source_family='trust' AND (NOT coalesce((context->>'financial_scope')::boolean,false) OR NOT coalesce((context->>'native_trust')::boolean,false))) THEN RETURN NULL;END IF;
  ELSIF historical_version.source_family='stand_up' THEN
   PERFORM haven.stand_up_assert(e.facility_id);
  ELSE
   native:=public.provider_document_target(historical_version.task_id,(historical_version.captured->>'native_version_id')::uuid);
   IF native IS NULL THEN RETURN NULL;END IF;
  END IF;
  v:=historical_version;
 END LOOP;
 SELECT details INTO configuration FROM haven.corporate_submission_events WHERE expectation_id=e.id AND kind='configured' ORDER BY sequence DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'task_id',x.task_id,'source_family',x.source_family,'source_version',x.source_version,'prepared_at',x.prepared_at,'captured',CASE WHEN p_include_payload THEN x.captured ELSE NULL END) ORDER BY x.version),'[]') INTO versions FROM(SELECT * FROM haven.corporate_submission_versions WHERE expectation_id=e.id ORDER BY version DESC LIMIT 1)x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'sequence',x.sequence,'kind',x.kind,'version_id',x.version_id,'actor_id',x.actor_id,'recorded_at',x.recorded_at,'details',x.details) ORDER BY x.sequence),'[]') INTO events FROM(SELECT * FROM haven.corporate_submission_events WHERE expectation_id=e.id ORDER BY sequence DESC LIMIT 50)x;
 IF v.id IS NOT NULL THEN SELECT * INTO state_event FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind IN('sent','received','accepted','rejected') ORDER BY sequence DESC LIMIT 1;END IF;
 SELECT * INTO follow_event FROM haven.corporate_submission_events WHERE expectation_id=e.id AND kind IN('follow_up_linked','rejected') ORDER BY sequence DESC LIMIT 1;
 IF follow_event.id IS NOT NULL THEN issue:=haven.corporate_issue_json((follow_event.details->>'issue_id')::uuid,e.organization_id,e.facility_id,(SELECT subject_id FROM public.operation_task_instances WHERE id=follow_event.task_id));END IF;
 RETURN jsonb_build_object('id',e.id,'revision',haven.corporate_expectation_revision(e.id),'facility_id',e.facility_id,'component_key',e.component_key,'subject_kind',e.subject_kind,'resident_id',e.resident_id,'period_start',e.period_start,'period_end',e.period_end,'period_provenance',e.period_provenance,'mapping_state',e.mapping_state,
  'payload_included',p_include_payload,
  'recipient_label',configuration->>'recipient_label','backup_label',configuration->>'backup_label','due_on',configuration->>'due_on','due_state',CASE WHEN configuration->>'due_on' IS NULL THEN 'unknown' ELSE 'documented' END,
  'current_state',CASE WHEN v.id IS NULL THEN 'expected' WHEN state_event.id IS NULL THEN 'prepared' ELSE state_event.kind END,'current_version_id',v.id,'versions',versions,'events',events,
  'history_complete',(SELECT count(*)<=1 FROM haven.corporate_submission_versions WHERE expectation_id=e.id) AND (SELECT count(*)<=50 FROM haven.corporate_submission_events WHERE expectation_id=e.id),
  'history_cursor',CASE WHEN (SELECT count(*)<=1 FROM haven.corporate_submission_versions WHERE expectation_id=e.id) AND (SELECT count(*)<=50 FROM haven.corporate_submission_events WHERE expectation_id=e.id) THEN NULL ELSE jsonb_build_object('before_version',CASE WHEN (SELECT count(*)<=1 FROM haven.corporate_submission_versions WHERE expectation_id=e.id) THEN 0 ELSE v.version END,'before_sequence',CASE WHEN (SELECT count(*)<=50 FROM haven.corporate_submission_events WHERE expectation_id=e.id) THEN 0 ELSE (SELECT min((x->>'sequence')::bigint) FROM jsonb_array_elements(events)x) END) END,'follow_up',issue);
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.corporate_expectation_json(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_snapshot_data(p_task uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;coverage haven.corporate_coverage_sets;site jsonb;captured_site jsonb;e haven.corporate_submission_expectations;detail jsonb;sites jsonb:='[]';all_visible boolean:=true;meetings jsonb;available_sites jsonb;issue_candidates jsonb;historical_meeting haven.corporate_meeting_captures;captured_expectation uuid;
BEGIN
 c:=haven.corporate_deliverable_context(p_task,p_start,p_end);
 IF haven.app_role() NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Current corporate authority required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'label',f.name) ORDER BY f.name,f.id),'[]') INTO available_sites FROM public.facilities f WHERE f.organization_id=(c->>'organization_id')::uuid AND f.deleted_at IS NULL AND haven.has_facility_access(f.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.summary,'status',i.status,'owner_label',coalesce(p.full_name,i.owner_role::text),'owner_current',haven.operation_issue_owner_current(i.owner_user_id,i.owner_role,i.organization_id,i.facility_id)) ORDER BY i.reported_at,i.id),'[]') INTO issue_candidates
 FROM(SELECT * FROM public.operation_issues WHERE organization_id=(c->>'organization_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND subject_id=(c->>'subject_id')::uuid AND status<>'resolved' ORDER BY reported_at,id LIMIT 101)i LEFT JOIN public.user_profiles p ON p.id=i.owner_user_id;
 IF jsonb_array_length(issue_candidates)>100 THEN RAISE EXCEPTION 'Issue candidate history exceeds complete reader bound' USING ERRCODE='54000';END IF;
 SELECT * INTO coverage FROM haven.corporate_coverage_sets WHERE organization_id=(c->>'organization_id')::uuid AND component_key=c->>'activity_key' AND subject_kind=c->>'subject_kind' AND resident_id IS NOT DISTINCT FROM (c->>'resident_id')::uuid AND period_start=p_start AND period_end=p_end ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN c||jsonb_build_object('availability','available','reason','Expected site set has not been recorded; no complete-coverage conclusion is available.','available_sites',available_sites,'issue_candidates',issue_candidates,'coverage',NULL,'coverage_complete',false,'sites','[]'::jsonb,'meetings','[]'::jsonb,'meetings_complete',true,'complete',true,'front_office_boundary','standup_weekly_allowlist_only');END IF;
 FOR site IN SELECT value FROM jsonb_array_elements(coverage.facility_ids) ORDER BY value#>>'{}' LOOP
  PERFORM 1 FROM public.facilities f WHERE f.id=(site#>>'{}')::uuid AND f.organization_id=coverage.organization_id AND f.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN all_visible:=false;sites:=sites||jsonb_build_array(jsonb_build_object('facility_id',site,'status','unavailable','expectation',NULL));CONTINUE;END IF;
  PERFORM 1 FROM public.user_facility_access g WHERE g.user_id=haven.authorized_user_id() AND g.organization_id=coverage.organization_id AND g.facility_id=(site#>>'{}')::uuid FOR SHARE;
  IF NOT haven.has_facility_access((site#>>'{}')::uuid) THEN all_visible:=false;sites:=sites||jsonb_build_array(jsonb_build_object('facility_id',site,'status','unavailable','expectation',NULL));CONTINUE;END IF;
  SELECT * INTO e FROM haven.corporate_submission_expectations x WHERE x.organization_id=coverage.organization_id AND x.facility_id=(site#>>'{}')::uuid AND x.component_key=coverage.component_key AND x.period_start=coverage.period_start AND x.period_end=coverage.period_end
   AND (x.subject_kind<>'resident' OR x.resident_id=(c->>'resident_id')::uuid) ORDER BY x.created_at DESC LIMIT 1;
  IF NOT FOUND THEN sites:=sites||jsonb_build_array(jsonb_build_object('facility_id',site,'status','missing','expectation',NULL));CONTINUE;END IF;
  detail:=haven.corporate_expectation_json(e.id,e.facility_id=(c->>'facility_id')::uuid);
  IF detail IS NULL THEN all_visible:=false;sites:=sites||jsonb_build_array(jsonb_build_object('facility_id',site,'status','unavailable','expectation',NULL));ELSE sites:=sites||jsonb_build_array(jsonb_build_object('facility_id',site,'status','expected','expectation',detail));END IF;
 END LOOP;
 -- Historical captures may contain sites or source-task versions no longer in
 -- the latest coverage set. Reauthorize every captured member before any old
 -- snapshot is returned; one unreadable member withholds the whole detail set.
 IF all_visible THEN
  FOR historical_meeting IN SELECT * FROM haven.corporate_meeting_captures WHERE organization_id=coverage.organization_id AND component_key=coverage.component_key AND subject_kind=coverage.subject_kind AND resident_id IS NOT DISTINCT FROM coverage.resident_id AND period_start=coverage.period_start AND period_end=coverage.period_end LOOP
   IF jsonb_typeof(historical_meeting.snapshot->'sites') IS DISTINCT FROM 'array' THEN all_visible:=false;EXIT;END IF;
   FOR captured_site IN SELECT value FROM jsonb_array_elements(historical_meeting.snapshot->'sites') LOOP
    IF captured_site->>'facility_id' IS NULL OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=(captured_site->>'facility_id')::uuid AND f.organization_id=coverage.organization_id AND f.deleted_at IS NULL) OR NOT haven.has_facility_access((captured_site->>'facility_id')::uuid) THEN all_visible:=false;EXIT;END IF;
    captured_expectation:=NULLIF(captured_site#>>'{expectation,id}','')::uuid;
    IF captured_expectation IS NOT NULL AND haven.corporate_expectation_json(captured_expectation) IS NULL THEN all_visible:=false;EXIT;END IF;
   END LOOP;
   EXIT WHEN NOT all_visible;
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'label',f.name) ORDER BY f.name,f.id),'[]') INTO available_sites FROM public.facilities f WHERE f.organization_id=(c->>'organization_id')::uuid AND f.deleted_at IS NULL AND haven.has_facility_access(f.id);
 IF NOT all_visible THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('facility_id',x->'facility_id','status',CASE WHEN x->>'status'='missing' THEN 'missing' ELSE 'unavailable' END,'expectation',NULL) ORDER BY x->>'facility_id'),'[]') INTO sites FROM jsonb_array_elements(sites)x;
  meetings:='[]';
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'coverage_revision',m.coverage_revision,'captured_at',m.captured_at,'presented_at',m.presented_at,'presented_on',m.presented_on,'presentation_provenance',m.presentation_provenance,'snapshot',m.snapshot) ORDER BY m.captured_at,m.id),'[]') INTO meetings FROM(SELECT * FROM haven.corporate_meeting_captures WHERE organization_id=coverage.organization_id AND component_key=coverage.component_key AND subject_kind=coverage.subject_kind AND resident_id IS NOT DISTINCT FROM coverage.resident_id AND period_start=coverage.period_start AND period_end=coverage.period_end ORDER BY captured_at DESC LIMIT 101)m;
  IF jsonb_array_length(meetings)>100 THEN RAISE EXCEPTION 'Meeting history exceeds complete reader bound' USING ERRCODE='54000';END IF;
 END IF;
 RETURN c||jsonb_build_object('availability',CASE WHEN all_visible THEN 'available' ELSE 'unavailable' END,'reason',CASE WHEN all_visible THEN 'All expected sites are accounted for; missing submissions remain explicit.' ELSE 'One or more expected sites are unreadable; protected details are withheld and complete coverage is refused.' END,'available_sites',available_sites,'issue_candidates',issue_candidates,
  'coverage',jsonb_build_object('id',coverage.id,'revision',coverage.revision,'version',coverage.version,'facility_ids',coverage.facility_ids,'recorded_at',coverage.recorded_at,'provenance',coverage.provenance),'coverage_complete',all_visible,'sites',sites,'meetings',meetings,'meetings_complete',all_visible,'complete',true,'front_office_boundary','standup_weekly_allowlist_only');
END $$;
REVOKE ALL ON FUNCTION haven.corporate_snapshot_data(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.corporate_deliverable_snapshot(p_task uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE first jsonb;fresh jsonb;result jsonb;
BEGIN
 first:=haven.corporate_snapshot_data(p_task,p_start,p_end);
 PERFORM pg_advisory_xact_lock(hashtextextended('corporate-snapshot-final:'||haven.authorized_user_id()::text||':'||p_task::text||':'||p_start::text||':'||p_end::text,0));
 fresh:=haven.corporate_snapshot_data(p_task,p_start,p_end);
 IF first IS DISTINCT FROM fresh THEN RAISE EXCEPTION 'Corporate deliverable authority, source visibility or history changed' USING ERRCODE='42501';END IF;
 result:=first-ARRAY['organization_id','facility_id','subject_id','subject_kind','resident_id'];IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'Corporate snapshot exceeds one MiB bound' USING ERRCODE='54000';END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.corporate_deliverable_snapshot(uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.corporate_deliverable_snapshot(uuid,date,date) TO authenticated;

CREATE FUNCTION public.corporate_deliverable_history(p_task uuid,p_expectation uuid,p_before_version integer DEFAULT NULL,p_before_sequence bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;header jsonb;fresh jsonb;versions jsonb;events jsonb;result jsonb;version_more boolean;event_more boolean;
BEGIN
 header:=haven.corporate_expectation_json(p_expectation);IF header IS NULL THEN RAISE EXCEPTION 'Corporate history unavailable' USING ERRCODE='42501';END IF;
 c:=haven.corporate_deliverable_context(p_task,(header->>'period_start')::date,(header->>'period_end')::date);
 IF (header->>'facility_id',header->>'component_key',header->>'subject_kind',header->>'resident_id') IS DISTINCT FROM (c->>'facility_id',c->>'activity_key',c->>'subject_kind',c->>'resident_id') THEN RAISE EXCEPTION 'Corporate history scope unavailable' USING ERRCODE='42501';END IF;
 IF p_before_version=0 THEN versions:='[]';version_more:=false;ELSE SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'task_id',x.task_id,'source_family',x.source_family,'source_version',x.source_version,'prepared_at',x.prepared_at,'captured',x.captured) ORDER BY x.version DESC) FILTER(WHERE rn=1),'[]'),bool_or(rn=2) INTO versions,version_more FROM(SELECT v.*,row_number() OVER(ORDER BY version DESC)rn FROM haven.corporate_submission_versions v WHERE expectation_id=p_expectation AND (p_before_version IS NULL OR version<p_before_version) ORDER BY version DESC LIMIT 2)x;END IF;
 IF p_before_sequence=0 THEN events:='[]';event_more:=false;ELSE SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'sequence',x.sequence,'kind',x.kind,'version_id',x.version_id,'actor_id',x.actor_id,'recorded_at',x.recorded_at,'details',x.details) ORDER BY x.sequence DESC) FILTER(WHERE rn<=50),'[]'),bool_or(rn=51) INTO events,event_more FROM(SELECT ev.*,row_number() OVER(ORDER BY sequence DESC)rn FROM haven.corporate_submission_events ev WHERE expectation_id=p_expectation AND (p_before_sequence IS NULL OR sequence<p_before_sequence) ORDER BY sequence DESC LIMIT 51)x;END IF;
 result:=jsonb_build_object('task_id',p_task,'expectation_id',p_expectation,'versions',versions,'events',events,'next_before_version',CASE WHEN coalesce(version_more,false) THEN (SELECT min((x->>'version')::integer) FROM jsonb_array_elements(versions)x) ELSE 0 END,'next_before_sequence',CASE WHEN coalesce(event_more,false) THEN (SELECT min((x->>'sequence')::bigint) FROM jsonb_array_elements(events)x) ELSE 0 END,'complete',NOT coalesce(version_more,false) AND NOT coalesce(event_more,false));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'Corporate history page exceeds one MiB bound' USING ERRCODE='54000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('corporate-history-final:'||haven.authorized_user_id()::text||':'||p_expectation::text,0));fresh:=haven.corporate_expectation_json(p_expectation);
 IF header IS DISTINCT FROM fresh THEN RAISE EXCEPTION 'Corporate history authority or content changed' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.corporate_deliverable_history(uuid,uuid,integer,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.corporate_deliverable_history(uuid,uuid,integer,bigint) TO authenticated;

CREATE FUNCTION haven.corporate_meeting_projection(p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE site jsonb;expectation jsonb;current_version jsonb;projected_sites jsonb:='[]';result jsonb;
BEGIN
 IF jsonb_typeof(p_snapshot->'sites')<>'array' OR jsonb_array_length(p_snapshot->'sites')>100 OR p_snapshot->'coverage' IS NULL THEN RAISE EXCEPTION 'Bounded complete meeting source required' USING ERRCODE='54000';END IF;
 FOR site IN SELECT value FROM jsonb_array_elements(p_snapshot->'sites') LOOP
  expectation:=site->'expectation';current_version:=NULL;
  IF expectation IS NOT NULL AND expectation->>'current_version_id' IS NOT NULL THEN SELECT jsonb_build_object('id',v.id,'version',v.version,'task_id',v.task_id,'source_family',v.source_family,'source_version',v.source_version,'prepared_at',v.prepared_at,'captured',v.captured) INTO current_version FROM haven.corporate_submission_versions v WHERE v.id=(expectation->>'current_version_id')::uuid AND v.expectation_id=(expectation->>'id')::uuid;END IF;
  projected_sites:=projected_sites||jsonb_build_array(jsonb_build_object('facility_id',site->'facility_id','facility_label',(SELECT name FROM public.facilities WHERE id=(site->>'facility_id')::uuid),'status',site->>'status','expectation',CASE WHEN expectation IS NULL THEN NULL ELSE jsonb_build_object('id',expectation->'id','component_key',expectation->>'component_key','subject_kind',expectation->>'subject_kind','resident_id',expectation->'resident_id','current_state',expectation->>'current_state','current_version_id',expectation->'current_version_id','current_version',current_version,'recipient_label',expectation->'recipient_label','backup_label',expectation->'backup_label','due_on',expectation->'due_on','follow_up',expectation->'follow_up') END));
 END LOOP;
 result:=jsonb_build_object('schema_version',1,'activity_key',p_snapshot->>'activity_key','component_label',p_snapshot->>'component_label','period_start',p_snapshot->'period_start','period_end',p_snapshot->'period_end','coverage',p_snapshot->'coverage','sites',projected_sites,'front_office_boundary','standup_weekly_allowlist_only');
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'Meeting capture exceeds one MiB bound before mutation' USING ERRCODE='54000';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.corporate_meeting_projection(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.corporate_insert_event(p_expectation uuid,p_task uuid,p_kind text,p_version uuid,p_details jsonb) RETURNS haven.corporate_submission_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result haven.corporate_submission_events;
BEGIN
 IF (SELECT count(*) FROM haven.corporate_submission_events WHERE expectation_id=p_expectation)>=200 THEN RAISE EXCEPTION 'Corporate event history bound reached before mutation' USING ERRCODE='54000';END IF;
 INSERT INTO haven.corporate_submission_events(expectation_id,task_id,kind,version_id,details,sequence,actor_id,recorded_at)
 SELECT p_expectation,p_task,p_kind,p_version,p_details,coalesce(max(sequence),0)+1,haven.authorized_user_id(),clock_timestamp() FROM haven.corporate_submission_events WHERE expectation_id=p_expectation RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.corporate_insert_event(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.corporate_deliverable_command(p_task uuid,p_request_key text,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;e haven.corporate_submission_expectations;coverage haven.corporate_coverage_sets;prior haven.corporate_deliverable_requests;v haven.corporate_submission_versions;event haven.corporate_submission_events;prior_event haven.corporate_submission_events;configuration jsonb;expected_sites jsonb;site_count integer;valid_count integer;request_hash text;actor uuid;family jsonb;native jsonb;captured jsonb;source_version text;issue public.operation_issues;snapshot jsonb;week date;version_no integer;at_value timestamptz;on_value date;revision uuid;site_timezone text;due_evidence text;
BEGIN
 IF p_request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_action NOT IN('register','configure','prepare','sent','received','accepted','rejected','link_follow_up','capture_meeting') THEN RAISE EXCEPTION 'Valid corporate command and request key required' USING ERRCODE='22023';END IF;
 actor:=haven.authorized_user_id();IF actor IS NULL THEN RAISE EXCEPTION 'Corporate authority required' USING ERRCODE='42501';END IF;
 -- Lock current task/session/grants and any native source family before a
 -- request/expectation wait. Source writers or permission changes then wait
 -- behind this command instead of producing a stale stronger-authority view.
 IF p_action IN('rejected','link_follow_up') THEN issue:=haven.lock_operation_issue_authority((p_payload->>'issue_id')::uuid);ELSE PERFORM haven.lock_operation_authority(p_task);END IF;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=actor FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=actor FOR SHARE;
 IF p_action='prepare' AND p_payload->>'source_family'='census' THEN LOCK TABLE public.census_daily_log IN SHARE MODE;
 ELSIF p_action='prepare' AND p_payload->>'source_family'='trust' THEN LOCK TABLE public.resident_trust_accounts,public.resident_trust_transactions,public.trust_account_entries IN SHARE MODE;
 ELSIF p_action='prepare' AND p_payload->>'source_family'='stand_up' THEN LOCK TABLE public.stand_up_reports,public.stand_up_revisions IN SHARE MODE;
 ELSIF p_action='prepare' AND p_payload->>'source_family'='resident_document' THEN LOCK TABLE public.resident_document_versions,public.resident_documents,storage.objects IN SHARE MODE;
 ELSIF p_action='capture_meeting' THEN LOCK TABLE public.census_daily_log,public.resident_trust_accounts,public.resident_trust_transactions,public.trust_account_entries,public.stand_up_reports,public.stand_up_revisions,public.resident_document_versions,public.resident_documents,storage.objects IN SHARE MODE;
 END IF;
 IF p_action IN('register','capture_meeting') THEN
  IF p_payload->>'period_start' IS NULL OR p_payload->>'period_end' IS NULL THEN RAISE EXCEPTION 'Explicit period required' USING ERRCODE='22023';END IF;
  c:=haven.corporate_deliverable_context(p_task,(p_payload->>'period_start')::date,(p_payload->>'period_end')::date);
 ELSE
  SELECT * INTO e FROM haven.corporate_submission_expectations WHERE id=(p_payload->>'expectation_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corporate expectation unavailable' USING ERRCODE='42501';END IF;
  c:=haven.corporate_deliverable_context(p_task,e.period_start,e.period_end);
  IF (e.organization_id,e.facility_id,e.component_key,e.subject_kind,e.resident_id) IS DISTINCT FROM((c->>'organization_id')::uuid,(c->>'facility_id')::uuid,c->>'activity_key',c->>'subject_kind',(c->>'resident_id')::uuid) THEN RAISE EXCEPTION 'Stable corporate expectation scope required' USING ERRCODE='42501';END IF;
 END IF;
 IF NOT coalesce((c->>'can_manage')::boolean,false) THEN RAISE EXCEPTION 'Current corporate manager authority required' USING ERRCODE='42501';END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'action',p_action,'payload',p_payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('corporate-request:'||actor::text||':'||p_request_key,0));
 SELECT * INTO prior FROM haven.corporate_deliverable_requests WHERE actor_id=actor AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.task_id<>p_task OR prior.action<>p_action OR prior.request_hash<>request_hash THEN RAISE EXCEPTION 'Request scope/content conflict' USING ERRCODE='23505';END IF;
  PERFORM haven.corporate_deliverable_context(p_task,prior.period_start,prior.period_end);
  RETURN jsonb_build_object('period_start',prior.period_start,'period_end',prior.period_end,'replayed',true);
 END IF;
 IF e.id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('corporate-expectation:'||e.id::text,0));
  revision:=haven.corporate_expectation_revision(e.id);
  IF (p_payload->>'expected_revision')::uuid IS DISTINCT FROM revision THEN RAISE EXCEPTION 'Corporate expectation changed' USING ERRCODE='40001';END IF;
 END IF;
 PERFORM set_config('haven.corporate_deliverable_command',haven.corporate_deliverable_token(),true);

 IF p_action='register' THEN
  IF p_payload-ARRAY['period_start','period_end','period_provenance','expected_facility_ids']<>'{}'::jsonb OR jsonb_typeof(p_payload->'expected_facility_ids')<>'array' OR jsonb_array_length(p_payload->'expected_facility_ids') NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(p_payload->>'period_provenance',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Explicit period provenance and expected site set required' USING ERRCODE='22023';END IF;
  SELECT jsonb_agg(to_jsonb((value#>>'{}')::uuid) ORDER BY value#>>'{}'),count(*),count(DISTINCT value#>>'{}') INTO expected_sites,site_count,valid_count FROM jsonb_array_elements(p_payload->'expected_facility_ids');
  IF site_count<>valid_count OR NOT expected_sites ? (c->>'facility_id') THEN RAISE EXCEPTION 'Unique expected sites must include this task site' USING ERRCODE='22023';END IF;
  PERFORM 1 FROM public.facilities f WHERE f.organization_id=(c->>'organization_id')::uuid AND f.deleted_at IS NULL AND f.id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(expected_sites)) ORDER BY f.id FOR SHARE;
  PERFORM 1 FROM public.user_facility_access g WHERE g.user_id=actor AND g.organization_id=(c->>'organization_id')::uuid AND g.facility_id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(expected_sites)) ORDER BY g.facility_id FOR SHARE;
  SELECT count(*) INTO valid_count FROM public.facilities f WHERE f.organization_id=(c->>'organization_id')::uuid AND f.deleted_at IS NULL AND f.id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(expected_sites)) AND haven.has_facility_access(f.id);
  IF valid_count<>site_count THEN RAISE EXCEPTION 'Every expected site requires current organization access' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('corporate-coverage:'||(c->>'organization_id')||':'||(c->>'activity_key')||':'||(c->>'subject_kind')||':'||coalesce(c->>'resident_id','none')||':'||(c->>'period_start')||':'||(c->>'period_end'),0));
  SELECT * INTO coverage FROM haven.corporate_coverage_sets WHERE organization_id=(c->>'organization_id')::uuid AND component_key=c->>'activity_key' AND subject_kind=c->>'subject_kind' AND resident_id IS NOT DISTINCT FROM (c->>'resident_id')::uuid AND period_start=(c->>'period_start')::date AND period_end=(c->>'period_end')::date ORDER BY version DESC LIMIT 1;
  IF coverage.id IS NULL OR coverage.facility_ids IS DISTINCT FROM expected_sites OR coverage.provenance IS DISTINCT FROM btrim(p_payload->>'period_provenance') THEN
   IF coalesce(coverage.version,0)>=100 THEN RAISE EXCEPTION 'Corporate coverage version bound reached before mutation' USING ERRCODE='54000';END IF;
   INSERT INTO haven.corporate_coverage_sets(organization_id,component_key,subject_kind,resident_id,period_start,period_end,version,facility_ids,provenance,actor_id,recorded_at) VALUES((c->>'organization_id')::uuid,c->>'activity_key',c->>'subject_kind',(c->>'resident_id')::uuid,(c->>'period_start')::date,(c->>'period_end')::date,coalesce(coverage.version,0)+1,expected_sites,btrim(p_payload->>'period_provenance'),actor,clock_timestamp()) RETURNING * INTO coverage;
  END IF;
  INSERT INTO haven.corporate_submission_expectations(origin_task_id,organization_id,facility_id,component_key,subject_kind,resident_id,period_start,period_end,period_provenance,mapping_state,created_by,created_at)
  VALUES(p_task,(c->>'organization_id')::uuid,(c->>'facility_id')::uuid,c->>'activity_key',c->>'subject_kind',(c->>'resident_id')::uuid,(c->>'period_start')::date,(c->>'period_end')::date,btrim(p_payload->>'period_provenance'),CASE WHEN c->>'activity_key' IN('hfo-al-m09-02','hfo-al-c08-01') THEN 'unconfirmed' ELSE 'mapped' END,actor,clock_timestamp()) ON CONFLICT(organization_id,facility_id,component_key,period_start,period_end,subject_kind,resident_id) DO NOTHING;
  SELECT * INTO e FROM haven.corporate_submission_expectations WHERE organization_id=(c->>'organization_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND component_key=c->>'activity_key' AND period_start=(c->>'period_start')::date AND period_end=(c->>'period_end')::date AND subject_kind=c->>'subject_kind' AND resident_id IS NOT DISTINCT FROM (c->>'resident_id')::uuid;
 ELSIF p_action='configure' THEN
  -- Match the HTTP evidence schema's ECMAScript trim set, independent of database locale.
  due_evidence:=btrim(p_payload->>'due_provenance',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  IF p_payload-ARRAY['expectation_id','expected_revision','recipient_label','backup_label','due_on','configuration_provenance','due_provenance']<>'{}'::jsonb OR length(btrim(coalesce(p_payload->>'configuration_provenance',''))) NOT BETWEEN 1 AND 1000 OR (p_payload->>'recipient_label' IS NOT NULL AND length(btrim(p_payload->>'recipient_label')) NOT BETWEEN 1 AND 200) OR (p_payload->>'backup_label' IS NOT NULL AND length(btrim(p_payload->>'backup_label')) NOT BETWEEN 1 AND 200) OR ((p_payload->>'due_on' IS NULL)<>(p_payload->>'due_provenance' IS NULL)) OR (p_payload->>'due_provenance' IS NOT NULL AND (jsonb_typeof(p_payload->'due_provenance')<>'string' OR length(due_evidence) NOT BETWEEN 1 AND 1000)) THEN RAISE EXCEPTION 'Configuration must preserve known and unknown facts with provenance' USING ERRCODE='22023';END IF;
  event:=haven.corporate_insert_event(e.id,p_task,'configured',NULL,jsonb_build_object('recipient_label',nullif(btrim(p_payload->>'recipient_label'),''),'backup_label',nullif(btrim(p_payload->>'backup_label'),''),'due_on',(p_payload->>'due_on')::date,'configuration_provenance',btrim(p_payload->>'configuration_provenance'),'due_provenance',due_evidence));
 ELSIF p_action='prepare' THEN
  IF p_payload-ARRAY['expectation_id','expected_revision','source_family','stand_up_week_start','native_version_id']<>'{}'::jsonb OR e.mapping_state='unconfirmed' THEN RAISE EXCEPTION 'Unconfirmed component mapping or native classification cannot prepare a corporate packet' USING ERRCODE='22023';END IF;
  SELECT details INTO configuration FROM haven.corporate_submission_events WHERE expectation_id=e.id AND kind='configured' ORDER BY sequence DESC LIMIT 1;
  IF e.component_key IN('hfo-al-q01-01','hfo-al-c08-01') AND configuration->>'recipient_label' IS NULL THEN RAISE EXCEPTION 'Confirmed current recipient configuration required' USING ERRCODE='22023';END IF;
  IF (e.component_key='hfo-al-m09-01' AND p_payload->>'source_family' NOT IN('census','stand_up')) OR (e.component_key IN('hfo-al-m09-03','hfo-al-q01-01') AND p_payload->>'source_family'<>'trust') OR (e.component_key='hfo-al-c08-01' AND p_payload->>'source_family'<>'resident_document') THEN RAISE EXCEPTION 'Native source does not match the corporate component' USING ERRCODE='22023';END IF;
  IF p_payload->>'source_family' IN('census','trust') THEN
   IF p_payload->>'stand_up_week_start' IS NOT NULL OR p_payload->>'native_version_id' IS NOT NULL THEN RAISE EXCEPTION 'Unexpected native source identity' USING ERRCODE='22023';END IF;
   native:=public.read_finance_operation_source_input(p_task,e.period_start,e.period_end);SELECT value INTO family FROM jsonb_array_elements(native->'families') WHERE value->>'family'=p_payload->>'source_family';
   IF native->>'complete'<>'true' OR family IS NULL OR family->>'availability'<>'available' THEN RAISE EXCEPTION 'Complete current native source required' USING ERRCODE='42501';END IF;
   captured:=jsonb_build_object('source_kind','finance_operation_source_snapshot','family',family->>'family','period_start',e.period_start,'period_end',e.period_end,'records',family->'records','missing_dates',family->'missing_dates','source_observed_version',native->>'source_version');
   source_version:=encode(sha256(convert_to(jsonb_build_object('family',family->>'family','period_start',e.period_start,'period_end',e.period_end,'records',family->'records','missing_dates',family->'missing_dates')::text,'UTF8')),'hex');
  ELSIF p_payload->>'source_family'='stand_up' THEN
   IF p_payload->>'native_version_id' IS NOT NULL OR p_payload->>'stand_up_week_start' IS NULL THEN RAISE EXCEPTION 'Exact Stand Up week required' USING ERRCODE='22023';END IF;
   week:=(p_payload->>'stand_up_week_start')::date;IF extract(isodow FROM week)<>1 OR week NOT BETWEEN e.period_start AND e.period_end THEN RAISE EXCEPTION 'Stand Up source requires an in-period Monday' USING ERRCODE='22023';END IF;
   native:=public.stand_up_command('export',jsonb_build_object('facility_id',e.facility_id,'week_start',week));
   IF native->>'schema_version'<>'standup-2026-v1' OR (native->>'facility_id')::uuid<>e.facility_id OR (SELECT count(*) FROM jsonb_object_keys(native->'values'))<>16 OR native->>'baseline_id' IS NULL OR coalesce((native->>'version')::integer,0)<1 OR native->>'source_as_of' IS NULL THEN RAISE EXCEPTION 'Actual immutable native Stand Up revision required; missing report remains missing' USING ERRCODE='42501';END IF;
   captured:=jsonb_build_object('source_kind','stand_up_command_export','schema_version',native->>'schema_version','facility_id',native->'facility_id','week_start',native->'week_start','baseline_id',native->'baseline_id','version',native->'version','source_as_of',native->'source_as_of','values',native->'values');
  ELSE
   IF p_payload->>'native_version_id' IS NULL OR p_payload->>'stand_up_week_start' IS NOT NULL THEN RAISE EXCEPTION 'Exact current native document version required' USING ERRCODE='22023';END IF;
   native:=public.provider_document_target(p_task,(p_payload->>'native_version_id')::uuid);
   IF native#>>'{version,state}'<>'finalized' OR native#>>'{version,native_current}'<>'true' THEN RAISE EXCEPTION 'Current finalized native document required' USING ERRCODE='42501';END IF;
   captured:=jsonb_build_object('source_kind','resident_document_version','native_version_id',native#>'{version,id}','native_document_id',native#>'{version,native_document_id}','document_type',native#>'{version,document_type}','title',native#>'{version,title}','revision',native#>'{version,revision}','finalized_at',native#>'{version,finalized_at}');
  END IF;
  source_version:=coalesce(source_version,encode(sha256(convert_to(captured::text,'UTF8')),'hex'));SELECT * INTO v FROM haven.corporate_submission_versions WHERE expectation_id=e.id ORDER BY version DESC LIMIT 1;
  PERFORM haven.assert_corporate_source_capture_bound(captured);
  IF v.id IS NULL OR v.source_version<>source_version OR v.source_family<>p_payload->>'source_family' THEN
   IF coalesce(v.version,0)>=100 THEN RAISE EXCEPTION 'Corporate source version bound reached before mutation' USING ERRCODE='54000';END IF;
   version_no:=coalesce(v.version,0)+1;INSERT INTO haven.corporate_submission_versions(expectation_id,task_id,version,source_family,source_version,captured,prepared_by,prepared_at) VALUES(e.id,p_task,version_no,p_payload->>'source_family',source_version,captured,actor,clock_timestamp()) RETURNING * INTO v;
   event:=haven.corporate_insert_event(e.id,p_task,'prepared',v.id,jsonb_build_object('version_id',v.id,'preparation_only',true,'external_transmission',false));
  END IF;
 ELSIF p_action IN('sent','received','accepted','rejected','link_follow_up') THEN
  SELECT * INTO v FROM haven.corporate_submission_versions WHERE id=(p_payload->>'version_id')::uuid AND expectation_id=e.id;
  IF p_action<>'link_follow_up' AND NOT FOUND THEN RAISE EXCEPTION 'Exact corporate packet version required' USING ERRCODE='42501';END IF;
  IF p_action='sent' AND EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind IN('sent','received','accepted','rejected')) THEN RAISE EXCEPTION 'Packet lifecycle cannot regress to sent' USING ERRCODE='40001';
  ELSIF p_action='received' AND EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind IN('received','accepted','rejected')) THEN RAISE EXCEPTION 'Packet lifecycle cannot regress to received' USING ERRCODE='40001';
  ELSIF p_action='accepted' AND EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind IN('accepted','rejected')) THEN RAISE EXCEPTION 'Packet version already has a terminal decision' USING ERRCODE='40001';
  ELSIF p_action='rejected' AND EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind IN('accepted','rejected')) THEN RAISE EXCEPTION 'Packet version already has a terminal decision' USING ERRCODE='40001';END IF;
  SELECT details INTO configuration FROM haven.corporate_submission_events WHERE expectation_id=e.id AND kind='configured' ORDER BY sequence DESC LIMIT 1;
  SELECT f.timezone INTO site_timezone FROM public.facilities f WHERE id=e.facility_id;
  IF p_action='sent' THEN
   IF p_payload-ARRAY['expectation_id','expected_revision','version_id','channel','source_evidence','sent_at','sent_on']<>'{}'::jsonb OR configuration->>'recipient_label' IS NULL THEN RAISE EXCEPTION 'Current recipient and attributable sent evidence required' USING ERRCODE='22023';END IF;
   PERFORM haven.provider_report_time(p_payload,'sent_at','sent_on',(SELECT timezone FROM public.facilities WHERE id=e.facility_id),true,false);PERFORM haven.provider_report_text(p_payload,'channel');PERFORM haven.provider_report_text(p_payload,'source_evidence');event:=haven.corporate_insert_event(e.id,p_task,'sent',v.id,p_payload-ARRAY['expectation_id','expected_revision','version_id']||jsonb_build_object('recipient_label',configuration->>'recipient_label','recording_kind','operator_recorded','provider_receipt',false));
  ELSIF p_action='received' THEN
   IF p_payload-ARRAY['expectation_id','expected_revision','version_id','channel','source_evidence','received_at','received_on']<>'{}'::jsonb THEN RAISE EXCEPTION 'Attributable received evidence required' USING ERRCODE='22023';END IF;
   PERFORM haven.provider_report_time(p_payload,'received_at','received_on',(SELECT timezone FROM public.facilities WHERE id=e.facility_id),true,false);PERFORM haven.provider_report_text(p_payload,'channel');PERFORM haven.provider_report_text(p_payload,'source_evidence');event:=haven.corporate_insert_event(e.id,p_task,'received',v.id,p_payload-ARRAY['expectation_id','expected_revision','version_id']||jsonb_build_object('recording_kind','operator_recorded','acceptance',false));
   SELECT * INTO prior_event FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind='sent' ORDER BY sequence DESC LIMIT 1;IF prior_event.id IS NOT NULL AND haven.corporate_evidence_before(p_payload,'received_at','received_on',prior_event.details,'sent_at','sent_on',site_timezone) THEN RAISE EXCEPTION 'Received evidence cannot precede sent evidence' USING ERRCODE='22023';END IF;
  ELSIF p_action='accepted' THEN
   IF p_payload-ARRAY['expectation_id','expected_revision','version_id','approver_label','source_evidence','accepted_at','accepted_on']<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind='received') THEN RAISE EXCEPTION 'Receipt and attributable acceptance evidence required' USING ERRCODE='22023';END IF;
   PERFORM haven.provider_report_time(p_payload,'accepted_at','accepted_on',(SELECT timezone FROM public.facilities WHERE id=e.facility_id),true,false);PERFORM haven.provider_report_text(p_payload,'approver_label',200);PERFORM haven.provider_report_text(p_payload,'source_evidence');SELECT * INTO prior_event FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind='received' ORDER BY sequence DESC LIMIT 1;IF haven.corporate_evidence_before(p_payload,'accepted_at','accepted_on',prior_event.details,'received_at','received_on',site_timezone) THEN RAISE EXCEPTION 'Acceptance evidence cannot precede receipt evidence' USING ERRCODE='22023';END IF;event:=haven.corporate_insert_event(e.id,p_task,'accepted',v.id,p_payload-ARRAY['expectation_id','expected_revision','version_id']||jsonb_build_object('recording_kind','operator_recorded','accepted_version_id',v.id));
  ELSE
   PERFORM haven.lock_corporate_issue_ownership((p_payload->>'issue_id')::uuid);
   SELECT * INTO issue FROM public.operation_issues WHERE id=(p_payload->>'issue_id')::uuid FOR UPDATE;
   IF issue.id IS NULL OR (issue.owner_user_id IS NULL AND issue.owner_role IS NULL) OR NOT haven.operation_issue_owner_current(issue.owner_user_id,issue.owner_role,issue.organization_id,issue.facility_id) THEN RAISE EXCEPTION 'Existing unresolved issue with a current owner required' USING ERRCODE='42501';END IF;
   IF issue.organization_id<>e.organization_id OR issue.facility_id<>e.facility_id OR issue.subject_id IS DISTINCT FROM (c->>'subject_id')::uuid OR issue.task_instance_id IS DISTINCT FROM p_task OR issue.status='resolved' THEN RAISE EXCEPTION 'Same-task unresolved issue required' USING ERRCODE='42501';END IF;
   IF p_action='rejected' THEN
    IF p_payload-ARRAY['expectation_id','expected_revision','version_id','reason','issue_id','channel','source_evidence','rejected_at','rejected_on']<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind='received') THEN RAISE EXCEPTION 'Rejected packet requires prior receipt and attributable rejection evidence' USING ERRCODE='22023';END IF;
    PERFORM haven.provider_report_text(p_payload,'reason');PERFORM haven.provider_report_text(p_payload,'channel');PERFORM haven.provider_report_text(p_payload,'source_evidence');PERFORM haven.provider_report_time(p_payload,'rejected_at','rejected_on',(SELECT timezone FROM public.facilities WHERE id=e.facility_id),true,false);SELECT * INTO prior_event FROM haven.corporate_submission_events WHERE expectation_id=e.id AND version_id=v.id AND kind='received' ORDER BY sequence DESC LIMIT 1;IF haven.corporate_evidence_before(p_payload,'rejected_at','rejected_on',prior_event.details,'received_at','received_on',site_timezone) THEN RAISE EXCEPTION 'Rejection evidence cannot precede receipt evidence' USING ERRCODE='22023';END IF;
    event:=haven.corporate_insert_event(e.id,p_task,'rejected',v.id,(p_payload-ARRAY['expectation_id','expected_revision','version_id','issue_id'])||jsonb_build_object('issue_id',issue.id,'issue_revision',issue.issue_revision,'owner_user_id',issue.owner_user_id,'owner_role',issue.owner_role,'backup_user_id',issue.backup_user_id,'backup_role',issue.backup_role,'issue_status',issue.status,'follow_up_at',issue.follow_up_at,'next_action','Owner to correct the rejected packet; resolution remains separate','recording_kind','operator_recorded'));
   ELSE
    IF p_payload-ARRAY['expectation_id','expected_revision','problem_state','issue_id']<>'{}'::jsonb OR p_payload->>'problem_state' NOT IN('missing','late','rejected') THEN RAISE EXCEPTION 'Follow-up problem state invalid' USING ERRCODE='22023';END IF;
    IF p_payload->>'problem_state'='missing' AND EXISTS(SELECT 1 FROM haven.corporate_submission_versions WHERE expectation_id=e.id) THEN RAISE EXCEPTION 'Missing follow-up requires no prepared packet version' USING ERRCODE='22023';END IF;
    IF p_payload->>'problem_state'='late' AND (configuration->>'due_on' IS NULL OR (configuration->>'due_on')::date >= (clock_timestamp() AT TIME ZONE(SELECT timezone FROM public.facilities WHERE id=e.facility_id))::date) THEN RAISE EXCEPTION 'Late follow-up requires a passed documented due date' USING ERRCODE='22023';END IF;
    IF p_payload->>'problem_state'='late' AND EXISTS(SELECT 1 FROM haven.corporate_submission_versions latest JOIN haven.corporate_submission_events done ON done.expectation_id=latest.expectation_id AND done.version_id=latest.id AND done.kind IN('received','accepted','rejected') WHERE latest.expectation_id=e.id AND latest.version=(SELECT max(version) FROM haven.corporate_submission_versions WHERE expectation_id=e.id)) THEN RAISE EXCEPTION 'Late follow-up requires the latest packet to remain unreceived' USING ERRCODE='22023';END IF;
    IF p_payload->>'problem_state'='rejected' AND NOT EXISTS(SELECT 1 FROM haven.corporate_submission_versions latest JOIN haven.corporate_submission_events rejected ON rejected.expectation_id=latest.expectation_id AND rejected.version_id=latest.id AND rejected.kind='rejected' WHERE latest.expectation_id=e.id AND latest.version=(SELECT max(version) FROM haven.corporate_submission_versions WHERE expectation_id=e.id)) THEN RAISE EXCEPTION 'Rejected follow-up requires the latest packet version to be rejected' USING ERRCODE='22023';END IF;
    event:=haven.corporate_insert_event(e.id,p_task,'follow_up_linked',NULL,jsonb_build_object('problem_state',p_payload->>'problem_state','issue_id',issue.id,'issue_revision',issue.issue_revision,'owner_user_id',issue.owner_user_id,'owner_role',issue.owner_role,'backup_user_id',issue.backup_user_id,'backup_role',issue.backup_role,'issue_status',issue.status,'follow_up_at',issue.follow_up_at,'next_action',CASE p_payload->>'problem_state' WHEN 'missing' THEN 'Owner to obtain or prepare the missing packet' WHEN 'late' THEN 'Owner to follow the documented overdue packet' ELSE 'Owner to correct the rejected packet' END));
   END IF;
  END IF;
 ELSE
  IF p_payload-ARRAY['period_start','period_end','coverage_revision','presented_at','presented_on','presentation_provenance']<>'{}'::jsonb OR (p_payload->>'presented_at' IS NOT NULL AND p_payload->>'presented_on' IS NOT NULL) OR ((p_payload->>'presented_at' IS NOT NULL OR p_payload->>'presented_on' IS NOT NULL)<>(p_payload->>'presentation_provenance' IS NOT NULL)) THEN RAISE EXCEPTION 'Meeting presentation provenance and precision invalid' USING ERRCODE='22023';END IF;
  PERFORM haven.provider_report_time(p_payload,'presented_at','presented_on',(SELECT timezone FROM public.facilities WHERE id=(c->>'facility_id')::uuid),false,false);
  IF p_payload->>'presentation_provenance' IS NOT NULL THEN PERFORM haven.provider_report_text(p_payload,'presentation_provenance');END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('corporate-coverage:'||(c->>'organization_id')||':'||(c->>'activity_key')||':'||(c->>'subject_kind')||':'||coalesce(c->>'resident_id','none')||':'||(c->>'period_start')||':'||(c->>'period_end'),0));
  SELECT * INTO coverage FROM haven.corporate_coverage_sets WHERE organization_id=(c->>'organization_id')::uuid AND component_key=c->>'activity_key' AND subject_kind=c->>'subject_kind' AND resident_id IS NOT DISTINCT FROM (c->>'resident_id')::uuid AND period_start=(c->>'period_start')::date AND period_end=(c->>'period_end')::date ORDER BY version DESC LIMIT 1;
  IF coverage.id IS NULL OR coverage.revision IS DISTINCT FROM (p_payload->>'coverage_revision')::uuid THEN RAISE EXCEPTION 'Expected site set changed' USING ERRCODE='40001';END IF;
  PERFORM 1 FROM public.facilities f WHERE f.organization_id=coverage.organization_id AND f.deleted_at IS NULL AND f.id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(coverage.facility_ids)) ORDER BY f.id FOR SHARE;
  SELECT count(*) INTO valid_count FROM public.facilities f WHERE f.organization_id=coverage.organization_id AND f.deleted_at IS NULL AND f.id IN(SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(coverage.facility_ids)) AND haven.has_facility_access(f.id);
  IF valid_count<>jsonb_array_length(coverage.facility_ids) THEN RAISE EXCEPTION 'Every captured expected site requires current organization access' USING ERRCODE='42501';END IF;
  snapshot:=haven.corporate_snapshot_data(p_task,coverage.period_start,coverage.period_end);
  IF snapshot->>'coverage_complete'<>'true' THEN RAISE EXCEPTION 'Incomplete or unreadable expected-site coverage cannot be captured' USING ERRCODE='42501';END IF;
  snapshot:=haven.corporate_meeting_projection(snapshot);
  IF (SELECT count(*) FROM haven.corporate_meeting_captures WHERE organization_id=coverage.organization_id AND component_key=coverage.component_key AND subject_kind=coverage.subject_kind AND resident_id IS NOT DISTINCT FROM coverage.resident_id AND period_start=coverage.period_start AND period_end=coverage.period_end)>=100 THEN RAISE EXCEPTION 'Corporate meeting history bound reached before mutation' USING ERRCODE='54000';END IF;
  IF p_payload->>'presented_at' IS NOT NULL THEN at_value:=(p_payload->>'presented_at')::timestamptz;ELSIF p_payload->>'presented_on' IS NOT NULL THEN on_value:=(p_payload->>'presented_on')::date;END IF;
  INSERT INTO haven.corporate_meeting_captures(organization_id,component_key,subject_kind,resident_id,period_start,period_end,coverage_revision,captured_at,captured_by,presented_at,presented_on,presentation_provenance,snapshot)
  VALUES((c->>'organization_id')::uuid,c->>'activity_key',c->>'subject_kind',(c->>'resident_id')::uuid,coverage.period_start,coverage.period_end,coverage.revision,clock_timestamp(),actor,at_value,on_value,nullif(btrim(p_payload->>'presentation_provenance'),''),snapshot-ARRAY['meetings','meetings_complete']) RETURNING id INTO revision;
 END IF;
 INSERT INTO haven.corporate_deliverable_requests(actor_id,request_key,task_id,action,request_hash,period_start,period_end,created_at) VALUES(actor,p_request_key,p_task,p_action,request_hash,(c->>'period_start')::date,(c->>'period_end')::date,clock_timestamp());
 PERFORM set_config('haven.corporate_deliverable_command','',true);
 c:=haven.corporate_deliverable_context(p_task,(c->>'period_start')::date,(c->>'period_end')::date);
 RETURN jsonb_build_object('period_start',c->>'period_start','period_end',c->>'period_end','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.corporate_deliverable_command(uuid,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.corporate_deliverable_command(uuid,text,text,jsonb) TO authenticated;

COMMENT ON TABLE haven.corporate_submission_expectations IS 'COL-160 stable expected-submission identity: organization, site, exact component, explicit period and supported native subject. Task/request/recipient/version are excluded from identity.';
COMMENT ON TABLE haven.corporate_submission_versions IS 'COL-160 immutable server-captured native source versions. Preparation is never sent, received, accepted or provider acknowledgment.';
COMMENT ON TABLE haven.corporate_meeting_captures IS 'COL-160 immutable expected-site meeting view with capture time separate from attributable presentation date/time.';
COMMENT ON FUNCTION public.corporate_deliverable_snapshot(uuid,date,date) IS 'COL-160 current-authority corporate detail. Missing sites stay missing; any unreadable expected site refuses detailed partial coverage.';
COMMENT ON FUNCTION public.corporate_deliverable_command(uuid,text,text,jsonb) IS 'COL-160 command-only local recording. No email/provider/Front Office transmission, schedule activation or operating acceptance.';
NOTIFY pgrst,'reload schema';
COMMIT;
