import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieWrite = { name: string; value: string; options?: Record<string, unknown> };
type CookieAdapter = { getAll: () => { name: string; value: string }[]; setAll: (cookies: CookieWrite[]) => void };

const mock = vi.hoisted(() => ({ rpc: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => ({
    auth: { signOut: (args: unknown) => mock.signOut(args, options.cookies) },
  }),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

const UNLOCK = "22222222-2222-4222-8222-222222222222";
const AUTH_COOKIE = "sb-synthetic-auth-token";

function request(unlockId: string, token: string | null = "floor-token"): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["x-timeclock-device"] = token;
  const req = new NextRequest(`https://haven.example/api/floor/heartbeat?unlock_id=${unlockId}`, { headers });
  req.cookies.set(AUTH_COOKIE, "session");
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mock.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("GET /api/floor/heartbeat", () => {
  it("keeps an active unlock and leaves the session alone", async () => {
    mock.rpc.mockResolvedValue({ data: { active: true, reason: null }, error: null });
    const response = await GET(request(UNLOCK));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ active: true, reason: null });
    expect(mock.rpc).toHaveBeenCalledWith("floor_heartbeat", { p_device_token: "floor-token", p_unlock_id: UNLOCK });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("signs the tablet out on the same response when the person clocked out", async () => {
    mock.rpc.mockResolvedValue({ data: { active: false, reason: "clocked_out" }, error: null });
    const response = await GET(request(UNLOCK));
    expect(await response.json()).toEqual({ active: false, reason: "clocked_out" });
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" }, expect.anything());
    expect(response.headers.getSetCookie().find((c) => c.startsWith(`${AUTH_COOKIE}=`))).toMatch(/Max-Age=0/);
  });

  it("reads a tablet without a token as revoked, and an unknown reason as unknown", async () => {
    const revoked = await GET(request(UNLOCK, null));
    expect(await revoked.json()).toEqual({ active: false, reason: "device_revoked" });
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValue({ data: { active: false, reason: "something_new" }, error: null });
    expect(await (await GET(request(UNLOCK))).json()).toEqual({ active: false, reason: "unknown" });
  });

  it("answers unavailable, without signing out, when the database cannot answer", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "timeout", code: "57014" } });
    const response = await GET(request(UNLOCK));
    expect(response.status).toBe(503);
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a malformed unlock id", async () => {
    expect((await GET(request("nope"))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
