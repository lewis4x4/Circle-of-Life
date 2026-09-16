-- COL-350: the Weekly Stand Up entry window becomes a per-facility setting with
-- one server enforcement point.
--
-- Homewood Lodge night and early shift staff could not open the upcoming Monday
-- report before Sunday 12:00 a.m. Eastern, because haven.stand_up_week() flipped
-- the open reporting period at that boundary and haven.stand_up_save() refused
-- any other week without an organization administrator and a written reason.
-- That boundary is now one integer per facility: minutes before the Monday
-- 8:45 a.m. Eastern deadline, null meaning the Haven default of 1,965 (Sunday
-- 12:00 a.m., the behaviour this migration preserves as the default).
--
-- The rule exists in exactly two places: src/lib/stand-up/model.ts for display
-- and public.stand_up_entry_opens_at here for enforcement. The deadline
-- (8:45 a.m.), the management call (9:15 a.m.), the Monday-to-Sunday staffing
-- period, the submission rule and corporate reminders do not move.
BEGIN;

-- ---------------------------------------------------------------------------
-- The setting
-- ---------------------------------------------------------------------------
CREATE TABLE public.stand_up_facility_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  -- Minutes before Monday 08:45 America/New_York. 60 is Monday 7:45 a.m.;
  -- 3405 is Saturday 12:00 a.m., which is as far back as the window may reach
  -- without touching the prior Monday's meeting. Null means the code default.
  entry_open_lead_minutes integer NULL
    CHECK (entry_open_lead_minutes IS NULL OR entry_open_lead_minutes BETWEEN 60 AND 3405),
  updated_by uuid NULL REFERENCES public.user_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, facility_id)
);
ALTER TABLE public.stand_up_facility_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stand Up roles read the entry window for accessible facilities"
  ON public.stand_up_facility_settings FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin')
  );
-- Writing the window is an organization decision. A facility administrator
-- enters figures; they do not move their own deadline.
CREATE POLICY "Organization administrators set the entry window"
  ON public.stand_up_facility_settings FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin')
  );
CREATE POLICY "Organization administrators change the entry window"
  ON public.stand_up_facility_settings FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin')
  );

REVOKE ALL ON public.stand_up_facility_settings FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON public.stand_up_facility_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- The window, computed once
-- ---------------------------------------------------------------------------

-- Definer: the save path must read the window for the facility it is refusing,
-- and a facility administrator's own SELECT policy is not the authority on it.
-- A null facility means "the organization default", which is what the
-- all-facilities overview and the corporate publisher use.
CREATE FUNCTION haven.stand_up_entry_open_lead_minutes(p_facility_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
  (SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s
    WHERE s.facility_id = p_facility_id AND s.entry_open_lead_minutes BETWEEN 60 AND 3405),
  1965)
$$;

-- The wall clock, not a fixed offset: a lead is counted back from Monday
-- 8:45 a.m. in calendar minutes, so 1,965 lands on Sunday 12:00 a.m. on both
-- sides of a daylight-saving change. Mirrors standUpEntryOpensAt in
-- src/lib/stand-up/model.ts; supabase/tests/review_stand_up_entry_window.sql
-- pins the two to the same instants.
CREATE FUNCTION haven.stand_up_entry_opens_at(p_facility_id uuid, p_meeting_monday date) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT ((p_meeting_monday + time '08:45')
   - make_interval(mins => haven.stand_up_entry_open_lead_minutes(p_facility_id)))
   AT TIME ZONE 'America/New_York'
$$;
CREATE FUNCTION public.stand_up_entry_opens_at(p_facility_id uuid, p_meeting_monday date) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT haven.stand_up_entry_opens_at(p_facility_id, p_meeting_monday)
$$;

-- The meeting Monday this facility may enter at a given instant: the latest
-- Monday whose window has opened. At most 3,405 minutes reaches back two days,
-- so the answer is always the upcoming Monday, this one, or the previous one.
-- Taking the instant as an argument is what lets a probe assert the boundary
-- minute by minute; nothing but the one-argument form is used in the app.
CREATE FUNCTION haven.stand_up_open_week(p_facility_id uuid, p_now timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(
  (SELECT max(c.candidate) FROM (
    SELECT (date_trunc('week', p_now AT TIME ZONE 'America/New_York')::date + o.shift) AS candidate
    FROM (VALUES (7),(0),(-7)) AS o(shift)
   ) c
   WHERE p_now >= haven.stand_up_entry_opens_at(p_facility_id, c.candidate)),
  date_trunc('week', p_now AT TIME ZONE 'America/New_York')::date - 7)
$$;
CREATE FUNCTION haven.stand_up_open_week(p_facility_id uuid) RETURNS date
LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT haven.stand_up_open_week(p_facility_id, clock_timestamp())
$$;

-- The organization default week, restated through the one rule rather than
-- repeating the Sunday boundary. Michelle's Monday overview and the corporate
-- publisher keep reading this and are unaffected by any facility override.
CREATE OR REPLACE FUNCTION haven.stand_up_week() RETURNS date
LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT haven.stand_up_open_week(NULL) $$;

-- ---------------------------------------------------------------------------
-- Enforcement: haven.stand_up_save, unchanged except for the window
-- ---------------------------------------------------------------------------
-- Differences from 336: the open week is read once per save from the facility's
-- own setting, and a save for a week whose window has not opened is refused with
-- P0409 / stand_up_entry_not_open rather than being treated as a historical
-- correction. Locks, CAS, idempotency, revisions and receipts are untouched.
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
 END IF;
 PERFORM haven.stand_up_validate(p->'values');
 asof:=CASE WHEN p ? 'as_of' THEN (p->>'as_of')::timestamptz WHEN w=open_week AND p_batch IS NULL THEN clock_timestamp() ELSE NULL END;
 IF asof>clock_timestamp() THEN RAISE EXCEPTION 'Source observation time cannot be future'; END IF;
 IF s NOT IN('draft','ready') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
 IF s='ready' AND ((clock_timestamp() AT TIME ZONE 'America/New_York')::date<w OR EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value='null'::jsonb)) THEN RAISE EXCEPTION 'Ready requires complete values and closed staffing week'; END IF;
 SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=f AND week_start=w FOR UPDATE;
 PERFORM haven.stand_up_assert(f,w<>open_week OR p_batch IS NOT NULL);
 IF coalesce(r.version,0)<>(p->>'expected_version')::integer THEN RAISE EXCEPTION 'Stale report version' USING ERRCODE='P0409'; END IF;
 IF r.id IS NULL THEN INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(o,f,w,p->'values',s) RETURNING * INTO r; END IF;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of) VALUES(r.id,r.version+1,p->'values',s,a,p->>'reason',coalesce(p->'provenance','{}'),p_batch,asof) RETURNING id INTO v_id;
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- Writing the setting, and reporting it with the workspace
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_set_entry_window(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid:=(p->>'facility_id')::uuid; o uuid; a uuid; n numeric; m integer;
BEGIN
 IF f IS NULL THEN RAISE EXCEPTION 'Facility required'; END IF;
 -- Owner and org_admin only; a facility administrator is refused here and again by RLS.
 o:=haven.stand_up_assert(f,true); a:=haven.authorized_user_id();
 IF NOT p ? 'entry_open_lead_minutes' OR p->'entry_open_lead_minutes'='null'::jsonb THEN m:=NULL;
 ELSE
  IF jsonb_typeof(p->'entry_open_lead_minutes')<>'number' THEN RAISE EXCEPTION 'Entry open lead must be whole minutes'; END IF;
  n:=(p->>'entry_open_lead_minutes')::numeric;
  IF trunc(n)<>n OR n<60 OR n>3405 THEN RAISE EXCEPTION 'Entry open lead must be between 60 and 3405 minutes'; END IF;
  m:=n::integer;
 END IF;
 INSERT INTO public.stand_up_facility_settings(organization_id,facility_id,entry_open_lead_minutes,updated_by)
 VALUES(o,f,m,a)
 ON CONFLICT(organization_id,facility_id) DO UPDATE SET entry_open_lead_minutes=excluded.entry_open_lead_minutes,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 RETURN jsonb_build_object('facility_id',f,'entry_open_lead_minutes',m,
  'open_week',haven.stand_up_open_week(f),
  'entry_opens_at',haven.stand_up_entry_opens_at(f,haven.stand_up_open_week(f)));
END $$;

-- 338's wrapper (reverse_import and revisions kept), plus the new action and the
-- per-facility window on every workspace read. current_week stays the
-- organization default so the all-facilities overview and the corporate feed
-- are unchanged.
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb;
BEGIN
 IF p_action='set_entry_window' THEN RETURN haven.stand_up_set_entry_window(p_payload); END IF;
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  SELECT coalesce(jsonb_agg(x||coalesce(haven.stand_up_revision_metadata((x->>'revision_id')::uuid),'{}') ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  SELECT coalesce(jsonb_agg(y||jsonb_build_object(
    'entry_open_lead_minutes',(SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s WHERE s.facility_id=(y->>'id')::uuid),
    'open_week',haven.stand_up_open_week((y->>'id')::uuid),
    'entry_opens_at',haven.stand_up_entry_opens_at((y->>'id')::uuid,haven.stand_up_open_week((y->>'id')::uuid))
   ) ORDER BY y->>'name'),'[]') INTO facilities FROM jsonb_array_elements(result->'facilities') y;
  RETURN result||jsonb_build_object('reports',reports,'facilities',facilities,'server_now',clock_timestamp(),'actor_role',haven.app_role()::text);
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||coalesce(haven.stand_up_revision_metadata((result->>'revision_id')::uuid),'{}');
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_entry_open_lead_minutes(uuid),haven.stand_up_entry_opens_at(uuid,date),haven.stand_up_open_week(uuid),haven.stand_up_open_week(uuid,timestamptz),haven.stand_up_set_entry_window(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.stand_up_entry_opens_at(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_entry_opens_at(uuid,date) TO authenticated;

COMMENT ON TABLE public.stand_up_facility_settings IS 'COL-350: per-facility Weekly Stand Up entry window. entry_open_lead_minutes is whole minutes before the Monday 08:45 America/New_York deadline; null means the Haven default of 1965 (Sunday 12:00 a.m.). Written only through stand_up_command set_entry_window by owner or org_admin.';
COMMENT ON FUNCTION public.stand_up_entry_opens_at(uuid,date) IS 'COL-350: when Stand Up entry opens for one facility and meeting Monday, in America/New_York wall clock. The only SQL statement of the rule; its display mirror is standUpEntryOpensAt in src/lib/stand-up/model.ts.';

NOTIFY pgrst, 'reload schema';
COMMIT;
