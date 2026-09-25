-- Homewood Lodge: open the COL-849 test window (floor tablets and kiosk on production).
--
-- Linear: COL-849. Runbook: docs/operations/homewood-test-window.md.
-- Who runs it: Brian, by hand, against production. The build never runs it.
-- Close the window with scripts/floor/homewood-test-window-wipe.sql on the evening
-- of 2026-09-30, before the 05:30 ET Oct 1 Timeclock job.
--
-- The window started at 2026-09-25 20:24:02.307103+00, when Homewood's
-- timeclock_facility_settings.timeclock_enabled was set to true. Everything created at
-- Homewood from that instant is test data and is removed by the wipe.
--
-- What the apply changes:
--   1. Timeclock on at Homewood (idempotent; it is already on).
--   2. Smart Rounding test cadence: a new cadence version with version 3's windows is put
--      in force now through haven.apply_observation_config_activation, the same mechanism
--      homewood-pause-cadence.sql uses. It closes version 2 (the COL-695 pause) at this
--      instant and carries an effective_to of 2026-10-01 00:00+00 (8:00 PM ET Sept 30), so
--      the generator makes no check due after that instant. An end version with no
--      windows is scheduled for the same instant, so the timeline stays gap free if the
--      wipe runs late. Version 3 (the COL-695 resume) stays scheduled for
--      2026-10-01 10:00+00. Pending checks are not cancelled (p_cancel_pending false), so
--      no row from before the window is touched.
--   3. Outside alerts reach Brian only:
--      a. One Homewood notification route, "COL-849 test window: Brian only", targets
--         administrators (who the rungs already reach) and Brian's user. It adds Brian to
--         every observation escalation rung that uses routes (tier 1 to tier 3) and to
--         acute watchlist notices, and adds nobody else.
--      b. A delivery fence: haven.col849_test_window_notification_fence plus one trigger
--         on each queue an outside sender reads (observation_escalation_deliveries,
--         care_event_deliveries, watchlist_signal_notifications,
--         resident_monitoring_order_notifications). Any Homewood push, SMS, voice or email
--         row for someone other than Brian is written as skipped with skip_reason
--         'col849_test_window', so the senders never claim it. In-app rows are untouched:
--         staff see test alerts inside Haven. Exec alerts are in-app only and operation
--         escalations are switched off (oce-escalation-scanner answers 409), so neither
--         can text or push anyone. The fence stops acting at the Oct 1 go-live instant
--         even if the wipe never runs.
--   4. The exact prior configuration is recorded once in audit_log as a row with
--      table_name 'homewood_test_window' (record_id = the test cadence version): every
--      Homewood cadence and escalation version, window, rung and shift override, the
--      template binding, every organization notification route and care-event
--      escalation policy, the incident number counter, the timeclock settings row and the
--      Oct 1 cron job. The wipe restores from it and refuses to commit unless the result
--      equals it.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/homewood-test-window-open.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col849_apply = 'homewood-test-window-open';"; cat scripts/floor/homewood-test-window-open.sql; } > /tmp/col849-open-apply.sql
--     supabase db query --linked -f /tmp/col849-open-apply.sql
--
-- Plain SQL on purpose: `supabase db query` sends the file through the Management API,
-- which does not run psql meta-commands. The apply switch is a session setting whose value
-- must name this script. The final statement is the report, so it is what prints. The
-- report prints ids, roles and counts, never resident or staff names.
--
-- Safe to run twice: an open window is recognized by its test cadence version and
-- snapshot and left alone. It refuses to run at or after 2026-10-01 00:00+00.

DROP TABLE IF EXISTS pg_temp.col849_report;
CREATE TEMP TABLE col849_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

-- The configuration the wipe must give back, as one document. The wipe script carries a
-- byte-identical copy of this function and compares against the stored snapshot.
-- updated_at and updated_by are left out: haven_set_updated_at rewrites them on any
-- restore, so they cannot be part of an equality.
CREATE OR REPLACE FUNCTION pg_temp.col849_config(p_org uuid, p_fac uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  c_drop CONSTANT text[] := ARRAY['updated_at', 'updated_by'];
  v_cron jsonb;
  v_doc jsonb;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_agg(jsonb_build_object('jobname', j.jobname, 'schedule', j.schedule, 'active', j.active, 'command_md5', md5(j.command)) ORDER BY j.jobname)
               FROM cron.job j WHERE j.jobname = 'col695-homewood-timeclock-on'$q$ INTO v_cron;
  END IF;
  SELECT jsonb_build_object(
    'cadence_versions', (SELECT coalesce(jsonb_agg(to_jsonb(v) - c_drop ORDER BY v.version_number), '[]') FROM public.facility_cadence_versions v WHERE v.facility_id = p_fac),
    'cadence_windows', (SELECT coalesce(jsonb_agg(to_jsonb(w) - c_drop ORDER BY w.cadence_version_id, w.window_key, w.id), '[]') FROM public.facility_cadence_windows w WHERE w.facility_id = p_fac),
    'escalation_versions', (SELECT coalesce(jsonb_agg(to_jsonb(v) - c_drop ORDER BY v.version_number), '[]') FROM public.facility_escalation_versions v WHERE v.facility_id = p_fac),
    'escalation_rungs', (SELECT coalesce(jsonb_agg(to_jsonb(r) - c_drop ORDER BY r.escalation_version_id, r.sort_order, r.id), '[]') FROM public.facility_escalation_rungs r WHERE r.facility_id = p_fac),
    'escalation_rung_shift_overrides', (SELECT coalesce(jsonb_agg(to_jsonb(o) - c_drop ORDER BY o.escalation_rung_id, o.shift_key, o.id), '[]') FROM public.facility_escalation_rung_shift_overrides o WHERE o.facility_id = p_fac),
    'template_binding', (SELECT to_jsonb(b) - c_drop FROM public.facility_config_template_bindings b WHERE b.facility_id = p_fac),
    'notification_routes', (SELECT coalesce(jsonb_agg(to_jsonb(r) - c_drop ORDER BY r.id), '[]') FROM public.notification_routes r WHERE r.organization_id = p_org),
    'care_event_escalation_policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.care_event_escalation_policies p WHERE p.organization_id = p_org),
    'incident_sequences', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.year), '[]') FROM public.incident_sequences s WHERE s.facility_id = p_fac),
    'timeclock_settings', (SELECT to_jsonb(t) - c_drop - 'timeclock_enabled' FROM public.timeclock_facility_settings t WHERE t.facility_id = p_fac),
    'fence_triggers', (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_col849_test_window_notification_fence'),
    'fence_function', to_regprocedure('haven.col849_test_window_notification_fence()') IS NOT NULL,
    'cron', coalesce(v_cron, '"cron.job not present on this database"'::jsonb))
  INTO v_doc;
  RETURN v_doc;
END
$fn$;

BEGIN;

DO $col849$
DECLARE
  c_script CONSTANT text := 'homewood-test-window-open';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  c_brian_email CONSTANT text := 'blewis@lewisinsurance.com';
  c_window_start CONSTANT timestamptz := '2026-09-25 20:24:02.307103+00';
  c_test_end CONSTANT timestamptz := '2026-10-01 00:00:00+00';
  c_go_live_date CONSTANT date := DATE '2026-10-01';
  c_pause_marker CONSTANT text := 'COL-695 pause';
  c_resume_marker CONSTANT text := 'COL-695 resume';
  c_test_marker CONSTANT text := 'COL-849 test window';
  c_end_marker CONSTANT text := 'COL-849 test window end';
  c_route_name CONSTANT text := 'COL-849 test window: Brian only';
  c_fence_tables CONSTANT text[] := ARRAY['observation_escalation_deliveries', 'care_event_deliveries', 'watchlist_signal_notifications', 'resident_monitoring_order_notifications'];
  v_apply boolean := coalesce(current_setting('haven.col849_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_fac_id uuid;
  v_fac_name text;
  v_tz text;
  v_day_start time;
  v_go_live timestamptz;
  v_brian uuid;
  v_active record;
  v_resume record;
  v_active_windows integer;
  v_resume_windows integer;
  v_already_open boolean;
  v_snapshot jsonb;
  v_test_id uuid;
  v_end_id uuid;
  v_route_id uuid;
  v_next integer;
  v_result jsonb;
  v_reason_test text;
  v_reason_end text;
  v_esc_version uuid;
  v_table text;
  r record;
BEGIN
  -- Facility: exactly one, and the one the repository knows as Homewood.
  SELECT count(*) INTO v_n FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Homewood Lodge facility in the Circle of Life organization, found %', v_n;
  END IF;
  SELECT f.id, f.name, f.timezone INTO STRICT v_fac_id, v_fac_name, v_tz FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_fac_id <> c_homewood THEN
    RAISE EXCEPTION 'The Homewood Lodge facility found (%) is not the Homewood id the repository uses (%)', v_fac_id, c_homewood;
  END IF;
  IF v_tz <> 'America/New_York' THEN
    RAISE EXCEPTION 'Homewood timezone is %, expected America/New_York', v_tz;
  END IF;

  -- Go-live: the day shift start on 2026-10-01, derived exactly as the COL-695 scripts do.
  SELECT count(*) INTO v_n FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active day shift at Homewood, found %', v_n;
  END IF;
  SELECT s.starts_at_local INTO STRICT v_day_start FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  v_go_live := (c_go_live_date + v_day_start) AT TIME ZONE v_tz;

  -- Brian: the one person outside alerts may reach during the window.
  SELECT count(*) INTO v_n FROM public.user_profiles up
  WHERE up.organization_id = c_org AND lower(up.email) = c_brian_email AND up.is_active AND up.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active Haven user for Brian in the Circle of Life organization, found %', v_n;
  END IF;
  SELECT up.id INTO STRICT v_brian FROM public.user_profiles up
  WHERE up.organization_id = c_org AND lower(up.email) = c_brian_email AND up.is_active AND up.deleted_at IS NULL;

  INSERT INTO col849_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'id', v_fac_id::text),
    ('window', 'start', c_window_start::text),
    ('window', 'test cadence generates nothing due at or after', c_test_end::text || ' (' || to_char(c_test_end AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local)'),
    ('window', 'go-live (version 3 takes effect)', v_go_live::text),
    ('now', 'instant', v_now::text),
    ('alerts', 'Brian user id', v_brian::text),
    ('alerts', 'Brian has a phone on his profile', (SELECT (nullif(btrim(up.phone), '') IS NOT NULL)::text FROM public.user_profiles up WHERE up.id = v_brian)),
    ('alerts', 'Brian push subscriptions', (SELECT count(*)::text FROM public.notification_subscriptions ns WHERE ns.user_id = v_brian AND ns.deleted_at IS NULL));

  IF v_now >= c_test_end THEN
    RAISE EXCEPTION 'The test window closes at % and it is now %; nothing to open', c_test_end, v_now;
  END IF;
  IF v_now < c_window_start THEN
    RAISE EXCEPTION 'The clock (%) is before the window start %', v_now, c_window_start;
  END IF;

  INSERT INTO col849_report (section, item, detail)
  SELECT 'timeclock', 'timeclock_enabled now', coalesce((SELECT t.timeclock_enabled::text FROM public.timeclock_facility_settings t
                                                         WHERE t.organization_id = c_org AND t.facility_id = v_fac_id), 'no settings row');

  -- Cadence: exactly one version in force, and exactly one scheduled.
  SELECT count(*) INTO v_n FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.status = 'active' AND v.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active cadence version at Homewood, found %', v_n;
  END IF;
  SELECT v.* INTO STRICT v_active FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.status = 'active' AND v.deleted_at IS NULL;
  SELECT count(*) INTO v_active_windows FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_active.id AND w.deleted_at IS NULL AND w.enabled;
  v_already_open := v_active.change_reason LIKE c_test_marker || ':%';

  SELECT count(*) INTO v_n FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
    AND v.effective_from = v_go_live AND v.change_reason LIKE c_resume_marker || '%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one COL-695 resume version scheduled at %, found %', v_go_live, v_n;
  END IF;
  SELECT v.* INTO STRICT v_resume FROM public.facility_cadence_versions v
  WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status = 'scheduled'
    AND v.effective_from = v_go_live AND v.change_reason LIKE c_resume_marker || '%';
  SELECT count(*) INTO v_resume_windows FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL AND w.enabled;

  INSERT INTO col849_report (section, item, detail) VALUES
    ('cadence in force', 'version', v_active.id::text || ' (number ' || v_active.version_number || ')'),
    ('cadence in force', 'effective from', v_active.effective_from::text),
    ('cadence in force', 'enabled windows', v_active_windows::text),
    ('cadence in force', 'is the COL-849 test cadence', v_already_open::text),
    ('cadence scheduled', 'version', v_resume.id::text || ' (number ' || v_resume.version_number || '), from ' || v_resume.effective_from::text),
    ('cadence scheduled', 'enabled windows', v_resume_windows::text);
  FOR r IN SELECT w.window_key, w.shift_key, w.due_at_local, w.enabled FROM public.facility_cadence_windows w
           WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL ORDER BY w.sort_order, w.due_at_local LOOP
    INSERT INTO col849_report (section, item, detail)
      VALUES ('test windows (copied from version ' || v_resume.version_number || ')', r.window_key,
              r.shift_key || ' ' || to_char(r.due_at_local, 'HH24:MI') || CASE WHEN r.enabled THEN '' ELSE ' (disabled)' END);
  END LOOP;

  IF NOT v_already_open THEN
    IF NOT (v_active.change_reason LIKE c_pause_marker || '%' AND v_active_windows = 0) THEN
      RAISE EXCEPTION 'The cadence in force at Homewood is not the COL-695 pause (no windows). Review Smart Rounding settings before opening the test window';
    END IF;
    IF v_resume_windows = 0 THEN
      RAISE EXCEPTION 'The scheduled COL-695 resume version has no enabled windows to test with';
    END IF;
    IF EXISTS (SELECT 1 FROM public.facility_cadence_versions v
               WHERE v.facility_id = v_fac_id AND v.deleted_at IS NULL AND v.status IN ('draft', 'pending_approval', 'scheduled')
                 AND v.id <> v_resume.id) THEN
      RAISE EXCEPTION 'Another cadence version is waiting at Homewood besides the COL-695 resume; review it before opening the test window';
    END IF;
    IF EXISTS (SELECT 1 FROM public.notification_routes nr WHERE nr.organization_id = c_org AND nr.name = c_route_name AND nr.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'A "%" route already exists while the test cadence is not in force; the window is half open. Run the wipe dry run and review', c_route_name;
    END IF;
    IF to_regprocedure('haven.col849_test_window_notification_fence()') IS NOT NULL THEN
      RAISE EXCEPTION 'The COL-849 delivery fence already exists while the test cadence is not in force; the window is half open. Run the wipe dry run and review';
    END IF;
  END IF;

  -- Who each rung reaches today (counts only), and what changes.
  SELECT v.id INTO v_esc_version FROM public.facility_escalation_versions v
  WHERE v.facility_id = v_fac_id AND v.status = 'active' AND v.deleted_at IS NULL;
  IF v_esc_version IS NULL THEN
    RAISE EXCEPTION 'No active escalation version at Homewood';
  END IF;
  FOR r IN SELECT rg.id, rg.rung_key, rg.channels, rg.assigned_staff_only, rg.use_standing_alert_routes, rg.target_staff_roles
           FROM public.facility_escalation_rungs rg
           WHERE rg.escalation_version_id = v_esc_version AND rg.deleted_at IS NULL AND rg.enabled ORDER BY rg.sort_order LOOP
    INSERT INTO col849_report (section, item, detail)
    SELECT 'escalation rungs (unchanged)', r.rung_key,
           array_to_string(r.channels, ', ') || '; reaches ' || count(*) || ' people without an assignee'
           || CASE WHEN bool_or(x.target_user_id = v_brian) THEN ', Brian included' ELSE ', Brian not included' END
    FROM haven.observation_escalation_recipients(c_org, v_fac_id, r.id, NULL) x;
  END LOOP;
  INSERT INTO col849_report (section, item, detail) VALUES
    ('notification plan', 'route', CASE WHEN v_already_open THEN 'already present' ELSE 'add "' || c_route_name || '" at Homewood: administrators plus Brian; adds Brian to tier 1 to tier 3 and to acute watchlist notices' END),
    ('notification plan', 'delivery fence', CASE WHEN v_already_open THEN 'already present' ELSE 'skip every Homewood push, SMS, voice and email row for anyone but Brian on ' || array_to_string(c_fence_tables, ', ') || '; in-app untouched; inactive from ' || v_go_live::text END),
    ('notification plan', 'Homewood care-event escalation policies', (SELECT count(*)::text FROM public.care_event_escalation_policies p WHERE p.facility_id = v_fac_id) || ' (organization defaults apply; unchanged)'),
    ('notification plan', 'organization routes', (SELECT count(*)::text FROM public.notification_routes nr WHERE nr.organization_id = c_org AND nr.deleted_at IS NULL) || ' (unchanged)');

  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE $q$SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on'$q$ LOOP
      INSERT INTO col849_report (section, item, detail) VALUES ('cron', r.jobname, r.schedule || CASE WHEN r.active THEN ', active (left alone)' ELSE ', NOT ACTIVE' END);
    END LOOP;
  ELSE
    INSERT INTO col849_report (section, item, detail) VALUES ('cron', 'cron.job', 'not present on this database');
  END IF;

  INSERT INTO col849_report (section, item, detail) VALUES
    ('plan', 'timeclock', 'timeclock_enabled = true (idempotent)'),
    ('plan', 'cadence', CASE WHEN v_already_open THEN 'the test cadence is already in force; left alone'
                             ELSE 'new version with version ' || v_resume.version_number || '''s windows in force from now until ' || c_test_end::text
                                  || '; end version (no windows) scheduled at ' || c_test_end::text || '; version ' || v_resume.version_number || ' stays scheduled at ' || v_go_live::text END);

  IF NOT v_apply THEN
    RETURN;
  END IF;

  -- 1. Timeclock on.
  INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled)
  VALUES (c_org, v_fac_id, true)
  ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = true
  WHERE public.timeclock_facility_settings.timeclock_enabled IS DISTINCT FROM true;

  IF v_already_open THEN
    IF NOT EXISTS (SELECT 1 FROM public.audit_log a WHERE a.table_name = 'homewood_test_window' AND a.facility_id = v_fac_id AND a.record_id = v_active.id) THEN
      RAISE EXCEPTION 'The test cadence is in force but its snapshot is missing; rolled back';
    END IF;
    IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_col849_test_window_notification_fence') <> cardinality(c_fence_tables)
       OR NOT EXISTS (SELECT 1 FROM public.notification_routes nr WHERE nr.organization_id = c_org AND nr.facility_id = v_fac_id AND nr.name = c_route_name AND nr.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'The test cadence is in force but the route or the delivery fence is missing; rolled back';
    END IF;
    INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'already open', 'timeclock on; nothing else changed');
    RETURN;
  END IF;

  -- 2. Snapshot before any configuration changes. The id of the test version is chosen now
  --    so the snapshot row can point at it.
  v_test_id := gen_random_uuid();
  v_end_id := gen_random_uuid();
  v_route_id := gen_random_uuid();
  v_snapshot := pg_temp.col849_config(c_org, v_fac_id);

  -- 3. The test cadence.
  v_reason_test := c_test_marker || ': Smart Rounding test cadence at Homewood (windows copied from version '
    || v_resume.version_number || ') from ' || to_char(v_now AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' to '
    || to_char(c_test_end AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local. Removed by the COL-849 wipe.';
  v_reason_end := c_end_marker || ': no observation windows from ' || to_char(c_test_end AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI')
    || ' local until the COL-695 resume at go-live. Removed by the COL-849 wipe.';

  SELECT coalesce(max(v.version_number), 0) + 1 INTO v_next FROM public.facility_cadence_versions v WHERE v.facility_id = v_fac_id;
  INSERT INTO public.facility_cadence_versions
    (id, organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, configuration, apply_mode, activation_reason)
  VALUES
    (v_test_id, v_resume.organization_id, v_fac_id, v_next, 'draft', v_now, v_reason_test, v_resume.source_template_id, v_resume.configuration, 'immediate', v_reason_test);
  INSERT INTO public.facility_cadence_windows
    (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT w.organization_id, w.facility_id, v_test_id, w.window_key, w.label, w.due_at_local, w.grace_before_minutes, w.grace_after_minutes, w.shift_key, w.sort_order, w.enabled
  FROM public.facility_cadence_windows w
  WHERE w.cadence_version_id = v_resume.id AND w.deleted_at IS NULL;
  v_result := haven.apply_observation_config_activation('cadence', v_test_id, v_now, NULL, false);
  UPDATE public.facility_cadence_versions SET effective_to = c_test_end WHERE id = v_test_id;
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'test cadence in force', v_result::text);

  INSERT INTO public.facility_cadence_versions
    (id, organization_id, facility_id, version_number, status, effective_from, change_reason, source_template_id, configuration, apply_mode, activation_reason)
  VALUES
    (v_end_id, v_active.organization_id, v_fac_id, v_next + 1, 'scheduled', c_test_end, v_reason_end, v_active.source_template_id, v_active.configuration, 'scheduled', v_reason_end);
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'end version scheduled', v_end_id::text || ' at ' || c_test_end::text);

  -- 4. Brian's route.
  INSERT INTO public.notification_routes (id, organization_id, facility_id, name, severity_min, channels, staff_role_targets, user_targets, is_active)
  VALUES (v_route_id, c_org, v_fac_id, c_route_name, 'level_1', ARRAY['in_app', 'push', 'sms'], ARRAY['administrator']::public.staff_role[], ARRAY[v_brian], true);
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'route added', v_route_id::text);

  -- 5. The delivery fence. The facility, Brian and the go-live instant are written into the
  --    function body so the trigger reads no table and cannot be widened by data.
  EXECUTE format($f$
    CREATE FUNCTION haven.col849_test_window_notification_fence() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $body$
    BEGIN
      -- COL-849 test window: outside alerts at Homewood reach Brian only. Dropped by the wipe.
      IF NEW.facility_id = %L::uuid
         AND pg_catalog.now() < %L::timestamptz
         AND NEW.channel::text IN ('push', 'sms', 'voice', 'email')
         AND NEW.status IN ('queued', 'sending')
         AND NEW.target_user_id IS DISTINCT FROM %L::uuid THEN
        NEW.status := 'skipped';
        NEW.skip_reason := 'col849_test_window';
      END IF;
      RETURN NEW;
    END
    $body$$f$, v_fac_id, v_go_live, v_brian);
  REVOKE ALL ON FUNCTION haven.col849_test_window_notification_fence() FROM PUBLIC;
  FOREACH v_table IN ARRAY c_fence_tables LOOP
    EXECUTE format('CREATE TRIGGER tr_col849_test_window_notification_fence BEFORE INSERT OR UPDATE OF status ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION haven.col849_test_window_notification_fence()', v_table);
  END LOOP;
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'delivery fence', 'on ' || array_to_string(c_fence_tables, ', '));

  -- 6. The snapshot, where the wipe can find it.
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, organization_id, facility_id)
  VALUES ('homewood_test_window', v_test_id, 'INSERT', v_snapshot,
          jsonb_build_object('marker', 'COL-849', 'window_start', c_window_start, 'test_end', c_test_end, 'go_live', v_go_live,
                             'opened_at', v_now, 'brian_user_id', v_brian, 'paused_version_id', v_active.id,
                             'resume_version_id', v_resume.id, 'test_version_id', v_test_id, 'end_version_id', v_end_id,
                             'route_id', v_route_id, 'fence_tables', to_jsonb(c_fence_tables)),
          c_org, v_fac_id);

  -- Check the result before the transaction commits.
  IF public.facility_cadence_in_force(v_fac_id, v_now) IS DISTINCT FROM v_test_id THEN
    RAISE EXCEPTION 'The test cadence is not the version in force now; rolled back';
  END IF;
  IF public.facility_cadence_in_force(v_fac_id, c_test_end) IS NOT NULL
     OR public.facility_cadence_in_force(v_fac_id, v_go_live - interval '1 second') IS NOT NULL THEN
    RAISE EXCEPTION 'A cadence version with windows is in force after %; rolled back', c_test_end;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.id = v_resume.id AND v.status = 'scheduled' AND v.effective_from = v_go_live AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Version % is no longer scheduled at go-live; rolled back', v_resume.version_number;
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_col849_test_window_notification_fence' AND t.tgenabled = 'O') <> cardinality(c_fence_tables) THEN
    RAISE EXCEPTION 'The delivery fence is not on every queue; rolled back';
  END IF;
  FOR r IN SELECT rg.id, rg.rung_key FROM public.facility_escalation_rungs rg
           WHERE rg.escalation_version_id = v_esc_version AND rg.deleted_at IS NULL AND rg.enabled AND NOT rg.assigned_staff_only LOOP
    IF NOT EXISTS (SELECT 1 FROM haven.observation_escalation_recipients(c_org, v_fac_id, r.id, NULL) x WHERE x.target_user_id = v_brian) THEN
      RAISE EXCEPTION 'Rung % does not reach Brian after the route was added; rolled back', r.rung_key;
    END IF;
  END LOOP;
  IF (pg_temp.col849_config(c_org, v_fac_id) -> 'escalation_rungs') IS DISTINCT FROM (v_snapshot -> 'escalation_rungs')
     OR (pg_temp.col849_config(c_org, v_fac_id) -> 'care_event_escalation_policies') IS DISTINCT FROM (v_snapshot -> 'care_event_escalation_policies') THEN
    RAISE EXCEPTION 'Escalation rungs or care-event policies changed; rolled back';
  END IF;
  FOR r IN SELECT w.window_key, w.due_at_utc FROM public.facility_observation_windows_for_date(v_fac_id, (v_now AT TIME ZONE v_tz)::date) w
           WHERE w.due_at_utc >= v_now ORDER BY w.due_at_utc LOOP
    INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'window still to come today', r.window_key || ' due ' || r.due_at_utc::text);
  END LOOP;
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'snapshot', 'audit_log table_name homewood_test_window, record_id ' || v_test_id::text);
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'verified', 'test cadence in force until ' || c_test_end::text || '; version 3 still scheduled; Brian on every routed rung; fence on');
END
$col849$;

COMMIT;

RESET haven.col849_apply;

SELECT section, item, detail FROM col849_report ORDER BY seq;
