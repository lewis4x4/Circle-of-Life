import { expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("./executors", () => ({ executeReportTemplate: execute }));
vi.mock("./resolve-template-id", () => ({ resolveReportTemplateIdBySlug: async () => ({id:"template-id"}) }));
import { runTemplateAndPersist } from "./run-persistence";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
function client() {
 const updates: unknown[]=[];
 const q: Record<string, ReturnType<typeof vi.fn>>={};
 for(const n of ["insert","select","eq"]) q[n]=vi.fn(()=>q);
 q.update=vi.fn((value)=>{updates.push(value);return q;});
 q.single=vi.fn().mockResolvedValue({data:{id:"run-id"},error:null});
 q.then=vi.fn((resolve)=>resolve({data:null,error:null}));
 return {supabase:{from:()=>q} as unknown as SupabaseClient<Database>,updates};
}
it("finalizes an executor failure instead of leaving Running",async()=>{
 const c=client(); execute.mockRejectedValueOnce(new Error("query failed"));
 await expect(runTemplateAndPersist({...c,organizationId:"org",slug:"census",title:"Census",facilityId:"homewood",scopeLabel:"Homewood"})).rejects.toThrow("query failed");
 expect(c.updates).toContainEqual(expect.objectContaining({status:"failed",error_json:{message:"query failed"}}));
});
it("saves output with the scope used by execution before reporting completion",async()=>{
 const c=client(); execute.mockResolvedValueOnce({summary:[],rows:[{count:4}]});
 const run=await runTemplateAndPersist({...c,organizationId:"org",slug:"census",title:"Census",facilityId:"homewood",scopeLabel:"Homewood"});
 expect(run.snapshot.scopeLabel).toBe("Homewood");
 expect(c.updates).toContainEqual(expect.objectContaining({status:"completed",result_snapshot_json:expect.objectContaining({facilityId:"homewood",scopeLabel:"Homewood",slices:[expect.objectContaining({result:{summary:[],rows:[{count:4}]}})]})}));
});
