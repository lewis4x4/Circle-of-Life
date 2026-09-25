-- Created with supabase migration new; repository claim 530. COL-768 (Medicaid Amendment A, build 10).
-- Document freshness: some evidence is only good for a period (bank statements: 90 days until Jessica sets the
-- rest, COL-761). Freshness is derived when read, never by an unattended job: an accepted requirement whose
-- title matches a `document.valid_days` entry (the entry in force on the day it was accepted) is
-- fresh, expiring (within 14 days) or expired. Nothing changes for requirements without a period.
-- 1. benefits_document_freshness(case) lists those requirements, with whether a linked family member with
--    current financial authority could be asked for a new copy.
-- 2. benefits_freshness_reopen reopens an expiring/expired requirement as requested for the facility
--    administrator to gather (write access is enough; it is not a review decision). Once reopened, the existing
--    family collection can ask the family for it. No message leaves Haven.
-- 3. Board rows carry documents_expiring for the "document expiring" badge.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days'));
CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates','document.valid_days'];
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
SELECT o.id,'document.valid_days','[{"match":"bank statement","days":90}]'::jsonb,DATE '2026-09-24','Seeded by migration 530: bank statements are good for 90 days; other documents never expire until Jessica sets their periods (COL-761).' FROM public.organizations o ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION haven.benefits_requirement_freshness(p_req public.benefits_requirements,p_org uuid,p_today date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE accepted_on date; days integer; expires_on date; BEGIN
 IF p_req.status<>'accepted' OR p_req.reviewed_at IS NULL THEN RETURN NULL; END IF;
 accepted_on:=(p_req.reviewed_at AT TIME ZONE 'America/New_York')::date;
 SELECT (e->>'days')::integer INTO days FROM jsonb_array_elements(haven.benefits_rule(p_org,'document.valid_days',accepted_on)) WITH ORDINALITY x(e,n)
 WHERE position(lower(btrim(e->>'match')) IN lower(p_req.title))>0 ORDER BY n LIMIT 1;
 IF days IS NULL THEN RETURN NULL; END IF;
 expires_on:=accepted_on+days;
 RETURN jsonb_build_object('accepted_on',accepted_on,'valid_days',days,'expires_on',expires_on,'days_left',expires_on-p_today,
  'freshness',CASE WHEN p_today>=expires_on THEN 'expired' WHEN expires_on-p_today<=14 THEN 'expiring' ELSE 'fresh' END);
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_document_freshness_internal(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases; today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 c:=haven.benefits_assert_case(p_case_id,'read');
 RETURN jsonb_build_object('as_of',today,'case_id',c.id,'revision',c.revision,
  'can_write',haven.benefits_permission(c.facility_id,'write') AND c.status<>'closed',
  'family_can_collect',EXISTS(SELECT 1 FROM public.family_resident_links l WHERE l.resident_id=c.resident_id AND l.revoked_at IS NULL AND haven.benefits_family_eligible(l.user_id,c,false)),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('requirement_id',r.id,'title',r.title,'signature_status',r.signature_status)||f.v ORDER BY (f.v->>'expires_on')::date,r.title)
   FROM public.benefits_requirements r CROSS JOIN LATERAL (SELECT haven.benefits_requirement_freshness(r,c.organization_id,today) v) f
   WHERE r.case_id=c.id AND f.v IS NOT NULL),'[]'));
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_freshness_reopen_internal(p_case_id uuid,p_requirement_id uuid,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; r public.benefits_requirements; old public.benefits_requests; stored jsonb; result jsonb; fr jsonb; today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_requirement_id IS NULL THEN RAISE EXCEPTION 'Invalid reopen request' USING ERRCODE='22023'; END IF;
 c:=haven.benefits_assert_case(p_case_id,'write');
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored:=jsonb_build_object('requirement_id',p_requirement_id,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>p_case_id OR old.action<>'freshness_reopen' OR old.payload<>stored THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN old.result;
 END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM haven.benefits_lock_authority(c.facility_id);
 c:=haven.benefits_assert_case(p_case_id,'write');
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed; refresh and retry' USING ERRCODE='P0409'; END IF;
 IF c.status='closed' THEN RAISE EXCEPTION 'Reopen the case before modifying' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.benefits_requirements WHERE id=p_requirement_id AND case_id=c.id FOR UPDATE;
 fr:=haven.benefits_requirement_freshness(r,c.organization_id,today);
 IF r.id IS NULL OR coalesce(fr->>'freshness','') NOT IN ('expiring','expired') THEN RAISE EXCEPTION 'Only a document that is expiring or expired can be reopened here' USING ERRCODE='22023'; END IF;
 UPDATE public.benefits_requirements SET status='requested',reviewed_by=NULL,reviewed_at=NULL,
  notes=left('The accepted copy '||CASE WHEN fr->>'freshness'='expired' THEN 'expired' ELSE 'expires' END||' on '||(fr->>'expires_on')||' (good for '||(fr->>'valid_days')||' days). Facility administrator to gather a current copy.'||coalesce(' '||notes,''),4000),updated_at=now()
 WHERE id=r.id;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'requirement_id',r.id);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'freshness_reopen',jsonb_build_object('requirement_id',r.id,'previous_document_id',r.document_id)||fr,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'freshness_reopen',stored,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_board_internal(p_facility_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); today date:=(now() AT TIME ZONE 'America/New_York')::date; f public.facilities; stalled integer; warn integer; BEGIN
 SELECT * INTO f FROM public.facilities WHERE id=p_facility_id AND organization_id=(a->>'org')::uuid AND deleted_at IS NULL;
 IF f.id IS NULL OR NOT haven.benefits_permission(f.id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 stalled:=(haven.benefits_rule(f.organization_id,'stalled.days',today))::text::integer;
 warn:=(haven.benefits_rule(f.organization_id,'renewal.warning_days',today))::text::integer;
 RETURN jsonb_build_object('as_of',today,'facility_id',f.id,'facility_name',f.name,'stalled_days',stalled,'renewal_warning_days',warn,
  'can_write',haven.benefits_permission(f.id,'write'),
  'steps',(SELECT jsonb_agg(jsonb_build_object('step',s.step,'label',s.label) ORDER BY s.ord) FROM haven.benefits_board_steps() s),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.revenue_not_collected_cents DESC NULLS LAST,q.resident_name) FROM (
   SELECT c.id case_id,c.revision,c.status,c.resident_id,r.first_name||' '||r.last_name resident_name,c.next_action,c.due_date,u.full_name assignee_name,
    c.agency_score,c.reapply_on,ct.id caseworker_id,ct.name caseworker_name,ct.phone caseworker_phone,
    x.dates step_dates,nx.step next_step,
    CASE WHEN nx.ord IS NULL THEN 'agency' WHEN nx.ord IN (3,4,9,10,11,12,13) OR (nx.ord=6 AND x.dates ? 'form_3008_requested') OR (nx.ord=8 AND x.dates ? 'app_requested') THEN 'agency' ELSE 'us' END waiting_on,
    -- Activity is the latest recorded step; the case's creation date counts only until a step exists (imported cases carry old dates).
    (today-coalesce(lastd.d,(c.created_at AT TIME ZONE 'America/New_York')::date)) days_since_last_step,
    pay.fp IS NULL AND (today-coalesce(lastd.d,(c.created_at AT TIME ZONE 'America/New_York')::date))>stalled stalled,
    rate.cents plan_rate_cents,
    -- COL-774: a case leaves the active board only when the plan's first payment is posted; it returns as a renewal row.
    pay.fp->>'on' first_payment_on,rn.renewal_on renewal_date,
    -- COL-768: accepted evidence past or near its good-for period.
    (SELECT count(*) FROM public.benefits_requirements dr WHERE dr.case_id=c.id AND haven.benefits_requirement_freshness(dr,c.organization_id,today)->>'freshness' IN ('expiring','expired')) documents_expiring,
    CASE WHEN pay.fp IS NOT NULL THEN 'renewal' WHEN x.dates ? 'plan_authorized' THEN 'awaiting_first_payment' ELSE 'working' END phase,
    CASE WHEN pay.fp IS NOT NULL THEN rn.renewal_on-today WHEN x.dates ? 'plan_authorized' THEN today-(x.dates->>'plan_authorized')::date END phase_days,
    CASE WHEN rate.cents IS NULL OR pay.fp IS NOT NULL THEN NULL ELSE ((today-coalesce((x.dates->>'intake_requested')::date,(c.created_at AT TIME ZONE 'America/New_York')::date))*rate.cents/30)::bigint END revenue_not_collected_cents
   FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id AND r.deleted_at IS NULL
   LEFT JOIN public.user_profiles u ON u.id=c.assigned_to LEFT JOIN public.benefits_contacts ct ON ct.id=c.caseworker_contact_id
   CROSS JOIN LATERAL (SELECT haven.benefits_board_step_dates(c.id) dates) x
   LEFT JOIN LATERAL (SELECT max(v::date) d FROM jsonb_each_text(x.dates) j(k,v)) lastd ON true
   LEFT JOIN LATERAL (SELECT s.step,s.ord FROM haven.benefits_board_steps() s WHERE NOT (x.dates ? s.step) ORDER BY s.ord LIMIT 1) nx ON true
   CROSS JOIN LATERAL (SELECT haven.benefits_plan_rate_cents(c.organization_id,c.facility_id,nullif(c.funding->>'plan',''),today) cents) rate
   CROSS JOIN LATERAL (SELECT haven.benefits_first_payment(c.id) fp) pay
   CROSS JOIN LATERAL (SELECT CASE WHEN c.funding->>'renewal_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (c.funding->>'renewal_date')::date END renewal_on) rn
   WHERE c.facility_id=f.id AND c.organization_id=f.organization_id AND c.program='smmc_ltc'
    AND (pay.fp IS NULL AND c.status<>'closed'
     OR pay.fp IS NOT NULL AND rn.renewal_on IS NOT NULL AND rn.renewal_on-today<=warn
      AND (c.status<>'closed' OR NOT EXISTS(SELECT 1 FROM public.benefits_cases o WHERE o.resident_id=c.resident_id AND o.program='smmc_ltc' AND o.status<>'closed' AND o.id<>c.id)))
   LIMIT 300) q),'[]'),
  'needs_answers',coalesce((SELECT jsonb_agg(jsonb_build_object('resident_id',r.id,'resident_name',r.first_name||' '||r.last_name) ORDER BY r.last_name) FROM public.residents r
   JOIN LATERAL (SELECT x.result FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
   WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa','pending_admission') AND s.result='needs_answers'),'[]'),
  'rechecks_due',(SELECT count(*) FROM public.benefits_rechecks x WHERE x.facility_id=f.id AND x.status='open' AND x.due_on<=today+14),
  'contacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'agency',k.agency,'phone',k.phone) ORDER BY k.agency,k.name) FROM public.benefits_contacts k WHERE k.organization_id=f.organization_id AND k.deleted_at IS NULL AND k.active),'[]'));
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_requirement_freshness','benefits_document_freshness_internal','benefits_freshness_reopen_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.benefits_document_freshness(p_case_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_document_freshness_internal(p_case_id); $$;
CREATE FUNCTION public.benefits_freshness_reopen(p_case_id uuid,p_requirement_id uuid,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_freshness_reopen_internal(p_case_id,p_requirement_id,p_expected_revision,p_request_id); $$;
REVOKE ALL ON FUNCTION public.benefits_document_freshness(uuid),public.benefits_freshness_reopen(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_document_freshness(uuid),haven.benefits_document_freshness_internal(uuid),
 public.benefits_freshness_reopen(uuid,uuid,integer,uuid),haven.benefits_freshness_reopen_internal(uuid,uuid,integer,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
