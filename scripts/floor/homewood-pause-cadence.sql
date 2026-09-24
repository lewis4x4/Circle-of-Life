-- Homewood Lodge: no Smart Rounding cadence in force until the Oct 1 day shift.
--
-- Spec: docs/specs/40-floor-tablet-and-kiosk.md section 9, item 1 (COL-677, run for COL-695).
-- Who runs it: Brian, by hand, against production. The build never runs it.
--
-- What it does, through the existing cadence version mechanism (migrations 417, 429, 436):
--   1. A new cadence version with no observation windows is put in force now, through
--      haven.apply_observation_config_activation, the one function allowed to put a
--      cadence version in force. It closes the current version at this instant and
--      soft-deletes pending cadence checks due from now on (the same "immediate" apply
--      an administrator gets from activate_cadence_version). It carries the current
--      version's shift configuration, so shift boundaries do not move.
--   2. A copy of the current version's windows and configuration is left "scheduled"
--      at the Oct 1 day shift start (the day shift's start time from the facility's
--      shift definitions, 2026-10-01, America/New_York). The cadence-version-activator
--      cron puts it in force on its first tick at or after that instant, exactly as it
--      does for any scheduled change.
-- Nothing here edits a version that was in force; the timeline stays gap free.
--
-- While the pause is in force the observation-task-generator reports Homewood under
-- facilities_without_cadence and answers ok=false. That is expected until go-live.
-- Monitoring orders are separate from the cadence and keep generating their checks.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/homewood-pause-cadence.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col695_apply = 'homewood-pause-cadence';"; cat scripts/floor/homewood-pause-cadence.sql; } > /tmp/col695-pause-cadence-apply.sql
--     supabase db query --linked -f /tmp/col695-pause-cadence-apply.sql
--
-- Plain SQL on purpose: `supabase db query` sends the file through the Management API,
-- which does not run psql meta-commands such as \if. `--db-url` is not a substitute: it
-- refuses a file with more than one statement; for a rehearsal use `psql -f` on a scratch
-- database. The apply switch is a session setting whose value must name this script, so
-- a switch left over for another script cannot apply this one. The final statement is
-- the report, so it is what prints.
--
-- Safe to run twice: a pause already in force and a resume already scheduled for the
-- same instant are reported and left alone. Everything is scoped to one facility,
-- found by name inside the Circle of Life organization and checked against the
-- Homewood id the repository already uses; zero or several matches stop the script.

DROP TABLE IF EXISTS pg_temp.col695_report;
CREATE TEMP TABLE col695_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

BEGIN;

DO $col695$
DECLARE
  c_script CONSTANT text := 'homewood-pause-cadence';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  c_go_live_date CONSTANT date := DATE '2026-10-01';
  c_pause_marker CONSTANT text := 'COL-695 pause';
  c_resume_marker CONSTANT text := 'COL-695 resume';
  v_apply boolean := coalesce(current_setting('haven.col695_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_fac_id uuid;
  v_tz text;
  v_day_key text;
  v_day_start time;
  v_go_live timestamptz;
  v_active record;
  v_active_windows integer;
  v_source record;
  v_source_windows integer;
  v_pause_in_force boolean;
  v_resume_id uuid;
  v_pending_to_cancel integer;
  v_next_number integer;
  v_pause_id uuid;
  v_result jsonb;
  v_reason_pause text;
  v_reason_resume text;
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
  IF v_tz <> 'America/New_York' THEN
    RAISE EXCEPTION 'Homewood timezone is %, expected America/New_York', v_tz;
  END IF;

  -- Go-live: the day shift start on 2026-10-01, from the facility's own shift definitions.
  SELECT count(*) INTO v_n FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active day shift at Homewood, found %', v_n;
  END IF;
  SELECT s.shift_key, s.starts_at_local INTO STRICT v_day_key, v_day_start FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  v_go_live := (c_go_live_date + v_day_start) AT TIME ZONE v_tz;

  INSERT INTO col695_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'id', v_fac_id::text),
    ('facility', 'timezone', v_tz),
    ('go-live', 'day shift', v_day_key || ' starts ' || v_day_start::text || ' local'),
    ('go-live', 'instant', to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local, ' || v_go_live::text),
    ('now', 'instant', v_now::text);

  IF v_now >= v_go_live THEN
    INSERT INTO col695_report (section, item, detail)
      VALUES ('result', 'nothing to do', 'Go-live has passed; a pause now would stop live rounding. Not applied.');
    RETURN;
  END IF;

  -- The version in force now.
  SELECT count(*) INTO v_n FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.status = 'active' AND v.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active cadence version at Homewood, found %', v_n;
  END IF;
  SELECT v.* INTO STRICT v_active FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.status = 'active' AND v.deleted_at IS NULL;
  SELECT count(*) INTO v_active_windows FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_active.id AND w.deleted_at IS NULL AND w.enabled;
  v_pause_in_force := v_active_windows = 0 AND v_active.change_reason LIKE c_pause_marker || '%';

  INSERT INTO col695_report (section, item, detail) VALUES
    ('cadence in force', 'version', v_active.id::text || ' (number ' || v_active.version_number || ')'),
    ('cadence in force', 'effective from', v_active.effective_from::text),
    ('cadence in force', 'enabled windows', v_active_windows::text),
    ('cadence in force', 'is the COL-695 pause', v_pause_in_force::text);

  -- The version whose windows come back at go-live: the latest one that was in force
  -- and had windows. Before the pause that is the active version; after it, the one
  -- the pause superseded.
  SELECT v.* INTO v_source FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status IN ('active', 'superseded')
    AND EXISTS (SELECT 1 FROM public.facility_cadence_windows w
                WHERE w.cadence_version_id = v.id AND w.deleted_at IS NULL AND w.enabled)
  ORDER BY v.effective_from DESC, v.version_number DESC
  LIMIT 1;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'No Homewood cadence version with observation windows exists to bring back at go-live';
  END IF;
  SELECT count(*) INTO v_source_windows FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_source.id AND w.deleted_at IS NULL;
  INSERT INTO col695_report (section, item, detail) VALUES
    ('windows restored at go-live', 'copied from version', v_source.id::text || ' (number ' || v_source.version_number || ')'),
    ('windows restored at go-live', 'windows', v_source_windows::text);
  FOR r IN SELECT w.window_key, w.shift_key, w.due_at_local, w.enabled FROM public.facility_cadence_windows w
           WHERE w.cadence_version_id = v_source.id AND w.deleted_at IS NULL ORDER BY w.sort_order, w.due_at_local LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES ('windows restored at go-live', r.window_key, r.shift_key || ' ' || r.due_at_local::text || CASE WHEN r.enabled THEN '' ELSE ' (disabled)' END);
  END LOOP;

  -- Anything else already waiting to take effect would collide with this plan.
  FOR r IN SELECT v.id, v.version_number, v.status, v.effective_from, v.change_reason FROM public.facility_cadence_versions v
           WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status IN ('draft', 'pending_approval', 'scheduled')
           ORDER BY v.version_number LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES ('other versions not in force', r.id::text, 'number ' || r.version_number || ', ' || r.status || ', from ' || r.effective_from::text
              || CASE WHEN r.change_reason LIKE c_resume_marker || '%' THEN ', the COL-695 resume' ELSE '' END);
  END LOOP;

  SELECT v.id INTO v_resume_id FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
    AND v.effective_from = v_go_live AND v.change_reason LIKE c_resume_marker || '%'
  LIMIT 1;

  IF EXISTS (SELECT 1 FROM public.facility_cadence_versions v
             WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
               AND v.id IS DISTINCT FROM v_resume_id AND v.effective_from <= v_go_live) THEN
    RAISE EXCEPTION 'Another cadence version is scheduled at Homewood before or at go-live; review it in Smart Rounding settings before pausing';
  END IF;

  -- Pending cadence checks the pause would stand down (the same set the immediate
  -- apply soft-deletes). Checks already due stay for homewood-clear-pre-go-live.sql.
  SELECT count(*) INTO v_pending_to_cancel FROM public.resident_observation_tasks t
  WHERE t.facility_id = v_fac_id AND t.deleted_at IS NULL AND t.window_key IS NOT NULL
    AND t.monitoring_order_id IS NULL AND t.due_at >= v_now
    AND t.status IN ('upcoming', 'due_soon', 'due_now', 'overdue', 'critically_overdue')
    AND NOT EXISTS (SELECT 1 FROM public.observation_escalation_dispatches d WHERE d.task_id = t.id);

  INSERT INTO col695_report (section, item, detail) VALUES
    ('plan', 'pause', CASE WHEN v_pause_in_force THEN 'already in force; left alone'
                           ELSE 'new version with no windows in force from now; ' || v_pending_to_cancel || ' pending cadence checks stood down' END),
    ('plan', 'resume', CASE WHEN v_resume_id IS NOT NULL THEN 'already scheduled (' || v_resume_id::text || '); left alone'
                            ELSE 'copy of version ' || v_source.version_number || ' scheduled for ' || v_go_live::text END);

  -- The cron job that puts a scheduled version in force (hosted projects only).
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE $q$SELECT jobname, schedule, active FROM cron.job
                        WHERE jobname ILIKE '%activator%' OR jobname ILIKE '%task-generator%' OR jobname ILIKE 'observation-task-generator%'
                        ORDER BY jobname$q$ LOOP
      INSERT INTO col695_report (section, item, detail)
        VALUES ('cron', r.jobname, r.schedule || CASE WHEN r.active THEN ', active' ELSE ', NOT ACTIVE' END);
    END LOOP;
  ELSE
    INSERT INTO col695_report (section, item, detail) VALUES ('cron', 'cron.job', 'not present on this database');
  END IF;

  IF NOT v_apply THEN
    RETURN;
  END IF;

  v_reason_pause := c_pause_marker || ': Smart Rounding is not in use on the Homewood floor until the '
    || to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' day shift start. No observation windows are in force until then.';
  v_reason_resume := c_resume_marker || ': Smart Rounding goes live on the Homewood floor at the '
    || to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' day shift start. Windows copied from version '
    || v_source.version_number || '.';

  IF NOT v_pause_in_force THEN
    SELECT coalesce(max(v.version_number), 0) + 1 INTO v_next_number FROM public.facility_cadence_versions v WHERE v.facility_id = v_fac_id;
    INSERT INTO public.facility_cadence_versions
      (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, configuration, apply_mode, activation_reason)
    VALUES
      (v_active.organization_id, v_fac_id, v_next_number, 'draft', v_now, v_reason_pause, NULL, v_active.configuration, 'immediate', v_reason_pause)
    RETURNING id INTO v_pause_id;
    v_result := haven.apply_observation_config_activation('cadence', v_pause_id, v_now, NULL, true);
    INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'pause in force', v_result::text);
  END IF;

  IF v_resume_id IS NULL THEN
    SELECT coalesce(max(v.version_number), 0) + 1 INTO v_next_number FROM public.facility_cadence_versions v WHERE v.facility_id = v_fac_id;
    INSERT INTO public.facility_cadence_versions
      (organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, configuration, apply_mode, activation_reason)
    VALUES
      (v_source.organization_id, v_fac_id, v_next_number, 'scheduled', v_go_live, v_reason_resume, v_source.source_template_id, v_source.configuration, 'scheduled', v_reason_resume)
    RETURNING id INTO v_resume_id;
    INSERT INTO public.facility_cadence_windows
      (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
    SELECT w.organization_id, w.facility_id, v_resume_id, w.window_key, w.label, w.due_at_local, w.grace_before_minutes, w.grace_after_minutes, w.shift_key, w.sort_order, w.enabled
    FROM public.facility_cadence_windows w
    WHERE w.cadence_version_id = v_source.id AND w.deleted_at IS NULL;
    INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'resume scheduled', v_resume_id::text || ' at ' || v_go_live::text);
  END IF;

  -- Check the result before the transaction commits.
  IF EXISTS (SELECT 1 FROM public.facility_observation_windows_for_date(v_fac_id, (v_now AT TIME ZONE v_tz)::date) w WHERE w.due_at_utc >= v_now) THEN
    RAISE EXCEPTION 'Observation windows are still in force at Homewood after the pause; rolled back';
  END IF;
  IF NOT public.facility_is_shift_boundary(v_fac_id, v_go_live) THEN
    RAISE EXCEPTION 'Go-live % is not a Homewood shift boundary; rolled back', v_go_live;
  END IF;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'verified', 'no windows in force from now; resume scheduled at a shift boundary');
END
$col695$;

COMMIT;

RESET haven.col695_apply;

SELECT section, item, detail FROM col695_report ORDER BY seq;
