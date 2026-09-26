import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

function request(prefix: string, token: string | null = "kiosk-token"): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["x-timeclock-device"] = token;
  return new NextRequest(`https://haven.example/api/kiosk/visitor/residents?prefix=${encodeURIComponent(prefix)}`, { headers });
}

function match(i: number) {
  return { resident_id: `r${i}`, display_name: `Martha ${i}.`, room: String(i) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/kiosk/visitor/residents", () => {
  it("answers nothing before 3 letters without calling the database", async () => {
    for (const prefix of ["", "Ma", "M1-", "  ab  "]) {
      const response = await GET(request(prefix));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ matches: [] });
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("returns at most 6 residents for a 3-letter prefix, with the device token held server side", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, matches: [1, 2, 3, 4, 5, 6, 7].map(match) }, error: null });
    const body = await (await GET(request("Mar"))).json();
    expect(body.matches).toHaveLength(6);
    expect(body.matches[0]).toEqual(match(1));
    expect(mock.rpc).toHaveBeenCalledWith("visitor_kiosk_resident_matches", { p_device_token: "kiosk-token", p_prefix: "Mar" });
  });

  it("passes only the resident id, short name and room, and a missing room as null", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, matches: [{ resident_id: "r1", display_name: "Mary B.", room: null, last_name: "Brown" }] }, error: null });
    expect((await (await GET(request("Mar"))).json()).matches).toEqual([{ resident_id: "r1", display_name: "Mary B.", room: null }]);
  });

  it("refuses without a token, maps a revoked token to 401 and a throttled one to 429", async () => {
    expect((await GET(request("Mar", null))).status).toBe(401);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_unknown" }, error: null });
    expect((await GET(request("Mar"))).status).toBe(401);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_throttled" }, error: null });
    const throttled = await GET(request("Mar"));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("300");
  });

  it("answers unavailable when the database call fails", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const response = await GET(request("Mar"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
