import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), facility: { facility_id: "facility", organization_id: "org" } as unknown, access: true }));
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: async () => ({
    actor: {
      id: "actor",
      organization_id: "org",
      admin: {
        from: () => {
          const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: state.facility, error: null }) };
          return query;
        },
        rpc: state.rpc,
      },
    },
  }),
  actorCanAccessFacility: async () => state.access,
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { DELETE, GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "case" }) };
const REQUEST = "33333333-3333-4333-8333-333333333333";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const req = (method: string, body?: unknown) => new Request("https://local.test/approval", { method, body: body === undefined ? undefined : JSON.stringify(body) }) as never;

describe("arrival approval route (COL-333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.facility = { facility_id: "facility", organization_id: "org" };
    state.access = true;
  });

  it("reads the status for the acting user", async () => {
    state.rpc.mockResolvedValue({ data: { ready: true }, error: null });
    const response = await GET(req("GET"), params);
    expect(await response.json()).toEqual({ ready: true });
    expect(state.rpc).toHaveBeenCalledWith("admission_arrival_status", { p_case: "case", p_actor_id: "actor" });
  });

  it("approves exactly the readiness the approver was shown", async () => {
    state.rpc.mockResolvedValue({ data: { id: "approval", replayed: false }, error: null });
    const response = await POST(req("POST", { fingerprint: FINGERPRINT, request_id: REQUEST }), params);
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admission_arrival_approve", {
      p_case: "case", p_actor_id: "actor", p_expected_fingerprint: FINGERPRINT, p_request_id: REQUEST,
    });
  });

  it("refuses an approval with no fingerprint before the database", async () => {
    expect((await POST(req("POST", { request_id: REQUEST }), params)).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("hides a case in a facility the actor cannot reach", async () => {
    state.access = false;
    expect((await GET(req("GET"), params)).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["Only an administrator can approve an arrival", 403],
    ["The readiness changed since you reviewed it. Review it again before approving", 409],
    ["Not ready for arrival: financial clearance, bed assignment", 409],
  ])("keeps the database's words: %s", async (message, status) => {
    state.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await POST(req("POST", { fingerprint: FINGERPRINT, request_id: REQUEST }), params);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  it("withdraws with a reason, and not without one", async () => {
    expect((await DELETE(req("DELETE", { request_id: REQUEST, reason: " " }), params)).status).toBe(400);
    state.rpc.mockResolvedValue({ data: { id: "withdrawal" }, error: null });
    const response = await DELETE(req("DELETE", { request_id: REQUEST, reason: "Family postponed" }), params);
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admission_arrival_approval_withdraw", {
      p_case: "case", p_actor_id: "actor", p_reason: "Family postponed", p_request_id: REQUEST,
    });
  });

  it("logs but never returns an unexpected database message", async () => {
    const sentinel = "insert or update on table admission_arrival_approvals violates foreign key";
    state.rpc.mockResolvedValue({ data: null, error: { message: sentinel } });
    const response = await POST(req("POST", { fingerprint: FINGERPRINT, request_id: REQUEST }), params);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
    expect(logError).toHaveBeenCalled();
  });

  it("says a reused request id in plain words", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Idempotency key payload differs" } });
    const response = await POST(req("POST", { fingerprint: FINGERPRINT, request_id: REQUEST }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This request was already sent with different details. Refresh the page and try again." });
  });
});
