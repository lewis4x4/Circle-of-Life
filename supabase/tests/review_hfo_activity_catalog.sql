-- Disposable PostgreSQL replay only. Every fixture and grant rolls back.
BEGIN;
CREATE FUNCTION pg_temp.hfo_expect(p_sql text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN IF position(p_message IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Expected rejection: %',p_message;
END $$;
CREATE TEMP TABLE hfo_baseline AS SELECT count(*) total,count(*) FILTER(WHERE status='completed') completed FROM public.operation_task_instances;
CREATE TEMP TABLE hfo_fixture AS SELECT gen_random_uuid() template,gen_random_uuid() revision,gen_random_uuid() instance,
  gen_random_uuid() facility_subject,gen_random_uuid() resident,gen_random_uuid() employee,gen_random_uuid() asset,
  gen_random_uuid() other_facility,gen_random_uuid() other_org,gen_random_uuid() other_entity,gen_random_uuid() foreign_facility,
  gen_random_uuid() reader,gen_random_uuid() reader_session, f.id facility,f.organization_id org,f.entity_id entity
  FROM public.facilities f WHERE f.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF (SELECT count(*) FROM hfo_fixture)<>1 THEN RAISE EXCEPTION 'HFO fixture requires existing facility'; END IF; END $$;
INSERT INTO public.organizations(id,name) SELECT other_org,'HFO other organization' FROM hfo_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT other_entity,other_org,'HFO other entity' FROM hfo_fixture;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT other_facility,org,entity,'HFO other facility','Test','Test','00000',1 FROM hfo_fixture
  UNION ALL SELECT foreign_facility,other_org,other_entity,'HFO foreign facility','Test','Test','00000',1 FROM hfo_fixture;

-- Existing delivered history was extended, not retargeted or rematched by name.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.operation_task_templates t JOIN public.operation_activities a ON a.id=t.activity_id
    WHERE a.organization_id<>t.organization_id OR (a.facility_id IS NOT NULL AND a.facility_id IS DISTINCT FROM t.facility_id)) THEN RAISE EXCEPTION 'Invalid backfilled template scope'; END IF;
  IF EXISTS(SELECT 1 FROM public.operation_task_templates t JOIN public.operation_task_templates p ON p.id=t.previous_version_id WHERE t.activity_id<>p.activity_id) THEN RAISE EXCEPTION 'Backfilled revision split stable identity'; END IF;
  IF EXISTS(SELECT 1 FROM public.operation_task_instances i JOIN public.operation_task_templates t ON t.id=i.template_id WHERE i.activity_id IS DISTINCT FROM t.activity_id) THEN RAISE EXCEPTION 'Backfilled instance lost template activity'; END IF;
  IF EXISTS(SELECT 1 FROM public.operation_task_instances WHERE template_id IS NULL AND activity_id IS NOT NULL) THEN RAISE EXCEPTION 'Orphan history was guessed'; END IF;
  IF EXISTS(SELECT 1 FROM public.operation_activities WHERE origin='legacy_template' AND (activity_kind IS NOT NULL OR subject_kind IS NOT NULL)) THEN RAISE EXCEPTION 'Legacy semantics were guessed'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000001') THEN
    IF (SELECT count(*) FROM public.operation_activity_source_items WHERE organization_id='00000000-0000-0000-0000-000000000001')<>91 THEN RAISE EXCEPTION 'Expected exactly 91 COL source items'; END IF;
    IF EXISTS(SELECT 1 FROM public.operation_activity_source_items s WHERE NOT EXISTS(SELECT 1 FROM public.operation_activity_source_mappings m WHERE m.source_item_id=s.id)) THEN RAISE EXCEPTION 'Unmapped source item'; END IF;
    IF EXISTS(SELECT 1 FROM public.operation_activity_source_items WHERE organization_id<>'00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Intake seeded another tenant'; END IF;
  END IF;
END $$;

INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type)
  SELECT template,org,facility,'HFO original','Regression fixture','safety','on_demand' FROM hfo_fixture;
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type,previous_version_id,version)
  SELECT revision,org,facility,'HFO revised wording','Regression fixture','safety','on_demand',template,2 FROM hfo_fixture;
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,assigned_shift_date)
  SELECT instance,org,facility,template,'HFO original','safety','on_demand',CURRENT_DATE FROM hfo_fixture;
DO $$ DECLARE a uuid; BEGIN
  SELECT activity_id INTO a FROM public.operation_task_templates WHERE id=(SELECT template FROM hfo_fixture);
  IF a IS NULL OR a IS DISTINCT FROM (SELECT activity_id FROM public.operation_task_templates WHERE id=(SELECT revision FROM hfo_fixture))
    OR a IS DISTINCT FROM (SELECT activity_id FROM public.operation_task_instances WHERE id=(SELECT instance FROM hfo_fixture)) THEN RAISE EXCEPTION 'Legacy insert/revision/instance did not retain one activity'; END IF;
END $$;
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_templates SET previous_version_id=id WHERE id=(SELECT template FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_templates SET activity_id=gen_random_uuid() WHERE id=(SELECT template FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_templates SET facility_id=(SELECT other_facility FROM hfo_fixture) WHERE id=(SELECT template FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_task_templates(organization_id,facility_id,name,description,category,cadence_type,previous_version_id) SELECT org,other_facility,''Bad'',''Bad'',''safety'',''on_demand'',template FROM hfo_fixture','lineage scope');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_task_templates(organization_id,facility_id,name,description,category,cadence_type,previous_version_id) SELECT other_org,foreign_facility,''Bad'',''Bad'',''safety'',''on_demand'',template FROM hfo_fixture','lineage scope');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_task_templates(organization_id,facility_id,name,description,category,cadence_type,activity_id) SELECT f.org,f.other_facility,''Bad'',''Bad'',''safety'',''on_demand'',t.activity_id FROM hfo_fixture f JOIN public.operation_task_templates t ON t.id=f.template','activity scope');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_task_templates(organization_id,facility_id,name,description,category,cadence_type,activity_id) SELECT f.other_org,f.foreign_facility,''Bad'',''Bad'',''safety'',''on_demand'',t.activity_id FROM hfo_fixture f JOIN public.operation_task_templates t ON t.id=f.template','activity scope');
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_instances SET template_id=(SELECT revision FROM hfo_fixture) WHERE id=(SELECT instance FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_instances SET activity_id=NULL WHERE id=(SELECT instance FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('UPDATE public.operation_task_instances SET facility_id=(SELECT other_facility FROM hfo_fixture) WHERE id=(SELECT instance FROM hfo_fixture)','identity is immutable');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_task_instances(organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,assigned_shift_date) SELECT org,other_facility,template,''Bad'',''safety'',''on_demand'',CURRENT_DATE FROM hfo_fixture','template scope');
SELECT pg_temp.hfo_expect('UPDATE public.operation_activities SET activity_key=''changed'' WHERE id=(SELECT activity_id FROM public.operation_task_templates WHERE id=(SELECT template FROM hfo_fixture))','identity is immutable');
SELECT pg_temp.hfo_expect('UPDATE public.operation_activity_source_items SET source_payload=''{}'' WHERE source_item_id=''AL-D01''','provenance is immutable');

-- All four subject types reuse actual domain masters and reject wrong site/org/type.
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
  SELECT resident,org,facility,'HFO','Resident','1950-01-01','female' FROM hfo_fixture;
INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date)
  SELECT employee,org,facility,'HFO','Employee','resident_aide',CURRENT_DATE FROM hfo_fixture;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name)
  SELECT asset,org,facility,'aed','HFO asset' FROM hfo_fixture;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind)
  SELECT facility_subject,org,facility,'facility' FROM hfo_fixture;
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,resident_id)
  SELECT org,facility,'resident',resident FROM hfo_fixture;
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,employee_id)
  SELECT org,facility,'employee',employee FROM hfo_fixture;
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,asset_id)
  SELECT org,facility,'asset',asset FROM hfo_fixture;
DO $$ DECLARE k text; col text; BEGIN
  FOREACH k IN ARRAY ARRAY['resident','employee','asset'] LOOP
    col:=k||'_id';
    PERFORM pg_temp.hfo_expect(format('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,%I) SELECT org,other_facility,%L,%I FROM hfo_fixture',col,k,k),'Invalid activity subject scope');
    PERFORM pg_temp.hfo_expect(format('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,%I) SELECT other_org,foreign_facility,%L,%I FROM hfo_fixture',col,k,k),'Invalid activity subject scope');
    PERFORM pg_temp.hfo_expect(format('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,%I) SELECT org,facility,%L,gen_random_uuid() FROM hfo_fixture',col,k),'Invalid activity subject scope');
  END LOOP;
END $$;
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind) SELECT other_org,facility,''facility'' FROM hfo_fixture','Invalid activity subject scope');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,employee_id) SELECT org,facility,''resident'',employee FROM hfo_fixture','Invalid activity subject scope');
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,resident_id,employee_id) SELECT org,facility,''resident'',resident,employee FROM hfo_fixture','check constraint');
SELECT pg_temp.hfo_expect('UPDATE public.operation_activity_subjects SET facility_id=(SELECT other_facility FROM hfo_fixture) WHERE id=(SELECT facility_subject FROM hfo_fixture)','references are immutable');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.operation_activity_subjects WHERE facility_id=(SELECT facility FROM hfo_fixture))<>4 THEN RAISE EXCEPTION 'Four typed subject references not present'; END IF;
  IF (SELECT count(*) FROM public.operation_task_instances)<>(SELECT total+1 FROM hfo_baseline)
    OR (SELECT count(*) FROM public.operation_task_instances WHERE status='completed')<>(SELECT completed FROM hfo_baseline) THEN RAISE EXCEPTION 'Catalog changed task completion history'; END IF;
  IF NOT has_table_privilege('authenticated','public.operation_activity_subjects','SELECT')
    OR has_table_privilege('authenticated','public.operation_activity_subjects','INSERT')
    OR has_table_privilege('authenticated','public.operation_activities','INSERT')
    OR has_table_privilege('authenticated','public.operation_activity_source_items','UPDATE')
    OR has_function_privilege('authenticated','haven.validate_operation_activity_subject()','EXECUTE')
    OR has_function_privilege('anon','haven.bind_operation_template_activity()','EXECUTE') THEN RAISE EXCEPTION 'Catalog grants expanded write/subject access'; END IF;
END $$;

-- Live current-actor catalog scope and revocation, with real session claims.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.operation_task_templates TO authenticated;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT reader,reader||'@hfo.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"HFO reader"}' FROM hfo_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT reader,reader||'@hfo.invalid','HFO reader','facility_admin',org,true FROM hfo_fixture
  ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT reader_session,reader FROM hfo_fixture;
INSERT INTO public.user_facility_access(user_id,organization_id,facility_id) SELECT reader,org,facility FROM hfo_fixture;
INSERT INTO public.operation_activities(organization_id,facility_id,activity_key,name,origin)
  SELECT org,other_facility,'hfo-hidden','Hidden facility','legacy_template' FROM hfo_fixture
  UNION ALL SELECT other_org,NULL,'hfo-foreign','Foreign organization','legacy_template' FROM hfo_fixture;
GRANT SELECT ON hfo_fixture TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.reader,'session_id',f.reader_session,'role','authenticated','auth_claim_version',p.auth_claim_version,'app_role','facility_admin','organization_id',f.org)::text,true)
  FROM hfo_fixture f JOIN public.user_profiles p ON p.id=f.reader;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.operation_activities WHERE activity_key IN ('hfo-hidden','hfo-foreign')) THEN RAISE EXCEPTION 'Catalog scope leak'; END IF;
  IF EXISTS(SELECT 1 FROM public.operation_activities WHERE activity_key='legacy-template:'||(SELECT template FROM hfo_fixture)) THEN RAISE EXCEPTION 'Unclassified legacy catalog leaked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.operation_activities WHERE origin='admin_log') THEN RAISE EXCEPTION 'Reviewed source catalog missing'; END IF;
END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.operation_activity_subjects WHERE subject_kind IN('resident','employee')) THEN RAISE EXCEPTION 'Protected subject without explicit domain grant leaked'; END IF; END $$;
SELECT pg_temp.hfo_expect('INSERT INTO public.operation_activities(organization_id,activity_key,name,origin) SELECT org,''forbidden'',''Forbidden'',''admin_log'' FROM hfo_fixture','permission denied');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT reader FROM hfo_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.operation_activities WHERE activity_key='legacy-template:'||(SELECT template FROM hfo_fixture)) THEN RAISE EXCEPTION 'Revoked facility catalog still visible'; END IF; END $$;
RESET ROLE;
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT reader FROM hfo_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.operation_activities) OR EXISTS(SELECT 1 FROM public.operation_activity_source_items) THEN RAISE EXCEPTION 'Disabled actor still sees catalog'; END IF; END $$;
RESET ROLE;
SELECT 'COL-132 catalog identity, 91-source mapping, subject validation, immutable history and current-actor checks passed' AS result;
ROLLBACK;
