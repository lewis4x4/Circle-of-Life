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
    expect(await response.json()).toEqual({ first_name: "Test", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 252 });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_identify", expect.objectContaining({ p_device_token: "device-token", p_identifier: "A-100", p_pin: "123456" }));
  });

  it("refuses without a device token and never calls the database", async () => {
    expect((await POST(request({ identifier: "A-100", pin: "123456" }, null))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("treats a short PIN as not recognised without a database call", async () => {
    const response = await POST(request({ identifier: "A-100", pin: "1" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "not_recognized" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps lockout to 423 and the facility flag to 403", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "locked" }, error: null });
    expect((await POST(request({ identifier: "A-100", pin: "123456" }))).status).toBe(423);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "facility_off" }, error: null });
    expect((await POST(request({ identifier: "A-100", pin: "123456" }))).status).toBe(403);
  });
});
