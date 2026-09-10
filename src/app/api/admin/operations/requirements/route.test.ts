import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { GET, POST } from "./route";
import { POST as PUBLISH } from "./[id]/publish/route";
import { POST as PREVIEW } from "./[id]/preview/route";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const order = vi.fn();
const actor = {
  id: "actor",
  organizationId: "org",
  appRole: "owner",
  currentActor: {
    client: {
      rpc,
      from: vi.fn(() => {
        const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order };
        return query;
      }),
    },
  },
};
const activityId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => new Request("https://local.test/requirements", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  order.mockResolvedValue({ data: [{ id: draftId, status: "published", version: 1 }], error: null });
});

describe("central requirement drafts", () => {
  it("lists versions for an activity through the session client", async () => {
    const response = await GET(new NextRequest(`https://local.test/requirements?activity_id=${activityId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [{ id: draftId, status: "published", version: 1 }] });
  });

  it("requires a valid activity identifier to list", async () => {
    expect((await GET(new NextRequest("https://local.test/requirements?activity_id=nope") as never)).status).toBe(400);
  });

  it("saves a draft with the authenticated command and returns the row", async () => {
    rpc.mockResolvedValue({ data: { id: draftId, status: "draft", version: 1 }, error: null });
    const response = await POST(post({ activity_id: activityId, payload: { title: "Generator weekly observation" } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_operation_requirement_draft_review", { p_activity_id: activityId, p_payload: { title: "Generator weekly observation" } });
  });

  it("rejects non-editable fields before any command", async () => {
    const response = await POST(post({ activity_id: activityId, payload: { status: "published", version: 4 } }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not call the command after reauthentication fails", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) });
    expect((await POST(post({ activity_id: activityId, payload: {} }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database authority denial without revealing whether the activity exists", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Requirement activity unavailable" } });
    const response = await POST(post({ activity_id: activityId, payload: {} }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Requirement unavailable" });
  });

  it("does not manufacture a draft from an unconfirmed result", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect((await POST(post({ activity_id: activityId, payload: {} }))).status).toBe(500);
  });
});

describe("central requirement publication", () => {
  const params = { params: Promise.resolve({ id: draftId }) };

  it("previews with an explicit effective time and returns the database preview", async () => {
    rpc.mockResolvedValue({ data: { publishable: false, problems: ["requirement wording is required"], next_version: 1 }, error: null });
    const response = await PREVIEW(post({ effective_from: "2026-10-01T04:00:00Z" }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).preview.problems).toEqual(["requirement wording is required"]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("preview_operation_requirement_review", { p_draft_id: draftId, p_effective_from: "2026-10-01T04:00:00Z" });
  });

  it("requires an effective time with offset before publishing", async () => {
    expect((await PUBLISH(post({ effective_from: "2026-10-01" }), params)).status).toBe(400);
    expect((await PUBLISH(post("not json"), params)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the bounded not-publishable message as a conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Requirement version is not publishable: at least one recorder role is required" } });
    const response = await PUBLISH(post({ effective_from: "2026-10-01T04:00:00Z" }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Requirement version is not publishable: at least one recorder role is required" });
  });

  it("only confirms publication when the database returns a published row", async () => {
    rpc.mockResolvedValue({ data: { id: draftId, status: "draft", version: 1 }, error: null });
    expect((await PUBLISH(post({ effective_from: "2026-10-01T04:00:00Z" }), params)).status).toBe(500);
    rpc.mockResolvedValue({ data: { id: draftId, status: "published", version: 1 }, error: null });
    expect((await PUBLISH(post({ effective_from: "2026-10-01T04:00:00Z" }), params)).status).toBe(200);
  });

  it("hides a malformed draft identifier exactly like an unauthorised one", async () => {
    expect((await PUBLISH(post({ effective_from: "2026-10-01T04:00:00Z" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
