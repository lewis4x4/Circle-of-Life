# Original controlled diagnostic

This historical diagnostic intentionally expects the old minute-boundary error. It is reference evidence, not part of the passing regression suite. The recorded HEAD9f23 had the then-uncommitted COL221 opacity change; the recorded component hash matches the later published6b209f51 component exactly. No application changes or hosted calls were made during this diagnostic.

```tsx
import React, {act} from "react";
import {renderToString} from "react-dom/server";
import {hydrateRoot, type Root} from "react-dom/client";
import {it,expect,vi,afterAll} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {BillingArOverviewHero} from "@/app/(admin)/billing/billing-ar-overview-hero";
const stable = vi.hoisted(()=>({availableFacilities:[{id:"11111111-1111-4111-8111-111111111111",name:"Same synthetic facility"}],selectedFacilityId:null,setSelectedFacility:vi.fn()}));
vi.mock("@/hooks/useFacilityStore",()=>({useFacilityStore:(selector:((state:typeof stable)=>unknown)|undefined)=>selector?selector(stable):stable}));
const out="/Users/brianlewis/.hermes/tmp/agent-runs/haven-overnight-20260912-01a09869/col224-repro";
const observations:unknown[]=[];
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
async function reproduce(name:string,serverAt:string,clientAt:string,expectMismatch:boolean){
 vi.useFakeTimers({toFake:["Date"]});
 let root:Root|undefined;
 const container=document.createElement("div");document.body.append(container);
 const recovered:{message:string;stack:string|null;componentStack:string|null;cause:string|null}[]=[];
 const consoleErrors:string[]=[];const spy=vi.spyOn(console,"error").mockImplementation((...args)=>consoleErrors.push(args.map(x=>x instanceof Error?x.stack??x.message:String(x)).join(" ")));
 try{
  vi.setSystemTime(new Date(serverAt));const html=renderToString(<BillingArOverviewHero/>);container.innerHTML=html;const beforeText=container.textContent;
  vi.setSystemTime(new Date(clientAt));
  await act(async()=>{root=hydrateRoot(container,<BillingArOverviewHero/>,{onRecoverableError:(error,info)=>{const e=error as Error&{cause?:unknown};recovered.push({message:e.message,stack:e.stack??null,componentStack:info.componentStack??null,cause:e.cause?String(e.cause):null})}});await new Promise(resolve=>setTimeout(resolve,30))});
  const afterText=container.textContent;
  observations.push({name,serverAt,clientAt,facilityState:{selectedFacilityId:stable.selectedFacilityId,availableFacilities:stable.availableFacilities},serverHtml:html,hydratedHtml:container.innerHTML,serverText:beforeText,hydratedText:afterText,recoverableErrors:recovered,consoleErrors,expectedMismatch:expectMismatch});
  if(expectMismatch){expect(recovered.length).toBeGreaterThan(0);expect(recovered[0].message).toMatch(/hydration|hydrated/i);expect(beforeText).not.toBe(afterText);expect(beforeText).toContain("7:54 PM");expect(afterText).toContain("7:55 PM")}
  else{expect(recovered).toEqual([]);expect(afterText).toBe(beforeText)}
 }finally{if(root)await act(async()=>root!.unmount());container.remove();spy.mockRestore();vi.useRealTimers()}
}
it("reproduces minute-boundary hydration with identical facility state",async()=>{await reproduce("minute-boundary","2026-09-12T23:54:59.999Z","2026-09-12T23:55:00.001Z",true)});
it("has no recoverable mismatch within the same displayed minute",async()=>{await reproduce("same-minute-control","2026-09-12T23:54:10.000Z","2026-09-12T23:54:59.999Z",false)});
afterAll(()=>fs.writeFileSync(path.join(out,"hydration-report.json"),JSON.stringify({scope:"Local controlled current-component mechanism; not proof of historical incident root cause",observations},null,2)+"\n"));

```
