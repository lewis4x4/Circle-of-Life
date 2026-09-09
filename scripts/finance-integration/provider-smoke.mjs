import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkQboIdentity } from './qbo-identity.mjs';
// No write transport exists here. Approved commands belong to F03/F05.
const allowed = new Set(['--provider=qbo', '--mode=read-only']);
if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw new Error('Only QBO read-only smoke is implemented');
const started = new Date();
const environment = process.env.HFA_QBO_ENVIRONMENT ?? 'sandbox';
const outcome = await checkQboIdentity({ environment, realm: process.env.HFA_QBO_REALM_ID,
  expectedRealm: process.env.HFA_QBO_EXPECTED_REALM_ID, token: process.env.HFA_QBO_ACCESS_TOKEN,
  expectedCompanyInfoId: process.env.HFA_QBO_EXPECTED_COMPANY_INFO_ID,
  expectedCompanyNameHash: process.env.HFA_QBO_EXPECTED_COMPANY_NAME_SHA256 });
const exitCode = outcome.status === 'PASS' ? 0 : outcome.status === 'BLOCKED_EXTERNAL' ? 2 : 1;
const report = { schema_version: 1, acceptance_ids: ['HFA-002', 'HFA-028'], mode: 'read-only', environment,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started_at: started.toISOString(), ...outcome,
  counts: { passed: outcome.checks.filter(check => check.status === 'PASS').length, failed: outcome.checks.filter(check => check.status === 'FAIL').length, skipped: 0 },
  limits: ['Company identity smoke only; not complete import, posting, reconciliation or business acceptance.'],
  completed_at: new Date().toISOString(), duration_ms: Date.now() - started.getTime(), exit_code: exitCode };
const directory = path.resolve('test-results/finance-integration'); fs.mkdirSync(directory, { recursive: true });
// Filename labels are fixed even for invalid supplied configuration.
const label = ['sandbox', 'production'].includes(environment) ? environment : 'invalid';
const filename = path.join(directory, `${started.toISOString().replaceAll(':', '-')}-provider-${label}.json`);
fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, counts: report.counts, artifact: path.relative(process.cwd(), filename) }));
process.exit(exitCode);
