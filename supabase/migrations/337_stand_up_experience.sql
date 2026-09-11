-- Preserve source evidence while making duration and meeting history unambiguous.
BEGIN;

CREATE FUNCTION haven.stand_up_overtime_minutes(v jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n numeric; m numeric; total numeric;
BEGIN
 IF v IS NULL OR v='null'::jsonb OR jsonb_typeof(v)<>'number' THEN RETURN NULL; END IF;
 n:=(v#>>'{}')::numeric;
 IF n<0 OR n<>trunc(n,2) THEN RETURN NULL; END IF;
 m:=(n-trunc(n))*100; total:=trunc(n)*60+m;
 IF m>59 OR total>2147483647 THEN RETURN NULL; END IF;
 RETURN total::integer;
END $$;
-- Generated projections neither rewrite raw values nor alter receipt/revision evidence.
ALTER TABLE public.stand_up_reports
 ADD COLUMN overtime_minutes integer GENERATED ALWAYS AS (haven.stand_up_overtime_minutes(values->'overtime_reported')) STORED,
 ADD COLUMN overtime_issue boolean GENERATED ALWAYS AS (values->'overtime_reported'<>'null'::jsonb AND haven.stand_up_overtime_minutes(values->'overtime_reported') IS NULL) STORED;
ALTER TABLE public.stand_up_revisions
 ADD COLUMN overtime_minutes integer GENERATED ALWAYS AS (haven.stand_up_overtime_minutes(values->'overtime_reported')) STORED,
 ADD COLUMN overtime_issue boolean GENERATED ALWAYS AS (values->'overtime_reported'<>'null'::jsonb AND haven.stand_up_overtime_minutes(values->'overtime_reported') IS NULL) STORED;

CREATE OR REPLACE FUNCTION haven.stand_up_validate(v jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; n numeric;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Values must be an object'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v))<>16 OR NOT v ?& haven.stand_up_keys() THEN RAISE EXCEPTION 'Exactly sixteen supported metrics required'; END IF;
 FOREACH k IN ARRAY haven.stand_up_keys() LOOP
  IF v->k='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k)<>'number' THEN RAISE EXCEPTION 'Invalid numeric metric: %',k; END IF;
  n:=(v->>k)::numeric;
  IF n<0 OR n>2147483647 OR (k<>'overtime_reported' AND trunc(n)<>n) THEN RAISE EXCEPTION 'Invalid numeric metric: %',k; END IF;
  IF k='overtime_reported' AND haven.stand_up_overtime_minutes(v->k) IS NULL THEN RAISE EXCEPTION 'Overtime requires hours and minutes from 00 to 59'; END IF;
 END LOOP;
END $$;

CREATE INDEX idx_stand_up_revision_meeting ON public.stand_up_revisions(report_id,created_at DESC,version DESC);
CREATE INDEX idx_stand_up_revision_submitted ON public.stand_up_revisions(report_id,version DESC) WHERE status='ready';

CREATE FUNCTION haven.stand_up_revision_metadata(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'overtime_minutes',v.overtime_minutes,'overtime_issue',v.overtime_issue,
  'entry_origin',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(v.values) kv WHERE kv.value<>'null'::jsonb) THEN 'initialized'
    WHEN v.batch_id IS NOT NULL THEN 'imported'
    WHEN EXISTS(SELECT 1 FROM public.stand_up_recovery_decisions d WHERE d.result->>'revision_id'=v.id::text) THEN 'recovery'
    ELSE 'manual' END,
  'updated_by',v.actor_id,
  'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
  'first_submitted_at',(SELECT min(s.created_at) FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready'),
  'last_submitted_at',(SELECT s.created_at FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'last_submitted_revision_id',(SELECT s.id FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1)
 ) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE v.id=p_revision
$$;

-- Keep the original lock, revocation, CAS, recovery and idempotency implementation.
-- Only the authorized public command may invoke it; its old grant is removed.
ALTER FUNCTION haven.stand_up_command(text,jsonb) RENAME TO stand_up_command_v1;
REVOKE ALL ON FUNCTION haven.stand_up_command_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Reversal must preserve an invalid legacy duration as evidence without making
-- a new invalid write or aborting restoration of the other valid batch rows.
CREATE FUNCTION haven.stand_up_reverse_import(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; batch public.stand_up_batches%ROWTYPE; row jsonb; r public.stand_up_reports%ROWTYPE;
 old_revision public.stand_up_revisions%ROWTYPE; merged jsonb; saved jsonb; results jsonb:='[]'; conflicts jsonb:='[]';
BEGIN
 a:=haven.authorized_user_id(); o:=haven.organization_id();
 IF a IS NULL OR haven.app_role()::text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Import access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_org:'||o::text,0));
 SELECT * INTO batch FROM public.stand_up_batches WHERE id=(p_payload->>'batch_id')::uuid FOR UPDATE;
 IF NOT FOUND OR batch.organization_id IS DISTINCT FROM haven.organization_id() OR haven.app_role()::text NOT IN('owner','org_admin') OR haven.authorized_user_id() IS DISTINCT FROM a THEN
  RAISE EXCEPTION 'Import access denied' USING ERRCODE='42501';
 END IF;
 IF batch.reversal IS NOT NULL THEN RETURN batch.reversal; END IF;
 IF batch.result IS NULL OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Reversal requires committed batch and reason'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(batch.result->'reports') ORDER BY value->>'facility_id',value->>'week_start' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended((row->>'facility_id')||(row->>'week_start'),0));
  SELECT * INTO r FROM public.stand_up_reports WHERE id=(row->>'id')::uuid FOR UPDATE;
  PERFORM haven.stand_up_assert(r.facility_id,true);
  IF r.revision_id IS DISTINCT FROM (row->>'revision_id')::uuid THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('report_id',r.id,'reason','Later edits preserved')); CONTINUE;
  END IF;
  SELECT * INTO old_revision FROM public.stand_up_revisions WHERE report_id=r.id AND version=r.version-1;
  IF NOT FOUND THEN SELECT jsonb_object_agg(key,'null'::jsonb) INTO merged FROM unnest(haven.stand_up_keys()) key;
  ELSIF old_revision.overtime_issue THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('report_id',r.id,'facility_id',r.facility_id,'week_start',r.week_start,
    'code','legacy_overtime_requires_review','retained_revision_id',old_revision.id,'retained_overtime',old_revision.values->'overtime_reported',
    'reason','Prior overtime needs hours/minutes review. Current report preserved; retained source revision is unchanged.'));
   CONTINUE;
  ELSE merged:=old_revision.values; END IF;
  saved:=haven.stand_up_save(jsonb_build_object('facility_id',r.facility_id,'week_start',r.week_start,'expected_version',r.version,'request_id',gen_random_uuid(),
   'values',merged,'status',coalesce(old_revision.status,'draft'),'as_of',old_revision.source_as_of,'reason',p_payload->>'reason',
   'provenance',jsonb_build_object('reverses_batch_id',batch.id,'reverses_revision_id',r.revision_id)));
  results:=results||jsonb_build_array(saved);
 END LOOP;
 saved:=jsonb_build_object('batch_id',batch.id,'restored',results,'conflicts',conflicts,'reason',p_payload->>'reason','actor_id',haven.authorized_user_id());
 UPDATE public.stand_up_batches SET reversal=saved WHERE id=batch.id;
 RETURN saved;
END $$;

CREATE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb;
BEGIN
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  SELECT coalesce(jsonb_agg(x||coalesce(haven.stand_up_revision_metadata((x->>'revision_id')::uuid),'{}') ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  RETURN result||jsonb_build_object('reports',reports,'server_now',clock_timestamp(),'actor_role',haven.app_role()::text);
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||coalesce(haven.stand_up_revision_metadata((result->>'revision_id')::uuid),'{}');
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.stand_up_command(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.stand_up_command(p_action,p_payload) $$;

CREATE FUNCTION haven.stand_up_revision_aggregate(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('facility_id',r.facility_id,'facility_name',f.name,'week_start',r.week_start,
  'version',v.version,'revision_id',v.id,'values',v.values,'status',v.status,'updated_at',v.created_at,'source_as_of',v.source_as_of)
  ||(haven.stand_up_revision_metadata(v.id)-'updated_by'-'updated_by_name')
 FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id
 JOIN public.facilities f ON f.id=r.facility_id WHERE v.id=p_revision
$$;

CREATE OR REPLACE FUNCTION haven.stand_up_export_aggregate(p_organization_id uuid,p_week_start date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE seq bigint; result jsonb;
BEGIN
 SELECT coalesce((SELECT max(v.sequence) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.organization_id=p_organization_id),0),
 jsonb_build_object('reports',coalesce((SELECT jsonb_agg(haven.stand_up_revision_aggregate(r.revision_id) ORDER BY r.week_start,r.facility_id)
  FROM public.stand_up_reports r JOIN public.facilities f ON f.id=r.facility_id WHERE r.organization_id=p_organization_id AND f.deleted_at IS NULL AND (p_week_start IS NULL OR r.week_start=p_week_start)),'[]'),
  'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.facilities WHERE organization_id=p_organization_id AND deleted_at IS NULL),'[]')) INTO seq,result;
 result:=result||jsonb_build_object('sequence',seq);
 INSERT INTO public.stand_up_export_audit(organization_id,source_identity,sequence) VALUES(p_organization_id,'stand_up_aggregate_service',seq);
 RETURN result;
END $$;

CREATE FUNCTION haven.stand_up_meeting_snapshot_available(p_week date,p_archive_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_archive_at >= ((p_week+time '09:15') AT TIME ZONE 'America/New_York')
$$;

CREATE FUNCTION haven.stand_up_export_history(p_organization_id uuid,p_from_week date,p_to_week date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
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
 INSERT INTO public.stand_up_export_audit(organization_id,source_identity,sequence) VALUES(p_organization_id,'stand_up_history_service',seq);
 RETURN result;
END $$;
CREATE FUNCTION public.stand_up_export_history(p_organization_id uuid,p_from_week date,p_to_week date) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.stand_up_export_history(p_organization_id,p_from_week,p_to_week) $$;

REVOKE ALL ON FUNCTION haven.stand_up_meeting_snapshot_available(date,timestamptz),haven.stand_up_reverse_import(jsonb),haven.stand_up_overtime_minutes(jsonb),haven.stand_up_revision_metadata(uuid),haven.stand_up_revision_aggregate(uuid),haven.stand_up_command(text,jsonb),haven.stand_up_export_history(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.stand_up_export_history(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stand_up_export_history(uuid,date,date),haven.stand_up_export_history(uuid,date,date) TO service_role;
COMMENT ON FUNCTION public.stand_up_export_history(uuid,date,date) IS 'Audited service-only archive: kind 0 latest, 1 last submission, 2 actual recorded revision at Monday 09:15 Eastern. Archive generation time is not source observation time.';
COMMIT;
