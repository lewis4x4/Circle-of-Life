import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const out=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(out,'../../..');
const require=createRequire(path.join(root,'package.json'));
const {chromium}=require('playwright');const AxeBuilder=require('@axe-core/playwright').default;
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/haven-staging/col223-fixture.json'),'utf8'));
if(state.target!=='iwcnajanvjvynolltflw'||state.cleaned||!state.receipt)throw Error('Fresh completed fixture required');
const base='http://127.0.0.1:4323';const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const diff=execFileSync('git',['diff','--','src'],{cwd:root});const diffHash=createHash('sha256').update(diff).digest('hex');
const files=execFileSync('git',['diff','--name-only','--','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const sourceFiles=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const token='base64-'+Buffer.from(JSON.stringify(state.session)).toString('base64url');
const cookieName='sb-'+state.target+'-auth-token';const cookies=[];
for(let at=0;at<token.length;at+=3180)cookies.push({name:cookieName+(token.length>3180?'.'+at/3180:''),value:token.slice(at,at+3180),domain:'127.0.0.1',path:'/',httpOnly:false,secure:false,sameSite:'Lax'});
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Explicit phase required');
const report={phase,at:new Date().toISOString(),target:state.target,base,sourceSha:sha,diffSha256:diffHash,sourceFiles,fixture:{actor:state.user,site:state.site,run:state.run},results:[]};
const landmarks=['landmark-main-is-top-level','landmark-no-duplicate-main','landmark-banner-is-top-level','landmark-contentinfo-is-top-level','landmark-no-duplicate-banner','landmark-no-duplicate-contentinfo'];
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,375])for(const view of ['history']){
  const context=await browser.newContext({viewport:{width,height:width===375?812:1000}});await context.addCookies(cookies);
  const page=await context.newPage();const result={width,view,errors:[],httpFailures:[]};report.results.push(result);
  page.on('pageerror',e=>result.errors.push(e.message.slice(0,500)));
  page.on('response',r=>{if(r.status()>=400)result.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
  try{
   const workspace=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/workspace'&&r.status()===200,{timeout:90000});
   const response=await page.goto(base+`/admin/operations/work?facility_id=${state.site}&view=${view}`,{waitUntil:'domcontentloaded',timeout:90000});
   result.httpStatus=response.status();if(response.status()!==200)throw Error('Route failed');
   const reply=await (await workspace).json();result.workspace={actor:reply.actor,facility_id:reply.facility_id,partial:reply.partial,groups:Object.keys(reply.groups??{})};
   await page.getByRole('heading',{name:'Site work',exact:true}).waitFor({timeout:60000});
   await page.getByText('Synthetic facilities check',{exact:true}).first().waitFor({timeout:60000});
   result.route=new URL(page.url()).pathname;if(result.route!=='/admin/operations/work')throw Error('Unexpected redirect');
   result.selectedFacility=await page.locator('select').first().inputValue();if(result.selectedFacility!==state.site)throw Error('Wrong fixture site');
   if(reply.actor.id!==state.user)throw Error('Wrong authenticated actor');
   await page.getByRole('button',{name:'View receipt history',exact:true}).click();
   const chain=page.getByRole('region',{name:'Receipt chain'});
   await chain.getByText(`Current evidence: ${phase==='before'?'missing':'complete'}`,{exact:true}).waitFor({timeout:60000});
   await chain.getByText('Original receipt state (historical): performed_missing_evidence',{exact:true}).waitFor({timeout:60000});
   await chain.getByText('No issues reported.',{exact:true}).waitFor({timeout:60000});
   if(phase==='after')await chain.getByRole('button',{name:'Download evidence'}).waitFor({timeout:60000});
   else await chain.getByText('No attached evidence.',{exact:true}).waitFor({timeout:60000});
   result.receiptText=await chain.innerText();
   if(result.receiptText.includes('Receipt state: performed_missing_evidence'))throw Error('Ambiguous label remains');
   const backendResponse=await context.request.get(base+'/api/admin/operations/occurrences/'+state.occurrence_completed.id+'/receipts');
   if(backendResponse.status()!==200)throw Error('Receipt read failed');
   const backend=(await backendResponse.json()).receipts[0];
   result.receipt={id:backend.id,completion_state:backend.completion_state,evidence_status:backend.evidence_status,evidence_status_current:backend.evidence_status_current,recorded_at:backend.recorded_at,performed_at:backend.performed_at,recorder_id:backend.recorder_id};
   if(backend.id!==state.receipt.receipt.id||backend.completion_state!=='performed_missing_evidence'||backend.evidence_status!=='missing'||backend.evidence_status_current!==(phase==='before'?'missing':'complete'))throw Error('Backend states did not match history');
   await chain.screenshot({path:path.join(out,`${phase}-receipt-${width}.png`)});
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();
   result.axeViolations=axe.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}));
   result.landmarkViolations=result.axeViolations.filter(v=>landmarks.includes(v.id));
   result.landmarkPasses=axe.passes.filter(v=>landmarks.includes(v.id)).map(v=>v.id);
   result.semanticCounts=await page.evaluate(()=>({main:document.querySelectorAll('main,[role="main"]').length,nestedMain:document.querySelectorAll('main main').length,nestedBanner:document.querySelectorAll('main [role="banner"]').length,nestedContentinfo:document.querySelectorAll('main [role="contentinfo"]').length}));
   result.screenshot=`${phase}-${view}-${width}.png`;await page.screenshot({path:path.join(out,result.screenshot),fullPage:true});
   result.bodyText=(await page.locator('body').innerText()).slice(0,12000);
   if(result.landmarkViolations.length||result.semanticCounts.main!==1||result.semanticCounts.nestedMain)throw Error('Landmark regression');
   if(result.errors.length||result.httpFailures.length)throw Error('Page errors/read failures');
   result.status='PASS';
  }catch(e){result.status='FAIL';result.failure=e.message;await page.screenshot({path:path.join(out,`${phase}-${view}-${width}-failed.png`),fullPage:true}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(out,`${phase}-ui-report.json`),JSON.stringify(report,null,2));
 }
}finally{
 await browser.close();report.sourceUnchanged=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()===sha&&createHash('sha256').update(execFileSync('git',['diff','--','src'],{cwd:root})).digest('hex')===diffHash;
 report.status=report.sourceUnchanged&&report.results.length===2&&report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';
 fs.writeFileSync(path.join(out,`${phase}-ui-report.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,results:report.results.map(({width,view,status,failure,landmarkViolations,skipAfterEnter,nextFocus,axeViolations})=>({width,view,status,failure,landmarkViolations,skipAfterEnter,nextFocus,otherViolations:axeViolations?.filter(v=>!landmarks.includes(v.id))}))},null,2));
}
