import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

function request(body: unknown, token: string | null = "device-token"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/kiosk/timeclock/identify", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kiosk/timeclock/identify", () => {
  it("returns the valid next actions for a recognised person", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, first_name: "Test", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 252 }, error: null });
    const response = await POST(request({ identifier: "A-100", pin: "123456" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ first_name: "Test", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 252, planned_context: { status: "unavailable" } });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_identify", expect.objectContaining({ p_device_token: "device-token", p_identifier: "A-100", p_pin: "123456" }));
  });

  it("scopes planned reads to database-verified identity and never exposes the internal IDs", async () => {
    const staff = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", facility = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const planned = { assignment_id: "assignment", schedule_id: "schedule", staff_id: staff, facility_id: facility, service_date: new Date().toISOString().slice(0, 10), starts_at: new Date(Date.now() - 3600_000).toISOString(), ends_at: new Date(Date.now() + 8 * 3600_000).toISOString(), time_zone: "America/New_York", label: "Custom nine hours", color: "#338866", block_index: 0, block_count: 1 };
    const builder = { order: () => builder, range: async () => ({ data: [planned], count: 1, error: null }) };
    mock.rpc.mockImplementation((name: string) => name === "timeclock_identify"
      ? Promise.resolve({ data: { ok: true, staff_id: staff, facility_id: facility, first_name: "Test", state: "out", next_actions: ["in"], today_worked_minutes: 252 }, error: null })
      : builder);
    const response = await POST(request({ identifier: "A-100", pin: "123456", staff_id: "attacker", facility_id: "other" }));
    const result = await response.json();
    expect(result).toMatchObject({ next_actions: ["in"], today_worked_minutes: 252, planned_context: { status: "ready", blocks: [{ label: "Custom nine hours" }] } });
    expect(mock.rpc).toHaveBeenCalledWith("schedule_assignment_intervals", expect.objectContaining({ p_staff_id: staff, p_facility_id: facility }), { count: "exact" });
    expect(result).not.toHaveProperty("staff_id"); expect(result).not.toHaveProperty("facility_id");
  });

  it("refuses without a device token and never calls the database", async () => {
    expect((await POST(request({ identifier: "A-100", pin: "123456" }, null))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("treats a short PIN as not recognised without a database call", async () => {
    const response = await POST(request({ identifier: "A-100", pin: "1" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "not_recognized" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps lockout to 423 and the facility flag to 403", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "locked" }, error: null });
    const locked = await POST(request({ identifier: "A-100", pin: "123456" }));
    expect(locked.status).toBe(423);
    expect(locked.headers.get("Cache-Control")).toBe("no-store");
    expect(locked.headers.get("Retry-After")).toBe("900");
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "facility_off" }, error: null });
    expect((await POST(request({ identifier: "A-100", pin: "123456" }))).status).toBe(403);
  });
});

describe("identify: front-door kiosk display fields (COL-692)", () => {
  it("passes display_name and last_out_at through when the database returns them", async () => {
    mock.rpc.mockResolvedValue({
      data: { ok: true, first_name: "Ashley", display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00Z", state: "out", next_actions: ["in"], today_worked_minutes: 0 },
      error: null,
    });
    const response = await POST(request({ identifier: "1042", pin: "123456" }));
    expect(await response.json()).toMatchObject({ display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00Z" });
  });

  it("returns null for a person with no clock out yet", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, first_name: "Ashley", display_name: "Ashley W.", last_out_at: null, state: "out", next_actions: ["in"], today_worked_minutes: 0 }, error: null });
    const response = await POST(request({ identifier: "1042", pin: "123456" }));
    expect((await response.json()).last_out_at).toBeNull();
  });
});
