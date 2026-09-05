#!/usr/bin/env node
// Disposable SQL regression: no production connection or environment credentials.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = `haven-referral-closure-${process.pid}-${Date.now()}`;
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 2 ** 22 });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout;
}
function sql(source) {
  return docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], source);
}
function migration(name) {
  return readFileSync(`${root}supabase/migrations/${name}`, 'utf8');
}

try {
  docker(['run', '-d', '--name', container, '--network', 'none', '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine']);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
    if (r.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  sql(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TYPE app_role AS ENUM ('owner','org_admin','facility_admin','nurse','caregiver','family');
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE facilities (id uuid PRIMARY KEY, organization_id uuid, deleted_at timestamptz);
    CREATE TABLE user_profiles (id uuid PRIMARY KEY, organization_id uuid, app_role app_role);
    CREATE TABLE user_facility_access (user_id uuid, facility_id uuid, revoked_at timestamptz);
    CREATE TABLE family_resident_links (user_id uuid, resident_id uuid, revoked_at timestamptz);
    CREATE TABLE residents (id uuid PRIMARY KEY, referral_source_id uuid);
    CREATE FUNCTION test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
      $$ SELECT lpad(n::text,32,'0')::uuid $$;
    CREATE FUNCTION test_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
      RAISE NOTICE 'PASS: %', label;
    END $$;
    CREATE FUNCTION test_error(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      BEGIN EXECUTE statement;
      EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN RETURN; END IF;
        RAISE;
      END;
      RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded', expected_state;
    END $$;
  `);
  sql(migration('004_haven_rls_helpers.sql'));
  // Real audit functions/table; foundation triggers target tables outside this fixture.
  sql(migration('006_audit_triggers.sql').split('-- BEFORE UPDATE: timestamps')[0]);
  sql(migration('075_referral_inquiry_schema.sql'));
  sql(migration('076_referral_inquiry_rls_audit.sql'));
  sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO organizations VALUES (test_id(10)), (test_id(20));
    INSERT INTO facilities VALUES (test_id(101),test_id(10),NULL),
      (test_id(102),test_id(10),NULL),(test_id(201),test_id(20),NULL);
    INSERT INTO auth.users SELECT test_id(n) FROM generate_series(1,4) n;
    INSERT INTO user_profiles VALUES (test_id(1),test_id(10),'owner'),
      (test_id(2),test_id(10),'nurse'),(test_id(3),test_id(20),'owner'),
      (test_id(4),test_id(10),'family');
    INSERT INTO user_facility_access VALUES (test_id(2),test_id(101),NULL);
    INSERT INTO referral_leads(id,organization_id,facility_id,first_name,last_name,status)
      VALUES (test_id(501),test_id(10),test_id(101),'Synthetic','A','lost'),
      (test_id(502),test_id(10),test_id(102),'Synthetic','B','new'),
      (test_id(503),test_id(20),test_id(201),'Synthetic','C','new');
  `);
  sql(migration('317_referral_lead_closure_reasons.sql'));
  sql(`
    SELECT test_assert((SELECT count(*)=0 FROM referral_closure_reasons), 'no guessed vocabulary');
    SELECT test_assert((SELECT closed_at IS NULL FROM referral_leads WHERE id=test_id(501)), 'legacy lost lead preserved');
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub',test_id(1)::text,false);
    INSERT INTO referral_closure_reasons(id,organization_id,code,label,closed_by_party)
      VALUES (test_id(1001),test_id(10),'test_prospect','Synthetic prospect reason','prospect'),
      (test_id(1002),test_id(10),'test_facility','Synthetic facility reason','facility');
    SELECT test_error($q$INSERT INTO referral_closure_reasons(organization_id,code,label,closed_by_party)
      VALUES(test_id(20),'wrong_org','Synthetic','prospect')$q$, '42501');
    SELECT set_config('request.jwt.claim.sub',test_id(3)::text,false);
    INSERT INTO referral_closure_reasons(id,organization_id,code,label,closed_by_party)
      VALUES (test_id(2001),test_id(20),'test_other_org','Synthetic other org','prospect');
    SELECT test_assert((SELECT count(*)=1 FROM referral_closure_reasons), 'catalog org isolation');
    SELECT set_config('request.jwt.claim.sub',test_id(1)::text,false);
    SELECT test_error($q$UPDATE referral_leads SET status='lost',closed_at=now(),closed_by_party='prospect',
      closure_reason_id=test_id(2001) WHERE id=test_id(501)$q$, '23503');
    SELECT test_error($q$UPDATE referral_leads SET status='lost',closed_at=now(),closed_by_party='facility',
      closure_reason_id=test_id(1001) WHERE id=test_id(501)$q$, '23503');
    SELECT test_error($q$UPDATE referral_leads SET closed_by_party='prospect',closure_reason_id=test_id(1001)
      WHERE id=test_id(501)$q$, '23514');
    SELECT test_error($q$UPDATE referral_leads SET closed_at=now(),closed_by_party='facility',
      closure_reason_id=test_id(1002),competitor_chosen='Synthetic' WHERE id=test_id(501)$q$, '23514');
    UPDATE referral_leads SET closed_at=now(),closed_by_party='prospect',closure_reason_id=test_id(1001),
      competitor_chosen='Synthetic competitor' WHERE id=test_id(501);
    SELECT test_assert((SELECT closure_reason_id=test_id(1001) FROM referral_leads WHERE id=test_id(501)),
      'same org and party closure accepted');
    SELECT test_error($q$UPDATE referral_leads SET status='contacted' WHERE id=test_id(501)$q$,'23514');
    UPDATE referral_leads SET status='contacted',closed_at=NULL,closed_by_party=NULL,
      closure_reason_id=NULL,closure_note=NULL,competitor_chosen=NULL WHERE id=test_id(501);
    SELECT test_assert((SELECT status='contacted' FROM referral_leads WHERE id=test_id(501)), 'explicit reopen');
    SELECT set_config('request.jwt.claim.sub',test_id(2)::text,false);
    SELECT test_assert((SELECT count(*)=2 FROM referral_closure_reasons), 'nurse reads org vocabulary');
    SELECT test_error($q$INSERT INTO referral_closure_reasons(organization_id,code,label,closed_by_party)
      VALUES(test_id(10),'nurse_write','Synthetic','prospect')$q$,'42501');
    WITH changed AS (UPDATE referral_leads SET status='lost',closed_at=now(),closed_by_party='facility',
      closure_reason_id=test_id(1002) WHERE id=test_id(502) RETURNING id)
    SELECT test_assert((SELECT count(*)=0 FROM changed), 'cross facility closure denied');
    WITH changed AS (UPDATE referral_leads SET status='lost',closed_at=now(),closed_by_party='facility',
      closure_reason_id=test_id(1002) WHERE id=test_id(501) RETURNING id)
    SELECT test_assert((SELECT count(*)=1 FROM changed), 'nurse closes accessible facility lead');
    SELECT test_error($q$DELETE FROM referral_closure_reasons WHERE id=test_id(1001)$q$,'42501');
    SELECT set_config('request.jwt.claim.sub',test_id(4)::text,false);
    SELECT test_assert((SELECT count(*)=0 FROM referral_closure_reasons), 'family has no catalog access');
    SELECT set_config('request.jwt.claim.sub',test_id(1)::text,false);
    UPDATE referral_closure_reasons SET label='Synthetic renamed reason' WHERE id=test_id(1001);
    UPDATE referral_closure_reasons SET is_active=false WHERE id=test_id(1001);
    SELECT test_assert((SELECT count(*)=1 FROM referral_closure_reasons WHERE is_active), 'retired reason excluded from active vocabulary');
    RESET ROLE;
    SELECT test_assert((SELECT count(*)=2 FROM audit_log WHERE table_name='referral_closure_reasons'
      AND record_id=test_id(1001) AND action='UPDATE'), 'catalog updates audited');
    SELECT test_assert((SELECT count(*)>=3 FROM audit_log WHERE table_name='referral_leads'
      AND record_id=test_id(501) AND action='UPDATE'), 'closure and reopen audited');
    UPDATE referral_closure_reasons SET deleted_at=now() WHERE id=test_id(1001);
    SELECT test_assert((SELECT count(*)=1 FROM referral_closure_reasons WHERE id=test_id(1001)
      AND deleted_at IS NOT NULL), 'privileged soft deletion retains catalog row');
    SET ROLE authenticated;
    SELECT test_assert((SELECT count(*)=1 FROM referral_closure_reasons), 'soft deleted reason hidden');
    RESET ROLE;
    SET ROLE anon;
    SELECT test_error('SELECT * FROM referral_closure_reasons','42501');
  `);
  console.log('PASS: referral closure SQL, org/party integrity, facility RLS, legacy compatibility, soft deletes, and real audit triggers');
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
