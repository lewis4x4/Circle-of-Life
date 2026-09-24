-- Created with supabase migration new; repository claim 527. COL-773 (Medicaid Amendment A, build 8).
-- One-time import of Jessica's Medicaid Log into the benefits workflow, run only by the service-key importer
-- (scripts/benefits/import-medicaid-log.mjs) for rows a person has matched to a resident.
-- Each row opens (or reuses) the resident's long-term-care case and records the log's dated steps as board
-- events tagged source 'medicaid_log_import' with the log's own dates; score, reapply date, caseworker and
-- plan/start come across the same way. Re-running a row adds nothing (import key per row and step).
BEGIN;

CREATE OR REPLACE FUNCTION haven.benefits_log_import_row_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.residents; actor uuid:=(p_payload->>'actor_id')::uuid; c public.benefits_cases; key text:=p_payload->>'import_key'; st record; on_date date;
 checklist jsonb; added integer:=0; contact_id uuid; score integer; BEGIN
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
 END IF;
 -- Dated steps, each once per import key.
 FOR st IN SELECT b.*,(p_payload->'steps'->>b.step) raw FROM haven.benefits_board_steps() b WHERE p_payload->'steps' ? b.step AND b.step<>'score' LOOP
  on_date:=(st.raw)::date;
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
  UPDATE public.benefits_cases SET caseworker_contact_id=coalesce(caseworker_contact_id,contact_id) WHERE id=c.id;
 END IF;
 IF nullif(btrim(p_payload->>'notes'),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.benefits_events e WHERE e.case_id=c.id AND e.payload->>'import_key'=key AND e.payload->>'event_type'='note') THEN
  INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,jsonb_build_object('agency','other','event_type','note','outcome','Medicaid Log notes','occurred_on',current_date,
   'notes',left(p_payload->>'notes',4000),'formal_decision',false,'source','medicaid_log_import','import_key',key,'source_reference','Medicaid Log (Jessica Murphy)'),actor);
  added:=added+1;
 END IF;
 -- Funded residents (Completed tab): plan, rate and start as unverified funding facts; review stays a person's job.
 IF nullif(btrim(p_payload->>'plan'),'') IS NOT NULL AND coalesce(c.funding->>'status','')<>'reviewed' THEN
  UPDATE public.benefits_cases SET funding=funding||jsonb_strip_nulls(jsonb_build_object('plan',left(btrim(p_payload->>'plan'),200),'coverage_start',p_payload->>'coverage_start',
   'expected_benefit_cents',CASE WHEN p_payload->>'monthly_cents' ~ '^[0-9]+$' THEN (p_payload->>'monthly_cents')::bigint END,'status','unverified','notes','From the Medicaid Log import; verify against the plan authorization.')) WHERE id=c.id;
 END IF;
 UPDATE public.benefits_cases SET revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'log_import_row',jsonb_build_object('import_key',key,'records_added',added),c.revision,actor);
 RETURN jsonb_build_object('case_id',c.id,'records_added',added);
END $$;
REVOKE ALL ON FUNCTION haven.benefits_log_import_row_internal(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.benefits_log_import_row(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_log_import_row_internal(p_payload); $$;
REVOKE ALL ON FUNCTION public.benefits_log_import_row(jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Only the service-key importer; staff never call this.
GRANT EXECUTE ON FUNCTION public.benefits_log_import_row(jsonb),haven.benefits_log_import_row_internal(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
