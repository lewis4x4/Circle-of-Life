BEGIN;

-- COL-142 / HFO-06: atomic, idempotent execution receipts. One click on a
-- managed occurrence produces one attributable, immutable receipt: the
-- recorder is the authenticated session, recorded-at is the server clock,
-- performed-at is the stated work instant (never in the future), the
-- performer defaults to the recorder and is explicit otherwise, late and
-- on-behalf entries carry a reason, values are validated against the
-- occurrence's own governing versions, and required evidence that is not
-- present leaves the occurrence performed-with-missing-evidence rather than
-- completed. The same request key and content return the one receipt; changed
-- content conflicts; a second differing attempt on a recorded occurrence
-- conflicts and names the current receipt. A minimal issue can be created in
-- the same transaction; HFO-14 owns the issue lifecycle. Legacy rows keep the
-- legacy completion command; managed occurrences are recorded only here.
-- This migration records no work, creates no issue, decides nothing about
-- Q10 (what allows an item to count as done) or Q12 (hands-on time), and
-- supplies no verified evidence (COL-143).

-- ---------------------------------------------------------------------------
-- Rule helpers: recorded values against the versioned input rules; required
-- evidence that applies to an outcome. No verified evidence exists before
-- COL-143, so every applicable rule is unmet here; the helper returns the
-- applicable rules so a later finalisation can subtract what it satisfies.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_receipt_values_problems(p_rules jsonb,p_values jsonb) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE problems text[]:='{}'; rule jsonb; k text; val jsonb; typ text;
BEGIN
 IF p_values IS NULL OR jsonb_typeof(p_values)<>'object' THEN RETURN ARRAY['values must be an object']; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_values) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_rules,'[]'::jsonb)) r WHERE r->>'key'=k) THEN problems:=array_append(problems,'value '||k||' is not a defined input'); END IF;
 END LOOP;
 FOR rule IN SELECT * FROM jsonb_array_elements(coalesce(p_rules,'[]'::jsonb)) LOOP
  k:=rule->>'key'; val:=p_values->k; typ:=rule->>'type';
  IF val IS NULL OR jsonb_typeof(val)='null' THEN
   IF coalesce((rule->>'required')::boolean,false) THEN problems:=array_append(problems,'input '||k||' is required'); END IF;
   CONTINUE;
  END IF;
  IF typ='number' THEN
   IF jsonb_typeof(val)<>'number' THEN problems:=array_append(problems,'input '||k||' must be a number');
   ELSIF rule ? 'min' AND (val#>>'{}')::numeric<(rule->>'min')::numeric THEN problems:=array_append(problems,'input '||k||' must be at least '||(rule->>'min'));
   ELSIF rule ? 'max' AND (val#>>'{}')::numeric>(rule->>'max')::numeric THEN problems:=array_append(problems,'input '||k||' must be at most '||(rule->>'max')); END IF;
  ELSIF typ='text' THEN
   IF jsonb_typeof(val)<>'string' OR length(btrim(val#>>'{}'))=0 OR length(val#>>'{}')>4000 THEN problems:=array_append(problems,'input '||k||' must be text of at most 4000 characters'); END IF;
  ELSIF typ='boolean' THEN
   IF jsonb_typeof(val)<>'boolean' THEN problems:=array_append(problems,'input '||k||' must be true or false'); END IF;
  ELSIF typ='choice' THEN
   IF jsonb_typeof(val)<>'string' OR NOT (coalesce(rule->'choices','[]'::jsonb) ? (val#>>'{}')) THEN problems:=array_append(problems,'input '||k||' must be one of the listed choices'); END IF;
  ELSIF typ='datetime' THEN
   IF jsonb_typeof(val)<>'string' OR (val#>>'{}') !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' OR haven.operation_occurrence_timestamp(val) IS NULL THEN problems:=array_append(problems,'input '||k||' must be a timestamp'); END IF;
  ELSE problems:=array_append(problems,'input '||k||' has an unknown type'); END IF;
 END LOOP;
 RETURN problems;
END $$;
CREATE FUNCTION haven.operation_receipt_missing_evidence(p_rules jsonb,p_outcome text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r->>'kind','label',r->>'label','min_count',(r->>'min_count')::int,'when',r->>'when') ORDER BY r->>'label'),'[]'::jsonb)
 FROM jsonb_array_elements(coalesce(p_rules,'[]'::jsonb)) r
 WHERE p_outcome<>'not_performed' AND (r->>'min_count')::numeric>=1
  AND (r->>'when'='always' OR (r->>'when'='on_success' AND p_outcome='performed') OR (r->>'when'='on_failure' AND p_outcome='failed'))
$$;
REVOKE ALL ON FUNCTION haven.operation_receipt_values_problems(jsonb,jsonb),haven.operation_receipt_missing_evidence(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Minimal issue identity (HFO-14 extends assignment, waiting, resolution and
-- reopening). Reporting a problem never performs the work.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 activity_id uuid NOT NULL,
 subject_id uuid NOT NULL REFERENCES public.operation_activity_subjects(id),
 authority_class text NOT NULL CHECK(authority_class IN('facility','resident','employee_personnel','employee_medical','asset','financial')),
 task_instance_id uuid REFERENCES public.operation_task_instances(id),
 receipt_id uuid,
 issue_kind text NOT NULL CHECK(issue_kind IN('problem','help_request','failed_result')),
 summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 2000),
 severity text NOT NULL DEFAULT 'normal' CHECK(severity IN('low','normal','high')),
 status text NOT NULL DEFAULT 'open' CHECK(status='open'),
 reported_by uuid NOT NULL REFERENCES public.user_profiles(id),
 reported_role text NOT NULL,
 reported_at timestamptz NOT NULL DEFAULT now(),
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id)
);
CREATE INDEX idx_operation_issues_task ON public.operation_issues(task_instance_id) WHERE task_instance_id IS NOT NULL;
CREATE INDEX idx_operation_issues_site ON public.operation_issues(organization_id,facility_id,status,reported_at);

-- ---------------------------------------------------------------------------
-- Execution receipts: immutable; one effective performance and one effective
-- verification per occurrence.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_execution_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 task_instance_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 activity_id uuid NOT NULL,
 subject_id uuid NOT NULL REFERENCES public.operation_activity_subjects(id),
 authority_class text NOT NULL CHECK(authority_class IN('facility','resident','employee_personnel','employee_medical','asset','financial')),
 requirement_version_id uuid NOT NULL REFERENCES public.operation_requirement_versions(id),
 facility_requirement_id uuid REFERENCES public.operation_facility_requirements(id),
 receipt_kind text NOT NULL CHECK(receipt_kind IN('performance','verification')),
 recorder_id uuid NOT NULL REFERENCES public.user_profiles(id),
 recorder_role text NOT NULL,
 recorded_at timestamptz NOT NULL,
 performed_at timestamptz NOT NULL,
 performer_kind text NOT NULL CHECK(performer_kind IN('self','other_staff','vendor','unknown_historical')),
 performer_user_id uuid REFERENCES public.user_profiles(id),
 performer_vendor_id uuid REFERENCES public.vendors(id),
 performer_label text CHECK(performer_label IS NULL OR length(btrim(performer_label)) BETWEEN 1 AND 200),
 entry_kind text NOT NULL CHECK(entry_kind IN('routine','late','on_behalf')),
 entry_reason text CHECK(entry_reason IS NULL OR length(btrim(entry_reason)) BETWEEN 1 AND 2000),
 outcome text CHECK(outcome IS NULL OR outcome IN('performed','failed','not_performed')),
 values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(values)='object'),
 note text CHECK(note IS NULL OR length(note)<=4000),
 evidence_status text NOT NULL CHECK(evidence_status IN('not_required','complete','missing')),
 missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(missing_evidence)='array'),
 completion_state text NOT NULL CHECK(completion_state IN('completed','performed_missing_evidence','awaiting_verification','failed','not_performed')),
 issue_id uuid REFERENCES public.operation_issues(id),
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 revision text NOT NULL,
 superseded_by_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK(performed_at<=recorded_at+interval '2 minutes'),
 CHECK((receipt_kind='performance' AND outcome IS NOT NULL) OR (receipt_kind='verification' AND outcome IS NULL AND performer_kind='self' AND entry_kind='routine' AND issue_id IS NULL)),
 CHECK(entry_kind='routine' OR entry_reason IS NOT NULL),
 CHECK((performer_kind='self' AND performer_user_id IS NULL AND performer_vendor_id IS NULL AND performer_label IS NULL)
  OR (performer_kind='other_staff' AND performer_user_id IS NOT NULL AND performer_vendor_id IS NULL AND performer_label IS NULL)
  OR (performer_kind='vendor' AND performer_vendor_id IS NOT NULL AND performer_user_id IS NULL AND performer_label IS NOT NULL)
  OR (performer_kind='unknown_historical' AND performer_user_id IS NULL AND performer_vendor_id IS NULL AND performer_label IS NOT NULL)),
 CHECK(performer_kind='self' OR entry_kind<>'routine'),
 CHECK(performer_kind<>'unknown_historical' OR entry_kind='late'),
 CHECK(outcome IS DISTINCT FROM 'failed' OR issue_id IS NOT NULL),
 CHECK(outcome IS DISTINCT FROM 'not_performed' OR entry_reason IS NOT NULL),
 CHECK((completion_state='failed')=(outcome='failed') AND (completion_state='not_performed')=(outcome='not_performed')),
 CHECK(completion_state<>'performed_missing_evidence' OR evidence_status='missing'),
 CHECK(completion_state NOT IN('completed','awaiting_verification') OR evidence_status<>'missing')
);
ALTER TABLE public.operation_issues ADD CONSTRAINT operation_issues_receipt_id_fkey FOREIGN KEY(receipt_id) REFERENCES public.operation_execution_receipts(id);
CREATE UNIQUE INDEX operation_receipt_effective_performance ON public.operation_execution_receipts(task_instance_id) WHERE receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
CREATE UNIQUE INDEX operation_receipt_effective_verification ON public.operation_execution_receipts(task_instance_id) WHERE receipt_kind='verification' AND superseded_by_receipt_id IS NULL;
CREATE INDEX idx_operation_execution_receipts_task ON public.operation_execution_receipts(task_instance_id,recorded_at);
CREATE INDEX idx_operation_execution_receipts_site ON public.operation_execution_receipts(organization_id,facility_id,activity_id,recorded_at);

ALTER TABLE public.operation_execution_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_execution_receipts,public.operation_issues FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_execution_receipts,public.operation_issues TO authenticated,service_role;
-- A receipt is readable exactly when its occurrence is (COL-133 subject boundary);
-- an issue without a task follows its subject's authority.
CREATE POLICY operation_execution_receipts_read ON public.operation_execution_receipts FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.operation_task_readable(task_instance_id));
CREATE POLICY operation_issues_read ON public.operation_issues FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND CASE WHEN task_instance_id IS NOT NULL THEN haven.operation_task_readable(task_instance_id)
  ELSE haven.operation_subject_accessible(subject_id,organization_id,facility_id,authority_class) END);
CREATE TRIGGER operation_execution_receipts_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_execution_receipts
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_issues_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_issues
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_execution_receipts_no_truncate BEFORE TRUNCATE ON public.operation_execution_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_issues_no_truncate BEFORE TRUNCATE ON public.operation_issues
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
-- Generic audit payloads of subject-bearing operations tables carry values,
-- notes and protected subject identifiers; the operations audit trail is the
-- readable history. Hidden from the generic audit read for these tables.
CREATE POLICY operation_receipt_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(
 table_name NOT IN('operation_execution_receipts','operation_issues','operation_activity_bindings','operation_occurrence_associations'));

CREATE FUNCTION haven.guard_operation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the receipt commands' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION haven.guard_operation_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issues are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the issue commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (OLD.receipt_id IS NOT NULL OR NEW.receipt_id IS NULL
  OR to_jsonb(NEW)-'receipt_id' IS DISTINCT FROM to_jsonb(OLD)-'receipt_id') THEN
  RAISE EXCEPTION 'Issue lifecycle commands arrive with HFO-14' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_receipt(),haven.guard_operation_issue() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_execution_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_execution_receipts
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_receipt();
CREATE TRIGGER operation_issue_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_issues
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_issue();

-- Lifecycle events the commands write.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_audit_log'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%event_type%';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.operation_audit_log DROP CONSTRAINT %I',c); END IF;
 ALTER TABLE public.operation_audit_log ADD CONSTRAINT operation_audit_log_event_type_check CHECK(event_type IN(
  'created','assigned','started','completed','missed','deferred','cancelled','escalated','verified','signed','updated','generated','associated','reconciled','recorded','issue_reported'));
END $$;

-- ---------------------------------------------------------------------------
-- Execution state on the occurrence. Legacy rows carry NULL; managed rows
-- start at none. Only the receipt commands move the performance columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_task_instances
 ADD COLUMN effective_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN verification_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN performed_at timestamptz,
 ADD COLUMN execution_state text CHECK(execution_state IS NULL OR execution_state IN('none','completed','performed_missing_evidence','awaiting_verification','failed','not_performed'));
ALTER TABLE public.operation_task_instances ADD CONSTRAINT operation_execution_shape CHECK(
 (occurrence_kind IS NULL AND execution_state IS NULL AND effective_receipt_id IS NULL AND verification_receipt_id IS NULL AND performed_at IS NULL)
 OR (occurrence_kind IS NOT NULL AND execution_state IS NOT NULL AND (execution_state<>'none' OR (effective_receipt_id IS NULL AND verification_receipt_id IS NULL AND performed_at IS NULL))));
CREATE INDEX idx_operation_task_instances_execution_state ON public.operation_task_instances(facility_id,execution_state) WHERE occurrence_kind IS NOT NULL;

-- The 340 identity guard keeps its body; managed rows additionally refuse any
-- change to the performance columns, and any status change other than the
-- ordinary start, unless a receipt or occurrence command holds the token.
CREATE OR REPLACE FUNCTION haven.guard_operation_occurrence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; b public.operation_activity_bindings;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.occurrence_kind IS NULL THEN RETURN NEW; END IF;
  IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the occurrence commands' USING ERRCODE='42501'; END IF;
  IF NEW.occurrence_kind='scheduled' AND NEW.period_key<>to_char(NEW.assigned_shift_date,'YYYY-MM-DD') THEN
   RAISE EXCEPTION 'Occurrence period key must be its occurrence date' USING ERRCODE='23514';
  END IF;
  IF NEW.occurrence_kind='event' AND NEW.period_key<>NEW.source_event_key||':'||NEW.source_event_id THEN
   RAISE EXCEPTION 'Event occurrence key must be its source event' USING ERRCODE='23514';
  END IF;
  IF NEW.occurrence_kind IN('scheduled','event') THEN
   SELECT * INTO activity FROM public.operation_activities WHERE id=NEW.activity_id;
   IF activity.subject_kind='facility' THEN
    IF NEW.binding_id IS NOT NULL THEN RAISE EXCEPTION 'Facility occurrences carry no binding' USING ERRCODE='23514'; END IF;
   ELSE
    SELECT * INTO b FROM public.operation_activity_bindings WHERE id=NEW.binding_id;
    IF NOT FOUND OR b.activity_id<>NEW.activity_id OR b.facility_id<>NEW.facility_id OR b.subject_id<>NEW.subject_id OR b.organization_id<>NEW.organization_id
     OR b.authority_class<>NEW.authority_class OR b.effective_from>NEW.governing_at OR (b.effective_to IS NOT NULL AND b.effective_to<=NEW.governing_at) THEN
     RAISE EXCEPTION 'Occurrence needs a binding covering its governing instant' USING ERRCODE='23514';
    END IF;
   END IF;
  END IF;
  -- COL-142: a managed occurrence starts with no execution.
  NEW.execution_state:='none'; NEW.effective_receipt_id:=NULL; NEW.verification_receipt_id:=NULL; NEW.performed_at:=NULL;
  NEW.occurrence_revision:=haven.operation_occurrence_revision();
  RETURN NEW;
 END IF;
 IF OLD.occurrence_kind IS NULL THEN
  IF NEW.occurrence_kind IS NOT NULL THEN RAISE EXCEPTION 'Legacy rows cannot acquire a managed identity' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.occurrence_kind,NEW.binding_id,NEW.period_key,NEW.period_start_date,NEW.period_end_date,NEW.governing_at,NEW.schedule_snapshot,NEW.source_event_key,NEW.source_event_id,NEW.source_event_at,NEW.request_key,NEW.request_hash,NEW.grace_ends_at,NEW.remind_at)
  IS DISTINCT FROM (OLD.occurrence_kind,OLD.binding_id,OLD.period_key,OLD.period_start_date,OLD.period_end_date,OLD.governing_at,OLD.schedule_snapshot,OLD.source_event_key,OLD.source_event_id,OLD.source_event_at,OLD.request_key,OLD.request_hash,OLD.grace_ends_at,OLD.remind_at) THEN
  RAISE EXCEPTION 'Occurrence identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN RAISE EXCEPTION 'Occurrence deadline is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.assigned_shift_date IS DISTINCT FROM OLD.assigned_shift_date OR NEW.assigned_shift IS DISTINCT FROM OLD.assigned_shift THEN
  RAISE EXCEPTION 'Occurrence identity is immutable' USING ERRCODE='23514';
 END IF;
 IF auth.uid() IS NULL AND NOT haven.operation_occurrence_approved() THEN
  RAISE EXCEPTION 'Managed occurrences change only through the occurrence commands' USING ERRCODE='42501';
 END IF;
 IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND (NOT haven.operation_occurrence_approved() OR NEW.status<>'cancelled') THEN
  RAISE EXCEPTION 'Managed occurrences are removed only after cancellation through the occurrence commands' USING ERRCODE='42501';
 END IF;
 -- COL-142: performance facts and status moves belong to the receipt commands.
 IF NOT haven.operation_occurrence_approved() THEN
  IF (NEW.effective_receipt_id,NEW.verification_receipt_id,NEW.performed_at,NEW.execution_state,NEW.completed_at,NEW.signed_by,NEW.signed_at,NEW.second_sign_by,NEW.second_signed_at,NEW.verified_by,NEW.verified_at,NEW.sla_met,NEW.completion_notes,NEW.completion_evidence_paths)
   IS DISTINCT FROM (OLD.effective_receipt_id,OLD.verification_receipt_id,OLD.performed_at,OLD.execution_state,OLD.completed_at,OLD.signed_by,OLD.signed_at,OLD.second_sign_by,OLD.second_signed_at,OLD.verified_by,OLD.verified_at,OLD.sla_met,OLD.completion_notes,OLD.completion_evidence_paths) THEN
   RAISE EXCEPTION 'Managed occurrences are recorded through the receipt commands' USING ERRCODE='42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='pending' AND NEW.status='in_progress') THEN
   RAISE EXCEPTION 'Managed occurrences are recorded through the receipt commands' USING ERRCODE='42501';
  END IF;
 END IF;
 NEW.occurrence_revision:=haven.operation_occurrence_revision();
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Recorder authority for a managed occurrence: the 337 locks and current
-- checks, with the recorder or reviewer list of the governing versions in
-- place of the legacy assignment gate. A NULL list locks authority only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.lock_operation_work_authority(p_task uuid,p_roles public.app_role[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; s public.operation_activity_subjects; linked public.operation_task_templates; actor record;
BEGIN
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF t.template_id IS NOT NULL THEN
  SELECT * INTO linked FROM public.operation_task_templates WHERE id=t.template_id FOR SHARE;
  IF linked.asset_ref IS NOT NULL THEN PERFORM 1 FROM public.facility_assets WHERE id=linked.asset_ref FOR SHARE; END IF;
  IF linked.vendor_booking_ref IS NOT NULL THEN
   PERFORM 1 FROM public.vendors WHERE id=linked.vendor_booking_ref FOR SHARE;
   PERFORM 1 FROM public.vendor_facilities WHERE vendor_id=linked.vendor_booking_ref AND facility_id=t.facility_id FOR SHARE;
  END IF;
 END IF;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 IF s.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=s.resident_id FOR SHARE;
 ELSIF s.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=s.employee_id FOR SHARE;
 ELSIF s.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=s.asset_id FOR SHARE; END IF;
 PERFORM 1 FROM public.facilities WHERE id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.employee_medical_access WHERE user_id=auth.uid() AND facility_id=t.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
  WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 SELECT * INTO actor FROM haven.current_authorized_actor();
 IF actor.actor_is_managed IS NOT TRUE OR NOT haven.operation_task_readable(p_task)
  OR NOT (t.authority_class IN('facility','asset') OR EXISTS(SELECT 1 FROM public.operation_subject_access g WHERE g.user_id=auth.uid() AND g.organization_id=t.organization_id
   AND g.facility_id=t.facility_id AND g.scope=t.authority_class AND g.can_record AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))
  OR (t.authority_class='resident' AND haven.app_role()::text NOT IN('owner','org_admin','facility_admin','nurse'))
  OR (p_roles IS NOT NULL AND NOT (haven.app_role()=ANY(p_roles))) THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_work_authority(uuid,public.app_role[]) FROM PUBLIC,anon,authenticated,service_role;

-- The 337 authority guard keeps its 340 body; a managed row updated under an
-- approved command has already had its authority locked by that command with
-- the governing recorder list, so the legacy assignment gate is not re-run.
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
-- Record work (session). Validates the request, locks current authority,
-- validates values and evidence against the occurrence's own governing
-- versions, and persists receipt, issue, occurrence state and audit together.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_receipt_reply(r public.operation_execution_receipts,t public.operation_task_instances,i public.operation_issues,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('receipt',to_jsonb(r),'occurrence',jsonb_build_object('id',t.id,'status',t.status,'execution_state',t.execution_state,'occurrence_revision',t.occurrence_revision,'performed_at',t.performed_at),
  'issue',CASE WHEN i.id IS NULL THEN NULL ELSE to_jsonb(i) END,'replayed',p_replayed)
$$;
REVOKE ALL ON FUNCTION haven.operation_receipt_reply(public.operation_execution_receipts,public.operation_task_instances,public.operation_issues,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.operation_issue_payload_problem(p_issue jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_issue IS NULL OR jsonb_typeof(p_issue)<>'object' THEN RETURN 'issue must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_issue) LOOP
  IF k NOT IN('kind','summary','severity') THEN RETURN 'issue field is not editable'; END IF;
 END LOOP;
 IF p_issue ? 'kind' AND (jsonb_typeof(p_issue->'kind')<>'string' OR (p_issue->>'kind') NOT IN('problem','help_request','failed_result')) THEN RETURN 'issue kind must be problem, help_request or failed_result'; END IF;
 IF jsonb_typeof(p_issue->'summary') IS DISTINCT FROM 'string' OR length(btrim(p_issue->>'summary'))=0 OR length(p_issue->>'summary')>2000 THEN RETURN 'issue summary must be text of at most 2000 characters'; END IF;
 IF p_issue ? 'severity' AND jsonb_typeof(p_issue->'severity')<>'null' AND (jsonb_typeof(p_issue->'severity')<>'string' OR (p_issue->>'severity') NOT IN('low','normal','high')) THEN RETURN 'issue severity must be low, normal or high'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.operation_issue_payload_problem(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.record_operation_work(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; k text; now_at timestamptz;
 performed timestamptz; performer jsonb; performer_kind text; performer_user uuid; performer_vendor uuid; performer_label text; vendor_name text;
 entry text; reason text; outcome text; vals jsonb; note text; issue_in jsonb; problem text; roles public.app_role[]; problems text[]; missing jsonb;
 state text; evidence text; canonical jsonb; request_hash text; existing public.operation_execution_receipts; r public.operation_execution_receipts;
 i public.operation_issues; event text; new_status text;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Record payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('performed_at','performer','entry_kind','entry_reason','outcome','values','note','issue') THEN RAISE EXCEPTION 'Record payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 outcome:=p_payload->>'outcome';
 IF outcome IS NULL OR outcome NOT IN('performed','failed','not_performed') THEN RAISE EXCEPTION 'outcome must be performed, failed or not_performed' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'performed_at' AND jsonb_typeof(p_payload->'performed_at')<>'null' AND haven.operation_occurrence_timestamp(p_payload->'performed_at') IS NULL THEN
  RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 performer:=coalesce(nullif(p_payload->'performer','null'::jsonb),'{"kind":"self"}'::jsonb);
 IF jsonb_typeof(performer)<>'object' THEN RAISE EXCEPTION 'performer must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(performer) LOOP
  IF k NOT IN('kind','user_id','vendor_id','label') THEN RAISE EXCEPTION 'performer field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 performer_kind:=coalesce(performer->>'kind','self');
 IF performer_kind NOT IN('self','other_staff','vendor','unknown_historical') THEN RAISE EXCEPTION 'performer kind must be self, other_staff, vendor or unknown_historical' USING ERRCODE='22023'; END IF;
 BEGIN
  performer_user:=nullif(performer->>'user_id','')::uuid; performer_vendor:=nullif(performer->>'vendor_id','')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'performer identifiers must be uuids' USING ERRCODE='22023'; END;
 performer_label:=nullif(btrim(coalesce(performer->>'label','')),'');
 IF length(coalesce(performer_label,''))>200 THEN RAISE EXCEPTION 'performer label must be at most 200 characters' USING ERRCODE='22023'; END IF;
 entry:=coalesce(p_payload->>'entry_kind','routine');
 IF entry NOT IN('routine','late','on_behalf') THEN RAISE EXCEPTION 'entry_kind must be routine, late or on_behalf' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(coalesce(p_payload->>'entry_reason','')),'');
 IF length(coalesce(reason,''))>2000 THEN RAISE EXCEPTION 'entry_reason must be at most 2000 characters' USING ERRCODE='22023'; END IF;
 vals:=coalesce(nullif(p_payload->'values','null'::jsonb),'{}'::jsonb);
 IF jsonb_typeof(vals)<>'object' THEN RAISE EXCEPTION 'values must be an object' USING ERRCODE='22023'; END IF;
 note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF length(coalesce(note,''))>4000 THEN RAISE EXCEPTION 'note must be text of at most 4000 characters' USING ERRCODE='22023'; END IF;
 issue_in:=nullif(p_payload->'issue','null'::jsonb);
 IF issue_in IS NOT NULL THEN
  problem:=haven.operation_issue_payload_problem(issue_in);
  IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 END IF;
 IF outcome='failed' AND issue_in IS NULL THEN RAISE EXCEPTION 'A failed outcome requires an issue' USING ERRCODE='22023'; END IF;
 IF outcome='not_performed' AND reason IS NULL THEN RAISE EXCEPTION 'not_performed requires entry_reason' USING ERRCODE='22023'; END IF;
 -- Current authority first: the occurrence, its subject, the actor's grants
 -- and session are locked and the actor must hold recording authority
 -- (COL-133); the recorder list of the governing versions is checked after
 -- the replay lookup so a replay stays idempotent when validation drifts.
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
 -- The fingerprint covers the payload as sent with defaults applied, except the
 -- performed instant, which stays as supplied so a replay of a default-now
 -- request still matches.
 canonical:=jsonb_build_object('performed_at',p_payload->'performed_at','performer',jsonb_build_object('kind',performer_kind,'user_id',performer_user,'vendor_id',performer_vendor,'label',performer->>'label'),
  'entry_kind',entry,'entry_reason',reason,'outcome',outcome,'values',vals,'note',note,'issue',issue_in);
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',canonical)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task THEN
   SELECT * INTO i FROM public.operation_issues WHERE id=existing.issue_id;
   RETURN haven.operation_receipt_reply(existing,t,i,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
 IF FOUND THEN RAISE EXCEPTION 'Work is already recorded for this occurrence' USING ERRCODE='23505',DETAIL='current_receipt_id='||existing.id; END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 IF t.status NOT IN('pending','in_progress','missed','deferred') OR t.execution_state<>'none' THEN RAISE EXCEPTION 'Occurrence cannot be recorded from this state' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 now_at:=clock_timestamp();
 performed:=coalesce(haven.operation_occurrence_timestamp(p_payload->'performed_at'),now_at);
 IF performed>now_at+interval '2 minutes' THEN RAISE EXCEPTION 'Performed time cannot be in the future' USING ERRCODE='22023'; END IF;
 IF performed<now_at-interval '15 minutes' AND entry<>'late' THEN RAISE EXCEPTION 'Work performed earlier than fifteen minutes ago must be entered as late with a reason' USING ERRCODE='22023'; END IF;
 IF performer_kind<>'self' AND entry='routine' THEN RAISE EXCEPTION 'Work performed by someone else must be entered on behalf with a reason' USING ERRCODE='22023'; END IF;
 IF entry<>'routine' AND reason IS NULL THEN RAISE EXCEPTION 'entry_reason is required for late or on-behalf entries' USING ERRCODE='22023'; END IF;
 IF performer_kind='unknown_historical' AND entry<>'late' THEN RAISE EXCEPTION 'An unknown historical performer requires a late entry' USING ERRCODE='22023'; END IF;
 IF performer_kind IN('self','other_staff') AND performer_label IS NOT NULL THEN RAISE EXCEPTION 'A staff performer carries no label' USING ERRCODE='22023'; END IF;
 IF performer_kind='self' THEN
  IF performer_user IS NOT NULL OR performer_vendor IS NOT NULL THEN RAISE EXCEPTION 'A self performer carries no identifier' USING ERRCODE='22023'; END IF;
 ELSIF performer_kind='other_staff' THEN
  IF performer_user IS NULL OR performer_vendor IS NOT NULL THEN RAISE EXCEPTION 'other_staff requires user_id' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.user_profiles p JOIN public.user_facility_access g ON g.user_id=p.id AND g.facility_id=t.facility_id AND g.revoked_at IS NULL
   AND (g.operation_expires_at IS NULL OR g.operation_expires_at>now_at)
   WHERE p.id=performer_user AND p.organization_id=t.organization_id AND p.is_active AND p.deleted_at IS NULL FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 ELSIF performer_kind='vendor' THEN
  IF performer_vendor IS NULL OR performer_user IS NOT NULL THEN RAISE EXCEPTION 'vendor requires vendor_id' USING ERRCODE='22023'; END IF;
  SELECT vv.name INTO vendor_name FROM public.vendors vv JOIN public.vendor_facilities vf ON vf.vendor_id=vv.id AND vf.facility_id=t.facility_id AND vf.deleted_at IS NULL
   WHERE vv.id=performer_vendor AND vv.organization_id=t.organization_id AND vv.deleted_at IS NULL FOR SHARE OF vv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Performer vendor is not linked to this site' USING ERRCODE='22023'; END IF;
  performer_label:=coalesce(performer_label,left(vendor_name,200));
 ELSE
  IF performer_user IS NOT NULL OR performer_vendor IS NOT NULL OR performer_label IS NULL THEN RAISE EXCEPTION 'An unknown historical performer requires a label and no identifier' USING ERRCODE='22023'; END IF;
 END IF;
 -- Values and evidence against the occurrence's own governing versions.
 problems:=haven.operation_receipt_values_problems(coalesce(fr.local_required_inputs,v.required_inputs),vals);
 IF coalesce(cardinality(problems),0)>0 THEN RAISE EXCEPTION 'Recorded values are invalid: %',problems[1] USING ERRCODE='22023'; END IF;
 missing:=haven.operation_receipt_missing_evidence(coalesce(fr.local_required_evidence,v.required_evidence),outcome);
 evidence:=CASE WHEN jsonb_array_length(missing)=0 THEN 'not_required' ELSE 'missing' END;
 state:=CASE WHEN outcome='failed' THEN 'failed' WHEN outcome='not_performed' THEN 'not_performed' WHEN evidence='missing' THEN 'performed_missing_evidence'
  WHEN v.review_required THEN 'awaiting_verification' ELSE 'completed' END;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  IF issue_in IS NOT NULL THEN
   INSERT INTO public.operation_issues(organization_id,facility_id,activity_id,subject_id,authority_class,task_instance_id,issue_kind,summary,severity,reported_by,reported_role,reported_at,request_key,request_hash)
   VALUES(t.organization_id,t.facility_id,t.activity_id,t.subject_id,t.authority_class,t.id,coalesce(issue_in->>'kind',CASE WHEN outcome='failed' THEN 'failed_result' ELSE 'problem' END),
    btrim(issue_in->>'summary'),coalesce(nullif(issue_in->>'severity',''),'normal'),auth.uid(),haven.app_role()::text,now_at,p_request_key||'|receipt',request_hash) RETURNING * INTO i;
  END IF;
  INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,performer_user_id,performer_vendor_id,performer_label,entry_kind,entry_reason,outcome,values,note,
   evidence_status,missing_evidence,completion_state,issue_id,request_key,request_hash,revision)
  VALUES(t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'performance',
   auth.uid(),haven.app_role()::text,now_at,performed,performer_kind,performer_user,performer_vendor,performer_label,entry,reason,outcome,vals,note,
   evidence,missing,state,i.id,p_request_key,request_hash,haven.operation_occurrence_revision()) RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  -- A concurrent commit won the occurrence or the key between our read and our insert.
  SELECT * INTO existing FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
  IF FOUND THEN RAISE EXCEPTION 'Work is already recorded for this occurrence' USING ERRCODE='23505',DETAIL='current_receipt_id='||existing.id; END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 IF i.id IS NOT NULL THEN UPDATE public.operation_issues SET receipt_id=r.id WHERE id=i.id RETURNING * INTO i; END IF;
 new_status:=CASE WHEN state='completed' THEN 'completed' ELSE 'in_progress' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state=state,effective_receipt_id=r.id,performed_at=performed,
  signed_by=auth.uid(),signed_at=now_at,
  completed_at=CASE WHEN state='completed' THEN now_at END,
  verified_by=CASE WHEN state='completed' THEN auth.uid() END,verified_at=CASE WHEN state='completed' THEN now_at END,
  sla_met=CASE WHEN t.due_at IS NULL THEN NULL ELSE performed<=coalesce(t.grace_ends_at,t.due_at) END,
  completion_notes=note,updated_at=now_at,updated_by=auth.uid()
 WHERE id=t.id;
 event:=CASE state WHEN 'completed' THEN 'completed' WHEN 'awaiting_verification' THEN 'signed' ELSE 'recorded' END;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,event,t.status,new_status,auth.uid(),haven.app_role()::text,note,
  jsonb_build_object('receipt_id',r.id,'completion_state',state,'outcome',outcome,'entry_kind',entry,'performer_kind',performer_kind,'performed_at',performed,'recorded_at',now_at,
   'evidence_status',evidence,'missing_evidence',missing,'issue_id',i.id,'request_key',p_request_key,'request_hash',request_hash,'receipt_version',1));
 IF i.id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'issue_reported',new_status,new_status,auth.uid(),haven.app_role()::text,i.summary,
   jsonb_build_object('issue_id',i.id,'issue_kind',i.issue_kind,'severity',i.severity,'receipt_id',r.id));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN haven.operation_receipt_reply(r,t,i,false);
END $$;

-- ---------------------------------------------------------------------------
-- Verify work (session): the independent review the rule requires.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.verify_operation_work(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; k text; note text; now_at timestamptz;
 perf public.operation_execution_receipts; existing public.operation_execution_receipts; r public.operation_execution_receipts; i public.operation_issues; request_hash text; missing jsonb;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Verification payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('decision','note') THEN RAISE EXCEPTION 'Verification payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_payload->>'decision' IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'decision must be verified' USING ERRCODE='22023'; END IF;
 note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF length(coalesce(note,''))>4000 THEN RAISE EXCEPTION 'note must be text of at most 4000 characters' USING ERRCODE='22023'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',jsonb_build_object('decision','verified','note',note))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task THEN RETURN haven.operation_receipt_reply(existing,t,NULL::public.operation_issues,true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 now_at:=clock_timestamp();
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL FOR SHARE;
 IF NOT FOUND OR t.execution_state<>'awaiting_verification' THEN RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
 IF auth.uid()=perf.recorder_id OR auth.uid() IS NOT DISTINCT FROM perf.performer_user_id THEN
  RAISE EXCEPTION 'A different authorized staff member must verify this task' USING ERRCODE='42501'; END IF;
 missing:=haven.operation_receipt_missing_evidence(coalesce(fr.local_required_evidence,v.required_evidence),perf.outcome);
 IF jsonb_array_length(missing)>0 THEN RAISE EXCEPTION 'Required evidence is missing' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,values,note,evidence_status,missing_evidence,completion_state,request_key,request_hash,revision)
  VALUES(t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'verification',
   auth.uid(),haven.app_role()::text,now_at,now_at,'self','routine',NULL,'{}'::jsonb,note,perf.evidence_status,'[]'::jsonb,'completed',p_request_key,request_hash,haven.operation_occurrence_revision())
  RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL) THEN
   RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 UPDATE public.operation_task_instances SET status='completed',execution_state='completed',verification_receipt_id=r.id,completed_at=now_at,
  second_sign_by=auth.uid(),second_signed_at=now_at,verified_by=auth.uid(),verified_at=now_at,updated_at=now_at,updated_by=auth.uid() WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'verified',t.status,'completed',auth.uid(),haven.app_role()::text,note,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'completion_state','completed','request_key',p_request_key,'request_hash',request_hash,'receipt_version',1)),
 (t.organization_id,t.facility_id,t.id,'completed',t.status,'completed',auth.uid(),haven.app_role()::text,NULL,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'independent_verification',true));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN haven.operation_receipt_reply(r,t,NULL::public.operation_issues,false);
END $$;

-- ---------------------------------------------------------------------------
-- Report an issue (session) without pretending the work was performed.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.report_operation_issue(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; roles public.app_role[]; f public.facilities; activity public.operation_activities; subject public.operation_activity_subjects; k text; problem text;
 task_id uuid; org uuid:=haven.organization_id(); class text; canonical jsonb; request_hash text; existing public.operation_issues; i public.operation_issues; now_at timestamptz;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Issue payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('task_instance_id','activity_id','facility_id','subject_id','kind','summary','severity') THEN RAISE EXCEPTION 'Issue payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 problem:=haven.operation_issue_payload_problem(p_payload-ARRAY['task_instance_id','activity_id','facility_id','subject_id']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 BEGIN task_id:=nullif(p_payload->>'task_instance_id','')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'task_instance_id must be a uuid' USING ERRCODE='22023'; END;
 now_at:=clock_timestamp();
 IF task_id IS NOT NULL THEN
  PERFORM haven.lock_operation_work_authority(task_id,NULL);
  SELECT * INTO t FROM public.operation_task_instances WHERE id=task_id;
  IF t.subject_id IS NULL OR t.authority_class='unclassified' OR t.activity_id IS NULL OR t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
  SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
  roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
  PERFORM haven.lock_operation_work_authority(task_id,roles);
  class:=t.authority_class;
 ELSE
  BEGIN
   PERFORM (p_payload->>'activity_id')::uuid,(p_payload->>'facility_id')::uuid,(p_payload->>'subject_id')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'activity_id, facility_id and subject_id are required uuids' USING ERRCODE='22023'; END;
  IF p_payload->>'activity_id' IS NULL OR p_payload->>'facility_id' IS NULL OR p_payload->>'subject_id' IS NULL THEN
   RAISE EXCEPTION 'activity_id, facility_id and subject_id are required uuids' USING ERRCODE='22023'; END IF;
  SELECT * INTO f FROM public.facilities WHERE id=(p_payload->>'facility_id')::uuid AND organization_id=org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  -- Site authority first; nothing about the activity or subject is disclosed before it.
  PERFORM haven.lock_operation_recorder(org,f.id);
  SELECT * INTO activity FROM public.operation_activities WHERE id=(p_payload->>'activity_id')::uuid AND organization_id=org AND (facility_id IS NULL OR facility_id=f.id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO subject FROM public.operation_activity_subjects WHERE id=(p_payload->>'subject_id')::uuid AND organization_id=org AND facility_id=f.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  IF activity.subject_kind IS NOT NULL AND subject.subject_kind<>activity.subject_kind THEN RAISE EXCEPTION 'Issue subject must match the activity subject' USING ERRCODE='22023'; END IF;
  class:=CASE subject.subject_kind WHEN 'employee' THEN 'employee_personnel' ELSE subject.subject_kind END;
  IF subject.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=subject.resident_id FOR SHARE;
  ELSIF subject.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=subject.employee_id FOR SHARE;
  ELSIF subject.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=subject.asset_id FOR SHARE; END IF;
  IF NOT haven.operation_subject_accessible(subject.id,org,f.id,class) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  t.organization_id:=org; t.facility_id:=f.id; t.activity_id:=activity.id; t.subject_id:=subject.id;
 END IF;
 canonical:=jsonb_build_object('task',task_id,'activity',t.activity_id,'facility',t.facility_id,'subject',t.subject_id,'kind',coalesce(p_payload->>'kind','problem'),
  'summary',btrim(p_payload->>'summary'),'severity',coalesce(nullif(p_payload->>'severity',''),'normal'));
 request_hash:=encode(sha256(convert_to(jsonb_build_object('recorder',auth.uid(),'payload',canonical)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_issues WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.reported_by=auth.uid() THEN RETURN jsonb_build_object('issue',to_jsonb(existing),'replayed',true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_issues(organization_id,facility_id,activity_id,subject_id,authority_class,task_instance_id,issue_kind,summary,severity,reported_by,reported_role,reported_at,request_key,request_hash)
  VALUES(t.organization_id,t.facility_id,t.activity_id,t.subject_id,class,task_id,coalesce(p_payload->>'kind','problem'),btrim(p_payload->>'summary'),coalesce(nullif(p_payload->>'severity',''),'normal'),
   auth.uid(),haven.app_role()::text,now_at,p_request_key,request_hash) RETURNING * INTO i;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 IF task_id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'issue_reported',t.status,t.status,auth.uid(),haven.app_role()::text,i.summary,jsonb_build_object('issue_id',i.id,'issue_kind',i.issue_kind,'severity',i.severity,'request_key',p_request_key));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 IF task_id IS NOT NULL THEN PERFORM haven.lock_operation_work_authority(task_id,roles); ELSE PERFORM haven.lock_operation_recorder(org,t.facility_id); END IF;
 RETURN jsonb_build_object('issue',to_jsonb(i),'replayed',false);
END $$;

-- ---------------------------------------------------------------------------
-- The 340 cancellation command keeps its body; an occurrence with recorded
-- work can no longer be cancelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.cancel_operation_occurrence(p_task uuid,p_reason text,p_request_key text,p_remove boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; reason text; replayed boolean:=false;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(coalesce(p_reason,'')),'');
 IF reason IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF t.deleted_at IS NOT NULL THEN
  -- A removed occurrence is invisible to the session; only the exact earlier
  -- request replays, under current site authority.
  IF t.occurrence_kind IS NOT NULL AND t.status='cancelled'
   AND EXISTS(SELECT 1 FROM public.operation_audit_log WHERE task_instance_id=t.id AND event_type='cancelled' AND event_data->>'request_key'=p_request_key AND actor_id=auth.uid()) THEN
   PERFORM haven.lock_operation_recorder(t.organization_id,t.facility_id);
   RETURN jsonb_build_object('task_id',t.id,'status',t.status,'replayed',true,'removed',true,'occurrence_revision',t.occurrence_revision);
  END IF;
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM haven.lock_operation_authority(p_task);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Only managed occurrences use this command' USING ERRCODE='22023'; END IF;
 -- COL-142: recorded work is never hidden by cancellation; corrections are HFO-08.
 IF t.execution_state<>'none' THEN RAISE EXCEPTION 'Occurrence has recorded work' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 IF t.status='cancelled' THEN
  IF NOT EXISTS(SELECT 1 FROM public.operation_audit_log WHERE task_instance_id=t.id AND event_type='cancelled' AND event_data->>'request_key'=p_request_key) THEN
   RAISE EXCEPTION 'Occurrence is already cancelled' USING ERRCODE='P0001'; END IF;
  replayed:=true;
 ELSE
  IF t.status NOT IN('pending','in_progress','missed','deferred') THEN RAISE EXCEPTION 'Occurrence cannot be cancelled from this state' USING ERRCODE='P0001'; END IF;
  UPDATE public.operation_task_instances SET status='cancelled',cancellation_reason=reason,updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'cancelled',t.status,'cancelled',auth.uid(),haven.app_role()::text,reason,jsonb_build_object('request_key',p_request_key,'source','occurrence-command'));
 END IF;
 IF p_remove AND t.deleted_at IS NULL THEN
  UPDATE public.operation_task_instances SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'updated','cancelled','cancelled',auth.uid(),haven.app_role()::text,'removed from views; identity retained',jsonb_build_object('request_key',p_request_key,'removed',true));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN jsonb_build_object('task_id',t.id,'status',t.status,'replayed',replayed,'removed',t.deleted_at IS NOT NULL,'occurrence_revision',t.occurrence_revision);
END $$;

-- ---------------------------------------------------------------------------
-- The legacy completion command keeps its 337 body; a managed occurrence is
-- refused there and recorded through the receipt command instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.complete_operation_task_review(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_notes text,p_evidence text[] DEFAULT '{}'
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  target text;
  finalizer uuid;
  v_current_role text;
  v_current_organization uuid;
BEGIN
  PERFORM haven.lock_operation_authority(p_task_id);
  IF p_actor_id IS DISTINCT FROM auth.uid() OR p_actor_role IS DISTINCT FROM haven.app_role()::text THEN
    RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  -- COL-142: managed occurrences are recorded through the receipt command.
  IF t.occurrence_kind IS NOT NULL THEN RAISE EXCEPTION 'Managed occurrences are recorded through the receipt command' USING ERRCODE='P0001'; END IF;
  SELECT profile.app_role::text,profile.organization_id
  INTO v_current_role,v_current_organization
  FROM public.user_profiles AS profile
  WHERE profile.id=p_actor_id AND profile.is_active AND profile.deleted_at IS NULL
  FOR SHARE;
  IF v_current_role IS NULL OR v_current_organization IS DISTINCT FROM t.organization_id
     OR v_current_role IS DISTINCT FROM p_actor_role
     OR (
       t.assigned_to=p_actor_id
       OR (t.assigned_to IS NULL AND t.assigned_role=v_current_role)
       OR v_current_role IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities AS facility
  WHERE facility.id=t.facility_id AND facility.organization_id=v_current_organization AND facility.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
  END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501';
    END IF;
  END IF;
  IF coalesce(cardinality(p_evidence),0)>0 THEN RAISE EXCEPTION 'Classified evidence command required' USING ERRCODE='42501'; END IF;
  IF t.status='completed' THEN RETURN 'completed'; END IF;
  IF t.status NOT IN('pending','in_progress','missed','deferred') THEN RAISE EXCEPTION 'Task cannot be completed from this state'; END IF;
  IF t.signed_by IS NOT NULL AND t.requires_dual_sign THEN
    IF t.signed_by=p_actor_id THEN RAISE EXCEPTION 'A different authorized staff member must verify this task'; END IF;
    target:='completed'; finalizer:=p_actor_id;
  ELSE
    target:=CASE WHEN t.requires_dual_sign THEN 'in_progress' ELSE 'completed' END;
    finalizer:=CASE WHEN t.requires_dual_sign THEN NULL ELSE p_actor_id END;
  END IF;
  UPDATE public.operation_task_instances SET status=target,signed_by=coalesce(t.signed_by,p_actor_id),
    signed_at=coalesce(t.signed_at,now()),second_sign_by=CASE WHEN t.requires_dual_sign THEN finalizer END,
    second_signed_at=CASE WHEN t.requires_dual_sign AND finalizer IS NOT NULL THEN now() END,
    completed_at=coalesce(t.completed_at,now()),
    completion_notes=CASE WHEN t.signed_by IS NULL THEN p_notes ELSE t.completion_notes END,
    completion_evidence_paths=CASE WHEN t.signed_by IS NULL THEN p_evidence ELSE t.completion_evidence_paths END,
    verified_by=finalizer,verified_at=CASE WHEN finalizer IS NOT NULL THEN now() END,
    sla_met=(t.due_at IS NULL OR t.due_at>=coalesce(t.completed_at,now())),updated_by=p_actor_id
  WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,target,p_actor_id,v_current_role,p_notes,
    jsonb_build_object('awaiting_second_verification',finalizer IS NULL,'independent_verification',t.signed_by IS NOT NULL));
  PERFORM haven.lock_operation_authority(p_task_id);
  RETURN CASE WHEN target='in_progress' THEN 'awaiting_verification' ELSE target END;
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_operation_work_review(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_operation_work(p_task,p_request_key,p_payload) $$;
CREATE FUNCTION public.verify_operation_work_review(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.verify_operation_work(p_task,p_request_key,p_payload) $$;
CREATE FUNCTION public.report_operation_issue_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.report_operation_issue(p_request_key,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.record_operation_work(uuid,text,jsonb),haven.verify_operation_work(uuid,text,jsonb),haven.report_operation_issue(text,jsonb),
 public.record_operation_work_review(uuid,text,jsonb),public.verify_operation_work_review(uuid,text,jsonb),public.report_operation_issue_review(text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.record_operation_work(uuid,text,jsonb),haven.verify_operation_work(uuid,text,jsonb),haven.report_operation_issue(text,jsonb),
 public.record_operation_work_review(uuid,text,jsonb),public.verify_operation_work_review(uuid,text,jsonb),public.report_operation_issue_review(text,jsonb)
 TO authenticated;

-- No receipt or issue exists before this migration is applied anywhere; the
-- replay probe asserts the same after it.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_execution_receipts) OR EXISTS(SELECT 1 FROM public.operation_issues) THEN
  RAISE EXCEPTION 'COL-142: a receipt or issue exists before the migration; repair before applying';
 END IF;
END $$;

COMMENT ON TABLE public.operation_execution_receipts IS 'COL-142: immutable execution receipts (performance and independent verification) for managed occurrences. Recorder is the session, recorded-at the server clock, performed-at the stated work instant; one effective performance receipt per occurrence; missing required evidence stays performed_missing_evidence, never completed.';
COMMENT ON TABLE public.operation_issues IS 'COL-142: minimal issue identity created with a receipt or reported on its own; always open here. HFO-14 owns assignment, waiting, resolution and reopening.';
COMMENT ON COLUMN public.operation_task_instances.execution_state IS 'COL-142: none, completed, performed_missing_evidence, awaiting_verification, failed or not_performed for managed occurrences; NULL for legacy rows. Only completed changes the status.';
COMMENT ON FUNCTION haven.record_operation_work(uuid,text,jsonb) IS 'COL-142: one attributable receipt per click under current authority; idempotent by request key and content; conflicts name the current receipt; never reports full completion with missing required evidence.';
NOTIFY pgrst,'reload schema';
COMMIT;
