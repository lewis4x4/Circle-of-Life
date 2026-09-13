import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {fileURLToPath}from'node:url';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../../..'),ready=process.argv[2],mode=process.argv[3];
if(!ready||!['intake','review'].includes(mode))throw Error('Explicit parent readiness and intake/review mode required');
const verify=()=>execFileSync('python3',['-B',path.join(out,'guarded.py'),'verify','--ready',ready],{cwd:root,stdio:'pipe'});verify();
const readiness=JSON.parse(fs.readFileSync(ready)),privatePath=path.join(os.homedir(),'.config/haven-staging/col158-fixture.json'),state=JSON.parse(fs.readFileSync(privatePath));
if((fs.statSync(privatePath).mode&0o077)!==0||state.cleaned||!state.setupPassed||state.sourceSha!==readiness.sourceSha||state.target!=='iwcnajanvjvynolltflw')throw Error('Fresh exact private fixture required');
if(state.pendingBrowser)throw Error('Uncertain prior browser mutation; inspect saved exact requests before retry');
if(mode==='review'&&!state.httpProofPassed)throw Error('HTTP proof prerequisite');if(mode==='intake'&&state.browserIntakePassed)throw Error('Intake already completed; do not repeat native creation');
for(const label of ['One','Two'])if(crypto.createHash('sha256').update(fs.readFileSync(state['pdf_'+label])).digest('hex')!==state.pdf_hashes[label])throw Error('PDF input hash mismatch');
const save=()=>fs.writeFileSync(privatePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const session=state.sessions.owner;if(session.expires_at*1000<Date.now()+180000)throw Error('Fresh session required');
const require=createRequire(path.join(root,'package.json')),{chromium}=require('playwright'),AxeBuilder=require('@axe-core/playwright').default;
const token='base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'),cookies=[];for(let i=0;i<token.length;i+=3180)cookies.push({name:'sb-'+state.target+'-auth-token'+(token.length>3180?'.'+i/3180:''),value:token.slice(i,i+3180),domain:'127.0.0.1',path:'/',secure:false,httpOnly:false,sameSite:'Lax'});
const report={mode,sourceSha:readiness.sourceSha,target:state.target,cases:[]},browser=await chromium.launch({headless:true});
try{for(const width of mode==='intake'?[1440]:[1440,375]){
 verify();const context=await browser.newContext({viewport:{width,height:width===375?812:1000}});await context.addCookies(cookies);const page=await context.newPage();const result={width,pageErrors:[],consoleErrors:[],httpFailures:[]};report.cases.push(result);
 page.on('request',request=>{const url=new URL(request.url());if(request.method()==='POST'&&url.pathname.startsWith('/api/admin/operations/provider-reports')){state.browserRequests??=[];state.browserRequests.push({path:url.pathname,body:request.postData(),at:new Date().toISOString()});save();}});
 page.on('pageerror',e=>result.pageErrors.push({message:e.message,stack:e.stack}));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)result.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
 try{
  const target=mode==='intake'?state.task:width===1440?state.task:state.second_task;
  const response=await page.goto(`http://127.0.0.1:4358/admin/operations/work?facility_id=${state.site}`,{waitUntil:'domcontentloaded',timeout:90000});if(response.status()!==200)throw Error('Work route failed');
  const rows=page.getByRole('listitem',{name:'COL158 Synthetic provider report',exact:true});await rows.first().waitFor({state:'visible',timeout:60000});let row,body;
  for(const candidate of await rows.all()){
   const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/provider-reports'&&r.request().method()==='GET'&&r.status()===200);
   await candidate.getByText('Provider reports and support plans',{exact:true}).click();body=await(await read).json();if(body.task_id===target){row=candidate;break;}
  }
  if(!row||body.resident_id!==state.resident||!body.complete||!body.can_intake)throw Error('Exact task/patient/current writer scope unavailable');
  if(mode==='intake'){
   await row.getByText('Add native resident contact',{exact:true}).click();await row.getByLabel('Contact name',{exact:true}).fill('Synthetic Caseworker Example');await row.getByLabel('Contact type',{exact:true}).fill('caseworker');
   const contactRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/provider-reports/contacts'&&r.request().method()==='POST');
   state.pendingBrowser='contact';save();await row.getByRole('button',{name:'Create native contact',exact:true}).click();const contactResponse=await contactRead,contact=await contactResponse.json();
   if(contactResponse.status()!==200||contact.task_id!==target||contact.resident_id!==state.resident)throw Error('Contact not verified');state.browser_contact=contact.contact.id;delete state.pendingBrowser;save();
   await row.getByText('Native report document intake',{exact:true}).click();await row.getByLabel('Document title',{exact:true}).fill('Synthetic report One');await row.getByLabel('Document type',{exact:true}).selectOption('support_plan');await row.getByLabel('Native report file',{exact:true}).setInputFiles(state.pdf_One);
   const finalizedRead=page.waitForResponse(r=>/^\/api\/admin\/operations\/provider-reports\/documents\/[^/]+\/finalize$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST',{timeout:90000});
   state.pendingBrowser='native_intake';save();await row.getByRole('button',{name:'Upload and finalize native version',exact:true}).click();const finalizedResponse=await finalizedRead,version=(await finalizedResponse.json()).version;
   if(finalizedResponse.status()!==200||version.task_id!==target||version.resident_id!==state.resident||version.facility_id!==state.site||version.state!=='finalized'||!version.checksum_verified||version.declared_sha256!==state.pdf_hashes.One)throw Error('Native finalization not verified');
   state.browser_version=version.id;state.browserIntakePassed=true;delete state.pendingBrowser;save();result.nativeVersion=version.id;result.sha256=version.declared_sha256;result.realBrowserContactAndUpload=true;
   await row.getByText('Native document version finalized. Receipt, review and signature observations remain separate.',{exact:true}).waitFor();
  }else{
   const expectation=body.expectations.find(e=>e.id===state.expectation);if(!expectation||expectation.current_version_id!==state.version_two)throw Error('Existing patient report not reused');
   await row.getByText('Record a distinct report event',{exact:true}).click();await row.getByLabel('Report event',{exact:true}).selectOption('review');await row.getByLabel('Exact native document version',{exact:true}).selectOption(state.version_two);await row.getByLabel('Review result',{exact:true}).selectOption('reviewed');await row.getByLabel('Review findings',{exact:true}).fill('Synthetic independent task review via actual UI');
   const eventRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/operations/provider-reports'&&r.request().method()==='POST');
   state.pendingBrowser='review-'+width;save();const form=row.getByLabel('Review findings',{exact:true}).locator('xpath=ancestor::form');await form.getByRole('button',{name:'Save factual report event',exact:true}).click();const eventResponse=await eventRead,updated=await eventResponse.json();
   if(eventResponse.status()!==200||updated.task_id!==target||updated.expectations.find(e=>e.id===state.expectation)?.review_state!=='reviewed')throw Error('Current task review not recorded');delete state.pendingBrowser;save();result.currentTaskReview=true;result.task=target;
   for(const label of ['Native document versions','Report provenance history'])await row.getByText(label,{exact:true}).click();
  }
  const labels=mode==='intake'?['Provider reports and support plans','Native report document intake']:['Provider reports and support plans','Native document versions','Report provenance history'];result.viewportCaptures=[];
  for(let i=0;i<labels.length;i++){const target=row.getByText(labels[i],{exact:true});await target.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:path.join(out,`${mode}-${width}-${i}.png`)});result.viewportCaptures.push(`${mode}-${width}-${i}.png`);}
  result.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();result.axeViolations=axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))}));result.result=result.horizontalOverflow||result.pageErrors.length||result.consoleErrors.length||result.httpFailures.length||result.axeViolations.length?'FAIL':'PASS';
 }catch(e){result.result='FAIL';result.failure={message:e.message,stack:e.stack};await page.screenshot({path:path.join(out,`${mode}-${width}-failed.png`)}).catch(()=>{});}
 await context.close();fs.writeFileSync(path.join(out,`browser-${mode}-report.json`),JSON.stringify(report,null,2)+'\n');
}}finally{await browser.close();verify();report.result=report.cases.length===(mode==='intake'?1:2)&&report.cases.every(c=>c.result==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(out,`browser-${mode}-report.json`),JSON.stringify(report,null,2)+'\n');}
if(report.result!=='PASS')process.exitCode=1;
