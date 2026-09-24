-- COL-750: resident movement carries the date it happened, not the date it
-- was saved.
--
-- Until now every status change (hospital out and back, leave out and back,
-- discharge, death, arrival) was dated by the capture trigger (217, 433) at
-- now(): a discharge entered Wednesday for a Monday departure read as
-- Wednesday everywhere that reads resident_status_history, and the real date
-- survived only in residents.discharge_date. Thursday's Stand Up compares
-- against Monday and Monday reports last week (COL-749), so both are only true
-- if each movement is dated when it happened.
--
-- What changes:
--
--   1. residents.status_effective_at / status_effective_reason. A status change
--      may carry the time it actually happened (and, when late, why). Omitted,
--      it is the save time, exactly as before. The value is kept on the
--      resident as "when the current status began".
--   2. haven.resident_status_effective_guard (BEFORE trigger on residents), for
--      every writer, browser or SQL:
--        - a future time is refused;
--        - a time at or before the resident's last recorded change is refused,
--          because the two intervals would overlap (pre-admission states,
--          inquiry and pending admission, are not census and give way);
--        - a time older than the facility's back-date window needs an owner or
--          org admin AND a reason. The window is the operating rule
--          resident_movement.backdate_window_days (491 registry), so it is
--          runtime-configurable and effective-dated. An unreadable value
--          means no window: every back-date then needs an owner or org admin.
--        - a discharge's time must fall on its discharge date.
--   3. fn_resident_status_history_capture writes that time instead of now().
--      created_at on the history row stays the save time (the recorded-at).
--      New columns: effective_basis says whether the start is a save time, an
--      entered time or an admission date (so the record no longer has to guess
--      from a midnight), late_entry_reason keeps the reason.
--   4. A deferred constraint trigger refuses overlapping live intervals for a
--      resident, whoever writes the history table.
--   5. confirm_admission_arrival_review takes the arrival time (optional) and
--      dates the move-in with it.
--   6. Readers: admission_discharge_register returns the recorded-at, basis and
--      late-entry reason beside the effective time; stand_up_roster_census_as_of
--      counts the roster at any past instant from effective dates (Thursday vs
--      Monday, COL-754); record_census_daily_log counts the census in force when
--      the log day began, from effective dates, instead of whatever the roster
--      says when the job happens to run. It also stops failing on a resident
--      with no payer (null jsonb key), which has kept production from
--      recording any day since 2026-09-22.
--
-- Numbering: first applied to staging and production as 503 on 2026-09-24,
-- then renumbered to 504 when PR #874 had already claimed 503; both hosted
-- ledger rows were moved to 504 (the seeded rule's change_reason there still
-- says 503).
--
-- Seed: every organization gets resident_movement.backdate_window_days = 3 (the
-- default proposed in the PR: a weekend's movements can still be entered on
-- Monday without an owner). Owners change it on Settings -> Threshold targets.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The back-date window is an operating rule
-- ---------------------------------------------------------------------------
ALTER TABLE public.operating_rules DROP CONSTRAINT IF EXISTS operating_rules_rule_key_check;
ALTER TABLE public.operating_rules ADD CONSTRAINT operating_rules_rule_key_check CHECK (rule_key IN (
  'risk.score_bands',
  'survey_binder.due_window_days',
  'compliance.score_alert_below_pct',
  'resident_movement.backdate_window_days'
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
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.operating_rules_validate_row() FROM PUBLIC, anon, authenticated;

-- The resolver's built-in default, as 491 does for its keys, so an
-- organization created later (or with no row) gets the same proposed window
-- rather than none.
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
SELECT o.id, NULL, 'resident_movement.backdate_window_days', '3'::jsonb,
       DATE '2026-09-24',
       'Seeded by migration 504 (COL-750): proposed default. Staff may date a resident movement up to 3 days back (Eastern calendar days); older needs an owner or org admin and a reason.'
FROM public.organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS status_effective_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_effective_reason text
    CONSTRAINT residents_status_effective_reason_length
    CHECK (status_effective_reason IS NULL OR char_length(btrim(status_effective_reason)) BETWEEN 1 AND 500);
COMMENT ON COLUMN public.residents.status_effective_at IS
  'COL-750: when the current status actually began. Supplied with a status change ("when did this happen?"); omitted, it is the save time. Null only for residents whose status has not changed since COL-750; resident_status_history is the timeline.';
COMMENT ON COLUMN public.residents.status_effective_reason IS
  'COL-750: why the current status was entered late. Required when its time is older than the resident_movement.backdate_window_days operating rule.';

ALTER TABLE public.resident_status_history
  ADD COLUMN IF NOT EXISTS effective_basis text
    CONSTRAINT resident_status_history_effective_basis_check
    CHECK (effective_basis IS NULL OR effective_basis IN ('save_time', 'entered', 'admission_date')),
  ADD COLUMN IF NOT EXISTS late_entry_reason text
    CONSTRAINT resident_status_history_late_entry_reason_length
    CHECK (late_entry_reason IS NULL OR char_length(btrim(late_entry_reason)) BETWEEN 1 AND 500);
COMMENT ON COLUMN public.resident_status_history.effective_basis IS
  'COL-750: what effective_from is. save_time = the moment it was saved; entered = the time staff said it happened; admission_date = midnight Eastern of the admission date. Null on rows written before COL-750. created_at is always the save time (recorded at).';
COMMENT ON COLUMN public.resident_status_history.late_entry_reason IS
  'COL-750: the reason given for a change entered later than the back-date window allows.';

-- ---------------------------------------------------------------------------
-- 3. The guard, for every writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.resident_status_effective_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_tz text;
  v_today date;
  v_at timestamptz;
  v_reason text;
  v_window jsonb;
  v_window_days integer;
  v_role text;
  v_last_from timestamptz;
  v_last_status public.resident_status;
BEGIN
  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = NEW.facility_id;
  v_tz := coalesce(v_tz, 'America/New_York');

  IF TG_OP = 'INSERT' THEN
    -- Mirrors the first history row the capture trigger opens.
    NEW.status_effective_at := coalesce(NEW.admission_date::timestamp AT TIME ZONE v_tz, v_now);
    NEW.status_effective_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.status_effective_at IS DISTINCT FROM OLD.status_effective_at
       OR NEW.status_effective_reason IS DISTINCT FROM OLD.status_effective_reason THEN
      RAISE EXCEPTION 'When a status began is recorded with the status change itself. Change the status to record when it happened.'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  v_reason := nullif(btrim(coalesce(NEW.status_effective_reason, '')), '');

  -- Not supplied (or supplied as now): the save time, as before COL-750.
  IF NEW.status_effective_at IS NULL
     OR NEW.status_effective_at IS NOT DISTINCT FROM OLD.status_effective_at
     OR NEW.status_effective_at = v_now THEN
    NEW.status_effective_at := v_now;
    NEW.status_effective_reason := v_reason;
    RETURN NEW;
  END IF;

  v_at := NEW.status_effective_at;
  v_today := (v_now AT TIME ZONE v_tz)::date;

  IF v_at > v_now THEN
    RAISE EXCEPTION 'A resident movement cannot be dated in the future. Enter when it actually happened.'
      USING ERRCODE = '22023';
  END IF;

  -- Overlap: the new interval must start after the last recorded census change.
  SELECT h.effective_from, h.status INTO v_last_from, v_last_status
  FROM public.resident_status_history h
  WHERE h.resident_id = NEW.id
    AND h.deleted_at IS NULL
    AND h.status NOT IN ('inquiry', 'pending_admission')
  ORDER BY h.effective_from DESC
  LIMIT 1;
  IF v_last_from IS NULL
     AND OLD.status NOT IN ('inquiry', 'pending_admission')
     AND NOT EXISTS (SELECT 1 FROM public.resident_status_history h WHERE h.resident_id = NEW.id AND h.deleted_at IS NULL) THEN
    -- A resident from before history capture: the capture trigger opens the
    -- outgoing interval here, so the same boundary applies.
    v_last_from := coalesce(OLD.admission_date::timestamp AT TIME ZONE v_tz, OLD.created_at);
    v_last_status := OLD.status;
  END IF;
  IF v_last_from IS NOT NULL AND v_at <= v_last_from THEN
    RAISE EXCEPTION 'This would overlap the resident''s last recorded change (% on %). Choose a time after it, or correct that change first.',
      CASE v_last_status WHEN 'active' THEN 'in house' WHEN 'hospital_hold' THEN 'to hospital'
        WHEN 'loa' THEN 'on leave' ELSE v_last_status::text END,
      to_char(v_last_from AT TIME ZONE v_tz, 'FMMon FMDD, YYYY FMHH12:MI AM')
      USING ERRCODE = '23P01';
  END IF;

  IF NEW.status IN ('discharged', 'deceased') AND NEW.discharge_date IS NOT NULL
     AND (v_at AT TIME ZONE v_tz)::date <> NEW.discharge_date THEN
    RAISE EXCEPTION 'The time of the discharge must fall on the discharge date.'
      USING ERRCODE = '22023';
  END IF;

  -- The back-date window, as of today, for this facility.
  SELECT r.value INTO v_window
  FROM public.haven_operating_rule(NEW.organization_id, NEW.facility_id, 'resident_movement.backdate_window_days', v_today) r;
  v_window_days := CASE
    WHEN jsonb_typeof(v_window) = 'number' AND v_window::text ~ '^[0-9]+$' THEN v_window::text::integer
  END;

  IF v_window_days IS NULL OR (v_at AT TIME ZONE v_tz)::date < v_today - v_window_days THEN
    IF auth.uid() IS NOT NULL THEN
      v_role := haven.app_role()::text;
    ELSE
      -- No signed-in user: a trusted server call (service role, which can run
      -- set_config) names its actor in haven.movement_actor for the
      -- transaction. updated_by cannot carry it: haven_set_updated_at
      -- overwrites it with auth.uid() before this trigger runs.
      SELECT p.app_role::text INTO v_role
      FROM public.user_profiles p
      WHERE p.id = nullif(current_setting('haven.movement_actor', true), '')::uuid
        AND p.deleted_at IS NULL AND p.organization_id = NEW.organization_id;
    END IF;
    IF v_role IS NULL OR v_role NOT IN ('owner', 'org_admin') THEN
      RAISE EXCEPTION 'Only an owner or org admin can date a resident movement more than % day(s) back. Ask one to enter it, with the reason it is late.',
        coalesce(v_window_days, 0)
        USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Say why this movement is being entered late.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.status_effective_reason := v_reason;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.resident_status_effective_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_residents_status_effective_guard ON public.residents;
CREATE TRIGGER tr_residents_status_effective_guard
  BEFORE INSERT OR UPDATE ON public.residents
  FOR EACH ROW EXECUTE FUNCTION haven.resident_status_effective_guard();

-- ---------------------------------------------------------------------------
-- 4. The capture trigger writes the effective time
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_resident_status_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_actor uuid;
  v_at timestamptz;
  v_basis text;
  v_tz text;
BEGIN
  v_actor := COALESCE(NEW.updated_by, NEW.created_by, auth.uid());
  SELECT COALESCE(timezone, 'America/New_York') INTO v_tz FROM public.facilities WHERE id = NEW.facility_id;
  v_tz := COALESCE(v_tz, 'America/New_York');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.resident_status_history (
      organization_id, facility_id, resident_id, status, effective_from, effective_basis, created_by, updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      COALESCE(NEW.status_effective_at, NEW.admission_date::timestamp AT TIME ZONE v_tz, now()),
      CASE WHEN NEW.admission_date IS NOT NULL THEN 'admission_date' ELSE 'save_time' END,
      v_actor,
      v_actor
    )
    ON CONFLICT (resident_id) WHERE effective_to IS NULL AND deleted_at IS NULL DO NOTHING;

    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_at := COALESCE(NEW.status_effective_at, now());
      v_basis := CASE WHEN v_at = now() THEN 'save_time' ELSE 'entered' END;
    ELSE
      -- A facility-only change keeps the save time (433).
      v_at := now();
      v_basis := 'save_time';
    END IF;

    -- Residents predating history capture still need an outgoing interval.
    INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_basis,created_by,updated_by)
    SELECT OLD.organization_id,OLD.facility_id,OLD.id,OLD.status,
      COALESCE(OLD.admission_date::timestamp AT TIME ZONE (SELECT COALESCE(timezone,'America/New_York') FROM public.facilities WHERE id=OLD.facility_id),OLD.created_at),
      CASE WHEN OLD.admission_date IS NOT NULL THEN 'admission_date' ELSE 'save_time' END,
      v_actor,v_actor
    WHERE NOT EXISTS(SELECT 1 FROM public.resident_status_history WHERE resident_id=OLD.id AND deleted_at IS NULL);

    -- Close the interval in force at v_at. The guard has already refused any
    -- time at or before the last census change, so the only intervals that can
    -- reach past v_at are pre-admission ones (inquiry, pending admission):
    -- they end at v_at, and one that began after it collapses to an empty
    -- interval rather than overlapping the arrival.
    UPDATE public.resident_status_history
       SET effective_from = LEAST(effective_from, v_at),
           effective_to = v_at,
           updated_at = now(),
           updated_by = v_actor
     WHERE resident_id = NEW.id
       AND deleted_at IS NULL
       AND (effective_to IS NULL OR effective_to > v_at);

    INSERT INTO public.resident_status_history (
      organization_id, facility_id, resident_id, status, effective_from, effective_basis, late_entry_reason, created_by, updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      v_at,
      v_basis,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status_effective_reason END,
      v_actor,
      v_actor
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. No overlapping live intervals, whoever writes the history
-- ---------------------------------------------------------------------------
-- Deferred to commit so a writer that closes one interval and opens the next in
-- two statements is judged on the result. Checks only the resident touched.
CREATE OR REPLACE FUNCTION haven.resident_status_history_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cur public.resident_status_history%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM public.resident_status_history WHERE id = NEW.id;
  IF NOT FOUND OR cur.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.resident_status_history h
    WHERE h.resident_id = cur.resident_id
      AND h.id <> cur.id
      AND h.deleted_at IS NULL
      AND tstzrange(h.effective_from, coalesce(h.effective_to, 'infinity'::timestamptz), '[)')
          && tstzrange(cur.effective_from, coalesce(cur.effective_to, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Resident status history cannot overlap: two intervals for this resident cover the same time.'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION haven.resident_status_history_no_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_resident_status_history_no_overlap ON public.resident_status_history;
CREATE CONSTRAINT TRIGGER tr_resident_status_history_no_overlap
  AFTER INSERT OR UPDATE ON public.resident_status_history
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION haven.resident_status_history_no_overlap();

-- ---------------------------------------------------------------------------
-- 6. Arrival is dated when the resident arrived
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.confirm_admission_arrival_review(uuid,uuid,date);
CREATE FUNCTION public.confirm_admission_arrival_review(
  p_case_id uuid,
  p_actor_id uuid,
  p_arrival_date date,
  p_arrival_at timestamptz DEFAULT NULL,
  p_late_entry_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c admission_cases%ROWTYPE; r residents%ROWTYPE; b beds%ROWTYPE; today date; tz text; v_at timestamptz;
BEGIN
 SELECT * INTO STRICT c FROM admission_cases WHERE id=p_case_id AND deleted_at IS NULL FOR UPDATE;
 SELECT coalesce(timezone,'America/New_York') INTO tz FROM facilities WHERE id=c.facility_id;
 tz := coalesce(tz,'America/New_York');
 today := (now() AT TIME ZONE tz)::date;
 IF c.actual_arrival_at IS NOT NULL THEN RETURN c.resident_id; END IF;
 IF c.status::text IN('cancelled','closed') THEN RAISE EXCEPTION 'A cancelled or closed admission cannot confirm arrival'; END IF;
 IF p_arrival_date IS NULL OR p_arrival_date>today OR p_arrival_at>now() THEN RAISE EXCEPTION 'Choose an actual arrival date, not a future date'; END IF;
 IF p_arrival_at IS NOT NULL AND (p_arrival_at AT TIME ZONE tz)::date<>p_arrival_date THEN RAISE EXCEPTION 'The arrival time must fall on the arrival date'; END IF;
 IF c.financial_clearance_at IS NULL OR c.physician_orders_received_at IS NULL OR c.bed_id IS NULL OR NOT EXISTS(SELECT 1 FROM admission_case_rate_terms WHERE admission_case_id=c.id) THEN RAISE EXCEPTION 'Complete financial, physician-order, bed and rate readiness first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT fr.* FROM form_1823_records fr WHERE fr.resident_id=c.resident_id AND fr.deleted_at IS NULL ORDER BY CASE WHEN fr.admission_case_id=c.id THEN 1 ELSE 0 END DESC,fr.updated_at DESC,fr.id DESC LIMIT 1) f JOIN admission_document_checklist_items d ON d.admission_case_id=c.id AND d.document_type='form_1823' WHERE f.resident_id=c.resident_id AND f.status='received' AND f.exam_date<=today AND f.expiration_date>=today AND nullif(trim(f.physician_name),'') IS NOT NULL AND d.received_at IS NOT NULL AND nullif(trim(d.notes),'') IS NOT NULL AND f.deleted_at IS NULL AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'Current Form 1823 and verified evidence are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=c.resident_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF r.gender IS NULL OR r.date_of_birth IS NULL THEN RAISE EXCEPTION 'Complete resident date of birth and gender before confirming arrival'; END IF;
 PERFORM bed.id FROM public.beds bed WHERE bed.id IN(r.bed_id,c.bed_id) ORDER BY bed.id FOR UPDATE;
 SELECT * INTO STRICT b FROM beds WHERE id=c.bed_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF b.reserved_for_admission_case_id IS NOT NULL AND b.reserved_for_admission_case_id<>c.id THEN RAISE EXCEPTION 'The selected bed is reserved for another admission'; END IF;
 IF b.current_resident_id IS NOT NULL AND b.current_resident_id<>r.id THEN RAISE EXCEPTION 'The selected bed is occupied by another resident'; END IF;
 IF b.status NOT IN('available','hold','occupied') THEN RAISE EXCEPTION 'The bed is unavailable for arrival'; END IF;
 -- Today with no time is now; an earlier day with no time is that day's start
 -- (the admission-date convention the capture trigger already uses).
 v_at := coalesce(p_arrival_at, CASE WHEN p_arrival_date=today THEN now() ELSE p_arrival_date::timestamp AT TIME ZONE tz END);
 -- The route calls as the service role; name the actor for the movement guard.
 PERFORM set_config('haven.movement_actor', p_actor_id::text, true);
 UPDATE residents SET status='active',admission_date=p_arrival_date,bed_id=b.id,
   status_effective_at=v_at,status_effective_reason=nullif(btrim(coalesce(p_late_entry_reason,'')),''),
   updated_by=p_actor_id WHERE id=r.id;
 UPDATE beds SET status='occupied',current_resident_id=r.id,reserved_for_admission_case_id=NULL,updated_by=p_actor_id WHERE id=b.id;
 UPDATE admission_cases SET status='move_in',actual_arrival_at=v_at,updated_by=p_actor_id WHERE id=c.id;
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_admission_arrival_review(uuid,uuid,date,timestamptz,text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Readers
-- ---------------------------------------------------------------------------
-- The register already reads effective_from; it now also says when each row
-- was recorded and on what basis, so a late entry is visible as one.
DROP FUNCTION IF EXISTS public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean);
CREATE FUNCTION public.admission_discharge_register(
  p_organization_id uuid,
  p_facility_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_include_holds boolean DEFAULT true
)
RETURNS TABLE (
  event_at timestamptz,
  event_type text,
  resident_id uuid,
  resident_display_name text,
  room_number text,
  bed_label text,
  room_as_of text,
  from_status public.resident_status,
  to_status public.resident_status,
  admission_source text,
  discharge_reason public.discharge_reason,
  discharge_destination text,
  recorded_by uuid,
  recorded_by_name text,
  recorded_at timestamptz,
  effective_basis text,
  late_entry_reason text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH ordered AS (
    SELECT
      h.resident_id,
      h.status,
      h.effective_from,
      h.created_by,
      h.created_at,
      h.effective_basis,
      h.late_entry_reason,
      lag(h.status) OVER (PARTITION BY h.resident_id ORDER BY h.effective_from, h.id) AS prev_status
    FROM public.resident_status_history h
    WHERE h.organization_id = p_organization_id
      AND h.facility_id = p_facility_id
      AND h.deleted_at IS NULL
      -- An empty interval (a pre-admission state an arrival dated earlier
      -- collapsed) is not an event.
      AND (h.effective_to IS NULL OR h.effective_to > h.effective_from)
  ),
  classified AS (
    SELECT
      o.*,
      CASE o.status
        WHEN 'active' THEN CASE o.prev_status
          WHEN 'discharged' THEN 'readmission'
          WHEN 'hospital_hold' THEN 'hospital_return'
          WHEN 'loa' THEN 'leave_return'
          ELSE 'admission'
        END
        WHEN 'discharged' THEN 'discharge'
        WHEN 'deceased' THEN 'death'
        WHEN 'hospital_hold' THEN 'hospital_out'
        WHEN 'loa' THEN 'leave_out'
        ELSE NULL
      END AS event_type
    FROM ordered o
  ),
  ranked AS (
    SELECT
      c.*,
      CASE WHEN c.event_type IN ('discharge', 'death')
        THEN row_number() OVER (
          PARTITION BY c.resident_id, (c.event_type IN ('discharge', 'death'))
          ORDER BY c.effective_from DESC)
        ELSE NULL
      END AS ending_rank,
      CASE WHEN c.event_type IN ('admission', 'readmission')
        THEN row_number() OVER (
          PARTITION BY c.resident_id, (c.event_type IN ('admission', 'readmission'))
          ORDER BY c.effective_from DESC)
        ELSE NULL
      END AS starting_rank
    FROM classified c
    WHERE c.event_type IS NOT NULL
  )
  SELECT
    r.effective_from,
    r.event_type,
    r.resident_id,
    btrim(res.first_name || ' ' || res.last_name),
    rm.room_number,
    b.bed_label,
    'current'::text,
    r.prev_status,
    r.status,
    CASE WHEN r.starting_rank = 1 THEN res.admission_source END,
    CASE WHEN r.ending_rank = 1 THEN res.discharge_reason END,
    CASE WHEN r.ending_rank = 1 THEN res.discharge_destination END,
    r.created_by,
    up.full_name,
    r.created_at,
    r.effective_basis,
    r.late_entry_reason
  FROM ranked r
  JOIN public.residents res ON res.id = r.resident_id AND res.deleted_at IS NULL
  LEFT JOIN public.beds b ON b.id = res.bed_id AND b.deleted_at IS NULL
  LEFT JOIN public.rooms rm ON rm.id = b.room_id AND rm.deleted_at IS NULL
  LEFT JOIN public.user_profiles up ON up.id = r.created_by
  WHERE r.effective_from >= p_from
    AND r.effective_from < p_to
    AND (p_include_holds
         OR r.event_type NOT IN ('hospital_out', 'hospital_return', 'leave_out', 'leave_return'))
  ORDER BY r.effective_from, res.last_name, res.first_name
$$;
COMMENT ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) IS
  'COL-353 admission and discharge register for one facility and range, derived from resident_status_history and dated by when each movement happened (COL-750). recorded_at is when it was saved; effective_basis and late_entry_reason say how it was dated. p_include_holds = false hides hospital and leave rows so the page can match a paper log.';
REVOKE ALL ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) TO authenticated, service_role;

-- The Stand Up roster at any instant, from effective dates: the status each
-- resident held at p_as_of in this facility. A resident with no history at all
-- (predating capture) counts by the current status, as 433 does. The live
-- stand_up_roster_census(uuid,uuid) is unchanged: the current status is by
-- construction the one in force now.
CREATE OR REPLACE FUNCTION public.stand_up_roster_census_as_of(p_organization_id uuid, p_facility_id uuid, p_as_of timestamptz)
RETURNS TABLE(in_house_count integer,hospital_hold_count integer,loa_count integer,roster_census_count integer,resident_count_in_haven integer,roster_as_of timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH at_time AS (
  SELECT h.status FROM public.resident_status_history h
  JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
  WHERE h.organization_id=p_organization_id AND h.facility_id=p_facility_id AND h.deleted_at IS NULL
    AND h.effective_from<=p_as_of AND (h.effective_to IS NULL OR h.effective_to>p_as_of)
  UNION ALL
  SELECT r.status FROM public.residents r
  WHERE r.organization_id=p_organization_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.id AND h.deleted_at IS NULL)
 )
 SELECT
  count(*) FILTER (WHERE status='active')::integer,
  count(*) FILTER (WHERE status='hospital_hold')::integer,
  count(*) FILTER (WHERE status='loa')::integer,
  count(*) FILTER (WHERE status IN('active','hospital_hold','loa'))::integer,
  (SELECT count(*) FROM public.residents r WHERE r.organization_id=p_organization_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL)::integer,
  (SELECT max(h.effective_from) FROM public.resident_status_history h
    WHERE h.organization_id=p_organization_id AND h.facility_id=p_facility_id AND h.deleted_at IS NULL AND h.effective_from<=p_as_of)
 FROM at_time
$$;
REVOKE ALL ON FUNCTION public.stand_up_roster_census_as_of(uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stand_up_roster_census_as_of(uuid,uuid,timestamptz) TO authenticated,service_role;
COMMENT ON FUNCTION public.stand_up_roster_census_as_of(uuid,uuid,timestamptz) IS
  'COL-750: stand_up_roster_census at a past instant, from effective dates (status held at p_as_of in this facility). For Thursday against Monday (COL-754). Counts only.';

-- The daily census: who was in census when the log day began, from effective
-- dates. Acuity and payer still come from the resident record as it is now.
CREATE OR REPLACE FUNCTION public.record_census_daily_log (p_organization_id uuid DEFAULT NULL, p_log_date date DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $function$
DECLARE
  _facility_today date := (now() AT TIME ZONE 'America/New_York')::date;
  _log_date date := COALESCE(p_log_date, _facility_today);
  _day_start timestamptz := _log_date::timestamp AT TIME ZONE 'America/New_York';
  _written integer;
  _residents integer;
BEGIN
  -- Acuity, payer and beds still read live state, so only today or yesterday
  -- may be written.
  IF _log_date > _facility_today OR _log_date < _facility_today - 1 THEN
    RAISE EXCEPTION 'record_census_daily_log records today or yesterday in America/New_York only (asked for %)', _log_date
      USING ERRCODE = '22007';
  END IF;

  WITH facility AS (
    SELECT
      f.id,
      f.organization_id,
      COALESCE(f.total_licensed_beds, 0) AS licensed_beds
    FROM
      public.facilities f
    WHERE
      f.deleted_at IS NULL
      AND (p_organization_id IS NULL
        OR f.organization_id = p_organization_id)),
  -- The status each resident held at the start of the log day, by effective
  -- date (COL-750). A resident with no history counts by current status.
  status_at_start AS (
    SELECT h.facility_id, h.resident_id, h.status
    FROM public.resident_status_history h
    JOIN facility ON facility.id = h.facility_id
    WHERE h.deleted_at IS NULL
      AND h.effective_from <= _day_start
      AND (h.effective_to IS NULL OR h.effective_to > _day_start)
    UNION ALL
    SELECT r.facility_id, r.id, r.status
    FROM public.residents r
    JOIN facility ON facility.id = r.facility_id
    WHERE r.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.resident_status_history h WHERE h.resident_id = r.id AND h.deleted_at IS NULL)),
  in_census AS (
    SELECT
      s.facility_id,
      s.status,
      r.acuity_level,
      r.primary_payer
    FROM
      status_at_start s
      JOIN public.residents r ON r.id = s.resident_id AND r.deleted_at IS NULL
    WHERE
      s.status IN ('active', 'hospital_hold', 'loa')),
  resident_counts AS (
    SELECT
      c.facility_id,
      count(*) AS occupied_beds,
      count(*) FILTER (WHERE c.status IN ('hospital_hold', 'loa')) AS hold_beds
    FROM
      in_census c
    GROUP BY
      c.facility_id),
  acuity_counts AS (
    SELECT
      k.facility_id,
      jsonb_object_agg(k.bucket, k.residents) AS residents_by_acuity
    FROM (
      SELECT
        c.facility_id,
        COALESCE(c.acuity_level::text, 'unassigned') AS bucket,
        count(*) AS residents
      FROM
        in_census c
      GROUP BY
        1,
        2) k
    GROUP BY
      k.facility_id),
  payer_counts AS (
    SELECT
      k.facility_id,
      jsonb_object_agg(k.bucket, k.residents) AS residents_by_payer
    FROM (
      SELECT
        c.facility_id,
        -- A resident with no payer yet is its own bucket. A null key made
        -- jsonb_object_agg fail the whole run: production has recorded no
        -- day since two residents were created without a payer on 2026-09-22.
        COALESCE(c.primary_payer::text, 'unassigned') AS bucket,
        count(*) AS residents
      FROM
        in_census c
      GROUP BY
        1,
        2) k
    GROUP BY
      k.facility_id),
  movement_counts AS (
    SELECT
      r.facility_id,
      count(*) FILTER (WHERE r.admission_date = _log_date) AS admissions_today,
      count(*) FILTER (WHERE r.discharge_date = _log_date) AS discharges_today
    FROM
      public.residents r
      JOIN facility ON facility.id = r.facility_id
    WHERE
      r.deleted_at IS NULL
    GROUP BY
      r.facility_id),
  bed_counts AS (
    SELECT
      b.facility_id,
      count(*) FILTER (WHERE b.status = 'maintenance') AS maintenance_beds
    FROM
      public.beds b
      JOIN facility ON facility.id = b.facility_id
    WHERE
      b.deleted_at IS NULL
    GROUP BY
      b.facility_id),
  measured AS (
    SELECT
      facility.id AS facility_id,
      facility.organization_id,
      facility.licensed_beds,
      COALESCE(resident_counts.occupied_beds, 0)::integer AS occupied_beds,
      COALESCE(resident_counts.hold_beds, 0)::integer AS hold_beds,
      COALESCE(bed_counts.maintenance_beds, 0)::integer AS maintenance_beds,
      COALESCE(acuity_counts.residents_by_acuity, '{}'::jsonb) AS residents_by_acuity,
      COALESCE(payer_counts.residents_by_payer, '{}'::jsonb) AS residents_by_payer,
      COALESCE(movement_counts.admissions_today, 0)::integer AS admissions_today,
      COALESCE(movement_counts.discharges_today, 0)::integer AS discharges_today
    FROM
      facility
      LEFT JOIN resident_counts ON resident_counts.facility_id = facility.id
      LEFT JOIN acuity_counts ON acuity_counts.facility_id = facility.id
      LEFT JOIN payer_counts ON payer_counts.facility_id = facility.id
      LEFT JOIN movement_counts ON movement_counts.facility_id = facility.id
      LEFT JOIN bed_counts ON bed_counts.facility_id = facility.id),
  written AS (
  INSERT INTO public.census_daily_log (facility_id, organization_id, log_date, total_licensed_beds, occupied_beds, available_beds, hold_beds, maintenance_beds, occupancy_rate, residents_by_acuity, residents_by_payer, admissions_today, discharges_today)
    SELECT
      m.facility_id,
      m.organization_id,
      _log_date,
      m.licensed_beds,
      m.occupied_beds,
      GREATEST(m.licensed_beds - m.occupied_beds - m.maintenance_beds, 0),
      m.hold_beds,
      m.maintenance_beds,
      CASE WHEN m.licensed_beds > 0 THEN
        round(m.occupied_beds::numeric / m.licensed_beds, 4)
      ELSE
        0
      END,
      m.residents_by_acuity,
      m.residents_by_payer,
      m.admissions_today,
      m.discharges_today
    FROM
      measured m
    ON CONFLICT (facility_id, log_date)
      DO UPDATE SET
        total_licensed_beds = EXCLUDED.total_licensed_beds, occupied_beds = EXCLUDED.occupied_beds, available_beds = EXCLUDED.available_beds, hold_beds = EXCLUDED.hold_beds, maintenance_beds = EXCLUDED.maintenance_beds, occupancy_rate = EXCLUDED.occupancy_rate, residents_by_acuity = EXCLUDED.residents_by_acuity, residents_by_payer = EXCLUDED.residents_by_payer, admissions_today = EXCLUDED.admissions_today, discharges_today = EXCLUDED.discharges_today
      RETURNING
        census_daily_log.occupied_beds)
  SELECT
    count(*)::integer,
    COALESCE(sum(written.occupied_beds), 0)::integer
  INTO _written,
  _residents
  FROM
    written;

  RETURN jsonb_build_object('log_date', _log_date, 'facilities_recorded', _written, 'residents_in_census', _residents);
END
$function$;

COMMENT ON FUNCTION public.record_census_daily_log (uuid, date) IS
'Records one census_daily_log row per live facility for one operating day -- the midnight census of that day: the residents whose status in force when the day began (America/New_York), by effective date from resident_status_history (COL-750), was active, hospital_hold or loa. Acuity, payer and beds are read live, so only today or yesterday may be written. Re-running a day replaces that day. p_organization_id NULL records every organization. service_role only. COL-414, COL-750.';

REVOKE ALL ON FUNCTION public.record_census_daily_log (uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_census_daily_log (uuid, date) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
