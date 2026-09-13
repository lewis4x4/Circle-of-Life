import {verifyNativeRuntime} from './native-runtime-identity.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/native-services';
const config=JSON.parse(fs.readFileSync(root+'/smoke.private.json','utf8'));
const manifest=JSON.parse(fs.readFileSync(root+'/manifest.private.json','utf8'));
const verifiedRuntime=verifyNativeRuntime(config,true);
const original=JSON.parse(fs.readFileSync('test-results/finance-integration/2026-09-09T06-50-13.440Z-native-authenticated-audit.json','utf8'));
const fixture=JSON.parse(fs.readFileSync(root+'/'+original.run_id+'-fixture.private.json','utf8')).fixture;
const cases=[];function check(name,ok,expected,actual){cases.push({name,acceptance_ids:['HFA-012','HFA-059'],status:ok?'PASS':'FAIL',expected,actual});if(!ok)throw Error(name);}
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const sql=s=>execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-qAt','-h',root,'-p','55448','-U','postgres','-d','hfa_native_01a08335','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
async function sign(label){const c=JSON.parse(fs.readFileSync(root+'/'+original.run_id+'-'+label+'-credentials.private.json','utf8'));const r=await fetch(config.apiUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:c.email,password:c.password}),redirect:'error',signal:AbortSignal.timeout(10000)});const d=await r.json();check(label+' real sign-in',r.status===200&&typeof d.access_token==='string',200,r.status);return {id:c.id,token:d.access_token};}
async function edge(job,token,method='POST'){return fetch('http://127.0.0.1:59835/functions/v1/export-audit-log',{method,headers:{apikey:config.anonKey,Origin:'http://127.0.0.1:4327','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify({job_id:job})}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});}
let failure=null;
try{
const a=await sign('restricted'),b=await sign('outsider');
const job=sql(`SELECT id FROM public.audit_log_export_jobs WHERE organization_id='${fixture.org}' AND requested_by='${a.id}' AND facility_id='${fixture.a}' ORDER BY created_at LIMIT 1;`);
if(!/^[0-9a-f-]{36}$/.test(job))throw Error('Expected owned synthetic job');
const expected=JSON.parse(sql(`SELECT json_build_object('sha',sha256_checksum,'rows',row_count) FROM haven.audit_export_snapshots WHERE job_id='${job}';`));
const positive=await edge(job,a.token);const bytes=await positive.text();check('actual Deno handler returns complete immutable CSV',positive.status===200&&expected.rows===2505&&hash(bytes)===expected.sha,{status:200,rows:2505,sha:expected.sha},{status:positive.status,sha:hash(bytes)});
check('actual HTTP checksum and no-store headers',positive.headers.get('X-Checksum-SHA256')===expected.sha&&positive.headers.get('Cache-Control')==='no-store',true,true);
check('actual HTTP CORS exposes checksum to permitted origin',positive.headers.get('Access-Control-Allow-Origin')==='http://127.0.0.1:4327'&&positive.headers.get('Access-Control-Expose-Headers').includes('X-Checksum-SHA256'),true,true);
const repeat=await edge(job,a.token);check('HTTP retry returns identical saved bytes',repeat.status===200&&await repeat.text()===bytes,200,repeat.status);
for(const [name,token,status] of [['missing bearer',null,401],['other organization',b.token,403],['service role',config.serviceRoleKey,403]]){const r=await edge(job,token);check(name+' denied through actual handler',r.status===status,status,r.status);}
const parts=a.token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);const bad=await edge(job,parts.join('.'));check('invalid signed request denied through actual handler',bad.status===401,401,bad.status);
const logout=await fetch(config.apiUrl+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+a.token},redirect:'error',signal:AbortSignal.timeout(10000)});check('actual GoTrue logout succeeds',logout.status===204,204,logout.status);
const revoked=await edge(job,a.token);check('still-signed revoked session denied through actual handler',revoked.status===401,401,revoked.status);
}catch(e){failure=e.message;}
const report={schema_version:1,status:failure?'FAIL':'PASS',evidence_layer:'standalone-Deno-real-Auth-PostgREST',source_sha256:hash(fs.readFileSync('supabase/functions/export-audit-log/handler.ts')),runtime_identity_helper_sha256:hash(fs.readFileSync(root+'/native-runtime-identity.mjs')),runtime:verifiedRuntime,driver_sha256:hash(fs.readFileSync(import.meta.filename)),cases,counts:{total:cases.length,passed:cases.filter(x=>x.status==='PASS').length,failed:cases.filter(x=>x.status==='FAIL').length,skipped:0},failure,limits:['Native standalone Deno is not the deployed Supabase Edge JWT gateway; actual handler delegates JWT/current authorization to real PostgREST.','Synthetic fixtures only; not hosted production, provider,342 dynamic-security or business acceptance.']};
const out='test-results/finance-integration/'+new Date().toISOString().replaceAll(':','-')+'-native-audit-http.json';fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,failure,artifact:out}));process.exit(failure?1:0);
