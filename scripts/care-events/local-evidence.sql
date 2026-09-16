-- 07A "Something happened": local evidence for spec section 9 items 4 to 8.
--
-- Run against the throwaway replay database only (never a hosted project):
--   psql "postgresql://postgres@127.0.0.1:57432/haven" -v ON_ERROR_STOP=1 -f scripts/care-events/local-evidence.sql
--
-- Everything runs inside one transaction that is ROLLED BACK at the end, so
-- the database is left exactly as it was, including the auth.uid() override.
--
-- Caller: the seeded caregiver at Homewood Lodge (user a0000000-...-0004, who
-- holds user_facility_access to Homewood 00000000-0000-0000-0002-000000000003).
-- Resident: the first active Homewood resident with an active care plan, so
-- the care plan review alert path is exercised.

\set ON_ERROR_STOP on
\pset footer off

\set caregiver '''a0000000-0000-0000-0000-000000000004'''
\set facility_admin '''a0000000-0000-0000-0000-000000000002'''
\set family_user '''a0000000-0000-0000-0000-000000000007'''
\set other_facility_user '''a0000000-0000-0000-0000-000000000012'''
\set facility '''00000000-0000-0000-0002-000000000003'''
\set org '''00000000-0000-0000-0000-000000000001'''

BEGIN;

-- The replay stub's auth.uid() returns NULL and haven.current_authorized_actor()
-- (326) reads auth.jwt() claims plus an auth.sessions row. Make auth.uid()
-- read the sub claim, and give each test user a session and a claims payload
-- the same way supabase/tests/review_access_boundaries.sql does.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT NULLIF(COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) ->> 'sub', '')::uuid $$;

CREATE FUNCTION pg_temp.become(p_user uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_session uuid; v_version integer;
BEGIN
  SELECT s.id INTO v_session FROM auth.sessions s WHERE s.user_id = p_user LIMIT 1;
  IF v_session IS NULL THEN
    INSERT INTO auth.sessions (user_id) VALUES (p_user) RETURNING id INTO v_session;
  END IF;
  SELECT auth_claim_version INTO v_version FROM public.user_profiles WHERE id = p_user;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'session_id', v_session, 'role', 'authenticated',
    'auth_claim_version', v_version, 'iat', extract(epoch FROM clock_timestamp())::bigint)::text, true);
  RETURN (SELECT full_name || ' (' || app_role || ')' FROM public.user_profiles WHERE id = p_user);
END $$;

SELECT pg_temp.become(:caregiver) AS acting_as;

\echo
\echo '=== 0. Caller, facility, resident, and pre-conditions'
SELECT up.full_name AS caller, up.app_role, f.name AS facility
FROM public.user_profiles up
JOIN public.user_facility_access ufa ON ufa.user_id = up.id AND ufa.revoked_at IS NULL
JOIN public.facilities f ON f.id = ufa.facility_id
WHERE up.id = :caregiver AND f.id = :facility;

CREATE TEMP TABLE ev_fixture ON COMMIT DROP AS
SELECT r.id AS resident_id, r.last_name || ', ' || r.first_name AS resident
FROM public.residents r
WHERE r.facility_id = :facility AND r.deleted_at IS NULL AND r.status = 'active'
  AND EXISTS (SELECT 1 FROM public.care_plans cp WHERE cp.resident_id = r.id AND cp.status = 'active' AND cp.deleted_at IS NULL)
ORDER BY r.last_name
LIMIT 1;

SELECT resident_id, resident,
  (SELECT count(*) FROM public.resident_watch_instances w WHERE w.resident_id = ev_fixture.resident_id AND w.deleted_at IS NULL AND w.status IN ('active','pending_approval') AND (w.ends_at IS NULL OR w.ends_at > now())) AS active_watches_before,
  (SELECT count(*) FROM public.care_plan_review_alerts a WHERE a.resident_id = ev_fixture.resident_id AND a.deleted_at IS NULL) AS care_plan_alerts_before
FROM ev_fixture;

SELECT name AS watch_protocol, trigger_type, approval_required
FROM public.resident_watch_protocols
WHERE facility_id = :facility AND trigger_type = 'incident_fall' AND active AND deleted_at IS NULL;

SELECT count(*) AS on_call_rows_today
FROM public.on_call_schedules
WHERE facility_id = :facility AND deleted_at IS NULL AND shift_date = (now() AT TIME ZONE 'America/New_York')::date;

\echo
\echo '=== (a) Level 3 fall as caregiver: hurt a_little, head yes, witnessed no, going_out no'
CREATE TEMP TABLE ev_receipt_a ON COMMIT DROP AS
SELECT public.submit_care_event(jsonb_build_object(
  'client_event_id', 'e0000000-0000-0000-0000-00000000000a',
  'facility_id', :facility,
  'resident_id', (SELECT resident_id FROM ev_fixture),
  'kind', 'fall',
  'answers', jsonb_build_object('hurt', 'a_little', 'head', 'yes', 'witnessed', 'no', 'going_out', 'no'),
  'note', 'Found by the bed, helped up with two staff.',
  'location_code', 'resident_room',
  'captured_offline', false
)) AS receipt;

SELECT jsonb_pretty(receipt) AS receipt FROM ev_receipt_a;

\echo '--- care_events row'
SELECT kind, derived_level, final_level, category, status, shift, location_code, sentence, flags
FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a';

\echo '--- incidents row (count and key columns)'
SELECT count(*) AS incident_count FROM public.incidents i
WHERE i.id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a');
SELECT i.incident_number, i.category, i.severity, i.fall_witnessed, i.injury_occurred, i.injury_severity, i.location_description, i.immediate_actions, i.ahca_reportable, i.insurance_reportable, i.description
FROM public.incidents i
WHERE i.id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a');

\echo '--- incident_followups rows (task_type, due offset, assigned)'
SELECT f.task_type, round(extract(epoch FROM (f.due_at - i.occurred_at)) / 60) AS due_minutes, f.assigned_to IS NOT NULL AS assigned, f.description
FROM public.incident_followups f
JOIN public.incidents i ON i.id = f.incident_id
WHERE i.id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a')
ORDER BY f.due_at, f.task_type;

\echo '--- resident_watch_instances created by the incidents trigger'
SELECT count(*) AS watch_instances_from_incident, min(status::text) AS status
FROM public.resident_watch_instances w
WHERE w.triggered_by_id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a');

\echo '--- care_plan_review_alerts for the resident (trigger_source_id = the incident)'
SELECT count(*) AS care_plan_alerts_from_incident, min(trigger_type) AS trigger_type
FROM public.care_plan_review_alerts a
WHERE a.trigger_source_id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a');

\echo '--- exec_alerts row'
SELECT source_module, severity, title, body, category, status, deep_link_path
FROM public.exec_alerts
WHERE deep_link_path = '/admin/care-events/' || (SELECT id::text FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a');

\echo '--- care_event_deliveries by step, channel and status'
SELECT d.escalation_step, d.target_role, d.channel, d.status, d.skip_reason, count(*) AS rows
FROM public.care_event_deliveries d
WHERE d.care_event_id = (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a')
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 3, 4;

\echo
\echo '=== (b) Level 4 wandering not_found: AHCA obligations and flag'
SELECT jsonb_pretty(public.submit_care_event(jsonb_build_object(
  'client_event_id', 'e0000000-0000-0000-0000-00000000000b',
  'facility_id', :facility,
  'resident_id', (SELECT resident_id FROM ev_fixture),
  'kind', 'wandering',
  'answers', jsonb_build_object('where', 'not_found', 'hurt', 'no'),
  'occurred_at', now()
)) - 'deliveries') AS receipt_b;

SELECT ce.final_level, ce.category, ce.flags ->> 'ahca_reportable' AS ahca_reportable, ce.flags ->> 'call_911_prompt' AS call_911_prompt
FROM public.care_events ce WHERE ce.client_event_id = 'e0000000-0000-0000-0000-00000000000b';

SELECT o.jurisdiction, o.authority, o.due_at, o.due_at AT TIME ZONE 'America/New_York' AS due_local,
  round(extract(epoch FROM (o.due_at - i.occurred_at)) / 86400, 2) AS days_after_event
FROM public.regulatory_reporting_obligations o
JOIN public.incidents i ON i.id = o.incident_id
WHERE o.incident_id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b')
ORDER BY o.due_at;

SELECT i.elopement_last_seen_at IS NOT NULL AS last_seen_set, i.elopement_found_at, i.elopement_outcome, i.immediate_actions
FROM public.incidents i
WHERE i.id = (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b');

\echo
\echo '=== (c) Replay of the Level 3 fall with the same client_event_id'
SELECT
  (public.submit_care_event(jsonb_build_object(
    'client_event_id', 'e0000000-0000-0000-0000-00000000000a',
    'facility_id', :facility,
    'resident_id', (SELECT resident_id FROM ev_fixture),
    'kind', 'fall',
    'answers', jsonb_build_object('hurt', 'a_little', 'head', 'yes', 'witnessed', 'no', 'going_out', 'no')
  )) ->> 'care_event_id')::uuid = (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a) AS same_care_event_id,
  (public.submit_care_event(jsonb_build_object(
    'client_event_id', 'e0000000-0000-0000-0000-00000000000a',
    'facility_id', :facility,
    'resident_id', (SELECT resident_id FROM ev_fixture),
    'kind', 'fall',
    'answers', jsonb_build_object('hurt', 'a_little', 'head', 'yes', 'witnessed', 'no', 'going_out', 'no')
  )) ->> 'replayed')::boolean AS replayed,
  (SELECT count(*) FROM public.incidents i
     WHERE i.id IN (SELECT incident_id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a')) AS incidents_for_client_event,
  (SELECT count(*) FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000a') AS care_events_for_client_event;

\echo
\echo '=== (d) acknowledge_care_event as facility_admin'
SELECT pg_temp.become(:facility_admin) AS acting_as;

SELECT public.acknowledge_care_event((SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a));

SELECT ce.status, ce.acknowledged_by = :facility_admin::uuid AS acknowledged_by_caller, ce.acknowledged_at IS NOT NULL AS acknowledged_at_set,
  i.administrator_notified, i.administrator_notified_at, i.nurse_notified
FROM public.care_events ce
JOIN public.incidents i ON i.id = ce.incident_id
WHERE ce.client_event_id = 'e0000000-0000-0000-0000-00000000000a';

SELECT d.escalation_step, d.channel, d.status, d.skip_reason, d.target_user_id = :facility_admin::uuid AS is_caller
FROM public.care_event_deliveries d
WHERE d.care_event_id = (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a)
ORDER BY d.escalation_step, d.channel, d.status;

SELECT acknowledged_at IS NOT NULL AS exec_alert_acknowledged
FROM public.exec_alerts
WHERE deep_link_path = '/admin/care-events/' || (SELECT receipt ->> 'care_event_id' FROM ev_receipt_a);

\echo '--- escalation tick after acknowledgment inserts nothing for the acknowledged event'
SELECT public.care_event_escalation_tick() AS rows_inserted_by_tick;

\echo
\echo '=== (e) Clock-advanced escalation: fresh unacknowledged Level 3 (medication wrong) at 11 minutes'
SELECT pg_temp.become(:caregiver) AS acting_as;
CREATE TEMP TABLE ev_receipt_e ON COMMIT DROP AS
SELECT public.submit_care_event(jsonb_build_object(
  'client_event_id', 'e0000000-0000-0000-0000-00000000000e',
  'facility_id', :facility,
  'resident_id', (SELECT resident_id FROM ev_fixture),
  'kind', 'medication',
  'answers', jsonb_build_object('what', 'wrong', 'reaction', 'no')
)) AS receipt;
SELECT receipt ->> 'level' AS level, receipt ->> 'incident_number' AS incident_number FROM ev_receipt_e;

-- Definer functions read created_at; move it back 11 minutes (the guard
-- trigger is bypassed for this transaction the same way the definers do it).
SELECT set_config('haven.care_event_definer', '1', true);
UPDATE public.care_events SET created_at = now() - interval '11 minutes'
WHERE id = (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_e);

SELECT public.care_event_escalation_tick() AS rows_inserted_by_tick_at_11_minutes;

SELECT d.escalation_step, d.target_role, d.channel, d.status, d.skip_reason, count(*) AS rows
FROM public.care_event_deliveries d
WHERE d.care_event_id = (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_e)
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 3;

\echo '--- second tick at the same clock inserts nothing (step 2 already present, step 3 not due until 20 minutes)'
SELECT public.care_event_escalation_tick() AS rows_inserted_by_second_tick;

\echo '--- Level 4 repeat steps: the wandering event at 6 minutes gets steps 4 and 5; six minutes later they repeat'
UPDATE public.care_events SET created_at = now() - interval '6 minutes'
WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b';
SELECT public.care_event_escalation_tick() AS rows_inserted_for_level_4_at_6_minutes;
SELECT d.escalation_step, d.target_role, d.channel, d.status, count(*) AS rows
FROM public.care_event_deliveries d
WHERE d.care_event_id = (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b')
  AND d.escalation_step >= 4
GROUP BY 1, 2, 3, 4 ORDER BY 1, 3;
UPDATE public.care_event_deliveries SET created_at = created_at - interval '6 minutes'
WHERE care_event_id = (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b')
  AND escalation_step >= 4;
SELECT public.care_event_escalation_tick() AS rows_inserted_by_repeat_tick;
SELECT d.escalation_step, count(*) AS rows_after_repeat
FROM public.care_event_deliveries d
WHERE d.care_event_id = (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b')
  AND d.escalation_step >= 4
GROUP BY 1 ORDER BY 1;

\echo
\echo '=== (g) RLS: family cannot select; a user without Homewood access sees nothing; caregiver cannot change final_level'
GRANT USAGE ON SCHEMA public TO authenticated;
SELECT pg_temp.become(:family_user) AS acting_as;
SET LOCAL ROLE authenticated;
SELECT count(*) AS care_events_visible_to_family FROM public.care_events;
RESET ROLE;

SELECT pg_temp.become(:other_facility_user) AS acting_as;
SELECT up.app_role, string_agg(f.name, ', ') AS facilities
FROM public.user_profiles up
LEFT JOIN public.user_facility_access ufa ON ufa.user_id = up.id AND ufa.revoked_at IS NULL
LEFT JOIN public.facilities f ON f.id = ufa.facility_id
WHERE up.id = :other_facility_user GROUP BY 1;
SET LOCAL ROLE authenticated;
SELECT count(*) AS homewood_care_events_visible_to_oakridge_only_user FROM public.care_events WHERE facility_id = :facility;
RESET ROLE;

SELECT pg_temp.become(:caregiver) AS acting_as;
SELECT set_config('haven.care_event_definer', '', true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS own_events_visible_to_caregiver FROM public.care_events WHERE reported_by = :caregiver::uuid;
DO $$
BEGIN
  UPDATE public.care_events SET final_level = 'level_1'
  WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000e';
  RAISE EXCEPTION 'caregiver was able to change final_level';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'caregiver final_level update refused: %', SQLERRM;
END $$;
UPDATE public.care_events SET note = 'Reporter note edit within 24 hours.'
WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000e';
SELECT note AS note_after_reporter_edit FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000e';
RESET ROLE;

\echo
\echo '=== (h) Administrator completion form: gate, lower level, close'
SELECT pg_temp.become(:facility_admin) AS acting_as;
SELECT jsonb_pretty(public.complete_care_event_admin_section(
  (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a), '{}'::jsonb)) AS gate_before;
SELECT jsonb_pretty(public.complete_care_event_admin_section(
  (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a),
  jsonb_build_object(
    'family_notified', jsonb_build_object('now', true, 'method', 'phone'),
    'physician_notified', jsonb_build_object('now', false),
    'ahca', jsonb_build_object('reportable', false, 'reason_code', NULL),
    'corrective_actions', jsonb_build_object('chips', jsonb_build_array('care_plan_review', 'increased_checks'), 'other', NULL)
  ))) AS gate_after_section_2_and_4;
SELECT jsonb_pretty(public.complete_care_event_admin_section(
  (SELECT (receipt ->> 'care_event_id')::uuid FROM ev_receipt_a),
  jsonb_build_object('close', true))) AS closed;
SELECT ce.status, ce.closed_by IS NOT NULL AS closed_by_set, ce.answers -> 'admin' AS admin_answers, ce.answers ->> 'hurt' AS caregiver_answer_kept,
  i.status AS incident_status, i.family_notified, i.family_notified_method, i.resolution_notes, i.care_plan_updated
FROM public.care_events ce JOIN public.incidents i ON i.id = ce.incident_id
WHERE ce.client_event_id = 'e0000000-0000-0000-0000-00000000000a';

\echo '--- Level 4 wandering: close refused while the gate is open; lower the level with a reason'
DO $$
DECLARE v_id uuid := (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b');
BEGIN
  PERFORM public.complete_care_event_admin_section(v_id, '{"close": true}'::jsonb);
  RAISE EXCEPTION 'close accepted with an open gate';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'care_event: close gate: %' THEN RAISE; END IF;
  RAISE NOTICE 'close refused: %', SQLERRM;
END $$;
DO $$
DECLARE v_id uuid := (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b');
BEGIN
  PERFORM public.complete_care_event_admin_section(v_id, '{"lower_level": {"level": 3, "reason": ""}}'::jsonb);
  RAISE EXCEPTION 'lower_level accepted without a reason';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'care_event: a reason is required%' THEN RAISE; END IF;
  RAISE NOTICE 'lower without reason refused: %', SQLERRM;
END $$;
SELECT jsonb_pretty(public.complete_care_event_admin_section(
  (SELECT id FROM public.care_events WHERE client_event_id = 'e0000000-0000-0000-0000-00000000000b'),
  '{"lower_level": {"level": 3, "reason": "Resident located on the grounds within minutes"}}'::jsonb)) AS lowered;
SELECT ce.derived_level AS original_level_kept, ce.final_level, ce.level_changed_by IS NOT NULL AS changed_by_set, ce.level_change_reason, i.severity AS incident_severity
FROM public.care_events ce JOIN public.incidents i ON i.id = ce.incident_id
WHERE ce.client_event_id = 'e0000000-0000-0000-0000-00000000000b';

\echo
\echo '=== (f) v_incident_reports_log for the facility (5 rows) and v_resident_timeline for the resident (10 rows)'
SELECT log_date, room, resident, fall, bruise, scrapes_or_burn, cut_laceration_puncture, non_apparent, other, shift, severity, category
FROM public.v_incident_reports_log
WHERE facility_id = :facility
ORDER BY occurred_at DESC
LIMIT 5;

SELECT source, title, level, left(detail, 60) AS detail
FROM public.v_resident_timeline
WHERE resident_id = (SELECT resident_id FROM ev_fixture)
ORDER BY occurred_at DESC
LIMIT 10;

\echo
\echo '=== ROLLBACK: nothing above is kept'
ROLLBACK;
