import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown, token: string | null = "device-token"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/kiosk/timeclock/punch", { method: "POST", headers, body: JSON.stringify(body) });
}

const GOOD = { identifier: "A-100", pin: "123456", punch_type: "in", device_time: "2026-09-16T11:02:00.000Z", client_punch_id: CLIENT_ID, captured_offline: false };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TIMECLOCK_BADGE_HMAC_SECRET;
});

describe("POST /api/kiosk/timeclock/punch", () => {
  it("records a punch and returns the receipt (200)", async () => {
    mock.rpc.mockResolvedValue({
      data: { ok: true, replayed: false, punch_id: "p1", first_name: "Test", punch_type: "in", punched_at: "2026-09-16T11:02:00.100Z", flags: [], state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 0 },
      error: null,
    });
    const response = await POST(request(GOOD));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ punch_id: "p1", first_name: "Test", next_actions: ["out", "meal_start"], replayed: false });
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[0]).toBe("timeclock_record_punch");
    expect(args[1]).toMatchObject({ p_device_token: "device-token", p_identifier: "A-100", p_pin: "123456", p_punch_type: "in", p_client_punch_id: CLIENT_ID, p_captured_offline: false });
    expect(args[1].p_badge_lookup_hmac).toBeNull();
  });

  it("passes a badge HMAC when the secret is configured, never the raw value", async () => {
    process.env.TIMECLOCK_BADGE_HMAC_SECRET = "a-long-enough-server-secret-value";
    mock.rpc.mockResolvedValue({ data: { ok: true, punch_id: "p", first_name: "T", punch_type: "in", punched_at: "x", flags: [], state: "in", next_actions: ["out"], today_worked_minutes: 0 }, error: null });
    await POST(request(GOOD));
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(String(args[1].p_badge_lookup_hmac)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(args[1].p_badge_lookup_hmac)).not.toContain("A-100");
  });

  it("refuses without a device header before touching the database (401)", async () => {
    const response = await POST(request(GOOD, null));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "device_unknown" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps database codes to statuses: 401 device, 403 flag, 423 locked, 409 next type, 429 throttled", async () => {
    const cases: [string, number][] = [
      ["device_unknown", 401],
      ["facility_off", 403],
      ["locked", 423],
      ["invalid_next_type", 409],
      ["device_throttled", 429],
      ["not_recognized", 401],
    ];
    for (const [code, status] of cases) {
      mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: code }, error: null });
      const response = await POST(request(GOOD));
      expect(response.status, code).toBe(status);
      expect((await response.json()).error).toBe(code);
    }
  });

  it("never reveals a terminated or unassigned person: same words as a wrong PIN", async () => {
    for (const code of ["inactive_staff", "not_assigned", "pin_unavailable"]) {
      mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: code }, error: null });
      const response = await POST(request(GOOD));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "not_recognized" });
    }
  });

  it("an idempotent retry returns the stored punch with replayed=true", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, replayed: true, punch_id: "p1", first_name: "Test", punch_type: "in", punched_at: "2026-09-16T11:02:00.100Z", flags: [], state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 4 }, error: null });
    const first = await POST(request(GOOD));
    const second = await POST(request(GOOD));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).replayed).toBe(true);
    const ids = mock.rpc.mock.calls.map((c) => (c as unknown as [string, Record<string, unknown>])[1].p_client_punch_id);
    expect(ids).toEqual([CLIENT_ID, CLIENT_ID]);
  });

  it("an offline replay the server refused comes back as 422 rejected_offline so the tablet drops it", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "not_recognized" }, error: null });
    const response = await POST(request({ ...GOOD, pin: "", captured_offline: true }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "rejected_offline" });
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[1]).toMatchObject({ p_captured_offline: true, p_pin: "" });
  });

  it("rejects malformed input (400) and a malformed PIN online (401) without a database call", async () => {
    expect((await POST(request({ ...GOOD, punch_type: "nap" }))).status).toBe(400);
    expect((await POST(request({ ...GOOD, client_punch_id: "nope" }))).status).toBe(400);
    expect((await POST(request({ ...GOOD, device_time: "yesterday" }))).status).toBe(400);
    expect((await POST(request({ ...GOOD, pin: "12" }))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("returns 503 on a database transport error", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const response = await POST(request(GOOD));
    expect(response.status).toBe(503);
  });
});

describe("punch: front-door kiosk display fields (COL-692)", () => {
  it("carries display_name on the receipt when the database returns it, and adds nothing when it does not", async () => {
    mock.rpc.mockResolvedValueOnce({
      data: { ok: true, replayed: false, punch_id: "p1", first_name: "Ashley", display_name: "Ashley W.", last_out_at: null, punch_type: "in", punched_at: "2026-10-01T10:58:00Z", flags: [], state: "in", next_actions: ["out"], today_worked_minutes: 0 },
      error: null,
    });
    expect(await (await POST(request(GOOD))).json()).toMatchObject({ display_name: "Ashley W.", last_out_at: null });
    mock.rpc.mockResolvedValueOnce({
      data: { ok: true, replayed: false, punch_id: "p1", first_name: "Ashley", punch_type: "in", punched_at: "2026-10-01T10:58:00Z", flags: [], state: "in", next_actions: ["out"], today_worked_minutes: 0 },
      error: null,
    });
    const older = await (await POST(request(GOOD))).json();
    expect(older).not.toHaveProperty("display_name");
    expect(older).not.toHaveProperty("last_out_at");
  });
});
