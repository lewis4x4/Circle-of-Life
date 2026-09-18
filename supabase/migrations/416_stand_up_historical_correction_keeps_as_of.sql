-- COL-395: "A historical correction erases the report's recorded as-of time."
--
-- haven.stand_up_save computed the observation time as clock_timestamp() for the
-- open reporting period, the payload's as_of when one was sent, and NULL
-- otherwise -- then wrote that NULL over stand_up_reports.source_as_of. The form
-- never sends as_of, so an owner correcting a past week discarded the time the
-- figures were actually observed. The earlier revision kept its own
-- source_as_of, but the report row -- what the workspace RPC returns and what the
-- form and the Front Office feed read -- then said "As-of time not recorded"
-- about figures whose time had been recorded.
--
-- A save that says nothing about as_of now keeps the observation time already on
-- the report, and the new revision records the same value, so revision history
-- and the report still agree.
--
-- Deliberately narrow. The inheritance applies only when the payload has no
-- as_of key at all and there is no batch:
--
--   * An explicit as_of still wins, including an explicit null. Reversal
--     (reverse_import) and outage recovery (commit_recovery) both build their
--     payload with jsonb_build_object('as_of',<prior revision's source_as_of>),
--     so the key is always present and a restored null still means "the state
--     being restored had no recorded time". Those paths are byte-identical.
--   * Imports (p_batch IS NOT NULL) are unchanged. An import carries figures
--     from another source; inheriting a manual entry's observation time would
--     attach one source's time to another source's figures. An import that
--     knows its observation time sends it on the row.
--   * The open reporting period is unchanged: asof is clock_timestamp() there,
--     so the coalesce is a no-op.
--   * The future-time refusal is unchanged -- it is checked on the explicit
--     value, and a value already stored is by definition not in the future.
--
-- Everything else in this function is exactly migration 406's text.
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
 -- COL-395: a save that says nothing about as_of keeps the observation time the
 -- report already carries instead of erasing it. On the open period asof is
 -- already clock_timestamp() and on a new report there is nothing to inherit,
 -- so this only reaches the historical correction the finding names.
 IF NOT (p ? 'as_of') AND p_batch IS NULL THEN asof:=coalesce(asof,r.source_as_of); END IF;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of) VALUES(r.id,r.version+1,p->'values',s,a,p->>'reason',coalesce(p->'provenance','{}'),p_batch,asof) RETURNING id INTO v_id;
 PERFORM haven.stand_up_roster_confirm(p,o,f,a,r.id,v_id);
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

COMMENT ON FUNCTION haven.stand_up_save(jsonb,uuid) IS 'COL-395: a save with no as_of in its payload keeps the observation time already recorded on the report, so a historical correction no longer erases it; the new revision records the same value. An explicit as_of still wins, including an explicit null, which is how reversal and outage recovery restore a prior state. Imports are unchanged. COL-298: a stand_up_reports row still exists only once a save carries at least one figure.';

NOTIFY pgrst, 'reload schema';
COMMIT;
-- Rollback: restore the 406 definition of haven.stand_up_save. No data or column
-- changes to undo. Reports whose source_as_of was erased before this migration
-- stay erased -- the value is still on their revisions, and rewriting report rows
-- from history is a separate, reasoned correction, not a schema rollback.
