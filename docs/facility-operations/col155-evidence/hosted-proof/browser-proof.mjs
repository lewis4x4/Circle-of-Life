// Guarded COL155 read-only browser capture. Fixture/HTTP proof must already pass.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../../../..');
const ready = process.argv[2];
const existingReview = process.argv[3] === '--recheck-existing';
if (process.argv[3] && !existingReview) throw Error('Unknown browser mode');
if (!ready) throw Error('Explicit parent readiness required');
const verify = () => execFileSync('python3', ['-B', path.join(out, 'guarded.py'), 'verify', '--ready', ready], { cwd: root, stdio: 'pipe' });
verify();
const readiness = JSON.parse(fs.readFileSync(ready));
const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/haven-staging/col155-review-fixture.json')));
const stamp = JSON.parse(fs.readFileSync(path.join(out, 'staging-readiness.json')));
if (state.cleaned || !state.httpProofPassed || state.target !== 'iwcnajanvjvynolltflw' || state.sourceSha !== readiness.sourceSha || stamp.sourceSha !== readiness.sourceSha || stamp.result !== 'PASS') throw Error('Fresh exact-source exercised fixture required');
if (!state.session || state.session.expires_at * 1000 < Date.now() + 180000) throw Error('Fresh current session required');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const encoded = 'base64-' + Buffer.from(JSON.stringify(state.session)).toString('base64url');
const cookies = [];
for (let i = 0; i < encoded.length; i += 3180) cookies.push({ name: 'sb-' + state.target + '-auth-token' + (encoded.length > 3180 ? '.' + i / 3180 : ''), value: encoded.slice(i, i + 3180), domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' });
const prior = existingReview ? JSON.parse(fs.readFileSync(path.join(out, 'initial-browser-report.json'))) : null;
const report = { mode: existingReview ? 'existing-review-recheck' : 'record-and-recheck', sourceSha: readiness.sourceSha, sourceManifest: readiness.source_manifest, target: state.target, cases: [] };
const browser = await chromium.launch({ headless: true });
try {
 for (const width of [1440, 375]) {
  verify();
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const result = { width, pageErrors: [], consoleErrors: [], httpFailures: [] }; report.cases.push(result);
  page.on('pageerror', error => result.pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) result.httpFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  try {
   const response = await page.goto(`http://127.0.0.1:4355/admin/operations/work?facility_id=${state.site}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
   if (response.status() !== 200) throw Error('Work route failed');
   const task = state['browser_task_' + width]?.id;
   if (!task) throw Error('Fresh per-width task required');
   const rows = page.getByRole('listitem', { name: state.taskLabel, exact: true });
   await rows.first().waitFor({ state: 'visible', timeout: 60000 });
   let row;
   // Every attempted row is read-only until the returned task ID matches exactly.
   for (const candidateRow of await rows.all()) {
    await candidateRow.getByText('Resident review source context', { exact: true }).click();
    await candidateRow.getByLabel('Source family').selectOption('resident_contact');
    await candidateRow.getByLabel('Review start date').fill(state.period.start_date);
    const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/operations/resident-review-sources' && response.status() === 200);
    await candidateRow.getByLabel('Review end date').fill(state.period.end_date);
    const candidates = await (await read).json();
    if (candidates.task_id !== task) continue;
    if (!candidates.eligible || candidates.period.start_date !== state.period.start_date || candidates.period.end_date !== state.period.end_date) throw Error('Source scope mismatch');
    const index = candidates.items.findIndex(source => source.source_id === state.contact);
    if (index < 0) throw Error('Exact synthetic source missing');
    if (!existingReview) await candidateRow.getByRole('checkbox').nth(index).check();
    row = candidateRow; result.sourceFamily = candidates.family; result.candidateCount = candidates.items.length;
    break;
   }
   if (!row) throw Error('Fresh task row not resolved through actual task-bound response');
   let saved;
   if (existingReview) {
    const initial = prior.cases.find(entry => entry.width === width && entry.task === task);
    if (!initial?.uiSaveAndRecheck || !initial.receipt) throw Error('Original successful UI save provenance missing');
    saved = { receipt: { id: initial.receipt } };
    result.originalUiProofSource = prior.sourceSha;
    result.task = task; result.receipt = initial.receipt;
   } else {
   await row.getByLabel('Review findings').fill('Synthetic browser review at ' + width + ' pixels');
   const saveRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/operations/occurrences/${task}/source-review` && response.request().method() === 'POST');
   await row.getByRole('button', { name: 'Record review with selected sources', exact: true }).click();
   const saveResponse = await saveRead; saved = await saveResponse.json();
   if (saveResponse.status() !== 200 || saved.outcome !== 'receipt' || saved.occurrence.id !== task || saved.receipt.recorder_id !== state.user || saved.references.length !== 1) throw Error('Browser review save not verified');
   result.task = task; result.receipt = saved.receipt.id; result.selectedVersion = JSON.parse(saveResponse.request().postData()).references[0].source_version;
   await row.getByText('Review recorded. Required evidence and any separate verification still apply.', { exact: true }).waitFor();
   }
   const historyRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/operations/occurrences/${task}/source-reviews` && response.status() === 200);
   await row.getByText('Versioned source review history', { exact: true }).click();
   const history = await (await historyRead).json();
   if (history.task_id !== task || !history.reviews.some(review => review.receipt_id === saved.receipt.id)) throw Error('Browser-created review absent from history');
   const recheckRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/operations/occurrences/${task}/source-reviews/recheck` && response.request().method() === 'POST');
   await row.getByRole('button', { name: 'Recheck source version', exact: true }).click();
   const recheckResponse = await recheckRead; const checked = await recheckResponse.json();
   if (recheckResponse.status() !== 200 || checked.task_id !== task || !checked.reviews.some(review => review.receipt_id === saved.receipt.id && review.references.some(reference => reference.checks.length > 0))) throw Error('Browser recheck not recorded');
   result.historyStates = checked.reviews.flatMap(review => review.references.map(reference => reference.current_state));
   result.uiSaveAndRecheck = !existingReview; result.existingReviewRechecked = existingReview;
   await row.scrollIntoViewIfNeeded();
   await page.screenshot({ path: path.join(out, `review-${width}.png`), fullPage: true });
   const axe = await new AxeBuilder({ page }).exclude('nextjs-portal').analyze();
   result.axeViolations = axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
   result.result = result.pageErrors.length || result.consoleErrors.length || result.httpFailures.length || result.axeViolations.length ? 'FAIL' : 'PASS';
  } catch (error) { result.result = 'FAIL'; result.failure = { message: error.message, stack: error.stack }; await page.screenshot({ path: path.join(out, `review-${width}-failed.png`) }).catch(() => {}); }
  await context.close();
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
 }
} finally { await browser.close(); verify(); report.result = report.cases.length === 2 && report.cases.every(row => row.result === 'PASS') ? 'PASS' : 'FAIL'; fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
if (report.result !== 'PASS') process.exitCode = 1;
