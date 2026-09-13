BEGIN;

-- COL-144 / HFO-14: problems, next actions, backup ownership and resolution
-- on the COL-142 issue identity. An issue moves through open, assigned,
-- waiting and resolved only through session commands that lock current site,
-- subject and actor authority, replay by request key and content, refuse a
-- stale issue revision, and append an immutable event with the actor, the
-- expected revision and the details of every transition. Owners and backups
-- are explicit assignments of a current site member or a role; a backup
-- covers only when the owner is no longer current or with a stated reason,
-- and the backlog shows unassigned, waiting, reassigned and uncovered work
-- at read time. Resolving records a summary and may cite a readable receipt
-- on the same subject; reopening clears the resolution on the row and keeps
-- it verbatim in the event history. Problem status is independent of
-- performance: no command here touches a receipt or an occurrence beyond an
-- audit row on the linked task.
-- This migration assigns nothing, resolves nothing, sends no notification,
-- infers no coverage from a role name (Q02 open) and sets no urgency or
-- escalation rule (Q29 open).

-- ---------------------------------------------------------------------------
-- Lifecycle columns on the issue. The 341 status check (open only) is
-- replaced; every existing row is open and satisfies the new shape.
-- ---------------------------------------------------------------------------
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_issues'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%(status = %';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.operation_issues DROP CONSTRAINT %I',c); END IF;
END $$;
ALTER TABLE public.operation_issues
 ADD COLUMN owner_user_id uuid REFERENCES public.user_profiles(id),
 ADD COLUMN owner_role public.app_role,
 ADD COLUMN backup_user_id uuid REFERENCES public.user_profiles(id),
 ADD COLUMN backup_role public.app_role,
 ADD COLUMN assigned_at timestamptz,
 ADD COLUMN accepted_at timestamptz,
 ADD COLUMN accepted_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN waiting_reason text CHECK(waiting_reason IS NULL OR length(btrim(waiting_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN follow_up_at timestamptz,
 ADD COLUMN resolved_at timestamptz,
 ADD COLUMN resolved_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN resolution_summary text CHECK(resolution_summary IS NULL OR length(btrim(resolution_summary)) BETWEEN 1 AND 4000),
 ADD COLUMN resolution_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN reopen_count integer NOT NULL DEFAULT 0 CHECK(reopen_count>=0),
 ADD COLUMN issue_revision text,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.operation_issues ADD CONSTRAINT operation_issues_status_check CHECK(status IN('open','assigned','waiting','resolved'));
ALTER TABLE public.operation_issues ADD CONSTRAINT operation_issue_lifecycle_shape CHECK(
 (status='open' AND owner_user_id IS NULL AND owner_role IS NULL AND backup_user_id IS NULL AND backup_role IS NULL AND accepted_at IS NULL AND accepted_by IS NULL
  AND waiting_reason IS NULL AND follow_up_at IS NULL AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_summary IS NULL AND resolution_receipt_id IS NULL)
 OR (status='assigned' AND (owner_user_id IS NOT NULL OR owner_role IS NOT NULL) AND waiting_reason IS NULL AND follow_up_at IS NULL AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_summary IS NULL AND resolution_receipt_id IS NULL)
 OR (status='waiting' AND waiting_reason IS NOT NULL AND follow_up_at IS NOT NULL AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_summary IS NULL AND resolution_receipt_id IS NULL)
 OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_summary IS NOT NULL AND waiting_reason IS NULL AND follow_up_at IS NULL));
ALTER TABLE public.operation_issues ADD CONSTRAINT operation_issue_acceptance_shape CHECK((accepted_at IS NULL)=(accepted_by IS NULL));
CREATE INDEX idx_operation_issues_owner ON public.operation_issues(owner_user_id,status) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_operation_issues_follow_up ON public.operation_issues(facility_id,follow_up_at) WHERE status='waiting';

-- ---------------------------------------------------------------------------
-- Immutable lifecycle events: the history behind the issue row's projection.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_issue_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 issue_id uuid NOT NULL REFERENCES public.operation_issues(id),
 event_kind text NOT NULL CHECK(event_kind IN('assigned','reassigned','accepted','covered','waiting','resumed','resolved','reopened','linked')),
 from_status text NOT NULL CHECK(from_status IN('open','assigned','waiting','resolved')),
 to_status text NOT NULL CHECK(to_status IN('open','assigned','waiting','resolved')),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_role text NOT NULL,
 expected_revision text NOT NULL,
 request_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 -- Ordering key: the statement clock and a monotonic sequence, because two
 -- events of one transaction would share now() and random ids do not order.
 event_seq bigint GENERATED ALWAYS AS IDENTITY,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_operation_issue_events_issue ON public.operation_issue_events(issue_id,event_seq);
ALTER TABLE public.operation_issue_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_issue_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_issue_events TO authenticated,service_role;
-- An event is readable exactly when its issue is.
CREATE POLICY operation_issue_events_read ON public.operation_issue_events FOR SELECT TO authenticated USING(
 organization_id=haven.organization_id() AND EXISTS(SELECT 1 FROM public.operation_issues i WHERE i.id=issue_id AND i.organization_id=haven.organization_id()
  AND CASE WHEN i.task_instance_id IS NOT NULL THEN haven.operation_task_readable(i.task_instance_id)
   ELSE haven.operation_subject_accessible(i.subject_id,i.organization_id,i.facility_id,i.authority_class) END));
CREATE TRIGGER operation_issue_events_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_issue_events
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_issue_events_no_truncate BEFORE TRUNCATE ON public.operation_issue_events
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE POLICY operation_issue_event_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name<>'operation_issue_events');

CREATE FUNCTION haven.guard_operation_issue_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Issue events are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the issue commands' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_issue_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_issue_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_issue_events
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_issue_event();

-- The 341 issue guard keeps its intent (no delete, no write without the
-- token, the receipt link set once) and now lets the lifecycle columns move
-- under the token while the identity stays immutable. Every write rotates
-- the revision clients echo back.
CREATE OR REPLACE FUNCTION haven.guard_operation_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issues are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the issue commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.activity_id,NEW.subject_id,NEW.authority_class,NEW.task_instance_id,NEW.issue_kind,NEW.summary,NEW.severity,NEW.reported_by,NEW.reported_role,NEW.reported_at,NEW.request_key,NEW.request_hash,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.activity_id,OLD.subject_id,OLD.authority_class,OLD.task_instance_id,OLD.issue_kind,OLD.summary,OLD.severity,OLD.reported_by,OLD.reported_role,OLD.reported_at,OLD.request_key,OLD.request_hash,OLD.created_at) THEN
   RAISE EXCEPTION 'Issue identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.receipt_id IS NOT NULL AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id THEN RAISE EXCEPTION 'Issue receipt link is set once' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.issue_revision:=haven.operation_occurrence_revision();
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
-- Existing rows (none on a fresh replay) receive a revision under the token.
DO $$ BEGIN
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET issue_revision=haven.operation_occurrence_revision() WHERE issue_revision IS NULL;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
ALTER TABLE public.operation_issues ALTER COLUMN issue_revision SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Currentness of an owner or backup at read time: an active, undeleted member
-- of the organisation with a current site grant; a role counts when any such
-- member holds it. Answers only inside the caller's own organisation and a
-- site the caller currently holds (NULL otherwise), so the helpers are not a
-- membership oracle for other sites.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_issue_user_current(p_user uuid,p_org uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_org IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(p_facility) THEN NULL
  WHEN p_user IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM public.user_profiles p JOIN public.user_facility_access g ON g.user_id=p.id AND g.facility_id=p_facility AND g.organization_id=p_org
  WHERE p.id=p_user AND p.organization_id=p_org AND p.is_active AND p.deleted_at IS NULL AND g.revoked_at IS NULL AND (g.operation_expires_at IS NULL OR g.operation_expires_at>clock_timestamp())) END
$$;
CREATE FUNCTION haven.operation_issue_owner_current(p_user uuid,p_role public.app_role,p_org uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_org IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(p_facility) THEN NULL
  WHEN p_user IS NOT NULL THEN haven.operation_issue_user_current(p_user,p_org,p_facility)
  WHEN p_role IS NOT NULL THEN EXISTS(SELECT 1 FROM public.user_profiles p JOIN public.user_facility_access g ON g.user_id=p.id AND g.facility_id=p_facility AND g.organization_id=p_org
   WHERE p.organization_id=p_org AND p.app_role=p_role AND p.is_active AND p.deleted_at IS NULL AND g.revoked_at IS NULL AND (g.operation_expires_at IS NULL OR g.operation_expires_at>clock_timestamp()))
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION haven.operation_issue_user_current(uuid,uuid,uuid),haven.operation_issue_owner_current(uuid,public.app_role,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_issue_user_current(uuid,uuid,uuid),haven.operation_issue_owner_current(uuid,public.app_role,uuid,uuid) TO authenticated,service_role;

-- The reachable backlog: every unresolved issue the reader may see, with the
-- owner and backup currentness, an overdue follow-up flag, the linked
-- occurrence's execution state and the last lifecycle event. Invoker view;
-- the issue, occurrence and event policies apply.
CREATE VIEW public.operation_issue_backlog WITH (security_invoker=true) AS
 SELECT i.id,i.organization_id,i.facility_id,i.activity_id,i.subject_id,i.authority_class,i.task_instance_id,i.receipt_id,i.issue_kind,i.summary,i.severity,i.status,
  i.reported_by,i.reported_role,i.reported_at,i.owner_user_id,i.owner_role,i.backup_user_id,i.backup_role,i.assigned_at,i.accepted_at,i.accepted_by,i.waiting_reason,i.follow_up_at,
  i.reopen_count,i.issue_revision,i.updated_at,
  haven.operation_issue_owner_current(i.owner_user_id,i.owner_role,i.organization_id,i.facility_id) AS owner_current,
  haven.operation_issue_owner_current(i.backup_user_id,i.backup_role,i.organization_id,i.facility_id) AS backup_current,
  (i.status='waiting' AND i.follow_up_at<clock_timestamp()) AS follow_up_overdue,
  t.status AS occurrence_status,t.execution_state,
  e.event_kind AS last_event_kind,e.created_at AS last_event_at
 FROM public.operation_issues i
 LEFT JOIN public.operation_task_instances t ON t.id=i.task_instance_id
 LEFT JOIN LATERAL (SELECT ev.event_kind,ev.created_at FROM public.operation_issue_events ev WHERE ev.issue_id=i.id ORDER BY ev.event_seq DESC LIMIT 1) e ON true
 WHERE i.status<>'resolved';
REVOKE ALL ON public.operation_issue_backlog FROM PUBLIC,anon;
GRANT SELECT ON public.operation_issue_backlog TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Issue authority: lock the issue, its linked occurrence and template links,
-- the native subject, the site, the actor's grants and session, then require
-- current site and subject authority. Nothing about the issue is disclosed
-- before that; missing and unauthorised share one wording.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.lock_operation_issue_authority(p_issue uuid) RETURNS public.operation_issues
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; t public.operation_task_instances; linked public.operation_task_templates; s public.operation_activity_subjects; actor record;
BEGIN
 SELECT * INTO i FROM public.operation_issues WHERE id=p_issue FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.task_instance_id IS NOT NULL THEN
  SELECT * INTO t FROM public.operation_task_instances WHERE id=i.task_instance_id FOR SHARE;
  IF t.template_id IS NOT NULL THEN
   SELECT * INTO linked FROM public.operation_task_templates WHERE id=t.template_id FOR SHARE;
   IF linked.asset_ref IS NOT NULL THEN PERFORM 1 FROM public.facility_assets WHERE id=linked.asset_ref FOR SHARE; END IF;
   IF linked.vendor_booking_ref IS NOT NULL THEN
    PERFORM 1 FROM public.vendors WHERE id=linked.vendor_booking_ref FOR SHARE;
    PERFORM 1 FROM public.vendor_facilities WHERE vendor_id=linked.vendor_booking_ref AND facility_id=t.facility_id FOR SHARE;
   END IF;
  END IF;
 END IF;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=i.subject_id;
 IF s.subject_kind='resident' THEN PERFORM 1 FROM public.residents WHERE id=s.resident_id FOR SHARE;
 ELSIF s.subject_kind='employee' THEN PERFORM 1 FROM public.staff WHERE id=s.employee_id FOR SHARE;
 ELSIF s.subject_kind='asset' THEN PERFORM 1 FROM public.facility_assets WHERE id=s.asset_id FOR SHARE; END IF;
 PERFORM 1 FROM public.facilities WHERE id=i.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=i.facility_id FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id=auth.uid() AND facility_id=i.facility_id FOR SHARE;
 PERFORM 1 FROM public.employee_medical_access WHERE user_id=auth.uid() AND facility_id=i.facility_id FOR SHARE;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
  WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 SELECT * INTO actor FROM haven.current_authorized_actor();
 IF actor.actor_is_managed IS NOT TRUE OR i.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.operation_facility_access(i.facility_id)
  OR NOT haven.operation_subject_accessible(i.subject_id,i.organization_id,i.facility_id,i.authority_class)
  OR (i.task_instance_id IS NOT NULL AND NOT haven.operation_task_readable(i.task_instance_id)) THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501';
 END IF;
 RETURN i;
END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_issue_authority(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Owners and backups come from the operations roles that site authority
-- admits; a family or broker profile is never an owner or a backup.
CREATE FUNCTION haven.operation_issue_role_allowed(p_role public.app_role) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_role::text IN('housekeeper','owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')
$$;
CREATE FUNCTION haven.operation_issue_user_role_allowed(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=p_user AND haven.operation_issue_role_allowed(p.app_role))
$$;
REVOKE ALL ON FUNCTION haven.operation_issue_role_allowed(public.app_role),haven.operation_issue_user_role_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Actor classes after the lock: manager (the COL-133 broad operations list),
-- owner, backup and reporter. Roles come from the current profile, never from
-- the request.
CREATE FUNCTION haven.operation_issue_actor_classes(i public.operation_issues) RETURNS text[]
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT ARRAY(SELECT c FROM (VALUES
  ('manager',haven.app_role()::text IN('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','dietary','maintenance_role')),
  ('owner',(i.owner_user_id IS NOT NULL AND i.owner_user_id=auth.uid()) OR (i.owner_role IS NOT NULL AND i.owner_role=haven.app_role())),
  ('backup',(i.backup_user_id IS NOT NULL AND i.backup_user_id=auth.uid()) OR (i.backup_role IS NOT NULL AND i.backup_role=haven.app_role())),
  ('reporter',i.reported_by=auth.uid())) v(c,ok) WHERE ok)
$$;
REVOKE ALL ON FUNCTION haven.operation_issue_actor_classes(public.operation_issues) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Shared command mechanics: request shape, replay by key and content, the
-- event append with its audit row on the linked task, and the reply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_issue_request_problem(p_request_key text,p_expected_revision text,p_payload jsonb,p_keys text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RETURN 'A request key is required'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{64}$' THEN RETURN 'An expected issue revision is required'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN 'Issue payload must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF NOT (k=ANY(p_keys)) THEN RETURN 'Issue payload field is not editable'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION haven.operation_issue_text(p_payload jsonb,p_key text,p_max int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_payload->p_key)<>'string' THEN RAISE EXCEPTION '% must be text of at most % characters',p_key,p_max USING ERRCODE='22023'; END IF;
 v:=nullif(btrim(p_payload->>p_key),'');
 IF v IS NOT NULL AND length(v)>p_max THEN RAISE EXCEPTION '% must be text of at most % characters',p_key,p_max USING ERRCODE='22023'; END IF;
 RETURN v;
END $$;
CREATE FUNCTION haven.operation_issue_uuid(p_payload jsonb,p_key text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_payload->p_key)<>'string' THEN RAISE EXCEPTION '% must be a uuid',p_key USING ERRCODE='22023'; END IF;
 RETURN (p_payload->>p_key)::uuid;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION '% must be a uuid',p_key USING ERRCODE='22023'; END $$;
CREATE FUNCTION haven.operation_issue_role(p_payload jsonb,p_key text) RETURNS public.app_role
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_payload->p_key)<>'string' THEN RAISE EXCEPTION '% must be an application role',p_key USING ERRCODE='22023'; END IF;
 RETURN (p_payload->>p_key)::public.app_role;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION '% must be an application role',p_key USING ERRCODE='22023'; END $$;
CREATE FUNCTION haven.operation_issue_request_hash(p_canonical jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_canonical)::text,'UTF8')),'hex')
$$;
-- Replay: the same key with the same content and issue returns the existing
-- event; anything else under that key is a conflict. NULL when unseen.
CREATE FUNCTION haven.operation_issue_replay(p_issue uuid,p_request_key text,p_request_hash text) RETURNS public.operation_issue_events
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e public.operation_issue_events;
BEGIN
 SELECT * INTO e FROM public.operation_issue_events WHERE request_key=p_request_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF e.issue_id=p_issue AND e.request_hash=p_request_hash AND e.actor_id=auth.uid() THEN RETURN e; END IF;
 RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION haven.write_operation_issue_event(before public.operation_issues,after public.operation_issues,p_kind text,p_request_key text,p_request_hash text,p_expected_revision text,p_details jsonb) RETURNS public.operation_issue_events
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE e public.operation_issue_events;
BEGIN
 BEGIN
  INSERT INTO public.operation_issue_events(organization_id,facility_id,issue_id,event_kind,from_status,to_status,actor_id,actor_role,expected_revision,request_key,request_hash,details)
  VALUES(after.organization_id,after.facility_id,after.id,p_kind,before.status,after.status,auth.uid(),haven.app_role()::text,p_expected_revision,p_request_key,p_request_hash,coalesce(p_details,'{}'::jsonb)) RETURNING * INTO e;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 IF after.task_instance_id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  SELECT after.organization_id,after.facility_id,after.task_instance_id,'updated',t.status,t.status,auth.uid(),haven.app_role()::text,'issue '||p_kind,
   jsonb_build_object('issue_id',after.id,'issue_event_id',e.id,'event_kind',p_kind,'issue_from_status',before.status,'issue_to_status',after.status,'request_key',p_request_key)
  FROM public.operation_task_instances t WHERE t.id=after.task_instance_id;
 END IF;
 RETURN e;
END $$;
CREATE FUNCTION haven.operation_issue_reply(i public.operation_issues,e public.operation_issue_events,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT jsonb_build_object('issue',to_jsonb(i),'event',to_jsonb(e),'replayed',p_replayed) $$;
REVOKE ALL ON FUNCTION haven.operation_issue_request_problem(text,text,jsonb,text[]),haven.operation_issue_text(jsonb,text,int),haven.operation_issue_uuid(jsonb,text),haven.operation_issue_role(jsonb,text),
 haven.operation_issue_request_hash(jsonb),haven.operation_issue_replay(uuid,text,text),haven.write_operation_issue_event(public.operation_issues,public.operation_issues,text,text,text,text,jsonb),
 haven.operation_issue_reply(public.operation_issues,public.operation_issue_events,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Commands (session). Order in each: shape → lock → replay → revision →
-- actor class → transition → write under the token → re-lock → reply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.assign_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text;
 v_owner_user uuid; v_owner_role public.app_role; v_backup_user uuid; v_backup_role public.app_role; note text; kind text; acceptance_kept boolean;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['owner_user_id','owner_role','backup_user_id','backup_role','note']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 v_owner_user:=haven.operation_issue_uuid(p_payload,'owner_user_id'); v_owner_role:=haven.operation_issue_role(p_payload,'owner_role');
 v_backup_user:=haven.operation_issue_uuid(p_payload,'backup_user_id'); v_backup_role:=haven.operation_issue_role(p_payload,'backup_role');
 note:=haven.operation_issue_text(p_payload,'note',2000);
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','assign','issue',p_issue,'owner_user_id',v_owner_user,'owner_role',v_owner_role,'backup_user_id',v_backup_user,'backup_role',v_backup_role,'note',note));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF v_owner_user IS NULL AND v_owner_role IS NULL THEN RAISE EXCEPTION 'An owner user or role is required' USING ERRCODE='22023'; END IF;
 -- Owners and backups are operations roles (the list haven.operation_facility_access enforces), never family or broker.
 IF v_owner_role IS NOT NULL AND NOT haven.operation_issue_role_allowed(v_owner_role) THEN RAISE EXCEPTION 'Owner role must be an operations role' USING ERRCODE='22023'; END IF;
 IF v_backup_role IS NOT NULL AND NOT haven.operation_issue_role_allowed(v_backup_role) THEN RAISE EXCEPTION 'Backup role must be an operations role' USING ERRCODE='22023'; END IF;
 IF v_owner_user IS NOT NULL AND NOT (coalesce(haven.operation_issue_user_current(v_owner_user,i.organization_id,i.facility_id),false) AND haven.operation_issue_user_role_allowed(v_owner_user)) THEN RAISE EXCEPTION 'Owner is not current staff at this site' USING ERRCODE='22023'; END IF;
 IF v_backup_user IS NOT NULL AND NOT (coalesce(haven.operation_issue_user_current(v_backup_user,i.organization_id,i.facility_id),false) AND haven.operation_issue_user_role_allowed(v_backup_user)) THEN RAISE EXCEPTION 'Backup is not current staff at this site' USING ERRCODE='22023'; END IF;
 IF (v_backup_user IS NOT NULL AND v_backup_user=v_owner_user) OR (v_backup_user IS NULL AND v_owner_user IS NULL AND v_backup_role IS NOT NULL AND v_backup_role=v_owner_role) THEN
  RAISE EXCEPTION 'Backup must differ from the owner' USING ERRCODE='22023'; END IF;
 IF i.status='resolved' THEN RAISE EXCEPTION 'Issue is resolved' USING ERRCODE='P0001'; END IF;
 -- The first owner ever named is an assignment even from waiting; reassignment needs a previous owner.
 kind:=CASE WHEN i.owner_user_id IS NULL AND i.owner_role IS NULL THEN 'assigned' ELSE 'reassigned' END;
 -- An acceptance stands only while the accepting person is still the owner, holds the owner role, or is the (new) backup.
 acceptance_kept:=i.accepted_by IS NOT NULL AND (i.accepted_by IS NOT DISTINCT FROM v_owner_user OR i.accepted_by IS NOT DISTINCT FROM v_backup_user
  OR (v_owner_role IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=i.accepted_by AND p.app_role=v_owner_role)));
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET owner_user_id=v_owner_user,owner_role=v_owner_role,backup_user_id=v_backup_user,backup_role=v_backup_role,assigned_at=clock_timestamp(),
  accepted_at=CASE WHEN acceptance_kept THEN accepted_at END,accepted_by=CASE WHEN acceptance_kept THEN accepted_by END,
  status=CASE WHEN status='open' THEN 'assigned' ELSE status END WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,kind,p_request_key,request_hash,p_expected_revision,jsonb_build_object(
  'previous_owner_user_id',before.owner_user_id,'previous_owner_role',before.owner_role,'previous_backup_user_id',before.backup_user_id,'previous_backup_role',before.backup_role,
  'previous_owner_current',haven.operation_issue_owner_current(before.owner_user_id,before.owner_role,i.organization_id,i.facility_id),
  'acceptance_cleared',before.accepted_by IS NOT NULL AND NOT acceptance_kept,'previous_accepted_by',CASE WHEN before.accepted_by IS NOT NULL AND NOT acceptance_kept THEN before.accepted_by END,
  'owner_user_id',v_owner_user,'owner_role',v_owner_role,'backup_user_id',v_backup_user,'backup_role',v_backup_role,'note',note));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

CREATE FUNCTION haven.accept_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; note text; cover_reason text; kind text; owner_current boolean;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['note','cover_reason']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 note:=haven.operation_issue_text(p_payload,'note',2000); cover_reason:=haven.operation_issue_text(p_payload,'cover_reason',2000);
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','accept','issue',p_issue,'note',note,'cover_reason',cover_reason));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('owner'=ANY(classes) OR 'backup'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status<>'assigned' THEN RAISE EXCEPTION 'Issue is not assigned' USING ERRCODE='P0001'; END IF;
 IF 'owner'=ANY(classes) THEN kind:='accepted';
 ELSE
  owner_current:=coalesce(haven.operation_issue_owner_current(i.owner_user_id,i.owner_role,i.organization_id,i.facility_id),false);
  IF owner_current AND cover_reason IS NULL THEN RAISE EXCEPTION 'Covering for a current owner requires cover_reason' USING ERRCODE='22023'; END IF;
  kind:='covered';
 END IF;
 IF i.accepted_by IS NOT NULL AND i.accepted_by=auth.uid() THEN RAISE EXCEPTION 'Issue is already accepted' USING ERRCODE='P0001'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET accepted_at=clock_timestamp(),accepted_by=auth.uid() WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,kind,p_request_key,request_hash,p_expected_revision,jsonb_build_object(
  'previous_accepted_by',before.accepted_by,'previous_accepted_at',before.accepted_at,'owner_current',owner_current,'cover_reason',cover_reason,'note',note));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

CREATE FUNCTION haven.wait_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; reason text; follow_up timestamptz;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['reason','follow_up_at']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 reason:=haven.operation_issue_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A waiting reason is required' USING ERRCODE='22023'; END IF;
 follow_up:=haven.operation_occurrence_timestamp(p_payload->'follow_up_at');
 IF follow_up IS NULL THEN RAISE EXCEPTION 'follow_up_at must be a timestamp' USING ERRCODE='22023'; END IF;
 i:=haven.lock_operation_issue_authority(p_issue);
 -- The instant is hashed as supplied so a replay from another session time zone still matches.
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','wait','issue',p_issue,'reason',reason,'follow_up_at',p_payload->'follow_up_at'));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF follow_up<clock_timestamp() THEN RAISE EXCEPTION 'follow_up_at must be in the future' USING ERRCODE='22023'; END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes) OR 'owner'=ANY(classes) OR 'backup'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status NOT IN('open','assigned') THEN RAISE EXCEPTION 'Issue cannot wait from this state' USING ERRCODE='P0001'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET status='waiting',waiting_reason=reason,follow_up_at=follow_up WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,'waiting',p_request_key,request_hash,p_expected_revision,jsonb_build_object('reason',reason,'follow_up_at',follow_up));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

CREATE FUNCTION haven.resume_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; note text;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['note']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 note:=haven.operation_issue_text(p_payload,'note',2000);
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','resume','issue',p_issue,'note',note));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes) OR 'owner'=ANY(classes) OR 'backup'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status<>'waiting' THEN RAISE EXCEPTION 'Issue is not waiting' USING ERRCODE='P0001'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET status=CASE WHEN owner_user_id IS NOT NULL OR owner_role IS NOT NULL THEN 'assigned' ELSE 'open' END,waiting_reason=NULL,follow_up_at=NULL WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,'resumed',p_request_key,request_hash,p_expected_revision,jsonb_build_object('waiting_reason',before.waiting_reason,'follow_up_at',before.follow_up_at,'note',note));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

-- A resolution may cite a performance receipt on the same activity and
-- subject that the actor may read; an unreadable or foreign receipt is refused
-- with one wording so nothing about other work is disclosed.
CREATE FUNCTION haven.operation_issue_receipt_fits(i public.operation_issues,p_receipt uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.operation_execution_receipts r WHERE r.id=p_receipt AND r.receipt_kind='performance' AND r.organization_id=i.organization_id
  AND r.activity_id=i.activity_id AND r.subject_id=i.subject_id AND haven.operation_task_readable(r.task_instance_id))
$$;
REVOKE ALL ON FUNCTION haven.operation_issue_receipt_fits(public.operation_issues,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.resolve_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; v_summary text; receipt uuid;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['resolution_summary','resolution_receipt_id']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 v_summary:=haven.operation_issue_text(p_payload,'resolution_summary',4000);
 IF v_summary IS NULL THEN RAISE EXCEPTION 'A resolution summary is required' USING ERRCODE='22023'; END IF;
 receipt:=haven.operation_issue_uuid(p_payload,'resolution_receipt_id');
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','resolve','issue',p_issue,'resolution_summary',v_summary,'resolution_receipt_id',receipt));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes) OR 'owner'=ANY(classes) OR 'backup'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status='resolved' THEN RAISE EXCEPTION 'Issue is resolved' USING ERRCODE='P0001'; END IF;
 IF receipt IS NOT NULL AND NOT haven.operation_issue_receipt_fits(i,receipt) THEN RAISE EXCEPTION 'Resolution receipt must be a readable performance receipt for this subject' USING ERRCODE='22023'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid(),resolution_summary=v_summary,resolution_receipt_id=receipt,waiting_reason=NULL,follow_up_at=NULL WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,'resolved',p_request_key,request_hash,p_expected_revision,jsonb_build_object(
  'resolution_summary',v_summary,'resolution_receipt_id',receipt,'waiting_reason',before.waiting_reason,'follow_up_at',before.follow_up_at));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

CREATE FUNCTION haven.reopen_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; reason text;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['reason']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 reason:=haven.operation_issue_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A reopen reason is required' USING ERRCODE='22023'; END IF;
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','reopen','issue',p_issue,'reason',reason));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes) OR 'reporter'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status<>'resolved' THEN RAISE EXCEPTION 'Issue is not resolved' USING ERRCODE='P0001'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET status=CASE WHEN owner_user_id IS NOT NULL OR owner_role IS NOT NULL THEN 'assigned' ELSE 'open' END,
  resolved_at=NULL,resolved_by=NULL,resolution_summary=NULL,resolution_receipt_id=NULL,reopen_count=reopen_count+1 WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,'reopened',p_request_key,request_hash,p_expected_revision,jsonb_build_object(
  'reason',reason,'reopen_count',i.reopen_count,'previous_resolution',jsonb_build_object('resolved_at',before.resolved_at,'resolved_by',before.resolved_by,'resolution_summary',before.resolution_summary,'resolution_receipt_id',before.resolution_receipt_id)));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

-- Link an unresolved issue to the performance receipt that found it, once.
-- A failed check whose receipt already created its own issue may also be
-- linked to an earlier open issue; nothing on the receipt or occurrence moves.
CREATE FUNCTION haven.link_operation_issue(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.operation_issues; before public.operation_issues; e public.operation_issue_events; problem text; classes text[]; request_hash text; receipt uuid;
BEGIN
 problem:=haven.operation_issue_request_problem(p_request_key,p_expected_revision,p_payload,ARRAY['receipt_id']);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 receipt:=haven.operation_issue_uuid(p_payload,'receipt_id');
 IF receipt IS NULL THEN RAISE EXCEPTION 'receipt_id is required' USING ERRCODE='22023'; END IF;
 i:=haven.lock_operation_issue_authority(p_issue);
 request_hash:=haven.operation_issue_request_hash(jsonb_build_object('command','link','issue',p_issue,'receipt_id',receipt));
 e:=haven.operation_issue_replay(p_issue,p_request_key,request_hash);
 IF e.id IS NOT NULL THEN RETURN haven.operation_issue_reply(i,e,true); END IF;
 IF p_expected_revision IS DISTINCT FROM i.issue_revision THEN RAISE EXCEPTION 'Issue changed since it was read' USING ERRCODE='P0001'; END IF;
 classes:=haven.operation_issue_actor_classes(i);
 IF NOT ('manager'=ANY(classes) OR 'owner'=ANY(classes) OR 'backup'=ANY(classes) OR 'reporter'=ANY(classes)) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF i.status='resolved' THEN RAISE EXCEPTION 'Issue is resolved' USING ERRCODE='P0001'; END IF;
 IF i.receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Issue is already linked to a receipt' USING ERRCODE='P0001'; END IF;
 IF NOT haven.operation_issue_receipt_fits(i,receipt) THEN RAISE EXCEPTION 'Linked receipt must be a readable performance receipt for this subject' USING ERRCODE='22023'; END IF;
 before:=i;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_issues SET receipt_id=receipt WHERE id=i.id RETURNING * INTO i;
 e:=haven.write_operation_issue_event(before,i,'linked',p_request_key,request_hash,p_expected_revision,jsonb_build_object('receipt_id',receipt));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_issue_authority(p_issue);
 RETURN haven.operation_issue_reply(i,e,false);
END $$;

-- ---------------------------------------------------------------------------
-- The 341 cancellation command keeps its body; an occurrence with an
-- unresolved linked issue can no longer be cancelled or removed.
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
  -- COL-144: an unresolved issue on the occurrence would vanish from the backlog;
  -- resolve it first. Checked only for a new cancellation so an exact replay of
  -- an earlier cancel stays idempotent even if an issue was reported since.
  IF EXISTS(SELECT 1 FROM public.operation_issues WHERE task_instance_id=t.id AND status<>'resolved') THEN RAISE EXCEPTION 'Occurrence has an open issue' USING ERRCODE='P0001'; END IF;
  UPDATE public.operation_task_instances SET status='cancelled',cancellation_reason=reason,updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'cancelled',t.status,'cancelled',auth.uid(),haven.app_role()::text,reason,jsonb_build_object('request_key',p_request_key,'source','occurrence-command'));
 END IF;
 IF p_remove AND t.deleted_at IS NULL THEN
  -- Removal hides the occurrence and every issue that reads through it; an
  -- unresolved issue must be resolved before the occurrence can be removed.
  IF EXISTS(SELECT 1 FROM public.operation_issues WHERE task_instance_id=t.id AND status<>'resolved') THEN RAISE EXCEPTION 'Occurrence has an open issue' USING ERRCODE='P0001'; END IF;
  UPDATE public.operation_task_instances SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=auth.uid() WHERE id=t.id;
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'updated','cancelled','cancelled',auth.uid(),haven.app_role()::text,'removed from views; identity retained',jsonb_build_object('request_key',p_request_key,'removed',true));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN jsonb_build_object('task_id',t.id,'status',t.status,'replayed',replayed,'removed',t.deleted_at IS NOT NULL,'occurrence_revision',t.occurrence_revision);
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.assign_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.assign_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.accept_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.accept_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.wait_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.wait_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.resume_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.resume_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.resolve_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.resolve_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.reopen_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reopen_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.link_operation_issue_review(p_issue uuid,p_request_key text,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.link_operation_issue(p_issue,p_request_key,p_expected_revision,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.assign_operation_issue(uuid,text,text,jsonb),haven.accept_operation_issue(uuid,text,text,jsonb),haven.wait_operation_issue(uuid,text,text,jsonb),haven.resume_operation_issue(uuid,text,text,jsonb),
 haven.resolve_operation_issue(uuid,text,text,jsonb),haven.reopen_operation_issue(uuid,text,text,jsonb),haven.link_operation_issue(uuid,text,text,jsonb),
 public.assign_operation_issue_review(uuid,text,text,jsonb),public.accept_operation_issue_review(uuid,text,text,jsonb),public.wait_operation_issue_review(uuid,text,text,jsonb),public.resume_operation_issue_review(uuid,text,text,jsonb),
 public.resolve_operation_issue_review(uuid,text,text,jsonb),public.reopen_operation_issue_review(uuid,text,text,jsonb),public.link_operation_issue_review(uuid,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.assign_operation_issue(uuid,text,text,jsonb),haven.accept_operation_issue(uuid,text,text,jsonb),haven.wait_operation_issue(uuid,text,text,jsonb),haven.resume_operation_issue(uuid,text,text,jsonb),
 haven.resolve_operation_issue(uuid,text,text,jsonb),haven.reopen_operation_issue(uuid,text,text,jsonb),haven.link_operation_issue(uuid,text,text,jsonb),
 public.assign_operation_issue_review(uuid,text,text,jsonb),public.accept_operation_issue_review(uuid,text,text,jsonb),public.wait_operation_issue_review(uuid,text,text,jsonb),public.resume_operation_issue_review(uuid,text,text,jsonb),
 public.resolve_operation_issue_review(uuid,text,text,jsonb),public.reopen_operation_issue_review(uuid,text,text,jsonb),public.link_operation_issue_review(uuid,text,text,jsonb)
 TO authenticated;

-- After application every issue carries a revision and no lifecycle event has
-- been written by this migration; the replay probe asserts the same.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_issue_events) OR EXISTS(SELECT 1 FROM public.operation_issues WHERE issue_revision !~ '^[0-9a-f]{64}$' OR status<>'open') THEN
  RAISE EXCEPTION 'COL-144: issue rows or events are not in the expected post-migration state; repair before applying';
 END IF;
END $$;

COMMENT ON TABLE public.operation_issues IS 'COL-142/COL-144: issue identity created with a receipt or reported on its own, with an explicit lifecycle (open, assigned, waiting, resolved), named owner and backup, waiting reason and follow-up, resolution summary and receipt, reopen count and a revision clients echo back. Status is independent of performance.';
COMMENT ON TABLE public.operation_issue_events IS 'COL-144: immutable lifecycle events (assigned, reassigned, accepted, covered, waiting, resumed, resolved, reopened, linked) with actor, expected revision, request key and details. The issue row is the projection; the events are the history.';
COMMENT ON VIEW public.operation_issue_backlog IS 'COL-144: every unresolved issue the reader may see, with owner and backup currentness, overdue follow-up, the linked occurrence state and the last event, computed at read time. Nothing is notified.';
COMMENT ON FUNCTION haven.lock_operation_issue_authority(uuid) IS 'COL-144: locks the issue, its linked occurrence, native subject, site, grants and session, then requires current site and subject authority before any issue fact is disclosed.';
NOTIFY pgrst,'reload schema';
COMMIT;
