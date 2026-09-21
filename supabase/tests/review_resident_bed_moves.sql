-- Synthetic rollback proof. No production resident identifiers or names.
BEGIN;
SET LOCAL client_min_messages=warning;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
GRANT SELECT,UPDATE ON public.residents TO authenticated;
GRANT SELECT ON public.family_resident_links TO authenticated;
-- Vanilla replay's service role lacks hosted Supabase's grants/BYPASSRLS.
-- This transaction-only adaptation exercises the actual trusted SQL role.
ALTER ROLE service_role BYPASSRLS;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE TEMP TABLE bm AS SELECT gen_random_uuid() org,gen_random_uuid() other_org,
  gen_random_uuid() ent,gen_random_uuid() other_ent,gen_random_uuid() fac,
  gen_random_uuid() other_fac,gen_random_uuid() foreign_fac,
  gen_random_uuid() room,gen_random_uuid() other_room,gen_random_uuid() foreign_room,
  gen_random_uuid() dead_room,gen_random_uuid() resident,gen_random_uuid() unassigned,
  gen_random_uuid() inactive,gen_random_uuid() deleted_resident,gen_random_uuid() admission;
CREATE TEMP TABLE bm_beds(label text PRIMARY KEY,id uuid DEFAULT gen_random_uuid());
INSERT INTO bm_beds(label) VALUES ('source'),('target'),('empty'),('occupied'),('hospital'),('loa'),
  ('hold'),('maintenance'),('offline'),('blocked'),('deleted'),('dead_room'),('other_fac'),('foreign_org'),
  ('pointer'),('reservation'),('arrival'),('bad_room_scope');
CREATE TEMP TABLE bm_actors(role text PRIMARY KEY,id uuid DEFAULT gen_random_uuid(),session uuid DEFAULT gen_random_uuid());
INSERT INTO bm_actors(role) VALUES ('owner'),('org_admin'),('facility_admin'),('nurse'),('caregiver'),('family');
INSERT INTO organizations(id,name) SELECT org,'Bed move review' FROM bm UNION ALL SELECT other_org,'Other bed review' FROM bm;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review' FROM bm UNION ALL SELECT other_ent,other_org,'Other' FROM bm;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Review A','1 Way','Town','00000',20 FROM bm
  UNION ALL SELECT other_fac,ent,org,'Review B','2 Way','Town','00000',20 FROM bm
  UNION ALL SELECT foreign_fac,other_ent,other_org,'Review C','3 Way','Town','00000',20 FROM bm;
INSERT INTO rooms(id,facility_id,organization_id,room_number,deleted_at)
  SELECT room,fac,org,'101',NULL::timestamptz FROM bm
  UNION ALL SELECT other_room,other_fac,org,'201',NULL FROM bm
  UNION ALL SELECT foreign_room,foreign_fac,other_org,'301',NULL FROM bm
  UNION ALL SELECT dead_room,fac,org,'102',now() FROM bm;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status,is_temporarily_blocked,deleted_at)
  SELECT b.id,CASE b.label WHEN 'other_fac' THEN f.other_room WHEN 'bad_room_scope' THEN f.other_room
      WHEN 'foreign_org' THEN f.foreign_room WHEN 'dead_room' THEN f.dead_room ELSE f.room END,
    CASE b.label WHEN 'other_fac' THEN f.other_fac WHEN 'foreign_org' THEN f.foreign_fac ELSE f.fac END,
    CASE b.label WHEN 'foreign_org' THEN f.other_org ELSE f.org END,b.label,
    CASE WHEN b.label IN ('hold','maintenance','offline') THEN b.label::bed_status ELSE 'available'::bed_status END,
    b.label='blocked',CASE WHEN b.label='deleted' THEN now() END
  FROM bm_beds b CROSS JOIN bm f;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT id,id||'@bed-review.invalid','{}','{}' FROM bm_actors;
INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
  SELECT a.id,f.org,a.id||'@bed-review.invalid','Synthetic actor',a.role::app_role,true FROM bm_actors a CROSS JOIN bm f;
INSERT INTO auth.sessions(id,user_id) SELECT session,id FROM bm_actors;
INSERT INTO user_facility_access(user_id,organization_id,facility_id)
  SELECT a.id,f.org,f.fac FROM bm_actors a CROSS JOIN bm f;
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,gender,date_of_birth,status,bed_id,deleted_at,monthly_base_rate,primary_diagnosis)
  SELECT resident,org,fac,'Synthetic','Mover','prefer_not_to_say'::gender,'1940-01-01'::date,'active'::resident_status,(SELECT id FROM bm_beds WHERE label='source'),NULL::timestamptz,123456,'Fixture only' FROM bm
  UNION ALL SELECT unassigned,org,fac,'Synthetic','Unassigned','prefer_not_to_say','1940-01-01','active',NULL,NULL,123456,'Fixture only' FROM bm
  UNION ALL SELECT inactive,org,fac,'Synthetic','Inactive','prefer_not_to_say','1940-01-01','discharged',(SELECT id FROM bm_beds WHERE label='empty'),NULL,123456,'Fixture only' FROM bm
  UNION ALL SELECT deleted_resident,org,fac,'Synthetic','Deleted','prefer_not_to_say','1940-01-01','active',(SELECT id FROM bm_beds WHERE label='empty'),now(),123456,'Fixture only' FROM bm;
INSERT INTO residents(organization_id,facility_id,first_name,last_name,gender,status,bed_id)
  SELECT f.org,f.fac,'Synthetic',b.label,'prefer_not_to_say',
    CASE b.label WHEN 'hospital' THEN 'hospital_hold'::resident_status WHEN 'loa' THEN 'loa'::resident_status ELSE 'active'::resident_status END,b.id
  FROM bm f CROSS JOIN bm_beds b WHERE b.label IN ('occupied','hospital','loa');
UPDATE beds SET current_resident_id=(SELECT inactive FROM bm) WHERE id=(SELECT id FROM bm_beds WHERE label='pointer');
INSERT INTO admission_cases(id,resident_id,organization_id,facility_id,status)
  SELECT admission,inactive,org,fac,'pending_clearance' FROM bm;
UPDATE beds SET reserved_for_admission_case_id=(SELECT admission FROM bm),status='hold'
  WHERE id=(SELECT id FROM bm_beds WHERE label='reservation');
GRANT ALL ON bm,bm_beds,bm_actors TO authenticated,service_role;

CREATE FUNCTION pg_temp.bm_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Bed move: %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.bm_login(who text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor bm_actors; version integer;
BEGIN
 SELECT * INTO STRICT actor FROM bm_actors WHERE role=who;
 SELECT auth_claim_version INTO version FROM user_profiles WHERE id=actor.id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'session_id',actor.session,
   'role','authenticated','auth_claim_version',version,'exp',extract(epoch FROM now()+interval '1 hour')::bigint)::text,true);
END $$;
CREATE FUNCTION pg_temp.bm_snapshot() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT jsonb_build_object(
   'residents',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM residents r WHERE organization_id IN (SELECT org FROM bm UNION SELECT other_org FROM bm)),
   'beds',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM beds b WHERE organization_id IN (SELECT org FROM bm UNION SELECT other_org FROM bm)),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE organization_id IN (SELECT org FROM bm UNION SELECT other_org FROM bm)))
$$;
CREATE FUNCTION pg_temp.bm_denied(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb; denied boolean:=false;
BEGIN
 before_state:=pg_temp.bm_snapshot();
 BEGIN EXECUTE sql;
 EXCEPTION WHEN OTHERS THEN
   IF position(expected IN SQLERRM)=0 THEN RAISE; END IF;
   denied:=true;
 END;
 PERFORM pg_temp.bm_assert(denied,'expected refusal: '||expected);
 PERFORM pg_temp.bm_assert(before_state=pg_temp.bm_snapshot(),'refusal partially mutated resident, beds or audit');
END $$;

-- Fixture boundary used by the independent-session concurrency harness.
SELECT pg_temp.bm_login('nurse');
SET LOCAL ROLE authenticated;
SELECT public.change_resident_bed(f.resident,b.id,(SELECT id FROM bm_beds WHERE label='source')) FROM bm f,bm_beds b WHERE b.label='target';
RESET ROLE;
SELECT pg_temp.bm_assert((SELECT bed_id=(SELECT id FROM bm_beds WHERE label='target')
  AND status='active' AND monthly_base_rate=123456 AND primary_diagnosis='Fixture only' FROM residents WHERE id=(SELECT resident FROM bm)),
  'move lost assignment or changed clinical/lifecycle/billing fields');
SELECT pg_temp.bm_assert((SELECT status='available' AND current_resident_id IS NULL FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='source')),
  'old bed was not released');
SELECT pg_temp.bm_assert((SELECT status='occupied' AND current_resident_id=(SELECT resident FROM bm) FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='target')),
  'new bed was not claimed');
SELECT pg_temp.bm_assert(EXISTS(SELECT 1 FROM audit_log WHERE table_name='residents' AND record_id=(SELECT resident FROM bm)
  AND user_id=(SELECT id FROM bm_actors WHERE role='nurse') AND organization_id=(SELECT org FROM bm) AND facility_id=(SELECT fac FROM bm)
  AND old_data->>'bed_id'=(SELECT id::text FROM bm_beds WHERE label='source')
  AND new_data->>'bed_id'=(SELECT id::text FROM bm_beds WHERE label='target')),'attributed old/new bed audit missing');
SET LOCAL ROLE authenticated;
SELECT public.change_resident_bed(f.unassigned,b.id,NULL) FROM bm f,bm_beds b WHERE b.label='source';
SELECT pg_temp.bm_denied('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=''empty''),NULL) FROM bm','assignment changed');
SELECT pg_temp.bm_denied('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=''empty''),(SELECT id FROM bm_beds WHERE label=''source'')) FROM bm','assignment changed');
SELECT pg_temp.bm_denied('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=''target''),(SELECT id FROM bm_beds WHERE label=''target'')) FROM bm','different available bed');
DO $$ DECLARE target text; fragment text;
BEGIN
 FOREACH target IN ARRAY ARRAY['occupied','hospital','loa','hold','maintenance','offline','blocked','deleted','dead_room','other_fac','foreign_org','pointer','reservation','bad_room_scope'] LOOP
   fragment:=CASE WHEN target IN ('occupied','hospital','loa') THEN 'already occupied'
     WHEN target='pointer' THEN 'conflicting assignment' WHEN target='reservation' THEN 'reserved for admission'
     WHEN target IN ('dead_room','bad_room_scope') THEN 'unavailable room'
     WHEN target IN ('deleted','other_fac','foreign_org') THEN 'unavailable in this facility' ELSE 'not available for assignment' END;
   PERFORM pg_temp.bm_denied(format('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=%L),(SELECT id FROM bm_beds WHERE label=''target'')) FROM bm',target),fragment);
 END LOOP;
END $$;
SELECT pg_temp.bm_denied('SELECT change_resident_bed(inactive,(SELECT id FROM bm_beds WHERE label=''target''),(SELECT id FROM bm_beds WHERE label=''empty'')) FROM bm','Only a current resident');
SELECT pg_temp.bm_denied('SELECT change_resident_bed(deleted_resident,(SELECT id FROM bm_beds WHERE label=''target''),(SELECT id FROM bm_beds WHERE label=''empty'')) FROM bm','Only a current resident');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''other_fac'') WHERE id=(SELECT inactive FROM bm)','unavailable in this facility');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''foreign_org'') WHERE id=(SELECT inactive FROM bm)','unavailable in this facility');

-- Caregivers retain unrelated clinical edits but cannot claim or move beds.
SELECT pg_temp.bm_login('caregiver');
UPDATE residents SET diet_order='Synthetic unrelated update' WHERE id=(SELECT resident FROM bm);
SELECT pg_temp.bm_assert((SELECT diet_order='Synthetic unrelated update' FROM residents WHERE id=(SELECT resident FROM bm)),'unrelated caregiver edit failed');
SELECT pg_temp.bm_denied('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=''empty''),(SELECT id FROM bm_beds WHERE label=''target'')) FROM bm','authority required');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT resident FROM bm)','authority required');
SELECT pg_temp.bm_denied('UPDATE residents SET status=''active'' WHERE id=(SELECT inactive FROM bm)','authority required');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=NULL WHERE id=(SELECT resident FROM bm)','authority required');
-- The existing official discharge/death action is independently authorized by
-- resident RLS. Releasing occupancy with that lifecycle transition is not a
-- bed move, while clearing a still-active resident above remains prohibited.
SAVEPOINT caregiver_discharge;
UPDATE residents SET status='discharged',bed_id=NULL WHERE id=(SELECT resident FROM bm);
SELECT pg_temp.bm_assert((SELECT status='discharged' AND bed_id IS NULL
  AND updated_by=(SELECT id FROM bm_actors WHERE role='caregiver')
  FROM residents WHERE id=(SELECT resident FROM bm)),'caregiver discharge lost existing behavior');
RESET ROLE;
SELECT pg_temp.bm_assert((SELECT status='available' AND current_resident_id IS NULL
  FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='target')),'caregiver discharge did not release occupancy');
ROLLBACK TO SAVEPOINT caregiver_discharge;
SAVEPOINT caregiver_death;
UPDATE residents SET status='deceased',bed_id=NULL WHERE id=(SELECT resident FROM bm);
SELECT pg_temp.bm_assert((SELECT status='deceased' AND bed_id IS NULL
  AND updated_by=(SELECT id FROM bm_actors WHERE role='caregiver')
  FROM residents WHERE id=(SELECT resident FROM bm)),'caregiver death record lost existing behavior');
RESET ROLE;
SELECT pg_temp.bm_assert((SELECT status='available' AND current_resident_id IS NULL
  FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='target')),'caregiver death record did not release occupancy');
ROLLBACK TO SAVEPOINT caregiver_death;
RESET ROLE;
-- Elevated transport with end-user claims still goes through the same guard,
-- including rows hidden by normal SELECT RLS (deleted residents).
SELECT pg_temp.bm_denied('UPDATE residents SET deleted_at=NULL WHERE id=(SELECT deleted_resident FROM bm)','authority required');
SELECT set_config('request.jwt.claims','{}',true);
UPDATE residents SET bed_id=NULL WHERE id=(SELECT unassigned FROM bm);
SELECT pg_temp.bm_login('caregiver');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT unassigned FROM bm)','authority required');
SELECT pg_temp.bm_login('family');
SELECT pg_temp.bm_denied('SELECT change_resident_bed(resident,(SELECT id FROM bm_beds WHERE label=''empty''),(SELECT id FROM bm_beds WHERE label=''target'')) FROM bm','authority required');
SELECT pg_temp.bm_login('nurse');
SELECT set_config('request.jwt.claims',(auth.jwt()||'{"exp":1}'::jsonb)::text,true);
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT resident FROM bm)','authority required');
SELECT pg_temp.bm_login('nurse');
SELECT set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('session_id',gen_random_uuid()))::text,true);
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT resident FROM bm)','authority required');
SELECT pg_temp.bm_login('nurse');
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT id FROM bm_actors WHERE role='nurse');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT resident FROM bm)','authority required');
SELECT set_config('request.jwt.claims','{}',true);

-- A contradictory source pointer needs review too; moving must not leave it
-- behind or silently erase another resident's legacy assignment.
UPDATE beds SET current_resident_id=(SELECT inactive FROM bm) WHERE id=(SELECT id FROM bm_beds WHERE label='target');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''empty'') WHERE id=(SELECT resident FROM bm)','current bed has a conflicting assignment');
UPDATE beds SET current_resident_id=(SELECT resident FROM bm) WHERE id=(SELECT id FROM bm_beds WHERE label='target');

-- Trusted direct writes cannot bypass physical/scope integrity, including new
-- inserts, status reactivation, undelete, and scoped-column mutation.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''hospital'') WHERE id=(SELECT resident FROM bm)','already occupied');
SELECT pg_temp.bm_denied('INSERT INTO residents(organization_id,facility_id,first_name,last_name,gender,status,bed_id) SELECT org,fac,''Synthetic'',''Duplicate'',''prefer_not_to_say'',''active'',(SELECT id FROM bm_beds WHERE label=''target'') FROM bm','already occupied');
UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label='target') WHERE id IN (SELECT inactive FROM bm UNION SELECT deleted_resident FROM bm);
SELECT pg_temp.bm_denied('UPDATE residents SET status=''active'' WHERE id=(SELECT inactive FROM bm)','already occupied');
SELECT pg_temp.bm_denied('UPDATE residents SET deleted_at=NULL WHERE id=(SELECT deleted_resident FROM bm)','already occupied');
SELECT pg_temp.bm_denied('UPDATE residents SET facility_id=(SELECT other_fac FROM bm) WHERE id=(SELECT resident FROM bm)','unavailable in this facility');
SELECT pg_temp.bm_denied('UPDATE residents SET organization_id=(SELECT other_org FROM bm) WHERE id=(SELECT resident FROM bm)','unavailable in this facility');
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''foreign_org'') WHERE id=(SELECT inactive FROM bm)','unavailable in this facility');

-- Matching admission arrival consumes only its own reservation and preserves
-- the service-side actor contract and the shared live-holder invariant.
UPDATE residents SET status='pending_admission',bed_id=NULL WHERE id=(SELECT inactive FROM bm);
UPDATE admission_cases SET financial_clearance_at=now(),physician_orders_received_at=now(),
  bed_id=(SELECT id FROM bm_beds WHERE label='arrival'),status='bed_reserved' WHERE id=(SELECT admission FROM bm);
INSERT INTO form_1823_records(admission_case_id,resident_id,facility_id,organization_id,status,physician_name,exam_date,expiration_date)
  SELECT admission,inactive,fac,org,'received','Synthetic physician',current_date-1,current_date+365 FROM bm;
INSERT INTO admission_document_checklist_items(admission_case_id,organization_id,facility_id,document_type,required,received_at,notes)
  SELECT admission,org,fac,'form_1823',true,now(),'Synthetic verified document' FROM bm
  ON CONFLICT(admission_case_id,document_type) WHERE deleted_at IS NULL
  DO UPDATE SET received_at=excluded.received_at,notes=excluded.notes;
INSERT INTO admission_case_rate_terms(admission_case_id,accommodation_type,quoted_base_rate_cents,created_by)
  SELECT admission,'private',10000,(SELECT id FROM bm_actors WHERE role='owner') FROM bm;
SELECT pg_temp.bm_denied('UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label=''arrival'') WHERE id=(SELECT resident FROM bm)','reserved for admission');
UPDATE beds SET is_temporarily_blocked=true WHERE id=(SELECT id FROM bm_beds WHERE label='arrival');
SELECT pg_temp.bm_denied('SELECT confirm_admission_arrival_review(admission,(SELECT id FROM bm_actors WHERE role=''owner''),current_date-1) FROM bm','not available for assignment');
UPDATE beds SET is_temporarily_blocked=false WHERE id=(SELECT id FROM bm_beds WHERE label='arrival');
SELECT confirm_admission_arrival_review(admission,(SELECT id FROM bm_actors WHERE role='owner'),current_date-1) FROM bm;
SELECT pg_temp.bm_assert((SELECT status='occupied' AND current_resident_id=(SELECT inactive FROM bm)
  AND reserved_for_admission_case_id IS NULL FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='arrival')),'matched admission failed');

-- Facility generic behavior and all four allowed server-derived roles.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO residents(organization_id,facility_id,first_name,last_name,gender,status)
  SELECT org,other_fac,'Synthetic','Second facility','prefer_not_to_say','active' FROM bm;
SELECT pg_temp.bm_login('owner');
SELECT change_resident_bed(r.id,b.id,NULL) FROM residents r,bm f,bm_beds b
  WHERE r.facility_id=f.other_fac AND b.label='other_fac';
DO $$ DECLARE who text;
BEGIN
 FOREACH who IN ARRAY ARRAY['owner','org_admin','facility_admin'] LOOP
   PERFORM pg_temp.bm_login(who);
   PERFORM change_resident_bed((SELECT resident FROM bm),(SELECT id FROM bm_beds WHERE label='empty'),(SELECT id FROM bm_beds WHERE label='target'));
   PERFORM change_resident_bed((SELECT resident FROM bm),(SELECT id FROM bm_beds WHERE label='target'),(SELECT id FROM bm_beds WHERE label='empty'));
 END LOOP;
END $$;
SELECT pg_temp.bm_assert(NOT has_function_privilege('anon','public.change_resident_bed(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.change_resident_bed(uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.change_resident_bed(uuid,uuid,uuid)','EXECUTE'),'RPC grants changed');
ROLLBACK;
