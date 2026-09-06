import { beforeEach,expect,it,vi } from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({client:vi.fn(),run:vi.fn(),facility:vi.fn(),fail:vi.fn()}));
vi.mock("@/lib/supabase/service-role",()=>({createServiceRoleClient:mocks.client}));
vi.mock("@/lib/admin/api-auth",()=>({actorCanAccessFacility:mocks.facility}));
vi.mock("./run-persistence",()=>({runTemplateAndPersist:mocks.run,failReportRun:mocks.fail,finishReportRun:vi.fn()}));
import {POST} from "@/app/api/reports/scheduler/route";
let updates:Record<string,unknown>[];
let failAdvance=false;
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv("REPORT_SCHEDULER_SECRET","local-secret");updates=[];failAdvance=false;
 mocks.facility.mockResolvedValue(true);
 mocks.client.mockReturnValue({from:(table:string)=>{
   const q:Record<string,ReturnType<typeof vi.fn>>={};let writing=false;let advancing=false;
   for(const method of ["select","eq","is","lte","order","limit","or"])q[method]=vi.fn(()=>q);
   q.update=vi.fn((value)=>{writing=true;advancing="next_run_at" in value;updates.push(value);return q;});
   q.maybeSingle=vi.fn().mockResolvedValue({data:table==="user_profiles"?{id:"owner",organization_id:"org",app_role:"owner"}:null,error:null});
   q.single=vi.fn().mockResolvedValue({data:{slug:"census",name:"Census"},error:null});
   q.then=vi.fn((resolve)=>resolve({data:writing?null:[{id:"schedule",source_type:"template",source_id:"template",organization_id:"org",created_by:"owner",facility_id:null,output_format:"csv",timezone:"America/New_York",next_run_at:"2026-01-01T13:00:00Z",recurrence_rule:'{"frequency":"daily","weekday":1,"monthDay":1,"timeLocal":"08:00"}'}],error:failAdvance && advancing ? {message:"calendar write failed"}:null}));
   return q;
 }});
});
it("does not complete or advance a schedule when execution fails",async()=>{
 mocks.run.mockRejectedValue(new Error("executor failed"));
 const result=await POST(new NextRequest("http://local/api/reports/scheduler",{method:"POST",headers:{"x-cron-secret":"local-secret"}}));
 expect(result.status).toBe(500);
 expect(updates).toEqual([{status:"failed",last_error:"executor failed"}]);
});
it("advances only after the shared executor has persisted real output",async()=>{
 mocks.run.mockResolvedValue({runId:"run"});
 const result=await POST(new NextRequest("http://local/api/reports/scheduler",{method:"POST",headers:{"x-cron-secret":"local-secret"}}));
 expect(result.status).toBe(200);
 expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({slug:"census",scheduleId:"schedule",scopeLabel:"All facilities"}));
 expect(updates).toEqual([expect.objectContaining({next_run_at:expect.any(String),last_error:null})]);
});
it("rejects unauthenticated cron calls before database access",async()=>{
 const result=await POST(new NextRequest("http://local/api/reports/scheduler",{method:"POST"}));
 expect(result.status).toBe(401);expect(mocks.client).not.toHaveBeenCalled();
});

it("preserves completed output when advancing the schedule fails",async()=>{
 failAdvance=true;mocks.run.mockResolvedValue({runId:"completed-run"});
 const result=await POST(new NextRequest("http://local/api/reports/scheduler",{method:"POST",headers:{"x-cron-secret":"local-secret"}}));
 expect(result.status).toBe(500);
 expect(mocks.fail).not.toHaveBeenCalled();
 expect(updates).toContainEqual(expect.objectContaining({status:"failed",last_error:"Output saved; could not advance schedule"}));
});
