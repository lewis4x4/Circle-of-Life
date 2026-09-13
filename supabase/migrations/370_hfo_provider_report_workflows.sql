BEGIN;
-- Native resident document intake and explicit administrative report history.
CREATE FUNCTION haven.provider_report_context(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances;s public.operation_activity_subjects;a public.operation_activities;
BEGIN
 IF haven.authorized_user_id() IS NULL OR NOT coalesce(haven.operation_task_readable(p_task),false) THEN RAISE EXCEPTION 'Provider report scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO s FROM public.operation_activity_subjects WHERE id=t.subject_id;
 SELECT * INTO a FROM public.operation_activities WHERE id=t.activity_id;
 RETURN jsonb_build_object('task_id',t.id,'subject_id',t.subject_id,'organization_id',t.organization_id,'facility_id',t.facility_id,'resident_id',s.resident_id,'timezone',coalesce((SELECT timezone FROM public.facilities WHERE id=t.facility_id),'America/New_York'),
 'eligible',a.activity_key='hfo-al-h01-01' AND a.activity_kind='record_review' AND s.subject_kind='resident' AND t.authority_class='resident',
 'can_manage',haven.operation_task_mutable(p_task),
 'native_read',haven.app_role() NOT IN('dietary','maintenance_role') AND t.facility_id IN(SELECT haven.accessible_facility_ids()) AND has_table_privilege('authenticated','public.resident_documents','SELECT'),
 'native_write',haven.app_role() IN('owner','org_admin','facility_admin','nurse') AND t.facility_id IN(SELECT haven.accessible_facility_ids()) AND has_table_privilege('authenticated','public.resident_documents','INSERT'));
END $$;
REVOKE ALL ON FUNCTION haven.provider_report_context(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_report_context(uuid) TO authenticated;
CREATE FUNCTION haven.provider_report_scope(p_task uuid,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;
BEGIN
 c:=haven.provider_report_context(p_task);
 IF NOT coalesce((c->>'eligible')::boolean,false) OR NOT coalesce((c->>'native_read')::boolean,false)
 OR (p_write AND NOT coalesce((c->>'can_manage')::boolean,false))
 OR NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=(c->>'resident_id')::uuid AND r.facility_id=(c->>'facility_id')::uuid AND r.organization_id=(c->>'organization_id')::uuid AND r.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Current native and HFO resident scope required' USING ERRCODE='42501'; END IF;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION haven.provider_report_scope(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_report_scope(uuid,boolean) TO authenticated;
CREATE FUNCTION haven.provider_report_readable(p_task uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$ BEGIN PERFORM haven.provider_report_scope(p_task,false);RETURN true;EXCEPTION WHEN insufficient_privilege THEN RETURN false;END $$;
REVOKE ALL ON FUNCTION haven.provider_report_readable(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_report_readable(uuid) TO authenticated;

CREATE FUNCTION haven.provider_resident_access(p_org uuid,p_site uuid,p_resident uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(haven.authorized_user_id() IS NOT NULL AND haven.organization_id()=p_org AND haven.app_role() NOT IN('dietary','maintenance_role')
 AND p_site IN(SELECT haven.accessible_facility_ids()) AND has_table_privilege('authenticated','public.resident_documents','SELECT')
 AND EXISTS(SELECT 1 FROM public.residents r WHERE r.id=p_resident AND r.organization_id=p_org AND r.facility_id=p_site AND r.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.operation_task_instances t JOIN public.operation_activity_subjects s ON s.id=t.subject_id JOIN public.operation_activities a ON a.id=t.activity_id
 WHERE t.organization_id=p_org AND t.facility_id=p_site AND s.resident_id=p_resident AND s.subject_kind='resident' AND t.authority_class='resident' AND a.activity_key='hfo-al-h01-01' AND a.activity_kind='record_review' AND haven.operation_task_readable(t.id)),false)
$$;
REVOKE ALL ON FUNCTION haven.provider_resident_access(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION haven.provider_resident_access(uuid,uuid,uuid) TO authenticated;

CREATE TABLE public.resident_document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),native_document_id uuid UNIQUE REFERENCES public.resident_documents(id),
 task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),organization_id uuid NOT NULL REFERENCES public.organizations(id),facility_id uuid NOT NULL REFERENCES public.facilities(id),resident_id uuid NOT NULL REFERENCES public.residents(id),
 document_type text NOT NULL CHECK(document_type IN('form_1823','hospice_plan','community_support_plan','support_plan','provider_report','other')),title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','finalized')),revision uuid NOT NULL DEFAULT gen_random_uuid(),
 declared_mime text NOT NULL CHECK(declared_mime IN('application/pdf','image/jpeg','image/png')),declared_size_bytes integer NOT NULL CHECK(declared_size_bytes BETWEEN 1 AND 20971520),declared_sha256 text NOT NULL CHECK(declared_sha256~'^[a-f0-9]{64}$'),
 object_path text NOT NULL,object_id uuid,object_version text,object_etag text,verified_sha256 text,verified_md5 text,page_count integer,
 supersedes_version_id uuid REFERENCES public.resident_document_versions(id),uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),prepared_at timestamptz NOT NULL,finalized_at timestamptz,
 request_key text NOT NULL,request_hash text NOT NULL,UNIQUE(uploaded_by,request_key),CHECK(native_document_id IS NULL OR native_document_id=document_id),
 CHECK((state='prepared' AND native_document_id IS NULL AND finalized_at IS NULL) OR(state='finalized' AND native_document_id IS NOT NULL AND finalized_at IS NOT NULL AND verified_sha256=declared_sha256))
);
CREATE TABLE haven.resident_document_byte_attestations (
 version_id uuid NOT NULL REFERENCES public.resident_document_versions(id),object_id uuid NOT NULL,object_version text NOT NULL,object_etag text NOT NULL,size_bytes integer NOT NULL,mime text NOT NULL,sha256 text NOT NULL,md5 text NOT NULL,
 uploader_id uuid NOT NULL,verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(version_id,object_id,object_version,object_etag)
);
REVOKE ALL ON haven.resident_document_byte_attestations FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE haven.resident_document_byte_attestations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON haven.resident_document_byte_attestations TO authenticated;
CREATE POLICY native_byte_attestation_read ON haven.resident_document_byte_attestations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=version_id));
CREATE FUNCTION haven.resident_document_attestation(p_version uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT to_jsonb(a) FROM haven.resident_document_byte_attestations a WHERE a.version_id=p_version ORDER BY verified_at DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION haven.resident_document_attestation(uuid) FROM PUBLIC,anon,service_role;
-- Opaque byte provenance only; source authorization remains in the caller's guard.
GRANT EXECUTE ON FUNCTION haven.resident_document_attestation(uuid) TO authenticated;
CREATE FUNCTION public.attest_resident_document_bytes(p_version uuid,p_object uuid,p_object_version text,p_etag text,p_size integer,p_mime text,p_sha256 text,p_md5 text,p_uploader uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server byte verification required' USING ERRCODE='42501'; END IF;
 IF p_sha256!~'^[a-f0-9]{64}$' OR p_md5!~'^[a-f0-9]{32}$' OR p_size NOT BETWEEN 1 AND 20971520 OR p_mime NOT IN('application/pdf','image/jpeg','image/png') THEN RAISE EXCEPTION 'Invalid byte attestation'; END IF;
 INSERT INTO haven.resident_document_byte_attestations(version_id,object_id,object_version,object_etag,size_bytes,mime,sha256,md5,uploader_id) VALUES(p_version,p_object,p_object_version,p_etag,p_size,p_mime,p_sha256,p_md5,p_uploader) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.attest_resident_document_bytes(uuid,uuid,text,text,integer,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_resident_document_bytes(uuid,uuid,text,text,integer,text,text,text,uuid) TO service_role;
ALTER TABLE public.resident_document_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resident_document_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.resident_document_versions TO authenticated;
CREATE POLICY resident_document_version_read ON public.resident_document_versions FOR SELECT TO authenticated USING(haven.provider_resident_access(organization_id,facility_id,resident_id) AND ((state='prepared' AND uploaded_by=haven.authorized_user_id() AND haven.provider_report_readable(task_id)) OR (state='finalized' AND EXISTS(SELECT 1 FROM public.resident_documents d WHERE d.id=native_document_id AND d.organization_id=resident_document_versions.organization_id AND d.facility_id=resident_document_versions.facility_id AND d.resident_id=resident_document_versions.resident_id AND d.deleted_at IS NULL))));
CREATE POLICY resident_document_version_insert ON public.resident_document_versions FOR INSERT TO authenticated WITH CHECK(haven.provider_report_readable(task_id) AND uploaded_by=haven.authorized_user_id());
CREATE POLICY resident_document_version_update ON public.resident_document_versions FOR UPDATE TO authenticated USING(haven.provider_report_readable(task_id) AND uploaded_by=haven.authorized_user_id()) WITH CHECK(haven.provider_report_readable(task_id) AND uploaded_by=haven.authorized_user_id());
CREATE FUNCTION haven.guard_resident_document_version() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;prior public.resident_document_versions;obj storage.objects;proof jsonb;doc public.resident_documents;
BEGIN
 IF TG_OP NOT IN('INSERT','UPDATE') THEN RAISE EXCEPTION 'Native document history is immutable' USING ERRCODE='42501'; END IF;
 c:=haven.provider_report_scope(NEW.task_id,true);IF NOT (c->>'native_write')::boolean THEN RAISE EXCEPTION 'Native document writer required' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM public.resident_documents WHERE id=NEW.document_id) THEN RAISE EXCEPTION 'Native document identity already exists' USING ERRCODE='23505';END IF;
  NEW.organization_id:=(c->>'organization_id')::uuid;NEW.facility_id:=(c->>'facility_id')::uuid;NEW.resident_id:=(c->>'resident_id')::uuid;NEW.uploaded_by:=haven.authorized_user_id();NEW.prepared_at:=clock_timestamp();NEW.revision:=gen_random_uuid();
  NEW.object_path:=NEW.facility_id::text||'/'||NEW.document_id::text||'/'||NEW.id::text||'/source';
  IF NEW.state<>'prepared' OR NEW.native_document_id IS NOT NULL OR NEW.object_id IS NOT NULL OR NEW.object_version IS NOT NULL OR NEW.object_etag IS NOT NULL OR NEW.verified_sha256 IS NOT NULL OR NEW.verified_md5 IS NOT NULL OR NEW.finalized_at IS NOT NULL OR NEW.page_count IS NOT NULL THEN RAISE EXCEPTION 'New document is not verified' USING ERRCODE='42501';END IF;
  IF NEW.request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Request key required';END IF;
  NEW.request_hash:=encode(sha256(convert_to(jsonb_build_object('task',NEW.task_id,'type',NEW.document_type,'title',NEW.title,'mime',NEW.declared_mime,'size',NEW.declared_size_bytes,'sha',NEW.declared_sha256,'supersedes',NEW.supersedes_version_id)::text,'UTF8')),'hex');
  IF NEW.supersedes_version_id IS NOT NULL THEN SELECT * INTO prior FROM public.resident_document_versions WHERE id=NEW.supersedes_version_id;
   IF NOT FOUND OR prior.resident_id<>NEW.resident_id OR prior.facility_id<>NEW.facility_id OR prior.document_type<>NEW.document_type OR prior.state<>'finalized' THEN RAISE EXCEPTION 'Superseded native version unavailable';END IF;
  END IF;
 ELSE
  IF OLD.state='finalized' OR (to_jsonb(NEW)-ARRAY['state','revision','native_document_id','object_id','object_version','object_etag','verified_sha256','verified_md5','page_count','finalized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','native_document_id','object_id','object_version','object_etag','verified_sha256','verified_md5','page_count','finalized_at']) THEN RAISE EXCEPTION 'Native version identity is immutable' USING ERRCODE='42501';END IF;
  IF NEW.state<>'finalized' THEN RAISE EXCEPTION 'Use verified native finalization' USING ERRCODE='42501';END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id='resident-documents' AND name=OLD.object_path;
  proof:=haven.resident_document_attestation(OLD.id);
  IF obj.id IS NULL OR coalesce(to_jsonb(obj)->>'owner_id',to_jsonb(obj)->>'owner') IS DISTINCT FROM OLD.uploaded_by::text OR proof IS NULL OR (proof->>'object_id')::uuid<>obj.id OR proof->>'object_version' IS DISTINCT FROM obj.version OR proof->>'object_etag' IS DISTINCT FROM lower(trim(both '"' from obj.metadata->>'eTag'))
   OR (proof->>'size_bytes')::integer<>OLD.declared_size_bytes OR proof->>'sha256'<>OLD.declared_sha256 OR proof->>'mime'<>OLD.declared_mime OR (proof->>'uploader_id')::uuid<>OLD.uploaded_by
   OR proof->>'md5' IS DISTINCT FROM lower(trim(both '"' from obj.metadata->>'eTag')) OR (obj.metadata->>'size')::integer<>OLD.declared_size_bytes OR obj.metadata->>'mimetype'<>OLD.declared_mime THEN RAISE EXCEPTION 'Server-verified native bytes required' USING ERRCODE='42501';END IF;
  SELECT * INTO doc FROM public.resident_documents WHERE id=OLD.document_id FOR UPDATE;
  IF NOT FOUND OR (doc.organization_id,doc.facility_id,doc.resident_id,doc.document_type,doc.title,doc.storage_path,doc.file_size,doc.file_type,doc.uploaded_by) IS DISTINCT FROM (OLD.organization_id,OLD.facility_id,OLD.resident_id,OLD.document_type,OLD.title,OLD.object_path,OLD.declared_size_bytes,OLD.declared_mime,OLD.uploaded_by) THEN RAISE EXCEPTION 'Canonical native document does not match verified intake' USING ERRCODE='42501'; END IF;
  NEW.native_document_id:=OLD.document_id;NEW.object_id:=obj.id;NEW.object_version:=obj.version;NEW.object_etag:=proof->>'object_etag';NEW.verified_sha256:=proof->>'sha256';NEW.verified_md5:=proof->>'md5';NEW.page_count:=CASE WHEN OLD.declared_mime IN('image/png','image/jpeg') THEN 1 END;NEW.finalized_at:=clock_timestamp();
  UPDATE public.resident_documents SET uploaded_at=NEW.finalized_at WHERE id=OLD.document_id;
  NEW.revision:=gen_random_uuid();
 END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(NEW.task_id,true) THEN RAISE EXCEPTION 'Resident authority changed' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_resident_document_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER resident_document_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.resident_document_versions FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_document_version();
CREATE TRIGGER resident_document_version_no_truncate BEFORE TRUNCATE ON public.resident_document_versions FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_resident_document_version();

CREATE FUNCTION haven.resident_document_storage_access(p_bucket text,p_path text,p_write boolean,p_object uuid DEFAULT NULL,p_version text DEFAULT NULL,p_etag text DEFAULT NULL,p_size integer DEFAULT NULL,p_mime text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.resident_document_versions;c jsonb;
BEGIN
 IF p_bucket<>'resident-documents' THEN RETURN false;END IF;
 SELECT * INTO v FROM public.resident_document_versions WHERE object_path=p_path;
 IF NOT FOUND THEN RETURN false;END IF;
 IF v.state='prepared' OR p_write THEN c:=haven.provider_report_scope(v.task_id,p_write);ELSE IF NOT haven.provider_resident_access(v.organization_id,v.facility_id,v.resident_id) THEN RETURN false;END IF;END IF;
 IF p_write THEN RETURN (c->>'native_write')::boolean AND v.state='prepared' AND v.uploaded_by=haven.authorized_user_id();END IF;
 IF v.state='prepared' THEN RETURN v.uploaded_by=haven.authorized_user_id();END IF;
 IF (p_object,p_version,p_etag,p_size,p_mime) IS DISTINCT FROM(v.object_id,v.object_version,v.object_etag,v.declared_size_bytes,v.declared_mime) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.resident_documents d WHERE d.id=v.native_document_id AND d.resident_id=v.resident_id AND d.facility_id=v.facility_id AND d.organization_id=v.organization_id AND d.storage_path=v.object_path AND d.deleted_at IS NULL);
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION haven.resident_document_storage_access(text,text,boolean,uuid,text,text,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.resident_document_storage_access(text,text,boolean,uuid,text,text,integer,text) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('resident-documents','resident-documents',false,20971520,ARRAY['application/pdf','image/jpeg','image/png']) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.buckets b WHERE b.id='resident-documents' AND NOT b.public AND b.file_size_limit=20971520 AND (SELECT array_agg(m ORDER BY m COLLATE "C") FROM unnest(b.allowed_mime_types) m)=ARRAY['application/pdf','image/jpeg','image/png']) THEN RAISE EXCEPTION 'Existing native resident-document bucket configuration is incompatible';END IF;END $$;
CREATE POLICY native_resident_document_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='resident-documents' AND haven.resident_document_storage_access(bucket_id,name,false,id,version,lower(trim(both '"' from metadata->>'eTag')),CASE WHEN metadata->>'size'~'^[0-9]{1,9}$' THEN (metadata->>'size')::integer END,metadata->>'mimetype'));
CREATE POLICY native_resident_document_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='resident-documents' AND haven.resident_document_storage_access(bucket_id,name,true));
CREATE POLICY native_resident_document_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'resident-documents' OR haven.resident_document_storage_access(bucket_id,name,false,id,version,lower(trim(both '"' from metadata->>'eTag')),CASE WHEN metadata->>'size'~'^[0-9]{1,9}$' THEN (metadata->>'size')::integer END,metadata->>'mimetype'));
CREATE POLICY native_resident_document_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'resident-documents' OR haven.resident_document_storage_access(bucket_id,name,true));
CREATE POLICY native_resident_document_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'resident-documents') WITH CHECK(bucket_id<>'resident-documents');
CREATE POLICY native_resident_document_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'resident-documents');
CREATE FUNCTION haven.provider_document_current(v public.resident_document_versions) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT v.state='finalized' AND EXISTS(SELECT 1 FROM public.resident_documents d WHERE d.id=v.native_document_id AND d.deleted_at IS NULL
 AND(d.organization_id,d.facility_id,d.resident_id,d.document_type,d.title,d.storage_path,d.file_size,d.file_type,d.uploaded_by,d.uploaded_at) IS NOT DISTINCT FROM(v.organization_id,v.facility_id,v.resident_id,v.document_type,v.title,v.object_path,v.declared_size_bytes,v.declared_mime,v.uploaded_by,v.finalized_at))
 AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='resident-documents' AND o.name=v.object_path AND (o.id,o.version,lower(trim(both '"' from o.metadata->>'eTag')),(o.metadata->>'size')::integer,o.metadata->>'mimetype',coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')) IS NOT DISTINCT FROM(v.object_id,v.object_version,v.object_etag,v.declared_size_bytes,v.declared_mime,v.uploaded_by::text))
$$;
REVOKE ALL ON FUNCTION haven.provider_document_current(public.resident_document_versions) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION haven.provider_document_current(public.resident_document_versions) TO authenticated;
CREATE FUNCTION haven.provider_document_json(v public.resident_document_versions) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT jsonb_build_object('id',v.id,'document_id',v.document_id,'native_document_id',v.native_document_id,'task_id',v.task_id,'resident_id',v.resident_id,'facility_id',v.facility_id,'document_type',v.document_type,'title',v.title,'state',v.state,'revision',v.revision,'declared_mime',v.declared_mime,'declared_size_bytes',v.declared_size_bytes,'declared_sha256',v.declared_sha256,'bucket','resident-documents','object_path',v.object_path,'supersedes_version_id',v.supersedes_version_id,'prepared_at',v.prepared_at,'finalized_at',v.finalized_at,'checksum_verified',v.state='finalized','native_current',haven.provider_document_current(v),'page_count',v.page_count) $$;
REVOKE ALL ON FUNCTION haven.provider_document_json(public.resident_document_versions) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_document_json(public.resident_document_versions) TO authenticated;
CREATE FUNCTION public.provider_document_target(p_task uuid,p_version uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;v public.resident_document_versions;o storage.objects;
BEGIN
 c:=haven.provider_report_scope(p_task,false);SELECT * INTO v FROM public.resident_document_versions WHERE id=p_version;
 IF NOT FOUND OR (v.organization_id,v.facility_id,v.resident_id) IS DISTINCT FROM((c->>'organization_id')::uuid,(c->>'facility_id')::uuid,(c->>'resident_id')::uuid) OR (v.state='prepared' AND v.task_id<>p_task) THEN RAISE EXCEPTION 'Native document unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='resident-documents' AND name=v.object_path;
 IF v.state='finalized' AND NOT haven.provider_document_current(v) THEN RAISE EXCEPTION 'Verified native header or object changed' USING ERRCODE='42501';END IF;
 IF v.state='finalized' AND (o.id IS NULL OR (o.id,o.version,lower(trim(both '"' from o.metadata->>'eTag'))) IS DISTINCT FROM(v.object_id,v.object_version,v.object_etag)) THEN RAISE EXCEPTION 'Finalized native object identity changed' USING ERRCODE='42501';END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,false) THEN RAISE EXCEPTION 'Document authority changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('task_id',p_task,'resident_id',c->'resident_id','version',haven.provider_document_json(v),'uploader_id',v.uploaded_by,'object',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'version',o.version,'etag',lower(trim(both '"' from o.metadata->>'eTag')),'size',(o.metadata->>'size')::integer,'mime',o.metadata->>'mimetype') END);
END $$;
REVOKE ALL ON FUNCTION public.provider_document_target(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.provider_document_target(uuid,uuid) TO authenticated;
CREATE FUNCTION public.prepare_provider_document(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;v public.resident_document_versions;expected text;
BEGIN
 c:=haven.provider_report_scope(p_task,true);IF NOT (c->>'native_write')::boolean THEN RAISE EXCEPTION 'Native writer required' USING ERRCODE='42501';END IF;
 IF p_payload-ARRAY['document_type','title','declared_mime','declared_size_bytes','declared_sha256','supersedes_version_id']<>'{}' OR p_request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Invalid intake request';END IF;
 expected:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'type',p_payload->>'document_type','title',p_payload->>'title','mime',p_payload->>'declared_mime','size',(p_payload->>'declared_size_bytes')::integer,'sha',p_payload->>'declared_sha256','supersedes',(p_payload->>'supersedes_version_id')::uuid)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-intake:'||haven.authorized_user_id()::text||':'||p_request_key,0));
 c:=haven.provider_report_scope(p_task,true);SELECT * INTO v FROM public.resident_document_versions WHERE uploaded_by=haven.authorized_user_id() AND request_key=p_request_key;
 IF FOUND THEN IF v.task_id<>p_task OR v.request_hash<>expected THEN RAISE EXCEPTION 'Request scope/content conflict' USING ERRCODE='23505';END IF;
 ELSE INSERT INTO public.resident_document_versions(task_id,document_type,title,declared_mime,declared_size_bytes,declared_sha256,supersedes_version_id,request_key) VALUES(p_task,p_payload->>'document_type',p_payload->>'title',p_payload->>'declared_mime',(p_payload->>'declared_size_bytes')::integer,p_payload->>'declared_sha256',(p_payload->>'supersedes_version_id')::uuid,p_request_key) RETURNING * INTO v;END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,true) THEN RAISE EXCEPTION 'Native intake authority changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('version',haven.provider_document_json(v));
END $$;
REVOKE ALL ON FUNCTION public.prepare_provider_document(uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_provider_document(uuid,text,jsonb) TO authenticated;
CREATE TABLE haven.provider_document_finalizations(version_id uuid PRIMARY KEY REFERENCES public.resident_document_versions(id),actor_id uuid NOT NULL,request_key text NOT NULL,expected_revision uuid NOT NULL,UNIQUE(actor_id,request_key));
ALTER TABLE haven.provider_document_finalizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.provider_document_finalizations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.provider_document_finalizations TO authenticated;
CREATE POLICY provider_finalization_read ON haven.provider_document_finalizations FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=version_id));
CREATE POLICY provider_finalization_insert ON haven.provider_document_finalizations FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=version_id AND v.state='finalized' AND v.uploaded_by=haven.authorized_user_id()));
CREATE FUNCTION public.finalize_provider_document(p_task uuid,p_version uuid,p_request_key text,p_expected_revision uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;v public.resident_document_versions;old haven.provider_document_finalizations;
BEGIN
 c:=haven.provider_report_scope(p_task,true);IF NOT (c->>'native_write')::boolean THEN RAISE EXCEPTION 'Native writer required' USING ERRCODE='42501';END IF;
 IF p_request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Request key required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-finalize:'||haven.authorized_user_id()::text||':'||p_request_key,0));
 SELECT * INTO v FROM public.resident_document_versions WHERE id=p_version AND task_id=p_task FOR UPDATE;
 c:=haven.provider_report_scope(p_task,true);
 IF NOT FOUND OR v.id IS NULL OR v.uploaded_by<>haven.authorized_user_id() THEN RAISE EXCEPTION 'Native intake unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO old FROM haven.provider_document_finalizations WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
 IF FOUND THEN IF old.version_id<>p_version OR old.expected_revision<>p_expected_revision THEN RAISE EXCEPTION 'Finalization request conflict' USING ERRCODE='23505';END IF;
 ELSE
  IF v.revision IS DISTINCT FROM p_expected_revision OR v.state<>'prepared' THEN RAISE EXCEPTION 'Native intake revision changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.resident_documents(id,resident_id,facility_id,organization_id,document_type,title,storage_path,file_type,file_size,uploaded_by,uploaded_at) VALUES(v.document_id,v.resident_id,v.facility_id,v.organization_id,v.document_type,v.title,v.object_path,v.declared_mime,v.declared_size_bytes,v.uploaded_by,clock_timestamp());
  UPDATE public.resident_document_versions SET state='finalized' WHERE id=v.id RETURNING * INTO v;
  INSERT INTO haven.provider_document_finalizations(version_id,actor_id,request_key,expected_revision) VALUES(v.id,haven.authorized_user_id(),p_request_key,p_expected_revision);
 END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,true) THEN RAISE EXCEPTION 'Native finalization authority changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('version',haven.provider_document_json(v));
END $$;
REVOKE ALL ON FUNCTION public.finalize_provider_document(uuid,uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_provider_document(uuid,uuid,text,uuid) TO authenticated;

CREATE FUNCTION haven.provider_report_text(p jsonb,k text,lim integer DEFAULT 1000) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR length(btrim(p->>k)) NOT BETWEEN 1 AND lim THEN RAISE EXCEPTION 'Required report provenance field: %',k USING ERRCODE='22023';END IF;RETURN btrim(p->>k);END $$;
REVOKE ALL ON FUNCTION haven.provider_report_text(jsonb,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_report_text(jsonb,text,integer) TO authenticated;
CREATE TABLE haven.provider_report_expectations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),organization_id uuid NOT NULL,facility_id uuid NOT NULL,resident_id uuid NOT NULL,contact_id uuid NOT NULL REFERENCES public.resident_contacts(id),contact_version text NOT NULL,observed_contact_label text NOT NULL,
 document_type text NOT NULL CHECK(document_type IN('form_1823','hospice_plan','community_support_plan','support_plan','provider_report','other')),expected_version text NOT NULL CHECK(length(btrim(expected_version)) BETWEEN 1 AND 1000),
 service_at timestamptz,service_on date,service_provenance text NOT NULL CHECK(length(btrim(service_provenance)) BETWEEN 1 AND 1000),actor_id uuid NOT NULL,recorded_at timestamptz NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,UNIQUE(actor_id,request_key)
);
CREATE TABLE haven.provider_report_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),expectation_id uuid NOT NULL REFERENCES haven.provider_report_expectations(id),task_id uuid NOT NULL REFERENCES public.operation_task_instances(id),kind text NOT NULL CHECK(kind IN('set_due','attach_receipt','review','signature_observation','link_chase')),
 reference_version_id uuid REFERENCES public.resident_document_versions(id),details jsonb NOT NULL,expected_revision uuid NOT NULL,sequence bigint NOT NULL,actor_id uuid NOT NULL,recorded_at timestamptz NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,UNIQUE(actor_id,request_key),UNIQUE(expectation_id,sequence)
);
ALTER TABLE haven.provider_report_expectations ENABLE ROW LEVEL SECURITY;ALTER TABLE haven.provider_report_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.provider_report_expectations,haven.provider_report_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON haven.provider_report_expectations,haven.provider_report_events TO authenticated;
CREATE POLICY provider_expectation_read ON haven.provider_report_expectations FOR SELECT TO authenticated USING(haven.provider_resident_access(organization_id,facility_id,resident_id) AND EXISTS(SELECT 1 FROM public.resident_contacts n WHERE n.id=contact_id AND n.resident_id=provider_report_expectations.resident_id AND n.facility_id=provider_report_expectations.facility_id AND n.deleted_at IS NULL));
CREATE POLICY provider_expectation_insert ON haven.provider_report_expectations FOR INSERT TO authenticated WITH CHECK(haven.provider_report_readable(task_id) AND actor_id=haven.authorized_user_id());
CREATE POLICY provider_event_read ON haven.provider_report_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM haven.provider_report_expectations e WHERE e.id=expectation_id) AND (reference_version_id IS NULL OR EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=reference_version_id)));
CREATE POLICY provider_event_insert ON haven.provider_report_events FOR INSERT TO authenticated WITH CHECK(haven.provider_report_readable(task_id) AND actor_id=haven.authorized_user_id() AND (reference_version_id IS NULL OR EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=reference_version_id)));
-- Only opaque HFO header identities/counts leave this definer, never native
-- references, hashes, provider names, signature data or document content.
CREATE FUNCTION haven.provider_report_headers(p_task uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;result jsonb;
BEGIN c:=haven.provider_report_context(p_task);IF NOT coalesce((c->>'native_read')::boolean,false) THEN RAISE EXCEPTION 'Native report scope required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'revision',coalesce(last.id,e.id),'event_count',coalesce(last.sequence,0)) ORDER BY e.recorded_at,e.id),'[]') INTO result FROM(SELECT * FROM haven.provider_report_expectations WHERE organization_id=(c->>'organization_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND resident_id=(c->>'resident_id')::uuid ORDER BY recorded_at,id LIMIT 101) e LEFT JOIN LATERAL(SELECT id,sequence FROM haven.provider_report_events WHERE expectation_id=e.id ORDER BY sequence DESC LIMIT 1) last ON true;RETURN result;END $$;
REVOKE ALL ON FUNCTION haven.provider_report_headers(uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION haven.provider_report_headers(uuid) TO authenticated;
CREATE FUNCTION haven.guard_provider_expectation() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;n public.resident_contacts;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Report expectation history is immutable' USING ERRCODE='42501';END IF;
 c:=haven.provider_report_scope(NEW.task_id,true);SELECT * INTO n FROM public.resident_contacts WHERE id=NEW.contact_id;
 IF NOT FOUND OR (n.resident_id,n.facility_id,n.organization_id) IS DISTINCT FROM((c->>'resident_id')::uuid,(c->>'facility_id')::uuid,(c->>'organization_id')::uuid) OR n.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Current native contact required' USING ERRCODE='42501';END IF;
 PERFORM haven.provider_report_time(jsonb_build_object('service_at',NEW.service_at,'service_on',NEW.service_on),'service_at','service_on',c->>'timezone',true,false);
 IF NEW.request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Actual service time and request key required' USING ERRCODE='22023';END IF;
 NEW.contact_version:=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex');NEW.observed_contact_label:=n.name;
 NEW.organization_id:=(c->>'organization_id')::uuid;NEW.facility_id:=(c->>'facility_id')::uuid;NEW.resident_id:=(c->>'resident_id')::uuid;NEW.actor_id:=haven.authorized_user_id();NEW.recorded_at:=clock_timestamp();
 NEW.request_hash:=encode(sha256(convert_to(jsonb_build_object('task',NEW.task_id,'contact',NEW.contact_id,'type',NEW.document_type,'expected',NEW.expected_version,'service_at',NEW.service_at,'service_on',NEW.service_on,'provenance',NEW.service_provenance)::text,'UTF8')),'hex');
 IF c IS DISTINCT FROM haven.provider_report_scope(NEW.task_id,true) THEN RAISE EXCEPTION 'Report scope changed' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_provider_expectation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER provider_expectation_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.provider_report_expectations FOR EACH ROW EXECUTE FUNCTION haven.guard_provider_expectation();
CREATE TRIGGER provider_expectation_no_truncate BEFORE TRUNCATE ON haven.provider_report_expectations FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_provider_expectation();
CREATE FUNCTION haven.guard_provider_report_event() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;e haven.provider_report_expectations;v public.resident_document_versions;head jsonb;prev_version uuid;old haven.provider_report_events;i public.operation_issues;allowed text[];tstamp timestamptz;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Report events are immutable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-report:'||NEW.expectation_id::text,0));
 SELECT * INTO e FROM haven.provider_report_expectations WHERE id=NEW.expectation_id;IF NOT FOUND THEN RAISE EXCEPTION 'Expectation unavailable' USING ERRCODE='42501';END IF;
 IF NEW.task_id IS NULL THEN NEW.task_id:=e.task_id;END IF;c:=haven.provider_report_scope(NEW.task_id,true);IF(e.organization_id,e.facility_id,e.resident_id) IS DISTINCT FROM((c->>'organization_id')::uuid,(c->>'facility_id')::uuid,(c->>'resident_id')::uuid) THEN RAISE EXCEPTION 'Same resident report scope required' USING ERRCODE='42501';END IF;
 SELECT h INTO head FROM jsonb_array_elements(haven.provider_report_headers(NEW.task_id)) h WHERE h->>'id'=e.id::text;
 IF (head->>'revision')::uuid IS DISTINCT FROM NEW.expected_revision THEN RAISE EXCEPTION 'Report revision changed' USING ERRCODE='40001';END IF;
 allowed:=CASE NEW.kind WHEN 'set_due' THEN ARRAY['due_at','due_on','approval_reference','approver_label','approved_at','approved_on','effective_date','source_version_id'] WHEN 'attach_receipt' THEN ARRAY['version_id','received_at','received_on','receipt_provenance'] WHEN 'review' THEN ARRAY['version_id','result','findings'] WHEN 'signature_observation' THEN ARRAY['version_id','signer_role','signer_label','page','source_provenance','signed_at','signed_on','corrects_event_id'] WHEN 'link_chase' THEN ARRAY['issue_id'] ELSE ARRAY[]::text[] END;
 IF jsonb_typeof(NEW.details)<>'object' OR NEW.details-allowed<>'{}' OR NEW.request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Invalid report event fields' USING ERRCODE='22023';END IF;
 NEW.reference_version_id:=CASE WHEN NEW.kind='set_due' THEN (NEW.details->>'source_version_id')::uuid WHEN NEW.kind<>'link_chase' THEN (NEW.details->>'version_id')::uuid END;
 IF NEW.kind<>'link_chase' THEN
  SELECT * INTO v FROM public.resident_document_versions WHERE id=NEW.reference_version_id;
  IF NOT FOUND OR v.state<>'finalized' OR v.resident_id<>e.resident_id OR v.facility_id<>e.facility_id OR (NEW.kind<>'set_due' AND v.document_type<>e.document_type) THEN RAISE EXCEPTION 'Verified native report version required' USING ERRCODE='42501';END IF;
  PERFORM public.provider_document_target(NEW.task_id,v.id);
 END IF;
 SELECT (details->>'version_id')::uuid INTO prev_version FROM haven.provider_report_events WHERE expectation_id=e.id AND kind='attach_receipt' ORDER BY sequence DESC LIMIT 1;
 IF NEW.kind='set_due' THEN
  PERFORM haven.provider_report_text(NEW.details,'approval_reference');PERFORM haven.provider_report_text(NEW.details,'approver_label');
  PERFORM haven.provider_report_time(NEW.details,'approved_at','approved_on',c->>'timezone',true,false);PERFORM haven.provider_report_time(NEW.details,'due_at','due_on',c->>'timezone',true,true);PERFORM haven.provider_report_time(NEW.details,'_no_timestamp','effective_date',c->>'timezone',true,true);
  NEW.details:=NEW.details||jsonb_build_object('verification','operator_recorded_approval_evidence');
 ELSIF NEW.kind='attach_receipt' THEN
  PERFORM haven.provider_report_text(NEW.details,'receipt_provenance');PERFORM haven.provider_report_time(NEW.details,'received_at','received_on',c->>'timezone',true,false);
  IF prev_version IS NOT NULL AND prev_version<>v.id AND v.supersedes_version_id IS DISTINCT FROM prev_version THEN RAISE EXCEPTION 'Link an explicitly superseding native version';END IF;
 ELSIF NEW.kind='review' THEN
  PERFORM haven.provider_report_text(NEW.details,'findings');IF NEW.details->>'result' NOT IN('reviewed','follow_up_needed') OR NEW.details->>'result' IS NULL OR prev_version IS DISTINCT FROM v.id THEN RAISE EXCEPTION 'Review the current received version';END IF;
 ELSIF NEW.kind='signature_observation' THEN
  PERFORM haven.provider_report_text(NEW.details,'signer_label');PERFORM haven.provider_report_text(NEW.details,'source_provenance');
  IF NEW.details->>'signer_role' IS NULL OR NEW.details->>'signer_role' NOT IN('caseworker','resident','administrator','other') OR (NEW.details->>'page')::integer IS NULL OR (NEW.details->>'page')::integer NOT BETWEEN 1 AND 10000 OR (v.page_count IS NOT NULL AND (NEW.details->>'page')::integer>v.page_count) THEN RAISE EXCEPTION 'Actual version-bound signature observation required';END IF;
  PERFORM haven.provider_report_time(NEW.details,'signed_at','signed_on',c->>'timezone',false,false);
  IF NEW.details->>'corrects_event_id' IS NOT NULL THEN SELECT * INTO old FROM haven.provider_report_events WHERE id=(NEW.details->>'corrects_event_id')::uuid AND expectation_id=e.id AND kind='signature_observation';IF NOT FOUND OR old.reference_version_id<>v.id THEN RAISE EXCEPTION 'Signature correction must retain its native version';END IF;END IF;
  NEW.details:=NEW.details||jsonb_build_object('verification','operator_observed','page_status',CASE WHEN v.page_count IS NULL THEN 'operator_reported_unverified' ELSE 'within_verified_image_page_count' END);
 ELSE
  SELECT * INTO i FROM public.operation_issues WHERE id=(NEW.details->>'issue_id')::uuid;
  IF NOT FOUND OR i.subject_id IS DISTINCT FROM (c->>'subject_id')::uuid OR i.facility_id<>e.facility_id OR i.authority_class<>'resident' THEN RAISE EXCEPTION 'Same-task chase issue required' USING ERRCODE='42501';END IF;
 END IF;
 NEW.actor_id:=haven.authorized_user_id();NEW.recorded_at:=clock_timestamp();NEW.sequence:=(head->>'event_count')::bigint+1;
 NEW.request_hash:=encode(sha256(convert_to(jsonb_build_object('expectation',e.id,'kind',NEW.kind,'expected_revision',NEW.expected_revision,'details',NEW.details-ARRAY['verification','page_status'])::text,'UTF8')),'hex');
 IF NEW.reference_version_id IS NOT NULL THEN PERFORM public.provider_document_target(NEW.task_id,NEW.reference_version_id);END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(NEW.task_id,true) THEN RAISE EXCEPTION 'Report scope changed after capture' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_provider_report_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER provider_report_event_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.provider_report_events FOR EACH ROW EXECUTE FUNCTION haven.guard_provider_report_event();
CREATE TRIGGER provider_report_event_no_truncate BEFORE TRUNCATE ON haven.provider_report_events FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_provider_report_event();

CREATE FUNCTION public.provider_report_snapshot(p_task uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;headers jsonb;h jsonb;e haven.provider_report_expectations;due jsonb;receipt jsonb;review jsonb;last_review jsonb;chase public.operation_issues;events jsonb;versions jsonb;contacts jsonb;candidates jsonb;items jsonb:='[]';visible_count integer;complete boolean:=true;owner_label text;
BEGIN
 c:=haven.provider_report_scope(p_task,false);headers:=haven.provider_report_headers(p_task);
 IF jsonb_array_length(headers)>100 THEN RAISE EXCEPTION 'Report history exceeds complete reader bound' USING ERRCODE='54000';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'label',n.name,'type',n.contact_type) ORDER BY n.id),'[]') INTO contacts FROM(SELECT * FROM public.resident_contacts WHERE resident_id=(c->>'resident_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND deleted_at IS NULL ORDER BY id LIMIT 101) n;
 SELECT coalesce(jsonb_agg(haven.provider_document_json(v) ORDER BY v.prepared_at,v.id),'[]') INTO versions FROM(SELECT * FROM public.resident_document_versions WHERE resident_id=(c->>'resident_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND organization_id=(c->>'organization_id')::uuid ORDER BY prepared_at,id LIMIT 101) v;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label','Follow-up · '||i.status||' · '||left(i.id::text,8),'status',i.status,'owner_label',coalesce(u.full_name,i.owner_role::text)) ORDER BY i.id),'[]') INTO candidates FROM(SELECT * FROM public.operation_issues WHERE subject_id=(c->>'subject_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND authority_class='resident' ORDER BY id LIMIT 101) i LEFT JOIN public.user_profiles u ON u.id=i.owner_user_id;
 IF jsonb_array_length(contacts)>100 OR jsonb_array_length(versions)>100 OR jsonb_array_length(candidates)>100 THEN RAISE EXCEPTION 'Native candidates exceed complete reader bound' USING ERRCODE='54000';END IF;
 FOR h IN SELECT value FROM jsonb_array_elements(headers) LOOP
  SELECT * INTO e FROM haven.provider_report_expectations WHERE id=(h->>'id')::uuid;
  IF NOT FOUND THEN complete:=false;CONTINUE;END IF;
  WITH visible AS MATERIALIZED(SELECT * FROM haven.provider_report_events WHERE expectation_id=e.id),page AS(SELECT * FROM visible ORDER BY sequence DESC LIMIT 100)
  SELECT (SELECT count(*) FROM visible),coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'task_id',task_id,'kind',kind,'actor_id',actor_id,'recorded_at',recorded_at,'details',details) ORDER BY sequence DESC) FROM page),'[]') INTO visible_count,events;
  IF visible_count<>(h->>'event_count')::integer THEN complete:=false;CONTINUE;END IF;
  SELECT details INTO due FROM haven.provider_report_events WHERE expectation_id=e.id AND kind='set_due' ORDER BY sequence DESC LIMIT 1;
  SELECT details INTO receipt FROM haven.provider_report_events WHERE expectation_id=e.id AND kind='attach_receipt' ORDER BY sequence DESC LIMIT 1;
  SELECT details INTO review FROM haven.provider_report_events WHERE expectation_id=e.id AND kind='review' AND task_id=p_task AND details->>'version_id'=receipt->>'version_id' ORDER BY sequence DESC LIMIT 1;
  SELECT jsonb_build_object('task_id',task_id,'recorded_at',recorded_at,'reviewer_id',actor_id,'result',details->>'result') INTO last_review FROM haven.provider_report_events WHERE expectation_id=e.id AND kind='review' AND details->>'version_id'=receipt->>'version_id' ORDER BY sequence DESC LIMIT 1;
  SELECT i.* INTO chase FROM public.operation_issues i JOIN haven.provider_report_events ev ON ev.details->>'issue_id'=i.id::text WHERE ev.expectation_id=e.id AND ev.kind='link_chase' ORDER BY ev.sequence DESC LIMIT 1;
  SELECT full_name INTO owner_label FROM public.user_profiles WHERE id=chase.owner_user_id;
  items:=items||jsonb_build_array(jsonb_build_object('id',e.id,'origin_task_id',e.task_id,'revision',h->>'revision','document_type',e.document_type,'expected_version',e.expected_version,'contact_id',e.contact_id,'contact_label',e.observed_contact_label,'contact_current',EXISTS(SELECT 1 FROM public.resident_contacts n WHERE n.id=e.contact_id AND encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex')=e.contact_version),
   'service_at',e.service_at,'service_on',e.service_on,'service_provenance',e.service_provenance,'service_confirmation','operator_attested','due_at',due->>'due_at','due_on',due->>'due_on','due_state',CASE WHEN due IS NULL THEN 'unknown' WHEN (due->>'effective_date')::date>(clock_timestamp() AT TIME ZONE(c->>'timezone'))::date THEN 'documented_approval_pending_effective' ELSE 'documented_approval' END,'due_provenance',due,'overdue',coalesce((due->>'effective_date')::date<=(clock_timestamp() AT TIME ZONE(c->>'timezone'))::date,false) AND coalesce((due->>'due_at')::timestamptz<clock_timestamp(),(due->>'due_on')::date<(clock_timestamp() AT TIME ZONE(c->>'timezone'))::date,false),
   'current_version_id',receipt->>'version_id','received_at',receipt->>'received_at','received_on',receipt->>'received_on','receipt_provenance',receipt->>'receipt_provenance','review_state',coalesce(review->>'result','not_reviewed'),'last_review',last_review,'required_signers','unknown',
   'chase_issue_id',chase.id,'owner_user_id',chase.owner_user_id,'owner_role',chase.owner_role,'owner_label',coalesce(owner_label,chase.owner_role::text),'follow_up_at',chase.follow_up_at,'events',events,'events_complete',visible_count<=100));
 END LOOP;
 IF headers IS DISTINCT FROM haven.provider_report_headers(p_task) THEN RAISE EXCEPTION 'Report revision changed during read' USING ERRCODE='40001';END IF;
 FOR h IN SELECT value FROM jsonb_array_elements(headers) LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE x->>'id'=h->>'id') AND ((SELECT count(*) FROM haven.provider_report_events WHERE expectation_id=(h->>'id')::uuid)<>(h->>'event_count')::integer OR NOT EXISTS(SELECT 1 FROM haven.provider_report_expectations WHERE id=(h->>'id')::uuid)) THEN RAISE EXCEPTION 'Native report reference visibility changed' USING ERRCODE='42501';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(versions) x WHERE NOT EXISTS(SELECT 1 FROM public.resident_document_versions v WHERE v.id=(x->>'id')::uuid)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(contacts) x WHERE NOT EXISTS(SELECT 1 FROM public.resident_contacts n WHERE n.id=(x->>'id')::uuid AND n.deleted_at IS NULL)) THEN RAISE EXCEPTION 'Native source visibility changed' USING ERRCODE='42501';END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,false) THEN RAISE EXCEPTION 'Native report scope changed during history read' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('task_id',p_task,'eligible',true,'availability','available','reason',CASE WHEN complete THEN 'Operator-attested service and administrative history only; provider signatures, applicability and renewal rules are not inferred.' ELSE 'Some report history is not currently native-readable; no empty-report conclusion is established.' END,'resident_id',c->'resident_id','can_manage',(c->>'can_manage')::boolean,'can_intake',(c->>'can_manage')::boolean AND (c->>'native_write')::boolean,'contacts',contacts,'chase_candidates',candidates,'expectations',items,'versions',versions,'complete',complete);
END $$;
REVOKE ALL ON FUNCTION public.provider_report_snapshot(uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.provider_report_snapshot(uuid) TO authenticated;
CREATE FUNCTION public.provider_report_command(p_task uuid,p_request_key text,p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;e haven.provider_report_expectations;ev haven.provider_report_events;expected text;details jsonb;issue jsonb;kind text:=p_action;
BEGIN
 c:=haven.provider_report_scope(p_task,true);IF p_request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Valid report request required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-request:'||haven.authorized_user_id()::text||':'||p_request_key,0));c:=haven.provider_report_scope(p_task,true);
 IF p_action='create' THEN
  IF p_payload-ARRAY['contact_id','document_type','expected_version','service_at','service_on','service_provenance']<>'{}' THEN RAISE EXCEPTION 'Unknown service expectation fields';END IF;
  PERFORM haven.provider_report_text(p_payload,'expected_version');PERFORM haven.provider_report_text(p_payload,'service_provenance');PERFORM haven.provider_report_time(p_payload,'service_at','service_on',c->>'timezone',true,false);
  expected:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'contact',(p_payload->>'contact_id')::uuid,'type',p_payload->>'document_type','expected',p_payload->>'expected_version','service_at',(p_payload->>'service_at')::timestamptz,'service_on',(p_payload->>'service_on')::date,'provenance',p_payload->>'service_provenance')::text,'UTF8')),'hex');
  SELECT * INTO e FROM haven.provider_report_expectations WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
  IF FOUND THEN IF e.request_hash<>expected OR e.task_id<>p_task THEN RAISE EXCEPTION 'Report request scope/content conflict' USING ERRCODE='23505';END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM haven.provider_report_events WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key) THEN RAISE EXCEPTION 'Report request already used' USING ERRCODE='23505';END IF;
   INSERT INTO haven.provider_report_expectations(task_id,contact_id,document_type,expected_version,service_at,service_on,service_provenance,request_key) VALUES(p_task,(p_payload->>'contact_id')::uuid,p_payload->>'document_type',p_payload->>'expected_version',(p_payload->>'service_at')::timestamptz,(p_payload->>'service_on')::date,p_payload->>'service_provenance',p_request_key) RETURNING * INTO e;
  END IF;
 ELSE
  SELECT * INTO e FROM haven.provider_report_expectations WHERE id=(p_payload->>'expectation_id')::uuid AND resident_id=(c->>'resident_id')::uuid AND facility_id=(c->>'facility_id')::uuid AND organization_id=(c->>'organization_id')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'Report expectation unavailable' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM haven.provider_report_expectations WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key) THEN RAISE EXCEPTION 'Report request already used' USING ERRCODE='23505';END IF;
  details:=p_payload-ARRAY['expectation_id','expected_revision'];
  IF p_action='create_chase' THEN
   IF details<>'{}' THEN RAISE EXCEPTION 'Generic chase takes no clinical fields';END IF;
   issue:=public.report_operation_issue_review(encode(sha256(convert_to('provider-chase:'||p_request_key,'UTF8')),'hex'),jsonb_build_object('task_instance_id',p_task,'kind','problem','summary','Follow-up required','severity','normal'));
   details:=jsonb_build_object('issue_id',issue->'issue'->>'id');kind:='link_chase';
  END IF;
  expected:=encode(sha256(convert_to(jsonb_build_object('expectation',e.id,'kind',kind,'expected_revision',(p_payload->>'expected_revision')::uuid,'details',details)::text,'UTF8')),'hex');
  SELECT * INTO ev FROM haven.provider_report_events WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
  IF FOUND THEN IF ev.task_id<>p_task OR ev.request_hash<>expected THEN RAISE EXCEPTION 'Report request scope/content conflict' USING ERRCODE='23505';END IF;
  ELSE INSERT INTO haven.provider_report_events(expectation_id,task_id,kind,details,expected_revision,request_key) VALUES(e.id,p_task,kind,details,(p_payload->>'expected_revision')::uuid,p_request_key);END IF;
 END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,true) THEN RAISE EXCEPTION 'Report authority changed' USING ERRCODE='42501';END IF;
 RETURN public.provider_report_snapshot(p_task);
END $$;
REVOKE ALL ON FUNCTION public.provider_report_command(uuid,text,text,jsonb) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.provider_report_command(uuid,text,text,jsonb) TO authenticated;

CREATE FUNCTION haven.provider_report_time(p jsonb,at_key text,on_key text,tz text,required boolean,future_allowed boolean) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE a text:=p->>at_key;d text:=p->>on_key;t timestamptz;day date;
BEGIN
 IF (a IS NOT NULL AND d IS NOT NULL) OR (required AND a IS NULL AND d IS NULL) THEN RAISE EXCEPTION 'Retain one actual date precision: %',at_key USING ERRCODE='22023';END IF;
 IF a IS NOT NULL THEN
  IF a!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Exact timestamp requires recorded offset';END IF;t:=a::timestamptz;
  IF NOT isfinite(t) OR (NOT future_allowed AND t>clock_timestamp()) THEN RAISE EXCEPTION 'Recorded timestamp cannot be future';END IF;
 END IF;
 IF d IS NOT NULL THEN
  IF d!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Actual calendar date required';END IF;day:=d::date;
  IF NOT isfinite(day) OR (NOT future_allowed AND day>(clock_timestamp() AT TIME ZONE tz)::date) THEN RAISE EXCEPTION 'Recorded date cannot be future';END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.provider_report_time(jsonb,text,text,text,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.provider_report_time(jsonb,text,text,text,boolean,boolean) TO authenticated;

CREATE TABLE haven.provider_contact_requests(task_id uuid NOT NULL,actor_id uuid NOT NULL,request_key text NOT NULL,contact_id uuid NOT NULL REFERENCES public.resident_contacts(id),request_hash text NOT NULL,PRIMARY KEY(actor_id,request_key));
ALTER TABLE haven.provider_contact_requests ENABLE ROW LEVEL SECURITY;REVOKE ALL ON haven.provider_contact_requests FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT ON haven.provider_contact_requests TO authenticated;
CREATE POLICY provider_contact_request_read ON haven.provider_contact_requests FOR SELECT TO authenticated USING(actor_id=haven.authorized_user_id() AND haven.provider_report_readable(task_id));
CREATE POLICY provider_contact_request_insert ON haven.provider_contact_requests FOR INSERT TO authenticated WITH CHECK(actor_id=haven.authorized_user_id() AND haven.provider_report_readable(task_id));
CREATE FUNCTION haven.guard_provider_contact_request() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;n public.resident_contacts;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Native contact request history is immutable';END IF;c:=haven.provider_report_scope(NEW.task_id,true);
 IF NOT(c->>'native_write')::boolean THEN RAISE EXCEPTION 'Native contact writer required' USING ERRCODE='42501';END IF;
 SELECT * INTO n FROM public.resident_contacts WHERE id=NEW.contact_id;
 IF NOT FOUND OR (n.resident_id,n.facility_id,n.organization_id,n.created_by) IS DISTINCT FROM ((c->>'resident_id')::uuid,(c->>'facility_id')::uuid,(c->>'organization_id')::uuid,haven.authorized_user_id()) THEN RAISE EXCEPTION 'Current native contact creation required' USING ERRCODE='42501';END IF;
 IF NEW.request_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'Request key required';END IF;
 NEW.actor_id:=haven.authorized_user_id();NEW.request_hash:=encode(sha256(convert_to(jsonb_build_object('task',NEW.task_id,'name',n.name,'type',n.contact_type)::text,'UTF8')),'hex');
 IF c IS DISTINCT FROM haven.provider_report_scope(NEW.task_id,true) THEN RAISE EXCEPTION 'Native contact scope changed' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_provider_contact_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER provider_contact_request_guard BEFORE INSERT OR UPDATE OR DELETE ON haven.provider_contact_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_provider_contact_request();
CREATE TRIGGER provider_contact_request_no_truncate BEFORE TRUNCATE ON haven.provider_contact_requests FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_provider_contact_request();
CREATE FUNCTION public.create_provider_contact(p_task uuid,p_request_key text,p_name text,p_contact_type text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb;old haven.provider_contact_requests;n public.resident_contacts;expected text;
BEGIN
 c:=haven.provider_report_scope(p_task,true);IF NOT(c->>'native_write')::boolean THEN RAISE EXCEPTION 'Native contact writer required' USING ERRCODE='42501';END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(btrim(p_contact_type)) NOT BETWEEN 1 AND 80 OR p_name IS NULL OR p_contact_type IS NULL THEN RAISE EXCEPTION 'Native contact name and type required';END IF;
 expected:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'name',btrim(p_name),'type',btrim(p_contact_type))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('provider-contact:'||haven.authorized_user_id()::text||':'||p_request_key,0));c:=haven.provider_report_scope(p_task,true);
 SELECT * INTO old FROM haven.provider_contact_requests WHERE actor_id=haven.authorized_user_id() AND request_key=p_request_key;
 IF FOUND THEN
  IF old.request_hash<>expected OR old.task_id<>p_task THEN RAISE EXCEPTION 'Contact request scope/content conflict' USING ERRCODE='23505';END IF;SELECT * INTO n FROM public.resident_contacts WHERE id=old.contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Native contact unavailable' USING ERRCODE='42501';END IF;
 ELSE
  INSERT INTO public.resident_contacts(resident_id,facility_id,organization_id,name,contact_type,created_by,updated_by) VALUES((c->>'resident_id')::uuid,(c->>'facility_id')::uuid,(c->>'organization_id')::uuid,btrim(p_name),btrim(p_contact_type),haven.authorized_user_id(),haven.authorized_user_id()) RETURNING * INTO n;
  INSERT INTO haven.provider_contact_requests(task_id,actor_id,request_key,contact_id,request_hash) VALUES(p_task,haven.authorized_user_id(),p_request_key,n.id,expected);
 END IF;
 IF c IS DISTINCT FROM haven.provider_report_scope(p_task,true) THEN RAISE EXCEPTION 'Native contact scope changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('task_id',p_task,'resident_id',c->'resident_id','contact',jsonb_build_object('id',n.id,'label',n.name,'type',n.contact_type));
END $$;
REVOKE ALL ON FUNCTION public.create_provider_contact(uuid,text,text,text) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.create_provider_contact(uuid,text,text,text) TO authenticated;
COMMIT;
