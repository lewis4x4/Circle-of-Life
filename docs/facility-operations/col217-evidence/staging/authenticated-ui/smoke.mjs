import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire('/Users/brianlewis/Circle of Life/Haven HFO Staging Integration/package.json');
const {chromium}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const out=path.dirname(new URL(import.meta.url).pathname);
const dir=decodeURIComponent(out);
const base='http://127.0.0.1:4317';
const routes=[{path:'/admin/operations/work',ready:'Site work'},{path:'/admin/billing/invoices',ready:'All invoices'}];
const report={source:'b3e1d819874c942afb737f46eaa632ba54de247c',at:new Date().toISOString(),target:'iwcnajanvjvynolltflw',base,actor:'synthetic corporate fixture',readOnly:true,results:[]};
const browser=await chromium.launch({headless:true});
try {
 for(const route of routes)for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){
  const context=await browser.newContext({viewport,storageState:'/Users/brianlewis/.config/haven-staging/col143-corp-storage-state.json'});
  const page=await context.newPage();
  const errors=[];const httpFailures=[];
  page.on('pageerror',e=>errors.push(String(e.message).slice(0,300)));
  page.on('response',r=>{if(r.status()>=400)httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
  const item={route:route.path,viewport:viewport.width,errors,httpFailures};
  try{
   const response=await page.goto(base+route.path,{waitUntil:'domcontentloaded',timeout:90000});
   item.httpStatus=response?.status();
   if(item.httpStatus!==200)throw new Error('Main route did not return200');
   if(new URL(page.url()).pathname!==route.path)throw new Error('Redirect prevented actual requested-page proof: '+new URL(page.url()).pathname);
   await page.getByText(route.ready,{exact:true}).first().waitFor({state:'visible',timeout:60000});
   await page.waitForTimeout(2500);
   if(route.path==='/admin/operations/work'){
    const site=page.locator('select').first();
    const options=await site.locator('option').allTextContents();
    const fixtureOptions=options.filter(text=>/^col143-.* sitea$/.test(text.trim()));
    if(fixtureOptions.length!==1)throw new Error('Expected exactly one visible synthetic Site A option');
    await site.selectOption({label:fixtureOptions[0]});
    await page.waitForTimeout(2500);
    item.todayText=(await page.locator('body').innerText()).slice(-9000);
    await page.screenshot({path:path.join(dir,'operations-today-'+viewport.width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'History',exact:true}).click();
    await page.waitForTimeout(2500);
    item.selectedSite=fixtureOptions[0];item.selectedView='history';
   }
   item.finalPath=new URL(page.url()).pathname;
   if(item.finalPath!==route.path)throw new Error('Client redirect prevented actual requested-page proof');
   item.heading=await page.locator('h1,h2').allTextContents();
   item.alerts=(await page.locator('[role="alert"]').allTextContents()).filter(text=>text.trim());
   item.loadingText=await page.getByText(/loading/i).allTextContents();
   item.bodyText=(await page.locator('body').innerText()).slice(0,16000);
   const shot=route.path.replaceAll('/','_')+'-'+viewport.width+'.png';
   await page.screenshot({path:path.join(dir,shot),fullPage:true});item.screenshot=shot;
   const axe=await new AxeBuilder({page}).exclude('nextjs-portal').analyze();
   item.axeViolations=axe.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}));
   item.axePassCount=axe.passes.length;
   item.status=errors.length||item.alerts.length||httpFailures.length||item.axeViolations.some(v=>['critical','serious'].includes(v.impact))?'FAIL':'PASS';
  }catch(error){item.status='FAIL';item.failure=String(error.message).slice(0,500);await page.screenshot({path:path.join(dir,route.path.replaceAll('/','_')+'-'+viewport.width+'-failed.png'),fullPage:true}).catch(()=>{});}
  report.results.push(item);await context.close();
 }
}finally{await browser.close();report.status=report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,results:report.results.map(({route,viewport,status,failure,alerts,httpFailures,axeViolations})=>({route,viewport,status,failure,alerts,httpFailures,axeViolations}))}));
