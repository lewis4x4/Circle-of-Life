-- Created with supabase migration new; repository claim 529. COL-774 (Medicaid Amendment A, build 9).
-- The board runs through plan enrollment, authorization and first payment, and returns before renewal:
-- 1. record_step for plan_enrolled / plan_authorized carries the funding facts (plan, reference, coverage dates,
--    renewal date, resident contribution) into the case's funding as unverified; review stays on the case.
-- 2. first_payment is derived, read-only, from the resident ledger (456): the first posted, unreversed payment
--    from the case's plan on or after coverage start. Haven never writes billing from benefits.
-- 3. A row leaves the active board only when that payment exists; until then an authorized case shows
--    "Approved — awaiting first payment (n days)".
-- 4. A paid case comes back as a renewal row once its renewal date is within renewal.warning_days (451).
BEGIN;

-- First posted payment from the case's plan on or after coverage start, read from the resident ledger (never written here).
-- A payment counts when its payer name names the plan, it is not reversed, and it is not private pay.
CREATE OR REPLACE FUNCTION haven.benefits_first_payment(p_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('on',e.effective_date,'amount_cents',e.amount_cents)
 FROM public.benefits_cases c
 JOIN public.resident_ledger_entries e ON e.resident_id=c.resident_id AND e.organization_id=c.organization_id
 JOIN public.payments p ON p.id=e.source_id AND p.resident_id=c.resident_id AND p.deleted_at IS NULL
 WHERE c.id=p_case_id AND nullif(btrim(c.funding->>'plan'),'') IS NOT NULL AND c.funding->>'coverage_start' ~ '^\d{4}-\d{2}-\d{2}$'
  AND e.account_kind='receivable' AND e.entry_type='resident_payment' AND e.source_type='payment' AND e.reversal_of_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.resident_ledger_entries rv WHERE rv.reversal_of_id=e.id)
  AND e.effective_date>=(c.funding->>'coverage_start')::date
  AND p.payer_type IS DISTINCT FROM 'private_pay'::public.payer_type
  AND position(lower(btrim(c.funding->>'plan')) IN lower(coalesce(p.payer_name,'')))>0
 ORDER BY e.effective_date,e.recorded_at LIMIT 1;
$$;

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

CREATE OR REPLACE FUNCTION haven.benefits_board_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; old public.benefits_requests; stored jsonb; result jsonb; s record; on_date date; today date:=(now() AT TIME ZONE 'America/New_York')::date; score integer; ev jsonb; fund jsonb; k text; BEGIN
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_action NOT IN ('record_step','record_score','set_caseworker') THEN RAISE EXCEPTION 'Invalid board command' USING ERRCODE='22023'; END IF;
 c:=haven.benefits_assert_case(p_case_id,'write');
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-request:'||p_request_id,0));
 stored:=jsonb_build_object('payload',p_payload,'expected_revision',p_expected_revision);
 SELECT * INTO old FROM public.benefits_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old.actor_id<>(a->>'id')::uuid OR old.case_id<>p_case_id OR old.action<>'board_'||p_action OR old.payload<>stored THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN old.result;
 END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM haven.benefits_lock_authority(c.facility_id);
 c:=haven.benefits_assert_case(p_case_id,'write');
 IF c.revision<>p_expected_revision THEN RAISE EXCEPTION 'Case changed; refresh and retry' USING ERRCODE='P0409'; END IF;
 IF c.status='closed' THEN RAISE EXCEPTION 'Reopen the case before modifying' USING ERRCODE='22023'; END IF;
 IF p_action IN ('record_step','record_score') THEN
  PERFORM haven.benefits_keys(p_payload,CASE WHEN p_action='record_step' THEN ARRAY['step','occurred_on','outcome','notes','plan','reference','coverage_start','coverage_end','renewal_date','resident_contribution_cents'] ELSE ARRAY['score','occurred_on','notes'] END);
  on_date:=coalesce((p_payload->>'occurred_on')::date,today);
  IF on_date>today OR on_date<today-730 THEN RAISE EXCEPTION 'Record the date it happened; not in the future' USING ERRCODE='22023'; END IF;
  IF length(coalesce(p_payload->>'notes',''))>2000 THEN RAISE EXCEPTION 'Notes too long' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='record_step' THEN
  SELECT * INTO s FROM haven.benefits_board_steps() b WHERE b.step=p_payload->>'step';
  IF s.step IS NULL OR s.step='score' THEN RAISE EXCEPTION 'Unknown board step' USING ERRCODE='22023'; END IF;
  IF s.step='dcf_decision' AND coalesce(p_payload->>'outcome','') NOT IN ('Approved','Denied') THEN RAISE EXCEPTION 'Choose approved or denied' USING ERRCODE='22023'; END IF;
  -- COL-774: plan steps carry the funding facts (plan, reference, coverage dates, renewal, resident contribution) as unverified funding.
  fund:=jsonb_strip_nulls(jsonb_build_object('plan',nullif(btrim(p_payload->>'plan'),''),'reference',nullif(btrim(p_payload->>'reference'),''),'coverage_start',p_payload->'coverage_start',
   'coverage_end',p_payload->'coverage_end','renewal_date',p_payload->'renewal_date','resident_contribution_cents',p_payload->'resident_contribution_cents'));
  IF fund<>'{}'::jsonb AND s.step NOT IN ('plan_enrolled','plan_authorized') THEN RAISE EXCEPTION 'Funding facts belong to the plan steps' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(fund) LOOP
   IF k IN ('coverage_start','coverage_end','renewal_date') THEN
    IF jsonb_typeof(fund->k)<>'string' OR fund->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid funding date' USING ERRCODE='22023'; END IF;
    BEGIN on_date:=(fund->>k)::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid funding date' USING ERRCODE='22023'; END;
    on_date:=coalesce((p_payload->>'occurred_on')::date,today);
   END IF;
   IF k='resident_contribution_cents' AND (jsonb_typeof(fund->k)<>'number' OR fund->>k !~ '^[0-9]+$' OR (fund->>k)::numeric>99999999) THEN RAISE EXCEPTION 'Invalid funding amount' USING ERRCODE='22023'; END IF;
   IF k IN ('plan','reference') AND length(fund->>k)>200 THEN RAISE EXCEPTION 'Invalid funding text' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF s.step='plan_enrolled' AND nullif(btrim(coalesce(fund->>'plan',c.funding->>'plan')),'') IS NULL THEN RAISE EXCEPTION 'Name the plan the resident enrolled in' USING ERRCODE='22023'; END IF;
  IF s.step='plan_authorized' AND coalesce(fund->>'coverage_start',c.funding->>'coverage_start') IS NULL THEN RAISE EXCEPTION 'Record the coverage start the plan authorized' USING ERRCODE='22023'; END IF;
  IF fund<>'{}'::jsonb THEN
   IF c.funding->>'status'='reviewed' THEN RAISE EXCEPTION 'Funding is already reviewed; change it on the case' USING ERRCODE='22023'; END IF;
   UPDATE public.benefits_cases SET funding=funding||fund||jsonb_build_object('status','unverified') WHERE id=c.id;
  END IF;
  ev:=jsonb_build_object('agency',s.agency,'event_type',s.event_type,'outcome',coalesce(nullif(btrim(p_payload->>'outcome'),''),s.outcome),'occurred_on',on_date,'board_step',s.step,'formal_decision',false)
   ||CASE WHEN nullif(btrim(p_payload->>'notes'),'') IS NOT NULL THEN jsonb_build_object('notes',btrim(p_payload->>'notes')) ELSE '{}'::jsonb END
   ||CASE WHEN fund<>'{}'::jsonb THEN jsonb_build_object('funding',fund) ELSE '{}'::jsonb END;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,ev,(a->>'id')::uuid);
  UPDATE public.benefits_cases SET status=CASE WHEN s.ord IN (5,7) OR s.ord>=9 THEN 'waiting' ELSE status END WHERE id=c.id;
 ELSIF p_action='record_score' THEN
  IF jsonb_typeof(p_payload->'score')<>'number' OR (p_payload->>'score') !~ '^[1-5]$' THEN RAISE EXCEPTION 'Score is a whole number from 1 to 5' USING ERRCODE='22023'; END IF;
  score:=(p_payload->>'score')::integer;
  ev:=jsonb_build_object('agency','elder_options','event_type','screening','outcome','Score '||score||CASE WHEN score=5 THEN ' — moves forward' ELSE ' — not approved at this score' END,
   'occurred_on',on_date,'board_step','score','formal_decision',false)||CASE WHEN nullif(btrim(p_payload->>'notes'),'') IS NOT NULL THEN jsonb_build_object('notes',btrim(p_payload->>'notes')) ELSE '{}'::jsonb END;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,ev,(a->>'id')::uuid);
  IF score=5 THEN
   UPDATE public.benefits_cases SET agency_score=5,reapply_on=NULL,status='open',next_action='Score 5: request the AHCA 3008 medical certification.' WHERE id=c.id;
  ELSE
   UPDATE public.benefits_cases SET agency_score=score,status='waiting',
    reapply_on=on_date+(haven.benefits_rule(c.organization_id,'score.reapply_days',on_date))::text::integer,
    next_action='Score '||score||': not approved at this score. Reapply on '||to_char(on_date+(haven.benefits_rule(c.organization_id,'score.reapply_days',on_date))::text::integer,'YYYY-MM-DD')||'.' WHERE id=c.id;
  END IF;
 ELSE
  PERFORM haven.benefits_keys(p_payload,ARRAY['contact_id']);
  IF p_payload->>'contact_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.benefits_contacts k WHERE k.id=(p_payload->>'contact_id')::uuid AND k.organization_id=c.organization_id AND k.deleted_at IS NULL) THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='22023'; END IF;
  UPDATE public.benefits_cases SET caseworker_contact_id=(p_payload->>'contact_id')::uuid WHERE id=c.id;
 END IF;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'board_'||p_action,p_payload,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'board_'||p_action,stored,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.benefits_first_payment(uuid) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
