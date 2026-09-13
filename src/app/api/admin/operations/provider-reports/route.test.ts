import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/operations/auth",()=>({requireOperationsActor:vi.fn(),revalidateOperationsActor:vi.fn()}));
import { requireOperationsActor,revalidateOperationsActor } from "@/lib/operations/auth";
import { GET,POST } from "./route";
const id="00000000-0000-0000-0002-000000000003",rpc=vi.fn(),actor={id,organizationId:id,appRole:"owner",currentActor:{client:{rpc}}};
const reply={task_id:id,eligible:true,availability:"available",reason:"Explicit source context",resident_id:id,can_manage:true,can_intake:true,chase_candidates:[],contacts:[],expectations:[],versions:[],complete:true};
const get=()=>GET(new Request(`https://local.test?task_id=${id}`));
const create=()=>POST(new Request("https://local.test",{method:"POST",body:JSON.stringify({action:"create",task_id:id,request_key:"service-001",contact_id:id,document_type:"support_plan",expected_version:"Reported version",service_on:"2026-09-12",service_provenance:"Operator source reference"})}));
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireOperationsActor).mockResolvedValue({actor} as never);vi.mocked(revalidateOperationsActor).mockResolvedValue({actor} as never);rpc.mockResolvedValue({data:reply,error:null});});
describe("provider report API authority and precision",()=>{
 it("returns only current task-scoped validated data with no-store",async()=>{const r=await get();expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(rpc).toHaveBeenCalledTimes(1);});
 it("preserves date-only service payload without adding an invented time",async()=>{expect((await create()).status).toBe(200);expect(rpc.mock.calls[0][1].p_payload).toMatchObject({service_on:"2026-09-12"});expect(rpc.mock.calls[0][1].p_payload).not.toHaveProperty("service_at");});
 it("discards mutation-time data after current native access is lost",async()=>{rpc.mockResolvedValueOnce({data:{...reply,reason:"stale clinical data"},error:null}).mockResolvedValueOnce({data:null,error:{code:"42501"}});const r=await create();expect(r.status).toBe(404);expect(JSON.stringify(await r.json())).not.toContain("stale clinical data");});
 it("rejects actor change before any command",async()=>{vi.mocked(revalidateOperationsActor).mockResolvedValue({actor:{...actor,id:"other"}} as never);expect((await create()).status).toBe(404);expect(rpc).not.toHaveBeenCalled();});
 it("rejects wrong-scope or invalid success rather than claiming empty history",async()=>{rpc.mockResolvedValue({data:{...reply,task_id:"00000000-0000-0000-0002-000000000004"},error:null});expect((await get()).status).toBe(503);rpc.mockResolvedValue({data:{},error:null});expect((await get()).status).toBe(503);});
 it("keeps native denial distinct from valid confirmed empty",async()=>{rpc.mockResolvedValue({data:null,error:{code:"42501"}});const r=await get();expect(r.status).toBe(404);expect(await r.json()).not.toHaveProperty("expectations");});
 it("keeps request/revision conflicts explicit",async()=>{rpc.mockResolvedValue({data:null,error:{code:"40001"}});expect((await create()).status).toBe(409);});
});
