import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ requireAdminApiActor: vi.fn(), requireFacilityAccess: vi.fn(), rpc: vi.fn(), upsert: vi.fn(), flag: { timeclock_enabled: false } as Record<string, unknown> | null }));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mock.requireAdminApiActor, requireFacilityAccess: mock.requireFacilityAccess }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET, POST } from "./route";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function actor(role = "org_admin") {
  return {
    id: "admin-1",
    organization_id: "org-1",
    app_role: role,
    client: {
      rpc: mock.rpc,
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mock.flag, error: null }) }) }),
        upsert: mock.upsert,
      }),
    },
    admin: {},
  };
}

function post(body: unknown): Request {
  return new Request("https://haven.example/api/admin/timeclock/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.flag = { timeclock_enabled: false };
  mock.requireAdminApiActor.mockResolvedValue({ actor: actor() });
  mock.requireFacilityAccess.mockResolvedValue({ ok: true });
  mock.upsert.mockResolvedValue({ error: null });
});

describe("/api/admin/timeclock/devices", () => {
  it("lists devices without token hashes and reports the flag and manage capability", async () => {
    mock.rpc.mockResolvedValue({ data: [{ id: DEVICE, label: "Front desk", enrolled_at: "x", last_seen_at: null, revoked_at: null, throttled_until: null }], error: null });
    const response = await GET(new Request(`https://haven.example/api/admin/timeclock/devices?facility_id=${FACILITY}`));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ enabled: false, can_manage: true });
    expect(json.devices[0].label).toBe("Front desk");
    expect(JSON.stringify(json)).not.toContain("token_hash");
  });

  it("returns the one time enrollment code from the database function", async () => {
    mock.rpc.mockResolvedValue({ data: { code: "ABCD2345", expires_at: "2026-09-16T15:00:00.000Z" }, error: null });
    const response = await POST(post({ facility_id: FACILITY, action: "enroll_code" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "ABCD2345", expires_at: "2026-09-16T15:00:00.000Z" });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_create_enrollment_code", { p_facility_id: FACILITY });
  });

  it("revokes a device and flips the facility flag with the actor recorded", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(post({ facility_id: FACILITY, action: "revoke", device_id: DEVICE }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_revoke_device", { p_device_id: DEVICE });
    expect((await POST(post({ facility_id: FACILITY, action: "set_enabled", enabled: true }))).status).toBe(200);
    expect(mock.upsert).toHaveBeenCalledWith({ organization_id: "org-1", facility_id: FACILITY, timeclock_enabled: true, updated_by: "admin-1" }, { onConflict: "organization_id,facility_id" });
  });

  it("refuses writes from a facility_admin and from outside the facility grant", async () => {
    mock.requireAdminApiActor.mockResolvedValueOnce({ response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) });
    expect((await POST(post({ facility_id: FACILITY, action: "enroll_code" }))).status).toBe(403);
    mock.requireFacilityAccess.mockResolvedValueOnce({ response: NextResponse.json({ error: "Facility not found" }, { status: 404 }) });
    expect((await POST(post({ facility_id: FACILITY, action: "enroll_code" }))).status).toBe(404);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    expect((await POST(post({ facility_id: "nope", action: "enroll_code" }))).status).toBe(400);
    expect((await POST(post({ facility_id: FACILITY, action: "revoke", device_id: "x" }))).status).toBe(400);
    expect((await GET(new Request("https://haven.example/api/admin/timeclock/devices"))).status).toBe(400);
  });
});
