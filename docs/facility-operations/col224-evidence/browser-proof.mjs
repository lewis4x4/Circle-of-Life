import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..'),ready=process.argv[2];if(!ready)throw Error('Parent readiness required');const verify=()=>execFileSync('python3',['-B',path.join(out,'guard.py'),'verify','--ready',ready],{cwd:root,stdio:'pipe'});verify();const readiness=JSON.parse(fs.readFileSync(ready));
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/haven-staging/col224-fixture.json')));if(state.cleaned||state.target!==readiness.target)throw Error('Fresh active fixture required');
const require=createRequire(path.join(root,'package.json'));const {chromium}=require('playwright');const AxeBuilder=require('@axe-core/playwright').default;
const token='base64-'+Buffer.from(JSON.stringify(state.session)).toString('base64url'),name='sb-'+state.target+'-auth-token',cookies=[];for(let i=0;i<token.length;i+=3180)cookies.push({name:name+(token.length>3180?'.'+i/3180:''),value:token.slice(i,i+3180),domain:'127.0.0.1',path:'/',secure:false,httpOnly:false,sameSite:'Lax'});cookies.push({name:'haven_selected_facility',value:state.site,domain:'127.0.0.1',path:'/',sameSite:'Lax'});
const report={at:new Date().toISOString(),target:state.target,source_manifest:readiness.source_manifest,clock_control:'Real browser wall clock; no freezing or hydration suppression',results:[]};const browser=await chromium.launch({headless:true});
try{for(const width of [375,1440]){
 const context=await browser.newContext({viewport:{width,height:width===375?812:1000},colorScheme:'light'});await context.addCookies(cookies);const page=await context.newPage();let item;
 page.on('pageerror',error=>item?.pageErrors.push({name:error.name,message:error.message,stack:error.stack??null,cause:error.cause?String(error.cause):null}));
 page.on('console',message=>{if(message.type()==='error')item?.consoleErrors.push({text:message.text(),location:message.location()})});
 page.on('response',response=>{if(response.status()>=400)item?.httpFailures.push({path:new URL(response.url()).pathname,status:response.status()})});
 for(const load of ['initial','reload']){
  verify();item={width,load,pageErrors:[],consoleErrors:[],httpFailures:[]};report.results.push(item);
  try{
   const response=load==='initial'?await page.goto(readiness.appUrl+'/admin/billing/invoices',{waitUntil:'domcontentloaded',timeout:90000}):await page.reload({waitUntil:'domcontentloaded',timeout:90000});
   if(response.status()!==200||new URL(page.url()).pathname!=='/admin/billing/invoices')throw Error('Actual billing route did not load');
   const serverHtml=await response.text();const serverClock=serverHtml.match(/<span[^>]*>\s*As of([\s\S]*?)<\/span>/);
   item.serverClockText=serverClock?('As of'+serverClock[1]).replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim():null;
   if(item.serverClockText!=='As of — ET')throw Error('Server clock placeholder was not confirmed');
   await page.getByRole('heading',{name:'Billing & AR',exact:true}).waitFor({timeout:60000});
   const scope=page.getByRole('radio',{name:state.run+' Site',exact:true});await scope.waitFor({timeout:60000});if(await scope.getAttribute('aria-checked')!=='true')await scope.click();
   await page.getByText('No invoices in this scope',{exact:true}).waitFor({timeout:60000});
   const clock=page.getByText(/^As of\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/).first();await clock.waitFor({timeout:60000});item.clockAfterHydration=await clock.innerText();
   await page.evaluate(()=>{window.__col224RefreshCount=0;window.addEventListener('billing-ar-overview-refresh',()=>window.__col224RefreshCount++)});
   await page.getByRole('button',{name:'Refresh',exact:true}).first().click();await page.waitForFunction(()=>window.__col224RefreshCount===1);
   item.clockAfterRefresh=await clock.innerText();item.refreshEventCount=await page.evaluate(()=>window.__col224RefreshCount);
   // The minute can remain identical during a short real-clock test. Do not
   // mistake unchanged formatted text for a failed refresh or fake time movement.
   item.displayedMinuteChanged=item.clockAfterHydration!==item.clockAfterRefresh;
   await page.getByText('No invoices in this scope',{exact:true}).waitFor({timeout:60000});
   await page.screenshot({path:path.join(out,`${load}-${width}.png`)});
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();item.axeViolations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}));
   if(item.pageErrors.length||item.consoleErrors.length||item.httpFailures.length||item.axeViolations.length)throw Error('Browser errors, failed reads or accessibility violations');item.status='PASS';
  }catch(error){item.status='FAIL';item.failure=error.stack??String(error);await page.screenshot({path:path.join(out,`${load}-${width}-failed.png`)}).catch(()=>{});}
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
 }
 await context.close();
}}finally{await browser.close();verify();report.result=report.results.length===4&&report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
