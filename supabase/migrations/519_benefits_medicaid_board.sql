-- Created with supabase migration new; repository claim 519. COL-767 (Medicaid Amendment A, build 5).
-- The facility Medicaid board: one row per open long-term-care case, one column per step of Jessica's log.
-- 1. Board steps are case events tagged with `board_step`; dates already recorded through the case workflow
--    (formal DCF decision, plan enrollment/authorization, accepted AHCA 3008) fill the same columns.
-- 2. A board command records a step (date, never in the future), the agency score (only 5 moves forward;
--    below 5 sets a reapply date `score.reapply_days` out), and the DCF caseworker from the contacts list.
-- 3. Operating rules: score.reapply_days (30), stalled.days (14), plan.rates (placeholders from Jessica's log
--    until she confirms: UHC $1,600; Grande Cypress $1,750). Unknown rates stay unknown, never $0.
BEGIN;

ALTER TABLE public.benefits_rules DROP CONSTRAINT benefits_rules_rule_key_check;
ALTER TABLE public.benefits_rules ADD CONSTRAINT benefits_rules_rule_key_check CHECK(rule_key IN (
 'checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates'));
CREATE OR REPLACE FUNCTION haven.benefits_rule_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['checklist.smmc_ltc','checklist.oss','checklist.other','screening.standard_individual','family_collection.max_days','renewal.warning_days',
  'screening.admission_gate','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days','plan.rates'];
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
 ELSIF p_key IN ('family_collection.max_days','renewal.warning_days','screening.recheck_days','runway.lead_days','score.reapply_days','stalled.days') THEN
  IF jsonb_typeof(p_value)<>'number' OR p_value::text !~ '^[0-9]+$' OR (p_value::text)::integer NOT BETWEEN (CASE WHEN p_key IN ('family_collection.max_days','screening.recheck_days','score.reapply_days','stalled.days') THEN 1 ELSE 0 END) AND 365 THEN RAISE EXCEPTION 'Day window must be a whole number of days up to 365' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Unknown benefits rule' USING ERRCODE='22023'; END IF;
END $$;

INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'score.reapply_days','30'::jsonb,DATE '2026-09-24','Seeded by migration 519: Brian 2026-09-24 — a score below 5 can be reapplied for 30 days later.' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'stalled.days','14'::jsonb,DATE '2026-09-24','Seeded by migration 519: placeholder until Jessica sets how long a step may sit before it is flagged (COL-761).' FROM public.organizations o ON CONFLICT DO NOTHING;
INSERT INTO public.benefits_rules(organization_id,rule_key,value,effective_from,reason)
SELECT o.id,'plan.rates',jsonb_build_array(jsonb_build_object('plan','UHC','monthly_cents',160000))||coalesce((SELECT jsonb_agg(jsonb_build_object('plan','UHC','monthly_cents',175000,'facility_id',f.id)) FROM public.facilities f WHERE f.organization_id=o.id AND f.deleted_at IS NULL AND f.name ILIKE '%grande cypress%'),'[]'::jsonb),
 DATE '2026-09-24','Seeded by migration 519 from the rates in Jessica''s Medicaid Log (UHC $1,600; Grande Cypress $1,750); placeholders until Jessica confirms (COL-761).' FROM public.organizations o ON CONFLICT DO NOTHING;

CREATE TABLE public.benefits_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 agency text NOT NULL CHECK(agency IN ('dcf','elder_options','elder_affairs','cares','plan','other')),
 phone text CHECK(length(phone)<=50), email text CHECK(length(email)<=200), notes text CHECK(length(notes)<=1000),
 active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX idx_benefits_contacts_org ON public.benefits_contacts(organization_id,agency) WHERE deleted_at IS NULL;
ALTER TABLE public.benefits_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefits_contacts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_benefits_contacts_audit AFTER INSERT OR UPDATE OR DELETE ON public.benefits_contacts FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

ALTER TABLE public.benefits_cases ADD COLUMN agency_score smallint CHECK(agency_score BETWEEN 1 AND 5), ADD COLUMN reapply_on date,
 ADD COLUMN caseworker_contact_id uuid REFERENCES public.benefits_contacts(id);

-- The ordered board steps and how each is recorded as an agency event.
CREATE OR REPLACE FUNCTION haven.benefits_board_steps() RETURNS TABLE(step text,ord integer,agency text,event_type text,outcome text,label text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT * FROM (VALUES
  ('intake_requested',1,'other','correspondence','Intake requested','Intake requested'),
  ('intake_emailed',2,'other','correspondence','Intake and notice emailed','Intake & notice emailed'),
  ('assessment_complete',3,'elder_options','assessment','Assessment complete','Assessment complete'),
  ('score',4,'elder_options','screening','Score recorded','Score'),
  ('form_3008_requested',5,'other','correspondence','AHCA 3008 requested','3008 requested'),
  ('form_3008_returned',6,'other','correspondence','AHCA 3008 returned','3008 returned'),
  ('app_requested',7,'dcf','application','Medicaid application requested','App requested'),
  ('app_returned',8,'dcf','application','Medicaid application returned','App returned'),
  ('cares_processing',9,'cares','assessment','CARES processing','CARES processing'),
  ('cares_appointment',10,'cares','assessment','CARES appointment','CARES appointment'),
  ('dcf_decision',11,'dcf','eligibility','DCF decision','Approved / denied'),
  ('plan_enrolled',12,'plan','enrollment','Plan enrolled','Plan enrolled'),
  ('plan_authorized',13,'plan','authorization','Plan authorized','Plan authorized')) s(step,ord,agency,event_type,outcome,label);
$$;

-- Latest recorded date per step for a case: board-tagged events first, then the equivalent workflow facts.
CREATE OR REPLACE FUNCTION haven.benefits_board_step_dates(p_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(s.step,d.on_date) FILTER (WHERE d.on_date IS NOT NULL),'{}'::jsonb)
 FROM haven.benefits_board_steps() s
 LEFT JOIN LATERAL (SELECT coalesce(
   (SELECT max((e.payload->>'occurred_on')::date) FROM public.benefits_events e WHERE e.case_id=p_case_id AND e.payload->>'board_step'=s.step),
   CASE s.step
    WHEN 'dcf_decision' THEN (SELECT max((e.payload->>'occurred_on')::date) FROM public.benefits_events e WHERE e.case_id=p_case_id AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='dcf' AND e.payload->>'event_type' IN ('eligibility','denial'))
    WHEN 'plan_enrolled' THEN (SELECT max((e.payload->>'occurred_on')::date) FROM public.benefits_events e WHERE e.case_id=p_case_id AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='enrollment')
    WHEN 'plan_authorized' THEN (SELECT max((e.payload->>'occurred_on')::date) FROM public.benefits_events e WHERE e.case_id=p_case_id AND (e.payload->>'formal_decision')::boolean AND e.payload->>'agency'='plan' AND e.payload->>'event_type'='authorization')
    WHEN 'form_3008_returned' THEN (SELECT max((r.reviewed_at AT TIME ZONE 'America/New_York')::date) FROM public.benefits_requirements r WHERE r.case_id=p_case_id AND r.status='accepted' AND r.title ILIKE '%3008%')
   END) on_date) d ON true;
$$;

CREATE OR REPLACE FUNCTION haven.benefits_plan_rate_cents(p_org uuid,p_facility uuid,p_plan text,p_as_of date) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (e->>'monthly_cents')::integer FROM jsonb_array_elements(haven.benefits_rule(p_org,'plan.rates',p_as_of)) e
 WHERE lower(btrim(e->>'plan'))=lower(btrim(coalesce(p_plan,'UHC'))) AND (e->>'facility_id' IS NULL OR (e->>'facility_id')::uuid=p_facility)
 ORDER BY (e->>'facility_id' IS NULL) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION haven.benefits_board_internal(p_facility_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); today date:=(now() AT TIME ZONE 'America/New_York')::date; f public.facilities; stalled integer; BEGIN
 SELECT * INTO f FROM public.facilities WHERE id=p_facility_id AND organization_id=(a->>'org')::uuid AND deleted_at IS NULL;
 IF f.id IS NULL OR NOT haven.benefits_permission(f.id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 stalled:=(haven.benefits_rule(f.organization_id,'stalled.days',today))::text::integer;
 RETURN jsonb_build_object('as_of',today,'facility_id',f.id,'facility_name',f.name,'stalled_days',stalled,
  'can_write',haven.benefits_permission(f.id,'write'),
  'steps',(SELECT jsonb_agg(jsonb_build_object('step',s.step,'label',s.label) ORDER BY s.ord) FROM haven.benefits_board_steps() s),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.revenue_not_collected_cents DESC NULLS LAST,q.resident_name) FROM (
   SELECT c.id case_id,c.revision,c.status,c.resident_id,r.first_name||' '||r.last_name resident_name,c.next_action,c.due_date,u.full_name assignee_name,
    c.agency_score,c.reapply_on,ct.id caseworker_id,ct.name caseworker_name,ct.phone caseworker_phone,
    x.dates step_dates,nx.step next_step,
    CASE WHEN nx.ord IS NULL THEN 'agency' WHEN nx.ord IN (3,4,9,10,11,12,13) OR (nx.ord=6 AND x.dates ? 'form_3008_requested') OR (nx.ord=8 AND x.dates ? 'app_requested') THEN 'agency' ELSE 'us' END waiting_on,
    -- Activity is the latest recorded step; the case's creation date counts only until a step exists (imported cases carry old dates).
    (today-coalesce(lastd.d,(c.created_at AT TIME ZONE 'America/New_York')::date)) days_since_last_step,
    (today-coalesce(lastd.d,(c.created_at AT TIME ZONE 'America/New_York')::date))>stalled stalled,
    rate.cents plan_rate_cents,
    CASE WHEN rate.cents IS NULL THEN NULL ELSE ((today-coalesce((x.dates->>'intake_requested')::date,(c.created_at AT TIME ZONE 'America/New_York')::date))*rate.cents/30)::bigint END revenue_not_collected_cents
   FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id AND r.deleted_at IS NULL
   LEFT JOIN public.user_profiles u ON u.id=c.assigned_to LEFT JOIN public.benefits_contacts ct ON ct.id=c.caseworker_contact_id
   CROSS JOIN LATERAL (SELECT haven.benefits_board_step_dates(c.id) dates) x
   LEFT JOIN LATERAL (SELECT max(v::date) d FROM jsonb_each_text(x.dates) j(k,v)) lastd ON true
   LEFT JOIN LATERAL (SELECT s.step,s.ord FROM haven.benefits_board_steps() s WHERE NOT (x.dates ? s.step) ORDER BY s.ord LIMIT 1) nx ON true
   CROSS JOIN LATERAL (SELECT haven.benefits_plan_rate_cents(c.organization_id,c.facility_id,nullif(c.funding->>'plan',''),today) cents) rate
   WHERE c.facility_id=f.id AND c.organization_id=f.organization_id AND c.program='smmc_ltc' AND c.status<>'closed' LIMIT 300) q),'[]'),
  'needs_answers',coalesce((SELECT jsonb_agg(jsonb_build_object('resident_id',r.id,'resident_name',r.first_name||' '||r.last_name) ORDER BY r.last_name) FROM public.residents r
   JOIN LATERAL (SELECT x.result FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1) s ON true
   WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa','pending_admission') AND s.result='needs_answers'),'[]'),
  'rechecks_due',(SELECT count(*) FROM public.benefits_rechecks x WHERE x.facility_id=f.id AND x.status='open' AND x.due_on<=today+14),
  'contacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'agency',k.agency,'phone',k.phone) ORDER BY k.agency,k.name) FROM public.benefits_contacts k WHERE k.organization_id=f.organization_id AND k.deleted_at IS NULL AND k.active),'[]'));
END $$;

-- Board command: record_step, record_score, set_caseworker. Same identity, revision and replay rules as case commands.
CREATE OR REPLACE FUNCTION haven.benefits_board_command_internal(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); c public.benefits_cases; old public.benefits_requests; stored jsonb; result jsonb; s record; on_date date; today date:=(now() AT TIME ZONE 'America/New_York')::date; score integer; ev jsonb; BEGIN
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
  PERFORM haven.benefits_keys(p_payload,CASE WHEN p_action='record_step' THEN ARRAY['step','occurred_on','outcome','notes'] ELSE ARRAY['score','occurred_on','notes'] END);
  on_date:=coalesce((p_payload->>'occurred_on')::date,today);
  IF on_date>today OR on_date<today-730 THEN RAISE EXCEPTION 'Record the date it happened; not in the future' USING ERRCODE='22023'; END IF;
  IF length(coalesce(p_payload->>'notes',''))>2000 THEN RAISE EXCEPTION 'Notes too long' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='record_step' THEN
  SELECT * INTO s FROM haven.benefits_board_steps() b WHERE b.step=p_payload->>'step';
  IF s.step IS NULL OR s.step='score' THEN RAISE EXCEPTION 'Unknown board step' USING ERRCODE='22023'; END IF;
  IF s.step='dcf_decision' AND coalesce(p_payload->>'outcome','') NOT IN ('Approved','Denied') THEN RAISE EXCEPTION 'Choose approved or denied' USING ERRCODE='22023'; END IF;
  ev:=jsonb_build_object('agency',s.agency,'event_type',s.event_type,'outcome',coalesce(nullif(btrim(p_payload->>'outcome'),''),s.outcome),'occurred_on',on_date,'board_step',s.step,'formal_decision',false)
   ||CASE WHEN nullif(btrim(p_payload->>'notes'),'') IS NOT NULL THEN jsonb_build_object('notes',btrim(p_payload->>'notes')) ELSE '{}'::jsonb END;
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

CREATE OR REPLACE FUNCTION haven.benefits_contact_save_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); k public.benefits_contacts; BEGIN
 PERFORM haven.benefits_keys(p_payload,ARRAY['id','name','agency','phone','email','notes','active']);
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id,'write')) THEN RAISE EXCEPTION 'Benefits write access required' USING ERRCODE='42501'; END IF;
 IF length(coalesce(btrim(p_payload->>'name'),'')) NOT BETWEEN 1 AND 200 OR coalesce(p_payload->>'agency','') NOT IN ('dcf','elder_options','elder_affairs','cares','plan','other') THEN RAISE EXCEPTION 'A contact needs a name and an agency' USING ERRCODE='22023'; END IF;
 IF p_payload->>'id' IS NOT NULL THEN
  UPDATE public.benefits_contacts SET name=btrim(p_payload->>'name'),agency=p_payload->>'agency',phone=nullif(btrim(p_payload->>'phone'),''),email=nullif(btrim(p_payload->>'email'),''),
   notes=nullif(btrim(p_payload->>'notes'),''),active=coalesce((p_payload->>'active')::boolean,true),updated_at=now()
  WHERE id=(p_payload->>'id')::uuid AND organization_id=(a->>'org')::uuid AND deleted_at IS NULL RETURNING * INTO k;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  INSERT INTO public.benefits_contacts(organization_id,name,agency,phone,email,notes,active,created_by)
  VALUES((a->>'org')::uuid,btrim(p_payload->>'name'),p_payload->>'agency',nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'email'),''),nullif(btrim(p_payload->>'notes'),''),coalesce((p_payload->>'active')::boolean,true),(a->>'id')::uuid) RETURNING * INTO k;
 END IF;
 RETURN to_jsonb(k);
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_rule_keys','benefits_rule_default','benefits_rule_validate','benefits_board_steps','benefits_board_step_dates','benefits_plan_rate_cents','benefits_board_internal','benefits_board_command_internal','benefits_contact_save_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.benefits_board(p_facility_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_board_internal(p_facility_id); $$;
CREATE FUNCTION public.benefits_board_command(p_case_id uuid,p_action text,p_payload jsonb,p_expected_revision integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_board_command_internal(p_case_id,p_action,p_payload,p_expected_revision,p_request_id); $$;
CREATE FUNCTION public.benefits_contact_save(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_contact_save_internal(p_payload); $$;
REVOKE ALL ON FUNCTION public.benefits_board(uuid),public.benefits_board_command(uuid,text,jsonb,integer,uuid),public.benefits_contact_save(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_board(uuid),haven.benefits_board_internal(uuid),
 public.benefits_board_command(uuid,text,jsonb,integer,uuid),haven.benefits_board_command_internal(uuid,text,jsonb,integer,uuid),
 public.benefits_contact_save(jsonb),haven.benefits_contact_save_internal(jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
