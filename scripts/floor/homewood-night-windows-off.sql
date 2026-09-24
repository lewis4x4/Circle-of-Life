-- Homewood Lodge: the Oct 1 cadence has no scheduled night checks (COL-735).
--
-- Michelle's rule (2026-09-16), ruled by Brian 2026-09-23: formal observation notes at
-- 06:00, 10:00, 14:00 and 18:00; at night staff walk through continually and document
-- only when something happens. The 06:00/18:00 windows stay one sided (the incoming
-- shift lays eyes on every resident). The 22:00 `late_evening` and 02:00 `overnight`
-- windows come off.
-- Who runs it: Brian, by hand, against production. The build never runs it.
--
-- Run it AFTER scripts/floor/homewood-pause-cadence.sql (COL-695). That script leaves a
-- "COL-695 resume" cadence version scheduled at the Oct 1 day shift start, with the
-- windows copied from the version in force. This script disables the two night windows
-- on that scheduled version, so what comes back at go-live is Michelle's four checks.
-- The version has never been in force, so no history changes; the audit trigger on
-- facility_cadence_windows records the edit, and the version's change reason names it.
-- The version keeps its COL-695 resume marker, so a later run of the pause script
-- recognizes it and leaves it alone.
--
-- Both night windows must be present and the four day/shift-change windows enabled, or
-- the script stops: an unexpected shape means somebody changed the cadence since
-- 2026-09-23 and this plan no longer describes it.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/homewood-night-windows-off.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col735_apply = 'homewood-night-windows-off';"; cat scripts/floor/homewood-night-windows-off.sql; } > /tmp/col735-night-windows-apply.sql
--     supabase db query --linked -f /tmp/col735-night-windows-apply.sql
--
-- Plain SQL for the same reasons as the pause script (no psql meta-commands through the
-- Management API). Safe to run twice: a resume version that already carries this change
-- is reported and left alone.

DROP TABLE IF EXISTS pg_temp.col735_report;
CREATE TEMP TABLE col735_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

BEGIN;

DO $col735$
DECLARE
  c_script CONSTANT text := 'homewood-night-windows-off';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  c_go_live_date CONSTANT date := DATE '2026-10-01';
  c_resume_marker CONSTANT text := 'COL-695 resume';
  c_marker CONSTANT text := 'COL-735';
  c_off_keys CONSTANT text[] := ARRAY['late_evening', 'overnight'];
  c_keep_keys CONSTANT text[] := ARRAY['shift_change_am', 'mid_morning', 'afternoon', 'shift_change_pm'];
  v_apply boolean := coalesce(current_setting('haven.col735_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_fac_id uuid;
  v_tz text;
  v_day_start time;
  v_go_live timestamptz;
  v_resume record;
  v_off_present integer;
  v_off_enabled integer;
  v_keep_enabled integer;
  v_done boolean;
  v_reason text;
  r record;
BEGIN
  -- Facility: exactly one, and the one the repository knows as Homewood.
  SELECT count(*) INTO v_n FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Homewood Lodge facility in the Circle of Life organization, found %', v_n;
  END IF;
  SELECT f.id, f.timezone INTO STRICT v_fac_id, v_tz FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_fac_id <> c_homewood THEN
    RAISE EXCEPTION 'The Homewood Lodge facility found (%) is not the Homewood id the repository uses (%)', v_fac_id, c_homewood;
  END IF;

  -- Go-live: the day shift start on 2026-10-01, derived exactly as the pause script does.
  SELECT count(*) INTO v_n FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active day shift at Homewood, found %', v_n;
  END IF;
  SELECT s.starts_at_local INTO STRICT v_day_start FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  v_go_live := (c_go_live_date + v_day_start) AT TIME ZONE v_tz;

  INSERT INTO col735_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'id', v_fac_id::text),
    ('go-live', 'instant', to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local, ' || v_go_live::text),
    ('now', 'instant', v_now::text);

  IF v_now >= v_go_live THEN
    INSERT INTO col735_report (section, item, detail)
      VALUES ('result', 'nothing to do', 'Go-live has passed; the resume version is in force and is history now. Change the cadence in Smart Rounding settings instead.');
    RETURN;
  END IF;

  -- The COL-695 resume version: scheduled at go-live, never in force.
  SELECT count(*) INTO v_n FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
    AND v.effective_from = v_go_live AND v.change_reason LIKE c_resume_marker || '%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one COL-695 resume version scheduled at %, found %. Run scripts/floor/homewood-pause-cadence.sql first.', v_go_live, v_n;
  END IF;
  SELECT v.* INTO STRICT v_resume FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
    AND v.effective_from = v_go_live AND v.change_reason LIKE c_resume_marker || '%';

  INSERT INTO col735_report (section, item, detail)
    VALUES ('resume version', 'version', v_resume.id::text || ' (number ' || v_resume.version_number || ')');
  FOR r IN SELECT w.window_key, w.shift_key, w.due_at_local, w.grace_before_minutes, w.grace_after_minutes, w.enabled
           FROM public.facility_cadence_windows w
           WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL ORDER BY w.sort_order, w.due_at_local LOOP
    INSERT INTO col735_report (section, item, detail)
      VALUES ('resume windows before', r.window_key, r.shift_key || ' ' || to_char(r.due_at_local, 'HH24:MI')
              || ' (-' || r.grace_before_minutes || '/+' || r.grace_after_minutes || ')'
              || CASE WHEN r.enabled THEN '' ELSE ' disabled' END);
  END LOOP;

  SELECT count(*), count(*) FILTER (WHERE w.enabled) INTO v_off_present, v_off_enabled
  FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.window_key = ANY (c_off_keys);
  SELECT count(*) INTO v_keep_enabled FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled AND w.window_key = ANY (c_keep_keys);
  IF v_off_present <> cardinality(c_off_keys) OR v_keep_enabled <> cardinality(c_keep_keys) THEN
    RAISE EXCEPTION 'The resume version does not have the expected shape (night windows present: % of %, day/shift-change windows enabled: % of %). The cadence changed since 2026-09-23; review it in Smart Rounding settings.',
      v_off_present, cardinality(c_off_keys), v_keep_enabled, cardinality(c_keep_keys);
  END IF;
  IF EXISTS (SELECT 1 FROM public.facility_cadence_windows w
             WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled
               AND NOT (w.window_key = ANY (c_off_keys || c_keep_keys))) THEN
    RAISE EXCEPTION 'The resume version carries an enabled window this plan does not know about. Review it in Smart Rounding settings.';
  END IF;

  v_done := v_off_enabled = 0 AND v_resume.change_reason LIKE '%' || c_marker || '%';
  INSERT INTO col735_report (section, item, detail) VALUES
    ('plan', 'night windows', CASE WHEN v_done THEN 'already disabled by COL-735; left alone'
                                   ELSE 'disable ' || array_to_string(c_off_keys, ' and ') || ' on the resume version' END),
    ('plan', 'checks per resident per day at go-live', cardinality(c_keep_keys)::text);

  IF NOT v_apply OR v_done THEN
    RETURN;
  END IF;

  v_reason := ' ' || c_marker || ': night documented by exception (Michelle 2026-09-16 rule, Brian ruling 2026-09-23); the 22:00 and 02:00 windows are disabled on this version before it takes effect.';
  UPDATE public.facility_cadence_windows w
  SET enabled = false
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled AND w.window_key = ANY (c_off_keys);
  UPDATE public.facility_cadence_versions v
  SET change_reason = v.change_reason || v_reason,
      activation_reason = coalesce(v.activation_reason, '') || v_reason
  WHERE v.id = v_resume.id;

  -- Check the result before the transaction commits.
  SELECT count(*) INTO v_n FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled;
  IF v_n <> cardinality(c_keep_keys) THEN
    RAISE EXCEPTION 'The resume version has % enabled windows after the change, expected %; rolled back', v_n, cardinality(c_keep_keys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v
                 WHERE v.id = v_resume.id AND v.status = 'scheduled' AND v.effective_from = v_go_live AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The resume version is no longer scheduled at go-live; rolled back';
  END IF;
  FOR r IN SELECT w.window_key, w.shift_key, w.due_at_local, w.grace_before_minutes, w.grace_after_minutes
           FROM public.facility_cadence_windows w
           WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled ORDER BY w.sort_order, w.due_at_local LOOP
    INSERT INTO col735_report (section, item, detail)
      VALUES ('resume windows after', r.window_key, r.shift_key || ' ' || to_char(r.due_at_local, 'HH24:MI')
              || ' (-' || r.grace_before_minutes || '/+' || r.grace_after_minutes || ')');
  END LOOP;
  INSERT INTO col735_report (section, item, detail) VALUES ('applied', 'verified', 'four windows at go-live; resume still scheduled at a shift boundary');
END
$col735$;

COMMIT;
RESET haven.col735_apply;
SELECT section, item, detail FROM col735_report ORDER BY seq;
