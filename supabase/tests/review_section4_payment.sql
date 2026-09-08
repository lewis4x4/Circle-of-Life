-- Local disposable replay only: every clinical fixture and auth adaptation rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON residents,facilities,entities,invoices,payments,family_resident_links TO authenticated;
GRANT UPDATE,DELETE ON payments TO authenticated;
CREATE TEMP TABLE payment_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() witness,gen_random_uuid() resident,gen_random_uuid() resident2,f.id facility,f.organization_id org FROM facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Clinical reviewer"}'::jsonb FROM payment_fixture
 UNION ALL SELECT witness,witness||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Clinical witness"}'::jsonb FROM payment_fixture;
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Clinical reviewer','owner'::app_role,org,true FROM payment_fixture
 UNION ALL SELECT witness,witness||'@review.invalid','Clinical witness','nurse'::app_role,org,true FROM payment_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM payment_fixture UNION ALL SELECT witness,facility,org FROM payment_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM payment_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM payment_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender)
 SELECT resident,facility,org,'Clinical','Fixture','1940-01-01'::date,'female'::gender FROM payment_fixture
 UNION ALL SELECT resident2,facility,org,'Clinical','Second','1940-01-01'::date,'female'::gender FROM payment_fixture;

CREATE TEMP TABLE payment_invoice_fixture AS SELECT gen_random_uuid() invoice, gen_random_uuid() request,f.*,fa.entity_id FROM payment_fixture f JOIN facilities fa ON fa.id=f.facility;
INSERT INTO invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due,status)
 SELECT invoice,resident,facility,org,entity_id,'PAY-'||invoice,current_date,current_date,current_date,current_date,10000,10000,10000,'sent' FROM payment_invoice_fixture;
GRANT SELECT ON payment_fixture,payment_invoice_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; receipt jsonb; repeat_receipt jsonb;
BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,10,'check',p_expected_caller=>f.witness); RAISE EXCEPTION 'Wrong expected caller accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 receipt:=record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor);
 repeat_receipt:=record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor);
 BEGIN UPDATE payments SET amount=amount+1 WHERE id=(receipt->>'payment_id')::uuid; RAISE EXCEPTION 'Payment amount diverged'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Recorded payment financial identity cannot be changed; preserve its receipt and allocation' THEN RAISE; END IF; END;
 BEGIN UPDATE payments SET invoice_id=NULL WHERE id=(receipt->>'payment_id')::uuid; RAISE EXCEPTION 'Payment unlinked'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Recorded payment financial identity cannot be changed; preserve its receipt and allocation' THEN RAISE; END IF; END;
 BEGIN DELETE FROM payments WHERE id=(receipt->>'payment_id')::uuid; RAISE EXCEPTION 'Payment deleted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Recorded payment history cannot be deleted' THEN RAISE; END IF; END;
 UPDATE payments SET deposited=true,deposited_date=current_date,refunded=true,refund_amount=100,notes='Refund metadata retained' WHERE id=(receipt->>'payment_id')::uuid;
 IF receipt IS DISTINCT FROM repeat_receipt OR (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 THEN RAISE EXCEPTION 'Exact retry allocated twice'; END IF;
 BEGIN
  PERFORM record_payment(f.request,f.resident,f.invoice,current_date,4001,'check',p_expected_caller=>f.actor);
  RAISE EXCEPTION 'Altered retry accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Payment request identity was already used with different details' THEN RAISE; END IF; END;
 BEGIN
  PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,6001,'check',p_expected_caller=>f.actor);
  RAISE EXCEPTION 'Overpayment accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Payment must not exceed the current open invoice balance' THEN RAISE; END IF; END;
 BEGIN
  PERFORM record_payment(gen_random_uuid(),f.resident2,f.invoice,current_date,10,'check',p_expected_caller=>f.actor);
  RAISE EXCEPTION 'Wrong resident accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invoice must match the resident, facility, entity and organization' THEN RAISE; END IF; END;
 BEGIN
  PERFORM apply_invoice_payment(f.invoice,1);
  RAISE EXCEPTION 'Legacy allocation bypass accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_table_privilege('authenticated','payments','INSERT') THEN RAISE EXCEPTION 'Direct payment insert remains granted'; END IF;
 IF (SELECT count(*) FROM payments WHERE resident_id=f.resident)<>1 THEN RAISE EXCEPTION 'Rejected requests left payments'; END IF;
 RAISE NOTICE 'PASS: exact receipt, altered retry, overpayment, resident mismatch and direct bypass';
END $$;
RESET ROLE;
-- Test as the privileged replay owner: the guard is independent of grants/RLS.
DO $$ DECLARE f record; original jsonb;
BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 SELECT receipt INTO STRICT original FROM payment_recording_receipts WHERE caller_id=f.actor AND request_id=f.request;
 BEGIN UPDATE payment_recording_receipts SET receipt='{}'::jsonb WHERE caller_id=f.actor AND request_id=f.request; RAISE EXCEPTION 'Privileged receipt update accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'Payment recording receipts are immutable' THEN RAISE; END IF; END;
 BEGIN DELETE FROM payment_recording_receipts WHERE caller_id=f.actor AND request_id=f.request; RAISE EXCEPTION 'Privileged receipt deletion accepted';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'Payment recording receipts are immutable' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM payment_recording_receipts WHERE caller_id=f.actor AND request_id=f.request AND receipt=original) THEN RAISE EXCEPTION 'Receipt immutability lost original evidence'; END IF;
 RAISE NOTICE 'PASS: receipt creation succeeds; privileged UPDATE and DELETE reject without changing evidence';
END $$;
UPDATE invoices SET deleted_at=now() WHERE id=(SELECT invoice FROM payment_invoice_fixture);
UPDATE residents SET deleted_at=now() WHERE id=(SELECT resident FROM payment_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; result jsonb;
BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 result:=record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor);
 IF result->>'payment_id' IS NULL THEN RAISE EXCEPTION 'Committed receipt lost after eligibility change'; END IF;
END $$;
RESET ROLE;
UPDATE invoices SET deleted_at=NULL WHERE id=(SELECT invoice FROM payment_invoice_fixture);
UPDATE residents SET deleted_at=NULL WHERE id=(SELECT resident FROM payment_fixture);
-- Inject each storage failure: the entire function statement must roll back.
CREATE FUNCTION public.review_payment_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected payment failure'; END $$;
CREATE TRIGGER review_payment_fail BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION review_payment_failure();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,100,'cash',p_expected_caller=>f.actor); RAISE EXCEPTION 'failure absent';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected payment failure' THEN RAISE; END IF; END;
 IF (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 OR (SELECT count(*) FROM payment_recording_receipts)<>1 THEN RAISE EXCEPTION 'Payment failure partially committed'; END IF;
END $$;
DROP TRIGGER review_payment_fail ON payments;
CREATE TRIGGER review_invoice_fail BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION review_payment_failure();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,100,'cash',p_expected_caller=>f.actor); RAISE EXCEPTION 'failure absent';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected payment failure' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM payments WHERE resident_id=f.resident)<>1 OR (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 THEN RAISE EXCEPTION 'Invoice failure partially committed'; END IF;
END $$;
DROP TRIGGER review_invoice_fail ON invoices;
CREATE TRIGGER review_receipt_fail BEFORE INSERT ON payment_recording_receipts FOR EACH ROW EXECUTE FUNCTION review_payment_failure();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,100,'cash',p_expected_caller=>f.actor); RAISE EXCEPTION 'failure absent';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected payment failure' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM payments WHERE resident_id=f.resident)<>1 OR (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 THEN RAISE EXCEPTION 'Receipt failure partially committed'; END IF;
END $$;
DROP TRIGGER review_receipt_fail ON payment_recording_receipts;
CREATE TRIGGER review_audit_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION review_payment_failure();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,100,'cash',p_expected_caller=>f.actor); RAISE EXCEPTION 'failure absent';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected payment failure' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM payments WHERE resident_id=f.resident)<>1 OR (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 THEN RAISE EXCEPTION 'Audit failure partially committed'; END IF;
END $$;
DROP TRIGGER review_audit_fail ON audit_log;
-- Reproduce the old split-write defect against the retained legacy helper.
SAVEPOINT baseline_split;
INSERT INTO payments(resident_id,facility_id,organization_id,entity_id,invoice_id,payment_date,amount,payment_method)
 SELECT resident,facility,org,entity_id,invoice,current_date,100,'cash' FROM payment_invoice_fixture;
CREATE TRIGGER review_invoice_fail BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION review_payment_failure();
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM apply_invoice_payment(f.invoice,100);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected payment failure' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM payments WHERE resident_id=f.resident)<>2 OR (SELECT balance_due FROM invoices WHERE id=f.invoice)<>6000 THEN RAISE EXCEPTION 'Legacy baseline not reproduced'; END IF;
 RAISE NOTICE 'BASELINE REPRODUCED: split insert survives allocation failure with invoice balance unchanged';
END $$;
ROLLBACK TO baseline_split;
-- Current facility and organization govern receipt recovery as well as new writes.
UPDATE user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM payment_fixture);
UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM payment_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM payment_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor); RAISE EXCEPTION 'Revoked facility recovered receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM record_payment(gen_random_uuid(),f.resident,f.invoice,current_date,100,'check',p_expected_caller=>f.actor); RAISE EXCEPTION 'Revoked facility recorded payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO organizations(name) VALUES('Payment other organization fixture');
UPDATE user_profiles SET organization_id=(SELECT id FROM organizations WHERE name='Payment other organization fixture') WHERE id=(SELECT actor FROM payment_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM payment_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor); RAISE EXCEPTION 'Changed tenant recovered receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE user_profiles SET app_role='nurse' WHERE id=(SELECT actor FROM payment_fixture);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM payment_fixture f JOIN user_profiles p ON p.id=f.actor;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM payment_invoice_fixture;
 BEGIN PERFORM record_payment(f.request,f.resident,f.invoice,current_date,4000,'check',p_expected_caller=>f.actor); RAISE EXCEPTION 'Nurse recovered payment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: current role denial, source eligibility receipt recovery, payment/invoice/receipt rollback';
END $$;
RESET ROLE;
ROLLBACK;
