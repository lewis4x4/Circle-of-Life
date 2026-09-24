-- COL-797: "Once a facility submits Stand Up for a staffing week, nobody but an
-- owner can change it. The administrator who submitted needed to fix a figure
-- after the call and was locked out."
--
-- While a meeting is the open reporting period, the administrator can already
-- edit a submitted report: the next save stores a draft and the report reads
-- "Changes awaiting resubmission". Once the period moves on, stand_up_save
-- treats every change as a historical correction and calls
-- stand_up_assert(f,true), which admits owner and org_admin only. A
-- facility_admin who submitted the week cannot correct it, and nothing records
-- field by field what changed after a submission; the revision snapshots hold
-- whole value sets and have to be diffed by the reader.
--
-- What changes:
--
--   * public.stand_up_post_submit_changes: one immutable row per changed field
--     (and one for a status change) on every revision written after the report
--     was first submitted. Actor id, actor name and role as recorded then, UTC
--     timestamp, before and after value, and the revision's reason. Written by an
--     AFTER INSERT trigger on stand_up_revisions, so every write path is covered
--     (entry, historical correction, outage recovery, import reversal, the
--     workbook connector) rather than only the one the editor uses. RLS: Stand Up
--     administrators (owner, org_admin, facility_admin) in the organization with
--     access to the facility may read; nobody may write, update or delete.
--
--   * haven.stand_up_can_edit_submitted(facility, week): true when the week has
--     a submission and the caller is its last submitter or an owner, org_admin
--     or facility_admin. stand_up_save uses it so a submitted past week can be
--     corrected, with the written reason historical corrections already require,
--     by those people instead of owner and org_admin only. The facility check in
--     stand_up_assert still applies to everyone. A past week that was never
--     submitted, and every import, stays owner and org_admin only, as before.
--     `manager` does not hold Stand Up today and is not added here.
--
--   * stand_up_command gains 'post_submit_changes' (the field history for one
--     report, same authority as reading it), reports and save receipts carry
--     'last_submitted_by', and the workspace carries 'can_edit_submitted'.
--
-- The body of stand_up_save is migration 457's text with the two
-- stand_up_assert calls changed; stand_up_command is migration 440's text with
-- the additions above.
BEGIN;

CREATE TABLE public.stand_up_post_submit_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 report_id uuid NOT NULL REFERENCES public.stand_up_reports(id),
 week_start date NOT NULL,
 revision_id uuid NOT NULL REFERENCES public.stand_up_revisions(id),
 version integer NOT NULL,
 field_key text NOT NULL,
 before_value jsonb,
 after_value jsonb,
 actor_id uuid NOT NULL,
 actor_name text,
 actor_role text,
 reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(revision_id,field_key)
);
CREATE INDEX idx_stand_up_post_submit_changes_report_id ON public.stand_up_post_submit_changes(report_id,version);
CREATE INDEX idx_stand_up_post_submit_changes_facility_id_week_start ON public.stand_up_post_submit_changes(facility_id,week_start);

ALTER TABLE public.stand_up_post_submit_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_post_submit_changes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.stand_up_post_submit_changes TO authenticated;
CREATE POLICY "Stand Up administrators see post-submit changes in accessible facilities"
 ON public.stand_up_post_submit_changes FOR SELECT TO authenticated
 USING (organization_id = (SELECT haven.organization_id())
  AND (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin')
  AND facility_id IN (SELECT haven.accessible_facility_ids()));
CREATE TRIGGER stand_up_post_submit_change_immutable BEFORE UPDATE OR DELETE ON public.stand_up_post_submit_changes
 FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();

COMMENT ON TABLE public.stand_up_post_submit_changes IS 'COL-797: immutable field-level audit of every Stand Up change written after the report was first submitted. One row per changed figure (field_key is the metric key) and one for a status change (field_key = status). Written only by the stand_up_revisions trigger.';

-- ---------------------------------------------------------------------------
-- Field-level audit, written beside every revision after a submission.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_record_post_submit_changes() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE prev public.stand_up_revisions%ROWTYPE; rep public.stand_up_reports%ROWTYPE; who text; role text;
BEGIN
 SELECT * INTO prev FROM public.stand_up_revisions WHERE report_id=NEW.report_id AND version=NEW.version-1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Only what changes after a submission; drafting before the first one is ordinary entry.
 IF NOT EXISTS(SELECT 1 FROM public.stand_up_revisions s WHERE s.report_id=NEW.report_id AND s.version<NEW.version AND s.status='ready') THEN RETURN NULL; END IF;
 SELECT * INTO rep FROM public.stand_up_reports WHERE id=NEW.report_id;
 SELECT p.full_name,p.app_role::text INTO who,role FROM public.user_profiles p WHERE p.id=NEW.actor_id AND p.organization_id=rep.organization_id;
 IF who IS NULL THEN SELECT c.display_name INTO who FROM haven.stand_up_connector_actors c WHERE c.actor_id=NEW.actor_id AND c.organization_id=rep.organization_id; END IF;
 INSERT INTO public.stand_up_post_submit_changes(organization_id,facility_id,report_id,week_start,revision_id,version,field_key,before_value,after_value,actor_id,actor_name,actor_role,reason,created_at)
 SELECT rep.organization_id,rep.facility_id,rep.id,rep.week_start,NEW.id,NEW.version,c.k,c.before_value,c.after_value,NEW.actor_id,who,role,NEW.reason,NEW.created_at
 FROM (
  SELECT k,coalesce(prev.values->k,'null'::jsonb) AS before_value,coalesce(NEW.values->k,'null'::jsonb) AS after_value FROM unnest(haven.stand_up_keys()) k
  UNION ALL SELECT 'status',to_jsonb(prev.status),to_jsonb(NEW.status)
 ) c WHERE c.before_value IS DISTINCT FROM c.after_value;
 RETURN NULL;
END $$;

CREATE TRIGGER stand_up_record_post_submit_changes
 AFTER INSERT ON public.stand_up_revisions
 FOR EACH ROW EXECUTE FUNCTION haven.stand_up_record_post_submit_changes();

COMMENT ON FUNCTION haven.stand_up_record_post_submit_changes() IS 'COL-797: after a Stand Up report has a submitted revision, each later revision writes one stand_up_post_submit_changes row per figure (and status) that differs from the revision before it, with actor, time, before and after value and reason.';

-- ---------------------------------------------------------------------------
-- Who may change a week after it was submitted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_can_edit_submitted(p_facility uuid,p_week date) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; r text; submitter uuid;
BEGIN
 SELECT actor_user_id,actor_app_role::text INTO a,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL THEN RETURN false; END IF;
 SELECT s.actor_id INTO submitter FROM public.stand_up_revisions s JOIN public.stand_up_reports rp ON rp.id=s.report_id
  WHERE rp.facility_id=p_facility AND rp.week_start=p_week AND s.status='ready' ORDER BY s.version DESC LIMIT 1;
 IF submitter IS NULL THEN RETURN false; END IF;
 RETURN a=submitter OR r IN('owner','org_admin','facility_admin');
END $$;

COMMENT ON FUNCTION haven.stand_up_can_edit_submitted(uuid,date) IS 'COL-797: the week has a submitted revision and the caller is its last submitter or an owner, org_admin or facility_admin. Facility access is still checked by stand_up_assert.';

-- ---------------------------------------------------------------------------
-- stand_up_save: migration 457's body; the two stand_up_assert calls admit the
-- submitter and facility administrators to a submitted past week.
-- ---------------------------------------------------------------------------
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
  -- COL-797: a submitted past week may be corrected by its submitter or a
  -- facility administrator; anything else historical stays owner-only.
  PERFORM haven.stand_up_assert(f,p_batch IS NOT NULL OR NOT haven.stand_up_can_edit_submitted(f,w));
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
 PERFORM haven.stand_up_assert(f,p_batch IS NOT NULL OR (w<>open_week AND NOT haven.stand_up_can_edit_submitted(f,w)));
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

COMMENT ON FUNCTION haven.stand_up_save(jsonb,uuid) IS 'COL-797: a submitted past week may be corrected, with a reason, by its last submitter or an owner, org_admin or facility_admin; a never-submitted past week and every import stay owner and org_admin only. Every revision after a submission is audited field by field in stand_up_post_submit_changes. COL-553: on the open reporting period the census and hospital figures are always compared with the resident roster, whether or not the payload carries a roster block; a differing figure needs a reason. Historical corrections and imports record no confirmation, as before. COL-395: a save with no as_of in its payload keeps the observation time already recorded on the report. COL-298: a stand_up_reports row still exists only once a save carries at least one figure.';

-- ---------------------------------------------------------------------------
-- The field history for one report.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_post_submit_history(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; w date;
BEGIN
 f:=(p_payload->>'facility_id')::uuid; w:=(p_payload->>'week_start')::date;
 IF f IS NULL OR w IS NULL THEN RAISE EXCEPTION 'Facility and week required'; END IF;
 -- The same authority as reading the report: owner, org_admin or facility_admin with access to this facility.
 PERFORM haven.stand_up_assert(f);
 RETURN jsonb_build_object('facility_id',f,'week_start',w,'changes',coalesce((
  SELECT jsonb_agg(jsonb_build_object('id',c.id,'version',c.version,'revision_id',c.revision_id,'field_key',c.field_key,
    'before_value',c.before_value,'after_value',c.after_value,'actor_id',c.actor_id,'actor_name',c.actor_name,'actor_role',c.actor_role,
    'reason',c.reason,'created_at',c.created_at) ORDER BY c.version,c.field_key)
  FROM public.stand_up_post_submit_changes c WHERE c.facility_id=f AND c.week_start=w),'[]'::jsonb));
END $$;

-- The last submitter, beside the metadata the report already carries.
CREATE FUNCTION haven.stand_up_submission_metadata(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT m||jsonb_build_object('last_submitted_by',(SELECT s.actor_id FROM public.stand_up_revisions s WHERE s.id=(m->>'last_submitted_revision_id')::uuid))
 FROM (SELECT coalesce(haven.stand_up_revision_metadata(p_revision),'{}'::jsonb) AS m) x
$$;

-- Migration 440's wrapper, with the additions named at the top.
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb; organization uuid;
BEGIN
 IF p_action='set_entry_window' THEN RETURN haven.stand_up_set_entry_window(p_payload); END IF;
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 IF p_action='post_submit_changes' THEN RETURN haven.stand_up_post_submit_history(p_payload); END IF;
 IF p_action='roster' THEN RETURN haven.stand_up_roster_suggestion(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  organization:=haven.organization_id();
  SELECT coalesce(jsonb_agg(x||haven.stand_up_submission_metadata((x->>'revision_id')::uuid) ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  SELECT coalesce(jsonb_agg(y||jsonb_build_object(
    'entry_open_lead_minutes',(SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s WHERE s.facility_id=(y->>'id')::uuid),
    'open_week',haven.stand_up_open_week((y->>'id')::uuid),
    'entry_opens_at',haven.stand_up_entry_opens_at((y->>'id')::uuid,haven.stand_up_open_week((y->>'id')::uuid))
   ) ORDER BY y->>'name'),'[]') INTO facilities FROM jsonb_array_elements(result->'facilities') y;
  RETURN result||jsonb_build_object(
   'reports',reports,
   'facilities',facilities,
   'server_now',clock_timestamp(),
   'actor_role',haven.app_role()::text,
   'can_edit_submitted',haven.app_role()::text IN('owner','org_admin','facility_admin'),
   'google_connection',haven.stand_up_google_health(organization)
  );
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||haven.stand_up_submission_metadata((result->>'revision_id')::uuid);
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_record_post_submit_changes(),haven.stand_up_can_edit_submitted(uuid,date),
 haven.stand_up_post_submit_history(jsonb),haven.stand_up_submission_metadata(uuid) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 457's haven.stand_up_save and migration 440's
-- haven.stand_up_command, DROP TRIGGER stand_up_record_post_submit_changes ON
-- public.stand_up_revisions, then drop the four functions above and
-- public.stand_up_post_submit_changes. The audit rows are evidence; export them first.
