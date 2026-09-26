-- COL-805: Monday reads its times from the meeting schedule. Fails before
-- migration 525 (the setter refused Monday; the times were fixed). With the
-- schedule unchanged the history export is exactly migration 337's.
-- Native scratch-only probe; every fixture rolls back. Synthetic data only.
BEGIN;
SET LOCAL client_min_messages=warning;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE ms AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() owner_id,gen_random_uuid() owner_session,
 date '2026-09-14' week;
INSERT INTO public.organizations(id,name) SELECT org,'Monday schedule probe' FROM ms;
INSERT INTO public.entities(id,organization_id,name) SELECT ent,org,'Monday entity' FROM ms;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT fac,ent,org,'Monday facility','1 Way','Town','00000',10 FROM ms;
INSERT INTO public.stand_up_meeting_schedule(organization_id,meeting_day,weekday,entry_due_local,call_local,time_zone)
 SELECT org,d,w,time '08:45',time '09:15','America/New_York' FROM ms,(VALUES ('monday',1::smallint),('thursday',4::smallint)) v(d,w);
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT owner_id,owner_id||'@review.invalid','{}','{}' FROM ms;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT owner_id,owner_id||'@review.invalid','Schedule owner','owner',org,true FROM ms;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_id FROM ms;
CREATE FUNCTION pg_temp.ms_login() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'session_id',f.owner_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'organization_id',p.organization_id,'iat',extract(epoch FROM clock_timestamp())::bigint)::text,true)
 FROM ms f JOIN public.user_profiles p ON p.id=f.owner_id;
END $$;
CREATE FUNCTION pg_temp.ms_fail(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected failure: %',expected;
END $$;
GRANT SELECT ON ms TO authenticated;

-- A past Monday report with a revision before the call, one after it, and a submission.
DO $$ DECLARE f record; rid uuid; v1 uuid; v2 uuid; vals jsonb; BEGIN
 SELECT * INTO f FROM ms;
 SELECT jsonb_object_agg(k,to_jsonb(1)) INTO vals FROM unnest(haven.stand_up_keys()) k;
 INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(f.org,f.fac,f.week,vals,'ready') RETURNING id INTO rid;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,created_at) VALUES(rid,1,vals,'draft',f.owner_id,'Probe',(f.week+time '09:00') AT TIME ZONE 'America/New_York') RETURNING id INTO v1;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,created_at) VALUES(rid,2,vals||'{"current_total_census":2}','ready',f.owner_id,'Probe',(f.week+time '09:20') AT TIME ZONE 'America/New_York') RETURNING id INTO v2;
 UPDATE public.stand_up_reports SET version=2,revision_id=v2,values=vals||'{"current_total_census":2}' WHERE id=rid;
END $$;

CREATE FUNCTION pg_temp.old_export_history(p_organization_id uuid, p_from_week date, p_to_week date, p_generated timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql

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
 generated:=p_generated;
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
    AND haven.stand_up_meeting_snapshot_available(r.week_start,generated)
    AND s.created_at <= (r.week_start+time '09:15') AT TIME ZONE 'America/New_York'
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
  'snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('week_start',s.week_start,'kind',s.kind,'reports',s.reports,'facilities',f.items) ORDER BY s.week_start,s.kind) FROM snapshots s CROSS JOIN facilities f),'[]')),
  coalesce((SELECT max(v.sequence) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.organization_id=p_organization_id),0)
 INTO result,seq;
 RETURN result;
END $function$;

-- 1. Unchanged schedule: the export is exactly migration 337's, and the entry window is too.
DO $$ DECLARE f record; now_export jsonb; before jsonb; BEGIN
 SELECT * INTO f FROM ms;
 now_export:=haven.stand_up_export_history(f.org,f.week,f.week);
 before:=pg_temp.old_export_history(f.org,f.week,f.week,(now_export->>'archive_as_of')::timestamptz);
 IF (now_export-'monday_call_local') IS DISTINCT FROM before THEN RAISE EXCEPTION 'History export changed with the schedule unchanged: % vs %',now_export,before; END IF;
 IF now_export->>'monday_call_local'<>'09:15' THEN RAISE EXCEPTION 'The archive must state the call it used: %',now_export->>'monday_call_local'; END IF;
 IF haven.stand_up_entry_opens_at(f.fac,f.week+7)<>(f.week+time '09:15') AT TIME ZONE 'America/New_York' THEN
  RAISE EXCEPTION 'Entry window changed with the schedule unchanged'; END IF;
 -- The as-of-the-call snapshot is revision 1 (09:00), not the 09:20 submission.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(now_export->'snapshots') s WHERE (s->>'kind')::int=2 AND s->'reports'->0->'values'->>'current_total_census'='1') THEN
  RAISE EXCEPTION 'Snapshot at the call is wrong: %',now_export->'snapshots'; END IF;
END $$;

-- 2. The owner moves Monday: due 09:10, call 09:30. The window and the snapshot follow.
SELECT pg_temp.ms_login();
SET LOCAL ROLE authenticated;
SELECT public.stand_up_command('set_meeting_schedule','{"meeting_day":"monday","entry_due_local":"09:10","call_local":"09:30"}');
SELECT pg_temp.ms_fail($q$SELECT public.stand_up_command('set_meeting_schedule',jsonb_build_object('meeting_day','monday','facility_id',(SELECT fac FROM ms),'call_local','09:45'))$q$,'whole organization');
SELECT pg_temp.ms_fail($q$SELECT public.stand_up_command('set_meeting_schedule','{"meeting_day":"monday","weekday":2}')$q$,'stays on Monday');
RESET ROLE;
DO $$ DECLARE f record; now_export jsonb; BEGIN
 SELECT * INTO f FROM ms;
 IF haven.stand_up_entry_opens_at(f.fac,f.week+7)<>(f.week+time '09:30') AT TIME ZONE 'America/New_York' THEN
  RAISE EXCEPTION 'The entry window did not follow the Monday deadline'; END IF;
 now_export:=haven.stand_up_export_history(f.org,f.week,f.week);
 IF now_export->>'monday_call_local'<>'09:30' THEN RAISE EXCEPTION 'The archive did not follow the Monday call'; END IF;
 -- At a 09:30 call the 09:20 submission is the snapshot.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(now_export->'snapshots') s WHERE (s->>'kind')::int=2 AND s->'reports'->0->'values'->>'current_total_census'='2') THEN
  RAISE EXCEPTION 'Snapshot did not follow the Monday call: %',now_export->'snapshots'; END IF;
 -- Thursday entry follows its own previous call, independently of Monday.
 IF haven.stand_up_meeting_opens_at(f.org,f.fac,'thursday',f.week)<>((f.week-4)+time '09:15') AT TIME ZONE 'America/New_York' THEN RAISE EXCEPTION 'Thursday did not open at its previous call'; END IF;
END $$;
-- 3. The Monday workspace states the schedule.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(haven.stand_up_meeting_schedule_json((SELECT org FROM ms),NULL)) x WHERE x->>'meeting_day'='monday' AND x->>'entry_due_local'='09:10' AND x->>'call_local'='09:30') THEN
  RAISE EXCEPTION 'The schedule read does not state Monday'; END IF;
END $$;
ROLLBACK;
