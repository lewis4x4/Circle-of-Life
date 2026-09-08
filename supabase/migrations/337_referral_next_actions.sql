-- HCOL-08: accountable work is independent of referral conversion/loss and arrival.
-- PT409 is a deliberate HTTP conflict; 40001 is reserved for real serialization failures (PostgREST retries those).
CREATE TABLE public.referral_next_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
 action_text text NOT NULL CHECK(nullif(haven.rounding_trim_text(action_text),'') IS NOT NULL),
 owner_id uuid NOT NULL REFERENCES public.user_profiles(id), backup_id uuid REFERENCES public.user_profiles(id),
 due_at timestamptz, waiting_condition text, dependency_text text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','completed','superseded')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version>0),
 owner_acknowledged_at timestamptz, owner_acknowledged_version integer,
 backup_accepted_at timestamptz, backup_accepted_version integer,
 completed_at timestamptz, completed_by uuid REFERENCES public.user_profiles(id), completion_evidence text,
 superseded_by_action_id uuid REFERENCES public.referral_next_actions(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(backup_id IS NULL OR backup_id<>owner_id),
 CHECK(due_at IS NOT NULL OR nullif(haven.rounding_trim_text(waiting_condition),'') IS NOT NULL),
 CHECK((status='completed')=(completed_at IS NOT NULL AND completed_by IS NOT NULL AND nullif(haven.rounding_trim_text(completion_evidence),'') IS NOT NULL)),
 CHECK((status='superseded')=(superseded_by_action_id IS NOT NULL))
);
CREATE UNIQUE INDEX referral_next_actions_one_open ON public.referral_next_actions(lead_id) WHERE status='open';
CREATE INDEX referral_next_actions_scope ON public.referral_next_actions(facility_id,created_at DESC,id DESC);
CREATE TABLE public.referral_next_action_receipts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 lead_id uuid NOT NULL REFERENCES public.referral_leads(id), actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 action_id uuid, command text NOT NULL, expected_version integer NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.referral_next_action_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 request_id uuid NOT NULL UNIQUE REFERENCES public.referral_next_action_receipts(id) DEFERRABLE INITIALLY DEFERRED,
 action_id uuid NOT NULL REFERENCES public.referral_next_actions(id), lead_id uuid NOT NULL REFERENCES public.referral_leads(id),
 command text NOT NULL, actor_id uuid NOT NULL REFERENCES public.user_profiles(id), actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), payload jsonb NOT NULL, before_state jsonb, after_state jsonb NOT NULL
);
CREATE INDEX referral_next_action_events_lead ON public.referral_next_action_events(lead_id,created_at DESC,id DESC);
ALTER TABLE public.referral_next_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_next_action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_next_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_next_actions,public.referral_next_action_events,public.referral_next_action_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.referral_next_actions,public.referral_next_action_events TO authenticated;
CREATE POLICY referral_next_actions_read ON public.referral_next_actions FOR SELECT TO authenticated USING(
 organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids())
 AND EXISTS(SELECT 1 FROM public.referral_leads l WHERE l.id=lead_id AND l.organization_id=referral_next_actions.organization_id AND l.facility_id=referral_next_actions.facility_id AND l.deleted_at IS NULL));
CREATE POLICY referral_next_action_events_read ON public.referral_next_action_events FOR SELECT TO authenticated USING(
 organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids())
 AND EXISTS(SELECT 1 FROM public.referral_leads l WHERE l.id=lead_id AND l.organization_id=referral_next_action_events.organization_id AND l.facility_id=referral_next_action_events.facility_id AND l.deleted_at IS NULL));

CREATE FUNCTION haven.referral_action_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Referral action history and receipts are immutable' USING ERRCODE='42501'; END $$;
CREATE FUNCTION haven.referral_action_state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Retain referral action history' USING ERRCODE='42501'; END IF;
 IF OLD.status<>'open' OR (to_jsonb(NEW)-ARRAY['action_text','owner_id','backup_id','due_at','waiting_condition','dependency_text','status','version','terms_version','owner_acknowledged_at','owner_acknowledged_version','backup_accepted_at','backup_accepted_version','completed_at','completed_by','completion_evidence','superseded_by_action_id','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['action_text','owner_id','backup_id','due_at','waiting_condition','dependency_text','status','version','terms_version','owner_acknowledged_at','owner_acknowledged_version','backup_accepted_at','backup_accepted_version','completed_at','completed_by','completion_evidence','superseded_by_action_id','updated_at']) THEN
  RAISE EXCEPTION 'Action identity and terminal history are immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_action_state_guard BEFORE UPDATE OR DELETE ON public.referral_next_actions FOR EACH ROW EXECUTE FUNCTION haven.referral_action_state_guard();
CREATE TRIGGER referral_action_state_no_truncate BEFORE TRUNCATE ON public.referral_next_actions FOR EACH STATEMENT EXECUTE FUNCTION haven.referral_action_state_guard();
CREATE TRIGGER referral_action_receipt_guard BEFORE UPDATE OR DELETE ON public.referral_next_action_receipts FOR EACH ROW EXECUTE FUNCTION haven.referral_action_evidence_guard();
CREATE TRIGGER referral_action_receipt_no_truncate BEFORE TRUNCATE ON public.referral_next_action_receipts FOR EACH STATEMENT EXECUTE FUNCTION haven.referral_action_evidence_guard();
CREATE TRIGGER referral_action_event_guard BEFORE UPDATE OR DELETE ON public.referral_next_action_events FOR EACH ROW EXECUTE FUNCTION haven.referral_action_evidence_guard();
CREATE TRIGGER referral_action_event_no_truncate BEFORE TRUNCATE ON public.referral_next_action_events FOR EACH STATEMENT EXECUTE FUNCTION haven.referral_action_evidence_guard();
CREATE TRIGGER referral_action_audit AFTER INSERT OR UPDATE ON public.referral_next_actions FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER referral_action_receipt_audit AFTER INSERT ON public.referral_next_action_receipts FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER referral_action_event_audit AFTER INSERT ON public.referral_next_action_events FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE FUNCTION haven.guard_lead_open_action() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.referral_leads%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
  OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.merged_into_lead_id IS DISTINCT FROM OLD.merged_into_lead_id
  OR (NEW.status='merged' AND OLD.status IS DISTINCT FROM NEW.status)) THEN
  IF EXISTS(SELECT 1 FROM public.referral_next_actions WHERE lead_id=OLD.id AND status='open') THEN
   RAISE EXCEPTION 'Complete the open accountable action before moving, merging or deleting this lead' USING ERRCODE='55000';
  END IF;
  IF TG_OP<>'DELETE' AND NEW.merged_into_lead_id IS NOT NULL THEN
   -- Lead commands acquire the same parent lock before creating an action.
   IF (auth.jwt()->>'role')='authenticated' THEN
    IF OLD.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Source referral unavailable' USING ERRCODE='42501'; END IF;
    PERFORM haven.referral_action_actor(OLD.facility_id,true);
   END IF;
   SELECT * INTO target FROM public.referral_leads WHERE id=NEW.merged_into_lead_id;
   IF (auth.jwt()->>'role')='authenticated' THEN
    IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.organization_id IS DISTINCT FROM haven.organization_id()
      OR NOT haven.has_facility_access(target.facility_id) THEN RAISE EXCEPTION 'Receiving referral unavailable' USING ERRCODE='42501'; END IF;
    PERFORM haven.referral_action_actor(target.facility_id,true);
   END IF;
   SELECT * INTO target FROM public.referral_leads WHERE id=NEW.merged_into_lead_id FOR UPDATE;
   IF (auth.jwt()->>'role')='authenticated' THEN
    IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.organization_id IS DISTINCT FROM haven.organization_id()
      OR NOT haven.has_facility_access(target.facility_id) THEN RAISE EXCEPTION 'Receiving referral unavailable' USING ERRCODE='42501'; END IF;
    IF OLD.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Source referral unavailable' USING ERRCODE='42501'; END IF;
    PERFORM haven.referral_action_actor(OLD.facility_id,true,true);
    PERFORM haven.referral_action_actor(target.facility_id,true,true);
   END IF;
   IF EXISTS(SELECT 1 FROM public.referral_next_actions WHERE lead_id=NEW.merged_into_lead_id AND status='open') THEN
    RAISE EXCEPTION 'Receiving lead has unresolved accountable work' USING ERRCODE='55000';
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER referral_lead_open_action_guard BEFORE UPDATE OR DELETE ON public.referral_leads FOR EACH ROW EXECUTE FUNCTION haven.guard_lead_open_action();

CREATE FUNCTION haven.referral_action_actor(p_facility uuid,p_write boolean,p_lock boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; v_session uuid;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL THEN RAISE EXCEPTION 'Current referral authorization required' USING ERRCODE='42501'; END IF;
 IF p_lock THEN
  v_session:=(auth.jwt()->>'session_id')::uuid;
  PERFORM 1 FROM public.facilities WHERE id=p_facility FOR SHARE;
  PERFORM 1 FROM public.user_facility_access WHERE user_id=a.actor_user_id AND facility_id=p_facility FOR SHARE;
  PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN auth.sessions s ON s.user_id=p.id
   WHERE p.id=a.actor_user_id AND s.id=v_session FOR SHARE OF p,u,s;
  SELECT * INTO a FROM haven.current_authorized_actor();
 END IF;
 IF a.actor_user_id IS NULL OR NOT haven.has_facility_access(p_facility)
  OR (p_write AND a.actor_role_text NOT IN('owner','org_admin','facility_admin','nurse')) THEN
  RAISE EXCEPTION 'Current referral facility authorization required' USING ERRCODE='42501';
 END IF;
 RETURN a.actor_user_id;
END $$;
CREATE FUNCTION haven.referral_action_candidate(p_user uuid,p_org uuid,p_facility uuid,p_lock boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eligible boolean;
BEGIN
 IF p_user IS NULL THEN RETURN false; END IF;
 IF p_lock THEN
  IF NOT haven.referral_action_candidate(p_user,p_org,p_facility,false) THEN RETURN false; END IF;
  PERFORM 1 FROM public.user_facility_access WHERE user_id=p_user AND facility_id=p_facility FOR SHARE;
  PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=p_user FOR SHARE OF p,u;
 END IF;
 SELECT true INTO eligible FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN public.facilities f ON f.id=p_facility
 WHERE p.id=p_user AND p.organization_id=p_org AND p.is_active AND p.deleted_at IS NULL
  AND p.app_role IN('owner','org_admin','facility_admin','nurse') AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
  AND f.organization_id=p_org AND f.deleted_at IS NULL AND (p.app_role IN('owner','org_admin') OR EXISTS(
   SELECT 1 FROM public.user_facility_access x WHERE x.user_id=p.id AND x.organization_id=p_org AND x.facility_id=p_facility AND x.revoked_at IS NULL));
 RETURN coalesce(eligible,false);
END $$;
CREATE FUNCTION haven.referral_action_name(p_user uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_user IS NULL THEN NULL ELSE coalesce((SELECT nullif(haven.rounding_trim_text(full_name),'') FROM public.user_profiles WHERE id=p_user),'User '||left(p_user::text,8)) END
$$;
CREATE FUNCTION haven.referral_action_view(p public.referral_next_actions) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner boolean; v_backup boolean; v_actor uuid; v_manage boolean;
BEGIN
 v_actor:=haven.authorized_user_id();
 v_manage:=coalesce(haven.app_role() IN('owner','org_admin','facility_admin','nurse') AND haven.has_facility_access(p.facility_id),false);
 v_owner:=haven.referral_action_candidate(p.owner_id,p.organization_id,p.facility_id);
 v_backup:=haven.referral_action_candidate(p.backup_id,p.organization_id,p.facility_id);
 RETURN to_jsonb(p)||jsonb_build_object('lead_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.referral_leads WHERE id=p.lead_id),
  'owner_name',haven.referral_action_name(p.owner_id),
  'backup_name',haven.referral_action_name(p.backup_id),'owner_eligible',v_owner,'backup_eligible',v_backup,
  'owner_acknowledged',coalesce(p.owner_acknowledged_version=p.terms_version,false),'backup_accepted',coalesce(p.backup_accepted_version=p.terms_version,false),
  'can_manage',v_manage AND p.status='open','can_acknowledge',v_manage AND p.status='open' AND v_actor=p.owner_id AND v_owner,
  'can_accept_backup',v_manage AND p.status='open' AND coalesce(v_actor=p.backup_id,false) AND v_backup,'can_complete',v_manage AND p.status='open');
END $$;
CREATE FUNCTION haven.referral_action_terms(p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE required text[]:=ARRAY['action_text','owner_id','backup_id','due_at','waiting_condition','dependency_text']; v_due timestamptz;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT(p ?& required) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT(k=ANY(required)))
  OR jsonb_typeof(p->'action_text') IS DISTINCT FROM 'string' OR nullif(haven.rounding_trim_text(p->>'action_text'),'') IS NULL
  OR jsonb_typeof(p->'owner_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'backup_id') NOT IN('string','null')
  OR jsonb_typeof(p->'due_at') NOT IN('string','null') OR jsonb_typeof(p->'waiting_condition') NOT IN('string','null')
  OR jsonb_typeof(p->'dependency_text') NOT IN('string','null') THEN RAISE EXCEPTION 'Valid action, owner and explicit timing terms are required' USING ERRCODE='22023'; END IF;
 PERFORM (p->>'owner_id')::uuid; PERFORM (p->>'backup_id')::uuid;
 IF p->>'backup_id'=p->>'owner_id' THEN RAISE EXCEPTION 'Backup must be another person' USING ERRCODE='22023'; END IF;
 IF p->>'due_at' IS NOT NULL THEN
  IF (p->>'due_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Due date must be an explicit ISO instant' USING ERRCODE='22023'; END IF;
  v_due:=(p->>'due_at')::timestamptz;
 END IF;
 IF v_due IS NULL AND nullif(haven.rounding_trim_text(p->>'waiting_condition'),'') IS NULL THEN RAISE EXCEPTION 'Due date or waiting condition required' USING ERRCODE='22023'; END IF;
 RETURN p||jsonb_build_object('action_text',haven.rounding_trim_text(p->>'action_text'),'waiting_condition',nullif(haven.rounding_trim_text(p->>'waiting_condition'),''),'dependency_text',nullif(haven.rounding_trim_text(p->>'dependency_text'),''));
END $$;

CREATE FUNCTION haven.command_referral_next_action(p_request_id uuid,p_lead_id uuid,p_action_id uuid,p_expected_version integer,p_command text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.referral_leads%ROWTYPE; a public.referral_next_actions%ROWTYPE; prior public.referral_next_actions%ROWTYPE; replacement public.referral_next_actions%ROWTYPE;
 receipt public.referral_next_action_receipts%ROWTYPE; actor uuid; candidate uuid; terms jsonb; evidence text; result jsonb; keys text[]; changed boolean; v_now timestamptz;
BEGIN
 IF p_request_id IS NULL OR p_lead_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_command IS NULL
  OR p_command NOT IN('create','update','acknowledge','accept_backup','complete','supersede') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Valid action command and request ID required' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.referral_action_actor(l.facility_id,true);
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id FOR UPDATE;
 IF l.deleted_at IS NOT NULL OR l.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 -- Serialize request identity without trusting a client-supplied actor or scope.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,337));
 actor:=haven.referral_action_actor(l.facility_id,true);
 SELECT * INTO receipt FROM public.referral_next_action_receipts WHERE id=p_request_id;
 IF FOUND THEN
  actor:=haven.referral_action_actor(l.facility_id,true,true);
  IF receipt.actor_id<>actor THEN RAISE EXCEPTION 'Request belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.lead_id<>l.id OR receipt.organization_id<>l.organization_id OR receipt.facility_id<>l.facility_id OR receipt.action_id IS DISTINCT FROM p_action_id
   OR receipt.command<>p_command OR receipt.expected_version<>p_expected_version OR receipt.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION 'Request ID was used with different scope or payload' USING ERRCODE='22023'; END IF;
  RETURN receipt.result;
 END IF;
 IF l.status='merged' OR l.merged_into_lead_id IS NOT NULL THEN RAISE EXCEPTION 'Merged referral cannot receive action commands' USING ERRCODE='55000'; END IF;
 IF p_command='create' THEN
  IF p_action_id IS NOT NULL OR p_expected_version<>0 OR EXISTS(SELECT 1 FROM public.referral_next_actions WHERE lead_id=l.id AND status='open') THEN
   RAISE EXCEPTION 'An open action already exists or create version is stale' USING ERRCODE='PT409'; END IF;
  terms:=haven.referral_action_terms(p_payload);
 ELSE
  SELECT * INTO a FROM public.referral_next_actions WHERE id=p_action_id AND lead_id=l.id AND organization_id=l.organization_id AND facility_id=l.facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501'; END IF;
  IF a.version<>p_expected_version OR a.status<>'open' THEN RAISE EXCEPTION 'Action changed; refresh before saving' USING ERRCODE='PT409'; END IF;
  prior:=a;
  keys:=CASE p_command WHEN 'update' THEN ARRAY['action_text','owner_id','backup_id','due_at','waiting_condition','dependency_text','change_note']
   WHEN 'supersede' THEN ARRAY['replacement','supersede_evidence'] WHEN 'complete' THEN ARRAY['completion_evidence']
   WHEN 'acknowledge' THEN ARRAY['acknowledgment_note'] ELSE ARRAY['acceptance_note'] END;
  IF NOT(p_payload ?& keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(keys))) THEN RAISE EXCEPTION 'Unexpected command fields' USING ERRCODE='22023'; END IF;
  IF p_command IN('update','supersede','complete') THEN
   evidence:=p_payload->>CASE p_command WHEN 'update' THEN 'change_note' WHEN 'supersede' THEN 'supersede_evidence' ELSE 'completion_evidence' END;
   IF jsonb_typeof(p_payload->CASE p_command WHEN 'update' THEN 'change_note' WHEN 'supersede' THEN 'supersede_evidence' ELSE 'completion_evidence' END) IS DISTINCT FROM 'string'
    OR nullif(haven.rounding_trim_text(evidence),'') IS NULL THEN RAISE EXCEPTION 'Change or completion evidence required' USING ERRCODE='22023'; END IF;
  ELSE
   IF jsonb_typeof(p_payload->keys[1]) NOT IN('string','null') THEN RAISE EXCEPTION 'Acceptance note must be text or null' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_command='update' THEN terms:=haven.referral_action_terms(p_payload-'change_note'); END IF;
  IF p_command='supersede' THEN terms:=haven.referral_action_terms(p_payload->'replacement'); END IF;
 END IF;
 IF terms IS NOT NULL THEN
  FOR candidate IN SELECT x FROM unnest(ARRAY[(terms->>'owner_id')::uuid,(terms->>'backup_id')::uuid]) x WHERE x IS NOT NULL ORDER BY (x=actor),x LOOP
   IF NOT haven.referral_action_candidate(candidate,l.organization_id,l.facility_id,true) THEN RAISE EXCEPTION 'Assigned person is no longer eligible' USING ERRCODE='42501'; END IF;
  END LOOP;
 END IF;
 -- All action/target waits are over; independently revalidate the signed actor.
 actor:=haven.referral_action_actor(l.facility_id,true,true);
 v_now:=clock_timestamp();
 IF p_command IN('create','supersede') THEN
  IF p_command='supersede' THEN
   replacement.id:=gen_random_uuid();
   UPDATE public.referral_next_actions SET status='superseded',superseded_by_action_id=replacement.id,version=version+1,updated_at=v_now WHERE id=a.id RETURNING * INTO a;
  END IF;
  INSERT INTO public.referral_next_actions(id,organization_id,facility_id,lead_id,action_text,owner_id,backup_id,due_at,waiting_condition,dependency_text,created_by)
   VALUES(coalesce(replacement.id,gen_random_uuid()),l.organization_id,l.facility_id,l.id,terms->>'action_text',(terms->>'owner_id')::uuid,(terms->>'backup_id')::uuid,
    (terms->>'due_at')::timestamptz,terms->>'waiting_condition',terms->>'dependency_text',actor) RETURNING * INTO replacement;
  IF p_command='create' THEN a:=replacement; END IF;
 ELSIF p_command='update' THEN
  changed:=(a.action_text,a.owner_id,a.backup_id,a.due_at,a.waiting_condition,a.dependency_text) IS DISTINCT FROM
   (terms->>'action_text',(terms->>'owner_id')::uuid,(terms->>'backup_id')::uuid,(terms->>'due_at')::timestamptz,terms->>'waiting_condition',terms->>'dependency_text');
  UPDATE public.referral_next_actions SET action_text=terms->>'action_text',owner_id=(terms->>'owner_id')::uuid,backup_id=(terms->>'backup_id')::uuid,
   due_at=(terms->>'due_at')::timestamptz,waiting_condition=terms->>'waiting_condition',dependency_text=terms->>'dependency_text',version=version+1,
   terms_version=terms_version+CASE WHEN changed THEN 1 ELSE 0 END,
   owner_acknowledged_at=CASE WHEN changed THEN NULL ELSE owner_acknowledged_at END,owner_acknowledged_version=CASE WHEN changed THEN NULL ELSE owner_acknowledged_version END,
   backup_accepted_at=CASE WHEN changed THEN NULL ELSE backup_accepted_at END,backup_accepted_version=CASE WHEN changed THEN NULL ELSE backup_accepted_version END,updated_at=v_now
   WHERE id=a.id RETURNING * INTO a;
 ELSIF p_command='acknowledge' THEN
  IF actor<>a.owner_id THEN RAISE EXCEPTION 'Only the assigned owner can acknowledge' USING ERRCODE='42501'; END IF;
  UPDATE public.referral_next_actions SET owner_acknowledged_at=v_now,owner_acknowledged_version=terms_version,version=version+1,updated_at=v_now WHERE id=a.id RETURNING * INTO a;
 ELSIF p_command='accept_backup' THEN
  IF actor IS DISTINCT FROM a.backup_id THEN RAISE EXCEPTION 'Only the assigned backup can accept' USING ERRCODE='42501'; END IF;
  UPDATE public.referral_next_actions SET backup_accepted_at=v_now,backup_accepted_version=terms_version,version=version+1,updated_at=v_now WHERE id=a.id RETURNING * INTO a;
 ELSE
  UPDATE public.referral_next_actions SET status='completed',completed_at=v_now,completed_by=actor,completion_evidence=haven.rounding_trim_text(evidence),version=version+1,updated_at=v_now WHERE id=a.id RETURNING * INTO a;
 END IF;
 result:=jsonb_build_object('request_id',p_request_id,'action',haven.referral_action_view(CASE WHEN p_command='supersede' THEN replacement ELSE a END));
 IF p_command='supersede' THEN result:=result||jsonb_build_object('previous_action',haven.referral_action_view(a)); END IF;
 INSERT INTO public.referral_next_action_events(organization_id,facility_id,request_id,action_id,lead_id,command,actor_id,actor_name,payload,before_state,after_state)
  VALUES(l.organization_id,l.facility_id,p_request_id,a.id,l.id,p_command,actor,haven.referral_action_name(actor),p_payload,
   CASE WHEN prior.id IS NULL THEN NULL ELSE to_jsonb(prior) END,to_jsonb(a));
 INSERT INTO public.referral_next_action_receipts(id,organization_id,facility_id,lead_id,actor_id,action_id,command,expected_version,payload,result)
  VALUES(p_request_id,l.organization_id,l.facility_id,l.id,actor,p_action_id,p_command,p_expected_version,p_payload,result);
 RETURN result;
END $$;

CREATE FUNCTION haven.list_referral_next_actions(p_facility_id uuid,p_lead_id uuid DEFAULT NULL,p_open_only boolean DEFAULT true,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb; n integer:=greatest(1,least(coalesce(p_limit,25),100)); cursor jsonb:=NULL;
BEGIN
 PERFORM haven.referral_action_actor(p_facility_id,false,true);
 IF (p_before_created_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'Both cursor fields required' USING ERRCODE='22023'; END IF;
 IF p_lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.referral_leads WHERE id=p_lead_id AND facility_id=p_facility_id AND organization_id=haven.organization_id() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(haven.referral_action_view(q) ORDER BY q.created_at DESC,q.id DESC),'[]') INTO items FROM (
  SELECT a.* FROM public.referral_next_actions a JOIN public.referral_leads l ON l.id=a.lead_id AND l.organization_id=a.organization_id AND l.facility_id=a.facility_id AND l.deleted_at IS NULL
  WHERE a.facility_id=p_facility_id AND a.organization_id=haven.organization_id() AND (p_lead_id IS NULL OR a.lead_id=p_lead_id)
   AND (NOT coalesce(p_open_only,true) OR a.status='open') AND (p_before_id IS NULL OR (a.created_at,a.id)<(p_before_created_at,p_before_id))
  ORDER BY a.created_at DESC,a.id DESC LIMIT n+1) q;
 IF jsonb_array_length(items)>n THEN
  cursor:=jsonb_build_object('created_at',items->(n-1)->'created_at','id',items->(n-1)->'id'); items:=items-n;
 END IF;
 RETURN jsonb_build_object('items',items,'next_cursor',cursor);
END $$;
CREATE FUNCTION haven.list_referral_next_action_events(p_lead_id uuid,p_action_id uuid DEFAULT NULL,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.referral_leads%ROWTYPE; items jsonb; n integer:=greatest(1,least(coalesce(p_limit,25),100)); cursor jsonb:=NULL;
BEGIN
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.referral_action_actor(l.facility_id,false);
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.referral_action_actor(l.facility_id,false,true);
 IF l.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 IF (p_before_created_at IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'Both cursor fields required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC),'[]') INTO items FROM (
  SELECT e.* FROM public.referral_next_action_events e WHERE e.lead_id=l.id AND e.organization_id=l.organization_id AND e.facility_id=l.facility_id
   AND (p_action_id IS NULL OR e.action_id=p_action_id) AND (p_before_id IS NULL OR (e.created_at,e.id)<(p_before_created_at,p_before_id))
  ORDER BY e.created_at DESC,e.id DESC LIMIT n+1) q;
 IF jsonb_array_length(items)>n THEN cursor:=jsonb_build_object('created_at',items->(n-1)->'created_at','id',items->(n-1)->'id'); items:=items-n; END IF;
 RETURN jsonb_build_object('items',items,'next_cursor',cursor);
END $$;
CREATE FUNCTION haven.list_referral_next_action_assignees(p_facility_id uuid,p_after_user_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb; n integer:=greatest(1,least(coalesce(p_limit,50),100)); cursor text:=NULL;
BEGIN
 PERFORM haven.referral_action_actor(p_facility_id,true,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM (
  SELECT p.id,haven.referral_action_name(p.id) AS full_name,p.app_role FROM public.user_profiles p WHERE p.organization_id=haven.organization_id()
   AND (p_after_user_id IS NULL OR p.id>p_after_user_id) AND haven.referral_action_candidate(p.id,p.organization_id,p_facility_id)
  ORDER BY p.id LIMIT n+1) q;
 IF jsonb_array_length(items)>n THEN cursor:=items->(n-1)->>'id'; items:=items-n; END IF;
 RETURN jsonb_build_object('items',items,'next_cursor',cursor);
END $$;
CREATE FUNCTION haven.get_referral_next_action_receipt(p_request_id uuid,p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.referral_leads%ROWTYPE; actor uuid; result jsonb;
BEGIN
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.referral_action_actor(l.facility_id,false);
 SELECT * INTO l FROM public.referral_leads WHERE id=p_lead_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR l.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Referral unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.referral_action_actor(l.facility_id,false,true);
 SELECT r.result INTO result FROM public.referral_next_action_receipts r WHERE r.id=p_request_id AND r.lead_id=l.id
  AND r.organization_id=l.organization_id AND r.facility_id=l.facility_id AND r.actor_id=actor;
 RETURN result;
END $$;

-- The exposed surface is invoker-only. Private entry points enforce all authority
-- themselves and must be executable by the invoker wrapper's authenticated caller.
CREATE FUNCTION public.haven_command_referral_next_action(p_request_id uuid,p_lead_id uuid,p_action_id uuid,p_expected_version integer,p_command text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.command_referral_next_action(p_request_id,p_lead_id,p_action_id,p_expected_version,p_command,p_payload) $$;
CREATE FUNCTION public.haven_list_referral_next_actions(p_facility_id uuid,p_lead_id uuid DEFAULT NULL,p_open_only boolean DEFAULT true,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.list_referral_next_actions(p_facility_id,p_lead_id,p_open_only,p_before_created_at,p_before_id,p_limit) $$;
CREATE FUNCTION public.haven_list_referral_next_action_events(p_lead_id uuid,p_action_id uuid DEFAULT NULL,p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.list_referral_next_action_events(p_lead_id,p_action_id,p_before_created_at,p_before_id,p_limit) $$;
CREATE FUNCTION public.haven_list_referral_next_action_assignees(p_facility_id uuid,p_after_user_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.list_referral_next_action_assignees(p_facility_id,p_after_user_id,p_limit) $$;
CREATE FUNCTION public.haven_get_referral_next_action_receipt(p_request_id uuid,p_lead_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.get_referral_next_action_receipt(p_request_id,p_lead_id) $$;
REVOKE ALL ON FUNCTION haven.referral_action_evidence_guard(),haven.referral_action_state_guard(),haven.guard_lead_open_action(),haven.referral_action_actor(uuid,boolean,boolean),haven.referral_action_candidate(uuid,uuid,uuid,boolean),haven.referral_action_view(public.referral_next_actions),haven.referral_action_name(uuid),haven.referral_action_terms(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION haven.command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb),haven.list_referral_next_actions(uuid,uuid,boolean,timestamptz,uuid,integer),haven.list_referral_next_action_events(uuid,uuid,timestamptz,uuid,integer),haven.list_referral_next_action_assignees(uuid,uuid,integer),haven.get_referral_next_action_receipt(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb),haven.list_referral_next_actions(uuid,uuid,boolean,timestamptz,uuid,integer),haven.list_referral_next_action_events(uuid,uuid,timestamptz,uuid,integer),haven.list_referral_next_action_assignees(uuid,uuid,integer),haven.get_referral_next_action_receipt(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.haven_command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb),public.haven_list_referral_next_actions(uuid,uuid,boolean,timestamptz,uuid,integer),public.haven_list_referral_next_action_events(uuid,uuid,timestamptz,uuid,integer),public.haven_list_referral_next_action_assignees(uuid,uuid,integer),public.haven_get_referral_next_action_receipt(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.haven_command_referral_next_action(uuid,uuid,uuid,integer,text,jsonb),public.haven_list_referral_next_actions(uuid,uuid,boolean,timestamptz,uuid,integer),public.haven_list_referral_next_action_events(uuid,uuid,timestamptz,uuid,integer),public.haven_list_referral_next_action_assignees(uuid,uuid,integer),public.haven_get_referral_next_action_receipt(uuid,uuid) TO authenticated;
