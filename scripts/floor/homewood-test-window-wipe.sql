-- Homewood Lodge: close the COL-849 test window and remove everything it created.
--
-- Linear: COL-849. Runbook: docs/operations/homewood-test-window.md. Inventory:
-- HANDOFFS/2026-09-25__homewood-test-window/WRITE-INVENTORY.md.
-- Who runs it: Brian, by hand, against production, on the evening of 2026-09-30, after
-- the photo removal (scripts/floor/homewood-test-window-photos.mjs) and before the
-- 05:30 ET Oct 1 Timeclock job. The build never runs it.
--
-- The window is Homewood (00000000-0000-0000-0002-000000000003) from
-- 2026-09-25 20:24:02.307103+00. Every set is scoped by that facility plus that instant,
-- never by the facility alone; rows without a facility column are reached only through
-- their parent rows. Tables fed by other Haven surfaces are scoped by the producer as
-- well (exec alerts, kiosk visitor entries, manual handoff notes, incidents raised by a
-- care event); the dry run counts what is kept.
--
-- The apply is one transaction:
--   1. Stops before deleting anything if a Homewood payroll packet was created or changed
--      in the window, a test incident's AHCA obligation was submitted, a record outside
--      the test points at a test row, a photo is still in Storage, or it is at or after
--      2026-10-01 09:30+00 (05:30 ET, when the Oct 1 Timeclock job runs).
--   2. Disables exactly these guard triggers by name, nothing else (audit triggers keep
--      firing, so the audit trail records every deletion):
--        time_punches.tr_time_punches_append_only
--        time_punch_corrections.tr_time_punch_corrections_append_only
--        timeclock_sync_rejections.tr_timeclock_sync_rejections_append_only
--        resident_observation_logs.tr_rounding_logs_immutable
--        rounding_completion_receipts.tr_rounding_completion_receipts_immutable
--        resident_observation_tasks.tr_rounding_task_write_guard
--        floor_unlocks.tr_floor_unlocks_guard
--      tr_payroll_source_revision stays on: it does not block a delete, it marks payroll
--      previews built from these punches as stale, which is true.
--   3. Deletes every window row in foreign-key order, re-enables the guards and asserts
--      tgenabled = 'O' for each, raising (and rolling everything back) if not.
--   4. Restores the configuration from the snapshot the open script wrote to audit_log:
--      cadence version 2 active and version 3 scheduled, the test and end versions gone,
--      the template binding, the notification routes (Brian's route removed), the
--      delivery fence dropped, the Homewood incident number counter.
--   5. Timeclock off at Homewood and its other timeclock settings back to the snapshot;
--      failed PIN counters, PIN lockouts and device failure and throttle columns reset. Devices, credentials, staff and users are kept. The
--      col695-homewood-timeclock-on cron job is not touched.
--   6. Verifies inside the transaction: no window row left in any inventory table, every
--      pre-window row unchanged (row hashes), every guard on, the configuration equal to
--      the snapshot, the cron job unchanged. Any difference raises and rolls back.
-- The final statement is the report, including a verification section recomputed after
-- the commit.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/homewood-test-window-wipe.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col849_apply = 'homewood-test-window-wipe';"; cat scripts/floor/homewood-test-window-wipe.sql; } > /tmp/col849-wipe-apply.sql
--     supabase db query --linked -f /tmp/col849-wipe-apply.sql
--
-- Plain SQL on purpose (no psql meta-commands through the Management API). The report
-- prints ids, table names and counts, never resident or staff names. Safe to run twice:
-- a second apply finds no window rows and a configuration already equal to the snapshot.

DROP TABLE IF EXISTS pg_temp.col849_report;
CREATE TEMP TABLE col849_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);
DROP TABLE IF EXISTS pg_temp.col849_set;
CREATE TEMP TABLE col849_set (tbl text NOT NULL, id uuid NOT NULL, PRIMARY KEY (tbl, id));
DROP TABLE IF EXISTS pg_temp.col849_deleted;
CREATE TEMP TABLE col849_deleted (tbl text NOT NULL, id uuid NOT NULL, PRIMARY KEY (tbl, id));
DROP TABLE IF EXISTS pg_temp.col849_counts;
CREATE TEMP TABLE col849_counts (tbl text PRIMARY KEY, ord integer NOT NULL, window_rows bigint, pre_rows bigint, pre_hash text, kept_window_rows bigint,
                                 pre_touched_in_window bigint, deleted bigint, window_rows_after bigint, pre_rows_after bigint, pre_hash_after text);

-- The configuration document. Byte-identical to the copy in homewood-test-window-open.sql.
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

-- The window sets, one row per table and id. Every predicate carries the facility and the
-- window start; the ones reached through a parent also require the parent in the set.
CREATE OR REPLACE FUNCTION pg_temp.col849_collect(p_org uuid, p_fac uuid, p_fac_name text, p_ws timestamptz) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  TRUNCATE pg_temp.col849_set;
  -- Timeclock and floor.
  INSERT INTO pg_temp.col849_set SELECT 'time_punches', x.id FROM public.time_punches x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'time_punch_corrections', x.id FROM public.time_punch_corrections x WHERE x.facility_id = p_fac AND x.corrected_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'timeclock_sync_rejections', x.id FROM public.timeclock_sync_rejections x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'floor_unlocks', x.id FROM public.floor_unlocks x WHERE x.facility_id = p_fac AND x.started_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'med_tech_shifts', x.id FROM public.med_tech_shifts x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'med_passes', x.id FROM public.med_passes x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.shift_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'med_tech_shifts');
  INSERT INTO pg_temp.col849_set SELECT 'shift_tape_events', x.id FROM public.shift_tape_events x
    WHERE x.facility_id = p_fac AND x.occurred_at >= p_ws AND x.shift_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'med_tech_shifts');
  INSERT INTO pg_temp.col849_set SELECT 'med_tech_shift_residents', x.id FROM public.med_tech_shift_residents x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.shift_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'med_tech_shifts');
  -- Kiosk visitors: entries made at a kiosk device, not entries typed by staff.
  INSERT INTO pg_temp.col849_set SELECT 'visitor_log_entries', x.id FROM public.visitor_log_entries x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.kiosk_device_id IS NOT NULL;
  -- Smart Rounding.
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_tasks', x.id FROM public.resident_observation_tasks x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_logs', x.id FROM public.resident_observation_logs x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_assignments', x.id FROM public.resident_observation_assignments x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'rounding_completion_receipts', x.id FROM public.rounding_completion_receipts x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_integrity_flags', x.id FROM public.resident_observation_integrity_flags x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_exceptions', x.id FROM public.resident_observation_exceptions x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_observation_escalations', x.id FROM public.resident_observation_escalations x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'observation_escalation_dispatches', x.id FROM public.observation_escalation_dispatches x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'observation_escalation_deliveries', x.id FROM public.observation_escalation_deliveries x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'watchlist_signal_instances', x.id FROM public.watchlist_signal_instances x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'watchlist_signal_notifications', x.id FROM public.watchlist_signal_notifications x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'watchlist_signal_dispositions', x.id FROM public.watchlist_signal_dispositions x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'resident_monitoring_order_notifications', x.id FROM public.resident_monitoring_order_notifications x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  -- Something happened.
  INSERT INTO pg_temp.col849_set SELECT 'care_events', x.id FROM public.care_events x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'care_event_deliveries', x.id FROM public.care_event_deliveries x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  INSERT INTO pg_temp.col849_set SELECT 'incidents', x.id FROM public.incidents x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws
      AND x.id IN (SELECT ce.incident_id FROM public.care_events ce JOIN pg_temp.col849_set s ON s.tbl = 'care_events' AND s.id = ce.id);
  INSERT INTO pg_temp.col849_set SELECT 'behavioral_logs', x.id FROM public.behavioral_logs x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws
      AND x.id IN (SELECT ce.behavioral_log_id FROM public.care_events ce JOIN pg_temp.col849_set s ON s.tbl = 'care_events' AND s.id = ce.id);
  INSERT INTO pg_temp.col849_set SELECT 'condition_changes', x.id FROM public.condition_changes x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws
      AND x.id IN (SELECT ce.condition_change_id FROM public.care_events ce JOIN pg_temp.col849_set s ON s.tbl = 'care_events' AND s.id = ce.id);
  INSERT INTO pg_temp.col849_set SELECT 'incident_photos', x.id FROM public.incident_photos x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws
      AND (x.incident_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents')
           OR x.care_event_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'care_events'));
  INSERT INTO pg_temp.col849_set SELECT 'incident_followups', x.id FROM public.incident_followups x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.incident_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents');
  INSERT INTO pg_temp.col849_set SELECT 'regulatory_reporting_obligations', x.id FROM public.regulatory_reporting_obligations x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.incident_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents');
  INSERT INTO pg_temp.col849_set SELECT 'incident_rca', x.id FROM public.incident_rca x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.incident_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents');
  -- incident_root_causes has no id and no facility: keyed by its parent incident.
  INSERT INTO pg_temp.col849_set SELECT DISTINCT 'incident_root_causes', x.incident_id FROM public.incident_root_causes x
    WHERE x.incident_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents');
  INSERT INTO pg_temp.col849_set SELECT 'care_plan_review_alerts', x.id FROM public.care_plan_review_alerts x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws
      AND x.trigger_source_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl IN ('incidents', 'condition_changes'));
  INSERT INTO pg_temp.col849_set SELECT 'resident_watch_instances', x.id FROM public.resident_watch_instances x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.triggered_by_type::text IN ('incident_fall', 'incident_elopement', 'incident_wandering')
      AND x.triggered_by_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'incidents');
  -- A watch instance from a test incident places a monitoring order (haven.bridge_watch_instance_to_monitoring_order).
  INSERT INTO pg_temp.col849_set SELECT 'resident_monitoring_orders', x.id FROM public.resident_monitoring_orders x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.source_watch_instance_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'resident_watch_instances');
  INSERT INTO pg_temp.col849_set SELECT 'resident_monitoring_order_events', x.id FROM public.resident_monitoring_order_events x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.monitoring_order_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'resident_monitoring_orders');
  INSERT INTO pg_temp.col849_set SELECT 'resident_watch_events', x.id FROM public.resident_watch_events x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
  -- Executive alerts: the four producers the flows drive, nothing else.
  INSERT INTO pg_temp.col849_set SELECT 'exec_alerts', x.id FROM public.exec_alerts x
    WHERE x.facility_id = p_fac AND x.organization_id = p_org AND x.created_at >= p_ws
      AND ((x.source_module::text = 'compliance' AND right(x.title, length(': observation window at ' || p_fac_name)) = ': observation window at ' || p_fac_name)
        OR (x.source_module::text = 'staff' AND x.title LIKE 'Nobody is scheduled for the % at ' || p_fac_name || ' on %')
        OR (x.source_module::text = 'incidents' AND x.category = 'care_event'
            AND x.deep_link_path IN (SELECT '/admin/care-events/' || s.id::text FROM pg_temp.col849_set s WHERE s.tbl = 'care_events'))
        OR (x.category = 'smart_rounding'
            AND (x.id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl IN ('watchlist_signal_instances', 'resident_monitoring_orders'))
                 OR x.id IN (SELECT n.monitoring_order_id FROM public.resident_monitoring_order_notifications n
                             JOIN pg_temp.col849_set s ON s.tbl = 'resident_monitoring_order_notifications' AND s.id = n.id))));
  INSERT INTO pg_temp.col849_set SELECT 'exec_alert_user_state', x.id FROM public.exec_alert_user_state x
    WHERE x.exec_alert_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'exec_alerts');
  INSERT INTO pg_temp.col849_set SELECT 'exec_actions', x.id FROM public.exec_actions x
    WHERE x.alert_id IN (SELECT s.id FROM pg_temp.col849_set s WHERE s.tbl = 'exec_alerts');
  -- Handoff: notes people write (system notes carry a source_kind and are kept).
  INSERT INTO pg_temp.col849_set SELECT 'shift_handoff_notes', x.id FROM public.shift_handoff_notes x
    WHERE x.facility_id = p_fac AND x.created_at >= p_ws AND x.source_kind IS NULL;
  INSERT INTO pg_temp.col849_set SELECT 'shift_handoffs', x.id FROM public.shift_handoffs x WHERE x.facility_id = p_fac AND x.created_at >= p_ws;
END
$fn$;

-- Per table: pre-window rows (count and a hash of every column), all window rows at the
-- facility, and pre-window rows changed during the window. Tables without a facility or
-- time column are measured through their parent.
CREATE OR REPLACE FUNCTION pg_temp.col849_measure(p_fac uuid, p_ws timestamptz, p_after boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  v_pre bigint;
  v_hash text;
  v_all bigint;
  v_touched bigint;
  v_pre_where text;
  v_all_where text;
  v_has_updated boolean;
BEGIN
  FOR r IN SELECT c.tbl FROM pg_temp.col849_counts c ORDER BY c.ord LOOP
    v_pre_where := CASE r.tbl
      WHEN 'time_punch_corrections' THEN format('x.facility_id = %L AND x.corrected_at < %L', p_fac, p_ws)
      WHEN 'floor_unlocks' THEN format('x.facility_id = %L AND x.started_at < %L', p_fac, p_ws)
      WHEN 'shift_tape_events' THEN format('x.facility_id = %L AND x.occurred_at < %L', p_fac, p_ws)
      WHEN 'incident_root_causes' THEN format('x.incident_id IN (SELECT i.id FROM public.incidents i WHERE i.facility_id = %L AND i.created_at < %L)', p_fac, p_ws)
      WHEN 'exec_alert_user_state' THEN format('x.exec_alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at < %L)', p_fac, p_ws)
      WHEN 'exec_actions' THEN format('x.alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at < %L)', p_fac, p_ws)
      ELSE format('x.facility_id = %L AND x.created_at < %L', p_fac, p_ws) END;
    v_all_where := CASE r.tbl
      WHEN 'time_punch_corrections' THEN format('x.facility_id = %L AND x.corrected_at >= %L', p_fac, p_ws)
      WHEN 'floor_unlocks' THEN format('x.facility_id = %L AND x.started_at >= %L', p_fac, p_ws)
      WHEN 'shift_tape_events' THEN format('x.facility_id = %L AND x.occurred_at >= %L', p_fac, p_ws)
      WHEN 'incident_root_causes' THEN format('x.incident_id IN (SELECT i.id FROM public.incidents i WHERE i.facility_id = %L AND i.created_at >= %L)', p_fac, p_ws)
      WHEN 'exec_alert_user_state' THEN format('x.exec_alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at >= %L)', p_fac, p_ws)
      WHEN 'exec_actions' THEN format('x.alert_id IN (SELECT a.id FROM public.exec_alerts a WHERE a.facility_id = %L AND a.created_at >= %L)', p_fac, p_ws)
      ELSE format('x.facility_id = %L AND x.created_at >= %L', p_fac, p_ws) END;
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '''' ORDER BY md5(to_jsonb(x)::text)), '''')) FROM public.%I x WHERE %s',
                   r.tbl, v_pre_where) INTO v_pre, v_hash;
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s', r.tbl, v_all_where) INTO v_all;
    v_has_updated := EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = format('public.%I', r.tbl)::regclass AND a.attname = 'updated_at' AND NOT a.attisdropped);
    v_touched := NULL;
    IF v_has_updated THEN
      EXECUTE format('SELECT count(*) FROM public.%I x WHERE %s AND x.updated_at >= %L', r.tbl, v_pre_where, p_ws) INTO v_touched;
    END IF;
    IF p_after THEN
      UPDATE pg_temp.col849_counts c SET pre_rows_after = v_pre, pre_hash_after = v_hash,
        window_rows_after = (SELECT count(*) FROM pg_temp.col849_set s WHERE s.tbl = r.tbl)
      WHERE c.tbl = r.tbl;
    ELSE
      UPDATE pg_temp.col849_counts c SET pre_rows = v_pre, pre_hash = v_hash, pre_touched_in_window = v_touched,
        window_rows = (SELECT count(*) FROM pg_temp.col849_set s WHERE s.tbl = r.tbl),
        kept_window_rows = v_all - (SELECT count(*) FROM pg_temp.col849_set s WHERE s.tbl = r.tbl)
      WHERE c.tbl = r.tbl;
    END IF;
  END LOOP;
END
$fn$;

-- Delete order: children first. resident_observation_tasks and resident_observation_logs
-- point at each other and are deleted in one statement at position 16.
INSERT INTO col849_counts (tbl, ord) VALUES
  ('observation_escalation_deliveries', 1), ('observation_escalation_dispatches', 2), ('resident_observation_escalations', 3),
  ('watchlist_signal_notifications', 4), ('watchlist_signal_dispositions', 5), ('resident_monitoring_order_notifications', 6),
  ('care_event_deliveries', 7), ('exec_alert_user_state', 8), ('exec_actions', 9), ('exec_alerts', 10),
  ('resident_watch_events', 11), ('resident_observation_exceptions', 12), ('resident_observation_integrity_flags', 13),
  ('rounding_completion_receipts', 14), ('resident_observation_assignments', 15), ('resident_observation_tasks', 16),
  ('resident_observation_logs', 17), ('resident_monitoring_order_events', 18), ('resident_monitoring_orders', 19),
  ('watchlist_signal_instances', 20), ('incident_photos', 21), ('incident_followups', 22),
  ('regulatory_reporting_obligations', 23), ('incident_rca', 24), ('incident_root_causes', 25), ('care_plan_review_alerts', 26),
  ('resident_watch_instances', 27), ('care_events', 28), ('incidents', 29), ('behavioral_logs', 30), ('condition_changes', 31),
  ('shift_handoff_notes', 32), ('shift_handoffs', 33), ('visitor_log_entries', 34), ('med_passes', 35), ('shift_tape_events', 36),
  ('med_tech_shift_residents', 37), ('med_tech_shifts', 38), ('time_punch_corrections', 39), ('time_punches', 40),
  ('timeclock_sync_rejections', 41), ('floor_unlocks', 42);

BEGIN;

DO $col849$
DECLARE
  c_script CONSTANT text := 'homewood-test-window-wipe';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  c_window_start CONSTANT timestamptz := '2026-09-25 20:24:02.307103+00';
  c_deadline CONSTANT timestamptz := '2026-10-01 09:30:00+00';
  c_test_marker CONSTANT text := 'COL-849 test window';
  c_route_name CONSTANT text := 'COL-849 test window: Brian only';
  c_photo_bucket CONSTANT text := 'incident-photos';
  c_guards CONSTANT text[] := ARRAY[
    'time_punches.tr_time_punches_append_only',
    'time_punch_corrections.tr_time_punch_corrections_append_only',
    'timeclock_sync_rejections.tr_timeclock_sync_rejections_append_only',
    'resident_observation_logs.tr_rounding_logs_immutable',
    'rounding_completion_receipts.tr_rounding_completion_receipts_immutable',
    'resident_observation_tasks.tr_rounding_task_write_guard',
    'floor_unlocks.tr_floor_unlocks_guard'];
  c_compare CONSTANT text[] := ARRAY['cadence_versions', 'cadence_windows', 'escalation_versions', 'escalation_rungs', 'escalation_rung_shift_overrides',
    'template_binding', 'notification_routes', 'care_event_escalation_policies', 'timeclock_settings', 'cron'];
  v_apply boolean := coalesce(current_setting('haven.col849_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_m integer;
  v_fac_id uuid;
  v_fac_name text;
  v_tz text;
  v_snap record;
  v_snap_count integer;
  v_old jsonb;
  v_meta jsonb;
  v_current jsonb;
  v_key text;
  v_guard text;
  v_tbl text;
  v_trg text;
  v_photos integer;
  v_outside jsonb := '{}'::jsonb;
  v_blockers text[] := ARRAY[]::text[];
  v_kept_incidents integer;
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

  INSERT INTO col849_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'id', v_fac_id::text),
    ('window', 'start', c_window_start::text),
    ('window', 'apply refused at or after', c_deadline::text || ' (' || to_char(c_deadline AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local, the Oct 1 Timeclock job)'),
    ('now', 'instant', v_now::text);

  -- The snapshot the open script wrote.
  SELECT count(*) INTO v_snap_count FROM public.audit_log a WHERE a.table_name = 'homewood_test_window' AND a.facility_id = v_fac_id;
  IF v_snap_count > 1 THEN
    RAISE EXCEPTION 'Found % COL-849 snapshots at Homewood; expected at most one. Review audit_log before wiping', v_snap_count;
  END IF;
  SELECT a.old_data, a.new_data, a.record_id, a.created_at INTO v_snap FROM public.audit_log a
  WHERE a.table_name = 'homewood_test_window' AND a.facility_id = v_fac_id;
  v_old := v_snap.old_data;
  v_meta := v_snap.new_data;
  INSERT INTO col849_report (section, item, detail) VALUES
    ('snapshot', 'open script applied', CASE WHEN v_old IS NULL THEN 'no (nothing to restore beyond timeclock and counters)'
                                             ELSE 'yes, ' || v_snap.created_at::text || ', test cadence version ' || (v_meta ->> 'test_version_id') END);
  IF v_old IS NULL AND (EXISTS (SELECT 1 FROM public.facility_cadence_versions v WHERE v.facility_id = v_fac_id AND v.change_reason LIKE c_test_marker || '%')
                        OR EXISTS (SELECT 1 FROM public.notification_routes nr WHERE nr.organization_id = c_org AND nr.name = c_route_name)
                        OR to_regprocedure('haven.col849_test_window_notification_fence()') IS NOT NULL) THEN
    RAISE EXCEPTION 'COL-849 configuration exists at Homewood but its snapshot does not; the window is half open. Review before wiping';
  END IF;

  -- The sets and the measurements.
  PERFORM pg_temp.col849_collect(c_org, v_fac_id, v_fac_name, c_window_start);
  PERFORM pg_temp.col849_measure(v_fac_id, c_window_start, false);
  FOR r IN SELECT * FROM col849_counts ORDER BY ord LOOP
    INSERT INTO col849_report (section, item, detail)
      VALUES ('dry run', lpad(r.ord::text, 2, '0') || ' ' || r.tbl,
              'window rows to delete ' || r.window_rows || '; pre-window rows ' || r.pre_rows || ' (kept)'
              || CASE WHEN r.kept_window_rows > 0 THEN '; window rows from other producers kept ' || r.kept_window_rows ELSE '' END
              || CASE WHEN coalesce(r.pre_touched_in_window, 0) > 0 THEN '; pre-window rows updated during the window ' || r.pre_touched_in_window || ' (left as they are)' ELSE '' END);
  END LOOP;

  -- What the dry run needs a person to look at.
  INSERT INTO col849_report (section, item, detail)
  SELECT 'dry run', 'care events by reporter role', coalesce(string_agg(x.role || ' ' || x.n, ', ' ORDER BY x.role), 'none')
  FROM (SELECT coalesce(up.app_role::text, 'unknown') AS role, count(*) AS n
        FROM public.care_events ce JOIN col849_set s ON s.tbl = 'care_events' AND s.id = ce.id
        LEFT JOIN public.user_profiles up ON up.id = ce.reported_by GROUP BY 1) x;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'dry run', 'test cadence checks by version', coalesce(string_agg(x.v || ': ' || x.n, ', ' ORDER BY x.v), 'none')
  FROM (SELECT coalesce(v.version_number::text, 'monitoring order or none') AS v, count(*) AS n
        FROM public.resident_observation_tasks t JOIN col849_set s ON s.tbl = 'resident_observation_tasks' AND s.id = t.id
        LEFT JOIN public.facility_cadence_versions v ON v.id = t.cadence_version_id GROUP BY 1) x;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'dry run', 'deliveries by status', coalesce(string_agg(x.k || ' ' || x.n, ', ' ORDER BY x.k), 'none')
  FROM (SELECT d.channel || '/' || d.status || coalesce('/' || d.skip_reason, '') AS k, count(*) AS n
        FROM public.observation_escalation_deliveries d JOIN col849_set s ON s.tbl = 'observation_escalation_deliveries' AND s.id = d.id GROUP BY 1
        UNION ALL
        SELECT 'care event ' || d.channel || '/' || d.status || coalesce('/' || d.skip_reason, ''), count(*)
        FROM public.care_event_deliveries d JOIN col849_set s ON s.tbl = 'care_event_deliveries' AND s.id = d.id GROUP BY 1) x;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'dry run', 'push, SMS, voice or email sent to someone other than Brian', count(*)::text
  FROM (SELECT d.target_user_id, d.channel::text AS channel, d.status FROM public.observation_escalation_deliveries d JOIN col849_set s ON s.tbl = 'observation_escalation_deliveries' AND s.id = d.id
        UNION ALL SELECT d.target_user_id, d.channel, d.status FROM public.care_event_deliveries d JOIN col849_set s ON s.tbl = 'care_event_deliveries' AND s.id = d.id
        UNION ALL SELECT d.target_user_id, d.channel, d.status FROM public.watchlist_signal_notifications d JOIN col849_set s ON s.tbl = 'watchlist_signal_notifications' AND s.id = d.id
        UNION ALL SELECT d.target_user_id, d.channel, d.status FROM public.resident_monitoring_order_notifications d JOIN col849_set s ON s.tbl = 'resident_monitoring_order_notifications' AND s.id = d.id) x
  WHERE x.channel <> 'in_app' AND x.status IN ('sent', 'delivered', 'acknowledged')
    AND x.target_user_id IS DISTINCT FROM (v_meta ->> 'brian_user_id')::uuid;

  -- Stops.
  IF v_now >= c_deadline THEN
    v_blockers := v_blockers || ('it is at or after ' || c_deadline::text || '; the Oct 1 Timeclock job and go-live own Homewood now');
  END IF;
  SELECT count(*) INTO v_n FROM public.payroll_packets p WHERE p.facility_id = v_fac_id AND (p.created_at >= c_window_start OR p.updated_at >= c_window_start);
  SELECT count(*) INTO v_m FROM public.payroll_packet_events e WHERE e.facility_id = v_fac_id AND e.created_at >= c_window_start;
  INSERT INTO col849_report (section, item, detail) VALUES ('stops', 'Homewood payroll packets created or changed in the window', v_n::text || ' packets, ' || v_m || ' packet events');
  IF v_n + v_m > 0 THEN
    v_blockers := v_blockers || 'a Homewood payroll packet was created or changed in the window and may have read test punches'::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.regulatory_reporting_obligations o JOIN col849_set s ON s.tbl = 'regulatory_reporting_obligations' AND s.id = o.id
  WHERE o.submitted_at IS NOT NULL;
  INSERT INTO col849_report (section, item, detail) VALUES ('stops', 'test AHCA obligations marked submitted', v_n::text);
  IF v_n > 0 THEN
    v_blockers := v_blockers || 'a test incident''s AHCA reporting obligation is marked submitted'::text;
  END IF;
  v_outside := jsonb_build_object(
    'emar_records -> med_passes', (SELECT count(*) FROM public.emar_records e WHERE e.med_pass_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'med_passes')),
    'prn_events -> med_passes', (SELECT count(*) FROM public.prn_events e WHERE e.med_pass_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'med_passes')),
    'prn_events -> med_tech_shifts', (SELECT count(*) FROM public.prn_events e WHERE e.shift_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'med_tech_shifts')),
    'witness_signatures -> med_passes', (SELECT count(*) FROM public.witness_signatures w WHERE w.med_pass_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'med_passes')),
    'insurance_claims -> incidents', (SELECT count(*) FROM public.insurance_claims c WHERE c.incident_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'incidents')),
    'medication_errors -> incidents', (SELECT count(*) FROM public.medication_errors m WHERE m.linked_incident_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'incidents')),
    'resident_monitoring_orders (kept) -> resident_watch_instances', (SELECT count(*) FROM public.resident_monitoring_orders o
       WHERE o.source_watch_instance_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_watch_instances')
         AND o.id NOT IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_monitoring_orders')),
    'resident_monitoring_order_events (kept) -> resident_monitoring_orders', (SELECT count(*) FROM public.resident_monitoring_order_events e
       WHERE e.monitoring_order_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_monitoring_orders')
         AND e.id NOT IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_monitoring_order_events')),
    'resident_observation_tasks (kept) -> resident_monitoring_orders', (SELECT count(*) FROM public.resident_observation_tasks t
       WHERE t.monitoring_order_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_monitoring_orders')
         AND t.id NOT IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_observation_tasks')),
    'admission_arrival_reversals -> shift_handoff_notes', (SELECT count(*) FROM public.admission_arrival_reversals a
       WHERE a.census_review_note_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'shift_handoff_notes')
          OR a.finance_review_note_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'shift_handoff_notes')),
    'resident_observation_exceptions (kept) -> incidents', (SELECT count(*) FROM public.resident_observation_exceptions x
       WHERE x.linked_incident_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'incidents')
         AND x.id NOT IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'resident_observation_exceptions')),
    'care_events (kept) -> incidents', (SELECT count(*) FROM public.care_events x
       WHERE x.incident_id IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'incidents')
         AND x.id NOT IN (SELECT s.id FROM col849_set s WHERE s.tbl = 'care_events')));
  FOR r IN SELECT key, value FROM jsonb_each(v_outside) ORDER BY key LOOP
    INSERT INTO col849_report (section, item, detail) VALUES ('stops', 'records outside the test pointing at test rows: ' || r.key, r.value::text);
    IF r.value::bigint > 0 THEN
      v_blockers := v_blockers || ('a record outside the test points at a test row (' || r.key || ')');
    END IF;
  END LOOP;
  SELECT count(*) INTO v_photos FROM storage.objects o
  WHERE o.bucket_id = c_photo_bucket AND o.name LIKE c_org::text || '/' || v_fac_id::text || '/%' AND o.created_at >= c_window_start;
  INSERT INTO col849_report (section, item, detail) VALUES ('stops', 'test photos still in Storage (bucket ' || c_photo_bucket || ')', v_photos::text
    || CASE WHEN v_photos > 0 THEN '; run scripts/floor/homewood-test-window-photos.mjs --apply first' ELSE '' END);
  IF v_photos > 0 THEN
    v_blockers := v_blockers || 'test photos are still in Storage'::text;
  END IF;

  -- Guards: present and on before anything is disabled.
  FOREACH v_guard IN ARRAY c_guards LOOP
    v_tbl := split_part(v_guard, '.', 1);
    v_trg := split_part(v_guard, '.', 2);
    SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = format('public.%I', v_tbl)::regclass AND t.tgname = v_trg AND t.tgenabled = 'O' AND NOT t.tgisinternal;
    INSERT INTO col849_report (section, item, detail) VALUES ('guards before', v_guard, CASE WHEN v_n = 1 THEN 'enabled' ELSE 'MISSING OR NOT ENABLED' END);
    IF v_n <> 1 THEN
      v_blockers := v_blockers || ('guard trigger ' || v_guard || ' is missing or not enabled');
    END IF;
  END LOOP;

  -- Configuration the wipe will restore.
  IF v_old IS NOT NULL THEN
    v_current := pg_temp.col849_config(c_org, v_fac_id);
    FOREACH v_key IN ARRAY c_compare LOOP
      INSERT INTO col849_report (section, item, detail)
        VALUES ('configuration before', v_key, CASE WHEN (v_current -> v_key) IS NOT DISTINCT FROM (v_old -> v_key) THEN 'equal to the snapshot' ELSE 'differs from the snapshot; restored by the apply' END);
    END LOOP;
    INSERT INTO col849_report (section, item, detail) VALUES
      ('configuration before', 'delivery fence', (v_current ->> 'fence_triggers') || ' triggers; dropped by the apply');
  END IF;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'configuration before', 'timeclock_enabled', coalesce((SELECT t.timeclock_enabled::text FROM public.timeclock_facility_settings t WHERE t.facility_id = v_fac_id), 'no settings row');
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE $q$SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on'$q$ LOOP
      INSERT INTO col849_report (section, item, detail) VALUES ('cron', r.jobname, r.schedule || CASE WHEN r.active THEN ', active (left alone)' ELSE ', NOT ACTIVE' END);
    END LOOP;
  END IF;

  FOR v_n IN 1 .. coalesce(cardinality(v_blockers), 0) LOOP
    INSERT INTO col849_report (section, item, detail) VALUES ('STOP', 'the apply will refuse', v_blockers[v_n]);
  END LOOP;

  IF NOT v_apply THEN
    RETURN;
  END IF;
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'COL-849 wipe refused: %', array_to_string(v_blockers, '; ');
  END IF;

  -- Delete. Guards off by name, inside this transaction only.
  FOREACH v_guard IN ARRAY c_guards LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
  END LOOP;

  FOR r IN SELECT c.tbl FROM col849_counts c WHERE c.tbl <> 'resident_observation_logs' ORDER BY c.ord LOOP
    IF r.tbl = 'resident_observation_tasks' THEN
      WITH t AS (DELETE FROM public.resident_observation_tasks x USING col849_set s
                 WHERE s.tbl = 'resident_observation_tasks' AND x.id = s.id AND x.facility_id = v_fac_id RETURNING x.id),
           l AS (DELETE FROM public.resident_observation_logs x USING col849_set s
                 WHERE s.tbl = 'resident_observation_logs' AND x.id = s.id AND x.facility_id = v_fac_id RETURNING x.id)
      INSERT INTO col849_deleted SELECT 'resident_observation_tasks', t.id FROM t UNION ALL SELECT 'resident_observation_logs', l.id FROM l;
    ELSIF r.tbl = 'incident_root_causes' THEN
      DELETE FROM public.incident_root_causes x USING col849_set s WHERE s.tbl = 'incident_root_causes' AND x.incident_id = s.id;
      INSERT INTO col849_deleted SELECT s.tbl, s.id FROM col849_set s WHERE s.tbl = 'incident_root_causes';
    ELSE
      EXECUTE format('WITH d AS (DELETE FROM public.%I x USING pg_temp.col849_set s WHERE s.tbl = %L AND x.id = s.id RETURNING x.id)
                      INSERT INTO pg_temp.col849_deleted SELECT %L, d.id FROM d', r.tbl, r.tbl, r.tbl);
    END IF;
  END LOOP;

  FOREACH v_guard IN ARRAY c_guards LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
  END LOOP;
  FOREACH v_guard IN ARRAY c_guards LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = format('public.%I', split_part(v_guard, '.', 1))::regclass
                   AND t.tgname = split_part(v_guard, '.', 2) AND t.tgenabled = 'O') THEN
      RAISE EXCEPTION 'Guard trigger % is not enabled after the wipe; rolled back', v_guard;
    END IF;
  END LOOP;
  UPDATE col849_counts c SET deleted = (SELECT count(*) FROM col849_deleted d WHERE d.tbl = c.tbl);

  -- Restore the configuration.
  IF v_old IS NOT NULL THEN
    DELETE FROM public.facility_cadence_windows w
    WHERE w.facility_id = v_fac_id
      AND w.cadence_version_id IN (SELECT v.id FROM public.facility_cadence_versions v
                                   WHERE v.facility_id = v_fac_id AND (v.id IN ((v_meta ->> 'test_version_id')::uuid, (v_meta ->> 'end_version_id')::uuid)
                                                                       OR v.change_reason LIKE c_test_marker || '%'));
    DELETE FROM public.facility_cadence_versions v
    WHERE v.facility_id = v_fac_id AND (v.id IN ((v_meta ->> 'test_version_id')::uuid, (v_meta ->> 'end_version_id')::uuid) OR v.change_reason LIKE c_test_marker || '%');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'test and end cadence versions deleted', v_n::text);

    UPDATE public.facility_cadence_versions v
    SET status = s.status, effective_from = s.effective_from, effective_to = s.effective_to, change_reason = s.change_reason,
        activation_reason = s.activation_reason, apply_mode = s.apply_mode, activated_at = s.activated_at, activated_by = s.activated_by,
        configuration = s.configuration, source_template_id = s.source_template_id, proposal_id = s.proposal_id, deleted_at = s.deleted_at
    FROM jsonb_populate_recordset(NULL::public.facility_cadence_versions, v_old -> 'cadence_versions') s
    WHERE v.id = s.id AND v.facility_id = v_fac_id
      AND (to_jsonb(v) - ARRAY['updated_at', 'updated_by']) IS DISTINCT FROM (to_jsonb(s) - ARRAY['updated_at', 'updated_by']);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'cadence versions set back to the snapshot', v_n::text);

    IF (v_old -> 'template_binding') IS NULL OR jsonb_typeof(v_old -> 'template_binding') = 'null' THEN
      DELETE FROM public.facility_config_template_bindings b WHERE b.facility_id = v_fac_id;
    ELSE
      UPDATE public.facility_config_template_bindings b
      SET cadence_template_id = s.cadence_template_id, escalation_template_id = s.escalation_template_id,
          cadence_bound_at = s.cadence_bound_at, escalation_bound_at = s.escalation_bound_at,
          cadence_detached_at = s.cadence_detached_at, escalation_detached_at = s.escalation_detached_at,
          detach_reason = s.detach_reason, created_at = s.created_at, created_by = s.created_by, deleted_at = s.deleted_at
      FROM jsonb_populate_record(NULL::public.facility_config_template_bindings, v_old -> 'template_binding') s
      WHERE b.id = s.id AND b.facility_id = v_fac_id;
    END IF;
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'template binding', 'set back to the snapshot');

    DELETE FROM public.notification_routes nr
    WHERE nr.organization_id = c_org AND nr.facility_id = v_fac_id
      AND (nr.id = (v_meta ->> 'route_id')::uuid OR nr.name = c_route_name);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'test route deleted', v_n::text);
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY['observation_escalation_deliveries', 'care_event_deliveries', 'watchlist_signal_notifications', 'resident_monitoring_order_notifications'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_col849_test_window_notification_fence ON public.%I', v_tbl);
  END LOOP;
  DROP FUNCTION IF EXISTS haven.col849_test_window_notification_fence();
  INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'delivery fence', 'dropped');

  -- Incident numbers: give back the numbers the test used, unless a kept incident used one.
  SELECT count(*) INTO v_kept_incidents FROM public.incidents i WHERE i.facility_id = v_fac_id AND i.created_at >= c_window_start;
  IF v_old IS NOT NULL AND v_kept_incidents = 0 THEN
    UPDATE public.incident_sequences q SET last_number = s.last_number
    FROM jsonb_populate_recordset(NULL::public.incident_sequences, v_old -> 'incident_sequences') s
    WHERE q.facility_id = v_fac_id AND q.facility_id = s.facility_id AND q.year = s.year AND q.last_number IS DISTINCT FROM s.last_number;
    DELETE FROM public.incident_sequences q
    WHERE q.facility_id = v_fac_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.incident_sequences, v_old -> 'incident_sequences') s WHERE s.year = q.year);
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'incident number counter', 'set back to the snapshot');
  ELSE
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'incident number counter', 'left as it is (' || v_kept_incidents || ' kept Homewood incidents were numbered in the window)');
  END IF;

  -- Timeclock off, every other Homewood timeclock setting back to the snapshot (idle lock,
  -- roster roles, visitor cap, rounding owner rules), lockouts and throttles cleared.
  -- Devices and credentials stay.
  IF v_old IS NOT NULL AND jsonb_typeof(v_old -> 'timeclock_settings') = 'object' THEN
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum), string_agg(format('s.%I', a.attname), ', ' ORDER BY a.attnum) INTO v_tbl, v_trg
    FROM pg_attribute a
    WHERE a.attrelid = 'public.timeclock_facility_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id', 'organization_id', 'facility_id', 'timeclock_enabled', 'updated_at', 'updated_by');
    EXECUTE format('UPDATE public.timeclock_facility_settings t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.timeclock_facility_settings, $1) s)
                    WHERE t.organization_id = $2 AND t.facility_id = $3
                      AND (to_jsonb(t) - ARRAY[''updated_at'', ''updated_by'', ''timeclock_enabled'']) IS DISTINCT FROM $1', v_tbl, v_trg)
    USING v_old -> 'timeclock_settings', c_org, v_fac_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'timeclock settings other than the switch', CASE WHEN v_n = 0 THEN 'already equal to the snapshot' ELSE 'set back to the snapshot' END);
  END IF;
  UPDATE public.timeclock_facility_settings t SET timeclock_enabled = false
  WHERE t.organization_id = c_org AND t.facility_id = v_fac_id AND t.timeclock_enabled;
  UPDATE public.timeclock_credentials c SET failed_attempts = 0, locked_until = NULL
  WHERE c.organization_id = c_org AND (c.failed_attempts <> 0 OR c.locked_until IS NOT NULL)
    AND c.staff_id IN (SELECT s.id FROM public.staff s WHERE s.facility_id = v_fac_id
                       UNION SELECT a.staff_id FROM public.staff_facility_assignments a WHERE a.facility_id = v_fac_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'credentials with PIN failures or a lockout cleared', v_n::text);
  UPDATE public.timeclock_devices d
  SET failure_count = 0, failure_window_started_at = NULL, throttled_until = NULL,
      visitor_failure_count = 0, visitor_failure_window_started_at = NULL, visitor_throttled_until = NULL
  WHERE d.organization_id = c_org AND d.facility_id = v_fac_id
    AND (d.failure_count <> 0 OR d.failure_window_started_at IS NOT NULL OR d.throttled_until IS NOT NULL
         OR d.visitor_failure_count <> 0 OR d.visitor_failure_window_started_at IS NOT NULL OR d.visitor_throttled_until IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col849_report (section, item, detail) VALUES ('restored', 'devices with failure or throttle state cleared', v_n::text);

  -- Verify before the transaction commits.
  SELECT count(*) INTO v_n FROM col849_deleted d
  WHERE (d.tbl = 'incident_root_causes' AND EXISTS (SELECT 1 FROM public.incident_root_causes x WHERE x.incident_id = d.id));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Root causes of test incidents remain; rolled back';
  END IF;
  FOR r IN SELECT c.tbl FROM col849_counts c WHERE c.tbl <> 'incident_root_causes' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x JOIN pg_temp.col849_set s ON s.tbl = %L AND s.id = x.id', r.tbl, r.tbl) INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION '% rows of % survived the delete; rolled back', v_n, r.tbl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM col849_set) <> (SELECT count(*) FROM col849_deleted) THEN
    RAISE EXCEPTION 'Deleted % rows but the sets hold %; rolled back', (SELECT count(*) FROM col849_deleted), (SELECT count(*) FROM col849_set);
  END IF;
  PERFORM pg_temp.col849_collect(c_org, v_fac_id, v_fac_name, c_window_start);
  PERFORM pg_temp.col849_measure(v_fac_id, c_window_start, true);
  FOR r IN SELECT * FROM col849_counts ORDER BY ord LOOP
    IF r.window_rows_after <> 0 THEN
      RAISE EXCEPTION '% window rows are still in %; rolled back', r.window_rows_after, r.tbl;
    END IF;
    IF r.pre_rows_after <> r.pre_rows OR r.pre_hash_after <> r.pre_hash THEN
      RAISE EXCEPTION 'Pre-window rows of % changed (% before, % after); rolled back', r.tbl, r.pre_rows, r.pre_rows_after;
    END IF;
  END LOOP;
  v_current := pg_temp.col849_config(c_org, v_fac_id);
  IF v_old IS NOT NULL THEN
    FOREACH v_key IN ARRAY c_compare LOOP
      IF (v_current -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        RAISE EXCEPTION 'After the wipe % does not equal the snapshot; rolled back', v_key;
      END IF;
    END LOOP;
    IF v_kept_incidents = 0 AND (v_current -> 'incident_sequences') IS DISTINCT FROM (v_old -> 'incident_sequences') THEN
      RAISE EXCEPTION 'The Homewood incident counter does not equal the snapshot; rolled back';
    END IF;
  END IF;
  IF (v_current ->> 'fence_triggers')::integer <> 0 OR (v_current ->> 'fence_function')::boolean THEN
    RAISE EXCEPTION 'The delivery fence is still present; rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timeclock_facility_settings t WHERE t.facility_id = v_fac_id AND t.timeclock_enabled) THEN
    RAISE EXCEPTION 'Timeclock is still on at Homewood; rolled back';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on' AND active$q$ INTO v_n;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'The col695-homewood-timeclock-on job is not scheduled and active; rolled back';
    END IF;
  END IF;
  INSERT INTO col849_report (section, item, detail) VALUES ('applied', 'verified', 'no window rows left; pre-window rows unchanged; guards on; configuration equals the snapshot; cron job untouched');
END
$col849$;

COMMIT;

RESET haven.col849_apply;

-- Verification, recomputed after the commit (in a dry run it shows what is still there).
DO $verify$
DECLARE
  r record;
  v_fac_name text;
BEGIN
  SELECT f.name INTO v_fac_name FROM public.facilities f WHERE f.id = '00000000-0000-0000-0002-000000000003';
  PERFORM pg_temp.col849_collect('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0002-000000000003', v_fac_name, '2026-09-25 20:24:02.307103+00');
  PERFORM pg_temp.col849_measure('00000000-0000-0000-0002-000000000003', '2026-09-25 20:24:02.307103+00', true);
  FOR r IN SELECT * FROM col849_counts ORDER BY ord LOOP
    INSERT INTO col849_report (section, item, detail)
      VALUES ('verification', lpad(r.ord::text, 2, '0') || ' ' || r.tbl,
              'window rows now ' || r.window_rows_after || '; pre-window rows ' || r.pre_rows_after
              || CASE WHEN r.pre_hash_after = r.pre_hash THEN ' (unchanged)' ELSE ' (CHANGED)' END);
  END LOOP;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'verification', 'guard ' || c.relname || '.' || t.tgname, CASE WHEN t.tgenabled = 'O' THEN 'enabled' ELSE 'NOT ENABLED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgname IN ('tr_time_punches_append_only', 'tr_time_punch_corrections_append_only', 'tr_timeclock_sync_rejections_append_only',
    'tr_rounding_logs_immutable', 'tr_rounding_completion_receipts_immutable', 'tr_rounding_task_write_guard', 'tr_floor_unlocks_guard')
  ORDER BY c.relname, t.tgname;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'verification', 'cadence version ' || v.version_number, v.status || ' from ' || v.effective_from::text || coalesce(' to ' || v.effective_to::text, '')
  FROM public.facility_cadence_versions v WHERE v.facility_id = '00000000-0000-0000-0002-000000000003' AND v.deleted_at IS NULL ORDER BY v.version_number;
  INSERT INTO col849_report (section, item, detail)
  SELECT 'verification', 'timeclock_enabled', coalesce((SELECT t.timeclock_enabled::text FROM public.timeclock_facility_settings t
                                                         WHERE t.facility_id = '00000000-0000-0000-0002-000000000003'), 'no settings row');
  INSERT INTO col849_report (section, item, detail)
  SELECT 'verification', 'delivery fence triggers', count(*)::text FROM pg_trigger t WHERE t.tgname = 'tr_col849_test_window_notification_fence';
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR r IN EXECUTE $q$SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'col695-homewood-timeclock-on'$q$ LOOP
      INSERT INTO col849_report (section, item, detail) VALUES ('verification', 'cron ' || r.jobname, r.schedule || CASE WHEN r.active THEN ', active' ELSE ', NOT ACTIVE' END);
    END LOOP;
  END IF;
END
$verify$;

SELECT section, item, detail FROM col849_report ORDER BY seq;
