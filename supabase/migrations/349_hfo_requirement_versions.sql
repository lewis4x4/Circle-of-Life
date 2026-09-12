BEGIN;

-- COL-135 / HFO-02: effective-dated central requirement versions and facility
-- requirement configurations on top of the stable activity catalog (336) and
-- current authority (337). Publication is explicit, versioned and immutable,
-- and "published" is distinct from "in force": a version governs only inside
-- its effective window. Drafts, unknown values and needs-confirmation states
-- never become active defaults. Schedule confirmation stays independent of
-- applicability and cannot be published until the evaluator defines rule
-- shapes. No occurrence is generated, no template is bound and no recording
-- path is blocked by this migration.

-- ---------------------------------------------------------------------------
-- Rule shape validators. Strict: unknown keys, unknown types, duplicates and
-- empty labels are rejected so an unreviewed value cannot be stored as a rule.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_rule_inputs_valid(p_rules jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; k text; seen text[]:='{}';
BEGIN
 IF p_rules IS NULL OR jsonb_typeof(p_rules)<>'array' THEN RETURN false; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  IF jsonb_typeof(e)<>'object' THEN RETURN false; END IF;
  FOR k IN SELECT * FROM jsonb_object_keys(e) LOOP
   IF k NOT IN('key','label','type','required','unit','min','max','choices') THEN RETURN false; END IF;
  END LOOP;
  IF coalesce(e->>'key','') !~ '^[a-z][a-z0-9_]{0,63}$' OR e->>'key'=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,e->>'key');
  IF jsonb_typeof(e->'label') IS DISTINCT FROM 'string' OR length(btrim(e->>'label'))=0 THEN RETURN false; END IF;
  IF coalesce(e->>'type','') NOT IN('number','text','boolean','choice','datetime') THEN RETURN false; END IF;
  IF jsonb_typeof(e->'required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF e ? 'unit' AND jsonb_typeof(e->'unit')<>'string' THEN RETURN false; END IF;
  IF (e ? 'min' OR e ? 'max') AND e->>'type'<>'number' THEN RETURN false; END IF;
  IF e ? 'min' AND jsonb_typeof(e->'min')<>'number' THEN RETURN false; END IF;
  IF e ? 'max' AND jsonb_typeof(e->'max')<>'number' THEN RETURN false; END IF;
  IF e ? 'min' AND e ? 'max' AND (e->>'min')::numeric>(e->>'max')::numeric THEN RETURN false; END IF;
  IF e->>'type'='choice' THEN
   IF jsonb_typeof(e->'choices')<>'array' OR jsonb_array_length(e->'choices')=0 THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(e->'choices') c WHERE jsonb_typeof(c)<>'string' OR length(btrim(c#>>'{}'))=0) THEN RETURN false; END IF;
  ELSIF e ? 'choices' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION haven.operation_rule_evidence_valid(p_rules jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; k text; seen text[]:='{}';
BEGIN
 IF p_rules IS NULL OR jsonb_typeof(p_rules)<>'array' THEN RETURN false; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  IF jsonb_typeof(e)<>'object' THEN RETURN false; END IF;
  FOR k IN SELECT * FROM jsonb_object_keys(e) LOOP
   IF k NOT IN('kind','label','min_count','when') THEN RETURN false; END IF;
  END LOOP;
  IF coalesce(e->>'kind','') NOT IN('document','photo','signature','linked_record','reading') THEN RETURN false; END IF;
  IF jsonb_typeof(e->'label') IS DISTINCT FROM 'string' OR length(btrim(e->>'label'))=0 OR (e->>'label')=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,e->>'label');
  IF jsonb_typeof(e->'min_count') IS DISTINCT FROM 'number' OR (e->>'min_count')::numeric<1 OR (e->>'min_count')::numeric<>floor((e->>'min_count')::numeric) THEN RETURN false; END IF;
  IF coalesce(e->>'when','') NOT IN('always','on_failure','on_success') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION haven.operation_roles_valid(p_roles jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb;
BEGIN
 IF p_roles IS NULL OR jsonb_typeof(p_roles)<>'array' THEN RETURN false; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_roles) LOOP
  IF jsonb_typeof(e)<>'string' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_enum en JOIN pg_catalog.pg_type t ON t.oid=en.enumtypid
   JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='app_role' AND en.enumlabel=(e#>>'{}')) THEN RETURN false; END IF;
 END LOOP;
 RETURN (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_roles) x)=jsonb_array_length(p_roles);
END $$;
REVOKE ALL ON FUNCTION haven.operation_rule_inputs_valid(jsonb),haven.operation_rule_evidence_valid(jsonb),haven.operation_roles_valid(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_rule_inputs_valid(jsonb),haven.operation_rule_evidence_valid(jsonb),haven.operation_roles_valid(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Central requirement versions. status is draft or published; a published row
-- governs between effective_from and effective_to (NULL = open). Publishing a
-- successor closes the predecessor at the successor's effective time.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_requirement_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 activity_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published')),
 effective_from timestamptz,
 effective_to timestamptz,
 title text,
 wording text,
 procedure text,
 source_authority jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(source_authority)='object'),
 subject_kind text CHECK(subject_kind IN('facility','resident','employee','asset')),
 allowed_recorder_roles public.app_role[] NOT NULL DEFAULT '{}',
 allowed_reviewer_roles public.app_role[] NOT NULL DEFAULT '{}',
 review_required boolean NOT NULL DEFAULT false,
 required_inputs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(haven.operation_rule_inputs_valid(required_inputs)),
 required_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(haven.operation_rule_evidence_valid(required_evidence)),
 previous_version_id uuid REFERENCES public.operation_requirement_versions(id),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 published_by uuid REFERENCES public.user_profiles(id),
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(activity_id,version),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK(effective_to IS NULL OR (effective_from IS NOT NULL AND effective_to>effective_from)),
 CHECK(status='draft' OR (effective_from IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)),
 CHECK(status='published' OR (effective_from IS NULL AND effective_to IS NULL AND published_by IS NULL AND published_at IS NULL))
);
CREATE UNIQUE INDEX operation_requirement_one_draft ON public.operation_requirement_versions(activity_id) WHERE status='draft';
CREATE UNIQUE INDEX operation_requirement_one_open ON public.operation_requirement_versions(activity_id) WHERE status='published' AND effective_to IS NULL;
CREATE INDEX idx_operation_requirement_versions_window ON public.operation_requirement_versions(activity_id,effective_from,effective_to) WHERE status='published';

-- ---------------------------------------------------------------------------
-- Facility requirement configurations: effective-dated site applicability with
-- reason and approver, local procedure/roles/evidence that only constrain the
-- central version, owner/backup, and an independent schedule-confirmation state.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_facility_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 activity_id uuid NOT NULL,
 requirement_version_id uuid REFERENCES public.operation_requirement_versions(id),
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published')),
 effective_from timestamptz,
 effective_to timestamptz,
 applicability text NOT NULL DEFAULT 'needs_confirmation' CHECK(applicability IN('applicable','not_applicable','needs_confirmation')),
 applicability_reason text,
 override_source text NOT NULL DEFAULT 'central' CHECK(override_source IN('central','admin_log','interview','facility_policy','regulator','other')),
 local_procedure text,
 local_allowed_recorder_roles public.app_role[],
 local_required_inputs jsonb CHECK(local_required_inputs IS NULL OR haven.operation_rule_inputs_valid(local_required_inputs)),
 local_required_evidence jsonb CHECK(local_required_evidence IS NULL OR haven.operation_rule_evidence_valid(local_required_evidence)),
 owner_role public.app_role,
 owner_user_id uuid REFERENCES public.user_profiles(id),
 backup_role public.app_role,
 backup_user_id uuid REFERENCES public.user_profiles(id),
 schedule_status text NOT NULL DEFAULT 'needs_confirmation' CHECK(schedule_status IN('needs_confirmation','confirmed')),
 schedule_rule jsonb CHECK(schedule_rule IS NULL OR jsonb_typeof(schedule_rule)='object'),
 previous_version_id uuid REFERENCES public.operation_facility_requirements(id),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 approved_by uuid REFERENCES public.user_profiles(id),
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(activity_id,facility_id,version),
 FOREIGN KEY(organization_id,activity_id) REFERENCES public.operation_activities(organization_id,id),
 CHECK(effective_to IS NULL OR (effective_from IS NOT NULL AND effective_to>effective_from)),
 CHECK(status='draft' OR (effective_from IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(status='published' OR (effective_from IS NULL AND effective_to IS NULL AND approved_by IS NULL AND approved_at IS NULL)),
 CHECK(schedule_status='needs_confirmation' OR schedule_rule IS NOT NULL)
);
CREATE UNIQUE INDEX operation_facility_requirement_one_draft ON public.operation_facility_requirements(activity_id,facility_id) WHERE status='draft';
CREATE UNIQUE INDEX operation_facility_requirement_one_open ON public.operation_facility_requirements(activity_id,facility_id) WHERE status='published' AND effective_to IS NULL;
CREATE INDEX idx_operation_facility_requirements_site ON public.operation_facility_requirements(organization_id,facility_id,status);

ALTER TABLE public.operation_requirement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_facility_requirements ENABLE ROW LEVEL SECURITY;
-- Only the commands write; the service identity has no direct DML either.
REVOKE ALL ON public.operation_requirement_versions,public.operation_facility_requirements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_requirement_versions,public.operation_facility_requirements TO authenticated,service_role;
-- Drafts are visible only to the roles that may publish them; published
-- versions follow activity visibility (organization; legacy by site).
CREATE POLICY operation_requirement_versions_read ON public.operation_requirement_versions FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id()
 AND (status<>'draft' OR haven.app_role()::text IN('owner','org_admin'))
 AND EXISTS(SELECT 1 FROM public.operation_activities a WHERE a.id=activity_id));
CREATE POLICY operation_facility_requirements_read ON public.operation_facility_requirements FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id)
 AND (status<>'draft' OR haven.app_role()::text IN('owner','org_admin','facility_admin')));
CREATE TRIGGER operation_requirement_versions_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_requirement_versions
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_facility_requirements_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_facility_requirements
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_requirement_versions_no_truncate BEFORE TRUNCATE ON public.operation_requirement_versions
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_facility_requirements_no_truncate BEFORE TRUNCATE ON public.operation_facility_requirements
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();

-- ---------------------------------------------------------------------------
-- "In force" resolvers: the published version whose window covers an instant.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_requirement_in_force(p_activity uuid,p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT id FROM public.operation_requirement_versions WHERE activity_id=p_activity AND status='published'
  AND effective_from<=p_at AND (effective_to IS NULL OR effective_to>p_at) ORDER BY effective_from DESC LIMIT 1
$$;
CREATE FUNCTION haven.operation_facility_requirement_in_force(p_activity uuid,p_facility uuid,p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT id FROM public.operation_facility_requirements WHERE activity_id=p_activity AND facility_id=p_facility AND status='published'
  AND effective_from<=p_at AND (effective_to IS NULL OR effective_to>p_at) ORDER BY effective_from DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION haven.operation_requirement_in_force(uuid,timestamptz),haven.operation_facility_requirement_in_force(uuid,uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_requirement_in_force(uuid,timestamptz),haven.operation_facility_requirement_in_force(uuid,uuid,timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- Immutability and transition guards. Only the publish commands, which set the
-- transaction-local approved setting, may publish a draft or close an open
-- published row; nothing may edit or delete a version that has governed work.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_publish_approved() RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT current_setting('haven.operation_requirement_publish',true)='approved' $$;
REVOKE ALL ON FUNCTION haven.operation_publish_approved() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.guard_operation_requirement_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Requirement versions are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'A requirement version starts as a draft' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='draft' THEN
  IF NEW.status='published' AND NOT haven.operation_publish_approved() THEN RAISE EXCEPTION 'Use the requirement publication command' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.activity_id,NEW.version,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.activity_id,OLD.version,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Requirement version identity is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  -- Published wording, rules, roles, subject and start never change. The only
  -- permitted change closes an open window at a successor's effective time.
  IF NEW.status<>'published' OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR NOT haven.operation_publish_approved()
   OR to_jsonb(NEW)-ARRAY['effective_to','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['effective_to','updated_at'] THEN
   RAISE EXCEPTION 'Published requirement versions are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=NEW.activity_id AND organization_id=NEW.organization_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Requirement activity unavailable' USING ERRCODE='23514'; END IF;
 IF activity.subject_kind IS NOT NULL AND NEW.subject_kind IS NOT NULL AND NEW.subject_kind<>activity.subject_kind THEN
  RAISE EXCEPTION 'Requirement subject must match the activity subject' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_requirement_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_requirement_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_requirement_versions
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_requirement_version();

CREATE FUNCTION haven.guard_operation_facility_requirement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE central public.operation_requirement_versions;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Facility requirement versions are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'A facility requirement starts as a draft' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='draft' THEN
  IF NEW.status='published' AND NOT haven.operation_publish_approved() THEN RAISE EXCEPTION 'Use the facility requirement publication command' USING ERRCODE='42501'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.activity_id,NEW.version,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.activity_id,OLD.version,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Facility requirement identity is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.status<>'published' OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR NOT haven.operation_publish_approved()
   OR to_jsonb(NEW)-ARRAY['effective_to','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['effective_to','updated_at'] THEN
   RAISE EXCEPTION 'Published facility requirements are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 PERFORM 1 FROM public.facilities WHERE id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement site unavailable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.operation_activities WHERE id=NEW.activity_id AND organization_id=NEW.organization_id
  AND (facility_id IS NULL OR facility_id=NEW.facility_id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement activity unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.requirement_version_id IS NOT NULL THEN
  SELECT * INTO central FROM public.operation_requirement_versions WHERE id=NEW.requirement_version_id FOR SHARE;
  IF NOT FOUND OR central.organization_id<>NEW.organization_id OR central.activity_id<>NEW.activity_id OR central.status<>'published' THEN
   RAISE EXCEPTION 'Facility requirement must reference a published central version of the same activity' USING ERRCODE='23514';
  END IF;
  -- Local rules constrain the central rule and never widen it: roles are a
  -- subset; local inputs and evidence must keep every central requirement.
  IF NEW.local_allowed_recorder_roles IS NOT NULL AND NOT (NEW.local_allowed_recorder_roles <@ central.allowed_recorder_roles) THEN
   RAISE EXCEPTION 'Local recorder roles must be a subset of the central roles' USING ERRCODE='23514';
  END IF;
  IF NEW.local_required_evidence IS NOT NULL AND NOT (central.required_evidence <@ NEW.local_required_evidence) THEN
   RAISE EXCEPTION 'Local evidence must keep every central evidence requirement' USING ERRCODE='23514';
  END IF;
  IF NEW.local_required_inputs IS NOT NULL AND NOT (central.required_inputs <@ NEW.local_required_inputs) THEN
   RAISE EXCEPTION 'Local inputs must keep every central input requirement' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.local_allowed_recorder_roles IS NOT NULL OR NEW.local_required_evidence IS NOT NULL OR NEW.local_required_inputs IS NOT NULL THEN
  RAISE EXCEPTION 'Local rules require a published central version' USING ERRCODE='23514';
 END IF;
 IF NEW.owner_user_id IS NOT NULL THEN
  PERFORM 1 FROM public.user_profiles WHERE id=NEW.owner_user_id AND organization_id=NEW.organization_id AND is_active AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement owner unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.backup_user_id IS NOT NULL THEN
  PERFORM 1 FROM public.user_profiles WHERE id=NEW.backup_user_id AND organization_id=NEW.organization_id AND is_active AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement backup unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_facility_requirement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_facility_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_facility_requirements
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_facility_requirement();

-- ---------------------------------------------------------------------------
-- Occurrence rule snapshots. An occurrence records the exact central and site
-- versions that governed it; they are set once, must be in force on the
-- occurrence's local date, must agree with each other, and are never rewritten
-- when a later version changes future wording, evidence or schedule.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_task_instances
 ADD COLUMN requirement_version_id uuid REFERENCES public.operation_requirement_versions(id),
 ADD COLUMN facility_requirement_id uuid REFERENCES public.operation_facility_requirements(id);
CREATE INDEX idx_operation_task_instances_requirement_version ON public.operation_task_instances(requirement_version_id) WHERE requirement_version_id IS NOT NULL;

-- A version-backed occurrence without a legacy template carries the version's
-- activity identity; the 336 rule that template-less work is unreconciled
-- applies only when no published version governs it.
CREATE OR REPLACE FUNCTION haven.bind_operation_instance_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE template public.operation_task_templates; governed uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.template_id,NEW.activity_id)
      IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.template_id,OLD.activity_id) THEN
      RAISE EXCEPTION 'Operation instance identity is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.facilities WHERE id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid operation instance facility scope' USING ERRCODE='23514'; END IF;
  IF NEW.template_id IS NULL THEN
    IF NEW.requirement_version_id IS NOT NULL THEN
      SELECT activity_id INTO governed FROM public.operation_requirement_versions WHERE id=NEW.requirement_version_id AND organization_id=NEW.organization_id AND status='published';
      IF governed IS NULL THEN RAISE EXCEPTION 'Occurrence must snapshot a published version of its own activity' USING ERRCODE='23514'; END IF;
      IF NEW.activity_id IS NOT NULL AND NEW.activity_id<>governed THEN RAISE EXCEPTION 'Occurrence must snapshot a published version of its own activity' USING ERRCODE='23514'; END IF;
      NEW.activity_id:=governed;
      RETURN NEW;
    END IF;
    IF NEW.activity_id IS NOT NULL THEN RAISE EXCEPTION 'Unreconciled operation instance activity' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO template FROM public.operation_task_templates WHERE id=NEW.template_id;
  IF NOT FOUND OR template.organization_id IS DISTINCT FROM NEW.organization_id
    OR (template.facility_id IS NOT NULL AND template.facility_id IS DISTINCT FROM NEW.facility_id) THEN
    RAISE EXCEPTION 'Invalid operation instance template scope' USING ERRCODE='23514';
  END IF;
  IF NEW.activity_id IS NOT NULL AND NEW.activity_id<>template.activity_id THEN
    RAISE EXCEPTION 'Operation instance must retain template activity' USING ERRCODE='23514';
  END IF;
  NEW.activity_id:=template.activity_id;
  RETURN NEW;
END $$;

CREATE FUNCTION haven.guard_operation_instance_rule_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.operation_requirement_versions; fr public.operation_facility_requirements; tz text; local_start timestamptz; local_end timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (OLD.requirement_version_id IS NOT NULL AND NEW.requirement_version_id IS DISTINCT FROM OLD.requirement_version_id)
   OR (OLD.facility_requirement_id IS NOT NULL AND NEW.facility_requirement_id IS DISTINCT FROM OLD.facility_requirement_id) THEN
   RAISE EXCEPTION 'Occurrence rule snapshot is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.requirement_version_id IS NOT DISTINCT FROM OLD.requirement_version_id AND NEW.facility_requirement_id IS NOT DISTINCT FROM OLD.facility_requirement_id THEN RETURN NEW; END IF;
 END IF;
 IF NEW.requirement_version_id IS NULL AND NEW.facility_requirement_id IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(timezone,'America/New_York') INTO tz FROM public.facilities WHERE id=NEW.facility_id;
 local_start:=(NEW.assigned_shift_date::timestamp) AT TIME ZONE tz;
 local_end:=((NEW.assigned_shift_date+1)::timestamp) AT TIME ZONE tz;
 IF NEW.requirement_version_id IS NOT NULL THEN
  SELECT * INTO v FROM public.operation_requirement_versions WHERE id=NEW.requirement_version_id;
  IF NOT FOUND OR v.organization_id<>NEW.organization_id OR v.status<>'published' OR NEW.activity_id IS NULL OR v.activity_id<>NEW.activity_id THEN
   RAISE EXCEPTION 'Occurrence must snapshot a published version of its own activity' USING ERRCODE='23514';
  END IF;
  IF v.effective_from>=local_end OR (v.effective_to IS NOT NULL AND v.effective_to<=local_start) THEN
   RAISE EXCEPTION 'Occurrence must snapshot the version in force on its date' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.facility_requirement_id IS NOT NULL THEN
  SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=NEW.facility_requirement_id;
  IF NOT FOUND OR fr.organization_id<>NEW.organization_id OR fr.facility_id<>NEW.facility_id OR fr.status<>'published' OR NEW.activity_id IS NULL OR fr.activity_id<>NEW.activity_id THEN
   RAISE EXCEPTION 'Occurrence must snapshot a published site configuration of its own activity and site' USING ERRCODE='23514';
  END IF;
  IF fr.effective_from>=local_end OR (fr.effective_to IS NOT NULL AND fr.effective_to<=local_start) THEN
   RAISE EXCEPTION 'Occurrence must snapshot the site configuration in force on its date' USING ERRCODE='23514';
  END IF;
  IF fr.requirement_version_id IS NOT NULL AND fr.requirement_version_id IS DISTINCT FROM NEW.requirement_version_id THEN
   RAISE EXCEPTION 'Occurrence site configuration must agree with its central version' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_instance_rule_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_instance_rule_snapshot BEFORE INSERT OR UPDATE ON public.operation_task_instances
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_instance_rule_snapshot();

-- ---------------------------------------------------------------------------
-- Catalog read: activity identity with its source disposition, the version in
-- force now and any scheduled successor. Invoker view; underlying RLS applies.
-- ---------------------------------------------------------------------------
CREATE VIEW public.operation_activity_requirements WITH (security_invoker=true) AS
 SELECT a.id AS activity_id,a.organization_id,a.facility_id,a.activity_key,a.name,a.activity_kind,a.subject_kind,a.origin,
  (SELECT CASE WHEN bool_or(coalesce(s.source_payload->>'disposition','')='needs_confirmation') THEN 'needs_confirmation'
               WHEN count(*)>0 THEN 'mapped' ELSE NULL END
   FROM public.operation_activity_source_mappings m JOIN public.operation_activity_source_items s ON s.id=m.source_item_id
   WHERE m.activity_id=a.id) AS source_disposition,
  (SELECT array_agg(s.source_item_id ORDER BY s.source_item_id) FROM public.operation_activity_source_mappings m
   JOIN public.operation_activity_source_items s ON s.id=m.source_item_id WHERE m.activity_id=a.id) AS source_item_ids,
  cur.id AS current_requirement_version_id,cur.version AS current_version,cur.effective_from AS current_effective_from,cur.effective_to AS current_effective_to,cur.title AS current_title,
  nxt.id AS scheduled_requirement_version_id,nxt.version AS scheduled_version,nxt.effective_from AS scheduled_effective_from
 FROM public.operation_activities a
 LEFT JOIN public.operation_requirement_versions cur ON cur.id=haven.operation_requirement_in_force(a.id,clock_timestamp())
 LEFT JOIN LATERAL (SELECT id,version,effective_from FROM public.operation_requirement_versions n WHERE n.activity_id=a.id AND n.status='published' AND n.effective_from>clock_timestamp() ORDER BY effective_from LIMIT 1) nxt ON true;
REVOKE ALL ON public.operation_activity_requirements FROM PUBLIC,anon;
GRANT SELECT ON public.operation_activity_requirements TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Commands. Session-authenticated only: lock the actor's profile, session and
-- site grant, check current authority before and after DML, and never accept a
-- caller-supplied actor, approver or version number.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.assert_operation_requirement_actor(p_org uuid,p_facility uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'Requirement commands require an authenticated session' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions s ON s.user_id=p.id AND s.id=nullif(auth.jwt()->>'session_id','')::uuid WHERE p.id=auth.uid() FOR SHARE OF p,u,s;
 IF p_facility IS NOT NULL THEN PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE; END IF;
 IF haven.authorized_user_id() IS DISTINCT FROM auth.uid() OR haven.organization_id() IS DISTINCT FROM p_org
  OR (p_facility IS NULL AND haven.app_role()::text NOT IN('owner','org_admin'))
  OR (p_facility IS NOT NULL AND (haven.app_role()::text NOT IN('owner','org_admin','facility_admin') OR NOT haven.operation_facility_access(p_facility))) THEN
  RAISE EXCEPTION 'Requirement actor is not authorized' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.assert_operation_requirement_actor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.operation_requirement_problems(v public.operation_requirement_versions,p_effective_from timestamptz) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE problems text[]:='{}'; latest public.operation_requirement_versions; activity public.operation_activities;
BEGIN
 SELECT * INTO activity FROM public.operation_activities WHERE id=v.activity_id;
 IF length(btrim(coalesce(v.title,'')))=0 THEN problems:=array_append(problems,'title is required'); END IF;
 IF length(btrim(coalesce(v.wording,'')))=0 THEN problems:=array_append(problems,'requirement wording is required'); END IF;
 IF activity.subject_kind IS NULL THEN problems:=array_append(problems,'activity subject classification is required before publication');
 ELSIF v.subject_kind IS DISTINCT FROM activity.subject_kind THEN problems:=array_append(problems,'subject kind must match the activity'); END IF;
 IF coalesce(cardinality(v.allowed_recorder_roles),0)=0 THEN problems:=array_append(problems,'at least one recorder role is required'); END IF;
 IF v.review_required AND coalesce(cardinality(v.allowed_reviewer_roles),0)=0 THEN problems:=array_append(problems,'review requires at least one reviewer role'); END IF;
 IF p_effective_from IS NULL THEN problems:=array_append(problems,'effective time is required');
 ELSIF p_effective_from<clock_timestamp()-interval '1 day' THEN problems:=array_append(problems,'effective time cannot rewrite history'); END IF;
 SELECT * INTO latest FROM public.operation_requirement_versions WHERE activity_id=v.activity_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 IF FOUND AND p_effective_from IS NOT NULL AND p_effective_from<=latest.effective_from THEN problems:=array_append(problems,'effective time must follow the latest published version'); END IF;
 RETURN problems;
END $$;
CREATE FUNCTION haven.operation_facility_requirement_problems(fr public.operation_facility_requirements,p_effective_from timestamptz) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE problems text[]:='{}'; latest public.operation_facility_requirements; in_force uuid;
BEGIN
 IF fr.applicability='applicable' THEN
  in_force:=haven.operation_requirement_in_force(fr.activity_id,coalesce(p_effective_from,clock_timestamp()));
  IF in_force IS NULL THEN problems:=array_append(problems,'applicable requires a central version in force at the effective time');
  ELSIF fr.requirement_version_id IS DISTINCT FROM in_force THEN problems:=array_append(problems,'applicable must reference the central version in force at the effective time'); END IF;
 END IF;
 IF fr.applicability='not_applicable' AND length(btrim(coalesce(fr.applicability_reason,'')))=0 THEN problems:=array_append(problems,'not applicable requires a reason'); END IF;
 IF fr.override_source<>'central' AND length(btrim(coalesce(fr.applicability_reason,'')))=0 THEN problems:=array_append(problems,'a local override requires a reason'); END IF;
 IF (fr.local_procedure IS NOT NULL OR fr.local_allowed_recorder_roles IS NOT NULL OR fr.local_required_inputs IS NOT NULL OR fr.local_required_evidence IS NOT NULL)
  AND fr.override_source='central' THEN problems:=array_append(problems,'local changes must name their source'); END IF;
 -- Schedule confirmation is not available until the COL-137 evaluator defines
 -- and validates rule shapes; a proposed rule may be drafted, never published.
 IF fr.schedule_status='confirmed' THEN problems:=array_append(problems,'schedule confirmation is not available until the evaluator defines rule shapes'); END IF;
 IF fr.owner_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=fr.owner_user_id AND g.facility_id=fr.facility_id AND g.revoked_at IS NULL) THEN problems:=array_append(problems,'owner needs current access to this site'); END IF;
 IF fr.backup_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=fr.backup_user_id AND g.facility_id=fr.facility_id AND g.revoked_at IS NULL) THEN problems:=array_append(problems,'backup needs current access to this site'); END IF;
 IF p_effective_from IS NULL THEN problems:=array_append(problems,'effective time is required');
 ELSIF p_effective_from<clock_timestamp()-interval '1 day' THEN problems:=array_append(problems,'effective time cannot rewrite history'); END IF;
 SELECT * INTO latest FROM public.operation_facility_requirements WHERE activity_id=fr.activity_id AND facility_id=fr.facility_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 IF FOUND AND p_effective_from IS NOT NULL AND p_effective_from<=latest.effective_from THEN problems:=array_append(problems,'effective time must follow the latest published site configuration'); END IF;
 RETURN problems;
END $$;
REVOKE ALL ON FUNCTION haven.operation_requirement_problems(public.operation_requirement_versions,timestamptz),haven.operation_facility_requirement_problems(public.operation_facility_requirements,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.save_operation_requirement_draft(p_activity_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; draft public.operation_requirement_versions; k text;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Requirement draft payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('title','wording','procedure','source_authority','subject_kind','allowed_recorder_roles','allowed_reviewer_roles','review_required','required_inputs','required_evidence') THEN
   RAISE EXCEPTION 'Requirement draft field is not editable' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (p_payload ? 'allowed_recorder_roles' AND NOT haven.operation_roles_valid(p_payload->'allowed_recorder_roles'))
  OR (p_payload ? 'allowed_reviewer_roles' AND NOT haven.operation_roles_valid(p_payload->'allowed_reviewer_roles'))
  OR (p_payload ? 'required_inputs' AND NOT haven.operation_rule_inputs_valid(p_payload->'required_inputs'))
  OR (p_payload ? 'required_evidence' AND NOT haven.operation_rule_evidence_valid(p_payload->'required_evidence'))
  OR (p_payload ? 'source_authority' AND jsonb_typeof(p_payload->'source_authority')<>'object')
  OR (p_payload ? 'review_required' AND jsonb_typeof(p_payload->'review_required')<>'boolean')
  OR (p_payload ? 'subject_kind' AND p_payload->>'subject_kind' NOT IN('facility','resident','employee','asset')) THEN
  RAISE EXCEPTION 'Requirement draft contains an invalid rule' USING ERRCODE='22023';
 END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=p_activity_id AND organization_id=haven.organization_id() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Requirement activity unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(activity.organization_id,NULL);
 SELECT * INTO draft FROM public.operation_requirement_versions WHERE activity_id=activity.id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN
  -- A new draft starts from the latest published version so a revision changes
  -- only what the administrator changes; nothing silently resets.
  INSERT INTO public.operation_requirement_versions(organization_id,activity_id,version,subject_kind,created_by,title,wording,procedure,source_authority,
   allowed_recorder_roles,allowed_reviewer_roles,review_required,required_inputs,required_evidence)
  SELECT activity.organization_id,activity.id,(SELECT coalesce(max(version),0)+1 FROM public.operation_requirement_versions WHERE activity_id=activity.id),
   coalesce(c.subject_kind,activity.subject_kind),auth.uid(),c.title,c.wording,c.procedure,coalesce(c.source_authority,'{}'::jsonb),
   coalesce(c.allowed_recorder_roles,'{}'),coalesce(c.allowed_reviewer_roles,'{}'),coalesce(c.review_required,false),coalesce(c.required_inputs,'[]'::jsonb),coalesce(c.required_evidence,'[]'::jsonb)
  FROM (SELECT 1) seed LEFT JOIN LATERAL (SELECT * FROM public.operation_requirement_versions l WHERE l.activity_id=activity.id AND l.status='published' ORDER BY l.effective_from DESC LIMIT 1) c ON true
  RETURNING * INTO draft;
 END IF;
 UPDATE public.operation_requirement_versions SET
  title=CASE WHEN p_payload ? 'title' THEN nullif(btrim(p_payload->>'title'),'') ELSE title END,
  wording=CASE WHEN p_payload ? 'wording' THEN nullif(btrim(p_payload->>'wording'),'') ELSE wording END,
  procedure=CASE WHEN p_payload ? 'procedure' THEN nullif(btrim(p_payload->>'procedure'),'') ELSE procedure END,
  source_authority=CASE WHEN p_payload ? 'source_authority' THEN p_payload->'source_authority' ELSE source_authority END,
  subject_kind=CASE WHEN p_payload ? 'subject_kind' THEN p_payload->>'subject_kind' ELSE subject_kind END,
  allowed_recorder_roles=CASE WHEN p_payload ? 'allowed_recorder_roles' THEN (SELECT coalesce(array_agg(x::public.app_role),'{}') FROM jsonb_array_elements_text(p_payload->'allowed_recorder_roles') x) ELSE allowed_recorder_roles END,
  allowed_reviewer_roles=CASE WHEN p_payload ? 'allowed_reviewer_roles' THEN (SELECT coalesce(array_agg(x::public.app_role),'{}') FROM jsonb_array_elements_text(p_payload->'allowed_reviewer_roles') x) ELSE allowed_reviewer_roles END,
  review_required=CASE WHEN p_payload ? 'review_required' THEN (p_payload->>'review_required')::boolean ELSE review_required END,
  required_inputs=CASE WHEN p_payload ? 'required_inputs' THEN p_payload->'required_inputs' ELSE required_inputs END,
  required_evidence=CASE WHEN p_payload ? 'required_evidence' THEN p_payload->'required_evidence' ELSE required_evidence END
 WHERE id=draft.id RETURNING * INTO draft;
 PERFORM haven.assert_operation_requirement_actor(activity.organization_id,NULL);
 RETURN to_jsonb(draft);
END $$;

CREATE FUNCTION haven.preview_operation_requirement_publication(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE draft public.operation_requirement_versions; latest public.operation_requirement_versions; in_force uuid; problems text[]; configs jsonb; retained bigint; conflicts bigint;
BEGIN
 SELECT * INTO draft FROM public.operation_requirement_versions WHERE id=p_draft_id AND status='draft' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Requirement draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,NULL);
 problems:=haven.operation_requirement_problems(draft,p_effective_from);
 SELECT * INTO latest FROM public.operation_requirement_versions WHERE activity_id=draft.activity_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 in_force:=haven.operation_requirement_in_force(draft.activity_id,clock_timestamp());
 SELECT jsonb_build_object('total',count(*),'applicable',count(*) FILTER(WHERE applicability='applicable'),
  'not_applicable',count(*) FILTER(WHERE applicability='not_applicable'),'needs_confirmation',count(*) FILTER(WHERE applicability='needs_confirmation'))
 INTO configs FROM public.operation_facility_requirements WHERE activity_id=draft.activity_id AND status='published' AND effective_to IS NULL;
 -- Sites whose local recorder roles would no longer constrain the new central rule.
 SELECT count(*) INTO conflicts FROM public.operation_facility_requirements WHERE activity_id=draft.activity_id AND status='published' AND effective_to IS NULL
  AND local_allowed_recorder_roles IS NOT NULL AND NOT (local_allowed_recorder_roles <@ draft.allowed_recorder_roles);
 -- Occurrences that already snapshot the latest version keep it after publication.
 SELECT count(*) INTO retained FROM public.operation_task_instances WHERE latest.id IS NOT NULL AND requirement_version_id=latest.id
  AND p_effective_from IS NOT NULL AND assigned_shift_date>=p_effective_from::date;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,NULL);
 RETURN jsonb_build_object('draft_id',draft.id,'activity_id',draft.activity_id,'next_version',draft.version,
  'in_force_version_id',in_force,'latest_version_id',latest.id,'latest_version',latest.version,'latest_effective_from',latest.effective_from,'effective_from',p_effective_from,
  'publishable',coalesce(cardinality(problems),0)=0,'problems',to_jsonb(problems),
  'facility_configurations',configs,'facility_role_conflicts',conflicts,'future_occurrences_keeping_latest_snapshot',retained);
END $$;

CREATE FUNCTION haven.publish_operation_requirement_version(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE draft public.operation_requirement_versions; open_row public.operation_requirement_versions; problems text[];
BEGIN
 SELECT * INTO draft FROM public.operation_requirement_versions WHERE id=p_draft_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Requirement draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,NULL);
 SELECT * INTO open_row FROM public.operation_requirement_versions WHERE activity_id=draft.activity_id AND status='published' AND effective_to IS NULL FOR UPDATE;
 problems:=haven.operation_requirement_problems(draft,p_effective_from);
 IF coalesce(cardinality(problems),0)>0 THEN RAISE EXCEPTION 'Requirement version is not publishable: %',problems[1] USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_requirement_publish','approved',true);
 IF open_row.id IS NOT NULL THEN
  UPDATE public.operation_requirement_versions SET effective_to=p_effective_from WHERE id=open_row.id;
 END IF;
 UPDATE public.operation_requirement_versions SET status='published',effective_from=p_effective_from,published_by=auth.uid(),
  published_at=clock_timestamp(),previous_version_id=open_row.id WHERE id=draft.id RETURNING * INTO draft;
 PERFORM set_config('haven.operation_requirement_publish','',true);
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,NULL);
 RETURN to_jsonb(draft);
END $$;

CREATE FUNCTION haven.save_operation_facility_requirement_draft(p_activity_id uuid,p_facility_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE activity public.operation_activities; draft public.operation_facility_requirements; k text; org uuid:=haven.organization_id();
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Facility requirement draft payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('requirement_version_id','applicability','applicability_reason','override_source','local_procedure','local_allowed_recorder_roles',
   'local_required_inputs','local_required_evidence','owner_role','owner_user_id','backup_role','backup_user_id','schedule_status','schedule_rule') THEN
   RAISE EXCEPTION 'Facility requirement draft field is not editable' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (p_payload ? 'applicability' AND p_payload->>'applicability' NOT IN('applicable','not_applicable','needs_confirmation'))
  OR (p_payload ? 'override_source' AND p_payload->>'override_source' NOT IN('central','admin_log','interview','facility_policy','regulator','other'))
  OR (p_payload ? 'schedule_status' AND p_payload->>'schedule_status' NOT IN('needs_confirmation','confirmed'))
  OR (p_payload ? 'schedule_rule' AND jsonb_typeof(p_payload->'schedule_rule') NOT IN('object','null'))
  OR (p_payload ? 'local_allowed_recorder_roles' AND jsonb_typeof(p_payload->'local_allowed_recorder_roles')<>'null' AND NOT haven.operation_roles_valid(p_payload->'local_allowed_recorder_roles'))
  OR (p_payload ? 'local_required_inputs' AND jsonb_typeof(p_payload->'local_required_inputs')<>'null' AND NOT haven.operation_rule_inputs_valid(p_payload->'local_required_inputs'))
  OR (p_payload ? 'local_required_evidence' AND jsonb_typeof(p_payload->'local_required_evidence')<>'null' AND NOT haven.operation_rule_evidence_valid(p_payload->'local_required_evidence'))
  OR (p_payload ? 'owner_role' AND jsonb_typeof(p_payload->'owner_role')<>'null' AND NOT haven.operation_roles_valid(jsonb_build_array(p_payload->'owner_role')))
  OR (p_payload ? 'backup_role' AND jsonb_typeof(p_payload->'backup_role')<>'null' AND NOT haven.operation_roles_valid(jsonb_build_array(p_payload->'backup_role'))) THEN
  RAISE EXCEPTION 'Facility requirement draft contains an invalid value' USING ERRCODE='22023';
 END IF;
 SELECT * INTO activity FROM public.operation_activities WHERE id=p_activity_id AND organization_id=org AND (facility_id IS NULL OR facility_id=p_facility_id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement activity unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(activity.organization_id,p_facility_id);
 SELECT * INTO draft FROM public.operation_facility_requirements WHERE activity_id=activity.id AND facility_id=p_facility_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN
  -- A new site draft starts from the latest published configuration.
  INSERT INTO public.operation_facility_requirements(organization_id,facility_id,activity_id,version,created_by,requirement_version_id,applicability,applicability_reason,
   override_source,local_procedure,local_allowed_recorder_roles,local_required_inputs,local_required_evidence,owner_role,owner_user_id,backup_role,backup_user_id,schedule_status,schedule_rule)
  SELECT activity.organization_id,p_facility_id,activity.id,(SELECT coalesce(max(version),0)+1 FROM public.operation_facility_requirements WHERE activity_id=activity.id AND facility_id=p_facility_id),
   auth.uid(),c.requirement_version_id,coalesce(c.applicability,'needs_confirmation'),c.applicability_reason,coalesce(c.override_source,'central'),c.local_procedure,
   c.local_allowed_recorder_roles,c.local_required_inputs,c.local_required_evidence,c.owner_role,c.owner_user_id,c.backup_role,c.backup_user_id,coalesce(c.schedule_status,'needs_confirmation'),c.schedule_rule
  FROM (SELECT 1) seed LEFT JOIN LATERAL (SELECT * FROM public.operation_facility_requirements l WHERE l.activity_id=activity.id AND l.facility_id=p_facility_id AND l.status='published' ORDER BY l.effective_from DESC LIMIT 1) c ON true
  RETURNING * INTO draft;
 END IF;
 -- A confirmed schedule without a rule is a contradiction, reported plainly
 -- rather than through the table constraint.
 IF coalesce(p_payload->>'schedule_status',draft.schedule_status)='confirmed'
  AND (CASE WHEN p_payload ? 'schedule_rule' THEN nullif(p_payload->'schedule_rule','null'::jsonb) ELSE draft.schedule_rule END) IS NULL THEN
  RAISE EXCEPTION 'Facility requirement draft contains an invalid value: a confirmed schedule requires a rule' USING ERRCODE='22023';
 END IF;
 UPDATE public.operation_facility_requirements SET
  requirement_version_id=CASE WHEN p_payload ? 'requirement_version_id' THEN (p_payload->>'requirement_version_id')::uuid ELSE requirement_version_id END,
  applicability=CASE WHEN p_payload ? 'applicability' THEN p_payload->>'applicability' ELSE applicability END,
  applicability_reason=CASE WHEN p_payload ? 'applicability_reason' THEN nullif(btrim(p_payload->>'applicability_reason'),'') ELSE applicability_reason END,
  override_source=CASE WHEN p_payload ? 'override_source' THEN p_payload->>'override_source' ELSE override_source END,
  local_procedure=CASE WHEN p_payload ? 'local_procedure' THEN nullif(btrim(p_payload->>'local_procedure'),'') ELSE local_procedure END,
  local_allowed_recorder_roles=CASE WHEN p_payload ? 'local_allowed_recorder_roles' THEN
   CASE WHEN jsonb_typeof(p_payload->'local_allowed_recorder_roles')='null' THEN NULL ELSE (SELECT coalesce(array_agg(x::public.app_role),'{}') FROM jsonb_array_elements_text(p_payload->'local_allowed_recorder_roles') x) END
   ELSE local_allowed_recorder_roles END,
  local_required_inputs=CASE WHEN p_payload ? 'local_required_inputs' THEN nullif(p_payload->'local_required_inputs','null'::jsonb) ELSE local_required_inputs END,
  local_required_evidence=CASE WHEN p_payload ? 'local_required_evidence' THEN nullif(p_payload->'local_required_evidence','null'::jsonb) ELSE local_required_evidence END,
  owner_role=CASE WHEN p_payload ? 'owner_role' THEN (p_payload->>'owner_role')::public.app_role ELSE owner_role END,
  owner_user_id=CASE WHEN p_payload ? 'owner_user_id' THEN (p_payload->>'owner_user_id')::uuid ELSE owner_user_id END,
  backup_role=CASE WHEN p_payload ? 'backup_role' THEN (p_payload->>'backup_role')::public.app_role ELSE backup_role END,
  backup_user_id=CASE WHEN p_payload ? 'backup_user_id' THEN (p_payload->>'backup_user_id')::uuid ELSE backup_user_id END,
  schedule_status=CASE WHEN p_payload ? 'schedule_status' THEN p_payload->>'schedule_status' ELSE schedule_status END,
  schedule_rule=CASE WHEN p_payload ? 'schedule_rule' THEN nullif(p_payload->'schedule_rule','null'::jsonb) ELSE schedule_rule END
 WHERE id=draft.id RETURNING * INTO draft;
 PERFORM haven.assert_operation_requirement_actor(activity.organization_id,p_facility_id);
 RETURN to_jsonb(draft);
END $$;

CREATE FUNCTION haven.preview_operation_facility_requirement_publication(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE draft public.operation_facility_requirements; latest public.operation_facility_requirements; in_force public.operation_facility_requirements; problems text[]; retained bigint;
BEGIN
 SELECT * INTO draft FROM public.operation_facility_requirements WHERE id=p_draft_id AND status='draft' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 problems:=haven.operation_facility_requirement_problems(draft,p_effective_from);
 SELECT * INTO latest FROM public.operation_facility_requirements WHERE activity_id=draft.activity_id AND facility_id=draft.facility_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 SELECT * INTO in_force FROM public.operation_facility_requirements WHERE id=haven.operation_facility_requirement_in_force(draft.activity_id,draft.facility_id,clock_timestamp());
 SELECT count(*) INTO retained FROM public.operation_task_instances WHERE latest.id IS NOT NULL AND facility_requirement_id=latest.id
  AND p_effective_from IS NOT NULL AND assigned_shift_date>=p_effective_from::date;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 RETURN jsonb_build_object('draft_id',draft.id,'activity_id',draft.activity_id,'facility_id',draft.facility_id,'next_version',draft.version,
  'in_force_configuration_id',in_force.id,'in_force_applicability',in_force.applicability,'latest_configuration_id',latest.id,'latest_applicability',latest.applicability,
  'proposed_applicability',draft.applicability,'in_force_schedule_status',in_force.schedule_status,'proposed_schedule_status',draft.schedule_status,'effective_from',p_effective_from,
  'publishable',coalesce(cardinality(problems),0)=0,'problems',to_jsonb(problems),'future_occurrences_keeping_latest_snapshot',retained);
END $$;

CREATE FUNCTION haven.publish_operation_facility_requirement(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE draft public.operation_facility_requirements; open_row public.operation_facility_requirements; problems text[];
BEGIN
 SELECT * INTO draft FROM public.operation_facility_requirements WHERE id=p_draft_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 IF draft.requirement_version_id IS NOT NULL THEN PERFORM 1 FROM public.operation_requirement_versions WHERE id=draft.requirement_version_id FOR SHARE; END IF;
 SELECT * INTO open_row FROM public.operation_facility_requirements WHERE activity_id=draft.activity_id AND facility_id=draft.facility_id AND status='published' AND effective_to IS NULL FOR UPDATE;
 problems:=haven.operation_facility_requirement_problems(draft,p_effective_from);
 IF coalesce(cardinality(problems),0)>0 THEN RAISE EXCEPTION 'Facility requirement is not publishable: %',problems[1] USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_requirement_publish','approved',true);
 IF open_row.id IS NOT NULL THEN
  UPDATE public.operation_facility_requirements SET effective_to=p_effective_from WHERE id=open_row.id;
 END IF;
 UPDATE public.operation_facility_requirements SET status='published',effective_from=p_effective_from,approved_by=auth.uid(),
  approved_at=clock_timestamp(),previous_version_id=open_row.id WHERE id=draft.id RETURNING * INTO draft;
 PERFORM set_config('haven.operation_requirement_publish','',true);
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 RETURN to_jsonb(draft);
END $$;

-- Public invoker wrappers; implementations stay private with pinned search paths.
CREATE FUNCTION public.save_operation_requirement_draft_review(p_activity_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.save_operation_requirement_draft(p_activity_id,p_payload) $$;
CREATE FUNCTION public.preview_operation_requirement_review(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.preview_operation_requirement_publication(p_draft_id,p_effective_from) $$;
CREATE FUNCTION public.publish_operation_requirement_review(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.publish_operation_requirement_version(p_draft_id,p_effective_from) $$;
CREATE FUNCTION public.save_operation_facility_requirement_draft_review(p_activity_id uuid,p_facility_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.save_operation_facility_requirement_draft(p_activity_id,p_facility_id,p_payload) $$;
CREATE FUNCTION public.preview_operation_facility_requirement_review(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.preview_operation_facility_requirement_publication(p_draft_id,p_effective_from) $$;
CREATE FUNCTION public.publish_operation_facility_requirement_review(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.publish_operation_facility_requirement(p_draft_id,p_effective_from) $$;

REVOKE ALL ON FUNCTION
 haven.save_operation_requirement_draft(uuid,jsonb),haven.preview_operation_requirement_publication(uuid,timestamptz),haven.publish_operation_requirement_version(uuid,timestamptz),
 haven.save_operation_facility_requirement_draft(uuid,uuid,jsonb),haven.preview_operation_facility_requirement_publication(uuid,timestamptz),haven.publish_operation_facility_requirement(uuid,timestamptz),
 public.save_operation_requirement_draft_review(uuid,jsonb),public.preview_operation_requirement_review(uuid,timestamptz),public.publish_operation_requirement_review(uuid,timestamptz),
 public.save_operation_facility_requirement_draft_review(uuid,uuid,jsonb),public.preview_operation_facility_requirement_review(uuid,timestamptz),public.publish_operation_facility_requirement_review(uuid,timestamptz)
 FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION
 haven.save_operation_requirement_draft(uuid,jsonb),haven.preview_operation_requirement_publication(uuid,timestamptz),haven.publish_operation_requirement_version(uuid,timestamptz),
 haven.save_operation_facility_requirement_draft(uuid,uuid,jsonb),haven.preview_operation_facility_requirement_publication(uuid,timestamptz),haven.publish_operation_facility_requirement(uuid,timestamptz),
 public.save_operation_requirement_draft_review(uuid,jsonb),public.preview_operation_requirement_review(uuid,timestamptz),public.publish_operation_requirement_review(uuid,timestamptz),
 public.save_operation_facility_requirement_draft_review(uuid,uuid,jsonb),public.preview_operation_facility_requirement_review(uuid,timestamptz),public.publish_operation_facility_requirement_review(uuid,timestamptz)
 TO authenticated;

COMMENT ON TABLE public.operation_requirement_versions IS 'COL-135: effective-dated, immutable central requirement versions per stable activity. A published row governs only inside its effective window; drafts never govern work.';
COMMENT ON TABLE public.operation_facility_requirements IS 'COL-135: effective-dated site applicability, local constraints, owner/backup and independent schedule-confirmation state. needs_confirmation is an explicit state, not a default rule; schedule confirmation cannot be published until the evaluator defines rule shapes.';

COMMIT;
