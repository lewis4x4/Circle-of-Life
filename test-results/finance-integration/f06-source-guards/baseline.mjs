import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root='/Users/brianlewis/Circle of Life/Haven Finance Integration';
const out='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/billing-f06';
const ts=createRequire(path.join(root,'package.json'))('typescript');
const appFile=path.join(root,'src/lib/billing/generate-monthly-invoices.ts');
const edgeFile=path.join(root,'supabase/functions/_shared/billing/generate-monthly-invoices.ts');
const handlerFile=path.join(root,'supabase/functions/generate-monthly-invoices/index.ts');
function load(file,client,registered={}) {
 const exports={}; const module={exports};
 const context={module,exports,Request,Response,Date,Intl,Map,Set,console:{log(){},error(){}},Deno:{env:{get(key){return ({GENERATE_MONTHLY_INVOICES_SECRET:'synthetic-local-secret',SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-no-real-key'})[key]}},serve(fn){registered.handler=fn}},require(name){
  if(name.startsWith('https:')) return {createClient:()=>client};
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name),client,registered);
  throw new Error('Unexpected module '+name);
 }};
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,context,{filename:file});return module.exports;
}
const facility='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
function data(){return {
 residents:[{id:'r1',first_name:'Synthetic',last_name:'Hold',acuity_level:'level_2',status:'hospital_hold',admission_date:'2025-01-01',discharge_date:null,facility_id:facility,organization_id:org}],
 rate_schedules:[{id:'draft',status:'draft',effective_date:'2026-05-01',created_at:'2026-05-01',base_rate_private:999000,base_rate_semi_private:999000,care_surcharge_level_1:31000,care_surcharge_level_2:62000,care_surcharge_level_3:0},{id:'published',status:'published',effective_date:'2026-04-01',created_at:'2026-04-01',base_rate_private:310000,base_rate_semi_private:248000,care_surcharge_level_1:31000,care_surcharge_level_2:62000,care_surcharge_level_3:0}],
 resident_payers:[],facility_medicaid_providers:[],resident_rate_agreements:[],invoices:[],facilities:[{id:facility,name:'Synthetic'}]};}
function mock(overrides={}) {
 const rows=data();let writes=0;
 return {get writes(){return writes},from(table){let values=rows[table]||[];let cap=Infinity;let options;
 const query={select(_s,o){options=o;return this},eq(){return this},is(){return this},lte(){return this},or(){return this},order(){return this},in(field,allowed){if(table==='rate_schedules')values=values.filter(v=>allowed.includes(v[field]));return this},limit(n){cap=n;return this},then(resolve,reject){const result={data:values.slice(0,cap),error:null,...(options?.count==='exact'?{count:values.length}:{}),...overrides[table]};return Promise.resolve(result).then(resolve,reject)}};return query;},rpc(){writes++;return Promise.resolve({data:[{invoice_id:'synthetic',inserted:true}],error:null})}};
}
const cases=[];
async function check(name,fn){try{await fn();cases.push({name,status:'PASS'})}catch(e){cases.push({name,status:'FAIL',message:String(e.message)})}}
for(const [label,file] of [['app',appFile],['edge-shared',edgeFile]]){
 const producer=load(file);
 await check(label+' excludes latest draft rate',async()=>{const r=await producer.buildMonthlyInvoicePreview(mock(),{facilityId:facility,billingYear:2026,billingMonth:5});assert.equal(r.preview[0].total,372000)});
 for(const table of ['residents','resident_payers','facility_medicaid_providers','resident_rate_agreements','invoices']){
  await check(label+' rejects incomplete '+table,async()=>{const r=await producer.buildMonthlyInvoicePreview(mock({[table]:{count:2501}}),{facilityId:facility,billingYear:2026,billingMonth:5});assert.equal(r.preview.length,0);assert.ok(r.error)});
  await check(label+' rejects null '+table,async()=>{const r=await producer.buildMonthlyInvoicePreview(mock({[table]:{data:null,count:null}}),{facilityId:facility,billingYear:2026,billingMonth:5});assert.equal(r.preview.length,0);assert.ok(r.error)});
 }
 await check(label+' rejects incomplete facility list',async()=>{await assert.rejects(()=>producer.listActiveFacilitiesForOrganization(mock({facilities:{count:2501}}),org))});
 await check(label+' rejects fractional billing month',async()=>{const r=await producer.buildMonthlyInvoicePreview(mock(),{facilityId:facility,billingYear:2026,billingMonth:5.5});assert.equal(r.preview.length,0);assert.ok(r.error)});
}
await check('actual Edge organization handler returns configured cap',async()=>{const client=mock({residents:{data:[],count:0}}),registered={};load(handlerFile,client,registered);const r=await registered.handler(new Request('http://127.0.0.1/fixture',{method:'POST',headers:{'x-cron-secret':'synthetic-local-secret'},body:JSON.stringify({organization_id:org,billing_year:2026,billing_month:5,max_facilities:5})}));const body=await r.json();assert.equal(body.max_facilities,5)});
await check('actual Edge incomplete preview never writes',async()=>{const client=mock({residents:{count:2501}}),registered={};load(handlerFile,client,registered);const r=await registered.handler(new Request('http://127.0.0.1/fixture',{method:'POST',headers:{'x-cron-secret':'synthetic-local-secret'},body:JSON.stringify({facility_id:facility,billing_year:2026,billing_month:5})}));assert.equal(r.status,422);assert.equal(client.writes,0)});
const report={timestamp:new Date().toISOString(),source:Object.fromEntries([appFile,edgeFile,handlerFile].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),scope:'Executed exact app/Edge producer and actual registered Edge handler through TypeScript transpilation with synthetic Supabase transport; no Deno hosting or live database proof',cases};fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(out,'manifest.private.json'),JSON.stringify({created_by:'finance_source_inventory',run_id:'hfa-20260908-01a08335',paths:[path.join(out,'baseline.mjs'),path.join(out,'baseline.json')]},null,2));console.log(JSON.stringify({cases:cases.length,failed:cases.filter(c=>c.status==='FAIL').length,failures:cases.filter(c=>c.status==='FAIL').map(c=>({name:c.name,message:c.message.slice(0,180)}))},null,2));
