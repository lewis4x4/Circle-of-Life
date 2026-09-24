import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

const ENTRY = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, token: string | null = "kiosk-token"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-timeclock-device"] = token;
  return new Request("https://haven.example/api/kiosk/visitor/sign-out", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kiosk/visitor/sign-out", () => {
  it("signs the visit out and returns its times", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, checked_in_at: "2026-09-23T14:12:00Z", checked_out_at: "2026-09-23T15:40:00Z", display_name: "Jordan V." }, error: null });
    const response = await POST(request({ entry_id: ENTRY }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ checked_in_at: "2026-09-23T14:12:00Z", checked_out_at: "2026-09-23T15:40:00Z", display_name: "Jordan V." });
    expect(mock.rpc).toHaveBeenCalledWith("visitor_kiosk_sign_out", { p_device_token: "kiosk-token", p_entry_id: ENTRY });
  });

  it("maps not found (404) and already signed out (409)", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "not_found" }, error: null });
    expect((await POST(request({ entry_id: ENTRY }))).status).toBe(404);
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "already_signed_out" }, error: null });
    const again = await POST(request({ entry_id: ENTRY }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_signed_out" });
  });

  it("refuses a bad entry id or a missing token before the database", async () => {
    expect((await POST(request({ entry_id: "x" }))).status).toBe(400);
    expect((await POST(request({ entry_id: ENTRY }, null))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("answers a throttled kiosk with 429, Retry-After 300 and no-store, in the kiosk's own words", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "device_throttled" }, error: null });
    const response = await POST(request({ entry_id: ENTRY }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "device_throttled" });
  });
});
