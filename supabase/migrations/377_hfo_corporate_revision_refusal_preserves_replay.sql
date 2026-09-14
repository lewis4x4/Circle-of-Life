BEGIN;
-- COL-326 forward correction of 376: an obsolete expectation revision is still
-- refused at once, but an already-recorded request key is never pre-empted, so
-- idempotent replay survives. Preserves migrations 374, 375 and 376, the
-- existing function grants and ownership, and every immutable historical
-- request, version, event and capture. The signature is unchanged, so 374's
-- REVOKE/GRANT on this function continue to apply.
CREATE OR REPLACE FUNCTION public.corporate_deliverable_command(p_task uuid,p_request_key text,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;e haven.corporate_submission_expectations;coverage haven.corporate_coverage_sets;prior haven.corporate_deliverable_requests;v haven.corporate_submission_versions;event haven.corporate_submission_events;prior_event haven.corporate_submission_events;configuration jsonb;expected_sites jsonb;site_count integer;valid_count integer;request_hash text;actor uuid;family jsonb;native jsonb;captured jsonb;source_version text;issue public.operation_issues;snapshot jsonb;week date;version_no integer;at_value timestamptz;on_value date;revision uuid;site_timezone text;due_evidence text;
BEGIN
 IF p_request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_action NOT IN('register','configure','prepare','sent','received','accepted','rejected','link_follow_up','capture_meeting') THEN RAISE EXCEPTION 'Valid corporate command and request key required' USING ERRCODE='22023';END IF;
 actor:=haven.authorized_user_id();IF actor IS NULL THEN RAISE EXCEPTION 'Corporate authority required' USING ERRCODE='42501';END IF;
 -- COL-326 fast refusal for an obsolete expectation revision, corrected.
 -- The authoritative check below is reached only after this command takes the
 -- operation authority row lock on the task, the source-family table locks and
 -- the per-expectation advisory lock, so a stale revision was observed as a
 -- multi-minute wait rather than a refusal.
 --
 -- 376 refused too early: it ran before the request-key replay return below, so
 -- the byte-identical retry of a command that had already succeeded was refused
 -- 40001 instead of replayed. Every gated action appends an event and
 -- corporate_expectation_revision() returns the newest event id, so a success
 -- always advances the revision past the expected_revision its own retry must
 -- carry. That destroyed the idempotent replay request_key exists to provide
 -- and reported a committed change as rejected. Skipping the fast path for an
 -- already-recorded request key restores it: a replay falls through untouched.
 --
 -- The fast path now fires only when scope, authority and staleness all hold --
 -- exactly the state in which the locked check below raises 40001 -- so it can
 -- refuse nothing the unpatched function would have accepted, and an
 -- out-of-scope or unauthorised caller still reaches the original 42501.
 IF p_action NOT IN('register','capture_meeting') AND p_payload ? 'expectation_id' AND p_payload ? 'expected_revision'
    AND NOT EXISTS(SELECT 1 FROM haven.corporate_deliverable_requests WHERE actor_id=actor AND request_key=p_request_key) THEN
  SELECT * INTO e FROM haven.corporate_submission_expectations WHERE id=(p_payload->>'expectation_id')::uuid;
  IF FOUND THEN
   c:=haven.corporate_deliverable_context(p_task,e.period_start,e.period_end);
   IF (e.organization_id,e.facility_id,e.component_key,e.subject_kind,e.resident_id) IS NOT DISTINCT FROM((c->>'organization_id')::uuid,(c->>'facility_id')::uuid,c->>'activity_key',c->>'subject_kind',(c->>'resident_id')::uuid)
      AND coalesce((c->>'can_manage')::boolean,false)
      AND (p_payload->>'expected_revision')::uuid IS DISTINCT FROM haven.corporate_expectation_revision(e.id) THEN
    RAISE EXCEPTION 'Corporate expectation changed' USING ERRCODE='40001';
   END IF;
  END IF;
  e:=NULL;c:=NULL;
 END IF;
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
COMMIT;
