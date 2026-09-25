-- COL-555 (remainder) and COL-751: Thursday records census reasons, Thursday
-- can also be checked against Monday, and the census notice follows its
-- delivery setting.
--
--   1. Thursday census reasons. Until now a Thursday census or hospital figure
--      that differed from the roster stayed `open` until one side was fixed,
--      because Thursday recorded no reasons. Each open-period Thursday save now
--      records, per figure, what the roster said and what was saved, exactly as
--      Monday does (404): public.stand_up_meeting_roster_confirmations. A
--      differing figure may carry a reason from the facility's list
--      (stand_up.census_reason_options, 534); it then reads `explained` for the
--      facility's reason window and only while the roster does not change.
--      A draft may keep a differing figure without a reason (it stays `open`
--      and the administrator is told before the deadline); submitting it needs
--      the reason, so a submitted Thursday never carries an unexplained
--      difference. The reason travels with the report (roster_confirmations on
--      the report and on each revision).
--
--   2. Thursday against Monday, behind stand_up.thursday_census_vs_monday
--      (534, default off). When a facility turns it on, each Thursday figure is
--      also compared with what the administrator submitted on Monday plus the
--      roster's movement since that submission (the roster at the Monday
--      submission is read from effective-dated status history, 504). A
--      difference opens the same disagreement object, as a figure with
--      "against": "monday"; the same Thursday reason explains it. Off, nothing
--      about Thursday changes.
--
--   3. The census notice sweep (523) writes a notice only when
--      stand_up.census_notice_channels includes in_app, the one delivery that
--      exists. The notice words a Monday comparison in its own terms.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Thursday confirmations
-- ---------------------------------------------------------------------------
CREATE TABLE public.stand_up_meeting_roster_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  report_id uuid NOT NULL REFERENCES public.stand_up_meeting_reports(id),
  revision_id uuid NOT NULL REFERENCES public.stand_up_meeting_revisions(id),
  field_key text NOT NULL CHECK (field_key IN ('current_total_census', 'hospital_and_rehab_total')),
  roster_suggested_value integer CHECK (roster_suggested_value IS NULL OR roster_suggested_value >= 0),
  confirmed_value integer NOT NULL CHECK (confirmed_value >= 0),
  -- differs_unexplained: a draft saved with a differing figure and no reason yet.
  source text NOT NULL CHECK (source IN ('roster_confirmed', 'entered_no_roster', 'overridden', 'differs_unexplained')),
  override_reason text CHECK (override_reason IS NULL OR override_reason ~ '^[a-z][a-z0-9_]{0,39}$'),
  override_reason_label text CHECK (override_reason_label IS NULL OR char_length(override_reason_label) BETWEEN 1 AND 80),
  roster_as_of timestamptz,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((source = 'overridden') = (override_reason IS NOT NULL)),
  CHECK ((override_reason IS NULL) = (override_reason_label IS NULL)),
  CHECK ((source = 'entered_no_roster') = (roster_suggested_value IS NULL)),
  UNIQUE (revision_id, field_key)
);
CREATE INDEX idx_stand_up_meeting_roster_confirmations_report_id ON public.stand_up_meeting_roster_confirmations(report_id, field_key, confirmed_at DESC);
CREATE INDEX idx_stand_up_meeting_roster_confirmations_organization_id ON public.stand_up_meeting_roster_confirmations(organization_id);
CREATE INDEX idx_stand_up_meeting_roster_confirmations_facility_id ON public.stand_up_meeting_roster_confirmations(facility_id);
CREATE TRIGGER stand_up_meeting_roster_confirmation_immutable BEFORE UPDATE OR DELETE ON public.stand_up_meeting_roster_confirmations
  FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.stand_up_meeting_roster_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_meeting_roster_confirmations FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.stand_up_meeting_roster_confirmations IS
  'COL-555: what the roster said and what was saved for census and hospital on each open-period revision of a Stand Up meeting other than Monday, with the reason given for a difference. Written only by the meeting save; read through stand_up_command. Counts only.';

-- Records the confirmations for one open-period meeting revision. The server
-- recomputes the roster and decides the source.
CREATE FUNCTION haven.stand_up_meeting_roster_confirm(p jsonb, p_organization uuid, p_facility uuid, p_actor uuid, p_report uuid, p_revision uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE roster jsonb := coalesce(p -> 'roster', '{}'::jsonb); c record; k text; v jsonb; entry jsonb; reason text; reason_label text;
  suggested integer; confirmed integer; src text; submitting boolean := coalesce(p ->> 'status', 'draft') = 'ready';
BEGIN
  IF jsonb_typeof(roster) <> 'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(roster) x WHERE x <> ALL (haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  SELECT * INTO c FROM public.stand_up_roster_census(p_organization, p_facility);
  FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
    v := p -> 'values' -> k;
    IF v IS NULL OR v = 'null'::jsonb THEN CONTINUE; END IF;
    entry := roster -> k;
    IF entry IS NOT NULL AND jsonb_typeof(entry) <> 'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
    reason := nullif(btrim(coalesce(entry ->> 'override_reason', '')), '');
    reason_label := NULL;
    IF reason IS NOT NULL THEN
      reason_label := haven.stand_up_census_reason_label(p_organization, p_facility, reason, (clock_timestamp() AT TIME ZONE 'America/New_York')::date);
      IF reason_label IS NULL THEN RAISE EXCEPTION 'Invalid override reason' USING ERRCODE = '22023'; END IF;
    END IF;
    confirmed := (v #>> '{}')::numeric::integer;
    suggested := CASE WHEN c.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
    src := CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed = suggested THEN 'roster_confirmed'
      WHEN reason IS NOT NULL THEN 'overridden' ELSE 'differs_unexplained' END;
    IF src = 'differs_unexplained' AND submitting THEN
      RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
        CASE WHEN k = 'current_total_census' THEN 'Current census' ELSE 'Residents at hospital or rehab' END, suggested USING ERRCODE = '22023';
    END IF;
    IF src <> 'overridden' THEN reason := NULL; reason_label := NULL; END IF;
    INSERT INTO public.stand_up_meeting_roster_confirmations(organization_id, facility_id, report_id, revision_id, field_key, roster_suggested_value,
      confirmed_value, source, override_reason, override_reason_label, roster_as_of, confirmed_by)
    VALUES (p_organization, p_facility, p_report, p_revision, k, suggested, confirmed, src, reason, reason_label, c.roster_as_of, p_actor);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_meeting_roster_confirm(jsonb, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.stand_up_meeting_roster_confirmations(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(c.field_key, jsonb_build_object('source', c.source, 'suggested', c.roster_suggested_value, 'confirmed', c.confirmed_value,
    'override_reason', c.override_reason, 'override_reason_label', c.override_reason_label, 'roster_as_of', c.roster_as_of, 'confirmed_at', c.confirmed_at)), '{}'::jsonb)
  FROM public.stand_up_meeting_roster_confirmations c WHERE c.revision_id = p_revision
$$;
REVOKE ALL ON FUNCTION haven.stand_up_meeting_roster_confirmations(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Migration 517's reader, with the confirmations recorded on the current revision.
CREATE OR REPLACE FUNCTION haven.stand_up_meeting_report_json(p_report uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'organization_id',r.organization_id,'facility_id',r.facility_id,'week_start',r.week_start,
  'meeting_day',r.meeting_day,'version',r.version,'revision_id',r.revision_id,'values',r.values,'status',r.status,
  'source_as_of',r.source_as_of,'updated_at',r.updated_at,
  'updated_by',v.actor_id,
  'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
  'first_submitted_at',(SELECT min(s.created_at) FROM public.stand_up_meeting_revisions s WHERE s.report_id=r.id AND s.status='ready'),
  'last_submitted_at',ls.created_at,'last_submitted_revision_id',ls.id,'last_submitted_by',ls.actor_id,
  'monday_submitted',haven.stand_up_meeting_monday_submitted(r.facility_id,r.week_start,r.meeting_day),
  'roster_confirmations',CASE WHEN r.revision_id IS NULL THEN '{}'::jsonb ELSE haven.stand_up_meeting_roster_confirmations(r.revision_id) END)
 FROM public.stand_up_meeting_reports r
 LEFT JOIN public.stand_up_meeting_revisions v ON v.id=r.revision_id
 LEFT JOIN LATERAL (SELECT s.* FROM public.stand_up_meeting_revisions s WHERE s.report_id=r.id AND s.status='ready' ORDER BY s.version DESC LIMIT 1) ls ON true
 WHERE r.id=p_report
$$;

-- Migration 517's save; the open period also records the roster confirmations
-- for the revision it writes (a roster block in the payload is optional).
CREATE OR REPLACE FUNCTION haven.stand_up_meeting_save(p jsonb) RETURNS jsonb
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
   'monday_submitted',haven.stand_up_meeting_monday_submitted(f,w,d),'roster_confirmations','{}'::jsonb,'not_started',true);
  INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
  RETURN result;
 END IF;
 IF r.id IS NULL THEN INSERT INTO public.stand_up_meeting_reports(organization_id,facility_id,week_start,meeting_day,values,status) VALUES(o,f,w,d,p->'values',s) RETURNING * INTO r; END IF;
 -- The open period records when the figures were given; a correction keeps the time already recorded.
 asof:=CASE WHEN w=open_week THEN clock_timestamp() ELSE r.source_as_of END;
 INSERT INTO public.stand_up_meeting_revisions(report_id,version,values,status,actor_id,reason,source_as_of)
  VALUES(r.id,r.version+1,p->'values',s,a,nullif(btrim(p->>'reason'),''),asof) RETURNING id INTO v_id;
 -- COL-555: on the open period, census and hospital are compared with the roster whether or not a roster block was sent.
 IF w=open_week THEN PERFORM haven.stand_up_meeting_roster_confirm(p,o,f,a,r.id,v_id); END IF;
 UPDATE public.stand_up_meeting_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id;
 result:=haven.stand_up_meeting_report_json(r.id);
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The disagreement: Thursday reasons, and Thursday against Monday
-- ---------------------------------------------------------------------------
-- Migration 534's text; Thursday reads its own reasons, and when the facility
-- turns on stand_up.thursday_census_vs_monday each Thursday figure is also
-- compared with Monday's submitted figure plus the roster's movement since.
CREATE OR REPLACE FUNCTION haven.stand_up_census_disagreement(p_organization uuid, p_facility uuid, p_day text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  week date; times jsonb; roster record; vals jsonb; revision uuid; window_days integer; rule jsonb;
  k text; stand integer; ros integer; c_reason text; c_label text; c_at timestamptz; c_roster_as_of timestamptz; st text; until timestamptz;
  figures jsonb := '[]'::jsonb; overall text := 'not_entered'; rank_now integer := 0; rank integer;
  facility_name text; today date := (p_now AT TIME ZONE 'America/New_York')::date;
  vs_monday boolean := false; monday jsonb; m_census integer; m_hospital integer; m_count integer; monday_value integer; roster_then integer; expected integer; against text;
BEGIN
  SELECT f.name INTO facility_name FROM public.facilities f WHERE f.id = p_facility AND f.organization_id = p_organization AND f.deleted_at IS NULL;
  IF facility_name IS NULL THEN RETURN NULL; END IF;
  IF p_day = 'monday' THEN
    week := haven.stand_up_open_week(p_facility);
    SELECT r.values, r.revision_id INTO vals, revision FROM public.stand_up_reports r WHERE r.facility_id = p_facility AND r.week_start = week;
  ELSE
    week := haven.stand_up_meeting_open_week(p_organization, p_facility, p_day, p_now);
    IF week IS NULL THEN RETURN NULL; END IF;
    SELECT r.values, r.revision_id INTO vals, revision FROM public.stand_up_meeting_reports r
    WHERE r.facility_id = p_facility AND r.week_start = week AND r.meeting_day = p_day;
    SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.thursday_census_vs_monday', today) o;
    vs_monday := rule = 'true'::jsonb;
    IF vs_monday THEN
      monday := haven.stand_up_meeting_monday_submitted(p_facility, week, p_day);
      IF monday IS NOT NULL THEN
        SELECT x.roster_census_count, x.hospital_hold_count, x.resident_count_in_haven INTO m_census, m_hospital, m_count
        FROM public.stand_up_roster_census_as_of(p_organization, p_facility, (monday ->> 'submitted_at')::timestamptz) x;
      END IF;
    END IF;
  END IF;
  times := haven.stand_up_meeting_times(p_organization, p_facility, p_day, week);
  IF times IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO roster FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_window_days', today) o;
  -- An unreadable window gives a reason no grace: the disagreement stays open.
  window_days := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer ELSE 0 END;

  FOREACH k IN ARRAY ARRAY['current_total_census', 'hospital_and_rehab_total'] LOOP
    stand := CASE WHEN vals IS NULL OR vals -> k IS NULL OR vals -> k = 'null'::jsonb THEN NULL ELSE (vals ->> k)::numeric::integer END;
    ros := CASE WHEN roster.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN roster.roster_census_count ELSE roster.hospital_hold_count END;
    c_reason := NULL; c_label := NULL; c_at := NULL; c_roster_as_of := NULL;
    IF revision IS NOT NULL AND p_day = 'monday' THEN
      SELECT c.override_reason, coalesce(c.override_reason_label, haven.stand_up_census_reason_legacy_label(c.override_reason), c.override_reason), c.confirmed_at, c.roster_as_of
        INTO c_reason, c_label, c_at, c_roster_as_of
      FROM public.stand_up_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    ELSIF revision IS NOT NULL THEN
      SELECT c.override_reason, c.override_reason_label, c.confirmed_at, c.roster_as_of
        INTO c_reason, c_label, c_at, c_roster_as_of
      FROM public.stand_up_meeting_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    END IF;
    until := CASE WHEN c_at IS NULL THEN NULL ELSE c_at + make_interval(days => window_days) END;
    FOREACH against IN ARRAY CASE WHEN vs_monday THEN ARRAY['roster', 'monday'] ELSE ARRAY['roster'] END LOOP
      expected := NULL; monday_value := NULL; roster_then := NULL;
      IF against = 'monday' THEN
        monday_value := CASE WHEN monday IS NULL OR monday -> 'values' -> k IS NULL OR monday -> 'values' -> k = 'null'::jsonb THEN NULL
          ELSE (monday -> 'values' ->> k)::numeric::integer END;
        roster_then := CASE WHEN coalesce(m_count, 0) = 0 THEN NULL
          WHEN k = 'current_total_census' THEN m_census ELSE m_hospital END;
        expected := CASE WHEN monday_value IS NULL OR roster_then IS NULL OR ros IS NULL THEN NULL ELSE greatest(monday_value + (ros - roster_then), 0) END;
        -- Nothing to compare with (Monday not submitted, or no roster then): this comparison says nothing.
        IF expected IS NULL THEN CONTINUE; END IF;
      END IF;
      st := CASE
        WHEN stand IS NULL THEN 'not_entered'
        WHEN against = 'roster' AND ros IS NULL THEN 'no_roster'
        WHEN stand = CASE WHEN against = 'roster' THEN ros ELSE expected END THEN 'agrees'
        WHEN c_reason IS NOT NULL AND until > p_now AND c_roster_as_of IS NOT DISTINCT FROM roster.roster_as_of THEN 'explained'
        ELSE 'open' END;
      rank := CASE st WHEN 'open' THEN 4 WHEN 'explained' THEN 3 WHEN 'agrees' THEN 2 WHEN 'no_roster' THEN 1 ELSE 0 END;
      IF rank > rank_now THEN rank_now := rank; overall := st; END IF;
      figures := figures || jsonb_build_array(jsonb_build_object(
        'key', k, 'against', against,
        'label', CASE k WHEN 'current_total_census' THEN 'Census' ELSE 'At hospital or rehab' END
          || CASE WHEN against = 'monday' THEN ' against Monday' ELSE '' END,
        'stand_up', stand, 'roster', CASE WHEN against = 'roster' THEN ros ELSE expected END, 'state', st,
        'monday', monday_value, 'roster_change_since_monday', CASE WHEN against = 'monday' THEN ros - roster_then END,
        'reason', CASE WHEN st IN ('explained', 'open') THEN c_reason END,
        'reason_label', CASE WHEN st IN ('explained', 'open') THEN c_label END,
        'reason_at', CASE WHEN st IN ('explained', 'open') THEN c_at END,
        'reason_until', CASE WHEN st IN ('explained', 'open') THEN until END,
        'roster_changed_since_reason', c_reason IS NOT NULL AND c_roster_as_of IS DISTINCT FROM roster.roster_as_of));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'facility_id', p_facility, 'facility_name', facility_name, 'meeting_day', p_day, 'week_start', week,
    'entry_due_at', times -> 'entry_due_at', 'call_at', times -> 'call_at',
    'state', overall,
    'unreconciled', overall = 'open' AND p_now >= (times ->> 'call_at')::timestamptz,
    'roster_as_of', roster.roster_as_of, 'reason_window_days', window_days,
    'reason_options', haven.stand_up_census_reason_options(p_organization, p_facility, today),
    'compares_with_monday', vs_monday,
    'figures', figures);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_disagreement(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The notice follows its delivery setting
-- ---------------------------------------------------------------------------
-- Migration 523's sweep. A facility whose stand_up.census_notice_channels does
-- not include in_app gets no notice (in-app is the only delivery built), and a
-- Monday comparison is worded as one.
CREATE OR REPLACE FUNCTION haven.stand_up_census_notice_sweep(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f record; d jsonb; lead integer; rule jsonb; roles text[]; due timestamptz; call_at timestamptz; v_phase text;
  sent integer := 0; n integer; open_figures jsonb; message text; week date; today date := (p_now AT TIME ZONE 'America/New_York')::date;
BEGIN
  FOR f IN
    SELECT fa.id, fa.organization_id, m.meeting_day
    FROM public.facilities fa
    CROSS JOIN LATERAL (SELECT DISTINCT s.meeting_day FROM public.stand_up_meeting_schedule s WHERE s.organization_id = fa.organization_id AND s.active) m
    WHERE fa.deleted_at IS NULL
  LOOP
    week := CASE WHEN f.meeting_day = 'monday' THEN haven.stand_up_open_week(f.id)
      ELSE haven.stand_up_meeting_open_week(f.organization_id, f.id, f.meeting_day, p_now) END;
    IF week IS NULL THEN CONTINUE; END IF;
    d := haven.stand_up_meeting_times(f.organization_id, f.id, f.meeting_day, week);
    IF d IS NULL THEN CONTINUE; END IF;
    due := (d ->> 'entry_due_at')::timestamptz; call_at := (d ->> 'call_at')::timestamptz;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_lead_minutes', today) o;
    lead := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer END;
    IF lead IS NULL THEN CONTINUE; END IF;
    v_phase := CASE WHEN p_now >= due - make_interval(mins => lead) AND p_now < due THEN 'before_deadline'
      WHEN p_now >= due AND p_now < call_at THEN 'at_deadline' END;
    IF v_phase IS NULL THEN CONTINUE; END IF;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_channels', today) o;
    IF jsonb_typeof(rule) IS DISTINCT FROM 'array' OR NOT rule @> '["in_app"]'::jsonb THEN CONTINUE; END IF;
    d := haven.stand_up_census_disagreement(f.organization_id, f.id, f.meeting_day, p_now);
    IF d IS NULL OR d ->> 'state' <> 'open' THEN CONTINUE; END IF;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_roles', today) o;
    SELECT array_agg(x #>> '{}') INTO roles FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rule) = 'array' THEN rule ELSE '[]'::jsonb END) x;
    IF roles IS NULL THEN CONTINUE; END IF;
    SELECT jsonb_agg(x) INTO open_figures FROM jsonb_array_elements(d -> 'figures') x WHERE x ->> 'state' = 'open';
    SELECT string_agg(CASE WHEN x ->> 'against' = 'monday'
        THEN format('%s: Stand Up says %s, Monday''s %s with the roster''s change since is %s', x ->> 'label', x ->> 'stand_up', x ->> 'monday', x ->> 'roster')
        ELSE format('%s: Stand Up says %s, roster says %s', x ->> 'label', x ->> 'stand_up', x ->> 'roster') END, '. ')
      INTO message FROM jsonb_array_elements(open_figures) x;
    message := message || format('. Reconcile before %s.', to_char(due AT TIME ZONE 'America/New_York', 'FMHH12:MI AM'));
    INSERT INTO public.stand_up_census_notices(organization_id, facility_id, meeting_day, week_start, phase, recipient_user_id, recipient_role, entry_due_at, figures, message)
    SELECT f.organization_id, f.id, f.meeting_day, week, v_phase, p.id, p.app_role::text, due, open_figures, message
    FROM public.user_profiles p
    WHERE p.organization_id = f.organization_id AND p.is_active AND p.deleted_at IS NULL
      AND p.app_role::text = ANY (roles)
      AND (p.app_role::text IN ('owner', 'org_admin') OR EXISTS (
        SELECT 1 FROM public.user_facility_access u WHERE u.user_id = p.id AND u.facility_id = f.id
          AND u.organization_id = f.organization_id AND u.revoked_at IS NULL))
    ON CONFLICT ON CONSTRAINT stand_up_census_notices_one_per_recipient DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    sent := sent + n;
  END LOOP;
  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_notice_sweep(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_census_notice_sweep(timestamptz) IS
  'COL-751: pg_cron every five minutes (job stand-up-census-notices). For every facility and scheduled Stand Up meeting inside its notice window (stand_up.census_notice_lead_minutes before the entry deadline, and from the deadline to the call), writes one in-app notice per recipient (stand_up.census_notice_roles, with access to the facility) while the census disagreement is open and stand_up.census_notice_channels includes in_app. Idempotent per facility, meeting, week, phase and recipient.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 534's haven.stand_up_census_disagreement, 523's
-- haven.stand_up_census_notice_sweep and 517's haven.stand_up_meeting_save and
-- haven.stand_up_meeting_report_json; DROP FUNCTION
-- haven.stand_up_meeting_roster_confirm, haven.stand_up_meeting_roster_confirmations;
-- export then DROP TABLE public.stand_up_meeting_roster_confirmations.
