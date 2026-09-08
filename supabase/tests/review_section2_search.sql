-- NAV-003: synthetic source transfer and caller-scope regression. Rollback only.
BEGIN;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE sf AS SELECT gen_random_uuid() actor,gen_random_uuid() session,gen_random_uuid() resident,
 gen_random_uuid() other_actor,gen_random_uuid() other_session,gen_random_uuid() other_org,gen_random_uuid() other_entity,gen_random_uuid() foreign_facility,
 f.id facility,f.organization_id organization,(SELECT id FROM facilities WHERE organization_id=f.organization_id AND id<>f.id AND deleted_at IS NULL LIMIT 1) target_facility
 FROM facilities f WHERE f.deleted_at IS NULL LIMIT 1;
INSERT INTO organizations(id,name) SELECT other_org,'Section 2 foreign search fixture' FROM sf;
INSERT INTO entities(id,organization_id,name) SELECT other_entity,other_org,'Section 2 foreign entity' FROM sf;
INSERT INTO facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT foreign_facility,other_org,other_entity,'Section 2 foreign facility','Synthetic','Synthetic','00000',1 FROM sf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@search.invalid','{}'::jsonb,'{}'::jsonb FROM sf
 UNION ALL SELECT other_actor,other_actor||'@search.invalid','{}'::jsonb,'{}'::jsonb FROM sf;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active) SELECT actor,organization,actor||'@search.invalid','Search fixture','nurse'::app_role,true FROM sf
 UNION ALL SELECT other_actor,other_org,other_actor||'@search.invalid','Foreign search fixture','nurse'::app_role,true FROM sf;
INSERT INTO auth.sessions(id,user_id) SELECT session,actor FROM sf UNION ALL SELECT other_session,other_actor FROM sf;
INSERT INTO user_facility_access(user_id,organization_id,facility_id) SELECT actor,organization,facility FROM sf
 UNION ALL SELECT other_actor,other_org,foreign_facility FROM sf;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,organization,facility,'SectionTwoSearch','Synthetic','1940-01-01','female' FROM sf;
GRANT SELECT ON sf TO authenticated;
CREATE FUNCTION pg_temp.search_claims(foreign_actor boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'role','authenticated','session_id',CASE WHEN foreign_actor THEN f.other_session ELSE f.session END,'auth_claim_version',p.auth_claim_version)::text,true)::void FROM sf f JOIN user_profiles p ON p.id=CASE WHEN foreign_actor THEN f.other_actor ELSE f.actor END
$$;
CREATE FUNCTION pg_temp.search_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label;
END $$;
SELECT pg_temp.search_claims();
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'resident initially indexed in authorized facility');
RESET ROLE;
UPDATE residents SET facility_id=(SELECT target_facility FROM sf) WHERE id=(SELECT resident FROM sf);
SELECT 'NAV-003 index retained former scope' probe, d.facility_id<>r.facility_id stale FROM search_documents d JOIN residents r ON r.id=d.source_id WHERE r.id=(SELECT resident FROM sf);
SET LOCAL ROLE authenticated;
SELECT 'NAV-003 former facility name disclosure' probe,count(*) FROM search_documents WHERE source_id=(SELECT resident FROM sf);
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'former facility cannot retrieve transferred resident');
RESET ROLE;
SELECT pg_temp.search_assert((SELECT d.facility_id=r.facility_id AND d.organization_id=r.organization_id FROM search_documents d JOIN residents r ON r.id=d.source_id WHERE r.id=(SELECT resident FROM sf)),'trigger updates denormalized authority columns');
INSERT INTO user_facility_access(user_id,organization_id,facility_id) SELECT actor,organization,target_facility FROM sf;
SELECT pg_temp.search_claims();
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'new facility grant sees transferred resident');
RESET ROLE;
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM sf) AND facility_id=(SELECT target_facility FROM sf);
SELECT pg_temp.search_claims();
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'fresh-version revoked grant denies search');
RESET ROLE;
-- Even a stale externally written index scope cannot substitute for the current source.
UPDATE search_documents SET facility_id=(SELECT facility FROM sf) WHERE source_id=(SELECT resident FROM sf);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'stale index scope is denied by live resident authority');
RESET ROLE;
UPDATE residents SET organization_id=(SELECT other_org FROM sf),facility_id=(SELECT foreign_facility FROM sf) WHERE id=(SELECT resident FROM sf);
SELECT pg_temp.search_claims();
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'former tenant cannot retrieve moved resident');
RESET ROLE;
SELECT pg_temp.search_claims(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'new tenant sees its resident');
RESET ROLE;
UPDATE user_profiles SET app_role='family' WHERE id=(SELECT other_actor FROM sf);
SELECT pg_temp.search_claims(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'facility grant alone does not expose unlinked resident to family');
RESET ROLE;
INSERT INTO family_resident_links(user_id,organization_id,resident_id,relationship) SELECT other_actor,other_org,resident,'family' FROM sf;
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'linked family source access is preserved');
RESET ROLE;
UPDATE family_resident_links SET revoked_at=now() WHERE user_id=(SELECT other_actor FROM sf) AND resident_id=(SELECT resident FROM sf);
SELECT pg_temp.search_claims(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'revoked family link denies resident search');
RESET ROLE;
UPDATE family_resident_links SET revoked_at=NULL WHERE user_id=(SELECT other_actor FROM sf) AND resident_id=(SELECT resident FROM sf);
SELECT pg_temp.search_claims(true);
UPDATE residents SET deleted_at=now() WHERE id=(SELECT resident FROM sf);
UPDATE search_documents SET deleted_at=NULL WHERE source_id=(SELECT resident FROM sf);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'soft-deleted source is hidden even with a stale live index row');
RESET ROLE;
UPDATE residents SET deleted_at=NULL WHERE id=(SELECT resident FROM sf);
SELECT pg_temp.search_claims(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT resident FROM sf)),'restored source is visible before account disable');
RESET ROLE;
UPDATE user_profiles SET is_active=false WHERE id=(SELECT other_actor FROM sf);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents),'disabled account cannot search');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.search_assert(NOT EXISTS(SELECT 1 FROM search_documents),'no-profile caller cannot search');
RESET ROLE;
ROLLBACK;
