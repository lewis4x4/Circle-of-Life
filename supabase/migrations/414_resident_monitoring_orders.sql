-- Smart Rounding: Monitoring Orders.
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 4, 5.2,
-- 7.2, 9, 10, 12 items 5 and 6.
--
-- A Monitoring Order is a clinical instruction to observe a resident more often
-- than the standard cadence, for a defined window, at a defined interval,
-- requested by a named party for a stated reason. Any staff member from Resident
-- Aide up may enter one and it takes effect immediately. There is no approval
-- queue, no pending state and no approval column anywhere in this file, and a
-- later part must not add one: spec decision 5 is that the ordering party
-- carries the authority and the person keying it in does not need rank. The
-- facility administrator and the standing alert audience are notified through
-- notification_routes, not asked.
--
-- Absorption is the hard part, and it is expectation derived rather than row
-- derived. While an order is active the standard windows stop generating for
-- that resident, so there is no standard task row left to mark satisfied. Any
-- implementation that counts task rows reports a resident on 30 minute checks as
-- missing six windows a day, which is precisely the dishonesty this feature
-- exists to prevent. public.v_resident_observation_compliance therefore projects
-- the windows the cadence version in force defines for the service date and
-- marks one satisfied when any observation log for that resident falls inside
-- its span, whichever kind of task produced the log.
--
-- Grace scales with the interval by a single rule that the standard cadence also
-- falls out of. public.monitoring_order_grace_minutes is the only place that
-- rule lives. Its divisor and bounds are read from haven.observation_grace_formula
-- so the cadence configuration work can move them into a row without touching a
-- caller.
--
-- No named person, no resident identifying data and no QuickMAR read or write
-- appears here. Nothing in this file mutates a medication order or a MAR row.

BEGIN;

-- ---------------------------------------------------------------------------
-- Who may record an observation and who may order one.
--
-- "Resident Aide and above" is a staff_role phrase; SQL permission gates run on
-- the app_role enum that haven.app_role() returns, which has no resident_aide
-- and no assistant_administrator. The resolved list is recorded in
-- HANDOFFS/2026-09-16__smart-rounding-build-notes.md section 1.5. It lived
-- inline in public.submit_observation until this migration; it now lives here
-- once and that function calls it, so the two surfaces cannot drift apart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.can_record_observation (p_role text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT p_role = ANY (ARRAY['caregiver', 'med_tech', 'nurse', 'manager', 'coordinator', 'admin_assistant', 'facility_admin', 'org_admin', 'owner']);
$func$;

COMMENT ON FUNCTION haven.can_record_observation (text) IS
  'True when an app_role may record an observation or enter a Monitoring Order. Resident Aide and above, resolved onto the authentication role enum. The single definition; public.submit_observation, the Monitoring Order commands and the row level security policies all read it.';

CREATE OR REPLACE FUNCTION haven.can_record_observation ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT haven.can_record_observation (haven.app_role ()::text);
$func$;

COMMENT ON FUNCTION haven.can_record_observation () IS
  'The signed in caller''s form of haven.can_record_observation(text). Used by row level security policies, which have no role argument to hand it.';

CREATE OR REPLACE FUNCTION haven.can_cancel_monitoring_order (p_role text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT p_role = ANY (ARRAY['facility_admin', 'manager', 'org_admin', 'owner']);
$func$;

COMMENT ON FUNCTION haven.can_cancel_monitoring_order (text) IS
  'True when an app_role may cancel a Monitoring Order. Spec section 10: entering one is floor work, standing one down is not. manager stands in for the spec''s assistant_administrator, which exists only on the staff_role enum.';

REVOKE ALL ON FUNCTION haven.can_record_observation (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_record_observation (text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.can_record_observation () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_record_observation () TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.can_cancel_monitoring_order (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_cancel_monitoring_order (text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Interval scaled grace. One rule, two callers.
--
-- A 60 minute grace on a 30 minute order is incoherent, so grace scales with
-- the interval. The standard 240 minute spacing falls out of the same formula at
-- 60 minutes, which is the point: there is one rule, not two. The escalation
-- work reads this function rather than restating the arithmetic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_grace_formula ()
  RETURNS TABLE (
    divisor numeric,
    floor_minutes integer,
    ceiling_minutes integer)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    4.0::numeric,
    10,
    60;
$func$;

COMMENT ON FUNCTION haven.observation_grace_formula () IS
  'The divisor and the bounds of the interval scaled grace rule, as seed values. Seeded configuration, not a constant: the cadence configuration work replaces this body with a read from a facility row and no caller changes, because every caller goes through public.monitoring_order_grace_minutes.';

CREATE OR REPLACE FUNCTION public.monitoring_order_grace_minutes (p_interval_minutes integer)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = public, haven, pg_catalog
  AS $func$
  SELECT
    LEAST(g.ceiling_minutes, GREATEST(g.floor_minutes, ceil(p_interval_minutes::numeric / g.divisor)::integer))
  FROM
    haven.observation_grace_formula () g;
$func$;

COMMENT ON FUNCTION public.monitoring_order_grace_minutes (integer) IS
  'Grace in minutes for an observation interval, per spec section 5.2: LEAST(ceiling, GREATEST(floor, CEIL(interval / divisor))). 30 gives 10, 60 gives 15, 120 gives 30, 240 gives 60. The single definition of the rule; the escalation engine and the Monitoring Order task writer both read it rather than restating it.';

REVOKE ALL ON FUNCTION haven.observation_grace_formula () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.observation_grace_formula () TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.monitoring_order_grace_minutes (integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monitoring_order_grace_minutes (integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The order itself
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_monitoring_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid NULL REFERENCES public.entities (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  -- Set only on an order the care event bridge created from a watch instance.
  source_watch_instance_id uuid NULL REFERENCES public.resident_watch_instances (id),
  interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 15 AND 720),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NULL,
  review_due_at timestamptz NULL,
  ordered_by_type text NOT NULL CHECK (ordered_by_type IN ('physician', 'hospital_discharge', 'home_health_nurse', 'hospice_nurse', 'facility_nurse', 'facility_admin')),
  ordered_by_name text NOT NULL CHECK (char_length(btrim(ordered_by_name)) BETWEEN 1 AND 120),
  order_received_as text NOT NULL CHECK (order_received_as IN ('verbal', 'written_order', 'discharge_paperwork', 'fax')),
  reason_category text NOT NULL CHECK (reason_category IN ('post_hospital_return', 'post_fall', 'change_in_condition', 'behavior', 'skin_or_wound', 'elopement_risk', 'other')),
  reason_note text NOT NULL CHECK (char_length(btrim(reason_note)) BETWEEN 1 AND 1000),
  document_path text NULL,
  entered_by uuid NOT NULL REFERENCES public.user_profiles (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
  cancelled_by uuid NULL REFERENCES public.user_profiles (id),
  cancelled_at timestamptz NULL,
  cancel_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT resident_monitoring_orders_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
  -- An order with no end date and no review date runs forever and nobody ever
  -- has to decide about it again. The spec forces the decision at the table, not
  -- in a form, so a direct writer cannot skip it either.
  CONSTRAINT resident_monitoring_orders_review_required CHECK (ends_at IS NOT NULL OR review_due_at IS NOT NULL),
  CONSTRAINT resident_monitoring_orders_review_after_start CHECK (review_due_at IS NULL OR review_due_at > starts_at),
  -- The three cancellation fields are one fact and arrive together or not at all.
  CONSTRAINT resident_monitoring_orders_cancel_fields CHECK ((status = 'cancelled'
      AND cancelled_by IS NOT NULL
      AND cancelled_at IS NOT NULL
      AND char_length(btrim(COALESCE(cancel_reason, ''))) > 0)
    OR (status <> 'cancelled'
      AND cancelled_by IS NULL
      AND cancelled_at IS NULL
      AND cancel_reason IS NULL)),
  -- document_path is a path inside a private storage bucket. A scheme means
  -- somebody stored a link instead, and a link to discharge paperwork is a link
  -- to protected health information.
  CONSTRAINT resident_monitoring_orders_document_path_private CHECK (document_path IS NULL OR document_path !~* '^[a-z][a-z0-9+.-]*://')
);

-- Two concurrent active orders at different intervals for one resident is
-- incoherent and absorption cannot resolve it: neither interval is the one the
-- resident is actually on. At most one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_monitoring_orders_one_active
  ON public.resident_monitoring_orders (resident_id)
  WHERE status = 'active' AND deleted_at IS NULL;

-- The task generator's hot path: every active order at one facility, on every
-- tick, and every active order for one resident on the resident record.
CREATE INDEX IF NOT EXISTS idx_resident_monitoring_orders_facility_status
  ON public.resident_monitoring_orders (facility_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resident_monitoring_orders_resident_status
  ON public.resident_monitoring_orders (resident_id, status)
  WHERE deleted_at IS NULL;

-- One order per watch instance, which is what keeps the bridge trigger from
-- creating a second one when a row is touched again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_monitoring_orders_watch_instance
  ON public.resident_monitoring_orders (source_watch_instance_id)
  WHERE source_watch_instance_id IS NOT NULL AND deleted_at IS NULL;

-- The monitoring_order_review_overdue Watchlist signal reads this.
CREATE INDEX IF NOT EXISTS idx_resident_monitoring_orders_review_due
  ON public.resident_monitoring_orders (facility_id, review_due_at)
  WHERE status = 'active' AND deleted_at IS NULL AND review_due_at IS NOT NULL;

COMMENT ON TABLE public.resident_monitoring_orders IS
  'A clinical instruction to observe a resident more often than the facility cadence, for a defined window, at a defined interval, from a named ordering party for a stated reason. Takes effect on insert: there is no approval queue, no pending state and no approval column, by spec decision 5.';
COMMENT ON COLUMN public.resident_monitoring_orders.interval_minutes IS
  'Spacing between order checks. The form offers presets and a custom value; the table accepts 15 to 720. Grace comes from public.monitoring_order_grace_minutes, never from a second field.';
COMMENT ON COLUMN public.resident_monitoring_orders.review_due_at IS
  'When an open ended order must be decided about again. Required when ends_at is null. An order past its review date stays active and surfaces as a Watchlist signal; it is never silently expired.';
COMMENT ON COLUMN public.resident_monitoring_orders.document_path IS
  'Path inside a private storage bucket holding the discharge paperwork or faxed order. Never a public URL, and never rendered as one.';
COMMENT ON COLUMN public.resident_monitoring_orders.source_watch_instance_id IS
  'The resident_watch_instances row this order was bridged from, when any. resident_watch_instances stays the care event integration point; Monitoring Orders is the single operator facing model.';
COMMENT ON COLUMN public.resident_monitoring_orders.status IS
  'active, completed, cancelled or expired. Text plus CHECK, matching the observation module. There is deliberately no pending or awaiting_approval value.';

-- ---------------------------------------------------------------------------
-- Append only status history.
--
-- Written by a trigger rather than by each command, so no writer -- including a
-- direct UPDATE by a service role script -- can move an order between statuses
-- without leaving the row behind. No UPDATE policy and no DELETE policy: append
-- only means append only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_monitoring_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  monitoring_order_id uuid NOT NULL REFERENCES public.resident_monitoring_orders (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  from_status text NULL,
  to_status text NOT NULL,
  note text NULL,
  actor_id uuid NULL REFERENCES public.user_profiles (id),
  actor_role text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resident_monitoring_order_events_order
  ON public.resident_monitoring_order_events (monitoring_order_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_resident_monitoring_order_events_facility
  ON public.resident_monitoring_order_events (facility_id, occurred_at DESC);

COMMENT ON TABLE public.resident_monitoring_order_events IS
  'Append only status history for resident_monitoring_orders, one row per transition including the opening one. Written by tr_resident_monitoring_orders_history so a writer cannot skip it. No UPDATE or DELETE policy and no write grant to authenticated.';

-- ---------------------------------------------------------------------------
-- Notification ledger.
--
-- Spec section 4.3 says creating an order notifies the facility administrator
-- and the standing alert audience through notification_routes. The repository
-- has no general delivery queue -- care events carry their own -- so this is the
-- one for this module, shaped like public.care_event_deliveries so a single
-- sender can eventually serve both. Rows are queued here; nothing in this
-- migration sends anything.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_monitoring_order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  monitoring_order_id uuid NOT NULL REFERENCES public.resident_monitoring_orders (id),
  notification_route_id uuid NULL REFERENCES public.notification_routes (id),
  target_role text NOT NULL,
  target_user_id uuid NULL REFERENCES public.user_profiles (id),
  target_phone text NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms', 'voice', 'email')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason text NULL,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resident_monitoring_order_notifications_pending
  ON public.resident_monitoring_order_notifications (status, send_after)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_resident_monitoring_order_notifications_order
  ON public.resident_monitoring_order_notifications (monitoring_order_id, created_at DESC);

COMMENT ON TABLE public.resident_monitoring_order_notifications IS
  'Queued notifications for a new Monitoring Order, resolved through notification_routes with the administrator and organization admin fallback that care events use. The administrator is told, not asked: nothing here gates the order.';

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.resident_monitoring_orders, public.resident_monitoring_order_events,
  public.resident_monitoring_order_notifications FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.resident_monitoring_orders TO authenticated;
-- Read only for authenticated on both ledgers. Their rows come from the history
-- trigger and the create command, which run as definers.
GRANT SELECT ON public.resident_monitoring_order_events TO authenticated;
GRANT SELECT ON public.resident_monitoring_order_notifications TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_monitoring_orders TO service_role;
GRANT SELECT, INSERT ON public.resident_monitoring_order_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.resident_monitoring_order_notifications TO service_role;

ALTER TABLE public.resident_monitoring_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_monitoring_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_monitoring_order_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_monitoring_orders_select ON public.resident_monitoring_orders;
CREATE POLICY resident_monitoring_orders_select ON public.resident_monitoring_orders
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- Resident Aide and above, at a facility the caller can reach, and only ever
-- straight to active. A row may not be inserted as cancelled or expired, and
-- there is no status this policy admits that means "waiting for somebody".
DROP POLICY IF EXISTS resident_monitoring_orders_insert ON public.resident_monitoring_orders;
CREATE POLICY resident_monitoring_orders_insert ON public.resident_monitoring_orders
  FOR INSERT
  WITH CHECK (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.can_record_observation ()
    AND status = 'active'
    AND entered_by = auth.uid ());

-- Standing an order down is the restricted half of spec section 10.
DROP POLICY IF EXISTS resident_monitoring_orders_update ON public.resident_monitoring_orders;
CREATE POLICY resident_monitoring_orders_update ON public.resident_monitoring_orders
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.can_cancel_monitoring_order (haven.app_role ()::text))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_cancel_monitoring_order (haven.app_role ()::text));

DROP POLICY IF EXISTS resident_monitoring_order_events_select ON public.resident_monitoring_order_events;
CREATE POLICY resident_monitoring_order_events_select ON public.resident_monitoring_order_events
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- No INSERT, UPDATE or DELETE policy on the history table. Deliberate.

DROP POLICY IF EXISTS resident_monitoring_order_notifications_select ON public.resident_monitoring_order_notifications;
CREATE POLICY resident_monitoring_order_notifications_select ON public.resident_monitoring_order_notifications
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- ---------------------------------------------------------------------------
-- Updated at, audit and history triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_resident_monitoring_orders_set_updated_at ON public.resident_monitoring_orders;
CREATE TRIGGER tr_resident_monitoring_orders_set_updated_at
  BEFORE UPDATE ON public.resident_monitoring_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_resident_monitoring_orders_audit ON public.resident_monitoring_orders;
CREATE TRIGGER tr_resident_monitoring_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_monitoring_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

CREATE OR REPLACE FUNCTION haven.record_monitoring_order_event ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_actor uuid;
  v_role text;
  v_note text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.entered_by);
    v_note := NULL;
  ELSE
    v_actor := COALESCE(NEW.cancelled_by, auth.uid(), NEW.entered_by);
    v_note := CASE WHEN NEW.status = 'cancelled' THEN
      NEW.cancel_reason
    ELSE
      NULL
    END;
  END IF;

  SELECT
    profile.app_role::text INTO v_role
  FROM
    public.user_profiles AS profile
  WHERE
    profile.id = v_actor;

  INSERT INTO public.resident_monitoring_order_events (organization_id, facility_id, monitoring_order_id, resident_id, from_status, to_status, note, actor_id, actor_role)
    VALUES (NEW.organization_id, NEW.facility_id, NEW.id, NEW.resident_id, CASE WHEN TG_OP = 'INSERT' THEN
        NULL
      ELSE
        OLD.status
      END, NEW.status, v_note, v_actor, v_role);

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.record_monitoring_order_event () IS
  'Writes the append only status history row for a Monitoring Order. A definer so the history lands whatever the writer''s authority is, and so a writer with UPDATE on the order table cannot move a status without leaving the trail.';

DROP TRIGGER IF EXISTS tr_resident_monitoring_orders_history ON public.resident_monitoring_orders;
CREATE TRIGGER tr_resident_monitoring_orders_history
  AFTER INSERT OR UPDATE ON public.resident_monitoring_orders
  FOR EACH ROW
  EXECUTE FUNCTION haven.record_monitoring_order_event ();

-- ---------------------------------------------------------------------------
-- Order tasks are resident_observation_tasks rows.
--
-- How a later part tells the two apart, stated once and relied on by the
-- Watchlist, the module shell, the settings surface and the verification work:
--
--   order task     monitoring_order_id IS NOT NULL AND window_key IS NULL
--   cadence task   monitoring_order_id IS NULL     AND window_key IS NOT NULL
--   legacy task    monitoring_order_id IS NULL AND window_key IS NULL
--                  (a per resident observation plan rule, plan_rule_id set)
--
-- window_key stays null on an order task on purpose. An order check is not a
-- standard window and must never be counted as one; what it does to a standard
-- window is absorption, which the compliance view computes from the log's
-- observation time, not from the task row. Stamping a reserved window key would
-- put an order check into the cadence idempotency index and make the two kinds
-- collide the moment an order started inside a standard window's span.
--
-- service_date is stamped on both kinds, so a report can group an order check
-- onto the facility local day it belongs to.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_observation_tasks
  ADD COLUMN IF NOT EXISTS monitoring_order_id uuid NULL REFERENCES public.resident_monitoring_orders (id);

COMMENT ON COLUMN public.resident_observation_tasks.monitoring_order_id IS
  'The Monitoring Order that generated this task. Null on a facility cadence task and on a legacy plan task. An order task carries this and a null window_key; the two kinds never share a row.';

-- Idempotency for order tasks, the analogue of idx_obs_tasks_window_occurrence.
-- A second generator tick inserts nothing.
-- The compliance view asks, once per projected window, whether this resident has
-- any log inside that span. The logs table indexes resident_id with entered_at,
-- which is when the row was keyed, not observed_at, which is when the caregiver
-- was in the room. Absorption compares against observed_at, so it gets the
-- resident from the existing index and then filters. This is the module's
-- hottest read; give it the column it actually orders by.
CREATE INDEX IF NOT EXISTS idx_obs_logs_resident_observed
  ON public.resident_observation_logs (resident_id, observed_at)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_tasks_order_occurrence
  ON public.resident_observation_tasks (monitoring_order_id, due_at)
  WHERE deleted_at IS NULL AND monitoring_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_obs_tasks_order_resident_due
  ON public.resident_observation_tasks (resident_id, due_at DESC)
  WHERE deleted_at IS NULL AND monitoring_order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Order task generation.
--
-- Order tasks land at interval_minutes from starts_at, with grace from the one
-- interval scaled rule. The horizon defaults to the end of the next shift, which
-- is the same horizon the cadence generator works to, read from the facility's
-- own shift definitions rather than from a number in this file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_monitoring_order_tasks (p_facility_id uuid DEFAULT NULL, p_through timestamptz DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_order record;
  v_timezone text;
  v_horizon timestamptz;
  v_grace integer;
  v_rows integer;
  v_inserted integer := 0;
BEGIN
  FOR v_order IN
  SELECT
    o.id,
    o.organization_id,
    o.entity_id,
    o.facility_id,
    o.resident_id,
    o.interval_minutes,
    o.starts_at,
    o.ends_at
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.status = 'active'
    AND o.deleted_at IS NULL
    AND (p_facility_id IS NULL OR o.facility_id = p_facility_id)
  ORDER BY
    o.facility_id,
    o.starts_at LOOP
      SELECT
        COALESCE(f.timezone, 'America/New_York') INTO v_timezone
      FROM
        public.facilities f
      WHERE
        f.id = v_order.facility_id;

      IF p_through IS NOT NULL THEN
        v_horizon := p_through;
      ELSE
        SELECT
          nxt.ends_at_utc INTO v_horizon
        FROM
          public.facility_next_shift_window (v_order.facility_id, now()) nxt;
      END IF;

      -- A facility with no shift definitions yet generates nothing rather than
      -- guessing a horizon of its own.
      IF v_horizon IS NULL THEN
        CONTINUE;
      END IF;

      -- Safety stop. Nothing should ask for more than a week of order tasks in
      -- one call, and a 15 minute order over an open ended horizon would try to
      -- write forever.
      v_horizon := LEAST(v_horizon, now() + interval '7 days');
      IF v_order.ends_at IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_order.ends_at);
      END IF;
      IF v_horizon < v_order.starts_at THEN
        CONTINUE;
      END IF;

      v_grace := public.monitoring_order_grace_minutes (v_order.interval_minutes);

      INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, monitoring_order_id, service_date, scheduled_for, due_at, grace_ends_at, status)
      SELECT
        v_order.organization_id,
        v_order.entity_id,
        v_order.facility_id,
        v_order.resident_id,
        v_order.id,
        ((occurrence AT TIME ZONE v_timezone)::date),
        occurrence,
        occurrence,
        occurrence + make_interval(mins => v_grace),
        'upcoming'::public.resident_observation_task_status
      FROM
        generate_series(v_order.starts_at, v_horizon, make_interval(mins => v_order.interval_minutes)) AS occurrence
      WHERE
        -- Never backfill a check nobody could have done. An order entered at
        -- 21:00 with a start time of 21:00 produces its first task at 21:00, not
        -- a row for every interval since the paperwork was signed.
        occurrence + make_interval(mins => v_grace) >= now()
      ON CONFLICT (monitoring_order_id, due_at)
        WHERE deleted_at IS NULL AND monitoring_order_id IS NOT NULL
        DO NOTHING;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_inserted := v_inserted + v_rows;
    END LOOP;

  RETURN v_inserted;
END;
$func$;

COMMENT ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) IS
  'Writes the observation tasks an active Monitoring Order is due, at interval_minutes from starts_at with grace from public.monitoring_order_grace_minutes, out to the end of the next shift or to an explicit horizon. Idempotent: a second call inserts nothing. COL-37 ruling: definer required -- the task generator calls it as service_role and the create command calls it on behalf of a caregiver who has no INSERT grant on resident_observation_tasks, and it writes only rows derived from orders the caller already had to be permitted to create. Not granted to authenticated.';

REVOKE ALL ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monitoring_order_tasks (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Notify the administrator and the standing alert audience.
--
-- Same resolution care events use: the facility's active notification_routes
-- rows, their staff_role_targets and user_targets, and the administrator or
-- organization admin fallback when a facility has no route configured. No role,
-- recipient or channel is named in this function beyond the fallback, which
-- exists so a facility that has configured nothing still reaches somebody.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.notify_monitoring_order_created (p_order_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_order record;
  v_route record;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_had_target boolean := FALSE;
BEGIN
  SELECT
    o.id,
    o.organization_id,
    o.facility_id INTO v_order
  FROM
    public.resident_monitoring_orders o
  WHERE
    o.id = p_order_id
    AND o.deleted_at IS NULL;

  IF v_order.id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_route IN
  SELECT
    nr.id,
    nr.name,
    nr.channels,
    nr.staff_role_targets,
    nr.user_targets
  FROM
    public.notification_routes nr
  WHERE
    nr.organization_id = v_order.organization_id
    AND (nr.facility_id IS NULL OR nr.facility_id = v_order.facility_id)
    AND nr.is_active
    AND nr.deleted_at IS NULL LOOP
      FOREACH v_channel IN ARRAY COALESCE(v_route.channels, ARRAY[]::text[])
      LOOP
        IF v_channel NOT IN ('in_app', 'push', 'sms', 'voice', 'email') THEN
          CONTINUE;
        END IF;

        INSERT INTO public.resident_monitoring_order_notifications (organization_id, facility_id, monitoring_order_id, notification_route_id, target_role, target_user_id, target_phone, channel, status)
        SELECT DISTINCT
          v_order.organization_id,
          v_order.facility_id,
          v_order.id,
          v_route.id,
          COALESCE(v_route.name, 'route'),
          recipient.user_id,
          recipient.phone,
          v_channel,
          'queued'
        FROM (
          SELECT
            s.user_id,
            NULLIF(btrim(s.phone), '') AS phone
          FROM
            public.staff s
          WHERE
            s.organization_id = v_order.organization_id
            AND s.facility_id = v_order.facility_id
            AND s.employment_status = 'active'
            AND s.deleted_at IS NULL
            AND s.user_id IS NOT NULL
            AND v_route.staff_role_targets IS NOT NULL
            AND s.staff_role = ANY (v_route.staff_role_targets)
          UNION
          SELECT
            up.id,
            NULLIF(btrim(up.phone), '')
          FROM
            public.user_profiles up
          WHERE
            v_route.user_targets IS NOT NULL
            AND up.id = ANY (v_route.user_targets)
            AND up.organization_id = v_order.organization_id
            AND up.is_active
            AND up.deleted_at IS NULL) recipient
      WHERE
        EXISTS (
          SELECT
            1
          FROM
            public.user_profiles keep
          WHERE
            keep.id = recipient.user_id);

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_queued := v_queued + v_rows;
        IF v_rows > 0 THEN
          v_had_target := TRUE;
        END IF;
      END LOOP;
    END LOOP;

  -- Nothing configured, or nothing the routes resolved to. The administrator
  -- still hears about it.
  IF NOT v_had_target THEN
    INSERT INTO public.resident_monitoring_order_notifications (organization_id, facility_id, monitoring_order_id, notification_route_id, target_role, target_user_id, target_phone, channel, status)
    SELECT
      v_order.organization_id,
      v_order.facility_id,
      v_order.id,
      NULL,
      up.app_role::text,
      up.id,
      NULLIF(btrim(up.phone), ''),
      'in_app',
      'queued'
    FROM
      public.user_profiles up
    WHERE
      up.organization_id = v_order.organization_id
      AND up.is_active
      AND up.deleted_at IS NULL
      AND (up.app_role IN ('owner', 'org_admin')
        OR (up.app_role IN ('facility_admin', 'admin_assistant')
          AND EXISTS (
            SELECT
              1
            FROM
              public.user_facility_access ufa
            WHERE
              ufa.user_id = up.id
              AND ufa.facility_id = v_order.facility_id
              AND ufa.revoked_at IS NULL)));

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;

    IF v_rows = 0 THEN
      INSERT INTO public.resident_monitoring_order_notifications (organization_id, facility_id, monitoring_order_id, notification_route_id, target_role, target_user_id, target_phone, channel, status, skip_reason)
        VALUES (v_order.organization_id, v_order.facility_id, v_order.id, NULL, 'facility_administrator', NULL, NULL, 'in_app', 'skipped', 'no_target');
      v_queued := v_queued + 1;
    END IF;
  END IF;

  RETURN v_queued;
END;
$func$;

COMMENT ON FUNCTION haven.notify_monitoring_order_created (p_order_id uuid) IS
  'Queues the new Monitoring Order notification against every active notification route for the facility, with the administrator fallback when none resolves. Tells, never asks: no row it writes gates the order.';

REVOKE ALL ON FUNCTION haven.notify_monitoring_order_created (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.notify_monitoring_order_created (uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Commands
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

  -- The standard windows stop for this resident. Tasks already on the board for
  -- a window that has not opened yet would otherwise run to overdue and reach
  -- the escalation ladder for a check the order replaced.
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
    AND t.due_at > v_starts_at;

  PERFORM
    public.generate_monitoring_order_tasks (v_resident.facility_id, NULL);

  PERFORM
    haven.notify_monitoring_order_created (v_order_id);

  RETURN v_order_id;
END;
$func$;

COMMENT ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) IS
  'Enters a Monitoring Order and puts it in force immediately. Resident Aide and above at a facility the caller can reach. Excuses the resident''s not yet worked standard windows, writes the first order tasks and queues the administrator notification. There is no approval step. COL-37 ruling: definer required -- a caregiver has no INSERT grant on resident_observation_tasks and no write path to the notification ledger, and the command re-checks organization, facility access and role itself before writing anything.';

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

  RETURN p_order_id;
END;
$func$;

COMMENT ON FUNCTION public.cancel_monitoring_order (uuid, text) IS
  'Stands a Monitoring Order down with a stated reason and excuses its not yet worked tasks. facility_admin, manager, org_admin and owner only. The append only history row is written by the table trigger, not here. COL-37 ruling: definer required -- the command also excuses resident_observation_tasks rows, which the caller has no grant to update, and it re-checks organization, facility access and role before writing.';

CREATE OR REPLACE FUNCTION public.expire_monitoring_orders ()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
BEGIN
  -- Only an order with an end date that has passed. An open ended order whose
  -- review date is in the past stays active on purpose: expiring it would end
  -- the elevated observation for a resident nobody has looked at again, and
  -- silently. It surfaces as the monitoring_order_review_overdue Watchlist
  -- signal instead, which is a person being asked to decide.
  UPDATE
    public.resident_monitoring_orders o
  SET
    status = 'expired'
  WHERE
    o.status = 'active'
    AND o.deleted_at IS NULL
    AND o.ends_at IS NOT NULL
    AND o.ends_at <= now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

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

  RETURN v_rows;
END;
$func$;

COMMENT ON FUNCTION public.expire_monitoring_orders () IS
  'Expires Monitoring Orders whose end date has passed. Never expires an open ended order, whatever its review date says; a past review date is a Watchlist signal, not an expiry. Scheduled job surface, service_role only.';

REVOKE ALL ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_monitoring_order (uuid, integer, text, text, text, text, text, timestamptz, timestamptz, timestamptz, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_monitoring_order (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_monitoring_order (uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expire_monitoring_orders () FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_monitoring_orders () TO service_role;

-- ---------------------------------------------------------------------------
-- public.v_resident_observation_compliance
--
-- The single compliance read for the observation module. Every later part reads
-- this instead of counting task rows.
--
-- Contract
-- --------
-- Grain: one row per resident per facility local service date per projected
-- standard observation window. A resident on the standard cadence at a facility
-- with six windows produces six rows for a day; so does a resident on a 30
-- minute Monitoring Order, who has no standard task rows at all that day.
--
-- Expected  = count(*)
-- Satisfied = count(*) FILTER (WHERE satisfied)
--
-- Never count resident_observation_tasks to get either number. While an order is
-- active the standard windows stop generating, so the task rows are not there to
-- count, and a resident being observed twice an hour would read as missing six
-- windows a day. That is the exact dishonesty Monitoring Orders exist to prevent.
--
-- How a row is built
--   1. the cadence version for the day is the stamp on that resident's standard
--      tasks for the date where any exist, and public.facility_cadence_in_force
--      at local midnight where none do
--   2. that version's windows are projected through
--      public.facility_observation_windows_for_version, which is the only place
--      window arithmetic lives
--   3. a window is satisfied when any observation log for that resident has an
--      observed_at inside the projected span, whether the log came from a
--      standard task or from an order task
--   4. expected is the projected count, never the task count
--
-- Reproducibility: both the stamp and facility_cadence_in_force resolve
-- effective dated, immutable versions, so a report for a past date recomputes to
-- the same numbers after the cadence changes.
--
-- The day a cadence change activates mid shift used to be the hole here: a
-- projector that resolves the version from the date answers with whatever is in
-- force at local midnight, while the tasks carry the version in force when they
-- were generated, and on that one day the read scores tasks against windows that
-- did not produce them. The projection now takes the resolved version as an
-- argument, so it scores against the stamp. cadence_version_matches_projection
-- stays on the row so a caller can assert the invariant rather than trust it.
--
-- Caller shape:
--   SELECT count(*) AS expected,
--          count(*) FILTER (WHERE satisfied) AS satisfied
--   FROM public.v_resident_observation_compliance
--   WHERE facility_id = $1 AND service_date = $2;
--
-- security_invoker: rows follow the reader's authority over
-- resident_observation_tasks, resident_monitoring_orders, residents and
-- facilities, not the view owner's.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_resident_observation_compliance;

CREATE VIEW public.v_resident_observation_compliance WITH ( security_invoker = TRUE
) AS
WITH coverage AS (
  -- Days a resident has standard cadence tasks.
  SELECT DISTINCT
    t.organization_id,
    t.facility_id,
    t.resident_id,
    t.service_date
  FROM
    public.resident_observation_tasks t
  WHERE
    t.deleted_at IS NULL
    AND t.service_date IS NOT NULL
    AND t.window_key IS NOT NULL
  UNION
  -- Days a resident was under a Monitoring Order and therefore has no standard
  -- tasks to draw the day from. This is the half that makes absorption work.
  SELECT DISTINCT
    o.organization_id,
    o.facility_id,
    o.resident_id,
    covered_day::date
  FROM
    public.resident_monitoring_orders o
    JOIN public.facilities f ON f.id = o.facility_id
      AND f.deleted_at IS NULL
    CROSS JOIN LATERAL generate_series(date_trunc('day', o.starts_at AT TIME ZONE COALESCE(f.timezone, 'America/New_York')), date_trunc('day', LEAST(COALESCE(o.cancelled_at, o.ends_at, now()), now()) AT TIME ZONE COALESCE(f.timezone, 'America/New_York')), interval '1 day') AS covered_day
  WHERE
    o.deleted_at IS NULL
),
resolved AS (
  SELECT
    c.organization_id,
    c.facility_id,
    c.resident_id,
    c.service_date,
    stamp.cadence_version_id AS stamped_cadence_version_id,
    COALESCE(stamp.cadence_version_id, public.facility_cadence_in_force (c.facility_id, (c.service_date::timestamp AT TIME ZONE COALESCE(f.timezone, 'America/New_York')))) AS cadence_version_id
  FROM
    coverage c
    JOIN public.residents res ON res.id = c.resident_id
      AND res.deleted_at IS NULL
    JOIN public.facilities f ON f.id = c.facility_id
      AND f.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT
        t.cadence_version_id
      FROM
        public.resident_observation_tasks t
      WHERE
        t.resident_id = c.resident_id
        AND t.service_date = c.service_date
        AND t.window_key IS NOT NULL
        AND t.cadence_version_id IS NOT NULL
        AND t.deleted_at IS NULL
      ORDER BY
        t.due_at
      LIMIT 1) stamp ON TRUE
)
SELECT
  r.organization_id,
  r.facility_id,
  r.resident_id,
  r.service_date,
  w.window_key,
  w.label AS window_label,
  w.shift_key,
  r.cadence_version_id,
  r.stamped_cadence_version_id,
  w.cadence_version_id AS projected_cadence_version_id,
  -- True by construction now that the projection takes the resolved version as
  -- an argument. Kept as a column so a caller can assert the invariant rather
  -- than trust it, and so a future projector change cannot quietly break it.
  (r.cadence_version_id IS NOT DISTINCT FROM w.cadence_version_id) AS cadence_version_matches_projection,
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  standard_task.id AS task_id,
  standard_task.status::text AS task_status,
  covering_order.id AS covered_by_monitoring_order_id,
  satisfying_log.id AS satisfied_by_log_id,
  satisfying_log.observed_at AS satisfied_at,
  satisfying_log.monitoring_order_id AS satisfied_by_monitoring_order_id,
  (satisfying_log.id IS NOT NULL) AS satisfied,
  -- Absorption: this standard window was covered by an order and the check that
  -- satisfied it was an order check.
  (covering_order.id IS NOT NULL
    AND satisfying_log.monitoring_order_id IS NOT NULL) AS absorbed,
  -- What the resident was actually on for this window. An order wins: while one
  -- is in force the standard windows are not what the floor is working, even
  -- when a stood down task row for one is still on the table.
  CASE WHEN covering_order.id IS NOT NULL THEN
    'monitoring_order'
  WHEN standard_task.id IS NOT NULL THEN
    'standard_task'
  ELSE
    'projected_only'
  END AS expectation_source
FROM
  resolved r
  -- Project from the version the tasks were stamped with, falling back to the
  -- version in force on the date when the resident had no standard tasks at all
  -- (which is the Monitoring Order case). Scoring a day against the version
  -- that generated it is what makes a past compliance report recompute to the
  -- same numbers after the cadence changes.
  CROSS JOIN LATERAL public.facility_observation_windows_for_version (r.facility_id, r.cadence_version_id, r.service_date) w
  LEFT JOIN LATERAL (
    SELECT
      t.id,
      t.status
    FROM
      public.resident_observation_tasks t
    WHERE
      t.resident_id = r.resident_id
      AND t.service_date = r.service_date
      AND t.window_key = w.window_key
      AND t.monitoring_order_id IS NULL
      AND t.deleted_at IS NULL
    ORDER BY
      -- A task that is still being worked describes the window better than one
      -- an order stood down, so prefer it when both exist.
      (t.status = 'excused'),
      t.due_at
    LIMIT 1) standard_task ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      o.id
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = r.resident_id
      AND o.deleted_at IS NULL
      AND o.starts_at <= w.window_closes_at_utc
      AND COALESCE(o.cancelled_at, o.ends_at, 'infinity'::timestamptz) > w.window_opens_at_utc
    ORDER BY
      o.starts_at DESC
    LIMIT 1) covering_order ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      l.id,
      l.observed_at,
      lt.monitoring_order_id
    FROM
      public.resident_observation_logs l
      JOIN public.resident_observation_tasks lt ON lt.id = l.task_id
    WHERE
      l.resident_id = r.resident_id
      AND l.deleted_at IS NULL
      AND l.observed_at >= w.window_opens_at_utc
      AND l.observed_at <= w.window_closes_at_utc
    ORDER BY
      l.observed_at
    LIMIT 1) satisfying_log ON TRUE;

COMMENT ON VIEW public.v_resident_observation_compliance IS
  'The compliance read for the observation module. One row per resident per facility local service date per projected standard window. Expected is count(*), satisfied is count(*) FILTER (WHERE satisfied). Expectation derived, never row derived: the windows are projected from the cadence version in force for the date and a window is satisfied by any observation log inside its span, so a resident under a Monitoring Order -- who has no standard task rows at all -- reads honestly instead of reading as six misses a day. Later parts read this and must not re-derive compliance by counting resident_observation_tasks.';

REVOKE ALL ON public.v_resident_observation_compliance FROM PUBLIC, anon;
GRANT SELECT ON public.v_resident_observation_compliance TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The resident_watch_instances bridge.
--
-- Spec section 4.4. The care event trigger that was expected to insert into
-- resident_watch_instances does not exist at this branch point -- migrations 400
-- to 403 only read the table -- so this bridge sits idle until that trigger
-- lands. That is expected and correct: building it on the watch table itself
-- makes it right regardless of what eventually writes there. The care event
-- functions are not modified and resident_watch_instances is not dropped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.monitoring_order_reason_from_watch_source (p_triggered_by_type text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    CASE WHEN p_triggered_by_type IS NULL THEN
      'other'
    WHEN p_triggered_by_type ~* '(fall)' THEN
      'post_fall'
    WHEN p_triggered_by_type ~* '(elope|wander)' THEN
      'elopement_risk'
    WHEN p_triggered_by_type ~* '(hospital|discharge|emergency|er_return)' THEN
      'post_hospital_return'
    WHEN p_triggered_by_type ~* '(behavio|agitat)' THEN
      'behavior'
    WHEN p_triggered_by_type ~* '(skin|wound|pressure)' THEN
      'skin_or_wound'
    WHEN p_triggered_by_type ~* '(condition|decline|vital|illness)' THEN
      'change_in_condition'
    ELSE
      'other'
    END;
$func$;

COMMENT ON FUNCTION haven.monitoring_order_reason_from_watch_source (text) IS
  'Maps resident_watch_instances.triggered_by_type, which is free text, onto the Monitoring Order reason_category CHECK list. Anything unrecognized becomes other rather than guessing a clinical reason.';

CREATE OR REPLACE FUNCTION haven.monitoring_order_bridge_defaults ()
  RETURNS TABLE (
    interval_minutes integer,
    review_after_hours integer)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    60,
    72;
$func$;

COMMENT ON FUNCTION haven.monitoring_order_bridge_defaults () IS
  'Seed values a bridged Monitoring Order falls back to when the watch protocol does not state an interval: the check spacing, and how long an open ended bridged order runs before somebody has to decide about it again. Seeded configuration, not a constant; the cadence configuration work moves both into a facility row without changing this function''s callers.';

REVOKE ALL ON FUNCTION haven.monitoring_order_reason_from_watch_source (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.monitoring_order_reason_from_watch_source (text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.monitoring_order_bridge_defaults () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.monitoring_order_bridge_defaults () TO authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.bridge_watch_instance_to_monitoring_order ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_defaults record;
  v_interval integer;
  v_entered_by uuid;
  v_review_due_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  -- A watch instance that arrived already finished has nothing to observe.
  IF NEW.status IN ('ended', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Guard one: this watch instance already has its order. The partial unique
  -- index on source_watch_instance_id enforces it too; this keeps the trigger
  -- from raising rather than returning.
  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.source_watch_instance_id = NEW.id
      AND o.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Guard two: the resident is already on an order. One active order per
  -- resident is an invariant of the model, not a race to lose.
  IF EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = NEW.resident_id
      AND o.status = 'active'
      AND o.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT
    * INTO v_defaults
  FROM
    haven.monitoring_order_bridge_defaults ();

  SELECT
    COALESCE(NULLIF(p.rule_definition_json ->> 'interval_minutes', '')::integer, v_defaults.interval_minutes) INTO v_interval
  FROM
    public.resident_watch_protocols p
  WHERE
    p.id = NEW.protocol_id;

  v_interval := COALESCE(v_interval, v_defaults.interval_minutes);
  IF v_interval < 15 OR v_interval > 720 THEN
    v_interval := v_defaults.interval_minutes;
  END IF;

  -- entered_by is NOT NULL and references user_profiles. Prefer whoever acted on
  -- the watch instance, then the caller, then an organization administrator, who
  -- is selected by role rather than by name.
  SELECT
    up.id INTO v_entered_by
  FROM
    public.user_profiles up
  WHERE
    up.id IN (COALESCE(NEW.approved_by, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(NEW.updated_by, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid))
    AND up.deleted_at IS NULL
  ORDER BY
    (up.id = NEW.approved_by) DESC,
    (up.id = auth.uid()) DESC
  LIMIT 1;

  IF v_entered_by IS NULL THEN
    SELECT
      up.id INTO v_entered_by
    FROM
      public.user_profiles up
    WHERE
      up.organization_id = NEW.organization_id
      AND up.app_role IN ('owner', 'org_admin')
      AND up.deleted_at IS NULL
    ORDER BY
      up.created_at
    LIMIT 1;
  END IF;

  IF v_entered_by IS NULL THEN
    RAISE WARNING 'Monitoring Order bridge skipped watch instance %: the organization has no administrator profile to record the order against', NEW.id;
    RETURN NEW;
  END IF;

  v_ends_at := NEW.ends_at;
  IF v_ends_at IS NOT NULL AND v_ends_at <= NEW.starts_at THEN
    v_ends_at := NULL;
  END IF;
  IF v_ends_at IS NULL THEN
    v_review_due_at := NEW.starts_at + make_interval(hours => v_defaults.review_after_hours);
  ELSE
    v_review_due_at := NULL;
  END IF;

  INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, source_watch_instance_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, created_by, status)
    VALUES (NEW.organization_id, NEW.entity_id, NEW.facility_id, NEW.resident_id, NEW.id, v_interval, NEW.starts_at, v_ends_at, v_review_due_at, 'facility_nurse', 'Facility nurse on duty', 'written_order', haven.monitoring_order_reason_from_watch_source (NEW.triggered_by_type), 'Created from a care event watch instance. Source: ' || COALESCE(NEW.triggered_by_type, 'unrecorded') || '.', v_entered_by, v_entered_by, 'active');

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.bridge_watch_instance_to_monitoring_order () IS
  'Creates the Monitoring Order that corresponds to a new resident_watch_instances row, so Monitoring Orders is the single operator facing model while the watch table stays the care event integration point. Idle until the care event trigger that writes resident_watch_instances lands, which is spec open item 8. Skips rather than raises when the watch instance already has an order, when the resident already has an active one, or when no profile exists to record it against, because it must never be the reason a care event write fails.';

DROP TRIGGER IF EXISTS tr_resident_watch_instances_monitoring_order_bridge ON public.resident_watch_instances;
CREATE TRIGGER tr_resident_watch_instances_monitoring_order_bridge
  AFTER INSERT ON public.resident_watch_instances
  FOR EACH ROW
  EXECUTE FUNCTION haven.bridge_watch_instance_to_monitoring_order ();

-- Backfill. Every watch instance that is still live and has no order gets one,
-- newest first so the one active order per resident index keeps the most recent.
INSERT INTO public.resident_monitoring_orders (organization_id, entity_id, facility_id, resident_id, source_watch_instance_id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note, entered_by, created_by, status)
SELECT DISTINCT ON (w.resident_id)
  w.organization_id,
  w.entity_id,
  w.facility_id,
  w.resident_id,
  w.id,
  COALESCE(NULLIF(p.rule_definition_json ->> 'interval_minutes', '')::integer, d.interval_minutes),
  w.starts_at,
  CASE WHEN w.ends_at > w.starts_at THEN
    w.ends_at
  ELSE
    NULL
  END,
  CASE WHEN w.ends_at > w.starts_at THEN
    NULL
  ELSE
    w.starts_at + make_interval(hours => d.review_after_hours)
  END,
  'facility_nurse',
  'Facility nurse on duty',
  'written_order',
  haven.monitoring_order_reason_from_watch_source (w.triggered_by_type),
  'Created from a care event watch instance. Source: ' || COALESCE(w.triggered_by_type, 'unrecorded') || '.',
  administrator.id,
  administrator.id,
  'active'
FROM
  public.resident_watch_instances w
  CROSS JOIN LATERAL haven.monitoring_order_bridge_defaults () d
  LEFT JOIN public.resident_watch_protocols p ON p.id = w.protocol_id
  CROSS JOIN LATERAL (
    SELECT
      up.id
    FROM
      public.user_profiles up
    WHERE
      up.deleted_at IS NULL
      AND (up.id = w.approved_by
        OR up.id = w.updated_by
        OR (up.organization_id = w.organization_id
          AND up.app_role IN ('owner', 'org_admin')))
    ORDER BY
      (up.id = w.approved_by) DESC,
      (up.id = w.updated_by) DESC,
      up.created_at
    LIMIT 1) administrator
WHERE
  w.deleted_at IS NULL
  AND w.status NOT IN ('ended', 'cancelled')
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = w.resident_id
      AND o.status = 'active'
      AND o.deleted_at IS NULL)
ORDER BY
  w.resident_id,
  w.starts_at DESC
ON CONFLICT
  DO NOTHING;

-- ---------------------------------------------------------------------------
-- The intervals the entry form offers.
--
-- The presets and the bounds are rows, not numbers in a component. A .ts file
-- carrying `[30, 60, 120, 240]` next to the word minutes is exactly what the
-- no-literals rule exists to stop, and it would also mean an administrator
-- could not change what the floor is offered without a deploy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.monitoring_order_interval_options ()
  RETURNS TABLE (
    preset_minutes integer[],
    min_minutes integer,
    max_minutes integer)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    ARRAY[30, 60, 120, 240]::integer[],
    15,
    720;
$func$;

COMMENT ON FUNCTION public.monitoring_order_interval_options () IS
  'The Monitoring Order intervals the entry form offers as presets, and the bounds a custom value must fall inside. Seed values matching the CHECK on resident_monitoring_orders.interval_minutes; the cadence configuration work moves them into a facility row without changing the caller.';

REVOKE ALL ON FUNCTION public.monitoring_order_interval_options () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monitoring_order_interval_options () TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.submit_observation: point the observer role gate at the shared list.
--
-- The list of roles that may record an observation was inlined in this function
-- by 413 and is now also the list that may enter a Monitoring Order, so it lives
-- in haven.can_record_observation and both read it. Nothing else in this body
-- changes: exactly two hunks, the DECLARE block that held the array and the one
-- IF that tested it, and the predicate is the same nine roles it always was.
-- The locked SYS-001 completion bodies -- haven.complete_rounding_task_core and
-- public.complete_rounding_task_review -- are not replayed here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_observation (p_task_id uuid, p_chip_selections jsonb, p_resident_location text, p_resident_state text, p_quick_status text, p_note text DEFAULT NULL, p_resident_position text DEFAULT NULL, p_intervention_codes text[] DEFAULT NULL, p_observed_at timestamptz DEFAULT NULL, p_late_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL, p_offline boolean DEFAULT FALSE, p_actor_id uuid DEFAULT NULL, p_actor_role text DEFAULT NULL, p_session_id uuid DEFAULT NULL, p_claim_version integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $func$
DECLARE
  -- Resident Aide and above now lives in haven.can_record_observation, which
  -- the Monitoring Order commands and the order table policies read too. One
  -- list, one place. Resolved onto the authentication role enum, recorded in
  -- HANDOFFS/2026-09-16__smart-rounding-build-notes.md section 1.5.
  v_chip_groups CONSTANT text[] := ARRAY['meal_intake', 'mood_state', 'med_response'];
  v_task public.resident_observation_tasks%ROWTYPE;
  v_caller uuid;
  v_actor_id uuid;
  v_actor_role text;
  v_session_id uuid;
  v_claim_version integer;
  v_staff_id uuid;
  v_group text;
  v_values jsonb;
  v_codes jsonb;
  v_unknown text;
  v_selections jsonb := '{}'::jsonb;
  v_chip_count integer := 0;
  v_summary text;
BEGIN
  SELECT
    * INTO v_task
  FROM
    public.resident_observation_tasks
  WHERE
    id = p_task_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation task not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    v_actor_id := v_caller;
    v_actor_role := haven.app_role()::text;
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
    SELECT
      profile.auth_claim_version INTO v_claim_version
    FROM
      public.user_profiles AS profile
    WHERE
      profile.id = v_actor_id;
    IF haven.organization_id() IS DISTINCT FROM v_task.organization_id OR NOT haven.has_facility_access(v_task.facility_id) THEN
      RAISE EXCEPTION 'Not allowed to record an observation at this facility'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    v_actor_id := p_actor_id;
    v_actor_role := p_actor_role;
    v_session_id := p_session_id;
    v_claim_version := p_claim_version;
  END IF;

  IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'An authorized observer is required to record an observation'
      USING ERRCODE = '42501';
  END IF;
  IF NOT haven.can_record_observation(v_actor_role) THEN
    RAISE EXCEPTION 'This role cannot record an observation'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    staff.id INTO v_staff_id
  FROM
    public.staff AS staff
  WHERE
    staff.user_id = v_actor_id
    AND staff.organization_id = v_task.organization_id
    AND staff.facility_id = v_task.facility_id
    AND staff.employment_status = 'active'
    AND staff.deleted_at IS NULL
  ORDER BY
    staff.id
  LIMIT 1;
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff profile is required to record an observation'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_resident_location), '') IS NULL OR NULLIF(btrim(p_resident_state), '') IS NULL OR NULLIF(btrim(p_quick_status), '') IS NULL THEN
    RAISE EXCEPTION 'Where the resident was, how they presented, and their status are required on every check'
      USING ERRCODE = '22023';
  END IF;
  IF haven.observation_quick_status_label(p_quick_status) IS NULL THEN
    RAISE EXCEPTION 'That status is not one this facility records'
      USING ERRCODE = '22023';
  END IF;

  IF p_chip_selections IS NULL OR jsonb_typeof(p_chip_selections) <> 'object' THEN
    RAISE EXCEPTION 'Chip selections must arrive as a group to code map'
      USING ERRCODE = '22023';
  END IF;
  SELECT
    key INTO v_unknown
  FROM
    jsonb_object_keys(p_chip_selections) AS key
  WHERE
    NOT (key = ANY (v_chip_groups))
  LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'There is no observation chip group named %', v_unknown
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_group IN ARRAY v_chip_groups LOOP
    v_values := p_chip_selections -> v_group;
    CONTINUE WHEN v_values IS NULL OR jsonb_typeof(v_values) = 'null';
    IF jsonb_typeof(v_values) <> 'array' THEN
      RAISE EXCEPTION 'Chip selections for one group must be a list of codes'
        USING ERRCODE = '22023';
    END IF;
    SELECT
      selected.code INTO v_unknown
    FROM
      jsonb_array_elements_text(v_values) AS selected (code)
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_vocab AS vocab
        WHERE
          vocab.organization_id = v_task.organization_id
          AND (vocab.facility_id IS NULL OR vocab.facility_id = v_task.facility_id)
          AND vocab.field_name = v_group
          AND vocab.value_code = selected.code
          AND vocab.active
          AND vocab.deleted_at IS NULL)
    LIMIT 1;
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'The observation chip % is not available at this facility', v_unknown
        USING ERRCODE = '22023';
    END IF;
    SELECT
      COALESCE(jsonb_agg(resolved.value_code ORDER BY resolved.display_order, resolved.value_code), '[]'::jsonb) INTO v_codes
    FROM (
      SELECT DISTINCT ON (selected.code)
        vocab.value_code,
        vocab.display_order
      FROM jsonb_array_elements_text(v_values) AS selected (code)
      JOIN public.observation_vocab AS vocab ON vocab.organization_id = v_task.organization_id
        AND (vocab.facility_id IS NULL OR vocab.facility_id = v_task.facility_id)
        AND vocab.field_name = v_group
        AND vocab.value_code = selected.code
        AND vocab.active
        AND vocab.deleted_at IS NULL
      ORDER BY
        selected.code,
        (vocab.facility_id IS NOT NULL) DESC) AS resolved;
    IF jsonb_array_length(v_codes) > 0 THEN
      v_selections := v_selections || jsonb_build_object(v_group, v_codes);
      v_chip_count := v_chip_count + jsonb_array_length(v_codes);
    END IF;
  END LOOP;

  IF v_chip_count = 0 THEN
    RAISE EXCEPTION 'Tap at least one meal, mood or medication chip before recording this check'
      USING ERRCODE = '22023';
  END IF;

  v_summary := haven.compose_observation_summary(v_task.organization_id, v_task.facility_id, v_selections, p_quick_status, p_resident_state, p_resident_location, p_resident_position, p_intervention_codes);

  RETURN public.complete_rounding_task_review(p_task_id, v_actor_id, v_actor_role, v_session_id, v_claim_version, v_task.organization_id, v_task.facility_id, v_staff_id, jsonb_build_object('request_id', COALESCE(p_request_id, pg_catalog.gen_random_uuid()), 'observed_at', COALESCE(p_observed_at, clock_timestamp()), 'offline', COALESCE(p_offline, FALSE), 'quick_status', p_quick_status, 'resident_location', p_resident_location, 'resident_state', p_resident_state, 'resident_position', p_resident_position, 'intervention_codes', COALESCE(to_jsonb(p_intervention_codes), '[]'::jsonb), 'chip_selections', v_selections, 'composed_summary', v_summary, 'note', NULLIF(btrim(p_note), ''), 'late_reason', NULLIF(btrim(p_late_reason), '')));
END;
$func$;

-- Re-pin the grants, because a replaced function is the classic way a REVOKE
-- from an earlier migration quietly comes undone (migration 312).
REVOKE ALL ON FUNCTION public.submit_observation (uuid, jsonb, text, text, text, text, text, text[], timestamptz, text, uuid, boolean, uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_observation (uuid, jsonb, text, text, text, text, text, text[], timestamptz, text, uuid, boolean, uuid, text, uuid, integer) TO authenticated, service_role;

-- PostgREST answers from a cached schema. Without this the new table, the new
-- view and the three new commands return 404 through the API and the page that
-- reads them looks like the broken thing.
NOTIFY pgrst,
'reload schema';

COMMIT;
