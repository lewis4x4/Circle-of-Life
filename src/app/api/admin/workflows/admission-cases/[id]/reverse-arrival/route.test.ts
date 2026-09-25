import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: async () => ({
    actor: {
      id: "actor",
      organization_id: "org",
      admin: {
        from: () => {
          const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: { facility_id: "facility", organization_id: "org" }, error: null }) };
          return query;
        },
        rpc: state.rpc,
      },
    },
  }),
  actorCanAccessFacility: async () => true,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "case" }) };
const REQUEST = "33333333-3333-4333-8333-333333333333";
const req = (body: unknown) => new Request("https://local.test/reverse", { method: "POST", body: JSON.stringify(body) }) as never;

describe("arrival reversal route (COL-333)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("needs a reason and a request id before the database", async () => {
    expect((await POST(req({ request_id: REQUEST }), params)).status).toBe(400);
    expect((await POST(req({ reason: "Wrong day" }), params)).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reverses through the one compensating transaction", async () => {
    state.rpc.mockResolvedValue({ data: { id: "reversal", replayed: false }, error: null });
    const response = await POST(req({ request_id: REQUEST, reason: "Entered for the wrong day" }), params);
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admission_arrival_reverse", {
      p_case: "case", p_actor_id: "actor", p_reason: "Entered for the wrong day", p_request_id: REQUEST,
    });
  });

  it.each([
    ["Only an administrator can reverse an arrival", 403],
    ["No arrival is recorded on this admission", 409],
    ["The resident is no longer in the arrival bed and census. Record the discharge, hospital stay or move instead of reversing the arrival", 409],
  ])("keeps the database's words: %s", async (message, status) => {
    state.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await POST(req({ request_id: REQUEST, reason: "Wrong day" }), params);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });
});
