import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  provision: vi.fn(),
  ensureAccess: vi.fn(),
  audit: vi.fn(),
  listFacilities: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: mocks.auth,
  actorHasOrgWideFacilityScope: () => true,
  listActorAccessibleFacilityIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/admin/user-create-provision", () => ({
  provisionAuthUserForAdminCreate: mocks.provision,
  UserCreateProvisionError: class extends Error {
    status = 409;
  },
}));
vi.mock("@/lib/admin/ensure-user-facility-access", () => ({
  ensureUserFacilityAccessGrants: mocks.ensureAccess,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  adminGetAuthSnapshotsByIds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/audit/user-management-audit", () => ({
  writeUserAuditEntry: mocks.audit,
}));

import { POST } from "@/app/api/admin/users/route";

const facilityId = "20000000-0000-4000-8000-000000000002";
const admin = {
  from: vi.fn(),
};

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  const terminal = vi.fn().mockResolvedValue(result);
  for (const key of ["select", "eq", "in", "is", "maybeSingle", "insert", "single"]) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  builder.maybeSingle = terminal;
  builder.single = terminal;
  builder.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    actor: {
      id: "admin-1",
      organization_id: "org-1",
      app_role: "org_admin",
      admin,
    },
  });
  mocks.provision.mockResolvedValue({
    userId: "auth-1",
    invitation_sent: false,
    provision_method: "temporary_password",
    temporary_password: "OnceOnly!",
  });
  mocks.ensureAccess.mockResolvedValue({ error: null });
  mocks.audit.mockResolvedValue(undefined);

  admin.from.mockImplementation((table: string) => {
    if (table === "user_profiles") {
      return chain({ data: null, error: null });
    }
    if (table === "facilities") {
      return chain({ data: [{ id: facilityId }], error: null });
    }
    if (table === "user_profiles" && false) {
      return chain({});
    }
    return chain({
      data: { id: "auth-1", email: "new@example.test" },
      error: null,
    });
  });
});

describe("POST /api/admin/users", () => {
  it("returns 409 when profile email already exists", async () => {
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        const first = chain({ data: { id: "existing" }, error: null });
        return first;
      }
      return chain({ data: [], error: null });
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "taken@example.test",
          full_name: "Taken User",
          app_role: "caregiver",
          send_invite: true,
          facilities: [{ facility_id: facilityId, is_primary: true }],
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("profile_email_exists");
  });

  it("reports partial failure when facility grants fail after profile insert", async () => {
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        const builder = chain({ data: null, error: null });
        builder.single = vi.fn().mockResolvedValue({
          data: { id: "auth-1", email: "new@example.test" },
          error: null,
        });
        return builder;
      }
      if (table === "facilities") {
        const builder = chain({ data: [{ id: facilityId }], error: null });
        builder.single = vi.fn().mockResolvedValue({ data: [{ id: facilityId }], error: null });
        return builder;
      }
      return chain({ data: null, error: null });
    });
    mocks.ensureAccess.mockResolvedValue({ error: "duplicate key value" });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.test",
          full_name: "New User",
          app_role: "caregiver",
          send_invite: true,
          facilities: [{ facility_id: facilityId, is_primary: true }],
        }),
      }),
    );
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.profile_created).toBe(true);
    expect(json.user_id).toBe("auth-1");
  });
});
