import { beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("@/lib/operations/auth",()=>({requireOperationsActor:vi.fn(),revalidateOperationsActor:vi.fn()}));
import { requireOperationsActor,revalidateOperationsActor } from "@/lib/operations/auth";import { GET } from "./route";
const task="00000000-0000-0000-0000-000000000001",expectation="00000000-0000-0000-0000-000000000002",rpc=vi.fn(),actor={id:task,organizationId:task,appRole:"owner",currentActor:{client:{rpc}}};
const page={task_id:task,expectation_id:expectation,versions:[],events:[],next_before_version:0,next_before_sequence:0,complete:true};
const get=(query=`task_id=${task}&expectation_id=${expectation}&before_version=0&before_sequence=51`)=>GET(new Request(`https://local.test?${query}`));
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireOperationsActor).mockResolvedValue({actor} as never);vi.mocked(revalidateOperationsActor).mockResolvedValue({actor} as never);rpc.mockResolvedValue({data:page,error:null});});
describe("bounded corporate history API",()=>{
 it("preserves independent zero exhausted and active cursors",async()=>{rpc.mockResolvedValue({data:{...page,next_before_sequence:1,complete:false},error:null});expect((await get()).status).toBe(200);expect(rpc).toHaveBeenCalledWith("corporate_deliverable_history",{p_task:task,p_expectation:expectation,p_before_version:0,p_before_sequence:51});});
 it("rejects malformed cursors and wrong-scope pages",async()=>{expect((await get(`task_id=${task}&expectation_id=${expectation}&before_version=-1`)).status).toBe(400);rpc.mockResolvedValue({data:{...page,task_id:expectation},error:null});expect((await get()).status).toBe(503);});
 it("maps deterministic page bounds without asking for identical retry",async()=>{rpc.mockResolvedValue({data:null,error:{code:"54000"}});expect((await get()).status).toBe(413);});
 it("revalidates the exact actor before reading",async()=>{vi.mocked(revalidateOperationsActor).mockResolvedValue({actor:{...actor,id:expectation}} as never);expect((await get()).status).toBe(404);expect(rpc).not.toHaveBeenCalled();});
});
