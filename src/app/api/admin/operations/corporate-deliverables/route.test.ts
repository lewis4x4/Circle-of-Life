import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn() }));
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { GET, POST } from "./route";
const id = "00000000-0000-0000-0002-000000000003", other = "00000000-0000-0000-0002-000000000004";
const rpc = vi.fn(), actor = { id, organizationId: id, appRole: "owner", currentActor: { client: { rpc } } };
const reply = { task_id:id, activity_key:"hfo-al-m09-01", component_label:"Census EOM review", can_manage:true, availability:"available", reason:"Complete expected-site accounting", period_start:"2026-08-01", period_end:"2026-08-31", available_sites:[], issue_candidates:[], coverage:null, coverage_complete:false, sites:[], meetings:[], meetings_complete:true, complete:true, front_office_boundary:"standup_weekly_allowlist_only" };
const get = () => GET(new Request(`https://local.test?task_id=${id}&period_start=2026-08-01&period_end=2026-08-31`));
const post = (body: unknown) => POST(new Request("https://local.test", { method:"POST", body:JSON.stringify(body) }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireOperationsActor).mockResolvedValue({actor} as never); vi.mocked(revalidateOperationsActor).mockResolvedValue({actor} as never); rpc.mockResolvedValue({data:reply,error:null}); });
describe("corporate deliverable API boundaries", () => {
  it("returns only a strict current complete coverage response", async () => { const response=await get(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual(reply); });
  it("registers an explicit site set and period without inventing recipient or schedule", async () => {
    const response=await post({action:"register",task_id:id,request_key:"col160-register-001",period_start:"2026-08-01",period_end:"2026-08-31",period_provenance:"Controller selected August period",expected_facility_ids:[id,other]});
    expect(response.status).toBe(200); expect(rpc.mock.calls[0]).toEqual(["corporate_deliverable_command",{p_task:id,p_request_key:"col160-register-001",p_action:"register",p_payload:{period_start:"2026-08-01",period_end:"2026-08-31",period_provenance:"Controller selected August period",expected_facility_ids:[id,other]}}]);
  });
  it("keeps preparation separate from sending and rejects arbitrary fields", async () => {
    const invalid=await post({action:"prepare",task_id:id,request_key:"col160-prepare-001",expectation_id:id,expected_revision:other,source_family:"census",sent:true}); expect(invalid.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
    await post({action:"prepare",task_id:id,request_key:"col160-prepare-001",expectation_id:id,expected_revision:other,source_family:"census"}); expect(rpc.mock.calls[0][1].p_action).toBe("prepare"); expect(rpc.mock.calls[0][1].p_payload).not.toHaveProperty("sent");
  });
  it("preserves date-only sent evidence and its operator channel", async () => {
    await post({action:"sent",task_id:id,request_key:"col160-sent-001",expectation_id:id,expected_revision:other,version_id:other,channel:"Operator-recorded postal mail",source_evidence:"Certified-mail register",sent_on:"2026-09-01"});
    expect(rpc.mock.calls[0][1].p_payload).toMatchObject({sent_on:"2026-09-01",channel:"Operator-recorded postal mail"}); expect(rpc.mock.calls[0][1].p_payload).not.toHaveProperty("sent_at");
  });
  it("drops mutation results if actor authority changes before reread", async () => { vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({actor} as never).mockResolvedValueOnce({actor:{...actor,id:other}} as never); const response=await post({action:"register",task_id:id,request_key:"col160-register-001",period_start:"2026-08-01",period_end:"2026-08-31",period_provenance:"Controller selected August period",expected_facility_ids:[id]}); expect(response.status).toBe(404); });
  it("refuses incomplete, wrong-scope and native-denied replies", async () => { rpc.mockResolvedValueOnce({data:{...reply,coverage_complete:false},error:null}); expect((await get()).status).toBe(200); rpc.mockResolvedValueOnce({data:{...reply,task_id:other},error:null}); expect((await get()).status).toBe(503); rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}}); expect((await get()).status).toBe(404); });
  it("treats deterministic source/history bounds as definitive",async()=>{rpc.mockResolvedValue({data:null,error:{code:"54000"}});const response=await post({action:"register",task_id:id,request_key:"col160-register-001",period_start:"2026-08-01",period_end:"2026-08-31",period_provenance:"Controller selected August period",expected_facility_ids:[id]});expect(response.status).toBe(413);});
});
