-- COL-805 (follow-up of COL-752, part of COL-749): Monday reads its times from
-- the meeting schedule.
--
-- COL-752 moved every Thursday time into public.stand_up_meeting_schedule and
-- left Monday's own 08:45 entry deadline and 09:15 call in three functions and
-- the history publisher, so that Monday publishing stayed byte-identical. Now:
--
--   * haven.stand_up_monday_times(org, facility): the organization's Monday row
--     (entry due, call, time zone). The facility's organization is used, else
--     the caller's, else the one organization that has a Monday row. With no row
--     at all it answers the seeded values (08:45, 09:15, America/New_York), the
--     same built-in default the operating-rules resolver keeps for its keys.
--   * haven.stand_up_entry_opens_at: the lead is counted back from Monday's
--     scheduled entry deadline instead of a fixed 08:45.
--   * haven.stand_up_export_history: the "as of the call" snapshot uses Monday's
--     scheduled call instead of a fixed 09:15, and the archive states that call
--     (monday_call_local) so the history publisher checks against the same time.
--     With the schedule unchanged every snapshot is exactly what it was;
--     supabase/tests/review_stand_up_monday_schedule.sql compares it with
--     migration 337's query.
--   * stand_up_command('set_meeting_schedule') accepts Monday, for the whole
--     organization only and on Monday only.
--   * The Monday workspace returns the schedule, so the screens say the
--     scheduled times instead of their own.
--
-- The published rows themselves are unchanged: nothing here adds or changes a
-- figure, a revision or a Front Office row.
BEGIN;

CREATE FUNCTION haven.stand_up_monday_times(p_organization uuid, p_facility uuid)
RETURNS TABLE(entry_due_local time, call_local time, time_zone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH org AS (
    SELECT coalesce(
      p_organization,
      (SELECT f.organization_id FROM public.facilities f WHERE f.id = p_facility),
      haven.organization_id(),
      (SELECT min(s.organization_id::text)::uuid FROM public.stand_up_meeting_schedule s
        WHERE s.meeting_day = 'monday' AND s.facility_id IS NULL
        HAVING count(DISTINCT s.organization_id) = 1)) AS id
  )
  SELECT coalesce(s.entry_due_local, time '08:45'), coalesce(s.call_local, time '09:15'), coalesce(s.time_zone, 'America/New_York')
  FROM org
  LEFT JOIN public.stand_up_meeting_schedule s ON s.organization_id = org.id AND s.meeting_day = 'monday' AND s.facility_id IS NULL AND s.active
$$;
REVOKE ALL ON FUNCTION haven.stand_up_monday_times(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_monday_times(uuid, uuid) IS
  'COL-805: the Monday Stand Up entry-due time, call time and time zone from public.stand_up_meeting_schedule (organization row). Falls back to the seeded 08:45 / 09:15 / America/New_York only when no Monday row exists.';

CREATE FUNCTION haven.stand_up_monday_call_at(p_organization uuid, p_week date)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT (p_week + t.call_local) AT TIME ZONE t.time_zone FROM haven.stand_up_monday_times(p_organization, NULL) t
$$;
REVOKE ALL ON FUNCTION haven.stand_up_monday_call_at(uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- Migration 405's text with the scheduled deadline in place of 08:45.
CREATE OR REPLACE FUNCTION haven.stand_up_entry_opens_at(p_facility_id uuid, p_meeting_monday date)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT ((p_meeting_monday + t.entry_due_local)
   - make_interval(mins => haven.stand_up_entry_open_lead_minutes(p_facility_id)))
   AT TIME ZONE t.time_zone
 FROM haven.stand_up_monday_times(NULL, p_facility_id) t
$function$;

-- Migration 337's text with the scheduled call in place of 09:15.
CREATE OR REPLACE FUNCTION haven.stand_up_export_history(p_organization_id uuid, p_from_week date, p_to_week date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; seq bigint; generated timestamptz;
BEGIN
 IF p_organization_id IS NULL OR p_from_week IS NULL OR p_to_week IS NULL OR extract(isodow FROM p_from_week)<>1 OR extract(isodow FROM p_to_week)<>1 OR p_to_week<p_from_week OR p_to_week-p_from_week>721 THEN
  RAISE EXCEPTION 'History export requires a Monday range of at most 104 weeks';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN RAISE EXCEPTION 'Unknown organization'; END IF;
 -- Serialize with the existing organization save lock: one archive timestamp and
 -- one consistent committed revision set, including backdated corrections.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('stand_up_org:'||p_organization_id::text,0));
 generated:=clock_timestamp();
 WITH eligible AS (
  SELECT r.* FROM public.stand_up_reports r JOIN public.facilities f ON f.id=r.facility_id
  WHERE r.organization_id=p_organization_id AND f.deleted_at IS NULL AND r.week_start BETWEEN p_from_week AND p_to_week
 ), candidates AS (
  SELECT r.week_start,r.facility_id,0 kind,v.id revision_id,v.values FROM eligible r JOIN public.stand_up_revisions v ON v.id=r.revision_id
  UNION ALL
  SELECT r.week_start,r.facility_id,1 kind,v.id,v.values FROM eligible r JOIN LATERAL (
   SELECT s.* FROM public.stand_up_revisions s WHERE s.report_id=r.id AND s.status='ready' ORDER BY s.version DESC LIMIT 1
  ) v ON true
  UNION ALL
  SELECT r.week_start,r.facility_id,2 kind,v.id,v.values FROM eligible r JOIN LATERAL (
   SELECT s.* FROM public.stand_up_revisions s WHERE s.report_id=r.id
    AND generated >= haven.stand_up_monday_call_at(p_organization_id,r.week_start)
    AND s.created_at <= haven.stand_up_monday_call_at(p_organization_id,r.week_start)
   ORDER BY s.created_at DESC,s.version DESC LIMIT 1
  ) v ON true
 ), snapshots AS (
  SELECT week_start,kind,jsonb_agg(haven.stand_up_revision_aggregate(revision_id) ORDER BY facility_id) reports
  FROM candidates GROUP BY week_start,kind
  HAVING bool_or(EXISTS(SELECT 1 FROM jsonb_each(values) kv WHERE kv.value<>'null'::jsonb))
   OR (kind=0 AND EXISTS(SELECT 1 FROM eligible e JOIN public.stand_up_revisions old ON old.report_id=e.id
    WHERE e.week_start=candidates.week_start AND EXISTS(SELECT 1 FROM jsonb_each(old.values) kv WHERE kv.value<>'null'::jsonb)))
 ), facilities AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') items
  FROM public.facilities WHERE organization_id=p_organization_id AND deleted_at IS NULL
 )
 SELECT jsonb_build_object('archive_as_of',generated,'from_week',p_from_week,'to_week',p_to_week,
  -- COL-805: the call the meeting snapshots are taken at, for the publisher's own check.
  'monday_call_local',to_char((haven.stand_up_monday_times(p_organization_id,NULL)).call_local,'HH24:MI'),
  'snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('week_start',s.week_start,'kind',s.kind,'reports',s.reports,'facilities',f.items) ORDER BY s.week_start,s.kind) FROM snapshots s CROSS JOIN facilities f),'[]')),
  coalesce((SELECT max(v.sequence) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.organization_id=p_organization_id),0)
 INTO result,seq;
 INSERT INTO public.stand_up_export_audit(organization_id,source_identity,sequence) VALUES(p_organization_id,'stand_up_history_service',seq);
 RETURN result;
END $function$;


-- Migration 517's setter, accepting Monday for the whole organization.
CREATE OR REPLACE FUNCTION haven.stand_up_set_meeting_schedule(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text; f uuid:=(p->>'facility_id')::uuid; d text:=p->>'meeting_day'; base public.stand_up_meeting_schedule;
 wd smallint; due time; call_time time; zone text; act boolean; saved public.stand_up_meeting_schedule;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN('owner','org_admin') OR (f IS NOT NULL AND (NOT haven.has_facility_access(f)
  OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=f AND organization_id=o AND deleted_at IS NULL))) THEN
  RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501';
 END IF;
 -- COL-805: Monday reads its times from here too, for the whole organization.
 -- Its weekday is fixed (its week key is its own date) and it has no facility override.
 IF d='monday' THEN
  IF f IS NOT NULL THEN RAISE EXCEPTION 'Monday''s times are set for the whole organization'; END IF;
  IF p ? 'weekday' AND (p->>'weekday')::smallint IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'The Monday meeting stays on Monday'; END IF;
 ELSIF haven.stand_up_meeting_keys(d) IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up meeting';
 END IF;
 base:=haven.stand_up_meeting_schedule_row(o,f,d);
 wd:=coalesce((p->>'weekday')::smallint,base.weekday);
 due:=coalesce((p->>'entry_due_local')::time,base.entry_due_local);
 call_time:=coalesce((p->>'call_local')::time,base.call_local);
 zone:=coalesce(nullif(btrim(p->>'time_zone'),''),base.time_zone);
 act:=coalesce((p->>'active')::boolean,base.active,true);
 IF wd IS NULL OR due IS NULL OR call_time IS NULL OR zone IS NULL THEN RAISE EXCEPTION 'Weekday, entry due time, call time and time zone required'; END IF;
 IF d<>'monday' AND wd NOT BETWEEN 2 AND 7 THEN RAISE EXCEPTION 'Weekday must be Tuesday through Sunday'; END IF;
 IF call_time<due THEN RAISE EXCEPTION 'The call cannot start before entry is due'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'Unknown time zone'; END IF;
 INSERT INTO public.stand_up_meeting_schedule(organization_id,facility_id,meeting_day,weekday,entry_due_local,call_local,time_zone,active,updated_by)
 VALUES(o,f,d,wd,due,call_time,zone,act,a)
 ON CONFLICT(organization_id,facility_id,meeting_day) DO UPDATE SET weekday=excluded.weekday,entry_due_local=excluded.entry_due_local,
  call_local=excluded.call_local,time_zone=excluded.time_zone,active=excluded.active,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 RETURNING * INTO saved;
 RETURN jsonb_build_object('organization_id',o,'facility_id',f,'meeting_day',d,'weekday',saved.weekday,
  'entry_due_local',to_char(saved.entry_due_local,'HH24:MI'),'call_local',to_char(saved.call_local,'HH24:MI'),'time_zone',saved.time_zone,'active',saved.active);
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_set_meeting_schedule(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.stand_up_meeting_schedule IS 'COL-752 / COL-805: the Stand Up meeting schedule. One row per organization and meeting day (facility_id null), optionally overridden per facility for meetings other than Monday. weekday is ISO (1 Monday .. 7 Sunday); entry_due_local and call_local are wall-clock times in time_zone. Seeded Monday and Thursday, due 08:45, call 09:15, America/New_York (Brian, 2026-09-24). Every meeting, Monday included, reads its times from here.';

-- stand_up_command: migration 522's text; the Monday workspace carries the schedule.
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

REVOKE ALL ON FUNCTION haven.stand_up_command(text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 405's haven.stand_up_entry_opens_at, migration
-- 337's haven.stand_up_export_history, migration 517's
-- haven.stand_up_set_meeting_schedule and migration 522's haven.stand_up_command,
-- then DROP FUNCTION haven.stand_up_monday_call_at(uuid,date) and
-- haven.stand_up_monday_times(uuid,uuid). Redeploy the previous history publisher.
