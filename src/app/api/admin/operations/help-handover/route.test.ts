import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/operations/auth",()=>({requireOperationsActor:vi.fn(),revalidateOperationsActor:vi.fn(),actorCanAccessFacility:vi.fn()}));
import { GET, POST } from "./route";
import { requireOperationsActor,revalidateOperationsActor,actorCanAccessFacility } from "@/lib/operations/auth";
const activity="11111111-1111-4111-8111-111111111111",facility="22222222-2222-4222-8222-222222222222";
const rpc=vi.fn();
let rows:Record<string,unknown[]>={}; let failAt:number|null=null;
const from=vi.fn((table:string)=>{
 const q:Record<string,unknown>={};
 for(const m of ["select","eq","is","neq","in","order"]) q[m]=vi.fn(()=>q);
 q.range=async(start:number,end:number)=>start===failAt?{data:null,error:{message:"failed page"}}:{data:(rows[table]??[]).slice(start,Math.min(end+1,start+17)),error:null};
 q.maybeSingle=async()=>({data:(rows[table]??[])[0]??null,error:null});
 q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows[table]??[],error:null}).then(resolve);
 return q;
});
const actor={id:"actor",organizationId:"org",appRole:"facility_admin",currentActor:{client:{rpc,from}}};
const get=()=>new Request(`https://local.test/help-handover?activity_id=${activity}&facility_id=${facility}`);
const body={activity_id:activity,facility_id:facility,command:"help",request_key:"help-test-001",expected_id:null,payload:{how_to:"Check mailbox",examples:"",contact:""}};
const post=(value:unknown)=>new Request("https://local.test/help-handover",{method:"POST",body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();rows={};failAt=null;rpc.mockResolvedValue({data:[],error:null});vi.mocked(requireOperationsActor).mockResolvedValue({actor} as never);vi.mocked(revalidateOperationsActor).mockResolvedValue({actor} as never);vi.mocked(actorCanAccessFacility).mockResolvedValue(true);});
describe("help and handover route",()=>{
 it("paginates every issue beyond a provider cap and discards partial reads",async()=>{
  rows.operation_issues=Array.from({length:1101},(_,i)=>({id:`issue-${i}`,status:"open"}));
  const response=await GET(get());expect(response.status).toBe(200);expect((await response.json()).open_issues).toHaveLength(1101);expect(rpc).toHaveBeenCalledTimes(2);
  failAt=17;expect((await GET(get())).status).toBe(503);
 });
 it("hides protected reference ids and paths while returning authorized vault links",async()=>{
  rows.operation_help_handover_events=[{id:"help",command:"help",duty_scope:"",payload:{how_to:"Guide",protected_document_ids:["visible","hidden"]},actor_id:"actor",created_at:"2026-01-01",previous_id:null}];
  rows.facility_documents=[{id:"visible",document_name:"Guide"}];
  const data=await (await GET(get())).json();expect(data.help.payload.protected_document_ids).toBeUndefined();expect(data.help.payload.protected_documents).toEqual([{id:"visible",label:"Guide",href:`/admin/facilities/${facility}/documents`}]);expect(JSON.stringify(data)).not.toContain("hidden");
 });
 it("uses fresh people after long reads to mark departed ownership uncovered",async()=>{
  rows.operation_help_handover_events=[{id:"p",command:"propose",duty_scope:"Mail",payload:{owner_user_id:"departed",effective_at:"2026-01-01"},actor_id:"actor",created_at:"2026-01-01",previous_id:null},{id:"a",command:"accept",duty_scope:"Mail",payload:{proposal_id:"p",duty_role:"owner"},actor_id:"departed",created_at:"2026-01-02",previous_id:"p"}];
  rpc.mockResolvedValueOnce({data:[{id:"departed",name:"Former owner"}],error:null}).mockResolvedValueOnce({data:[],error:null});
  const data=await (await GET(get())).json();expect(data.current_duties[0]).toMatchObject({active:true,owner_current:false,covered:false});expect(data.people).toEqual([]);
 });
 it("denies site loss and final session change without returning data",async()=>{
  vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);expect((await GET(get())).status).toBe(403);expect(from).not.toHaveBeenCalled();
  vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({response:new Response(null,{status:401})} as never);expect((await GET(get())).status).toBe(401);
 });
 it("keeps omitted references for server preservation and rejects malformed successful outcomes",async()=>{
  rpc.mockResolvedValueOnce({data:{event:{id:"saved"},replayed:false},error:null});expect((await POST(post(body))).status).toBe(200);expect(rpc).toHaveBeenCalledWith("write_operation_help_handover_review",expect.objectContaining({p_payload:body.payload}));
  rpc.mockResolvedValueOnce({data:{},error:null});expect((await POST(post(body))).status).toBe(503);
  expect((await POST(post({...body,actor_id:"injected"}))).status).toBe(400);
 });
});
