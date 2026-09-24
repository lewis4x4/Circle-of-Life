-- Created with supabase migration new; repository claim 507. COL-763 (Medicaid Amendment A, build 1).
-- Spec: docs/specs/39-medicaid-benefits-workflow.md -> Amendment A.
-- 1. The six "New Admits Medicaid Pending Criteria" answers are recorded as an append-only screening
--    (resident, optional admission) and classified against the organization's effective-dated gate rule.
-- 2. A candidate opens (or reuses) the resident's long-term-care case and marks the matching evidence as
--    requested; a "does not qualify now" answer schedules a recheck. A reviewer may override with a reason.
-- 3. Two operating rules join benefits_rules: screening.admission_gate and screening.recheck_days.
-- Classification is Circle of Life screening policy, never an eligibility decision.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
 'screening.admission_gate','screening.recheck_days'));

CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days'];
$$;
CREATE OR REPLACE FUNCTION haven.benefits_admission_gate_default() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('disqualify',jsonb_build_array('q_property_non_primary','q_income_over_limit','q_assets'),'income_limit_cents',282900,'assets_limit_cents',200000);
$$;
CREATE OR REPLACE FUNCTION haven.benefits_rule_default(p_key text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_key
  WHEN 'family_collection.max_days' THEN '90'::jsonb
  WHEN 'renewal.warning_days' THEN '60'::jsonb
  WHEN 'screening.standard_individual' THEN 'null'::jsonb
  WHEN 'checklist.smmc_ltc' THEN haven.benefits_checklist_default_smmc_ltc()
  WHEN 'screening.admission_gate' THEN haven.benefits_admission_gate_default()
  WHEN 'screening.recheck_days' THEN '90'::jsonb
  ELSE '[]'::jsonb END;
$$;
CREATE OR REPLACE FUNCTION haven.benefits_rule_validate(p_key text,p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
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
 ELSIF p_key='screening.admission_gate' THEN
  PERFORM haven.benefits_keys(p_value,ARRAY['disqualify','income_limit_cents','assets_limit_cents','source']);
  IF jsonb_typeof(p_value->'disqualify')<>'array' OR jsonb_array_length(p_value->'disqualify') NOT BETWEEN 1 AND 6
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'disqualify') d WHERE jsonb_typeof(d)<>'string' OR d#>>'{}' NOT IN ('q_property_non_primary','q_income_over_limit','q_life_insurance','q_burial_contract','q_assets','q_power_of_attorney'))
  OR (SELECT count(*) FROM jsonb_array_elements_text(p_value->'disqualify'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_value->'disqualify') x)
  OR jsonb_typeof(p_value->'income_limit_cents')<>'number' OR (p_value->>'income_limit_cents') !~ '^[0-9]+$' OR (p_value->>'income_limit_cents')::numeric NOT BETWEEN 1 AND 99999999
  OR jsonb_typeof(p_value->'assets_limit_cents')<>'number' OR (p_value->>'assets_limit_cents') !~ '^[0-9]+$' OR (p_value->>'assets_limit_cents')::numeric NOT BETWEEN 1 AND 9999999999
  OR length(coalesce(p_value->>'source',''))>500 THEN RAISE EXCEPTION 'Admission gate needs the disqualifying questions and whole-cent income and asset limits' USING ERRCODE='22023'; END IF;
 ELSIF p_key IN ('family_collection.max_days','renewal.warning_days','screening.recheck_days') THEN
  IF jsonb_typeof(p_value)<>'number' OR p_value::text !~ '^[0-9]+$' OR (p_value::text)::integer NOT BETWEEN (CASE WHEN p_key IN ('family_collection.max_days','screening.recheck_days') THEN 1 ELSE 0 END) AND 365 THEN RAISE EXCEPTION 'Day window must be a whole number of days up to 365' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Unknown benefits rule' USING ERRCODE='22023'; END IF;
END $$;
CREATE OR REPLACE FUNCTION haven.benefits_rules_list_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_manage',(a->>'admin')::boolean,'as_of',current_date,
 'rules',(SELECT jsonb_agg(jsonb_build_object('rule_key',k.key,
   'current',(SELECT to_jsonb(r) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key AND r.effective_from<=current_date ORDER BY r.effective_from DESC LIMIT 1),
   'value',haven.benefits_rule((a->>'org')::uuid,k.key,current_date),
   'scheduled',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.effective_from) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key AND r.effective_from>current_date),'[]'),
   'history_count',(SELECT count(*) FROM public.benefits_rules r WHERE r.organization_id=(a->>'org')::uuid AND r.rule_key=k.key)) ORDER BY k.key)
  FROM unnest(haven.benefits_rule_keys()) k(key)));
END $$;

INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'screening.admission_gate',haven.benefits_admission_gate_default()||jsonb_build_object('source','New Admits Medicaid Pending Criteria; Brian Lewis 2026-09-24 (COL-757, COL-759)'),DATE '2026-09-24',
 'Seeded by migration 507: owner ruling 2026-09-24. Non-primary property, income over $2,829 a month, or countable assets over $2,000 mean the resident does not qualify now.' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'screening.recheck_days','90'::jsonb,DATE '2026-09-24','Seeded by migration 507: owner ruling 2026-09-24. A resident who does not qualify now is asked again every quarter.' FROM public.organizations o ON CONFLICT DO NOTHING;

CREATE TABLE public.benefits_admission_screenings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), resident_id uuid NOT NULL REFERENCES public.residents(id),
 admission_case_id uuid REFERENCES public.admission_cases(id),
 source text NOT NULL CHECK(source IN ('admission','recheck','manual')),
 coverage text NOT NULL CHECK(coverage IN ('unknown','none','private_pay','medicaid_mma','application_pending','smmc_ltc_enrolled')),
 coverage_plan text CHECK(length(coverage_plan)<=200),
 q_property_non_primary text NOT NULL CHECK(q_property_non_primary IN ('yes','no','unknown')),
 q_income_over_limit text NOT NULL CHECK(q_income_over_limit IN ('yes','no','unknown')),
 q_life_insurance text NOT NULL CHECK(q_life_insurance IN ('yes','no','unknown')),
 q_burial_contract text NOT NULL CHECK(q_burial_contract IN ('yes','no','unknown')),
 q_assets text NOT NULL CHECK(q_assets IN ('yes','no','unknown')),
 q_power_of_attorney text NOT NULL CHECK(q_power_of_attorney IN ('yes','no','unknown')),
 monthly_income_cents integer CHECK(monthly_income_cents BETWEEN 0 AND 99999999),
 assets_cents bigint CHECK(assets_cents BETWEEN 0 AND 99999999999),
 private_pay_months integer CHECK(private_pay_months BETWEEN 0 AND 240),
 runway_date date,
 answered_by_kind text CHECK(answered_by_kind IN ('resident','poa','family','staff_records')),
 answered_at timestamptz NOT NULL, notes text CHECK(length(notes)<=4000),
 rule_id uuid REFERENCES public.benefits_rules(id), rule_value jsonb NOT NULL,
 result text NOT NULL CHECK(result IN ('candidate','not_qualified_now','needs_answers','already_enrolled')),
 reasons jsonb NOT NULL DEFAULT '[]',
 request_id uuid NOT NULL UNIQUE, request_payload jsonb NOT NULL,
 -- clock_timestamp, not now(): answers recorded within one transaction must still have a strict order ("latest answers").
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_benefits_admission_screenings_resident ON public.benefits_admission_screenings(resident_id,answered_at DESC,created_at DESC);
CREATE INDEX idx_benefits_admission_screenings_facility_result ON public.benefits_admission_screenings(facility_id,result);
CREATE TABLE public.benefits_screening_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), screening_id uuid NOT NULL REFERENCES public.benefits_admission_screenings(id),
 result text NOT NULL CHECK(result IN ('candidate','not_qualified_now','needs_answers')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 case_id uuid REFERENCES public.benefits_cases(id),
 request_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_benefits_screening_overrides_screening ON public.benefits_screening_overrides(screening_id,created_at DESC);
CREATE TABLE public.benefits_rechecks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), resident_id uuid NOT NULL REFERENCES public.residents(id),
 screening_id uuid NOT NULL REFERENCES public.benefits_admission_screenings(id), due_on date NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','closed')),
 outcome text CHECK(outcome IN ('no_change','changed','superseded','resident_left')),
 completed_screening_id uuid REFERENCES public.benefits_admission_screenings(id),
 completed_by uuid REFERENCES public.user_profiles(id), completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status='open' OR (outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_benefits_rechecks_one_open ON public.benefits_rechecks(resident_id) WHERE status='open';
CREATE INDEX idx_benefits_rechecks_facility_due ON public.benefits_rechecks(facility_id,status,due_on);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['benefits_admission_screenings','benefits_screening_overrides','benefits_rechecks'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
-- COL-627: housekeepers never read resident financial screening (restrictive, same form as 473/474).
CREATE POLICY "Housekeepers see resident name and room only" ON public.benefits_admission_screenings
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
CREATE POLICY "Housekeepers see resident name and room only" ON public.benefits_rechecks
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
-- Answer sets and overrides are the record itself (append-only, like benefits_history); financial answers stay
-- out of the broad audit_log. Rechecks change state, so their transitions are also captured in audit_log.
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.benefits_admission_screenings FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.benefits_screening_overrides FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();
CREATE TRIGGER tr_benefits_rechecks_audit AFTER INSERT OR UPDATE OR DELETE ON public.benefits_rechecks FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Pure classification: the same inputs always give the same result (mirrored in src/lib/benefits/admission-screening.ts).
-- A stated amount is compared with the rule's limit; when a yes/no answer contradicts the amount, the question
-- counts as unknown so a person resolves it, instead of the system picking a side.
CREATE OR REPLACE FUNCTION haven.benefits_screening_classify(p_coverage text,p_answers jsonb,p_income_cents bigint,p_assets_cents bigint,p_rule jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE q text; st text; ans text; reasons jsonb:='[]'; any_yes boolean:=false; any_unknown boolean:=false;
 income_limit bigint:=(p_rule->>'income_limit_cents')::bigint; assets_limit bigint:=(p_rule->>'assets_limit_cents')::bigint; BEGIN
 IF p_coverage='smmc_ltc_enrolled' THEN
  RETURN jsonb_build_object('result','already_enrolled','reasons',jsonb_build_array('Already enrolled in long-term-care Medicaid; track renewal instead of a new application.'));
 END IF;
 FOR q IN SELECT jsonb_array_elements_text(p_rule->'disqualify') LOOP
  ans:=coalesce(p_answers->>q,'unknown'); st:=ans;
  IF q='q_income_over_limit' AND p_income_cents IS NOT NULL THEN
   IF ans='unknown' THEN st:=CASE WHEN p_income_cents>income_limit THEN 'yes' ELSE 'no' END;
   ELSIF (ans='yes')<>(p_income_cents>income_limit) THEN st:='unknown'; reasons:=reasons||jsonb_build_array('The income answer and the monthly income amount disagree; confirm which is right.');
   END IF;
  ELSIF q='q_assets' THEN
   IF ans='yes' AND p_assets_cents IS NULL THEN st:='unknown'; reasons:=reasons||jsonb_build_array('Assets were reported; record the countable balance to compare with the limit.');
   ELSIF ans='yes' THEN st:=CASE WHEN p_assets_cents>assets_limit THEN 'yes' ELSE 'no' END;
   ELSIF ans='no' AND p_assets_cents IS NOT NULL AND p_assets_cents>assets_limit THEN st:='unknown'; reasons:=reasons||jsonb_build_array('The assets answer and the balance disagree; confirm which is right.');
   ELSIF ans='unknown' AND p_assets_cents IS NOT NULL THEN st:=CASE WHEN p_assets_cents>assets_limit THEN 'yes' ELSE 'no' END;
   END IF;
  END IF;
  IF st='yes' THEN any_yes:=true; reasons:=reasons||jsonb_build_array(CASE q
    WHEN 'q_property_non_primary' THEN 'Owns property that is not the primary residence.'
    WHEN 'q_income_over_limit' THEN 'Monthly income is over the admission limit.'
    WHEN 'q_assets' THEN 'Countable assets are over the admission limit.'
    WHEN 'q_life_insurance' THEN 'Has a life insurance policy.'
    WHEN 'q_burial_contract' THEN 'Has a burial contract.'
    ELSE 'Has a power of attorney.' END);
  ELSIF st='unknown' THEN any_unknown:=true; reasons:=reasons||jsonb_build_array(CASE q
    WHEN 'q_property_non_primary' THEN 'Whether they own property other than their home is not yet known.'
    WHEN 'q_income_over_limit' THEN 'Whether monthly income is over the limit is not yet known.'
    WHEN 'q_assets' THEN 'Whether countable assets are over the limit is not yet known.'
    WHEN 'q_life_insurance' THEN 'Whether they have life insurance is not yet known.'
    WHEN 'q_burial_contract' THEN 'Whether they have a burial contract is not yet known.'
    ELSE 'Whether they have a power of attorney is not yet known.' END);
  END IF;
 END LOOP;
 RETURN jsonb_build_object('result',CASE WHEN any_yes THEN 'not_qualified_now' WHEN any_unknown THEN 'needs_answers' ELSE 'candidate' END,'reasons',reasons);
END $$;

-- Applies a result: candidate opens or reuses the long-term-care case and marks the evidence to gather;
-- does-not-qualify schedules a recheck; any new result supersedes an open recheck.
CREATE OR REPLACE FUNCTION haven.benefits_screening_apply(p_screening public.benefits_admission_screenings,p_result text,p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases; created jsonb; recheck public.benefits_rechecks; recheck_days integer; marked integer:=0; t text; titles text[]; BEGIN
 UPDATE public.benefits_rechecks SET status='closed',outcome=CASE WHEN p_screening.source='recheck' THEN 'changed' ELSE 'superseded' END,
  completed_screening_id=p_screening.id,completed_by=p_actor,completed_at=now(),updated_at=now()
 WHERE resident_id=p_screening.resident_id AND status='open';
 IF p_result='not_qualified_now' THEN
  recheck_days:=(haven.benefits_rule(p_screening.organization_id,'screening.recheck_days',(p_screening.answered_at AT TIME ZONE 'America/New_York')::date))::text::integer;
  INSERT INTO public.benefits_rechecks(organization_id,facility_id,resident_id,screening_id,due_on)
  VALUES(p_screening.organization_id,p_screening.facility_id,p_screening.resident_id,p_screening.id,(p_screening.answered_at AT TIME ZONE 'America/New_York')::date+recheck_days) RETURNING * INTO recheck;
 ELSIF p_result='candidate' THEN
  SELECT * INTO c FROM public.benefits_cases WHERE resident_id=p_screening.resident_id AND program='smmc_ltc' AND status<>'closed' FOR UPDATE;
  IF c.id IS NULL THEN
   created:=haven.benefits_case_create_internal(p_screening.resident_id,p_screening.admission_case_id,'smmc_ltc',
    (md5('benefits-screening-case:'||p_request_id::text))::uuid);
   SELECT * INTO c FROM public.benefits_cases WHERE id=(created->>'case_id')::uuid FOR UPDATE;
   UPDATE public.benefits_cases SET next_action='Intake requested: candidate from the Medicaid admission questions. Send the intake request and gather the evidence marked requested.' WHERE id=c.id;
  END IF;
  -- Evidence the answers say exists is marked requested for the facility to gather; titles come from the checklist rule in force.
  titles:=ARRAY[]::text[];
  IF p_screening.q_life_insurance='yes' THEN titles:=array_append(titles,'Life insurance policy face and cash values'); END IF;
  IF p_screening.q_burial_contract='yes' THEN titles:=array_append(titles,'Burial contract and funding evidence'); END IF;
  IF p_screening.q_assets='yes' THEN titles:=array_cat(titles,ARRAY['Property and other asset evidence','Three months of bank statements: all accounts and pages']); END IF;
  IF p_screening.q_power_of_attorney='yes' THEN titles:=array_append(titles,'Power of attorney or other representative authority'); END IF;
  FOREACH t IN ARRAY titles LOOP
   UPDATE public.benefits_requirements SET status='requested',
    notes=left('Admission Medicaid questions answered yes on '||to_char(p_screening.answered_at AT TIME ZONE 'America/New_York','YYYY-MM-DD')||'. Facility administrator to gather.'||coalesce(' '||notes,''),4000),updated_at=now()
   WHERE case_id=c.id AND status='missing' AND lower(btrim(title))=lower(t);
   IF FOUND THEN marked:=marked+1; END IF;
  END LOOP;
  UPDATE public.benefits_cases SET screening=screening||jsonb_strip_nulls(jsonb_build_object(
    'income_cents',p_screening.monthly_income_cents,'assets_cents',p_screening.assets_cents,
    'life_insurance',p_screening.q_life_insurance,'burial',p_screening.q_burial_contract,'power_of_attorney',p_screening.q_power_of_attorney,
    'rule_reference','Admission Medicaid questions '||to_char(p_screening.answered_at AT TIME ZONE 'America/New_York','YYYY-MM-DD'))),
   revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by)
  VALUES(c.id,'admission_screening',jsonb_build_object('screening_id',p_screening.id,'case_id',c.id,'result',p_result,'requirements_marked',marked),c.revision,p_actor);
 END IF;
 RETURN jsonb_build_object('case_id',c.id,'recheck_id',recheck.id,'recheck_due_on',recheck.due_on,'requirements_marked',marked);
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_screening_record_internal(p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; s public.benefits_admission_screenings; prior public.benefits_admission_screenings;
 answered timestamptz; rule_row public.benefits_rules; rule_value jsonb; cls jsonb; applied jsonb; k text; months integer; BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing request identity' USING ERRCODE='22023'; END IF;
 PERFORM haven.benefits_keys(p_payload,ARRAY['resident_id','admission_case_id','source','coverage','coverage_plan','q_property_non_primary','q_income_over_limit','q_life_insurance','q_burial_contract','q_assets','q_power_of_attorney','monthly_income_cents','assets_cents','private_pay_months','answered_by_kind','answered_at','notes']);
 SELECT * INTO r FROM public.residents WHERE id=(p_payload->>'resident_id')::uuid AND deleted_at IS NULL FOR SHARE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.benefits_lock_authority(r.facility_id);
 IF r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-screening:'||p_request_id,0));
 SELECT * INTO prior FROM public.benefits_admission_screenings WHERE request_id=p_request_id;
 IF FOUND THEN
  IF prior.created_by<>(a->>'id')::uuid OR prior.request_payload<>p_payload THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('screening_id',prior.id,'result',prior.result,'reasons',prior.reasons,
   'case_id',(SELECT (h.payload->>'case_id')::uuid FROM public.benefits_history h WHERE h.action='admission_screening' AND h.payload->>'screening_id'=prior.id::text ORDER BY h.created_at LIMIT 1),
   'recheck_id',(SELECT x.id FROM public.benefits_rechecks x WHERE x.screening_id=prior.id ORDER BY x.created_at LIMIT 1),
   'recheck_due_on',(SELECT x.due_on FROM public.benefits_rechecks x WHERE x.screening_id=prior.id ORDER BY x.created_at LIMIT 1));
 END IF;
 IF p_payload->>'admission_case_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admission_cases ac WHERE ac.id=(p_payload->>'admission_case_id')::uuid AND ac.resident_id=r.id AND ac.facility_id=r.facility_id AND ac.organization_id=r.organization_id AND ac.deleted_at IS NULL) THEN RAISE EXCEPTION 'Admission unavailable' USING ERRCODE='22023'; END IF;
 IF coalesce(p_payload->>'source','') NOT IN ('admission','recheck','manual') OR coalesce(p_payload->>'coverage','') NOT IN ('unknown','none','private_pay','medicaid_mma','application_pending','smmc_ltc_enrolled') THEN RAISE EXCEPTION 'Invalid screening source or coverage' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['q_property_non_primary','q_income_over_limit','q_life_insurance','q_burial_contract','q_assets','q_power_of_attorney'] LOOP
  IF coalesce(p_payload->>k,'') NOT IN ('yes','no','unknown') THEN RAISE EXCEPTION 'Each question needs yes, no or unknown' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['monthly_income_cents','assets_cents','private_pay_months'] LOOP
  IF p_payload->>k IS NOT NULL AND (jsonb_typeof(p_payload->k)<>'number' OR p_payload->>k !~ '^[0-9]+$') THEN RAISE EXCEPTION 'Amounts are whole cents; months are whole months' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_payload->>'answered_by_kind' IS NOT NULL AND p_payload->>'answered_by_kind' NOT IN ('resident','poa','family','staff_records') THEN RAISE EXCEPTION 'Invalid respondent' USING ERRCODE='22023'; END IF;
 IF (p_payload ? 'coverage_plan' AND p_payload->>'coverage_plan' IS NOT NULL AND (jsonb_typeof(p_payload->'coverage_plan')<>'string' OR length(p_payload->>'coverage_plan')>200))
 OR (p_payload ? 'notes' AND p_payload->>'notes' IS NOT NULL AND (jsonb_typeof(p_payload->'notes')<>'string' OR length(p_payload->>'notes')>4000)) THEN RAISE EXCEPTION 'Invalid screening text' USING ERRCODE='22023'; END IF;
 answered:=coalesce((p_payload->>'answered_at')::timestamptz,clock_timestamp());
 IF answered>now()+interval '5 minutes' OR answered<now()-interval '2 years' THEN RAISE EXCEPTION 'Answers are recorded when they were given, not in the future' USING ERRCODE='22023'; END IF;
 SELECT * INTO rule_row FROM public.benefits_rules x WHERE x.organization_id=r.organization_id AND x.rule_key='screening.admission_gate' AND x.effective_from<=(answered AT TIME ZONE 'America/New_York')::date ORDER BY x.effective_from DESC LIMIT 1;
 rule_value:=coalesce(rule_row.value,haven.benefits_rule_default('screening.admission_gate'));
 cls:=haven.benefits_screening_classify(p_payload->>'coverage',p_payload,(p_payload->>'monthly_income_cents')::bigint,(p_payload->>'assets_cents')::bigint,rule_value);
 months:=(p_payload->>'private_pay_months')::integer;
 INSERT INTO public.benefits_admission_screenings(organization_id,facility_id,resident_id,admission_case_id,source,coverage,coverage_plan,
  q_property_non_primary,q_income_over_limit,q_life_insurance,q_burial_contract,q_assets,q_power_of_attorney,
  monthly_income_cents,assets_cents,private_pay_months,runway_date,answered_by_kind,answered_at,notes,rule_id,rule_value,result,reasons,request_id,request_payload,created_by)
 VALUES(r.organization_id,r.facility_id,r.id,(p_payload->>'admission_case_id')::uuid,p_payload->>'source',p_payload->>'coverage',nullif(btrim(p_payload->>'coverage_plan'),''),
  p_payload->>'q_property_non_primary',p_payload->>'q_income_over_limit',p_payload->>'q_life_insurance',p_payload->>'q_burial_contract',p_payload->>'q_assets',p_payload->>'q_power_of_attorney',
  (p_payload->>'monthly_income_cents')::integer,(p_payload->>'assets_cents')::bigint,months,
  CASE WHEN months IS NOT NULL THEN ((answered AT TIME ZONE 'America/New_York')::date+make_interval(months=>months))::date END,
  p_payload->>'answered_by_kind',answered,nullif(btrim(p_payload->>'notes'),''),rule_row.id,rule_value,cls->>'result',cls->'reasons',p_request_id,p_payload,(a->>'id')::uuid) RETURNING * INTO s;
 -- The screening row is immutable once written; the case it opens is linked through the case history row.
 applied:=haven.benefits_screening_apply(s,s.result,p_request_id,(a->>'id')::uuid);
 RETURN jsonb_build_object('screening_id',s.id,'result',s.result,'reasons',s.reasons,'case_id',applied->'case_id','recheck_id',applied->'recheck_id','recheck_due_on',applied->'recheck_due_on');
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_screening_override_internal(p_screening_id uuid,p_result text,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); s public.benefits_admission_screenings; o public.benefits_screening_overrides; applied jsonb; BEGIN
 IF p_request_id IS NULL OR p_result IS NULL OR p_result NOT IN ('candidate','not_qualified_now','needs_answers') OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'An override needs a result and a reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.benefits_admission_screenings WHERE id=p_screening_id;
 IF s.id IS NULL OR s.organization_id IS DISTINCT FROM (a->>'org')::uuid THEN RAISE EXCEPTION 'Screening unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.benefits_lock_authority(s.facility_id);
 IF NOT haven.benefits_permission(s.facility_id,'review') OR NOT EXISTS(SELECT 1 FROM public.residents x WHERE x.id=s.resident_id AND x.facility_id=s.facility_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'Screening unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-screening:'||p_request_id,0));
 SELECT * INTO o FROM public.benefits_screening_overrides WHERE request_id=p_request_id;
 IF FOUND THEN
  IF o.created_by<>(a->>'id')::uuid OR o.screening_id<>s.id OR o.result<>p_result OR o.reason<>p_reason THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('override_id',o.id,'screening_id',s.id,'result',o.result,'case_id',o.case_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.benefits_admission_screenings n WHERE n.resident_id=s.resident_id AND (n.answered_at,n.created_at)>(s.answered_at,s.created_at)) THEN RAISE EXCEPTION 'Only the latest answers can be overridden' USING ERRCODE='22023'; END IF;
 IF s.result='already_enrolled' THEN RAISE EXCEPTION 'An enrolled resident is tracked for renewal, not overridden' USING ERRCODE='22023'; END IF;
 applied:=haven.benefits_screening_apply(s,p_result,p_request_id,(a->>'id')::uuid);
 INSERT INTO public.benefits_screening_overrides(screening_id,result,reason,case_id,request_id,created_by)
 VALUES(s.id,p_result,btrim(p_reason),(applied->>'case_id')::uuid,p_request_id,(a->>'id')::uuid) RETURNING * INTO o;
 IF o.case_id IS NOT NULL THEN
  INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by)
  SELECT o.case_id,'screening_override',jsonb_build_object('screening_id',s.id,'result',p_result,'reason',o.reason),c.revision,(a->>'id')::uuid FROM public.benefits_cases c WHERE c.id=o.case_id;
 END IF;
 RETURN jsonb_build_object('override_id',o.id,'screening_id',s.id,'result',o.result,'case_id',o.case_id,'recheck_id',applied->'recheck_id','recheck_due_on',applied->'recheck_due_on');
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_screening_list_internal(p_resident_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; BEGIN
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL;
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'read') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('resident_id',r.id,'facility_id',r.facility_id,
  'permissions',jsonb_build_object('can_write',haven.benefits_permission(r.facility_id,'write'),'can_review',haven.benefits_permission(r.facility_id,'review')),
  'gate',haven.benefits_rule(r.organization_id,'screening.admission_gate',current_date),
  'active_case_id',(SELECT c.id FROM public.benefits_cases c WHERE c.resident_id=r.id AND c.program='smmc_ltc' AND c.status<>'closed'),
  'open_recheck',(SELECT to_jsonb(x) FROM public.benefits_rechecks x WHERE x.resident_id=r.id AND x.status='open'),
  'screenings',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.answered_at DESC,q.created_at DESC) FROM (
    SELECT s.id,s.admission_case_id,s.source,s.coverage,s.coverage_plan,s.q_property_non_primary,s.q_income_over_limit,s.q_life_insurance,s.q_burial_contract,s.q_assets,s.q_power_of_attorney,
     s.monthly_income_cents,s.assets_cents,s.private_pay_months,s.runway_date,s.answered_by_kind,s.answered_at,s.notes,s.result,s.reasons,s.created_at,
     p.full_name AS recorded_by_name,
     (SELECT to_jsonb(o)||jsonb_build_object('created_by_name',op.full_name) FROM public.benefits_screening_overrides o LEFT JOIN public.user_profiles op ON op.id=o.created_by WHERE o.screening_id=s.id ORDER BY o.created_at DESC LIMIT 1) AS override
    FROM public.benefits_admission_screenings s LEFT JOIN public.user_profiles p ON p.id=s.created_by
    WHERE s.resident_id=r.id AND s.organization_id=r.organization_id ORDER BY s.answered_at DESC,s.created_at DESC LIMIT 20) q),'[]'));
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_rule_keys','benefits_admission_gate_default','benefits_rule_default','benefits_rule_validate','benefits_rules_list_internal',
  'benefits_screening_classify','benefits_screening_apply','benefits_screening_record_internal','benefits_screening_override_internal','benefits_screening_list_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
-- Same posture as 451: the list/record/override entry points are callable by signed-in staff and repeat every authority check inside.
GRANT EXECUTE ON FUNCTION haven.benefits_rules_list_internal() TO authenticated;
CREATE FUNCTION public.benefits_screening_record(p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_screening_record_internal(p_payload,p_request_id); $$;
CREATE FUNCTION public.benefits_screening_override(p_screening_id uuid,p_result text,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_screening_override_internal(p_screening_id,p_result,p_reason,p_request_id); $$;
CREATE FUNCTION public.benefits_screening_list(p_resident_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_screening_list_internal(p_resident_id); $$;
REVOKE ALL ON FUNCTION public.benefits_screening_record(jsonb,uuid),public.benefits_screening_override(uuid,text,text,uuid),public.benefits_screening_list(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_screening_record(jsonb,uuid),haven.benefits_screening_record_internal(jsonb,uuid),
 public.benefits_screening_override(uuid,text,text,uuid),haven.benefits_screening_override_internal(uuid,text,text,uuid),
 public.benefits_screening_list(uuid),haven.benefits_screening_list_internal(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
