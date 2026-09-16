import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
}));

const actor = {
  id: "a0000000-0000-4000-8000-000000000004",
  organizationId: "org",
  appRole: "caregiver",
  fullName: "Maria Garcia",
  email: null,
  sessionEmail: null,
  client: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return state.rpcResult;
    },
  },
  admin: {},
};

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: async () => ({ actor }),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";

const RECEIPT = {
  care_event_id: "33333333-3333-4333-8333-333333333333",
  level: 2,
  incident_number: null,
  incident_id: null,
  deliveries: [],
  next_check_at: null,
  replayed: true,
};

function payload(extra: Record<string, unknown> = {}) {
  return {
    client_event_id: "22222222-2222-4222-8222-222222222222",
    facility_id: "00000000-0000-4000-8000-000000000001",
    resident_id: null,
    kind: "fall",
    answers: { hurt: "not_hurt" },
    note: null,
    occurred_at: "2026-09-16T02:06:00.000Z",
    location_code: null,
    captured_offline: true,
    ...extra,
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/care-events/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/care-events/submit queue owner guard", () => {
  beforeEach(() => {
    state.rpcCalls = [];
    state.rpcResult = { data: RECEIPT, error: null };
  });

  it("refuses with 403 when the queued item belongs to a different operator and never calls the RPC", async () => {
    const response = await POST(request(payload({ queue_owner_user_id: "a0000000-0000-4000-8000-000000000005" })));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "This event belongs to a different operator. Sign in as its original reporter to send it.",
    });
    expect(state.rpcCalls).toEqual([]);
  });

  it("strips queue_owner_user_id before the RPC when it matches the signed-in operator", async () => {
    const response = await POST(request(payload({ queue_owner_user_id: actor.id })));
    expect(response.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
    const sent = state.rpcCalls[0].args.p_payload as Record<string, unknown>;
    expect(sent).not.toHaveProperty("queue_owner_user_id");
    expect(sent).toMatchObject({ client_event_id: payload().client_event_id, captured_offline: true });
  });

  it("accepts a payload without the owner stamp (direct online submit)", async () => {
    const response = await POST(request(payload()));
    expect(response.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
  });
});
