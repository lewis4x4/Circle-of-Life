import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facility: vi.fn(),
  disable: vi.fn(),
  expand: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireFacilityAccess: mocks.facility,
}));

vi.mock("@/lib/admin/user-access-lifecycle", () => ({
  commitRestrictiveUserAccess: mocks.disable,
  commitExpansiveUserAccess: mocks.expand,
}));

vi.mock("@/lib/observability/logger", () => ({
  logError: vi.fn(),
}));

import { executeStaffOffboard, executeStaffReactivate } from "./staff-offboard-server";
import type { AdminApiActor } from "@/lib/admin/api-auth";

const STAFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STAFF_ID,
    organization_id: ORG_ID,
    facility_id: FACILITY_ID,
    user_id: USER_ID,
    first_name: "Harbor",
    last_name: "Example",
    employment_status: "active",
    termination_date: null,
    termination_reason: null,
    staff_role: "cna",
    hire_date: "2024-06-01",
    preferred_name: null,
    phone: null,
    phone_alt: null,
    email: null,
    address_line_1: null,
    address_line_2: null,
    city: null,
    state: null,
    zip: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    hourly_rate: null,
    overtime_rate: null,
    is_full_time: true,
    is_float_pool: false,
    max_hours_per_week: null,
    photo_url: null,
    notes: null,
    updated_at: "2026-09-15T12:00:00Z",
    ...overrides,
  };
}

function makeAdmin(options: {
  staff?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}) {
  const staff = options.staff === undefined ? staffRow() : options.staff;
  const user =
    options.user === undefined
      ? { id: USER_ID, app_role: "caregiver", is_active: true, deleted_at: null }
      : options.user;
  const calls = { update: [] as Record<string, unknown>[], audit: 0 };

  const admin = {
    from: (table: string) => {
      if (table === "staff") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: staff, error: null }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            calls.update.push(patch);
            return {
              eq: () => ({
                eq: () => ({
                  is: async () => ({ data: null, error: options.updateError ?? null }),
                }),
              }),
            };
          },
        };
      }
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: user, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: async () => {
            calls.audit += 1;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { admin, calls };
}

function actor(admin: ReturnType<typeof makeAdmin>["admin"], role = "facility_admin"): AdminApiActor {
  return {
    id: "admin-1",
    organization_id: ORG_ID,
    app_role: role as AdminApiActor["app_role"],
    admin: admin as never,
    client: {} as never,
  };
}

describe("executeStaffOffboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facility.mockResolvedValue({ ok: true });
    mocks.disable.mockResolvedValue({ sync_status: "synchronized" });
  });

  it("revokes Haven access then terminates employment and writes an audit row", async () => {
    const { admin, calls } = makeAdmin({});
    const result = await executeStaffOffboard(actor(admin), STAFF_ID, { reason: "left" }, "key-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.haven_access).toBe("revoked");
      expect(result.access_control_sync).toBe("queued");
    }
    expect(mocks.disable).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ operation: "disable", targetUserId: USER_ID, requestKey: "key-1" }),
    );
    expect(calls.update[0]).toMatchObject({ employment_status: "terminated", termination_reason: "left" });
    expect(calls.audit).toBe(1);
  });

  it("does not change employment when the actor cannot manage the linked login", async () => {
    const { admin, calls } = makeAdmin({
      user: { id: USER_ID, app_role: "owner", is_active: true, deleted_at: null },
    });
    const result = await executeStaffOffboard(actor(admin), STAFF_ID, { reason: "left" }, null);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.disable).not.toHaveBeenCalled();
    expect(calls.update).toHaveLength(0);
  });
});

describe("executeStaffReactivate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facility.mockResolvedValue({ ok: true });
    mocks.expand.mockResolvedValue({ sync_status: "synchronized" });
  });

  it("restores employment and Haven login for an org admin", async () => {
    const { admin, calls } = makeAdmin({
      staff: staffRow({ employment_status: "terminated", termination_date: "2026-09-01" }),
      user: { id: USER_ID, app_role: "caregiver", is_active: false, deleted_at: null },
    });
    const result = await executeStaffReactivate(actor(admin, "org_admin"), STAFF_ID, { reason: "rehired" }, "key-2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.haven_access).toBe("restored");
    expect(calls.update[0]).toMatchObject({ employment_status: "active", termination_date: null });
    expect(mocks.expand).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        operation: "reactivate",
        facilityIds: [FACILITY_ID],
        primaryFacilityId: FACILITY_ID,
      }),
    );
  });

  it("restores employment without Haven login when a facility admin acts", async () => {
    const { admin } = makeAdmin({
      staff: staffRow({ employment_status: "terminated" }),
      user: { id: USER_ID, app_role: "caregiver", is_active: false, deleted_at: null },
    });
    const result = await executeStaffReactivate(actor(admin, "facility_admin"), STAFF_ID, null, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.haven_access).toBe("needs_org_admin");
    expect(mocks.expand).not.toHaveBeenCalled();
  });
});
