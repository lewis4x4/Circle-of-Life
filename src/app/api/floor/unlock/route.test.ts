import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieWrite = { name: string; value: string; options?: Record<string, unknown> };
type CookieAdapter = { getAll: () => { name: string; value: string }[]; setAll: (cookies: CookieWrite[]) => void };

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  adapters: [] as CookieAdapter[],
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: mock.rpc, auth: { admin: { generateLink: mock.generateLink } } }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
    mock.adapters.push(options.cookies);
    return { auth: { verifyOtp: (args: unknown) => mock.verifyOtp(args, options.cookies) } };
  },
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

const STAFF = "11111111-1111-4111-8111-111111111111";
const UNLOCK = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const AUTH_COOKIE = "sb-synthetic-auth-token";

function request(body: unknown, init: { token?: string | null; cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token !== null) headers["x-timeclock-device"] = init.token ?? "floor-token";
  const req = new NextRequest("https://haven.example/api/floor/unlock", { method: "POST", headers, body: JSON.stringify(body) });
  // The test DOM drops a Cookie request header, so seed the jar directly.
  for (const pair of init.cookie?.split("; ") ?? []) {
    const [name, value] = pair.split("=");
    req.cookies.set(name, value);
  }
  return req;
}

const VERIFIED = {
  ok: true,
  unlock_id: UNLOCK,
  user_id: USER,
  email: "synthetic.medtech@example.test",
  on_clock: true,
  idle_lock_minutes: 3,
  display_name: "Test P.",
  role_label: "Med-Tech",
  clocked_in_at: "2026-09-23T11:02:00Z",
};

function setCookieHeaders(response: Response): string[] {
  return response.headers.getSetCookie();
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.adapters.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mock.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hashed" } }, error: null });
  mock.verifyOtp.mockImplementation(async (_args: unknown, cookies: CookieAdapter) => {
    cookies.setAll([{ name: AUTH_COOKIE, value: "new-session", options: { path: "/", sameSite: "lax" } }]);
    return { data: { session: { user: { id: USER } } }, error: null };
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("POST /api/floor/unlock", () => {
  it("verifies the PIN, mints the session onto the response cookies and returns the unlock", async () => {
    mock.rpc.mockResolvedValue({ data: VERIFIED, error: null });
    const response = await POST(request({ staff_id: STAFF, pin: "123456" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const json = await response.json();
    expect(json).toEqual({
      unlock_id: UNLOCK,
      user_id: USER,
      idle_lock_minutes: 3,
      display_name: "Test P.",
      role_label: "Med-Tech",
      clocked_in_at: "2026-09-23T11:02:00Z",
      on_clock: true,
    });
    expect(JSON.stringify(json)).not.toContain("example.test");
    expect(mock.rpc).toHaveBeenCalledWith("floor_verify_unlock", { p_device_token: "floor-token", p_staff_id: STAFF, p_employee_number: null, p_pin: "123456" });
    expect(mock.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "synthetic.medtech@example.test" });
    expect(mock.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hashed" }, expect.anything());
    // The minting client starts from no session: it never reads the previous person's cookies.
    expect(mock.adapters[0]?.getAll()).toEqual([]);
    expect(setCookieHeaders(response).some((c) => c.startsWith(`${AUTH_COOKIE}=new-session`))).toBe(true);
  });

  it("expires the previous person's session cookies before the new session lands", async () => {
    mock.rpc.mockResolvedValue({ data: VERIFIED, error: null });
    const response = await POST(request({ staff_id: STAFF, pin: "123456" }, {
      cookie: `${AUTH_COOKIE}.0=old-a; ${AUTH_COOKIE}.1=old-b; haven-shell-actor=old; theme=dark`,
    }));
    const cookies = setCookieHeaders(response);
    for (const name of [`${AUTH_COOKIE}.0`, `${AUTH_COOKIE}.1`, "haven-shell-actor"]) {
      const cookie = cookies.find((c) => c.startsWith(`${name}=`));
      expect(cookie, name).toMatch(/Max-Age=0/);
    }
    expect(cookies.some((c) => c.startsWith("theme="))).toBe(false);
    expect(cookies.some((c) => c.startsWith(`${AUTH_COOKIE}=new-session`))).toBe(true);
  });

  it("accepts the employee number path", async () => {
    mock.rpc.mockResolvedValue({ data: { ...VERIFIED, on_clock: false }, error: null });
    const response = await POST(request({ employee_number: " E-100 ", pin: "123456" }));
    expect(response.status).toBe(200);
    expect((await response.json()).on_clock).toBe(false);
    expect(mock.rpc).toHaveBeenCalledWith("floor_verify_unlock", { p_device_token: "floor-token", p_staff_id: null, p_employee_number: "E-100", p_pin: "123456" });
  });

  it("ends the unlock and answers unavailable when the session cannot be minted", async () => {
    mock.rpc.mockImplementation(async (name: string) =>
      name === "floor_verify_unlock" ? { data: VERIFIED, error: null } : { data: { ok: true }, error: null });
    mock.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: "Token has expired" } });
    const response = await POST(request({ staff_id: STAFF, pin: "123456" }, { cookie: `${AUTH_COOKIE}=old` }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(mock.rpc).toHaveBeenCalledWith("floor_end_unlock", { p_device_token: "floor-token", p_unlock_id: UNLOCK, p_reason: "switch" });
    expect(setCookieHeaders(response).find((c) => c.startsWith(`${AUTH_COOKIE}=`))).toMatch(/Max-Age=0/);
  });

  it("never hands out a session that belongs to someone else", async () => {
    mock.rpc.mockResolvedValue({ data: VERIFIED, error: null });
    mock.verifyOtp.mockImplementation(async (_args: unknown, cookies: CookieAdapter) => {
      cookies.setAll([{ name: AUTH_COOKIE, value: "wrong-person", options: { path: "/" } }]);
      return { data: { session: { user: { id: "44444444-4444-4444-8444-444444444444" } } }, error: null };
    });
    const response = await POST(request({ staff_id: STAFF, pin: "123456" }));
    expect(response.status).toBe(503);
    expect(setCookieHeaders(response).some((c) => c.includes("wrong-person"))).toBe(false);
  });

  it("maps the unlock refusals to operator codes and statuses", async () => {
    const cases: [string, number, string][] = [
      ["not_recognized", 401, "not_recognized"],
      ["locked", 423, "locked"],
      ["device_throttled", 429, "device_throttled"],
      ["device_unknown", 401, "device_unknown"],
      ["not_allowed", 403, "not_allowed"],
      ["no_login", 403, "no_login"],
      ["facility_off", 403, "facility_off"],
      ["something_new", 401, "not_recognized"],
    ];
    for (const [dbCode, status, code] of cases) {
      mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: dbCode }, error: null });
      const response = await POST(request({ staff_id: STAFF, pin: "123456" }));
      expect(response.status, dbCode).toBe(status);
      expect(await response.json()).toEqual({ error: code });
    }
    expect(mock.generateLink).not.toHaveBeenCalled();
  });

  it("says how many tries are left on a roster PIN miss, and never on the employee-number path", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "not_recognized", tries_left: 3 }, error: null });
    const roster = await POST(request({ staff_id: STAFF, pin: "123456" }));
    expect(roster.status).toBe(401);
    expect(await roster.json()).toEqual({ error: "not_recognized", tries_left: 3 });

    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "not_recognized", tries_left: 3 }, error: null });
    const byNumber = await POST(request({ employee_number: "E-1001", pin: "123456" }));
    expect(await byNumber.json()).toEqual({ error: "not_recognized" });

    mock.rpc.mockResolvedValueOnce({ data: { ok: false, error: "locked", tries_left: 0 }, error: null });
    expect(await (await POST(request({ staff_id: STAFF, pin: "123456" }))).json()).toEqual({ error: "locked" });
  });

  it("refuses a bad body before the database", async () => {
    expect((await POST(request({ staff_id: STAFF, employee_number: "E-1", pin: "123456" }))).status).toBe(400);
    expect((await POST(request({ pin: "123456" }))).status).toBe(400);
    expect((await POST(request({ staff_id: "not-a-uuid", pin: "123456" }))).status).toBe(400);
    expect((await POST(request({ staff_id: STAFF, pin: "12345" }))).status).toBe(401);
    expect((await POST(request({ staff_id: STAFF, pin: "123456" }, { token: null }))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
