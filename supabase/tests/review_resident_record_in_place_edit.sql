-- COL-597 synthetic rollback proof: in-place resident record edits.
-- No production identifiers. Proves the intake reviewer gate, provenance rows,
-- verification stamps, optimistic concurrency, idempotent retries and grants.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
GRANT SELECT ON public.residents TO authenticated;

CREATE TEMP TABLE ed AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,
  gen_random_uuid() other_fac,gen_random_uuid() resident,gen_random_uuid() other_resident;
CREATE TEMP TABLE ed_actors(role text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),session uuid DEFAULT gen_random_uuid());
INSERT INTO ed_actors(role) VALUES ('owner'),('facility_admin'),('med_tech'),('caregiver');
INSERT INTO organizations(id,name) SELECT org,'Record edit review' FROM ed;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review' FROM ed;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Review A','1 Way','Town','00000',20 FROM ed
  UNION ALL SELECT other_fac,ent,org,'Review B','2 Way','Town','00000',20 FROM ed;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT id,id||'@record-edit.invalid','{}','{}' FROM ed_actors;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT a.id,f.org,a.id||'@record-edit.invalid','Synthetic '||a.role,a.role::app_role,true FROM ed_actors a CROSS JOIN ed f;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM ed_actors;
INSERT INTO user_facility_access(user_id,organization_id,facility_id)
  SELECT a.id,f.org,f.fac FROM ed_actors a CROSS JOIN ed f;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status)
  SELECT resident,org,fac,'Synthetic','Record','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status FROM ed
  UNION ALL SELECT other_resident,org,other_fac,'Synthetic','Elsewhere','prefer_not_to_say','1940-01-01','active' FROM ed;
GRANT ALL ON ed,ed_actors TO authenticated,service_role;

CREATE FUNCTION pg_temp.ed_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Record edit: %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.ed_login(who text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor ed_actors; version integer;
BEGIN
 SELECT * INTO STRICT actor FROM ed_actors WHERE role=who;
 SELECT auth_claim_version INTO version FROM user_profiles WHERE id=actor.id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'session_id',actor.session,
   'role','authenticated','auth_claim_version',version,'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.ed_version(p uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$
 SELECT updated_at FROM residents WHERE id=p $$;
CREATE FUNCTION pg_temp.ed_denied(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN EXECUTE sql;
 EXCEPTION WHEN OTHERS THEN
   IF position(expected IN SQLERRM)=0 THEN RAISE; END IF;
   denied:=true;
 END;
 PERFORM pg_temp.ed_assert(denied,'expected refusal: '||expected);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ed_version(uuid) TO authenticated;

-- A caregiver may not record a clinical fact: the intake reviewer rule applies here too.
SELECT pg_temp.ed_login('caregiver');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''code_status'',''set'',''{"code_status":"dnr"}'',%L,gen_random_uuid())',
  (SELECT resident FROM ed),pg_temp.ed_version((SELECT resident FROM ed))),'cannot record this');
SELECT pg_temp.ed_assert((resident_record_field_sources((SELECT resident FROM ed))->'code_status'->>'can_edit')='false',
  'caregiver reported as able to edit code status');
RESET ROLE;

-- A facility administrator records the physician (operational) but not allergies (clinical).
SELECT pg_temp.ed_login('facility_admin');
SET LOCAL ROLE authenticated;
SELECT resident_record_field_save((SELECT resident FROM ed),'primary_physician','set',
  '{"name":"Dr. Synthetic","phone":"555-0100"}',pg_temp.ed_version((SELECT resident FROM ed)),gen_random_uuid());
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''allergy_list'',''set'',''{"allergies":["penicillin"]}'',%L,gen_random_uuid())',
  (SELECT resident FROM ed),pg_temp.ed_version((SELECT resident FROM ed))),'cannot record this');
-- Another facility's resident is not reachable at all.
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''primary_physician'',''set'',''{"name":"X"}'',%L,gen_random_uuid())',
  (SELECT other_resident FROM ed),pg_temp.ed_version((SELECT other_resident FROM ed))),'cannot record this');
RESET ROLE;
SELECT pg_temp.ed_assert((SELECT primary_physician_name='Dr. Synthetic' AND primary_physician_phone='555-0100' FROM residents WHERE id=(SELECT resident FROM ed)),
  'physician not written');

-- The nurse records a code status unverified, then verifies it; each is logged with the person.
SELECT pg_temp.ed_login('med_tech');
SET LOCAL ROLE authenticated;
SELECT resident_record_field_save((SELECT resident FROM ed),'code_status','set','{"code_status":"dnr","verified":false}',
  pg_temp.ed_version((SELECT resident FROM ed)),'00000000-0000-4000-8000-000000000597'::uuid);
RESET ROLE;
SELECT pg_temp.ed_assert((SELECT code_status='dnr' AND code_status_verified_at IS NULL AND code_status_verified_by IS NULL
  FROM residents WHERE id=(SELECT resident FROM ed)),'unverified code status was stamped verified');
SET LOCAL ROLE authenticated;
-- A retry with the same key is a replay, not a second write.
SELECT pg_temp.ed_assert((resident_record_field_save((SELECT resident FROM ed),'code_status','set','{"code_status":"dnr","verified":false}',
  pg_temp.ed_version((SELECT resident FROM ed)),'00000000-0000-4000-8000-000000000597'::uuid)->>'replayed')='true','retry was not idempotent');
-- A stale version is refused with P0409.
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''code_status'',''verify'',NULL,%L,gen_random_uuid())',
  (SELECT resident FROM ed),'2000-01-01T00:00:00Z'),'changed since you opened it');
SELECT resident_record_field_save((SELECT resident FROM ed),'code_status','verify',NULL,
  pg_temp.ed_version((SELECT resident FROM ed)),gen_random_uuid());
SELECT resident_record_field_save((SELECT resident FROM ed),'allergy_list','set','{"allergies":[" penicillin ","Penicillin","sulfa",""]}',
  pg_temp.ed_version((SELECT resident FROM ed)),gen_random_uuid());
SELECT resident_record_field_save((SELECT resident FROM ed),'do_not_hospitalize','set','{"do_not_hospitalize":true}',
  pg_temp.ed_version((SELECT resident FROM ed)),gen_random_uuid());
SELECT resident_record_field_save((SELECT resident FROM ed),'polst_molst','set','{"document_type":"polst","polst_status":"verified","physician_signature_date":"2026-09-01"}',
  pg_temp.ed_version((SELECT resident FROM ed)),gen_random_uuid());
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''feeding_tube'',''set'',''{"feeding_tube":"garden_hose"}'',%L,gen_random_uuid())',
  (SELECT resident FROM ed),pg_temp.ed_version((SELECT resident FROM ed))),'feeding_tube');
SELECT pg_temp.ed_denied(format('SELECT resident_record_field_save(%L,''primary_physician'',''set'',''{"name":"123-45-6789"}'',%L,gen_random_uuid())',
  (SELECT resident FROM ed),pg_temp.ed_version((SELECT resident FROM ed))),'SSN');
SELECT pg_temp.ed_assert((resident_record_field_sources((SELECT resident FROM ed))->'code_status'->'source'->>'kind')='person',
  'typed code status not reported as recorded by a person');
SELECT pg_temp.ed_assert((resident_record_field_sources((SELECT resident FROM ed))->'code_status'->'source'->>'by_name')='Synthetic med_tech',
  'typed code status not attributed');
RESET ROLE;

SELECT pg_temp.ed_assert((SELECT code_status_verified_by=(SELECT id FROM ed_actors WHERE role='med_tech') AND code_status_verified_at IS NOT NULL
  AND allergy_list=ARRAY['penicillin','sulfa'] AND allergy_list_reviewed_by=(SELECT id FROM ed_actors WHERE role='med_tech')
  AND do_not_hospitalize IS TRUE FROM residents WHERE id=(SELECT resident FROM ed)),'nurse writes or stamps missing');
SELECT pg_temp.ed_assert((SELECT count(*)=1 FROM advance_directive_documents WHERE resident_id=(SELECT resident FROM ed)
  AND document_type='polst' AND polst_status='verified' AND verified_by=(SELECT id FROM ed_actors WHERE role='med_tech')),'POLST row missing');
SELECT pg_temp.ed_assert((SELECT count(*)=6 FROM resident_record_field_edits WHERE resident_id=(SELECT resident FROM ed)),
  'expected exactly six provenance rows (retry must not add one)');
SELECT pg_temp.ed_assert((SELECT previous_value->>'code_status' IS NULL AND new_value->>'code_status'='dnr' AND surface='resident_record'
  AND recorded_by=(SELECT id FROM ed_actors WHERE role='med_tech') FROM resident_record_field_edits
  WHERE resident_id=(SELECT resident FROM ed) AND field_code='code_status' AND action='set'),'set row lacks before/after/person/surface');
SELECT pg_temp.ed_assert(EXISTS(SELECT 1 FROM audit_log WHERE table_name='residents' AND record_id=(SELECT resident FROM ed)
  AND user_id=(SELECT id FROM ed_actors WHERE role='med_tech') AND new_data->>'code_status'='dnr'),'resident audit row missing');

-- The log is read-only to request roles; the writer is the only way in.
SELECT pg_temp.ed_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ed_denied(format('INSERT INTO resident_record_field_edits(organization_id,facility_id,resident_id,field_code,action,new_value,surface,request_key,recorded_by) VALUES (%L,%L,%L,''code_status'',''set'',''{}'',''resident_record'',gen_random_uuid(),%L)',
  (SELECT org FROM ed),(SELECT fac FROM ed),(SELECT resident FROM ed),(SELECT id FROM ed_actors WHERE role='owner')),'permission denied');
SELECT pg_temp.ed_assert((SELECT count(*)=6 FROM resident_record_field_edits),'owner could not read the log');
RESET ROLE;

SELECT pg_temp.ed_assert(NOT has_function_privilege('anon','public.resident_record_field_save(uuid,text,text,jsonb,timestamptz,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.resident_record_field_save(uuid,text,text,jsonb,timestamptz,uuid,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.resident_record_field_save(uuid,text,text,jsonb,timestamptz,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.resident_record_field_sources(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','haven.resident_record_edit_allowed(text,uuid,uuid)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.resident_record_field_edits','INSERT'),'grants changed');
ROLLBACK;
