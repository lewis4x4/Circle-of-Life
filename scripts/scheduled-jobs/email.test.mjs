import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAlertEmail } from './email.mjs';
const delivery={id:'11111111-1111-4111-8111-111111111111',kind:'test',claim_token:'22222222-2222-4222-8222-222222222222',recipients:['primary@example.invalid','backup@example.invalid']};
const env={RESEND_API_KEY:'private-key-marker',SYSTEM_ALERT_EMAIL_FROM:'sender@example.invalid'};
test('unconfigured mail does not send and cannot claim acceptance',async()=>{
 assert.equal((await sendAlertEmail(delivery,{},()=>{throw Error('must not fetch');})).status,'unconfigured');
});
test('provider acceptance is distinct from delivery; backup recipients remain private',async()=>{
 let options;
 const result=await sendAlertEmail(delivery,env,async(_url,args)=>{options=args;return {ok:true,json:async()=>({id:'provider-id'})};});
 assert.deepEqual(result,{status:'provider_accepted',provider_id:'provider-id'});
 const body=JSON.parse(options.body);
 assert.deepEqual(body.to,[delivery.recipients[0]]);assert.deepEqual(body.bcc,[delivery.recipients[1]]);
 assert.equal(options.headers['Idempotency-Key'],`haven-system-alert/${delivery.id}`);
 assert.ok(!JSON.stringify(result).includes('example.invalid'));
});
test('failed or ambiguous provider responses never claim acceptance or expose bodies',async()=>{
 for(const fetcher of [async()=>({ok:false,status:503,json:async()=>({error:'SECRET'})}),async()=>{throw Error('SECRET');},async()=>({ok:true,json:async()=>({})})]) {
  const result=await sendAlertEmail(delivery,env,fetcher);assert.equal(result.status,'failed');assert.ok(!JSON.stringify(result).includes('SECRET'));
 }
});
