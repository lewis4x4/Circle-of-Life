BEGIN;
-- Native read context only. No financial, census or performance write trigger.
CREATE FUNCTION haven.finance_source_context(p_task uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; s public.operation_activity_subjects; a public.operation_activities; f public.facilities;
BEGIN
 IF haven.authorized_user_id() IS NULL OR NOT coalesce(haven.operation_task_readable(p_task),false) THEN RAISE EXCEPTION 'Finance source scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 SELECT * INTO a FROM public.operation_activities WHERE id=t.activity_id;
 SELECT * INTO f FROM public.facilities WHERE id=t.facility_id;
 IF a.activity_key NOT IN('hfo-al-d04-01','hfo-al-d04-02','hfo-al-d17-01','hfo-al-d19-01','hfo-al-w08-01','hfo-al-m07-01','hfo-al-m07-02','hfo-al-m09-01','hfo-al-m09-02','hfo-al-m09-03','hfo-al-m12-01','hfo-al-a09-01','hfo-al-q01-01','hfo-al-n06-01','hfo-al-n07-01','hfo-al-n08-01','hfo-al-n09-01','hfo-al-c01-01','hfo-al-c02-01','hfo-al-c03-01','hfo-al-c04-01','hfo-al-c05-01','hfo-al-c06-01','hfo-al-c07-01','hfo-al-c07-02','hfo-al-c08-01','hfo-al-c09-01') THEN RAISE EXCEPTION 'Finance source scope unavailable' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>=366 OR p_end>(clock_timestamp() AT TIME ZONE coalesce(f.timezone,'America/New_York'))::date THEN RAISE EXCEPTION 'Choose a past/current period of 1 to 366 days' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('task_id',t.id,'activity_key',a.activity_key,'organization_id',t.organization_id,'facility_id',f.id,'entity_id',f.entity_id,
 'subject_kind',s.subject_kind,'resident_id',CASE WHEN s.subject_kind='resident' THEN s.resident_id END,'timezone',coalesce(f.timezone,'America/New_York'),
 'financial_scope',coalesce(haven.operation_domain_access(t.organization_id,t.facility_id,'financial'),false),
 'native_site',f.id IN(SELECT haven.accessible_facility_ids()),
 'native_census',has_table_privilege('authenticated','public.census_daily_log','SELECT'),
 'native_finance',haven.app_role() IN('owner','org_admin','facility_admin') AND has_table_privilege('authenticated','public.payments','SELECT') AND has_table_privilege('authenticated','public.finance_command_receipts','SELECT') AND has_table_privilege('authenticated','public.payment_allocations','SELECT') AND has_table_privilege('authenticated','public.invoices','SELECT') AND has_table_privilege('authenticated','public.finance_source_events','SELECT'),
 'native_handoff',haven.app_role() IN('owner','org_admin','facility_admin') AND has_function_privilege('authenticated','public.finance_review_queue(uuid,uuid,text,timestamp with time zone,uuid,integer)','EXECUTE'),
 'native_legacy',haven.app_role() IN('owner','org_admin','facility_admin') AND has_table_privilege('authenticated','public.trust_account_entries','SELECT'),
 'native_trust',haven.app_role() IN('owner','org_admin','facility_admin','manager','admin_assistant') AND has_table_privilege('authenticated','public.resident_trust_accounts','SELECT') AND has_table_privilege('authenticated','public.resident_trust_transactions','SELECT'));
END $$;
REVOKE ALL ON FUNCTION haven.finance_source_context(uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.finance_source_context(uuid,date,date) TO authenticated;

CREATE FUNCTION public.read_finance_operation_source_input(p_task uuid,p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; fresh jsonb; org uuid; site uuid; resident uuid; rows jsonb; families jsonb:='[]'; missing jsonb; allowed boolean; family text; source_hash text;
BEGIN
 c:=haven.finance_source_context(p_task,p_start,p_end); org:=(c->>'organization_id')::uuid;site:=(c->>'facility_id')::uuid;resident:=(c->>'resident_id')::uuid;
 IF resident IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=resident AND r.organization_id=org AND r.facility_id=site AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'Native resident source unavailable' USING ERRCODE='42501'; END IF;
 FOREACH family IN ARRAY ARRAY['census','payments','trust','finance_handoff'] LOOP
  rows:='[]';missing:='[]';
  allowed:=(c->>'native_site')::boolean AND CASE family WHEN 'census' THEN c->>'subject_kind'='facility' AND (c->>'native_census')::boolean WHEN 'payments' THEN (c->>'financial_scope')::boolean AND (c->>'native_finance')::boolean AND c->>'subject_kind' IN('facility','resident') WHEN 'trust' THEN (c->>'financial_scope')::boolean AND (c->>'native_trust')::boolean AND c->>'subject_kind' IN('facility','resident') ELSE (c->>'financial_scope')::boolean AND (c->>'native_handoff')::boolean AND c->>'subject_kind'='facility' END;
  IF allowed AND family='census' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.economic_date,x.id),'[]') INTO rows FROM (
    SELECT d.id,NULL::text native_version,d.log_date economic_date,NULL::date service_period_start,NULL::date service_period_end,d.created_at recorded_at,'recorded_census'::text state,NULL::text amount_cents,
     jsonb_build_object('total_licensed_beds',d.total_licensed_beds,'occupied_beds',d.occupied_beds,'available_beds',d.available_beds,'hold_beds',d.hold_beds,'maintenance_beds',d.maintenance_beds,'admissions_today',d.admissions_today,'discharges_today',d.discharges_today) metrics
    FROM public.census_daily_log d WHERE d.organization_id=org AND d.facility_id=site AND d.log_date BETWEEN p_start AND p_end ORDER BY d.log_date,d.id LIMIT 5001
   ) x;
   SELECT coalesce(jsonb_agg(day::date ORDER BY day),'[]') INTO missing FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') day WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) r WHERE (r->>'economic_date')::date=day::date);
  ELSIF allowed AND family='payments' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.economic_date,x.id),'[]') INTO rows FROM (
    SELECT p.id,e.source_version native_version,p.payment_date economic_date,i.period_start service_period_start,i.period_end service_period_end,r.created_at recorded_at,
     CASE WHEN p.invoice_id IS NOT NULL AND i.id IS NULL THEN 'receipt_linked_invoice_unavailable' ELSE 'payment_received' END state,p.amount::text amount_cents,
     jsonb_build_object('allocated_cents',alloc.amount_cents::text,'unapplied_cents',(p.amount-coalesce(alloc.amount_cents,0))::text,'invoice_id',i.id) metrics,
     i.status::text invoice_status,i.finance_origin invoice_origin,i.updated_at invoice_updated_at
    FROM public.payments p JOIN public.finance_command_receipts r ON r.command_type='payment' AND r.id=p.id AND r.organization_id=p.organization_id AND r.facility_id=p.facility_id AND r.entity_id=p.entity_id
    JOIN public.finance_source_events e ON e.receipt_type=r.command_type AND e.receipt_id=r.id AND e.source_id=p.id AND e.operation='payment_received' AND e.organization_id=p.organization_id AND e.entity_id=p.entity_id AND e.facility_id=p.facility_id
    LEFT JOIN public.payment_allocations alloc ON alloc.payment_id=p.id AND alloc.invoice_id=p.invoice_id AND alloc.organization_id=p.organization_id AND alloc.facility_id=p.facility_id
    LEFT JOIN public.invoices i ON i.id=alloc.invoice_id AND i.resident_id=p.resident_id AND i.facility_id=p.facility_id AND i.organization_id=p.organization_id AND i.entity_id=p.entity_id AND i.deleted_at IS NULL
    WHERE p.organization_id=org AND p.facility_id=site AND p.entity_id=(c->>'entity_id')::uuid AND (resident IS NULL OR p.resident_id=resident) AND p.deleted_at IS NULL AND p.payment_date BETWEEN p_start AND p_end
    ORDER BY p.payment_date,p.id LIMIT 5001
   ) x;
  ELSIF allowed AND family='trust' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.state,x.id),'[]') INTO rows FROM (
    SELECT t.id,NULL::text native_version,(t.occurred_at AT TIME ZONE(c->>'timezone'))::date economic_date,NULL::date service_period_start,NULL::date service_period_end,t.created_at recorded_at,'canonical_trust_transaction'::text state,t.amount_cents::text amount_cents,
     jsonb_build_object('account_id',a.id,'direction',t.direction,'external_reconciliation','NOT_VERIFIED') metrics
    FROM public.resident_trust_transactions t JOIN public.resident_trust_accounts a ON a.id=t.account_id AND a.organization_id=t.organization_id AND a.facility_id=t.facility_id AND a.resident_id=t.resident_id AND a.deleted_at IS NULL
    WHERE t.organization_id=org AND t.facility_id=site AND (resident IS NULL OR t.resident_id=resident) AND t.deleted_at IS NULL AND t.occurred_at>=(p_start::timestamp AT TIME ZONE(c->>'timezone')) AND t.occurred_at<((p_end+1)::timestamp AT TIME ZONE(c->>'timezone'))
    UNION ALL
    SELECT a.id,NULL,NULL,NULL,NULL,a.created_at,'canonical_trust_account',NULL,jsonb_build_object('account_id',a.id,'canonical_balance_cents',a.balance_cents::text,'external_reconciliation','NOT_VERIFIED')
    FROM public.resident_trust_accounts a WHERE a.organization_id=org AND a.facility_id=site AND (resident IS NULL OR a.resident_id=resident) AND a.deleted_at IS NULL
    UNION ALL
    SELECT l.id,NULL,l.entry_date,NULL,NULL,l.created_at,'legacy_trust_entry_context',NULL,jsonb_build_object('legacy_balance_cents',l.balance_after_cents::text,'legacy_review_required',true,'external_reconciliation','NOT_VERIFIED')
    FROM public.trust_account_entries l WHERE (c->>'native_legacy')::boolean AND l.organization_id=org AND l.facility_id=site AND (resident IS NULL OR l.resident_id=resident) AND l.deleted_at IS NULL AND l.entry_date BETWEEN p_start AND p_end
    LIMIT 5001
   ) x;
  ELSIF allowed AND family='finance_handoff' THEN
   -- The native queue is the authorized batch discovery surface. A single
   -- recursive statement preserves its STABLE snapshot across bounded pages.
   WITH RECURSIVE pages(n,document) AS (
    SELECT 1,public.finance_review_queue((c->>'entity_id')::uuid,site,'batches',NULL,NULL,100)
    UNION ALL
    SELECT n+1,public.finance_review_queue((c->>'entity_id')::uuid,site,'batches',(document#>>'{next_cursor,created_at}')::timestamptz,(document#>>'{next_cursor,id}')::uuid,100)
    FROM pages WHERE (document->>'has_more')::boolean AND n<=50
   ), items AS (
    SELECT item FROM pages CROSS JOIN LATERAL jsonb_array_elements(document->'items') item
   ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',item->>'id','native_version',item->>'binding_sha256','economic_date',item->>'accounting_date',
    'service_period_start',NULL,'service_period_end',NULL,'recorded_at',item->>'created_at','state',item->>'status','amount_cents',NULL,
    'metrics',jsonb_build_object('dispatch_enabled',false,'accounting_classification','unverified','external_acknowledgment','unavailable'),
    'control_hash',encode(sha256(convert_to(item::text,'UTF8')),'hex')) ORDER BY item->>'id') FILTER(WHERE (item->>'accounting_date')::date BETWEEN p_start AND p_end),'[]'),
    coalesce((SELECT bool_or((document->>'has_more')::boolean AND n=51) OR sum(jsonb_array_length(document->'items'))>5000 FROM pages),false)
   INTO rows,allowed FROM items;
   IF allowed THEN RAISE EXCEPTION 'Native handoff discovery exceeds complete reader bound' USING ERRCODE='54000'; END IF;
   allowed:=true;
  END IF;
  IF jsonb_array_length(rows)>5000 THEN RAISE EXCEPTION 'Source period exceeds complete reader bound; choose a shorter period' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg((x-ARRAY['invoice_status','invoice_origin','invoice_updated_at','member_hash','control_hash','rules_generation','staging_generation','updated_at'])||jsonb_build_object('version',encode(sha256(convert_to(x::text,'UTF8')),'hex')) ORDER BY x->>'state',x->>'id'),'[]') INTO rows FROM jsonb_array_elements(rows) x;
  families:=families||jsonb_build_array(jsonb_build_object('family',family,'availability',CASE WHEN allowed THEN 'available' ELSE 'unavailable' END,'reason',CASE WHEN NOT allowed THEN 'Current native and HFO scope required; no empty-source conclusion.' WHEN family='census' THEN 'Recorded daily counts only; missing dates, physical presence, billable days and approval remain distinct.' WHEN family='payments' THEN 'Native received-payment receipts only; service period is separate. Legacy/unreceipted payments and rent-in-full rules are not established.' WHEN family='trust' THEN CASE WHEN (c->>'native_legacy')::boolean THEN 'Canonical and legacy context remain separate; account balance is current, not a historical opening balance; external reconciliation NOT_VERIFIED.' ELSE 'Canonical context only; legacy entries are unavailable under current native billing authority. Account balance is current, not a historical opening balance; external reconciliation NOT_VERIFIED.' END ELSE 'Local prepared/approval/invalidation only; dispatch and external acknowledgment unavailable.' END,'records',rows,'missing_dates',missing));
 END LOOP;
 fresh:=haven.finance_source_context(p_task,p_start,p_end); IF fresh IS DISTINCT FROM c THEN RAISE EXCEPTION 'Finance source authority changed' USING ERRCODE='42501'; END IF;
 source_hash:=encode(sha256(convert_to(families::text,'UTF8')),'hex');
 RETURN jsonb_build_object('task_id',p_task,'activity_key',c->>'activity_key','subject_kind',c->>'subject_kind','resident_id',resident,'facility_id',site,'start_date',p_start,'end_date',p_end,'timezone',c->>'timezone','source_version',source_hash,'complete',true,'families',families,'history','[]'::jsonb,'history_complete',true);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_operation_source_input(uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_operation_source_input(uuid,date,date) TO authenticated;

CREATE FUNCTION haven.finance_source_visibility(p_task uuid,p_start date,p_end date) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;
BEGIN
 IF NOT coalesce(haven.operation_task_readable(p_task),false) THEN RETURN NULL; END IF;
 c:=haven.finance_source_context(p_task,p_start,p_end);
 IF c->>'resident_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=(c->>'resident_id')::uuid AND r.facility_id=(c->>'facility_id')::uuid AND r.organization_id=(c->>'organization_id')::uuid AND r.deleted_at IS NULL) THEN RETURN NULL; END IF;
 RETURN encode(sha256(convert_to(c::text,'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION haven.finance_source_visibility(uuid,date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.finance_source_visibility(uuid,date,date) TO authenticated;
CREATE TABLE haven.finance_source_transitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),start_date date NOT NULL,end_date date NOT NULL,visibility_key text NOT NULL,
 source_version text NOT NULL,observed_at timestamptz NOT NULL,sequence bigint NOT NULL,
 UNIQUE(task_id,actor_id,start_date,end_date,visibility_key,sequence)
);
CREATE TABLE haven.finance_source_requests (
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),request_key text NOT NULL,task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),start_date date NOT NULL,end_date date NOT NULL,
 transition_id uuid NOT NULL REFERENCES haven.finance_source_transitions(id),PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE haven.finance_source_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.finance_source_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.finance_source_transitions,haven.finance_source_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.finance_source_transitions,haven.finance_source_requests TO authenticated;
CREATE POLICY finance_source_transition_read ON haven.finance_source_transitions FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND visibility_key=haven.finance_source_visibility(task_id,start_date,end_date));
CREATE POLICY finance_source_transition_insert ON haven.finance_source_transitions FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND visibility_key=haven.finance_source_visibility(task_id,start_date,end_date));
CREATE POLICY finance_source_request_read ON haven.finance_source_requests FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND haven.operation_task_readable(task_id));
CREATE POLICY finance_source_request_insert ON haven.finance_source_requests FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND EXISTS(SELECT 1 FROM haven.finance_source_transitions t WHERE t.id=transition_id AND t.task_id=finance_source_requests.task_id AND t.start_date=finance_source_requests.start_date AND t.end_date=finance_source_requests.end_date));
CREATE FUNCTION haven.guard_finance_source_transition() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb; previous haven.finance_source_transitions; captured_visibility text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Finance source history is immutable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hfo-finance-source:'||NEW.task_id::text||':'||haven.authorized_user_id()::text||':'||NEW.start_date::text||':'||NEW.end_date::text,0));
 captured_visibility:=haven.finance_source_visibility(NEW.task_id,NEW.start_date,NEW.end_date);
 input:=public.read_finance_operation_source_input(NEW.task_id,NEW.start_date,NEW.end_date);
 IF captured_visibility IS NULL OR captured_visibility IS DISTINCT FROM haven.finance_source_visibility(NEW.task_id,NEW.start_date,NEW.end_date) THEN RAISE EXCEPTION 'Finance visibility changed during capture' USING ERRCODE='42501'; END IF;
 NEW.actor_id:=haven.authorized_user_id();NEW.visibility_key:=captured_visibility;NEW.source_version:=input->>'source_version';NEW.observed_at:=clock_timestamp();
 SELECT * INTO previous FROM haven.finance_source_transitions WHERE task_id=NEW.task_id AND actor_id=NEW.actor_id AND start_date=NEW.start_date AND end_date=NEW.end_date AND visibility_key=NEW.visibility_key ORDER BY sequence DESC LIMIT 1;
 IF FOUND AND previous.source_version=NEW.source_version THEN RETURN NULL; END IF;
 NEW.sequence:=coalesce(previous.sequence,0)+1;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_source_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_source_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.finance_source_transitions FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_source_transition();
CREATE TRIGGER finance_source_transition_no_truncate BEFORE TRUNCATE ON haven.finance_source_transitions FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_finance_source_transition();
CREATE FUNCTION haven.guard_finance_source_request() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb;latest haven.finance_source_transitions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Finance source request history is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hfo-finance-source:'||NEW.task_id::text||':'||haven.authorized_user_id()::text||':'||NEW.start_date::text||':'||NEW.end_date::text,0));
 input:=public.read_finance_operation_source_input(NEW.task_id,NEW.start_date,NEW.end_date);
 SELECT * INTO latest FROM haven.finance_source_transitions WHERE task_id=NEW.task_id AND actor_id=haven.authorized_user_id() AND start_date=NEW.start_date AND end_date=NEW.end_date AND visibility_key=haven.finance_source_visibility(NEW.task_id,NEW.start_date,NEW.end_date) ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR latest.source_version IS DISTINCT FROM input->>'source_version' THEN RAISE EXCEPTION 'Current source transition required' USING ERRCODE='40001'; END IF;
 NEW.actor_id:=haven.authorized_user_id();NEW.transition_id:=latest.id;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_source_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_source_request_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.finance_source_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_source_request();
CREATE TRIGGER finance_source_request_no_truncate BEFORE TRUNCATE ON haven.finance_source_requests FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_finance_source_request();
CREATE FUNCTION public.finance_operation_source_snapshot(p_task uuid,p_start date,p_end date,p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE input jsonb;prior haven.finance_source_requests;transition uuid;history jsonb;visibility text;total integer;
BEGIN
 IF p_request_key IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('hfo-finance-request:'||haven.authorized_user_id()::text||':'||p_request_key,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hfo-finance-source:'||p_task::text||':'||haven.authorized_user_id()::text||':'||p_start::text||':'||p_end::text,0));
 END IF;
 input:=public.read_finance_operation_source_input(p_task,p_start,p_end);visibility:=haven.finance_source_visibility(p_task,p_start,p_end);
 IF p_request_key IS NOT NULL THEN
  SELECT * INTO prior FROM haven.finance_source_requests WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
  IF FOUND THEN
   IF (prior.task_id,prior.start_date,prior.end_date) IS DISTINCT FROM (p_task,p_start,p_end) THEN RAISE EXCEPTION 'Request key period/scope conflict' USING ERRCODE='23505'; END IF;
  ELSE
   INSERT INTO haven.finance_source_transitions(task_id,start_date,end_date) VALUES(p_task,p_start,p_end) RETURNING id INTO transition;
   IF transition IS NULL THEN SELECT id INTO transition FROM haven.finance_source_transitions WHERE task_id=p_task AND actor_id=haven.authorized_user_id() AND start_date=p_start AND end_date=p_end AND visibility_key=visibility ORDER BY sequence DESC LIMIT 1; END IF;
   INSERT INTO haven.finance_source_requests(request_key,task_id,start_date,end_date,transition_id) VALUES(p_request_key,p_task,p_start,p_end,transition);
  END IF;
 END IF;
 visibility:=haven.finance_source_visibility(p_task,p_start,p_end);
 input:=public.read_finance_operation_source_input(p_task,p_start,p_end);
 IF p_request_key IS NOT NULL AND prior.transition_id IS NULL AND NOT EXISTS(SELECT 1 FROM haven.finance_source_transitions t WHERE t.id=transition AND t.source_version=input->>'source_version') THEN RAISE EXCEPTION 'Finance source changed during refresh' USING ERRCODE='40001'; END IF;
 WITH scoped AS MATERIALIZED (SELECT * FROM haven.finance_source_transitions WHERE task_id=p_task AND start_date=p_start AND end_date=p_end),
 page AS (SELECT * FROM scoped ORDER BY sequence DESC LIMIT 100)
 SELECT (SELECT count(*) FROM scoped),coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'observed_at',observed_at,'source_version',source_version) ORDER BY sequence DESC) FROM page),'[]') INTO total,history;
 IF visibility IS NULL OR visibility IS DISTINCT FROM haven.finance_source_visibility(p_task,p_start,p_end) THEN RAISE EXCEPTION 'Finance visibility changed during history read' USING ERRCODE='42501'; END IF;
 RETURN input||jsonb_build_object('history',history,'history_complete',total<=100);
END $$;
REVOKE ALL ON FUNCTION public.finance_operation_source_snapshot(uuid,date,date,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.finance_operation_source_snapshot(uuid,date,date,text) TO authenticated;
COMMIT;
