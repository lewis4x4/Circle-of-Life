-- Monitoring Order suppression becomes per window, and ending an order hands the
-- resident straight back to the standard cadence (spec 25A sections 4.3 and 5).
--
-- Before this, the task generator asked one question per resident at one
-- instant: "is an order in force right now?" If yes, it skipped that resident
-- for every window of the shift it was generating. Two failures fell out of
-- that, and the second is the serious one.
--
-- (a) An order starting later today read as not in force at tick time, so the
--     resident got the full standard cadence written across the order's hours.
--     public.create_monitoring_order excuses the standard windows when the order
--     is entered, but at that point these rows did not exist yet and nothing
--     excused them afterwards. The resident ended up carrying standard tasks and
--     order tasks over the same hours, and the standard ones ran to overdue and
--     reached the escalation ladder for checks the order had replaced.
--
-- (b) An order ending three hours into a twelve hour shift suppressed the
--     standard cadence for the whole shift. Once the order ended, that resident
--     had no observation task of any kind until the next tick. A resident coming
--     off a Monitoring Order is by definition somebody who just fell or just came
--     back from hospital, and they could go most of a shift with nobody
--     scheduled to look at them.
--
-- The same unbounded reasoning sat in public.create_monitoring_order, whose
-- excuse predicate was `due_at > starts_at` with no upper bound, so entering an
-- order that ends at 15:00 excused that evening's and that night's standard
-- windows too and nothing ever brought them back. That is fixed here as well;
-- it is disclosed rather than folded in quietly, because it is a third
-- pre-existing function body.
--
-- The fix, in three pieces:
--
--   1. one definition of what it means for an order to cover a window,
--      haven.monitoring_order_covers_window, an interval overlap rather than an
--      instant test
--   2. public.observation_windows_under_monitoring_order, which the generator
--      reads so the interval arithmetic stays in SQL next to the window rows and
--      no time enters the Edge Function
--   3. public.reinstate_standard_observation_windows, called by
--      cancel_monitoring_order and expire_monitoring_orders, so ending an order
--      puts the rest of the shift's standard windows back on the board in the
--      same transaction rather than at the next tick
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. What it means for an order to cover a window. Stated once.
--
-- The order is half open, `[starts_at, ends_at)`: an order that ends at 15:00
-- does not own 15:00. The window is closed, `[opens, closes]`: a check done at
-- the last second of its grace is done inside the window. A null ends_at is an
-- unbounded upper bound, which is what an open ended order means.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.monitoring_order_covers_window (p_order_starts_at timestamptz, p_order_ends_at timestamptz, p_window_opens_at timestamptz, p_window_closes_at timestamptz)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    tstzrange(p_order_starts_at, p_order_ends_at, '[)') && tstzrange(p_window_opens_at, p_window_closes_at, '[]');
$func$;

COMMENT ON FUNCTION haven.monitoring_order_covers_window (timestamptz, timestamptz, timestamptz, timestamptz) IS
  'True when a Monitoring Order is in force over any part of a standard observation window. The single definition of absorption in time: the generator suppresses a window when this is true, the cancel and expire commands put a window back when it is false, and public.create_monitoring_order excuses on the same test. An instant comparison here is what let a resident hold standard and order tasks over the same hours, and let a resident coming off an order go a shift with no task at all.';

REVOKE ALL ON FUNCTION haven.monitoring_order_covers_window (timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.monitoring_order_covers_window (timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The windows of one shift, given its bounds.
--
-- public.facility_next_shift_observation_windows answers this for the next
-- shift and only for the next shift, because that is all the generator needed.
-- The reinstatement path needs the shift that is running right now, so the
-- projection is expressed once here in terms of an explicit span and the
-- existing next shift function is left exactly as it is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.facility_observation_windows_in_span (p_facility_id uuid, p_shift_key text, p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (
    cadence_version_id uuid,
    window_key text,
    label text,
    shift_key text,
    service_date date,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
spanned_date AS (
  SELECT DISTINCT
    d AS local_date
  FROM
    facility fac
    CROSS JOIN LATERAL unnest(ARRAY[(p_from AT TIME ZONE fac.timezone)::date, (p_to AT TIME ZONE fac.timezone)::date]) AS d
)
SELECT
  w.cadence_version_id,
  w.window_key,
  w.label,
  w.shift_key,
  sd.local_date,
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc
FROM
  spanned_date sd
  CROSS JOIN LATERAL public.facility_observation_windows_for_date (p_facility_id, sd.local_date) w
WHERE
  w.shift_key = p_shift_key
  AND w.due_at_utc >= p_from
  AND w.due_at_utc < p_to
ORDER BY
  w.due_at_utc;
$func$;

COMMENT ON FUNCTION public.facility_observation_windows_in_span (uuid, text, timestamptz, timestamptz) IS
  'Every observation window of one shift, projected for the local dates the shift spans and filtered to the shift''s own span. The reinstatement path uses it for the shift in force now; the generator keeps using public.facility_next_shift_observation_windows for the shift ahead. Invoker rights, like the rest of the projector: cadence configuration is facility policy and the cadence tables'' own SELECT policies scope it.';

REVOKE ALL ON FUNCTION public.facility_observation_windows_in_span (uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.facility_observation_windows_in_span (uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Which of the next shift's windows a Monitoring Order actually covers.
--
-- The generator reads this instead of asking which residents are under an order.
-- The grain is the grain of the idempotency index on the task table, so the
-- generator can subtract one set from the other without doing any time
-- arithmetic of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.observation_windows_under_monitoring_order (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    resident_id uuid,
    window_key text,
    service_date date,
    monitoring_order_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    o.resident_id,
    w.window_key,
    w.service_date,
    o.id
  FROM
    public.facility_next_shift_observation_windows (p_facility_id, p_at) w
    JOIN public.resident_monitoring_orders o ON o.facility_id = p_facility_id
      AND o.status = 'active'
      AND o.deleted_at IS NULL
  WHERE
    haven.monitoring_order_covers_window (o.starts_at, o.ends_at, w.window_opens_at_utc, w.window_closes_at_utc);
$func$;

COMMENT ON FUNCTION public.observation_windows_under_monitoring_order (uuid, timestamptz) IS
  'The (resident, window, service date) triples of the next shift that an active Monitoring Order covers, at the grain of the task table''s idempotency index. The task generator subtracts these from what it would otherwise write. Suppression is per window, never per resident: an order starting at midday leaves that morning''s standard windows on the board and an order ending at midday leaves that evening''s.';

REVOKE ALL ON FUNCTION public.observation_windows_under_monitoring_order (uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.observation_windows_under_monitoring_order (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Ending an order hands the resident back to the standard cadence now.
--
-- Neither cancel nor expire regenerated or reinstated anything, so a resident
-- whose order ended three hours into a shift had no task of any kind until the
-- next generator tick. This puts the rest of the current shift back on the board
-- inside the same transaction that ends the order.
--
-- Two paths, because a window can be in either state:
--
--   reinstated  a standard task exists and was excused when the order was
--               entered. Its status goes back to upcoming. Only a task excused
--               for that reason: a task excused because the resident left the
--               building stays excused.
--   written     no standard task exists, because the generator suppressed the
--               window. It is written now, through the same writer the generator
--               uses, so it gets an assignee and its primary assignment row and
--               a second call writes nothing.
--
-- A window whose grace has already closed is not put back. Nobody can work a
-- check whose window shut an hour ago, and a task that arrives already late goes
-- straight onto the escalation ladder for a resident nobody could have helped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reinstate_standard_observation_windows (p_resident_id uuid, p_at timestamptz DEFAULT now())
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  -- The exact string public.create_monitoring_order stamps on a window it takes
  -- off the board. Anything excused for a different reason is a different
  -- decision and is not reversed here.
  c_order_excuse CONSTANT text := 'Replaced by a Monitoring Order';
  v_resident record;
  v_shift record;
  v_reinstated integer := 0;
  v_written integer := 0;
  v_windows jsonb;
  v_payload jsonb;
BEGIN
  SELECT
    r.id,
    r.organization_id,
    r.facility_id,
    r.status,
    f.entity_id INTO v_resident
  FROM
    public.residents r
    JOIN public.facilities f ON f.id = r.facility_id
      AND f.deleted_at IS NULL
  WHERE
    r.id = p_resident_id
    AND r.deleted_at IS NULL;

  -- A resident who has left the building gets nothing put back.
  IF v_resident.id IS NULL OR v_resident.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT
    cur.shift_key,
    cur.roster_shift_type,
    cur.shift_service_date,
    cur.starts_at_utc,
    cur.ends_at_utc INTO v_shift
  FROM
    public.facility_shift_window_at (v_resident.facility_id, p_at) cur;

  -- A building with no shift model in force projects nothing rather than
  -- guessing a shift of its own.
  IF v_shift.shift_key IS NULL THEN
    RETURN 0;
  END IF;

  -- The window set is resolved once and carried as jsonb rather than through a
  -- temp table: this runs inside the transaction that cancels an order, and a
  -- definer that issues DDL on that path is a re-entrancy problem waiting to
  -- happen.
  SELECT
    jsonb_agg(jsonb_build_object('cadence_version_id', w.cadence_version_id, 'window_key', w.window_key, 'service_date', w.service_date, 'window_opens_at_utc', w.window_opens_at_utc, 'due_at_utc', w.due_at_utc, 'window_closes_at_utc', w.window_closes_at_utc)) INTO v_windows
  FROM
    public.facility_observation_windows_in_span (v_resident.facility_id, v_shift.shift_key, v_shift.starts_at_utc, v_shift.ends_at_utc) w
  WHERE
    -- Still workable. Nobody can do a check whose grace shut an hour ago, and a
    -- task that arrives already late goes straight onto the escalation ladder
    -- for a resident nobody could have helped.
    w.window_closes_at_utc > p_at
    -- And not covered by an order that is still running. There is at most one
    -- active order per resident, so in practice this is the order that was just
    -- ended being already gone; it is tested rather than assumed.
    AND NOT EXISTS (
      SELECT
        1
      FROM
        public.resident_monitoring_orders o
      WHERE
        o.resident_id = p_resident_id
        AND o.status = 'active'
        AND o.deleted_at IS NULL
        AND haven.monitoring_order_covers_window (o.starts_at, o.ends_at, w.window_opens_at_utc, w.window_closes_at_utc));

  IF v_windows IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'upcoming',
    excused_reason = NULL
  FROM
    jsonb_to_recordset(v_windows) AS rw (window_key text, service_date date)
  WHERE
    t.resident_id = p_resident_id
    AND t.deleted_at IS NULL
    AND t.monitoring_order_id IS NULL
    AND t.window_key = rw.window_key
    AND t.service_date = rw.service_date
    AND t.status = 'excused'
    AND t.excused_reason = c_order_excuse;

  GET DIAGNOSTICS v_reinstated = ROW_COUNT;

  SELECT
    jsonb_agg(jsonb_build_object('organization_id', v_resident.organization_id, 'entity_id', v_resident.entity_id, 'facility_id', v_resident.facility_id, 'resident_id', p_resident_id, 'cadence_version_id', rw.cadence_version_id, 'window_key', rw.window_key, 'service_date', rw.service_date, 'shift_assignment_id', a.shift_assignment_id, 'assigned_staff_id', a.staff_id, 'scheduled_for', rw.window_opens_at_utc, 'due_at', rw.due_at_utc, 'grace_ends_at', rw.window_closes_at_utc, 'status', 'upcoming')) INTO v_payload
  FROM
    jsonb_to_recordset(v_windows) AS rw (cadence_version_id uuid, window_key text, service_date date, window_opens_at_utc timestamptz, due_at_utc timestamptz, window_closes_at_utc timestamptz)
    LEFT JOIN public.resolve_observation_task_assignees (v_resident.facility_id, v_shift.shift_service_date, v_shift.roster_shift_type::text, ARRAY[p_resident_id]) a ON a.resident_id = p_resident_id;

  IF v_payload IS NOT NULL THEN
    v_written := public.record_cadence_observation_tasks (v_payload);
  END IF;

  RETURN v_reinstated + v_written;
END;
$func$;

COMMENT ON FUNCTION public.reinstate_standard_observation_windows (uuid, timestamptz) IS
  'Puts the remainder of the current shift''s standard observation windows back on the board for a resident whose Monitoring Order has just ended, by un-excusing the tasks the order took off and writing the ones the generator suppressed. Idempotent: it runs through public.record_cadence_observation_tasks, so a second call writes nothing and duplicates no assignment row. A window whose grace has already closed is not put back, and a resident who is no longer active gets nothing. COL-37 ruling: definer required. It writes resident_observation_tasks and resident_observation_assignments on behalf of whoever cancelled the order, who has no grant on either, and it is only reachable from the two commands that end an order.';

REVOKE ALL ON FUNCTION public.reinstate_standard_observation_windows (uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reinstate_standard_observation_windows (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. create_monitoring_order stops excusing windows its order does not cover.
--
-- Changed from 416: the excuse predicate was `due_at > v_starts_at`, unbounded
-- above, so an order running 14:00 to 15:00 excused that evening's and that
-- night's standard windows as well and nothing ever brought them back. It now
-- excuses exactly the windows the order covers, on the same overlap test the
-- generator and the reinstatement path use. Everything else in this body is
-- unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_monitoring_order (p_resident_id uuid, p_interval_minutes integer, p_ordered_by_type text, p_ordered_by_name text, p_order_received_as text, p_reason_category text, p_reason_note text, p_starts_at timestamptz DEFAULT NULL, p_ends_at timestamptz DEFAULT NULL, p_review_due_at timestamptz DEFAULT NULL, p_document_path text DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_caller uuid;
  v_role text;
  v_resident record;
  v_starts_at timestamptz;
  v_order_id uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'A signed in staff member is required to enter a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  -- residents carries no entity_id; the legal entity comes from the building.
  SELECT
    r.id,
    r.organization_id,
    f.entity_id,
    r.facility_id INTO v_resident
  FROM
    public.residents r
    JOIN public.facilities f ON f.id = r.facility_id
      AND f.deleted_at IS NULL
  WHERE
    r.id = p_resident_id
    AND r.deleted_at IS NULL;

  IF v_resident.id IS NULL THEN
    RAISE EXCEPTION 'Resident not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_role := haven.app_role()::text;
  IF haven.organization_id() IS DISTINCT FROM v_resident.organization_id OR NOT haven.has_facility_access(v_resident.facility_id) THEN
    RAISE EXCEPTION 'Not allowed to enter a Monitoring Order at this facility'
      USING ERRCODE = '42501';
  END IF;
  IF NOT haven.can_record_observation(v_role) THEN
    RAISE EXCEPTION 'This role cannot enter a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.user_profiles up
    WHERE
      up.id = v_caller
      AND up.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The signed in user has no staff profile to record against'
      USING ERRCODE = '42501';
  END IF;

  -- The one defensible default in this command. Everything else the operator
  -- states; the start of a clinical instruction is now unless they say
  -- otherwise, and a blank start time on a 21:00 discharge is a worse answer.
  v_starts_at := COALESCE(p_starts_at, now());

  IF p_ends_at IS NULL AND p_review_due_at IS NULL THEN
    RAISE EXCEPTION 'An open ended Monitoring Order needs a review date, so somebody has to decide about it again'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders existing
    WHERE
      existing.resident_id = p_resident_id
      AND existing.status = 'active'
      AND existing.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This resident is already on a Monitoring Order. Cancel it before entering a different interval.'
      USING ERRCODE = '23505';
  END IF;

  -- Status active on the first write. There is no pending state to pass through
  -- and nothing waits on anybody's approval.
  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, document_path, entered_by, created_by, status)
    VALUES (v_resident.organization_id, v_resident.entity_id, v_resident.facility_id, p_resident_id, p_interval_minutes, v_starts_at, p_ends_at, p_review_due_at, p_ordered_by_type, btrim(p_ordered_by_name), p_order_received_as, p_reason_category, btrim(p_reason_note), NULLIF(btrim(COALESCE(p_document_path, '')), ''), v_caller, v_caller, 'active')
  RETURNING
    id INTO v_order_id;

  -- The standard windows this order covers stop for this resident. Tasks on the
  -- board for a covered window would otherwise run to overdue and reach the
  -- escalation ladder for a check the order replaced.
  --
  -- Covered, not merely later. scheduled_for and grace_ends_at are the window's
  -- own span, and haven.monitoring_order_covers_window is the same overlap test
  -- the generator suppresses on, so the two cannot disagree about which windows
  -- an order owns. An order that ends at 15:00 leaves that evening's windows
  -- exactly where they are.
  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'excused',
    excused_reason = 'Replaced by a Monitoring Order'
  WHERE
    t.resident_id = p_resident_id
    AND t.deleted_at IS NULL
    AND t.monitoring_order_id IS NULL
    AND t.window_key IS NOT NULL
    AND t.status IN ('upcoming', 'due_soon')
    AND haven.monitoring_order_covers_window (v_starts_at, p_ends_at, t.scheduled_for, t.grace_ends_at);

  PERFORM
    public.generate_monitoring_order_tasks (v_resident.facility_id, NULL);

  PERFORM
    haven.notify_monitoring_order_created (v_order_id);

  RETURN v_order_id;
END;
$func$;

COMMENT ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) IS
  'Enters a Monitoring Order and puts it in force immediately. Resident Aide and above at a facility the caller can reach. Excuses exactly the standard windows the order covers, writes the first order tasks and queues the administrator notification. There is no approval step. COL-37 ruling: definer required -- a caregiver has no INSERT grant on resident_observation_tasks and no write path to the notification ledger, and the command re-checks organization, facility access and role itself before writing anything.';

-- ---------------------------------------------------------------------------
-- 6. cancel_monitoring_order hands the resident back.
--
-- Changed from 416: the reinstatement call at the end. Every authorization
-- check, the status guard and the order task stand down are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_monitoring_order (p_order_id uuid, p_reason text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_caller uuid;
  v_role text;
  v_order record;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'A signed in staff member is required to cancel a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Say why the Monitoring Order is being stood down'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    o.id,
    o.organization_id,
    o.facility_id,
    o.resident_id,
    o.status INTO v_order
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.id = p_order_id
    AND o.deleted_at IS NULL;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Monitoring Order not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_role := haven.app_role()::text;
  IF haven.organization_id() IS DISTINCT FROM v_order.organization_id OR NOT haven.has_facility_access(v_order.facility_id) THEN
    RAISE EXCEPTION 'Not allowed to cancel a Monitoring Order at this facility'
      USING ERRCODE = '42501';
  END IF;
  IF NOT haven.can_cancel_monitoring_order(v_role) THEN
    RAISE EXCEPTION 'This role cannot cancel a Monitoring Order'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.status <> 'active' THEN
    RAISE EXCEPTION 'This Monitoring Order is not active'
      USING ERRCODE = '22023';
  END IF;

  UPDATE
    public.resident_monitoring_orders o
  SET
    status = 'cancelled',
    cancelled_by = v_caller,
    cancelled_at = now(),
    cancel_reason = btrim(p_reason)
  WHERE
    o.id = p_order_id;

  -- Order tasks that have not come due yet go with it.
  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'excused',
    excused_reason = 'Monitoring Order cancelled'
  WHERE
    t.monitoring_order_id = p_order_id
    AND t.deleted_at IS NULL
    AND t.status IN ('upcoming', 'due_soon')
    AND t.due_at > now();

  -- And the standard cadence comes straight back, in this transaction. Waiting
  -- for the next generator tick left a resident who had just fallen with no
  -- observation task at all for the rest of the shift.
  PERFORM
    public.reinstate_standard_observation_windows (v_order.resident_id, now());

  RETURN p_order_id;
END;
$func$;

COMMENT ON FUNCTION public.cancel_monitoring_order (uuid, text) IS
  'Stands a Monitoring Order down with a stated reason, excuses its not yet worked tasks, and puts the rest of the current shift''s standard windows back on the board in the same transaction. facility_admin, manager, org_admin and owner only. The append only history row is written by the table trigger, not here. COL-37 ruling: definer required -- the command also excuses and writes resident_observation_tasks rows, which the caller has no grant to touch, and it re-checks organization, facility access and role before writing.';

-- ---------------------------------------------------------------------------
-- 7. expire_monitoring_orders does the same for every order it ends.
--
-- Changed from 416: the expiry UPDATE now returns the residents it touched and
-- each of them is handed back to the standard cadence. The rule about never
-- expiring an open ended order is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_monitoring_orders ()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
  v_residents uuid[];
  v_resident uuid;
BEGIN
  -- Only an order with an end date that has passed. An open ended order whose
  -- review date is in the past stays active on purpose: expiring it would end
  -- the elevated observation for a resident nobody has looked at again, and
  -- silently. It surfaces as the monitoring_order_review_overdue Watchlist
  -- signal instead, which is a person being asked to decide.
  WITH expired AS (
    UPDATE
      public.resident_monitoring_orders o
    SET
      status = 'expired'
    WHERE
      o.status = 'active'
      AND o.deleted_at IS NULL
      AND o.ends_at IS NOT NULL
      AND o.ends_at <= now()
    RETURNING
      o.resident_id
)
  SELECT
    count(*)::integer,
    COALESCE(array_agg(DISTINCT resident_id), ARRAY[]::uuid[]) INTO v_rows,
    v_residents
  FROM
    expired;

  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'excused',
    excused_reason = 'Monitoring Order ended'
  FROM
    public.resident_monitoring_orders o
  WHERE
    t.monitoring_order_id = o.id
    AND o.status = 'expired'
    AND t.deleted_at IS NULL
    AND t.status IN ('upcoming', 'due_soon')
    AND t.due_at > now();

  -- Every resident whose order just ended goes back on the standard cadence for
  -- the rest of the shift they are in, rather than waiting for the next tick.
  FOREACH v_resident IN ARRAY v_residents LOOP
    PERFORM
      public.reinstate_standard_observation_windows (v_resident, now());
  END LOOP;

  RETURN v_rows;
END;
$func$;

COMMENT ON FUNCTION public.expire_monitoring_orders () IS
  'Expires Monitoring Orders whose end date has passed, excuses their remaining order tasks, and puts each resident back on the standard cadence for the rest of the shift they are in. Never expires an open ended order, whatever its review date says; a past review date is a Watchlist signal, not an expiry. Scheduled job surface, service_role only.';

REVOKE ALL ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_monitoring_order (uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.cancel_monitoring_order (uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expire_monitoring_orders () FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expire_monitoring_orders () TO service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
