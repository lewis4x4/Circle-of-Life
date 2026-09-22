-- Created with supabase migration new; repository claim 451. COL-504 quality review follow-up.
-- 1. Operating rules (checklists, screening standard, family upload window, renewal warning) become
--    effective-dated benefits_rules rows an owner can change, instead of values fixed in SQL and TypeScript.
-- 2. The queue orders by due date (undated last) with a keyset cursor.
-- 3. A case whose resident moved facilities stays readable and flagged; a reviewed rebind follows the resident.
-- 4. Reading or exporting financial evidence is recorded in the case history.
-- 5. Case JSON carries resident status, resident facility and renewal date; options list Medicaid payers without a case.
-- 6. Reopening a closed case may state the next action in the same command (the reopen form does).
BEGIN;
CREATE TABLE public.benefits_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 rule_key text NOT NULL CHECK(rule_key IN ('checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days')),
 value jsonb NOT NULL, effective_from date NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,rule_key,effective_from)
);
CREATE INDEX benefits_rules_lookup ON public.benefits_rules(organization_id,rule_key,effective_from DESC);
ALTER TABLE public.benefits_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefits_rules FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.benefits_rules FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();

-- The source checklist (Jessica, 2026-09-16) is the built-in default so a new organization starts complete; rows in benefits_rules override it per organization.
CREATE FUNCTION haven.benefits_checklist_default_smmc_ltc() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_agg(jsonb_build_object('title',t.title,'stage',t.stage,'signature_status',t.signature_status)) FROM (VALUES
   ('Signed intake and financial screening','referral','pending'),
   ('AHCA 3008 medical certification','assessment','pending'),
   ('Current medication list','assessment','not_required'),
   ('Signed ACCESS application','application','pending'),
   ('Financial information release','application','pending'),
   ('Elder Options release','application','pending'),
   ('Designated representative appointment','application','pending'),
   ('Admission letter','application','not_required'),
   ('Photo identification','application','not_required'),
   ('Social Security card','application','not_required'),
   ('Medicare and other insurance cards','application','not_required'),
   ('Three months of bank statements: all accounts and pages','application','not_required'),
   ('Income verification','application','not_required'),
   ('Life insurance policy face and cash values','application','not_required'),
   ('Burial contract and funding evidence','application','not_required'),
   ('Property and other asset evidence','application','not_required'),
   ('Power of attorney or other representative authority','application','not_required'),
   ('Spouse financial and supporting documents','application','not_required')) t(title,stage,signature_status);
$$;
-- Fallbacks when an organization has no rule row; the operating values live in benefits_rules rows (seeded below, effective-dated, changeable by an owner).
CREATE FUNCTION haven.benefits_rule_default(p_key text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_key
  WHEN 'family_collection.max_days' THEN '90'::jsonb
  WHEN 'renewal.warning_days' THEN '60'::jsonb
  WHEN 'screening.standard_individual' THEN 'null'::jsonb
  WHEN 'checklist.smmc_ltc' THEN haven.benefits_checklist_default_smmc_ltc()
  ELSE '[]'::jsonb END;
$$;
CREATE FUNCTION haven.benefits_rule(p_org uuid,p_key text,p_as_of date DEFAULT current_date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT r.value FROM public.benefits_rules r WHERE r.organization_id=p_org AND r.rule_key=p_key AND r.effective_from<=p_as_of ORDER BY r.effective_from DESC LIMIT 1),haven.benefits_rule_default(p_key));
$$;
CREATE FUNCTION haven.benefits_rule_validate(p_key text,p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t jsonb; BEGIN
 IF length(p_value::text)>65536 THEN RAISE EXCEPTION 'Rule value too large' USING ERRCODE='22023'; END IF;
 IF p_key LIKE 'checklist.%' THEN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>60 THEN RAISE EXCEPTION 'Checklist must be a list of at most 60 items' USING ERRCODE='22023'; END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(p_value) LOOP
   PERFORM haven.benefits_keys(t,ARRAY['title','stage','signature_status']);
   IF length(coalesce(btrim(t->>'title'),'')) NOT BETWEEN 1 AND 200 OR coalesce(t->>'stage','') NOT IN ('screening','referral','assessment','application','funding','renewal') OR coalesce(t->>'signature_status','not_required') NOT IN ('not_required','pending') THEN RAISE EXCEPTION 'Checklist item needs a title, a stage and a signature requirement' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_value) e)<>(SELECT count(DISTINCT lower(btrim(e->>'title'))) FROM jsonb_array_elements(p_value) e) THEN RAISE EXCEPTION 'Checklist titles must be unique' USING ERRCODE='22023'; END IF;
 ELSIF p_key='screening.standard_individual' THEN
  PERFORM haven.benefits_keys(p_value,ARRAY['income_cents','assets_cents','label','source']);
  IF jsonb_typeof(p_value->'income_cents')<>'number' OR jsonb_typeof(p_value->'assets_cents')<>'number' OR (p_value->>'income_cents') !~ '^[0-9]+$' OR (p_value->>'assets_cents') !~ '^[0-9]+$'
  OR (p_value->>'income_cents')::numeric NOT BETWEEN 1 AND 99999999 OR (p_value->>'assets_cents')::numeric NOT BETWEEN 1 AND 9999999999
  OR length(coalesce(btrim(p_value->>'label'),'')) NOT BETWEEN 1 AND 200 OR length(coalesce(p_value->>'source','')) > 500 THEN RAISE EXCEPTION 'Screening standard needs whole-cent income and asset limits within range, a label and an optional source' USING ERRCODE='22023'; END IF;
 ELSIF p_key IN ('family_collection.max_days','renewal.warning_days') THEN
  IF jsonb_typeof(p_value)<>'number' OR p_value::text !~ '^[0-9]+$' OR (p_value::text)::integer NOT BETWEEN (CASE WHEN p_key='family_collection.max_days' THEN 1 ELSE 0 END) AND 365 THEN RAISE EXCEPTION 'Day window must be a whole number of days up to 365' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Unknown benefits rule' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION haven.benefits_rules_list_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_manage',(a->>'admin')::boolean,'as_of',current_date,
 'rules',(SELECT jsonb_agg(jsonb_build_object('rule_key',k.key,
   'current',(SELECT to_jsonb(r) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key AND r.effective_from<=current_date ORDER BY r.effective_from DESC LIMIT 1),
   'value',haven.benefits_rule((a->>'org')::uuid,k.key,current_date),
   'scheduled',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.effective_from) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key AND r.effective_from>current_date),'[]'),
   'history_count',(SELECT count(*) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key)) ORDER BY k.key)
  FROM unnest(ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days']) k(key)));
END $$;
CREATE FUNCTION haven.benefits_rule_set_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.benefits_rules; eff date; BEGIN
 IF NOT (a->>'admin')::boolean THEN RAISE EXCEPTION 'Benefits rule administrator required' USING ERRCODE='42501'; END IF;
 PERFORM haven.benefits_keys(p_payload,ARRAY['rule_key','value','effective_from','reason']);
 eff:=(p_payload->>'effective_from')::date;
 IF eff IS NULL OR eff<current_date OR eff>current_date+interval '2 years' THEN RAISE EXCEPTION 'Rules take effect today or on a future date within two years; past dates cannot be rewritten' USING ERRCODE='22023'; END IF;
 IF length(coalesce(btrim(p_payload->>'reason'),'')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE='22023'; END IF;
 PERFORM haven.benefits_rule_validate(p_payload->>'rule_key',p_payload->'value');
 INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason,created_by)
 VALUES((a->>'org')::uuid,p_payload->>'rule_key',p_payload->'value',eff,p_payload->>'reason',(a->>'id')::uuid) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
-- Seed the operating values recorded in spec 39 for every existing organization, effective-dated to their sources.
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'screening.standard_individual',jsonb_build_object('income_cents',298200,'assets_cents',200000,'label','DCF 2026 standard individual ICP/HCBS financial limits','source','https://prod.myflfamilies.com/sites/default/files/2026-02/Appendix%20A-9%20SSI-Related%20Programs%20-%20Financial%20Eligibility%20Standards.pdf'),DATE '2026-01-01','Seeded by migration 451 from DCF Appendix A-9 (2026); a review aid, never an eligibility decision.' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'checklist.smmc_ltc',haven.benefits_checklist_default_smmc_ltc(),DATE '2026-09-16','Seeded by migration 451 from the New Admits Medicaid Pending Criteria and forms packet reviewed with Jessica on 2026-09-16.' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'family_collection.max_days','90'::jsonb,DATE '2026-09-21','Seeded by migration 451: family upload links expire within 90 days unless an owner changes the window.' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'renewal.warning_days','60'::jsonb,DATE '2026-09-21','Seeded by migration 451: the queue flags renewals due within 60 days unless an owner changes the window.' FROM public.organizations o ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION haven.benefits_assert_case(p_case uuid,p_mode text DEFAULT 'read') RETURNS public.benefits_cases LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases; BEGIN
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case;
 IF c.id IS NULL OR NOT haven.benefits_permission(c.facility_id,p_mode) OR NOT EXISTS(
 SELECT 1 FROM public.residents r WHERE r.id=c.resident_id AND r.organization_id=c.organization_id AND r.deleted_at IS NULL AND (p_mode='read' OR r.facility_id=c.facility_id)) THEN
 RAISE EXCEPTION 'Benefits case unavailable' USING ERRCODE='42501'; END IF;
 RETURN c;
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_case_json(c public.benefits_cases) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(c)||jsonb_build_object('resident_name',r.first_name||' '||r.last_name,'facility_name',f.name,'assignee_name',u.full_name,
  'resident_status',r.status::text,'resident_facility_id',r.facility_id,'resident_facility_name',rf.name,'needs_rebind',r.facility_id IS DISTINCT FROM c.facility_id,
  'renewal_date',nullif(c.funding->>'renewal_date',''))
 FROM public.residents r JOIN public.facilities f ON f.id=c.facility_id LEFT JOIN public.facilities rf ON rf.id=r.facility_id LEFT JOIN public.user_profiles u ON u.id=c.assigned_to WHERE r.id=c.resident_id;
$$;
CREATE OR REPLACE FUNCTION haven.benefits_case_create_internal(p_resident_id uuid,p_admission_case_id uuid,p_program text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; c public.benefits_cases; existing public.benefits_requests; payload jsonb; result jsonb; checklist jsonb; BEGIN
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL FOR SHARE;
 PERFORM haven.benefits_lock_authority(r.facility_id);
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_program IS NULL OR p_program NOT IN ('smmc_ltc','oss','other') THEN RAISE EXCEPTION 'Invalid case' USING ERRCODE='22023'; END IF;
 IF p_admission_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admission_cases ac WHERE ac.id=p_admission_case_id AND ac.resident_id=r.id AND ac.facility_id=r.facility_id AND ac.organization_id=r.organization_id AND ac.deleted_at IS NULL) THEN RAISE EXCEPTION 'Admission unavailable' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('resident_id',p_resident_id,'admission_case_id',p_admission_case_id,'program',p_program);
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 SELECT * INTO existing FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF existing.actor_id<>(a->>'id')::uuid OR existing.action<>'create_case' OR existing.payload<>payload THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 PERFORM haven.benefits_assert_case(existing.case_id,'write'); RETURN existing.result; END IF;
 INSERT INTO public.benefits_cases(organization_id,facility_id,resident_id,admission_case_id,program,created_by)
 VALUES(r.organization_id,r.facility_id,r.id,p_admission_case_id,p_program,(a->>'id')::uuid) RETURNING * INTO c;
 UPDATE public.benefits_cases SET next_action='Review screening facts and confirm required evidence' WHERE id=c.id;
 checklist:=haven.benefits_rule(r.organization_id,'checklist.'||p_program,current_date);
 IF jsonb_typeof(checklist)='array' AND jsonb_array_length(checklist)>0 THEN
  INSERT INTO public.benefits_requirements(case_id,title,stage,status,signature_status,notes)
  SELECT c.id,t->>'title',t->>'stage','missing',coalesce(t->>'signature_status','not_required'),'Facility checklist rule in force on '||current_date||'; verify applicability and current form version. Not applicable requires reviewer reason.'
  FROM jsonb_array_elements(checklist) t;
 END IF;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'create_case',payload,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'create_case',payload,result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_collection_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  OR (p_payload->>'expires_at')::timestamptz<=now() OR (p_payload->>'expires_at')::timestamptz>now()+make_interval(days=>coalesce((haven.benefits_rule(c.organization_id,'family_collection.max_days',current_date))::text::integer,90))
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
CREATE OR REPLACE FUNCTION haven.benefits_case_list_internal(p_filters jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); rows jsonb; lim integer:=coalesce((p_filters->>'limit')::integer,50); cur_due date; cur_id uuid; next_cursor text; read_sites uuid[]; BEGIN
 PERFORM haven.benefits_keys(p_filters,ARRAY['facility_id','resident_id','status','before','limit']);
 IF lim NOT BETWEEN 1 AND 100 OR p_filters?'status' AND p_filters->>'status' NOT IN ('open','waiting','closed') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 IF p_filters->>'facility_id' IS NOT NULL AND NOT haven.benefits_permission((p_filters->>'facility_id')::uuid) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(f.id),'{}') INTO read_sites FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id);
 IF cardinality(read_sites)=0 THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 IF p_filters->>'before' IS NOT NULL THEN
  IF p_filters->>'before' !~ '^\d{4}-\d{2}-\d{2}\|[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
  cur_due:=split_part(p_filters->>'before','|',1)::date; cur_id:=split_part(p_filters->>'before','|',2)::uuid;
 END IF;
 -- Soonest due first, undated last; a case whose resident has moved stays visible (flagged) so it can be rebound rather than vanish.
 SELECT coalesce(jsonb_agg(haven.benefits_case_json(q::public.benefits_cases) ORDER BY coalesce(q.due_date,DATE '9999-12-31'),q.id),'[]') INTO rows FROM (
 SELECT c.* FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id AND r.organization_id=c.organization_id AND r.deleted_at IS NULL
 WHERE c.organization_id=(a->>'org')::uuid AND c.facility_id=ANY(read_sites)
 AND (p_filters->>'facility_id' IS NULL OR c.facility_id=(p_filters->>'facility_id')::uuid)
 AND (p_filters->>'resident_id' IS NULL OR c.resident_id=(p_filters->>'resident_id')::uuid)
 AND (p_filters->>'status' IS NULL OR c.status=p_filters->>'status')
 AND (cur_id IS NULL OR (coalesce(c.due_date,DATE '9999-12-31'),c.id)>(cur_due,cur_id))
 ORDER BY coalesce(c.due_date,DATE '9999-12-31'),c.id LIMIT lim+1) q;
 IF jsonb_array_length(rows)>lim THEN
  next_cursor:=coalesce(rows->(lim-1)->>'due_date','9999-12-31')||'|'||(rows->(lim-1)->>'id'); rows:=rows-lim;
 END IF;
 RETURN jsonb_build_object('cases',rows,'next_cursor',next_cursor);
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_options_internal(p_facility_id uuid DEFAULT NULL,p_query text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); facilities jsonb; read_sites uuid[]; write_sites uuid[]; BEGIN
 IF length(p_query)>200 THEN RAISE EXCEPTION 'Search too long' USING ERRCODE='22023'; END IF;
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 -- Authority is evaluated once per facility; every list below is bounded by those facilities and by actual access rows.
 SELECT coalesce(array_agg(f.id),'{}') INTO read_sites FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND (p_facility_id IS NULL OR f.id=p_facility_id) AND haven.benefits_permission(f.id);
 SELECT coalesce(array_agg(f.id),'{}') INTO write_sites FROM public.facilities f WHERE f.id=ANY(read_sites) AND haven.benefits_permission(f.id,'write');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name),'[]') INTO facilities FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id);
 IF jsonb_array_length(facilities)=0 THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('facilities',facilities,'can_manage_access',(a->>'admin')::boolean,
 -- Residents already on a Medicaid payer with no active case: the way existing residents (renewals) enter the workflow.
 'uncased_medicaid_residents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT DISTINCT ON (r.id) r.id,r.first_name||' '||r.last_name name,r.facility_id,p.payer_type::text payer_type,
   CASE WHEN p.payer_type::text='medicaid_oss' THEN 'oss' ELSE 'smmc_ltc' END suggested_program,p.medicaid_authorization_end
  FROM public.residents r JOIN public.resident_payers p ON p.resident_id=r.id AND p.deleted_at IS NULL AND p.payer_type::text LIKE 'medicaid%'
  WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa') AND r.facility_id=ANY(write_sites)
  AND NOT EXISTS(SELECT 1 FROM public.benefits_cases c WHERE c.resident_id=r.id AND c.status<>'closed')
  ORDER BY r.id,p.is_primary DESC LIMIT 100) x),'[]'),
 'residents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.id,r.first_name||' '||r.last_name name,r.facility_id FROM public.residents r WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.facility_id=ANY(write_sites) AND (r.id::text=p_query OR (r.first_name||' '||r.last_name) ILIKE '%'||p_query||'%') ORDER BY r.last_name,r.id LIMIT 100) x),'[]'),
 'assignees',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT DISTINCT p.id,p.full_name name,f.id facility_id FROM public.facilities f
  JOIN LATERAL (
   SELECT g.user_id FROM public.benefits_access_grants g WHERE g.organization_id=(a->>'org')::uuid AND g.facility_id=f.id AND g.revoked_at IS NULL AND g.expires_at>now() AND (g.can_write OR g.can_review)
   UNION SELECT p2.id FROM public.user_profiles p2 WHERE p2.organization_id=(a->>'org')::uuid AND p2.is_active AND p2.deleted_at IS NULL AND p2.app_role::text IN ('owner','org_admin')
  ) c ON true JOIN public.user_profiles p ON p.id=c.user_id
  WHERE f.id=ANY(read_sites) AND haven.benefits_staff(p.id,(a->>'org')::uuid,f.id) ORDER BY p.full_name,f.id LIMIT 500) x),'[]'));
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_case_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; old public.benefits_requests; result jsonb; v_id uuid; doc public.benefits_documents; req public.benefits_requirements; k text; v jsonb; manifest jsonb; mode text:='write'; stored_payload jsonb; BEGIN
 IF p_action='upsert_requirement' AND (p_payload->>'status' IN ('accepted','rejected','not_applicable') OR p_payload->>'signature_status'='verified') OR p_action='update_case' AND p_payload#>>'{funding,status}'='reviewed' OR p_action='record_event' AND coalesce((p_payload->>'formal_decision')::boolean,false) THEN mode:='review'; END IF;
 c:=haven.benefits_assert_case(p_case_id,mode);
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_action IS NULL THEN RAISE EXCEPTION 'Missing command identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored_payload:=jsonb_build_object('payload',p_payload,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
 IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>p_case_id OR old.action<>p_action OR old.payload<>stored_payload THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
 RETURN old.result; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM haven.benefits_lock_authority(c.facility_id);
 PERFORM 1 FROM public.residents WHERE id=c.resident_id FOR SHARE;
 c:=haven.benefits_assert_case(p_case_id,mode);
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed; refresh and retry' USING ERRCODE='P0409'; END IF;
 -- A closed case accepts only a reopen: status back to open, optionally clearing the closure reason and stating the next action.
 IF c.status='closed' AND (p_action<>'update_case' OR p_payload->>'status' IS DISTINCT FROM 'open' OR (p_payload-'closure_reason'-'next_action')<>'{"status":"open"}'::jsonb) THEN RAISE EXCEPTION 'Reopen the case before modifying' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'assigned_to' AND p_payload->>'assigned_to' IS NOT NULL AND NOT haven.benefits_assignable((p_payload->>'assigned_to')::uuid,c.organization_id,c.facility_id) THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_payload) LOOP
  IF k IN ('due_date','occurred_on') AND p_payload->>k IS NOT NULL AND p_payload->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END IF;
  IF k IN ('sent_at','received_at') AND p_payload->>k IS NOT NULL AND p_payload->>k !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'Invalid timestamp' USING ERRCODE='22023'; END IF;
  IF k IN ('notes','source_reference','external_reference','review_reason','closure_reason','next_action') AND (length(p_payload->>k)>4000 OR jsonb_typeof(p_payload->k) NOT IN ('string','null')) THEN RAISE EXCEPTION 'Invalid benefits text' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_action<>'finalize_document' AND p_payload ? 'document_id' THEN PERFORM haven.benefits_document_check(c.id,(p_payload->>'document_id')::uuid); END IF;
 CASE p_action
 WHEN 'update_case' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['status','next_action','assigned_to','due_date','closure_reason','screening','funding']);
  IF p_payload ? 'screening' THEN
   v:=p_payload->'screening'; PERFORM haven.benefits_keys(v,ARRAY['income_cents','assets_cents','income_basis','property','life_insurance','burial','power_of_attorney','married','notes','rule_reference']);
   FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF k IN ('income_cents','assets_cents') AND v->>k IS NOT NULL AND (jsonb_typeof(v->k)<>'number' OR v->>k !~ '^[0-9]+$' OR (v->>k)::numeric>999999999999) THEN RAISE EXCEPTION 'Invalid screening amount' USING ERRCODE='22023'; END IF;
    IF k IN ('notes','rule_reference') AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>4000) THEN RAISE EXCEPTION 'Invalid screening text' USING ERRCODE='22023'; END IF;
    IF k IN ('property','life_insurance','burial','power_of_attorney','married') AND coalesce(v->>k,'') NOT IN ('yes','no','unknown') THEN RAISE EXCEPTION 'Invalid knowledge state' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF v ? 'income_basis' AND coalesce(v->>'income_basis','') NOT IN ('gross','countable','unknown') THEN RAISE EXCEPTION 'Invalid income basis' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'funding' THEN
   v:=p_payload->'funding'; PERFORM haven.benefits_keys(v,ARRAY['plan','reference','coverage_start','coverage_end','renewal_date','resident_contribution_cents','expected_benefit_cents','status','evidence_event_ids','notes']);
   FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF k IN ('resident_contribution_cents','expected_benefit_cents') AND v->>k IS NOT NULL AND (jsonb_typeof(v->k)<>'number' OR v->>k !~ '^[0-9]+$' OR (v->>k)::numeric>999999999999) THEN RAISE EXCEPTION 'Invalid funding amount' USING ERRCODE='22023'; END IF;
    IF k IN ('coverage_start','coverage_end','renewal_date') AND v->>k IS NOT NULL THEN
     IF v->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid funding date' USING ERRCODE='22023'; END IF;
     PERFORM (v->>k)::date; END IF;
    IF k IN ('plan','reference') AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>200) OR k='notes' AND (jsonb_typeof(v->k)<>'string' OR length(v->>k)>4000) THEN RAISE EXCEPTION 'Invalid funding text' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF v ? 'status' AND coalesce(v->>'status','') NOT IN ('unverified','reviewed') THEN RAISE EXCEPTION 'Invalid funding review state' USING ERRCODE='22023'; END IF;
   IF (v->>'coverage_end')::date < (v->>'coverage_start')::date THEN RAISE EXCEPTION 'Coverage ends before start' USING ERRCODE='22023'; END IF;
   IF v ? 'evidence_event_ids' THEN
    IF jsonb_typeof(v->'evidence_event_ids')<>'array' OR jsonb_array_length(v->'evidence_event_ids')>30 THEN RAISE EXCEPTION 'Invalid funding evidence' USING ERRCODE='22023'; END IF;
    FOR k IN SELECT jsonb_array_elements_text(v->'evidence_event_ids') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.id=k::uuid AND e.case_id=c.id AND (e.payload->>'formal_decision')::boolean) THEN RAISE EXCEPTION 'Funding evidence unavailable' USING ERRCODE='22023'; END IF;
    END LOOP;
   END IF;
   IF v->>'status'='reviewed' AND (coalesce(jsonb_array_length(v->'evidence_event_ids'),0)=0 OR nullif(btrim(v->>'plan'),'') IS NULL OR nullif(btrim(v->>'reference'),'') IS NULL OR v->>'coverage_start' IS NULL) THEN RAISE EXCEPTION 'Reviewed funding needs plan, reference, start and agency evidence' USING ERRCODE='22023'; END IF;
   IF v->>'status'='reviewed' THEN
    IF NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='dcf' AND e.payload->>'event_type'='eligibility' AND lower(btrim(e.payload->>'outcome')) IN ('approved','eligible')) THEN RAISE EXCEPTION 'Reviewed funding needs approved DCF eligibility evidence' USING ERRCODE='22023'; END IF;
    IF c.program='smmc_ltc' AND (
      NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='cares' AND e.payload->>'event_type' IN ('assessment','eligibility') AND lower(btrim(e.payload->>'outcome')) IN ('approved','eligible'))
      OR NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='enrollment' AND lower(btrim(e.payload->>'outcome')) IN ('approved','enrolled','active','completed'))
      OR NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND v->'evidence_event_ids' ? e.id::text AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='authorization' AND lower(btrim(e.payload->>'outcome')) IN ('approved','authorized','active'))
    ) THEN RAISE EXCEPTION 'Reviewed LTC funding needs approved CARES, plan enrollment and authorization evidence' USING ERRCODE='22023'; END IF;
   END IF;
  END IF;
  UPDATE public.benefits_cases SET status=CASE WHEN p_payload?'status' THEN p_payload->>'status' ELSE status END,
   next_action=CASE WHEN p_payload?'next_action' THEN p_payload->>'next_action' ELSE next_action END,
   assigned_to=CASE WHEN p_payload?'assigned_to' THEN (p_payload->>'assigned_to')::uuid ELSE assigned_to END,
   due_date=CASE WHEN p_payload?'due_date' THEN (p_payload->>'due_date')::date ELSE due_date END,
   closure_reason=CASE WHEN p_payload?'closure_reason' THEN p_payload->>'closure_reason' ELSE closure_reason END,
   screening=CASE WHEN p_payload?'screening' THEN p_payload->'screening' ELSE screening END,
   funding=CASE WHEN p_payload?'funding' THEN p_payload->'funding' ELSE funding END WHERE id=c.id;
 WHEN 'upsert_requirement' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['id','title','stage','status','assigned_to','due_date','notes','document_id','review_reason','signature_status']);
  v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  SELECT * INTO req FROM public.benefits_requirements WHERE benefits_requirements.id=v_id;
  IF FOUND AND req.case_id<>c.id THEN RAISE EXCEPTION 'Requirement unavailable' USING ERRCODE='22023'; END IF;
  IF req.status IN ('accepted','not_applicable') AND mode<>'review' AND NOT haven.benefits_permission(c.facility_id,'review') THEN RAISE EXCEPTION 'Review permission required to change reviewed evidence' USING ERRCODE='42501'; END IF;
  -- Waiving or verifying a pending signature is a distinct review, not ordinary evidence collection.
  IF FOUND AND req.signature_status='pending' AND coalesce(p_payload->>'signature_status','not_required')<>'pending' AND mode<>'review' THEN c:=haven.benefits_assert_case(p_case_id,'review'); mode:='review'; END IF;
  INSERT INTO public.benefits_requirements(id,case_id,title,stage,status,assigned_to,due_date,notes,document_id,review_reason,signature_status,reviewed_by,reviewed_at)
  VALUES(v_id,c.id,p_payload->>'title',p_payload->>'stage',p_payload->>'status',(p_payload->>'assigned_to')::uuid,(p_payload->>'due_date')::date,p_payload->>'notes',(p_payload->>'document_id')::uuid,p_payload->>'review_reason',coalesce(p_payload->>'signature_status','not_required'),CASE WHEN mode='review' THEN (a->>'id')::uuid END,CASE WHEN mode='review' THEN now() END)
  ON CONFLICT ON CONSTRAINT benefits_requirements_pkey DO UPDATE SET title=excluded.title,stage=excluded.stage,status=excluded.status,assigned_to=excluded.assigned_to,due_date=excluded.due_date,notes=excluded.notes,document_id=excluded.document_id,review_reason=excluded.review_reason,signature_status=excluded.signature_status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now();
 WHEN 'record_event' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['agency','event_type','outcome','occurred_on','notes','source_reference','document_id','due_date','formal_decision']);
  IF coalesce(p_payload->>'agency','') NOT IN ('elder_options','cares','dcf','plan','other') OR coalesce(p_payload->>'event_type','') NOT IN ('screening','waitlist','assessment','application','eligibility','enrollment','authorization','correspondence','denial','appeal','renewal','notice_review','note') OR length(coalesce(btrim(p_payload->>'outcome'),'')) NOT BETWEEN 1 AND 200 OR p_payload->>'occurred_on' IS NULL THEN RAISE EXCEPTION 'Invalid agency event' USING ERRCODE='22023'; END IF;
  PERFORM (p_payload->>'occurred_on')::date; PERFORM (p_payload->>'due_date')::date;
  IF coalesce((p_payload->>'formal_decision')::boolean,false) THEN
   IF NOT haven.benefits_permission(c.facility_id,'review') THEN RAISE EXCEPTION 'Review permission required' USING ERRCODE='42501'; END IF;
   IF p_payload->>'document_id' IS NULL AND nullif(btrim(p_payload->>'source_reference'),'') IS NULL THEN RAISE EXCEPTION 'Formal decision requires attributable source' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,p_payload,(a->>'id')::uuid) RETURNING benefits_events.id INTO v_id;
 WHEN 'record_submission' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['stage','destination','method','sent_at','external_reference','document_ids','notes']);
  IF coalesce(p_payload->>'stage','') NOT IN ('screening','referral','assessment','application','funding','renewal') OR length(coalesce(btrim(p_payload->>'destination'),'')) NOT BETWEEN 1 AND 300 OR coalesce(p_payload->>'method','') NOT IN ('fax','portal','mail','secure_email','in_person') OR p_payload->>'sent_at' IS NULL OR jsonb_typeof(p_payload->'document_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission' USING ERRCODE='22023'; END IF;
  PERFORM (p_payload->>'sent_at')::timestamptz;
  IF jsonb_array_length(p_payload->'document_ids')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'document_ids')) THEN RAISE EXCEPTION 'Duplicate submission documents' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_payload->'document_ids') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Submission requires documents' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.stage=p_payload->>'stage') OR EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.stage=p_payload->>'stage' AND (r.status NOT IN ('accepted','not_applicable') OR r.status='accepted' AND NOT (p_payload->'document_ids' ? r.document_id::text))) THEN RAISE EXCEPTION 'Submission stage has unmet requirements' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_array_elements_text(p_payload->'document_ids') LOOP
   PERFORM haven.benefits_document_check(c.id,k::uuid);
   IF NOT EXISTS(SELECT 1 FROM public.benefits_requirements r WHERE r.case_id=c.id AND r.document_id=k::uuid AND r.status='accepted' AND r.signature_status<>'pending') THEN RAISE EXCEPTION 'Submission contains unreviewed document' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('id',d.id,'sha256',d.sha256,'filename',d.filename,'template_version',d.template_version) ORDER BY d.id) INTO manifest FROM public.benefits_documents d WHERE d.case_id=c.id AND p_payload->'document_ids' ? d.id::text;
  INSERT INTO public.benefits_submissions(case_id,payload,manifest,created_by) VALUES(c.id,p_payload,manifest,(a->>'id')::uuid) RETURNING benefits_submissions.id INTO v_id;
 WHEN 'record_receipt' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['submission_id','received_at','source_reference','document_id','notes']);
  IF NOT EXISTS(SELECT 1 FROM public.benefits_submissions s WHERE s.id=(p_payload->>'submission_id')::uuid AND s.case_id=c.id) OR p_payload->>'received_at' IS NULL OR (p_payload->>'document_id' IS NULL AND nullif(btrim(p_payload->>'source_reference'),'') IS NULL) THEN RAISE EXCEPTION 'Receipt needs submission and source' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'received_at')::timestamptz < (SELECT (s.payload->>'sent_at')::timestamptz FROM public.benefits_submissions s WHERE s.id=(p_payload->>'submission_id')::uuid) THEN RAISE EXCEPTION 'Receipt precedes submission' USING ERRCODE='22023'; END IF;
  INSERT INTO public.benefits_receipts(case_id,submission_id,payload,created_by) VALUES(c.id,(p_payload->>'submission_id')::uuid,p_payload,(a->>'id')::uuid) RETURNING benefits_receipts.id INTO v_id;
 WHEN 'prepare_document' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['filename','mime_type','size_bytes','sha256','document_type','template_version']);
  v_id:=gen_random_uuid();
  INSERT INTO public.benefits_documents(id,case_id,filename,mime_type,size_bytes,sha256,storage_path,document_type,template_version,created_by)
  VALUES(v_id,c.id,p_payload->>'filename',p_payload->>'mime_type',(p_payload->>'size_bytes')::bigint,p_payload->>'sha256',c.organization_id||'/'||c.id||'/'||v_id,p_payload->>'document_type',p_payload->>'template_version',(a->>'id')::uuid) RETURNING * INTO doc;
 WHEN 'finalize_document' THEN
  PERFORM haven.benefits_keys(p_payload,ARRAY['document_id']);
  SELECT * INTO doc FROM public.benefits_documents WHERE benefits_documents.id=(p_payload->>'document_id')::uuid AND case_id=c.id FOR UPDATE;
  IF doc.id IS NULL OR doc.status<>'reserved' OR doc.created_by<>(a->>'id')::uuid OR doc.verified_at IS NULL OR doc.verified_object IS NULL OR haven.benefits_object(doc.storage_path) IS DISTINCT FROM doc.verified_object THEN RAISE EXCEPTION 'Verified document bytes unavailable' USING ERRCODE='55000'; END IF;
  UPDATE public.benefits_documents SET status='ready' WHERE benefits_documents.id=doc.id RETURNING * INTO doc;
 ELSE RAISE EXCEPTION 'Unsupported benefits command' USING ERRCODE='22023';
 END CASE;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE benefits_cases.id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'record_id',v_id);
 IF doc.id IS NOT NULL THEN result:=result||jsonb_build_object('document',to_jsonb(doc)); END IF;
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,p_action,p_payload,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,p_action,stored_payload,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.benefits_case_rebind_internal(p_case_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; r public.residents; old public.benefits_requests; stored jsonb; result jsonb; p_from uuid; BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing command identity' USING ERRCODE='22023'; END IF;
 c:=haven.benefits_assert_case(p_case_id,'read');
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored:=jsonb_build_object('case_id',p_case_id);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>p_case_id OR old.action<>'rebind_facility' OR old.payload<>stored THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF; RETURN old.result; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 SELECT * INTO r FROM public.residents WHERE id=c.resident_id AND deleted_at IS NULL FOR SHARE;
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM c.organization_id THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 IF r.facility_id=c.facility_id THEN RAISE EXCEPTION 'Case already follows the resident''s facility' USING ERRCODE='22023'; END IF;
 -- A reviewed rebind: review authority on both the facility that held the case and the one that holds the resident now.
 IF NOT haven.benefits_permission(c.facility_id,'review') OR NOT haven.benefits_permission(r.facility_id,'review') THEN RAISE EXCEPTION 'Review authority on both facilities required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.benefits_cases x WHERE x.resident_id=c.resident_id AND x.program=c.program AND x.status<>'closed' AND x.id<>c.id) THEN RAISE EXCEPTION 'Another active case exists for this resident and program' USING ERRCODE='23505'; END IF;
 p_from:=c.facility_id;
 UPDATE public.benefits_cases SET facility_id=r.facility_id,revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'facility_id',c.facility_id);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'rebind_facility',jsonb_build_object('from_facility_id',p_from,'to_facility_id',r.facility_id),c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'rebind_facility',stored,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.benefits_document_access_internal(p_case_id uuid,p_document_id uuid,p_kind text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; BEGIN
 c:=haven.benefits_assert_case(p_case_id,'read');
 IF p_kind NOT IN ('download','packet') OR NOT EXISTS(SELECT 1 FROM public.benefits_documents d WHERE d.id=p_document_id AND d.case_id=c.id) THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='42501'; END IF;
 -- Reading private financial evidence is itself recorded; the case revision does not move because nothing about the case changed.
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'document_'||p_kind,jsonb_build_object('document_id',p_document_id),c.revision,(a->>'id')::uuid);
END $$;
CREATE FUNCTION public.benefits_rules_list() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_rules_list_internal(); $$;
CREATE FUNCTION public.benefits_rule_set(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_rule_set_internal(p_payload); $$;
CREATE FUNCTION public.benefits_case_rebind(p_case_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_case_rebind_internal(p_case_id,p_request_id); $$;
CREATE FUNCTION public.benefits_document_access(p_case_id uuid,p_document_id uuid,p_kind text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_document_access_internal(p_case_id,p_document_id,p_kind); $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='haven' AND p.proname IN ('benefits_checklist_default_smmc_ltc','benefits_rule_default','benefits_rule','benefits_rule_validate','benefits_rules_list_internal','benefits_rule_set_internal','benefits_case_rebind_internal','benefits_document_access_internal'))
    OR (n.nspname='public' AND p.proname IN ('benefits_rules_list','benefits_rule_set','benefits_case_rebind','benefits_document_access')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  IF f.nspname='public' OR f.proname IN ('benefits_rules_list_internal','benefits_rule_set_internal','benefits_case_rebind_internal','benefits_document_access_internal') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig); END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
