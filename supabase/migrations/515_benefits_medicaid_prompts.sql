-- Created with supabase migration new; repository claim 514. COL-766 (Medicaid Amendment A, build 4).
-- Most Medicaid cases start when a private-pay resident's money is running out, not at admission.
-- 1. Runway prompt: the latest answers recorded how many months the resident can private pay; Haven puts the
--    resident on Jessica's prompt list `runway.lead_days` (default 75) before that date, until a case exists.
-- 2. Late-payment prompt: the two most recent past-due private-pay invoices both still owe money. Payments are
--    still recorded in QuickBooks, so this signal only runs for a facility once Haven has payments recorded there
--    in the last 60 days; otherwise it reports itself off instead of flagging every resident.
-- 3. Jessica can start the case from a prompt or set it aside for a number of days with a reason.
-- Prompts are for staff only; nothing is sent to residents or families, and nothing is written to billing.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
 'screening.admission_gate','screening.recheck_days','runway.lead_days'));
CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days'];
$$;
CREATE OR REPLACE FUNCTION haven.benefits_rule_default(p_key text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_key
  WHEN 'family_collection.max_days' THEN '90'::jsonb
  WHEN 'renewal.warning_days' THEN '60'::jsonb
  WHEN 'screening.standard_individual' THEN 'null'::jsonb
  WHEN 'checklist.smmc_ltc' THEN haven.benefits_checklist_default_smmc_ltc()
  WHEN 'screening.admission_gate' THEN haven.benefits_admission_gate_default()
  WHEN 'screening.recheck_days' THEN '90'::jsonb
  WHEN 'runway.lead_days' THEN '75'::jsonb
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
 ELSIF p_key IN ('family_collection.max_days','renewal.warning_days','screening.recheck_days','runway.lead_days') THEN
  IF jsonb_typeof(p_value)<>'number' OR p_value::text !~ '^[0-9]+$' OR (p_value::text)::integer NOT BETWEEN (CASE WHEN p_key IN ('family_collection.max_days','screening.recheck_days') THEN 1 ELSE 0 END) AND 365 THEN RAISE EXCEPTION 'Day window must be a whole number of days up to 365' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Unknown benefits rule' USING ERRCODE='22023'; END IF;
END $$;

INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'runway.lead_days','75'::jsonb,DATE '2026-09-24','Seeded by migration 514: placeholder until Jessica sets how early to start before private pay runs out (COL-761).' FROM public.organizations o ON CONFLICT DO NOTHING;

CREATE TABLE public.benefits_prompt_dismissals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), resident_id uuid NOT NULL REFERENCES public.residents(id),
 kind text NOT NULL CHECK(kind IN ('runway','late_payments')), until_on date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), request_id uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_benefits_prompt_dismissals_resident ON public.benefits_prompt_dismissals(resident_id,kind,until_on DESC);
ALTER TABLE public.benefits_prompt_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefits_prompt_dismissals FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY "Housekeepers see resident name and room only" ON public.benefits_prompt_dismissals
  AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT haven.app_role()) IS DISTINCT FROM 'housekeeper'::public.app_role);
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.benefits_prompt_dismissals FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();
CREATE TRIGGER tr_benefits_prompt_dismissals_audit AFTER INSERT OR UPDATE OR DELETE ON public.benefits_prompt_dismissals FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Whether Haven holds this facility's payments (any recorded in the last 60 days).
CREATE OR REPLACE FUNCTION haven.benefits_late_signal_live(p_facility_id uuid,p_today date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.payments p WHERE p.facility_id=p_facility_id AND p.deleted_at IS NULL AND p.payment_date>=p_today-60);
$$;

CREATE OR REPLACE FUNCTION haven.benefits_prompts_internal(p_facility_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('as_of',today,
 'late_signal',coalesce((SELECT jsonb_agg(jsonb_build_object('facility_id',f.id,'facility_name',f.name,'live',haven.benefits_late_signal_live(f.id,today)) ORDER BY f.name)
   FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id,'read') AND (p_facility_id IS NULL OR f.id=p_facility_id)),'[]'),
 'runway',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.runway_date,q.resident_id) FROM (
   SELECT r.id resident_id,r.first_name||' '||r.last_name resident_name,r.facility_id,f.name facility_name,s.runway_date,(s.runway_date-today) days_left,s.result last_result,
    haven.benefits_permission(r.facility_id,'write') can_write
   FROM public.residents r JOIN public.facilities f ON f.id=r.facility_id
   JOIN LATERAL (SELECT x.* FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
   WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')
    AND haven.benefits_permission(r.facility_id,'read') AND (p_facility_id IS NULL OR r.facility_id=p_facility_id)
    AND s.runway_date IS NOT NULL AND s.result<>'already_enrolled'
    AND today>=s.runway_date-(haven.benefits_rule(r.organization_id,'runway.lead_days',today))::text::integer
    AND NOT EXISTS(SELECT 1 FROM public.benefits_cases c WHERE c.resident_id=r.id AND c.program='smmc_ltc' AND c.status<>'closed')
    AND NOT EXISTS(SELECT 1 FROM public.benefits_prompt_dismissals d WHERE d.resident_id=r.id AND d.kind='runway' AND d.until_on>=today)
   ORDER BY s.runway_date LIMIT 200) q),'[]'),
 'late_payments',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.oldest_due,q.resident_id) FROM (
   SELECT r.id resident_id,r.first_name||' '||r.last_name resident_name,r.facility_id,f.name facility_name,
    min(i.due_date) oldest_due,sum(i.balance_due) owed_cents,haven.benefits_permission(r.facility_id,'write') can_write
   FROM public.residents r JOIN public.facilities f ON f.id=r.facility_id
   JOIN LATERAL (SELECT v.* FROM public.invoices v WHERE v.resident_id=r.id AND v.deleted_at IS NULL AND v.status NOT IN ('draft','void','written_off')
     AND v.payer_type='private_pay' AND v.due_date<today ORDER BY v.due_date DESC LIMIT 2) i ON true
   WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')
    AND haven.benefits_permission(r.facility_id,'read') AND (p_facility_id IS NULL OR r.facility_id=p_facility_id)
    AND haven.benefits_late_signal_live(r.facility_id,today)
    AND NOT EXISTS(SELECT 1 FROM public.benefits_cases c WHERE c.resident_id=r.id AND c.program='smmc_ltc' AND c.status<>'closed')
    AND NOT EXISTS(SELECT 1 FROM public.benefits_prompt_dismissals d WHERE d.resident_id=r.id AND d.kind='late_payments' AND d.until_on>=today)
   GROUP BY r.id,r.first_name,r.last_name,r.facility_id,f.name
   HAVING count(*)=2 AND bool_and(i.balance_due>0) LIMIT 200) q),'[]'));
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_prompt_start_case_internal(p_resident_id uuid,p_kind text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; c public.benefits_cases; created jsonb; s public.benefits_admission_screenings; BEGIN
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('runway','late_payments') THEN RAISE EXCEPTION 'Invalid prompt' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL;
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE resident_id=r.id AND program='smmc_ltc' AND status<>'closed';
 IF c.id IS NOT NULL THEN RETURN jsonb_build_object('case_id',c.id,'already_open',true); END IF;
 created:=haven.benefits_case_create_internal(r.id,NULL,'smmc_ltc',p_request_id);
 SELECT * INTO s FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1;
 UPDATE public.benefits_cases SET next_action=CASE p_kind
   WHEN 'runway' THEN 'Intake requested: private pay expected to end about '||coalesce(to_char(s.runway_date,'YYYY-MM-DD'),'soon')||'. Send the intake request and 45-day notice.'
   ELSE 'Intake requested: the two most recent private-pay invoices are past due and unpaid. Confirm the resident''s finances and send the intake request.' END
 WHERE id=(created->>'case_id')::uuid AND (next_action IS NULL OR next_action LIKE 'Review screening facts%');
 RETURN jsonb_build_object('case_id',(created->>'case_id')::uuid,'already_open',false);
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_prompt_dismiss_internal(p_resident_id uuid,p_kind text,p_days integer,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; d public.benefits_prompt_dismissals; today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 IF p_request_id IS NULL OR p_kind NOT IN ('runway','late_payments') OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 180 OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Setting a prompt aside needs a number of days and a reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.benefits_prompt_dismissals WHERE request_id=p_request_id;
 IF FOUND THEN
  IF d.created_by<>(a->>'id')::uuid OR d.resident_id<>p_resident_id OR d.kind<>p_kind THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('dismissal_id',d.id,'until_on',d.until_on);
 END IF;
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL;
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.benefits_prompt_dismissals(organization_id,facility_id,resident_id,kind,until_on,reason,request_id,created_by)
 VALUES(r.organization_id,r.facility_id,r.id,p_kind,today+p_days,btrim(p_reason),p_request_id,(a->>'id')::uuid) RETURNING * INTO d;
 RETURN jsonb_build_object('dismissal_id',d.id,'until_on',d.until_on);
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_rule_keys','benefits_rule_default','benefits_rule_validate','benefits_late_signal_live','benefits_prompts_internal','benefits_prompt_start_case_internal','benefits_prompt_dismiss_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.benefits_prompts(p_facility_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_prompts_internal(p_facility_id); $$;
CREATE FUNCTION public.benefits_prompt_start_case(p_resident_id uuid,p_kind text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_prompt_start_case_internal(p_resident_id,p_kind,p_request_id); $$;
CREATE FUNCTION public.benefits_prompt_dismiss(p_resident_id uuid,p_kind text,p_days integer,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_prompt_dismiss_internal(p_resident_id,p_kind,p_days,p_reason,p_request_id); $$;
REVOKE ALL ON FUNCTION public.benefits_prompts(uuid),public.benefits_prompt_start_case(uuid,text,uuid),public.benefits_prompt_dismiss(uuid,text,integer,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_prompts(uuid),haven.benefits_prompts_internal(uuid),
 public.benefits_prompt_start_case(uuid,text,uuid),haven.benefits_prompt_start_case_internal(uuid,text,uuid),
 public.benefits_prompt_dismiss(uuid,text,integer,text,uuid),haven.benefits_prompt_dismiss_internal(uuid,text,integer,text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
