-- Rollback-only interleaved ingest and atomic replacement regression.
BEGIN;
DO $test$
DECLARE org uuid; actor uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
  doc uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  pending_doc uuid:=gen_random_uuid(); pending_run uuid:=gen_random_uuid(); pending_chunk uuid:=gen_random_uuid();
  preflight_doc uuid:=gen_random_uuid(); chunk uuid:=gen_random_uuid(); version integer; payload jsonb;
BEGIN
 SELECT id INTO STRICT org FROM public.organizations LIMIT 1;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 VALUES(actor,actor||'@ingest.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}');
 INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 VALUES(actor,org,actor||'@ingest.invalid','Ingest generation fixture','owner',true)
 ON CONFLICT(id) DO UPDATE SET organization_id=org,app_role='owner',is_active=true;
 INSERT INTO auth.sessions(id,user_id) VALUES(session_id,actor);
 SELECT auth_claim_version INTO version FROM public.user_profiles WHERE id=actor;
 INSERT INTO public.documents(id,workspace_id,title,status) VALUES(doc,org,'Generation fixture','published');
 PERFORM public.create_kb_ingest_authorization_run(a,doc,actor,session_id,version,org,NULL);
 PERFORM public.start_kb_ingest_authorization_mutation(a);
 PERFORM public.create_kb_ingest_authorization_run(b,doc,actor,session_id,version,org,NULL);
 payload:=jsonb_build_array(jsonb_build_object('id',chunk,'document_id',doc,'workspace_id',org,
   'chunk_index',0,'content','new successful content','chunk_type','section'));
 IF public.commit_kb_ingest_generation(b,payload,'new summary',3)<>1 THEN RAISE EXCEPTION 'Wrong count'; END IF;
 -- Superseded A cannot wipe B, even if it began mutating under a valid token.
 PERFORM public.fail_kb_ingest_authority_change(a);
 IF NOT EXISTS(SELECT 1 FROM public.chunks WHERE id=chunk AND content='new successful content')
   OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND status='published' AND summary='new summary') THEN
   RAISE EXCEPTION 'Old cleanup damaged new generation';
 END IF;
 BEGIN
   PERFORM public.commit_kb_ingest_generation(a,'[]','old summary',0);
   RAISE EXCEPTION 'Old commit accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
   PERFORM public.create_kb_ingest_authorization_run(a,doc,actor,session_id,version,org,NULL);
   RAISE EXCEPTION 'Old receipt stole generation';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 -- Same complete generation returns original receipt without duplicate audit.
 PERFORM public.commit_kb_ingest_generation(b,payload,'new summary',3);
 IF (SELECT count(*) FROM public.document_audit_events WHERE document_id=doc AND event_type='ingest_completed')<>1 THEN
   RAISE EXCEPTION 'Duplicate completion event';
 END IF;
 PERFORM public.create_kb_ingest_authorization_run(c,doc,actor,session_id,version,org,NULL);
 -- Invalid replacement is one transaction: the previous complete index survives.
 BEGIN
   PERFORM public.commit_kb_ingest_generation(c,jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'document_id',doc,'workspace_id',org,'chunk_index',0,'chunk_type','section')),'bad summary',1);
   RAISE EXCEPTION 'Invalid replacement accepted';
 EXCEPTION WHEN not_null_violation THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.chunks WHERE id=chunk) THEN RAISE EXCEPTION 'Replacement failed after deleting old index'; END IF;
 IF (SELECT status FROM public.ingest_authorization_runs WHERE id=c)<>'processing' THEN RAISE EXCEPTION 'Failed commit marked completed'; END IF;

 -- A new upload stays non-live until its complete generation commits, then is
 -- promoted to the requested status in the same transaction.
 INSERT INTO public.documents(id,workspace_id,title,status,uploaded_by,metadata,ingest_last_error)
 VALUES(pending_doc,org,'Pending upload fixture','draft',actor,
   jsonb_build_object('ingest_target_status','published'),'old failure');
 BEGIN
   UPDATE public.documents SET status='published' WHERE id=pending_doc;
   RAISE EXCEPTION 'Pending upload was published without a complete generation';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM public.create_kb_ingest_authorization_run(pending_run,pending_doc,actor,session_id,version,org,NULL);
 payload:=jsonb_build_array(jsonb_build_object('id',pending_chunk,'document_id',pending_doc,'workspace_id',org,
   'chunk_index',0,'content','complete pending content','chunk_type','section'));
 PERFORM public.commit_kb_ingest_generation(pending_run,payload,'pending summary',3);
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=pending_doc AND status='published'
      AND NOT metadata ? 'ingest_target_status' AND ingest_last_error IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.chunks WHERE id=pending_chunk) THEN
   RAISE EXCEPTION 'Complete generation did not atomically publish pending upload';
 END IF;

 -- If the authorization receipt itself cannot be created, the already-stored
 -- document gets an idempotent, visible failure receipt and remains non-live.
 INSERT INTO public.documents(id,workspace_id,title,status,uploaded_by,metadata)
 VALUES(preflight_doc,org,'Preflight failure fixture','draft',actor,
   jsonb_build_object('ingest_target_status','published'));
 PERFORM public.fail_kb_ingest_preflight(preflight_doc,actor,session_id,version,org,'authorization_receipt_failed');
 PERFORM public.fail_kb_ingest_preflight(preflight_doc,actor,session_id,version,org,'authorization_receipt_failed');
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=preflight_doc AND status='ingest_failed'
      AND ingest_last_error='authorization_receipt_failed' AND ingest_attempt_count=1)
    OR (SELECT count(*) FROM public.document_audit_events
        WHERE document_id=preflight_doc AND event_type='ingest_failed')<>1 THEN
   RAISE EXCEPTION 'Preflight failure was not recorded idempotently';
 END IF;

 IF position('workspace_id::text = p_organization_id::text' IN pg_get_functiondef(
      'public.create_kb_ingest_authorization_run(uuid,uuid,uuid,uuid,integer,uuid,uuid)'::regprocedure))=0
    OR position('workspace_id::text = v_run.organization_id::text' IN pg_get_functiondef(
      'public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'Ingest commands lost cross-schema workspace compatibility';
 END IF;

 -- Authorization fails at the actual mutation boundary, even with a valid old receipt.
 UPDATE public.user_profiles SET is_active=false WHERE id=actor;
 BEGIN
   PERFORM public.commit_kb_ingest_generation(c,payload,'revoked summary',3);
   RAISE EXCEPTION 'Revoked completion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.chunks WHERE id=chunk) THEN RAISE EXCEPTION 'Denied replacement deleted index'; END IF;
 IF has_function_privilege('authenticated','public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Browser can forge ingest actor command';
 END IF;
END;
$test$;
ROLLBACK;
