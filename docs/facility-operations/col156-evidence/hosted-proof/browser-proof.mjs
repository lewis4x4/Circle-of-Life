import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../../..');
const ready=process.argv[2];if(!ready)throw Error('Explicit parent readiness required');
const verify=()=>execFileSync('python3',['-B',path.join(out,'guarded.py'),'verify','--ready',ready],{cwd:root,stdio:'pipe'});
verify();const readiness=JSON.parse(fs.readFileSync(ready));
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/haven-staging/col156-fixture.json')));
if(state.cleaned||!state.transportPassed||state.sourceSha!==readiness.sourceSha||state.target!=='iwcnajanvjvynolltflw')throw Error('Fresh exercised exact-source fixture required');
state.session=state.sessions.owner;
if(state.session.expires_at*1000<Date.now()+180000)throw Error('Current session required');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const encoded = 'base64-' + Buffer.from(JSON.stringify(state.session)).toString('base64url');
const cookies = [];
for (let i = 0; i < encoded.length; i += 3180) cookies.push({ name: 'sb-' + state.target + '-auth-token' + (encoded.length > 3180 ? '.' + i / 3180 : ''), value: encoded.slice(i, i + 3180), domain: '127.0.0.1', path: '/', secure: false, httpOnly: false, sameSite: 'Lax' });

const report={sourceSha:readiness.sourceSha,target:state.target,cases:[]};const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,375]){
  verify();const context=await browser.newContext({viewport:{width,height:width===375?812:1000}});await context.addCookies(cookies);const page=await context.newPage();const result={width,pageErrors:[],consoleErrors:[],httpFailures:[]};report.cases.push(result);
  page.on('pageerror',e=>result.pageErrors.push({message:e.message,stack:e.stack}));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)result.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
  try{
   const response=await page.goto(`http://127.0.0.1:4356/admin/operations/work?facility_id=${state.site}`,{waitUntil:'domcontentloaded',timeout:90000});if(response.status()!==200)throw Error('Work route failed');
   const row=page.getByRole('listitem',{name:'COL156 Synthetic employee file context',exact:true});await row.waitFor({state:'visible',timeout:60000});
   const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/employee-sources'&&new URL(r.url()).searchParams.get('task_id')===state.task&&r.status()===200);
   await row.getByText('Employee File source context',{exact:true}).click();const initial=await(await read).json();if(initial.task_id!==state.task||initial.employee_id!==state.staff||initial.fields.length!==22||!initial.complete)throw Error('Incomplete/wrong employee projection');
   const reconcile=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/employee-sources/reconcile'&&r.request().method()==='POST');await row.getByRole('button',{name:'Refresh and record source changes',exact:true}).click();const refreshedResponse=await reconcile;const refreshed=await refreshedResponse.json();if(refreshedResponse.status()!==200||refreshed.task_id!==state.task||!refreshed.complete)throw Error('UI reconcile failed');
   result.historyCount=refreshed.history.length;result.scope=refreshed.assessment_scope;
   await row.getByText('Recorded source changes',{exact:true}).click();await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`employee-${width}.png`),fullPage:true});await row.screenshot({path:path.join(out,`employee-row-${width}.png`)});
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();result.axeViolations=axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))}));result.result=result.pageErrors.length||result.consoleErrors.length||result.httpFailures.length||result.axeViolations.length?'FAIL':'PASS';
  }catch(e){result.result='FAIL';result.failure={message:e.message,stack:e.stack};await page.screenshot({path:path.join(out,`employee-${width}-failed.png`)}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
 }
}finally{await browser.close();verify();report.result=report.cases.length===2&&report.cases.every(r=>r.result==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
if(report.result!=='PASS')process.exitCode=1;
