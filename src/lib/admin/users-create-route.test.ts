import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  provision: vi.fn(),
  ensureAccess: vi.fn(),
  rollbackAccess: vi.fn(),
  audit: vi.fn(),
  hardDelete: vi.fn(),
  logError: vi.fn(),
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
  rollbackUserFacilityAccessGrants: mocks.rollbackAccess,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  adminGetAuthSnapshotsByIds: vi.fn().mockResolvedValue({}),
  adminHardDeleteUser: mocks.hardDelete,
}));
vi.mock("@/lib/audit/user-management-audit", () => ({
  writeUserAuditEntry: mocks.audit,
}));
vi.mock("@/lib/observability/logger", () => ({
  logError: mocks.logError,
}));

import { POST } from "@/app/api/admin/users/route";

const facilityId = "20000000-0000-4000-8000-000000000002";

/** Records every delete() issued so tests can assert what rollback removed. */
const profileDeletes: string[] = [];
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

/** user_profiles builder that succeeds on insert and records deletes. */
function profileTable(insertResult: unknown, deleteError: { message: string } | null = null) {
  const builder = chain({ data: null, error: null });
  builder.single = vi.fn().mockResolvedValue(insertResult);
  builder.delete = vi.fn().mockReturnValue({
    eq: vi.fn((_col: string, value: string) => {
      profileDeletes.push(value);
      return Promise.resolve({ error: deleteError });
    }),
  });
  return builder;
}

function createRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: "new@example.test",
      full_name: "New User",
      app_role: "caregiver",
      send_invite: true,
      facilities: [{ facility_id: facilityId, is_primary: true }],
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  profileDeletes.length = 0;
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
    auth_user_created: true,
  });
  mocks.ensureAccess.mockResolvedValue({ error: null, applied: [] });
  mocks.rollbackAccess.mockResolvedValue({ error: null });
  mocks.audit.mockResolvedValue(undefined);
  mocks.hardDelete.mockResolvedValue(undefined);

  admin.from.mockImplementation((table: string) => {
    if (table === "user_profiles") {
      return chain({ data: null, error: null });
    }
    if (table === "facilities") {
      return chain({ data: [{ id: facilityId }], error: null });
    }
    return chain({ data: { id: "auth-1", email: "new@example.test" }, error: null });
  });
});

describe("POST /api/admin/users", () => {
  it("returns 409 when profile email already exists", async () => {
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chain({ data: { id: "existing" }, error: null });
      }
      return chain({ data: [], error: null });
    });

    const response = await POST(createRequest({ email: "taken@example.test" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("profile_email_exists");
  });

  it("rejects the same facility listed twice before any write", async () => {
    const response = await POST(
      createRequest({
        facilities: [
          { facility_id: facilityId, is_primary: true },
          { facility_id: facilityId, is_primary: false },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rolls back the profile, grants, and Auth user when grants fail", async () => {
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        // First call is the email-uniqueness check; second is the insert/delete.
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: { id: "auth-1" }, error: null });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });
    mocks.ensureAccess.mockResolvedValue({
      error: "duplicate key value",
      applied: [{ facility_id: facilityId, row_id: "row-1", outcome: "inserted", previous: null }],
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.rollback).toBe("complete");
    // Nothing half-created is advertised back to the caller.
    expect(json.profile_created).toBeUndefined();
    expect(json.user_id).toBeUndefined();

    // Grants written by this request are undone, the profile row is deleted, and the
    // Auth user this request created is removed.
    expect(mocks.rollbackAccess).toHaveBeenCalledWith(admin, [
      { facility_id: facilityId, row_id: "row-1", outcome: "inserted", previous: null },
    ]);
    expect(profileDeletes).toEqual(["auth-1"]);
    expect(mocks.hardDelete).toHaveBeenCalledWith("auth-1");
  });

  it("rolls back the profile but keeps a pre-existing Auth user", async () => {
    // Charlene's shape: the Auth user predates the request, so cleanup must not touch it.
    mocks.provision.mockResolvedValue({
      userId: "orphan-auth",
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password: "RecoveryPass!",
      auth_user_created: false,
    });
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: { id: "orphan-auth" }, error: null });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });
    mocks.ensureAccess.mockResolvedValue({ error: "grant exploded", applied: [] });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect((await response.json()).rollback).toBe("complete");
    expect(profileDeletes).toEqual(["orphan-auth"]);
    expect(mocks.hardDelete).not.toHaveBeenCalled();
  });

  it("deletes an Auth user it created when the profile insert fails", async () => {
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: null, error: { message: "insert blew up" } });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect((await response.json()).rollback).toBe("complete");
    expect(mocks.hardDelete).toHaveBeenCalledWith("auth-1");
    // No grants were attempted, so nothing grant-shaped is rolled back.
    expect(mocks.rollbackAccess).toHaveBeenCalledWith(admin, []);
  });

  it("does not delete a pre-existing Auth user when the profile insert fails", async () => {
    mocks.provision.mockResolvedValue({
      userId: "orphan-auth",
      invitation_sent: false,
      provision_method: "temporary_password",
      temporary_password: "RecoveryPass!",
      auth_user_created: false,
    });
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: null, error: { message: "insert blew up" } });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(mocks.hardDelete).not.toHaveBeenCalled();
  });

  it("reports a partial rollback when cleanup itself fails", async () => {
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: { id: "auth-1" }, error: null }, { message: "delete denied" });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });
    mocks.ensureAccess.mockResolvedValue({ error: "grant exploded", applied: [] });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.rollback).toBe("partial");
    // The operator gets the id back only when there is genuinely residue to clean up.
    expect(json.user_id).toBe("auth-1");
    expect(mocks.logError).toHaveBeenCalledWith(
      "admin.users.create_rollback_incomplete",
      expect.any(Error),
      expect.objectContaining({ residue: expect.arrayContaining([expect.stringContaining("user profile")]) }),
    );
  });

  it("does not leak the temporary password into the failure response", async () => {
    let profileLookups = 0;
    admin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        profileLookups += 1;
        if (profileLookups === 1) return chain({ data: null, error: null });
        return profileTable({ data: { id: "auth-1" }, error: null });
      }
      if (table === "facilities") return chain({ data: [{ id: facilityId }], error: null });
      return chain({ data: null, error: null });
    });
    mocks.ensureAccess.mockResolvedValue({ error: "grant exploded", applied: [] });

    const response = await POST(createRequest());
    const raw = JSON.stringify(await response.json());

    expect(raw).not.toContain("OnceOnly!");
  });
});
