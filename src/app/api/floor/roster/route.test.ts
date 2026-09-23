import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), staff: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: mock.rpc,
    from: () => ({ select: () => ({ in: mock.staff }) }),
  }),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

function request(token: string | null = "floor-token"): Request {
  const headers: Record<string, string> = {};
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/floor/roster", { headers });
}

const PERSON = {
  staff_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Test P.",
  initials: "TP",
  role_label: "Med-Tech",
  clocked_in_at: "2026-09-23T11:02:00Z",
  last_on_this_device: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.staff.mockResolvedValue({ data: [{ id: PERSON.staff_id, user_id: "u-1" }], error: null });
});

describe("GET /api/floor/roster", () => {
  it("returns the roster with each person's login id, no-store", async () => {
    mock.rpc.mockResolvedValue({
      data: { ok: true, facility_name: "Synthetic facility", device_label: "Floor 01", idle_lock_minutes: 3, throttled_until: null, roster: [PERSON] },
      error: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      facility_name: "Synthetic facility",
      device_label: "Floor 01",
      idle_lock_minutes: 3,
      throttled_until: null,
      roster: [{ ...PERSON, user_id: "u-1" }],
    });
    expect(mock.rpc).toHaveBeenCalledWith("floor_roster", { p_device_token: "floor-token" });
    expect(mock.staff).toHaveBeenCalledWith("id", [PERSON.staff_id]);
  });

  it("skips the login lookup for an empty roster", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, facility_name: "F", device_label: "L", idle_lock_minutes: 5, throttled_until: null, roster: [] }, error: null });
    const json = await (await GET(request())).json();
    expect(json.roster).toEqual([]);
    expect(mock.staff).not.toHaveBeenCalled();
  });

  it("refuses without a device header before the database (401)", async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "device_unknown" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps a revoked or kiosk token to 401 and a tablet with the flag off to 403", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_unknown" }, error: null });
    expect((await GET(request())).status).toBe(401);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "facility_off" }, error: null });
    const off = await GET(request());
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ error: "facility_off" });
  });
});
