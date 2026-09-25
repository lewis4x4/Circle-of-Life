-- Created with supabase migration new; repository claim 532. COL-769 (Medicaid Amendment A, build 12).
-- Two informational prompts on Jessica's list; neither changes a screening result, a case or eligibility.
-- 1. Over income: when `prompt.over_income` is on and the latest answers say income is over the limit, the
--    resident stays "does not qualify now" and Jessica sees "Over income — consider a Qualified Income Trust".
--    Default off; Brian turned it on 2026-09-24 (COL-758), so existing organizations are seeded on.
-- 2. Property look-back (always on): when a recheck changes "owns property other than their home" from yes to
--    no, Jessica is reminded to check the transfer look-back before applying.
-- Both can be set aside; for these two a reason is optional and still recorded.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days','summary.goals','prompt.over_income'));
CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days','summary.goals','prompt.over_income'];
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
  WHEN 'score.reapply_days' THEN '30'::jsonb
  WHEN 'stalled.days' THEN '14'::jsonb
  WHEN 'prompt.over_income' THEN 'false'::jsonb
  WHEN 'document.valid_days' THEN '[{"match":"bank statement","days":90}]'::jsonb
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
 ELSIF p_key='plan.rates' THEN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) e WHERE jsonb_typeof(e)<>'object'
   OR length(coalesce(btrim(e->>'plan'),'')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(e->'monthly_cents')<>'number' OR (e->>'monthly_cents') !~ '^[0-9]+$' OR (e->>'monthly_cents')::numeric NOT BETWEEN 1 AND 99999999
   OR (e ? 'facility_id' AND e->>'facility_id' IS NOT NULL AND e->>'facility_id' !~ '^[0-9a-f-]{36}$') OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('plan','monthly_cents','facility_id'))) THEN
   RAISE EXCEPTION 'Plan rates need a plan name, a whole-cent monthly rate and an optional facility' USING ERRCODE='22023'; END IF;
 ELSIF p_key='prompt.over_income' THEN
  IF jsonb_typeof(p_value)<>'boolean' THEN RAISE EXCEPTION 'The over-income prompt is on or off' USING ERRCODE='22023'; END IF;
 ELSIF p_key='summary.goals' THEN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) e WHERE jsonb_typeof(e)<>'object'
   OR coalesce(e->>'facility_id','') !~ '^[0-9a-f-]{36}$' OR jsonb_typeof(e->'medicaid_residents')<>'number' OR (e->>'medicaid_residents') !~ '^[0-9]+$' OR (e->>'medicaid_residents')::numeric>1000
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('facility_id','medicaid_residents')))
   OR (SELECT count(*) FROM jsonb_array_elements(p_value))<>(SELECT count(DISTINCT e->>'facility_id') FROM jsonb_array_elements(p_value) e) THEN
   RAISE EXCEPTION 'Goals need one facility and a whole number of Medicaid residents per line' USING ERRCODE='22023'; END IF;
 ELSIF p_key='document.valid_days' THEN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>60 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) e WHERE jsonb_typeof(e)<>'object'
   OR length(coalesce(btrim(e->>'match'),'')) NOT BETWEEN 2 AND 200 OR jsonb_typeof(e->'days')<>'number' OR (e->>'days') !~ '^[0-9]+$' OR (e->>'days')::numeric NOT BETWEEN 1 AND 3650
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('match','days'))) THEN
   RAISE EXCEPTION 'Good-for periods need the document name to match and a whole number of days up to 3650' USING ERRCODE='22023'; END IF;
 ELSIF p_key IN ('family_collection.max_days','renewal.warning_days','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days') THEN
  IF jsonb_typeof(p_value)<>'number' OR p_value::text !~ '^[0-9]+$' OR (p_value::text)::integer NOT BETWEEN (CASE WHEN p_key IN ('family_collection.max_days','screening.recheck_days','score.reapply_days','stalled.days') THEN 1 ELSE 0 END) AND 365 THEN RAISE EXCEPTION 'Day window must be a whole number of days up to 365' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Unknown benefits rule' USING ERRCODE='22023'; END IF;
END $$;



INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'prompt.over_income','true'::jsonb,DATE '2026-09-24','Seeded by migration 532: Brian 2026-09-24 (COL-758) — show the Qualified Income Trust prompt for over-income residents.' FROM public.organizations o ON CONFLICT DO NOTHING;

ALTER TABLE public.benefits_prompt_dismissals DROP CONSTRAINT benefits_prompt_dismissals_kind_check;
ALTER TABLE public.benefits_prompt_dismissals ADD CONSTRAINT benefits_prompt_dismissals_kind_check CHECK(kind IN ('runway','late_payments','over_income','property_lookback'));
ALTER TABLE public.benefits_prompt_dismissals ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE public.benefits_prompt_dismissals DROP CONSTRAINT benefits_prompt_dismissals_reason_check;
ALTER TABLE public.benefits_prompt_dismissals ADD CONSTRAINT benefits_prompt_dismissals_reason_check CHECK(
 CASE WHEN reason IS NULL THEN kind IN ('over_income','property_lookback') ELSE length(btrim(reason)) BETWEEN 1 AND 2000 END);

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
   HAVING count(*)=2 AND bool_and(i.balance_due>0) LIMIT 200) q),'[]'),
 -- COL-769: informational prompts. Neither changes a screening result, a case or eligibility.
 'over_income',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.facility_name,q.resident_name) FROM (
   SELECT r.id resident_id,r.first_name||' '||r.last_name resident_name,r.facility_id,f.name facility_name,s.answered_at,
    haven.benefits_permission(r.facility_id,'write') can_write
   FROM public.residents r JOIN public.facilities f ON f.id=r.facility_id
   JOIN LATERAL (SELECT x.* FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
   WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa','pending_admission')
    AND haven.benefits_permission(r.facility_id,'read') AND (p_facility_id IS NULL OR r.facility_id=p_facility_id)
    AND haven.benefits_rule(r.organization_id,'prompt.over_income',today)='true'::jsonb
    AND s.result='not_qualified_now' AND (s.q_income_over_limit='yes' OR s.reasons ? 'Monthly income is over the admission limit.')
    AND NOT EXISTS(SELECT 1 FROM public.benefits_prompt_dismissals d WHERE d.resident_id=r.id AND d.kind='over_income' AND d.until_on>=today)
   LIMIT 200) q),'[]'),
 'property_lookback',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.changed_at DESC,q.resident_id) FROM (
   SELECT r.id resident_id,r.first_name||' '||r.last_name resident_name,r.facility_id,f.name facility_name,s.answered_at changed_at,
    haven.benefits_permission(r.facility_id,'write') can_write
   FROM public.residents r JOIN public.facilities f ON f.id=r.facility_id
   JOIN LATERAL (SELECT x.* FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
   JOIN LATERAL (SELECT x.* FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC OFFSET 1 LIMIT 1) prev ON true
   WHERE r.organization_id=(a->>'org')::uuid AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa','pending_admission')
    AND haven.benefits_permission(r.facility_id,'read') AND (p_facility_id IS NULL OR r.facility_id=p_facility_id)
    AND prev.q_property_non_primary='yes' AND s.q_property_non_primary='no'
    AND NOT EXISTS(SELECT 1 FROM public.benefits_prompt_dismissals d WHERE d.resident_id=r.id AND d.kind='property_lookback' AND d.until_on>=today AND d.created_at>=s.answered_at)
   LIMIT 200) q),'[]'));
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_prompt_dismiss_internal(p_resident_id uuid,p_kind text,p_days integer,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); r public.residents; d public.benefits_prompt_dismissals; today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('runway','late_payments','over_income','property_lookback') OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 180
  OR length(coalesce(btrim(p_reason),''))>2000 OR (p_kind IN ('runway','late_payments') AND length(coalesce(btrim(p_reason),''))=0) THEN RAISE EXCEPTION 'Setting a prompt aside needs a number of days and a reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.benefits_prompt_dismissals WHERE request_id=p_request_id;
 IF FOUND THEN
  IF d.created_by<>(a->>'id')::uuid OR d.resident_id<>p_resident_id OR d.kind<>p_kind THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('dismissal_id',d.id,'until_on',d.until_on);
 END IF;
 SELECT * INTO r FROM public.residents WHERE id=p_resident_id AND deleted_at IS NULL;
 IF r.id IS NULL OR r.organization_id IS DISTINCT FROM (a->>'org')::uuid OR NOT haven.benefits_permission(r.facility_id,'write') THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.benefits_prompt_dismissals(organization_id,facility_id,resident_id,kind,until_on,reason,request_id,created_by)
 VALUES(r.organization_id,r.facility_id,r.id,p_kind,today+p_days,nullif(btrim(p_reason),''),p_request_id,(a->>'id')::uuid) RETURNING * INTO d;
 RETURN jsonb_build_object('dismissal_id',d.id,'until_on',d.until_on);
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
