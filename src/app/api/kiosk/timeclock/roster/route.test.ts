import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

function request(token: string | null = "device-token"): Request {
  const headers: Record<string, string> = {};
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/kiosk/timeclock/roster", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/kiosk/timeclock/roster", () => {
  it("returns names only, with the device token held server side (no-store)", async () => {
    mock.rpc.mockResolvedValue({
      data: {
        ok: true,
        throttled_until: null,
        roster: [
          { staff_id: "s1", display_name: "Ashley W.", employee_number: "1042" },
          { staff_id: "s2", display_name: "  " },
        ],
      },
      error: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ roster: [{ staff_id: "s1", display_name: "Ashley W." }], throttled_until: null });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_kiosk_roster", { p_device_token: "device-token" });
  });

  it("passes a throttle through so the kiosk can say when PIN entry reopens", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, throttled_until: "2026-10-01T23:40:00Z", roster: [] }, error: null });
    expect(await (await GET(request())).json()).toEqual({ roster: [], throttled_until: "2026-10-01T23:40:00Z" });
  });

  it("refuses without a token, maps an unknown device to 401 and the facility flag to 403", async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_unknown" }, error: null });
    expect((await GET(request())).status).toBe(401);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "facility_off" }, error: null });
    expect((await GET(request())).status).toBe(403);
  });

  it("answers 503 when the database call fails", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
