-- 463: Facility Operator Home — monthly census confirmation on tap (COL-569, COL-593 Cut 1).
--
-- On the first business day of a month the facility operator confirms last
-- month's census from Home. The row composes reads that already exist — the
-- nightly `census_daily_log` (415) and the live roster counts Stand Up uses
-- (`stand_up_roster_census`, 404) — and adds only what acceptance needs:
--
--   * haven.first_business_day            — first Monday–Friday of a month.
--                                           No facility holiday calendar exists
--                                           yet; when one does, this is the seam.
--   * haven.census_month_snapshot         — the counts the operator attests to.
--   * facility_census_confirmations       — append-only: "Confirm" (one per
--                                           facility-month) or "Something wrong"
--                                           (note required, row stays open). The
--                                           snapshot is frozen on the row by the
--                                           server, never sent by the browser.
--   * home_census_on_tap / home_record_census /
--     home_census_notices_for_executive   — read, write, and the in-app notice
--                                           to the Facility Executive (the same
--                                           path end-of-day escalations use).
--
-- Counts only: no resident name, room or id is read into or out of this file.
-- Rolls forward only; idempotent so a partial apply can be re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Calendar and snapshot helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.first_business_day(p_month date)
RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT d::date
  FROM pg_catalog.generate_series(
    date_trunc('month', p_month::timestamp),
    date_trunc('month', p_month::timestamp) + interval '6 days',
    interval '1 day') AS d
  WHERE extract(isodow FROM d) < 6
  ORDER BY d
  LIMIT 1
$$;

COMMENT ON FUNCTION haven.first_business_day(date) IS
  'First Monday–Friday of the month containing p_month (COL-569). Weekends only; there is no facility holiday calendar yet.';

-- SECURITY INVOKER: the caller's census_daily_log and resident RLS decide
-- what it can count. Inside home_record_census the facility grant has already
-- been asserted before this runs.
CREATE OR REPLACE FUNCTION haven.census_month_snapshot(p_organization_id uuid, p_facility_id uuid, p_census_month date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH bounds AS (
    SELECT date_trunc('month', p_census_month::timestamp)::date AS month_start,
           (date_trunc('month', p_census_month::timestamp) + interval '1 month')::date AS next_month
  ),
  logged AS (
    SELECT l.occupied_beds, l.admissions_today, l.discharges_today
    FROM public.census_daily_log l, bounds b
    WHERE l.organization_id = p_organization_id AND l.facility_id = p_facility_id
      AND l.log_date >= b.month_start AND l.log_date < b.next_month
  ),
  roster AS (
    SELECT * FROM public.stand_up_roster_census(p_organization_id, p_facility_id)
  )
  SELECT jsonb_build_object(
    'censusMonth', b.month_start,
    'daysInMonth', (b.next_month - b.month_start),
    'daysLogged', (SELECT count(*) FROM logged),
    'averageOccupied', (SELECT round(avg(occupied_beds)::numeric, 1) FROM logged),
    'admissions', (SELECT COALESCE(sum(admissions_today), 0) FROM logged),
    'discharges', (SELECT COALESCE(sum(discharges_today), 0) FROM logged),
    -- The midnight census on the 1st is who was in census when the month ended.
    'monthEndOccupied', (SELECT l.occupied_beds FROM public.census_daily_log l
                         WHERE l.organization_id = p_organization_id AND l.facility_id = p_facility_id
                           AND l.log_date = b.next_month),
    'licensedBeds', (SELECT f.total_licensed_beds FROM public.facilities f WHERE f.id = p_facility_id),
    'rosterCensus', (SELECT roster_census_count FROM roster),
    'rosterInHouse', (SELECT in_house_count FROM roster),
    'rosterHospitalHold', (SELECT hospital_hold_count FROM roster),
    'rosterLeave', (SELECT loa_count FROM roster),
    'rosterAsOf', (SELECT roster_as_of FROM roster)
  )
  FROM bounds b
$$;

COMMENT ON FUNCTION haven.census_month_snapshot(uuid, uuid, date) IS
  'COL-569: the counts an operator attests to for one facility-month — census_daily_log days logged, average and month-end occupied, admissions/discharges, and the live roster. Counts only.';

-- ---------------------------------------------------------------------------
-- 2. The attestation record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_census_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  census_month date NOT NULL CHECK (census_month = date_trunc('month', census_month::timestamp)::date),
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'flagged')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 2000),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notified_user_id uuid REFERENCES auth.users(id),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (outcome <> 'flagged' OR note IS NOT NULL)
);

COMMENT ON TABLE public.facility_census_confirmations IS
  'COL-569: a facility operator''s monthly census attestation from Home. "confirmed" closes the month (one per facility-month); "flagged" records what is wrong and keeps it open. The snapshot is computed server-side at write time. Counts only; the note is operator text and must not carry resident identifiers.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_census_confirmations_confirmed
  ON public.facility_census_confirmations (facility_id, census_month)
  WHERE outcome = 'confirmed' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_facility_census_confirmations_facility_month
  ON public.facility_census_confirmations (facility_id, census_month, recorded_at DESC);

ALTER TABLE public.facility_census_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators see census confirmations in accessible facilities" ON public.facility_census_confirmations;
CREATE POLICY "Operators see census confirmations in accessible facilities" ON public.facility_census_confirmations
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role()::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND deleted_at IS NULL
  );

-- Writes only through home_record_census, which computes the snapshot and
-- stamps the actor. Append only: no UPDATE or DELETE for anyone in the app.
REVOKE ALL ON public.facility_census_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.facility_census_confirmations TO authenticated, service_role;

DROP TRIGGER IF EXISTS facility_census_confirmations_audit_trigger ON public.facility_census_confirmations;
CREATE TRIGGER facility_census_confirmations_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_census_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- 3. The On-tap read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_census_on_tap(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_uid uuid := auth.uid();
  v_tz text;
  v_local_date date;
  v_month_start date;
  v_census_month date;
  v_first_bd date;
  v_confirmed jsonb;
  v_flag jsonb;
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'org_admin', 'facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Home is for facility operators' USING ERRCODE = '42501';
  END IF;
  IF p_facility_id IS NULL OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM public.facilities f
  WHERE f.id = p_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;

  v_local_date := (p_as_of AT TIME ZONE v_tz)::date;
  v_month_start := date_trunc('month', v_local_date::timestamp)::date;
  v_census_month := (v_month_start - interval '1 month')::date;
  v_first_bd := haven.first_business_day(v_month_start);

  IF v_local_date <> v_first_bd THEN
    RETURN jsonb_build_object('due', false, 'censusMonth', v_census_month, 'firstBusinessDay', v_first_bd, 'localDate', v_local_date);
  END IF;

  SELECT jsonb_build_object('at', c.recorded_at, 'byUserId', c.recorded_by, 'by', p.full_name, 'snapshot', c.snapshot)
  INTO v_confirmed
  FROM public.facility_census_confirmations c
  LEFT JOIN public.user_profiles p ON p.id = c.recorded_by
  WHERE c.facility_id = p_facility_id AND c.census_month = v_census_month
    AND c.outcome = 'confirmed' AND c.deleted_at IS NULL
  LIMIT 1;

  SELECT jsonb_build_object('at', c.recorded_at, 'byUserId', c.recorded_by, 'by', p.full_name, 'note', c.note)
  INTO v_flag
  FROM public.facility_census_confirmations c
  LEFT JOIN public.user_profiles p ON p.id = c.recorded_by
  WHERE c.facility_id = p_facility_id AND c.census_month = v_census_month
    AND c.outcome = 'flagged' AND c.deleted_at IS NULL
  ORDER BY c.recorded_at DESC
  LIMIT 1;

  v_snapshot := COALESCE(v_confirmed->'snapshot', haven.census_month_snapshot(v_org, p_facility_id, v_census_month));

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'due', true,
    'censusMonth', v_census_month,
    'firstBusinessDay', v_first_bd,
    'localDate', v_local_date,
    'status', CASE WHEN v_confirmed IS NOT NULL THEN 'confirmed' WHEN v_flag IS NOT NULL THEN 'flagged' ELSE 'open' END,
    'canRecord', v_role IN ('facility_admin', 'manager'),
    'snapshot', v_snapshot,
    'confirmed', v_confirmed - 'snapshot',
    'lastFlag', v_flag
  ));
END $$;

REVOKE ALL ON FUNCTION public.home_census_on_tap(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_census_on_tap(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.home_census_on_tap(uuid, timestamptz) IS
  'COL-569 On-tap row: on the facility''s first business day of the month, the prior month''s census to confirm, with its counts. Any other day answers due=false. SECURITY INVOKER; facility-scoped.';

-- ---------------------------------------------------------------------------
-- 4. The write: Confirm, or Something wrong
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: browser DML on the table is revoked so the
-- snapshot cannot be supplied by the client. The function re-checks the role
-- (facility_admin / manager only), the facility grant and the month before it
-- writes one row stamped with auth.uid().
CREATE OR REPLACE FUNCTION public.home_record_census(p_facility_id uuid, p_census_month date, p_outcome text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_uid uuid := auth.uid();
  v_tz text;
  v_current_month date;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_exec uuid;
  v_row public.facility_census_confirmations;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Census is confirmed by the facility administrator or manager' USING ERRCODE = '42501';
  END IF;
  IF p_facility_id IS NULL OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM public.facilities f
  WHERE f.id = p_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'flagged') THEN
    RAISE EXCEPTION 'Outcome must be confirmed or flagged' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'flagged' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Say what is wrong with the census' USING ERRCODE = '22023';
  END IF;

  v_current_month := date_trunc('month', (now() AT TIME ZONE v_tz)::timestamp)::date;
  IF p_census_month IS NULL
     OR p_census_month <> date_trunc('month', p_census_month::timestamp)::date
     OR p_census_month >= v_current_month
     OR p_census_month < (v_current_month - interval '12 months')::date THEN
    RAISE EXCEPTION 'Census month must be a closed month within the last year' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'confirmed' AND EXISTS (
    SELECT 1 FROM public.facility_census_confirmations
    WHERE facility_id = p_facility_id AND census_month = p_census_month
      AND outcome = 'confirmed' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Census for this month is already confirmed' USING ERRCODE = '23505';
  END IF;

  SELECT user_id INTO v_exec FROM public.facility_executives
  WHERE facility_id = p_facility_id AND organization_id = v_org;

  INSERT INTO public.facility_census_confirmations
    (organization_id, facility_id, census_month, outcome, note, snapshot, notified_user_id, recorded_by, recorded_at)
  VALUES
    (v_org, p_facility_id, p_census_month, p_outcome, v_note,
     haven.census_month_snapshot(v_org, p_facility_id, p_census_month), v_exec, v_uid, clock_timestamp())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'outcome', v_row.outcome,
    'recordedBy', v_row.recorded_by, 'recordedAt', v_row.recorded_at, 'notifiedUserId', v_row.notified_user_id);
END $$;

REVOKE ALL ON FUNCTION public.home_record_census(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_record_census(uuid, date, text, text) TO authenticated;

COMMENT ON FUNCTION public.home_record_census(uuid, date, text, text) IS
  'COL-37 ruling: definer required — browser DML on facility_census_confirmations is revoked so the snapshot is server-computed; the function re-checks role (facility_admin/manager), facility access and month before writing one row stamped with auth.uid() and the Facility Executive it notifies (COL-569).';

-- ---------------------------------------------------------------------------
-- 5. What the Facility Executive reads (in-app notice, same panel as escalations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_census_notices_for_executive()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', c.id,
      'facilityId', c.facility_id,
      'facilityName', f.name,
      'censusMonth', c.census_month,
      'outcome', c.outcome,
      'note', c.note,
      'recordedAt', c.recorded_at,
      'recordedBy', p.full_name,
      'rosterCensus', c.snapshot->'rosterCensus',
      'monthEndOccupied', c.snapshot->'monthEndOccupied',
      'averageOccupied', c.snapshot->'averageOccupied'
    )) ORDER BY c.recorded_at DESC), '[]'::jsonb)
  FROM public.facility_census_confirmations c
  JOIN public.facility_executives fe ON fe.facility_id = c.facility_id AND fe.user_id = auth.uid()
  JOIN public.facilities f ON f.id = c.facility_id
  LEFT JOIN public.user_profiles p ON p.id = c.recorded_by
  WHERE c.deleted_at IS NULL
    AND c.recorded_at >= now() - interval '35 days'
$$;

REVOKE ALL ON FUNCTION public.home_census_notices_for_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_census_notices_for_executive() TO authenticated;

COMMENT ON FUNCTION public.home_census_notices_for_executive() IS
  'COL-569: census confirmations and "something wrong" flags from buildings where the caller is the named Facility Executive, last 35 days. Delivery is the executive overview panel; push/email waits on COL-152.';

COMMIT;

NOTIFY pgrst, 'reload schema';
