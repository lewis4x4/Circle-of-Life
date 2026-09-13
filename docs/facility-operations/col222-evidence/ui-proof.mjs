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
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/haven-staging/col222-fixture.json'),'utf8'));
if(state.target!=='iwcnajanvjvynolltflw'||state.cleaned||!state.receipt)throw Error('Fresh completed fixture required');
const base='http://127.0.0.1:4322';const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const diff=execFileSync('git',['diff','--','src'],{cwd:root});const diffHash=createHash('sha256').update(diff).digest('hex');
const files=execFileSync('git',['diff','--name-only','--','src'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const sourceFiles=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const token='base64-'+Buffer.from(JSON.stringify(state.session)).toString('base64url');
const cookieName='sb-'+state.target+'-auth-token';const cookies=[];
for(let at=0;at<token.length;at+=3180)cookies.push({name:cookieName+(token.length>3180?'.'+at/3180:''),value:token.slice(at,at+3180),domain:'127.0.0.1',path:'/',httpOnly:false,secure:false,sameSite:'Lax'});
const report={at:new Date().toISOString(),target:state.target,base,sourceSha:sha,diffSha256:diffHash,sourceFiles,fixture:{actor:state.user,site:state.site,run:state.run},results:[]};
const landmarks=['landmark-main-is-top-level','landmark-no-duplicate-main','landmark-banner-is-top-level','landmark-contentinfo-is-top-level','landmark-no-duplicate-banner','landmark-no-duplicate-contentinfo'];
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,375])for(const view of ['today','history']){
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
   await page.keyboard.press('Control+Home');await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
   await page.keyboard.press('Tab');result.firstFocus=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim(),href:document.activeElement?.getAttribute('href')}));
   if(result.firstFocus.href!=='#main-content')throw Error('Skip link not first keyboard target');
   await page.keyboard.press('Enter');
   result.skipAfterEnter=await page.evaluate(()=>({hash:location.hash,activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id,targetExists:!!document.getElementById('main-content')}));
   if(result.skipAfterEnter.hash!=='#main-content'||!result.skipAfterEnter.targetExists)throw Error('Skip-link navigation failed');
   await page.keyboard.press('Tab');result.nextFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,100),withinTarget:!!document.getElementById('main-content')?.contains(document.activeElement)}));
   if(!result.nextFocus.withinTarget)throw Error('Keyboard focus did not continue inside skip target');
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();
   result.axeViolations=axe.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}));
   result.landmarkViolations=result.axeViolations.filter(v=>landmarks.includes(v.id));
   result.landmarkPasses=axe.passes.filter(v=>landmarks.includes(v.id)).map(v=>v.id);
   result.semanticCounts=await page.evaluate(()=>({main:document.querySelectorAll('main,[role="main"]').length,nestedMain:document.querySelectorAll('main main').length,nestedBanner:document.querySelectorAll('main [role="banner"]').length,nestedContentinfo:document.querySelectorAll('main [role="contentinfo"]').length}));
   result.screenshot=`${view}-${width}.png`;await page.screenshot({path:path.join(out,result.screenshot),fullPage:true});
   result.bodyText=(await page.locator('body').innerText()).slice(0,12000);
   if(result.landmarkViolations.length||result.semanticCounts.main!==1||result.semanticCounts.nestedMain)throw Error('Landmark regression');
   if(result.errors.length||result.httpFailures.length)throw Error('Page errors/read failures');
   result.status='PASS';
  }catch(e){result.status='FAIL';result.failure=e.message;await page.screenshot({path:path.join(out,`${view}-${width}-failed.png`),fullPage:true}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(out,'ui-report.json'),JSON.stringify(report,null,2));
 }
}finally{
 await browser.close();report.sourceUnchanged=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()===sha&&createHash('sha256').update(execFileSync('git',['diff','--','src'],{cwd:root})).digest('hex')===diffHash;
 report.status=report.sourceUnchanged&&report.results.length===4&&report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';
 fs.writeFileSync(path.join(out,'ui-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,results:report.results.map(({width,view,status,failure,landmarkViolations,skipAfterEnter,nextFocus,axeViolations})=>({width,view,status,failure,landmarkViolations,skipAfterEnter,nextFocus,otherViolations:axeViolations?.filter(v=>!landmarks.includes(v.id))}))},null,2));
}
