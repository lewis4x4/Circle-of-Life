import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), revalidate: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/rounding/auth", () => ({ getRoundingRequestContext: mocks.context, revalidateRoundingRequestContext: mocks.revalidate }));
import { POST } from "./route";
const owner = { userId: "user", sessionId: "session", organizationId: "org", facilityId: "facility" };
const filters: Array<[string, unknown]> = [];
function request(retryOwner: unknown = owner) { return new Request("https://haven.test/api/rounding/tasks/task/claim", { method: "POST", body: JSON.stringify({ retryOwner }) }); }
const params = { params: Promise.resolve({ id: "task" }) };
beforeEach(() => {
  vi.clearAllMocks(); filters.length = 0;
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, is: () => query, maybeSingle: mocks.single };
  const context = { userId: "user", sessionId: "session", organizationId: "org", currentStaffId: "staff", admin: { from: () => query }, actor: { client: { rpc: mocks.rpc } } };
  mocks.context.mockResolvedValue({ context }); mocks.revalidate.mockResolvedValue({ context });
  mocks.single.mockResolvedValue({ data: { id: "task" }, error: null });
  mocks.rpc.mockResolvedValue({ data: { claimed: true, staff_id: "staff" }, error: null });
});
it("claims through the authenticated current actor after facility/task scope validation", async () => {
  expect((await POST(request(), params)).status).toBe(200);
  expect(mocks.revalidate).toHaveBeenCalledWith(expect.anything(), { facilityId: "facility" });
  expect(filters).toEqual([["id", "task"], ["organization_id", "org"], ["facility_id", "facility"]]);
  expect(mocks.rpc).toHaveBeenCalledWith("claim_observation_task", { p_task_id: "task" });
});
it("refuses changed operator/session without a write", async () => {
  expect((await POST(request({ ...owner, sessionId: "old" }), params)).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("refuses revoked facility authority without querying or claiming a task", async () => {
  mocks.revalidate.mockResolvedValue({ response: new Response(null, { status: 403 }) });
  expect((await POST(request(), params)).status).toBe(403);
  expect(mocks.single).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not claim a task outside the selected facility", async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  expect((await POST(request(), params)).status).toBe(404);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not turn a rejected claim into success", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await POST(request(), params)).status).toBe(403);
});
