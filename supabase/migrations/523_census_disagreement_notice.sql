-- COL-555 (core) and COL-751 (part of COL-749): a census disagreement is one
-- object, and it reaches the administrator before each Stand Up.
--
-- Brian, 2026-09-22 (COL-555): "we have to catch and make sure we put in
-- safeguards to never have conflicting info". Brian, 2026-09-24 (COL-751): "BUT
-- do we have a workflow/alert to admin that there is a conflict so it is
-- reoplved before this becvomes a problem?"
--
--   * public.stand_up_census_disagreements(facility): for each facility and
--     meeting (Monday and Thursday), the open reporting period's census and
--     hospital figures against the live roster, joined to the reason recorded
--     with them. Derived on every read, never stored, so it cannot go stale.
--     Per figure and overall: not_entered, no_roster, agrees, explained or open.
--     A reason keeps a disagreement explained for the facility's reason window,
--     and only while the roster has not changed since the reason was given; when
--     either lapses it is open again. Thursday records no reasons, so a Thursday
--     figure that differs is open until one side is fixed. After the call starts
--     an open disagreement is also `unreconciled`.
--
--   * Three runtime settings in the COL-710 operating-rules registry
--     (effective-dated, per facility override, Settings -> Threshold targets):
--       stand_up.census_reason_window_days   default 7 (proposed)
--       stand_up.census_notice_lead_minutes  default 60 (proposed)
--       stand_up.census_notice_roles         default ["facility_admin"] (proposed)
--
--   * public.stand_up_census_notices: one row per facility, meeting, week, phase
--     and recipient, written by haven.stand_up_census_notice_sweep() when a
--     disagreement is open in the notice window before the entry deadline
--     (phase before_deadline) and again at the deadline if it is still open
--     (phase at_deadline). Recipients are the active users holding a notice
--     role with access to the facility. Delivery is in Haven: the recipient's
--     Stand Up page and Home show it, in plain words, with a link to reconcile,
--     and it disappears the moment either side is fixed. Push and text delivery
--     are not built here (see the COL-751 closeout).
--
--   * The sweep is scheduled every five minutes by pg_cron (job
--     stand-up-census-notices), created inactive with the migration as 496 does
--     and switched on by hand on each host after the apply.
BEGIN;

ALTER TABLE public.operating_rules DROP CONSTRAINT IF EXISTS operating_rules_rule_key_check;
ALTER TABLE public.operating_rules ADD CONSTRAINT operating_rules_rule_key_check CHECK (rule_key IN (
  'risk.score_bands',
  'survey_binder.due_window_days',
  'compliance.score_alert_below_pct',
  'resident_movement.backdate_window_days',
  'stand_up.census_reason_window_days',
  'stand_up.census_notice_lead_minutes',
  'stand_up.census_notice_roles'
));

CREATE OR REPLACE FUNCTION haven.operating_rules_validate_row()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v jsonb := NEW.value;
  k text;
BEGIN
  IF NEW.rule_key = 'risk.score_bands' THEN
    IF jsonb_typeof(v) <> 'object' THEN
      RAISE EXCEPTION 'Risk score bands must be an object' USING ERRCODE = '22023';
    END IF;
    FOR k IN SELECT jsonb_object_keys(v) LOOP
      IF k NOT IN ('critical_below', 'high_below', 'moderate_below') THEN
        RAISE EXCEPTION 'Unknown risk band %', k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(v->'critical_below') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v->'high_below') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v->'moderate_below') IS DISTINCT FROM 'number'
      OR (v->>'critical_below') !~ '^[0-9]+$'
      OR (v->>'high_below') !~ '^[0-9]+$'
      OR (v->>'moderate_below') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Risk bands need whole-number critical_below, high_below and moderate_below' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      (v->>'critical_below')::int >= 1
      AND (v->>'critical_below')::int < (v->>'high_below')::int
      AND (v->>'high_below')::int < (v->>'moderate_below')::int
      AND (v->>'moderate_below')::int <= 100
    ) THEN
      RAISE EXCEPTION 'Risk bands must rise: 1 <= critical < high < moderate <= 100' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'survey_binder.due_window_days' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 1 AND 365 THEN
      RAISE EXCEPTION 'The survey binder window must be a whole number of days from 1 to 365' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'compliance.score_alert_below_pct' THEN
    IF jsonb_typeof(v) = 'null' THEN
      RETURN NEW;
    END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'The compliance alert threshold must be off (null) or a whole percentage from 1 to 100' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'resident_movement.backdate_window_days' THEN
    -- 0 is a real setting: only an owner or org admin may back-date at all.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 365 THEN
      RAISE EXCEPTION 'The movement back-date window must be a whole number of days from 0 to 365' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_reason_window_days' THEN
    -- 0 is a real setting: a reason never keeps a disagreement explained.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION 'The census reason window must be a whole number of days from 0 to 60' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_notice_lead_minutes' THEN
    -- 0 is a real setting: the only notice goes out at the deadline.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 1440 THEN
      RAISE EXCEPTION 'The census notice lead time must be a whole number of minutes from 0 to 1440' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_notice_roles' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'string'
         OR r #>> '{}' NOT IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')) THEN
      RAISE EXCEPTION 'Census notices go to one or more of: owner, org_admin, facility_admin, manager, admin_assistant' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION haven.operating_rules_validate_row() FROM PUBLIC, anon, authenticated;

-- The resolver's built-in defaults, as 491 and 504 do, so an organization with
-- no row gets the proposed value rather than none.
CREATE OR REPLACE FUNCTION public.haven_operating_rule(
  p_organization_id uuid,
  p_facility_id uuid,
  p_rule_key text,
  p_as_of date
)
RETURNS TABLE (value jsonb, rule_id uuid, effective_from date, facility_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    coalesce(r.value, CASE p_rule_key
      WHEN 'risk.score_bands' THEN '{"critical_below": 50, "high_below": 70, "moderate_below": 85}'::jsonb
      WHEN 'survey_binder.due_window_days' THEN '60'::jsonb
      WHEN 'resident_movement.backdate_window_days' THEN '3'::jsonb
      WHEN 'stand_up.census_reason_window_days' THEN '7'::jsonb
      WHEN 'stand_up.census_notice_lead_minutes' THEN '60'::jsonb
      WHEN 'stand_up.census_notice_roles' THEN '["facility_admin"]'::jsonb
      ELSE 'null'::jsonb
    END),
    r.id,
    r.effective_from,
    r.facility_id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT o.value, o.id, o.effective_from, o.facility_id
    FROM public.operating_rules o
    WHERE o.organization_id = coalesce(p_organization_id, haven.organization_id())
      AND o.rule_key = p_rule_key
      AND (o.facility_id = p_facility_id OR o.facility_id IS NULL)
      AND o.effective_from <= p_as_of
    ORDER BY (o.facility_id IS NOT NULL) DESC, o.effective_from DESC, o.created_at DESC
    LIMIT 1
  ) r ON true
$$;

INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, k.rule_key, k.value, DATE '2026-09-24', k.reason
FROM public.organizations o
CROSS JOIN (VALUES
  ('stand_up.census_reason_window_days', '7'::jsonb, 'Seeded by migration 523 (COL-555): proposed default. A reason given for a Stand Up census that differs from the roster keeps it explained for 7 days, while the roster does not change.'),
  ('stand_up.census_notice_lead_minutes', '60'::jsonb, 'Seeded by migration 523 (COL-751): proposed default. An open census disagreement notifies 60 minutes before the Stand Up entry deadline, and again at the deadline.'),
  ('stand_up.census_notice_roles', '["facility_admin"]'::jsonb, 'Seeded by migration 523 (COL-751): proposed default. Census notices go to the facility''s administrator.')
) AS k(rule_key, value, reason)
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- The disagreement, derived
-- ---------------------------------------------------------------------------
-- One facility and meeting at an instant. Internal: callers are the reader
-- and the sweep below, which decide who may see it.
CREATE FUNCTION haven.stand_up_census_disagreement(p_organization uuid, p_facility uuid, p_day text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  week date; times jsonb; roster record; vals jsonb; revision uuid; window_days integer; rule jsonb;
  k text; stand integer; ros integer; c_reason text; c_at timestamptz; c_roster_as_of timestamptz; st text; until timestamptz;
  figures jsonb := '[]'::jsonb; overall text := 'not_entered'; rank_now integer := 0; rank integer;
  facility_name text;
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
  END IF;
  times := haven.stand_up_meeting_times(p_organization, p_facility, p_day, week);
  IF times IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO roster FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_window_days', (p_now AT TIME ZONE 'America/New_York')::date) o;
  -- An unreadable window gives a reason no grace: the disagreement stays open.
  window_days := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer ELSE 0 END;

  FOREACH k IN ARRAY ARRAY['current_total_census', 'hospital_and_rehab_total'] LOOP
    stand := CASE WHEN vals IS NULL OR vals -> k IS NULL OR vals -> k = 'null'::jsonb THEN NULL ELSE (vals ->> k)::numeric::integer END;
    ros := CASE WHEN roster.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN roster.roster_census_count ELSE roster.hospital_hold_count END;
    c_reason := NULL; c_at := NULL; c_roster_as_of := NULL;
    IF p_day = 'monday' AND revision IS NOT NULL THEN
      SELECT c.override_reason, c.confirmed_at, c.roster_as_of INTO c_reason, c_at, c_roster_as_of
      FROM public.stand_up_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    END IF;
    until := CASE WHEN c_at IS NULL THEN NULL ELSE c_at + make_interval(days => window_days) END;
    st := CASE
      WHEN stand IS NULL THEN 'not_entered'
      WHEN ros IS NULL THEN 'no_roster'
      WHEN stand = ros THEN 'agrees'
      WHEN c_reason IS NOT NULL AND until > p_now AND c_roster_as_of IS NOT DISTINCT FROM roster.roster_as_of THEN 'explained'
      ELSE 'open' END;
    rank := CASE st WHEN 'open' THEN 4 WHEN 'explained' THEN 3 WHEN 'agrees' THEN 2 WHEN 'no_roster' THEN 1 ELSE 0 END;
    IF rank > rank_now THEN rank_now := rank; overall := st; END IF;
    figures := figures || jsonb_build_array(jsonb_build_object(
      'key', k,
      'label', CASE k WHEN 'current_total_census' THEN 'Census' ELSE 'At hospital or rehab' END,
      'stand_up', stand, 'roster', ros, 'state', st,
      'reason', CASE WHEN st IN ('explained', 'open') THEN c_reason END,
      'reason_at', CASE WHEN st IN ('explained', 'open') THEN c_at END,
      'reason_until', CASE WHEN st IN ('explained', 'open') THEN until END,
      'roster_changed_since_reason', c_reason IS NOT NULL AND c_roster_as_of IS DISTINCT FROM roster.roster_as_of));
  END LOOP;

  RETURN jsonb_build_object(
    'facility_id', p_facility, 'facility_name', facility_name, 'meeting_day', p_day, 'week_start', week,
    'entry_due_at', times -> 'entry_due_at', 'call_at', times -> 'call_at',
    'state', overall,
    'unreconciled', overall = 'open' AND p_now >= (times ->> 'call_at')::timestamptz,
    'roster_as_of', roster.roster_as_of, 'reason_window_days', window_days,
    'figures', figures);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_disagreement(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Who reads it: Stand Up administrators and the facility's managers and
-- administrative assistants, for facilities they can access. Counts only.
CREATE FUNCTION public.stand_up_census_disagreements(p_facility uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid; o uuid; r text; now_at timestamptz := clock_timestamp();
BEGIN
  SELECT actor_user_id, actor_organization_id, actor_app_role::text INTO a, o, r FROM haven.current_authorized_actor() WHERE actor_is_managed;
  IF a IS NULL OR r NOT IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant') THEN
    RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(d ORDER BY d ->> 'facility_name', d ->> 'meeting_day')
    FROM public.facilities f
    CROSS JOIN (SELECT DISTINCT s.meeting_day FROM public.stand_up_meeting_schedule s WHERE s.organization_id = o) m
    CROSS JOIN LATERAL haven.stand_up_census_disagreement(o, f.id, m.meeting_day, now_at) d
    WHERE f.organization_id = o AND f.deleted_at IS NULL AND haven.has_facility_access(f.id)
      AND (p_facility IS NULL OR f.id = p_facility) AND d IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.stand_up_census_disagreements(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_census_disagreements(uuid) TO authenticated;
COMMENT ON FUNCTION public.stand_up_census_disagreements(uuid) IS
  'COL-555: the census disagreement for each accessible facility and Stand Up meeting, derived on read: Stand Up census and hospital figures against the live roster with the reason recorded and the reason window. Counts only. Owner, org_admin, facility_admin, manager and admin_assistant. COL-37 ruling: definer required -- stand_up_reports, stand_up_meeting_reports and stand_up_roster_confirmations are not readable by authenticated (Stand Up is RPC-only); it checks the caller''s role first and returns only facilities haven.has_facility_access admits.';

-- ---------------------------------------------------------------------------
-- The notice before each meeting's deadline
-- ---------------------------------------------------------------------------
CREATE TABLE public.stand_up_census_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  meeting_day text NOT NULL CHECK (meeting_day IN ('monday', 'thursday')),
  week_start date NOT NULL,
  phase text NOT NULL CHECK (phase IN ('before_deadline', 'at_deadline')),
  recipient_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  recipient_role text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app')),
  entry_due_at timestamptz NOT NULL,
  -- What was open when the notice went out: counts only.
  figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'array'),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT stand_up_census_notices_one_per_recipient UNIQUE (facility_id, meeting_day, week_start, phase, recipient_user_id)
);
CREATE INDEX idx_stand_up_census_notices_recipient_user_id ON public.stand_up_census_notices(recipient_user_id, created_at DESC);
CREATE INDEX idx_stand_up_census_notices_organization_id ON public.stand_up_census_notices(organization_id);
CREATE TRIGGER stand_up_census_notice_immutable BEFORE UPDATE OR DELETE ON public.stand_up_census_notices
  FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.stand_up_census_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_census_notices FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.stand_up_census_notices IS
  'COL-751: every census notice sent before a Stand Up entry deadline (before_deadline) and at it (at_deadline), one per recipient, with the open figures at that moment. Written only by haven.stand_up_census_notice_sweep; read through public.stand_up_census_notices_for_me.';

CREATE FUNCTION haven.stand_up_census_notice_sweep(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f record; d jsonb; lead integer; rule jsonb; roles text[]; due timestamptz; call_at timestamptz; v_phase text;
  sent integer := 0; n integer; open_figures jsonb; message text; week date;
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
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_lead_minutes', (p_now AT TIME ZONE 'America/New_York')::date) o;
    lead := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer END;
    IF lead IS NULL THEN CONTINUE; END IF;
    v_phase := CASE WHEN p_now >= due - make_interval(mins => lead) AND p_now < due THEN 'before_deadline'
      WHEN p_now >= due AND p_now < call_at THEN 'at_deadline' END;
    IF v_phase IS NULL THEN CONTINUE; END IF;
    d := haven.stand_up_census_disagreement(f.organization_id, f.id, f.meeting_day, p_now);
    IF d IS NULL OR d ->> 'state' <> 'open' THEN CONTINUE; END IF;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_roles', (p_now AT TIME ZONE 'America/New_York')::date) o;
    SELECT array_agg(x #>> '{}') INTO roles FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rule) = 'array' THEN rule ELSE '[]'::jsonb END) x;
    IF roles IS NULL THEN CONTINUE; END IF;
    SELECT jsonb_agg(x) INTO open_figures FROM jsonb_array_elements(d -> 'figures') x WHERE x ->> 'state' = 'open';
    SELECT string_agg(format('%s: Stand Up says %s, roster says %s', x ->> 'label', x ->> 'stand_up', x ->> 'roster'), '. ')
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
  'COL-751: pg_cron every five minutes (job stand-up-census-notices). For every facility and scheduled Stand Up meeting inside its notice window (stand_up.census_notice_lead_minutes before the entry deadline, and from the deadline to the call), writes one notice per recipient (stand_up.census_notice_roles, with access to the facility) while the census disagreement is open. Idempotent per facility, meeting, week, phase and recipient.';

-- What the signed-in person has been sent this week and is still open.
CREATE FUNCTION public.stand_up_census_notices_for_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid; o uuid; now_at timestamptz := clock_timestamp();
BEGIN
  SELECT actor_user_id, actor_organization_id INTO a, o FROM haven.current_authorized_actor() WHERE actor_is_managed;
  IF a IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', n.id, 'facility_id', n.facility_id, 'facility_name', d ->> 'facility_name',
      'meeting_day', n.meeting_day, 'week_start', n.week_start, 'phase', n.phase, 'entry_due_at', n.entry_due_at,
      'sent_at', n.created_at, 'message', n.message, 'unreconciled', (d ->> 'unreconciled')::boolean,
      'figures', (SELECT jsonb_agg(x) FROM jsonb_array_elements(d -> 'figures') x WHERE x ->> 'state' = 'open')) ORDER BY n.created_at DESC)
    FROM (
      SELECT DISTINCT ON (s.facility_id, s.meeting_day, s.week_start) s.*
      FROM public.stand_up_census_notices s
      WHERE s.recipient_user_id = a AND s.organization_id = o AND s.created_at > now_at - interval '8 days'
      ORDER BY s.facility_id, s.meeting_day, s.week_start, s.created_at DESC
    ) n
    CROSS JOIN LATERAL haven.stand_up_census_disagreement(o, n.facility_id, n.meeting_day, now_at) d
    -- Cleared the moment either side is fixed, or when the facility is no longer theirs.
    WHERE d ->> 'state' = 'open' AND (d ->> 'week_start')::date = n.week_start AND haven.has_facility_access(n.facility_id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.stand_up_census_notices_for_me() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_census_notices_for_me() TO authenticated;
COMMENT ON FUNCTION public.stand_up_census_notices_for_me() IS
  'COL-751: the census notices sent to the signed-in person in the last eight days whose disagreement is still open, with the live figures. COL-37 ruling: definer required -- stand_up_census_notices and the Stand Up tables are not readable by authenticated; it returns only rows addressed to the caller, for facilities haven.has_facility_access still admits.';

-- ---------------------------------------------------------------------------
-- The schedule, created inactive (switched on by hand on each host)
-- ---------------------------------------------------------------------------
DO $census_cron$ DECLARE job bigint; existing record; BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('haven.stand-up-census-notices',0));
  FOR existing IN EXECUTE 'SELECT * FROM cron.job WHERE jobname=$1' USING 'stand-up-census-notices' LOOP
   job:=existing.jobid;
  END LOOP;
  IF job IS NULL THEN
   EXECUTE 'SELECT cron.schedule($1,$2,$3)' INTO job USING 'stand-up-census-notices','*/5 * * * *','SELECT haven.stand_up_census_notice_sweep()';
   EXECUTE 'SELECT cron.alter_job($1,active:=false)' USING job;
  END IF;
 END IF;
END $census_cron$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: SELECT cron.unschedule('stand-up-census-notices'); DROP FUNCTION
-- public.stand_up_census_notices_for_me(), haven.stand_up_census_notice_sweep(timestamptz),
-- public.stand_up_census_disagreements(uuid), haven.stand_up_census_disagreement(uuid,uuid,text,timestamptz);
-- DROP TABLE public.stand_up_census_notices (export it first: it is the record
-- of who was told); restore migration 504's haven.operating_rules_validate_row,
-- public.haven_operating_rule and rule-key check; delete the three seeded rows.
