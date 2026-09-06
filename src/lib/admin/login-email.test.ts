import {beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),change:vi.fn(),audit:vi.fn()}));
vi.mock("@/lib/admin/api-auth",()=>({requireAdminApiActor:mocks.auth,actorCanAccessTargetUser:mocks.access}));
vi.mock("@/lib/audit/user-management-audit",()=>({writeUserAuditEntry:mocks.audit}));
import {POST} from "@/app/api/admin/users/[id]/login-email/route";
let query:Record<string,ReturnType<typeof vi.fn>>;
beforeEach(()=>{
 vi.clearAllMocks();query={};for(const name of ["select","eq","is","update"])query[name]=vi.fn(()=>query);
 query.maybeSingle=vi.fn().mockResolvedValue({data:{id:"target",app_role:"caregiver",email:"old@example.test"}});
 query.single=vi.fn().mockResolvedValue({data:{id:"target",email:"new@example.test"},error:null});
 mocks.auth.mockResolvedValue({actor:{id:"owner",organization_id:"org",app_role:"owner",admin:{from:()=>query,auth:{admin:{updateUserById:mocks.change}}}}});
 mocks.access.mockResolvedValue(true);mocks.change.mockResolvedValue({data:{user:{email:"new@example.test"}},error:null});
});
const send=()=>POST(new NextRequest("http://local",{method:"POST",body:JSON.stringify({email:"new@example.test"})}),{params:Promise.resolve({id:"target"})});
it("updates sign-in and profile identity before synchronized success",async()=>{
 const response=await send();expect(response.status).toBe(200);expect(mocks.change).toHaveBeenCalledWith("target",{email:"new@example.test"});expect(query.update).toHaveBeenCalledWith({email:"new@example.test"});
});
it("leaves the profile unchanged when Auth rejects the identity",async()=>{
 mocks.change.mockResolvedValue({data:{user:null},error:{message:"duplicate"}});const response=await send();expect(response.status).toBe(502);expect(query.update).not.toHaveBeenCalled();
});
it("reports retry-required partial success if profile persistence fails",async()=>{
 query.single.mockResolvedValue({data:null,error:{message:"unavailable"}});const response=await send();expect(response.status).toBe(500);expect((await response.json()).sync_status).toBe("retry_required");
});
