-- Synthetic local replay only: fixture, grants and injected failures roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON vendors,vendor_facilities,facilities,purchase_orders,po_line_items TO authenticated;
GRANT UPDATE ON purchase_orders,po_line_items TO authenticated;
CREATE TEMP TABLE po_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,
 gen_random_uuid() vendor,gen_random_uuid() request,f.id facility,f.organization_id org,
 '[{"description":"First","quantity":1.2345,"unit_cost_cents":1000},{"description":"Second","quantity":2,"unit_cost_cents":100}]'::jsonb lines
 FROM facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"PO reviewer"}' FROM po_fixture;
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','PO reviewer','owner',org,true FROM po_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM po_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM po_fixture;
INSERT INTO vendors(id,organization_id,name) SELECT vendor,org,'PO fixture '||vendor FROM po_fixture;
INSERT INTO vendor_facilities(organization_id,facility_id,vendor_id) SELECT org,facility,vendor FROM po_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true)
 FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
GRANT SELECT ON po_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; result jsonb; repeated jsonb; invalid jsonb;
BEGIN
 SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,gen_random_uuid(),f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Wrong caller accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
 repeated:=create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
 IF result IS DISTINCT FROM repeated OR (result->>'total_cents')::int<>1435 OR (result->>'line_count')::int<>2 THEN RAISE EXCEPTION 'Exact request or decimal total failed'; END IF;
 IF (SELECT count(*) FROM purchase_orders WHERE vendor_id=f.vendor)<>1 OR (SELECT count(*) FROM po_line_items WHERE purchase_order_id=(result->>'purchase_order_id')::uuid)<>2 THEN RAISE EXCEPTION 'Duplicate or missing rows'; END IF;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date+1,f.lines); RAISE EXCEPTION 'Changed request accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Purchase order request identity was already used with different details' THEN RAISE; END IF; END;
 FOREACH invalid IN ARRAY ARRAY[
  '[{"description":"x","quantity":0,"unit_cost_cents":1}]'::jsonb,
  '[{"description":"x","quantity":-1,"unit_cost_cents":1}]'::jsonb,
  '[{"description":"x","quantity":1.00001,"unit_cost_cents":1}]'::jsonb,
  '[{"description":"x","quantity":100000000,"unit_cost_cents":1}]'::jsonb,
  '[{"description":"x","quantity":"NaN","unit_cost_cents":1}]'::jsonb,
  '[{"description":"x","quantity":1,"unit_cost_cents":1.2}]'::jsonb,
  '[{"description":"x","quantity":1,"unit_cost_cents":-1}]'::jsonb,
  '[{"description":"x","quantity":1,"unit_cost_cents":2147483648}]'::jsonb,
  '[{"description":"x","quantity":2,"unit_cost_cents":2147483647}]'::jsonb,
  '[{"description":" ","quantity":1,"unit_cost_cents":1}]'::jsonb,'[]'::jsonb,'{}'::jsonb
 ] LOOP
  BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,invalid); RAISE EXCEPTION 'Invalid line accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invalid line accepted' THEN RAISE; END IF; END;
 END LOOP;
 -- Creation snapshot must not lock legitimate later draft changes/receipts.
 UPDATE purchase_orders SET notes='Edited draft',order_date=current_date+1 WHERE id=(result->>'purchase_order_id')::uuid;
 UPDATE po_line_items SET received_quantity=0.5 WHERE purchase_order_id=(result->>'purchase_order_id')::uuid;
 repeated:=create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
 IF result IS DISTINCT FROM repeated OR NOT EXISTS(SELECT 1 FROM purchase_orders WHERE id=(result->>'purchase_order_id')::uuid AND notes='Edited draft' AND order_date=current_date+1) THEN RAISE EXCEPTION 'Retry changed later edits'; END IF;
 BEGIN INSERT INTO purchase_orders(organization_id,vendor_id,facility_id,po_number,order_date) VALUES(f.org,f.vendor,f.facility,'BYPASS',current_date); RAISE EXCEPTION 'Direct insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: exact and changed retries, decimal totals, invalid numbers, mutable drafts, direct INSERT denial';
END $$;
RESET ROLE;
CREATE TEMP TABLE po_before AS SELECT
 (SELECT count(*) FROM purchase_orders) headers,(SELECT count(*) FROM po_line_items) lines,
 (SELECT count(*) FROM purchase_order_creation_receipts) receipts,
 (SELECT sum(last_number) FROM vendor_po_sequences) sequence_total,(SELECT count(*) FROM audit_log) audits;
CREATE FUNCTION public.review_po_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected PO failure'; END $$;
-- Fail every write boundary after allocation; each statement must undo all writes.
DO $$ DECLARE target text; f record; before_row record;
BEGIN
 SELECT * INTO f FROM po_fixture; SELECT * INTO before_row FROM po_before;
 FOREACH target IN ARRAY ARRAY['purchase_orders','po_line_items','purchase_order_creation_receipts','audit_log'] LOOP
  EXECUTE format('CREATE TRIGGER review_po_fail BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION review_po_failure()',target);
  BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Failure absent';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected PO failure' THEN RAISE; END IF; END;
  EXECUTE format('DROP TRIGGER review_po_fail ON %I',target);
  IF (SELECT count(*) FROM purchase_orders)<>before_row.headers OR (SELECT count(*) FROM po_line_items)<>before_row.lines
   OR (SELECT count(*) FROM purchase_order_creation_receipts)<>before_row.receipts
   OR (SELECT sum(last_number) FROM vendor_po_sequences) IS DISTINCT FROM before_row.sequence_total
   OR (SELECT count(*) FROM audit_log)<>before_row.audits THEN RAISE EXCEPTION 'Partial write after % failure',target; END IF;
 END LOOP;
 BEGIN UPDATE purchase_order_creation_receipts SET receipt='{}' WHERE caller_id=f.actor; RAISE EXCEPTION 'Receipt update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM purchase_order_creation_receipts WHERE caller_id=f.actor; RAISE EXCEPTION 'Receipt deletion accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: header, initial line, receipt and audit injected failures roll back number/header/lines/receipt/audit; receipts immutable';
END $$;
-- Same-account renewed sessions recover the original creation receipt.
INSERT INTO auth.sessions(id,user_id) SELECT gen_random_uuid(),actor FROM po_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',(SELECT id FROM auth.sessions WHERE user_id=f.actor AND id<>f.actor_session LIMIT 1),'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
END $$;
RESET ROLE;
-- Live tenant and source-reference validation apply even to organization admins.
SAVEPOINT po_tenant;
INSERT INTO organizations(name) VALUES('PO other tenant');
UPDATE vendors SET organization_id=(SELECT id FROM organizations WHERE name='PO other tenant') WHERE id=(SELECT vendor FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Cross-tenant vendor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Cross-tenant vendor receipt returned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE vendors SET organization_id=(SELECT org FROM po_fixture) WHERE id=(SELECT vendor FROM po_fixture);
UPDATE facilities SET organization_id=(SELECT id FROM organizations WHERE name='PO other tenant') WHERE id=(SELECT facility FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Cross-tenant facility accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO po_tenant;
SAVEPOINT po_deleted_vendor;
UPDATE vendors SET deleted_at=now() WHERE id=(SELECT vendor FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Deleted vendor receipt returned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO po_deleted_vendor;
-- An owner can recover existing history after unlinking, but a new creation
-- still requires the link used by the existing form.
SAVEPOINT po_owner_unlinked;
UPDATE vendor_facilities SET deleted_at=now() WHERE vendor_id=(SELECT vendor FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
 BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Owner unlinked creation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO po_owner_unlinked;
-- Role and facility/link revocation apply to receipt retrieval, not just writes.
UPDATE user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM po_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; receipt jsonb; BEGIN
 SELECT * INTO f FROM po_fixture;
 receipt:=create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines);
 BEGIN UPDATE purchase_orders SET status='approved' WHERE id=(receipt->>'purchase_order_id')::uuid; RAISE EXCEPTION 'Facility approval accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'facility_admin cannot approve purchase orders' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Vendor visibility through a second accessible facility does not authorize the
-- original PO: migration046 purchase_orders_select requires its exact facility link.
SAVEPOINT po_other_facility_link;
CREATE TEMP TABLE po_second_facility AS SELECT gen_random_uuid() id;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT s.id,source.entity_id,source.organization_id,'PO second facility','Synthetic address','Test','00000',1
 FROM po_second_facility s CROSS JOIN po_fixture f JOIN facilities source ON source.id=f.facility;
INSERT INTO user_facility_access(user_id,facility_id,organization_id)
 SELECT f.actor,s.id,f.org FROM po_fixture f CROSS JOIN po_second_facility s;
INSERT INTO vendor_facilities(organization_id,facility_id,vendor_id)
 SELECT f.org,s.id,f.vendor FROM po_fixture f CROSS JOIN po_second_facility s;
UPDATE vendor_facilities SET deleted_at=now() WHERE vendor_id=(SELECT vendor FROM po_fixture) AND facility_id=(SELECT facility FROM po_fixture);
GRANT SELECT ON po_second_facility TO authenticated;
-- Adding access increments the authoritative claim version; renew the actor JWT.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 IF NOT EXISTS(SELECT 1 FROM vendors WHERE id=f.vendor) THEN RAISE EXCEPTION 'Second link failed to retain vendor visibility'; END IF;
 IF (SELECT count(*) FROM haven.accessible_facility_ids() accessible WHERE accessible IN (f.facility,(SELECT id FROM po_second_facility)))<>2 THEN RAISE EXCEPTION 'Both facilities must remain accessible'; END IF;
 IF EXISTS(SELECT 1 FROM purchase_orders WHERE vendor_id=f.vendor AND facility_id=f.facility) THEN RAISE EXCEPTION 'Original PO unexpectedly visible through second link'; END IF;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Second facility link authorized original PO receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: vendor visible through second accessible facility, original PO SELECT and creation receipt remain denied without original facility link';
END $$;
RESET ROLE;
ROLLBACK TO po_other_facility_link;
UPDATE vendor_facilities SET deleted_at=now() WHERE vendor_id=(SELECT vendor FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Unlinked vendor receipt returned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM create_purchase_order(gen_random_uuid(),f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Unlinked vendor creation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE vendor_facilities SET deleted_at=NULL WHERE vendor_id=(SELECT vendor FROM po_fixture);
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM po_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Revoked facility receipt returned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT actor FROM po_fixture);
UPDATE user_profiles SET app_role='nurse' WHERE id=(SELECT actor FROM po_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Nurse receipt returned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- A changed tenant and deactivated current actor must not recover a receipt.
UPDATE user_profiles SET app_role='owner' WHERE id=(SELECT actor FROM po_fixture);
SAVEPOINT po_actor_scope;
INSERT INTO organizations(name) VALUES('PO actor other tenant');
UPDATE user_profiles SET organization_id=(SELECT id FROM organizations WHERE name='PO actor other tenant') WHERE id=(SELECT actor FROM po_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Changed tenant recovered receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO po_actor_scope;
UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM po_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN SELECT * INTO f FROM po_fixture;
 BEGIN PERFORM create_purchase_order(f.request,f.actor,f.facility,f.vendor,current_date,f.lines); RAISE EXCEPTION 'Disabled actor recovered receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS: live role/facility/vendor-link receipt authorization and existing approval guard'; END $$;
ROLLBACK;
