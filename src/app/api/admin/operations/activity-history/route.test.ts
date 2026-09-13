import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn(), actorCanViewOperations: vi.fn() }));
vi.mock("@/lib/operations/corporate-history", () => ({ composeCorporateHistory: vi.fn() }));
import { GET } from "./route";
import { requireOperationsActor, revalidateOperationsActor, actorCanAccessFacility, actorCanViewOperations } from "@/lib/operations/auth";
import { composeCorporateHistory } from "@/lib/operations/corporate-history";
const facility = "11111111-1111-4111-8111-111111111111", activity = "22222222-2222-4222-8222-222222222222";
const actor = { id: "actor", organizationId: "org", appRole: "owner" };
const body = { total: 2, open_issues: 1, partial: [], history: [{ id: "visible" }, { id: "protected" }], last_receipt: { id: "receipt" } };
const get = (query = `facility_id=${facility}&activity_id=${activity}`) => GET(new NextRequest(`https://local.test/api/admin/operations/activity-history?${query}`));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  vi.mocked(actorCanViewOperations).mockReturnValue(true);
  vi.mocked(composeCorporateHistory).mockResolvedValue({ status: 200, body } as never);
});
describe("corporate history request authority", () => {
  it("returns authentication denial before site or composition", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Denied" }, { status: 403 }) });
    expect((await get()).status).toBe(403); expect(composeCorporateHistory).not.toHaveBeenCalled();
  });
  it("refuses malformed inputs before site access", async () => {
    for (const query of ["", "facility_id=no", `facility_id=${facility}&activity_id=no`, `facility_id=${facility}&cursor=abc`, `facility_id=${facility}&activity_id=${activity}&cursor=`]) expect((await get(query)).status).toBe(400);
    expect(actorCanAccessFacility).not.toHaveBeenCalled();
  });
  it("hides an inaccessible site", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    expect((await get()).status).toBe(404); expect(composeCorporateHistory).not.toHaveBeenCalled();
  });
  it("discards rows if site access expires during reads", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await get(); expect(response.status).toBe(404); expect(await response.json()).not.toHaveProperty("history");
  });
  it("discards rows if identity or organization changes", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: { ...actor, organizationId: "other" } } as never);
    expect((await get()).status).toBe(503);
  });
  it.each([
    { ...body, history: [{ id: "visible" }], total: 1 },
    { ...body, total: 1 },
    { ...body, open_issues: 0 },
    { ...body, last_receipt: null },
    { ...body, history: [{ id: "visible", effective_receipt_id: "corrected" }, { id: "protected" }] },
  ])("rejects changing subject projections, totals or correction chains during bracketing", async (fresh) => {
    vi.mocked(composeCorporateHistory).mockResolvedValueOnce({ status: 200, body } as never).mockResolvedValueOnce({ status: 200, body: fresh } as never);
    const response = await get(); expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("history");
  });
  it("uses one time boundary and returns stable partial data honestly", async () => {
    const partial = { ...body, total: null, partial: ["total"] };
    vi.mocked(composeCorporateHistory).mockResolvedValue({ status: 200, body: partial } as never);
    const response = await get(); expect(response.status).toBe(200); expect(await response.json()).toEqual(partial);
    const calls = vi.mocked(composeCorporateHistory).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][0].now).toBe(calls[1][0].now);
  });
  it.each([400, 503] as const)("preserves invalid cursor/primary failure status %s", async (status) => {
    vi.mocked(composeCorporateHistory).mockResolvedValue({ status, error: "Unavailable" });
    expect((await get()).status).toBe(status);
  });
});
