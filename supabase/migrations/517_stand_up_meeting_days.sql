-- COL-752 (part of COL-749): Stand Up meets Monday and Thursday.
--
-- Brian, 2026-09-24: Thursday uses "Same as Monday's times" (entry due 8:45 a.m.,
-- call 9:15 a.m. Eastern); the attendees are "Same people as Monday with the
-- addtion of the three recruiters"; the administrators share "the current A/R,
-- current census, depatures, and hosptial stays", compared with what they
-- submitted on Monday; and Thursday is "Haven Only": never published to Front
-- Office or the Google workbook.
--
-- The shape:
--
--   * public.stand_up_meeting_schedule is the runtime meeting schedule: one row
--     per organization and meeting day, optionally overridden per facility. Each
--     row carries the weekday, the entry-due and call times and the time zone.
--     Seeded Monday and Thursday, due 08:45, call 09:15, America/New_York. Nothing
--     Thursday does reads a time from code.
--
--   * Every existing public.stand_up_reports row is the Monday meeting and stays
--     exactly as it is. Its save path, entry window, recovery, imports, workbook
--     connector, Front Office publisher, history publisher and Google export are
--     not touched by this migration. The one Monday function it replaces,
--     haven.stand_up_command, is migration 512's text with a routing prologue:
--     a payload naming another meeting day goes to the meeting command below,
--     and a payload naming Monday has that key removed before the unchanged
--     Monday path runs.
--
--   * Other meetings live in public.stand_up_meeting_reports and
--     public.stand_up_meeting_revisions, keyed by facility, week (the Monday that
--     starts it) and meeting day. They carry their own figure set
--     (haven.stand_up_meeting_keys) and their own history. No publisher or export
--     function reads these tables, so a Thursday row cannot reach Front Office,
--     the history archive or the workbook; supabase/tests/review_stand_up_meeting_days.sql
--     proves the exports are byte-identical with and without Thursday rows.
--
--   * A meeting's entry window opens at the call of the meeting before it in the
--     schedule (Thursday opens when Monday's call starts) and stays the open
--     reporting period until the next week's window opens, as Monday's does.
--
--   * Recruiters may read a Thursday meeting for facilities they can access,
--     including Monday's submitted figures beside it. Only owner, org_admin and
--     facility_admin write facility figures, exactly as on Monday.
BEGIN;

-- ---------------------------------------------------------------------------
-- The meeting schedule (runtime configuration)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stand_up_meeting_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 -- Null is the organization default; a row with a facility overrides it there.
 facility_id uuid NULL REFERENCES public.facilities(id),
 meeting_day text NOT NULL CHECK (meeting_day IN ('monday','thursday')),
 weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 entry_due_local time NOT NULL,
 call_local time NOT NULL,
 time_zone text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 updated_by uuid NULL REFERENCES public.user_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (call_local >= entry_due_local),
 -- The Monday meeting is the weekly report; its week key is its own date.
 CHECK (meeting_day <> 'monday' OR weekday = 1),
 UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, meeting_day)
);
CREATE INDEX idx_stand_up_meeting_schedule_facility_id ON public.stand_up_meeting_schedule(facility_id) WHERE facility_id IS NOT NULL;
ALTER TABLE public.stand_up_meeting_schedule ENABLE ROW LEVEL SECURITY;
-- Read and written only through stand_up_command.
REVOKE ALL ON public.stand_up_meeting_schedule FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
SELECT o.id,d.meeting_day,d.weekday,time '08:45',time '09:15','America/New_York'
FROM public.organizations o CROSS JOIN (VALUES ('monday',1::smallint),('thursday',4::smallint)) d(meeting_day,weekday)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.stand_up_meeting_schedule IS 'COL-752: the Stand Up meeting schedule. One row per organization and meeting day (facility_id null), optionally overridden per facility. weekday is ISO (1 Monday .. 7 Sunday); entry_due_local and call_local are wall-clock times in time_zone. Seeded Monday and Thursday, due 08:45, call 09:15, America/New_York (Brian, 2026-09-24). Thursday reads every time from here. The Monday row records Monday''s times; the Monday entry window (405), meeting snapshot (337) and history publisher still hold their own 08:45 and 09:15 and are unchanged by COL-752.';

-- The row that governs one facility and meeting day: the facility override,
-- else the organization default. A null facility reads the organization default.
CREATE FUNCTION haven.stand_up_meeting_schedule_row(p_organization uuid,p_facility uuid,p_day text) RETURNS public.stand_up_meeting_schedule
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.* FROM public.stand_up_meeting_schedule s
 WHERE s.organization_id=p_organization AND s.meeting_day=p_day AND (s.facility_id IS NULL OR s.facility_id=p_facility)
 ORDER BY s.facility_id IS NULL LIMIT 1
$$;

-- A wall-clock time on a weekday of the week starting p_week, as an instant.
CREATE FUNCTION haven.stand_up_meeting_instant(p_week date,p_weekday smallint,p_local time,p_zone text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT ((p_week+(p_weekday-1))+p_local) AT TIME ZONE p_zone
$$;

-- When entry opens for one meeting: at the call of the meeting before it in the
-- schedule. Earlier the same week if there is one (Thursday opens at Monday's
-- call), else the latest meeting of the week before; a meeting alone in the
-- schedule opens at its own call a week earlier. Null when the meeting is not
-- scheduled for this facility.
CREATE FUNCTION haven.stand_up_meeting_opens_at(p_organization uuid,p_facility uuid,p_day text,p_week date) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE me public.stand_up_meeting_schedule; prev public.stand_up_meeting_schedule;
BEGIN
 me:=haven.stand_up_meeting_schedule_row(p_organization,p_facility,p_day);
 IF me.id IS NULL OR NOT me.active THEN RETURN NULL; END IF;
 SELECT r.* INTO prev
 FROM (SELECT DISTINCT s.meeting_day FROM public.stand_up_meeting_schedule s WHERE s.organization_id=p_organization AND s.meeting_day<>p_day) m
 CROSS JOIN LATERAL haven.stand_up_meeting_schedule_row(p_organization,p_facility,m.meeting_day) r
 WHERE r.active
 ORDER BY (r.weekday<me.weekday) DESC, r.weekday DESC, r.call_local DESC LIMIT 1;
 IF prev.id IS NULL THEN RETURN haven.stand_up_meeting_instant(p_week-7,me.weekday,me.call_local,me.time_zone); END IF;
 RETURN haven.stand_up_meeting_instant(CASE WHEN prev.weekday<me.weekday THEN p_week ELSE p_week-7 END,prev.weekday,prev.call_local,prev.time_zone);
END $$;

-- The week (its Monday) of the meeting a facility may enter at an instant: the
-- latest week whose window has opened. Null when the meeting is not scheduled.
CREATE FUNCTION haven.stand_up_meeting_open_week(p_organization uuid,p_facility uuid,p_day text,p_now timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT max(c.candidate) FROM (
  SELECT (date_trunc('week',p_now AT TIME ZONE 'UTC')::date+o.shift) AS candidate FROM (VALUES (7),(0),(-7),(-14)) o(shift)
 ) c
 WHERE p_now>=haven.stand_up_meeting_opens_at(p_organization,p_facility,p_day,c.candidate)
$$;

-- Everything a screen needs to state one meeting's window, from the schedule.
CREATE FUNCTION haven.stand_up_meeting_times(p_organization uuid,p_facility uuid,p_day text,p_week date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE me public.stand_up_meeting_schedule;
BEGIN
 me:=haven.stand_up_meeting_schedule_row(p_organization,p_facility,p_day);
 IF me.id IS NULL OR NOT me.active OR p_week IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('week_start',p_week,'meeting_date',p_week+(me.weekday-1),
  'entry_opens_at',haven.stand_up_meeting_opens_at(p_organization,p_facility,p_day,p_week),
  'entry_due_at',haven.stand_up_meeting_instant(p_week,me.weekday,me.entry_due_local,me.time_zone),
  'call_at',haven.stand_up_meeting_instant(p_week,me.weekday,me.call_local,me.time_zone));
END $$;

-- The schedule as a screen reads it, for one facility (or the organization).
CREATE FUNCTION haven.stand_up_meeting_schedule_json(p_organization uuid,p_facility uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('meeting_day',r.meeting_day,'weekday',r.weekday,'entry_due_local',to_char(r.entry_due_local,'HH24:MI'),
   'call_local',to_char(r.call_local,'HH24:MI'),'time_zone',r.time_zone,'facility_override',r.facility_id IS NOT NULL) ORDER BY r.weekday,r.meeting_day),'[]'::jsonb)
 FROM (SELECT DISTINCT s.meeting_day FROM public.stand_up_meeting_schedule s WHERE s.organization_id=p_organization) m
 CROSS JOIN LATERAL haven.stand_up_meeting_schedule_row(p_organization,p_facility,m.meeting_day) r
 WHERE r.active
$$;

-- ---------------------------------------------------------------------------
-- The figure set of each meeting other than Monday
-- ---------------------------------------------------------------------------
-- Thursday (COL-749 ruling 5): current A/R, current census, departures since
-- Monday and residents at a hospital or in rehab. COL-755 splits the last into
-- hospital and rehab by adding keys here; saved revisions keep the keys they
-- were saved with.
CREATE FUNCTION haven.stand_up_meeting_keys(p_day text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_day WHEN 'thursday' THEN ARRAY['current_ar_cents','current_total_census','departures_since_monday','hospital_and_rehab_total']::text[] END
$$;
-- The Monday figure each one is compared with; null when Monday has none.
CREATE FUNCTION haven.stand_up_meeting_monday_key(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_key WHEN 'current_ar_cents' THEN 'monthly_rent_roll_cents' WHEN 'current_total_census' THEN 'current_total_census'
  WHEN 'hospital_and_rehab_total' THEN 'hospital_and_rehab_total' END
$$;
CREATE FUNCTION haven.stand_up_meeting_validate(p_day text,v jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE keys text[]:=haven.stand_up_meeting_keys(p_day); k text; n numeric;
BEGIN
 IF keys IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up meeting'; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Values must be an object'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v))<>cardinality(keys) OR NOT v ?& keys THEN RAISE EXCEPTION 'Exactly the % supported figures required',cardinality(keys); END IF;
 FOREACH k IN ARRAY keys LOOP
  IF v->k='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k)<>'number' THEN RAISE EXCEPTION 'Invalid numeric figure: %',k; END IF;
  n:=(v->>k)::numeric;
  IF n<0 OR n>2147483647 OR trunc(n)<>n THEN RAISE EXCEPTION 'Invalid numeric figure: %',k; END IF;
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Meeting reports other than Monday, and their immutable history
-- ---------------------------------------------------------------------------
CREATE TABLE public.stand_up_meeting_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 -- The Monday that starts the meeting's week, as on stand_up_reports.
 week_start date NOT NULL CHECK (extract(isodow FROM week_start)=1),
 -- Monday reports are public.stand_up_reports; nothing else is published.
 meeting_day text NOT NULL CHECK (meeting_day IN ('thursday')),
 version integer NOT NULL DEFAULT 0,
 revision_id uuid,
 values jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('draft','ready')),
 source_as_of timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (facility_id,week_start,meeting_day)
);
CREATE TABLE public.stand_up_meeting_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL REFERENCES public.stand_up_meeting_reports(id),
 version integer NOT NULL,
 values jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('draft','ready')),
 actor_id uuid NOT NULL,
 reason text,
 source_as_of timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (report_id,version)
);
ALTER TABLE public.stand_up_meeting_reports ADD FOREIGN KEY (revision_id) REFERENCES public.stand_up_meeting_revisions(id);
CREATE INDEX idx_stand_up_meeting_reports_organization_id ON public.stand_up_meeting_reports(organization_id,meeting_day,week_start);
CREATE INDEX idx_stand_up_meeting_reports_revision_id ON public.stand_up_meeting_reports(revision_id);
CREATE INDEX idx_stand_up_meeting_revisions_report_id_created_at ON public.stand_up_meeting_revisions(report_id,created_at DESC,version DESC);
CREATE TRIGGER stand_up_meeting_revision_immutable BEFORE UPDATE OR DELETE ON public.stand_up_meeting_revisions
 FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.stand_up_meeting_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stand_up_meeting_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_meeting_reports, public.stand_up_meeting_revisions FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.stand_up_meeting_reports IS 'COL-752: Stand Up reports for meetings other than Monday, keyed by facility, week (its Monday) and meeting day. Haven only (Brian, 2026-09-24): no publisher, export or Google sync reads this table. Written only through stand_up_command.';
COMMENT ON TABLE public.stand_up_meeting_revisions IS 'COL-752: immutable revision history of stand_up_meeting_reports; the revision current at the call is the meeting''s as-of-the-call snapshot.';

-- ---------------------------------------------------------------------------
-- Reading a meeting report
-- ---------------------------------------------------------------------------
-- What the administrator last submitted on Monday for the same facility and
-- week, restricted to the figures this meeting compares with. Null when the
-- Monday report was never submitted.
CREATE FUNCTION haven.stand_up_meeting_monday_submitted(p_facility uuid,p_week date,p_day text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('revision_id',s.id,'submitted_at',s.created_at,'values',
   (SELECT coalesce(jsonb_object_agg(k,coalesce(s.values->haven.stand_up_meeting_monday_key(k),'null'::jsonb)),'{}'::jsonb)
    FROM unnest(haven.stand_up_meeting_keys(p_day)) k WHERE haven.stand_up_meeting_monday_key(k) IS NOT NULL))
 FROM public.stand_up_reports r
 JOIN LATERAL (SELECT v.* FROM public.stand_up_revisions v WHERE v.report_id=r.id AND v.status='ready' ORDER BY v.version DESC LIMIT 1) s ON true
 WHERE r.facility_id=p_facility AND r.week_start=p_week
$$;

CREATE FUNCTION haven.stand_up_meeting_report_json(p_report uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'organization_id',r.organization_id,'facility_id',r.facility_id,'week_start',r.week_start,
  'meeting_day',r.meeting_day,'version',r.version,'revision_id',r.revision_id,'values',r.values,'status',r.status,
  'source_as_of',r.source_as_of,'updated_at',r.updated_at,
  'updated_by',v.actor_id,
  'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
  'first_submitted_at',(SELECT min(s.created_at) FROM public.stand_up_meeting_revisions s WHERE s.report_id=r.id AND s.status='ready'),
  'last_submitted_at',ls.created_at,'last_submitted_revision_id',ls.id,'last_submitted_by',ls.actor_id,
  'monday_submitted',haven.stand_up_meeting_monday_submitted(r.facility_id,r.week_start,r.meeting_day))
 FROM public.stand_up_meeting_reports r
 LEFT JOIN public.stand_up_meeting_revisions v ON v.id=r.revision_id
 LEFT JOIN LATERAL (SELECT s.* FROM public.stand_up_meeting_revisions s WHERE s.report_id=r.id AND s.status='ready' ORDER BY s.version DESC LIMIT 1) ls ON true
 WHERE r.id=p_report
$$;

-- Who may read a meeting other than Monday: Stand Up administrators and
-- recruiters, in their organization, for facilities they can access.
CREATE FUNCTION haven.stand_up_meeting_reader(p_facility uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN('owner','org_admin','facility_admin','recruiter')
  OR (p_facility IS NOT NULL AND (NOT haven.has_facility_access(p_facility)
   OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=o AND deleted_at IS NULL))) THEN
  RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501';
 END IF;
 RETURN o;
END $$;

-- ---------------------------------------------------------------------------
-- Saving a meeting report
-- ---------------------------------------------------------------------------
-- The Monday save's rules, on the meeting's own window and figure set: locks,
-- idempotent receipts, optimistic version, nothing entered reserves nothing,
-- a past meeting needs a written reason, and a past meeting that was never
-- submitted is owner and org_admin only. Figures are written by owner,
-- org_admin and facility_admin (haven.stand_up_assert); recruiters are refused.
CREATE FUNCTION haven.stand_up_meeting_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid:=(p->>'facility_id')::uuid; w date:=(p->>'week_start')::date; d text:=p->>'meeting_day'; request uuid:=(p->>'request_id')::uuid;
 s text:=coalesce(p->>'status','draft'); o uuid; a uuid; r public.stand_up_meeting_reports%ROWTYPE; receipt public.stand_up_receipts%ROWTYPE;
 open_week date; v_id uuid; asof timestamptz; result jsonb; submitted boolean;
BEGIN
 IF f IS NULL OR w IS NULL OR d IS NULL OR request IS NULL OR p->>'expected_version' IS NULL THEN RAISE EXCEPTION 'Facility, week, meeting, request and expected version required'; END IF;
 IF haven.stand_up_meeting_keys(d) IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up meeting'; END IF;
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text||request::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_meeting:'||f::text||w::text||d,0));
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 SELECT * INTO receipt FROM public.stand_up_receipts WHERE actor_id=a AND request_id=request;
 IF FOUND THEN IF receipt.payload IS DISTINCT FROM p THEN RAISE EXCEPTION 'Idempotency key payload differs'; END IF; RETURN receipt.result; END IF;
 IF extract(isodow FROM w)<>1 THEN RAISE EXCEPTION 'Week must start on its Monday'; END IF;
 open_week:=haven.stand_up_meeting_open_week(o,f,d,clock_timestamp());
 IF open_week IS NULL THEN RAISE EXCEPTION 'This meeting is not on the Stand Up schedule for this facility'; END IF;
 IF w>open_week THEN
  RAISE EXCEPTION 'This report opens %', to_char(haven.stand_up_meeting_opens_at(o,f,d,w) AT TIME ZONE (haven.stand_up_meeting_schedule_row(o,f,d)).time_zone,'FMDay, FMMonth FMDD "at" FMHH12:MI AM')||' Eastern'
   USING ERRCODE='P0409', HINT='stand_up_entry_not_open';
 END IF;
 SELECT * INTO r FROM public.stand_up_meeting_reports WHERE facility_id=f AND week_start=w AND meeting_day=d FOR UPDATE;
 submitted:=r.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.stand_up_meeting_revisions v WHERE v.report_id=r.id AND v.status='ready');
 IF w<>open_week THEN
  PERFORM haven.stand_up_assert(f,NOT submitted);
  IF nullif(btrim(p->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Historical change requires reason'; END IF;
 END IF;
 PERFORM haven.stand_up_meeting_validate(d,p->'values');
 IF s NOT IN('draft','ready') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
 IF s='ready' AND EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'Submitting requires every figure'; END IF;
 IF coalesce(r.version,0)<>(p->>'expected_version')::integer THEN RAISE EXCEPTION 'Stale report version' USING ERRCODE='P0409'; END IF;
 IF r.id IS NULL AND w=open_week AND NOT EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value<>'null'::jsonb) THEN
  result:=jsonb_build_object('id',NULL,'organization_id',o,'facility_id',f,'week_start',w,'meeting_day',d,'version',0,'revision_id',NULL,
   'values',p->'values','status','draft','source_as_of',NULL,'updated_at',NULL,'updated_by',NULL,'updated_by_name',NULL,
   'first_submitted_at',NULL,'last_submitted_at',NULL,'last_submitted_revision_id',NULL,'last_submitted_by',NULL,
   'monday_submitted',haven.stand_up_meeting_monday_submitted(f,w,d),'not_started',true);
  INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
  RETURN result;
 END IF;
 IF r.id IS NULL THEN INSERT INTO public.stand_up_meeting_reports(organization_id,facility_id,week_start,meeting_day,values,status) VALUES(o,f,w,d,p->'values',s) RETURNING * INTO r; END IF;
 -- The open period records when the figures were given; a correction keeps the time already recorded.
 asof:=CASE WHEN w=open_week THEN clock_timestamp() ELSE r.source_as_of END;
 INSERT INTO public.stand_up_meeting_revisions(report_id,version,values,status,actor_id,reason,source_as_of)
  VALUES(r.id,r.version+1,p->'values',s,a,nullif(btrim(p->>'reason'),''),asof) RETURNING id INTO v_id;
 UPDATE public.stand_up_meeting_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id;
 result:=haven.stand_up_meeting_report_json(r.id);
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- The meeting command: workspace, list, save, revisions
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_meeting_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d text:=p_payload->>'meeting_day'; o uuid; f uuid; w date; role text; r public.stand_up_meeting_reports%ROWTYPE;
 facilities jsonb; reports jsonb; baselines jsonb; times jsonb; snapshot uuid; org_week date;
BEGIN
 IF haven.stand_up_meeting_keys(d) IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up meeting'; END IF;
 IF p_action='save' THEN RETURN haven.stand_up_meeting_save(p_payload); END IF;
 f:=(p_payload->>'facility_id')::uuid;
 o:=haven.stand_up_meeting_reader(f);
 role:=haven.app_role()::text;
 IF p_action IN('workspace','list') THEN
  org_week:=haven.stand_up_meeting_open_week(o,NULL,d,clock_timestamp());
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'open_week',x.open_week,
    'window',haven.stand_up_meeting_times(o,x.id,d,x.open_week)) ORDER BY x.name),'[]'::jsonb) INTO facilities
  FROM (SELECT fa.id,fa.name,haven.stand_up_meeting_open_week(o,fa.id,d,clock_timestamp()) open_week
   FROM public.facilities fa WHERE fa.organization_id=o AND fa.deleted_at IS NULL AND haven.has_facility_access(fa.id)
    AND (f IS NULL OR fa.id=f)) x;
  SELECT coalesce(jsonb_agg(haven.stand_up_meeting_report_json(m.id) ORDER BY m.week_start DESC,m.facility_id),'[]'::jsonb) INTO reports
  FROM public.stand_up_meeting_reports m
  WHERE m.organization_id=o AND m.meeting_day=d AND haven.has_facility_access(m.facility_id) AND (f IS NULL OR m.facility_id=f);
  -- Monday's submitted figures for each facility's open week, which has no report yet.
  SELECT coalesce(jsonb_agg(jsonb_build_object('facility_id',y->>'id','week_start',y->>'open_week','monday_submitted',
    haven.stand_up_meeting_monday_submitted((y->>'id')::uuid,(y->>'open_week')::date,d))),'[]'::jsonb) INTO baselines
  FROM jsonb_array_elements(facilities) y WHERE y->>'open_week' IS NOT NULL;
  RETURN jsonb_build_object('meeting_day',d,'scheduled',org_week IS NOT NULL,'current_week',org_week,
   'window',haven.stand_up_meeting_times(o,NULL,d,org_week),
   'schedule',haven.stand_up_meeting_schedule_json(o,f),
   'keys',to_jsonb(haven.stand_up_meeting_keys(d)),
   'facilities',facilities,'reports',reports,'monday_baselines',baselines,
   'can_edit',role IN('owner','org_admin','facility_admin'),
   'can_edit_submitted',role IN('owner','org_admin','facility_admin'),
   'server_now',clock_timestamp(),'actor_role',role);
 ELSIF p_action='revisions' THEN
  w:=(p_payload->>'week_start')::date;
  IF f IS NULL OR w IS NULL THEN RAISE EXCEPTION 'Facility and week required'; END IF;
  times:=haven.stand_up_meeting_times(o,f,d,w);
  SELECT * INTO r FROM public.stand_up_meeting_reports WHERE facility_id=f AND week_start=w AND meeting_day=d;
  IF r.id IS NULL THEN RETURN jsonb_build_object('facility_id',f,'week_start',w,'meeting_day',d,'window',times,'call_snapshot_revision_id',NULL,'revisions','[]'::jsonb); END IF;
  -- The meeting's own "as of the call" snapshot: the revision current when the call started.
  IF times IS NOT NULL AND clock_timestamp()>=(times->>'call_at')::timestamptz THEN
   SELECT v.id INTO snapshot FROM public.stand_up_meeting_revisions v WHERE v.report_id=r.id AND v.created_at<=(times->>'call_at')::timestamptz ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('facility_id',f,'week_start',w,'meeting_day',d,'window',times,'call_snapshot_revision_id',snapshot,'revisions',coalesce((
   SELECT jsonb_agg(jsonb_build_object('version',v.version,'revision_id',v.id,'status',v.status,'created_at',v.created_at,'reason',v.reason,'values',v.values,
    'source_as_of',v.source_as_of,'updated_by',v.actor_id,
    'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id)) ORDER BY v.version)
   FROM public.stand_up_meeting_revisions v WHERE v.report_id=r.id),'[]'::jsonb));
 END IF;
 RAISE EXCEPTION 'This action is not available for the % meeting',initcap(d);
END $$;

-- ---------------------------------------------------------------------------
-- Changing the schedule (owner and org_admin)
-- ---------------------------------------------------------------------------
-- Monday's own entry window, snapshot and history publisher still carry their
-- 08:45 and 09:15, so the Monday row is not changed here: a Monday row that
-- disagreed with them would state a schedule nothing enforces.
CREATE FUNCTION haven.stand_up_set_meeting_schedule(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text; f uuid:=(p->>'facility_id')::uuid; d text:=p->>'meeting_day'; base public.stand_up_meeting_schedule;
 wd smallint; due time; call_time time; zone text; act boolean; saved public.stand_up_meeting_schedule;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN('owner','org_admin') OR (f IS NOT NULL AND (NOT haven.has_facility_access(f)
  OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=f AND organization_id=o AND deleted_at IS NULL))) THEN
  RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501';
 END IF;
 IF haven.stand_up_meeting_keys(d) IS NULL THEN RAISE EXCEPTION 'Only a meeting other than Monday can be scheduled here'; END IF;
 base:=haven.stand_up_meeting_schedule_row(o,f,d);
 wd:=coalesce((p->>'weekday')::smallint,base.weekday);
 due:=coalesce((p->>'entry_due_local')::time,base.entry_due_local);
 call_time:=coalesce((p->>'call_local')::time,base.call_local);
 zone:=coalesce(nullif(btrim(p->>'time_zone'),''),base.time_zone);
 act:=coalesce((p->>'active')::boolean,base.active,true);
 IF wd IS NULL OR due IS NULL OR call_time IS NULL OR zone IS NULL THEN RAISE EXCEPTION 'Weekday, entry due time, call time and time zone required'; END IF;
 IF wd NOT BETWEEN 2 AND 7 THEN RAISE EXCEPTION 'Weekday must be Tuesday through Sunday'; END IF;
 IF call_time<due THEN RAISE EXCEPTION 'The call cannot start before entry is due'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'Unknown time zone'; END IF;
 INSERT INTO public.stand_up_meeting_schedule(organization_id,facility_id,meeting_day,weekday,entry_due_local,call_local,time_zone,active,updated_by)
 VALUES(o,f,d,wd,due,call_time,zone,act,a)
 ON CONFLICT(organization_id,facility_id,meeting_day) DO UPDATE SET weekday=excluded.weekday,entry_due_local=excluded.entry_due_local,
  call_local=excluded.call_local,time_zone=excluded.time_zone,active=excluded.active,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 RETURNING * INTO saved;
 RETURN jsonb_build_object('organization_id',o,'facility_id',f,'meeting_day',d,'weekday',saved.weekday,
  'entry_due_local',to_char(saved.entry_due_local,'HH24:MI'),'call_local',to_char(saved.call_local,'HH24:MI'),'time_zone',saved.time_zone,'active',saved.active);
END $$;

-- ---------------------------------------------------------------------------
-- haven.stand_up_command: migration 512's text with a routing prologue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb; organization uuid;
BEGIN
 -- COL-752: the meeting schedule, and every meeting other than Monday, have
 -- their own command. A payload naming Monday runs the Monday path unchanged,
 -- with the key removed so receipts and results are exactly what they were.
 IF p_action='set_meeting_schedule' THEN RETURN haven.stand_up_set_meeting_schedule(p_payload); END IF;
 IF p_payload ? 'meeting_day' THEN
  IF p_payload->>'meeting_day' IS DISTINCT FROM 'monday' THEN RETURN haven.stand_up_meeting_command(p_action,p_payload); END IF;
  p_payload:=p_payload-'meeting_day';
 END IF;
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

REVOKE ALL ON FUNCTION
 haven.stand_up_meeting_schedule_row(uuid,uuid,text),
 haven.stand_up_meeting_instant(date,smallint,time,text),
 haven.stand_up_meeting_opens_at(uuid,uuid,text,date),
 haven.stand_up_meeting_open_week(uuid,uuid,text,timestamptz),
 haven.stand_up_meeting_times(uuid,uuid,text,date),
 haven.stand_up_meeting_schedule_json(uuid,uuid),
 haven.stand_up_meeting_keys(text),
 haven.stand_up_meeting_monday_key(text),
 haven.stand_up_meeting_validate(text,jsonb),
 haven.stand_up_meeting_monday_submitted(uuid,date,text),
 haven.stand_up_meeting_report_json(uuid),
 haven.stand_up_meeting_reader(uuid),
 haven.stand_up_meeting_save(jsonb),
 haven.stand_up_meeting_command(text,jsonb),
 haven.stand_up_set_meeting_schedule(jsonb)
FROM PUBLIC, anon, authenticated, service_role;
-- Unchanged from 512: only the wrapper is callable, through public.stand_up_command.
REVOKE ALL ON FUNCTION haven.stand_up_command(text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;

COMMENT ON FUNCTION haven.stand_up_meeting_command(text,jsonb) IS 'COL-752: workspace, list, save and revisions for a Stand Up meeting other than Monday (payload meeting_day). Owner, org_admin, facility_admin and recruiter read; owner, org_admin and facility_admin write. Haven only: nothing here is published.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 512's haven.stand_up_command, drop the functions
-- named in the REVOKE above, then public.stand_up_meeting_reports (after
-- clearing its revision_id), public.stand_up_meeting_revisions and
-- public.stand_up_meeting_schedule. Export the Thursday revisions first; they
-- are evidence.
