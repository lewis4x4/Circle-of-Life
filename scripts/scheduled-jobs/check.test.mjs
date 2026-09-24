import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runFixture(mode) {
  // A preload intercepts every fetch in a fresh process; no provider is contacted.
  const preload=`
    import { createHash } from 'node:crypto';
    const mode=${JSON.stringify(mode)};
    const job={jobid:1,jobname:'fixture',endpoint:'ar-aging-check',active:true,schedule:'* * * * *',
      vault_names:['ar_aging_check_secret'],target_project_ref:'abcdefghijklmnopqrst'};
    globalThis.fetch=async(url,options={})=>{
      if(String(url).includes('sentry.example')) {
        console.error('TEST_SENT_EVENT');
        return {ok:mode!=='sentry_failure',status:mode==='sentry_failure'?503:200};
      }
      const query=options.body ? JSON.parse(options.body).query : '';
      let data;
      if(String(url).endsWith('/secrets')) data=[{name:'AR_AGING_CHECK_SECRET',value:'deadbeef'}];
      else if(query.startsWith('select j.jobid,j.jobname')) data=[job];
      else if(query.startsWith('select name,case')) data=[{name:'ar_aging_check_secret',digest:'deadbeef'}];
      else if(query.includes('current_setting')) data=[{timezone:'GMT'}];
      else if(query==='select job_monitor.collect()') {
        if(mode==='collector_failure') return {ok:false,status:500,json:async()=>({error:'PRIVATE_PROVIDER_MARKER'})};
        data=[{collect:1}];
      } else if(query.startsWith('select coalesce(j.jobid')) data=[{jobid:1,installed_at:'2026-01-01T00:00:00Z',
        // Two failed runs in a row: past the consecutive-failure threshold, so it alerts.
        command_matches:true,runs:[{request_id:10,requested_at:new Date(Date.now()-15000).toISOString(),
          outcome:'error',http_status:500,governance_refusal:false},{request_id:9,
          requested_at:new Date(Date.now()-75000).toISOString(),outcome:'error',http_status:500,governance_refusal:false}]}];
      else if(query.startsWith('select fingerprint')) data=mode==='unchanged' ? [{fingerprint:createHash('sha256')
        .update(JSON.stringify([{jobid:1,state:'error',http_status:500}])).digest('hex')}] : [];
      else if(query.startsWith('insert into job_monitor.signal_state')) {console.error('TEST_SAVED_RECEIPT');data=[];}
      else throw new Error('Unexpected mock query');
      return {ok:true,status:200,json:async()=>data};
    };`;
  return spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('./check.mjs',import.meta.url)),'--send-sentry'],{
    encoding:'utf8',env:{...process.env,SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',
      SUPABASE_ACCESS_TOKEN:'unit-test-token',JOB_MONITOR_RECHECK_DELAY_MS:'0',SENTRY_DSN_JOB_MONITOR:'https://publickey@sentry.example/123'}});
}
test('unchanged findings do not resend or update the receipt',()=>{
  const result=runFixture('unchanged');
  assert.equal(result.status,2,result.stderr);
  assert.equal(JSON.parse(result.stdout).sentry.delivery,'unchanged_suppressed');
  assert.ok(!result.stderr.includes('TEST_SENT_EVENT'));
  assert.ok(!result.stderr.includes('TEST_SAVED_RECEIPT'));
});
test('new findings send before recording ingestion and never disclose secret digests',()=>{
  const result=runFixture('new');
  assert.equal(result.status,2,result.stderr);
  assert.equal(JSON.parse(result.stdout).sentry.recipient_receipt,'not_verified');
  assert.ok(result.stderr.indexOf('TEST_SENT_EVENT')<result.stderr.indexOf('TEST_SAVED_RECEIPT'));
  assert.ok(!result.stdout.includes('deadbeef'));
  assert.ok(!result.stdout.includes('unit-test-token'));
});
test('collector failures signal a sanitized monitor error',()=>{
  const result=runFixture('collector_failure');
  assert.equal(result.status,1);
  assert.ok(result.stderr.includes('monitor_failure_signal'));
  assert.ok(!result.stderr.includes('PRIVATE_PROVIDER_MARKER'));
});
test('failed ingestion does not save a delivered fingerprint',()=>{
  const result=runFixture('sentry_failure');
  assert.equal(result.status,1);
  assert.ok(!result.stderr.includes('TEST_SAVED_RECEIPT'));
  assert.ok(result.stderr.includes('Monitor failure signal could not reach Sentry'));
});
