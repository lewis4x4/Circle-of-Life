-- COL-755 (part of COL-749): hospital and rehab are counted separately.
--
-- Brian, 2026-09-24, asked "Should hospital and rehab be counted separately?":
-- "YES". Rehab is not hospital. Both stays keep the resident on census with the
-- bed held (his earlier ruling), so nothing about census, billing, bed hold or
-- Medicaid may change.
--
-- The choice: a stay type on hospital_hold, not a new resident_status value.
-- Every census, billing, bed-hold, Medicaid, occupancy and register rule in
-- Haven keys on resident_status = 'hospital_hold' (resident_billable_status,
-- the bed-hold clock, record_census_daily_log, the roster census, the floor and
-- caregiver apps, the Front Office publisher). A new enum value would have to be
-- added to every one of them and any one missed would silently drop a rehab
-- resident from census or billing. A column that only ever qualifies
-- hospital_hold changes none of them.
--
--   * public.bed_hold_stay_type: 'hospital' | 'rehab'.
--   * residents.bed_hold_stay_type and resident_status_history.bed_hold_stay_type.
--     Null means "type not recorded": every stay recorded before today stays
--     null and is never guessed. Any status other than hospital_hold clears it.
--   * Moving a recorded stay from hospital to rehab (or back) is a movement: it
--     carries its own effective time and goes through the COL-750 guard
--     (future, overlap, back-date window) and opens a new history interval of
--     the same status. Recording the type of a stay whose type was not recorded
--     is a correction of the stay in force and changes no dates.
--   * public.stand_up_bed_hold_split(org, facility, as_of): hospital, rehab and
--     type-not-recorded counts, live or at a past instant. The roster
--     suggestion on the Monday form carries the split beside the unchanged
--     hospital figure. Monday's published hospital_and_rehab_total is not
--     touched (nothing here is read by a publisher).
--   * Thursday (COL-754) gains hospital_total and rehab_total beside
--     hospital_and_rehab_total. A Thursday total may exceed hospital plus rehab
--     only by stays whose type is not recorded; it may never be less.
--
-- Guard and capture below are migration 504's text with the stay-type lines
-- added; nothing else in them changes.
BEGIN;

CREATE TYPE public.bed_hold_stay_type AS ENUM ('hospital', 'rehab');

ALTER TABLE public.residents ADD COLUMN bed_hold_stay_type public.bed_hold_stay_type;
ALTER TABLE public.resident_status_history ADD COLUMN bed_hold_stay_type public.bed_hold_stay_type;
ALTER TABLE public.residents ADD CONSTRAINT residents_bed_hold_stay_type_only_on_hold
  CHECK (bed_hold_stay_type IS NULL OR status = 'hospital_hold');
ALTER TABLE public.resident_status_history ADD CONSTRAINT resident_status_history_bed_hold_stay_type_only_on_hold
  CHECK (bed_hold_stay_type IS NULL OR status = 'hospital_hold');
COMMENT ON COLUMN public.residents.bed_hold_stay_type IS
  'COL-755: whether the current bed-hold stay is at a hospital or in rehab. Only on hospital_hold; null there means the type was not recorded (every stay before 2026-09-24). Census, billing and bed hold do not read it.';
COMMENT ON COLUMN public.resident_status_history.bed_hold_stay_type IS
  'COL-755: hospital or rehab for a hospital_hold interval; null = type not recorded. A change of type on a recorded stay opens a new interval.';

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

  -- COL-755: the stay type belongs to a bed-hold stay only.
  IF NEW.status IS DISTINCT FROM 'hospital_hold' THEN
    NEW.bed_hold_stay_type := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Mirrors the first history row the capture trigger opens.
    NEW.status_effective_at := coalesce(NEW.admission_date::timestamp AT TIME ZONE v_tz, v_now);
    NEW.status_effective_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.status = 'hospital_hold'
     AND OLD.bed_hold_stay_type IS NOT NULL
     AND NEW.bed_hold_stay_type IS DISTINCT FROM OLD.bed_hold_stay_type THEN
    -- COL-755: hospital to rehab (or back) on a recorded stay is a movement,
    -- dated and checked like a status change below.
    IF NEW.bed_hold_stay_type IS NULL THEN
      RAISE EXCEPTION 'A stay recorded as hospital or rehab cannot be changed back to not recorded.'
        USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    -- Recording the type of a stay whose type was not recorded is a
    -- correction of the stay in force, not a new movement.
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

CREATE OR REPLACE FUNCTION public.fn_resident_status_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_stay_moved boolean := false;
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
      organization_id, facility_id, resident_id, status, bed_hold_stay_type, effective_from, effective_basis, created_by, updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      NEW.bed_hold_stay_type,
      COALESCE(NEW.status_effective_at, NEW.admission_date::timestamp AT TIME ZONE v_tz, now()),
      CASE WHEN NEW.admission_date IS NOT NULL THEN 'admission_date' ELSE 'save_time' END,
      v_actor,
      v_actor
    )
    ON CONFLICT (resident_id) WHERE effective_to IS NULL AND deleted_at IS NULL DO NOTHING;

    RETURN NEW;
  END IF;

  -- COL-755: hospital to rehab (or back) on a recorded stay opens a new
  -- interval of the same status; recording the type of an unrecorded stay
  -- corrects the interval in force.
  v_stay_moved := OLD.status = 'hospital_hold' AND NEW.status = 'hospital_hold'
    AND OLD.bed_hold_stay_type IS NOT NULL
    AND NEW.bed_hold_stay_type IS DISTINCT FROM OLD.bed_hold_stay_type;
  IF OLD.status = 'hospital_hold' AND NEW.status = 'hospital_hold'
     AND OLD.bed_hold_stay_type IS NULL AND NEW.bed_hold_stay_type IS NOT NULL
     AND OLD.facility_id IS NOT DISTINCT FROM NEW.facility_id THEN
    UPDATE public.resident_status_history
       SET bed_hold_stay_type = NEW.bed_hold_stay_type,
           updated_at = now(),
           updated_by = v_actor
     WHERE resident_id = NEW.id
       AND deleted_at IS NULL
       AND effective_to IS NULL
       AND status = 'hospital_hold';
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.facility_id IS DISTINCT FROM NEW.facility_id OR v_stay_moved THEN
    IF OLD.status IS DISTINCT FROM NEW.status OR v_stay_moved THEN
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
      organization_id, facility_id, resident_id, status, bed_hold_stay_type, effective_from, effective_basis, late_entry_reason, created_by, updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      NEW.bed_hold_stay_type,
      v_at,
      v_basis,
      CASE WHEN OLD.status IS DISTINCT FROM NEW.status OR v_stay_moved THEN NEW.status_effective_reason END,
      v_actor,
      v_actor
    );
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS tr_residents_status_history_capture ON public.residents;
CREATE TRIGGER tr_residents_status_history_capture
  AFTER INSERT OR UPDATE OF status, facility_id, bed_hold_stay_type ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.fn_resident_status_history_capture();

-- ---------------------------------------------------------------------------
-- Counting the split, live or at a past instant
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.stand_up_bed_hold_split(p_organization_id uuid, p_facility_id uuid, p_as_of timestamptz DEFAULT NULL)
RETURNS TABLE(hospital_count integer, rehab_count integer, type_not_recorded_count integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH holds AS (
  SELECT r.bed_hold_stay_type AS stay FROM public.residents r
  WHERE p_as_of IS NULL AND r.organization_id=p_organization_id AND r.facility_id=p_facility_id
    AND r.deleted_at IS NULL AND r.status='hospital_hold'
  UNION ALL
  SELECT h.bed_hold_stay_type FROM public.resident_status_history h
  JOIN public.residents r ON r.id=h.resident_id AND r.deleted_at IS NULL
  WHERE p_as_of IS NOT NULL AND h.organization_id=p_organization_id AND h.facility_id=p_facility_id
    AND h.deleted_at IS NULL AND h.status='hospital_hold'
    AND h.effective_from<=p_as_of AND (h.effective_to IS NULL OR h.effective_to>p_as_of)
  UNION ALL
  SELECT r.bed_hold_stay_type FROM public.residents r
  WHERE p_as_of IS NOT NULL AND r.organization_id=p_organization_id AND r.facility_id=p_facility_id
    AND r.deleted_at IS NULL AND r.status='hospital_hold'
    AND NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.id AND h.deleted_at IS NULL)
 )
 SELECT count(*) FILTER (WHERE stay='hospital')::integer,
        count(*) FILTER (WHERE stay='rehab')::integer,
        count(*) FILTER (WHERE stay IS NULL)::integer
 FROM holds
$$;
REVOKE ALL ON FUNCTION public.stand_up_bed_hold_split(uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stand_up_bed_hold_split(uuid,uuid,timestamptz) TO authenticated,service_role;
COMMENT ON FUNCTION public.stand_up_bed_hold_split(uuid,uuid,timestamptz) IS
  'COL-755: residents on a bed-hold stay at a hospital, in rehab, and with the type not recorded, for one facility, now (p_as_of null) or at a past instant from effective dates. The three add up to hospital_hold_count in stand_up_roster_census. Counts only.';

-- The Monday form's roster suggestion: migration 404's text plus the split.
CREATE OR REPLACE FUNCTION haven.stand_up_roster_suggestion(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; o uuid; c record; s record;
BEGIN
 f:=(p_payload->>'facility_id')::uuid;
 IF f IS NULL THEN RAISE EXCEPTION 'Facility required'; END IF;
 o:=haven.stand_up_assert(f);
 SELECT * INTO c FROM public.stand_up_roster_census(o,f);
 SELECT * INTO s FROM public.stand_up_bed_hold_split(o,f,NULL);
 RETURN jsonb_build_object('facility_id',f,'in_house_count',c.in_house_count,'hospital_hold_count',c.hospital_hold_count,'loa_count',c.loa_count,
  'roster_census_count',c.roster_census_count,'resident_count_in_haven',c.resident_count_in_haven,'roster_as_of',c.roster_as_of,
  'hospital_count',s.hospital_count,'rehab_count',s.rehab_count,'bed_hold_type_not_recorded_count',s.type_not_recorded_count,
  'server_now',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_roster_suggestion(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Thursday: hospital and rehab beside the total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.stand_up_meeting_keys(p_day text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_day WHEN 'thursday' THEN ARRAY['current_ar_cents','current_total_census','departures_since_monday','hospital_and_rehab_total','hospital_total','rehab_total']::text[] END
$$;
CREATE OR REPLACE FUNCTION haven.stand_up_meeting_validate(p_day text,v jsonb) RETURNS void
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
 -- COL-755: the total counts every bed-hold stay; hospital and rehab are the
 -- stays whose type is recorded, so together they can never exceed it.
 IF p_day='thursday' AND jsonb_typeof(v->'hospital_total')='number' AND jsonb_typeof(v->'rehab_total')='number'
  AND jsonb_typeof(v->'hospital_and_rehab_total')='number'
  AND (v->>'hospital_total')::numeric+(v->>'rehab_total')::numeric>(v->>'hospital_and_rehab_total')::numeric THEN
  RAISE EXCEPTION 'Hospital and rehab together cannot be more than the residents at hospital or rehab';
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_meeting_keys(text),haven.stand_up_meeting_validate(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 504's haven.resident_status_effective_guard and
-- public.fn_resident_status_history_capture and its capture trigger column
-- list (status, facility_id), migration 404's haven.stand_up_roster_suggestion
-- and migration 517's stand_up_meeting_keys / stand_up_meeting_validate; DROP
-- FUNCTION public.stand_up_bed_hold_split(uuid,uuid,timestamptz); then drop the
-- two columns and the type. Export recorded stay types first; they are evidence.
