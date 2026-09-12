-- F03 durable staging only. Dispatch cannot be enabled by any API in this migration.
-- Source events and intents are inserted by the authoritative receipt transaction.
BEGIN;

CREATE TABLE public.finance_source_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_sha256 text NOT NULL UNIQUE CHECK(identity_sha256 ~ '^[0-9a-f]{64}$'),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 facility_id uuid REFERENCES public.facilities(id),
 receipt_type text NOT NULL,
 receipt_id uuid NOT NULL,
 source_type text NOT NULL CHECK(source_type IN('payment','invoice','journal')),
 source_id uuid NOT NULL,
 source_version text NOT NULL CHECK(source_version ~ '^[0-9a-f]{64}$'),
 operation text NOT NULL CHECK(operation IN('payment_received','invoice_posted','manual_journal_posted','journal_reversed')),
 amount_basis text NOT NULL CHECK(amount_basis IN('payment_gross','invoice_gross','journal_debit_total')),
 control_total_cents bigint NOT NULL CHECK(control_total_cents>0),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_session_id uuid NOT NULL,
 actor_claim_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(receipt_type,receipt_id) REFERENCES public.finance_command_receipts(command_type,id),
 UNIQUE(receipt_type,receipt_id),
 UNIQUE(organization_id,entity_id,source_type,source_id,operation)
);
CREATE TABLE public.finance_outbound_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_sha256 text NOT NULL UNIQUE CHECK(identity_sha256 ~ '^[0-9a-f]{64}$'),
 event_id uuid NOT NULL UNIQUE REFERENCES public.finance_source_events(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 facility_id uuid REFERENCES public.facilities(id),
 operation text NOT NULL DEFAULT 'stage_accounting_summary' CHECK(operation='stage_accounting_summary'),
 external_payload jsonb CHECK(external_payload IS NULL),
 dispatch_enabled boolean NOT NULL DEFAULT false CHECK(NOT dispatch_enabled),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_staging_controls (
 entity_id uuid PRIMARY KEY REFERENCES public.entities(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 staging_generation bigint NOT NULL DEFAULT 0 CHECK(staging_generation>=0),
 connection_generation_ref uuid,
 capability_reference_sha256 text CHECK(capability_reference_sha256 ~ '^[0-9a-f]{64}$'),
 worker_id uuid,
 stopped boolean NOT NULL DEFAULT true,
 dispatch_enabled boolean NOT NULL DEFAULT false CHECK(NOT dispatch_enabled),
 updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_staging_control_receipts (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_session_id uuid NOT NULL,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finance_staging_commands (
 id uuid PRIMARY KEY,
 intent_id uuid NOT NULL REFERENCES public.finance_outbound_intents(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 facility_id uuid REFERENCES public.facilities(id),
 staging_generation bigint NOT NULL,
 connection_generation_ref uuid,
 capability_reference_sha256 text,
 operation text NOT NULL CHECK(operation IN('queue','retry','supersede')),
 retry_of uuid REFERENCES public.finance_staging_commands(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_session_id uuid NOT NULL,
 actor_claim_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((operation='queue' AND retry_of IS NULL) OR (operation IN('retry','supersede') AND retry_of IS NOT NULL)),
 UNIQUE NULLS NOT DISTINCT(intent_id,staging_generation,retry_of)
);
CREATE UNIQUE INDEX finance_staging_root_intent ON public.finance_staging_commands(intent_id) WHERE retry_of IS NULL;
CREATE UNIQUE INDEX finance_staging_retry_predecessor ON public.finance_staging_commands(retry_of) WHERE retry_of IS NOT NULL;
CREATE TABLE public.finance_staging_attempts (
 id uuid PRIMARY KEY,
 command_id uuid NOT NULL REFERENCES public.finance_staging_commands(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),
 facility_id uuid REFERENCES public.facilities(id),
 worker_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 outcome text NOT NULL DEFAULT 'blocked_dispatch_disabled' CHECK(outcome='blocked_dispatch_disabled'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(command_id,attempt_number)
);
CREATE INDEX finance_events_entity ON public.finance_source_events(entity_id,created_at,id);
CREATE INDEX finance_intents_entity ON public.finance_outbound_intents(entity_id,created_at,id);

CREATE FUNCTION haven.can_read_finance_staging(p_org uuid,p_entity uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_org=haven.organization_id() AND haven.app_role() IN('owner','org_admin','facility_admin')
 AND EXISTS(SELECT 1 FROM public.entities WHERE id=p_entity AND organization_id=p_org AND deleted_at IS NULL)
 AND CASE WHEN p_facility IS NULL THEN haven.app_role() IN('owner','org_admin')
 ELSE haven.has_facility_access(p_facility) AND EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND entity_id=p_entity AND organization_id=p_org AND deleted_at IS NULL) END,false)
$$;
REVOKE ALL ON FUNCTION haven.can_read_finance_staging(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.can_read_finance_staging(uuid,uuid,uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finance_source_events','finance_outbound_intents','finance_staging_commands','finance_staging_attempts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY scoped_finance_staging_read ON public.%I FOR SELECT TO authenticated USING(haven.can_read_finance_staging(organization_id,entity_id,facility_id))',t);
  EXECUTE format('CREATE TRIGGER immutable_finance_staging BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['finance_staging_controls','finance_staging_control_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY scoped_finance_control_read ON public.%I FOR SELECT TO authenticated USING(haven.can_read_finance_staging(organization_id,entity_id,NULL))',t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_finance_control_receipts BEFORE UPDATE OR DELETE ON public.finance_staging_control_receipts
 FOR EACH ROW EXECUTE FUNCTION haven.reject_finance_evidence_mutation();
CREATE FUNCTION haven.guard_finance_staging_control() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_user IN('anon','authenticated','service_role') OR TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Use a current-authorized staging control command' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (NEW.entity_id,NEW.organization_id) IS DISTINCT FROM (OLD.entity_id,OLD.organization_id) THEN
  RAISE EXCEPTION 'Staging control identity is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_finance_staging_control() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_staging_control_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_staging_controls
 FOR EACH ROW EXECUTE FUNCTION haven.guard_finance_staging_control();

CREATE FUNCTION haven.stage_financial_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_source_type text; v_operation text; v_basis text; v_total bigint; v_version text; v_event uuid:=gen_random_uuid(); v_event_identity text; v_actor uuid;
BEGIN
 -- Payment cash has exactly one representation: its payment receipt, never
 -- the subsequent native-GL payment_post receipt. Cancellation has no effect.
 IF NEW.command_type IN('payment_post','payment_cancelled') THEN RETURN NEW; END IF;
 IF NEW.command_type NOT IN('payment','invoice_post','manual_post','reversal') THEN
  RAISE EXCEPTION 'Financial receipt operation needs an explicit event origin'; END IF;
 v_actor:=haven.assert_finance_scope(NEW.entity_id,NEW.facility_id,NEW.command_type<>'payment');
 IF NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NEW.actor_id IS DISTINCT FROM v_actor
  OR NEW.actor_session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid
  OR NEW.actor_claim_version IS DISTINCT FROM (SELECT actor_claim_version FROM haven.current_authorized_actor()) THEN
  RAISE EXCEPTION 'Source receipt authority mismatch' USING ERRCODE='42501'; END IF;
 CASE NEW.command_type
 WHEN 'payment' THEN v_source_type:='payment';v_operation:='payment_received';v_basis:='payment_gross';v_total:=(NEW.payload->>'amount_cents')::bigint;
 WHEN 'invoice_post' THEN v_source_type:='invoice';v_operation:='invoice_posted';v_basis:='invoice_gross';v_total:=(NEW.payload->>'amount')::bigint;
 ELSE
  v_source_type:='journal';v_operation:=CASE WHEN NEW.command_type='manual_post' THEN 'manual_journal_posted' ELSE 'journal_reversed' END;v_basis:='journal_debit_total';
  SELECT sum(l.debit_cents)::bigint INTO v_total FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
   WHERE j.id=NEW.id AND j.organization_id=NEW.organization_id AND j.entity_id=NEW.entity_id AND j.status='posted' AND j.deleted_at IS NULL AND l.deleted_at IS NULL;
 END CASE;
 -- Hash the whole immutable receipt in a timezone-stable canonical JSON form.
 v_version:=encode(sha256(convert_to((to_jsonb(NEW)||jsonb_build_object('created_at',to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text,'UTF8')),'hex');
 v_event_identity:=encode(sha256(convert_to(concat_ws(':','haven-finance-event-v1',NEW.organization_id,NEW.entity_id,v_source_type,NEW.id,v_version,v_operation),'UTF8')),'hex');
 INSERT INTO public.finance_staging_controls(entity_id,organization_id,updated_by) VALUES(NEW.entity_id,NEW.organization_id,v_actor) ON CONFLICT(entity_id) DO NOTHING;
 INSERT INTO public.finance_source_events(id,identity_sha256,organization_id,entity_id,facility_id,receipt_type,receipt_id,source_type,source_id,source_version,operation,amount_basis,control_total_cents,actor_id,actor_session_id,actor_claim_version)
 VALUES(v_event,v_event_identity,NEW.organization_id,NEW.entity_id,NEW.facility_id,NEW.command_type,NEW.id,v_source_type,NEW.id,v_version,v_operation,v_basis,v_total,NEW.actor_id,NEW.actor_session_id,NEW.actor_claim_version);
 INSERT INTO public.finance_outbound_intents(identity_sha256,event_id,organization_id,entity_id,facility_id)
 VALUES(encode(sha256(convert_to('haven-outbound-stage-v1:'||v_event_identity,'UTF8')),'hex'),v_event,NEW.organization_id,NEW.entity_id,NEW.facility_id);
 PERFORM haven.assert_finance_scope(NEW.entity_id,NEW.facility_id,NEW.command_type<>'payment');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.stage_financial_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_receipt_stage AFTER INSERT ON public.finance_command_receipts FOR EACH ROW EXECUTE FUNCTION haven.stage_financial_receipt();

CREATE FUNCTION haven.set_finance_staging_control(p_id uuid,p_entity_id uuid,p_expected_generation bigint,p_stopped boolean,p_connection_generation_ref uuid,p_capability_reference_sha256 text,p_worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_control public.finance_staging_controls%ROWTYPE; v_prior public.finance_staging_control_receipts%ROWTYPE; v_payload jsonb; v_result jsonb;
BEGIN
 v_actor:=haven.assert_finance_scope(p_entity_id,NULL,true);
 IF p_id IS NULL OR p_stopped IS NULL OR p_expected_generation IS NULL THEN RAISE EXCEPTION 'Control identity, version and stop state required'; END IF;
 v_payload:=jsonb_build_object('entity_id',p_entity_id,'expected_generation',p_expected_generation,'stopped',p_stopped,'connection_generation_ref',p_connection_generation_ref,'capability_reference_sha256',p_capability_reference_sha256,'worker_id',p_worker_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-staging-control:'||p_id,0));
 v_actor:=haven.assert_finance_scope(p_entity_id,NULL,true);
 SELECT * INTO v_prior FROM public.finance_staging_control_receipts WHERE id=p_id;
 IF FOUND THEN
  IF v_prior.entity_id<>p_entity_id OR v_prior.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Control identity content conflict' USING ERRCODE='23505'; END IF;
  RETURN v_prior.result;
 END IF;
 INSERT INTO public.finance_staging_controls(entity_id,organization_id,updated_by) VALUES(p_entity_id,haven.organization_id(),v_actor) ON CONFLICT(entity_id) DO NOTHING;
 SELECT * INTO v_control FROM public.finance_staging_controls WHERE entity_id=p_entity_id FOR UPDATE;
 v_actor:=haven.assert_finance_scope(p_entity_id,NULL,true);
 IF v_control.staging_generation<>p_expected_generation THEN RAISE EXCEPTION 'Staging control generation changed' USING ERRCODE='40001'; END IF;
 UPDATE public.finance_staging_controls SET stopped=p_stopped,connection_generation_ref=p_connection_generation_ref,
  capability_reference_sha256=p_capability_reference_sha256,worker_id=p_worker_id,staging_generation=staging_generation+1,updated_by=v_actor,updated_at=clock_timestamp() WHERE entity_id=p_entity_id;
 v_result:=jsonb_build_object('entity_id',p_entity_id,'staging_generation',v_control.staging_generation+1,'stopped',p_stopped,'dispatch_enabled',false);
 INSERT INTO public.finance_staging_control_receipts(id,organization_id,entity_id,actor_id,actor_session_id,payload,result)
 VALUES(p_id,haven.organization_id(),p_entity_id,v_actor,(auth.jwt()->>'session_id')::uuid,v_payload,v_result);
 PERFORM haven.assert_finance_scope(p_entity_id,NULL,true);
 RETURN v_result;
END $$;

CREATE FUNCTION haven.queue_finance_outbound(p_id uuid,p_intent_id uuid,p_retry_of uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intent public.finance_outbound_intents%ROWTYPE; v_control public.finance_staging_controls%ROWTYPE; v_prior public.finance_staging_commands%ROWTYPE; v_predecessor public.finance_staging_commands%ROWTYPE; v_actor uuid; v_operation text:='queue';
BEGIN
 SELECT * INTO v_intent FROM public.finance_outbound_intents WHERE id=p_intent_id;
 IF NOT FOUND OR p_id IS NULL THEN RAISE EXCEPTION 'Staging intent unavailable' USING ERRCODE='42501'; END IF;
 v_actor:=haven.assert_finance_scope(v_intent.entity_id,v_intent.facility_id,true);
 SELECT * INTO v_control FROM public.finance_staging_controls WHERE entity_id=v_intent.entity_id FOR UPDATE;
 v_actor:=haven.assert_finance_scope(v_intent.entity_id,v_intent.facility_id,true);
 IF NOT FOUND OR v_control.stopped THEN RAISE EXCEPTION 'Outbound staging is stopped' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_prior FROM public.finance_staging_commands WHERE id=p_id;
 IF FOUND THEN
  IF v_prior.intent_id<>p_intent_id OR v_prior.retry_of IS DISTINCT FROM p_retry_of THEN RAISE EXCEPTION 'Staging command identity content conflict' USING ERRCODE='23505'; END IF;
  IF v_prior.staging_generation<>v_control.staging_generation THEN RAISE EXCEPTION 'Staging command generation is stale' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('command_id',p_id,'status','staged_dispatch_disabled');
 END IF;
 IF p_retry_of IS NOT NULL THEN
  SELECT * INTO v_predecessor FROM public.finance_staging_commands WHERE id=p_retry_of AND intent_id=p_intent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retry predecessor does not belong to intent'; END IF;
  IF EXISTS(SELECT 1 FROM public.finance_staging_attempts WHERE command_id=p_retry_of AND outcome='blocked_dispatch_disabled') THEN
   v_operation:='retry';
  ELSIF v_predecessor.staging_generation<>v_control.staging_generation AND NOT EXISTS(SELECT 1 FROM public.finance_staging_attempts WHERE command_id=p_retry_of) THEN
   -- No attempt can have dispatched in this segment. Preserve the stale root
   -- and create one successor at the current binding instead of stranding it.
   v_operation:='supersede';
  ELSE RAISE EXCEPTION 'Retry requires a prior blocked staging attempt'; END IF;
 END IF;
 INSERT INTO public.finance_staging_commands(id,intent_id,organization_id,entity_id,facility_id,staging_generation,connection_generation_ref,capability_reference_sha256,operation,retry_of,actor_id,actor_session_id,actor_claim_version)
 SELECT p_id,p_intent_id,v_intent.organization_id,v_intent.entity_id,v_intent.facility_id,v_control.staging_generation,v_control.connection_generation_ref,v_control.capability_reference_sha256,
 v_operation,p_retry_of,v_actor,(auth.jwt()->>'session_id')::uuid,a.actor_claim_version FROM haven.current_authorized_actor() a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current staging authority required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('command_id',p_id,'status','staged_dispatch_disabled');
END $$;

-- This endpoint is a local worker observation, never a dispatch/acknowledgment.
-- Only service_role has EXECUTE, and the registered entity worker+generation
-- are revalidated under the same control lock used by stop/rebind operations.
CREATE FUNCTION haven.record_finance_staging_attempt(p_id uuid,p_command_id uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_command public.finance_staging_commands%ROWTYPE; v_control public.finance_staging_controls%ROWTYPE; v_prior public.finance_staging_attempts%ROWTYPE; v_number integer;
BEGIN
 SELECT * INTO v_command FROM public.finance_staging_commands WHERE id=p_command_id;
 IF NOT FOUND OR p_id IS NULL THEN RAISE EXCEPTION 'Worker command unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_control FROM public.finance_staging_controls WHERE entity_id=v_command.entity_id FOR UPDATE;
 IF v_control.stopped OR p_worker_id IS NULL OR v_control.worker_id IS DISTINCT FROM p_worker_id
  OR v_control.organization_id IS DISTINCT FROM v_command.organization_id
  OR NOT EXISTS(SELECT 1 FROM public.entities WHERE id=v_command.entity_id AND organization_id=v_command.organization_id AND deleted_at IS NULL)
  OR (v_command.facility_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=v_command.facility_id AND entity_id=v_command.entity_id AND organization_id=v_command.organization_id AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Staging worker not authorized' USING ERRCODE='42501'; END IF;
 IF v_command.staging_generation<>v_control.staging_generation OR v_command.connection_generation_ref IS DISTINCT FROM v_control.connection_generation_ref
  OR v_command.capability_reference_sha256 IS DISTINCT FROM v_control.capability_reference_sha256 THEN RAISE EXCEPTION 'Staging command generation is stale' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_prior FROM public.finance_staging_attempts WHERE id=p_id;
 IF FOUND THEN
  IF (v_prior.command_id,v_prior.worker_id) IS DISTINCT FROM (p_command_id,p_worker_id) THEN RAISE EXCEPTION 'Attempt identity content conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('attempt_id',p_id,'outcome',v_prior.outcome);
 END IF;
 SELECT coalesce(max(attempt_number),0)+1 INTO v_number FROM public.finance_staging_attempts WHERE command_id=p_command_id;
 INSERT INTO public.finance_staging_attempts(id,command_id,organization_id,entity_id,facility_id,worker_id,attempt_number)
 VALUES(p_id,p_command_id,v_command.organization_id,v_command.entity_id,v_command.facility_id,p_worker_id,v_number);
 RETURN jsonb_build_object('attempt_id',p_id,'outcome','blocked_dispatch_disabled');
END $$;

CREATE FUNCTION haven.finance_staging_summary(p_entity_id uuid,p_facility_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_totals jsonb; v_gap bigint; v_events bigint;
BEGIN
 PERFORM haven.assert_finance_scope(p_entity_id,p_facility_id);
 SELECT coalesce(jsonb_object_agg(amount_basis,total_cents),'{}'::jsonb) INTO v_totals FROM(
  SELECT amount_basis,sum(control_total_cents)::text total_cents FROM public.finance_source_events
   WHERE entity_id=p_entity_id AND organization_id=haven.organization_id() AND (p_facility_id IS NULL OR facility_id=p_facility_id) GROUP BY amount_basis) grouped;
 SELECT count(*) INTO v_events FROM public.finance_source_events WHERE entity_id=p_entity_id AND organization_id=haven.organization_id() AND (p_facility_id IS NULL OR facility_id=p_facility_id);
 SELECT count(*) INTO v_gap FROM public.finance_command_receipts r WHERE r.entity_id=p_entity_id AND r.organization_id=haven.organization_id()
  AND (p_facility_id IS NULL OR r.facility_id=p_facility_id) AND r.command_type IN('payment','invoice_post','manual_post','reversal')
  AND NOT EXISTS(SELECT 1 FROM public.finance_source_events e WHERE e.receipt_type=r.command_type AND e.receipt_id=r.id);
 RETURN jsonb_build_object('event_count',v_events::text,'control_totals_by_basis',v_totals,'unrepresented_eligible_receipts',v_gap::text,'dispatch_enabled',false);
END $$;

CREATE FUNCTION public.set_finance_staging_control(p_id uuid,p_entity_id uuid,p_expected_generation bigint,p_stopped boolean,p_connection_generation_ref uuid DEFAULT NULL,p_capability_reference_sha256 text DEFAULT NULL,p_worker_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.set_finance_staging_control(p_id,p_entity_id,p_expected_generation,p_stopped,p_connection_generation_ref,p_capability_reference_sha256,p_worker_id) $$;
CREATE FUNCTION public.queue_finance_outbound(p_id uuid,p_intent_id uuid,p_retry_of uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.queue_finance_outbound(p_id,p_intent_id,p_retry_of) $$;
CREATE FUNCTION public.record_finance_staging_attempt(p_id uuid,p_command_id uuid,p_worker_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_finance_staging_attempt(p_id,p_command_id,p_worker_id) $$;
CREATE FUNCTION public.finance_staging_summary(p_entity_id uuid,p_facility_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finance_staging_summary(p_entity_id,p_facility_id) $$;
REVOKE ALL ON FUNCTION haven.set_finance_staging_control(uuid,uuid,bigint,boolean,uuid,text,uuid),public.set_finance_staging_control(uuid,uuid,bigint,boolean,uuid,text,uuid),
 haven.queue_finance_outbound(uuid,uuid,uuid),public.queue_finance_outbound(uuid,uuid,uuid),haven.finance_staging_summary(uuid,uuid),public.finance_staging_summary(uuid,uuid),
 haven.record_finance_staging_attempt(uuid,uuid,uuid),public.record_finance_staging_attempt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.set_finance_staging_control(uuid,uuid,bigint,boolean,uuid,text,uuid),public.set_finance_staging_control(uuid,uuid,bigint,boolean,uuid,text,uuid),
 haven.queue_finance_outbound(uuid,uuid,uuid),public.queue_finance_outbound(uuid,uuid,uuid),haven.finance_staging_summary(uuid,uuid),public.finance_staging_summary(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION haven.record_finance_staging_attempt(uuid,uuid,uuid),public.record_finance_staging_attempt(uuid,uuid,uuid) TO service_role;
COMMIT;
