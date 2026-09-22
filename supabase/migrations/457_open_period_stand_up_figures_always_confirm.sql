-- COL-553: "A direct-database write put census 35 in Homewood's open draft; the
-- roster check only runs when the browser asks for it."
--
-- Migration 404 (COL-351) compares the open period's census and hospital
-- figures with the resident roster and refuses a differing figure that has no
-- reason. Two things let a figure through unconfirmed:
--
--   1. haven.stand_up_roster_confirm begins `IF roster IS NULL THEN RETURN`, and
--      stand_up_save hands it the payload as sent. The comparison therefore ran
--      only when the client included a `roster` block. The editor always sends
--      one, but a script, another client, or an editor whose roster read failed
--      (which it tolerates) saved an open-period figure with no confirmation
--      row and no reason.
--   2. Nothing looked at stand_up_revisions after the fact. A privileged write
--      around stand_up_save (Homewood, 2026-09-21 09:03 ET, census 35 from a
--      workbook recovery script, no receipt, no confirmation) was indistinguishable
--      from a properly saved one.
--
-- What changes:
--
--   * stand_up_save, on the open reporting period with no batch, always runs the
--     comparison: a payload with no `roster` block is treated as one carrying no
--     reasons. The suggestion was already recomputed server-side; only the reasons
--     were ever the client's to supply. A differing figure with no reason raises
--     the same 22023 message as before, which the editor already answers by
--     re-reading the roster and showing the reason control. A facility with no
--     roster in Haven still records entered_no_roster. Historical corrections and
--     imports are unchanged: they still may not carry a roster block, and they
--     still record nothing (a past meeting keeps the confirmation recorded at the
--     time). Everything else in the body is migration 416's text.
--
--     Decided here: outage recovery (commit_recovery) and import reversal
--     (reverse_import) for the open period go through the same rule. Neither
--     builds a roster block, so a restored figure that differs from today's
--     roster is refused with the same message until a reason is supplied or the
--     roster is corrected. The recovery dialog shows the message; giving it a
--     reason control is COL-555.
--
--   * A deferred constraint trigger on stand_up_revisions: an open-period
--     revision with no batch that carries a census or hospital figure must have
--     its stand_up_roster_confirmations rows by the end of the transaction.
--     stand_up_save writes them in the same transaction and passes; a write
--     around it fails at commit instead of leaving a silent divergence.
--
-- Data Health (public.facility_data_health) already returns roster_census and
-- stand_up_census side by side; it is unchanged here.
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
 -- COL-553: on the open reporting period the comparison is not the client's to
 -- request. A payload with no roster block is one that carries no reasons; the
 -- server recomputes the suggestion and decides the source either way. The
 -- receipt below still stores the payload exactly as it was sent.
 PERFORM haven.stand_up_roster_confirm(CASE WHEN w=open_week AND p_batch IS NULL THEN p||jsonb_build_object('roster',coalesce(p->'roster','{}'::jsonb)) ELSE p END,o,f,a,r.id,v_id);
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

COMMENT ON FUNCTION haven.stand_up_save(jsonb,uuid) IS 'COL-553: on the open reporting period the census and hospital figures are always compared with the resident roster, whether or not the payload carries a roster block; a differing figure needs a reason. Historical corrections and imports record no confirmation, as before. COL-395: a save with no as_of in its payload keeps the observation time already recorded on the report. COL-298: a stand_up_reports row still exists only once a save carries at least one figure.';

-- ---------------------------------------------------------------------------
-- The guard behind the guard: an open-period revision that carries a roster
-- figure must have its confirmation rows by commit, whoever wrote it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_revision_confirmed() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; w date; k text;
BEGIN
 -- Imports carry figures from another source and are exempt, as in stand_up_save.
 IF NEW.batch_id IS NOT NULL THEN RETURN NULL; END IF;
 SELECT r.facility_id,r.week_start INTO f,w FROM public.stand_up_reports r WHERE r.id=NEW.report_id;
 -- A past meeting keeps the confirmation recorded at the time; only the open period is checked.
 IF f IS NULL OR w IS DISTINCT FROM haven.stand_up_open_week(f) THEN RETURN NULL; END IF;
 FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
  IF NEW.values->k IS NOT NULL AND NEW.values->k<>'null'::jsonb
   AND NOT EXISTS(SELECT 1 FROM public.stand_up_roster_confirmations c WHERE c.revision_id=NEW.id AND c.field_key=k) THEN
   RAISE EXCEPTION 'Open-period Stand Up figure % has no roster confirmation. Write it through stand_up_command(''save'') so it is compared with the resident roster.',k
    USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_revision_confirmed() FROM PUBLIC,anon,authenticated,service_role;

CREATE CONSTRAINT TRIGGER stand_up_revision_confirmed
 AFTER INSERT ON public.stand_up_revisions
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION haven.stand_up_revision_confirmed();

COMMENT ON FUNCTION haven.stand_up_revision_confirmed() IS 'COL-553: deferred constraint trigger on stand_up_revisions. An open-period revision with no batch that carries a census or hospital figure must have a stand_up_roster_confirmations row for that figure by the end of the transaction. stand_up_save writes the rows itself; a write around it is refused at commit.';

NOTIFY pgrst, 'reload schema';
COMMIT;
