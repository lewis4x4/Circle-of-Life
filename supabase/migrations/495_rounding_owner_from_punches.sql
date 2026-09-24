-- COL-677 / COL-693: Smart Rounding checks owned by on-clock staff (spec 40 section 8).
--
-- Homewood has no shift_assignments, so every generated check resolved to
-- none_scheduled, nobody owned it and a missed check named nobody. Where the
-- facility runs the timeclock, the punches are the staffing record: whoever is
-- on the clock at that facility right now is on shift.
--
-- The ownership chain becomes:
--
--   1. resident_split     unchanged
--   2. shift_roster       unchanged
--   3. on_clock           nobody is scheduled, the shift being resolved is the
--                         one in progress, and eligible staff are on the clock
--                         at the facility. Spread by the same stable hash ring
--                         as shift_roster (ordered by staff_id, positioned by
--                         hashtextextended(resident_id)), so a re-run with the
--                         same people on the clock picks the same owner.
--                         At a shift handoff the outgoing shift is often still
--                         on the clock: the ring prefers staff whose opening
--                         'in' punch falls inside the shift being resolved
--                         (allowing rounding_clock_in_lead_minutes for early
--                         arrivals, a facility setting) and falls back to
--                         everybody on the clock only when nobody clocked in
--                         for this shift. Without that preference the night
--                         tech still clocked in at 06:03 would own the day's
--                         checks all day, because owned checks never move.
--   4. awaiting_clock_in  nobody is scheduled for the NEXT shift at a facility
--                         that staffs from punches. Nobody is on the clock for
--                         a shift that has not started, and the outgoing shift
--                         must never own the incoming shift's checks, so the
--                         checks are written unowned and
--                         assign_unowned_observation_tasks gives them owners on
--                         the first run after the shift starts. Not a gap yet.
--   5. none_scheduled     unchanged meaning: nobody to own the checks.
--
-- Decisions:
--   * On the clock means haven.timeclock_state IN ('in', 'meal'). A person on a
--     meal break is still on shift; the floor tablet roster (migration 494)
--     uses the same definition, so the roster and the owner cannot disagree.
--   * The opening 'in' punch must be at this facility, so somebody whose home
--     is here but who punched in at another building owns nothing here.
--   * Which roles own checks is facility configuration, not code:
--     timeclock_facility_settings.rounding_owner_roles, default med_tech only
--     (spec 40 section 10 item 6 names an on-clock med tech as the owner). It
--     may name only roles haven.complete_rounding_task_core lets complete any
--     check (owner, org_admin, facility_admin, med_tech); retired roles never.
--     An administrator who punches in owns nothing unless a facility says so.
--   * The person must be able to actually complete the check through
--     haven.assert_rounding_service_actor: active profile, live auth user, an
--     active staff row at this facility, and a facility grant unless owner or
--     org_admin. An owner who cannot work the check is worse than no owner.
--   * On-clock sources apply only where timeclock_facility_settings has
--     timeclock_enabled; a facility without the timeclock behaves as before.
--   * Already-owned checks never change owner. The generator's writer,
--     record_cadence_observation_tasks (migration 433), inserts new checks and
--     on conflict adopts an existing check only when it has no owner, no live
--     assignment row, the same cadence version and an open status; an owned
--     check is left alone. The unowned pass below has the same rule.
--   * A "Nobody is scheduled" alert raised on an earlier tick is resolved by
--     resolve_observation_staffing_gap once eligible staff are on the clock for
--     that shift in progress (resolved_at, status resolved, a note in
--     current_value_json). De-duplication is unchanged: while an alert with the
--     same title is open no second one is raised, and after it is resolved a
--     genuine new gap raises a new alert.
--
-- Nothing here reads or writes objects from migration 476.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The owner roles, per facility.
-- ---------------------------------------------------------------------------
ALTER TABLE public.timeclock_facility_settings
  ADD COLUMN rounding_owner_roles text[] NOT NULL DEFAULT ARRAY['med_tech']
    CONSTRAINT timeclock_facility_settings_rounding_owner_roles_check CHECK (
      cardinality(rounding_owner_roles) >= 1
      AND array_position(rounding_owner_roles, NULL) IS NULL
      AND rounding_owner_roles <@ ARRAY['owner', 'org_admin', 'facility_admin', 'med_tech']::text[]),
  ADD COLUMN rounding_clock_in_lead_minutes integer NOT NULL DEFAULT 30
    CONSTRAINT timeclock_facility_settings_rounding_lead_minutes_check CHECK (rounding_clock_in_lead_minutes BETWEEN 0 AND 240);

COMMENT ON COLUMN public.timeclock_facility_settings.rounding_owner_roles IS
  'COL-693: login roles whose on-clock staff own Smart Rounding checks at this facility when nobody is scheduled. Non-empty subset of the roles that can complete any check (owner, org_admin, facility_admin, med_tech). Default med_tech only; a missing settings row means the same default.';

COMMENT ON COLUMN public.timeclock_facility_settings.rounding_clock_in_lead_minutes IS
  'COL-693: how many minutes before a shift starts a clock-in still counts as clocking in for that shift when choosing on-clock owners (0 to 240, default 30). Staff whose opening in punch is earlier (the outgoing shift at a handoff) own the shift''s checks only when nobody clocked in for it.';

-- ---------------------------------------------------------------------------
-- 1. Who is on the clock at a facility and may own a check there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_on_clock_staff (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    staff_id uuid,
    clocked_in_at timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    s.id,
    opening.punched_at
  FROM
    public.staff s
    JOIN public.user_profiles p ON p.id = s.user_id
      AND p.organization_id = s.organization_id
    JOIN auth.users au ON au.id = p.id
    -- The in punch that opened the current stint, and where it was made.
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(tp.facility_id, tc.facility_id) AS facility_id,
        e.punched_at
      FROM
        haven.timeclock_effective_punches(s.id, p_at - interval '16 hours', p_at + interval '1 second') e
      LEFT JOIN public.time_punches tp ON e.source = 'punch'
        AND tp.id = e.punch_id
      LEFT JOIN public.time_punch_corrections tc ON e.source = 'correction'
        AND tc.id = e.punch_id
    WHERE
      e.punch_type = 'in'
    ORDER BY
      e.punched_at DESC
    LIMIT 1) opening
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.employment_status = 'active'
    AND p.is_active
    AND p.deleted_at IS NULL
    AND au.deleted_at IS NULL
    AND (au.banned_until IS NULL OR au.banned_until <= now())
    AND p.app_role::text = ANY (COALESCE((
          SELECT
            t.rounding_owner_roles
          FROM public.timeclock_facility_settings t
          WHERE
            t.organization_id = s.organization_id
            AND t.facility_id = p_facility_id), ARRAY['med_tech']))
    AND (p.app_role::text IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT
          1
        FROM
          public.user_facility_access a
        WHERE
          a.user_id = p.id
          AND a.organization_id = s.organization_id
          AND a.facility_id = p_facility_id
          AND a.revoked_at IS NULL))
    AND EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.organization_id = s.organization_id
        AND t.facility_id = p_facility_id
        AND t.timeclock_enabled)
    AND haven.timeclock_state(s.id, p_at) IN ('in', 'meal')
    AND opening.facility_id = p_facility_id;
$func$;

COMMENT ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) IS
  'COL-693: staff on the clock (in or on a meal break) at a facility whose timeclock is enabled, whose opening in punch was at that facility, whose role is in the facility''s rounding_owner_roles (default med_tech), and who could complete any check there: active profile and auth user, active staff row at the facility, facility grant unless owner or org_admin. Returns when the opening in punch was made. Private helper for the rounding owner chain.';

REVOKE ALL ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. Who owns the checks of a shift in progress: the on-clock staff who
--     clocked in for this shift (opening in punch no earlier than the shift
--     start less the facility's lead minutes), else everybody on the clock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_shift_owner_staff (p_facility_id uuid, p_at timestamptz, p_shift_starts_at timestamptz)
  RETURNS TABLE (
    staff_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH on_clock AS (
    SELECT
      c.staff_id,
      c.clocked_in_at
    FROM
      haven.observation_on_clock_staff (p_facility_id, p_at) c
),
lead AS (
  SELECT
    make_interval(mins => COALESCE((
        SELECT
          t.rounding_clock_in_lead_minutes
        FROM public.timeclock_facility_settings t
        WHERE
          t.facility_id = p_facility_id), 30)) AS lead_time
),
this_shift AS (
  SELECT
    c.staff_id
  FROM
    on_clock c,
    lead l
  WHERE
    c.clocked_in_at >= p_shift_starts_at - l.lead_time
)
SELECT
  t.staff_id
FROM
  this_shift t
UNION ALL
SELECT
  c.staff_id
FROM
  on_clock c
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      this_shift);
$func$;

COMMENT ON FUNCTION haven.observation_shift_owner_staff (uuid, timestamptz, timestamptz) IS
  'COL-693: the eligible on-clock staff who clocked in for the shift that starts at p_shift_starts_at (opening in punch no earlier than the start less timeclock_facility_settings.rounding_clock_in_lead_minutes, default 30), falling back to every eligible person on the clock only when nobody did. Keeps the outgoing shift, still clocked in at a handoff, from owning the incoming shift''s checks. Private helper.';

REVOKE ALL ON FUNCTION haven.observation_shift_owner_staff (uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The owner chain at an instant. The public resolver keeps its signature and
--    asks about now(); the unowned pass asks about the generator's tick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.resolve_observation_task_assignees_at (p_facility_id uuid, p_shift_service_date date, p_roster_shift_type text, p_resident_ids uuid[], p_at timestamptz)
  RETURNS TABLE (
    resident_id uuid,
    shift_assignment_id uuid,
    staff_id uuid,
    assignment_source text)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH scheduled AS (
    SELECT
      sa.id,
      sa.staff_id,
      sa.assigned_resident_ids
    FROM
      public.shift_assignments sa
    WHERE
      sa.facility_id = p_facility_id
      AND sa.shift_date = p_shift_service_date
      AND sa.shift_type = p_roster_shift_type::public.shift_type
      AND sa.status IN ('assigned', 'confirmed')
      AND sa.deleted_at IS NULL
),
split AS (
  SELECT DISTINCT ON (r.resident_id)
    r.resident_id,
    s.id AS shift_assignment_id,
    s.staff_id
  FROM
    unnest(p_resident_ids) AS r (resident_id)
    JOIN scheduled s ON r.resident_id = ANY (s.assigned_resident_ids)
  ORDER BY
    r.resident_id,
    s.id
),
roster AS (
  SELECT DISTINCT ON (s.staff_id)
    s.id,
    s.staff_id
  FROM
    scheduled s
  ORDER BY
    s.staff_id,
    s.id
),
ring AS (
  SELECT
    r.id,
    r.staff_id,
    row_number() OVER (ORDER BY r.staff_id, r.id) - 1 AS ring_position,
    count(*) OVER () AS ring_size
  FROM
    roster r
),
-- Which shift is being resolved, relative to the instant: the one in progress,
-- the one after it, or neither (a past shift, or a date the caller chose).
phase AS (
  SELECT
    (
      SELECT
        cur.starts_at_utc
      FROM
        public.facility_shift_window_at (p_facility_id, p_at) cur
      WHERE
        cur.shift_service_date = p_shift_service_date
        AND cur.roster_shift_type::text = p_roster_shift_type) AS current_starts_at,
    EXISTS (
      SELECT
        1
      FROM
        public.facility_next_shift_window (p_facility_id, p_at) nxt
      WHERE
        nxt.shift_service_date = p_shift_service_date
        AND nxt.roster_shift_type::text = p_roster_shift_type) AS is_next,
    EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.facility_id = p_facility_id
        AND t.timeclock_enabled) AS staffs_from_punches
),
clock_ring AS (
  SELECT
    c.staff_id,
    row_number() OVER (ORDER BY c.staff_id) - 1 AS ring_position,
    count(*) OVER () AS ring_size
  FROM
    phase ph
    CROSS JOIN LATERAL haven.observation_shift_owner_staff (p_facility_id, p_at, ph.current_starts_at) c
  WHERE
    ph.current_starts_at IS NOT NULL
    AND NOT EXISTS (
      SELECT
        1
      FROM
        scheduled)
)
SELECT
  r.resident_id,
  COALESCE(sp.shift_assignment_id, fallback.id) AS shift_assignment_id,
  COALESCE(sp.staff_id, fallback.staff_id, punched.staff_id) AS staff_id,
  CASE WHEN sp.staff_id IS NOT NULL THEN
    'resident_split'
  WHEN fallback.staff_id IS NOT NULL THEN
    'shift_roster'
  WHEN punched.staff_id IS NOT NULL THEN
    'on_clock'
  WHEN ph.is_next
    AND ph.staffs_from_punches THEN
    'awaiting_clock_in'
  ELSE
    'none_scheduled'
  END AS assignment_source
FROM
  unnest(p_resident_ids) AS r (resident_id)
  CROSS JOIN phase ph
  LEFT JOIN split sp ON sp.resident_id = r.resident_id
  LEFT JOIN LATERAL (
    SELECT
      g.id,
      g.staff_id
    FROM
      ring g
    WHERE
      sp.staff_id IS NULL
      AND g.ring_position = ((hashtextextended(r.resident_id::text, 0) % g.ring_size) + g.ring_size) % g.ring_size) fallback ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      c.staff_id
    FROM
      clock_ring c
    WHERE
      sp.staff_id IS NULL
      AND fallback.staff_id IS NULL
      AND c.ring_position = ((hashtextextended(r.resident_id::text, 0) % c.ring_size) + c.ring_size) % c.ring_size) punched ON TRUE
ORDER BY
  r.resident_id;
$func$;

COMMENT ON FUNCTION haven.resolve_observation_task_assignees_at (uuid, date, text, uuid[], timestamptz) IS
  'COL-693: the rounding owner chain at an instant -- resident_split, shift_roster, on_clock (shift in progress, nobody scheduled, eligible staff on the clock -- preferring those who clocked in for this shift -- stable hash ring), awaiting_clock_in (next shift, nobody scheduled, facility staffs from punches), else none_scheduled. Private; called by public.resolve_observation_task_assignees and public.assign_unowned_observation_tasks.';

REVOKE ALL ON FUNCTION haven.resolve_observation_task_assignees_at (uuid, date, text, uuid[], timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_observation_task_assignees (p_facility_id uuid, p_shift_service_date date, p_roster_shift_type text, p_resident_ids uuid[])
  RETURNS TABLE (
    resident_id uuid,
    shift_assignment_id uuid,
    staff_id uuid,
    assignment_source text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    a.resident_id,
    a.shift_assignment_id,
    a.staff_id,
    a.assignment_source
  FROM
    haven.resolve_observation_task_assignees_at (p_facility_id, p_shift_service_date, p_roster_shift_type, p_resident_ids, now()) a;
$func$;

COMMENT ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) IS
  'Who should own each resident''s observation tasks for one shift at one facility: the staff member the resident split already names, else a staff member scheduled for that shift chosen by a stable hash so the choice survives a re-run, else (COL-693, shift in progress, timeclock on) a staff member on the clock at the facility who can own checks there, preferring those who clocked in for this shift over the outgoing shift, chosen by the same stable hash; for the next shift at a facility that staffs from punches the answer is awaiting_clock_in with no owner; else nobody and assignment_source none_scheduled. The shift is matched on shift_assignments.shift_type, which is a fixed enum, rather than on the renameable shift_key. COL-37 ruling: definer required -- the on-clock step reads haven.timeclock_state and the punch ledgers, which are private to the timeclock and hold no service_role grant; execute stays with service_role only (the task generator), and the body writes nothing.';

REVOKE ALL ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Each generator run: give still-unowned, not yet due checks of the shift in
--    progress an owner through the same chain. Owned checks are never touched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_unowned_observation_tasks (p_facility_id uuid, p_at timestamptz DEFAULT now())
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_shift record;
  v_residents uuid[];
  v_assigned integer := 0;
BEGIN
  SELECT
    * INTO v_shift
  FROM
    public.facility_shift_window_at (p_facility_id, p_at);

  IF v_shift.shift_key IS NULL THEN
    RETURN 0;
  END IF;

  -- Lock the candidates first so a concurrent claim or completion is seen, then
  -- resolve once per resident.
  SELECT
    array_agg(DISTINCT t.resident_id) INTO v_residents
  FROM (
    SELECT
      t.resident_id
    FROM
      public.resident_observation_tasks t
    WHERE
      t.facility_id = p_facility_id
      AND t.deleted_at IS NULL
      AND t.assigned_staff_id IS NULL
      AND t.status IN ('upcoming', 'due_soon', 'due_now')
      AND t.due_at > p_at
      AND t.due_at >= v_shift.starts_at_utc
      AND t.due_at < v_shift.ends_at_utc
      AND NOT EXISTS (
        SELECT
          1
        FROM
          public.resident_observation_assignments a
        WHERE
          a.task_id = t.id
          AND a.released_at IS NULL)
    ORDER BY
      t.id
    FOR UPDATE OF t) t;

  IF v_residents IS NULL THEN
    RETURN 0;
  END IF;

  WITH owner AS (
    SELECT
      o.resident_id,
      o.shift_assignment_id,
      o.staff_id
    FROM
      haven.resolve_observation_task_assignees_at (p_facility_id, v_shift.shift_service_date, v_shift.roster_shift_type::text, v_residents, p_at) o
    WHERE
      o.staff_id IS NOT NULL
),
updated AS (
  UPDATE
    public.resident_observation_tasks t
  SET
    assigned_staff_id = o.staff_id,
    shift_assignment_id = o.shift_assignment_id
  FROM
    owner o
  WHERE
    t.resident_id = o.resident_id
    AND t.facility_id = p_facility_id
    AND t.deleted_at IS NULL
    AND t.assigned_staff_id IS NULL
    AND t.status IN ('upcoming', 'due_soon', 'due_now')
    AND t.due_at > p_at
    AND t.due_at >= v_shift.starts_at_utc
    AND t.due_at < v_shift.ends_at_utc
    AND NOT EXISTS (
      SELECT
        1
      FROM
        public.resident_observation_assignments a
      WHERE
        a.task_id = t.id
        AND a.released_at IS NULL)
  RETURNING
    t.id,
    t.organization_id,
    t.entity_id,
    t.facility_id,
    t.resident_id,
    t.shift_assignment_id,
    t.assigned_staff_id
),
recorded AS (
  INSERT INTO public.resident_observation_assignments (organization_id, entity_id, facility_id, resident_id, task_id, shift_assignment_id, staff_id, assignment_type)
  SELECT
    u.organization_id,
    u.entity_id,
    u.facility_id,
    u.resident_id,
    u.id,
    u.shift_assignment_id,
    u.assigned_staff_id,
    'primary'::public.resident_observation_assignment_type
  FROM
    updated u
  ON CONFLICT (task_id, staff_id)
    WHERE released_at IS NULL
    DO NOTHING
  RETURNING
    id
)
SELECT
  count(*)::integer INTO v_assigned
FROM
  updated;

  RETURN v_assigned;
END;
$func$;

COMMENT ON FUNCTION public.assign_unowned_observation_tasks (uuid, timestamptz) IS
  'COL-693: gives every unowned, not yet due check (upcoming, due_soon or due_now, due after p_at) of the shift in progress at the facility an owner through the rounding owner chain -- in practice the on-clock staff when nobody is scheduled -- and writes its primary assignment row. A check that already has an owner or a live assignment is never touched, so a re-run changes nothing. Returns the number of checks assigned. COL-37 ruling: definer required -- the task generator writes assignments on behalf of nobody and the chain reads the private timeclock ledgers; execute is granted to service_role only.';

REVOKE ALL ON FUNCTION public.assign_unowned_observation_tasks (uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.assign_unowned_observation_tasks (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3b. One title for the staffing gap alert, so raising and resolving it name
--     the same row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_staffing_gap_title (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    format('Nobody is scheduled for the %s at %s on %s', COALESCE((
          SELECT
            d.label
          FROM public.facility_shift_definitions d
          WHERE
            d.facility_id = p_facility_id
            AND d.shift_key = p_shift_key
            AND d.deleted_at IS NULL), 'shift'), f.name, to_char(p_service_date, 'FMMonth FMDD, YYYY'))
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id;
$func$;

COMMENT ON FUNCTION haven.observation_staffing_gap_title (uuid, text, date) IS
  'COL-693: the exec_alerts title of a rounding staffing gap for one facility, shift and service date. Shared by record_observation_staffing_gap and resolve_observation_staffing_gap so both name the same alert. Private helper.';

REVOKE ALL ON FUNCTION haven.observation_staffing_gap_title (uuid, text, date) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The staffing gap counts on-clock staff as staffed.
--
-- Changed from 423: two early returns. The shift in progress is staffed when
-- somebody eligible is on the clock. The next shift at a facility that staffs
-- from punches is not a gap yet: its owners come from punches when it starts,
-- and if nobody clocks in, the first run inside the shift raises it. Everything
-- else, including the alert shape and its de-duplication, is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_observation_staffing_gap (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_title text;
  v_recorded integer := 0;
  v_staffs_from_punches boolean;
BEGIN
  SELECT
    f.id,
    f.organization_id,
    f.entity_id,
    f.name INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.organization_id = v_facility.organization_id
        AND t.facility_id = p_facility_id
        AND t.timeclock_enabled) INTO v_staffs_from_punches;

  IF v_staffs_from_punches THEN
    IF EXISTS (
      SELECT
        1
      FROM
        public.facility_shift_window_at (p_facility_id, now()) cur
      WHERE
        cur.shift_key = p_shift_key
        AND cur.shift_service_date = p_service_date)
      AND EXISTS (
        SELECT
          1
        FROM
          haven.observation_on_clock_staff (p_facility_id, now())) THEN
      RETURN FALSE;
    END IF;

    IF EXISTS (
      SELECT
        1
      FROM
        public.facility_next_shift_window (p_facility_id, now()) nxt
      WHERE
        nxt.shift_key = p_shift_key
        AND nxt.shift_service_date = p_service_date) THEN
      RETURN FALSE;
    END IF;
  END IF;

  v_title := haven.observation_staffing_gap_title (p_facility_id, p_shift_key, p_service_date);

  INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
  SELECT
    v_facility.organization_id,
    v_facility.entity_id,
    v_facility.id,
    'staff',
    'warning',
    v_title,
    CASE WHEN v_staffs_from_punches THEN
      'Observation checks were generated for this shift and there is no staff member on the schedule or on the clock to own them. Nobody was invented as the assignee, so these checks are completable only by a med tech or an administrator until somebody clocks in at the front door or the schedule is filled in.'
    ELSE
      'Observation checks were generated for this shift and there is no staff member on the schedule to own them. Nobody was invented as the assignee, so these checks are completable only by a med tech or an administrator until the schedule is filled in. Open the schedule for this facility and this date.'
    END
  WHERE
    NOT EXISTS (
      SELECT
        1
      FROM
        public.exec_alerts existing
      WHERE
        existing.organization_id = v_facility.organization_id
        AND existing.facility_id = v_facility.id
        AND existing.title = v_title
        AND existing.resolved_at IS NULL
        AND existing.deleted_at IS NULL);

  GET DIAGNOSTICS v_recorded = ROW_COUNT;
  RETURN v_recorded > 0;
END;
$func$;

COMMENT ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) IS
  'Records an open exec_alerts row naming a facility, a shift and a service date for which observation tasks were generated and no staff member is scheduled to own them. COL-693: at a facility whose timeclock is enabled, the shift in progress is staffed when an eligible staff member is on the clock (returns false), and the next shift is not a gap until it starts (returns false). Idempotent against an unresolved alert with the same title, so a cron that ticks every few minutes raises the gap once. COL-37 ruling: definer required, because the task generator writes an executive alert on behalf of nobody and has no caller authority to inherit, and the on-clock check reads the private timeclock ledgers. Execute is granted to service_role only.';

REVOKE ALL ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. A gap that is no longer a gap. A tech who clocks in after the first tick
--    of a shift gets its checks on the next tick; the alert raised on the first
--    tick is resolved on that same tick rather than left open all shift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_observation_staffing_gap (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_resolved integer := 0;
BEGIN
  -- Staffed means: the facility staffs from punches, the named shift is the
  -- one in progress, and somebody eligible is on the clock.
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.timeclock_facility_settings t
    WHERE
      t.facility_id = p_facility_id
      AND t.timeclock_enabled)
    OR NOT EXISTS (
      SELECT
        1
      FROM
        public.facility_shift_window_at (p_facility_id, now()) cur
      WHERE
        cur.shift_key = p_shift_key
        AND cur.shift_service_date = p_service_date)
    OR NOT EXISTS (
      SELECT
        1
      FROM
        haven.observation_on_clock_staff (p_facility_id, now())) THEN
    RETURN FALSE;
  END IF;

  UPDATE
    public.exec_alerts e
  SET
    resolved_at = now(),
    status = 'resolved',
    last_evaluated_at = now(),
    current_value_json = COALESCE(e.current_value_json, '{}'::jsonb) || jsonb_build_object('resolved_reason', 'on_clock_staff', 'resolution_note', 'Resolved automatically: a staff member who can own observation checks clocked in for this shift, and the unowned checks were assigned on the next run.')
  WHERE
    e.facility_id = p_facility_id
    AND e.organization_id = (
      SELECT
        f.organization_id
      FROM
        public.facilities f
      WHERE
        f.id = p_facility_id)
    AND e.title = haven.observation_staffing_gap_title (p_facility_id, p_shift_key, p_service_date)
    AND e.resolved_at IS NULL
    AND e.deleted_at IS NULL;

  GET DIAGNOSTICS v_resolved = ROW_COUNT;
  RETURN v_resolved > 0;
END;
$func$;

COMMENT ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) IS
  'COL-693: resolves the open "Nobody is scheduled" exec alert for a facility, shift and service date when that shift is in progress at a facility whose timeclock is enabled and an eligible staff member is on the clock. Sets resolved_at, status resolved and a resolution note in current_value_json; returns true when an alert was resolved. Does nothing otherwise, so a genuine gap stays open. De-duplication of record_observation_staffing_gap is unchanged. COL-37 ruling: definer required -- the task generator resolves an executive alert on behalf of nobody and the on-clock check reads the private timeclock ledgers; execute is granted to service_role only.';

REVOKE ALL ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_observation_staffing_gap (uuid, text, date) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
