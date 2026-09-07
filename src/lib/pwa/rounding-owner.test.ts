import {afterEach,expect,it,vi} from "vitest";
const getSession=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getSession}})}));
import {queueRoundingCompletion} from "./rounding-sync";
afterEach(()=>vi.unstubAllGlobals());
it("refuses a stale page's queue owner after another operator signs in",async()=>{
 getSession.mockResolvedValue({data:{session:{user:{id:"new-operator"}}}});
 let notify:(event:{data:unknown})=>void=()=>{};
 class Channel {port1={set onmessage(value:typeof notify){notify=value;}};port2={};}
 const postMessage=vi.fn(()=>Promise.resolve().then(()=>notify({data:{ok:true,state:{}}})));
 vi.stubGlobal("MessageChannel",Channel);
 vi.stubGlobal("navigator",{onLine:false,serviceWorker:{getRegistration:async()=>({active:{postMessage}})}});
 await expect(queueRoundingCompletion("task","resident",{quickStatus:"awake"},{ownerUserId:"old-operator",organizationId:"org",facilityId:"facility"})).rejects.toThrow(/operator|account/i);
 expect(postMessage).not.toHaveBeenCalled();
});
it("preserves the first online request identity and time when falling back to the outbox",async()=>{
 getSession.mockResolvedValue({data:{session:{user:{id:"operator"}}}});
 let notify:(event:{data:unknown})=>void=()=>{};
 class Channel {port1={set onmessage(value:typeof notify){notify=value;}};port2={};}
 const postMessage=vi.fn(()=>Promise.resolve().then(()=>notify({data:{ok:true,state:{}}})));
 vi.stubGlobal("MessageChannel",Channel);
 vi.stubGlobal("navigator",{onLine:false,serviceWorker:{getRegistration:async()=>({active:{postMessage}})}});
 const payload={quickStatus:"awake" as const,requestId:"bb36f9cf-fc96-47d3-aad6-676d649ee425",observedAt:"2026-09-07T12:00:00.000Z"};
 const item=await queueRoundingCompletion("task","resident",payload,{ownerUserId:"operator",organizationId:"org",facilityId:"facility"});
 expect(item.payload).toEqual(payload);
 expect(postMessage.mock.calls[0][0].item.payload).toEqual(payload);
});
it("assigns a durable identity to a newly queued legacy draft",async()=>{
 getSession.mockResolvedValue({data:{session:{user:{id:"operator"}}}});
 let notify:(event:{data:unknown})=>void=()=>{};
 class Channel {port1={set onmessage(value:typeof notify){notify=value;}};port2={};}
 const postMessage=vi.fn(()=>Promise.resolve().then(()=>notify({data:{ok:true,state:{}}})));
 vi.stubGlobal("MessageChannel",Channel);
 vi.stubGlobal("navigator",{onLine:false,serviceWorker:{getRegistration:async()=>({active:{postMessage}})}});
 const item=await queueRoundingCompletion("task","resident",{quickStatus:"awake"},{ownerUserId:"operator",organizationId:"org",facilityId:"facility"});
 expect(item.payload.requestId).toBe(item.id);
 expect(Number.isNaN(Date.parse(item.payload.observedAt!))).toBe(false);
});
