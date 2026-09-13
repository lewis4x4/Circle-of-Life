import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanViewOperations: vi.fn() }));
vi.mock("@/lib/operations/needs-attention", () => ({ ATTENTION_CATEGORIES: ["overdue", "unresolved_issues", "missing_evidence", "waiting", "unassigned", "configuration_needed"], composeNeedsAttention: vi.fn() }));
import { GET } from "./route";
import { requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { composeNeedsAttention } from "@/lib/operations/needs-attention";
const actor = { id: "actor", organizationId: "org", appRole: "owner" };
const body = { facilities: [{ id: "site" }], counts: { overdue: { count: 2 } }, items: [{ key: "protected" }], total: 2, partial: [], all_clear: false };
const get = (query = "") => GET(new NextRequest(`https://local.test/api/admin/operations/needs-attention?${query}`));
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never); vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never); vi.mocked(actorCanViewOperations).mockReturnValue(true); vi.mocked(composeNeedsAttention).mockResolvedValue({ status: 200, body } as never);
});
describe("Needs Attention request authority", () => {
  it("denies unauthorized actors before source reads", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Denied" }, { status: 403 }) });
    expect((await get()).status).toBe(403); expect(composeNeedsAttention).not.toHaveBeenCalled();
  });
  it("refuses malformed parameters", async () => {
    for (const query of ["facility_id=no", "category=everything", "cursor=", "cursor=@@@"]) expect((await get(query)).status).toBe(400);
    expect(composeNeedsAttention).not.toHaveBeenCalled();
  });
  it.each([400, 404, 409, 503] as const)("retains composer refusal %s", async (status) => {
    vi.mocked(composeNeedsAttention).mockResolvedValue({ status, error: "Unavailable" }); expect((await get()).status).toBe(status);
  });
  it("discards assembled data after actor revalidation denial", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Expired" }, { status: 401 }) }); expect((await get()).status).toBe(401);
  });
  it("discards assembled data on role or organization changes", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: { ...actor, organizationId: "other" } } as never); expect((await get()).status).toBe(503);
  });
  it.each([{ ...body, facilities: [] }, { ...body, total: 1 }, { ...body, items: [] }, { ...body, counts: { overdue: { count: 1 } } }])("rejects changing facility/subject projections and denominators during waits", async (fresh) => {
    vi.mocked(composeNeedsAttention).mockResolvedValueOnce({ status: 200, body } as never).mockResolvedValueOnce({ status: 200, body: fresh } as never);
    const response = await get(); expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("items");
  });
  it("returns stable partial data without claiming an empty result", async () => {
    const partial = { ...body, total: null, partial: ["site:issues"] };
    vi.mocked(composeNeedsAttention).mockResolvedValue({ status: 200, body: partial } as never);
    const response = await get(); expect(await response.json()).toEqual(partial);
    const calls = vi.mocked(composeNeedsAttention).mock.calls; expect(calls).toHaveLength(2); expect(calls[0][0].now).toBe(calls[1][0].now);
  });
});
