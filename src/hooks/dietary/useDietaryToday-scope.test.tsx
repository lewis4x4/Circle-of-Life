import {act,renderHook,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/caregiver/facility-context",()=>({loadCaregiverFacilityContext:mocks.context}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:"cook"}}})},from:(table:string)=>{
 const query:Record<string,ReturnType<typeof vi.fn>>={};for(const name of ["select","eq","order","limit","gte","lte","in","neq"])query[name]=vi.fn(()=>query);
 query.then=vi.fn((resolve,reject)=>Promise.resolve(mocks.read(table)).then(resolve,reject));return query;
}})}));
import {useDietaryToday} from "./useDietaryToday";
it("keeps temperature-write scope paired with the visible kitchen snapshot during refresh",async()=>{
 mocks.context.mockResolvedValue({ok:true,ctx:{facilityId:"facility-a"}});
 mocks.read.mockImplementation((table)=>({data:table==="facilities"?[{name:"Kitchen A"}]:[],error:null}));
 const {result,unmount}=renderHook(()=>useDietaryToday());
 await waitFor(()=>expect(result.current.loading).toBe(false));
 let finish!:(value:unknown)=>void;
 const pendingData=new Promise(resolve=>{finish=resolve;});
 mocks.context.mockResolvedValue({ok:true,ctx:{facilityId:"facility-b"}});
 mocks.read.mockImplementation((table)=>table==="facilities"?pendingData:{data:[],error:null});
 let refresh!:Promise<void>;
 act(()=>{refresh=result.current.refresh();});
 await waitFor(()=>expect(mocks.context).toHaveBeenCalledTimes(2));
 expect(result.current.facilityId).toBe("facility-a");
 expect(result.current.service_bar.facility_name).toBe("Kitchen A");
 await act(async()=>{finish({data:[{name:"Kitchen B"}],error:null});await refresh;});
 expect(result.current.facilityId).toBe("facility-b");
 expect(result.current.service_bar.facility_name).toBe("Kitchen B");
 unmount();
});
