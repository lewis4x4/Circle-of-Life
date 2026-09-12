-- Expose the stored import disposition of each held field so both applications
-- and the publisher can name a held import from a fact, never from inference.
-- Additive: no table or column changes; every existing response key is kept.
BEGIN;

-- Dispositions written by the historical import live in the revision provenance
-- (provenance.row.field_dispositions). A later revision that still leaves the
-- metric null keeps the disposition of the most recent revision that carried
-- one, so a held import stays held until an administrator enters a value. A
-- reversal revision (provenance.reverses_batch_id) restores the pre-import
-- figures and ends the carry-forward: a reversed import is no longer held.
CREATE FUNCTION haven.stand_up_field_dispositions(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((
  SELECT jsonb_object_agg(d.key,d.value)
  FROM public.stand_up_revisions v
  CROSS JOIN LATERAL (
   SELECT CASE WHEN reversal OR jsonb_typeof(x)<>'object' THEN '{}'::jsonb ELSE x END AS dispositions FROM (
    SELECT coalesce(s.provenance->'row'->'field_dispositions',s.provenance->'field_dispositions') AS x,
     (s.provenance ? 'reverses_batch_id') AS reversal
    FROM public.stand_up_revisions s
    WHERE s.report_id=v.report_id AND s.version<=v.version
     AND (coalesce(s.provenance->'row'->'field_dispositions',s.provenance->'field_dispositions') IS NOT NULL OR s.provenance ? 'reverses_batch_id')
    ORDER BY s.version DESC LIMIT 1
   ) latest
  ) held
  CROSS JOIN LATERAL jsonb_each(held.dispositions) d
  WHERE v.id=p_revision AND jsonb_typeof(d.value)='string' AND v.values->d.key='null'::jsonb
 ),'{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION haven.stand_up_revision_metadata(p_revision uuid) RETURNS jsonb
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
  'last_submitted_revision_id',(SELECT s.id FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'field_dispositions',haven.stand_up_field_dispositions(v.id)
 ) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE v.id=p_revision
$$;

-- Read-only revision list for one report so Haven can show what changed on a
-- revision. Same authorization as reading the report; no write path is added.
CREATE FUNCTION haven.stand_up_revision_history(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; r public.stand_up_reports%ROWTYPE;
BEGIN
 f:=(p_payload->>'facility_id')::uuid;
 PERFORM haven.stand_up_assert(f);
 SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=f AND week_start=(p_payload->>'week_start')::date;
 IF NOT FOUND THEN RETURN jsonb_build_object('facility_id',f,'week_start',p_payload->>'week_start','revisions','[]'::jsonb); END IF;
 RETURN jsonb_build_object('facility_id',r.facility_id,'week_start',r.week_start,'revisions',coalesce((
  SELECT jsonb_agg(jsonb_build_object('version',v.version,'revision_id',v.id,'status',v.status,'created_at',v.created_at,'reason',v.reason,'values',v.values,
   'updated_by',v.actor_id,'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
   'entry_origin',(haven.stand_up_revision_metadata(v.id)->>'entry_origin')) ORDER BY v.version)
  FROM public.stand_up_revisions v WHERE v.report_id=r.id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb;
BEGIN
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  SELECT coalesce(jsonb_agg(x||coalesce(haven.stand_up_revision_metadata((x->>'revision_id')::uuid),'{}') ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  RETURN result||jsonb_build_object('reports',reports,'server_now',clock_timestamp(),'actor_role',haven.app_role()::text);
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||coalesce(haven.stand_up_revision_metadata((result->>'revision_id')::uuid),'{}');
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_field_dispositions(uuid),haven.stand_up_revision_history(jsonb),haven.stand_up_revision_metadata(uuid),haven.stand_up_command(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;
COMMENT ON FUNCTION haven.stand_up_field_dispositions(uuid) IS 'Stored import dispositions for metrics that are still null on this revision; historical_unit_unconfirmed marks withheld legacy overtime.';
COMMIT;
-- Rollback: restore the 337 definition of haven.stand_up_revision_metadata and
-- haven.stand_up_command, then DROP FUNCTION haven.stand_up_revision_history(jsonb)
-- and haven.stand_up_field_dispositions(uuid). No data or column changes to undo.
