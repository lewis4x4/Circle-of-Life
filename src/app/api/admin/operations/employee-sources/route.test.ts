import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/operations/auth",()=>({requireOperationsActor:vi.fn(),revalidateOperationsActor:vi.fn()}));
import { requireOperationsActor,revalidateOperationsActor } from "@/lib/operations/auth";
import { GET } from "./route";
import { POST } from "./reconcile/route";
const id="00000000-0000-0000-0002-000000000003";const rpc=vi.fn();const actor={id,organizationId:id,appRole:"owner",currentActor:{client:{rpc}}};
const input={task_id:id,employee_id:id,activity_key:"hfo-al-w06-01",as_of:"2026-09-13",availability:"available",reason:null,can_medical:false,can_open_employee_file:true,source_version:"a".repeat(64),staff:{id,first_name:"",last_name:"",hire_date:"2026-01-01",employment_status:"active",staff_role:"resident_aide",facility_id:id,user_id:null},requirements:[],records:[],history:[],complete:true};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireOperationsActor).mockResolvedValue({actor} as never);vi.mocked(revalidateOperationsActor).mockResolvedValue({actor} as never);rpc.mockResolvedValue({data:input,error:null});});
describe("task-bound employee sources",()=>{
 it("revalidatesbeforeonlynativeGET andreturnsno-store",async()=>{const r=await GET(new Request(`https://local.test?task_id=${id}`));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(rpc).toHaveBeenCalledTimes(1);expect((await r.json()).fields).toHaveLength(22);});
 it("usesfreshcallerresultafterreconcile nativeaccessloss",async()=>{rpc.mockResolvedValueOnce({data:{...input,source_version:"stale-medical"},error:null}).mockResolvedValueOnce({data:input,error:null});const r=await POST(new Request("https://local.test",{method:"POST",body:JSON.stringify({task_id:id,request_key:"refresh-0001"})}));expect(r.status).toBe(200);expect(JSON.stringify(await r.json())).not.toContain("stale-medical");expect(rpc).toHaveBeenCalledTimes(2);});
 it("denieschangedactorandunavailableHTTPwithoutzeroreadiness",async()=>{vi.mocked(revalidateOperationsActor).mockResolvedValue({actor:{...actor,id:"other"}} as never);expect((await GET(new Request(`https://local.test?task_id=${id}`))).status).toBe(404);expect(rpc).not.toHaveBeenCalled();});
 it("propagatesnativefailureas503notemptysuccess",async()=>{rpc.mockResolvedValue({data:null,error:{code:"57014"}});const r=await GET(new Request(`https://local.test?task_id=${id}`));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty("fields");});
 it("deniesanonymousbeforework",async()=>{vi.mocked(requireOperationsActor).mockResolvedValue({response:NextResponse.json({}, {status:401})});expect((await GET(new Request(`https://local.test?task_id=${id}`))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
});
