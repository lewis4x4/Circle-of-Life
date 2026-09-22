-- Created with supabase migration new; repository claim 446. COL-504.
-- Explicit authenticated family collection, with no case/document read grants.
BEGIN;
CREATE TABLE public.benefits_collection_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.benefits_cases(id),
 requirement_id uuid NOT NULL REFERENCES public.benefits_requirements(id), family_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
 requires_signature boolean NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 document_id uuid REFERENCES public.benefits_documents(id), received_at timestamptz,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX benefits_collection_case ON public.benefits_collection_requests(case_id);
CREATE INDEX benefits_collection_family ON public.benefits_collection_requests(family_user_id,expires_at) WHERE revoked_at IS NULL;
ALTER TABLE public.benefits_collection_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefits_collection_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.benefits_family_actor() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_role_text IS DISTINCT FROM 'family'
 OR EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=a.actor_user_id AND coalesce(p.settings->>'must_change_password','false')<>'false') THEN
 RAISE EXCEPTION 'Family actor unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',a.actor_user_id,'org',a.actor_organization_id);
END $$;
CREATE FUNCTION haven.benefits_family_eligible(p_user uuid,p_case public.benefits_cases,p_signature boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.family_resident_links l JOIN public.user_profiles p ON p.id=l.user_id JOIN auth.users u ON u.id=p.id
 JOIN public.residents r ON r.id=l.resident_id JOIN public.facilities f ON f.id=r.facility_id
 WHERE l.user_id=p_user AND l.resident_id=p_case.resident_id AND l.organization_id=p_case.organization_id AND l.revoked_at IS NULL
 AND l.can_view_financial AND (NOT p_signature OR l.can_make_decisions)
 AND p.organization_id=p_case.organization_id AND p.app_role='family' AND p.is_active AND p.deleted_at IS NULL
 AND coalesce(p.settings->>'must_change_password','false')='false' AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND r.organization_id=p_case.organization_id AND r.facility_id=p_case.facility_id AND r.deleted_at IS NULL
 AND f.organization_id=p_case.organization_id AND f.deleted_at IS NULL AND p_case.status<>'closed');
$$;
CREATE FUNCTION haven.benefits_family_assert(p_collection uuid) RETURNS public.benefits_collection_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_family_actor(); q public.benefits_collection_requests; c public.benefits_cases; r public.benefits_requirements; BEGIN
 SELECT * INTO q FROM public.benefits_collection_requests WHERE id=p_collection;
 SELECT * INTO c FROM public.benefits_cases WHERE id=q.case_id;
 SELECT * INTO r FROM public.benefits_requirements WHERE id=q.requirement_id AND case_id=q.case_id;
 IF q.id IS NULL OR q.family_user_id IS DISTINCT FROM (a->>'id')::uuid OR c.organization_id IS DISTINCT FROM (a->>'org')::uuid
 OR q.revoked_at IS NOT NULL OR q.expires_at<=now() OR r.id IS NULL
 OR NOT haven.benefits_family_eligible(q.family_user_id,c,q.requires_signature OR r.signature_status<>'not_required') THEN
 RAISE EXCEPTION 'Collection unavailable' USING ERRCODE='42501'; END IF;
 RETURN q;
END $$;
CREATE FUNCTION haven.benefits_collection_list_internal(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases:=haven.benefits_assert_case(p_case_id,'read'); BEGIN
 RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('family_name',p.full_name) ORDER BY q.created_at DESC)
 FROM public.benefits_collection_requests q JOIN public.user_profiles p ON p.id=q.family_user_id WHERE q.case_id=c.id),'[]'),
 'eligible_family',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'can_make_decisions',haven.benefits_family_eligible(p.id,c,true)))
 FROM public.user_profiles p WHERE haven.benefits_family_eligible(p.id,c,false)),'[]'));
END $$;
CREATE FUNCTION haven.benefits_collection_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; r public.benefits_requirements; q public.benefits_collection_requests; old public.benefits_requests; stored jsonb; result jsonb; BEGIN
 c:=haven.benefits_assert_case(p_case_id,'write');
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_action NOT IN ('assign','revoke') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid collection command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored:=jsonb_build_object('payload',p_payload,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>c.id OR old.action<>'collection_'||p_action OR old.payload<>stored THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 RETURN old.result; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM haven.benefits_assert_case(c.id,'write');
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed' USING ERRCODE='P0409'; END IF;
 IF c.status='closed' THEN RAISE EXCEPTION 'Case closed' USING ERRCODE='22023'; END IF;
 IF p_action='assign' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['requirement_id','family_user_id','expires_at']);
  SELECT * INTO r FROM public.benefits_requirements WHERE id=(p_payload->>'requirement_id')::uuid AND case_id=c.id FOR UPDATE;
  IF r.id IS NULL OR r.status IN ('accepted','not_applicable') OR (p_payload->>'expires_at')::timestamptz IS NULL
  OR (p_payload->>'expires_at')::timestamptz<=now() OR (p_payload->>'expires_at')::timestamptz>now()+interval '90 days'
  OR NOT haven.benefits_family_eligible((p_payload->>'family_user_id')::uuid,c,r.signature_status<>'not_required') THEN RAISE EXCEPTION 'Family collection is not authorized' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.benefits_collection_requests x WHERE x.requirement_id=r.id AND x.revoked_at IS NULL AND x.received_at IS NULL AND x.expires_at>now()) THEN RAISE EXCEPTION 'An active request already exists for this requirement' USING ERRCODE='23505'; END IF;
  INSERT INTO public.benefits_collection_requests(case_id,requirement_id,family_user_id,requires_signature,expires_at,created_by)
  VALUES(c.id,r.id,(p_payload->>'family_user_id')::uuid,r.signature_status<>'not_required',(p_payload->>'expires_at')::timestamptz,(a->>'id')::uuid) RETURNING * INTO q;
 ELSE
  PERFORM haven.benefits_keys(p_payload,ARRAY['collection_id']);
  UPDATE public.benefits_collection_requests SET revoked_at=coalesce(revoked_at,now()) WHERE id=(p_payload->>'collection_id')::uuid AND case_id=c.id RETURNING * INTO q;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Collection unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'collection_id',q.id);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'collection_'||p_action,p_payload||jsonb_build_object('collection_id',q.id),c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'collection_'||p_action,stored,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.benefits_family_list_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_family_actor(); BEGIN
 RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(x.item ORDER BY x.created_at DESC) FROM (
 SELECT q.created_at,jsonb_build_object('id',q.id,'resident_name',r.first_name||' '||r.last_name,'title',req.title,'due_date',req.due_date,'expires_at',q.expires_at,'requires_signature',q.requires_signature OR req.signature_status<>'not_required','revision',c.revision,
 'upload',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('document_id',d.id,'filename',d.filename,'status',CASE WHEN d.status='ready' THEN 'received' ELSE 'pending' END) END) item
 FROM public.benefits_collection_requests q JOIN public.benefits_cases c ON c.id=q.case_id JOIN public.residents r ON r.id=c.resident_id
 JOIN public.benefits_requirements req ON req.id=q.requirement_id AND req.case_id=c.id LEFT JOIN public.benefits_documents d ON d.id=q.document_id AND d.created_by=q.family_user_id
 WHERE q.family_user_id=(a->>'id')::uuid AND c.organization_id=(a->>'org')::uuid AND q.revoked_at IS NULL AND q.expires_at>now()
 AND haven.benefits_family_eligible(q.family_user_id,c,q.requires_signature OR req.signature_status<>'not_required')
 ORDER BY q.created_at DESC LIMIT 100) x),'[]'));
END $$;
CREATE FUNCTION haven.benefits_family_target_internal(p_collection_id uuid,p_document_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.benefits_collection_requests:=haven.benefits_family_assert(p_collection_id); d public.benefits_documents; obj jsonb; BEGIN
 SELECT * INTO d FROM public.benefits_documents WHERE id=p_document_id AND id=q.document_id AND case_id=q.case_id AND created_by=q.family_user_id;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='42501'; END IF;
 obj:=haven.benefits_object(d.storage_path);
 IF d.status='ready' AND (d.verified_object IS NULL OR obj IS DISTINCT FROM d.verified_object) THEN RAISE EXCEPTION 'Document bytes changed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('document',to_jsonb(d),'object',obj);
END $$;
CREATE FUNCTION haven.benefits_family_command_internal(p_collection_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_family_actor(); q public.benefits_collection_requests; c public.benefits_cases; r public.benefits_requirements; d public.benefits_documents; old public.benefits_requests; stored jsonb; result jsonb; v_id uuid; BEGIN
 q:=haven.benefits_family_assert(p_collection_id);
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_action IS NULL OR p_action NOT IN ('prepare','finalize') THEN RAISE EXCEPTION 'Invalid upload command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored:=jsonb_build_object('collection_id',p_collection_id,'payload',p_payload,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>q.case_id OR old.action<>'family_'||p_action OR old.payload<>stored THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 RETURN old.result; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=q.case_id FOR UPDATE;
 q:=haven.benefits_family_assert(p_collection_id);
 SELECT * INTO r FROM public.benefits_requirements WHERE id=q.requirement_id AND case_id=c.id FOR UPDATE;
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed' USING ERRCODE='P0409'; END IF;
 IF q.received_at IS NOT NULL OR r.status IN ('accepted','not_applicable') THEN RAISE EXCEPTION 'Collection completed' USING ERRCODE='22023'; END IF;
 IF p_action='prepare' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['filename','mime_type','size_bytes','sha256']);
  IF q.document_id IS NOT NULL THEN RAISE EXCEPTION 'Upload already reserved; resume the original request' USING ERRCODE='23505'; END IF;
  v_id:=gen_random_uuid();
  INSERT INTO public.benefits_documents(id,case_id,filename,mime_type,size_bytes,sha256,storage_path,document_type,created_by)
  VALUES(v_id,c.id,p_payload->>'filename',p_payload->>'mime_type',(p_payload->>'size_bytes')::bigint,p_payload->>'sha256',c.organization_id||'/'||c.id||'/'||v_id,'family_requested_evidence',(a->>'id')::uuid) RETURNING * INTO d;
  UPDATE public.benefits_collection_requests SET document_id=d.id WHERE id=q.id;
 ELSE
  PERFORM haven.benefits_keys(p_payload,ARRAY['document_id']);
  SELECT * INTO d FROM public.benefits_documents WHERE id=(p_payload->>'document_id')::uuid AND id=q.document_id AND case_id=c.id AND created_by=q.family_user_id FOR UPDATE;
  IF d.id IS NULL OR d.status<>'reserved' OR d.verified_at IS NULL OR d.verified_object IS NULL OR haven.benefits_object(d.storage_path) IS DISTINCT FROM d.verified_object THEN RAISE EXCEPTION 'Verified document bytes unavailable' USING ERRCODE='55000'; END IF;
  UPDATE public.benefits_documents SET status='ready' WHERE id=d.id RETURNING * INTO d;
  UPDATE public.benefits_collection_requests SET received_at=now() WHERE id=q.id;
  UPDATE public.benefits_requirements SET status='received',document_id=d.id,reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL,
   signature_status=CASE WHEN q.requires_signature OR signature_status<>'not_required' THEN 'pending' ELSE 'not_required' END,updated_at=now() WHERE id=r.id;
 END IF;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('collection_id',q.id,'revision',c.revision,'document',to_jsonb(d));
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'family_'||p_action,p_payload||jsonb_build_object('collection_id',q.id,'document_id',d.id),c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'family_'||p_action,stored,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.benefits_collection_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['revoked_at','document_id','received_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','document_id','received_at'])
 OR (OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id) OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
 OR (OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at) THEN RAISE EXCEPTION 'Collection evidence is immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER benefits_collection_immutable BEFORE UPDATE OR DELETE ON public.benefits_collection_requests FOR EACH ROW EXECUTE FUNCTION haven.benefits_collection_immutable();

CREATE FUNCTION public.benefits_collection_list(p_case_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_collection_list_internal(p_case_id); $$;
CREATE FUNCTION public.benefits_collection_command(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_collection_command_internal(p_case_id,p_action,p_payload,p_expected_revision,p_request_id); $$;
CREATE FUNCTION public.benefits_family_list() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_family_list_internal(); $$;
CREATE FUNCTION public.benefits_family_target(p_collection_id uuid,p_document_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_family_target_internal(p_collection_id,p_document_id); $$;
CREATE FUNCTION public.benefits_family_command(p_collection_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_family_command_internal(p_collection_id,p_action,p_payload,p_expected_revision,p_request_id); $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','haven') AND (p.proname LIKE 'benefits_family_%' OR p.proname LIKE 'benefits_collection_%') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.nspname='public' OR f.proname IN ('benefits_collection_list_internal','benefits_collection_command_internal','benefits_family_list_internal','benefits_family_target_internal','benefits_family_command_internal') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
