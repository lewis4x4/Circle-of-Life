import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../../..');
export async function main(ready){
 if(!ready)throw Error('Explicit parent readiness required');
 const verify=()=>execFileSync('python3',['-B',path.join(out,'guarded.py'),'verify','--ready',ready],{cwd:root,stdio:'pipe'});verify();
 const readiness=JSON.parse(fs.readFileSync(ready)),privatePath=path.join(os.homedir(),'.hermes/tmp/agent-runs/haven-col160-closeout-01a09c89/fixture-state.json'),state=JSON.parse(fs.readFileSync(privatePath));
 if((fs.statSync(privatePath).mode&0o077)!==0||state.cleaned||!state.setupPassed||!state.httpProofPassed||state.sourceSha!==readiness.sourceSha||state.target!=='iwcnajanvjvynolltflw')throw Error('Fresh exact private fixture required');
 if(state.pendingBrowser)throw Error('Uncertain prior browser mutation: inspect exact requests before resuming');
 if(state.browserProofPassed)throw Error('Browser proof already complete');
 const save=()=>fs.writeFileSync(privatePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});
 const session=state.sessions.owner;if(session.expires_at*1000<Date.now()+180000)throw Error('Fresh session required');
 const require=createRequire(path.join(root,'package.json')),{chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
 const token='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'),cookies=[];for(let i=0;i<token.length;i+=3180)cookies.push({name:'sb-'+state.target+'-auth-token'+(token.length>3180?'.'+i/3180:''),value:token.slice(i,i+3180),domain:'127.0.0.1',path:'/',secure:false,httpOnly:false,sameSite:'Lax'});
 const report={sourceSha:readiness.sourceSha,target:state.target,cases:[],outboundProviderEmailFrontOfficeCalls:0},browser=await chromium.launch({headless:true});
 try{for(const width of [1440,375]){
  verify();const context=await browser.newContext({viewport:{width,height:width===375?812:1000},reducedMotion:'reduce'});await context.addCookies(cookies);const page=await context.newPage();const result={width,pageErrors:[],consoleErrors:[],httpFailures:[],refusedOutbound:[],screenshots:[]};report.cases.push(result);
  let faultPhase=null,committedBody=null,committedResult=null,retryBody=null;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!['http://127.0.0.1:4360','https://iwcnajanvjvynolltflw.supabase.co'].includes(url.origin)){result.refusedOutbound.push({origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');}
   if(request.method()==='POST'&&url.pathname==='/api/admin/operations/corporate-deliverables'){
    verify();state.browserRequests??=[];state.browserRequests.push({width,path:url.pathname,body:request.postData(),phase:faultPhase,at:new Date().toISOString()});save();
    if(faultPhase==='deterministic'){
     // Inject an obsolete revision into the transport request; the real server
     // returns its deterministic409, and the UI must discard retry state.
     faultPhase=null;const body=JSON.parse(request.postData());body.expected_revision='00000000-0000-4000-8000-000000000000';return route.continue({postData:JSON.stringify(body)});
    }
    if(faultPhase==='uncertain'){
     committedBody=request.postData();const response=await route.fetch();if(response.status()!==200)throw Error('Actual commit before response loss did not succeed');committedResult=await response.json();state.lastDroppedResponse={body:committedBody,result:committedResult,width};save();faultPhase='retry';return route.abort('failed');
    }
    if(faultPhase==='retry'){retryBody=request.postData();if(retryBody!==committedBody)throw Error('Retry bytes changed');faultPhase=null;}
   }
   return route.continue();
  });
  page.on('pageerror',error=>result.pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error'){const text=message.text();if(!/409 \(Conflict\)|net::ERR_FAILED/.test(text))result.consoleErrors.push(text);}});page.on('response',response=>{if(response.status()>=400&&response.status()!==409)result.httpFailures.push({path:new URL(response.url()).pathname,status:response.status()});});
  try{
   const response=await page.goto(`http://127.0.0.1:4360/admin/operations/work?facility_id=${state.site}`,{waitUntil:'domcontentloaded',timeout:90000});if(response.status()!==200)throw Error('Work route failed');
   await page.getByText(/^FPC EOM review · Mapping:/).waitFor({state:'visible',timeout:60000});result.tasklessFpcVisible=true;
   const row=page.getByRole('listitem',{name:'COL160 Synthetic hfo-al-m09-01',exact:true});await row.waitFor({state:'visible'});await row.getByText('Corporate deliverables and meeting history',{exact:true}).click();await row.getByLabel('Period start',{exact:true}).fill(state.period.period_start);
   const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/operations/corporate-deliverables'&&response.request().method()==='GET'&&response.status()===200);await row.getByLabel('Period end',{exact:true}).fill(state.period.period_end);const value=await(await read).json();if(value.task_id!==state.task||!value.coverage_complete)throw Error('Exact task coverage unavailable');
   await row.getByText('Packet version and event history',{exact:true}).click();let loaded=0;while(await row.getByRole('button',{name:'Load older packet history',exact:true}).count()){
    const history=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/corporate-deliverables/history')&&response.status()===200);await row.getByRole('button',{name:'Load older packet history',exact:true}).click();await history;loaded++;if(loaded>20)throw Error('Unbounded UI history');
   }result.historyPagesLoaded=loaded;
   faultPhase='deterministic';state.pendingBrowser='deterministic-'+width;save();const conflict=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/operations/corporate-deliverables'&&response.request().method()==='POST');await row.getByRole('button',{name:'Prepare from current census source',exact:true}).click();if((await conflict).status()!==409)throw Error('Real deterministic409 required');await row.getByText('Corporate change was rejected. Reload current detail before another action.',{exact:true}).waitFor();if(await row.getByRole('button',{name:'Retry identical corporate request',exact:true}).count())throw Error('Deterministic refusal retained uncertain retry');delete state.pendingBrowser;save();result.deterministicRefusal={actualServerStatus:409,injection:'Obsolete revision in transport request',retryAbsent:true};
   const reload=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/operations/corporate-deliverables'&&response.request().method()==='GET'&&response.status()===200);await row.getByRole('button',{name:'Reload corporate coverage',exact:true}).click();await reload;
   faultPhase='uncertain';state.pendingBrowser='uncertain-'+width;save();await row.getByRole('button',{name:'Prepare from current census source',exact:true}).click();await row.getByText('Corporate save result is unknown. Retry the identical request before another change.',{exact:true}).waitFor();if(!await row.getByLabel('Period start',{exact:true}).isDisabled())throw Error('Pending scope remained editable');
   const retry=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/operations/corporate-deliverables'&&response.request().method()==='POST');await row.getByRole('button',{name:'Retry identical corporate request',exact:true}).click();const replay=await retry,replayed=await replay.json();if(replay.status()!==200||retryBody!==committedBody)throw Error('Identical retry did not complete');const prior=committedResult.sites.find(site=>site.facility_id===state.site).expectation,current=replayed.sites.find(site=>site.facility_id===state.site).expectation;if(prior.id!==current.id||prior.current_version_id!==current.current_version_id||prior.revision!==current.revision)throw Error('Retry duplicated committed capture');delete state.pendingBrowser;save();result.uncertainRetry={actualCommittedStatus:200,responseDropped:true,byteIdentical:true,noDuplicate:true};
   await row.getByText('Immutable meeting captures',{exact:true}).click();await row.getByText('Packet version and event history',{exact:true}).click();for(const summary of await row.locator('summary').all()){if((await summary.textContent()).startsWith('Captured '))await summary.click();}
   for(const [index,label] of ['Corporate deliverables and meeting history','Immutable meeting captures','Packet version and event history'].entries()){await row.getByText(label,{exact:true}).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));const filename=`corporate-${width}-${index}.png`;await page.screenshot({path:path.join(out,filename)});result.screenshots.push(filename);}
   // Reachable trust and contract panels are inspected against actual responses.
   result.components=[];
   for(const key of ['hfo-al-m09-03','hfo-al-q01-01','hfo-al-c08-01']){
    const candidates=page.getByRole('listitem',{name:'COL160 Synthetic '+key,exact:true});const expectedTask=state.tasks[key+':'+(key==='hfo-al-m09-03'?'subject':'resident_subject')];let candidate,actual;
    for(const item of await candidates.all()){
     await item.getByText('Corporate deliverables and meeting history',{exact:true}).click();await item.getByLabel('Period start',{exact:true}).fill(state.period.period_start);const dataRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/operations/corporate-deliverables'&&response.request().method()==='GET'&&response.status()===200);await item.getByLabel('Period end',{exact:true}).fill(state.period.period_end);const body=await(await dataRead).json();if(body.task_id===expectedTask){candidate=item;actual=body;break;}
    }
    if(!candidate||actual.activity_key!==key||actual.task_id!==expectedTask)throw Error('Exact component/task response unavailable');
    if(key==='hfo-al-c08-01')await candidate.getByText('Contract recipient and a canonical native contract-document classification remain unconfirmed. Preparation is unavailable; an arbitrary resident document is not accepted.',{exact:true}).waitFor();
    result.components.push({key,task:actual.task_id,available:actual.availability});await candidate.getByText('Corporate deliverables and meeting history',{exact:true}).evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));const filename=`component-${key}-${width}.png`;await page.screenshot({path:path.join(out,filename)});result.screenshots.push(filename);
   }
   result.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();result.axeViolations=axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))}));result.result=result.horizontalOverflow||result.pageErrors.length||result.consoleErrors.length||result.httpFailures.length||result.axeViolations.length||result.refusedOutbound.length?'FAIL':'PASS';
  }catch(error){result.result='FAIL';result.failure={message:error.message,stack:error.stack};await page.screenshot({path:path.join(out,`corporate-${width}-failed.png`)}).catch(()=>{});}
  await context.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');if(result.result!=='PASS')break;
 }}finally{await browser.close();verify();report.result=report.cases.length===2&&report.cases.every(c=>c.result==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
 if(report.result!=='PASS')throw Error('Browser proof failed; inspect retained report and private exact request journal');state.browserProofPassed=true;save();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
