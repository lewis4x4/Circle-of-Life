-- COL-695: turn the Homewood Timeclock on at 05:30 ET on 2026-10-01, once.
--
-- Scheduled on production by hand 2026-09-24 as pg_cron job 49
-- `col695-homewood-timeclock-on` (repo policy: no cron.schedule in migrations).
-- 05:30, not 06:00: Smart Rounding assigns each check to whoever is clocked in
-- (migrations 495/501), so day staff must be able to punch before the 06:00
-- shift-change window opens. The body acts only on 2026-10-01 New York time and
-- unschedules itself. Rehearsed on staging in a rolled-back transaction
-- (flag on, one audit row, job gone).
--
-- To cancel before it fires:  SELECT cron.unschedule('col695-homewood-timeclock-on');
-- To check after:             SELECT timeclock_enabled FROM public.timeclock_facility_settings
--                             WHERE facility_id = '00000000-0000-0000-0002-000000000003';

SELECT cron.schedule('col695-homewood-timeclock-on', '30 9 1 10 *', $job$
DO $tc$
BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::date <> DATE '2026-10-01' THEN
    RAISE NOTICE 'COL-695 timeclock go-live: not 2026-10-01 in New York; nothing done';
  ELSE
    INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0002-000000000003', true)
    ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = true;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on';
END
$tc$;
$job$);
