-- COL-627 (Brian, 2026-09-23): med-techs see only their own staff row, time records and
-- background checks; staff illness records stay visible to them ("for patients");
-- administrators are unaffected. Synthetic rollback proof.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE TEMP TABLE mt AS SELECT gen_random_uuid() org,gen_random_uuid() ent,gen_random_uuid() fac,
  gen_random_uuid() me_staff,gen_random_uuid() other_staff;
CREATE TEMP TABLE mt_actors(role text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),session uuid DEFAULT gen_random_uuid());
INSERT INTO mt_actors(role) VALUES ('med_tech'),('coworker'),('facility_admin');
INSERT INTO organizations(id,name) SELECT org,'Staff data review' FROM mt;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review' FROM mt;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT fac,ent,org,'Review A','1 Way','Town','00000',20 FROM mt;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@mt-review.invalid','{}','{}' FROM mt_actors;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT a.id,f.org,a.id||'@mt-review.invalid','Synthetic '||a.role,(CASE a.role WHEN 'coworker' THEN 'med_tech' ELSE a.role END)::app_role,true FROM mt_actors a CROSS JOIN mt f;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM mt_actors;
INSERT INTO user_facility_access(user_id,organization_id,facility_id) SELECT a.id,f.org,f.fac FROM mt_actors a CROSS JOIN mt f;
INSERT INTO staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date)
  SELECT me_staff,org,fac,(SELECT id FROM mt_actors WHERE role='med_tech'),'Me','Tech','medication_tech'::staff_role,current_date FROM mt
  UNION ALL SELECT other_staff,org,fac,(SELECT id FROM mt_actors WHERE role='coworker'),'Co','Worker','medication_tech'::staff_role,current_date FROM mt;
INSERT INTO time_records(organization_id,facility_id,staff_id,clock_in,clock_in_method)
  SELECT org,fac,me_staff,now()-interval '2 hours','web' FROM mt UNION ALL SELECT org,fac,other_staff,now()-interval '2 hours','web' FROM mt;
INSERT INTO staff_background_checks(organization_id,facility_id,staff_id) SELECT org,fac,me_staff FROM mt UNION ALL SELECT org,fac,other_staff FROM mt;
INSERT INTO staff_illness_records(organization_id,facility_id,staff_id,reported_date,illness_type,absent_from)
  SELECT org,fac,other_staff,current_date,'gi',current_date FROM mt;
GRANT ALL ON mt,mt_actors TO authenticated;

CREATE FUNCTION pg_temp.mt_login(who text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE a mt_actors; v integer;
BEGIN
 SELECT * INTO STRICT a FROM mt_actors WHERE role=who;
 SELECT auth_claim_version INTO v FROM user_profiles WHERE id=a.id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session,'role','authenticated',
   'auth_claim_version',v,'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.mt_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-627 med-tech staff data: %',msg; END IF; END $$;

SELECT pg_temp.mt_login('med_tech');
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_assert((SELECT count(*)=1 FROM staff WHERE organization_id=(SELECT org FROM mt) AND id=(SELECT me_staff FROM mt)),'med-tech lost own staff row');
SELECT pg_temp.mt_assert((SELECT count(*)=0 FROM staff WHERE id=(SELECT other_staff FROM mt)),'med-tech read a coworker staff row');
SELECT pg_temp.mt_assert((SELECT count(*)=1 FROM time_records WHERE organization_id=(SELECT org FROM mt)),'med-tech time records not limited to own');
SELECT pg_temp.mt_assert((SELECT count(*)<=1 FROM staff_background_checks WHERE organization_id=(SELECT org FROM mt)
  AND staff_id<>(SELECT me_staff FROM mt)) AND (SELECT count(*)=0 FROM staff_background_checks WHERE staff_id=(SELECT other_staff FROM mt)),'med-tech read a coworker background check');
SELECT pg_temp.mt_assert((SELECT count(*)=1 FROM staff_illness_records WHERE staff_id=(SELECT other_staff FROM mt)),'med-tech lost staff illness records');
RESET ROLE;

SELECT pg_temp.mt_login('facility_admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_assert((SELECT count(*)=2 FROM staff WHERE organization_id=(SELECT org FROM mt)),'administrator lost the staff roster');
SELECT pg_temp.mt_assert((SELECT count(*)=2 FROM time_records WHERE organization_id=(SELECT org FROM mt)),'administrator lost time records');
SELECT pg_temp.mt_assert((SELECT count(*)=2 FROM staff_background_checks WHERE organization_id=(SELECT org FROM mt)),'administrator lost background checks');
RESET ROLE;
ROLLBACK;
