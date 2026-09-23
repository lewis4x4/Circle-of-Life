-- COL-671: the service automation projection carries current site-level asset
-- tasks (COL-593 scheduler) and still omits protected or stale subjects.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
CREATE FUNCTION pg_temp.col671_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',msg; END IF; END $$;
CREATE TEMP TABLE col671 AS SELECT gen_random_uuid() asset,gen_random_uuid() retired_asset,gen_random_uuid() resident,
 gen_random_uuid() subject_asset,gen_random_uuid() subject_retired,gen_random_uuid() subject_resident,
 gen_random_uuid() task_asset,gen_random_uuid() task_retired,gen_random_uuid() task_resident,gen_random_uuid() task_mismatch,
 f.id site,f.organization_id org FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
GRANT SELECT ON col671 TO service_role;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name,status)
 SELECT asset,org,site,'generator','COL-671 generator','active' FROM col671
 UNION ALL SELECT retired_asset,org,site,'generator','COL-671 retired generator','retired' FROM col671;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender) SELECT resident,org,site,'Protected','Resident','1940-01-01','female' FROM col671;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id)
 SELECT subject_asset,org,site,'asset',asset FROM col671 UNION ALL SELECT subject_retired,org,site,'asset',retired_asset FROM col671;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subject_resident,org,site,'resident',resident FROM col671;
-- Fixture rows only; the write guard is exercised by the COL-133 probe.
ALTER TABLE public.operation_task_instances DISABLE TRIGGER USER;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,subject_id,authority_class,template_name,template_category,template_cadence_type,assigned_shift_date)
 SELECT task_asset,org,site,subject_asset,'asset','Generator weekly run','safety','weekly',current_date FROM col671
 UNION ALL SELECT task_retired,org,site,subject_retired,'asset','Retired generator run','safety','weekly',current_date FROM col671
 UNION ALL SELECT task_resident,org,site,subject_resident,'resident','Protected resident task','safety','on_demand',current_date FROM col671
 UNION ALL SELECT task_mismatch,org,site,subject_asset,'facility','Asset subject misclassified as facility','safety','on_demand',current_date FROM col671;
ALTER TABLE public.operation_task_instances ENABLE TRIGGER USER;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.col671_assert((SELECT count(*)=1 FROM public.operation_automation_tasks WHERE id=(SELECT task_asset FROM col671)),'Current asset-subject task missing from automation projection');
SELECT pg_temp.col671_assert((SELECT count(*)=0 FROM public.operation_automation_tasks WHERE id IN(SELECT task_retired FROM col671 UNION ALL SELECT task_resident FROM col671 UNION ALL SELECT task_mismatch FROM col671)),'Automation projection leaked a retired asset, protected subject or mismatched class');
RESET ROLE;
SELECT pg_temp.col671_assert(NOT has_table_privilege('authenticated','public.operation_automation_tasks','SELECT'),'Automation projection readable by authenticated');
SELECT 'COL-671 automation asset projection PASS' result;
ROLLBACK;
