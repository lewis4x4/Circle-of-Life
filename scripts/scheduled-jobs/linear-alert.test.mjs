import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncJobIssues,
  sendLinear,
  toJobResults,
  getLinearToken,
  monitorRunUrl,
  issueTitle,
  priorityFor,
  readSignature,
  replaceSignature,
  buildDescription,
  HAVEN_DEFAULTS,
  MONITOR_JOB,
} from './linear-alert.mjs';

const NOW = new Date('2026-09-24T12:00:00Z');
const BASE = {
  token: 'tok',
  teamId: 'team-col',
  labelId: 'label-job',
  assigneeId: 'user-brian',
  runUrl: 'https://github.com/example/repo/actions/runs/1',
  now: () => NOW,
};

// Fake Linear API. `openIssues` maps issue title -> open issue node.
function fakeLinear({ openIssues = {}, doneStates = [{ id: 'state-done', name: 'Done', position: 3 }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      calls.push({ op: 'token', body: init.body, auth: init.headers.Authorization });
      return new Response(JSON.stringify({ access_token: 'app-token' }), { status: 200 });
    }
    const { query, variables } = JSON.parse(init.body);
    const op = query.match(/(?:query|mutation) (\w+)/)[1];
    calls.push({ op, variables, auth: init.headers.Authorization });
    const data = {
      FindOpenJobIssue: () => ({ issues: { nodes: openIssues[variables.title] ? [openIssues[variables.title]] : [] } }),
      DoneState: () => ({ workflowStates: { nodes: doneStates } }),
      CreateJobIssue: () => ({ issueCreate: { success: true, issue: { id: 'new-id', identifier: 'COL-900', url: 'https://linear.app/x' } } }),
      UpdateJobIssue: () => ({ issueUpdate: { success: true } }),
      CommentJobIssue: () => ({ commentCreate: { success: true } }),
    }[op]();
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return { fetchImpl, calls };
}

const openIssue = (job, signature) => ({
  id: `id-${job}`,
  identifier: 'COL-800',
  url: 'https://linear.app/y',
  description: buildDescription({ job, status: 'failing', signature }, { now: NOW }),
});

test('new failure creates one assigned, labeled, prioritized issue', async () => {
  const { fetchImpl, calls } = fakeLinear();
  const summary = await syncJobIssues(
    [{ job: 'stand-up-google-inbound', status: 'failing', signature: 'error (HTTP 409)', detail: '- Consecutive failures: 100' }],
    { ...BASE, fetchImpl },
  );
  assert.deepEqual(summary.created, ['COL-900']);
  const input = calls.find(c => c.op === 'CreateJobIssue').variables.input;
  assert.equal(input.title, 'Scheduled job alert: stand-up-google-inbound');
  assert.equal(input.teamId, 'team-col');
  assert.deepEqual(input.labelIds, ['label-job']);
  assert.equal(input.assigneeId, 'user-brian');
  assert.equal(input.priority, 2);
  assert.equal(readSignature(input.description), 'error (HTTP 409)');
  assert.match(input.description, /Consecutive failures: 100/);
  assert.match(input.description, /actions\/runs\/1/);
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('safety, medication, escalation and monitor jobs are Urgent', () => {
  for (const job of ['resident-safety-scorer-daily', 'home-escalate-uncleared-15m', 'emar-missed-dose-check', MONITOR_JOB]) {
    assert.equal(priorityFor(job), 1, job);
  }
  assert.equal(priorityFor('report-scheduler-daily'), 2);
});

test('same failure on an open issue makes no writes', async () => {
  const job = 'observation-task-generator-4h';
  const { fetchImpl, calls } = fakeLinear({ openIssues: { [issueTitle(job)]: openIssue(job, 'partial (HTTP 207)') } });
  const summary = await syncJobIssues([{ job, status: 'failing', signature: 'partial (HTTP 207)' }], { ...BASE, fetchImpl });
  assert.deepEqual(summary.unchanged, ['COL-800']);
  assert.deepEqual(calls.map(c => c.op), ['FindOpenJobIssue']);
});

test('changed failure comments once and stores the new signature', async () => {
  const job = 'report-scheduler-daily';
  const { fetchImpl, calls } = fakeLinear({ openIssues: { [issueTitle(job)]: openIssue(job, 'error') } });
  const summary = await syncJobIssues([{ job, status: 'failing', signature: 'error (HTTP 500)' }], { ...BASE, fetchImpl });
  assert.deepEqual(summary.commented, ['COL-800']);
  assert.match(calls.find(c => c.op === 'CommentJobIssue').variables.input.body, /\*\*error\*\* → \*\*error \(HTTP 500\)/);
  assert.equal(readSignature(calls.find(c => c.op === 'UpdateJobIssue').variables.input.description), 'error (HTTP 500)');
});

test('recovered job comments and moves the issue to the first Done state', async () => {
  const job = 'grace-redteam-nightly';
  const { fetchImpl, calls } = fakeLinear({
    openIssues: { [issueTitle(job)]: openIssue(job, 'error') },
    doneStates: [{ id: 'state-shipped', name: 'Shipped', position: 5 }, { id: 'state-done', name: 'Done', position: 3 }],
  });
  const summary = await syncJobIssues([{ job, status: 'healthy' }], { ...BASE, fetchImpl });
  assert.deepEqual(summary.closed, ['COL-800']);
  assert.match(calls.find(c => c.op === 'CommentJobIssue').variables.input.body, /^Recovered/);
  assert.deepEqual(calls.find(c => c.op === 'UpdateJobIssue').variables, { id: `id-${job}`, input: { stateId: 'state-done' } });
});

test('healthy job with no open issue makes no writes', async () => {
  const { fetchImpl, calls } = fakeLinear();
  const summary = await syncJobIssues([{ job: 'resident-assurance-ai-daily', status: 'healthy' }], { ...BASE, fetchImpl });
  assert.deepEqual(calls.map(c => c.op), ['FindOpenJobIssue']);
  assert.deepEqual(summary, { created: [], commented: [], closed: [], unchanged: [], errors: [] });
});

test('one job erroring does not stop the others, and errors carry no provider body', async () => {
  const { fetchImpl: ok } = fakeLinear();
  let n = 0;
  const flaky = async (url, init) => (++n === 1
    ? new Response(JSON.stringify({ errors: [{ message: 'PRIVATE_BODY', extensions: { code: 'RATELIMITED' } }] }), { status: 400 })
    : ok(url, init));
  const summary = await syncJobIssues(
    [{ job: 'job-a', status: 'failing', signature: 'error' }, { job: 'job-b', status: 'failing', signature: 'error' }],
    { ...BASE, fetchImpl: flaky },
  );
  assert.deepEqual(summary.errors, [{ job: 'job-a', message: 'Linear API HTTP 400: RATELIMITED' }]);
  assert.deepEqual(summary.created, ['COL-900']);
});

test('toJobResults maps alerts, parity problems and healthy successes', () => {
  const outcomes = [
    { jobid: 1, jobname: 'stand-up-google-inbound', endpoint: 'stand-up-google', state: 'error', alert: true,
      http_status: 409, consecutive_failures: 100, requested_at: '2026-09-24T00:00:00Z', request_id: 7 },
    { jobid: 2, jobname: 'home-escalate-uncleared-15m', state: 'not_monitored', alert: true },
    { jobid: 3, jobname: 'ar-aging-check-daily', state: 'success', alert: false, http_status: 200 },
    { jobid: 4, jobname: 'new-job', state: 'awaiting_first_run', alert: false },
    { jobid: 5, jobname: 'report-scheduler-daily', state: 'success', alert: false },
  ];
  const parity = [
    { jobid: 3, jobname: 'ar-aging-check-daily', endpoint: 'ar-aging-check', state: 'match' },
    { jobid: 5, jobname: 'report-scheduler-daily', endpoint: 'report-scheduler', state: 'mismatch' },
    { jobid: 1, jobname: 'stand-up-google-inbound', endpoint: 'stand-up-google', state: 'missing_edge_secret' },
  ];
  const results = Object.fromEntries(toJobResults(outcomes, parity).map(r => [r.job, r]));
  assert.equal(results['stand-up-google-inbound'].signature, 'error (HTTP 409) + secret missing_edge_secret');
  assert.match(results['stand-up-google-inbound'].detail, /Consecutive failures: 100/);
  assert.match(results['stand-up-google-inbound'].detail, /request 7/);
  assert.equal(results['home-escalate-uncleared-15m'].signature, 'Not monitored');
  assert.deepEqual(results['ar-aging-check-daily'], { job: 'ar-aging-check-daily', status: 'healthy' });
  assert.equal(results['report-scheduler-daily'].status, 'failing');
  assert.equal(results['report-scheduler-daily'].signature, 'secret mismatch');
  assert.equal(results['new-job'], undefined);
});

test('signature ignores run-to-run noise so repeated runs stay quiet', () => {
  const run = n => toJobResults([{ jobid: 1, jobname: 'j', state: 'error', alert: true, http_status: 409,
    consecutive_failures: n, requested_at: `2026-09-24T0${n}:00:00Z`, request_id: n }])[0].signature;
  assert.equal(run(1), run(2));
});

test('replaceSignature rewrites only the Failure line', () => {
  const before = buildDescription({ job: 'x', signature: 'error', detail: 'keep me' }, { now: NOW });
  const after = replaceSignature(before, 'error (HTTP 502)');
  assert.equal(readSignature(after), 'error (HTTP 502)');
  assert.match(after, /keep me/);
  assert.match(after, /\*\*Job:\*\* `x`/);
});

test('getLinearToken uses client credentials over basic auth', async () => {
  const { fetchImpl, calls } = fakeLinear();
  assert.equal(await getLinearToken({ clientId: 'cid', clientSecret: 'secret', fetchImpl }), 'app-token');
  assert.equal(calls[0].auth, `Basic ${Buffer.from('cid:secret').toString('base64')}`);
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('scope'), 'read,write');
});

test('getLinearToken fails without credentials and never echoes the provider body', async () => {
  await assert.rejects(getLinearToken({ clientId: '', clientSecret: 'x' }), /LINEAR_MONITOR_CLIENT_ID/);
  const fetchImpl = async () => new Response('PRIVATE_BODY', { status: 401 });
  await assert.rejects(getLinearToken({ clientId: 'a', clientSecret: 'b', fetchImpl }), e => {
    assert.equal(e.message, 'Linear token request failed: HTTP 401');
    return true;
  });
});

test('sendLinear uses Haven defaults and the GitHub Actions run link', async () => {
  const { fetchImpl, calls } = fakeLinear();
  const env = {
    LINEAR_MONITOR_CLIENT_ID: 'cid', LINEAR_MONITOR_CLIENT_SECRET: 'secret',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'org/Circle-of-Life', GITHUB_RUN_ID: '42',
  };
  const summary = await sendLinear([{ job: 'report-scheduler-daily', status: 'failing', signature: 'error' }], env, fetchImpl);
  assert.deepEqual(summary.created, ['COL-900']);
  const input = calls.find(c => c.op === 'CreateJobIssue').variables.input;
  assert.equal(input.teamId, HAVEN_DEFAULTS.teamId);
  assert.deepEqual(input.labelIds, [HAVEN_DEFAULTS.labelId]);
  assert.equal(input.assigneeId, HAVEN_DEFAULTS.assigneeId);
  assert.match(input.description, /https:\/\/github\.com\/org\/Circle-of-Life\/actions\/runs\/42/);
  assert.equal(calls.find(c => c.op === 'CreateJobIssue').auth, 'Bearer app-token');
});

test('monitorRunUrl prefers MONITOR_RUN_URL and is empty outside Actions', () => {
  assert.equal(monitorRunUrl({ MONITOR_RUN_URL: 'https://x' }), 'https://x');
  assert.equal(monitorRunUrl({}), undefined);
});
