-- A Smart Rounding check cannot be charted before its window opens.
--
-- Found in the COL-849 Homewood test (2026-09-25): a med tech charted the
-- 06:00 check at 22:00 the evening before, and it was recorded completed on
-- time with no integrity flag. Nothing on the write path compared the moment
-- the resident was seen with the moment the check's window opens, so a whole
-- next day of checks could be charted before going home.
--
-- The rule reads configuration that already exists; it adds no number of its
-- own. A check's window opens at resident_observation_tasks.scheduled_for:
--   * cadence checks: the generator writes the window's open instant there
--     (due time minus the window's grace_before_minutes, facility_cadence_windows);
--   * monitoring-order checks: generate_monitoring_order_tasks writes the
--     occurrence, which is also the due time.
-- A log whose observed_at is before that instant is refused. Charting after the
-- window closes is unchanged (late, with a reason). Older plan-rule tasks, which
-- carry neither a cadence version nor a monitoring order, are not touched, the
-- same scope haven.require_observation_capture uses.
--
-- One BEFORE INSERT trigger on resident_observation_logs covers every writer
-- (the caregiver app, the floor tablet and the device offline replay) whatever
-- function inserts the log.

BEGIN;

CREATE OR REPLACE FUNCTION haven.refuse_observation_before_window_opens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_opens timestamptz;
  v_smart boolean;
  v_tz text;
BEGIN
  IF NEW.task_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT t.scheduled_for, (t.cadence_version_id IS NOT NULL OR t.monitoring_order_id IS NOT NULL), coalesce(nullif(btrim(f.timezone), ''), 'America/New_York')
    INTO v_opens, v_smart, v_tz
  FROM public.resident_observation_tasks t
  JOIN public.facilities f ON f.id = t.facility_id
  WHERE t.id = NEW.task_id;
  IF NOT coalesce(v_smart, false) OR v_opens IS NULL OR NEW.observed_at IS NULL OR NEW.observed_at >= v_opens THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This check opens at %. Chart it then.', pg_catalog.to_char(v_opens AT TIME ZONE v_tz, 'FMHH12:MI AM')
    USING ERRCODE = '22023', DETAIL = 'check_not_open';
END
$function$;

REVOKE ALL ON FUNCTION haven.refuse_observation_before_window_opens() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_resident_observation_logs_window_open ON public.resident_observation_logs;
CREATE TRIGGER tr_resident_observation_logs_window_open
  BEFORE INSERT ON public.resident_observation_logs
  FOR EACH ROW EXECUTE FUNCTION haven.refuse_observation_before_window_opens();

COMMIT;
