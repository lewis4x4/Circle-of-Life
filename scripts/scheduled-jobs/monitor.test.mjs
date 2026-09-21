import test from 'node:test';
import assert from 'node:assert/strict';
import { assessJob, latestDue, compareSecrets, sendSentry } from './monitor.mjs';
const now=new Date('2026-09-14T12:45:00Z');
const job={jobid:1,jobname:'test',endpoint:'ar-aging-check',active:true,schedule:'*/30 * * * *',
  installed_at:'2026-09-13T00:00:00Z',command_matches:true,runs:[]};
const run={request_id:10,requested_at:'2026-09-14T12:30:01Z',http_status:200,outcome:'success'};
test('cron success without an HTTP request is not work success',()=>{
  assert.equal(assessJob({...job,cron_status:'succeeded'},now).state,'did_not_run');
});
test('HTTP success, refusal, error and missing response stay distinct',()=>{
  for(const state of ['success','refused','error','response_missing']) {
    const result=assessJob({...job,runs:[{...run,outcome:state}]},now);
    assert.equal(result.state,state);assert.equal(result.alert,state!=='success');
  }
});
test('pending requests past the response deadline alert',()=>{
  assert.equal(assessJob({...job,runs:[{...run,outcome:'pending'}]},now).state,'response_missing');
});
test('only the exact known governance refusal avoids a defect alert',()=>{
  const refusal={...run,outcome:'refused',http_status:403,governance_refusal:true};
  assert.equal(assessJob({...job,endpoint:'resident-assurance-ai',runs:[refusal]},now).alert,false);
  assert.equal(assessJob({...job,runs:[refusal]},now).alert,true);
  assert.equal(assessJob({...job,endpoint:'resident-assurance-ai',runs:[{...refusal,http_status:401}]},now).alert,true);
});
test('daily and monthly schedules detect missed occurrences without interval guesses',()=>{
  assert.equal(latestDue('0 2 1 * *',now).toISOString(),'2026-09-01T02:00:00.000Z');
  assert.equal(latestDue('0 12 * * *',now).toISOString(),'2026-09-14T12:00:00.000Z');
  assert.equal(latestDue('4-59/5 * * * *',now).toISOString(),'2026-09-14T12:44:00.000Z');
  assert.equal(latestDue('20 7,8 * * *',now).toISOString(),'2026-09-14T08:20:00.000Z');
  assert.equal(latestDue('0 0 * * 7',now).toISOString(),'2026-09-13T00:00:00.000Z');
  assert.throws(()=>latestDue('0,broken * * * *',now));
  assert.equal(assessJob({...job,schedule:'0,broken * * * *'},now).state,'unsupported_schedule');
});
test('new registrations await first due time; changed/new jobs cannot silently escape coverage',()=>{
  assert.equal(assessJob({...job,installed_at:'2026-09-14T12:40:00Z'},now).state,'awaiting_first_run');
  assert.equal(assessJob({...job,command_matches:false},now).state,'not_monitored');
  assert.equal(assessJob({...job,installed_at:null},now).alert,true);
});
test('repeated failures count until last success',()=>{
  const runs=[{...run,outcome:'error'},{...run,requested_at:'2026-09-14T12:00:01Z',outcome:'refused'},
    {...run,requested_at:'2026-09-14T11:30:01Z'}];
  assert.equal(assessJob({...job,runs},now).consecutive_failures,2);
});
test('disabled and deleted registered schedules alert',()=>{
  assert.equal(assessJob({...job,active:false},now).alert,true);
  assert.equal(assessJob({...job,removed:true},now).state,'removed');
});
test('a newer pending call cannot hide the previous failed outcome',()=>{
  const result=assessJob({...job,schedule:'* * * * *',runs:[
    {...run,requested_at:'2026-09-14T12:44:30Z',outcome:'pending'},
    {...run,outcome:'error',http_status:500}]},now);
  assert.equal(result.state,'error');assert.equal(result.alert,true);
});
test('native SQL cron history distinguishes success, failure and a missed due run',()=>{
  const native={...job,endpoint:null,monitoring_mode:'cron',schedule:'*/15 * * * *',cron_runs:[
    {start_time:'2026-09-14T12:30:01Z',end_time:'2026-09-14T12:30:02Z',status:'succeeded'}]};
  assert.equal(assessJob(native,now).state,'success');
  assert.equal(assessJob({...native,cron_runs:[{...native.cron_runs[0],status:'failed'}]},now).state,'error');
  assert.equal(assessJob({...native,cron_runs:[]},now).state,'did_not_run');
  assert.equal(assessJob({...native,cron_runs:[{
    start_time:'2026-09-14T12:44:30Z',end_time:null,status:'running'}]},now).state,'running');
});
test('secret checks fail closed and do not include digests in output',()=>{
  const j={...job,vault_names:['ar_aging_check_secret']};
  const vault=[{name:'ar_aging_check_secret',digest:'abcd'}];
  const edge=[{name:'AR_AGING_CHECK_SECRET',value:'abcd'}];
  assert.equal(compareSecrets([j],vault,edge)[0].state,'match');
  assert.equal(compareSecrets([j],vault,[{...edge[0],value:'def0'}])[0].state,'mismatch');
  assert.equal(compareSecrets([j],[],edge)[0].state,'missing_vault_secret');
  assert.equal(compareSecrets([{...j,endpoint:'new-job'}],vault,edge)[0].state,'unknown_mapping');
  assert.deepEqual(compareSecrets([{...j,endpoint:null}],vault,edge),[]);
  assert.ok(!JSON.stringify(compareSecrets([j],vault,edge)).includes('abcd'));
});
test('Sentry delivery is awaited and HTTP acceptance never claims recipient receipt',async()=>{
  let sent;
  const result=await sendSentry('https://publickey@sentry.example/123','test-project',[{state:'error'}],async(url,opts)=>{
    sent={url,opts};return {ok:true,status:200};
  });
  assert.equal(result.recipient_receipt,'not_verified');
  assert.equal(sent.url,'https://sentry.example/api/123/envelope/');
  assert.ok(!sent.opts.body.includes('publickey'));
  await assert.rejects(sendSentry('https://publickey@sentry.example/123','test',[],async()=>({ok:false,status:429})),/HTTP 429/);
});
