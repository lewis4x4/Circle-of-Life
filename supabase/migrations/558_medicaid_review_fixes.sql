-- Created with supabase migration new; repository claim 558. Review fixes for Medicaid Amendment A (#919).
-- 1. The Facility Executive override on admission_cases (528) is enforced in the database: a guard sets
--    medicaid_gate_override_at itself, and only an owner, org admin or facility administrator of that facility
--    may set or clear it, recording themselves (a signed-in writer can only name themselves). The update
--    policy lets med_techs write the row, so this was forgeable from the API before.
-- 2. The gate applies to an expected Medicaid payer even when today's coverage is private pay (spend-down).
-- 3. An override counts only while the person who recorded it still holds Facility Executive authority.
-- 4. Reopening an expiring document sends a verified signature back to pending for the new copy (530).
-- 5. The Medicaid Log importer (527) skips a bad date instead of aborting the row, and a re-run that adds
--    nothing no longer bumps the case revision or writes history.
BEGIN;

CREATE OR REPLACE FUNCTION haven.guard_medicaid_gate_override() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claim_role text; signed_in uuid; BEGIN
 IF TG_OP='UPDATE' AND NEW.medicaid_gate_override_reason IS NOT DISTINCT FROM OLD.medicaid_gate_override_reason
  AND NEW.medicaid_gate_override_by IS NOT DISTINCT FROM OLD.medicaid_gate_override_by
  AND NEW.medicaid_gate_override_at IS NOT DISTINCT FROM OLD.medicaid_gate_override_at THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.medicaid_gate_override_reason IS NULL AND NEW.medicaid_gate_override_by IS NULL AND NEW.medicaid_gate_override_at IS NULL THEN RETURN NEW; END IF;
 claim_role:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','');
 IF claim_role='authenticated' THEN
  signed_in:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid;
  IF signed_in IS NULL OR haven.admission_actor_role(signed_in,NEW.facility_id,ARRAY['owner','org_admin','facility_admin']) IS NULL THEN
   RAISE EXCEPTION 'Only a Facility Executive can record or clear the Medicaid review override' USING ERRCODE='42501';
  END IF;
  IF NEW.medicaid_gate_override_reason IS NOT NULL AND NEW.medicaid_gate_override_by IS DISTINCT FROM signed_in THEN
   RAISE EXCEPTION 'An override records the person making it' USING ERRCODE='42501';
  END IF;
 ELSIF claim_role IN ('anon') THEN
  RAISE EXCEPTION 'Override unavailable' USING ERRCODE='42501';
 END IF;
 IF NEW.medicaid_gate_override_reason IS NOT NULL THEN
  IF haven.admission_actor_role(NEW.medicaid_gate_override_by,NEW.facility_id,ARRAY['owner','org_admin','facility_admin']) IS NULL THEN
   RAISE EXCEPTION 'The override must be recorded by an owner, org admin or facility administrator of this facility' USING ERRCODE='42501';
  END IF;
  NEW.medicaid_gate_override_at:=clock_timestamp();
 ELSE
  NEW.medicaid_gate_override_by:=NULL; NEW.medicaid_gate_override_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_medicaid_gate_override() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS tr_admission_cases_medicaid_gate_override ON public.admission_cases;
CREATE TRIGGER tr_admission_cases_medicaid_gate_override BEFORE INSERT OR UPDATE ON public.admission_cases
 FOR EACH ROW EXECUTE FUNCTION haven.guard_medicaid_gate_override();

CREATE OR REPLACE FUNCTION haven.benefits_move_in_gate_internal(p_admission_case_id uuid,p_anticipated_payer_source text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ac public.admission_cases; s record; result text; applies boolean; overridden boolean; BEGIN
 SELECT * INTO ac FROM public.admission_cases WHERE id=p_admission_case_id AND deleted_at IS NULL;
 IF ac.id IS NULL THEN RAISE EXCEPTION 'Admission unavailable' USING ERRCODE='22023'; END IF;
 SELECT x.coverage,coalesce((SELECT o.result FROM public.benefits_screening_overrides o WHERE o.screening_id=x.id ORDER BY o.created_at DESC LIMIT 1),x.result) result INTO s
 FROM public.benefits_admission_screenings x WHERE x.resident_id=ac.resident_id ORDER BY x.answered_at DESC,x.created_at DESC LIMIT 1;
 result:=s.result;
 -- Review finding: an expected Medicaid payer is gated even when today's coverage is private pay (spend-down).
 applies:=coalesce(s.coverage,'')<>'smmc_ltc_enrolled'
  AND (coalesce(p_anticipated_payer_source='medicaid_pending',false) OR coalesce(s.coverage IN ('medicaid_mma','application_pending'),false));
 -- An override counts only while the person who recorded it still holds Facility Executive authority there.
 overridden:=ac.medicaid_gate_override_reason IS NOT NULL
  AND haven.admission_actor_role(ac.medicaid_gate_override_by,ac.facility_id,ARRAY['owner','org_admin','facility_admin']) IS NOT NULL;
 RETURN jsonb_build_object('applies',applies,'result',result,'overridden',overridden,
  'satisfied',NOT applies OR coalesce(result='candidate',false) OR overridden,
  'reason',CASE WHEN NOT applies THEN NULL WHEN result IS NULL THEN 'Medicaid preliminary review (the Medicaid questions have not been answered)'
   WHEN result='not_qualified_now' THEN 'Medicaid preliminary review (answers show: does not qualify now)'
   WHEN result='needs_answers' THEN 'Medicaid preliminary review (answers are incomplete)' ELSE NULL END);
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
 -- A new copy needs its own signature check: a verified signature goes back to pending (review finding).
 UPDATE public.benefits_requirements SET status='requested',reviewed_by=NULL,reviewed_at=NULL,
  signature_status=CASE WHEN signature_status='verified' THEN 'pending' ELSE signature_status END,signed_on=NULL,
  notes=left('The accepted copy '||CASE WHEN fr->>'freshness'='expired' THEN 'expired' ELSE 'expires' END||' on '||(fr->>'expires_on')||' (good for '||(fr->>'valid_days')||' days). Facility administrator to gather a current copy.'||coalesce(' '||notes,''),4000),updated_at=now()
 WHERE id=r.id;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING revision INTO c.revision;
 result:=jsonb_build_object('case_id',c.id,'revision',c.revision,'requirement_id',r.id);
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'freshness_reopen',jsonb_build_object('requirement_id',r.id,'previous_document_id',r.document_id)||fr,c.revision,(a->>'id')::uuid);
 INSERT INTO public.benefits_requests(request_id,actor_id,case_id,action,payload,result) VALUES(p_request_id,(a->>'id')::uuid,c.id,'freshness_reopen',stored,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_log_import_row_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.residents; actor uuid:=(p_payload->>'actor_id')::uuid; c public.benefits_cases; key text:=p_payload->>'import_key'; st record; on_date date;
 checklist jsonb; added integer:=0; contact_id uuid; score integer; created boolean:=false; changed boolean:=false; BEGIN
 PERFORM haven.benefits_keys(p_payload,ARRAY['import_key','organization_id','resident_id','actor_id','steps','score','reapply_on','caseworker_name','caseworker_phone','notes','plan','monthly_cents','coverage_start','decision']);
 IF length(coalesce(key,'')) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Import key required' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.residents WHERE id=(p_payload->>'resident_id')::uuid AND organization_id=(p_payload->>'organization_id')::uuid AND deleted_at IS NULL;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=actor AND p.organization_id=r.organization_id AND p.is_active AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'Importer must be an active user of the organization' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-log-import:'||r.id,0));
 SELECT * INTO c FROM public.benefits_cases WHERE resident_id=r.id AND program='smmc_ltc' AND status<>'closed' FOR UPDATE;
 IF c.id IS NULL THEN
  INSERT INTO public.benefits_cases(organization_id,facility_id,resident_id,program,created_by,next_action)
  VALUES(r.organization_id,r.facility_id,r.id,'smmc_ltc',actor,'Imported from the Medicaid Log; confirm the next step on the board.') RETURNING * INTO c;
  checklist:=haven.benefits_rule(r.organization_id,'checklist.smmc_ltc',current_date);
  IF jsonb_typeof(checklist)='array' THEN
   INSERT INTO public.benefits_requirements(case_id,title,stage,status,signature_status,notes)
   SELECT c.id,t->>'title',t->>'stage','missing',coalesce(t->>'signature_status','not_required'),'Created by the Medicaid Log import; verify what is already on file.' FROM jsonb_array_elements(checklist) t;
  END IF;
  INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'log_import_case',jsonb_build_object('import_key',key),c.revision,actor);
  created:=true;
 END IF;
 -- Dated steps, each once per import key.
 FOR st IN SELECT b.*,(p_payload->'steps'->>b.step) raw FROM haven.benefits_board_steps() b WHERE p_payload->'steps' ? b.step AND b.step<>'score' LOOP
  -- A bad date skips that step instead of aborting the whole row (review finding).
  BEGIN on_date:=(st.raw)::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN on_date:=NULL; END;
  IF on_date IS NULL OR on_date>current_date+1 OR on_date<DATE '2015-01-01' THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND e.payload->>'import_key'=key AND e.payload->>'board_step'=st.step) THEN CONTINUE; END IF;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,jsonb_build_object('agency',st.agency,'event_type',st.event_type,
   'outcome',CASE WHEN st.step='dcf_decision' AND p_payload->>'decision' IN ('Approved','Denied') THEN p_payload->>'decision' ELSE st.outcome END,
   'occurred_on',on_date,'board_step',st.step,'formal_decision',false,'source','medicaid_log_import','import_key',key,'source_reference','Medicaid Log (Jessica Murphy)'),actor);
  added:=added+1;
 END LOOP;
 IF p_payload ? 'score' AND p_payload->>'score' ~ '^[1-5]$' AND NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND e.payload->>'import_key'=key AND e.payload->>'board_step'='score') THEN
  score:=(p_payload->>'score')::integer;
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,jsonb_build_object('agency','elder_options','event_type','screening','outcome','Score '||score,
   'occurred_on',coalesce((p_payload->'steps'->>'score')::date,(p_payload->'steps'->>'assessment_complete')::date,current_date),'board_step','score','formal_decision',false,
   'source','medicaid_log_import','import_key',key,'source_reference','Medicaid Log (Jessica Murphy)'),actor);
  UPDATE public.benefits_cases SET agency_score=score,reapply_on=CASE WHEN score<5 THEN (p_payload->>'reapply_on')::date END,status=CASE WHEN score<5 THEN 'waiting' ELSE status END WHERE id=c.id;
  added:=added+1;
 END IF;
 IF nullif(btrim(p_payload->>'caseworker_name'),'') IS NOT NULL THEN
  SELECT k.id INTO contact_id FROM public.benefits_contacts k WHERE k.organization_id=r.organization_id AND k.deleted_at IS NULL AND k.agency='dcf' AND lower(btrim(k.name))=lower(btrim(p_payload->>'caseworker_name')) LIMIT 1;
  IF contact_id IS NULL THEN
   INSERT INTO public.benefits_contacts(organization_id,name,agency,phone,notes,created_by) VALUES(r.organization_id,left(btrim(p_payload->>'caseworker_name'),200),'dcf',left(nullif(btrim(p_payload->>'caseworker_phone'),''),50),'From the Medicaid Log import',actor) RETURNING id INTO contact_id;
  END IF;
  UPDATE public.benefits_cases SET caseworker_contact_id=coalesce(caseworker_contact_id,contact_id) WHERE id=c.id AND caseworker_contact_id IS NULL;
  IF FOUND THEN changed:=true; END IF;
 END IF;
 IF nullif(btrim(p_payload->>'notes'),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND e.payload->>'import_key'=key AND e.payload->>'event_type'='note') THEN
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,jsonb_build_object('agency','other','event_type','note','outcome','Medicaid Log notes','occurred_on',current_date,
   'notes',left(p_payload->>'notes',4000),'formal_decision',false,'source','medicaid_log_import','import_key',key,'source_reference','Medicaid Log (Jessica Murphy)'),actor);
  added:=added+1;
 END IF;
 -- Funded residents (Completed tab): plan, rate and start as unverified funding facts; review stays a person's job.
 IF nullif(btrim(p_payload->>'plan'),'') IS NOT NULL AND coalesce(c.funding->>'status','')<>'reviewed' THEN
  UPDATE public.benefits_cases SET funding=funding||jsonb_strip_nulls(jsonb_build_object('plan',left(btrim(p_payload->>'plan'),200),'coverage_start',p_payload->>'coverage_start',
   'expected_benefit_cents',CASE WHEN p_payload->>'monthly_cents' ~ '^[0-9]+$' THEN (p_payload->>'monthly_cents')::bigint END,'status','unverified','notes','From the Medicaid Log import; verify against the plan authorization.')) WHERE id=c.id
   AND funding IS DISTINCT FROM funding||jsonb_strip_nulls(jsonb_build_object('plan',left(btrim(p_payload->>'plan'),200),'coverage_start',p_payload->>'coverage_start',
   'expected_benefit_cents',CASE WHEN p_payload->>'monthly_cents' ~ '^[0-9]+$' THEN (p_payload->>'monthly_cents')::bigint END,'status','unverified','notes','From the Medicaid Log import; verify against the plan authorization.'));
  IF FOUND THEN changed:=true; END IF;
 END IF;
 -- Re-running a row that adds nothing leaves the case (and any edit in progress) untouched (review finding).
 IF created OR changed OR added>0 THEN
  UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'log_import_row',jsonb_build_object('import_key',key,'records_added',added),c.revision,actor);
 END IF;
 RETURN jsonb_build_object('case_id',c.id,'records_added',added);
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
