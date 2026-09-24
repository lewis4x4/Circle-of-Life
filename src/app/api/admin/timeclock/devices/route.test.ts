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
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_create_enrollment_code", { p_facility_id: FACILITY, p_device_kind: "kiosk" });
  });

  it("creates a floor tablet code when the kind is floor and refuses an unknown kind", async () => {
    mock.rpc.mockResolvedValue({ data: { code: "ABCD2345", expires_at: "2026-09-16T15:00:00.000Z", device_kind: "floor" }, error: null });
    expect((await POST(post({ facility_id: FACILITY, action: "enroll_code", device_kind: "floor" }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_create_enrollment_code", { p_facility_id: FACILITY, p_device_kind: "floor" });
    mock.rpc.mockClear();
    expect((await POST(post({ facility_id: FACILITY, action: "enroll_code", device_kind: "kitchen" }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("reports the floor settings, falling back to the column defaults before a settings row exists", async () => {
    mock.rpc.mockResolvedValue({ data: [], error: null });
    mock.flag = null;
    const json = await (await GET(new Request(`https://haven.example/api/admin/timeclock/devices?facility_id=${FACILITY}`))).json();
    expect(json.floor).toEqual({ idle_lock_minutes: 3, roster_roles: ["med_tech", "facility_admin"] });
    mock.flag = { timeclock_enabled: true, floor_idle_lock_minutes: 5, floor_roster_roles: ["med_tech"] };
    const next = await (await GET(new Request(`https://haven.example/api/admin/timeclock/devices?facility_id=${FACILITY}`))).json();
    expect(next.floor).toEqual({ idle_lock_minutes: 5, roster_roles: ["med_tech"] });
  });

  it("saves floor settings with the actor recorded and refuses out of range values or non-staff roles", async () => {
    const ok = await POST(post({ facility_id: FACILITY, action: "set_floor_settings", idle_lock_minutes: 5, roster_roles: ["med_tech", "housekeeper"] }));
    expect(ok.status).toBe(200);
    expect(mock.upsert).toHaveBeenCalledWith(
      { organization_id: "org-1", facility_id: FACILITY, floor_idle_lock_minutes: 5, floor_roster_roles: ["med_tech", "housekeeper"], updated_by: "admin-1" },
      { onConflict: "organization_id,facility_id" },
    );
    for (const bad of [
      { idle_lock_minutes: 0, roster_roles: ["med_tech"] },
      { idle_lock_minutes: 31, roster_roles: ["med_tech"] },
      { idle_lock_minutes: 3, roster_roles: [] },
      { idle_lock_minutes: 3, roster_roles: ["family"] },
      { idle_lock_minutes: 3, roster_roles: ["caregiver"] },
    ]) {
      expect((await POST(post({ facility_id: FACILITY, action: "set_floor_settings", ...bad }))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(mock.upsert).toHaveBeenCalledTimes(1);
  });

  it("sets or clears a floor tablet's own roster roles", async () => {
    mock.rpc.mockResolvedValue({ data: { device_id: DEVICE, roster_roles: ["med_tech"] }, error: null });
    expect((await POST(post({ facility_id: FACILITY, action: "set_device_roster_roles", device_id: DEVICE, roster_roles: ["med_tech"] }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_set_device_roster_roles", { p_device_id: DEVICE, p_roster_roles: ["med_tech"] });
    mock.rpc.mockResolvedValue({ data: { device_id: DEVICE, roster_roles: null }, error: null });
    expect((await POST(post({ facility_id: FACILITY, action: "set_device_roster_roles", device_id: DEVICE, roster_roles: null }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenLastCalledWith("timeclock_set_device_roster_roles", { p_device_id: DEVICE, p_roster_roles: null });
    mock.rpc.mockResolvedValue({ data: null, error: { message: "timeclock: roster roles apply to floor tablets only" } });
    expect((await POST(post({ facility_id: FACILITY, action: "set_device_roster_roles", device_id: DEVICE, roster_roles: ["med_tech"] }))).status).toBe(400);
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
