-- Synthetic local replay only: all fixture writes roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT,INSERT,UPDATE ON journal_entries,journal_entry_lines,gl_accounts,entity_gl_settings,gl_posting_rules,gl_period_closes,invoices,payments TO authenticated;
GRANT SELECT,UPDATE ON entities,facilities TO authenticated;
GRANT SELECT ON family_resident_links,residents TO authenticated;
CREATE TEMP TABLE gl_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,gen_random_uuid() invoice,
 gen_random_uuid() payment,gen_random_uuid() debit,gen_random_uuid() credit,gen_random_uuid() cash,
 r.id resident,r.facility_id facility,r.organization_id org,f.entity_id entity
 FROM residents r JOIN facilities f ON f.id=r.facility_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"GL reviewer"}' FROM gl_fixture;
INSERT INTO user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','GL reviewer','owner',org,true FROM gl_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM gl_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM gl_fixture;
INSERT INTO gl_accounts(id,organization_id,entity_id,code,name,account_type)
 SELECT debit,org,entity,debit::text,'GL AR','asset'::gl_account_type FROM gl_fixture UNION ALL
 SELECT credit,org,entity,credit::text,'GL Revenue','revenue'::gl_account_type FROM gl_fixture UNION ALL
 SELECT cash,org,entity,cash::text,'GL Cash','asset'::gl_account_type FROM gl_fixture;
INSERT INTO entity_gl_settings(organization_id,entity_id,accounts_receivable_id,revenue_id,cash_id)
 SELECT org,entity,debit,credit,cash FROM gl_fixture ON CONFLICT(entity_id) DO UPDATE SET accounts_receivable_id=excluded.accounts_receivable_id,revenue_id=excluded.revenue_id,cash_id=excluded.cash_id;
UPDATE gl_posting_rules SET is_active=false WHERE entity_id=(SELECT entity FROM gl_fixture);
INSERT INTO invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due)
 SELECT invoice,resident,facility,org,entity,invoice::text,'2090-01-15','2090-01-30',(date '2090-01-01'+(SELECT count(*)::int FROM invoices)),(date '2090-01-31'+(SELECT count(*)::int FROM invoices)),1000,1000,1000 FROM gl_fixture;
INSERT INTO payments(id,resident_id,facility_id,organization_id,entity_id,payment_date,amount,payment_method)
 SELECT payment,resident,facility,org,entity,'2090-01-15',1000,'cash' FROM gl_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true)
 FROM gl_fixture f JOIN user_profiles p ON p.id=f.actor;
GRANT SELECT ON gl_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; result jsonb; repeated jsonb; jid uuid;
BEGIN
 SELECT * INTO f FROM gl_fixture;
 BEGIN PERFORM haven.lock_source_gl_journal(NULL,f.invoice); RAISE EXCEPTION 'NULL helper source type accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM post_source_to_gl(NULL,f.invoice); RAISE EXCEPTION 'NULL posting source type accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Unsupported GL source' THEN RAISE; END IF; END;
 INSERT INTO journal_entries(organization_id,entity_id,facility_id,entry_date) VALUES(f.org,f.entity,f.facility,'2090-01-15') RETURNING id INTO jid;
 BEGIN PERFORM haven.source_gl_line_state(jid,1000,NULL,NULL); RAISE EXCEPTION 'NULL stored source type accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: NULL posting/helper input and NULL stored journal source type reject';
 result:=post_source_to_gl('invoice',f.invoice); repeated:=post_source_to_gl('invoice',f.invoice);
 IF (result->>'already_posted')::boolean OR NOT (repeated->>'already_posted')::boolean OR result->>'journal_entry_id'<>repeated->>'journal_entry_id' THEN RAISE EXCEPTION 'Posting retry failed'; END IF;
 jid:=(result->>'journal_entry_id')::uuid;
 IF (SELECT count(*) FROM journal_entry_lines WHERE journal_entry_id=jid)<>2 OR NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=jid AND status='posted' AND posted_by=f.actor AND posted_at IS NOT NULL) THEN RAISE EXCEPTION 'Posting evidence absent'; END IF;
 UPDATE entity_gl_settings SET accounts_receivable_id=f.cash WHERE entity_id=f.entity;
 PERFORM post_source_to_gl('invoice',f.invoice); -- Historical accounts survive current configuration changes.
 UPDATE entity_gl_settings SET accounts_receivable_id=f.debit WHERE entity_id=f.entity;
 UPDATE invoices SET total=1001 WHERE id=f.invoice;
 BEGIN PERFORM post_source_to_gl('invoice',f.invoice); RAISE EXCEPTION 'Changed source accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Changed source accepted' THEN RAISE; END IF; END;
 UPDATE invoices SET total=1000 WHERE id=f.invoice;
 result:=post_source_to_gl('payment',f.payment);
 IF NOT EXISTS(SELECT 1 FROM journal_entry_lines WHERE journal_entry_id=(result->>'journal_entry_id')::uuid AND gl_account_id=f.cash AND debit_cents=1000) THEN RAISE EXCEPTION 'Payment defaults failed'; END IF;
 RAISE NOTICE 'PASS: invoice/payment atomic posting, exact retry, current-source mismatch, historical configuration';
END $$;
RESET ROLE;
-- Every scenario starts from an unposted source without deleting any financial history.
DO $$ DECLARE f record; inv uuid; jid uuid; result jsonb; before_ids uuid[]; scenario text;
BEGIN
 SELECT * INTO f FROM gl_fixture;
 FOREACH scenario IN ARRAY ARRAY['empty','valid','unbalanced','balanced_wrong','deleted_history','voided','rule'] LOOP
  inv:=gen_random_uuid(); jid:=gen_random_uuid();
  INSERT INTO invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due)
   VALUES(inv,f.resident,f.facility,f.org,f.entity,inv::text,'2090-01-15','2090-01-30',(date '2090-01-01'+(SELECT count(*)::int FROM invoices)),(date '2090-01-31'+(SELECT count(*)::int FROM invoices)),1000,1000,1000);
  INSERT INTO journal_entries(id,organization_id,entity_id,facility_id,entry_date,source_type,source_id,status)
   VALUES(jid,f.org,f.entity,f.facility,'2090-01-15','invoice',inv,CASE WHEN scenario='voided' THEN 'voided'::journal_entry_status ELSE 'draft'::journal_entry_status END);
  IF scenario IN('valid','unbalanced','balanced_wrong','deleted_history') THEN
   INSERT INTO journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,debit_cents,credit_cents)
    VALUES(jid,f.org,f.debit,1,CASE WHEN scenario='balanced_wrong' THEN 999 ELSE 1000 END,0),
     (jid,f.org,f.credit,2,0,CASE WHEN scenario IN('unbalanced','balanced_wrong') THEN 999 ELSE 1000 END);
  END IF;
  IF scenario='deleted_history' THEN UPDATE journal_entry_lines SET deleted_at=now() WHERE journal_entry_id=jid; END IF;
  IF scenario='rule' THEN INSERT INTO gl_posting_rules(organization_id,entity_id,event_type,debit_gl_account_id,credit_gl_account_id) VALUES(f.org,f.entity,'invoice',f.cash,f.credit); END IF;
  SELECT array_agg(id ORDER BY id) INTO before_ids FROM journal_entry_lines WHERE journal_entry_id=jid;
  IF scenario IN('empty','valid','rule') THEN
   EXECUTE 'SET LOCAL ROLE authenticated';
   result:=post_source_to_gl('invoice',inv);
   EXECUTE 'RESET ROLE';
   IF (result->>'journal_entry_id')::uuid<>jid OR (result->>'already_posted')::boolean THEN RAISE EXCEPTION 'Recovery identity failed'; END IF;
   IF scenario='valid' AND before_ids IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM journal_entry_lines WHERE journal_entry_id=jid) THEN RAISE EXCEPTION 'Lines replaced'; END IF;
   IF scenario='rule' AND NOT EXISTS(SELECT 1 FROM journal_entry_lines WHERE journal_entry_id=jid AND gl_account_id=f.cash AND debit_cents=1000) THEN RAISE EXCEPTION 'Rule precedence failed'; END IF;
  ELSE
   EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Unsafe recovery accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unsafe recovery accepted' OR position(jid::text in SQLERRM)=0 THEN RAISE; END IF; END;
   EXECUTE 'RESET ROLE';
   IF before_ids IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM journal_entry_lines WHERE journal_entry_id=jid) THEN RAISE EXCEPTION 'Failure destroyed history'; END IF;
  END IF;
 END LOOP;
 RAISE NOTICE 'PASS: empty and exact draft recovery retain identity; ambiguous, wrong totals, deleted history, voided reject without deletion; rule precedence';
END $$;
RESET ROLE;
-- Failure injection proves no header/line/audit survives a rejected statement.
CREATE FUNCTION public.review_gl_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected GL failure'; END $$;
DO $$ DECLARE f record; inv uuid; target text; h bigint; l bigint; a bigint;
BEGIN
 SELECT * INTO f FROM gl_fixture;
 inv:=gen_random_uuid();
 INSERT INTO invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due)
 VALUES(inv,f.resident,f.facility,f.org,f.entity,inv::text,'2090-01-15','2090-01-30',(date '2090-01-01'+(SELECT count(*)::int FROM invoices)),(date '2090-01-31'+(SELECT count(*)::int FROM invoices)),1000,1000,1000);
 SELECT count(*) INTO h FROM journal_entries; SELECT count(*) INTO l FROM journal_entry_lines; SELECT count(*) INTO a FROM audit_log;
 FOREACH target IN ARRAY ARRAY['journal_entries','journal_entry_lines','audit_log'] LOOP
  EXECUTE format('CREATE TRIGGER review_gl_fail BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION review_gl_failure()',target);
  BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Failure absent'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected GL failure' THEN RAISE; END IF; END;
  EXECUTE format('DROP TRIGGER review_gl_fail ON %I',target);
  IF (SELECT count(*) FROM journal_entries)<>h OR (SELECT count(*) FROM journal_entry_lines)<>l OR (SELECT count(*) FROM audit_log)<>a THEN RAISE EXCEPTION 'Partial financial writes after % failure',target; END IF;
 END LOOP;
 -- Failure at the final posted transition also rolls back header and lines.
 CREATE TRIGGER review_gl_fail BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION review_gl_failure();
 BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Failure absent'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected GL failure' THEN RAISE; END IF; END;
 DROP TRIGGER review_gl_fail ON journal_entries;
 IF (SELECT count(*) FROM journal_entries)<>h OR (SELECT count(*) FROM journal_entry_lines)<>l OR (SELECT count(*) FROM audit_log)<>a THEN RAISE EXCEPTION 'Partial writes after post failure'; END IF;
 UPDATE gl_accounts SET is_active=false WHERE id=f.cash;
 BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Inactive account accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Inactive account accepted' THEN RAISE; END IF; END;
 UPDATE gl_accounts SET is_active=true WHERE id=f.cash;
 INSERT INTO gl_period_closes(organization_id,entity_id,period_year,period_month,status) VALUES(f.org,f.entity,2090,1,'closed');
 BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Closed period accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Accounting period is closed' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM journal_entries WHERE source_id=inv) THEN RAISE EXCEPTION 'Closed period left draft'; END IF;
 UPDATE gl_period_closes SET status='open' WHERE entity_id=f.entity AND period_year=2090 AND period_month=1;
 UPDATE invoices SET entity_id=(SELECT id FROM entities WHERE id<>f.entity LIMIT 1) WHERE id=inv;
 BEGIN PERFORM post_source_to_gl('invoice',inv); RAISE EXCEPTION 'Cross-entity source accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-entity source accepted' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: header/line/audit/final-post failures roll back; inactive account, closed period, source entity mismatch reject';
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; jid uuid:=gen_random_uuid(); line_id uuid; posted_id uuid;
BEGIN
 SELECT * INTO f FROM gl_fixture;
 -- Legitimate manual journals retain multi-line accounting and direct posting.
 INSERT INTO journal_entries(id,organization_id,entity_id,facility_id,entry_date,source_type) VALUES(jid,f.org,f.entity,f.facility,'2090-01-15','manual');
 INSERT INTO journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,debit_cents,credit_cents)
 VALUES(jid,f.org,f.debit,1,600,0),(jid,f.org,f.cash,2,400,0),(jid,f.org,f.credit,3,0,1000);
 UPDATE gl_period_closes SET status='closed' WHERE entity_id=f.entity AND period_year=2090 AND period_month=1;
 BEGIN UPDATE journal_entries SET status='posted' WHERE id=jid; RAISE EXCEPTION 'Manual closed-period bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Accounting period is closed' THEN RAISE; END IF; END;
 UPDATE gl_period_closes SET status='open' WHERE entity_id=f.entity AND period_year=2090 AND period_month=1;
 UPDATE journal_entries SET status='posted' WHERE id=jid;
 IF NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=jid AND posted_by=f.actor AND posted_at IS NOT NULL) THEN RAISE EXCEPTION 'Manual posting failed'; END IF;
 posted_id:=jid; jid:=gen_random_uuid();
 INSERT INTO journal_entries(id,organization_id,entity_id,facility_id,entry_date,source_type) VALUES(jid,f.org,f.entity,f.facility,'2090-01-15','manual');
 SELECT id INTO line_id FROM journal_entry_lines WHERE journal_entry_id=posted_id LIMIT 1;
 -- RLS normally denies; privileged fixture below separately exercises trigger.
 BEGIN INSERT INTO journal_entries(organization_id,entity_id,entry_date,status) VALUES(f.org,f.entity,'2090-01-15','posted'); RAISE EXCEPTION 'Direct posted insert accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Direct posted insert accepted' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: legitimate three-line manual journal posts; manual closed-period bypass and direct posted INSERT fail';
END $$;
RESET ROLE;
DO $$ DECLARE f record; target uuid; line_id uuid;
BEGIN
 SELECT * INTO f FROM gl_fixture;
 SELECT id INTO target FROM journal_entries WHERE source_type='manual' AND status='draft' AND organization_id=f.org ORDER BY created_at DESC LIMIT 1;
 SELECT l.id INTO line_id FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.source_id=f.invoice LIMIT 1;
 BEGIN UPDATE journal_entry_lines SET journal_entry_id=target WHERE id=line_id; RAISE EXCEPTION 'Posted parent reparent accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Cannot change lines unless both journal parents are draft' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: line reparent trigger protects old posted parent even with privileged writes';
END $$;
SAVEPOINT authority;
UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM gl_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM post_source_to_gl('invoice',(SELECT invoice FROM gl_fixture)); RAISE EXCEPTION 'Inactive actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT authority;
UPDATE user_profiles SET app_role='facility_admin' WHERE id=(SELECT actor FROM gl_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM post_source_to_gl('invoice',(SELECT invoice FROM gl_fixture)); RAISE EXCEPTION 'Facility role posted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT authority;
UPDATE user_profiles SET organization_id=(SELECT id FROM organizations WHERE id<>(SELECT org FROM gl_fixture) LIMIT 1) WHERE id=(SELECT actor FROM gl_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM post_source_to_gl('invoice',(SELECT invoice FROM gl_fixture)); RAISE EXCEPTION 'Changed tenant read receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT authority;
DO $$ BEGIN RAISE NOTICE 'PASS: current actor deactivation, role and tenant changes reject original receipt'; END $$;
ROLLBACK;
