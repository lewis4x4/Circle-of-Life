-- COL-627 (Brian, 2026-09-23): housekeepers see resident name and room, and all resident
-- logs, and nothing else about residents. Synthetic rollback proof; no production ids.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- Coverage: every resident-bearing table is either a log / housekeeping work (allowed)
-- or denies the housekeeper. A new resident table must make that choice.
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO v
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name='resident_id'
    AND c.table_name NOT IN ('adl_logs','behavioral_logs','care_events','condition_changes','daily_logs','home_notes','incident_followups','incidents','operation_activity_subjects')
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.table_name
      AND p.permissive='RESTRICTIVE' AND p.policyname='Housekeepers see resident name and room only');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'COL-627: resident tables with no housekeeper decision: %. Add the restrictive "Housekeepers see resident name and room only" policy, or add the table to this probe''s allow list if it is a resident log.', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='residents'
      AND permissive='RESTRICTIVE' AND policyname='Housekeepers see resident name and room only') THEN
    RAISE EXCEPTION 'COL-627: residents must deny housekeepers';
  END IF;
END $$;

CREATE TEMP TABLE hk AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,gen_random_uuid() room,gen_random_uuid() bed,
  gen_random_uuid() resident,gen_random_uuid() med,gen_random_uuid() log;
CREATE TEMP TABLE hk_actors(role text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),session uuid DEFAULT gen_random_uuid());
INSERT INTO hk_actors(role) VALUES ('housekeeper'),('med_tech');
INSERT INTO organizations(id,name) SELECT org,'Housekeeper review' FROM hk;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review' FROM hk;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Review A','1 Way','Town','00000',20 FROM hk;
INSERT INTO rooms(id,facility_id,organization_id,room_number) SELECT room,fac,org,'12' FROM hk;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status) SELECT bed,room,fac,org,'A','available'::bed_status FROM hk;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@hk-review.invalid','{}','{}' FROM hk_actors;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT a.id,f.org,a.id||'@hk-review.invalid','Synthetic '||a.role,a.role::app_role,true FROM hk_actors a CROSS JOIN hk f;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM hk_actors;
INSERT INTO user_facility_access(user_id,organization_id,facility_id) SELECT a.id,f.org,f.fac FROM hk_actors a CROSS JOIN hk f;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,preferred_name,gender,date_of_birth,status,bed_id,primary_diagnosis)
  SELECT resident,org,fac,'Synthetic','Record','Sy','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status,bed,'Fixture diagnosis' FROM hk;
INSERT INTO resident_medications(id,resident_id,facility_id,organization_id,medication_name,route,frequency,start_date,order_date,status)
  SELECT med,resident,fac,org,'Fixture med','oral','daily',current_date,current_date,'active' FROM hk;
INSERT INTO daily_logs(id,resident_id,facility_id,organization_id,log_date,shift,general_notes,logged_by)
  SELECT log,f.resident,f.fac,f.org,current_date,'day','Fixture note',a.id FROM hk f JOIN hk_actors a ON a.role='med_tech';
GRANT ALL ON hk,hk_actors TO authenticated;

CREATE FUNCTION pg_temp.hk_login(who text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE a hk_actors; v integer;
BEGIN
 SELECT * INTO STRICT a FROM hk_actors WHERE role=who;
 SELECT auth_claim_version INTO v FROM user_profiles WHERE id=a.id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated',
   'auth_claim_version',v,'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.hk_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-627 housekeeper: %',msg; END IF; END $$;

SELECT pg_temp.hk_login('housekeeper');
SET LOCAL ROLE authenticated;
SELECT pg_temp.hk_assert((SELECT count(*)=0 FROM residents WHERE id=(SELECT resident FROM hk)),'housekeeper read the residents table');
SELECT pg_temp.hk_assert((SELECT count(*)=0 FROM resident_medications WHERE id=(SELECT med FROM hk)),'housekeeper read medications');
SELECT pg_temp.hk_assert((SELECT count(*)=1 FROM daily_logs WHERE id=(SELECT log FROM hk)),'housekeeper lost resident logs');
SELECT pg_temp.hk_assert((SELECT display_name='Sy Record' AND room_label='12-A' AND status='active'
  FROM resident_directory() WHERE resident_id=(SELECT resident FROM hk)),'directory did not give name and room');
RESET ROLE;

SELECT pg_temp.hk_login('med_tech');
SET LOCAL ROLE authenticated;
SELECT pg_temp.hk_assert((SELECT count(*)=1 FROM residents WHERE id=(SELECT resident FROM hk)),'med-tech lost the residents table');
SELECT pg_temp.hk_assert((SELECT count(*)=1 FROM resident_medications WHERE id=(SELECT med FROM hk)),'med-tech lost medications');
RESET ROLE;

SELECT pg_temp.hk_assert(NOT has_function_privilege('anon','public.resident_directory(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.resident_directory(uuid)','EXECUTE'),'directory grants changed');
ROLLBACK;
