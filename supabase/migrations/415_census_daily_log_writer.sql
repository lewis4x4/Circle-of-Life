-- COL-414: write the daily census the incident rate is supposed to divide by.
--
-- `census_daily_log` has existed since migration 007 and nothing has ever
-- written to it. Because no daily history existed, the executive incident rate
-- took one day's census, multiplied it by the 30-day window, and called the
-- product resident-days. A portfolio that admitted through the month is
-- credited with its highest census on all thirty days, so the denominator runs
-- large and the rate runs low; a portfolio that discharged through the month
-- gets the opposite, and Homewood's shape overstates the rate by roughly a
-- third. Neither is a measurement.
--
-- This is the writer named in docs/specs/00-foundation.md as `daily-census-log`
-- (cron, midnight ET). It counts what is there and records it against one
-- operating day. It does not model, interpolate, or carry a day forward: a day
-- nobody recorded stays absent, and the reader is required to say so rather
-- than fill it in.
--
-- `log_date` is the midnight census for that operating day -- the residents in
-- census when the day began -- which is the census convention resident-days are
-- counted on. Occupied is the billable census population (active +
-- hospital_hold + loa), the same population `residents` reports to the
-- executive KPI run, so the numerator and denominator describe the same people.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_census_daily_log (p_organization_id uuid DEFAULT NULL, p_log_date date DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $function$
DECLARE
  _facility_today date := (now() AT TIME ZONE 'America/New_York')::date;
  _log_date date := COALESCE(p_log_date, _facility_today);
  _written integer;
  _residents integer;
BEGIN
  -- Every count below reads live resident and bed state, so the only days this
  -- function can honestly record are the ones it can still observe. Stamping
  -- today's roster onto an older date would manufacture history that reads
  -- exactly like a measurement.
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
  in_census AS (
    SELECT
      r.facility_id,
      r.status,
      r.acuity_level,
      r.primary_payer
    FROM
      public.residents r
      JOIN facility ON facility.id = r.facility_id
    WHERE
      r.deleted_at IS NULL
      AND r.status IN ('active', 'hospital_hold', 'loa')),
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
        c.primary_payer::text AS bucket,
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
      -- A bed is not available while someone is in it or while it is out of
      -- service. Licensed beds can fall below the count in them during a
      -- licence change, so the floor is zero rather than a negative.
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
    -- Re-running the same day replaces that day's counts rather than adding a
    -- second version of it. The audit trigger keeps the correction visible.
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
'Records one census_daily_log row per live facility for one operating day -- the midnight census of that day, counted from live residents and beds. Occupied is the billable census population (active + hospital_hold + loa), matching the population the executive KPI run counts, so the incident-rate numerator and denominator describe the same people. Only today or yesterday in America/New_York may be written: every count reads live state, so an older date would stamp the current roster onto a day it never described. Re-running a day replaces that day. p_organization_id NULL records every organization. service_role only. COL-414.';

REVOKE ALL ON FUNCTION public.record_census_daily_log (uuid, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_census_daily_log (uuid, date) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
