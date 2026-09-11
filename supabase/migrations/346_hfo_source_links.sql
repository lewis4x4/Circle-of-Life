BEGIN;

-- COL-147 / HFO-09: link final source records to requirements with replay and
-- invalidation handling. The shared mechanism only: an allowlist of source
-- adapters (each naming a reader that returns the live state of one record),
-- an allowlist of the activities a source may satisfy, an immutable delivery
-- ledger keyed on the final source id and version, a matching predicate over
-- activity, site, subject, period and rule, and satisfaction written as the
-- same 341/344 receipts a person would write, carrying the source identity.
-- A final matching record satisfies exactly its occurrence once; a replay or
-- a concurrent delivery converges on the one ledger row; a draft, voided,
-- stale, missing, wrong-site, wrong-subject, non-allowlisted or off-period
-- record cannot satisfy anything and leaves a recorded refusal; a corrected
-- version supersedes the earlier source receipt as a 344 correction; a void
-- reverses the source receipt and leaves an attention row. Pending
-- reconciliation (unmatched, ambiguous, conflict, invalidated) is visible and
-- resolved only by explicit audited commands that never widen the predicate.
-- This migration registers no adapter, no reader, no rule and no source,
-- declares nothing final, and connects no domain (COL-154 through COL-159).

-- ---------------------------------------------------------------------------
-- Source token: a second transaction-local marker on the same owner secret,
-- so guards can tell a source command's writes from the other commands'.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_approved() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(nullif(current_setting('haven.operation_source_command',true),'')=haven.operation_occurrence_token(),false)
$$;
REVOKE ALL ON FUNCTION haven.operation_source_approved() FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Allowlists. Registration happens only by migration (no session, no
-- service); nothing is registered here.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_source_adapters (
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 source_key text NOT NULL CHECK(source_key ~ '^[a-z][a-z0-9-]{0,63}$'),
 subject_kind text NOT NULL CHECK(subject_kind IN('facility','resident','employee','asset')),
 reader_function text NOT NULL CHECK(reader_function ~ '^[a-z][a-z0-9_]{0,62}$'),
 status text NOT NULL DEFAULT 'registered' CHECK(status IN('registered','retired')),
 note text CHECK(note IS NULL OR length(note)<=2000),
 registered_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz,
 PRIMARY KEY(organization_id,source_key),
 CHECK((status='retired')=(retired_at IS NOT NULL))
);
CREATE TABLE public.operation_source_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 source_key text NOT NULL,
 activity_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'registered' CHECK(status IN('registered','retired')),
 registered_at timestamptz NOT NULL DEFAULT now(),
 retired_at timestamptz,
 UNIQUE(organization_id,source_key,activity_id),
 FOREIGN KEY(organization_id,source_key) REFERENCES public.operation_source_adapters(organization_id,source_key),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK((status='retired')=(retired_at IS NOT NULL))
);
CREATE FUNCTION haven.operation_source_reader_exists(p_name text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='haven' AND p.proname=p_name AND p.pronargs=1 AND p.proargtypes[0]='text'::regtype AND p.prorettype='jsonb'::regtype AND NOT p.proretset)
$$;
-- Only a migration or the owner (no session, no service identity) registers or retires.
CREATE FUNCTION haven.guard_operation_source_allowlist() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Source allowlists are immutable history' USING ERRCODE='23514'; END IF;
 IF auth.uid() IS NOT NULL OR coalesce(auth.jwt()->>'role','') IN('service_role','authenticated','anon') THEN
  RAISE EXCEPTION 'Source adapters are registered by migration only' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='operation_source_adapters' THEN
  IF TG_OP='UPDATE' AND (OLD.id,OLD.organization_id,OLD.source_key,OLD.subject_kind,OLD.reader_function,OLD.registered_at) IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.source_key,NEW.subject_kind,NEW.reader_function,NEW.registered_at) THEN
   RAISE EXCEPTION 'Source adapter identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='retired' AND NEW.status='registered' THEN RAISE EXCEPTION 'A retired source adapter is not re-registered' USING ERRCODE='23514'; END IF;
  IF NEW.status='registered' AND NOT haven.operation_source_reader_exists(NEW.reader_function) THEN
   RAISE EXCEPTION 'Source reader haven.%(text) RETURNS jsonb does not exist',NEW.reader_function USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND (OLD.organization_id,OLD.source_key,OLD.activity_id,OLD.registered_at) IS DISTINCT FROM (NEW.organization_id,NEW.source_key,NEW.activity_id,NEW.registered_at) THEN
   RAISE EXCEPTION 'Source rule identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='retired' AND NEW.status='registered' THEN RAISE EXCEPTION 'A retired source rule is not re-registered' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_reader_exists(text),haven.guard_operation_source_allowlist() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_source_adapter_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_source_adapters FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_source_allowlist();
CREATE TRIGGER operation_source_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_source_rules FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_source_allowlist();
CREATE TRIGGER operation_source_adapters_no_truncate BEFORE TRUNCATE ON public.operation_source_adapters FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_source_rules_no_truncate BEFORE TRUNCATE ON public.operation_source_rules FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_source_adapters_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_source_adapters FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_source_rules_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_source_rules FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.operation_source_adapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_source_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_source_adapters,public.operation_source_rules FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_source_adapters,public.operation_source_rules TO authenticated,service_role;
CREATE POLICY operation_source_adapters_read ON public.operation_source_adapters FOR SELECT TO authenticated USING(organization_id=haven.organization_id());
CREATE POLICY operation_source_rules_read ON public.operation_source_rules FOR SELECT TO authenticated USING(organization_id=haven.organization_id());

-- ---------------------------------------------------------------------------
-- Delivery ledger and reconcile attempts.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_source_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 source_key text NOT NULL,
 source_record_id text NOT NULL CHECK(source_record_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 source_record_version text NOT NULL CHECK(source_record_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
 event_kind text NOT NULL CHECK(event_kind IN('final','voided')),
 delivery_kind text NOT NULL CHECK(delivery_kind IN('session','service')),
 delivered_by uuid REFERENCES public.user_profiles(id),
 delivered_at timestamptz NOT NULL,
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 activity_id uuid,
 subject_id uuid REFERENCES public.operation_activity_subjects(id),
 authority_class text CHECK(authority_class IS NULL OR authority_class IN('facility','resident','employee_personnel','asset')),
 task_instance_id uuid REFERENCES public.operation_task_instances(id),
 receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 state text NOT NULL CHECK(state IN('satisfied','corrected','invalidated','unmatched','ambiguous','conflict','refused','dismissed')),
 attention boolean NOT NULL DEFAULT false,
 reason text CHECK(reason IS NULL OR reason ~ '^[a-z][a-z0-9_]{0,63}$'),
 detail text CHECK(detail IS NULL OR length(detail)<=2000),
 candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(candidates)='array'),
 snapshot jsonb CHECK(snapshot IS NULL OR jsonb_typeof(snapshot)='object'),
 reconciled_by uuid REFERENCES public.user_profiles(id),
 reconciled_at timestamptz,
 revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,source_key) REFERENCES public.operation_source_adapters(organization_id,source_key),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK((delivery_kind='session')=(delivered_by IS NOT NULL)),
 CHECK(state NOT IN('satisfied','corrected','invalidated') OR receipt_id IS NOT NULL),
 CHECK(receipt_id IS NULL OR state IN('satisfied','corrected','invalidated','dismissed')),
 CHECK(state NOT IN('satisfied','corrected','invalidated','conflict') OR task_instance_id IS NOT NULL),
 CHECK((reconciled_by IS NULL)=(reconciled_at IS NULL))
);
-- One live delivery per record version and kind: a refused row is history that never blocks a later, correct delivery.
CREATE UNIQUE INDEX operation_source_event_live ON public.operation_source_events(organization_id,source_key,source_record_id,source_record_version,event_kind) WHERE state<>'refused';
CREATE INDEX idx_operation_source_events_record ON public.operation_source_events(organization_id,source_key,source_record_id,delivered_at);
CREATE INDEX idx_operation_source_events_site ON public.operation_source_events(organization_id,facility_id,attention,delivered_at);
CREATE INDEX idx_operation_source_events_task ON public.operation_source_events(task_instance_id) WHERE task_instance_id IS NOT NULL;
CREATE TABLE public.operation_source_event_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.operation_source_events(id),
 seq integer NOT NULL CHECK(seq>0),
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_role text NOT NULL,
 at timestamptz NOT NULL,
 action text NOT NULL CHECK(action IN('retry','select','dismiss')),
 reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 2000),
 from_state text NOT NULL,
 to_state text NOT NULL,
 outcome jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(outcome)='object'),
 UNIQUE(event_id,seq)
);

ALTER TABLE public.operation_execution_receipts
 ADD COLUMN source_event_id uuid REFERENCES public.operation_source_events(id),
 ADD COLUMN source_key text,
 ADD COLUMN source_record_id text,
 ADD COLUMN source_record_version text,
 ADD CONSTRAINT operation_receipt_source_shape CHECK(num_nonnulls(source_event_id,source_key,source_record_id,source_record_version) IN(0,4));
CREATE INDEX idx_operation_execution_receipts_source ON public.operation_execution_receipts(organization_id,source_key,source_record_id) WHERE source_event_id IS NOT NULL;
-- A source record satisfies at most one occurrence at a time: one effective performance receipt per record across the organisation.
CREATE UNIQUE INDEX operation_receipt_effective_source ON public.operation_execution_receipts(organization_id,source_key,source_record_id)
 WHERE receipt_kind='performance' AND superseded_by_receipt_id IS NULL AND source_event_id IS NOT NULL;

CREATE FUNCTION haven.guard_operation_source_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Source deliveries are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT (haven.operation_source_approved() AND haven.operation_occurrence_approved()) THEN RAISE EXCEPTION 'Use the source commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.id,OLD.organization_id,OLD.facility_id,OLD.source_key,OLD.source_record_id,OLD.source_record_version,OLD.event_kind,OLD.delivery_kind,OLD.delivered_by,OLD.delivered_at,OLD.request_key,OLD.request_hash,OLD.created_at)
   IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.facility_id,NEW.source_key,NEW.source_record_id,NEW.source_record_version,NEW.event_kind,NEW.delivery_kind,NEW.delivered_by,NEW.delivered_at,NEW.request_key,NEW.request_hash,NEW.created_at) THEN
   RAISE EXCEPTION 'Source delivery identity is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id THEN RAISE EXCEPTION 'Source delivery receipt is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.snapshot IS NOT NULL AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN RAISE EXCEPTION 'Source delivery snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.attention=false AND NEW.attention=true THEN RAISE EXCEPTION 'Source delivery attention is cleared once' USING ERRCODE='23514'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
   IF NOT ((OLD.state IN('unmatched','ambiguous','conflict') OR (OLD.state='refused' AND OLD.attention)) AND NEW.state IN('satisfied','corrected','invalidated','dismissed','refused','unmatched','ambiguous','conflict')
    OR (OLD.state='invalidated' AND NEW.state='dismissed')) THEN
    RAISE EXCEPTION 'Source delivery is settled' USING ERRCODE='23514'; END IF;
  ELSIF (NEW.attention,NEW.reason,NEW.detail,NEW.candidates,NEW.snapshot,NEW.activity_id,NEW.subject_id,NEW.authority_class,NEW.task_instance_id,NEW.receipt_id)
   IS DISTINCT FROM (OLD.attention,OLD.reason,OLD.detail,OLD.candidates,OLD.snapshot,OLD.activity_id,OLD.subject_id,OLD.authority_class,OLD.task_instance_id,OLD.receipt_id) THEN
   -- Content moves only while the delivery is pending; a settled row changes only its reconcile stamp.
   IF NOT (OLD.state IN('unmatched','ambiguous','conflict') OR (OLD.state='refused' AND OLD.attention)) THEN RAISE EXCEPTION 'Source delivery is settled' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW.revision:=haven.operation_occurrence_revision();
 RETURN NEW;
END $$;
CREATE FUNCTION haven.guard_operation_source_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Source reconcile attempts are immutable' USING ERRCODE='23514'; END IF;
 IF NOT (haven.operation_source_approved() AND haven.operation_occurrence_approved()) THEN RAISE EXCEPTION 'Use the source commands' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_source_event(),haven.guard_operation_source_attempt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_source_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_source_events FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_source_event();
CREATE TRIGGER operation_source_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_source_event_attempts FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_source_attempt();
CREATE TRIGGER operation_source_events_no_truncate BEFORE TRUNCATE ON public.operation_source_events FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_source_attempts_no_truncate BEFORE TRUNCATE ON public.operation_source_event_attempts FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_source_events_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_source_events FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_source_attempts_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_source_event_attempts FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.operation_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_source_event_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_source_events,public.operation_source_event_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_source_events,public.operation_source_event_attempts TO authenticated,service_role;
-- A delivery is readable under current site authority, and only when the
-- occurrence it names and the subject it resolved are readable too.
CREATE FUNCTION haven.operation_source_event_readable(e public.operation_source_events) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT e.organization_id=haven.organization_id() AND haven.operation_facility_access(e.facility_id)
  AND (e.task_instance_id IS NULL OR haven.operation_task_readable(e.task_instance_id))
  AND (e.subject_id IS NULL OR haven.operation_subject_accessible(e.subject_id,e.organization_id,e.facility_id,e.authority_class))
$$;
REVOKE ALL ON FUNCTION haven.operation_source_event_readable(public.operation_source_events) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_source_event_readable(public.operation_source_events) TO authenticated;
CREATE POLICY operation_source_events_read ON public.operation_source_events FOR SELECT TO authenticated USING(haven.operation_source_event_readable(operation_source_events));
CREATE POLICY operation_source_attempts_read ON public.operation_source_event_attempts FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.operation_source_events e WHERE e.id=event_id AND haven.operation_source_event_readable(e)));
CREATE POLICY operation_source_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(
 table_name NOT IN('operation_source_events','operation_source_event_attempts','operation_source_adapters','operation_source_rules'));

-- Lifecycle events the commands write.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_audit_log'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%event_type%';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.operation_audit_log DROP CONSTRAINT %I',c); END IF;
 ALTER TABLE public.operation_audit_log ADD CONSTRAINT operation_audit_log_event_type_check CHECK(event_type IN(
  'created','assigned','started','completed','missed','deferred','cancelled','escalated','verified','signed','updated','generated','associated','reconciled','recorded','issue_reported','corrected','reversed',
  'source_linked','source_pending','source_invalidated'));
END $$;

-- ---------------------------------------------------------------------------
-- The 341 authority guard keeps its body; beside 340's cancellation carve-out,
-- a service-identity update of a managed occurrence under both tokens is
-- accepted when it leaves the subject, classification, removal and raw
-- evidence paths untouched (the source commands project satisfaction and
-- invalidation exactly as the receipt commands do).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.guard_operation_current_authority() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.subject_id,NEW.authority_class) IS DISTINCT FROM (OLD.subject_id,OLD.authority_class) THEN
 RAISE EXCEPTION 'Operation subject classification is immutable; reconcile through an approved migration' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.authority_class<>'unclassified' AND NEW.activity_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.operation_activities a JOIN public.operation_activity_subjects subject ON subject.id=NEW.subject_id
 WHERE a.id=NEW.activity_id AND a.subject_kind IS NOT NULL AND a.subject_kind<>subject.subject_kind) THEN
 RAISE EXCEPTION 'Operation subject type does not match activity' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.authority_class<>'unclassified' AND NOT haven.operation_subject_current(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL THEN
 IF TG_OP='UPDATE' AND haven.operation_occurrence_approved() AND OLD.occurrence_kind IN('scheduled','event') AND OLD.status='pending' AND NEW.status='cancelled'
  AND (NEW.created_by,NEW.updated_by,NEW.signed_by,NEW.second_sign_by,NEW.verified_by,NEW.completion_notes,NEW.completion_evidence_paths,NEW.completed_at,NEW.started_at,NEW.deleted_at)
   IS NOT DISTINCT FROM (OLD.created_by,OLD.updated_by,OLD.signed_by,OLD.second_sign_by,OLD.verified_by,OLD.completion_notes,OLD.completion_evidence_paths,OLD.completed_at,OLD.started_at,OLD.deleted_at) THEN
 RETURN NEW; END IF;
 -- COL-147: the source commands project a final source record's satisfaction or invalidation.
 IF TG_OP='UPDATE' AND haven.operation_occurrence_approved() AND haven.operation_source_approved() AND OLD.occurrence_kind IN('scheduled','event')
  AND (NEW.deleted_at,NEW.completion_evidence_paths,NEW.created_by) IS NOT DISTINCT FROM (OLD.deleted_at,OLD.completion_evidence_paths,OLD.created_by)
  AND (NEW.status<>'completed' OR NEW.effective_receipt_id IS NOT NULL) THEN
 RETURN NEW; END IF;
 -- Only trusted service provisioning may supply a typed subject/classification;
 -- browser DML is revoked. Existing schedulers default to unclassified.
 -- Service jobs may create unclassified occurrences and update facility/asset
 -- scheduling, never assert human performance or complete protected subjects.
 IF (TG_OP='INSERT' AND (NEW.created_by IS NOT NULL OR NEW.updated_by IS NOT NULL OR NEW.status='completed' OR NEW.signed_by IS NOT NULL OR NEW.second_sign_by IS NOT NULL OR NEW.verified_by IS NOT NULL OR coalesce(cardinality(NEW.completion_evidence_paths),0)>0))
 OR (TG_OP='UPDATE' AND ((NEW.created_by,NEW.updated_by,NEW.signed_by,NEW.second_sign_by,NEW.verified_by,NEW.completion_notes,NEW.completion_evidence_paths,NEW.completed_at) IS DISTINCT FROM (OLD.created_by,OLD.updated_by,OLD.signed_by,OLD.second_sign_by,OLD.verified_by,OLD.completion_notes,OLD.completion_evidence_paths,OLD.completed_at) OR NEW.status='completed' OR NEW.authority_class NOT IN('unclassified','facility','asset'))) THEN
 RAISE EXCEPTION 'Authenticated operation actor required' USING ERRCODE='42501'; END IF;
 IF NEW.authority_class IN('facility','asset') AND NOT haven.operation_subject_current(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NOT (OLD.occurrence_kind IS NOT NULL AND haven.operation_occurrence_approved()) THEN PERFORM haven.lock_operation_authority(OLD.id); END IF;
 ELSIF NOT haven.operation_subject_accessible(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 NEW.updated_by:=auth.uid(); IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); END IF;
 IF coalesce(cardinality(NEW.completion_evidence_paths),0)>0 THEN RAISE EXCEPTION 'Classified evidence command required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Reader and snapshot helpers.
-- ---------------------------------------------------------------------------
CREATE TYPE haven.operation_source_snapshot AS (
 ok boolean,reason text,detail text,version text,finality text,facility_id uuid,activity_id uuid,subject_kind text,subject_native_id uuid,
 recorded_by uuid,recorded_at timestamptz,statement jsonb,raw jsonb);

-- Reads one record live through the allowlisted reader; a reader failure is a recorded refusal, never a crash.
CREATE FUNCTION haven.operation_source_read(p_adapter public.operation_source_adapters,p_record_id text) RETURNS haven.operation_source_snapshot
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE s haven.operation_source_snapshot; raw jsonb; k text;
BEGIN
 s.ok:=false;
 IF NOT haven.operation_source_reader_exists(p_adapter.reader_function) THEN s.reason:='reader_missing'; s.detail:='Source reader is not installed'; RETURN s; END IF;
 BEGIN
  EXECUTE format('SELECT haven.%I($1)',p_adapter.reader_function) INTO raw USING p_record_id;
 EXCEPTION WHEN OTHERS THEN s.reason:='reader_failed'; s.detail:=left(SQLERRM,2000); RETURN s; END;
 s.raw:=raw;
 IF raw IS NULL OR jsonb_typeof(raw)<>'object' THEN s.reason:='reader_failed'; s.detail:='Source reader returned no object'; RETURN s; END IF;
 BEGIN
  IF (raw->>'exists')::boolean IS DISTINCT FROM true THEN s.reason:='record_missing'; s.detail:='Source record does not exist'; RETURN s; END IF;
  FOR k IN SELECT * FROM jsonb_object_keys(raw) LOOP
   IF k NOT IN('exists','version','finality','facility_id','activity_id','subject','recorded_by','recorded_at','statement') THEN s.reason:='reader_failed'; s.detail:='Source reader returned an unknown field '||k; RETURN s; END IF;
  END LOOP;
  s.version:=raw->>'version'; s.finality:=raw->>'finality';
  IF s.version IS NULL OR s.version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' THEN s.reason:='reader_failed'; s.detail:='Source reader returned no stable version'; RETURN s; END IF;
  IF s.finality IS NULL OR s.finality NOT IN('draft','final','voided') THEN s.reason:='reader_failed'; s.detail:='Source reader returned an unknown finality'; RETURN s; END IF;
  s.facility_id:=(raw->>'facility_id')::uuid; s.activity_id:=(raw->>'activity_id')::uuid; s.recorded_by:=(raw->>'recorded_by')::uuid;
  s.subject_native_id:=nullif(raw->'subject'->>'id','')::uuid;
  s.subject_kind:=raw->'subject'->>'kind';
  s.recorded_at:=haven.operation_occurrence_timestamp(raw->'recorded_at');
  s.statement:=raw->'statement';
 EXCEPTION WHEN OTHERS THEN s.reason:='reader_failed'; s.detail:='Source reader returned an invalid value: '||left(SQLERRM,1900); RETURN s; END;
 IF s.facility_id IS NULL OR s.activity_id IS NULL OR s.recorded_by IS NULL OR s.recorded_at IS NULL OR s.subject_kind IS NULL OR s.subject_kind NOT IN('facility','resident','employee','asset')
  OR (s.subject_kind<>'facility' AND s.subject_native_id IS NULL) OR (s.subject_kind='facility' AND s.subject_native_id IS NOT NULL) THEN
  s.reason:='reader_failed'; s.detail:='Source reader returned an incomplete record'; RETURN s; END IF;
 IF s.finality<>'voided' AND (s.statement IS NULL OR jsonb_typeof(s.statement)<>'object') THEN s.reason:='reader_failed'; s.detail:='Source reader returned no statement'; RETURN s; END IF;
 s.ok:=true;
 RETURN s;
END $$;
-- What the ledger keeps for a delivery whose subject was not resolved (or whose site did not match): identity and finality only, never the
-- author, the native subject id or the statement, because such a row is readable under site access alone.
CREATE FUNCTION haven.operation_source_redact(p_raw jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_raw IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('exists',p_raw->'exists','version',p_raw->'version','finality',p_raw->'finality','facility_id',p_raw->'facility_id',
  'activity_id',p_raw->'activity_id','subject',jsonb_build_object('kind',p_raw->'subject'->'kind'),'recorded_at',p_raw->'recorded_at','redacted',true)) END
$$;
CREATE FUNCTION haven.operation_source_class(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE p_kind WHEN 'employee' THEN 'employee_personnel' ELSE p_kind END $$;
CREATE FUNCTION haven.operation_source_reply(e public.operation_source_events,t public.operation_task_instances,r public.operation_execution_receipts,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('event',to_jsonb(e),
  'occurrence',CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'status',t.status,'execution_state',t.execution_state,'occurrence_revision',t.occurrence_revision,'performed_at',t.performed_at) END,
  'receipt',CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END,'candidates',e.candidates,'replayed',p_replayed)
$$;
CREATE FUNCTION haven.operation_source_reply_for(e public.operation_source_events,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT haven.operation_source_reply(e,(SELECT t FROM public.operation_task_instances t WHERE t.id=e.task_instance_id),(SELECT r FROM public.operation_execution_receipts r WHERE r.id=e.receipt_id),p_replayed)
$$;
REVOKE ALL ON FUNCTION haven.operation_source_read(public.operation_source_adapters,text),haven.operation_source_class(text),haven.operation_source_redact(jsonb),
 haven.operation_source_reply(public.operation_source_events,public.operation_task_instances,public.operation_execution_receipts,boolean),
 haven.operation_source_reply_for(public.operation_source_events,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- The matching predicate: managed scheduled/event occurrences of the
-- allowlisted activity at the site for the resolved subject whose period
-- contains the performed instant's local date in the occurrence's own
-- timezone. Rows are locked in id order so concurrent deliveries and human
-- recordings serialise on the occurrence.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_candidates(p_org uuid,p_facility uuid,p_activity uuid,p_subject uuid,p_performed timestamptz) RETURNS SETOF public.operation_task_instances
LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT t.* FROM public.operation_task_instances t
 WHERE t.organization_id=p_org AND t.facility_id=p_facility AND t.activity_id=p_activity AND t.subject_id=p_subject
  AND t.occurrence_kind IN('scheduled','event') AND t.deleted_at IS NULL AND t.status<>'cancelled'
  AND (p_performed AT TIME ZONE coalesce(t.schedule_snapshot->>'timezone',(SELECT coalesce(f.timezone,'America/New_York') FROM public.facilities f WHERE f.id=t.facility_id)))::date
   BETWEEN t.period_start_date AND t.period_end_date
 ORDER BY t.id FOR UPDATE OF t
$$;
REVOKE ALL ON FUNCTION haven.operation_source_candidates(uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Writing satisfaction (a fresh chain or a 344 correction of this source's
-- earlier receipt) and invalidation (a 344 reversal of this source's
-- effective receipt). Both run under both tokens; the caller holds the
-- occurrence lock. Returns the receipt written; a statement or recorder
-- refusal is returned as a reason instead of an exception so the ledger
-- keeps it.
-- ---------------------------------------------------------------------------
CREATE TYPE haven.operation_source_write AS (receipt public.operation_execution_receipts,reason text,detail text);

CREATE FUNCTION haven.operation_source_satisfy(e public.operation_source_events,snap haven.operation_source_snapshot,t public.operation_task_instances,prev public.operation_execution_receipts,p_actor uuid,p_validate_only boolean DEFAULT false) RETURNS haven.operation_source_write
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE w haven.operation_source_write; v public.operation_requirement_versions; fr public.operation_facility_requirements; s haven.operation_statement; roles public.app_role[];
 recorder public.user_profiles; now_at timestamptz; i public.operation_issues; r public.operation_execution_receipts; ver public.operation_execution_receipts; new_id uuid; new_status text; superseded_review uuid;
 reason text; event text; hash text;
BEGIN
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN w.reason:='statement_invalid'; w.detail:='Occurrence has no governing requirement version'; RETURN w; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
 SELECT * INTO recorder FROM public.user_profiles WHERE id=snap.recorded_by AND organization_id=t.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN w.reason:='recorder_unknown'; w.detail:='Source author is not a person of this organisation'; RETURN w; END IF;
 IF NOT recorder.is_active THEN w.reason:='recorder_not_current'; w.detail:='Source author is no longer an active person of this organisation'; RETURN w; END IF;
 IF cardinality(roles)>0 AND NOT (recorder.app_role=ANY(roles)) THEN w.reason:='recorder_not_authorized'; w.detail:='Source author is not on the published recorder list for this activity'; RETURN w; END IF;
 now_at:=clock_timestamp();
 BEGIN
  s:=haven.operation_work_statement_shape(snap.statement);
  s:=haven.operation_work_statement(s,t,v,fr,prev.chain_id,snap.recorded_at,snap.recorded_at,now_at);
 EXCEPTION WHEN OTHERS THEN w.reason:='statement_invalid'; w.detail:=left(SQLERRM,2000); RETURN w; END;
 IF p_validate_only THEN RETURN w; END IF;
 hash:=e.request_hash;
 reason:=CASE WHEN prev.id IS NULL THEN NULL ELSE 'Source record '||e.source_key||' '||e.source_record_id||' corrected: version '||prev.source_record_version||' superseded by '||e.source_record_version END;
 new_id:=gen_random_uuid();
 IF prev.id IS NOT NULL THEN
  SELECT * INTO ver FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL FOR UPDATE;
  SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRED;
 END IF;
 IF s.issue_in IS NOT NULL THEN
  INSERT INTO public.operation_issues(organization_id,facility_id,activity_id,subject_id,authority_class,task_instance_id,issue_kind,summary,severity,reported_by,reported_role,reported_at,request_key,request_hash)
  VALUES(t.organization_id,t.facility_id,t.activity_id,t.subject_id,t.authority_class,t.id,coalesce(s.issue_in->>'kind',CASE WHEN s.outcome='failed' THEN 'failed_result' ELSE 'problem' END),
   btrim(s.issue_in->>'summary'),coalesce(nullif(s.issue_in->>'severity',''),'normal'),recorder.id,recorder.app_role::text,now_at,e.request_key||'|issue',hash) RETURNING * INTO i;
 END IF;
 IF prev.id IS NOT NULL THEN UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=new_id,superseded_at=now_at WHERE id=prev.id; END IF;
 INSERT INTO public.operation_execution_receipts(id,organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
  recorder_id,recorder_role,recorded_at,performed_at,performer_kind,performer_user_id,performer_vendor_id,performer_label,entry_kind,entry_reason,outcome,values,note,
  evidence_status,missing_evidence,completion_state,issue_id,request_key,request_hash,revision,chain_id,corrects_receipt_id,correction_reason,correction_seq,
  source_event_id,source_key,source_record_id,source_record_version)
 VALUES(new_id,t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'performance',
  recorder.id,recorder.app_role::text,now_at,s.performed,s.performer_kind,s.performer_user,s.performer_vendor,s.performer_label,s.entry,s.reason,s.outcome,s.vals,s.note,
  s.evidence,s.missing,s.state,i.id,e.request_key||'|receipt',hash,haven.operation_occurrence_revision(),coalesce(prev.chain_id,new_id),prev.id,reason,coalesce(prev.correction_seq+1,0),
  e.id,e.source_key,e.source_record_id,e.source_record_version) RETURNING * INTO r;
 IF prev.id IS NOT NULL THEN
  SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey IMMEDIATE;
  IF ver.id IS NOT NULL AND ver.verifies_receipt_id=prev.id THEN
   UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=r.id,superseded_at=now_at WHERE id=ver.id;
   superseded_review:=ver.id;
  END IF;
 END IF;
 IF i.id IS NOT NULL THEN UPDATE public.operation_issues SET receipt_id=r.id WHERE id=i.id RETURNING * INTO i; END IF;
 new_status:=CASE WHEN s.state='completed' THEN 'completed' ELSE 'in_progress' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state=s.state,effective_receipt_id=r.id,performed_at=s.performed,
  signed_by=recorder.id,signed_at=now_at,
  verification_receipt_id=CASE WHEN superseded_review IS NULL THEN verification_receipt_id END,
  second_sign_by=CASE WHEN superseded_review IS NULL THEN second_sign_by END,second_signed_at=CASE WHEN superseded_review IS NULL THEN second_signed_at END,
  completed_at=CASE WHEN s.state='completed' THEN now_at END,
  verified_by=CASE WHEN s.state='completed' THEN recorder.id END,verified_at=CASE WHEN s.state='completed' THEN now_at END,
  sla_met=CASE WHEN t.due_at IS NULL THEN NULL ELSE s.performed<=coalesce(t.grace_ends_at,t.due_at) END,
  completion_notes=s.note,updated_at=now_at,updated_by=coalesce(p_actor,recorder.id)
 WHERE id=t.id;
 event:=CASE WHEN prev.id IS NOT NULL THEN 'corrected' WHEN s.state='completed' THEN 'completed' WHEN s.state='awaiting_verification' THEN 'signed' ELSE 'recorded' END;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,event,t.status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,coalesce(reason,s.note),
  jsonb_build_object('receipt_id',r.id,'corrected_receipt_id',prev.id,'chain_id',r.chain_id,'correction_seq',r.correction_seq,'completion_state',s.state,'outcome',s.outcome,'entry_kind',s.entry,'performer_kind',s.performer_kind,
   'performed_at',s.performed,'recorded_at',now_at,'recorder_id',recorder.id,'evidence_status',s.evidence,'missing_evidence',s.missing,'issue_id',i.id,
   'previous_execution_state',t.execution_state,'previous_status',t.status,'superseded_verification_receipt_id',superseded_review,
   'source_event_id',e.id,'source_key',e.source_key,'source_record_id',e.source_record_id,'source_record_version',e.source_record_version,'request_key',e.request_key,'request_hash',hash,'receipt_version',1));
 IF prev.id IS NOT NULL AND s.state='completed' THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,s.note,
   jsonb_build_object('receipt_id',r.id,'corrected_receipt_id',prev.id,'completion_state',s.state,'correction',true,'source_event_id',e.id));
 END IF;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'source_linked',t.status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,NULL,
  jsonb_build_object('source_event_id',e.id,'source_key',e.source_key,'source_record_id',e.source_record_id,'source_record_version',e.source_record_version,'delivery_kind',e.delivery_kind,'delivered_by',e.delivered_by,
   'receipt_id',r.id,'corrected_receipt_id',prev.id,'recorder_id',recorder.id));
 IF i.id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'issue_reported',new_status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,i.summary,
   jsonb_build_object('issue_id',i.id,'issue_kind',i.issue_kind,'severity',i.severity,'receipt_id',r.id,'source_event_id',e.id));
 END IF;
 w.receipt:=r;
 RETURN w;
END $$;

CREATE FUNCTION haven.operation_source_invalidate(e public.operation_source_events,snap haven.operation_source_snapshot,t public.operation_task_instances,perf public.operation_execution_receipts,p_actor uuid,p_reason text DEFAULT NULL) RETURNS haven.operation_source_write
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE w haven.operation_source_write; v public.operation_requirement_versions; fr public.operation_facility_requirements; recorder public.user_profiles; now_at timestamptz;
 ver public.operation_execution_receipts; r public.operation_execution_receipts; new_id uuid; new_status text; superseded_review uuid; reason text;
BEGIN
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 SELECT * INTO recorder FROM public.user_profiles WHERE id=snap.recorded_by AND organization_id=t.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN w.reason:='recorder_unknown'; w.detail:='Source author is not a person of this organisation'; RETURN w; END IF;
 IF NOT recorder.is_active THEN w.reason:='recorder_not_current'; w.detail:='Source author is no longer an active person of this organisation'; RETURN w; END IF;
 now_at:=clock_timestamp();
 reason:=coalesce(p_reason,'Source record '||e.source_key||' '||e.source_record_id||' voided (version '||e.source_record_version||')');
 SELECT * INTO ver FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL FOR UPDATE;
 new_id:=gen_random_uuid();
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRED;
 UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=new_id,superseded_at=now_at WHERE id=perf.id;
 INSERT INTO public.operation_execution_receipts(id,organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
  recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,values,note,evidence_status,missing_evidence,completion_state,request_key,request_hash,revision,
  chain_id,corrects_receipt_id,correction_reason,correction_seq,source_event_id,source_key,source_record_id,source_record_version)
 VALUES(new_id,t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'reversal',
  recorder.id,recorder.app_role::text,now_at,now_at,'self','routine',NULL,'{}'::jsonb,NULL,'not_required','[]'::jsonb,'reversed',e.request_key||'|reversal',e.request_hash,haven.operation_occurrence_revision(),
  perf.chain_id,perf.id,reason,perf.correction_seq+1,e.id,e.source_key,e.source_record_id,e.source_record_version) RETURNING * INTO r;
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey IMMEDIATE;
 IF ver.id IS NOT NULL AND ver.verifies_receipt_id=perf.id THEN
  UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=r.id,superseded_at=now_at WHERE id=ver.id;
  superseded_review:=ver.id;
 END IF;
 new_status:=CASE WHEN coalesce(t.grace_ends_at,t.due_at)<now_at THEN 'missed' ELSE 'pending' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state='none',effective_receipt_id=NULL,verification_receipt_id=NULL,performed_at=NULL,
  completed_at=NULL,signed_by=NULL,signed_at=NULL,second_sign_by=NULL,second_signed_at=NULL,verified_by=NULL,verified_at=NULL,sla_met=NULL,completion_notes=NULL,
  missed_at=CASE WHEN new_status='missed' THEN coalesce(missed_at,now_at) ELSE missed_at END,updated_at=now_at,updated_by=coalesce(p_actor,recorder.id)
 WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'reversed',t.status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,reason,
  jsonb_build_object('receipt_id',r.id,'reversed_receipt_id',perf.id,'chain_id',r.chain_id,'correction_seq',r.correction_seq,'reason',reason,'recorded_at',now_at,
   'previous_execution_state',t.execution_state,'previous_status',t.status,'previous_performed_at',t.performed_at,'superseded_verification_receipt_id',superseded_review,
   'source_event_id',e.id,'request_key',e.request_key,'request_hash',e.request_hash,'receipt_version',1)),
 (t.organization_id,t.facility_id,t.id,'source_invalidated',t.status,new_status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,NULL,
  jsonb_build_object('source_event_id',e.id,'source_key',e.source_key,'source_record_id',e.source_record_id,'source_record_version',e.source_record_version,'delivery_kind',e.delivery_kind,'delivered_by',e.delivered_by,
   'reversal_receipt_id',r.id,'reversed_receipt_id',perf.id,'reversed_source_record_version',perf.source_record_version));
 w.receipt:=r;
 RETURN w;
END $$;
REVOKE ALL ON FUNCTION
 haven.operation_source_satisfy(public.operation_source_events,haven.operation_source_snapshot,public.operation_task_instances,public.operation_execution_receipts,uuid,boolean),
 haven.operation_source_invalidate(public.operation_source_events,haven.operation_source_snapshot,public.operation_task_instances,public.operation_execution_receipts,uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Settle one delivery against the live snapshot: resolves subject, matches,
-- locks the occurrence (session: the deliverer's current authority through
-- the 341 lock; service: the rows themselves), writes satisfaction,
-- correction, invalidation or a pending/refused outcome, and updates the
-- ledger row. Shared by delivery and reconcile.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_settle(p_event uuid,snap haven.operation_source_snapshot,p_select uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e public.operation_source_events; adapter public.operation_source_adapters; activity public.operation_activities; subject public.operation_activity_subjects;
 t public.operation_task_instances; c public.operation_task_instances; n int:=0; cands jsonb:='[]'::jsonb; perf public.operation_execution_receipts; any_receipt public.operation_execution_receipts;
 moved public.operation_task_instances; moved_receipt uuid;
 w haven.operation_source_write; v_state text; v_reason text; v_detail text; v_attention boolean:=false; performed timestamptz; class text; native uuid;
BEGIN
 SELECT * INTO e FROM public.operation_source_events WHERE id=p_event FOR UPDATE;
 SELECT * INTO adapter FROM public.operation_source_adapters WHERE organization_id=e.organization_id AND source_key=e.source_key;
 -- Snapshot problems recorded first.
 IF adapter.status IS DISTINCT FROM 'registered' THEN v_state:='refused'; v_reason:='adapter_retired'; v_detail:='Source adapter is retired';
 ELSIF NOT snap.ok THEN v_state:='refused'; v_reason:=snap.reason; v_detail:=snap.detail;
 -- The site is checked before anything else about the record is reported, so another site learns nothing beyond the mismatch.
 ELSIF snap.facility_id<>e.facility_id OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=e.facility_id AND f.organization_id=e.organization_id AND f.deleted_at IS NULL) THEN
  v_state:='refused'; v_reason:='facility_mismatch'; v_detail:='Source record belongs to another site';
 ELSIF snap.version<>e.source_record_version THEN v_state:='refused'; v_reason:='source_version_changed'; v_detail:='Source record is now version '||snap.version;
 ELSIF e.event_kind='final' AND snap.finality='draft' THEN v_state:='refused'; v_reason:='source_not_final'; v_detail:='Source record is a draft';
 ELSIF e.event_kind='final' AND snap.finality='voided' THEN v_state:='refused'; v_reason:='source_voided'; v_detail:='Source record is voided';
 ELSIF e.event_kind='voided' AND snap.finality<>'voided' THEN v_state:='refused'; v_reason:='source_not_voided'; v_detail:='Source record is not voided';
 ELSIF snap.subject_kind<>adapter.subject_kind THEN v_state:='refused'; v_reason:='subject_kind_mismatch'; v_detail:='Source record names a '||snap.subject_kind||' but the adapter is registered for '||adapter.subject_kind;
 ELSIF NOT EXISTS(SELECT 1 FROM public.operation_source_rules ru WHERE ru.organization_id=e.organization_id AND ru.source_key=e.source_key AND ru.activity_id=snap.activity_id AND ru.status='registered') THEN
  v_state:='refused'; v_reason:='activity_not_allowlisted'; v_detail:='Activity is not allowlisted for this source';
 END IF;
 IF v_state IS NULL THEN
  SELECT * INTO activity FROM public.operation_activities WHERE id=snap.activity_id AND organization_id=e.organization_id FOR SHARE;
  IF NOT FOUND OR activity.subject_kind IS DISTINCT FROM adapter.subject_kind THEN v_state:='refused'; v_reason:='subject_kind_mismatch'; v_detail:='Activity subject kind differs from the adapter'; END IF;
 END IF;
 IF v_state IS NULL THEN
  class:=haven.operation_source_class(snap.subject_kind);
  IF snap.subject_kind='facility' THEN
   INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind) VALUES(e.organization_id,e.facility_id,'facility') ON CONFLICT (facility_id) WHERE subject_kind='facility' DO NOTHING;
   SELECT * INTO subject FROM public.operation_activity_subjects WHERE facility_id=e.facility_id AND subject_kind='facility';
  ELSE
   native:=snap.subject_native_id;
   SELECT * INTO subject FROM public.operation_activity_subjects s WHERE s.organization_id=e.organization_id AND s.facility_id=e.facility_id AND s.subject_kind=snap.subject_kind
    AND CASE snap.subject_kind WHEN 'resident' THEN s.resident_id WHEN 'employee' THEN s.employee_id ELSE s.asset_id END=native;
   IF NOT FOUND THEN v_state:='unmatched'; v_reason:='subject_not_enrolled'; v_detail:='No enrolled subject at this site matches the source record'; v_attention:=true; END IF;
  END IF;
  IF subject.id IS NOT NULL AND NOT haven.operation_subject_current(subject.id,e.organization_id,e.facility_id,class) THEN
   -- A subject that is no longer current is not recorded on the row (nobody could read or reconcile it under its authority); the snapshot is redacted.
   v_state:='unmatched'; v_reason:='subject_not_current'; v_detail:='The subject of the source record is no longer current at this site'; v_attention:=true; subject:=NULL;
  ELSIF subject.id IS NOT NULL AND p_actor IS NOT NULL AND NOT haven.operation_subject_accessible(subject.id,e.organization_id,e.facility_id,class) THEN
   RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF v_state IS NULL AND e.event_kind='voided' THEN
  -- Invalidation matches by source identity, never by period.
  SELECT r.* INTO any_receipt FROM public.operation_execution_receipts r WHERE r.organization_id=e.organization_id AND r.source_key=e.source_key AND r.source_record_id=e.source_record_id AND r.receipt_kind='performance'
   ORDER BY (r.superseded_by_receipt_id IS NULL) DESC,r.recorded_at DESC LIMIT 1;
  IF any_receipt.id IS NULL THEN v_state:='refused'; v_reason:='nothing_to_invalidate'; v_detail:='This source record never satisfied an occurrence';
  ELSE
   IF p_actor IS NOT NULL THEN PERFORM haven.lock_operation_work_authority(any_receipt.task_instance_id,NULL); END IF;
   SELECT * INTO t FROM public.operation_task_instances WHERE id=any_receipt.task_instance_id FOR UPDATE;
   SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL FOR UPDATE;
   IF perf.id IS NULL OR perf.source_key IS DISTINCT FROM e.source_key OR perf.source_record_id IS DISTINCT FROM e.source_record_id THEN
    v_state:='refused'; v_reason:='source_not_effective'; v_detail:='The receipt this source wrote is no longer the effective one'; v_attention:=true;
   ELSIF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN v_state:='refused'; v_reason:='occurrence_cancelled'; v_detail:='Occurrence is cancelled'; v_attention:=true;
   ELSE
    w:=haven.operation_source_invalidate(e,snap,t,perf,p_actor);
    IF w.reason IS NOT NULL THEN v_state:='refused'; v_reason:=w.reason; v_detail:=w.detail; v_attention:=true;
    ELSE v_state:='invalidated'; v_attention:=true; END IF;
   END IF;
  END IF;
 ELSIF v_state IS NULL THEN
  performed:=coalesce(haven.operation_occurrence_timestamp(snap.statement->'performed_at'),snap.recorded_at);
  IF performed>clock_timestamp()+interval '2 minutes' THEN
   v_state:='refused'; v_reason:='statement_invalid'; v_detail:='Performed time cannot be in the future';
  END IF;
 END IF;
 IF v_state IS NULL AND e.event_kind='final' THEN
  FOR c IN SELECT * FROM haven.operation_source_candidates(e.organization_id,e.facility_id,activity.id,subject.id,performed) LOOP
   n:=n+1; cands:=cands||to_jsonb(c.id); t:=c;
  END LOOP;
  IF p_select IS NOT NULL THEN
   IF NOT (cands ? p_select::text) THEN RAISE EXCEPTION 'Selected occurrence is not a candidate for this source record' USING ERRCODE='22023'; END IF;
   SELECT * INTO t FROM public.operation_task_instances WHERE id=p_select; n:=1;
  END IF;
  IF n=0 THEN v_state:='unmatched'; v_reason:='no_candidate'; v_detail:='No occurrence of this activity for this subject covers the performed date'; v_attention:=true;
  ELSIF n>1 THEN v_state:='ambiguous'; v_reason:='several_candidates'; v_detail:=n||' occurrences cover the performed date'; v_attention:=true; t:=NULL;
  ELSE
   IF p_actor IS NOT NULL THEN PERFORM haven.lock_operation_work_authority(t.id,NULL); END IF;
   SELECT * INTO t FROM public.operation_task_instances WHERE id=t.id;
   SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL FOR UPDATE;
   -- This record may already be the effective receipt of another occurrence (an earlier version covered another period): a record satisfies at
   -- most one occurrence, so that receipt is invalidated first and the new version satisfies here as a fresh chain.
   IF v_state IS NULL AND (perf.id IS NULL OR perf.source_key IS DISTINCT FROM e.source_key OR perf.source_record_id IS DISTINCT FROM e.source_record_id) THEN
    SELECT r.* INTO any_receipt FROM public.operation_execution_receipts r WHERE r.organization_id=e.organization_id AND r.source_key=e.source_key AND r.source_record_id=e.source_record_id
     AND r.receipt_kind='performance' AND r.superseded_by_receipt_id IS NULL AND r.task_instance_id<>t.id;
    IF any_receipt.id IS NOT NULL THEN
     IF perf.id IS NOT NULL THEN
      v_state:='conflict'; v_reason:='already_recorded'; v_detail:='Occurrence already carries a receipt from '||CASE WHEN perf.source_key IS NULL THEN 'a person' ELSE 'another source' END; v_attention:=true;
     ELSE
      -- The new version must be able to satisfy here before anything is moved: an invalid version strips nothing.
      w:=haven.operation_source_satisfy(e,snap,t,NULL,p_actor,true);
      IF w.reason IS NOT NULL THEN v_state:='refused'; v_reason:=w.reason; v_detail:=w.detail; v_attention:=(w.reason IN('recorder_not_authorized','recorder_not_current'));
      ELSE
       IF p_actor IS NOT NULL THEN PERFORM haven.lock_operation_work_authority(any_receipt.task_instance_id,NULL); END IF;
       SELECT * INTO moved FROM public.operation_task_instances WHERE id=any_receipt.task_instance_id FOR UPDATE;
       SELECT * INTO any_receipt FROM public.operation_execution_receipts WHERE id=any_receipt.id FOR UPDATE;
       w:=haven.operation_source_invalidate(e,snap,moved,any_receipt,p_actor,'Source record '||e.source_key||' '||e.source_record_id||' version '||any_receipt.source_record_version||' superseded by version '||e.source_record_version||' covering another occurrence');
       IF w.reason IS NOT NULL THEN v_state:='refused'; v_reason:=w.reason; v_detail:=w.detail; v_attention:=true; END IF;
       moved_receipt:=(w.receipt).id; w:=NULL;
      END IF;
     END IF;
    END IF;
   END IF;
   IF v_state IS NOT NULL THEN NULL;
   ELSIF perf.id IS NOT NULL AND (perf.source_key IS DISTINCT FROM e.source_key OR perf.source_record_id IS DISTINCT FROM e.source_record_id) THEN
    v_state:='conflict'; v_reason:='already_recorded'; v_detail:='Occurrence already carries a receipt from '||CASE WHEN perf.source_key IS NULL THEN 'a person' ELSE 'another source' END; v_attention:=true;
   ELSIF perf.id IS NULL AND t.execution_state<>'none' THEN
    v_state:='conflict'; v_reason:='already_recorded'; v_detail:='Occurrence is not unrecorded'; v_attention:=true;
   ELSE
    w:=haven.operation_source_satisfy(e,snap,t,perf,p_actor);
    IF w.reason IS NOT NULL THEN v_state:='refused'; v_reason:=w.reason; v_detail:=w.detail; v_attention:=(w.reason IN('recorder_not_authorized','recorder_not_current'));
    ELSE v_state:=CASE WHEN perf.id IS NULL THEN 'satisfied' ELSE 'corrected' END; END IF;
   END IF;
  END IF;
 END IF;
 IF v_state IN('conflict','satisfied','corrected','invalidated') OR (v_state='refused' AND t.id IS NOT NULL AND e.event_kind='final' AND v_reason IN('recorder_not_authorized','recorder_not_current','statement_invalid','recorder_unknown')) THEN
  IF v_state IN('conflict','refused') THEN
   INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
   VALUES(t.organization_id,t.facility_id,t.id,'source_pending',t.status,t.status,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,v_detail,
    jsonb_build_object('source_event_id',e.id,'source_key',e.source_key,'source_record_id',e.source_record_id,'source_record_version',e.source_record_version,'state',v_state,'reason',v_reason,'current_receipt_id',perf.id));
  END IF;
 END IF;
 IF v_state='refused' AND v_reason IN('reader_missing','reader_failed','adapter_retired') THEN v_attention:=true; END IF;
 UPDATE public.operation_source_events SET state=v_state,attention=v_attention,reason=v_reason,detail=v_detail,candidates=cands,
  snapshot=coalesce(snapshot,CASE WHEN subject.id IS NOT NULL THEN snap.raw WHEN v_reason='facility_mismatch' THEN '{"redacted":true}'::jsonb ELSE haven.operation_source_redact(snap.raw) END),
  -- A resolved scope is never dropped from a row on a later refusal: whatever was stored under that authority stays under it.
  activity_id=coalesce(activity.id,activity_id),subject_id=coalesce(subject.id,subject_id),authority_class=coalesce(CASE WHEN subject.id IS NULL THEN NULL ELSE class END,authority_class),
  task_instance_id=CASE WHEN v_state IN('conflict','satisfied','corrected','invalidated') OR (t.id IS NOT NULL AND v_state='refused') THEN t.id END,
  receipt_id=(w.receipt).id
 WHERE id=e.id RETURNING * INTO e;
 IF moved_receipt IS NOT NULL AND e.state IN('satisfied','corrected') THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(e.organization_id,e.facility_id,e.task_instance_id,'source_linked',NULL,NULL,p_actor,CASE WHEN p_actor IS NULL THEN 'service' ELSE haven.app_role()::text END,'Earlier version invalidated on another occurrence',
   jsonb_build_object('source_event_id',e.id,'moved_from_task_instance_id',moved.id,'moved_reversal_receipt_id',moved_receipt,'receipt_id',e.receipt_id));
 END IF;
 IF p_actor IS NOT NULL AND t.id IS NOT NULL AND e.state IN('satisfied','corrected','invalidated') THEN PERFORM haven.lock_operation_work_authority(t.id,NULL); END IF;
 RETURN haven.operation_source_reply_for(e,false);
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_settle(uuid,haven.operation_source_snapshot,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Deliver (session or service).
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.deliver_operation_source_event(p_org uuid,p_actor uuid,p_delivery_kind text,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; src text; rec text; ver text; kind text; facility uuid; adapter public.operation_source_adapters; canonical jsonb; hash text; existing public.operation_source_events;
 snap haven.operation_source_snapshot; e public.operation_source_events; reply jsonb;
BEGIN
 -- A session delivery is the current managed actor in their own organisation; a service delivery names the organisation and has no actor.
 IF p_delivery_kind='session' THEN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR NOT EXISTS(SELECT 1 FROM haven.current_authorized_actor() x WHERE x.actor_is_managed) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  p_org:=haven.organization_id();
 ELSIF p_actor IS NOT NULL OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Source delivery by the service is a service command' USING ERRCODE='42501'; END IF;
 IF p_org IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Source delivery payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('source_key','source_record_id','source_record_version','event_kind','facility_id','organization_id') THEN RAISE EXCEPTION 'Source delivery field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 src:=p_payload->>'source_key'; rec:=p_payload->>'source_record_id'; ver:=p_payload->>'source_record_version'; kind:=p_payload->>'event_kind';
 IF src IS NULL OR src !~ '^[a-z][a-z0-9-]{0,63}$' THEN RAISE EXCEPTION 'source_key must be a slug' USING ERRCODE='22023'; END IF;
 IF rec IS NULL OR rec !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RAISE EXCEPTION 'source_record_id must be a stable identifier' USING ERRCODE='22023'; END IF;
 IF ver IS NULL OR ver !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' THEN RAISE EXCEPTION 'source_record_version must be a stable identifier' USING ERRCODE='22023'; END IF;
 IF kind IS NULL OR kind NOT IN('final','voided') THEN RAISE EXCEPTION 'event_kind must be final or voided' USING ERRCODE='22023'; END IF;
 BEGIN facility:=(p_payload->>'facility_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'facility_id must be a uuid' USING ERRCODE='22023'; END;
 IF facility IS NULL THEN RAISE EXCEPTION 'facility_id is required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'organization_id' AND nullif(p_payload->>'organization_id','')::uuid IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'organization_id does not match the caller' USING ERRCODE='22023'; END IF;
 SELECT * INTO adapter FROM public.operation_source_adapters WHERE organization_id=p_org AND source_key=src;
 IF NOT FOUND OR adapter.status<>'registered' THEN RAISE EXCEPTION 'Source adapter is not allowlisted' USING ERRCODE='22023'; END IF;
 -- The deliverer must currently hold the site and, for a protected subject kind, that domain's recording scope, before the source is read at all.
 IF p_actor IS NOT NULL THEN
  IF NOT haven.operation_domain_access(p_org,facility,haven.operation_source_class(adapter.subject_kind)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM 1 FROM public.facilities WHERE id=facility AND organization_id=p_org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 -- One source record at a time across every version, kind and deliverer.
 PERFORM pg_advisory_xact_lock(hashtext('operation_source:'||p_org::text||':'||src||':'||rec));
 canonical:=jsonb_build_object('source_key',src,'source_record_id',rec,'source_record_version',ver,'event_kind',kind,'facility_id',facility);
 hash:=encode(sha256(convert_to(jsonb_build_object('organization',p_org,'deliverer',coalesce(p_actor::text,'service'),'payload',canonical)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_source_events WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=hash AND existing.delivered_by IS NOT DISTINCT FROM p_actor THEN
   IF p_actor IS NOT NULL AND NOT haven.operation_source_event_readable(existing) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
   RETURN haven.operation_source_reply_for(existing,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 -- Convergence: the one live (non-refused) delivery of this version and kind, returned only to someone who may read it.
 SELECT * INTO existing FROM public.operation_source_events WHERE organization_id=p_org AND source_key=src AND source_record_id=rec AND source_record_version=ver AND event_kind=kind AND state<>'refused';
 IF FOUND THEN
  IF p_actor IS NOT NULL AND NOT haven.operation_source_event_readable(existing) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  RETURN haven.operation_source_reply_for(existing,true);
 END IF;
 snap:=haven.operation_source_read(adapter,rec);
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 PERFORM set_config('haven.operation_source_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_source_events(organization_id,facility_id,source_key,source_record_id,source_record_version,event_kind,delivery_kind,delivered_by,delivered_at,request_key,request_hash,state,attention,snapshot,revision)
  VALUES(p_org,facility,src,rec,ver,kind,p_delivery_kind,p_actor,clock_timestamp(),p_request_key,hash,'unmatched',true,NULL,haven.operation_occurrence_revision()) RETURNING * INTO e;
 EXCEPTION WHEN unique_violation THEN
  PERFORM set_config('haven.operation_occurrence_command','',true); PERFORM set_config('haven.operation_source_command','',true);
  SELECT * INTO existing FROM public.operation_source_events WHERE organization_id=p_org AND source_key=src AND source_record_id=rec AND source_record_version=ver AND event_kind=kind AND state<>'refused';
  IF FOUND THEN
   IF p_actor IS NOT NULL AND NOT haven.operation_source_event_readable(existing) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
   RETURN haven.operation_source_reply_for(existing,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 -- An earlier refused delivery of this version that still asks for attention is superseded by this attempt.
 UPDATE public.operation_source_events SET attention=false,detail=coalesce(detail,'')||' (superseded by a later delivery)'
  WHERE organization_id=p_org AND source_key=src AND source_record_id=rec AND source_record_version=ver AND event_kind=kind AND state='refused' AND attention AND id<>e.id;
 reply:=haven.operation_source_settle(e.id,snap,NULL,p_actor);
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM set_config('haven.operation_source_command','',true);
 RETURN reply;
END $$;

-- ---------------------------------------------------------------------------
-- Reconcile (session): retry the predicate against the live source, select
-- one of the current candidates, or dismiss with a reason. Every attempt is
-- an immutable row; the event's revision must be the one the actor read.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.reconcile_operation_source_event(p_event uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.operation_source_events; adapter public.operation_source_adapters; k text; action text; reason text; chosen uuid; hash text; a public.operation_source_event_attempts;
 snap haven.operation_source_snapshot; reply jsonb; from_state text; now_at timestamptz;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'An expected event revision is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Reconcile payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('action','occurrence_id','reason') THEN RAISE EXCEPTION 'Reconcile payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 action:=p_payload->>'action';
 IF action IS NULL OR action NOT IN('retry','select','dismiss') THEN RAISE EXCEPTION 'action must be retry, select or dismiss' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
 IF length(coalesce(reason,''))>2000 THEN RAISE EXCEPTION 'reason must be text of at most 2000 characters' USING ERRCODE='22023'; END IF;
 IF action='dismiss' AND reason IS NULL THEN RAISE EXCEPTION 'A dismiss reason is required' USING ERRCODE='22023'; END IF;
 BEGIN chosen:=nullif(p_payload->>'occurrence_id','')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'occurrence_id must be a uuid' USING ERRCODE='22023'; END;
 IF action='select' AND chosen IS NULL THEN RAISE EXCEPTION 'select requires occurrence_id' USING ERRCODE='22023'; END IF;
 IF action<>'select' AND chosen IS NOT NULL THEN RAISE EXCEPTION 'occurrence_id applies to select only' USING ERRCODE='22023'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 -- Lock order as delivery: the per-record advisory lock first, then the ledger row.
 SELECT * INTO e FROM public.operation_source_events WHERE id=p_event;
 IF NOT FOUND OR e.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source:'||e.organization_id::text||':'||e.source_key||':'||e.source_record_id));
 SELECT * INTO e FROM public.operation_source_events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(e.facility_id)
  OR haven.app_role()::text NOT IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator') THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
  WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=e.facility_id FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=auth.uid() AND facility_id=e.facility_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM haven.current_authorized_actor() x WHERE x.actor_is_managed) OR NOT haven.operation_facility_access(e.facility_id) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF e.subject_id IS NOT NULL AND NOT haven.operation_subject_accessible(e.subject_id,e.organization_id,e.facility_id,e.authority_class) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('event',p_event,'actor',auth.uid(),'expected_revision',p_expected_revision,'action',action,'occurrence_id',chosen,'reason',reason)::text,'UTF8')),'hex');
 SELECT * INTO a FROM public.operation_source_event_attempts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF a.request_hash=hash AND a.event_id=p_event AND a.actor_id=auth.uid() THEN RETURN haven.operation_source_reply_for(e,true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 IF e.revision<>p_expected_revision THEN RAISE EXCEPTION 'Event changed since it was read' USING ERRCODE='P0001',DETAIL='current_event_revision='||e.revision; END IF;
 IF NOT (e.state IN('unmatched','ambiguous','conflict') OR (e.state='refused' AND e.attention) OR (e.state='invalidated' AND action='dismiss')) THEN
  RAISE EXCEPTION 'Source delivery is settled' USING ERRCODE='P0001'; END IF;
 SELECT * INTO adapter FROM public.operation_source_adapters WHERE organization_id=e.organization_id AND source_key=e.source_key;
 from_state:=e.state; now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 PERFORM set_config('haven.operation_source_command',haven.operation_occurrence_token(),true);
 IF action='dismiss' THEN
  UPDATE public.operation_source_events SET state='dismissed',attention=false,reconciled_by=auth.uid(),reconciled_at=now_at WHERE id=e.id RETURNING * INTO e;
  reply:=haven.operation_source_reply_for(e,false);
 ELSE
  snap:=haven.operation_source_read(adapter,e.source_record_id);
  -- A reader that cannot answer now leaves the pending row exactly as it is; the attempt is not a settlement.
  IF NOT snap.ok AND snap.reason IN('reader_missing','reader_failed') THEN RAISE EXCEPTION 'Source reader unavailable: %',snap.detail USING ERRCODE='P0001'; END IF;
  reply:=haven.operation_source_settle(e.id,snap,chosen,auth.uid());
  UPDATE public.operation_source_events SET reconciled_by=auth.uid(),reconciled_at=now_at WHERE id=e.id RETURNING * INTO e;
  reply:=haven.operation_source_reply_for(e,false);
 END IF;
 INSERT INTO public.operation_source_event_attempts(event_id,seq,request_key,request_hash,actor_id,actor_role,at,action,reason,from_state,to_state,outcome)
 VALUES(e.id,(SELECT coalesce(max(seq),0)+1 FROM public.operation_source_event_attempts WHERE event_id=e.id),p_request_key,hash,auth.uid(),haven.app_role()::text,now_at,action,reason,from_state,e.state,
  jsonb_build_object('state',e.state,'reason',e.reason,'detail',e.detail,'attention',e.attention,'task_instance_id',e.task_instance_id,'receipt_id',e.receipt_id,'occurrence_id',chosen,
   'snapshot',CASE WHEN action='dismiss' THEN NULL WHEN e.subject_id IS NOT NULL THEN snap.raw ELSE haven.operation_source_redact(snap.raw) END));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM set_config('haven.operation_source_command','',true);
 IF NOT haven.operation_facility_access(e.facility_id) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN reply;
END $$;

-- ---------------------------------------------------------------------------
-- Wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.deliver_operation_source_event_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN haven.deliver_operation_source_event(NULL,auth.uid(),'session',p_request_key,p_payload);
END $$;
CREATE FUNCTION public.deliver_operation_source_event_service(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Source delivery by the service is a service command' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Source delivery payload must be an object' USING ERRCODE='22023'; END IF;
 BEGIN org:=nullif(p_payload->>'organization_id','')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'organization_id must be a uuid' USING ERRCODE='22023'; END;
 IF org IS NULL THEN RAISE EXCEPTION 'organization_id is required for a service delivery' USING ERRCODE='22023'; END IF;
 RETURN haven.deliver_operation_source_event(org,NULL,'service',p_request_key,p_payload);
END $$;
CREATE FUNCTION public.reconcile_operation_source_event_review(p_event uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reconcile_operation_source_event(p_event,p_request_key,p_expected_revision,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.deliver_operation_source_event(uuid,uuid,text,text,jsonb),haven.reconcile_operation_source_event(uuid,text,text,jsonb),
 public.deliver_operation_source_event_review(text,jsonb),public.deliver_operation_source_event_service(text,jsonb),public.reconcile_operation_source_event_review(uuid,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.deliver_operation_source_event(uuid,uuid,text,text,jsonb),haven.reconcile_operation_source_event(uuid,text,text,jsonb),
 public.deliver_operation_source_event_review(text,jsonb),public.reconcile_operation_source_event_review(uuid,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION haven.deliver_operation_source_event(uuid,uuid,text,text,jsonb),public.deliver_operation_source_event_service(text,jsonb) TO service_role;

-- This migration registers no adapter, no rule and no delivery; the replay probe asserts the same after it.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_source_adapters) OR EXISTS(SELECT 1 FROM public.operation_source_rules) OR EXISTS(SELECT 1 FROM public.operation_source_events)
  OR EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL) THEN
  RAISE EXCEPTION 'COL-147: the migration must not register a source or deliver anything';
 END IF;
END $$;

COMMENT ON TABLE public.operation_source_adapters IS 'COL-147: allowlisted source adapters, registered only by migration; each names the haven reader that returns the live state (existence, version, finality, site, activity, subject, author, recording instant, statement) of one source record.';
COMMENT ON TABLE public.operation_source_rules IS 'COL-147: the activities a source may satisfy. A reader naming any other activity is refused.';
COMMENT ON TABLE public.operation_source_events IS 'COL-147: immutable delivery ledger keyed on organisation, source, record, version and kind. Replay and concurrent delivery converge on one row; refusals and pending reconciliation are retained history.';
COMMENT ON TABLE public.operation_source_event_attempts IS 'COL-147: immutable reconcile attempts (retry, select, dismiss) with request key, actor and outcome.';
COMMENT ON COLUMN public.operation_execution_receipts.source_event_id IS 'COL-147: the delivery that wrote this receipt; with source_key, source_record_id and source_record_version it names the final source record and version behind the receipt.';
COMMENT ON FUNCTION haven.deliver_operation_source_event(uuid,uuid,text,text,jsonb) IS 'COL-147: deliver one final or voided source record version; reads the source live, matches activity, site, subject, period and rule, satisfies exactly one occurrence once (or corrects the earlier version, or invalidates), records every refusal, converges replays and concurrent deliveries.';
COMMENT ON FUNCTION haven.reconcile_operation_source_event(uuid,text,text,jsonb) IS 'COL-147: retry, select among current candidates or dismiss a pending delivery under current site authority and the expected revision; never widens the predicate.';
NOTIFY pgrst,'reload schema';
COMMIT;
