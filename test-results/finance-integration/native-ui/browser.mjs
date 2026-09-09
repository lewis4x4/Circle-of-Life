import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{createRequire}from'node:module';
import{verifyNativeRuntime,nativeRoot}from'../native-services/native-runtime-identity.mjs';
const out='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/ui-read-review';const repo='/Users/brianlewis/Circle of Life/Haven Finance Integration';
const storage=nativeRoot+'/browser-owner/storage-state.private.json';
const runtime=verifyNativeRuntime({projectId:'hfa-native-01a08335',transport:'native-services',apiUrl:'http://127.0.0.1:59831',database:{socket:nativeRoot,port:55448,name:'hfa_native_01a08335',user:'postgres'}});
if((fs.statSync(storage).mode&0o077)!==0)throw Error('Private fixture state permissions required');
process.env.TMPDIR=out+'/tmp';const require=createRequire(repo+'/package.json');const{chromium,expect}=require('@playwright/test');const AxeBuilder=require('@axe-core/playwright').default;
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFiles=['src/components/layout/AppShell.tsx','src/components/finance/FinanceReviewQueueClient.tsx'];
const source=Object.fromEntries(sourceFiles.map(f=>[f,sha(path.join(repo,f))]));
const browser=await chromium.launch({headless:true});const context=await browser.newContext({storageState:storage,viewport:{width:1440,height:1000}});
const denied=[];const rpcCalls=[];await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['http://127.0.0.1:4327','http://127.0.0.1:59831','http://127.0.0.1:59835'].includes(u.origin)){denied.push(u.origin);return route.abort();}if(u.pathname.includes('/rpc/'))rpcCalls.push(u.pathname.split('/rpc/')[1]);return route.continue();});
const page=await context.newPage();const modes=[];let failure=null;
try{
 await page.goto('http://127.0.0.1:4327/admin/finance/integration',{waitUntil:'networkidle',timeout:30000});
 const entity=page.getByRole('combobox',{name:'Entity',exact:true});await expect(entity).toBeEnabled({timeout:30000});await entity.selectOption({label:'Synthetic shared entity'});
 const table=page.getByRole('table',{name:'Source events',exact:true});await expect(table).toBeVisible({timeout:30000});
 for(const theme of['light','dark']){
  await page.setViewportSize({width:1440,height:1000});const toggle=page.getByRole('button',{name:/Toggle theme/});if(!(await toggle.getAttribute('aria-label')).includes('currently '+theme))await toggle.click();await expect(toggle).toHaveAttribute('aria-label',new RegExp('currently '+theme));
  for(const mobile of[false,true]){
   await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});const mode=theme+(mobile?'-mobile':'-desktop');
   const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
   const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
   const readonly=await page.getByText('This viewer cannot prepare, approve or release batches.',{exact:false}).count()>0&&await page.getByRole('button',{name:/^(Prepare|Approve|Release)/i}).count()===0;
   let focus=null;
   if(mobile){
    await table.scrollIntoViewIfNeeded();await table.evaluate(t=>{t.parentElement.scrollLeft=0;});
    await page.getByRole('button',{name:'Refresh page',exact:true}).focus();
    const box=await table.locator('..').boundingBox();const clip={x:Math.max(0,box.x-3),y:Math.max(0,box.y-3),width:box.width+6,height:box.height+6};
    const before=await page.screenshot({path:out+'/'+mode+'-before.png',clip});
    await page.keyboard.press('Tab');await expect(table).toBeFocused();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const computed=await table.evaluate(t=>{const c=getComputedStyle(t),p=getComputedStyle(t.parentElement);return{focusVisible:t.matches(':focus-visible'),outlineStyle:c.outlineStyle,outlineWidth:c.outlineWidth,outlineOffset:c.outlineOffset,outlineColor:c.outlineColor,wrapperOverflowX:p.overflowX,wrapperOverflowY:p.overflowY,tableWidth:t.getBoundingClientRect().width,wrapperWidth:t.parentElement.getBoundingClientRect().width};});
    const after=await page.screenshot({path:out+'/'+mode+'-focused.png',clip});
    const left=await table.evaluate(t=>t.parentElement.scrollLeft);await page.keyboard.press('ArrowRight');await expect.poll(()=>table.evaluate(t=>t.parentElement.scrollLeft)).toBeGreaterThan(left);
    focus={...computed,focusPixelsChanged:!before.equals(after),scrollBefore:left,scrollAfter:await table.evaluate(t=>t.parentElement.scrollLeft)};
   }
   modes.push({mode,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),metrics,readonly,focus});
  }
 }
}catch(error){failure=error instanceof Error?error.message:'UI verification failed';}
finally{await context.close();await browser.close();}
const report={source,runtimeVerified:true,runtimeServices:runtime.services.map(s=>({service:s.service,port:s.port})),modes,failure,deniedOrigins:[...new Set(denied)],rpcCalls:[...new Set(rpcCalls)],limits:'Existing private synthetic owner session only; no new actors or financial mutations; local fixture, not provider/production approval'};
fs.writeFileSync(out+'/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(failure)process.exitCode=1;
