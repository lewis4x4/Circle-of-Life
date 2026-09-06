#!/usr/bin/env node
// Verify migration 318 on synthetic rows, never on the linked project.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = `haven-col-name-test-${process.pid}-${Date.now()}`;
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 2 ** 22 });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout.trim();
}
function sql(source) {
  return docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-qAt'], source);
}
function assert(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
}
const migration = readFileSync(`${root}supabase/migrations/318_col_facility_entity_names.sql`, 'utf8');
const audit = readFileSync(`${root}supabase/migrations/006_audit_triggers.sql`, 'utf8')
  .split('-- BEFORE UPDATE: timestamps')[0];
const org = '00000000-0000-0000-0000-000000000001';
const otherOrg = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const fid = n => `00000000-0000-0000-0002-${String(n).padStart(12, '0')}`;
const eid = n => `00000000-0000-0000-0001-${String(n).padStart(12, '0')}`;

try {
  docker(['run', '-d', '--name', container, '--network', 'none', '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine']);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
    if (r.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  sql(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE entities (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL,
      dba_name text, deleted_at timestamptz, updated_at timestamptz DEFAULT now(), updated_by uuid,
      fein text DEFAULT 'SYNTHETIC-UNCHANGED');
    CREATE TABLE facilities (id uuid PRIMARY KEY, entity_id uuid NOT NULL REFERENCES entities,
      organization_id uuid NOT NULL, name text NOT NULL, deleted_at timestamptz,
      updated_at timestamptz DEFAULT now(), updated_by uuid);
    INSERT INTO entities(id,organization_id,name,dba_name) VALUES
      ('${eid(1)}','${org}','Pine House, Inc.','Oakridge ALF'),
      ('${eid(2)}','${org}','Smith & Sorensen LLC','Rising Oaks ALF'),
      ('${eid(3)}','${org}','Sorensen, Smith & Bay, LLC','Homewood Lodge, ALF'),
      ('${eid(4)}','${org}','The Plantation on Summers, LLC','Plantation ALF'),
      ('${eid(5)}','${org}','Grande Cypress ALF LLC',NULL),
      ('${eid(6)}','${otherOrg}','Synthetic outside entity','Outside');
    INSERT INTO facilities(id,entity_id,organization_id,name) VALUES
      ('${fid(1)}','${eid(1)}','${org}','Oakridge ALF'),
      ('${fid(2)}','${eid(2)}','${org}','Rising Oaks ALF'),
      ('${fid(3)}','${eid(3)}','${org}','Homewood Lodge ALF'),
      ('${fid(4)}','${eid(4)}','${org}','Plantation ALF'),
      ('${fid(5)}','${eid(5)}','${org}','Grande Cypress ALF'),
      ('${fid(6)}','${eid(6)}','${otherOrg}','Synthetic outside facility');
  `);
  sql(audit);
  for (const table of ['entities', 'facilities']) {
    sql(`CREATE TRIGGER tr_${table}_set_updated_at BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION haven_set_updated_at();
      CREATE TRIGGER tr_${table}_audit AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();`);
  }
  function expectPreflightFailure() {
    let rejected = false;
    try { sql(migration); } catch (error) {
      if (!String(error).includes('COL name alignment preflight failed')) throw error;
      rejected = true;
    }
    assert(rejected, 'unexpected mapping must reject entire migration');
    assert(sql(`SELECT name FROM facilities WHERE id='${fid(4)}'`) === 'Plantation ALF', 'no partial rename');
  }
  sql(`UPDATE facilities SET name='Unexpected operator edit' WHERE id='${fid(1)}'`);
  expectPreflightFailure();
  sql(`UPDATE facilities SET name='Oakridge ALF' WHERE id='${fid(1)}';
    UPDATE entities SET organization_id='${otherOrg}' WHERE id='${eid(5)}'`);
  expectPreflightFailure();
  sql(`UPDATE entities SET organization_id='${org}' WHERE id='${eid(5)}'`);
  const before = Number(sql('SELECT count(*) FROM audit_log'));
  sql(migration);
  const after = Number(sql('SELECT count(*) FROM audit_log'));
  assert(after - before === 5, 'exactly five changed rows audited');
  assert(sql(`SELECT name FROM facilities WHERE id='${fid(3)}'`) === 'Homewood Lodge, ALF', 'Homewood label');
  assert(sql(`SELECT name FROM facilities WHERE id='${fid(4)}'`) === 'The Plantation on Summers', 'Plantation label');
  assert(sql(`SELECT name FROM entities WHERE id='${eid(3)}'`) === 'Sorensen, Smith & Bay LLC', 'LLC spelling');
  assert(sql(`SELECT dba_name FROM entities WHERE id='${eid(4)}'`) === 'The Plantation on Summers', 'Plantation DBA');
  assert(sql(`SELECT dba_name FROM entities WHERE id='${eid(5)}'`) === 'Grande Cypress ALF', 'Grande Cypress DBA');
  assert(sql(`SELECT count(*) FROM entities WHERE fein='SYNTHETIC-UNCHANGED'`) === '6', 'tax identifiers untouched');
  assert(sql(`SELECT name FROM facilities WHERE id='${fid(6)}'`) === 'Synthetic outside facility', 'other organization untouched');
  sql(migration);
  assert(Number(sql('SELECT count(*) FROM audit_log')) === after, 'replay creates no duplicate updates');
  console.log('PASS: name drift and org mismatch rollback, five exact audited changes, unchanged tax/other-org data, idempotent replay');
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
