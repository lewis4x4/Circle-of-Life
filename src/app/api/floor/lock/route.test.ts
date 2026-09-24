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

import { POST } from "./route";

const UNLOCK = "22222222-2222-4222-8222-222222222222";
const AUTH_COOKIE = "sb-synthetic-auth-token";

function request(body: unknown, init: { token?: string | null; cookies?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token !== null) headers["x-timeclock-device"] = init.token ?? "floor-token";
  const req = new NextRequest("https://haven.example/api/floor/lock", { method: "POST", headers, body: JSON.stringify(body) });
  for (const [name, value] of Object.entries(init.cookies ?? {})) req.cookies.set(name, value);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mock.rpc.mockResolvedValue({ data: { ok: true, ended_at: "2026-09-23T12:00:00Z", end_reason: "switch" }, error: null });
  mock.signOut.mockImplementation(async (_args: unknown, cookies: CookieAdapter) => {
    cookies.setAll([{ name: AUTH_COOKIE, value: "", options: { path: "/", maxAge: 0 } }]);
    return { error: null };
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("POST /api/floor/lock", () => {
  it("ends the unlock with the device token, signs out locally and clears the cookies (204)", async () => {
    const response = await POST(request({ unlock_id: UNLOCK, reason: "switch" }, { cookies: { [AUTH_COOKIE]: "session", "haven-shell-actor": "a" } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mock.rpc).toHaveBeenCalledWith("floor_end_unlock", { p_device_token: "floor-token", p_unlock_id: UNLOCK, p_reason: "switch" });
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" }, expect.anything());
    const cookies = response.headers.getSetCookie();
    for (const name of [AUTH_COOKIE, "haven-shell-actor"]) {
      expect(cookies.find((c) => c.startsWith(`${name}=`)), name).toMatch(/Max-Age=0/);
    }
  });

  it("still clears the cookies when the session already expired and sign-out fails", async () => {
    mock.signOut.mockRejectedValue(new Error("Auth session missing"));
    const response = await POST(request({ unlock_id: UNLOCK, reason: "idle" }, { cookies: { [`${AUTH_COOKIE}.0`]: "stale" } }));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().find((c) => c.startsWith(`${AUTH_COOKIE}.0=`))).toMatch(/Max-Age=0/);
  });

  it("reaches the lock screen even when the database is unreachable", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "fetch failed", code: "" } });
    const response = await POST(request({ unlock_id: UNLOCK, reason: "sleep" }));
    expect(response.status).toBe(204);
  });

  it("signs out without a database call when the tablet has no token", async () => {
    const response = await POST(request({ unlock_id: UNLOCK, reason: "sleep" }, { token: null, cookies: { [AUTH_COOKIE]: "s" } }));
    expect(response.status).toBe(204);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.signOut).toHaveBeenCalled();
  });

  it("refuses a reason the tablet may not give", async () => {
    for (const reason of ["clocked_out", "device_revoked", "", undefined]) {
      expect((await POST(request({ unlock_id: UNLOCK, reason }))).status).toBe(400);
    }
    expect((await POST(request({ unlock_id: "nope", reason: "idle" }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
