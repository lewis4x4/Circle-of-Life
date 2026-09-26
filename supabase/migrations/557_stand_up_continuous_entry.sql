-- COL-427: entry is always available for the next occurrence of each meeting.
-- Each report closes for ordinary entry at its own scheduled call, at which
-- point the next report opens. Existing immutable call revisions and reasoned
-- historical corrections remain separate from the live entry period.
-- Retain legacy lead settings for wire compatibility; they no longer gate entry.
BEGIN;

CREATE OR REPLACE FUNCTION haven.stand_up_entry_opens_at(p_facility_id uuid, p_meeting_monday date)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT ((p_meeting_monday - 7) + t.call_local) AT TIME ZONE t.time_zone
 FROM haven.stand_up_monday_times(NULL, p_facility_id) t
$$;
COMMENT ON FUNCTION haven.stand_up_entry_opens_at(uuid,date) IS
 'COL-427: a Monday report opens at the previous Monday call. At the scheduled call ordinary entry moves to the next report, while immutable as-of-call history and audited corrections remain available. Legacy entry lead settings no longer restrict entry.';

CREATE OR REPLACE FUNCTION haven.stand_up_meeting_opens_at(p_organization uuid,p_facility uuid,p_day text,p_week date)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE me public.stand_up_meeting_schedule;
BEGIN
 me:=haven.stand_up_meeting_schedule_row(p_organization,p_facility,p_day);
 IF me.id IS NULL OR NOT me.active OR p_week IS NULL THEN RETURN NULL; END IF;
 RETURN haven.stand_up_meeting_instant(p_week-7,me.weekday,me.call_local,me.time_zone);
END $$;
COMMENT ON FUNCTION haven.stand_up_meeting_opens_at(uuid,uuid,text,date) IS
 'COL-427: each scheduled meeting report opens at the preceding occurrence of that same meeting, respecting facility schedule overrides and local time. No gap in entry, and Thursday ordinary entry rolls over at Thursday call rather than the next Monday call.';

-- Keep the workbook/reporting week separate from the next editable meeting.
-- The Google connector validates this calendar scope, and must not start
-- importing this week's workbook into next Monday's newly opened draft.
CREATE FUNCTION haven.stand_up_reporting_week(p_now timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT date_trunc('week',(p_now AT TIME ZONE 'America/New_York')+interval '1 day')::date
$$;
REVOKE ALL ON FUNCTION haven.stand_up_reporting_week(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION haven.stand_up_week() RETURNS date
LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT haven.stand_up_reporting_week(clock_timestamp()) $$;
COMMENT ON FUNCTION haven.stand_up_week() IS
 'COL-427: calendar reporting/workbook week, Sunday through Saturday. Continuous entry uses stand_up_open_week instead; preserving this scope keeps existing Google bridge and publisher validation unchanged.';

-- Migration 525's workspace wrapper, returning the editable period explicitly.
-- All command routing, authority checks and metadata are unchanged.
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb; organization uuid;
BEGIN
 -- COL-752: the meeting schedule, and every meeting other than Monday, have
 -- their own command. A payload naming Monday runs the Monday path unchanged,
 -- with the key removed so receipts and results are exactly what they were.
 IF p_action='set_meeting_schedule' THEN RETURN haven.stand_up_set_meeting_schedule(p_payload); END IF;
 IF p_payload ? 'meeting_day' THEN
  IF p_payload->>'meeting_day' IS DISTINCT FROM 'monday' THEN RETURN haven.stand_up_meeting_command(p_action,p_payload); END IF;
  p_payload:=p_payload-'meeting_day';
 END IF;
 IF p_action='prefill' THEN RETURN haven.stand_up_prefill_for(p_payload); END IF;
 IF p_action='submitted_latest' THEN RETURN haven.stand_up_submitted_latest(p_payload); END IF;
 IF p_action='set_entry_window' THEN RETURN haven.stand_up_set_entry_window(p_payload); END IF;
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 IF p_action='post_submit_changes' THEN RETURN haven.stand_up_post_submit_history(p_payload); END IF;
 IF p_action='roster' THEN RETURN haven.stand_up_roster_suggestion(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  organization:=haven.organization_id();
  SELECT coalesce(jsonb_agg(x||haven.stand_up_submission_metadata((x->>'revision_id')::uuid)
    ||jsonb_build_object('prefill_confirmations',haven.stand_up_prefill_confirmations((x->>'revision_id')::uuid)) ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  SELECT coalesce(jsonb_agg(y||jsonb_build_object(
    'entry_open_lead_minutes',(SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s WHERE s.facility_id=(y->>'id')::uuid),
    'open_week',haven.stand_up_open_week((y->>'id')::uuid),
    'entry_opens_at',haven.stand_up_entry_opens_at((y->>'id')::uuid,haven.stand_up_open_week((y->>'id')::uuid))
   ) ORDER BY y->>'name'),'[]') INTO facilities FROM jsonb_array_elements(result->'facilities') y;
  RETURN result||jsonb_build_object(
   'current_week',haven.stand_up_open_week(NULL),
   'reports',reports,
   'facilities',facilities,
   'server_now',clock_timestamp(),
   'actor_role',haven.app_role()::text,
   'can_edit_submitted',haven.app_role()::text IN('owner','org_admin','facility_admin'),
   'google_connection',haven.stand_up_google_health(organization),
   -- COL-805: Monday's entry-due and call times, as the screens state them.
   'schedule',haven.stand_up_meeting_schedule_json(organization,NULL)
  );
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||haven.stand_up_submission_metadata((result->>'revision_id')::uuid)
   ||jsonb_build_object('prefill_confirmations',haven.stand_up_prefill_confirmations((result->>'revision_id')::uuid));
 END IF;
 RETURN result;
END $$;

-- CREATE OR REPLACE preserves the existing private helper grants. No actor,
-- authorization, revision, receipt, save validation or export policy changes.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore stand_up_entry_opens_at from migration 525 and
-- stand_up_meeting_opens_at from migration 517, stand_up_week from migration
-- 405, and stand_up_command from migration 525; then drop the private
-- stand_up_reporting_week(timestamptz) helper. No report/history data changes.
