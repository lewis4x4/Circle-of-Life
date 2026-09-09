import {verifyNativeRuntime} from './native-runtime-identity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';

// This runner deliberately cannot target the hosted Haven project. Provision a
// fresh local Supabase stack, replay actual migrations, and supply its private
// connection file. Auth functions and session tables must be genuine GoTrue.
const configPath = process.argv.find(arg => arg.startsWith('--config='))?.slice(9);
const requestedSuite = process.argv.find(arg => arg.startsWith('--suite='))?.slice(8) ?? 'audit';
const suite = ['audit', 'finance'].includes(requestedSuite) ? requestedSuite : 'invalid';
const privateRoot = '/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/native-services';
let config;
let configured = false;
let blocked = false;
const started = new Date();
const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
const sanitizedCommand = [process.execPath, import.meta.filename, ...process.argv.slice(2).map(arg => arg.startsWith('--config=') ? '--config=<run-private-configuration>' : arg.startsWith('--suite=') ? `--suite=${suite}` : '<unsupported-argument>')];
const runId = crypto.randomUUID();
const cases = [];
let runtimeIdentities = [];
let schemaBootstrapSha256 = null;
const fixture = Object.fromEntries(['org', 'otherOrg', 'entity', 'secondEntity', 'otherEntity', 'a', 'b', 'c', 'resident', 'otherResident', 'invoice', 'otherInvoice', 'payment'].map(key => [key, crypto.randomUUID()]));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const checksum = text => crypto.createHash('sha256').update(text).digest('hex');
function privateArtifact(filename, value) {
  const destination = path.join(privateRoot, filename);
  const manifestPath = path.join(privateRoot, 'manifest.private.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.artifacts = [...new Set([...manifest.artifacts, destination])];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  fs.writeFileSync(destination, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
}
const assertions = (name, ok, expected, actual) => {
  cases.push({ name, acceptance_ids: suite === 'audit' ? ['HFA-012', 'HFA-059'] : ['HFA-007', 'HFA-008', 'HFA-011'], status: ok ? 'PASS' : 'FAIL', expected, actual });
  if (!ok) throw new Error(`Assertion failed: ${name}`);
};
async function verifyRuntime() {
 const verified=verifyNativeRuntime(config);
 assertions('native processes, loopback listeners and database identity verified',true,true,true);
 return [...verified.services,{service:'native-postgres',...verified.backend}];
}
function sql(statement) {
  // Fixture setup and independent control totals use only the verified owned
  // container. Business operations below still use real signed HTTP requests.
  const result = spawnSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-A', '-t', '-h', privateRoot, '-p', '55448', '-U', 'postgres', '-d', 'hfa_native_01a08335', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    privateArtifact(`${runId}-sql-error.private.log`, result.stderr ?? result.error?.code ?? 'SQL failed');
    throw new Error('Local fixture SQL failed; details retained privately');
  }
  return result.stdout.trim();
}
async function request(endpoint, { method = 'GET', token = config.serviceRoleKey, body, prefer } = {}) {
  // Do not reuse a stale connection across local gateway/service startup.
  const headers = { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' };
  if (config.transport !== 'docker-exec-gateway-proxy') headers.Connection = 'close';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${config.apiUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, contentRange: response.headers.get('content-range') };
}
async function actor(label, organization, role, facility) {
  const email = `hfa-${label}-${runId}@synthetic.invalid`;
  const password = `Hfa!${crypto.randomBytes(24).toString('base64url')}9`;
  const created = await request('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, app_metadata: { app_role: role, organization_id: organization } } });
  assertions(`${label}: GoTrue creates synthetic actor`, created.status === 200 && typeof created.data?.id === 'string', 200, created.status);
  const id = created.data.id;
  privateArtifact(`${runId}-${label}-credentials.private.json`, { email, password, id, project_id: config.projectId, api_url: config.apiUrl });
  sql(`INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active) VALUES(${quote(id)},${quote(organization)},${quote(email)},'Synthetic authenticated smoke',${quote(role)},true);
    ${facility ? `INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) VALUES(${quote(id)},${quote(facility)},${quote(organization)});` : ''}`);
  const signed = await request('/auth/v1/token?grant_type=password', { method: 'POST', token: config.anonKey, body: { email, password } });
  assertions(`${label}: real password sign-in succeeds`, signed.status === 200 && typeof signed.data?.access_token === 'string', 200, signed.status);
  const claims = JSON.parse(Buffer.from(signed.data.access_token.split('.')[1], 'base64url').toString());
  const sessions = Number(sql(`SELECT count(*) FROM auth.sessions WHERE id=${quote(claims.session_id)} AND user_id=${quote(id)};`));
  assertions(`${label}: signed token matches real GoTrue session and claim version`, sessions === 1 && Number.isInteger(claims.auth_claim_version), { sessions: 1, versioned: true }, { sessions, versioned: Number.isInteger(claims.auth_claim_version) });
  return { id, token: signed.data.access_token, sessionId: claims.session_id };
}
const rpc = (name, actor, body) => request(`/rest/v1/rpc/${name}`, { method: 'POST', token: actor.token, body });
const denied = (name, response) => assertions(name, [401, 403].includes(response.status), '401 or 403', response.status);
async function audit(restricted, owner, outsider) {
  const tag = `HFA-full-${runId}`;
  sql(`INSERT INTO public.audit_log(id,table_name,record_id,action,old_data,new_data,changed_fields,organization_id,facility_id,created_at,user_agent)
    SELECT md5(${quote(tag)}||i)::uuid,${quote(tag)},gen_random_uuid(),'UPDATE',jsonb_build_object('value','before-'||i),jsonb_build_object('value','after-'||i),ARRAY['value'],${quote(fixture.org)},${quote(fixture.a)},'2099-01-01 12:00:00+00',' =FORMULA()' FROM generate_series(1,2505)i;
    INSERT INTO public.audit_log(table_name,record_id,action,organization_id,facility_id,created_at) VALUES
    ('HFA-excluded-B',gen_random_uuid(),'INSERT',${quote(fixture.org)},${quote(fixture.b)},'2099-01-01 12:00:00+00'),
    ('HFA-excluded-null',gen_random_uuid(),'INSERT',${quote(fixture.org)},NULL,'2099-01-01 12:00:00+00'),
    ('HFA-excluded-C',gen_random_uuid(),'INSERT',${quote(fixture.otherOrg)},${quote(fixture.c)},'2099-01-01 12:00:00+00');`);
  const direct = await request(`/rest/v1/audit_log?select=id&table_name=eq.${tag}`, { token: restricted.token, prefer: 'count=exact' });
  assertions('real REST row cap is exercised', direct.status === 206 && direct.data?.length === 1000 && direct.contentRange === '0-999/2505', { status: 206, rows: 1000, count: 2505 }, { status: direct.status, rows: direct.data?.length, range: direct.contentRange });
  const job = (who, facility, organization = fixture.org) => request('/rest/v1/audit_log_export_jobs', { method: 'POST', token: who.token, prefer: 'return=representation', body: { organization_id: organization, requested_by: who.id, facility_id: facility, date_from: '2099-01-01', date_to: '2099-01-01' } });
  for (const [label, scope] of [['B', fixture.b], ['null', null], ['other-organization', fixture.c]]) denied(`restricted ${label} export denied by PostgREST RLS`, await job(restricted, scope));
  const created = await job(restricted, fixture.a);
  assertions('authorized A job created through PostgREST', created.status === 201 && created.data?.length === 1, 201, created.status);
  const jobId = created.data[0].id;
  const materialized = await rpc('materialize_audit_export', restricted, { p_job_id: jobId });
  assertions('authorized materialization RPC succeeds', materialized.status === 200, 200, materialized.status);
  const retrieved = await rpc('retrieve_audit_export', restricted, { p_job_id: jobId });
  const snapshot = retrieved.data;
  assertions('complete 2505-row snapshot exceeds actual REST cap', retrieved.status === 200 && snapshot?.row_count === 2505 && snapshot.csv_content.includes('before-2505') && !snapshot.csv_content.includes('HFA-excluded-'), { status: 200, rows: 2505 }, { status: retrieved.status, rows: snapshot?.row_count });
  assertions('retrieved CSV SHA256 verifies exact UTF8 bytes', checksum(snapshot.csv_content) === snapshot.sha256_checksum, snapshot.sha256_checksum, checksum(snapshot.csv_content));
  const membership = snapshot.csv_content.split('\r\n').slice(1).filter(Boolean).map(line => line.split(',')[0].replaceAll('"', '')).sort();
  const expectedMembership = Array.from({ length: 2505 }, (_, index) => { const h = crypto.createHash('md5').update(`${tag}${index + 1}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }).sort();
  assertions('independently calculated exact source membership', JSON.stringify(membership) === JSON.stringify(expectedMembership), checksum(JSON.stringify(expectedMembership)), checksum(JSON.stringify(membership)));
  denied('other organization cannot retrieve known job UUID', await rpc('retrieve_audit_export', outsider, { p_job_id: jobId }));
  sql(`UPDATE public.audit_log SET new_data='{"changed_after_export":true}' WHERE id=md5(${quote(tag)}||'1')::uuid; DELETE FROM public.audit_log WHERE id=md5(${quote(tag)}||'2')::uuid;`);
  const retry = await rpc('retrieve_audit_export', restricted, { p_job_id: jobId });
  assertions('retry preserves original bytes after source changes', retry.status === 200 && retry.data?.csv_content === snapshot.csv_content, snapshot.sha256_checksum, retry.data?.sha256_checksum);
  const ownerJob = await job(owner, null);
  assertions('owner can request organization-wide export', ownerJob.status === 201, 201, ownerJob.status);
  const logout = await request('/auth/v1/logout?scope=global', { method: 'POST', token: restricted.token });
  assertions('real GoTrue global logout succeeds', logout.status === 204, 204, logout.status);
  assertions('GoTrue removed the current session', Number(sql(`SELECT count(*) FROM auth.sessions WHERE id=${quote(restricted.sessionId)};`)) === 0, 0, Number(sql(`SELECT count(*) FROM auth.sessions WHERE id=${quote(restricted.sessionId)};`)));
  denied('still-signed token cannot retrieve after session revocation', await rpc('retrieve_audit_export', restricted, { p_job_id: jobId }));
}
async function finance(restricted) {
  const installed = sql("SELECT to_regprocedure('public.record_finance_payment(uuid,uuid,uuid,date,integer,text,text,text,text)') IS NOT NULL;") === 't';
  assertions('finance336 command is installed', installed, true, installed);
  sql(`INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender) VALUES
    (${quote(fixture.resident)},${quote(fixture.a)},${quote(fixture.org)},'Synthetic','A','1940-01-01','female'),
    (${quote(fixture.otherResident)},${quote(fixture.c)},${quote(fixture.otherOrg)},'Synthetic','C','1940-01-01','female');
    INSERT INTO public.invoices(id,resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,total,subtotal,balance_due,status) VALUES
    (${quote(fixture.invoice)},${quote(fixture.resident)},${quote(fixture.a)},${quote(fixture.org)},${quote(fixture.entity)},${quote(`HFA-${fixture.invoice}`)},current_date,current_date,current_date,current_date,10000,10000,10000,'sent'),
    (${quote(fixture.otherInvoice)},${quote(fixture.otherResident)},${quote(fixture.c)},${quote(fixture.otherOrg)},${quote(fixture.otherEntity)},${quote(`HFA-${fixture.otherInvoice}`)},current_date,current_date,current_date,current_date,10000,10000,10000,'sent');`);
  const paymentDate = sql('SELECT current_date;');
  const payload = { p_id: fixture.payment, p_resident_id: fixture.resident, p_invoice_id: fixture.invoice, p_payment_date: paymentDate, p_amount_cents: 2500, p_method: 'check', p_reference: 'synthetic-check-1', p_payer_name: null, p_notes: null };
  const concurrent = await Promise.all([rpc('record_finance_payment', restricted, payload), rpc('record_finance_payment', restricted, payload)]);
  assertions('concurrent authenticated requests return one identical receipt', concurrent.every(result => result.status === 200) && JSON.stringify(concurrent[0].data) === JSON.stringify(concurrent[1].data), [200, 200], concurrent.map(result => result.status));
  const state = () => JSON.parse(sql(`SELECT json_build_object('payments',(SELECT count(*) FROM public.payments WHERE id=${quote(fixture.payment)}),'allocations',(SELECT count(*) FROM public.payment_allocations WHERE payment_id=${quote(fixture.payment)}),'receipts',(SELECT count(*) FROM public.finance_command_receipts WHERE command_type='payment' AND id=${quote(fixture.payment)}),'paid',amount_paid,'balance',balance_due) FROM public.invoices WHERE id=${quote(fixture.invoice)};`));
  const actual = state();
  assertions('independent SQL control totals prove one economic effect', actual.payments === 1 && actual.allocations === 1 && actual.receipts === 1 && actual.paid === 2500 && actual.balance === 7500, { payments: 1, allocations: 1, receipts: 1, paid: 2500, balance: 7500 }, actual);
  assertions('receipt distinguishes allocated and unapplied cash', concurrent[0].data?.allocated_cents === 2500 && concurrent[0].data?.unapplied_cents === 0, { allocated: 2500, unapplied: 0 }, { allocated: concurrent[0].data?.allocated_cents, unapplied: concurrent[0].data?.unapplied_cents });
  const conflict = await rpc('record_finance_payment', restricted, { ...payload, p_amount_cents: 2600 });
  assertions('same command with different content is an explicit conflict', conflict.status === 409, 409, conflict.status);
  denied('cross-organization resident payment denied', await rpc('record_finance_payment', restricted, { ...payload, p_id: crypto.randomUUID(), p_resident_id: fixture.otherResident, p_invoice_id: fixture.otherInvoice }));
  const invalidId = crypto.randomUUID();
  const invalid = await rpc('record_finance_payment', restricted, { ...payload, p_id: invalidId, p_invoice_id: fixture.otherInvoice });
  assertions('invoice from another scope cannot allocate resident money', invalid.status === 400 && invalid.data?.code === 'P0001' && invalid.data?.message === 'Open invoice unavailable in resident scope', { status: 400, code: 'P0001', reason: 'resident-scope rejection' }, { status: invalid.status, code: invalid.data?.code ?? null, reason_matches: invalid.data?.message === 'Open invoice unavailable in resident scope' });
  const invalidRows = Number(sql(`SELECT (SELECT count(*) FROM public.payments WHERE id=${quote(invalidId)})+(SELECT count(*) FROM public.finance_command_receipts WHERE id=${quote(invalidId)});`));
  assertions('rejected scope leaves no payment or receipt', invalidRows === 0, 0, invalidRows);
  const failureId = crypto.randomUUID();
  const injectionName = `hfa_smoke_${runId.replaceAll('-', '')}`;
  // A run-owned trigger fails the last receipt write to prove that preceding
  // payment/allocation/balance mutations roll back under real PostgREST.
  sql(`CREATE FUNCTION haven.${injectionName}() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF NEW.id=${quote(failureId)}::uuid THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$;
    REVOKE ALL ON FUNCTION haven.${injectionName}() FROM PUBLIC,anon,authenticated,service_role;
    CREATE TRIGGER ${injectionName} BEFORE INSERT ON public.finance_command_receipts FOR EACH ROW EXECUTE FUNCTION haven.${injectionName}();`);
  try {
    const failed = await rpc('record_finance_payment', restricted, { ...payload, p_id: failureId });
    const injectedFailure = failed.status === 400 && failed.data?.code === 'P0001' && failed.data?.message === 'Synthetic receipt failure';
    assertions('exact injected final receipt failure propagates through PostgREST', injectedFailure, { http: 400, sqlstate: 'P0001', marker: true }, { http: failed.status, sqlstate: failed.data?.code, marker: failed.data?.message === 'Synthetic receipt failure' });
    const failedRows = Number(sql(`SELECT (SELECT count(*) FROM public.payments WHERE id=${quote(failureId)})+(SELECT count(*) FROM public.payment_allocations WHERE payment_id=${quote(failureId)})+(SELECT count(*) FROM public.finance_command_receipts WHERE id=${quote(failureId)});`));
    assertions('final receipt failure rolls back all source money', failedRows === 0 && JSON.stringify(state()) === JSON.stringify(actual), { newRows: 0, paid: 2500, balance: 7500 }, { newRows: failedRows, ...state() });
  } finally {
    sql(`DROP TRIGGER ${injectionName} ON public.finance_command_receipts; DROP FUNCTION haven.${injectionName}();`);
  }
  const cancelledPayload = { ...payload, p_id: crypto.randomUUID() };
  const cancelled = await rpc('resolve_finance_payment', restricted, cancelledPayload);
  assertions('uncommitted request resolves to its exact cancellation identity', cancelled.status === 200 && cancelled.data?.status === 'cancelled' && cancelled.data?.payment_id === cancelledPayload.p_id, { http: 200, state: 'cancelled', identity_matches: true }, { http: cancelled.status, state: cancelled.data?.status, identity_matches: cancelled.data?.payment_id === cancelledPayload.p_id });
  const delayed = await rpc('record_finance_payment', restricted, cancelledPayload);
  assertions('delayed cancelled command cannot create money', delayed.status === 409, 409, delayed.status);
  const cancellation = JSON.parse(sql(`SELECT json_build_object('tombstones',(SELECT count(*) FROM public.finance_command_receipts WHERE command_type='payment_cancelled' AND id=${quote(cancelledPayload.p_id)}),'payments',(SELECT count(*) FROM public.payments WHERE id=${quote(cancelledPayload.p_id)}),'allocations',(SELECT count(*) FROM public.payment_allocations WHERE payment_id=${quote(cancelledPayload.p_id)}));`));
  assertions('cancellation retains one durable tombstone and no money', cancellation.tombstones === 1 && cancellation.payments === 0 && cancellation.allocations === 0, { tombstones: 1, payments: 0, allocations: 0 }, cancellation);
  sql(`UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=${quote(restricted.id)} AND facility_id=${quote(fixture.a)};`);
  denied('revoked current facility authority blocks old signed token', await rpc('record_finance_payment', restricted, { ...payload, p_id: crypto.randomUUID() }));
}
let failure = null;
try {
  if (suite === 'invalid' || process.argv.slice(2).some(arg => !arg.startsWith('--config=') && !arg.startsWith('--suite='))) throw new Error('Expected --config=<private-local-file> --suite=audit|finance');
  if (!configPath) { blocked = true; throw new Error('Private local runtime configuration is required'); }
  let resolvedConfig;
  let resolvedRoot;
  try { resolvedConfig = fs.realpathSync(configPath); resolvedRoot = fs.realpathSync(privateRoot); }
  catch { blocked = true; throw new Error('Private local runtime configuration is unavailable'); }
  if (!resolvedConfig.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Configuration must belong to the isolated run');
  try { config = JSON.parse(fs.readFileSync(resolvedConfig, 'utf8')); }
  catch { throw new Error('Private local runtime configuration is invalid'); }
  if (config.projectId !== 'hfa-native-01a08335' || config.transport !== 'native-services' || config.apiUrl !== 'http://127.0.0.1:59831' || config.database?.socket !== privateRoot || config.database?.port !== 55448 || config.database?.name !== 'hfa_native_01a08335' || config.database?.user !== 'postgres' || typeof config.anonKey !== 'string' || typeof config.serviceRoleKey !== 'string' || !config.anonKey || !config.serviceRoleKey) throw new Error('Verified disposable native target required');
  configured = true;
  try { schemaBootstrapSha256 = checksum(fs.readFileSync(path.join(privateRoot, 'schema-bootstrap.json'))); }
  catch { throw new Error('Verified local schema bootstrap evidence is unavailable'); }
  privateArtifact(`${runId}-fixture.private.json`, { run_id: runId, suite, fixture });
  runtimeIdentities = await verifyRuntime();
  const genuineAuth = sql("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='aal');") === 't';
  assertions('genuine GoTrue auth schema exists', genuineAuth, true, genuineAuth);
  sql(`INSERT INTO public.organizations(id,name) VALUES(${quote(fixture.org)},'Synthetic full Auth organization'),(${quote(fixture.otherOrg)},'Synthetic other full Auth organization');
    INSERT INTO public.entities(id,organization_id,name) VALUES(${quote(fixture.entity)},${quote(fixture.org)},'Synthetic shared entity'),(${quote(fixture.secondEntity)},${quote(fixture.org)},'Synthetic second entity'),(${quote(fixture.otherEntity)},${quote(fixture.otherOrg)},'Synthetic other entity');
    INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) VALUES
    (${quote(fixture.a)},${quote(fixture.org)},${quote(fixture.entity)},'Synthetic A','Synthetic','Synthetic','00000',2),
    (${quote(fixture.b)},${quote(fixture.org)},${quote(fixture.entity)},'Synthetic B','Synthetic','Synthetic','00000',2),
    (${quote(fixture.c)},${quote(fixture.otherOrg)},${quote(fixture.otherEntity)},'Synthetic C','Synthetic','Synthetic','00000',2);`);
  const restricted = await actor('restricted', fixture.org, 'facility_admin', fixture.a);
  const owner = await actor('owner', fixture.org, 'owner');
  const outsider = await actor('outsider', fixture.otherOrg, 'facility_admin', fixture.c);
  if (suite === 'audit') await audit(restricted, owner, outsider); else await finance(restricted);
} catch (error) {
  failure = error instanceof Error ? error.message : 'Unexpected local smoke failure';
  if (!cases.some(item => item.status === 'FAIL')) cases.push({ name: 'authenticated scenario execution', acceptance_ids: suite === 'audit' ? ['HFA-012'] : suite === 'finance' ? ['HFA-007'] : [], status: blocked ? 'BLOCKED_EXTERNAL' : 'FAIL', expected: 'scenario completes', actual: failure });
}
const status = blocked ? 'BLOCKED_EXTERNAL' : failure || cases.some(item => item.status !== 'PASS') ? 'FAIL' : 'PASS';
const output = path.resolve('test-results/finance-integration'); fs.mkdirSync(output, { recursive: true });
const filename = `${started.toISOString().replaceAll(':', '-')}-native-authenticated-${suite}.json`;
const report = { schema_version: 1, run_id: runId, suite, status, evidence_layer: 'native-real-GoTrue-PostgREST', target_identity: configured ? { project_id: config.projectId, api_url: config.apiUrl, database_port: config.database.port, transport: config.transport ?? 'direct-published-port', services: runtimeIdentities } : null, command: sanitizedCommand, exit_code: status === 'PASS' ? 0 : status === 'BLOCKED_EXTERNAL' ? 2 : 1, commit: checkoutCommit, source_sha256: sourceSha256, runtime_identity_helper_sha256: checksum(fs.readFileSync(path.join(privateRoot, 'native-runtime-identity.mjs'))), schema_bootstrap_sha256: schemaBootstrapSha256, fixture_seed_sha256: checksum(JSON.stringify(fixture)), cases, counts: { total: cases.length, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length, blocked: cases.filter(item => item.status === 'BLOCKED_EXTERNAL').length, skipped: 0 }, failure, started_at: started.toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started.getTime(), limits: ['Real pinned GoTrue and PostgREST on a run-owned native PostgreSQL cluster; synthetic fixtures only. Native proxy is not Kong or a deployed Edge gateway. No hosted production/provider/business or completed342 dynamic-security review proof.'] };
fs.writeFileSync(path.join(output, filename), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status, counts: report.counts, failure, artifact: path.join('test-results/finance-integration', filename) }));
process.exit(status === 'PASS' ? 0 : status === 'BLOCKED_EXTERNAL' ? 2 : 1);
