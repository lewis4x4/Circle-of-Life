import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { GET, POST } from "./route";
import { POST as PUBLISH } from "./[id]/publish/route";
import { POST as PREVIEW } from "./[id]/preview/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const order = vi.fn();
const actor = {
  id: "actor",
  organizationId: "org",
  appRole: "facility_admin",
  currentActor: {
    client: {
      rpc,
      from: vi.fn(() => {
        const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn(() => ({ order })) };
        return query;
      }),
    },
  },
};
const facilityId = "33333333-3333-4333-8333-333333333333";
const activityId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => new Request("https://local.test/facility-requirements", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  order.mockResolvedValue({ data: [], error: null });
});

describe("facility requirement configurations", () => {
  it("hides a site the actor has no current grant for, before any read", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    const response = await GET(new NextRequest(`https://local.test/facility-requirements?facility_id=${facilityId}`) as never);
    expect(response.status).toBe(404);
    expect(actor.currentActor.client.from).not.toHaveBeenCalled();
  });

  it("lists a granted site's configurations through the session client", async () => {
    const response = await GET(new NextRequest(`https://local.test/facility-requirements?facility_id=${facilityId}&activity_id=${activityId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configurations: [] });
  });

  it("refuses a site draft for a site without a current grant before the command", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    const response = await POST(post({ activity_id: activityId, facility_id: facilityId, payload: { applicability: "not_applicable" } }));
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the approver server-owned and forwards only editable fields", async () => {
    expect((await POST(post({ activity_id: activityId, facility_id: facilityId, payload: { applicability: "applicable", approved_by: "me" } }))).status).toBe(400);
    rpc.mockResolvedValue({ data: { id: draftId, status: "draft", applicability: "needs_confirmation" }, error: null });
    const response = await POST(post({ activity_id: activityId, facility_id: facilityId, payload: { schedule_status: "confirmed", schedule_rule: { kind: "weekly" } } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_operation_facility_requirement_draft_review", {
      p_activity_id: activityId, p_facility_id: facilityId, p_payload: { schedule_status: "confirmed", schedule_rule: { kind: "weekly" } },
    });
  });

  it("surfaces the bounded subset rule as a conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "Local recorder roles must be a subset of the central roles" } });
    const response = await POST(post({ activity_id: activityId, facility_id: facilityId, payload: { local_allowed_recorder_roles: ["owner"] } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Local recorder roles must be a subset of the central roles" });
  });

  it("previews a site configuration through the facility preview command and returns the database preview", async () => {
    rpc.mockResolvedValue({ data: { publishable: false, problems: ["schedule confirmation is not available until the evaluator defines rule shapes"] }, error: null });
    const response = await PREVIEW(post({ effective_from: "2026-10-01T04:00:00Z" }), { params: Promise.resolve({ id: draftId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).preview.publishable).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("preview_operation_facility_requirement_review", { p_draft_id: draftId, p_effective_from: "2026-10-01T04:00:00Z" });
  });

  it("publishes a site configuration only with an explicit effective time and a published result", async () => {
    const params = { params: Promise.resolve({ id: draftId }) };
    expect((await PUBLISH(post({}), params)).status).toBe(400);
    rpc.mockResolvedValue({ data: { id: draftId, status: "published", applicability: "not_applicable" }, error: null });
    const response = await PUBLISH(post({ effective_from: "2026-10-01T04:00:00Z" }), params);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("publish_operation_facility_requirement_review", { p_draft_id: draftId, p_effective_from: "2026-10-01T04:00:00Z" });
  });
});
