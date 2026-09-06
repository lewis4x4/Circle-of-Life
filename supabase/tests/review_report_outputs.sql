-- Rollback-only local reporting persistence/RLS regression.
BEGIN;
-- The vanilla replay stub omits Supabase auth schema visibility.
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE report_fixture AS SELECT p.id actor,p.organization_id org,gen_random_uuid() run_id,gen_random_uuid() source_id
  FROM public.user_profiles p WHERE p.app_role='owner' AND p.organization_id IS NOT NULL AND p.deleted_at IS NULL LIMIT 1;
GRANT SELECT ON report_fixture TO authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM report_fixture) THEN RAISE EXCEPTION 'Local seed owner required'; END IF; END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_role','owner','organization_id',org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',org))::text,true) FROM report_fixture;
SET LOCAL ROLE authenticated;
INSERT INTO public.report_runs(id,organization_id,source_type,source_id,status,run_scope_json)
  SELECT run_id,org,'template',source_id,'running','{}' FROM report_fixture;
DO $$ BEGIN
  BEGIN
    UPDATE public.report_runs SET run_scope_json='{"facility_id":"00000000-0000-4000-8000-000000000001"}',status='failed'
      WHERE id=(SELECT run_id FROM report_fixture);
    RAISE EXCEPTION 'Scope relabel accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.report_runs SET status='completed' WHERE id=(SELECT run_id FROM report_fixture);
    RAISE EXCEPTION 'Completion without output accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Completed reports require output matching the execution scope' THEN RAISE; END IF; END;
END $$;
UPDATE public.report_runs SET status='completed',completed_at=now(),result_snapshot_json='{"title":"Saved test","scopeLabel":"All facilities","facilityId":null,"slices":[]}' WHERE id=(SELECT run_id FROM report_fixture);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.report_runs WHERE id=(SELECT run_id FROM report_fixture) AND status='completed' AND result_snapshot_json->>'title'='Saved test') THEN RAISE EXCEPTION 'Result was not persisted'; END IF;
END $$;
-- Once finalized, a direct client update cannot rewrite the result.
UPDATE public.report_runs SET result_snapshot_json='{"title":"Rewritten"}' WHERE id=(SELECT run_id FROM report_fixture);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT result_snapshot_json->>'title' FROM public.report_runs WHERE id=(SELECT run_id FROM report_fixture)) <> 'Saved test' THEN RAISE EXCEPTION 'Saved result was mutable'; END IF;
END $$;
DO $$ BEGIN
 BEGIN
  UPDATE public.report_runs SET status='failed' WHERE id=(SELECT run_id FROM report_fixture);
  RAISE EXCEPTION 'Service caller rewrote a completed result as failed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
