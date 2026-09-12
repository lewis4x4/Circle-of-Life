-- F03 local preparation/approval only. No external dispatch or recovery ACK.
BEGIN;

CREATE TABLE public.finance_batch_rule_versions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id), mapping jsonb NOT NULL,
 policy_reference_sha256 text NOT NULL CHECK(policy_reference_sha256 ~ '^[0-9a-f]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 expected_generation bigint NOT NULL CHECK(expected_generation>=0),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), actor_session_id uuid NOT NULL,
 actor_claim_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'declared_draft' CHECK(status='declared_draft')
);
CREATE TABLE public.finance_batch_rule_bindings (
 entity_id uuid PRIMARY KEY REFERENCES public.entities(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 version_id uuid NOT NULL REFERENCES public.finance_batch_rule_versions(id),
 generation bigint NOT NULL CHECK(generation>0)
);
CREATE TABLE public.finance_batches (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id), facility_id uuid REFERENCES public.facilities(id),
 accounting_date date NOT NULL, currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 rules_version_id uuid NOT NULL REFERENCES public.finance_batch_rule_versions(id), rules_generation bigint NOT NULL,
 staging_generation bigint NOT NULL, connection_generation_ref uuid NOT NULL,
 capability_reference_sha256 text NOT NULL, request_sha256 text NOT NULL,
 payload jsonb NOT NULL, payload_sha256 text NOT NULL, member_set_sha256 text NOT NULL,
 source_controls jsonb NOT NULL, source_controls_sha256 text NOT NULL, binding_sha256 text NOT NULL,
 prepared_by uuid NOT NULL REFERENCES public.user_profiles(id), preparer_session_id uuid NOT NULL,
 preparer_claim_version integer NOT NULL, supersedes uuid UNIQUE REFERENCES public.finance_batches(id),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','locally_approved_dispatch_disabled','invalidated','rejected','superseded')),
 accounting_classification text NOT NULL DEFAULT 'unverified' CHECK(accounting_classification='unverified'),
 business_release_eligible boolean NOT NULL DEFAULT false CHECK(NOT business_release_eligible),
 dispatch_enabled boolean NOT NULL DEFAULT false CHECK(NOT dispatch_enabled),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_batch_members (
 batch_id uuid NOT NULL REFERENCES public.finance_batches(id), event_id uuid NOT NULL REFERENCES public.finance_source_events(id),
 member_document jsonb NOT NULL, PRIMARY KEY(batch_id,event_id)
);
CREATE TABLE public.finance_batch_event_claims (
 event_id uuid PRIMARY KEY REFERENCES public.finance_source_events(id),
 batch_id uuid NOT NULL REFERENCES public.finance_batches(id),
 FOREIGN KEY(batch_id,event_id) REFERENCES public.finance_batch_members(batch_id,event_id)
);
CREATE TABLE public.finance_batch_decisions (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES public.finance_batches(id),
 action text NOT NULL CHECK(action IN('prepare','approve','reject','invalidate','supersede')),
 origin text NOT NULL CHECK(origin IN('operator','control','rules','scope','period')),
 actor_id uuid REFERENCES public.user_profiles(id), actor_session_id uuid, actor_claim_version integer,
 binding_sha256 text NOT NULL, request_sha256 text NOT NULL, resulting_status text NOT NULL,
 reason_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((origin='operator' AND actor_id IS NOT NULL AND actor_session_id IS NOT NULL AND actor_claim_version IS NOT NULL)
    OR (origin<>'operator' AND actor_id IS NULL AND actor_session_id IS NULL AND actor_claim_version IS NULL))
);
CREATE UNIQUE INDEX finance_batch_one_approval ON public.finance_batch_decisions(batch_id) WHERE action='approve';
CREATE INDEX finance_batches_entity_status ON public.finance_batches(entity_id,status);
CREATE INDEX finance_batch_members_event ON public.finance_batch_members(event_id);

-- No raw read endpoint may present a stale approval as current. Snapshot RPC
-- computes current authority/control/period validity in one statement snapshot.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finance_batch_rule_versions','finance_batch_rule_bindings','finance_batches','finance_batch_members','finance_batch_event_claims','finance_batch_decisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['finance_batch_rule_versions','finance_batch_members','finance_batch_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_finance_batch_evidence BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation()',t);
 END LOOP;
END $$;

CREATE FUNCTION haven.guard_finance_batch_state() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_user IN('anon','authenticated','service_role') OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Use current-authorized batch commands' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='finance_batches' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at']) THEN RAISE EXCEPTION 'Batch evidence is immutable' USING ERRCODE='42501'; END IF;
  IF OLD.status IN('rejected','superseded') OR (NEW.status NOT IN('invalidated','rejected','superseded') AND NOT(OLD.status='prepared' AND NEW.status='locally_approved_dispatch_disabled')) THEN RAISE EXCEPTION 'Invalid batch transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_batch_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_batch_state_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_batches FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_batch_state();
CREATE TRIGGER finance_batch_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_batch_rule_bindings FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_batch_state();

CREATE FUNCTION haven.batch_sha(p_json jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT encode(sha256(convert_to(p_json::text,'UTF8')),'hex') $$;
CREATE FUNCTION haven.assert_finance_batch_actor(p_entity uuid,p_facility uuid,p_approve boolean DEFAULT false)
RETURNS TABLE(actor_id uuid,session_id uuid,claim_version integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF NOT FOUND OR a.actor_user_id IS NULL OR NOT a.actor_is_managed
  OR NOT haven.can_read_finance_staging(a.actor_organization_id,p_entity,p_facility)
  OR (p_approve AND a.actor_role_text NOT IN('owner','org_admin'))
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=(auth.jwt()->>'session_id')::uuid AND session.user_id=a.actor_user_id AND (nullif(to_jsonb(session)->>'not_after','') IS NULL OR (to_jsonb(session)->>'not_after')::timestamptz>clock_timestamp())) THEN RAISE EXCEPTION 'Current batch authority required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.actor_user_id,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version;
END $$;
CREATE FUNCTION haven.finance_batch_actor_live(p_actor uuid,p_session uuid,p_version integer,p_org uuid,p_entity uuid,p_facility uuid,p_approver boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN auth.sessions s ON s.user_id=p.id AND s.id=p_session
 JOIN public.entities e ON e.id=p_entity AND e.organization_id=p_org AND e.deleted_at IS NULL
 WHERE p.id=p_actor AND p.organization_id=p_org AND p.is_active AND p.deleted_at IS NULL AND p.auth_claim_version=p_version
 AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND (nullif(to_jsonb(s)->>'not_after','') IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp())
 AND p.app_role IN('owner','org_admin','facility_admin') AND (NOT p_approver OR p.app_role IN('owner','org_admin'))
 AND CASE WHEN p_facility IS NULL THEN p.app_role IN('owner','org_admin') ELSE
  EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=p_facility AND f.organization_id=p_org AND f.entity_id=p_entity AND f.deleted_at IS NULL)
  AND (p.app_role IN('owner','org_admin') OR EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=p.id AND g.facility_id=p_facility AND g.organization_id=p_org AND g.revoked_at IS NULL)) END)
$$;

-- Strict structural parity with payload.ts: no descriptions, identifiers,
-- filenames, arbitrary dimensions or nested source JSON enter provider lines.
CREATE FUNCTION haven.finance_batch_lines(p_lines jsonb,p_accounts jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE l jsonb; n numeric; d numeric:=0; c numeric:=0; result jsonb;
BEGIN
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 2 AND 1000 THEN RAISE EXCEPTION 'Two to 1000 summary lines required'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' OR l-ARRAY['accountReference','side','amountCents']<>'{}'::jsonb
   OR NOT(l ?& ARRAY['accountReference','side','amountCents']) OR jsonb_typeof(l->'accountReference')<>'string'
   OR l->>'accountReference' !~ '^[1-9][0-9]{0,19}$' OR NOT(p_accounts ? (l->>'accountReference'))
   OR jsonb_typeof(l->'side') IS DISTINCT FROM 'string' OR l->>'side' NOT IN('debit','credit') OR jsonb_typeof(l->'amountCents')<>'string'
   OR l->>'amountCents' !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Summary line violates structural allowlist'; END IF;
  n:=(l->>'amountCents')::numeric;
  IF n>9223372036854775807 THEN RAISE EXCEPTION 'Summary cents exceed signed64 storage'; END IF;
  IF l->>'side'='debit' THEN d:=d+n; ELSE c:=c+n; END IF;
 END LOOP;
 IF d<>c OR d>9223372036854775807 THEN RAISE EXCEPTION 'Summary must balance within signed64 storage'; END IF;
 SELECT jsonb_agg(jsonb_build_object('accountReference',account,'side',side,'amountCents',amount::text) ORDER BY account,side) INTO result FROM(
  SELECT value->>'accountReference' account,value->>'side' side,sum((value->>'amountCents')::numeric) amount FROM jsonb_array_elements(p_lines) GROUP BY 1,2) x;
 RETURN result;
END $$;

CREATE FUNCTION haven.finance_batch_iso_date(p_text text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date;
BEGIN
 IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Canonical ISO date required'; END IF;
 d:=p_text::date;
 IF d NOT BETWEEN date '0001-01-01' AND date '9999-12-31' OR to_char(d,'YYYY-MM-DD')<>p_text THEN RAISE EXCEPTION 'Canonical ISO date required'; END IF;
 RETURN d;
END $$;

CREATE FUNCTION haven.finance_batch_invalid_reason(p_batch public.finance_batches) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.finance_staging_controls%ROWTYPE; r public.finance_batch_rule_bindings%ROWTYPE; approval public.finance_batch_decisions%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.finance_staging_controls WHERE entity_id=p_batch.entity_id;
 IF NOT FOUND OR c.stopped OR c.organization_id IS DISTINCT FROM p_batch.organization_id OR c.staging_generation IS DISTINCT FROM p_batch.staging_generation
  OR c.connection_generation_ref IS DISTINCT FROM p_batch.connection_generation_ref OR c.capability_reference_sha256 IS DISTINCT FROM p_batch.capability_reference_sha256 THEN RETURN 'staging_control_changed'; END IF;
 SELECT * INTO r FROM public.finance_batch_rule_bindings WHERE entity_id=p_batch.entity_id;
 IF NOT FOUND OR r.version_id IS DISTINCT FROM p_batch.rules_version_id OR r.generation IS DISTINCT FROM p_batch.rules_generation THEN RETURN 'rules_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.gl_period_closes WHERE entity_id=p_batch.entity_id AND period_year=extract(year FROM p_batch.accounting_date) AND period_month=extract(month FROM p_batch.accounting_date) AND status='closed' AND deleted_at IS NULL) THEN RETURN 'period_closed'; END IF;
 IF EXISTS(SELECT 1 FROM public.finance_batch_members m JOIN public.finance_source_events e ON e.id=m.event_id WHERE m.batch_id=p_batch.id AND (e.organization_id<>p_batch.organization_id OR e.entity_id<>p_batch.entity_id OR e.source_version IS DISTINCT FROM m.member_document->>'sourceVersion' OR e.identity_sha256 IS DISTINCT FROM m.member_document->>'identitySha256' OR (p_batch.facility_id IS NOT NULL AND e.facility_id IS DISTINCT FROM p_batch.facility_id) OR (e.facility_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=e.facility_id AND f.organization_id=e.organization_id AND f.entity_id=e.entity_id AND f.deleted_at IS NULL)))) THEN RETURN 'member_scope_changed'; END IF;
 IF NOT haven.finance_batch_actor_live(p_batch.prepared_by,p_batch.preparer_session_id,p_batch.preparer_claim_version,p_batch.organization_id,p_batch.entity_id,p_batch.facility_id,false) THEN RETURN 'preparer_authority_changed'; END IF;
 SELECT * INTO approval FROM public.finance_batch_decisions WHERE batch_id=p_batch.id AND action='approve';
 IF FOUND AND NOT haven.finance_batch_actor_live(approval.actor_id,approval.actor_session_id,approval.actor_claim_version,p_batch.organization_id,p_batch.entity_id,p_batch.facility_id,true) THEN RETURN 'approver_authority_changed'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION haven.invalidate_finance_batches(p_entity uuid,p_origin text,p_reason text,p_date date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b record;
BEGIN
 FOR b IN SELECT id,binding_sha256 FROM public.finance_batches
  WHERE entity_id=p_entity AND status IN('prepared','locally_approved_dispatch_disabled')
   AND (p_date IS NULL OR date_trunc('month',accounting_date)=date_trunc('month',p_date)) ORDER BY id FOR UPDATE LOOP
  IF auth.jwt()->>'role'='authenticated' THEN PERFORM haven.assert_finance_batch_actor(p_entity,NULL,true); END IF;
  UPDATE public.finance_batches SET status='invalidated',updated_at=clock_timestamp() WHERE id=b.id;
  INSERT INTO public.finance_batch_decisions(id,batch_id,action,origin,binding_sha256,request_sha256,resulting_status,reason_code)
  VALUES(gen_random_uuid(),b.id,'invalidate',p_origin,b.binding_sha256,b.binding_sha256,'invalidated',p_reason);
 END LOOP;
END $$;
CREATE FUNCTION haven.finance_batch_control_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.jwt()->>'role'='authenticated' THEN PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true); END IF;
 IF (NEW.staging_generation,NEW.connection_generation_ref,NEW.capability_reference_sha256,NEW.worker_id,NEW.stopped) IS DISTINCT FROM (OLD.staging_generation,OLD.connection_generation_ref,OLD.capability_reference_sha256,OLD.worker_id,OLD.stopped) THEN
  PERFORM haven.invalidate_finance_batches(NEW.entity_id,'control','staging_control_changed'); END IF;
 IF auth.jwt()->>'role'='authenticated' THEN PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_batch_control_invalidation AFTER UPDATE ON public.finance_staging_controls FOR EACH ROW EXECUTE FUNCTION haven.finance_batch_control_changed();
CREATE FUNCTION haven.finance_batch_period_closed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true);
 IF NEW.status='closed' THEN PERFORM haven.invalidate_finance_batches(NEW.entity_id,'period','period_closed',make_date(NEW.period_year,NEW.period_month,1)); END IF;
 PERFORM haven.assert_finance_batch_actor(NEW.entity_id,NULL,true); RETURN NEW;
END $$;
CREATE TRIGGER finance_batch_period_invalidation AFTER INSERT OR UPDATE ON public.gl_period_closes FOR EACH ROW EXECUTE FUNCTION haven.finance_batch_period_closed();

CREATE FUNCTION haven.register_finance_batch_rules(p_id uuid,p_entity uuid,p_mapping jsonb,p_policy_sha256 text,p_expected_generation bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; c public.finance_staging_controls%ROWTYPE; old public.finance_batch_rule_versions%ROWTYPE; r public.finance_batch_rule_bindings%ROWTYPE; normalized jsonb; h text; account jsonb; generation bigint;
BEGIN
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,NULL,true);
 IF p_id IS NULL OR p_expected_generation IS NULL OR p_expected_generation<0 OR p_policy_sha256 IS NULL OR p_policy_sha256 !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' OR p_mapping-ARRAY['companyReference','accountReferences','accountingBasis','effectiveFrom','effectiveTo']<>'{}'::jsonb
  OR NOT(p_mapping ?& ARRAY['companyReference','accountReferences','accountingBasis','effectiveFrom','effectiveTo']) OR jsonb_typeof(p_mapping->'companyReference')<>'string'
  OR p_mapping->>'companyReference' !~ '^[1-9][0-9]{0,19}$' OR jsonb_typeof(p_mapping->'accountReferences') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_mapping->'accountReferences') NOT BETWEEN 1 AND 1000
  OR jsonb_typeof(p_mapping->'accountingBasis') IS DISTINCT FROM 'string' OR p_mapping->>'accountingBasis' NOT IN('cash','accrual')
  OR jsonb_typeof(p_mapping->'effectiveFrom') IS DISTINCT FROM 'string' OR jsonb_typeof(p_mapping->'effectiveTo') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Declared mapping violates structural allowlist'; END IF;
 IF haven.finance_batch_iso_date(p_mapping->>'effectiveFrom')>haven.finance_batch_iso_date(p_mapping->>'effectiveTo') THEN RAISE EXCEPTION 'Rule effective window is reversed'; END IF;
 FOR account IN SELECT value FROM jsonb_array_elements(p_mapping->'accountReferences') LOOP
  IF jsonb_typeof(account)<>'string' OR account #>> '{}' !~ '^[1-9][0-9]{0,19}$' THEN RAISE EXCEPTION 'Numeric declared account reference required'; END IF;
 END LOOP;
 SELECT jsonb_build_object('companyReference',p_mapping->>'companyReference','accountReferences',jsonb_agg(x.account ORDER BY x.account),'accountingBasis',p_mapping->>'accountingBasis','effectiveFrom',p_mapping->>'effectiveFrom','effectiveTo',p_mapping->>'effectiveTo') INTO normalized FROM(SELECT DISTINCT value account FROM jsonb_array_elements(p_mapping->'accountReferences')) x;
 h:=haven.batch_sha(jsonb_build_object('entity',p_entity,'mapping',normalized,'policy',p_policy_sha256,'expected_generation',p_expected_generation));
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-batch-rules:'||p_id,0));
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,NULL,true);
 INSERT INTO public.finance_staging_controls(entity_id,organization_id,updated_by) VALUES(p_entity,haven.organization_id(),a.actor_id) ON CONFLICT(entity_id) DO NOTHING;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,NULL,true);
 SELECT * INTO c FROM public.finance_staging_controls WHERE entity_id=p_entity FOR UPDATE;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,NULL,true);
 SELECT * INTO old FROM public.finance_batch_rule_versions WHERE id=p_id;
 IF FOUND THEN
  IF old.content_sha256<>h OR old.entity_id<>p_entity OR old.created_by<>a.actor_id THEN RAISE EXCEPTION 'Rules identity content conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('rules_version_id',p_id,'status','declared_draft','content_sha256',h);
 END IF;
 SELECT * INTO r FROM public.finance_batch_rule_bindings WHERE entity_id=p_entity;
 generation:=coalesce(r.generation,0);
 IF generation<>p_expected_generation THEN RAISE EXCEPTION 'Rules generation changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.finance_batch_rule_versions(id,organization_id,entity_id,mapping,policy_reference_sha256,content_sha256,expected_generation,created_by,actor_session_id,actor_claim_version)
 VALUES(p_id,c.organization_id,p_entity,normalized,p_policy_sha256,h,p_expected_generation,a.actor_id,a.session_id,a.claim_version);
 INSERT INTO public.finance_batch_rule_bindings(entity_id,organization_id,version_id,generation) VALUES(p_entity,c.organization_id,p_id,generation+1)
 ON CONFLICT(entity_id) DO UPDATE SET version_id=excluded.version_id,generation=excluded.generation;
 PERFORM haven.invalidate_finance_batches(p_entity,'rules','rules_changed');
 PERFORM haven.assert_finance_batch_actor(p_entity,NULL,true);
 RETURN jsonb_build_object('rules_version_id',p_id,'status','declared_draft','rules_generation',generation+1,'content_sha256',h);
END $$;

CREATE FUNCTION haven.prepare_finance_batch(p_id uuid,p_entity uuid,p_facility uuid,p_date date,p_rules uuid,p_members jsonb,p_supersedes uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; c public.finance_staging_controls%ROWTYPE; r public.finance_batch_rule_bindings%ROWTYPE; rules public.finance_batch_rule_versions%ROWTYPE;
 b public.finance_batches%ROWTYPE; predecessor public.finance_batches%ROWTYPE; event public.finance_source_events%ROWTYPE;
 item jsonb; lines jsonb; members jsonb:='[]'; all_lines jsonb:='[]'; payload jsonb; controls jsonb; req_hash text; member_hash text; payload_hash text; control_hash text; binding text;
 economic_date date; receipt public.finance_command_receipts%ROWTYPE; event_id uuid; seen uuid[]:='{}'; line_count integer:=0; total numeric:=0; sum_debit numeric; reason text;
BEGIN
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 IF p_id IS NULL OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_rules IS NULL OR p_date IS NULL OR p_date NOT BETWEEN date '0001-01-01' AND date '9999-12-31'
  OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 1000 OR p_supersedes=p_id THEN RAISE EXCEPTION 'Valid bounded batch request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-batch:'||p_id,0));
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 PERFORM haven.lock_finance_period(p_entity,p_date);
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 SELECT * INTO c FROM public.finance_staging_controls WHERE entity_id=p_entity FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staging control required'; END IF;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 IF c.stopped OR c.connection_generation_ref IS NULL OR c.capability_reference_sha256 IS NULL THEN RAISE EXCEPTION 'Declared current unstopped staging binding required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.gl_period_closes WHERE entity_id=p_entity AND period_year=extract(year FROM p_date) AND period_month=extract(month FROM p_date) AND status='closed' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Accounting period is closed'; END IF;
 SELECT * INTO r FROM public.finance_batch_rule_bindings WHERE entity_id=p_entity;
 IF NOT FOUND OR r.version_id<>p_rules THEN RAISE EXCEPTION 'Current declared rules required' USING ERRCODE='40001'; END IF;
 SELECT * INTO rules FROM public.finance_batch_rule_versions WHERE id=p_rules AND entity_id=p_entity AND organization_id=c.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rules scope mismatch' USING ERRCODE='42501'; END IF;
 IF p_date NOT BETWEEN haven.finance_batch_iso_date(rules.mapping->>'effectiveFrom') AND haven.finance_batch_iso_date(rules.mapping->>'effectiveTo') THEN RAISE EXCEPTION 'Accounting date outside declared rule window'; END IF;
 -- Validate identities before taking deterministic event locks.
 FOR item IN SELECT value FROM jsonb_array_elements(p_members) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['eventId','lines']<>'{}'::jsonb OR NOT(item ?& ARRAY['eventId','lines'])
   OR jsonb_typeof(item->'eventId')<>'string' OR item->>'eventId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Member violates structural allowlist'; END IF;
  event_id:=(item->>'eventId')::uuid;
  IF event_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate batch member'; END IF; seen:=array_append(seen,event_id);
 END LOOP;
 PERFORM 1 FROM public.finance_source_events WHERE id=ANY(seen) ORDER BY id FOR SHARE;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 FOR item IN SELECT value FROM jsonb_array_elements(p_members) ORDER BY (value->>'eventId')::uuid LOOP
  SELECT * INTO event FROM public.finance_source_events WHERE id=(item->>'eventId')::uuid;
  IF NOT FOUND OR event.organization_id<>c.organization_id OR event.entity_id<>p_entity OR (p_facility IS NOT NULL AND event.facility_id IS DISTINCT FROM p_facility) OR NOT haven.can_read_finance_staging(event.organization_id,event.entity_id,event.facility_id) THEN RAISE EXCEPTION 'Source member unavailable in batch scope' USING ERRCODE='42501'; END IF;
  SELECT * INTO receipt FROM public.finance_command_receipts WHERE command_type=event.receipt_type AND id=event.receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source receipt missing'; END IF;
  IF event.receipt_type='payment' THEN economic_date:=haven.finance_batch_iso_date(receipt.payload->>'payment_date');
  ELSIF event.receipt_type IN('invoice_post','reversal') THEN economic_date:=haven.finance_batch_iso_date(receipt.payload->>'entry_date');
  ELSE SELECT entry_date INTO economic_date FROM public.journal_entries WHERE id=event.source_id AND organization_id=event.organization_id AND entity_id=event.entity_id AND status='posted' AND deleted_at IS NULL; END IF;
  IF economic_date IS NULL OR economic_date<>p_date THEN RAISE EXCEPTION 'Source economic date must equal accounting date until reviewed period mapping exists'; END IF;
  lines:=haven.finance_batch_lines(item->'lines',rules.mapping->'accountReferences');
  SELECT sum((value->>'amountCents')::numeric) INTO sum_debit FROM jsonb_array_elements(lines) WHERE value->>'side'='debit';
  IF sum_debit<>event.control_total_cents THEN RAISE EXCEPTION 'Each contribution must equal its source gross control'; END IF;
  total:=total+sum_debit; line_count:=line_count+jsonb_array_length(item->'lines');
  IF total>9223372036854775807 OR line_count>20000 THEN RAISE EXCEPTION 'Batch exceeds exact storage or contribution bound'; END IF;
  members:=members||jsonb_build_array(jsonb_build_object('eventId',event.id,'identitySha256',event.identity_sha256,'sourceVersion',event.source_version,'amountBasis',event.amount_basis,'operation',event.operation,'controlTotalCents',event.control_total_cents::text,'economicDate',to_char(economic_date,'YYYY-MM-DD'),'lines',lines));
  all_lines:=all_lines||lines;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('accountReference',account,'side',side,'amountCents',amount::text) ORDER BY account,side) INTO lines FROM(
  SELECT value->>'accountReference' account,value->>'side' side,sum((value->>'amountCents')::numeric) amount FROM jsonb_array_elements(all_lines) GROUP BY 1,2) q;
 lines:=haven.finance_batch_lines(lines,rules.mapping->'accountReferences');
 payload:=jsonb_build_object('schemaVersion',1,'companyReference',rules.mapping->>'companyReference','batchReference',p_id,'accountingDate',to_char(p_date,'YYYY-MM-DD'),'currency','USD','lines',lines);
 SELECT jsonb_agg(jsonb_build_object('amountBasis',basis,'operation',operation,'eventCount',count::text,'grossCents',amount::text) ORDER BY basis,operation) INTO controls FROM(
  SELECT value->>'amountBasis' basis,value->>'operation' operation,count(*) count,sum((value->>'controlTotalCents')::numeric) amount FROM jsonb_array_elements(members) GROUP BY 1,2) q;
 member_hash:=haven.batch_sha(members); payload_hash:=haven.batch_sha(payload); control_hash:=haven.batch_sha(controls);
 req_hash:=haven.batch_sha(jsonb_build_object('entity',p_entity,'facility',p_facility,'date',to_char(p_date,'YYYY-MM-DD'),'rules',p_rules,'members',members,'supersedes',p_supersedes));
 SELECT * INTO b FROM public.finance_batches WHERE id=p_id FOR UPDATE;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 IF b.id IS NOT NULL THEN
  IF b.request_sha256<>req_hash OR b.prepared_by<>a.actor_id THEN RAISE EXCEPTION 'Batch identity content conflict' USING ERRCODE='23505'; END IF;
  reason:=haven.finance_batch_invalid_reason(b);
  RETURN jsonb_build_object('batch_id',p_id,'status',CASE WHEN b.status IN('prepared','locally_approved_dispatch_disabled') AND reason IS NOT NULL THEN 'invalidated' ELSE b.status END,'binding_sha256',b.binding_sha256,'accounting_classification','unverified','business_release_eligible',false);
 END IF;
 IF p_supersedes IS NOT NULL THEN
  SELECT * INTO predecessor FROM public.finance_batches WHERE id=p_supersedes FOR UPDATE;
  SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
  IF predecessor.id IS NULL OR predecessor.organization_id<>c.organization_id OR predecessor.entity_id<>p_entity OR predecessor.facility_id IS DISTINCT FROM p_facility
   OR predecessor.status NOT IN('prepared','locally_approved_dispatch_disabled','invalidated') OR predecessor.dispatch_enabled
   OR (predecessor.prepared_by<>a.actor_id AND NOT coalesce(haven.app_role() IN('owner','org_admin'),false)) THEN RAISE EXCEPTION 'Only authorized safely unsent batch may be superseded' USING ERRCODE='42501'; END IF;
  UPDATE public.finance_batches SET status='superseded',updated_at=clock_timestamp() WHERE id=p_supersedes;
  INSERT INTO public.finance_batch_decisions(id,batch_id,action,origin,actor_id,actor_session_id,actor_claim_version,binding_sha256,request_sha256,resulting_status)
   VALUES(gen_random_uuid(),p_supersedes,'supersede','operator',a.actor_id,a.session_id,a.claim_version,predecessor.binding_sha256,req_hash,'superseded');
  DELETE FROM public.finance_batch_event_claims WHERE batch_id=p_supersedes;
  SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 END IF;
 binding:=haven.batch_sha(jsonb_build_object('action','local_batch_review','accountingClassification','unverified','businessReleaseEligible',false,'sourceDatePolicy','same_day','batch',p_id,'organization',c.organization_id,'entity',p_entity,'facility',p_facility,'date',to_char(p_date,'YYYY-MM-DD'),'currency','USD',
  'payload',payload_hash,'members',member_hash,'sourceControls',control_hash,'rulesVersion',p_rules,'rulesHash',rules.content_sha256,'policyHash',rules.policy_reference_sha256,
  'rulesGeneration',r.generation::text,'stagingGeneration',c.staging_generation::text,'connectionGeneration',c.connection_generation_ref,'capabilityReference',c.capability_reference_sha256,
  'preparer',a.actor_id,'preparerSession',a.session_id,'preparerScopeVersion',a.claim_version));
 INSERT INTO public.finance_batches(id,organization_id,entity_id,facility_id,accounting_date,rules_version_id,rules_generation,staging_generation,connection_generation_ref,capability_reference_sha256,
  request_sha256,payload,payload_sha256,member_set_sha256,source_controls,source_controls_sha256,binding_sha256,prepared_by,preparer_session_id,preparer_claim_version,supersedes)
 VALUES(p_id,c.organization_id,p_entity,p_facility,p_date,p_rules,r.generation,c.staging_generation,c.connection_generation_ref,c.capability_reference_sha256,
  req_hash,payload,payload_hash,member_hash,controls,control_hash,binding,a.actor_id,a.session_id,a.claim_version,p_supersedes);
 INSERT INTO public.finance_batch_members(batch_id,event_id,member_document) SELECT p_id,(value->>'eventId')::uuid,value FROM jsonb_array_elements(members);
 INSERT INTO public.finance_batch_event_claims(event_id,batch_id) SELECT unnest(seen),p_id;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(p_entity,p_facility);
 INSERT INTO public.finance_batch_decisions(id,batch_id,action,origin,actor_id,actor_session_id,actor_claim_version,binding_sha256,request_sha256,resulting_status)
 VALUES(p_id,p_id,'prepare','operator',a.actor_id,a.session_id,a.claim_version,binding,req_hash,'prepared');
 PERFORM haven.assert_finance_batch_actor(p_entity,p_facility);
 SELECT * INTO b FROM public.finance_batches WHERE id=p_id;
 IF haven.finance_batch_invalid_reason(b) IS NOT NULL THEN RAISE EXCEPTION 'Batch authority or binding changed during preparation' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('batch_id',p_id,'status','prepared','accounting_classification','unverified','business_release_eligible',false,'binding_sha256',binding,'payload_sha256',payload_hash,'member_set_sha256',member_hash,'source_controls',controls);
END $$;

CREATE FUNCTION haven.decide_finance_batch(p_id uuid,p_batch uuid,p_action text,p_expected_binding text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.finance_batches%ROWTYPE; c public.finance_staging_controls%ROWTYPE; a record; prior public.finance_batch_decisions%ROWTYPE; h text; reason text; next_status text;
BEGIN
 SELECT * INTO b FROM public.finance_batches WHERE id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Batch unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 IF p_id IS NULL OR p_action NOT IN('approve','reject','invalidate') OR p_action IS NULL OR p_expected_binding IS DISTINCT FROM b.binding_sha256 THEN RAISE EXCEPTION 'Exact batch binding and decision required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-batch-decision:'||p_id,0));
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 PERFORM haven.lock_finance_period(b.entity_id,b.accounting_date);
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 SELECT * INTO c FROM public.finance_staging_controls WHERE entity_id=b.entity_id FOR UPDATE;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 SELECT * INTO b FROM public.finance_batches WHERE id=p_batch FOR UPDATE;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 h:=haven.batch_sha(jsonb_build_object('batch',p_batch,'action',p_action,'binding',p_expected_binding,'actor',a.actor_id));
 SELECT * INTO prior FROM public.finance_batch_decisions WHERE id=p_id;
 IF FOUND AND (prior.request_sha256<>h OR prior.actor_id IS DISTINCT FROM a.actor_id OR prior.batch_id<>p_batch OR prior.action<>p_action) THEN RAISE EXCEPTION 'Decision identity content conflict' USING ERRCODE='23505'; END IF;
 reason:=haven.finance_batch_invalid_reason(b);
 IF b.status IN('prepared','locally_approved_dispatch_disabled') AND reason IS NOT NULL THEN
  UPDATE public.finance_batches SET status='invalidated',updated_at=clock_timestamp() WHERE id=p_batch;
  INSERT INTO public.finance_batch_decisions(id,batch_id,action,origin,binding_sha256,request_sha256,resulting_status,reason_code) VALUES(gen_random_uuid(),p_batch,'invalidate','scope',b.binding_sha256,b.binding_sha256,'invalidated',reason);
  b.status:='invalidated';
 END IF;
 IF prior.id IS NOT NULL THEN PERFORM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve'); RETURN jsonb_build_object('batch_id',p_batch,'status',b.status,'binding_sha256',b.binding_sha256,'accounting_classification','unverified','business_release_eligible',false); END IF;
 IF p_action='approve' THEN
  IF b.status='invalidated' THEN PERFORM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,true); RETURN jsonb_build_object('batch_id',p_batch,'status','invalidated','accounting_classification','unverified','business_release_eligible',false,'reason_code',coalesce(reason,'prior_invalidation')); END IF;
  IF b.status<>'prepared' OR a.actor_id=b.prepared_by THEN RAISE EXCEPTION 'Independent current approver required for prepared batch' USING ERRCODE='42501'; END IF;
  next_status:='locally_approved_dispatch_disabled';
 ELSE
  IF (a.actor_id<>b.prepared_by AND NOT coalesce(haven.app_role() IN('owner','org_admin'),false)) OR b.status IN('rejected','superseded') OR b.dispatch_enabled THEN RAISE EXCEPTION 'Decision requires authorized safely unsent batch' USING ERRCODE='42501'; END IF;
  next_status:=CASE WHEN p_action='reject' THEN 'rejected' ELSE 'invalidated' END;
 END IF;
 UPDATE public.finance_batches SET status=next_status,updated_at=clock_timestamp() WHERE id=p_batch;
 IF p_action='reject' THEN DELETE FROM public.finance_batch_event_claims WHERE batch_id=p_batch; END IF;
 SELECT * INTO a FROM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 INSERT INTO public.finance_batch_decisions(id,batch_id,action,origin,actor_id,actor_session_id,actor_claim_version,binding_sha256,request_sha256,resulting_status,reason_code)
 VALUES(p_id,p_batch,p_action,'operator',a.actor_id,a.session_id,a.claim_version,b.binding_sha256,h,next_status,CASE WHEN p_action='invalidate' THEN 'operator_invalidated' END);
 PERFORM haven.assert_finance_batch_actor(b.entity_id,b.facility_id,p_action='approve');
 IF p_action='approve' AND haven.finance_batch_invalid_reason(b) IS NOT NULL THEN RAISE EXCEPTION 'Batch authority or binding changed during approval' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('batch_id',p_batch,'status',next_status,'accounting_classification','unverified','business_release_eligible',false,'binding_sha256',b.binding_sha256,'dispatch_enabled',false);
END $$;

CREATE FUNCTION haven.finance_batch_snapshot(p_batch uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.finance_batches%ROWTYPE; reason text; members jsonb; decisions jsonb;
BEGIN
 SELECT * INTO b FROM public.finance_batches WHERE id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Batch unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_finance_batch_actor(b.entity_id,b.facility_id);
 reason:=haven.finance_batch_invalid_reason(b);
 SELECT coalesce(jsonb_agg(member_document ORDER BY event_id),'[]'::jsonb) INTO members FROM public.finance_batch_members WHERE batch_id=p_batch;
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY created_at,id),'[]'::jsonb) INTO decisions FROM public.finance_batch_decisions d WHERE batch_id=p_batch;
 RETURN jsonb_build_object('batch',to_jsonb(b)||jsonb_build_object('status',CASE WHEN b.status IN('prepared','locally_approved_dispatch_disabled') AND reason IS NOT NULL THEN 'invalidated' ELSE b.status END),
  'invalid_reason',reason,'members',members,'decision_history',decisions,'accounting_classification','unverified','business_release_eligible',false,'dispatch_enabled',false,'binding_claim','declared_local_only');
END $$;

CREATE FUNCTION public.register_finance_batch_rules(p_id uuid,p_entity uuid,p_mapping jsonb,p_policy_sha256 text,p_expected_generation bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.register_finance_batch_rules(p_id,p_entity,p_mapping,p_policy_sha256,p_expected_generation) $$;
CREATE FUNCTION public.prepare_finance_batch(p_id uuid,p_entity uuid,p_facility uuid,p_date date,p_rules uuid,p_members jsonb,p_supersedes uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.prepare_finance_batch(p_id,p_entity,p_facility,p_date,p_rules,p_members,p_supersedes) $$;
CREATE FUNCTION public.decide_finance_batch(p_id uuid,p_batch uuid,p_action text,p_expected_binding text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.decide_finance_batch(p_id,p_batch,p_action,p_expected_binding) $$;
CREATE FUNCTION public.finance_batch_snapshot(p_batch uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_batch_snapshot(p_batch) $$;

REVOKE ALL ON FUNCTION haven.batch_sha(jsonb),haven.finance_batch_iso_date(text),haven.assert_finance_batch_actor(uuid,uuid,boolean),haven.finance_batch_actor_live(uuid,uuid,integer,uuid,uuid,uuid,boolean),haven.finance_batch_lines(jsonb,jsonb),haven.finance_batch_invalid_reason(public.finance_batches),haven.invalidate_finance_batches(uuid,text,text,date),haven.finance_batch_control_changed(),haven.finance_batch_period_closed(),
 haven.register_finance_batch_rules(uuid,uuid,jsonb,text,bigint),haven.prepare_finance_batch(uuid,uuid,uuid,date,uuid,jsonb,uuid),haven.decide_finance_batch(uuid,uuid,text,text),haven.finance_batch_snapshot(uuid),
 public.register_finance_batch_rules(uuid,uuid,jsonb,text,bigint),public.prepare_finance_batch(uuid,uuid,uuid,date,uuid,jsonb,uuid),public.decide_finance_batch(uuid,uuid,text,text),public.finance_batch_snapshot(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.register_finance_batch_rules(uuid,uuid,jsonb,text,bigint),haven.prepare_finance_batch(uuid,uuid,uuid,date,uuid,jsonb,uuid),haven.decide_finance_batch(uuid,uuid,text,text),haven.finance_batch_snapshot(uuid),
 public.register_finance_batch_rules(uuid,uuid,jsonb,text,bigint),public.prepare_finance_batch(uuid,uuid,uuid,date,uuid,jsonb,uuid),public.decide_finance_batch(uuid,uuid,text,text),public.finance_batch_snapshot(uuid) TO authenticated;
COMMIT;
