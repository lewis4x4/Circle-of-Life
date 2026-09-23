-- COL-627 synthetic rollback proof: face-sheet prints are audited, and the
-- resident record's field history reads safely.
-- No production identifiers. Proves:
--   * a reader with facility access gets one audit_log row with ids and a kind, no PHI;
--   * a caller without access (no facility grant, other organization, signed out) is refused and writes nothing;
--   * resident_record_field_history returns in-place edits and applied document facts newest first,
--     names the person, caps with `truncated`, reports stale document facts, and gives document titles
--     and intake ids only to roles that may read intake;
--   * the grants are as specified.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;

CREATE TEMP TABLE fs AS SELECT gen_random_uuid() org,gen_random_uuid() other_org,gen_random_uuid() ent,gen_random_uuid() other_ent,
  gen_random_uuid() fac,gen_random_uuid() other_fac,gen_random_uuid() resident,gen_random_uuid() intake,gen_random_uuid() source;
CREATE TEMP TABLE fs_actors(name text PRIMARY KEY,app_role text NOT NULL,home text NOT NULL,has_access boolean NOT NULL,
  id uuid DEFAULT gen_random_uuid(),session uuid DEFAULT gen_random_uuid());
INSERT INTO fs_actors(name,app_role,home,has_access) VALUES
  ('owner','owner','org',true),('med_tech','med_tech','org',true),('cook','cook','org',true),
  ('no_access','cook','org',false),('stranger','owner','other_org',true);
INSERT INTO organizations(id,name) SELECT org,'Face sheet review' FROM fs UNION ALL SELECT other_org,'Face sheet elsewhere' FROM fs;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review' FROM fs UNION ALL SELECT other_ent,other_org,'Elsewhere' FROM fs;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Review A','1 Way','Town','00000',20 FROM fs
  UNION ALL SELECT other_fac,other_ent,other_org,'Elsewhere A','2 Way','Town','00000',20 FROM fs;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT id,id||'@face-sheet.invalid','{}','{}' FROM fs_actors;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT a.id,CASE a.home WHEN 'org' THEN f.org ELSE f.other_org END,a.id||'@face-sheet.invalid','Synthetic '||a.name,a.app_role::app_role,true
  FROM fs_actors a CROSS JOIN fs f;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM fs_actors;
INSERT INTO user_facility_access(user_id,organization_id,facility_id)
  SELECT a.id,CASE a.home WHEN 'org' THEN f.org ELSE f.other_org END,CASE a.home WHEN 'org' THEN f.fac ELSE f.other_fac END
  FROM fs_actors a CROSS JOIN fs f WHERE a.has_access;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status)
  SELECT resident,org,fac,'Synthetic','Facesheet','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status FROM fs;
CREATE TEMP TABLE fs_out(k text PRIMARY KEY,h jsonb);
GRANT ALL ON fs,fs_actors,fs_out TO authenticated,service_role;

CREATE FUNCTION pg_temp.fs_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Face sheet: %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.fs_login(who text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor fs_actors; version integer;
BEGIN
 IF who IS NULL THEN
   PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
   RETURN;
 END IF;
 SELECT * INTO STRICT actor FROM fs_actors WHERE name=who;
 SELECT auth_claim_version INTO version FROM user_profiles WHERE id=actor.id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'session_id',actor.session,
   'role','authenticated','auth_claim_version',version,'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.fs_denied(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN EXECUTE sql;
 EXCEPTION WHEN OTHERS THEN
   IF position(expected IN SQLERRM)=0 THEN RAISE; END IF;
   denied:=true;
 END;
 PERFORM pg_temp.fs_assert(denied,'expected refusal: '||expected);
END $$;
CREATE FUNCTION pg_temp.fs_version(p uuid) RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS $$
 SELECT updated_at FROM residents WHERE id=p $$;
CREATE FUNCTION pg_temp.fs_prints() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
 SELECT count(*) FROM audit_log WHERE table_name='resident_face_sheet_print' AND record_id=(SELECT resident FROM fs) $$;
GRANT EXECUTE ON FUNCTION pg_temp.fs_version(uuid),pg_temp.fs_prints() TO authenticated;

-- 1. A reader with facility access: one row, ids and a kind, nothing else.
SELECT pg_temp.fs_login('cook');
SET LOCAL ROLE authenticated;
INSERT INTO fs_out SELECT 'print',to_jsonb(record_resident_face_sheet_print((SELECT resident FROM fs)));
RESET ROLE;
SELECT pg_temp.fs_assert((SELECT count(*)=1 FROM audit_log a JOIN fs_out p ON p.k='print' AND (p.h#>>'{}')::uuid=a.id
  WHERE a.table_name='resident_face_sheet_print' AND a.action='INSERT'
    AND a.record_id=(SELECT resident FROM fs) AND a.facility_id=(SELECT fac FROM fs) AND a.organization_id=(SELECT org FROM fs)
    AND a.user_id=(SELECT id FROM fs_actors WHERE name='cook') AND a.old_data IS NULL),
  'print row missing or mis-attributed');
SELECT pg_temp.fs_assert((SELECT a.new_data='{"event":"resident_face_sheet_printed","print_kind":"face_sheet"}'::jsonb
  FROM audit_log a JOIN fs_out p ON p.k='print' AND (p.h#>>'{}')::uuid=a.id),'print row carries more than an event and a kind');
SELECT pg_temp.fs_assert((SELECT a.new_data::text !~* '(synthetic|facesheet|1940)' FROM audit_log a JOIN fs_out p ON p.k='print' AND (p.h#>>'{}')::uuid=a.id),
  'print row carries a name or a date of birth');
SELECT pg_temp.fs_assert(pg_temp.fs_prints()=1,'expected exactly one print row');

-- 2. No facility grant, another organization, or signed out: refused, nothing written.
SELECT pg_temp.fs_login('no_access');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_denied(format('SELECT record_resident_face_sheet_print(%L)',(SELECT resident FROM fs)),'Resident unavailable');
SELECT pg_temp.fs_denied(format('SELECT resident_record_field_history(%L)',(SELECT resident FROM fs)),'Resident unavailable');
RESET ROLE;
SELECT pg_temp.fs_login('stranger');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_denied(format('SELECT record_resident_face_sheet_print(%L)',(SELECT resident FROM fs)),'Resident unavailable');
SELECT pg_temp.fs_denied(format('SELECT resident_record_field_history(%L)',(SELECT resident FROM fs)),'Resident unavailable');
-- An unknown resident is refused the same way.
SELECT pg_temp.fs_denied(format('SELECT record_resident_face_sheet_print(%L)',gen_random_uuid()),'Resident unavailable');
RESET ROLE;
SELECT pg_temp.fs_login(NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_denied(format('SELECT record_resident_face_sheet_print(%L)',(SELECT resident FROM fs)),'signed-in');
RESET ROLE;
SELECT pg_temp.fs_assert(pg_temp.fs_prints()=1,'a refused print wrote an audit row');
-- audit_log stays write-closed to request roles; the definer is the only way in.
SELECT pg_temp.fs_login('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fs_denied(format('INSERT INTO audit_log(table_name,record_id,action,new_data) VALUES (''resident_face_sheet_print'',%L,''INSERT'',''{}'')',
  (SELECT resident FROM fs)),'');
RESET ROLE;
SELECT pg_temp.fs_assert(pg_temp.fs_prints()=1,'a direct insert reached audit_log');

-- 3. Field history. One admission-document fact applied yesterday, one that went
-- stale on apply an hour ago, then two in-place edits by the nurse.
INSERT INTO resident_record_intakes(id,organization_id,facility_id,resident_id,title,state,created_by)
  SELECT intake,org,fac,resident,'Synthetic admission','review',(SELECT id FROM fs_actors WHERE name='owner') FROM fs;
INSERT INTO resident_record_intake_sources(id,intake_id,organization_id,facility_id,source_order,title,original_filename,
  declared_mime,declared_size_bytes,declared_sha256,storage_path,uploaded_by)
  SELECT source,intake,org,fac,1,'Synthetic admission packet','packet.pdf','application/pdf',1,repeat('a',64),
    'synthetic/'||source,(SELECT id FROM fs_actors WHERE name='owner') FROM fs;
INSERT INTO resident_record_extracted_facts(intake_id,source_id,organization_id,facility_id,field_code,domain,structured_value,
  display_value,current_value_fingerprint,required_reviewer,state,proposal_origin,reviewed_by,reviewed_at,
  applied_destination,applied_record_id,applied_at)
  SELECT intake,source,org,fac,'resident.allergy_list','clinical','{}'::jsonb,'Latex',repeat('b',64),'clinical'::resident_record_reviewer_class,'applied'::resident_record_fact_state,'manual',
    (SELECT id FROM fs_actors WHERE name='owner'),now()-interval '1 day','resident',resident,now()-interval '1 day' FROM fs
  UNION ALL
  SELECT intake,source,org,fac,'resident.code_status','clinical','{}'::jsonb,'Full code',repeat('c',64),'clinical'::resident_record_reviewer_class,'stale'::resident_record_fact_state,'manual',
    (SELECT id FROM fs_actors WHERE name='owner'),now()-interval '1 hour',NULL,NULL::uuid,NULL::timestamptz FROM fs;

SELECT pg_temp.fs_login('med_tech');
SET LOCAL ROLE authenticated;
SELECT resident_record_field_save((SELECT resident FROM fs),'code_status','set','{"code_status":"dnr","verified":false}',
  pg_temp.fs_version((SELECT resident FROM fs)),gen_random_uuid());
SELECT resident_record_field_save((SELECT resident FROM fs),'code_status','verify',NULL,
  pg_temp.fs_version((SELECT resident FROM fs)),gen_random_uuid());
RESET ROLE;

-- The owner may read intake: newest first, attributed, document title and stale intake shown.
SELECT pg_temp.fs_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO fs_out SELECT 'owner',resident_record_field_history((SELECT resident FROM fs));
INSERT INTO fs_out SELECT 'capped',resident_record_field_history((SELECT resident FROM fs),1);
RESET ROLE;
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(h->'entries')=3 AND (h->>'truncated')='false' AND (h->>'limit')='50' FROM fs_out WHERE k='owner'),
  'expected three history entries, untruncated');
SELECT pg_temp.fs_assert((SELECT h->'entries'->0->>'action'='verify' AND h->'entries'->0->>'kind'='person'
  AND h->'entries'->0->>'by_name'='Synthetic med_tech' AND h->'entries'->0->>'field'='code_status'
  AND h->'entries'->1->>'action'='set' AND h->'entries'->1->'new_value'->>'code_status'='dnr'
  AND h->'entries'->1->'previous_value'->>'code_status' IS NULL FROM fs_out WHERE k='owner'),'in-place edits not newest first with before/after/person');
SELECT pg_temp.fs_assert((SELECT h->'entries'->2->>'kind'='document' AND h->'entries'->2->>'field'='allergy_list'
  AND h->'entries'->2->>'document_title'='Synthetic admission packet' AND h->'entries'->2->>'document_value'='Latex'
  AND h->'entries'->2->>'by_name'='Synthetic owner' FROM fs_out WHERE k='owner'),'applied document fact missing its title, value or reviewer');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(h->'stale')=1 AND h->'stale'->0->>'field'='code_status'
  AND h->'stale'->0->>'intake_id'=(SELECT intake::text FROM fs) AND NOT (h->'stale'->0 ? 'display_value') FROM fs_out WHERE k='owner'),
  'stale code-status fact not reported with its intake');
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(h->'entries')=1 AND (h->>'truncated')='true' FROM fs_out WHERE k='capped'),
  'the limit did not cap the history or report truncation');

-- A cook sees the history but not intake detail.
SELECT pg_temp.fs_login('cook');
SET LOCAL ROLE authenticated;
INSERT INTO fs_out SELECT 'floor',resident_record_field_history((SELECT resident FROM fs));
RESET ROLE;
SELECT pg_temp.fs_assert((SELECT jsonb_array_length(h->'entries')=3 AND h->'entries'->2->>'document_title' IS NULL
  AND h->'entries'->2->>'document_value' IS NULL AND jsonb_array_length(h->'stale')=1
  AND h->'stale'->0->>'intake_id' IS NULL AND h->'stale'->0->>'document_title' IS NULL FROM fs_out WHERE k='floor'),
  'a role that may not read intake was given document titles, values or intake ids');

-- 4. Grants.
SELECT pg_temp.fs_assert(has_function_privilege('authenticated','public.record_resident_face_sheet_print(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.record_resident_face_sheet_print(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.record_resident_face_sheet_print(uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.record_resident_face_sheet_print(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.resident_record_field_history(uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.resident_record_field_history(uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.resident_record_field_history(uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('public','public.resident_record_field_history(uuid,integer)','EXECUTE'),'grants changed');
SELECT pg_temp.fs_assert((SELECT bool_and(p.prosecdef AND obj_description(p.oid,'pg_proc') LIKE '%COL-37 ruling:%'
  AND array_to_string(p.proconfig,',')='search_path=""') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('record_resident_face_sheet_print','resident_record_field_history')),
  'definer, ruling or empty search_path missing');
ROLLBACK;
