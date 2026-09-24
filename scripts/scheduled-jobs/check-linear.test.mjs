import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs the real check.mjs with --send-linear. A preload intercepts every fetch in a fresh
// process; neither Supabase nor Linear is contacted.
// Modes: persistent (two failed runs in a row), blip_recovers (one 5xx, then a success
// by the re-check), blip_held (one 5xx that is still failing on the re-check).
function runFixture(mode, args = ['--send-linear'], envOverrides = {}) {
  const preload = `
    const mode=${JSON.stringify(mode)};
    let collections=0;
    const at=ms=>new Date(Date.now()-ms).toISOString();
    const failed=(id,ms)=>({request_id:id,requested_at:at(ms),outcome:'error',http_status:503,governance_refusal:false});
    const job={jobid:1,jobname:'fixture',endpoint:'ar-aging-check',active:true,schedule:'* * * * *',
      vault_names:['ar_aging_check_secret'],target_project_ref:'abcdefghijklmnopqrst'};
    const reply=data=>({ok:true,status:200,json:async()=>data});
    globalThis.fetch=async(url,options={})=>{
      url=String(url);
      if(url==='https://api.linear.app/oauth/token') {
        if(mode==='linear_token_failure') return {ok:false,status:401,json:async()=>({error:'PRIVATE_LINEAR_BODY'})};
        return reply({access_token:'linear-app-token'});
      }
      if(url==='https://api.linear.app/graphql') {
        const {query,variables}=JSON.parse(options.body);
        if(options.headers.Authorization!=='Bearer linear-app-token') throw new Error('bad Linear auth');
        if(query.includes('FindOpenJobIssue') || query.includes('FindRecentClosedJobIssue')) return reply({data:{issues:{nodes:[]}}});
        if(query.includes('CreateJobIssue')) {
          console.error('TEST_LINEAR_CREATE '+variables.input.title+' priority='+variables.input.priority);
          console.error('TEST_LINEAR_BODY '+JSON.stringify(variables.input.description));
          return reply({data:{issueCreate:{success:true,issue:{id:'i1',identifier:'COL-901',url:'https://linear.app/i1'}}}});
        }
        throw new Error('Unexpected Linear operation');
      }
      const query=options.body ? JSON.parse(options.body).query : '';
      let data;
      if(url.endsWith('/secrets')) data=[{name:'AR_AGING_CHECK_SECRET',value:'deadbeef'}];
      else if(query.startsWith('select j.jobid,j.jobname')) data=[job];
      else if(query.startsWith('select name,case')) data=[{name:'ar_aging_check_secret',digest:'deadbeef'}];
      else if(query.includes('current_setting')) data=[{timezone:'GMT'}];
      else if(query==='select job_monitor.collect()') {
        if(mode==='collector_failure') return {ok:false,status:500,json:async()=>({error:'PRIVATE_PROVIDER_MARKER'})};
        collections++;
        console.error('TEST_COLLECT '+collections);
        data=[{collect:1}];
      } else if(query.startsWith('select coalesce(j.jobid')) {
        const success={request_id:8,requested_at:at(3600000),outcome:'success',http_status:200,governance_refusal:false};
        const runs=mode==='blip_recovers' && collections>1
          ? [{request_id:11,requested_at:at(1000),outcome:'success',http_status:200,governance_refusal:false},failed(10,15000),success]
          : mode==='blip_recovers' || mode==='blip_held' ? [failed(10,15000),success]
          : [failed(10,15000),failed(9,75000),success];
        data=[{jobid:1,installed_at:'2026-01-01T00:00:00Z',command_matches:true,runs}];
      }
      else throw new Error('Unexpected mock query');
      return reply(data);
    };`;
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('./check.mjs', import.meta.url)), ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'unit-test-token',
      LINEAR_MONITOR_CLIENT_ID: 'linear-client', LINEAR_MONITOR_CLIENT_SECRET: 'linear-secret',
      GITHUB_REPOSITORY: '', GITHUB_RUN_ID: '', MONITOR_RUN_URL: '', JOB_MONITOR_RECHECK_DELAY_MS: '0', ...envOverrides },
  });
}

test('a persistent failure alerts once with job, last success, consecutive count and likely cause', () => {
  const result = runFixture('persistent');
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.linear.created, ['COL-901']);
  assert.deepEqual(report.linear.errors, []);
  assert.equal(result.stderr.match(/TEST_LINEAR_CREATE /g).length, 1);
  assert.ok(result.stderr.includes('TEST_LINEAR_CREATE Scheduled job alert: fixture priority=2'));
  const body = JSON.parse(result.stderr.match(/TEST_LINEAR_BODY (.*)/)[1]);
  assert.match(body, /\*\*Job:\*\* `fixture`/);
  assert.match(body, /- Last success: \d{4}-\d\d-\d\dT/);
  assert.match(body, /- Consecutive failures: 2/);
  assert.match(body, /- Likely cause: Function returned a server error \(HTTP 503\)/);
  assert.match(body, /- Alerting because: 2 consecutive failures/);
  // Already confirmed by the job's own next run, so no in-run re-check was spent.
  assert.equal(result.stderr.match(/TEST_COLLECT /g).length, 1);
  // The monitor's own issue is only looked up (to close it on recovery), never created on success.
  assert.ok(!result.stderr.includes('Scheduled job alert: job-monitor'));
  for (const secret of ['deadbeef', 'unit-test-token', 'linear-secret', 'linear-app-token']) {
    assert.ok(!result.stdout.includes(secret), secret);
    assert.ok(!result.stderr.includes(secret), secret);
  }
});

test('a single 5xx that recovers on the re-check stays quiet and opens no issue', () => {
  const result = runFixture('blip_recovers');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.match(/TEST_COLLECT /g).length, 2);
  assert.ok(!result.stderr.includes('TEST_LINEAR_CREATE'));
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.linear.created, []);
  assert.equal(report.jobs[0].state, 'success');
  assert.equal(report.jobs[0].rechecked, true);
});

test('a single 5xx still failing on the re-check is held quietly inside the hold window', () => {
  const result = runFixture('blip_held');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.match(/TEST_COLLECT /g).length, 2);
  assert.ok(!result.stderr.includes('TEST_LINEAR_CREATE'));
  const report = JSON.parse(result.stdout);
  assert.equal(report.held.length, 1);
  assert.equal(report.held[0].jobname, 'fixture');
  assert.equal(report.jobs[0].severity, 'quiet');
});

test('no alert destination configured fails the run loudly, even with nothing to alert', () => {
  const result = runFixture('blip_recovers', ['--send-linear'], { LINEAR_MONITOR_CLIENT_ID: '', LINEAR_MONITOR_CLIENT_SECRET: '' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('LINEAR_MONITOR_CLIENT_ID and LINEAR_MONITOR_CLIENT_SECRET are required'));
  assert.ok(result.stderr.includes('Monitor failure could not reach Linear'));
});

test('a collector failure opens an Urgent job-monitor issue without leaking provider text', () => {
  const result = runFixture('collector_failure');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('monitor_failure_linear'));
  assert.ok(result.stderr.includes('TEST_LINEAR_CREATE Scheduled job alert: job-monitor priority=1'));
  assert.ok(!result.stderr.includes('PRIVATE_PROVIDER_MARKER'));
});

test('a Linear credential failure fails the run with a sanitized reason', () => {
  const result = runFixture('linear_token_failure');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Linear token request failed: HTTP 401'));
  assert.ok(result.stderr.includes('Monitor failure could not reach Linear'));
  assert.ok(!result.stderr.includes('PRIVATE_LINEAR_BODY'));
});

test('a secrets-only check cannot drive Linear alert state', () => {
  const result = runFixture('persistent', ['--secrets-only', '--send-linear']);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('cannot update the full monitor alert state'));
});
