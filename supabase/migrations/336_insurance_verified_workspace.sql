-- Verified insurance intake: server-only processing, reviewed publication and scoped summaries.
ALTER TABLE public.insurance_policies
 ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified' CHECK(verification_status IN('unverified','verified')),
 ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 ADD COLUMN predecessor_policy_id uuid REFERENCES public.insurance_policies(id),
 ADD COLUMN shared_limit boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX insurance_verified_term_identity ON public.insurance_policies(organization_id,entity_id,lower(btrim(carrier_name)),lower(btrim(policy_number)),effective_date) WHERE deleted_at IS NULL AND verification_status='verified';
CREATE TABLE public.insurance_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid REFERENCES public.facilities(id),filename text NOT NULL,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 mime_type text NOT NULL CHECK(mime_type IN('application/pdf','text/plain')),byte_size integer NOT NULL CHECK(byte_size>0 AND byte_size<=4194304),
 family text NOT NULL,storage_path text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','ready','quarantined','failed')),
 scan_status text NOT NULL DEFAULT 'not_configured' CHECK(scan_status IN('not_configured','clean','quarantined','failed')),
 extraction_status text NOT NULL DEFAULT 'pending' CHECK(extraction_status IN('pending','processing','review_required','failed','manual_review')),
 run_id uuid,lease_expires_at timestamptz,error text,created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 UNIQUE(organization_id,sha256)
);
CREATE TABLE public.insurance_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),document_id uuid REFERENCES public.insurance_documents(id),
 kind text NOT NULL CHECK(kind IN('new_policy','verification','endorsement','renewal')),policy_id uuid REFERENCES public.insurance_policies(id),expected_version integer,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected')),
 payload jsonb NOT NULL DEFAULT '{}',evidence jsonb NOT NULL DEFAULT '{}',extraction_metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(extraction_metadata)='object'),result jsonb,rejection_reason text,
 created_by uuid NOT NULL REFERENCES auth.users(id),updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE TABLE public.insurance_policy_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),policy_id uuid NOT NULL REFERENCES public.insurance_policies(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),role text NOT NULL CHECK(length(btrim(role))>0),effective_from date NOT NULL,effective_to date,
 created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE public.insurance_policy_facilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),policy_id uuid NOT NULL REFERENCES public.insurance_policies(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),role text NOT NULL CHECK(length(btrim(role))>0),effective_from date NOT NULL,effective_to date,
 created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE public.insurance_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),policy_id uuid NOT NULL REFERENCES public.insurance_policies(id),
 version integer NOT NULL,draft_id uuid NOT NULL UNIQUE REFERENCES public.insurance_drafts(id),kind text NOT NULL,change_effective_date date,
 before_snapshot jsonb, snapshot jsonb NOT NULL,evidence jsonb NOT NULL,approved_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(policy_id,version)
);
CREATE TABLE public.insurance_work_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),facility_id uuid REFERENCES public.facilities(id),
 policy_id uuid REFERENCES public.insurance_policies(id),document_id uuid REFERENCES public.insurance_documents(id),kind text NOT NULL,title text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','completed','dismissed')),owner_id uuid REFERENCES public.user_profiles(id),due_date date,milestone_days integer,
 term_expiration_date date,superseded_at timestamptz,version integer NOT NULL DEFAULT 1,note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 UNIQUE(policy_id,term_expiration_date,milestone_days)
);
CREATE TABLE public.insurance_certificate_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),entity_id uuid NOT NULL REFERENCES public.entities(id),facility_id uuid REFERENCES public.facilities(id),
 holder_name text NOT NULL,holder_details text NOT NULL DEFAULT '',requirements text NOT NULL DEFAULT '',owner_id uuid REFERENCES public.user_profiles(id),due_date date,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','acknowledged','needs_information','issued','cancelled')),document_id uuid REFERENCES public.insurance_documents(id),
 version integer NOT NULL DEFAULT 1,note text,created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE TABLE public.insurance_policy_coverages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),policy_id uuid NOT NULL REFERENCES public.insurance_policies(id),
 coverage_type public.insurance_policy_type NOT NULL,occurrence_limit_cents integer CHECK(occurrence_limit_cents>=0),aggregate_limit_cents integer CHECK(aggregate_limit_cents>=0),deductible_cents integer CHECK(deductible_cents>=0),shared_limit_group text,
 created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE INDEX ON public.insurance_policy_coverages(policy_id) WHERE deleted_at IS NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['insurance_policy_coverages','insurance_documents','insurance_drafts','insurance_policy_parties','insurance_policy_facilities','insurance_policy_versions','insurance_work_items','insurance_certificate_requests'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('CREATE INDEX ON public.%I(organization_id)',t);
 EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log()',t||'_audit',t);
 END LOOP;
END $$;
CREATE INDEX ON public.insurance_policy_facilities(policy_id,facility_id) WHERE deleted_at IS NULL;
CREATE INDEX ON public.insurance_policy_parties(policy_id) WHERE deleted_at IS NULL;
CREATE INDEX ON public.insurance_drafts(document_id) WHERE deleted_at IS NULL;
DROP POLICY insurance_policies_select ON public.insurance_policies;
CREATE POLICY insurance_policies_select ON public.insurance_policies FOR SELECT USING(organization_id=haven.organization_id() AND deleted_at IS NULL AND haven.app_role() IN('owner','org_admin'));
-- Verified rows cannot be changed through legacy DML. SECURITY DEFINER publication is
-- owned by postgres; role identity is not a caller-writable GUC or payload flag.
CREATE FUNCTION haven.insurance_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user<>'postgres' AND ((TG_OP='INSERT' AND (NEW.verification_status<>'unverified' OR NEW.version<>0 OR NEW.predecessor_policy_id IS NOT NULL)) OR (TG_OP<>'INSERT' AND OLD.verification_status='verified') OR (TG_OP='UPDATE' AND (NEW.verification_status<>OLD.verification_status OR NEW.version<>OLD.version OR NEW.predecessor_policy_id IS DISTINCT FROM OLD.predecessor_policy_id))) THEN
 RAISE EXCEPTION 'Verified policy requires reviewed publication' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER insurance_verified_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON public.insurance_policies FOR EACH ROW EXECUTE FUNCTION haven.insurance_policy_guard();
CREATE FUNCTION haven.insurance_immutable_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Approved insurance history is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER insurance_immutable_version BEFORE UPDATE OR DELETE ON public.insurance_policy_versions FOR EACH ROW EXECUTE FUNCTION haven.insurance_immutable_version();
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('insurance-originals','insurance-originals',false,4194304,ARRAY['application/pdf','text/plain']) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=4194304,allowed_mime_types=ARRAY['application/pdf','text/plain'];
-- No authenticated storage policies: originals are streamed by a manager-authorized API.
CREATE FUNCTION haven.insurance_assert_owner(p_owner uuid,p_org uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_owner AND organization_id=p_org AND app_role IN('owner','org_admin') AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid work owner' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION haven.insurance_validate_draft(p jsonb,e jsonb,p_org uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text; x jsonb; ev jsonb; i integer; from_date date; to_date date;
BEGIN
 IF jsonb_typeof(p)<>'object' OR jsonb_typeof(e)<>'object' THEN RAISE EXCEPTION 'Invalid draft payload' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['entity_id','policy_type','carrier_name','policy_number','effective_date','expiration_date'] LOOP
 IF nullif(btrim(p->>k),'') IS NULL THEN RAISE EXCEPTION 'Missing critical field: %',k USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (p->>'effective_date')!~'^\d{4}-\d{2}-\d{2}$' OR (p->>'expiration_date')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid policy dates' USING ERRCODE='22023'; END IF;
 from_date:=(p->>'effective_date')::date;to_date:=(p->>'expiration_date')::date;
 IF to_date<from_date THEN RAISE EXCEPTION 'Invalid policy dates' USING ERRCODE='22023'; END IF;
 PERFORM (p->>'policy_type')::public.insurance_policy_type;
 IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id=(p->>'entity_id')::uuid AND organization_id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid primary entity' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'parties') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'facilities') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'shared_limit') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Explicit parties, facilities and shared_limit required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'parties') v WHERE v->>'entity_id'=p->>'entity_id' AND v->>'role'='primary_named_insured') THEN RAISE EXCEPTION 'Primary named insured must be included' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['premium_cents','aggregate_limit_cents','occurrence_limit_cents','deductible_cents'] LOOP
 IF p->>k IS NOT NULL AND (jsonb_typeof(p->k)<>'number' OR (p->>k)!~'^\d+$' OR (p->>k)::numeric>2147483647) THEN RAISE EXCEPTION 'Invalid integer cents: %',k USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['parties','facilities'] LOOP
 i:=0;
 FOR x IN SELECT value FROM jsonb_array_elements(p->k) LOOP
 IF nullif(btrim(x->>'role'),'') IS NULL OR (x->>'effective_from') IS NULL OR (x->>'effective_from')!~'^\d{4}-\d{2}-\d{2}$' OR ((x->>'effective_to') IS NOT NULL AND (x->>'effective_to')!~'^\d{4}-\d{2}-\d{2}$') OR (x->>'effective_from')::date<from_date OR (x->>'effective_from')::date>to_date OR coalesce((x->>'effective_to')::date,to_date)>to_date OR coalesce((x->>'effective_to')::date,to_date)<(x->>'effective_from')::date THEN RAISE EXCEPTION 'Invalid relationship effective interval' USING ERRCODE='22023'; END IF;
 IF (k='parties' AND NOT EXISTS(SELECT 1 FROM public.entities WHERE id=(x->>'entity_id')::uuid AND organization_id=p_org AND deleted_at IS NULL)) OR (k='facilities' AND NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=(x->>'facility_id')::uuid AND organization_id=p_org AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Invalid relationship scope' USING ERRCODE='22023'; END IF;
 IF NOT e ? (k||'.'||i) THEN RAISE EXCEPTION 'Missing relationship evidence: %.%',k,i USING ERRCODE='22023'; END IF;i:=i+1;
 END LOOP;
 END LOOP;
 FOR k IN SELECT unnest(ARRAY['entity_id','policy_type','carrier_name','policy_number','effective_date','expiration_date','shared_limit']) UNION SELECT key FROM jsonb_each(p) WHERE key IN('premium_cents','aggregate_limit_cents','occurrence_limit_cents','deductible_cents') AND value<>'null'::jsonb LOOP
 IF NOT e ? k THEN RAISE EXCEPTION 'Missing critical evidence: %',k USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p?'coverages' THEN
 IF jsonb_typeof(p->'coverages') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid coverage array' USING ERRCODE='22023'; END IF;
 i:=0;
 FOR x IN SELECT value FROM jsonb_array_elements(p->'coverages') LOOP
 IF x->>'coverage_type' IS NULL THEN RAISE EXCEPTION 'Coverage type required' USING ERRCODE='22023'; END IF;
 PERFORM (x->>'coverage_type')::public.insurance_policy_type;
 FOREACH k IN ARRAY ARRAY['aggregate_limit_cents','occurrence_limit_cents','deductible_cents'] LOOP
 IF x->>k IS NOT NULL AND (jsonb_typeof(x->k)<>'number' OR (x->>k)!~'^\d+$' OR (x->>k)::numeric>2147483647) THEN RAISE EXCEPTION 'Invalid coverage integer cents' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF NOT e?('coverages.'||i) THEN RAISE EXCEPTION 'Missing coverage evidence' USING ERRCODE='22023'; END IF;i:=i+1;
 END LOOP;
 END IF;
 FOR k,ev IN SELECT key,value FROM jsonb_each(e) LOOP
 IF ev->>'source'='manual' THEN
 IF length(btrim(coalesce(ev->>'reason','')))=0 THEN RAISE EXCEPTION 'Manual evidence needs a reason: %',k USING ERRCODE='22023'; END IF;
 ELSIF ev->>'source'='document' THEN
 IF coalesce(ev->>'page','')!~'^[1-9][0-9]*$' OR length(btrim(coalesce(ev->>'excerpt','')))=0 OR NOT EXISTS(SELECT 1 FROM public.insurance_documents WHERE id=(ev->>'document_id')::uuid AND organization_id=p_org AND status='ready' AND scan_status IN('clean','not_configured') AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid document evidence: %',k USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Invalid evidence source: %',k USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION haven.insurance_workspace_impl(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; org uuid; actor uuid; manages boolean; d public.insurance_drafts; doc public.insurance_documents; pol public.insurance_policies; item public.insurance_work_items; cert public.insurance_certificate_requests;
 v_id uuid; v_facility uuid; v_entity uuid; v_owner uuid; v_payload jsonb; v_result jsonb; v_before jsonb; x jsonb; n integer; days integer; as_of date; v_change date;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor(); org:=a.actor_organization_id;actor:=a.actor_user_id;
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 manages:=a.actor_role_text IN('owner','org_admin');
 IF NOT manages AND a.actor_role_text<>'facility_admin' THEN RAISE EXCEPTION 'Insurance access forbidden' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid payload' USING ERRCODE='22023'; END IF;
 v_facility:=(p_payload->>'facility_id')::uuid;
 IF v_facility IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=v_facility AND organization_id=org AND deleted_at IS NULL AND (manages OR id IN(SELECT haven.accessible_facility_ids()))) THEN RAISE EXCEPTION 'Facility access forbidden' USING ERRCODE='42501'; END IF;
 IF p_action='overview' THEN
 as_of:=coalesce((p_payload->>'as_of')::date,(now() AT TIME ZONE 'America/New_York')::date);
 v_id:=(p_payload->>'policy_id')::uuid;
 SELECT jsonb_build_object('can_manage',manages,'as_of',as_of,'pagination',jsonb_build_object('complete',true),
 'owners',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name) ORDER BY full_name,id) FROM public.user_profiles WHERE organization_id=org AND app_role IN('owner','org_admin') AND is_active AND deleted_at IS NULL),'[]') ELSE '[]'::jsonb END,
 'entities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) ORDER BY e.name,e.id) FROM public.entities e WHERE e.organization_id=org AND e.deleted_at IS NULL AND (manages OR EXISTS(SELECT 1 FROM public.facilities f WHERE f.entity_id=e.id AND f.organization_id=org AND f.deleted_at IS NULL AND f.id IN(SELECT haven.accessible_facility_ids())))),'[]'),
 'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'entity_id',f.entity_id) ORDER BY f.name,f.id) FROM public.facilities f WHERE f.organization_id=org AND f.deleted_at IS NULL AND (v_facility IS NULL OR f.id=v_facility) AND (manages OR f.id IN(SELECT haven.accessible_facility_ids()))),'[]'),
 'policies',coalesce((SELECT jsonb_agg(CASE WHEN manages THEN to_jsonb(p)||jsonb_build_object('coverages',coalesce((SELECT jsonb_agg(to_jsonb(pc) ORDER BY pc.id) FROM public.insurance_policy_coverages pc WHERE pc.policy_id=p.id AND pc.deleted_at IS NULL),'[]'),'parties',coalesce((SELECT jsonb_agg(to_jsonb(pp) ORDER BY pp.effective_from,pp.id) FROM public.insurance_policy_parties pp WHERE pp.policy_id=p.id AND pp.deleted_at IS NULL),'[]'),'facilities',coalesce((SELECT jsonb_agg(to_jsonb(pf) ORDER BY pf.effective_from,pf.id) FROM public.insurance_policy_facilities pf WHERE pf.policy_id=p.id AND pf.deleted_at IS NULL),'[]')) ELSE jsonb_build_object('id',p.id,'entity_id',p.entity_id,'policy_type',p.policy_type,'carrier_name',p.carrier_name,'policy_number',p.policy_number,'effective_date',p.effective_date,'expiration_date',p.expiration_date,'status',p.status,'verification_status',p.verification_status,'version',p.version,'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('facility_id',pf.facility_id,'role',pf.role,'effective_from',pf.effective_from,'effective_to',pf.effective_to)) FROM public.insurance_policy_facilities pf WHERE pf.policy_id=p.id AND pf.deleted_at IS NULL AND pf.effective_from<=as_of AND coalesce(pf.effective_to,p.expiration_date)>=as_of AND pf.facility_id IN(SELECT haven.accessible_facility_ids()) AND (v_facility IS NULL OR pf.facility_id=v_facility)),'[]')) END ORDER BY p.expiration_date,p.id) FROM public.insurance_policies p WHERE p.organization_id=org AND p.deleted_at IS NULL AND (v_id IS NULL OR p.id=v_id) AND (manages OR p.verification_status='verified') AND ((manages AND v_facility IS NULL) OR EXISTS(SELECT 1 FROM public.insurance_policy_facilities pf WHERE pf.policy_id=p.id AND pf.deleted_at IS NULL AND (v_facility IS NULL OR pf.facility_id=v_facility) AND (manages OR (pf.facility_id IN(SELECT haven.accessible_facility_ids()) AND pf.effective_from<=as_of AND coalesce(pf.effective_to,p.expiration_date)>=as_of))))),'[]'),
 'claims',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date_of_loss DESC,t.id) FROM public.insurance_claims t WHERE organization_id=org AND deleted_at IS NULL AND (v_id IS NULL OR insurance_policy_id=v_id)),'[]') ELSE '[]'::jsonb END,
 'premium_allocations',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.premium_allocations t WHERE organization_id=org AND deleted_at IS NULL AND (v_id IS NULL OR insurance_policy_id=v_id)),'[]') ELSE '[]'::jsonb END,
 'documents',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id) FROM public.insurance_documents t WHERE organization_id=org AND deleted_at IS NULL AND (v_facility IS NULL OR facility_id=v_facility)),'[]') ELSE '[]'::jsonb END,
 'drafts',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id) FROM public.insurance_drafts t WHERE organization_id=org AND deleted_at IS NULL AND (v_id IS NULL OR policy_id=v_id)),'[]') ELSE '[]'::jsonb END,
 'work_items',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.due_date,t.id) FROM public.insurance_work_items t WHERE organization_id=org AND deleted_at IS NULL AND (v_facility IS NULL OR facility_id=v_facility) AND (v_id IS NULL OR policy_id=v_id) AND (manages OR facility_id IN(SELECT haven.accessible_facility_ids()))),'[]'),
 'certificate_requests',coalesce((SELECT jsonb_agg(CASE WHEN manages THEN to_jsonb(t) ELSE to_jsonb(t)-'document_id' END ORDER BY t.created_at DESC,t.id) FROM public.insurance_certificate_requests t WHERE organization_id=org AND deleted_at IS NULL AND (v_facility IS NULL OR facility_id=v_facility) AND (manages OR facility_id IN(SELECT haven.accessible_facility_ids()))),'[]'),
 'versions',CASE WHEN manages THEN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id) FROM public.insurance_policy_versions t WHERE organization_id=org AND (v_id IS NULL OR policy_id=v_id)),'[]') ELSE '[]'::jsonb END) INTO v_result;
 RETURN v_result;
 END IF;
 IF p_action='create_certificate_request' THEN
 v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());v_entity:=(p_payload->>'entity_id')::uuid;v_owner:=(p_payload->>'owner_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id=v_entity AND organization_id=org AND deleted_at IS NULL) OR (NOT manages AND (v_facility IS NULL OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=v_facility AND entity_id=v_entity AND organization_id=org AND deleted_at IS NULL))) THEN RAISE EXCEPTION 'Invalid certificate entity scope' USING ERRCODE='42501'; END IF;
 IF NOT manages AND v_owner IS NOT NULL AND v_owner<>actor THEN RAISE EXCEPTION 'Owner assignment forbidden' USING ERRCODE='42501'; END IF;
 IF manages THEN PERFORM haven.insurance_assert_owner(v_owner,org); END IF;
 IF length(btrim(coalesce(p_payload->>'holder_name','')))=0 THEN RAISE EXCEPTION 'Holder name required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.insurance_certificate_requests(id,organization_id,entity_id,facility_id,holder_name,holder_details,requirements,owner_id,due_date,created_by)
 VALUES(v_id,org,v_entity,v_facility,p_payload->>'holder_name',coalesce(p_payload->>'holder_details',''),coalesce(p_payload->>'requirements',''),v_owner,(p_payload->>'due_date')::date,actor) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO cert FROM public.insurance_certificate_requests WHERE id=v_id AND organization_id=org AND deleted_at IS NULL;
 IF cert.id IS NULL OR (NOT manages AND (cert.facility_id IS NULL OR cert.facility_id NOT IN(SELECT haven.accessible_facility_ids()))) THEN RAISE EXCEPTION 'Request identity conflict' USING ERRCODE='23505'; END IF;
 IF cert.entity_id<>v_entity OR cert.facility_id IS DISTINCT FROM v_facility OR cert.holder_name IS DISTINCT FROM p_payload->>'holder_name' OR cert.holder_details<>coalesce(p_payload->>'holder_details','') OR cert.requirements<>coalesce(p_payload->>'requirements','') THEN RAISE EXCEPTION 'Request identity conflict' USING ERRCODE='23505'; END IF;
 RETURN CASE WHEN manages THEN to_jsonb(cert) ELSE to_jsonb(cert)-'document_id' END;
 END IF;
 IF NOT manages THEN RAISE EXCEPTION 'Insurance manager required' USING ERRCODE='42501'; END IF;
 IF p_action='get_document' THEN
 SELECT * INTO doc FROM public.insurance_documents WHERE id=(p_payload->>'id')::uuid AND organization_id=org AND deleted_at IS NULL AND status='ready' AND scan_status IN('clean','not_configured');
 IF doc.id IS NULL THEN RAISE EXCEPTION 'Document not found or unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.insurance_document_access(organization_id,document_id,actor_id) VALUES(org,doc.id,actor);
 RETURN to_jsonb(doc);
 ELSIF p_action='save_draft' THEN
 v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
 PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,336));
 SELECT * INTO d FROM public.insurance_drafts WHERE id=v_id FOR UPDATE;
 IF d.id IS NOT NULL THEN
 IF d.organization_id<>org OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 IF d.status<>'draft' THEN RAISE EXCEPTION 'Draft is already finalized' USING ERRCODE='40001'; END IF;
 IF NOT p_payload?'revision' AND d.kind=p_payload->>'kind' AND d.document_id IS NOT DISTINCT FROM (p_payload->>'document_id')::uuid AND d.policy_id IS NOT DISTINCT FROM (p_payload->>'policy_id')::uuid AND d.expected_version IS NOT DISTINCT FROM (p_payload->>'expected_version')::integer AND d.payload=p_payload->'payload' AND d.evidence=p_payload->'evidence' THEN RETURN to_jsonb(d); END IF;
 IF (p_payload->>'revision')::integer IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'Stale draft revision' USING ERRCODE='40001'; END IF;
 END IF;
 IF jsonb_typeof(p_payload->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'evidence') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Payload and evidence objects required' USING ERRCODE='22023'; END IF;
 IF p_payload->>'document_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.insurance_documents WHERE id=(p_payload->>'document_id')::uuid AND organization_id=org AND deleted_at IS NULL AND status='ready') THEN RAISE EXCEPTION 'Document not found or unavailable' USING ERRCODE='P0002'; END IF;
 IF p_payload->>'kind' IN('verification','endorsement','renewal') THEN
 SELECT * INTO pol FROM public.insurance_policies WHERE id=(p_payload->>'policy_id')::uuid AND organization_id=org AND deleted_at IS NULL;
 IF pol.id IS NULL THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE='P0002'; END IF;
 IF (p_payload->>'expected_version')::integer IS DISTINCT FROM pol.version THEN RAISE EXCEPTION 'Stale policy version' USING ERRCODE='40001'; END IF;
 ELSIF p_payload->>'kind' IS DISTINCT FROM 'new_policy' OR p_payload->>'policy_id' IS NOT NULL THEN RAISE EXCEPTION 'Invalid draft kind' USING ERRCODE='22023'; END IF;
 IF d.id IS NULL THEN
 INSERT INTO public.insurance_drafts(id,organization_id,document_id,kind,policy_id,expected_version,payload,evidence,created_by,updated_by)
 VALUES(v_id,org,(p_payload->>'document_id')::uuid,p_payload->>'kind',(p_payload->>'policy_id')::uuid,(p_payload->>'expected_version')::integer,p_payload->'payload',p_payload->'evidence',actor,actor) RETURNING * INTO d;
 ELSE
 UPDATE public.insurance_drafts SET document_id=(p_payload->>'document_id')::uuid,kind=p_payload->>'kind',policy_id=(p_payload->>'policy_id')::uuid,expected_version=(p_payload->>'expected_version')::integer,payload=p_payload->'payload',evidence=p_payload->'evidence',revision=revision+1,updated_at=now(),updated_by=actor WHERE id=v_id RETURNING * INTO d;
 END IF;
 RETURN to_jsonb(d);
 ELSIF p_action IN('approve_draft','reject_draft') THEN
 SELECT * INTO d FROM public.insurance_drafts WHERE id=(p_payload->>'id')::uuid AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 IF d.status='approved' AND p_action='approve_draft' THEN RETURN d.result; END IF;
 IF d.status<>'draft' OR (p_payload->>'revision')::integer IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'Stale or finalized draft' USING ERRCODE='40001'; END IF;
 IF p_action='reject_draft' THEN
 IF length(btrim(coalesce(p_payload->>'reason','')))=0 THEN RAISE EXCEPTION 'Rejection reason required' USING ERRCODE='22023'; END IF;
 UPDATE public.insurance_drafts SET status='rejected',rejection_reason=p_payload->>'reason',updated_by=actor,updated_at=now() WHERE id=d.id RETURNING * INTO d; RETURN to_jsonb(d);
 END IF;
 IF p_payload->'confirm_evidence' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Explicit evidence confirmation required' USING ERRCODE='22023'; END IF;
 PERFORM haven.insurance_validate_draft(d.payload,d.evidence,org);v_payload:=d.payload||jsonb_build_object('carrier_name',btrim(d.payload->>'carrier_name'),'policy_number',btrim(d.payload->>'policy_number'));
 IF d.kind='endorsement' AND NOT d.evidence?'change_effective_date' THEN RAISE EXCEPTION 'Endorsement effective date evidence required' USING ERRCODE='22023'; END IF;
 IF d.policy_id IS NOT NULL THEN
 SELECT * INTO pol FROM public.insurance_policies WHERE id=d.policy_id AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF pol.id IS NULL THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE='P0002'; END IF;
 IF pol.version IS DISTINCT FROM d.expected_version THEN RAISE EXCEPTION 'Stale policy version' USING ERRCODE='40001'; END IF;
 SELECT snapshot INTO v_before FROM public.insurance_policy_versions WHERE policy_id=pol.id ORDER BY version DESC LIMIT 1;
 v_before:=coalesce(v_before,to_jsonb(pol));
 END IF;
 IF d.kind='endorsement' THEN
 IF pol.verification_status<>'verified' THEN RAISE EXCEPTION 'Endorsement requires verified term' USING ERRCODE='22023'; END IF;
 IF (v_payload->>'entity_id')::uuid<>pol.entity_id OR (v_payload->>'policy_type')::public.insurance_policy_type<>pol.policy_type OR v_payload->>'carrier_name'<>pol.carrier_name OR v_payload->>'policy_number'<>pol.policy_number OR (v_payload->>'effective_date')::date<>pol.effective_date OR (v_payload->>'expiration_date')::date<>pol.expiration_date THEN RAISE EXCEPTION 'Endorsement cannot change term identity or dates; use renewal' USING ERRCODE='22023'; END IF;
 v_change:=(v_payload->>'change_effective_date')::date;
 IF v_change IS NULL OR v_change<pol.effective_date OR v_change>pol.expiration_date THEN RAISE EXCEPTION 'Endorsement effective date required within term' USING ERRCODE='22023'; END IF;
 -- Unchanged links preserve intervals. A changed schedule cannot rewrite the period before its effective date.
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(v_before->'parties','[]')) LOOP
 IF (x->>'effective_from')::date<v_change AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'parties') z WHERE z->>'entity_id'=x->>'entity_id' AND z->>'role'=x->>'role' AND z->>'effective_from'=x->>'effective_from' AND least(coalesce((z->>'effective_to')::date,pol.expiration_date),v_change-1)=least(coalesce((x->>'effective_to')::date,pol.expiration_date),v_change-1)) THEN RAISE EXCEPTION 'Endorsement must preserve prior party intervals' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(v_before->'facilities','[]')) LOOP
 IF (x->>'effective_from')::date<v_change AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'facilities') z WHERE z->>'facility_id'=x->>'facility_id' AND z->>'role'=x->>'role' AND z->>'effective_from'=x->>'effective_from' AND least(coalesce((z->>'effective_to')::date,pol.expiration_date),v_change-1)=least(coalesce((x->>'effective_to')::date,pol.expiration_date),v_change-1)) THEN RAISE EXCEPTION 'Endorsement must preserve prior facility intervals' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(v_payload->'parties') LOOP
 IF (x->>'effective_from')::date<v_change AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(v_before->'parties','[]')) z WHERE z->>'entity_id'=x->>'entity_id' AND z->>'role'=x->>'role' AND z->>'effective_from'=x->>'effective_from' AND least(coalesce((z->>'effective_to')::date,pol.expiration_date),v_change-1)=least(coalesce((x->>'effective_to')::date,pol.expiration_date),v_change-1)) THEN RAISE EXCEPTION 'New party cannot predate endorsement' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(v_payload->'facilities') LOOP
 IF (x->>'effective_from')::date<v_change AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(v_before->'facilities','[]')) z WHERE z->>'facility_id'=x->>'facility_id' AND z->>'role'=x->>'role' AND z->>'effective_from'=x->>'effective_from' AND least(coalesce((z->>'effective_to')::date,pol.expiration_date),v_change-1)=least(coalesce((x->>'effective_to')::date,pol.expiration_date),v_change-1)) THEN RAISE EXCEPTION 'New facility cannot predate endorsement' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE public.insurance_policies SET broker_name=v_payload->>'broker_name',premium_cents=(v_payload->>'premium_cents')::integer,aggregate_limit_cents=(v_payload->>'aggregate_limit_cents')::integer,occurrence_limit_cents=(v_payload->>'occurrence_limit_cents')::integer,deductible_cents=(v_payload->>'deductible_cents')::integer,premium_period=v_payload->>'premium_period',notes=v_payload->>'notes',shared_limit=(v_payload->>'shared_limit')::boolean,version=version+1,updated_by=actor WHERE id=pol.id RETURNING * INTO pol;
 UPDATE public.insurance_policy_parties SET deleted_at=now() WHERE policy_id=pol.id AND deleted_at IS NULL;
 UPDATE public.insurance_policy_facilities SET deleted_at=now() WHERE policy_id=pol.id AND deleted_at IS NULL;
 ELSIF d.kind='verification' THEN
 IF pol.verification_status<>'unverified' THEN RAISE EXCEPTION 'Verification requires unverified policy' USING ERRCODE='40001'; END IF;
 UPDATE public.insurance_policies SET entity_id=(v_payload->>'entity_id')::uuid,policy_type=(v_payload->>'policy_type')::public.insurance_policy_type,carrier_name=v_payload->>'carrier_name',broker_name=v_payload->>'broker_name',policy_number=v_payload->>'policy_number',effective_date=(v_payload->>'effective_date')::date,expiration_date=(v_payload->>'expiration_date')::date,premium_cents=(v_payload->>'premium_cents')::integer,aggregate_limit_cents=(v_payload->>'aggregate_limit_cents')::integer,occurrence_limit_cents=(v_payload->>'occurrence_limit_cents')::integer,deductible_cents=(v_payload->>'deductible_cents')::integer,premium_period=v_payload->>'premium_period',notes=v_payload->>'notes',shared_limit=(v_payload->>'shared_limit')::boolean,verification_status='verified',version=1,updated_by=actor WHERE id=pol.id RETURNING * INTO pol;
 ELSE
 IF EXISTS(SELECT 1 FROM public.insurance_policies p WHERE p.organization_id=org AND p.deleted_at IS NULL AND p.verification_status='unverified' AND p.entity_id=(v_payload->>'entity_id')::uuid AND lower(btrim(p.carrier_name))=lower(btrim(v_payload->>'carrier_name')) AND lower(btrim(p.policy_number))=lower(btrim(v_payload->>'policy_number')) AND p.effective_date=(v_payload->>'effective_date')::date) THEN RAISE EXCEPTION 'Existing legacy term requires explicit verification' USING ERRCODE='23505'; END IF;
 INSERT INTO public.insurance_policies(organization_id,entity_id,policy_type,carrier_name,broker_name,policy_number,effective_date,expiration_date,premium_cents,aggregate_limit_cents,occurrence_limit_cents,deductible_cents,premium_period,notes,shared_limit,status,verification_status,version,predecessor_policy_id,created_by,updated_by)
 VALUES(org,(v_payload->>'entity_id')::uuid,(v_payload->>'policy_type')::public.insurance_policy_type,v_payload->>'carrier_name',v_payload->>'broker_name',v_payload->>'policy_number',(v_payload->>'effective_date')::date,(v_payload->>'expiration_date')::date,(v_payload->>'premium_cents')::integer,(v_payload->>'aggregate_limit_cents')::integer,(v_payload->>'occurrence_limit_cents')::integer,(v_payload->>'deductible_cents')::integer,v_payload->>'premium_period',v_payload->>'notes',(v_payload->>'shared_limit')::boolean,CASE WHEN (v_payload->>'expiration_date')::date<(now() AT TIME ZONE 'America/New_York')::date THEN 'expired'::public.insurance_policy_status ELSE 'active'::public.insurance_policy_status END,'verified',1,CASE WHEN d.kind='renewal' THEN d.policy_id ELSE NULL END,actor,actor) RETURNING * INTO pol;
 END IF;
 INSERT INTO public.insurance_policy_parties(organization_id,policy_id,entity_id,role,effective_from,effective_to) SELECT org,pol.id,(z->>'entity_id')::uuid,z->>'role',(z->>'effective_from')::date,(z->>'effective_to')::date FROM jsonb_array_elements(v_payload->'parties') z;
 INSERT INTO public.insurance_policy_facilities(organization_id,policy_id,facility_id,role,effective_from,effective_to) SELECT org,pol.id,(z->>'facility_id')::uuid,z->>'role',(z->>'effective_from')::date,(z->>'effective_to')::date FROM jsonb_array_elements(v_payload->'facilities') z;
 UPDATE public.insurance_policy_coverages SET deleted_at=now() WHERE policy_id=pol.id AND deleted_at IS NULL;
 INSERT INTO public.insurance_policy_coverages(organization_id,policy_id,coverage_type,occurrence_limit_cents,aggregate_limit_cents,deductible_cents,shared_limit_group) SELECT org,pol.id,(z->>'coverage_type')::public.insurance_policy_type,(z->>'occurrence_limit_cents')::integer,(z->>'aggregate_limit_cents')::integer,(z->>'deductible_cents')::integer,z->>'shared_limit_group' FROM jsonb_array_elements(coalesce(v_payload->'coverages','[]')) z;
 INSERT INTO public.insurance_policy_versions(organization_id,policy_id,version,draft_id,kind,change_effective_date,before_snapshot,snapshot,evidence,approved_by) VALUES(org,pol.id,pol.version,d.id,d.kind,v_change,v_before,to_jsonb(pol)||jsonb_build_object('parties',v_payload->'parties','facilities',v_payload->'facilities','coverages',coalesce(v_payload->'coverages','[]')),d.evidence,actor);
 v_result:=jsonb_build_object('policy_id',pol.id,'version',pol.version);
 UPDATE public.insurance_drafts SET status='approved',result=v_result,updated_by=actor,updated_at=now() WHERE id=d.id;
 IF d.kind<>'endorsement' AND pol.status NOT IN('cancelled','expired') AND pol.expiration_date>=(now() AT TIME ZONE 'America/New_York')::date THEN PERFORM haven.insurance_workspace_impl('configure_renewal',jsonb_build_object('policy_id',pol.id,'owner_id',actor,'milestone_days',jsonb_build_array(120,90,60,30))); END IF;
 RETURN v_result;
 ELSIF p_action='configure_renewal' THEN
 SELECT * INTO pol FROM public.insurance_policies WHERE id=(p_payload->>'policy_id')::uuid AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF pol.id IS NULL THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE='P0002'; END IF;
 v_owner:=(p_payload->>'owner_id')::uuid;PERFORM haven.insurance_assert_owner(v_owner,org);
 IF jsonb_typeof(p_payload->'milestone_days') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'milestone_days') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'One to twelve renewal milestones required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_payload->'milestone_days') LOOP
 IF jsonb_typeof(x)<>'number' OR x::text !~'^[1-9][0-9]*$' OR x::numeric>730 THEN RAISE EXCEPTION 'Invalid renewal milestone' USING ERRCODE='22023'; END IF;
 END LOOP;
 UPDATE public.insurance_work_items SET status='dismissed',note='Superseded renewal schedule',superseded_at=now(),version=version+1,updated_at=now() WHERE policy_id=pol.id AND kind='renewal' AND status='open' AND (term_expiration_date<>pol.expiration_date OR NOT (p_payload->'milestone_days') @> to_jsonb(milestone_days));
 FOR days IN SELECT DISTINCT value::integer FROM jsonb_array_elements_text(p_payload->'milestone_days') LOOP
 INSERT INTO public.insurance_work_items(organization_id,policy_id,kind,title,owner_id,due_date,milestone_days,term_expiration_date) VALUES(org,pol.id,'renewal','Renewal review: '||days||' days before expiration',v_owner,pol.expiration_date-days,days,pol.expiration_date)
 ON CONFLICT(policy_id,term_expiration_date,milestone_days) DO UPDATE SET owner_id=excluded.owner_id,
 status=CASE WHEN insurance_work_items.status='dismissed' AND insurance_work_items.superseded_at IS NOT NULL THEN 'open' ELSE insurance_work_items.status END,
 note=CASE WHEN insurance_work_items.status='dismissed' AND insurance_work_items.superseded_at IS NOT NULL THEN 'Renewal milestone restored by configuration' ELSE insurance_work_items.note END,
 superseded_at=NULL,version=insurance_work_items.version+CASE WHEN insurance_work_items.owner_id IS DISTINCT FROM excluded.owner_id OR (insurance_work_items.status='dismissed' AND insurance_work_items.superseded_at IS NOT NULL) THEN 1 ELSE 0 END,updated_at=now();
 END LOOP;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY due_date,id) FROM public.insurance_work_items t WHERE policy_id=pol.id AND deleted_at IS NULL),'[]');
 ELSIF p_action='update_work_item' THEN
 SELECT * INTO item FROM public.insurance_work_items WHERE id=(p_payload->>'id')::uuid AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF item.id IS NULL THEN RAISE EXCEPTION 'Work item not found' USING ERRCODE='P0002'; END IF;
 IF (p_payload->>'version')::integer IS DISTINCT FROM item.version THEN RAISE EXCEPTION 'Stale work item version' USING ERRCODE='40001'; END IF;
 IF p_payload->>'status' NOT IN('open','completed','dismissed') OR p_payload->>'status' IS NULL THEN RAISE EXCEPTION 'Invalid work status' USING ERRCODE='22023'; END IF;
 IF p_payload->>'status' IN('completed','dismissed') AND length(btrim(coalesce(p_payload->>'note','')))=0 THEN RAISE EXCEPTION 'Completion or dismissal note required' USING ERRCODE='22023'; END IF;
 v_owner:=CASE WHEN p_payload?'owner_id' THEN (p_payload->>'owner_id')::uuid ELSE item.owner_id END;PERFORM haven.insurance_assert_owner(v_owner,org);
 UPDATE public.insurance_work_items SET status=p_payload->>'status',superseded_at=NULL,owner_id=v_owner,due_date=CASE WHEN p_payload?'due_date' THEN (p_payload->>'due_date')::date ELSE due_date END,note=coalesce(p_payload->>'note',note),version=version+1,updated_at=now() WHERE id=item.id RETURNING * INTO item; RETURN to_jsonb(item);
 ELSIF p_action='update_certificate_request' THEN
 SELECT * INTO cert FROM public.insurance_certificate_requests WHERE id=(p_payload->>'id')::uuid AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF cert.id IS NULL THEN RAISE EXCEPTION 'Certificate request not found' USING ERRCODE='P0002'; END IF;
 IF (p_payload->>'version')::integer IS DISTINCT FROM cert.version THEN RAISE EXCEPTION 'Stale certificate version' USING ERRCODE='40001'; END IF;
 IF p_payload->>'status' NOT IN('requested','acknowledged','needs_information','issued','cancelled') OR p_payload->>'status' IS NULL THEN RAISE EXCEPTION 'Invalid certificate status' USING ERRCODE='22023'; END IF;
 IF cert.status IN('issued','cancelled') AND p_payload->>'status'<>cert.status THEN RAISE EXCEPTION 'Finalized certificate request' USING ERRCODE='40001'; END IF;
 v_id:=coalesce((p_payload->>'document_id')::uuid,cert.document_id);
 IF v_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.insurance_documents WHERE id=v_id AND organization_id=org AND status='ready' AND scan_status IN('clean','not_configured') AND family='certificate' AND deleted_at IS NULL AND (facility_id IS NULL OR facility_id=cert.facility_id)) THEN RAISE EXCEPTION 'Certificate evidence unavailable or mismatched' USING ERRCODE='22023'; END IF;
 IF p_payload->>'status'='issued' AND v_id IS NULL THEN RAISE EXCEPTION 'Issued certificate requires stored certificate evidence' USING ERRCODE='22023'; END IF;
 UPDATE public.insurance_certificate_requests SET status=p_payload->>'status',document_id=v_id,note=coalesce(p_payload->>'note',note),version=version+1,updated_at=now() WHERE id=cert.id RETURNING * INTO cert; RETURN to_jsonb(cert);
 END IF;
 RAISE EXCEPTION 'Unknown insurance command' USING ERRCODE='22023';
END $$;
CREATE TABLE public.insurance_document_access(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),document_id uuid NOT NULL REFERENCES public.insurance_documents(id),actor_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.insurance_document_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insurance_document_access FROM PUBLIC,anon,authenticated;
CREATE TRIGGER insurance_document_access_audit AFTER INSERT ON public.insurance_document_access FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER insurance_document_access_immutable BEFORE UPDATE OR DELETE ON public.insurance_document_access FOR EACH ROW EXECUTE FUNCTION haven.insurance_immutable_version();
CREATE FUNCTION public.insurance_workspace(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.insurance_workspace_impl(p_action,p_payload) $$;
REVOKE ALL ON FUNCTION public.insurance_workspace(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.insurance_workspace(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION haven.insurance_workspace_impl(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.insurance_workspace_impl(text,jsonb) TO authenticated;
CREATE FUNCTION haven.insurance_processing_impl(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;actor uuid;v_id uuid;v_run uuid;v_facility uuid;doc public.insurance_documents;d public.insurance_drafts;v_status text;
BEGIN
 org:=(p_payload->>'organization_id')::uuid;actor:=(p_payload->>'actor_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=actor AND p.organization_id=org AND p.app_role IN('owner','org_admin') AND p.is_active AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RAISE EXCEPTION 'Current insurance manager required' USING ERRCODE='42501'; END IF;
 IF p_action='register_document' THEN
 v_id:=(p_payload->>'id')::uuid;v_facility:=(p_payload->>'facility_id')::uuid;
 IF v_id IS NULL OR nullif(btrim(p_payload->>'filename'),'') IS NULL THEN RAISE EXCEPTION 'Document identity and filename required' USING ERRCODE='22023'; END IF;
 IF p_payload->>'family' NOT IN('policy','declarations','endorsement','certificate','renewal','cancellation','nonrenewal','loss_run','other') OR p_payload->>'family' IS NULL THEN RAISE EXCEPTION 'Invalid document family' USING ERRCODE='22023'; END IF;
 IF v_facility IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=v_facility AND organization_id=org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid document facility' USING ERRCODE='22023'; END IF;
 INSERT INTO public.insurance_documents(id,organization_id,facility_id,filename,sha256,mime_type,byte_size,family,storage_path,created_by)
 VALUES(v_id,org,v_facility,p_payload->>'filename',p_payload->>'sha256',p_payload->>'mime_type',(p_payload->>'byte_size')::integer,p_payload->>'family',org::text||'/'||v_id::text,actor)
 ON CONFLICT(organization_id,sha256) DO NOTHING;
 SELECT * INTO doc FROM public.insurance_documents WHERE organization_id=org AND sha256=p_payload->>'sha256' AND deleted_at IS NULL;
 IF doc.id IS NULL THEN RAISE EXCEPTION 'Document identity conflict' USING ERRCODE='23505'; END IF;
 IF doc.family IN('cancellation','nonrenewal') THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(doc.id::text,337));
 INSERT INTO public.insurance_work_items(organization_id,facility_id,document_id,kind,title,due_date,owner_id)
 SELECT org,doc.facility_id,doc.id,'urgent_notice','Urgent insurance notice review: '||doc.family,(now() AT TIME ZONE 'America/New_York')::date,actor WHERE NOT EXISTS(SELECT 1 FROM public.insurance_work_items WHERE document_id=doc.id AND kind='urgent_notice');
 END IF;
 RETURN to_jsonb(doc);
 END IF;
 v_id:=coalesce((p_payload->>'document_id')::uuid,(p_payload->>'id')::uuid);
 SELECT * INTO doc FROM public.insurance_documents WHERE id=v_id AND organization_id=org AND deleted_at IS NULL FOR UPDATE;
 IF doc.id IS NULL THEN RAISE EXCEPTION 'Document not found' USING ERRCODE='P0002'; END IF;
 IF doc.facility_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=doc.facility_id AND organization_id=org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Document facility unavailable' USING ERRCODE='42501'; END IF;
 IF p_action='finish_document' THEN
 IF doc.status='ready' THEN RETURN to_jsonb(doc); END IF;
 v_status:=p_payload->>'status';
 IF v_status NOT IN('ready','quarantined','failed') OR v_status IS NULL THEN RAISE EXCEPTION 'Invalid document disposition' USING ERRCODE='22023'; END IF;
 IF p_payload->>'scan_status' NOT IN('not_configured','clean','quarantined','failed') OR p_payload->>'scan_status' IS NULL THEN RAISE EXCEPTION 'Scan disposition required' USING ERRCODE='22023'; END IF;
 IF v_status='ready' AND (p_payload->>'scan_status' NOT IN('clean','not_configured') OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='insurance-originals' AND name=doc.storage_path)) THEN RAISE EXCEPTION 'Stored object and accepted scan disposition required' USING ERRCODE='22023'; END IF;
 UPDATE public.insurance_documents SET status=v_status,scan_status=p_payload->>'scan_status',error=left(p_payload->>'error',2000),updated_at=now() WHERE id=doc.id RETURNING * INTO doc;RETURN to_jsonb(doc);
 ELSIF p_action='start_extraction' THEN
 IF doc.status<>'ready' OR doc.scan_status NOT IN('clean','not_configured') THEN RAISE EXCEPTION 'Source document unavailable' USING ERRCODE='22023'; END IF;
 v_run:=(p_payload->>'run_id')::uuid;IF v_run IS NULL THEN RAISE EXCEPTION 'Extraction run required' USING ERRCODE='22023'; END IF;
 IF doc.extraction_status='processing' AND doc.lease_expires_at>now() THEN
 IF doc.run_id=v_run THEN RETURN to_jsonb(doc); END IF;
 RAISE EXCEPTION 'Extraction already processing' USING ERRCODE='40001'; END IF;
 IF doc.run_id=v_run THEN RAISE EXCEPTION 'Extraction run already used' USING ERRCODE='40001'; END IF;
 UPDATE public.insurance_documents SET extraction_status='processing',run_id=v_run,lease_expires_at=now()+interval '5 minutes',error=NULL,updated_at=now() WHERE id=doc.id RETURNING * INTO doc;RETURN to_jsonb(doc);
 ELSIF p_action='finish_extraction' THEN
 v_run:=(p_payload->>'run_id')::uuid;v_status:=p_payload->>'status';
 IF v_run IS NULL OR doc.run_id IS DISTINCT FROM v_run THEN RAISE EXCEPTION 'Stale extraction run' USING ERRCODE='40001'; END IF;
 IF doc.extraction_status<>'processing' THEN RETURN to_jsonb(doc); END IF;
 IF doc.lease_expires_at<now() THEN RAISE EXCEPTION 'Expired extraction lease' USING ERRCODE='40001'; END IF;
 IF doc.status<>'ready' OR doc.scan_status NOT IN('clean','not_configured') THEN RAISE EXCEPTION 'Source document unavailable' USING ERRCODE='22023'; END IF;
 IF v_status NOT IN('review_required','failed','manual_review') OR v_status IS NULL THEN RAISE EXCEPTION 'Invalid extraction outcome' USING ERRCODE='22023'; END IF;
 IF v_status='review_required' THEN
 IF doc.family NOT IN('policy','declarations') OR jsonb_typeof(p_payload->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'evidence') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Extraction requires supported family and draft objects' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'extraction_metadata') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Extraction metadata object required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.insurance_drafts(organization_id,document_id,kind,payload,evidence,extraction_metadata,created_by,updated_by) VALUES(org,doc.id,'new_policy',p_payload->'payload',p_payload->'evidence',p_payload->'extraction_metadata',actor,actor);
 END IF;
 UPDATE public.insurance_documents SET extraction_status=v_status,lease_expires_at=NULL,error=left(p_payload->>'error',2000),updated_at=now() WHERE id=doc.id RETURNING * INTO doc;RETURN to_jsonb(doc);
 END IF;
 RAISE EXCEPTION 'Unknown processing command' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.insurance_processing(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.insurance_processing_impl(p_action,p_payload) $$;
REVOKE ALL ON FUNCTION public.insurance_processing(text,jsonb),haven.insurance_processing_impl(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.insurance_processing(text,jsonb),haven.insurance_processing_impl(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION haven.insurance_assert_owner(uuid,uuid),haven.insurance_validate_draft(jsonb,jsonb,uuid),haven.insurance_policy_guard(),haven.insurance_immutable_version() FROM PUBLIC,anon,authenticated,service_role;

-- Historical vault copies retain their custody, but may not bypass the new
-- original-document boundary merely because their path begins with a facility.
CREATE FUNCTION haven.insurance_vault_path_restricted(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.facility_documents d
  WHERE d.organization_id=haven.organization_id() AND d.file_path=p_path
   AND starts_with(d.document_category,'insurance_')
  UNION ALL
  SELECT 1 FROM public.facility_document_versions d
  WHERE d.organization_id=haven.organization_id() AND d.file_path=p_path
   AND starts_with(d.document_category,'insurance_')
 );
$$;
REVOKE ALL ON FUNCTION haven.insurance_vault_path_restricted(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.insurance_vault_path_restricted(text) TO authenticated;
CREATE POLICY insurance_vault_metadata_boundary ON public.facility_documents
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
  NOT starts_with(document_category,'insurance_') OR haven.app_role() IN('owner','org_admin')
 );
CREATE POLICY insurance_vault_versions_boundary ON public.facility_document_versions
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
  NOT starts_with(document_category,'insurance_') OR haven.app_role() IN('owner','org_admin')
 );
CREATE POLICY insurance_vault_original_boundary ON storage.objects
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
  bucket_id<>'facility-documents' OR haven.app_role() IN('owner','org_admin')
 OR NOT haven.insurance_vault_path_restricted(name)
 );
CREATE FUNCTION haven.insurance_vault_record_restricted(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.facility_documents d
  WHERE d.organization_id=haven.organization_id() AND d.id=p_id
   AND starts_with(d.document_category,'insurance_')
  UNION ALL
  SELECT 1 FROM public.facility_document_versions d
  WHERE d.organization_id=haven.organization_id() AND d.superseded_document_id=p_id
   AND starts_with(d.document_category,'insurance_')
 );
$$;
REVOKE ALL ON FUNCTION haven.insurance_vault_record_restricted(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.insurance_vault_record_restricted(uuid) TO authenticated;
CREATE POLICY insurance_vault_audit_boundary ON public.facility_audit_log
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
  table_name<>'facility_documents' OR haven.app_role() IN('owner','org_admin')
  OR NOT haven.insurance_vault_record_restricted(record_id)
 );
ALTER FUNCTION haven.insurance_workspace_impl(text,jsonb) OWNER TO postgres;
ALTER FUNCTION haven.insurance_processing_impl(text,jsonb) OWNER TO postgres;
-- The generic audit feed permits facility-less records. Financial originals and
-- reviewed source snapshots must remain manager-only through that feed as well.
CREATE POLICY insurance_audit_manager_boundary ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name NOT LIKE 'insurance_%' OR haven.app_role() IN('owner','org_admin'));
-- Defense in depth against unrelated broad bucket policies added in the future.
CREATE POLICY insurance_originals_browser_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING(bucket_id<>'insurance-originals') WITH CHECK(bucket_id<>'insurance-originals');
CREATE FUNCTION haven.insurance_finalized_draft_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Finalized insurance draft is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER insurance_finalized_draft_guard BEFORE UPDATE OR DELETE ON public.insurance_drafts FOR EACH ROW EXECUTE FUNCTION haven.insurance_finalized_draft_guard();
REVOKE ALL ON FUNCTION haven.insurance_finalized_draft_guard() FROM PUBLIC,anon,authenticated,service_role;
-- Legacy routes must not bypass the new restricted register through direct table
-- reads. Facility-facing access remains the explicit minimal workspace projection.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['insurance_policies','insurance_claims','claim_activities','workers_comp_claims','insurance_renewals','renewal_data_packages','loss_runs','premium_allocations','certificates_of_insurance','entity_insurance_allocation_settings'] LOOP
 EXECUTE format('CREATE POLICY insurance_legacy_manager_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(haven.app_role() IN(''owner'',''org_admin'')) WITH CHECK(haven.app_role() IN(''owner'',''org_admin''))',t);
 END LOOP;
END $$;
CREATE POLICY insurance_legacy_audit_manager_boundary ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name NOT IN('claim_activities','workers_comp_claims','renewal_data_packages','loss_runs','premium_allocations','certificates_of_insurance','entity_insurance_allocation_settings') OR haven.app_role() IN('owner','org_admin'));
