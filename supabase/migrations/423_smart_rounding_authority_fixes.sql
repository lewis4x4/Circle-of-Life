-- Smart Rounding authority fixes (spec 25A). Four defects found by adversarial
-- review of migrations 414, 416 and 417, plus the assignment support the task
-- generator needs so a generated task has somebody who can work it.
--
-- M2. Every UPDATE policy in the module carried the facility predicate in its
--     USING clause and dropped it from WITH CHECK, so a caller could read a row
--     they were allowed to see and write it into a facility they were not. A
--     facility_admin scoped to one building moved a Monitoring Order into
--     another building; the resident stayed put and the order then claimed to
--     belong somewhere the resident was not. Seven policies, all rebuilt here.
--
-- M1. facility_escalation_rungs_update and its shift override counterpart never
--     required the parent version be draft or pending_approval, so the contents
--     of the escalation ladder currently in force were editable in place. Every
--     escalation row stamped with that version then recomputed against a ladder
--     that was never in force. The cadence window policy already refused the
--     identical edit; the escalation side now does too.
--
-- M3. haven.record_monitoring_order_event returned early unless status changed,
--     so the interval a resident is checked at, who ordered it, how it arrived
--     and the clinical reason could all be rewritten on an active clinical order
--     with no history row. Spec 4.2 requires append only history on every
--     mutation. The ledger stays append only: no UPDATE policy, no DELETE
--     policy, no write grant to authenticated.
--
-- M0. The generator assigned a task only where a shift_assignments row already
--     named the resident, and left it unassigned otherwise. An unassigned task
--     with no live assignment row is completable by nobody below nurse, which is
--     a tested SYS-001 invariant, so those tasks sat on the board unworkable by
--     the floor. Owner decision: auto assign from the employee shift schedule.
--     public.resolve_observation_task_assignees is the fallback chain, and
--     public.record_cadence_observation_tasks now writes the assignment row that
--     lets the assignee guard pass through the assignment path rather than only
--     through assigned_staff_id.
--
-- Nothing here weakens an authorization guard. haven.complete_rounding_task_core
-- and public.complete_rounding_task_review are untouched.
BEGIN;

-- ---------------------------------------------------------------------------
-- M2 and M1. The seven UPDATE policies.
--
-- Shape, applied to all of them:
--   USING       organization, not deleted, role, facility in reach
--   WITH CHECK  organization, role, facility in reach
--
-- The facility predicate has to appear twice. USING decides which row the
-- caller may touch; WITH CHECK decides what the row is allowed to become. A
-- policy that omits it from WITH CHECK lets a caller move a row out of their
-- own scope in a single statement, and the row lands somewhere they can no
-- longer see, so nothing they can read afterwards shows what they did.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS facility_shift_definitions_update ON public.facility_shift_definitions;

CREATE POLICY facility_shift_definitions_update ON public.facility_shift_definitions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

DROP POLICY IF EXISTS facility_cadence_versions_update ON public.facility_cadence_versions;

CREATE POLICY facility_cadence_versions_update ON public.facility_cadence_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- The cadence window policy already refused an edit to an in force version.
-- What it did not do was require the version the row is moving *to* be a draft,
-- so a window could be detached from a draft and reattached to the version
-- currently generating tasks. Both halves now carry the same test.
DROP POLICY IF EXISTS facility_cadence_windows_update ON public.facility_cadence_windows;

CREATE POLICY facility_cadence_windows_update ON public.facility_cadence_windows
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_cadence_versions v
      WHERE
        v.id = facility_cadence_windows.cadence_version_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')
        AND (haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'manager'))))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_cadence_versions v
      WHERE
        v.id = facility_cadence_windows.cadence_version_id
        AND v.facility_id = facility_cadence_windows.facility_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')));

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
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.can_cancel_monitoring_order (haven.app_role ()::text));

DROP POLICY IF EXISTS facility_escalation_versions_update ON public.facility_escalation_versions;

CREATE POLICY facility_escalation_versions_update ON public.facility_escalation_versions
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- M1 lands on these two. The role list is unchanged from 417 on purpose:
-- widening it to match the cadence window policy would hand facility_admin and
-- manager an edit they do not have today, and this migration only ever removes
-- authority. What it adds is the parent status test the cadence side already
-- carried.
DROP POLICY IF EXISTS facility_escalation_rungs_update ON public.facility_escalation_rungs;

CREATE POLICY facility_escalation_rungs_update ON public.facility_escalation_rungs
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = facility_escalation_rungs.escalation_version_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = facility_escalation_rungs.escalation_version_id
        AND v.facility_id = facility_escalation_rungs.facility_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')));

DROP POLICY IF EXISTS facility_escalation_rung_shift_overrides_update ON public.facility_escalation_rung_shift_overrides;

CREATE POLICY facility_escalation_rung_shift_overrides_update ON public.facility_escalation_rung_shift_overrides
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = facility_escalation_rung_shift_overrides.escalation_version_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        public.facility_escalation_versions v
      WHERE
        v.id = facility_escalation_rung_shift_overrides.escalation_version_id
        AND v.facility_id = facility_escalation_rung_shift_overrides.facility_id
        AND v.deleted_at IS NULL
        AND v.status IN ('draft', 'pending_approval')));

-- ---------------------------------------------------------------------------
-- M2, second half. An order's facility and its resident's facility are one fact.
--
-- Row level security stops a caller moving an order somewhere they cannot
-- reach. It cannot stop a caller who can reach both buildings from moving an
-- order into the wrong one, because both facilities pass the same predicate.
-- Nothing validated the pair, so an order could claim to belong to one building
-- for a resident who lives in another, and every facility scoped read then
-- disagreed about whose resident it was.
--
-- Fires on insert, and on update only when facility_id actually moves, so a
-- resident who transfers buildings does not freeze the cancel path on their
-- existing orders.
--
-- AFTER, not BEFORE, and the ordering is the point. Row level security evaluates
-- WITH CHECK after every BEFORE trigger and before every AFTER trigger, so a
-- BEFORE trigger here would raise on a caller who is simply out of scope and
-- turn a clean `UPDATE 0` into an error that names a facility the caller was
-- never allowed to know about. AFTER leaves row level security to answer first
-- and catches only the caller who can reach both buildings and picked the wrong
-- one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.assert_monitoring_order_facility_matches_resident ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_resident_facility uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id THEN
    RETURN NULL;
  END IF;

  SELECT
    r.facility_id INTO v_resident_facility
  FROM
    public.residents r
  WHERE
    r.id = NEW.resident_id;

  IF v_resident_facility IS NULL THEN
    RAISE EXCEPTION 'Monitoring Order names a resident that does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_resident_facility IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'A Monitoring Order must belong to the facility its resident lives at'
      USING ERRCODE = '23514';
  END IF;

  -- An AFTER row trigger's return value is ignored.
  RETURN NULL;
END;
$func$;

COMMENT ON FUNCTION haven.assert_monitoring_order_facility_matches_resident () IS
  'Refuses a Monitoring Order whose facility_id is not the facility its resident lives at, on insert and on any update that moves facility_id. A definer because it reads public.residents on behalf of a writer whose own reach may be narrower than the row they are writing; execute is revoked from every request role, and a trigger function is authorized at CREATE TRIGGER time rather than at fire time.';

REVOKE ALL ON FUNCTION haven.assert_monitoring_order_facility_matches_resident () FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_resident_monitoring_orders_facility_matches_resident ON public.resident_monitoring_orders;

CREATE TRIGGER tr_resident_monitoring_orders_facility_matches_resident
  AFTER INSERT OR UPDATE ON public.resident_monitoring_orders
  FOR EACH ROW
  EXECUTE FUNCTION haven.assert_monitoring_order_facility_matches_resident ();

-- ---------------------------------------------------------------------------
-- M3. The Monitoring Order ledger records every material change, not only a
-- status transition.
--
-- Two columns, because a history row now answers two different questions and
-- collapsing them into from_status and to_status would make a field change read
-- as a status change that went nowhere.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_monitoring_order_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'status_change';

ALTER TABLE public.resident_monitoring_order_events
  ADD COLUMN IF NOT EXISTS changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.resident_monitoring_order_events
  DROP CONSTRAINT IF EXISTS resident_monitoring_order_events_event_type_known;

ALTER TABLE public.resident_monitoring_order_events
  ADD CONSTRAINT resident_monitoring_order_events_event_type_known CHECK (event_type IN ('status_change', 'field_change'));

ALTER TABLE public.resident_monitoring_order_events
  DROP CONSTRAINT IF EXISTS resident_monitoring_order_events_changed_fields_array;

ALTER TABLE public.resident_monitoring_order_events
  ADD CONSTRAINT resident_monitoring_order_events_changed_fields_array CHECK (jsonb_typeof(changed_fields) = 'array');

-- A field change row that names no field is a row that says nothing happened.
ALTER TABLE public.resident_monitoring_order_events
  DROP CONSTRAINT IF EXISTS resident_monitoring_order_events_field_change_names_a_field;

ALTER TABLE public.resident_monitoring_order_events
  ADD CONSTRAINT resident_monitoring_order_events_field_change_names_a_field CHECK (event_type <> 'field_change'
    OR jsonb_array_length(changed_fields) > 0);

COMMENT ON COLUMN public.resident_monitoring_order_events.event_type IS
  'status_change when the order moved between statuses, field_change when it did not and something material about it did. A status change that also rewrote fields is a status_change row whose changed_fields names them.';
COMMENT ON COLUMN public.resident_monitoring_order_events.changed_fields IS
  'Ordered array of {"field","from","to"} objects naming every material column that changed on this mutation. Empty on the opening row, where nothing changed because nothing existed before.';

CREATE OR REPLACE FUNCTION haven.record_monitoring_order_event ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  -- Everything about an order a reader would want explained, which is every
  -- column except the audit bookkeeping the audit trigger already carries.
  -- interval_minutes is the one that matters most: it is how often a resident is
  -- physically looked at, and before this it could be halved with no trace here.
  c_material CONSTANT text[] := ARRAY['organization_id', 'entity_id', 'facility_id', 'resident_id', 'source_watch_instance_id', 'interval_minutes', 'starts_at', 'ends_at', 'review_due_at', 'ordered_by_type', 'ordered_by_name', 'order_received_as', 'reason_category', 'reason_note', 'document_path', 'entered_by', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'deleted_at'];
  v_actor uuid;
  v_role text;
  v_note text;
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb := '[]'::jsonb;
  v_status_changed boolean;
  v_event_type text;
BEGIN
  v_status_changed := TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('field', k, 'from', v_old -> k, 'to', v_new -> k) ORDER BY k), '[]'::jsonb) INTO v_changed
    FROM
      unnest(c_material) AS k
    WHERE
      v_old -> k IS DISTINCT FROM v_new -> k;
  END IF;

  -- An update that moved nothing a reader cares about, such as a bare
  -- updated_at touch, leaves no row. Silence here is honest; silence about an
  -- interval change was not.
  IF NOT v_status_changed AND jsonb_array_length(v_changed) = 0 THEN
    RETURN NEW;
  END IF;

  v_event_type := CASE WHEN v_status_changed THEN
    'status_change'
  ELSE
    'field_change'
  END;

  IF TG_OP = 'INSERT' THEN
    v_actor := COALESCE(auth.uid(), NEW.entered_by);
    v_note := NULL;
  ELSE
    v_actor := COALESCE(auth.uid(), NEW.cancelled_by, NEW.entered_by);
    v_note := CASE WHEN v_status_changed AND NEW.status = 'cancelled' THEN
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

  INSERT INTO public.resident_monitoring_order_events (organization_id, facility_id, monitoring_order_id, resident_id, from_status, to_status, event_type, changed_fields, note, actor_id, actor_role)
    VALUES (NEW.organization_id, NEW.facility_id, NEW.id, NEW.resident_id, CASE WHEN TG_OP = 'INSERT' THEN
        NULL
      ELSE
        OLD.status
      END, NEW.status, v_event_type, v_changed, v_note, v_actor, v_role);

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.record_monitoring_order_event () IS
  'Writes the append only history row for a Monitoring Order: every status transition, and every change to a material field whether or not the status moved. A definer so the history lands whatever the writer''s authority is, and so a writer with UPDATE on the order table cannot rewrite the interval a resident is checked at without leaving the trail. The ledger has no UPDATE policy and no DELETE policy; that is what append only means here.';

-- ---------------------------------------------------------------------------
-- M0. Who works a generated task.
--
-- Three steps, in order, and the third one is a defect rather than a guess:
--
--   1. resident_split   a shift_assignments row for this shift already names
--                       the resident. Unchanged behaviour.
--   2. shift_roster     nobody split the residents, but staff are scheduled for
--                       this shift at this facility. Spread the residents across
--                       them by a stable hash of resident_id against the ordered
--                       staff list, so one task has one owner and a re-run picks
--                       the same owner rather than reshuffling the board.
--   3. none_scheduled   nobody is scheduled. No assignee is invented. The caller
--                       raises a visible defect and still generates, so the
--                       staffing gap is counted rather than hidden.
--
-- The ring is ordered by staff_id and the position comes from
-- hashtextextended(resident_id), both of which are stable for the life of the
-- data, so the same roster and the same residents produce the same assignment on
-- every tick of every day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_observation_task_assignees (p_facility_id uuid, p_shift_service_date date, p_roster_shift_type text, p_resident_ids uuid[])
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
)
SELECT
  r.resident_id,
  COALESCE(sp.shift_assignment_id, fallback.id) AS shift_assignment_id,
  COALESCE(sp.staff_id, fallback.staff_id) AS staff_id,
  CASE WHEN sp.staff_id IS NOT NULL THEN
    'resident_split'
  WHEN fallback.staff_id IS NOT NULL THEN
    'shift_roster'
  ELSE
    'none_scheduled'
  END AS assignment_source
FROM
  unnest(p_resident_ids) AS r (resident_id)
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
ORDER BY
  r.resident_id;
$func$;

COMMENT ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) IS
  'Who should own each resident''s observation tasks for one shift at one facility: the staff member the resident split already names, else a staff member scheduled for that shift chosen by a stable hash so the choice survives a re-run, else nobody and assignment_source none_scheduled. The shift is matched on shift_assignments.shift_type, which is a fixed enum, rather than on the renameable shift_key. Service only: the task generator is the caller, and it runs as service_role.';

REVOKE ALL ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_observation_task_assignees (uuid, date, text, uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- M0, step 3. A shift nobody is scheduled for is a defect a human can see.
--
-- Shaped like the alert fn_facilities_seed_observation_defaults writes for a
-- building with no cadence: same table, same de-duplication on an unresolved
-- title, so the two staffing and configuration gaps read the same way on the
-- executive surface. Named by the shift's label rather than its key, because a
-- configuration key is not operator vocabulary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_observation_staffing_gap (p_facility_id uuid, p_shift_key text, p_service_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_shift_label text;
  v_title text;
  v_recorded integer := 0;
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
    d.label INTO v_shift_label
  FROM
    public.facility_shift_definitions d
  WHERE
    d.facility_id = p_facility_id
    AND d.shift_key = p_shift_key
    AND d.deleted_at IS NULL;

  v_title := format('Nobody is scheduled for the %s at %s on %s', COALESCE(v_shift_label, 'shift'), v_facility.name, to_char(p_service_date, 'FMMonth FMDD, YYYY'));

  INSERT INTO public.exec_alerts (organization_id, entity_id, facility_id, source_module, severity, title, body)
  SELECT
    v_facility.organization_id,
    v_facility.entity_id,
    v_facility.id,
    'staff',
    'warning',
    v_title,
    'Observation checks were generated for this shift and there is no staff member on the schedule to own them. Nobody was invented as the assignee, so these checks are completable only by a nurse or an administrator until the schedule is filled in. Open the schedule for this facility and this date.'
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
  'Records an open exec_alerts row naming a facility, a shift and a service date for which observation tasks were generated and no staff member is scheduled to own them. Idempotent against an unresolved alert with the same title, so a cron that ticks every few minutes raises the gap once. COL-37 ruling: definer required, because the task generator writes an executive alert on behalf of nobody and has no caller authority to inherit. Execute is granted to service_role only.';

REVOKE ALL ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_observation_staffing_gap (uuid, text, date) TO service_role;

-- ---------------------------------------------------------------------------
-- M0, the write. A generated task that names an assignee also gets the
-- assignment row, so the assignee guard in haven.complete_rounding_task_core
-- passes through the assignment path and the board carries an audit trail
-- naming who owns the check.
--
-- Changed from 414: the insert moved into a CTE so the new task ids are
-- available, the assignment insert was added, and the count now comes from the
-- CTE rather than from GET DIAGNOSTICS. The conflict target, the column list and
-- the idempotency behaviour are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cadence_observation_tasks (p_rows jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_inserted integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cadence observation task payload must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  WITH inserted AS (
    INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, cadence_version_id, window_key, service_date, shift_assignment_id, assigned_staff_id, scheduled_for, due_at, grace_ends_at, status)
    SELECT
      r.organization_id,
      r.entity_id,
      r.facility_id,
      r.resident_id,
      r.cadence_version_id,
      r.window_key,
      r.service_date,
      r.shift_assignment_id,
      r.assigned_staff_id,
      r.scheduled_for,
      r.due_at,
      r.grace_ends_at,
      COALESCE(r.status, 'upcoming')::public.resident_observation_task_status
    FROM
      jsonb_to_recordset(p_rows) AS r (organization_id uuid, entity_id uuid, facility_id uuid, resident_id uuid, cadence_version_id uuid, window_key text, service_date date, shift_assignment_id uuid, assigned_staff_id uuid, scheduled_for timestamptz, due_at timestamptz, grace_ends_at timestamptz, status text)
    ON CONFLICT (resident_id, window_key, service_date)
      WHERE deleted_at IS NULL AND window_key IS NOT NULL
      DO NOTHING
    RETURNING
      id, organization_id, entity_id, facility_id, resident_id, shift_assignment_id, assigned_staff_id
),
  assigned AS (
  INSERT INTO public.resident_observation_assignments (organization_id, entity_id, facility_id, resident_id, task_id, shift_assignment_id, staff_id, assignment_type)
  SELECT
    i.organization_id,
    i.entity_id,
    i.facility_id,
    i.resident_id,
    i.id,
    i.shift_assignment_id,
    i.assigned_staff_id,
    'primary'::public.resident_observation_assignment_type
  FROM
    inserted i
  WHERE
    i.assigned_staff_id IS NOT NULL
  ON CONFLICT (task_id, staff_id)
    WHERE released_at IS NULL
    DO NOTHING
  RETURNING
    id
)
  SELECT
    count(*)::integer INTO v_inserted
  FROM
    inserted;

  RETURN v_inserted;
END;
$func$;

COMMENT ON FUNCTION public.record_cadence_observation_tasks (jsonb) IS
  'Inserts generated facility cadence tasks, ignoring any that already exist for the same resident, window and service date, and writes the primary resident_observation_assignments row for every new task that names an assignee. A second generator run inserts nothing and assigns nothing. The assignment row is what lets a caregiver complete the check through the assignment path rather than only through assigned_staff_id.';

NOTIFY pgrst,
'reload schema';

COMMIT;
