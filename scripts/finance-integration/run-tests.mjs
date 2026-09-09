import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const suite = process.argv[2];
const directories = { finance: ['src/lib/finance-integration', 'src/lib/finance/post-to-gl.test.ts', 'src/lib/finance/forecast.test.ts', 'src/lib/finance/resident-money.test.ts', 'src/lib/finance/format-cents.test.ts', 'src/lib/finance/journal-form-lines.test.ts', 'src/app/(admin)/admin/cash/page.test.tsx', 'src/app/(admin)/finance/journal-entries/new', 'src/components/finance/FinanceReviewQueueClient.test.tsx'], audit: ['src/lib/platform-audit'] };
if (!Object.hasOwn(directories, suite)) throw new Error('Expected finance or audit');
const started = new Date();
const directory = path.resolve('test-results/finance-integration');
fs.mkdirSync(directory, { recursive: true });
const prefix = `${started.toISOString().replaceAll(':', '-')}-${suite}`;
const rawPath = path.join(directory, `${prefix}-vitest.json`);
const command = [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...directories[suite], '--reporter=json', `--outputFile=${rawPath}`];
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
const raw = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : null;
const cases = (raw?.testResults ?? []).flatMap(file => file.assertionResults.map(test => ({
  name: test.fullName, acceptance_ids: [...new Set(test.fullName.match(/HFA-\d{3}/g) ?? [])], status: test.status,
  duration_ms: test.duration ?? null, failures: test.failureMessages ?? [],
})));
const status = result.status === 0 && raw?.success && cases.length > 0 && cases.every(test => test.status === 'passed') ? 'PASS' : 'FAIL';
const changedPaths = [...new Set([...execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split('\n'), ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')])].filter(file => file && !file.startsWith('test-results/') && fs.existsSync(file) && fs.statSync(file).isFile()).sort();
const sourceHashes = Object.fromEntries(changedPaths.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const testSourceHashes = Object.fromEntries((raw?.testResults ?? []).map(file => [path.relative(process.cwd(), file.name), crypto.createHash('sha256').update(fs.readFileSync(file.name)).digest('hex')]));
const report = { schema_version: 1, suite, status, command, exit_code: result.status, signal: result.signal, spawn_error: result.error?.code ?? null, fixture: { kind: 'inline-synthetic-test-source', sha256: testSourceHashes }, evidence_layer: 'unit', target_identity: 'synthetic-local-no-network', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  changed_file_sha256: sourceHashes, tracked_diff_sha256: crypto.createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'])).digest('hex'),
  started_at: started.toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started.getTime(),
  counts: { total: cases.length, passed: cases.filter(x => x.status === 'passed').length, failed: cases.filter(x => x.status === 'failed').length, skipped: cases.filter(x => !['passed', 'failed'].includes(x.status)).length }, cases,
  limits: ['Unit assertions only; does not satisfy provider, Auth/PostgREST, complete financial workflow or business acceptance.'], raw_artifact: path.relative(process.cwd(), rawPath) };
fs.writeFileSync(path.join(directory, `${prefix}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status, counts: report.counts, artifact: path.relative(process.cwd(), path.join(directory, `${prefix}.json`)) }));
process.exit(status === 'PASS' ? 0 : 1);
