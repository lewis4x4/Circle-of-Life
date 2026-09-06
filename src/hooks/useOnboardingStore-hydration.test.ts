import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({responses:vi.fn(),questions:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({isBrowserSupabaseConfigured:()=>true,createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:"actor",app_metadata:{app_role:"owner"}}}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{organization_id:"org",full_name:"Actor"}})})})})})}));
vi.mock("@/lib/onboarding/supabase-queries",()=>({fetchQuestions:mocks.questions,fetchResponses:mocks.responses,upsertResponse:mocks.save,exportAllAsMarkdown:vi.fn(),importQuestions:vi.fn()}));
import {useOnboardingStore} from "./useOnboardingStore";
beforeEach(()=>{vi.clearAllMocks();useOnboardingStore.getState().clearAfterSignOut();mocks.questions.mockResolvedValue([]);mocks.save.mockResolvedValue(undefined);});
it("does not expose an older hydration while a newer hydration remains in flight",async()=>{
 let resolveFirst!:(value:unknown)=>void; let resolveSecond!:(value:unknown)=>void;
 mocks.responses.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{resolveSecond=resolve;}));
 const first=useOnboardingStore.getState().hydrate();
 await vi.waitFor(()=>expect(mocks.responses).toHaveBeenCalledTimes(1));
 const second=useOnboardingStore.getState().hydrate();
 await vi.waitFor(()=>expect(mocks.responses).toHaveBeenCalledTimes(2));
 resolveFirst({});await first;
 expect(useOnboardingStore.getState().hydration).toBe("loading");
 resolveSecond({});await second;
 expect(useOnboardingStore.getState().hydration).toBe("ready");
});
