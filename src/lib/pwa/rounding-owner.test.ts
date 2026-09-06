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
