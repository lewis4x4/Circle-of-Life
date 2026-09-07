-- Rollback-only interleaved ingest and atomic replacement regression.
BEGIN;
DO $test$
DECLARE org uuid; actor uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
  doc uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  chunk uuid:=gen_random_uuid(); version integer; payload jsonb;
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
