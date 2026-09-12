BEGIN;

-- COL-139 / HFO-04: subject-scoped occurrences without duplicate or rewritten
-- history. An occurrence's identity is activity + site + typed subject +
-- canonical period (or source event, or a manual request), never the
-- template, version or configuration id and never the deadline. Explicit
-- effective-dated bindings enrol residents, employees and assets; registry
-- existence never does. Generation is a service command that expands one
-- evaluator period to the bound subjects, converges on the database-owned
-- identity, serialises per subject and reports conflicts instead of creating
-- a second active occurrence. Manual unscheduled work carries no invented
-- period or deadline, and early/late work is linked to a scheduled
-- occurrence only through an immutable audited association.
-- This migration binds no real subject, generates no occurrence, confirms no
-- schedule, delivers no reminder and records no performed work. Legacy rows
-- (occurrence_kind NULL) keep every existing path unchanged.

-- ---------------------------------------------------------------------------
-- Command approval token. A plain setting could be forged by any role that
-- can run set_config, so the commands set a per-transaction token derived
-- from a secret only the owner-run definer functions can read. No client or
-- service statement can mint, alter or remove a managed identity directly.
-- ---------------------------------------------------------------------------
CREATE TABLE haven.operation_command_secrets (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 secret text NOT NULL CHECK(length(secret)=64)
);
-- Built-in entropy only: no dependency on where pgcrypto lives on the hosted project.
INSERT INTO haven.operation_command_secrets(secret) VALUES(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||clock_timestamp()::text||pg_backend_pid()::text,'UTF8')),'hex'));
REVOKE ALL ON haven.operation_command_secrets FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.operation_occurrence_token() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(pg_current_xact_id()::text||':'||secret,'UTF8')),'hex') FROM haven.operation_command_secrets
$$;
REVOKE ALL ON FUNCTION haven.operation_occurrence_token() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.operation_occurrence_approved() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(nullif(current_setting('haven.operation_occurrence_command',true),'')=haven.operation_occurrence_token(),false)
$$;
REVOKE ALL ON FUNCTION haven.operation_occurrence_approved() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.operation_occurrence_revision() RETURNS text
LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(gen_random_uuid()::text||':'||clock_timestamp()::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION haven.operation_occurrence_revision() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.operation_schedule_rule_sha256(p_configuration uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(schedule_rule::text,'UTF8')),'hex') FROM public.operation_facility_requirements WHERE id=p_configuration AND schedule_rule IS NOT NULL
$$;
REVOKE ALL ON FUNCTION haven.operation_schedule_rule_sha256(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.operation_schedule_rule_sha256(uuid) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Explicit, effective-dated activity/site/subject bindings.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_activity_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 activity_id uuid NOT NULL,
 subject_id uuid NOT NULL REFERENCES public.operation_activity_subjects(id),
 authority_class text NOT NULL CHECK(authority_class IN('facility','resident','employee_personnel','employee_medical','asset','financial')),
 shift text CHECK(shift IN('day','evening','night')),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
 effective_from timestamptz NOT NULL,
 effective_to timestamptz,
 retired_by uuid REFERENCES public.user_profiles(id),
 retired_at timestamptz,
 retirement_reason text,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK(effective_to IS NULL OR effective_to>effective_from),
 CHECK((effective_to IS NULL AND retired_at IS NULL AND retirement_reason IS NULL AND retired_by IS NULL)
  OR (effective_to IS NOT NULL AND retired_at IS NOT NULL AND length(btrim(coalesce(retirement_reason,'')))>0))
);
CREATE UNIQUE INDEX operation_binding_open ON public.operation_activity_bindings(activity_id,subject_id,coalesce(shift,'all')) WHERE effective_to IS NULL;
CREATE INDEX idx_operation_activity_bindings_site ON public.operation_activity_bindings(organization_id,facility_id,activity_id,effective_from,effective_to);
CREATE INDEX idx_operation_activity_bindings_subject ON public.operation_activity_bindings(subject_id);
ALTER TABLE public.operation_activity_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_activity_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_activity_bindings TO authenticated,service_role;
-- A binding is subject data: visible only with current authority over its subject.
CREATE POLICY operation_activity_bindings_read ON public.operation_activity_bindings FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.operation_subject_accessible(subject_id,organization_id,facility_id,authority_class));
CREATE TRIGGER operation_activity_bindings_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_activity_bindings
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_activity_bindings_no_truncate BEFORE TRUNCATE ON public.operation_activity_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();

CREATE FUNCTION haven.operation_binding_class_fits(p_subject_kind text,p_class text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_subject_kind WHEN 'facility' THEN p_class IN('facility','financial') WHEN 'resident' THEN p_class='resident'
  WHEN 'employee' THEN p_class IN('employee_personnel','employee_medical') WHEN 'asset' THEN p_class='asset' ELSE false END
$$;
REVOKE ALL ON FUNCTION haven.operation_binding_class_fits(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.guard_operation_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; subject public.operation_activity_subjects;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bindings are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the binding commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' THEN
  IF to_jsonb(NEW)-ARRAY['effective_to','retired_by','retired_at','retirement_reason'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['effective_to','retired_by','retired_at','retirement_reason']
   OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL THEN
   RAISE EXCEPTION 'Binding identity is immutable; retirement closes it once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF jsonb_typeof(NEW.provenance->'source') IS DISTINCT FROM 'string' OR (NEW.provenance->>'source') NOT IN('admin_log','interview','facility_policy','regulator','other')
  OR jsonb_typeof(NEW.provenance->'reason') IS DISTINCT FROM 'string' OR length(btrim(NEW.provenance->>'reason'))=0 THEN
  RAISE EXCEPTION 'Binding provenance needs a source and a reason' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.facilities WHERE id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Binding site unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=NEW.activity_id AND organization_id=NEW.organization_id AND (facility_id IS NULL OR facility_id=NEW.facility_id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Binding activity unavailable' USING ERRCODE='23514'; END IF;
 IF activity.subject_kind IS NULL THEN RAISE EXCEPTION 'activity subject classification is required before enrolment' USING ERRCODE='22023'; END IF;
 IF activity.subject_kind='facility' THEN RAISE EXCEPTION 'Facility activities need no binding: the site configuration enrols the site' USING ERRCODE='22023'; END IF;
 SELECT * INTO subject FROM public.operation_activity_subjects WHERE id=NEW.subject_id AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Binding subject unavailable' USING ERRCODE='23514'; END IF;
 IF subject.subject_kind<>activity.subject_kind THEN RAISE EXCEPTION 'Binding subject must match the activity subject' USING ERRCODE='22023'; END IF;
 IF NOT haven.operation_binding_class_fits(subject.subject_kind,NEW.authority_class) THEN RAISE EXCEPTION 'Binding authority class does not fit the subject' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_binding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_activity_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_activity_bindings
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_binding();

-- ---------------------------------------------------------------------------
-- Managed occurrence identity on the existing instance master.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_task_instances
 ADD COLUMN occurrence_kind text CHECK(occurrence_kind IN('scheduled','event','manual')),
 ADD COLUMN binding_id uuid REFERENCES public.operation_activity_bindings(id),
 ADD COLUMN period_key text,
 ADD COLUMN period_start_date date,
 ADD COLUMN period_end_date date,
 ADD COLUMN governing_at timestamptz,
 ADD COLUMN grace_ends_at timestamptz,
 ADD COLUMN remind_at timestamptz,
 ADD COLUMN schedule_snapshot jsonb CHECK(schedule_snapshot IS NULL OR jsonb_typeof(schedule_snapshot)='object'),
 ADD COLUMN source_event_key text CHECK(source_event_key IS NULL OR source_event_key ~ '^[a-z][a-z0-9-]{0,63}$'),
 ADD COLUMN source_event_id text CHECK(source_event_id IS NULL OR source_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 ADD COLUMN source_event_at timestamptz,
 ADD COLUMN request_key text,
 ADD COLUMN request_hash text,
 ADD COLUMN occurrence_revision text;
ALTER TABLE public.operation_task_instances ADD CONSTRAINT operation_occurrence_shape CHECK(
 (occurrence_kind IS NULL AND binding_id IS NULL AND period_key IS NULL AND period_start_date IS NULL AND period_end_date IS NULL AND governing_at IS NULL
  AND grace_ends_at IS NULL AND remind_at IS NULL AND schedule_snapshot IS NULL AND source_event_key IS NULL AND source_event_id IS NULL AND source_event_at IS NULL
  AND request_key IS NULL AND request_hash IS NULL AND occurrence_revision IS NULL)
 OR (occurrence_kind IN('scheduled','event') AND period_key IS NOT NULL AND period_start_date IS NOT NULL AND period_end_date IS NOT NULL
  AND period_start_date<=assigned_shift_date AND assigned_shift_date<=period_end_date AND governing_at IS NOT NULL AND due_at IS NOT NULL
  AND (grace_ends_at IS NULL OR grace_ends_at>=due_at) AND schedule_snapshot IS NOT NULL AND requirement_version_id IS NOT NULL AND facility_requirement_id IS NOT NULL
  AND subject_id IS NOT NULL AND authority_class<>'unclassified' AND template_id IS NULL AND request_key IS NULL AND request_hash IS NULL AND occurrence_revision IS NOT NULL
  AND ((occurrence_kind='scheduled' AND source_event_key IS NULL AND source_event_id IS NULL AND source_event_at IS NULL)
   OR (occurrence_kind='event' AND source_event_key IS NOT NULL AND source_event_id IS NOT NULL AND source_event_at IS NOT NULL AND governing_at=source_event_at)))
 OR (occurrence_kind='manual' AND period_key IS NULL AND period_start_date IS NULL AND period_end_date IS NULL AND due_at IS NULL AND grace_ends_at IS NULL AND remind_at IS NULL
  AND governing_at IS NOT NULL AND request_key IS NOT NULL AND request_hash IS NOT NULL AND requirement_version_id IS NOT NULL AND subject_id IS NOT NULL
  AND authority_class<>'unclassified' AND template_id IS NULL AND binding_id IS NULL AND schedule_snapshot IS NOT NULL AND occurrence_revision IS NOT NULL
  AND source_event_key IS NULL AND source_event_id IS NULL AND source_event_at IS NULL));
-- The identity is retained across cancellation and soft deletion on purpose:
-- a replay can never recreate a period that was cancelled or removed.
CREATE UNIQUE INDEX operation_occurrence_identity ON public.operation_task_instances(activity_id,facility_id,subject_id,period_key,coalesce(assigned_shift,'all'))
 WHERE occurrence_kind IN('scheduled','event');
CREATE UNIQUE INDEX operation_occurrence_request_key ON public.operation_task_instances(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_operation_task_instances_binding ON public.operation_task_instances(binding_id) WHERE binding_id IS NOT NULL;
CREATE INDEX idx_operation_occurrence_subject_period ON public.operation_task_instances(activity_id,facility_id,subject_id,period_start_date,period_end_date) WHERE occurrence_kind='scheduled';

CREATE FUNCTION haven.guard_operation_occurrence() RETURNS trigger
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
 NEW.occurrence_revision:=haven.operation_occurrence_revision();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_occurrence() FROM PUBLIC,anon,authenticated,service_role;
-- Fires after the activity/snapshot binders and before zz_operation_current_authority.
CREATE TRIGGER operation_occurrence_identity BEFORE INSERT OR UPDATE ON public.operation_task_instances
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_occurrence();

-- ---------------------------------------------------------------------------
-- Immutable, audited association of manual work with a scheduled occurrence.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_occurrence_associations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 occurrence_task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),
 work_task_id uuid NOT NULL UNIQUE REFERENCES public.operation_task_instances(id),
 association_kind text NOT NULL CHECK(association_kind IN('early','late','unscheduled')),
 expected_revision text NOT NULL,
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(occurrence_task_id<>work_task_id)
);
CREATE INDEX idx_operation_occurrence_associations_occurrence ON public.operation_occurrence_associations(occurrence_task_id);
ALTER TABLE public.operation_occurrence_associations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_occurrence_associations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_occurrence_associations TO authenticated;
CREATE POLICY operation_occurrence_associations_read ON public.operation_occurrence_associations FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.operation_task_readable(occurrence_task_id) AND haven.operation_task_readable(work_task_id));
CREATE TRIGGER operation_occurrence_associations_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_occurrence_associations
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_occurrence_associations_no_truncate BEFORE TRUNCATE ON public.operation_occurrence_associations
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE FUNCTION haven.guard_operation_association() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Occurrence associations are immutable' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the association command' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_association() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_occurrence_association_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_occurrence_associations
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_association();

-- Lifecycle events the commands write.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_audit_log'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%event_type%';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.operation_audit_log DROP CONSTRAINT %I',c); END IF;
 ALTER TABLE public.operation_audit_log ADD CONSTRAINT operation_audit_log_event_type_check CHECK(event_type IN(
  'created','assigned','started','completed','missed','deferred','cancelled','escalated','verified','signed','updated','generated','associated','reconciled'));
END $$;

-- ---------------------------------------------------------------------------
-- Recorder lock for commands that have no task row yet: pin the actor's
-- profile, session and grants, then check current site authority.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.lock_operation_recorder(p_org uuid,p_facility uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record;
BEGIN
 IF auth.uid() IS NULL OR (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.facilities WHERE id=p_facility FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.employee_medical_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
  WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 SELECT * INTO actor FROM haven.current_authorized_actor();
 IF actor.actor_is_managed IS NOT TRUE OR haven.organization_id() IS DISTINCT FROM p_org OR NOT haven.operation_facility_access(p_facility) THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_recorder(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Binding commands (session).
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.enroll_operation_binding(p_activity uuid,p_facility uuid,p_subject uuid,p_authority_class text,p_shift text,p_provenance jsonb,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; subject public.operation_activity_subjects; row public.operation_activity_bindings; org uuid:=haven.organization_id();
BEGIN
 IF p_authority_class IS NULL OR p_authority_class NOT IN('facility','resident','employee_personnel','employee_medical','asset','financial') THEN
  RAISE EXCEPTION 'Binding authority class is invalid' USING ERRCODE='22023'; END IF;
 IF p_shift IS NOT NULL AND p_shift NOT IN('day','evening','night') THEN RAISE EXCEPTION 'Binding shift is invalid' USING ERRCODE='22023'; END IF;
 IF p_provenance IS NULL OR jsonb_typeof(p_provenance)<>'object' THEN RAISE EXCEPTION 'Binding provenance needs a source and a reason' USING ERRCODE='22023'; END IF;
 IF p_effective_from IS NULL THEN RAISE EXCEPTION 'effective time is required' USING ERRCODE='22023'; END IF;
 IF p_effective_from<clock_timestamp()-interval '1 day' THEN RAISE EXCEPTION 'effective time cannot rewrite history' USING ERRCODE='22023'; END IF;
 -- Site authority first: nothing about an activity or a subject is disclosed before it.
 PERFORM haven.assert_operation_requirement_actor(org,p_facility);
 SELECT * INTO activity FROM public.operation_activities WHERE id=p_activity AND organization_id=org AND (facility_id IS NULL OR facility_id=p_facility) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF activity.subject_kind IS NULL THEN RAISE EXCEPTION 'activity subject classification is required before enrolment' USING ERRCODE='22023'; END IF;
 IF activity.subject_kind='facility' THEN RAISE EXCEPTION 'Facility activities need no binding: the site configuration enrols the site' USING ERRCODE='22023'; END IF;
 SELECT * INTO subject FROM public.operation_activity_subjects WHERE id=p_subject AND organization_id=org AND facility_id=p_facility FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF subject.subject_kind<>activity.subject_kind THEN RAISE EXCEPTION 'Binding subject must match the activity subject' USING ERRCODE='22023'; END IF;
 IF NOT haven.operation_binding_class_fits(subject.subject_kind,p_authority_class) THEN RAISE EXCEPTION 'Binding authority class does not fit the subject' USING ERRCODE='22023'; END IF;
 -- Pin the native subject before the final authority check so a transfer or
 -- retirement cannot race the enrolment.
 IF subject.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=subject.resident_id FOR SHARE;
 ELSIF subject.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=subject.employee_id FOR SHARE;
 ELSIF subject.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=subject.asset_id FOR SHARE; END IF;
 IF NOT haven.operation_subject_accessible(p_subject,org,p_facility,p_authority_class) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_activity_bindings(organization_id,facility_id,activity_id,subject_id,authority_class,shift,provenance,effective_from,created_by)
  VALUES(org,p_facility,activity.id,p_subject,p_authority_class,p_shift,p_provenance,p_effective_from,auth.uid()) RETURNING * INTO row;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'An open binding already exists for this subject' USING ERRCODE='23505';
 END;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.assert_operation_requirement_actor(activity.organization_id,p_facility);
 RETURN to_jsonb(row);
END $$;

CREATE FUNCTION haven.retire_operation_binding(p_binding uuid,p_effective_to timestamptz,p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE row public.operation_activity_bindings; closes timestamptz:=coalesce(p_effective_to,clock_timestamp());
BEGIN
 SELECT * INTO row FROM public.operation_activity_bindings WHERE id=p_binding AND organization_id=haven.organization_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 -- Same wording whether the binding is missing or the actor lacks its site, so
 -- an in-organisation caller without the grant learns nothing about existence.
 BEGIN
  PERFORM haven.assert_operation_requirement_actor(row.organization_id,row.facility_id);
 EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END;
 IF row.effective_to IS NOT NULL THEN RAISE EXCEPTION 'Binding is already retired' USING ERRCODE='P0001'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'retirement reason is required' USING ERRCODE='22023'; END IF;
 IF closes<=row.effective_from THEN RAISE EXCEPTION 'retirement must follow the binding start' USING ERRCODE='22023'; END IF;
 IF closes<clock_timestamp()-interval '1 day' THEN RAISE EXCEPTION 'effective time cannot rewrite history' USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_activity_bindings SET effective_to=closes,retired_by=auth.uid(),retired_at=clock_timestamp(),retirement_reason=btrim(p_reason) WHERE id=row.id RETURNING * INTO row;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.assert_operation_requirement_actor(row.organization_id,row.facility_id);
 RETURN to_jsonb(row);
END $$;

-- ---------------------------------------------------------------------------
-- Generation (service). One configuration, one page of evaluator periods,
-- expanded to the bound subjects. Whole-call problems raise; per-item
-- outcomes are reported truthfully and never invented.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_occurrence_overlap(p_activity uuid,p_facility uuid,p_subject uuid,p_period_key text,p_shift text,p_start date,p_end date) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT id FROM public.operation_task_instances t
 WHERE t.activity_id=p_activity AND t.facility_id=p_facility AND t.subject_id=p_subject AND t.occurrence_kind='scheduled'
  AND t.deleted_at IS NULL AND t.status<>'cancelled' AND t.period_start_date<=p_end AND t.period_end_date>=p_start
  AND (t.period_key<>p_period_key OR t.assigned_shift IS DISTINCT FROM p_shift)
  AND NOT (t.assigned_shift IS NOT NULL AND p_shift IS NOT NULL AND t.assigned_shift<>p_shift)
 ORDER BY t.period_start_date,t.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION haven.operation_occurrence_overlap(uuid,uuid,uuid,text,text,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.operation_occurrence_timestamp(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value)<>'string' THEN RETURN NULL; END IF;
 RETURN (p_value#>>'{}')::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
REVOKE ALL ON FUNCTION haven.operation_occurrence_timestamp(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.generate_operation_occurrences(p_facility uuid,p_configuration uuid,p_occurrences jsonb,p_run jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 f public.facilities; fr public.operation_facility_requirements; v public.operation_requirement_versions; activity public.operation_activities;
 tz text; site_tz text; rule_hash text; run_id text; kind text; date_from date; date_to date; item jsonb; outcomes jsonb:='[]'::jsonb;
 counts jsonb:=jsonb_build_object('created',0,'existing',0,'conflict',0,'no_binding',0,'binding_not_current',0,'configuration_not_in_force',0,'invalid',0);
 occ_date date; p_start date; p_end date; due timestamptz; grace timestamptz; remind timestamptz; governing timestamptz; v_shift text; reason text;
 ev_key text; ev_id text; ev_at timestamptz; v_period_key text; local_start timestamptz; local_end timestamptz;
 candidate record; matched boolean; b public.operation_activity_bindings; subject public.operation_activity_subjects; existing uuid; new_id uuid; snapshot jsonb; recorder text;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Generation is a service command' USING ERRCODE='42501'; END IF;
 IF p_occurrences IS NULL OR jsonb_typeof(p_occurrences)<>'array' OR jsonb_array_length(p_occurrences)=0 OR jsonb_array_length(p_occurrences)>400 THEN
  RAISE EXCEPTION 'Generation needs 1 to 400 evaluator periods' USING ERRCODE='22023'; END IF;
 IF p_run IS NULL OR jsonb_typeof(p_run)<>'object' OR jsonb_typeof(p_run->'run_id') IS DISTINCT FROM 'string' OR length(btrim(p_run->>'run_id'))=0 OR length(p_run->>'run_id')>128 THEN
  RAISE EXCEPTION 'Generation run needs a run_id' USING ERRCODE='22023'; END IF;
 run_id:=p_run->>'run_id';
 IF p_run->>'evaluator_version' IS DISTINCT FROM 'hfo-evaluator/1' THEN RAISE EXCEPTION 'Generation run must name a supported evaluator version' USING ERRCODE='22023'; END IF;
 kind:=coalesce(p_run->>'occurrence_kind','scheduled');
 IF kind NOT IN('scheduled','event') THEN RAISE EXCEPTION 'Generation occurrence kind is invalid' USING ERRCODE='22023'; END IF;
 IF NOT haven.operation_schedule_date_valid(p_run->'date_from') OR NOT haven.operation_schedule_date_valid(p_run->'date_to') THEN
  RAISE EXCEPTION 'Generation range is invalid' USING ERRCODE='22023'; END IF;
 date_from:=(p_run->>'date_from')::date; date_to:=(p_run->>'date_to')::date;
 IF date_from>date_to OR date_to-date_from>=800 THEN RAISE EXCEPTION 'Generation range is invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO f FROM public.facilities WHERE id=p_facility AND deleted_at IS NULL AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation site unavailable' USING ERRCODE='42501'; END IF;
 site_tz:=coalesce(f.timezone,'America/New_York');
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=p_configuration AND facility_id=p_facility AND organization_id=f.organization_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation configuration unavailable' USING ERRCODE='42501'; END IF;
 IF fr.status<>'published' OR fr.applicability<>'applicable' OR fr.schedule_status<>'confirmed' OR fr.schedule_rule IS NULL OR fr.requirement_version_id IS NULL
  OR NOT haven.operation_schedule_rule_valid(fr.schedule_rule) THEN
  RAISE EXCEPTION 'Generation requires a published, applicable configuration with a confirmed valid schedule' USING ERRCODE='22023'; END IF;
 IF NOT (p_run ? 'rule') OR jsonb_typeof(p_run->'rule')<>'object' THEN RAISE EXCEPTION 'Generation run must carry the evaluated rule' USING ERRCODE='22023'; END IF;
 IF p_run->'rule' IS DISTINCT FROM fr.schedule_rule THEN RAISE EXCEPTION 'Generation rule does not match the stored schedule rule' USING ERRCODE='22023'; END IF;
 rule_hash:=encode(sha256(convert_to(fr.schedule_rule::text,'UTF8')),'hex');
 IF p_run ? 'rule_sha256' AND p_run->>'rule_sha256' IS DISTINCT FROM rule_hash THEN RAISE EXCEPTION 'Generation rule hash does not match the stored schedule rule' USING ERRCODE='22023'; END IF;
 IF (kind='event') IS DISTINCT FROM (fr.schedule_rule->'recurrence'->>'kind'='event') THEN RAISE EXCEPTION 'Generation occurrence kind does not match the rule' USING ERRCODE='22023'; END IF;
 tz:=fr.schedule_rule->>'timezone';
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=fr.requirement_version_id AND status='published' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Generation configuration unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=fr.activity_id FOR SHARE;
 IF activity.subject_kind IS NULL THEN RAISE EXCEPTION 'activity subject classification is required before generation' USING ERRCODE='22023'; END IF;
 recorder:=coalesce(fr.owner_role::text,(SELECT r::text FROM unnest(coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles)) r LIMIT 1));
 -- The site itself is the subject of a facility-kind activity; its subject row
 -- is created on demand (as 337 did) because the configuration enrols the site.
 IF activity.subject_kind='facility' THEN
  INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind) VALUES(f.organization_id,p_facility,'facility')
  ON CONFLICT (facility_id) WHERE subject_kind='facility' DO NOTHING;
 END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 FOR item IN SELECT * FROM jsonb_array_elements(p_occurrences) LOOP
  reason:=NULL; v_shift:=NULL; ev_key:=NULL; ev_id:=NULL; ev_at:=NULL;
  IF jsonb_typeof(item)<>'object' THEN reason:='period must be an object';
  ELSIF NOT haven.operation_schedule_date_valid(item->'occurrence_date') THEN reason:='occurrence_date must be a calendar date';
  ELSIF NOT haven.operation_schedule_date_valid(item->'period'->'start_date') OR NOT haven.operation_schedule_date_valid(item->'period'->'end_date') THEN reason:='period must have calendar start and end dates';
  ELSIF haven.operation_occurrence_timestamp(item->'due_at') IS NULL THEN reason:='due_at must be a timestamp';
  ELSIF item ? 'grace_ends_at' AND jsonb_typeof(item->'grace_ends_at')<>'null' AND haven.operation_occurrence_timestamp(item->'grace_ends_at') IS NULL THEN reason:='grace_ends_at must be a timestamp';
  ELSIF item ? 'remind_at' AND jsonb_typeof(item->'remind_at')<>'null' AND haven.operation_occurrence_timestamp(item->'remind_at') IS NULL THEN reason:='remind_at must be a timestamp';
  ELSIF item->>'timezone' IS DISTINCT FROM tz THEN reason:='timezone must match the rule';
  ELSIF item ? 'shift' AND jsonb_typeof(item->'shift')<>'null' AND (jsonb_typeof(item->'shift')<>'string' OR (item->>'shift') NOT IN('day','evening','night')) THEN reason:='shift must be day, evening or night';
  ELSIF item ? 'adjustments' AND jsonb_typeof(item->'adjustments')<>'array' THEN reason:='adjustments must be a list';
  END IF;
  IF reason IS NULL THEN
   occ_date:=(item->>'occurrence_date')::date; p_start:=(item->'period'->>'start_date')::date; p_end:=(item->'period'->>'end_date')::date;
   due:=haven.operation_occurrence_timestamp(item->'due_at'); grace:=haven.operation_occurrence_timestamp(item->'grace_ends_at'); remind:=haven.operation_occurrence_timestamp(item->'remind_at');
   v_shift:=nullif(item->>'shift','');
   IF occ_date<date_from OR occ_date>date_to THEN reason:='occurrence_date lies outside the run range';
   ELSIF p_start>occ_date OR occ_date>p_end THEN reason:='period must contain the occurrence date';
   ELSIF grace IS NOT NULL AND grace<due THEN reason:='grace_ends_at must not precede due_at';
   END IF;
  END IF;
  IF reason IS NULL AND kind='event' THEN
   ev_key:=item->>'source_event_key'; ev_id:=item->>'source_event_id'; ev_at:=haven.operation_occurrence_timestamp(item->'source_event_at');
   IF ev_key IS NULL OR ev_key !~ '^[a-z][a-z0-9-]{0,63}$' OR ev_key IS DISTINCT FROM fr.schedule_rule->'recurrence'->>'event_key' THEN reason:='source_event_key must be the rule event';
   ELSIF ev_id IS NULL OR ev_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN reason:='source_event_id must be a stable identifier';
   ELSIF ev_at IS NULL THEN reason:='source_event_at must be a timestamp'; END IF;
  END IF;
  IF reason IS NOT NULL THEN
   outcomes:=outcomes||jsonb_build_object('occurrence_date',item->'occurrence_date','shift',item->'shift','outcome','invalid','reason',reason);
   counts:=jsonb_set(counts,'{invalid}',to_jsonb((counts->>'invalid')::int+1)); CONTINUE;
  END IF;
  governing:=CASE WHEN kind='event' THEN ev_at ELSE due END;
  v_period_key:=CASE WHEN kind='event' THEN ev_key||':'||ev_id ELSE to_char(occ_date,'YYYY-MM-DD') END;
  -- The governing instant chooses the versions; the 338 snapshot rule (in force
  -- on the occurrence's local day) is checked as well so no insert can fail.
  local_start:=(occ_date::timestamp) AT TIME ZONE site_tz; local_end:=((occ_date+1)::timestamp) AT TIME ZONE site_tz;
  IF NOT (fr.effective_from<=governing AND (fr.effective_to IS NULL OR fr.effective_to>governing))
   OR NOT (v.effective_from<=governing AND (v.effective_to IS NULL OR v.effective_to>governing))
   OR fr.effective_from>=local_end OR (fr.effective_to IS NOT NULL AND fr.effective_to<=local_start)
   OR v.effective_from>=local_end OR (v.effective_to IS NOT NULL AND v.effective_to<=local_start) THEN
   outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'outcome','configuration_not_in_force','governing_at',governing);
   counts:=jsonb_set(counts,'{configuration_not_in_force}',to_jsonb((counts->>'configuration_not_in_force')::int+1)); CONTINUE;
  END IF;
  snapshot:=jsonb_build_object('evaluator_version','hfo-evaluator/1','rule_version',1,'timezone',tz,'rule_sha256',rule_hash,'occurrence_date',to_char(occ_date,'YYYY-MM-DD'),
   'period',jsonb_build_object('start_date',to_char(p_start,'YYYY-MM-DD'),'end_date',to_char(p_end,'YYYY-MM-DD')),'due_at',due,'grace_ends_at',grace,'remind_at',remind,
   'adjustments',coalesce(item->'adjustments','[]'::jsonb),'run_id',run_id,'configuration_id',fr.id,'requirement_version_id',v.id);
  matched:=false;
  FOR candidate IN
   SELECT s.id AS subject_id,NULL::uuid AS binding_id,'facility'::text AS authority_class FROM public.operation_activity_subjects s
    WHERE activity.subject_kind='facility' AND s.facility_id=p_facility AND s.organization_id=f.organization_id AND s.subject_kind='facility'
   UNION ALL
   SELECT bd.subject_id,bd.id,bd.authority_class FROM public.operation_activity_bindings bd
    WHERE activity.subject_kind<>'facility' AND bd.activity_id=fr.activity_id AND bd.facility_id=p_facility AND bd.organization_id=f.organization_id
     AND bd.effective_from<=governing AND (bd.effective_to IS NULL OR bd.effective_to>governing) AND (bd.shift IS NULL OR bd.shift=v_shift)
   ORDER BY 2 NULLS FIRST,1
  LOOP
   matched:=true;
   -- Serialise the identity, then re-read the binding and the subject after
   -- the wait: a retirement or transfer committed meanwhile wins.
   PERFORM pg_advisory_xact_lock(hashtext(fr.activity_id::text||p_facility::text||candidate.subject_id::text));
   SELECT * INTO subject FROM public.operation_activity_subjects WHERE id=candidate.subject_id;
   IF subject.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=subject.resident_id FOR SHARE;
   ELSIF subject.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=subject.employee_id FOR SHARE;
   ELSIF subject.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=subject.asset_id FOR SHARE; END IF;
   IF candidate.binding_id IS NOT NULL THEN
    -- KEY SHARE waits behind an in-flight retirement and re-fetches the row.
    SELECT * INTO b FROM public.operation_activity_bindings WHERE id=candidate.binding_id FOR KEY SHARE;
    IF b.effective_from>governing OR (b.effective_to IS NOT NULL AND b.effective_to<=governing) THEN
     outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'subject_id',candidate.subject_id,'binding_id',candidate.binding_id,'outcome','no_binding','reason','binding retired before the governing instant');
     counts:=jsonb_set(counts,'{no_binding}',to_jsonb((counts->>'no_binding')::int+1)); CONTINUE;
    END IF;
   END IF;
   IF NOT haven.operation_subject_current(candidate.subject_id,f.organization_id,p_facility,candidate.authority_class) THEN
    outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'subject_id',candidate.subject_id,'binding_id',candidate.binding_id,'outcome','binding_not_current','reason','subject is no longer current');
    counts:=jsonb_set(counts,'{binding_not_current}',to_jsonb((counts->>'binding_not_current')::int+1)); CONTINUE;
   END IF;
   IF kind='scheduled' THEN
    existing:=haven.operation_occurrence_overlap(fr.activity_id,p_facility,candidate.subject_id,v_period_key,v_shift,p_start,p_end);
    IF existing IS NOT NULL THEN
     outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'subject_id',candidate.subject_id,'binding_id',candidate.binding_id,'outcome','conflict','conflict_task_id',existing,'reason','an active occurrence with an overlapping period already exists');
     counts:=jsonb_set(counts,'{conflict}',to_jsonb((counts->>'conflict')::int+1)); CONTINUE;
    END IF;
   END IF;
   new_id:=NULL;
   INSERT INTO public.operation_task_instances(organization_id,facility_id,activity_id,subject_id,authority_class,binding_id,template_name,template_category,template_cadence_type,
    assigned_shift_date,assigned_shift,assigned_role,status,priority,license_threatening,requires_dual_sign,due_at,grace_ends_at,remind_at,requirement_version_id,facility_requirement_id,
    governing_at,period_key,period_start_date,period_end_date,schedule_snapshot,occurrence_kind,source_event_key,source_event_id,source_event_at)
   VALUES(f.organization_id,p_facility,fr.activity_id,candidate.subject_id,candidate.authority_class,candidate.binding_id,coalesce(v.title,activity.name),'compliance','scheduled',
    occ_date,v_shift,recorder,'pending','normal',false,v.review_required,due,grace,remind,v.id,fr.id,
    governing,v_period_key,p_start,p_end,snapshot,kind,ev_key,ev_id,ev_at)
   ON CONFLICT (activity_id,facility_id,subject_id,period_key,(coalesce(assigned_shift,'all'))) WHERE occurrence_kind IN('scheduled','event') DO NOTHING
   RETURNING id INTO new_id;
   IF new_id IS NULL THEN
    SELECT id INTO existing FROM public.operation_task_instances WHERE activity_id=fr.activity_id AND facility_id=p_facility AND subject_id=candidate.subject_id
     AND period_key=v_period_key AND coalesce(assigned_shift,'all')=coalesce(v_shift,'all') AND occurrence_kind IN('scheduled','event');
    outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'subject_id',candidate.subject_id,'binding_id',candidate.binding_id,'outcome','existing','existing_task_id',existing);
    counts:=jsonb_set(counts,'{existing}',to_jsonb((counts->>'existing')::int+1));
   ELSE
    INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,to_status,event_data)
    VALUES(f.organization_id,p_facility,new_id,'generated','pending',jsonb_build_object('run_id',run_id,'evaluator_version','hfo-evaluator/1','rule_sha256',rule_hash,
     'configuration_id',fr.id,'requirement_version_id',v.id,'governing_at',governing,'binding_id',candidate.binding_id,'occurrence_kind',kind));
    outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'subject_id',candidate.subject_id,'binding_id',candidate.binding_id,'outcome','created','task_id',new_id);
    counts:=jsonb_set(counts,'{created}',to_jsonb((counts->>'created')::int+1));
   END IF;
  END LOOP;
  IF NOT matched THEN
   outcomes:=outcomes||jsonb_build_object('occurrence_date',to_char(occ_date,'YYYY-MM-DD'),'shift',v_shift,'outcome','no_binding','reason','no binding covers the governing instant');
   counts:=jsonb_set(counts,'{no_binding}',to_jsonb((counts->>'no_binding')::int+1));
  END IF;
 END LOOP;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 RETURN jsonb_build_object('run_id',run_id,'configuration_id',fr.id,'requirement_version_id',v.id,'evaluator_version','hfo-evaluator/1','rule_sha256',rule_hash,'outcomes',outcomes,'counts',counts);
END $$;

-- ---------------------------------------------------------------------------
-- Service reconciliation of native retirement or transfer: close the binding
-- and cancel only future pending work. Executed, completed and missed facts,
-- past and current periods, evidence and timestamps are never touched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.reconcile_operation_occurrences(p_facility uuid,p_run jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.facilities; b public.operation_activity_bindings; t public.operation_task_instances; run_id text; today date; closed jsonb:='[]'::jsonb; cancelled jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Reconciliation is a service command' USING ERRCODE='42501'; END IF;
 IF p_run IS NULL OR jsonb_typeof(p_run)<>'object' OR jsonb_typeof(p_run->'run_id') IS DISTINCT FROM 'string' OR length(btrim(p_run->>'run_id'))=0 OR length(p_run->>'run_id')>128 THEN
  RAISE EXCEPTION 'Reconciliation run needs a run_id' USING ERRCODE='22023'; END IF;
 run_id:=p_run->>'run_id';
 SELECT * INTO f FROM public.facilities WHERE id=p_facility AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation site unavailable' USING ERRCODE='42501'; END IF;
 today:=(clock_timestamp() AT TIME ZONE coalesce(f.timezone,'America/New_York'))::date;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 FOR b IN SELECT * FROM public.operation_activity_bindings WHERE facility_id=p_facility AND effective_to IS NULL ORDER BY id FOR UPDATE LOOP
  IF haven.operation_subject_current(b.subject_id,b.organization_id,b.facility_id,b.authority_class) THEN CONTINUE; END IF;
  UPDATE public.operation_activity_bindings SET effective_to=clock_timestamp(),retired_at=clock_timestamp(),retirement_reason='subject no longer current' WHERE id=b.id;
  closed:=closed||to_jsonb(b.id);
  FOR t IN SELECT * FROM public.operation_task_instances WHERE binding_id=b.id AND occurrence_kind IN('scheduled','event') AND status='pending' AND deleted_at IS NULL
   AND period_start_date>today ORDER BY period_start_date,id FOR UPDATE LOOP
   UPDATE public.operation_task_instances SET status='cancelled',cancellation_reason='subject retired before the period',updated_at=clock_timestamp() WHERE id=t.id;
   INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,event_notes,event_data)
   VALUES(t.organization_id,t.facility_id,t.id,'reconciled',t.status,'cancelled','subject retired before the period',jsonb_build_object('run_id',run_id,'binding_id',b.id,'subject_id',b.subject_id));
   cancelled:=cancelled||to_jsonb(t.id);
  END LOOP;
 END LOOP;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 RETURN jsonb_build_object('run_id',run_id,'facility_id',p_facility,'bindings_closed',closed,'occurrences_cancelled',cancelled,
  'counts',jsonb_build_object('bindings_closed',jsonb_array_length(closed),'occurrences_cancelled',jsonb_array_length(cancelled)));
END $$;

-- ---------------------------------------------------------------------------
-- Manual unscheduled occurrence (session). No period, no deadline; the queue
-- date only satisfies the legacy assigned_shift_date column and says so.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.create_operation_manual_occurrence(p_activity uuid,p_facility uuid,p_subject uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; subject public.operation_activity_subjects; f public.facilities; v public.operation_requirement_versions; fr public.operation_facility_requirements;
 k text; org uuid:=haven.organization_id(); class text; queue date; shift text; note text; request_hash text; existing public.operation_task_instances; row public.operation_task_instances;
 site_tz text; local_start timestamptz; local_end timestamptz; governing timestamptz; roles public.app_role[]; today date;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Manual occurrence payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('queue_date','shift','note') THEN RAISE EXCEPTION 'Manual occurrence field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_payload ? 'queue_date' AND jsonb_typeof(p_payload->'queue_date')<>'null' AND NOT haven.operation_schedule_date_valid(p_payload->'queue_date') THEN RAISE EXCEPTION 'queue_date must be a calendar date' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'shift' AND jsonb_typeof(p_payload->'shift')<>'null' AND (jsonb_typeof(p_payload->'shift')<>'string' OR (p_payload->>'shift') NOT IN('day','evening','night')) THEN RAISE EXCEPTION 'shift must be day, evening or night' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'note' AND jsonb_typeof(p_payload->'note')<>'null' AND (jsonb_typeof(p_payload->'note')<>'string' OR length(p_payload->>'note')>2000) THEN RAISE EXCEPTION 'note must be text of at most 2000 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO f FROM public.facilities WHERE id=p_facility AND organization_id=org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 -- Site authority before any activity or subject is read.
 PERFORM haven.lock_operation_recorder(org,p_facility);
 site_tz:=coalesce(f.timezone,'America/New_York');
 today:=(clock_timestamp() AT TIME ZONE site_tz)::date;
 queue:=coalesce((p_payload->>'queue_date')::date,today); shift:=nullif(p_payload->>'shift',''); note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF queue<today-366 OR queue>today+366 THEN RAISE EXCEPTION 'Queue date must be within a year of today' USING ERRCODE='22023'; END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=p_activity AND organization_id=org AND (facility_id IS NULL OR facility_id=p_facility) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF activity.subject_kind IS NULL THEN RAISE EXCEPTION 'activity subject classification is required before recording' USING ERRCODE='22023'; END IF;
 SELECT * INTO subject FROM public.operation_activity_subjects WHERE id=p_subject AND organization_id=org AND facility_id=p_facility FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF subject.subject_kind<>activity.subject_kind THEN RAISE EXCEPTION 'Occurrence subject must match the activity subject' USING ERRCODE='22023'; END IF;
 class:=CASE subject.subject_kind WHEN 'employee' THEN 'employee_personnel' ELSE subject.subject_kind END;
 IF subject.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=subject.resident_id FOR SHARE;
 ELSIF subject.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=subject.employee_id FOR SHARE;
 ELSIF subject.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=subject.asset_id FOR SHARE; END IF;
 PERFORM haven.lock_operation_recorder(org,p_facility);
 governing:=clock_timestamp();
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=haven.operation_requirement_in_force(activity.id,governing) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No requirement version is in force for this activity' USING ERRCODE='22023'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=haven.operation_facility_requirement_in_force(activity.id,p_facility,governing) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No site configuration is in force for this activity' USING ERRCODE='22023'; END IF;
 IF fr.applicability='not_applicable' THEN RAISE EXCEPTION 'This activity is not applicable at this site' USING ERRCODE='22023'; END IF;
 IF fr.requirement_version_id IS NOT NULL AND fr.requirement_version_id<>v.id THEN RAISE EXCEPTION 'Site configuration does not agree with the version in force' USING ERRCODE='22023'; END IF;
 local_start:=(queue::timestamp) AT TIME ZONE site_tz; local_end:=((queue+1)::timestamp) AT TIME ZONE site_tz;
 IF v.effective_from>=local_end OR (v.effective_to IS NOT NULL AND v.effective_to<=local_start) OR fr.effective_from>=local_end OR (fr.effective_to IS NOT NULL AND fr.effective_to<=local_start) THEN
  RAISE EXCEPTION 'Queue date lies outside the governing configuration window' USING ERRCODE='22023'; END IF;
 -- Recorder rule: the site list governs when set, else the central list; protected
 -- subjects additionally need an explicit recording grant (COL-133).
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles);
 IF NOT (haven.app_role()=ANY(roles)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF NOT haven.operation_subject_accessible(p_subject,org,p_facility,class)
  OR (class NOT IN('facility','asset') AND NOT EXISTS(SELECT 1 FROM public.operation_subject_access g WHERE g.user_id=auth.uid() AND g.organization_id=org AND g.facility_id=p_facility
   AND g.scope=class AND g.can_record AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))
  OR (class='resident' AND haven.app_role()::text NOT IN('owner','org_admin','facility_admin','nurse')) THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('activity',p_activity,'facility',p_facility,'subject',p_subject,'queue_date',to_char(queue,'YYYY-MM-DD'),'shift',shift,'note',note)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_task_instances WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.created_by=auth.uid() THEN RETURN to_jsonb(existing)||jsonb_build_object('replayed',true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_task_instances(organization_id,facility_id,activity_id,subject_id,authority_class,template_name,template_category,template_cadence_type,
   assigned_shift_date,assigned_shift,assigned_role,status,priority,license_threatening,requires_dual_sign,requirement_version_id,facility_requirement_id,governing_at,
   schedule_snapshot,occurrence_kind,request_key,request_hash,completion_notes)
  VALUES(org,p_facility,activity.id,p_subject,class,coalesce(v.title,activity.name),'compliance','on_demand',queue,shift,haven.app_role()::text,'pending','normal',false,v.review_required,v.id,fr.id,governing,
   jsonb_build_object('evaluator_version','hfo-evaluator/1','queue_date_is_compatibility_only',true,'queue_date',to_char(queue,'YYYY-MM-DD'),'timezone',site_tz,'configuration_id',fr.id,'requirement_version_id',v.id,'note',note),
   'manual',p_request_key,request_hash,NULL) RETURNING * INTO row;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(org,p_facility,row.id,'created','pending',auth.uid(),haven.app_role()::text,note,jsonb_build_object('occurrence_kind','manual','request_key',p_request_key,'request_hash',request_hash,'queue_date_is_compatibility_only',true));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_recorder(org,p_facility);
 RETURN to_jsonb(row)||jsonb_build_object('replayed',false);
END $$;

-- ---------------------------------------------------------------------------
-- Association (session): links manual work to one scheduled occurrence.
-- Changes nothing on either row and implies no completion.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.associate_operation_occurrence(p_occurrence uuid,p_work uuid,p_kind text,p_expected_revision text,p_reason text,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.operation_task_instances; w public.operation_task_instances; existing public.operation_occurrence_associations; row public.operation_occurrence_associations; request_hash text; reason text;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('early','late','unscheduled') THEN RAISE EXCEPTION 'Association kind must be early, late or unscheduled' USING ERRCODE='22023'; END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(coalesce(p_reason,'')),'');
 IF reason IS NULL THEN RAISE EXCEPTION 'Association reason is required' USING ERRCODE='22023'; END IF;
 IF p_occurrence=p_work THEN RAISE EXCEPTION 'Work cannot be associated with itself' USING ERRCODE='22023'; END IF;
 -- Lock the lower id first so two associations of the same pair cannot deadlock.
 IF p_occurrence<p_work THEN PERFORM haven.lock_operation_authority(p_occurrence); PERFORM haven.lock_operation_authority(p_work);
 ELSE PERFORM haven.lock_operation_authority(p_work); PERFORM haven.lock_operation_authority(p_occurrence); END IF;
 SELECT * INTO o FROM public.operation_task_instances WHERE id=p_occurrence;
 SELECT * INTO w FROM public.operation_task_instances WHERE id=p_work;
 IF o.occurrence_kind NOT IN('scheduled','event') THEN RAISE EXCEPTION 'Association target must be a scheduled occurrence' USING ERRCODE='22023'; END IF;
 IF w.occurrence_kind IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'Only manual work can be associated' USING ERRCODE='22023'; END IF;
 IF (o.organization_id,o.facility_id,o.activity_id,o.subject_id) IS DISTINCT FROM (w.organization_id,w.facility_id,w.activity_id,w.subject_id) THEN
  RAISE EXCEPTION 'Association requires the same activity, site and subject' USING ERRCODE='22023'; END IF;
 IF o.status='cancelled' THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('occurrence',p_occurrence,'work',p_work,'kind',p_kind,'reason',reason)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_occurrence_associations WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash THEN RETURN to_jsonb(existing)||jsonb_build_object('replayed',true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.operation_occurrence_associations WHERE work_task_id=p_work) THEN RAISE EXCEPTION 'Work is already associated' USING ERRCODE='23505'; END IF;
 IF p_expected_revision IS DISTINCT FROM o.occurrence_revision THEN RAISE EXCEPTION 'Occurrence changed since it was read' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_occurrence_associations(organization_id,facility_id,occurrence_task_id,work_task_id,association_kind,expected_revision,request_key,request_hash,reason,created_by)
  VALUES(o.organization_id,o.facility_id,o.id,w.id,p_kind,p_expected_revision,p_request_key,request_hash,reason,auth.uid()) RETURNING * INTO row;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Work is already associated' USING ERRCODE='23505';
 END;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 SELECT o.organization_id,o.facility_id,x.id,'associated',x.status,x.status,auth.uid(),haven.app_role()::text,reason,
  jsonb_build_object('association_id',row.id,'association_kind',p_kind,'expected_revision',p_expected_revision,'occurrence_task_id',o.id,'work_task_id',w.id,'request_key',p_request_key)
 FROM (SELECT o.id,o.status UNION ALL SELECT w.id,w.status) x;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_authority(p_occurrence); PERFORM haven.lock_operation_authority(p_work);
 RETURN to_jsonb(row)||jsonb_build_object('replayed',false);
END $$;

-- ---------------------------------------------------------------------------
-- Cancellation (session) of a managed occurrence; identity and evidence stay.
-- p_remove hides an already cancelled occurrence (soft delete) without ever
-- releasing its identity.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.cancel_operation_occurrence(p_task uuid,p_reason text,p_request_key text,p_remove boolean DEFAULT false) RETURNS jsonb
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
-- Legacy paths keep their 337 bodies; managed rows are refused where the
-- legacy semantics would create an unmanaged replacement or reopen a period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.defer_operation_task_review(
  p_task_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_deferred_until timestamptz,
  p_cancellation_reason text,
  p_request_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.operation_task_instances%ROWTYPE;
  v_current_role text;
  v_current_organization uuid;
  v_reason text;
  v_request_hash text;
  v_expected_key text;
  v_replacement_id uuid;
  v_shift_date date;
  v_shift text;
BEGIN
  PERFORM haven.lock_operation_authority(p_task_id);
  IF p_actor_id IS DISTINCT FROM auth.uid() OR p_actor_role IS DISTINCT FROM haven.app_role()::text THEN
    RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT t FROM public.operation_task_instances
  WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  -- COL-139: a managed occurrence keeps its period identity; the legacy defer
  -- would create a replacement row without one.
  IF t.occurrence_kind IS NOT NULL THEN
    RAISE EXCEPTION 'Managed occurrences cannot be deferred by the legacy command' USING ERRCODE='P0001';
  END IF;

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
  IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  IF v_current_role NOT IN('owner','org_admin') THEN
    PERFORM 1 FROM public.user_facility_access AS access
    WHERE access.user_id=p_actor_id AND access.organization_id=v_current_organization
      AND access.facility_id=t.facility_id AND access.revoked_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task actor is no longer authorized' USING ERRCODE='42501'; END IF;
  END IF;

  v_reason:=coalesce(nullif(trim(p_cancellation_reason),''),'Deferred to a later queue date');
  v_expected_key:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'operation-defer-v1:'||p_actor_id::text||':'||p_task_id::text,'UTF8'
  )),'hex');
  IF p_request_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'Invalid defer request key' USING ERRCODE='22023';
  END IF;
  v_request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'task_id',p_task_id,'actor_id',p_actor_id,'deferred_until',p_deferred_until,'reason',v_reason
  )::text,'UTF8')),'hex');

  IF t.defer_request_key IS NOT NULL THEN
    IF t.defer_request_key=p_request_key AND t.defer_request_hash=v_request_hash
       AND t.deferred_replacement_task_id IS NOT NULL THEN
      RETURN jsonb_build_object('new_task_id',t.deferred_replacement_task_id,'replayed',true);
    END IF;
    RAISE EXCEPTION 'This defer request was already saved with different content. Refresh the task before retrying';
  END IF;
  IF p_deferred_until IS NULL OR p_deferred_until<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Deferred time must be in the future';
  END IF;
  IF t.status NOT IN('pending','in_progress','missed') THEN
    RAISE EXCEPTION 'Task cannot be deferred from this state';
  END IF;

  v_shift_date:=(p_deferred_until AT TIME ZONE 'America/New_York')::date;
  v_shift:=CASE
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 7 AND 14 THEN 'day'
    WHEN extract(hour FROM p_deferred_until AT TIME ZONE 'America/New_York') BETWEEN 15 AND 22 THEN 'evening'
    ELSE 'night'
  END;
  INSERT INTO public.operation_task_instances(
    organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,
    assigned_shift_date,assigned_shift,assigned_to,assigned_role,status,priority,license_threatening,
    estimated_minutes,requires_dual_sign,due_at,created_by,updated_by,subject_id,authority_class
  ) VALUES(
    t.organization_id,t.facility_id,t.template_id,t.template_name,t.template_category,t.template_cadence_type,
    v_shift_date,v_shift,t.assigned_to,t.assigned_role,'pending',t.priority,t.license_threatening,
    t.estimated_minutes,t.requires_dual_sign,p_deferred_until,p_actor_id,p_actor_id,t.subject_id,t.authority_class
  ) RETURNING id INTO v_replacement_id;

  UPDATE public.operation_task_instances SET
    status='deferred',deferred_until=p_deferred_until,cancellation_reason=v_reason,
    defer_request_key=p_request_key,defer_request_hash=v_request_hash,
    deferred_replacement_task_id=v_replacement_id,updated_at=now(),updated_by=p_actor_id
  WHERE id=t.id;

  INSERT INTO public.operation_audit_log(
    organization_id,facility_id,task_instance_id,event_type,from_status,to_status,
    actor_id,actor_role,event_notes,event_data
  ) VALUES(
    t.organization_id,t.facility_id,t.id,'deferred',t.status,'deferred',
    p_actor_id,v_current_role,v_reason,jsonb_build_object(
      'deferred_to',p_deferred_until,'new_task_id',v_replacement_id,'source','admin-operations',
      'request_key',p_request_key,'request_hash',v_request_hash,'receipt_version',1
    )
  );
  PERFORM haven.lock_operation_authority(p_task_id);
  RETURN jsonb_build_object('new_task_id',v_replacement_id,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION haven.operation_task_command(p_task_id uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; new_status text; event text;
BEGIN
 PERFORM haven.lock_operation_authority(p_task_id);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task_id;
 -- COL-139: reopening a managed period needs its own scoped semantics.
 IF p_action='reinstate' AND t.occurrence_kind IS NOT NULL THEN RAISE EXCEPTION 'Managed occurrences cannot be reinstated by the legacy command' USING ERRCODE='P0001'; END IF;
 IF p_action='start' AND t.status='pending' THEN new_status:='in_progress'; event:='started';
 ELSIF p_action='reinstate' AND t.status IN('missed','deferred') THEN new_status:='pending'; event:='updated';
 ELSIF p_action='escalate' THEN RAISE EXCEPTION 'Manual escalation requires classified delivery authority' USING ERRCODE='P0001';
 ELSE RAISE EXCEPTION 'Task cannot transition from this state' USING ERRCODE='P0001'; END IF;
 UPDATE public.operation_task_instances SET status=new_status,started_at=CASE WHEN p_action='start' THEN clock_timestamp() ELSE started_at END,
 updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes)
 VALUES(t.organization_id,t.facility_id,t.id,event,t.status,new_status,auth.uid(),haven.app_role()::text,p_payload->>'reason');
 PERFORM haven.lock_operation_authority(p_task_id);
 RETURN jsonb_build_object('success',true,'status',new_status);
END $$;

-- The 337 authority guard keeps its body; the service reconciliation gains one
-- narrow carve-out: an approved command may cancel a pending managed
-- occurrence of any subject class (scheduling, not performance), and the
-- current-subject check does not apply because the subject has just retired.
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
 IF TG_OP='UPDATE' THEN PERFORM haven.lock_operation_authority(OLD.id);
 ELSIF NOT haven.operation_subject_accessible(NEW.subject_id,NEW.organization_id,NEW.facility_id,NEW.authority_class) THEN
 RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 NEW.updated_by:=auth.uid(); IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); END IF;
 IF coalesce(cardinality(NEW.completion_evidence_paths),0)>0 THEN RAISE EXCEPTION 'Classified evidence command required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.enroll_operation_binding_review(p_activity uuid,p_facility uuid,p_subject uuid,p_authority_class text,p_shift text,p_provenance jsonb,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.enroll_operation_binding(p_activity,p_facility,p_subject,p_authority_class,p_shift,p_provenance,p_effective_from) $$;
CREATE FUNCTION public.retire_operation_binding_review(p_binding uuid,p_effective_to timestamptz,p_reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.retire_operation_binding(p_binding,p_effective_to,p_reason) $$;
CREATE FUNCTION public.create_operation_manual_occurrence_review(p_activity uuid,p_facility uuid,p_subject uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.create_operation_manual_occurrence(p_activity,p_facility,p_subject,p_request_key,p_payload) $$;
CREATE FUNCTION public.associate_operation_occurrence_review(p_occurrence uuid,p_work uuid,p_kind text,p_expected_revision text,p_reason text,p_request_key text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.associate_operation_occurrence(p_occurrence,p_work,p_kind,p_expected_revision,p_reason,p_request_key) $$;
CREATE FUNCTION public.cancel_operation_occurrence_review(p_task uuid,p_reason text,p_request_key text,p_remove boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.cancel_operation_occurrence(p_task,p_reason,p_request_key,p_remove) $$;
CREATE FUNCTION public.generate_operation_occurrences_service(p_facility uuid,p_configuration uuid,p_occurrences jsonb,p_run jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.generate_operation_occurrences(p_facility,p_configuration,p_occurrences,p_run) $$;
CREATE FUNCTION public.reconcile_operation_occurrences_service(p_facility uuid,p_run jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reconcile_operation_occurrences(p_facility,p_run) $$;

REVOKE ALL ON FUNCTION
 haven.enroll_operation_binding(uuid,uuid,uuid,text,text,jsonb,timestamptz),haven.retire_operation_binding(uuid,timestamptz,text),
 haven.create_operation_manual_occurrence(uuid,uuid,uuid,text,jsonb),haven.associate_operation_occurrence(uuid,uuid,text,text,text,text),haven.cancel_operation_occurrence(uuid,text,text,boolean),
 haven.generate_operation_occurrences(uuid,uuid,jsonb,jsonb),haven.reconcile_operation_occurrences(uuid,jsonb),
 public.enroll_operation_binding_review(uuid,uuid,uuid,text,text,jsonb,timestamptz),public.retire_operation_binding_review(uuid,timestamptz,text),
 public.create_operation_manual_occurrence_review(uuid,uuid,uuid,text,jsonb),public.associate_operation_occurrence_review(uuid,uuid,text,text,text,text),public.cancel_operation_occurrence_review(uuid,text,text,boolean),
 public.generate_operation_occurrences_service(uuid,uuid,jsonb,jsonb),public.reconcile_operation_occurrences_service(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.enroll_operation_binding(uuid,uuid,uuid,text,text,jsonb,timestamptz),haven.retire_operation_binding(uuid,timestamptz,text),
 haven.create_operation_manual_occurrence(uuid,uuid,uuid,text,jsonb),haven.associate_operation_occurrence(uuid,uuid,text,text,text,text),haven.cancel_operation_occurrence(uuid,text,text,boolean),
 public.enroll_operation_binding_review(uuid,uuid,uuid,text,text,jsonb,timestamptz),public.retire_operation_binding_review(uuid,timestamptz,text),
 public.create_operation_manual_occurrence_review(uuid,uuid,uuid,text,jsonb),public.associate_operation_occurrence_review(uuid,uuid,text,text,text,text),public.cancel_operation_occurrence_review(uuid,text,text,boolean)
 TO authenticated;
GRANT EXECUTE ON FUNCTION
 haven.generate_operation_occurrences(uuid,uuid,jsonb,jsonb),haven.reconcile_operation_occurrences(uuid,jsonb),
 public.generate_operation_occurrences_service(uuid,uuid,jsonb,jsonb),public.reconcile_operation_occurrences_service(uuid,jsonb)
 TO service_role;

-- This migration enrols no subject and links no work: the replay probe asserts
-- the same after it, together with the 137 rule that no schedule is confirmed.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_activity_bindings) OR EXISTS(SELECT 1 FROM public.operation_occurrence_associations) THEN
  RAISE EXCEPTION 'COL-139: the migration must not create bindings or associations';
 END IF;
END $$;

COMMENT ON TABLE public.operation_activity_bindings IS 'COL-139: explicit effective-dated enrolment of one typed subject in one activity at one site. Registry existence and site configuration never enrol a resident, employee or asset; facility-kind activities need no binding.';
COMMENT ON TABLE public.operation_occurrence_associations IS 'COL-139: immutable audited link from manual work to one scheduled occurrence with the expected revision and request fingerprint. Implies no completion and rewrites nothing.';
COMMENT ON COLUMN public.operation_task_instances.occurrence_kind IS 'COL-139: scheduled, event or manual for managed occurrences; NULL for legacy rows, which keep every existing path.';
COMMENT ON COLUMN public.operation_task_instances.period_key IS 'COL-139: canonical period identity (occurrence date, or event_key:source_event_id). Unique with activity, site, subject and shift; retained across cancellation and soft deletion.';
COMMENT ON COLUMN public.operation_task_instances.governing_at IS 'COL-139: the precise instant at which the central version and site configuration were chosen (due instant, source event instant, or manual creation instant).';
COMMENT ON COLUMN public.operation_task_instances.schedule_snapshot IS 'COL-139: immutable evaluator output (version, timezone, rule hash, period, due, grace, reminder, adjustments); for manual work only a labelled compatibility queue date.';
COMMENT ON FUNCTION haven.generate_operation_occurrences(uuid,uuid,jsonb,jsonb) IS 'COL-139: service generation of one configuration''s evaluator periods expanded to bound subjects; converges on identity, serialises per subject, reports conflicts, never records performed work.';
NOTIFY pgrst,'reload schema';
COMMIT;
