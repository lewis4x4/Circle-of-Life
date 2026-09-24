import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

function request(prefix: string, token: string | null = "kiosk-token"): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["x-timeclock-device"] = token;
  return new NextRequest(`https://haven.example/api/kiosk/visitor/open?prefix=${encodeURIComponent(prefix)}`, { headers });
}

function match(i: number) {
  return { entry_id: `e${i}`, display_name: `Jordan ${i}.`, type_label: "Visiting a resident", checked_in_at: "2026-09-23T14:12:00Z" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/kiosk/visitor/open", () => {
  it("answers nothing before 3 letters without calling the database", async () => {
    for (const prefix of ["", "Jo", "J1-", "  ab  "]) {
      const response = await GET(request(prefix));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ matches: [] });
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("returns at most 5 matches for a 3-letter prefix", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, matches: [1, 2, 3, 4, 5, 6].map(match) }, error: null });
    const json = await (await GET(request("Jor"))).json();
    expect(json.matches).toHaveLength(5);
    expect(json.matches[0]).toEqual(match(1));
    expect(mock.rpc).toHaveBeenCalledWith("visitor_kiosk_open_matches", { p_device_token: "kiosk-token", p_prefix: "Jor" });
  });

  it("refuses without a token, and maps a revoked token to 401", async () => {
    expect((await GET(request("Jor", null))).status).toBe(401);
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "device_unknown" }, error: null });
    expect((await GET(request("Jor"))).status).toBe(401);
  });

  it("answers a throttled kiosk with 429, Retry-After 300 and no-store, in the kiosk's own words", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_throttled" }, error: null });
    const response = await GET(request("Car"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "device_throttled" });
  });
});
