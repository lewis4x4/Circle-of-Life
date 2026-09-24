-- Homewood Lodge: clear Smart Rounding checks and escalations from before go-live.
--
-- Spec: docs/specs/40-floor-tablet-and-kiosk.md section 9, item 2 (COL-677, run for COL-695).
-- Who runs it: Brian, by hand, against production. The build never runs it.
-- Run it after homewood-pause-cadence.sql, and once more on the morning of Oct 1
-- before the day shift starts to clear anything that came due in between.
--
-- Go-live is the Homewood day shift start on 2026-10-01 (the day shift's start time
-- from the facility's shift definitions, America/New_York). Before go-live nobody
-- was rounding on the floor with Haven, so the misses and escalations are not real.
--
-- What it changes, using the vocabulary the product already uses:
--   Checks: every Homewood check due before go-live that is missed or not yet
--     completed (upcoming, due soon, due now, overdue, critically overdue, escalated,
--     missed) becomes `excused`, with excused_reason starting "before go-live" (the
--     same status and field stand_down_ungenerated_observation_tasks and
--     cancel_monitoring_order use). Completed and reassigned checks are never touched.
--   Escalations: every open or in-progress escalation on those checks is closed the way
--     the Dismiss action in /api/rounding/escalations/[id] closes one: status
--     `dismissed`, acknowledged_at kept or set, resolved_at set, resolution_note
--     starting "before go-live". The status vocabulary is an enum (open, in_progress,
--     resolved, dismissed) and `resolved` needs a clinical rationale, so `dismissed`
--     is the closest allowed value and the reason goes in the note.
--   Deliveries: escalation texts and pushes still queued for those checks are marked
--     `skipped` with skip_reason `before_go_live`, so nobody is paged after the fact.
--     Deliveries already mid-send are left to finish.
--   Executive alerts: the open "observation window at Homewood" alerts raised by the
--     last escalation rung are resolved (resolved_at and status `resolved`, as
--     migration 231 did), so the first real miss after go-live raises a fresh one.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/homewood-clear-pre-go-live.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col695_apply = 'homewood-clear-pre-go-live';"; cat scripts/floor/homewood-clear-pre-go-live.sql; } > /tmp/col695-clear-pre-go-live-apply.sql
--     supabase db query --linked -f /tmp/col695-clear-pre-go-live-apply.sql
--
-- Plain SQL on purpose: `supabase db query` sends the file through the Management API,
-- which does not run psql meta-commands such as \if. `--db-url` is not a substitute: it
-- refuses a file with more than one statement; for a rehearsal use `psql -f` on a scratch
-- database. The apply switch is a session setting whose value must name this script.
-- The final statement is the report.
--
-- Safe to run twice: everything it changes leaves the set it selects from, so a second
-- run finds nothing to do. Everything is scoped to one facility, found by name inside
-- the Circle of Life organization and checked against the Homewood id the repository
-- already uses; zero or several matches stop the script. The report prints ids and
-- counts, never resident names.

DROP TABLE IF EXISTS pg_temp.col695_report;
CREATE TEMP TABLE col695_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

BEGIN;

DO $col695$
DECLARE
  c_script CONSTANT text := 'homewood-clear-pre-go-live';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  c_go_live_date CONSTANT date := DATE '2026-10-01';
  c_sample CONSTANT integer := 25;
  v_apply boolean := coalesce(current_setting('haven.col695_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_fac_id uuid;
  v_fac_name text;
  v_tz text;
  v_day_start time;
  v_go_live timestamptz;
  v_reason text;
  v_alert_title_suffix text;
  r record;
BEGIN
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

  SELECT count(*) INTO v_n FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active day shift at Homewood, found %', v_n;
  END IF;
  SELECT s.starts_at_local INTO STRICT v_day_start FROM public.facility_shift_definitions s
  WHERE s.facility_id = v_fac_id AND s.deleted_at IS NULL AND s.active AND s.roster_shift_type = 'day';
  v_go_live := (c_go_live_date + v_day_start) AT TIME ZONE v_tz;
  v_reason := 'before go-live: Smart Rounding was not in use on the Homewood floor before the '
    || to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' day shift start (COL-695).';
  v_alert_title_suffix := ': observation window at ' || v_fac_name;

  -- The sets this script changes.
  CREATE TEMP TABLE col695_tasks ON COMMIT DROP AS
  SELECT t.id, t.status::text AS status, t.due_at, (t.monitoring_order_id IS NOT NULL) AS monitoring_order
  FROM public.resident_observation_tasks t
  WHERE t.facility_id = v_fac_id AND t.deleted_at IS NULL AND t.due_at < v_go_live
    AND t.status IN ('upcoming', 'due_soon', 'due_now', 'overdue', 'critically_overdue', 'escalated', 'missed');

  CREATE TEMP TABLE col695_escalations ON COMMIT DROP AS
  SELECT e.id, e.status::text AS status, e.triggered_at
  FROM public.resident_observation_escalations e
  JOIN public.resident_observation_tasks t ON t.id = e.task_id
  WHERE e.facility_id = v_fac_id AND e.deleted_at IS NULL AND e.status IN ('open', 'in_progress')
    AND t.facility_id = v_fac_id AND t.due_at < v_go_live;

  CREATE TEMP TABLE col695_deliveries ON COMMIT DROP AS
  SELECT dl.id, dl.channel
  FROM public.observation_escalation_deliveries dl
  JOIN public.observation_escalation_dispatches d ON d.id = dl.dispatch_id
  JOIN public.resident_observation_tasks t ON t.id = d.task_id
  WHERE dl.facility_id = v_fac_id AND d.facility_id = v_fac_id AND NOT dl.is_test
    AND dl.status = 'queued' AND t.due_at < v_go_live;

  CREATE TEMP TABLE col695_alerts ON COMMIT DROP AS
  SELECT a.id, a.title
  FROM public.exec_alerts a
  WHERE a.facility_id = v_fac_id AND a.deleted_at IS NULL AND a.resolved_at IS NULL
    AND a.source_module = 'compliance' AND a.first_triggered_at < v_go_live
    AND right(a.title, length(v_alert_title_suffix)) = v_alert_title_suffix;

  INSERT INTO col695_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'id', v_fac_id::text),
    ('go-live', 'instant', to_char(v_go_live AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') || ' local, ' || v_go_live::text),
    ('now', 'instant', v_now::text),
    ('checks to excuse', 'total', (SELECT count(*) FROM col695_tasks)::text),
    ('checks to excuse', 'due range', coalesce((SELECT min(due_at)::text || ' to ' || max(due_at)::text FROM col695_tasks), 'none'));
  FOR r IN SELECT status, monitoring_order, due_at < v_now AS past_due, count(*) AS n FROM col695_tasks
           GROUP BY 1, 2, 3 ORDER BY 3 DESC, 1, 2 LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES ('checks to excuse', r.status || CASE WHEN r.monitoring_order THEN ' (monitoring order)' ELSE ' (cadence)' END
              || CASE WHEN r.past_due THEN ', due before now' ELSE ', due between now and go-live' END, r.n::text);
  END LOOP;
  INSERT INTO col695_report (section, item, detail)
    SELECT 'checks to excuse', 'sample ids', string_agg(id::text, ' ') FROM (SELECT id FROM col695_tasks ORDER BY due_at, id LIMIT c_sample) s
    HAVING count(*) > 0;

  INSERT INTO col695_report (section, item, detail)
    VALUES ('escalations to close', 'total', (SELECT count(*) FROM col695_escalations)::text);
  FOR r IN SELECT status, count(*) AS n, min(triggered_at) AS first_at, max(triggered_at) AS last_at FROM col695_escalations GROUP BY 1 ORDER BY 1 LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES ('escalations to close', r.status, r.n || ', triggered ' || r.first_at::text || ' to ' || r.last_at::text);
  END LOOP;
  INSERT INTO col695_report (section, item, detail)
    SELECT 'escalations to close', 'sample ids', string_agg(id::text, ' ') FROM (SELECT id FROM col695_escalations ORDER BY triggered_at, id LIMIT c_sample) s
    HAVING count(*) > 0;

  INSERT INTO col695_report (section, item, detail)
    VALUES ('queued deliveries to skip', 'total', (SELECT count(*) FROM col695_deliveries)::text);
  FOR r IN SELECT channel, count(*) AS n FROM col695_deliveries GROUP BY 1 ORDER BY 1 LOOP
    INSERT INTO col695_report (section, item, detail) VALUES ('queued deliveries to skip', r.channel, r.n::text);
  END LOOP;

  INSERT INTO col695_report (section, item, detail)
    VALUES ('executive alerts to resolve', 'total', (SELECT count(*) FROM col695_alerts)::text);
  INSERT INTO col695_report (section, item, detail)
    SELECT 'executive alerts to resolve', id::text, NULL FROM col695_alerts ORDER BY id;

  IF NOT v_apply THEN
    RETURN;
  END IF;

  UPDATE public.resident_observation_tasks t
  SET status = 'excused', excused_reason = v_reason, updated_at = v_now
  FROM col695_tasks c
  WHERE t.id = c.id AND t.facility_id = v_fac_id
    AND t.status IN ('upcoming', 'due_soon', 'due_now', 'overdue', 'critically_overdue', 'escalated', 'missed');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'checks excused', v_n::text);

  UPDATE public.resident_observation_escalations e
  SET status = 'dismissed', acknowledged_at = coalesce(e.acknowledged_at, v_now), resolved_at = v_now,
      resolution_note = v_reason, updated_at = v_now
  FROM col695_escalations c
  WHERE e.id = c.id AND e.facility_id = v_fac_id AND e.status IN ('open', 'in_progress');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'escalations dismissed', v_n::text);

  UPDATE public.observation_escalation_deliveries dl
  SET status = 'skipped', skip_reason = 'before_go_live', claim_token = NULL, updated_at = v_now
  FROM col695_deliveries c
  WHERE dl.id = c.id AND dl.facility_id = v_fac_id AND dl.status = 'queued';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'queued deliveries skipped', v_n::text);

  UPDATE public.exec_alerts a
  SET resolved_at = v_now, status = 'resolved', updated_at = v_now
  FROM col695_alerts c
  WHERE a.id = c.id AND a.facility_id = v_fac_id AND a.resolved_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'executive alerts resolved', v_n::text);

  -- Check the result before the transaction commits.
  IF EXISTS (SELECT 1 FROM public.resident_observation_tasks t
             WHERE t.facility_id = v_fac_id AND t.deleted_at IS NULL AND t.due_at < v_go_live
               AND t.status IN ('upcoming', 'due_soon', 'due_now', 'overdue', 'critically_overdue', 'escalated', 'missed')) THEN
    RAISE EXCEPTION 'Homewood checks due before go-live are still open or missed; rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resident_observation_escalations e
             JOIN public.resident_observation_tasks t ON t.id = e.task_id
             WHERE e.facility_id = v_fac_id AND e.deleted_at IS NULL AND e.status IN ('open', 'in_progress') AND t.due_at < v_go_live) THEN
    RAISE EXCEPTION 'Homewood escalations from before go-live are still open; rolled back';
  END IF;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'verified', 'nothing from before go-live is left open at Homewood');
END
$col695$;

COMMIT;

RESET haven.col695_apply;

SELECT section, item, detail FROM col695_report ORDER BY seq;
