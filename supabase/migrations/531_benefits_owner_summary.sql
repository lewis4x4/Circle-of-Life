-- Created with supabase migration new; repository claim 531. COL-775 (Medicaid Amendment A, build 11).
-- The owner Medicaid summary: a live replacement for the hand-typed "Murphy Notes" tab. One card per facility:
-- census (one number; holds count as occupied), residents on a Medicaid payer, open long-term-care cases by board
-- step, approved this month, awaiting first payment, Medicaid payments posted this month (read from the ledger),
-- revenue not yet collected (the board's figure, with how many cases have no rate), sweep progress and the
-- owner's monthly goal (`summary.goals`, effective-dated). Unknown stays unknown, never $0: payments are null
-- where the facility has no ledger activity yet. Owners and org admins see every facility; a facility
-- administrator sees the facilities they can access. Aggregates only, no resident names.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days','summary.goals'));
CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days','summary.goals'];
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



CREATE OR REPLACE FUNCTION haven.benefits_summary_internal() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; today date:=(now() AT TIME ZONE 'America/New_York')::date; month_start date; goals jsonb; BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL OR NOT a.actor_is_managed OR a.actor_role_text NOT IN ('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'The Medicaid summary is for owners and facility executives' USING ERRCODE='42501'; END IF;
 month_start:=date_trunc('month',today)::date;
 goals:=haven.benefits_rule(a.actor_organization_id,'summary.goals',today);
 RETURN jsonb_build_object('as_of',today,'month_start',month_start,'can_set_goals',a.actor_role_text IN ('owner','org_admin'),
  'steps',(SELECT jsonb_agg(jsonb_build_object('step',s.step,'label',s.label) ORDER BY s.ord) FROM haven.benefits_board_steps() s),
  'facilities',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.facility_name) FROM (
   SELECT f.id facility_id,f.name facility_name,f.total_licensed_beds licensed_beds,
    (SELECT count(*) FROM public.residents r WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) census,
    (SELECT count(DISTINCT r.id) FROM public.residents r JOIN public.resident_payers p ON p.resident_id=r.id AND p.deleted_at IS NULL AND p.payer_type::text LIKE 'medicaid%' AND p.effective_date<=today AND (p.end_date IS NULL OR p.end_date>=today)
      WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) medicaid_residents,
    (SELECT (g->>'medicaid_residents')::integer FROM jsonb_array_elements(goals) g WHERE g->>'facility_id'=f.id::text) goal_medicaid_residents,
    cs.open_cases,cs.by_step,cs.awaiting_first_payment,cs.revenue_not_collected_cents,cs.cases_without_rate,
    (SELECT count(DISTINCT e.case_id) FROM public.benefits_events e JOIN public.benefits_cases c ON c.id=e.case_id
      WHERE c.facility_id=f.id AND c.program='smmc_ltc' AND (e.payload->>'occurred_on')::date BETWEEN month_start AND today
      AND ((e.payload->>'board_step'='dcf_decision' AND e.payload->>'outcome'='Approved')
       OR (coalesce((e.payload->>'formal_decision')::boolean,false) AND e.payload->>'agency'='dcf' AND e.payload->>'event_type'='eligibility' AND lower(btrim(e.payload->>'outcome')) IN ('approved','eligible')))) approved_this_month,
    CASE WHEN EXISTS(SELECT 1 FROM public.resident_ledger_entries le WHERE le.facility_id=f.id) THEN
     coalesce((SELECT sum(CASE WHEN le.reversal_of_id IS NULL THEN le.amount_cents ELSE -le.amount_cents END) FROM public.resident_ledger_entries le JOIN public.payments p ON p.id=le.source_id
      WHERE le.facility_id=f.id AND le.account_kind='receivable' AND le.entry_type='resident_payment' AND le.source_type='payment'
       AND le.effective_date BETWEEN month_start AND today AND (p.payment_method='medicaid_payment' OR p.payer_type='medicaid_oss')),0)
    END medicaid_payments_this_month_cents,
    sw.started_at sweep_started_at,
    (SELECT count(*) FROM public.residents r WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')
      AND EXISTS(SELECT 1 FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id)) sweep_answered
   FROM public.facilities f
   LEFT JOIN public.benefits_sweeps sw ON sw.facility_id=f.id
   CROSS JOIN LATERAL (
    WITH x AS (
     SELECT nx.step next_step,(d.dates ? 'plan_authorized') awaiting,rate.cents rate,
      CASE WHEN rate.cents IS NULL THEN NULL ELSE ((today-coalesce((d.dates->>'intake_requested')::date,(c.created_at AT TIME ZONE 'America/New_York')::date))*rate.cents/30)::bigint END revenue
     FROM public.benefits_cases c
     CROSS JOIN LATERAL (SELECT haven.benefits_board_step_dates(c.id) dates) d
     LEFT JOIN LATERAL (SELECT s.step FROM haven.benefits_board_steps() s WHERE NOT (d.dates ? s.step) ORDER BY s.ord LIMIT 1) nx ON true
     CROSS JOIN LATERAL (SELECT haven.benefits_plan_rate_cents(c.organization_id,c.facility_id,nullif(c.funding->>'plan',''),today) cents) rate
     WHERE c.facility_id=f.id AND c.organization_id=f.organization_id AND c.program='smmc_ltc' AND c.status<>'closed' AND haven.benefits_first_payment(c.id) IS NULL)
    SELECT (SELECT count(*) FROM x) open_cases,
     coalesce((SELECT jsonb_object_agg(g.next_step,g.n) FROM (SELECT x.next_step,count(*) n FROM x WHERE NOT x.awaiting AND x.next_step IS NOT NULL GROUP BY x.next_step) g),'{}'::jsonb) by_step,
     (SELECT count(*) FROM x WHERE x.awaiting)::integer awaiting_first_payment,
     (SELECT sum(x.revenue) FROM x) revenue_not_collected_cents,
     (SELECT count(*) FROM x WHERE x.rate IS NULL)::integer cases_without_rate) cs
   WHERE f.organization_id=a.actor_organization_id AND f.deleted_at IS NULL
    AND (a.actor_role_text IN ('owner','org_admin') OR f.id IN (SELECT haven.accessible_facility_ids()))
  ) q),'[]'));
END $$;
REVOKE ALL ON FUNCTION haven.benefits_summary_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.benefits_summary() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_summary_internal(); $$;
REVOKE ALL ON FUNCTION public.benefits_summary() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_summary(),haven.benefits_summary_internal() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
