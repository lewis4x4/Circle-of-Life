import {expect,it,vi,beforeEach} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn()}));
vi.mock("@/lib/admin/api-auth",()=>({requireAdminApiActor:mocks.auth,actorCanAccessFacility:mocks.access}));
import {POST} from "@/app/api/dietary/temperature/route";
const id="11111111-1111-4111-8111-111111111111",facility="22222222-2222-4222-8222-222222222222";
const body={id,facilityId:facility,item:"Soup",logType:"hot_hold",temperature:145,minimum:135,maximum:200,correctiveAction:""};
let existing:Record<string,unknown>;
beforeEach(()=>{
 existing={id,organization_id:"org",facility_id:facility,item:"Soup",log_type:"hot_hold",temperature_f:145,threshold_min_f:135,threshold_max_f:200,corrective_action:null,in_safe_range:true,logged_by:"actor"};
 const q:Record<string,ReturnType<typeof vi.fn>>={};for(const m of ["insert","select","eq"])q[m]=vi.fn(()=>q);
 q.single=vi.fn().mockResolvedValue({data:null,error:{code:"23505",message:"duplicate key"}});
 q.maybeSingle=vi.fn(()=>Promise.resolve({data:existing,error:null}));
 mocks.auth.mockResolvedValue({actor:{id:"actor",organization_id:"org",admin:{from:()=>q}}});mocks.access.mockResolvedValue(true);
});
it("acknowledges a same-operator identical retry after a lost response",async()=>{
 const response=await POST(new Request("http://local",{method:"POST",body:JSON.stringify(body)}));expect(response.status).toBe(200);expect((await response.json()).id).toBe(id);
});
it("does not claim that a changed measurement was saved under an existing receipt",async()=>{
 existing.temperature_f=150;
 const response=await POST(new Request("http://local",{method:"POST",body:JSON.stringify(body)}));expect(response.status).toBe(409);
});
