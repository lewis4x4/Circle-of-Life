import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ requireAdminApiActor: vi.fn(), requireFacilityAccess: vi.fn(), rpc: vi.fn(), staffRow: null as Record<string, unknown> | null }));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mock.requireAdminApiActor, requireFacilityAccess: mock.requireFacilityAccess }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET, POST } from "./route";

const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "00000000-0000-0000-0000-000000000001";

function actor() {
  return {
    id: "manager-1",
    organization_id: ORG,
    app_role: "facility_admin",
    client: { rpc: mock.rpc },
    admin: {
      from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: mock.staffRow, error: null }) }) }) }) }),
    },
  };
}

function post(body: unknown): Request {
  return new Request("https://haven.example/api/admin/timeclock/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.rpc.mockReset();
  delete process.env.TIMECLOCK_BADGE_HMAC_SECRET;
  mock.staffRow = { facility_id: "facility-1", organization_id: ORG };
  mock.requireAdminApiActor.mockResolvedValue({ actor: actor() });
  mock.requireFacilityAccess.mockResolvedValue({ ok: true });
  mock.rpc.mockResolvedValue({ data: { staff_id: STAFF, eligible: true, exists: true, employee_number: "A-100", has_badge: false, locked_until: null, pin_set_at: "x", badge_set_at: null }, error: null });
});

describe("/api/admin/timeclock/credentials", () => {
  it("refuses before touching the database when the actor is not a manager", async () => {
    mock.requireAdminApiActor.mockResolvedValue({ response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) });
    expect((await GET(new Request(`https://haven.example/api/admin/timeclock/credentials?staff_id=${STAFF}`))).status).toBe(403);
    expect((await POST(post({ staff_id: STAFF, action: "reset_pin" }))).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("returns status without any hash, and whether badge registration is configured", async () => {
    const response = await GET(new Request(`https://haven.example/api/admin/timeclock/credentials?staff_id=${STAFF}`));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toMatchObject({ employee_number: "A-100", has_badge: false });
    expect(json.badge_secret_configured).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/pin_hash|token_hash|hmac/);
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_credential_status", { p_staff_id: STAFF });
  });

  it("creates a credential with a server generated six digit PIN returned once", async () => {
    const response = await POST(post({ staff_id: STAFF, action: "create", employee_number: "a-100" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.pin).toMatch(/^[0-9]{6}$/);
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[0]).toBe("timeclock_set_credentials");
    expect(args[1]).toMatchObject({ p_staff_id: STAFF, p_mode: "create", p_employee_number: "a-100", p_badge_lookup_hmac: null });
    expect(args[1].p_pin).toBe(json.pin);
  });

  it("assigns a numeric timeclock ID when none was provided", async () => {
    const response = await POST(post({ staff_id: STAFF, action: "create" }));
    expect(response.status).toBe(200);
    const [, args] = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args.p_employee_number).toMatch(/^[1-9][0-9]{7}$/);
    expect(args.p_employee_number).not.toBe((await response.json()).pin);
  });

  it("retries a generated ID collision without resetting the PIN", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "timeclock: employee_number_taken" } });
    const response = await POST(post({ staff_id: STAFF, action: "create" }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    const first = mock.rpc.mock.calls[0][1];
    const second = mock.rpc.mock.calls[1][1];
    expect(first.p_employee_number).not.toBe(second.p_employee_number);
    expect(first.p_pin).toBe(second.p_pin);
  });

  it("stops after five generated ID collisions", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint timeclock_credentials_organization_id_employee_number_key" } });
    const response = await POST(post({ staff_id: STAFF, action: "create" }));
    expect(response.status).toBe(409);
    expect(mock.rpc).toHaveBeenCalledTimes(5);
  });

  it("resets the PIN through set_pin and never accepts a caller-supplied PIN", async () => {
    const response = await POST(post({ staff_id: STAFF, action: "reset_pin", pin: "000000" }));
    expect(response.status).toBe(200);
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[1].p_mode).toBe("set_pin");
    expect(args[1].p_pin).not.toBe("000000");
    expect(String(args[1].p_pin)).toMatch(/^[0-9]{6}$/);
  });

  it("refuses badge registration until the server secret exists, then sends only the HMAC", async () => {
    const missing = await POST(post({ staff_id: STAFF, action: "set_badge", badge: "0004567" }));
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "badge_secret_missing" });
    expect(mock.rpc).not.toHaveBeenCalled();

    process.env.TIMECLOCK_BADGE_HMAC_SECRET = "a-long-enough-server-secret-value";
    const response = await POST(post({ staff_id: STAFF, action: "set_badge", badge: "0004567" }));
    expect(response.status).toBe(200);
    const args = mock.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[1].p_mode).toBe("set_badge");
    expect(String(args[1].p_badge_lookup_hmac)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args[1])).not.toContain("0004567");
  });

  it("maps database refusals: taken number 409, inactive staff 409, forbidden 403", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "timeclock: employee_number_taken" } });
    expect((await POST(post({ staff_id: STAFF, action: "set_number", employee_number: "B200" }))).status).toBe(409);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "timeclock: inactive_staff" } });
    expect((await POST(post({ staff_id: STAFF, action: "reset_pin" }))).status).toBe(409);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "timeclock: forbidden" } });
    expect((await POST(post({ staff_id: STAFF, action: "unlock" }))).status).toBe(403);
  });

  it("returns 404 for staff outside the actor's organization or facilities", async () => {
    mock.staffRow = { facility_id: "facility-9", organization_id: "other-org" };
    expect((await POST(post({ staff_id: STAFF, action: "reset_pin" }))).status).toBe(404);
    mock.staffRow = { facility_id: "facility-9", organization_id: ORG };
    mock.requireFacilityAccess.mockResolvedValue({ response: NextResponse.json({ error: "Facility not found" }, { status: 404 }) });
    expect((await POST(post({ staff_id: STAFF, action: "reset_pin" }))).status).toBe(404);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
