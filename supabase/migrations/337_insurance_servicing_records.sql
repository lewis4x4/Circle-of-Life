-- Insurance servicing preserves human approval, independent evidence, and source custody.
CREATE TABLE public.insurance_servicing_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),
 entity_id uuid NOT NULL REFERENCES public.entities(id),facility_id uuid REFERENCES public.facilities(id),policy_id uuid REFERENCES public.insurance_policies(id),document_id uuid REFERENCES public.insurance_documents(id),
 kind text NOT NULL CHECK(kind IN('renewal_package','vendor_evidence','loss_report','claim_matter','workforce_exposure')),title text NOT NULL CHECK(length(btrim(title))>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','review_required','approved','rejected','exception_approved','shared','acknowledged','closed')),
 payload jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(payload)='object'),display_names jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(display_names)='object'),event_metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(event_metadata)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),owner_id uuid REFERENCES public.user_profiles(id),due_date date,
 source_record_id uuid REFERENCES public.insurance_servicing_records(id),superseded_by uuid REFERENCES public.insurance_servicing_records(id),
 reviewed_by uuid REFERENCES auth.users(id),reviewed_at timestamptz,created_by uuid NOT NULL REFERENCES auth.users(id),updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE INDEX ON public.insurance_servicing_records(organization_id,kind,status) WHERE deleted_at IS NULL;
CREATE INDEX ON public.insurance_servicing_records(source_record_id);
CREATE TABLE public.insurance_servicing_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),record_id uuid NOT NULL REFERENCES public.insurance_servicing_records(id),
 version integer NOT NULL,status text NOT NULL,payload jsonb NOT NULL,snapshot jsonb NOT NULL,event jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(record_id,version)
);
CREATE TABLE public.insurance_servicing_exports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),record_id uuid NOT NULL REFERENCES public.insurance_servicing_records(id),
 version integer NOT NULL,actor_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(record_id,version) REFERENCES public.insurance_servicing_versions(record_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['insurance_servicing_records','insurance_servicing_versions','insurance_servicing_exports'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE INDEX ON public.%I(organization_id)',t);
 EXECUTE format('CREATE TRIGGER insurance_servicing_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log()',t);
 END LOOP;
END $$;
CREATE TRIGGER insurance_servicing_versions_immutable BEFORE UPDATE OR DELETE ON public.insurance_servicing_versions FOR EACH ROW EXECUTE FUNCTION haven.insurance_immutable_version();
CREATE TRIGGER insurance_servicing_exports_immutable BEFORE UPDATE OR DELETE ON public.insurance_servicing_exports FOR EACH ROW EXECUTE FUNCTION haven.insurance_immutable_version();
CREATE FUNCTION haven.insurance_servicing_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Insurance servicing records require retained history' USING ERRCODE='42501'; END IF;
 IF OLD.status NOT IN('draft','review_required') AND (NEW.payload IS DISTINCT FROM OLD.payload OR NEW.display_names IS DISTINCT FROM OLD.display_names OR NEW.entity_id<>OLD.entity_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id OR NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.kind<>OLD.kind OR NEW.title<>OLD.title OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id) THEN RAISE EXCEPTION 'Approved servicing content is immutable; create a revision' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER insurance_servicing_guard BEFORE UPDATE OR DELETE ON public.insurance_servicing_records FOR EACH ROW EXECUTE FUNCTION haven.insurance_servicing_guard();
CREATE FUNCTION haven.insurance_legacy_package_invalidate() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.ai_narrative_draft IS DISTINCT FROM OLD.ai_narrative_draft THEN
 NEW.narrative_reviewed_by:=NULL;NEW.narrative_reviewed_at:=NULL;NEW.narrative_published_by:=NULL;NEW.narrative_published_at:=NULL;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER insurance_legacy_package_invalidate BEFORE UPDATE ON public.renewal_data_packages FOR EACH ROW EXECUTE FUNCTION haven.insurance_legacy_package_invalidate();
-- Cross-reference validation runs at save and every transition, even after approval.
CREATE FUNCTION haven.insurance_servicing_scope(r public.insurance_servicing_records) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE doc_id uuid;f_id uuid;x jsonb;
BEGIN
 -- Keep linked rows stable throughout save/approval so concurrent soft deletion
 -- cannot invalidate a relationship between validation and publication.
 PERFORM 1 FROM public.entities WHERE id=r.entity_id FOR SHARE;
 PERFORM 1 FROM public.facilities WHERE id=r.facility_id FOR SHARE;
 PERFORM 1 FROM public.insurance_policies WHERE id=r.policy_id FOR SHARE;
 PERFORM 1 FROM public.user_profiles WHERE id=r.owner_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id=r.entity_id AND organization_id=r.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid servicing entity' USING ERRCODE='22023'; END IF;

 IF r.policy_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.insurance_policies p WHERE p.id=r.policy_id AND p.organization_id=r.organization_id AND p.deleted_at IS NULL AND (p.entity_id=r.entity_id OR (p.verification_status='verified' AND EXISTS(SELECT 1 FROM public.insurance_policy_parties pp WHERE pp.policy_id=p.id AND pp.organization_id=r.organization_id AND pp.entity_id=r.entity_id AND pp.deleted_at IS NULL)))) THEN RAISE EXCEPTION 'Policy does not belong to the selected insured entity' USING ERRCODE='22023'; END IF;
 IF r.facility_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=r.facility_id AND f.organization_id=r.organization_id AND f.deleted_at IS NULL AND (f.entity_id=r.entity_id OR EXISTS(SELECT 1 FROM public.insurance_policy_facilities pf WHERE pf.policy_id=r.policy_id AND pf.facility_id=f.id AND pf.organization_id=r.organization_id AND pf.deleted_at IS NULL))) THEN RAISE EXCEPTION 'Facility does not belong to selected entity or policy' USING ERRCODE='22023'; END IF;
 FOR doc_id IN SELECT r.document_id UNION SELECT nullif(r.payload->>'endorsement_document_id','')::uuid UNION SELECT value::text::uuid FROM jsonb_array_elements_text(coalesce(r.payload->'document_ids','[]')) LOOP
 IF doc_id IS NULL THEN CONTINUE; END IF;
 SELECT d.facility_id INTO f_id FROM public.insurance_documents d WHERE d.id=doc_id AND d.organization_id=r.organization_id AND d.deleted_at IS NULL AND d.status='ready' AND d.scan_status IN('clean','not_configured') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ready source document unavailable' USING ERRCODE='22023'; END IF;
 IF f_id IS NOT NULL AND ((r.facility_id IS NOT NULL AND f_id<>r.facility_id) OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=f_id AND f.organization_id=r.organization_id AND f.deleted_at IS NULL AND (f.entity_id=r.entity_id OR EXISTS(SELECT 1 FROM public.insurance_policy_facilities pf WHERE pf.policy_id=r.policy_id AND pf.facility_id=f.id AND pf.organization_id=r.organization_id AND pf.deleted_at IS NULL)))) THEN RAISE EXCEPTION 'Source document facility mismatch' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM 1 FROM public.vendors WHERE id=nullif(r.payload->>'vendor_id','')::uuid FOR SHARE;
 PERFORM 1 FROM public.contracts WHERE id=nullif(r.payload->>'contract_id','')::uuid FOR SHARE;
 PERFORM 1 FROM public.incidents WHERE id=nullif(r.payload->>'incident_id','')::uuid FOR SHARE;
 IF nullif(r.payload->>'vendor_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vendors WHERE id=(r.payload->>'vendor_id')::uuid AND organization_id=r.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid evidence vendor' USING ERRCODE='22023'; END IF;
 IF nullif(r.payload->>'contract_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contracts WHERE id=(r.payload->>'contract_id')::uuid AND vendor_id=(r.payload->>'vendor_id')::uuid AND organization_id=r.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Contract vendor mismatch' USING ERRCODE='22023'; END IF;
 IF nullif(r.payload->>'incident_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.incidents WHERE id=(r.payload->>'incident_id')::uuid AND organization_id=r.organization_id AND facility_id=r.facility_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Incident facility mismatch' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION haven.insurance_servicing_validate(r public.insurance_servicing_records,p_final boolean,p_exception boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb:=r.payload;k text;x jsonb;allowed text[];required text[];d date;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Servicing payload object required' USING ERRCODE='22023'; END IF;
 allowed:=CASE r.kind
 WHEN 'renewal_package' THEN ARRAY['period_start','period_end','document_ids','location_changes','exposures','open_questions','recipient','policy_snapshot']
 WHEN 'vendor_evidence' THEN ARRAY['vendor_id','contract_id','requirements','requires_endorsement','endorsement_document_id','endorsement_page','assessment','exception_reason','expiration_date']
 WHEN 'loss_report' THEN ARRAY['carrier_name','valuation_date','period_start','period_end','coverage_line','complete_periods','claims','no_losses_confirmed','no_loss_evidence_page']
 WHEN 'claim_matter' THEN ARRAY['incident_id','carrier_reference','loss_date','reported_date','recipient','acknowledgment','next_action','description']
 WHEN 'workforce_exposure' THEN ARRAY['period_start','period_end','broker_mapping_confirmed','rows','notes','manual_source_reason'] ELSE NULL END;
 IF allowed IS NULL THEN RAISE EXCEPTION 'Invalid servicing kind' USING ERRCODE='22023'; END IF;
 FOR k,x IN SELECT key,value FROM jsonb_each(p) LOOP
 IF NOT k=ANY(allowed) THEN RAISE EXCEPTION 'Unsupported servicing field: %',k USING ERRCODE='22023'; END IF;
 IF x='null'::jsonb THEN CONTINUE; END IF;
 IF k IN('document_ids','claims','rows') THEN
 IF jsonb_typeof(x)<>'array' OR jsonb_array_length(x)>1000 THEN RAISE EXCEPTION 'Invalid bounded array: %',k USING ERRCODE='22023'; END IF;
 ELSIF k='policy_snapshot' THEN IF jsonb_typeof(x)<>'object' THEN RAISE EXCEPTION 'Invalid policy snapshot' USING ERRCODE='22023'; END IF;
 ELSIF k IN('requires_endorsement','complete_periods','no_losses_confirmed','broker_mapping_confirmed') THEN IF jsonb_typeof(x)<>'boolean' THEN RAISE EXCEPTION 'Boolean required: %',k USING ERRCODE='22023'; END IF;
 ELSIF k IN('endorsement_page','no_loss_evidence_page') THEN IF jsonb_typeof(x)<>'number' OR x::text!~'^[1-9][0-9]*$' OR x::numeric>100000 THEN RAISE EXCEPTION 'Invalid source page' USING ERRCODE='22023'; END IF;
 ELSE
 IF jsonb_typeof(x)<>'string' OR length(x#>>'{}')>10000 THEN RAISE EXCEPTION 'Invalid text field: %',k USING ERRCODE='22023'; END IF;
 IF k IN('period_start','period_end','expiration_date','valuation_date','loss_date','reported_date') AND x#>>'{}'<>'' THEN
 IF x#>>'{}'!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date: %',k USING ERRCODE='22023'; END IF;d:=(x#>>'{}')::date;
 END IF;
 END IF;
 END LOOP;
 IF nullif(p->>'period_start','') IS NOT NULL AND nullif(p->>'period_end','') IS NOT NULL AND (p->>'period_end')::date<(p->>'period_start')::date THEN RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE='22023'; END IF;
 IF r.kind='renewal_package' THEN
 IF p?'document_ids' AND jsonb_typeof(p->'document_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Document list required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'document_ids','[]')) LOOP IF jsonb_typeof(x)<>'string' THEN RAISE EXCEPTION 'Invalid document ID' USING ERRCODE='22023'; END IF;PERFORM (x#>>'{}')::uuid;END LOOP;
 END IF;
 IF r.kind='loss_report' THEN
 IF p?'claims' AND jsonb_typeof(p->'claims') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Claim array required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'claims','[]')) LOOP
 IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) z WHERE z NOT IN('claim_reference','loss_date','paid_cents','reserve_cents','recovery_cents','expense_cents','incurred_cents','incurred_includes_expenses','page')) THEN RAISE EXCEPTION 'Invalid loss claim fields' USING ERRCODE='22023'; END IF;
 IF x?'claim_reference' AND (jsonb_typeof(x->'claim_reference')<>'string' OR length(x->>'claim_reference')>1000) THEN RAISE EXCEPTION 'Invalid claim reference' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['paid_cents','reserve_cents','recovery_cents','expense_cents','incurred_cents'] LOOP
 IF x->>k IS NOT NULL AND (jsonb_typeof(x->k)<>'number' OR (x->>k)!~'^\d+$' OR (x->>k)::numeric>2147483647) THEN RAISE EXCEPTION 'Invalid loss integer cents' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF x->>'incurred_includes_expenses' IS NOT NULL AND jsonb_typeof(x->'incurred_includes_expenses')<>'boolean' THEN RAISE EXCEPTION 'Invalid incurred expenses basis' USING ERRCODE='22023'; END IF;
 IF nullif(x->>'loss_date','') IS NOT NULL THEN IF x->>'loss_date'!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid claim loss date' USING ERRCODE='22023'; END IF;d:=(x->>'loss_date')::date; END IF;
 IF x->>'page' IS NOT NULL AND (jsonb_typeof(x->'page')<>'number' OR (x->>'page')!~'^[1-9][0-9]*$' OR (x->>'page')::numeric>100000) THEN RAISE EXCEPTION 'Invalid claim source page' USING ERRCODE='22023'; END IF;
 IF p_final AND (nullif(btrim(x->>'claim_reference'),'') IS NULL OR x->>'page' IS NULL) THEN RAISE EXCEPTION 'Claim reference and evidence page required' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT lower(btrim(value->>'claim_reference')) FROM jsonb_array_elements(coalesce(p->'claims','[]')) WHERE nullif(btrim(value->>'claim_reference'),'') IS NOT NULL GROUP BY lower(btrim(value->>'claim_reference')) HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate claim reference in report' USING ERRCODE='22023'; END IF;
 END IF;
 IF r.kind='workforce_exposure' THEN
 IF p?'rows' AND jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Exposure rows required' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'rows','[]')) LOOP
 IF jsonb_typeof(x)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) z WHERE z NOT IN('state','class_code','estimated_payroll_cents','actual_payroll_cents','basis_note')) THEN RAISE EXCEPTION 'Aggregate exposure fields only' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['state','class_code','basis_note'] LOOP IF x->>k IS NOT NULL AND (jsonb_typeof(x->k)<>'string' OR length(x->>k)>10000) THEN RAISE EXCEPTION 'Invalid exposure text' USING ERRCODE='22023'; END IF;END LOOP;
 IF nullif(x->>'state','') IS NOT NULL AND NOT (x->>'state')=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']) THEN RAISE EXCEPTION 'Invalid exposure state' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['estimated_payroll_cents','actual_payroll_cents'] LOOP IF x->>k IS NOT NULL AND (jsonb_typeof(x->k)<>'number' OR (x->>k)!~'^\d+$' OR (x->>k)::numeric>2147483647) THEN RAISE EXCEPTION 'Invalid payroll integer cents' USING ERRCODE='22023'; END IF;END LOOP;
 IF p_final AND (nullif(x->>'state','') IS NULL OR nullif(btrim(x->>'class_code'),'') IS NULL OR nullif(btrim(x->>'basis_note'),'') IS NULL) THEN RAISE EXCEPTION 'Exposure state, class and basis required' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT value->>'state',lower(btrim(value->>'class_code')) FROM jsonb_array_elements(coalesce(p->'rows','[]')) GROUP BY value->>'state',lower(btrim(value->>'class_code')) HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate exposure state and class' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM haven.insurance_servicing_scope(r);
 IF NOT p_final THEN RETURN; END IF;
 required:=CASE r.kind WHEN 'renewal_package' THEN ARRAY['period_start','period_end','recipient'] WHEN 'vendor_evidence' THEN ARRAY['vendor_id','requirements','assessment','expiration_date'] WHEN 'loss_report' THEN ARRAY['carrier_name','valuation_date','period_start','period_end','coverage_line'] WHEN 'claim_matter' THEN ARRAY['loss_date','next_action','description'] WHEN 'workforce_exposure' THEN ARRAY['period_start','period_end'] END;
 FOREACH k IN ARRAY required LOOP IF nullif(btrim(p->>k),'') IS NULL THEN RAISE EXCEPTION 'Required servicing field: %',k USING ERRCODE='22023'; END IF;END LOOP;
 IF r.kind='renewal_package' THEN
 IF r.policy_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.insurance_policies WHERE id=r.policy_id AND verification_status='verified' AND deleted_at IS NULL AND version=(p->'policy_snapshot'->>'version')::integer) THEN RAISE EXCEPTION 'Policy snapshot stale or unverified; refresh draft' USING ERRCODE='40001'; END IF;
 ELSIF r.kind='vendor_evidence' THEN
 IF r.document_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.insurance_documents WHERE id=r.document_id AND family='certificate') THEN RAISE EXCEPTION 'Ready certificate evidence required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'requires_endorsement') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Explicit endorsement requirement required' USING ERRCODE='22023'; END IF;
 IF p_exception THEN
 IF nullif(btrim(p->>'exception_reason'),'') IS NULL THEN RAISE EXCEPTION 'Explicit exception reason required' USING ERRCODE='22023'; END IF;
 ELSIF (p->>'requires_endorsement')::boolean AND (p->>'endorsement_page' IS NULL OR NOT EXISTS(SELECT 1 FROM public.insurance_documents WHERE id=(p->>'endorsement_document_id')::uuid AND id<>r.document_id AND family IN('policy','endorsement'))) THEN RAISE EXCEPTION 'Separate policy endorsement and page required' USING ERRCODE='22023'; END IF;
 ELSIF r.kind='loss_report' THEN
 IF r.document_id IS NULL THEN RAISE EXCEPTION 'Ready original loss report required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'complete_periods') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'no_losses_confirmed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'claims') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Explicit loss report completeness required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p->'claims')=0 THEN IF p->'no_losses_confirmed'<>'true'::jsonb OR p->>'no_loss_evidence_page' IS NULL THEN RAISE EXCEPTION 'Empty report needs confirmed no-loss evidence page' USING ERRCODE='22023'; END IF;
 ELSIF p->'no_losses_confirmed'<>'false'::jsonb THEN RAISE EXCEPTION 'Claim rows conflict with no-loss statement' USING ERRCODE='22023'; END IF;
 ELSIF r.kind='workforce_exposure' THEN
 IF p->'broker_mapping_confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Broker class mapping confirmation required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'rows')=0 THEN RAISE EXCEPTION 'Exposure rows required' USING ERRCODE='22023'; END IF;
 IF r.document_id IS NULL AND nullif(btrim(p->>'manual_source_reason'),'') IS NULL THEN RAISE EXCEPTION 'Document or manual source reason required' USING ERRCODE='22023'; END IF;
 END IF;
END $$;
CREATE FUNCTION haven.insurance_servicing_record_json(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT to_jsonb(r)||jsonb_build_object('versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version) FROM public.insurance_servicing_versions v WHERE v.record_id=r.id),'[]')) FROM public.insurance_servicing_records r WHERE r.id=p_id;
$$;
CREATE FUNCTION haven.insurance_loss_totals(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH reports AS (
 SELECT r.* FROM public.insurance_servicing_records r WHERE organization_id=p_org AND kind='loss_report' AND status='approved' AND superseded_by IS NULL AND deleted_at IS NULL
 ), selected AS (
 SELECT DISTINCT ON(r.entity_id,lower(btrim(r.payload->>'carrier_name')),r.policy_id,lower(btrim(r.payload->>'coverage_line')),lower(btrim(c->>'claim_reference')))
 c,r.id,r.payload->>'valuation_date' valuation_date
 FROM reports r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'claims') c
 ORDER BY r.entity_id,lower(btrim(r.payload->>'carrier_name')),r.policy_id,lower(btrim(r.payload->>'coverage_line')),lower(btrim(c->>'claim_reference')),r.payload->>'valuation_date' DESC,r.created_at DESC,r.id
 ), metrics AS (
 SELECT k,coalesce(sum((s.c->>k)::bigint),0) known,count(*) FILTER(WHERE s.c->>k IS NULL) missing
 FROM unnest(ARRAY['paid_cents','reserve_cents','recovery_cents','expense_cents','incurred_cents']) k LEFT JOIN selected s ON true GROUP BY k
 ) SELECT jsonb_object_agg(k,jsonb_build_object('known_subtotal_cents',known,'missing_count',CASE WHEN (SELECT count(*) FROM selected)=0 THEN 0 ELSE missing END,'total_cents',CASE WHEN NOT EXISTS(SELECT 1 FROM reports) THEN NULL WHEN NOT EXISTS(SELECT 1 FROM selected) THEN 0 WHEN missing>0 THEN NULL ELSE known END))||jsonb_build_object('claim_count',(SELECT count(*) FROM selected),'report_count',(SELECT count(*) FROM reports),'history_complete',coalesce((SELECT bool_and((payload->>'complete_periods')::boolean) FROM reports),false)) FROM metrics;
$$;
CREATE FUNCTION haven.insurance_servicing_impl(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;r public.insurance_servicing_records;prior public.insurance_servicing_records;candidate public.insurance_servicing_records;v public.insurance_servicing_versions;
 org uuid;actor uuid;v_id uuid;pol public.insurance_policies;p jsonb;ev jsonb;req jsonb;target text;v_kind text;expected integer;x jsonb;v_doc uuid;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();org:=a.actor_organization_id;actor:=a.actor_user_id;
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF a.actor_role_text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Insurance manager required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Payload object required' USING ERRCODE='22023'; END IF;
 IF p_action='list' THEN
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 v_kind:=p_payload->>'kind';
 IF v_kind IS NOT NULL AND v_kind NOT IN('renewal_package','vendor_evidence','loss_report','claim_matter','workforce_exposure') THEN RAISE EXCEPTION 'Invalid servicing kind' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object(
 'records',coalesce((SELECT jsonb_agg(haven.insurance_servicing_record_json(t.id) ORDER BY t.created_at DESC,t.id) FROM public.insurance_servicing_records t WHERE organization_id=org AND deleted_at IS NULL AND (v_kind IS NULL OR kind=v_kind)),'[]'),
 'entities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM public.entities WHERE organization_id=org AND deleted_at IS NULL),'[]'),
 'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'entity_id',entity_id) ORDER BY name,id) FROM public.facilities WHERE organization_id=org AND deleted_at IS NULL),'[]'),
 'policies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'entity_id',p.entity_id,'policy_number',p.policy_number,'carrier_name',p.carrier_name,'policy_type',p.policy_type,'verification_status',p.verification_status,'version',p.version,
 'insured_entity_ids',(SELECT jsonb_agg(entity_id ORDER BY entity_id) FROM (SELECT p.entity_id UNION SELECT pp.entity_id FROM public.insurance_policy_parties pp JOIN public.entities e ON e.id=pp.entity_id AND e.deleted_at IS NULL AND e.organization_id=org WHERE p.verification_status='verified' AND pp.policy_id=p.id AND pp.organization_id=org AND pp.deleted_at IS NULL) insured),
 'covered_facility_ids',coalesce((SELECT jsonb_agg(DISTINCT pf.facility_id ORDER BY pf.facility_id) FROM public.insurance_policy_facilities pf JOIN public.facilities f ON f.id=pf.facility_id AND f.deleted_at IS NULL AND f.organization_id=org WHERE p.verification_status='verified' AND pf.policy_id=p.id AND pf.organization_id=org AND pf.deleted_at IS NULL),'[]')) ORDER BY p.expiration_date,p.id) FROM public.insurance_policies p WHERE p.organization_id=org AND p.deleted_at IS NULL),'[]'),
 'documents',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY created_at DESC,id) FROM public.insurance_documents t WHERE organization_id=org AND deleted_at IS NULL AND status='ready' AND scan_status IN('clean','not_configured')),'[]'),
 'vendors',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM public.vendors WHERE organization_id=org AND deleted_at IS NULL),'[]'),
 'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'vendor_id',vendor_id,'title',title) ORDER BY title,id) FROM public.contracts WHERE organization_id=org AND deleted_at IS NULL),'[]'),
 'incidents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'facility_id',facility_id,'incident_type',category,'occurred_at',occurred_at) ORDER BY occurred_at DESC,id) FROM public.incidents WHERE organization_id=org AND deleted_at IS NULL),'[]'),
 'owners',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name) ORDER BY full_name,id) FROM public.user_profiles WHERE organization_id=org AND app_role IN('owner','org_admin') AND is_active AND deleted_at IS NULL),'[]'),
 'loss_totals',haven.insurance_loss_totals(org),'pagination',jsonb_build_object('complete',true));
 END IF;
 v_id:=(p_payload->>'id')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Stable record ID required' USING ERRCODE='22023'; END IF;
 -- Organization serialization protects loss authority and cross-record correction
 -- changes; stable-ID locking also prevents conflicting first-save retries.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,337));
 PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,338));
 SELECT * INTO r FROM public.insurance_servicing_records WHERE id=v_id FOR UPDATE;
 IF r.id IS NOT NULL AND (r.organization_id<>org OR r.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Servicing record not found' USING ERRCODE='P0002'; END IF;
 IF p_payload->>'version' IS NOT NULL AND (jsonb_typeof(p_payload->'version')<>'number' OR (p_payload->>'version')!~'^[1-9][0-9]*$') THEN RAISE EXCEPTION 'Positive integer version required' USING ERRCODE='22023'; END IF;
 expected:=(p_payload->>'version')::integer;
 IF p_action='save' THEN
 IF p_payload?'display_names' THEN RAISE EXCEPTION 'Display names are prepared by the server' USING ERRCODE='22023'; END IF;
 IF p_payload->>'kind' NOT IN('renewal_package','vendor_evidence','loss_report','claim_matter','workforce_exposure') OR p_payload->>'kind' IS NULL OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'title'),'') IS NULL OR length(p_payload->>'title')>1000 THEN RAISE EXCEPTION 'Valid servicing kind and title required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'payload') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Kind payload object required' USING ERRCODE='22023'; END IF;
 IF p_payload->>'due_date' IS NOT NULL AND (jsonb_typeof(p_payload->'due_date')<>'string' OR (p_payload->>'due_date')!~'^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'Invalid due date' USING ERRCODE='22023'; END IF;
 candidate:=r;candidate.id:=v_id;candidate.organization_id:=org;candidate.kind:=p_payload->>'kind';candidate.title:=btrim(p_payload->>'title');candidate.entity_id:=(p_payload->>'entity_id')::uuid;candidate.facility_id:=(p_payload->>'facility_id')::uuid;candidate.policy_id:=(p_payload->>'policy_id')::uuid;candidate.document_id:=(p_payload->>'document_id')::uuid;candidate.owner_id:=(p_payload->>'owner_id')::uuid;candidate.due_date:=(p_payload->>'due_date')::date;candidate.payload:=p_payload->'payload';
 IF r.id IS NOT NULL AND expected IS NULL AND r.kind=candidate.kind AND r.title=candidate.title AND r.entity_id=candidate.entity_id AND r.facility_id IS NOT DISTINCT FROM candidate.facility_id AND r.policy_id IS NOT DISTINCT FROM candidate.policy_id AND r.document_id IS NOT DISTINCT FROM candidate.document_id AND r.owner_id IS NOT DISTINCT FROM candidate.owner_id AND r.due_date IS NOT DISTINCT FROM candidate.due_date AND r.payload-'policy_snapshot'=candidate.payload-'policy_snapshot' THEN PERFORM haven.insurance_servicing_scope(r);PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);RETURN jsonb_build_object('record',haven.insurance_servicing_record_json(r.id)); END IF;
 IF r.id IS NOT NULL AND (r.status NOT IN('draft','review_required') OR expected IS DISTINCT FROM r.version OR r.kind<>candidate.kind) THEN RAISE EXCEPTION 'Stale or finalized servicing record' USING ERRCODE='40001'; END IF;
 IF r.id IS NULL AND expected IS NOT NULL THEN RAISE EXCEPTION 'Cannot update a missing record' USING ERRCODE='P0002'; END IF;
 IF candidate.kind='renewal_package' THEN
 IF candidate.policy_id IS NULL THEN RAISE EXCEPTION 'Renewal package requires verified policy' USING ERRCODE='22023'; END IF;
 SELECT * INTO pol FROM public.insurance_policies WHERE id=candidate.policy_id AND organization_id=org AND verification_status='verified' AND deleted_at IS NULL FOR SHARE;
 IF pol.id IS NULL THEN RAISE EXCEPTION 'Renewal package requires verified policy' USING ERRCODE='22023'; END IF;
 candidate.payload:=(candidate.payload-'policy_snapshot')||jsonb_build_object('policy_snapshot',jsonb_build_object('id',pol.id,'version',pol.version,'entity_id',pol.entity_id,'entity_name',(SELECT name FROM public.entities WHERE id=pol.entity_id AND organization_id=org),'policy_number',pol.policy_number,'carrier_name',pol.carrier_name,'policy_type',pol.policy_type,'effective_date',pol.effective_date,'expiration_date',pol.expiration_date,'premium_cents',pol.premium_cents,'shared_limit',pol.shared_limit,'parties',coalesce((SELECT jsonb_agg(jsonb_build_object('entity_id',entity_id,'entity_name',(SELECT e.name FROM public.entities e WHERE e.id=entity_id AND e.organization_id=org),'role',role,'effective_from',effective_from,'effective_to',effective_to)) FROM public.insurance_policy_parties WHERE policy_id=pol.id AND deleted_at IS NULL),'[]'),'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('facility_id',facility_id,'facility_name',(SELECT f.name FROM public.facilities f WHERE f.id=facility_id AND f.organization_id=org),'role',role,'effective_from',effective_from,'effective_to',effective_to)) FROM public.insurance_policy_facilities WHERE policy_id=pol.id AND deleted_at IS NULL),'[]')));
 END IF;
 PERFORM haven.insurance_servicing_validate(candidate,false);
 IF r.id IS NULL OR candidate.owner_id IS DISTINCT FROM r.owner_id THEN PERFORM haven.insurance_assert_owner(candidate.owner_id,org); END IF;
 candidate.display_names:=jsonb_build_object(
 'entity',(SELECT name FROM public.entities WHERE id=candidate.entity_id AND organization_id=org),
 'facility',(SELECT name FROM public.facilities WHERE id=candidate.facility_id AND organization_id=org),
 'vendor',(SELECT name FROM public.vendors WHERE id=nullif(candidate.payload->>'vendor_id','')::uuid AND organization_id=org),
 'contract',(SELECT title FROM public.contracts WHERE id=nullif(candidate.payload->>'contract_id','')::uuid AND organization_id=org),
 'owner',(SELECT full_name FROM public.user_profiles WHERE id=candidate.owner_id AND organization_id=org),
 'incident',(SELECT replace(category::text,'_',' ')||' · '||to_char(occurred_at AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI')||' Eastern' FROM public.incidents WHERE id=nullif(candidate.payload->>'incident_id','')::uuid AND organization_id=org));
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 IF r.id IS NULL THEN
 INSERT INTO public.insurance_servicing_records(id,organization_id,entity_id,facility_id,policy_id,document_id,kind,title,payload,display_names,owner_id,due_date,created_by,updated_by) VALUES(v_id,org,candidate.entity_id,candidate.facility_id,candidate.policy_id,candidate.document_id,candidate.kind,candidate.title,candidate.payload,candidate.display_names,candidate.owner_id,candidate.due_date,actor,actor) RETURNING * INTO r;
 ELSE
 UPDATE public.insurance_servicing_records SET entity_id=candidate.entity_id,facility_id=candidate.facility_id,policy_id=candidate.policy_id,document_id=candidate.document_id,title=candidate.title,payload=candidate.payload,display_names=candidate.display_names,owner_id=candidate.owner_id,due_date=candidate.due_date,version=version+1,updated_by=actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 END IF;
 ev:=jsonb_build_object('action','save','actor',actor,'timestamp',now());
 ELSIF p_action='revise' THEN
 IF r.id IS NULL THEN RAISE EXCEPTION 'Servicing record not found' USING ERRCODE='P0002'; END IF;
 IF expected IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Stale servicing version' USING ERRCODE='40001'; END IF;
 PERFORM haven.insurance_servicing_scope(r);
 IF r.status NOT IN('approved','exception_approved','shared','acknowledged','closed','rejected') OR (r.kind='loss_report' AND (r.status<>'approved' OR r.superseded_by IS NOT NULL)) THEN RAISE EXCEPTION 'Revision requires a finalized authoritative record' USING ERRCODE='40001'; END IF;
 v_id:=(p_payload->>'new_id')::uuid;IF v_id IS NULL OR v_id=r.id THEN RAISE EXCEPTION 'New revision identity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.insurance_servicing_records WHERE id=v_id;
 IF prior.id IS NOT NULL THEN
 IF prior.organization_id=org AND prior.source_record_id=r.id AND prior.kind=r.kind AND prior.deleted_at IS NULL THEN PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']); RETURN jsonb_build_object('record',haven.insurance_servicing_record_json(prior.id)); END IF;
 RAISE EXCEPTION 'Revision identity conflict' USING ERRCODE='23505'; END IF;
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 INSERT INTO public.insurance_servicing_records(id,organization_id,entity_id,facility_id,policy_id,document_id,kind,title,payload,display_names,owner_id,due_date,source_record_id,created_by,updated_by) VALUES(v_id,org,r.entity_id,r.facility_id,r.policy_id,r.document_id,r.kind,r.title,r.payload,r.display_names,r.owner_id,r.due_date,r.id,actor,actor) RETURNING * INTO r;
 ev:=jsonb_build_object('action','revise','source_record_id',r.source_record_id,'actor',actor,'timestamp',now());
 ELSIF p_action='reassign' THEN
 IF r.id IS NULL THEN RAISE EXCEPTION 'Servicing record not found' USING ERRCODE='P0002'; END IF;
 PERFORM haven.insurance_servicing_scope(r);
 IF NOT p_payload?'owner_id' OR NOT p_payload?'due_date' OR jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' OR nullif(btrim(p_payload->>'note'),'') IS NULL OR length(p_payload->>'note')>10000 THEN RAISE EXCEPTION 'Explicit owner, due date and reassignment note required' USING ERRCODE='22023'; END IF;
 IF p_payload->>'due_date' IS NOT NULL AND (jsonb_typeof(p_payload->'due_date')<>'string' OR (p_payload->>'due_date')!~'^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'Invalid due date' USING ERRCODE='22023'; END IF;
 candidate.owner_id:=(p_payload->>'owner_id')::uuid;candidate.due_date:=(p_payload->>'due_date')::date;
 req:=jsonb_build_object('owner_id',candidate.owner_id,'due_date',candidate.due_date,'note',p_payload->>'note');
 IF expected=r.version-1 AND EXISTS(SELECT 1 FROM public.insurance_servicing_versions WHERE record_id=r.id AND version=r.version AND event->>'action'='reassign' AND event->'request'=req) THEN PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']); RETURN jsonb_build_object('record',haven.insurance_servicing_record_json(r.id)); END IF;
 IF expected IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Stale servicing version' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.user_profiles WHERE id=candidate.owner_id FOR SHARE;
 PERFORM haven.insurance_assert_owner(candidate.owner_id,org);
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 ev:=jsonb_build_object('action','reassign','owner_id',candidate.owner_id,'due_date',candidate.due_date,'note',p_payload->>'note','actor',actor,'timestamp',now(),'request',req);
 UPDATE public.insurance_servicing_records SET owner_id=candidate.owner_id,due_date=candidate.due_date,event_metadata=event_metadata||(ev-'request'),version=version+1,updated_by=actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='export' THEN
 IF r.id IS NULL THEN RAISE EXCEPTION 'Servicing record not found' USING ERRCODE='P0002'; END IF;
 PERFORM haven.insurance_servicing_scope(r);
 SELECT * INTO v FROM public.insurance_servicing_versions WHERE record_id=r.id AND version=expected;
 IF r.kind<>'renewal_package' OR v.id IS NULL OR v.status NOT IN('approved','shared','acknowledged') THEN RAISE EXCEPTION 'Approved package version required for export' USING ERRCODE='22023'; END IF;
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 INSERT INTO public.insurance_servicing_exports(organization_id,record_id,version,actor_id) VALUES(org,r.id,expected,actor);
 RETURN jsonb_build_object('record',v.snapshot,'version',expected);
 ELSIF p_action='transition' THEN
 IF r.id IS NULL THEN RAISE EXCEPTION 'Servicing record not found' USING ERRCODE='P0002'; END IF;
 PERFORM haven.insurance_servicing_scope(r);
 target:=p_payload->>'status';
 req:=jsonb_build_object('status',target,'note',p_payload->>'note','recipient',p_payload->>'recipient','acknowledgment',p_payload->>'acknowledgment','reported_date',p_payload->>'reported_date');
 IF expected=r.version-1 AND target=r.status AND EXISTS(SELECT 1 FROM public.insurance_servicing_versions WHERE record_id=r.id AND version=r.version AND event->'request'=req) THEN PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']); RETURN jsonb_build_object('record',haven.insurance_servicing_record_json(r.id)); END IF;
 IF expected IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Stale servicing version' USING ERRCODE='40001'; END IF;
 IF NOT ((r.status='draft' AND target IN('review_required','rejected')) OR (r.status='review_required' AND (target IN('approved','rejected') OR (r.kind='vendor_evidence' AND target='exception_approved'))) OR (r.kind IN('renewal_package','claim_matter') AND r.status='approved' AND target='shared') OR (r.kind IN('renewal_package','claim_matter') AND r.status='shared' AND target='acknowledged') OR (r.kind='claim_matter' AND r.status='acknowledged' AND target='closed')) OR target IS NULL THEN RAISE EXCEPTION 'Invalid servicing status transition' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_each(p_payload) WHERE key IN('note','recipient','acknowledgment') LOOP IF x<>'null'::jsonb AND (jsonb_typeof(x)<>'string' OR length(x#>>'{}')>10000) THEN RAISE EXCEPTION 'Invalid transition text' USING ERRCODE='22023'; END IF;END LOOP;
 IF nullif(p_payload->>'reported_date','') IS NOT NULL THEN IF p_payload->>'reported_date'!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid reported date' USING ERRCODE='22023'; END IF;PERFORM (p_payload->>'reported_date')::date;END IF;
 IF target IN('approved','exception_approved') THEN
 PERFORM haven.insurance_servicing_validate(r,true,target='exception_approved');
 IF r.kind='renewal_package' THEN
 PERFORM 1 FROM public.insurance_policies WHERE id=r.policy_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.insurance_policies WHERE id=r.policy_id AND version=(r.payload->'policy_snapshot'->>'version')::integer AND verification_status='verified' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Policy snapshot stale; refresh draft' USING ERRCODE='40001'; END IF;
 END IF;
 IF r.kind='loss_report' THEN
 IF r.source_record_id IS NOT NULL THEN
 SELECT * INTO prior FROM public.insurance_servicing_records WHERE id=r.source_record_id AND organization_id=org FOR UPDATE;
 IF prior.id IS NULL OR prior.kind<>'loss_report' OR prior.status<>'approved' OR prior.superseded_by IS NOT NULL OR prior.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Loss correction predecessor no longer authoritative' USING ERRCODE='40001'; END IF;
 IF r.entity_id<>prior.entity_id OR r.policy_id IS DISTINCT FROM prior.policy_id OR r.document_id IS DISTINCT FROM prior.document_id OR lower(btrim(r.payload->>'carrier_name'))<>lower(btrim(prior.payload->>'carrier_name')) OR lower(btrim(r.payload->>'coverage_line'))<>lower(btrim(prior.payload->>'coverage_line')) OR r.payload->>'valuation_date'<>prior.payload->>'valuation_date' THEN RAISE EXCEPTION 'Loss correction must retain source identity and valuation' USING ERRCODE='22023'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.insurance_servicing_records t WHERE t.organization_id=org AND t.kind='loss_report' AND t.status='approved' AND t.superseded_by IS NULL AND t.deleted_at IS NULL AND t.id<>coalesce(r.source_record_id,r.id) AND t.document_id=r.document_id AND t.payload->>'valuation_date'=r.payload->>'valuation_date') THEN RAISE EXCEPTION 'Source document valuation already approved' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.insurance_servicing_records t CROSS JOIN LATERAL jsonb_array_elements(t.payload->'claims') c WHERE t.organization_id=org AND t.kind='loss_report' AND t.status='approved' AND t.superseded_by IS NULL AND t.deleted_at IS NULL AND t.id<>coalesce(r.source_record_id,r.id) AND t.entity_id=r.entity_id AND t.policy_id IS NOT DISTINCT FROM r.policy_id AND lower(btrim(t.payload->>'carrier_name'))=lower(btrim(r.payload->>'carrier_name')) AND lower(btrim(t.payload->>'coverage_line'))=lower(btrim(r.payload->>'coverage_line')) AND t.payload->>'valuation_date'=r.payload->>'valuation_date' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'claims') z WHERE lower(btrim(z->>'claim_reference'))=lower(btrim(c->>'claim_reference')))) THEN RAISE EXCEPTION 'Claim identity valuation already approved' USING ERRCODE='23505'; END IF;
 IF r.source_record_id IS NOT NULL THEN
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 UPDATE public.insurance_servicing_records SET superseded_by=r.id,version=version+1,updated_by=actor,updated_at=now() WHERE id=r.source_record_id RETURNING * INTO prior;
 INSERT INTO public.insurance_servicing_versions(organization_id,record_id,version,status,payload,snapshot,event,actor_id) VALUES(org,prior.id,prior.version,prior.status,prior.payload,to_jsonb(prior),jsonb_build_object('action','superseded','superseded_by',r.id,'actor',actor,'timestamp',now()),actor);
 END IF;
 END IF;
 END IF;
 IF target IN('rejected','shared','closed') AND nullif(btrim(p_payload->>'note'),'') IS NULL THEN RAISE EXCEPTION 'Transition evidence note required' USING ERRCODE='22023'; END IF;
 IF target='shared' AND nullif(btrim(p_payload->>'recipient'),'') IS NULL THEN RAISE EXCEPTION 'Recorded handoff recipient required' USING ERRCODE='22023'; END IF;
 IF target='shared' AND r.kind='renewal_package' AND btrim(p_payload->>'recipient')<>btrim(r.payload->>'recipient') THEN RAISE EXCEPTION 'Handoff recipient must match approved package' USING ERRCODE='22023'; END IF;
 IF target='acknowledged' THEN
 IF nullif(btrim(p_payload->>'recipient'),'') IS NULL OR nullif(btrim(p_payload->>'acknowledgment'),'') IS NULL OR btrim(p_payload->>'recipient') IS DISTINCT FROM btrim(r.event_metadata->>'recipient') THEN RAISE EXCEPTION 'Acknowledgment recipient and evidence required' USING ERRCODE='22023'; END IF;
 IF r.kind='claim_matter' AND nullif(p_payload->>'reported_date','') IS NULL THEN RAISE EXCEPTION 'Claim acknowledgment reported date required' USING ERRCODE='22023'; END IF;
 END IF;
 ev:=jsonb_strip_nulls(jsonb_build_object('action','transition','status',target,'note',p_payload->>'note','recipient',p_payload->>'recipient','acknowledgment',p_payload->>'acknowledgment','reported_date',p_payload->>'reported_date','actor',actor,'timestamp',now()))||jsonb_build_object('request',req);
 PERFORM haven.insurance_lock_actor(actor,org,ARRAY['owner','org_admin']);
 UPDATE public.insurance_servicing_records SET status=target,event_metadata=event_metadata||(ev-'request'),version=version+1,reviewed_by=CASE WHEN target IN('approved','exception_approved','rejected') THEN actor ELSE reviewed_by END,reviewed_at=CASE WHEN target IN('approved','exception_approved','rejected') THEN now() ELSE reviewed_at END,updated_by=actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 ELSE RAISE EXCEPTION 'Unknown servicing command' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.insurance_servicing_versions(organization_id,record_id,version,status,payload,snapshot,event,actor_id) VALUES(org,r.id,r.version,r.status,r.payload,to_jsonb(r),ev,actor);
 RETURN jsonb_build_object('record',haven.insurance_servicing_record_json(r.id));
END $$;
CREATE FUNCTION public.insurance_servicing(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT haven.insurance_servicing_impl(p_action,p_payload)$$;
REVOKE ALL ON FUNCTION public.insurance_servicing(text,jsonb),haven.insurance_servicing_impl(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.insurance_servicing(text,jsonb),haven.insurance_servicing_impl(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION haven.insurance_servicing_guard(),haven.insurance_legacy_package_invalidate(),haven.insurance_servicing_scope(public.insurance_servicing_records),haven.insurance_servicing_validate(public.insurance_servicing_records,boolean,boolean),haven.insurance_servicing_record_json(uuid),haven.insurance_loss_totals(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION haven.insurance_servicing_impl(text,jsonb) OWNER TO postgres;

-- The existing portfolio PDF contains organization-wide insurance/finance data.
-- Restrict persisted copies as well as the route that renders them.
CREATE POLICY insurance_portfolio_export_boundary ON storage.objects
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
  bucket_id<>'report-exports' OR split_part(name,'/',2)<>'executive-league'
  OR haven.app_role() IN('owner','org_admin')
 );
