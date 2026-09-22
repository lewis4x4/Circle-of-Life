-- COL-504 rollback (spec 39 "Rollout, verification and recovery"): disable the benefits write surface
-- without touching evidence. Revokes EXECUTE on every public write wrapper so the API returns
-- 404/503 for mutations while reads, documents and history remain intact. Re-grant to re-enable.
-- Apply with: node scripts/benefits/hosted-query.mjs <project-ref> scripts/benefits/rollback-write-rpcs.sql
-- NEVER DROP a benefits table or bucket as a rollback; that destroys immutable evidence.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.benefits_case_create(uuid,uuid,text,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_case_command(uuid,text,jsonb,integer,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_case_rebind(uuid,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_access_set(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_rule_set(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_collection_command(uuid,text,jsonb,integer,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_family_command(uuid,text,jsonb,integer,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.benefits_document_attest(uuid,text,bigint,text,uuid,text,text) FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- To re-enable: GRANT EXECUTE ON FUNCTION <each of the above> TO authenticated (attest TO service_role), then NOTIFY pgrst, 'reload schema'.
