#!/usr/bin/env node
/** Real Chromium interactions against production components/CSS, synthetic API responses.
 * No login, deployed endpoints, storage transport or hosted authorization is exercised.
 * Unknown API calls and external traffic fail the run. Servers bind loopback only.
 */
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const output = path.join(root, "test-results/employee-lifecycle");
const scratch = path.join(process.env.HOME, ".hermes/tmp/agent-runs", `employee-file-browser-${Date.now()}`);
await fs.mkdir(scratch, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(scratch, "manifest.json"), JSON.stringify({ run_id: path.basename(scratch), created_by: "codex", purpose: "Employee component browser smoke cache", paths: [scratch, path.join(scratch,"manifest.json"), path.join(scratch,"vite-cache")] }, null, 2), {mode:0o600});
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root: here, cacheDir: path.join(scratch,"vite-cache"), configFile: false, plugins: [react()],
 resolve: { alias: [ { find: "@/lib/supabase/client", replacement: path.join(here,"fixture-supabase.ts") }, { find: "next/link", replacement: path.join(here,"fixture-link.tsx") }, { find: "@", replacement: path.join(root,"src") } ] },
 css: { postcss: path.join(root,"postcss.config.mjs") }, server: { host:"127.0.0.1", port: 0, fs: { allow:[root] } }, logLevel:"error" });
const report = { evidence:"Synthetic API + real production React component/CSS in Chromium; not hosted authentication or Storage transport", viewports:[], unexpected:[], scratch };
let browser;
const staffId="11111111-1111-4111-8111-111111111111";
const endpoint=`/api/admin/staff/${staffId}/employee-file`;
const makeRequirement=(id,title,extra={})=>({id,code:id,title,version:1,category:"orientation",source_file:"SECTION 4-5.pdf",source_page:7,source_excerpt:"Employee and trainer orientation",content:"Orientation evidence reviewed against source. This synthetic text is test data.",review_status:"approved",review_note:"Synthetic review",due_days:0,recurrence_months:null,recurrence_status:"one_time",duty:"resident_interaction",required_signers:["employee","witness"],applies_to_staff_roles:["resident_aide"],...extra});
function fixture(){return { staff:{id:staffId,first_name:"Jordan",last_name:"Rivera",staff_role:"resident_aide",hire_date:"2026-08-01",employment_status:"active",facility_id:"22222222-2222-4222-8222-222222222222",user_id:"employee"}, requirements:[makeRequirement("orientation","Orientation and resident rights"),makeRequirement("consent","Handbook acknowledgment",{category:"policy",required_signers:["employee"]})],records:[{id:"signed-evidence",requirement_id:"orientation",staff_id:staffId,status:"verified",completed_on:"2026-08-02",expires_on:null,notes:"Orientation completed with an independent witness.",evidence_reference:null,storage_path:null,created_at:"2026-08-02T15:00:00Z",reviewed_by:"manager"}],signatures:[{id:"sig1",record_id:"signed-evidence",functional_role:"employee",signature_name:"Jordan Rivera",signed_at:"2026-08-02T12:00:00Z",user_id:"employee"},{id:"sig2",record_id:"signed-evidence",functional_role:"witness",signature_name:"Taylor Morgan",signed_at:"2026-08-02T12:01:00Z",user_id:"manager"}],dutyEvents:[],attendance:[],correctiveActions:[],canManage:true,canMedical:false,actorId:"manager",actorRole:"owner"};}
try {
 await server.listen(); const address=server.httpServer.address(); const base=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({headless:true});
 for(const width of [1440,390]){
  let data=fixture(), calls=[], failNext=false, expectedResourceFailures=0;
  const context=await browser.newContext({viewport:{width,height:1000}});
  const page=await context.newPage();
  page.on("pageerror",e=>report.unexpected.push(e.message));
  page.on("console",message=>{
   if(message.type()!=="error")return;
   if(message.text()==="Failed to load resource: the server responded with a status of 400 (Bad Request)" && message.location().url===`${base}${endpoint}/requirements` && expectedResourceFailures>0){expectedResourceFailures--;return;}
   report.unexpected.push(message.text());
  });
  await page.route("**/*",async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base){report.unexpected.push(`External traffic: ${request.url()}`);return route.abort();}
   if(!url.pathname.startsWith("/api/"))return route.continue();
   if(url.pathname===endpoint && request.method()==="GET")return route.fulfill({json:data});
   if(url.pathname===`${endpoint}/training` && request.method()==="GET")return route.fulfill({json:{completions:[],certificates:[],demonstrations:[]}});
   if(url.pathname===`${endpoint}/requirements` && request.method()==="GET")return route.fulfill({json:{profiles:[],grants:[]}});
   if([endpoint,`${endpoint}/requirements`].includes(url.pathname)&&request.method()==="POST"){
    const body=request.postDataJSON(); calls.push(body);
    if(failNext){failNext=false;expectedResourceFailures++;return route.fulfill({status:400,json:{error:"Synthetic review rejected: source approval needs review."}});}
    let result;
    if(body.action==="submit_record"){result={...body.payload,staff_id:staffId,status:"submitted",created_at:new Date().toISOString(),reviewed_by:null,storage_path:null};data.records.push(result);}
    else if(body.action==="create"){result={...body.payload,id:`draft-${calls.length}`,review_status:"draft",review_note:null};data.requirements.push(result);}
    else if(body.action==="approve"){result=data.requirements.find(r=>r.id===body.payload.id);result.review_status="approved";result.review_note=body.payload.review_note;}
    else{report.unexpected.push(`Unknown command: ${body.action}`);return route.fulfill({status:500,json:{error:"Unexpected test API command"}});}
    return route.fulfill({json:{result}});
   }
   report.unexpected.push(`Unknown API: ${request.method()} ${url.pathname}`);return route.fulfill({status:500,json:{error:"Unexpected test API"}});
  });
  await page.goto(base);
  await expect(page.getByRole("heading",{name:"Jordan Rivera · Employee file"})).toBeVisible();
  await expect(page.getByText("Witness: Taylor Morgan",{exact:false})).toBeVisible();
  const screenshot=async name=>{await page.screenshot({path:path.join(output,`${width}-${name}.png`),fullPage:true});};
  const inspect=async name=>{
   await page.mouse.move(0,0);
   await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   expect(overflow.scroll,`${width}px ${name} horizontal overflow`).toBeLessThanOrEqual(width+1);
   const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
   report.viewports.push({width,state:name,overflow,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>n.target)}))});
   await screenshot(name);
   // Collect every state before enforcing the aggregate accessibility gate.
  };
  await inspect("documents");
  const before=calls.length;
  await page.getByRole("button",{name:"Submit for review",exact:true}).click();
  expect(await page.getByLabel("Completion date",{exact:true}).evaluate(e=>e.validity.valueMissing)).toBe(true);
  expect(calls.length).toBe(before);
  await page.getByRole("combobox",{name:/^Requirement/}).selectOption("consent");
  await page.getByLabel("Completion date",{exact:true}).fill("2026-08-03");
  await page.getByLabel("Signed paper or external record reference, if applicable").fill("Synthetic signed handbook file");
  await page.getByRole("button",{name:"Submit for review",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(calls.at(-1).payload.completed_on).toBe("2026-08-03");
  await expect(page.getByText("Synthetic signed handbook file",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Duty readiness",exact:true}).click();
  await expect(page.getByText("Not configured",{exact:true}).first()).toBeVisible();
  await inspect("readiness");
  await page.getByRole("button",{name:"Attendance review",exact:true}).click();
  await inspect("attendance");
  await page.getByRole("button",{name:"Requirements",exact:true}).click();
  await page.getByLabel("Title",{exact:true}).fill("Synthetic verified packet requirement");
  await page.getByLabel("Applicable staff roles",{exact:true}).selectOption(["resident_aide", "medication_tech"]);
  await page.getByLabel("Complete requirement text to approve").fill("Synthetic source-backed full text for browser interaction testing.");
  await page.getByRole("button",{name:"Save draft version",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(calls.at(-1).action).toBe("create");expect(calls.at(-1).payload.applies_to_staff_roles.slice().sort()).toEqual(["medication_tech", "resident_aide"]);
  await expect(page.getByLabel("Version",{exact:true})).toHaveValue("2");
  const row=page.locator("li").filter({has:page.getByText("Synthetic verified packet requirement · v",{exact:false})});
  await row.getByLabel("Approval or retirement rationale").fill("Source, timing and applicability checked in synthetic test");
  await row.getByRole("checkbox").check();
  failNext=true;
  await row.getByRole("button",{name:"Approve version",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic review rejected");
  await screenshot("approval-error");
  await row.getByRole("button",{name:"Approve version",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(calls.at(-1).action).toBe("approve");
  await inspect("requirements");
  expect(expectedResourceFailures).toBe(0);
  await context.close();
 }
 expect(report.unexpected).toEqual([]);
 expect(report.viewports.flatMap(v=>v.violations.map(issue=>({width:v.width,state:v.state,...issue})))).toEqual([]);
 report.status="passed";
} catch(error){ report.status="failed";report.error=error.stack; throw error; }
finally {
 await fs.writeFile(path.join(output,"browser-smoke.json"),JSON.stringify(report,null,2));
 await browser?.close();await server.close();
 // Record exact owned cache paths, validate with steward, then remove only those files.
 const files=[]; const dirs=[];
 async function listOwned(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory()){await listOwned(file);dirs.push(file);}else if(entry.isFile())files.push(file);else throw new Error(`Unexpected scratch entry retained: ${file}`);}}
 const cache=path.join(scratch,"vite-cache");
 try {
  await listOwned(cache);
  const manifest=path.join(scratch,"manifest.json");
  await fs.writeFile(manifest,JSON.stringify({schema_version:1,run_id:path.basename(scratch),created_by:"codex",artifacts:files},null,2),{mode:0o600});await fs.chmod(manifest,0o600);
  const cleanup=spawnSync("jarvis-storage-steward",["cleanup-run","--manifest",manifest],{encoding:"utf8"});
  if(cleanup.status===0){for(const file of files)await fs.unlink(file);for(const dir of dirs)await fs.rmdir(dir);await fs.rmdir(cache);report.cleanup={validated:true,removedFiles:files.length,retainedManifest:manifest};}
  else report.cleanup={validated:false,retained:scratch,error:cleanup.stderr||cleanup.error?.message};
 }catch(error){report.cleanup={validated:false,retained:scratch,error:error.message};}
 await fs.writeFile(path.join(output,"browser-smoke.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,output,scratch,states:report.viewports.length,cleanup:report.cleanup}));
}
