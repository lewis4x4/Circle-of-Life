import { expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("./executors", () => ({ executeReportTemplate: execute }));
vi.mock("./resolve-template-id", () => ({ resolveReportTemplateIdBySlug: async () => ({id:"template-id"}) }));
import { runTemplateAndPersist } from "./run-persistence";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
function client() {
 const updates: unknown[]=[];
 const inserts: unknown[]=[];
 const q: Record<string, ReturnType<typeof vi.fn>>={};
 for(const n of ["select","eq"]) q[n]=vi.fn(()=>q);
 q.insert=vi.fn((value)=>{inserts.push(value);return q;});
 q.update=vi.fn((value)=>{updates.push(value);return q;});
 q.single=vi.fn().mockResolvedValue({data:{id:"run-id"},error:null});
 q.then=vi.fn((resolve)=>resolve({data:null,error:null}));
 return {supabase:{from:()=>q} as unknown as SupabaseClient<Database>,updates,inserts};
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
it("persists saved_view source_type and view id (not template slug as source)", async () => {
  const c = client();
  execute.mockResolvedValueOnce({ summary: [], rows: [] });
  const viewId = "a1b2c3d4-e5f6-4a70-8b9c-0d1e2f3a4b5c";
  await runTemplateAndPersist({
    ...c,
    organizationId: "org",
    slug: "census",
    title: "My census cut",
    facilityId: "homewood",
    scopeLabel: "Homewood",
    sourceType: "saved_view",
    sourceId: viewId,
    templateVersionId: "c3d4e5f6-a7b8-4c92-ad1e-2f3a4b5c6d7e",
  });
  expect(c.inserts).toContainEqual(
    expect.objectContaining({
      source_type: "saved_view",
      source_id: viewId,
      template_id: "template-id",
      template_version_id: "c3d4e5f6-a7b8-4c92-ad1e-2f3a4b5c6d7e",
    }),
  );
});
it("still fails closed on executor error for saved_view runs", async () => {
  const c = client();
  execute.mockRejectedValueOnce(new Error("partial failure"));
  await expect(
    runTemplateAndPersist({
      ...c,
      organizationId: "org",
      slug: "census",
      title: "My census cut",
      facilityId: "homewood",
      scopeLabel: "Homewood",
      sourceType: "saved_view",
      sourceId: "a1b2c3d4-e5f6-4a70-8b9c-0d1e2f3a4b5c",
    }),
  ).rejects.toThrow("partial failure");
  expect(c.updates).toContainEqual(
    expect.objectContaining({ status: "failed", error_json: { message: "partial failure" } }),
  );
});
