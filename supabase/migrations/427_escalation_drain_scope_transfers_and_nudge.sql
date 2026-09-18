-- Three defects, all reproduced on the replay before being touched (spec 25A).
--
-- M6. THE DELIVERY DRAIN WAS NOT SCOPED, AND TWO TICKS COULD BOTH SEND A ROW.
--
-- loadQueuedDeliveries in observation-escalation-engine/store.ts filtered on
-- `status = 'queued'` and `send_after <= now` and nothing else. It selected
-- organization_id and facility_id and filtered on neither, and engine.ts, its
-- only caller, passed neither although the tick receives both. Reproduced with
-- two synthetic tenants: a tick scoped to {Tenant A, A Bldg 1} selected all
-- three queued rows, including the one belonging to Tenant B. Each delivery
-- body carries a room number and a facility name, so a per facility cron entry
-- was a cross facility and in principle cross tenant disclosure path. The same
-- read also let two overlapping ticks both see the same row as claimable, which
-- is a duplicate send.
--
-- M9. A TRANSFERRED RESIDENT LEFT LIVE TASKS ESCALATING AT THE OLD BUILDING.
--
-- The generator picked departed residents as
-- `residents.facility_id = facilityId AND status <> 'active'`. A transferred
-- resident's facility_id points at the new building and their status is still
-- active, so they match neither half. Reproduced: the stand down found zero
-- candidates at the old building while the resident's task sat `upcoming` there
-- and the resident was at the new one. Those tasks run to overdue, climb the
-- ladder and reach the terminal rung: an SMS and a critical exec alert naming a
-- room at a building the resident is not in.
--
-- Same class as the hospital_hold defect staging surfaced: the generator decided
-- who to exclude by one predicate while the tasks already on the board were
-- governed by another. This migration gives both one definition, in SQL, so they
-- cannot disagree again.
--
-- M10. A POOL TASK BURNT ITS NUDGE ON NOBODY, PERMANENTLY.
--
-- record_observation_escalation_rung wrote the observation_escalation_dispatches
-- row, which is the (task_id, rung_key) idempotency anchor, before
-- haven.observation_escalation_recipients resolved. The seeded nudge is
-- assigned_staff_only with an empty target_staff_roles, so on a task with no
-- assigned staff it reached nobody. Reproduced: the first call returned
-- `fired: true, recipients: 0, deliveries_queued: 0` and left one dispatch row
-- and one skipped delivery; the second call, after the task could have been
-- assigned, returned `already_fired`. The nudge is the rung that catches most
-- misses before they reach a human, and this disabled it permanently on exactly
-- the tasks most likely to be missed: the ones nobody is assigned to.
BEGIN;

-- ---------------------------------------------------------------------------
-- M6, part one. A delivery can be claimed, and a claim can go stale.
--
-- `sending` is the claimed state. It is distinct from `queued` so a second tick
-- cannot pick the row up, and distinct from `sent` so a tick that dies mid send
-- is recoverable rather than either lost or duplicated.
-- ---------------------------------------------------------------------------
ALTER TABLE public.observation_escalation_deliveries
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;

-- Who holds the claim. A token rather than the timestamp, because the outcome
-- write guards on it and a timestamp has to survive a round trip through JSON
-- and back into timestamptz to be compared; a uuid either matches or it does
-- not. A tick that finishes late, after its claim was reclaimed by another tick,
-- writes nothing rather than overwriting the outcome of the tick that actually
-- sent the message.
ALTER TABLE public.observation_escalation_deliveries
  ADD COLUMN IF NOT EXISTS claim_token uuid NULL;

-- How many times this delivery has been handed out. The stale claim reclaim
-- below is what makes a tick killed mid send recoverable, and without a counter
-- it is also what makes any delivery whose outcome cannot be written resend
-- forever, one send per timeout interval. An SMS naming a resident's room to an
-- administrator at 02:00, on a loop, is worse than the duplicate send the claim
-- exists to prevent.
ALTER TABLE public.observation_escalation_deliveries
  ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.observation_escalation_deliveries
  DROP CONSTRAINT IF EXISTS observation_escalation_deliveries_status_check;

ALTER TABLE public.observation_escalation_deliveries
  ADD CONSTRAINT observation_escalation_deliveries_status_check CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));

COMMENT ON COLUMN public.observation_escalation_deliveries.claim_token IS
  'The token of the tick that currently holds this delivery. public.record_observation_escalation_delivery_outcome will only write an outcome for the holder, so a tick whose claim was reclaimed cannot overwrite the result of the tick that actually sent.';
COMMENT ON COLUMN public.observation_escalation_deliveries.send_attempts IS
  'How many times this delivery has been claimed for sending. Bounds the retry: a row that has exhausted haven.observation_delivery_max_attempts is failed rather than handed out again, so no delivery can resend indefinitely whatever goes wrong downstream.';
COMMENT ON COLUMN public.observation_escalation_deliveries.claimed_at IS
  'When a tick claimed this delivery for sending. Set with the move to status sending and read by public.claim_observation_escalation_deliveries to return a claim its owner never finished, so a tick that died mid send leaves the row retryable rather than stuck.';

-- How long a claim may sit before another tick may take it. A function rather
-- than a literal in the claim body, so the value moves without rewriting the
-- command; the cadence configuration work can point it at a facility row.
CREATE OR REPLACE FUNCTION haven.observation_delivery_claim_timeout ()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    interval '10 minutes';
$func$;

COMMENT ON FUNCTION haven.observation_delivery_claim_timeout () IS
  'How long a claimed but unfinished escalation delivery waits before another tick may take it. Long enough that a slow provider call is not sent twice, short enough that a tick killed mid send does not hold a resident''s escalation for a shift.';

REVOKE ALL ON FUNCTION haven.observation_delivery_claim_timeout () FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.observation_delivery_claim_timeout () TO authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.observation_delivery_max_attempts ()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT
    3;
$func$;

COMMENT ON FUNCTION haven.observation_delivery_max_attempts () IS
  'How many times one escalation delivery may be claimed for sending before it is failed instead. Two retries past the first attempt covers a provider blip and a tick that died; past that something is wrong that another send will not fix, and the alternative is an unbounded resend of a message naming a resident.';

REVOKE ALL ON FUNCTION haven.observation_delivery_max_attempts () FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION haven.observation_delivery_max_attempts () TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M6, part two. The drain claims what it is going to send, scoped to the tick.
--
-- Why a conditional status update and not FOR UPDATE SKIP LOCKED on its own:
-- the engine sends over HTTP between reading a delivery and recording its
-- outcome, so the claim has to survive outside any transaction. A row lock is
-- released at commit, which happens before the first provider call, so SKIP
-- LOCKED alone would leave the row claimable again while it was being sent.
-- Flipping the status is what makes the claim durable.
--
-- SKIP LOCKED is used as well, inside the subquery, so two claim statements
-- running at the same instant do not queue behind each other on the same rows;
-- it is the concurrency half and the status flip is the durability half.
--
-- Scoping is not optional and not a filter the caller may omit:
-- p_organization_id has no default. A tick that forgets it does not drain
-- everything, it fails to compile.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_observation_escalation_deliveries (uuid, uuid, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.claim_observation_escalation_deliveries (p_organization_id uuid, p_facility_id uuid, p_claim_token uuid, p_at timestamptz, p_limit integer)
  RETURNS TABLE (
    id uuid,
    organization_id uuid,
    facility_id uuid,
    dispatch_id uuid,
    rung_key text,
    target_user_id uuid,
    target_phone text,
    channel text,
    is_test boolean,
    message_body text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
  -- Two data modifying branches in one statement. They target disjoint rows,
  -- because one requires the attempt cap to be exhausted and the other requires
  -- it not to be, so neither can see or fight the other.
  WITH exhausted AS (
    -- A claim nobody came back for, on a delivery that has already had its
    -- chances. Failed rather than handed out again: this is the branch that
    -- turns an unbounded resend into a terminal state somebody can see.
    UPDATE
      public.observation_escalation_deliveries d
    SET
      status = 'failed',
      error_message = 'Abandoned mid send and out of attempts',
      claim_token = NULL,
      updated_at = now()
    WHERE
      d.organization_id = p_organization_id
      AND (p_facility_id IS NULL
        OR d.facility_id = p_facility_id)
      AND d.status = 'sending'
      AND d.claimed_at < p_at - haven.observation_delivery_claim_timeout ()
      AND d.send_attempts >= haven.observation_delivery_max_attempts ()
    RETURNING
      d.id
),
claimed AS (
  UPDATE
    public.observation_escalation_deliveries d
  SET
    status = 'sending',
    claimed_at = p_at,
    claim_token = p_claim_token,
    send_attempts = d.send_attempts + 1,
    updated_at = now()
  WHERE
    d.id IN (
      SELECT
        candidate.id
      FROM
        public.observation_escalation_deliveries candidate
      WHERE
        candidate.organization_id = p_organization_id
        AND (p_facility_id IS NULL
          OR candidate.facility_id = p_facility_id)
        AND candidate.send_after <= p_at
        AND candidate.send_attempts < haven.observation_delivery_max_attempts ()
        AND (candidate.status = 'queued'
          -- A claim its owner never finished. The tick that took it is gone.
          OR (candidate.status = 'sending'
            AND candidate.claimed_at < p_at - haven.observation_delivery_claim_timeout ()))
      ORDER BY
        candidate.send_after
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 500)
      FOR UPDATE
        SKIP LOCKED)
  RETURNING
    d.id,
    d.organization_id,
    d.facility_id,
    d.dispatch_id,
    d.rung_key,
    d.target_user_id,
    d.target_phone,
    d.channel,
    d.is_test,
    d.message_body
)
  SELECT
    *
  FROM
    claimed;
$func$;

COMMENT ON FUNCTION public.claim_observation_escalation_deliveries (uuid, uuid, uuid, timestamptz, integer) IS
  'Claims up to p_limit queued escalation deliveries for one organization, and for one facility when the tick names one, stamping the caller''s claim token and moving them to status sending in the same statement that returns them. Two overlapping ticks cannot both take a row: the second one''s UPDATE matches nothing because the status has already moved. A claim older than haven.observation_delivery_claim_timeout is handed to whoever asks next so a tick that died mid send leaves the delivery retryable, and a delivery that has exhausted haven.observation_delivery_max_attempts is failed instead, so retryable never means forever. The organization argument has no default on purpose: the unscoped read this replaces sent every queued push and SMS across every facility and every tenant, and each body names a room and a building. Service only.';

REVOKE ALL ON FUNCTION public.claim_observation_escalation_deliveries (uuid, uuid, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_observation_escalation_deliveries (uuid, uuid, uuid, timestamptz, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- M6, part three. The outcome write, and why it is a command rather than a
-- filtered UPDATE from the Edge Function.
--
-- The first version of this fix left store.ts writing the outcome through
-- PostgREST with `.eq("status", "queued")`. The claim had just moved the row to
-- `sending`, so that update matched zero rows; PostgREST returns no error for an
-- update that matches nothing, so the write succeeded silently and the outcome
-- was never recorded. The row stayed `sending`, the stale claim reclaim picked
-- it up after the timeout, and it sent again. Every timeout interval. Forever.
-- One duplicate send per tick had become an unbounded resend loop, at a slower
-- cadence, on a message naming a resident's room.
--
-- So the guard moves into the database, where it is one statement with the
-- claim it has to agree with, and where a probe can read it. And a write that
-- matches no row RAISES here rather than returning quietly: a send whose
-- outcome cannot be recorded is precisely the case that must not be silent,
-- because the alternative is sending it again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_observation_escalation_delivery_outcome (p_delivery_id uuid, p_claim_token uuid, p_status text, p_skip_reason text DEFAULT NULL, p_provider_message_id text DEFAULT NULL, p_error_message text DEFAULT NULL, p_sent_at timestamptz DEFAULT NULL)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'An escalation delivery outcome must be sent, failed or skipped, not %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE
    public.observation_escalation_deliveries d
  SET
    status = p_status,
    skip_reason = p_skip_reason,
    provider_message_id = p_provider_message_id,
    error_message = p_error_message,
    sent_at = p_sent_at,
    claim_token = NULL,
    updated_at = now()
  WHERE
    d.id = p_delivery_id
    -- The holder of the claim, and only the holder. A tick that finishes after
    -- its claim was reclaimed must not overwrite the outcome of the tick that
    -- actually sent the message.
    AND d.claim_token = p_claim_token
    -- And only from the state the claim leaves the row in. This is the
    -- predicate whose first version said 'queued' and silently matched nothing.
    AND d.status = 'sending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Escalation delivery % is not held by this claim, so its outcome cannot be recorded', p_delivery_id
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$func$;

COMMENT ON FUNCTION public.record_observation_escalation_delivery_outcome (uuid, uuid, text, text, text, text, timestamptz) IS
  'Records the outcome of one escalation delivery, for the tick that holds its claim and only from the sending state the claim leaves it in. Raises when no row matches, because a send whose outcome cannot be written is the one case that must never be silent: the row would stay claimed, the stale claim reclaim would hand it out again, and the message would send on a loop. Service only.';

REVOKE ALL ON FUNCTION public.record_observation_escalation_delivery_outcome (uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_observation_escalation_delivery_outcome (uuid, uuid, text, text, text, text, timestamptz) TO service_role;

CREATE INDEX IF NOT EXISTS idx_observation_escalation_deliveries_claimable
  ON public.observation_escalation_deliveries (organization_id, facility_id, send_after)
  WHERE status IN ('queued', 'sending');

-- ---------------------------------------------------------------------------
-- M9. One definition of who the module generates for, shared by the generator's
-- exclusion and by the stand down of tasks already on the board.
--
-- The two disagreed. Exclusion asked "is this resident active at this
-- facility?"; the stand down asked "is there a resident at this facility whose
-- status is not active?". A transfer satisfies neither question, so the tasks
-- stayed live at the building the resident had left.
--
-- Generating means: the resident row exists, is not retired, still belongs to
-- this facility, and is in the one status the task generator writes for. The
-- Edge Function stops carrying its own predicate and calls this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stand_down_ungenerated_observation_tasks (p_facility_id uuid, p_at timestamptz DEFAULT now())
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
BEGIN
  UPDATE
    public.resident_observation_tasks t
  SET
    status = 'excused',
    excused_reason = CASE WHEN res.id IS NULL THEN
      'Resident record is no longer available at this facility'
    WHEN res.facility_id IS DISTINCT FROM t.facility_id THEN
      'Resident has transferred to another facility'
    ELSE
      'Resident is no longer active at this facility'
    END
  FROM (
    SELECT
      task.id AS task_id,
      r.id,
      r.facility_id
    FROM
      public.resident_observation_tasks task
      LEFT JOIN public.residents r ON r.id = task.resident_id
        AND r.deleted_at IS NULL
    WHERE
      task.facility_id = p_facility_id) AS res
  WHERE
    t.id = res.task_id
    AND t.deleted_at IS NULL
    AND t.status IN ('upcoming', 'due_soon')
    -- Only a window nobody could have worked yet. A task already due is the
    -- escalation engine's business, and excusing it here would erase a real
    -- lapse.
    AND t.due_at > p_at
    AND (
      -- The record is gone, or retired, or the caller cannot see it.
      res.id IS NULL
      -- The resident transferred. This is the case that was missed: facility_id
      -- points at the new building and the status is still active, so neither
      -- half of the old predicate matched and the tasks stayed live here.
      OR res.facility_id IS DISTINCT FROM t.facility_id
      -- Not in a generating status. Same single value the generator writes for.
      OR NOT EXISTS (
        SELECT
          1
        FROM
          public.residents current_row
        WHERE
          current_row.id = res.id
          AND current_row.status = 'active'));

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$func$;

COMMENT ON FUNCTION public.stand_down_ungenerated_observation_tasks (uuid, timestamptz) IS
  'Excuses every not yet worked observation task at a facility whose resident the module would no longer generate for: the record is gone, the resident has transferred to another building, or their status is not the one the generator writes for. The single definition, shared with the generator so exclusion and stand down cannot disagree; they did, and a transferred resident left live tasks climbing the escalation ladder at the building they had left, ending in an SMS and a critical exec alert naming a room they were not in. Only touches a window that has not come due, so a real lapse is never excused. COL-37 ruling: definer required, because the cron caller has no UPDATE grant on resident_observation_tasks and the command derives every row it touches from the facility it was handed. Service only.';

REVOKE ALL ON FUNCTION public.stand_down_ungenerated_observation_tasks (uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.stand_down_ungenerated_observation_tasks (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- M10. A rung that reached nobody it could ever reach does not take the anchor.
--
-- Replaced from migration 419 with two changes and nothing else: the recipient
-- resolution moves above the dispatch INSERT, and an assigned_staff_only rung
-- that resolved to nobody returns `no_assignee_yet` without writing anything.
--
-- C1's guards are untouched and still come first, in the same order: the task
-- is re-selected FOR UPDATE, the idempotency answer is given before the
-- completion answer, and the terminal status set is still exactly the set
-- observation_escalations_due excludes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_observation_escalation_rung (p_task_id uuid, p_rung_key text, p_at timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_task record;
  v_rung record;
  v_close timestamptz;
  v_shift text;
  v_dispatch_id uuid;
  v_escalation_id uuid := NULL;
  v_facility_name text;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_recipients integer := 0;
  v_audience jsonb;
BEGIN
  -- The lock comes before the decision, not after it.
  --
  -- observation_escalations_due correctly excludes a completed task, but the
  -- engine walks up to five hundred due rows one round trip at a time, so
  -- seconds to minutes pass between that read and this call. A caregiver who
  -- finishes the check inside that gap used to get a full escalation written
  -- against them: a dispatch row, an escalation row, queued deliveries, and at
  -- the terminal rung a critical exec_alerts row that texts an administrator
  -- about a resident who was seen on time. The task status UPDATEs at the end
  -- of this function were already guarded, so the task row itself survived;
  -- everything else in the record did not.
  --
  -- FOR UPDATE makes the re-read authoritative. A completion that is already in
  -- flight blocks here and this statement then sees its committed status,
  -- rather than reading a stale row and deciding against it.
  SELECT
    t.id,
    t.organization_id,
    t.entity_id,
    t.facility_id,
    t.resident_id,
    t.assigned_staff_id,
    t.status INTO v_task
  FROM
    public.resident_observation_tasks t
  WHERE
    t.id = p_task_id
    AND t.deleted_at IS NULL
  FOR UPDATE;

  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'task_not_found');
  END IF;

  -- The idempotency answer comes before the completion answer, because it is
  -- the more specific truth: a rung that already fired did fire, whatever the
  -- task did afterwards, and the engine counts that answer. This is a read; the
  -- INSERT ... ON CONFLICT below is still the anchor that makes two concurrent
  -- ticks safe.
  IF EXISTS (
    SELECT
      1
    FROM
      public.observation_escalation_dispatches d
    WHERE
      d.task_id = p_task_id
      AND d.rung_key = p_rung_key) THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'already_fired', 'rung_key', p_rung_key);
  END IF;

  -- The terminal set is exactly the set observation_escalations_due excludes,
  -- so the due read and this guard cannot drift apart and disagree about what
  -- is still escalatable.
  --
  -- missed is deliberately in the set. Only the terminal rung writes it, no
  -- rung sorts above the terminal one, and a task that has already run the
  -- whole ladder is closed: a rung added below terminal afterwards must not
  -- reopen it.
  IF v_task.status IN ('completed_on_time', 'completed_late', 'excused', 'missed', 'reassigned') THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', CASE WHEN v_task.status::text = 'reassigned' THEN
        'task_reassigned'
      ELSE
        'task_completed'
      END, 'task_status', v_task.status::text);
  END IF;

  v_close := public.observation_task_window_close (p_task_id);
  IF v_close IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'no_window_close');
  END IF;

  SELECT
    sw.shift_key INTO v_shift
  FROM
    public.facility_shift_window_at (v_task.facility_id, v_close) sw;

  SELECT
    r.* INTO v_rung
  FROM
    public.observation_escalation_rungs_at (v_task.facility_id, v_close, v_shift) r
  WHERE
    r.rung_key = p_rung_key;

  IF v_rung.rung_key IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'rung_not_in_force');
  END IF;

  -- M10. Recipients resolve before the anchor, not after it.
  --
  -- The dispatch INSERT below is the (task_id, rung_key) idempotency anchor, and
  -- it used to happen first. The seeded nudge is assigned_staff_only with an
  -- empty target_staff_roles, so on a task with no assigned staff it reached
  -- nobody: the anchor was taken, a skipped delivery was recorded, and the nudge
  -- could never fire for that task again even once somebody was assigned or had
  -- claimed it. The nudge is the rung that catches most misses before they reach
  -- a human, so that silently disabled the early warning on exactly the tasks
  -- most likely to be missed, the ones nobody is assigned to.
  SELECT
    jsonb_agg(to_jsonb (rec)) INTO v_audience
  FROM
    haven.observation_escalation_recipients (v_task.organization_id, v_task.facility_id, v_rung.rung_id, v_task.assigned_staff_id) rec;

  -- A staff reminder that has no staff member to remind has not failed, it is
  -- early. Nothing is written, nothing is anchored, and the next tick tries
  -- again; when the task is assigned, or somebody claims it, the nudge fires
  -- then. This is deliberately narrow: a rung with a real audience that resolves
  -- to nobody is a configuration gap rather than a transient one, and it still
  -- anchors and still records a skipped delivery below, because re-firing it
  -- every tick forever would be noise rather than information.
  IF v_audience IS NULL AND v_rung.assigned_staff_only THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'no_assignee_yet', 'rung_key', v_rung.rung_key);
  END IF;

  INSERT INTO public.observation_escalation_dispatches (organization_id, entity_id, facility_id, resident_id, task_id, escalation_version_id, escalation_rung_id, rung_key, is_terminal, shift_key, window_closes_at, fired_at, channels)
    VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.escalation_version_id, v_rung.rung_id, v_rung.rung_key, v_rung.is_terminal, v_shift, v_close, p_at, v_rung.channels)
  ON CONFLICT (task_id, rung_key)
    DO NOTHING
  RETURNING
    id INTO v_dispatch_id;

  IF v_dispatch_id IS NULL THEN
    RETURN jsonb_build_object('fired', FALSE, 'reason', 'already_fired', 'rung_key', p_rung_key);
  END IF;

  IF NOT v_rung.assigned_staff_only THEN
    INSERT INTO public.resident_observation_escalations (organization_id, entity_id, facility_id, resident_id, task_id, escalation_level, escalation_type, escalation_version_id, rung_key, triggered_at)
      VALUES (v_task.organization_id, v_task.entity_id, v_task.facility_id, v_task.resident_id, v_task.id, v_rung.sort_order, 'auto_overdue', v_rung.escalation_version_id, v_rung.rung_key, p_at)
    RETURNING
      id INTO v_escalation_id;

    UPDATE
      public.observation_escalation_dispatches
    SET
      escalation_id = v_escalation_id
    WHERE
      id = v_dispatch_id;
  END IF;

  -- Written from the audience resolved above rather than by calling the resolver
  -- again per channel: one resolution per firing, so every channel is addressed
  -- to the same people and a roster change mid loop cannot split them.
  FOREACH v_channel IN ARRAY v_rung.channels LOOP
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, send_after)
    SELECT
      v_task.organization_id,
      v_task.facility_id,
      v_dispatch_id,
      rec.notification_route_id,
      v_rung.rung_key,
      rec.target_role,
      rec.target_user_id,
      rec.target_phone,
      v_channel,
      'queued',
      p_at
    FROM
      jsonb_to_recordset(COALESCE(v_audience, '[]'::jsonb)) AS rec (notification_route_id uuid, target_role text, target_user_id uuid, target_phone text);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;
    v_recipients := GREATEST(v_recipients, v_rows);
  END LOOP;

  -- A rung that resolved to nobody is recorded as a skipped delivery rather
  -- than as no delivery, so "nobody was told" is visible in the ledger instead
  -- of looking like a tick that never ran.
  IF v_queued = 0 THEN
    INSERT INTO public.observation_escalation_deliveries (organization_id, facility_id, dispatch_id, notification_route_id, rung_key, target_role, target_user_id, target_phone, channel, status, skip_reason, send_after)
      VALUES (v_task.organization_id, v_task.facility_id, v_dispatch_id, NULL, v_rung.rung_key, 'unresolved', NULL, NULL, v_rung.channels[1], 'skipped', 'no_target', p_at);
  END IF;

  UPDATE
    public.observation_escalation_dispatches
  SET
    recipients_resolved = v_recipients
  WHERE
    id = v_dispatch_id;

  IF v_rung.is_terminal THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'missed',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status NOT IN ('completed_on_time', 'completed_late', 'excused', 'reassigned');
  ELSIF NOT v_rung.assigned_staff_only THEN
    UPDATE
      public.resident_observation_tasks
    SET
      status = 'critically_overdue',
      escalated_at = COALESCE(escalated_at, p_at)
    WHERE
      id = p_task_id
      AND status IN ('upcoming', 'due_soon', 'due_now', 'overdue');
  END IF;

  -- The terminal rung is the one an owner should see without opening the
  -- module. Earlier rungs stay inside the rounding surface.
  --
  -- source_module is 'compliance'. The retired engine wrote 'resident_assurance',
  -- which is not a value of exec_alert_source_module and never has been, so
  -- every exec alert it tried to raise failed. That was the second piece of
  -- drift in that function, alongside the two columns it wrote that do not
  -- exist.
  IF v_rung.is_terminal THEN
    SELECT
      f.name INTO v_facility_name
    FROM
      public.facilities f
    WHERE
      f.id = v_task.facility_id;

    INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
    SELECT
      v_task.organization_id,
      v_task.entity_id,
      v_task.facility_id,
      'compliance',
      'critical',
      format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility')),
      format('An observation window closed without a check and reached the last rung of the facility escalation policy. Open Smart Rounding for the resident and the window.')
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.exec_alerts existing
        WHERE
          existing.organization_id = v_task.organization_id
          AND existing.facility_id = v_task.facility_id
          AND existing.title = format('%s: observation window at %s', v_rung.label, COALESCE(v_facility_name, 'this facility'))
          AND existing.resolved_at IS NULL
          AND existing.deleted_at IS NULL);
  END IF;

  RETURN jsonb_build_object('fired', TRUE, 'rung_key', v_rung.rung_key, 'dispatch_id', v_dispatch_id, 'escalation_id', v_escalation_id, 'is_escalation', NOT v_rung.assigned_staff_only, 'channels', to_jsonb (v_rung.channels), 'shift_key', v_shift, 'deliveries_queued', v_queued, 'recipients', v_recipients);
END;
$func$;

REVOKE ALL ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.record_observation_escalation_rung (uuid, text, timestamptz) IS
  'Fires one escalation rung against one task, once. Re-selects the task FOR UPDATE and refuses to fire anything at all when its status is terminal, because the engine walks a queue read seconds to minutes earlier and a caregiver who completed the check in that gap must not be escalated on. Resolves recipients before writing the dispatch ledger row, so a staff reminder with no staff member to remind answers no_assignee_yet and leaves the (task_id, rung_key) anchor free for the next tick rather than burning the rung on nobody. Writes the resident_observation_escalations row when the rung is a real escalation rather than a staff nudge, and one delivery row per recipient per channel. Returns fired false with a reason when the rung already fired, which is what makes a re-tick of the engine a no-op.';

-- ---------------------------------------------------------------------------
-- M9, the other half. A Monitoring Order stops generating at a building its
-- resident has left.
--
-- Changed from migration 416: one predicate. Without it, standing down a
-- transferred resident's order tasks above would simply hand them back on the
-- next tick, and the board would churn between excused and upcoming every few
-- minutes while the escalation ladder collected fresh tasks each time.
--
-- The order itself is deliberately left `active`. Whether a transfer ends a
-- clinical monitoring instruction or follows the resident to the new building is
-- a clinical decision and not one this migration is entitled to make; it is
-- recorded as an open question for the owner. What it does stop is the order
-- writing checks at a building nobody can work them in.
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
    -- The resident is still in the building this order belongs to, and still in
    -- a status the module generates for.
    AND EXISTS (
      SELECT
        1
      FROM
        public.residents r
      WHERE
        r.id = o.resident_id
        AND r.deleted_at IS NULL
        AND r.facility_id = o.facility_id
        AND r.status = 'active')
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
  'Writes the observation tasks an active Monitoring Order is due, at interval_minutes from starts_at with grace from public.monitoring_order_grace_minutes, out to the end of the next shift or to an explicit horizon. Generates nothing for an order whose resident has transferred away or is no longer in a generating status, so a stood down task is not handed straight back on the next tick. Idempotent: a second call inserts nothing. COL-37 ruling: definer required -- the task generator calls it as service_role and the create command calls it on behalf of a caregiver who has no INSERT grant on resident_observation_tasks, and it writes only rows derived from orders the caller already had to be permitted to create. Not granted to authenticated.';

NOTIFY pgrst,
'reload schema';

COMMIT;
