-- COL-298 / NAV-008: "Standup draft creation can reserve the whole week with
-- missing or partial metrics."
--
-- haven.stand_up_save inserted a stand_up_reports row on the first save for a
-- facility and Monday whatever it carried, including sixteen nulls. That row
-- took UNIQUE(facility_id, week_start), carried a source_as_of stamp implying
-- figures had been recorded, and read as a Draft. A week could be reserved by
-- an administrator who entered nothing.
--
-- A row is now created only by a save that carries at least one figure. A save
-- with nothing in it returns a not-started receipt: the request is still
-- recorded, so a retry of the same idempotency key is answered identically, and
-- no report, no revision and no reservation exist. Imports and reversals
-- (p_batch, or an existing report) are unchanged, because they are explicit,
-- reasoned and reversible operations on a week that is already real, and the
-- rule is scoped to the open reporting period for the same reason.
--
-- Everything else in this function is exactly migration 405's text: the locks,
-- the CAS on version, the receipt contract, the immutable revisions, the COL-351
-- roster confirmation and the entry window.
BEGIN;

CREATE OR REPLACE FUNCTION haven.stand_up_save(p jsonb,p_batch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid:=(p->>'facility_id')::uuid; w date:=(p->>'week_start')::date; o uuid; a uuid; r public.stand_up_reports%ROWTYPE; v_id uuid; result jsonb; request uuid:=(p->>'request_id')::uuid; receipt public.stand_up_receipts%ROWTYPE; asof timestamptz; s text:=coalesce(p->>'status','draft'); open_week date;
BEGIN
 IF f IS NULL OR w IS NULL OR request IS NULL OR p->>'expected_version' IS NULL THEN RAISE EXCEPTION 'Facility, week, request and expected version required'; END IF;
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 -- Serialize organization revisions so source sequence follows commit order.
 PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_org:'||o::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text||request::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(f::text||w::text,0));
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 SELECT * INTO receipt FROM public.stand_up_receipts WHERE actor_id=a AND request_id=request;
 IF FOUND THEN IF receipt.payload IS DISTINCT FROM p THEN RAISE EXCEPTION 'Idempotency key payload differs'; END IF; RETURN receipt.result; END IF;
 IF extract(isodow FROM w)<>1 THEN RAISE EXCEPTION 'Week must be Monday'; END IF;
 -- One reading of the window for the whole save, taken from server time.
 open_week:=haven.stand_up_open_week(f);
 IF w>open_week THEN
  RAISE EXCEPTION 'This report opens %', to_char(haven.stand_up_entry_opens_at(f,w) AT TIME ZONE 'America/New_York','FMDay, FMMonth FMDD "at" FMHH12:MI AM')||' Eastern'
   USING ERRCODE='P0409', HINT='stand_up_entry_not_open';
 END IF;
 IF w<>open_week OR p_batch IS NOT NULL THEN
  PERFORM haven.stand_up_assert(f,true);
  IF nullif(btrim(p->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Historical change requires reason'; END IF;
  -- A past meeting keeps the confirmation recorded at the time; today's roster is not its evidence.
  IF p ? 'roster' THEN RAISE EXCEPTION 'Roster confirmation applies to the open reporting period only'; END IF;
 END IF;
 PERFORM haven.stand_up_validate(p->'values');
 asof:=CASE WHEN p ? 'as_of' THEN (p->>'as_of')::timestamptz WHEN w=open_week AND p_batch IS NULL THEN clock_timestamp() ELSE NULL END;
 IF asof>clock_timestamp() THEN RAISE EXCEPTION 'Source observation time cannot be future'; END IF;
 IF s NOT IN('draft','ready') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
 IF s='ready' AND ((clock_timestamp() AT TIME ZONE 'America/New_York')::date<w OR EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value='null'::jsonb)) THEN RAISE EXCEPTION 'Ready requires complete values and closed staffing week'; END IF;
 SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=f AND week_start=w FOR UPDATE;
 PERFORM haven.stand_up_assert(f,w<>open_week OR p_batch IS NOT NULL);
 IF coalesce(r.version,0)<>(p->>'expected_version')::integer THEN RAISE EXCEPTION 'Stale report version' USING ERRCODE='P0409'; END IF;
 -- COL-298 / NAV-008: nothing entered reserves nothing. The receipt is still
 -- written, so the same request_id keeps answering the same way. There is no
 -- revision, so there is nothing for a roster confirmation to attach to either.
 -- Scoped to the open reporting period, which is the entry path the finding
 -- names. A historical correction and an import are owner-only, carry a written
 -- reason and land in an immutable revision; they stay exactly as they were.
 IF r.id IS NULL AND p_batch IS NULL AND w=open_week AND NOT EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value<>'null'::jsonb) THEN
  result:=jsonb_build_object('id',NULL,'organization_id',o,'facility_id',f,'week_start',w,'version',0,'revision_id',NULL,
   'values',p->'values','status','draft','source_as_of',NULL,'updated_at',NULL,
   'overtime_minutes',NULL,'overtime_issue',false,'entry_origin','initialized','field_dispositions','{}'::jsonb,
   'roster_confirmations','{}'::jsonb,
   'updated_by',NULL,'updated_by_name',NULL,'first_submitted_at',NULL,'last_submitted_at',NULL,'last_submitted_revision_id',NULL,
   'not_started',true);
  INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
  RETURN result;
 END IF;
 IF r.id IS NULL THEN INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(o,f,w,p->'values',s) RETURNING * INTO r; END IF;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of) VALUES(r.id,r.version+1,p->'values',s,a,p->>'reason',coalesce(p->'provenance','{}'),p_batch,asof) RETURNING id INTO v_id;
 PERFORM haven.stand_up_roster_confirm(p,o,f,a,r.id,v_id);
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

COMMENT ON FUNCTION haven.stand_up_save(jsonb,uuid) IS 'COL-298: a stand_up_reports row exists only once a save carries at least one figure. A save with sixteen blanks on the open reporting period returns a receipt marked not_started and reserves no facility and Monday. Historical corrections, imports, reversals and any save against an existing report are unchanged.';

NOTIFY pgrst, 'reload schema';
COMMIT;
-- Rollback: restore the 405 definition of haven.stand_up_save. No data or
-- column changes to undo; rows created before this migration are unaffected and
-- an empty one simply reads Not started.
