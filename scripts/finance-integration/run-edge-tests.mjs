import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const started = new Date();
const testFile = 'supabase/functions/export-audit-log/handler.test.ts';
const command = ['deno', 'test', '--allow-env=CORS_ALLOWED_ORIGINS', '--reporter=junit', testFile];
const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const xml = result.stdout ?? '';
const cases = [...xml.matchAll(/<testcase\s+([^>]+)>([\s\S]*?)<\/testcase>/g)].map(match => ({
  name: match[1].match(/\bname="([^"]*)"/)?.[1] ?? 'unknown', acceptance_ids: ['HFA-012', 'HFA-059'],
  status: /<(failure|error)\b/.test(match[2]) ? 'FAIL' : /<skipped\b/.test(match[2]) ? 'SKIP' : 'PASS',
}));
const status = result.status === 0 && cases.length > 0 && cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
const directory = path.resolve('test-results/finance-integration'); fs.mkdirSync(directory, { recursive: true });
const prefix = `${started.toISOString().replaceAll(':', '-')}-audit-edge`;
fs.writeFileSync(path.join(directory, `${prefix}.xml`), xml);
const report = { schema_version: 1, status, evidence_layer: 'Edge-unit', target_identity: 'synthetic-local-no-network', command,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), exit_code: result.status, signal: result.signal, spawn_error: result.error?.code ?? null,
  fixture_sha256: crypto.createHash('sha256').update(fs.readFileSync(testFile)).digest('hex'),
  started_at: started.toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started.getTime(), cases,
  counts: { total: cases.length, passed: cases.filter(x => x.status === 'PASS').length, failed: cases.filter(x => x.status === 'FAIL').length, skipped: cases.filter(x => x.status === 'SKIP').length },
  raw_artifact: path.relative(process.cwd(), path.join(directory, `${prefix}.xml`)),
  limits: ['Simulated user RPC responses exercise Edge boundary; not hosted Auth/PostgREST or all-domain audit evidence.'] };
fs.writeFileSync(path.join(directory, `${prefix}.json`), JSON.stringify(report, null, 2) + '\n');
if (result.stderr) process.stderr.write(result.stderr);
console.log(JSON.stringify({ status, counts: report.counts, artifact: path.relative(process.cwd(), path.join(directory, `${prefix}.json`)) }));
process.exit(status === 'PASS' ? 0 : 1);
