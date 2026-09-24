import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

const UNLOCK = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const FACILITY = "55555555-5555-4555-8555-555555555555";
const ROUND_ID = "66666666-6666-4666-8666-666666666666";
const EVENT_ID = "77777777-7777-4777-8777-777777777777";

function request(body: unknown, token: string | null = "floor-token"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/floor/replay", { method: "POST", headers, body: JSON.stringify(body) });
}

const ROUNDING = {
  kind: "rounding",
  client_id: ROUND_ID,
  unlock_id: UNLOCK,
  owner_user_id: OWNER,
  captured_at: "2026-09-23T13:30:00.000Z",
  task_id: TASK,
  payload: { requestId: ROUND_ID, observedAt: "2026-09-23T13:29:00.000Z", quickStatus: "asleep", repositioned: true, note: null },
};

const CARE_EVENT = {
  kind: "care_event",
  client_id: EVENT_ID,
  unlock_id: UNLOCK,
  owner_user_id: OWNER,
  captured_at: "2026-09-23T13:31:00.000Z",
  payload: { client_event_id: EVENT_ID, facility_id: FACILITY, kind: "fall", answers: {}, queue_owner_user_id: OWNER },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/floor/replay", () => {
  it("writes a rounding check and a care event as their owner with the device token", async () => {
    mock.rpc.mockImplementation(async (name: string) =>
      name === "floor_replay_complete_rounding_task"
        ? { data: { ok: true, log_id: "log-1", status: "completed_late" }, error: null }
        : { data: { ok: true, receipt: {} }, error: null });
    const response = await POST(request({ items: [ROUNDING, CARE_EVENT] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ results: [
      { client_id: ROUND_ID, status: "sent" },
      { client_id: EVENT_ID, status: "sent" },
    ] });

    const [roundName, roundArgs] = mock.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(roundName).toBe("floor_replay_complete_rounding_task");
    expect(roundArgs).toMatchObject({ p_device_token: "floor-token", p_unlock_id: UNLOCK, p_owner_user_id: OWNER, p_captured_at: "2026-09-23T13:30:00.000Z", p_task_id: TASK });
    expect(roundArgs.p_payload).toMatchObject({ request_id: ROUND_ID, observed_at: "2026-09-23T13:29:00.000Z", offline: true, quick_status: "asleep", repositioned: true, toileting_assisted: false, exception_present: false });

    const [eventName, eventArgs] = mock.rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(eventName).toBe("floor_replay_submit_care_event");
    expect(eventArgs.p_payload).toEqual({ client_event_id: EVENT_ID, facility_id: FACILITY, kind: "fall", answers: {}, captured_offline: true });
  });

  it("rejects for good what the proof or the writer refuses, and keeps what could not be written", async () => {
    mock.rpc
      .mockResolvedValueOnce({ data: { ok: false, error: "outside_unlock" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Rounding actor is no longer authorized" } })
      .mockResolvedValueOnce({ data: null, error: { code: "", message: "fetch failed" } })
      .mockResolvedValueOnce({ data: { ok: false, error: "device_unknown" }, error: null });
    const ids = ["a1111111-1111-4111-8111-111111111111", "a2222222-2222-4222-8222-222222222222", "a3333333-3333-4333-8333-333333333333", "a4444444-4444-4444-8444-444444444444"];
    const items = ids.map((id) => ({ ...ROUNDING, client_id: id, payload: { ...ROUNDING.payload, requestId: id } }));
    const json = await (await POST(request({ items }))).json();
    expect(json.results).toEqual([
      { client_id: ids[0], status: "rejected", error: "outside_unlock" },
      { client_id: ids[1], status: "rejected", error: "refused" },
      { client_id: ids[2], status: "retry", error: "unavailable" },
      { client_id: ids[3], status: "retry", error: "device_unknown" },
    ]);
  });

  it("rejects a malformed item without calling the database, and chip capture it cannot replay", async () => {
    const json = await (await POST(request({ items: [
      { ...ROUNDING, payload: { ...ROUNDING.payload, quickStatus: "sleepy" } },
      { ...CARE_EVENT, client_id: "b1111111-1111-4111-8111-111111111111", payload: { ...CARE_EVENT.payload, kind: "not_a_kind" } },
      { ...ROUNDING, client_id: "b2222222-2222-4222-8222-222222222222", payload: { ...ROUNDING.payload, chipSelections: { mood: ["calm"] } } },
      { ...ROUNDING, client_id: "b3333333-3333-4333-8333-333333333333", unlock_id: "nope" },
    ] }))).json();
    expect(json.results.map((r: { status: string; error?: string }) => [r.status, r.error])).toEqual([
      ["rejected", "invalid_input"],
      ["rejected", "invalid_input"],
      ["rejected", "chip_capture_not_replayable"],
      ["rejected", "invalid_input"],
    ]);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("needs the device token and a bounded batch", async () => {
    expect((await POST(request({ items: [ROUNDING] }, null))).status).toBe(401);
    expect((await POST(request({ items: [] }))).status).toBe(400);
    expect((await POST(request({ items: Array.from({ length: 26 }, () => ROUNDING) }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
