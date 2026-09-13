import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const out=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(out,'../../../..');
const ready=process.argv[2];if(!ready)throw Error('Explicit parent readiness path required');
const verify=()=>execFileSync('python3',[path.join(out,'guarded.py'),'verify','--ready',ready],{cwd:root,stdio:'pipe'});
verify();const stamp=JSON.parse(fs.readFileSync(path.join(out,'staging-readiness.json')));const readiness=JSON.parse(fs.readFileSync(ready));
if(stamp.result!=='PASS'||stamp.sourceSha!==readiness.sourceSha)throw Error('Reviewed staging readback required');
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/haven-staging/col140-profile-fixture.json')));
if(state.cleaned||state.target!=='iwcnajanvjvynolltflw'||state.sourceSha!==readiness.sourceSha||!state.prepared)throw Error('Fresh exact-source exercised fixture required');
const require=createRequire(path.join(root,'package.json'));const {chromium}=require('playwright');const AxeBuilder=require('@axe-core/playwright').default;
const token='base64-'+Buffer.from(JSON.stringify(state.session)).toString('base64url');const name='sb-'+state.target+'-auth-token';const cookies=[];
for(let i=0;i<token.length;i+=3180)cookies.push({name:name+(token.length>3180?'.'+i/3180:''),value:token.slice(i,i+3180),domain:'127.0.0.1',path:'/',secure:false,httpOnly:false,sameSite:'Lax'});
const report={sourceSha:readiness.sourceSha,sourceManifest:readiness.source_manifest,target:state.target,base:'http://127.0.0.1:4340',results:[]};const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,375]){
  verify();const context=await browser.newContext({viewport:{width,height:width===375?812:1000}});await context.addCookies(cookies);const page=await context.newPage();const item={width,errors:[],httpFailures:[]};report.results.push(item);
  page.on('pageerror',e=>item.errors.push(e.message.slice(0,500)));page.on('response',r=>{if(r.status()>=400)item.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
  try{
   const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/facility-profile'&&r.status()===200,{timeout:90000});
   const response=await page.goto(report.base+'/admin/operations/profile?facility_id='+state.site,{waitUntil:'domcontentloaded',timeout:90000});if(response.status()!==200)throw Error('Route failed');
   const profile=await(await read).json();if(profile.facility.id!==state.site||profile.entries.length!==91||profile.coverage.component_count!==110||profile.complete!==true)throw Error('Wrong/incomplete profile');
   await page.getByRole('heading',{name:'Facility profile',exact:true}).waitFor({timeout:60000});
   const prepared=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/facility-profile/drafts'&&r.request().method()==='POST',{timeout:90000});
   await page.getByRole('button',{name:'Prepare missing drafts',exact:true}).click();const prepResponse=await prepared;const prep=await prepResponse.json();if(prepResponse.status()!==200||prep.prepared!==0||prep.results.length!==110)throw Error('Safe repeat preparation failed');
   await page.getByText(/Activity drafts prepared: 0\./).waitFor({timeout:90000});
   await page.getByRole('button',{name:'Prepare missing drafts',exact:true}).waitFor({timeout:90000});
   item.coverage=profile.coverage;item.retry={prepared:prep.prepared,preserved:prep.preserved,unresolved:prep.unresolved};
   await page.screenshot({path:path.join(out,`profile-${width}.png`)});
   await page.locator('details').first().locator('summary').click();await page.locator('details[open]').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,`profile-expanded-${width}.png`)});
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();item.axeViolations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}));
   item.status=item.errors.length||item.httpFailures.length||item.axeViolations.length?'FAIL':'PASS';
  }catch(e){item.status='FAIL';item.failure=e.message;await page.screenshot({path:path.join(out,`profile-${width}-failed.png`)}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
 }
}finally{await browser.close();verify();report.result=report.results.length===2&&report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
