-- Created with supabase migration new; repository claim 508. COL-764 (Medicaid Amendment A, build 2).
-- Quarterly recheck for residents who do not qualify now (A/B/E = yes):
-- 1. The facility administrator lists due rechecks and records "no change" (schedules the next one) or
--    "resident left" (closes it). "Answers changed" is a new answer set with source 'recheck' (migration 507),
--    which closes the recheck as changed.
-- 2. A changed recheck that makes the resident a candidate puts the case on Jessica's queue as
--    "Resubmit — answers changed".
-- 3. Due and overdue rechecks are read live (benefits_recheck_list) by the Facility Operator Home card and the
--    Medicaid & benefits rechecks view; no scheduled job, so an alert cannot be missed or duplicated.
BEGIN;

ALTER TABLE public.benefits_rechecks ADD COLUMN completion_request_id uuid UNIQUE, ADD COLUMN note text CHECK(length(note)<=2000),
 ADD COLUMN next_recheck_id uuid REFERENCES public.benefits_rechecks(id);

CREATE OR REPLACE FUNCTION haven.benefits_screening_apply(p_screening public.benefits_admission_screenings,p_result text,p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.benefits_cases; created jsonb; recheck public.benefits_rechecks; recheck_days integer; marked integer:=0; t text; titles text[]; answered_on text; BEGIN
 answered_on:=to_char(p_screening.answered_at AT TIME ZONE 'America/New_York','YYYY-MM-DD');
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
  -- A recheck whose answers changed goes back to Jessica to resubmit, whether the case is new or reused.
  IF p_screening.source='recheck' THEN
   UPDATE public.benefits_cases SET next_action='Resubmit — answers changed at the recheck on '||answered_on||'. Review the updated answers and documents, then resubmit.',
    status=CASE WHEN status='waiting' THEN 'open' ELSE status END WHERE id=c.id;
  END IF;
  titles:=ARRAY[]::text[];
  IF p_screening.q_life_insurance='yes' THEN titles:=array_append(titles,'Life insurance policy face and cash values'); END IF;
  IF p_screening.q_burial_contract='yes' THEN titles:=array_append(titles,'Burial contract and funding evidence'); END IF;
  IF p_screening.q_assets='yes' THEN titles:=array_cat(titles,ARRAY['Property and other asset evidence','Three months of bank statements: all accounts and pages']); END IF;
  IF p_screening.q_power_of_attorney='yes' THEN titles:=array_append(titles,'Power of attorney or other representative authority'); END IF;
  FOREACH t IN ARRAY titles LOOP
   UPDATE public.benefits_requirements SET status='requested',
    notes=left(CASE WHEN p_screening.source='recheck' THEN 'Recheck' ELSE 'Admission Medicaid questions' END||' answered yes on '||answered_on||'. Facility administrator to gather.'||coalesce(' '||notes,''),4000),updated_at=now()
   WHERE case_id=c.id AND status='missing' AND lower(btrim(title))=lower(t);
   IF FOUND THEN marked:=marked+1; END IF;
  END LOOP;
  UPDATE public.benefits_cases SET screening=screening||jsonb_strip_nulls(jsonb_build_object(
    'income_cents',p_screening.monthly_income_cents,'assets_cents',p_screening.assets_cents,
    'life_insurance',p_screening.q_life_insurance,'burial',p_screening.q_burial_contract,'power_of_attorney',p_screening.q_power_of_attorney,
    'rule_reference',CASE WHEN p_screening.source='recheck' THEN 'Medicaid recheck ' ELSE 'Admission Medicaid questions ' END||answered_on)),
   revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by)
  VALUES(c.id,'admission_screening',jsonb_build_object('screening_id',p_screening.id,'case_id',c.id,'result',p_result,'source',p_screening.source,'requirements_marked',marked),c.revision,p_actor);
 END IF;
 RETURN jsonb_build_object('case_id',c.id,'recheck_id',recheck.id,'recheck_due_on',recheck.due_on,'requirements_marked',marked);
END $$;

-- "No change" schedules the next recheck from the confirmation date; "resident left" closes it.
CREATE OR REPLACE FUNCTION haven.benefits_recheck_complete_internal(p_recheck_id uuid,p_outcome text,p_note text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); x public.benefits_rechecks; nxt public.benefits_rechecks; today date:=(now() AT TIME ZONE 'America/New_York')::date; days integer; BEGIN
 IF p_request_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('no_change','resident_left') OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Choose no change or resident left' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-recheck:'||p_request_id,0));
 SELECT * INTO x FROM public.benefits_rechecks WHERE completion_request_id=p_request_id;
 IF FOUND THEN
  IF x.completed_by<>(a->>'id')::uuid OR x.id<>p_recheck_id OR x.outcome<>p_outcome THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  SELECT * INTO nxt FROM public.benefits_rechecks WHERE id=x.next_recheck_id;
  RETURN jsonb_build_object('recheck_id',x.id,'outcome',x.outcome,'next_recheck_id',nxt.id,'next_due_on',nxt.due_on);
 END IF;
 SELECT * INTO x FROM public.benefits_rechecks WHERE id=p_recheck_id FOR UPDATE;
 IF x.id IS NULL OR x.organization_id IS DISTINCT FROM (a->>'org')::uuid THEN RAISE EXCEPTION 'Recheck unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.benefits_lock_authority(x.facility_id);
 IF NOT haven.benefits_permission(x.facility_id,'write') THEN RAISE EXCEPTION 'Recheck unavailable' USING ERRCODE='42501'; END IF;
 IF x.status<>'open' THEN RAISE EXCEPTION 'This recheck is already complete' USING ERRCODE='22023'; END IF;
 IF p_outcome='no_change' THEN
  IF NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=x.resident_id AND r.facility_id=x.facility_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'Resident is no longer at this facility' USING ERRCODE='22023'; END IF;
  days:=(haven.benefits_rule(x.organization_id,'screening.recheck_days',today))::text::integer;
  UPDATE public.benefits_rechecks SET status='done',outcome='no_change',completed_by=(a->>'id')::uuid,completed_at=now(),completion_request_id=p_request_id,note=nullif(btrim(p_note),''),updated_at=now() WHERE id=x.id;
  INSERT INTO public.benefits_rechecks(organization_id,facility_id,resident_id,screening_id,due_on)
  VALUES(x.organization_id,x.facility_id,x.resident_id,x.screening_id,today+days) RETURNING * INTO nxt;
  UPDATE public.benefits_rechecks SET next_recheck_id=nxt.id WHERE id=x.id;
 ELSE
  UPDATE public.benefits_rechecks SET status='closed',outcome='resident_left',completed_by=(a->>'id')::uuid,completed_at=now(),completion_request_id=p_request_id,note=nullif(btrim(p_note),''),updated_at=now() WHERE id=x.id;
 END IF;
 RETURN jsonb_build_object('recheck_id',x.id,'outcome',p_outcome,'next_recheck_id',nxt.id,'next_due_on',nxt.due_on);
END $$;

-- Open rechecks the actor may work, soonest first, with the last answers that caused them.
CREATE OR REPLACE FUNCTION haven.benefits_recheck_list_internal(p_facility_id uuid,p_due_within_days integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); today date:=(now() AT TIME ZONE 'America/New_York')::date; BEGIN
 IF p_due_within_days IS NULL OR p_due_within_days NOT BETWEEN 0 AND 400 THEN RAISE EXCEPTION 'Invalid window' USING ERRCODE='22023'; END IF;
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('as_of',today,'rechecks',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.due_on,q.id) FROM (
  SELECT x.id,x.facility_id,f.name facility_name,x.resident_id,r.first_name||' '||r.last_name resident_name,x.due_on,(x.due_on<today) overdue,
   haven.benefits_permission(x.facility_id,'write') can_write,
   s.answered_at last_answered_at,s.result last_result,s.reasons last_reasons,
   s.q_property_non_primary,s.q_income_over_limit,s.q_assets
  FROM public.benefits_rechecks x JOIN public.residents r ON r.id=x.resident_id AND r.deleted_at IS NULL
  JOIN public.facilities f ON f.id=x.facility_id JOIN public.benefits_admission_screenings s ON s.id=x.screening_id
  WHERE x.organization_id=(a->>'org')::uuid AND x.status='open' AND x.due_on<=today+p_due_within_days
   AND haven.benefits_permission(x.facility_id,'read') AND (p_facility_id IS NULL OR x.facility_id=p_facility_id)
  ORDER BY x.due_on,x.id LIMIT 200) q),'[]'));
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_screening_apply','benefits_recheck_complete_internal','benefits_recheck_list_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.benefits_recheck_complete(p_recheck_id uuid,p_outcome text,p_note text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_recheck_complete_internal(p_recheck_id,p_outcome,p_note,p_request_id); $$;
CREATE FUNCTION public.benefits_recheck_list(p_facility_id uuid DEFAULT NULL,p_due_within_days integer DEFAULT 14) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_recheck_list_internal(p_facility_id,p_due_within_days); $$;
REVOKE ALL ON FUNCTION public.benefits_recheck_complete(uuid,text,text,uuid),public.benefits_recheck_list(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_recheck_complete(uuid,text,text,uuid),haven.benefits_recheck_complete_internal(uuid,text,text,uuid),
 public.benefits_recheck_list(uuid,integer),haven.benefits_recheck_list_internal(uuid,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
