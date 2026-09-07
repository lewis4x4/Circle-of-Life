import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  facilityAccess: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: mocks.facilityAccess,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import {
  getAccessibleRoundingFacilityIds,
  getRoundingRequestContext,
  revalidateRoundingRequestContext,
} from "./auth";

function queryResult(data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "in"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data, error: null }));
  query.then = vi.fn((resolve) => resolve({ data, error: null }));
  return query;
}

function actor(options?: { appRole?: string; staffId?: string | null }) {
  const staffQuery = queryResult({ id: options?.staffId ?? "staff-1" });
  const facilitiesQuery = queryResult([{ id: "facility-1" }, { id: "facility-2" }]);
  const grantsQuery = queryResult([{ facility_id: "facility-2" }]);
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "staff") return staffQuery;
      if (table === "facilities") return facilitiesQuery;
      if (table === "user_facility_access") return grantsQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  return {
    value: {
      id: "user-1",
      organizationId: "org-1",
      appRole: options?.appRole ?? "nurse",
      admin,
      client: {
        auth: {
          getClaims: vi.fn(async () => ({
            data: {
              claims: {
                sub: "user-1",
                session_id: "session-1",
                auth_claim_version: 3,
              },
            },
            error: null,
          })),
        },
      },
      email: null,
      fullName: null,
      sessionEmail: null,
    },
    staffQuery,
    facilitiesQuery,
    grantsQuery,
  };
}

describe("rounding current authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facilityAccess.mockResolvedValue(true);
  });

  it("forwards denied session/version/profile authority without any service read", async () => {
    const response = Response.json({ error: "Sign in again to continue." }, { status: 401 });
    mocks.requireActor.mockResolvedValue({ response });

    const result = await getRoundingRequestContext();

    expect("response" in result && result.response.status).toBe(401);
  });

  it("uses the current actor and only an active, nondeleted staff row in its organization", async () => {
    const current = actor();
    mocks.requireActor.mockResolvedValue({ actor: current.value });

    const result = await getRoundingRequestContext();

    expect("context" in result && result.context).toMatchObject({
      userId: "user-1",
      organizationId: "org-1",
      appRole: "nurse",
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    });
    expect(current.staffQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(current.staffQuery.eq).toHaveBeenCalledWith("employment_status", "active");
    expect(current.staffQuery.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("fails closed before service reads when verified claims lack a current session id", async () => {
    const current = actor();
    current.value.client.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", auth_claim_version: 3 } },
      error: null,
    });
    mocks.requireActor.mockResolvedValue({ actor: current.value });

    const result = await getRoundingRequestContext();

    expect("response" in result && result.response.status).toBe(401);
    expect(current.value.admin.from).not.toHaveBeenCalled();
  });

  it("denies an owner demoted before a manager mutation without checking a stale facility grant", async () => {
    const current = actor({ appRole: "owner" });
    const response = Response.json({ error: "Insufficient permissions" }, { status: 403 });
    mocks.revalidateActor.mockResolvedValue({ response });

    const result = await revalidateRoundingRequestContext(
      {
        actor: current.value as never,
        admin: current.value.admin as never,
        userId: "user-1",
        organizationId: "org-1",
        appRole: "owner",
        currentStaffId: "staff-1",
        sessionId: "session-1",
        authClaimVersion: 3,
      },
      { managerOnly: true, facilityId: "facility-1" },
    );

    expect("response" in result && result.response.status).toBe(403);
    expect(mocks.revalidateActor).toHaveBeenCalledWith(current.value, expect.objectContaining({
      allowedRoles: ["owner", "org_admin", "facility_admin", "nurse"],
    }));
    expect(mocks.facilityAccess).not.toHaveBeenCalled();
  });

  it("denies a facility revoke after successful session/profile revalidation", async () => {
    const current = actor();
    mocks.revalidateActor.mockResolvedValue({ actor: current.value });
    mocks.facilityAccess.mockResolvedValue(false);

    const result = await revalidateRoundingRequestContext(
      {
        actor: current.value as never,
        admin: current.value.admin as never,
        userId: "user-1",
        organizationId: "org-1",
        appRole: "nurse",
        currentStaffId: "staff-1",
        sessionId: "session-1",
        authClaimVersion: 3,
      },
      { managerOnly: true, facilityId: "facility-1" },
    );

    expect("response" in result && result.response.status).toBe(403);
    expect(current.staffQuery.eq).toHaveBeenCalledWith("facility_id", "facility-1");
  });

  it("returns only live organization facilities with a current nonrevoked grant", async () => {
    const current = actor({ appRole: "caregiver" });
    const context = {
      actor: current.value as never,
      admin: current.value.admin as never,
      userId: "user-1",
      organizationId: "org-1",
      appRole: "caregiver" as const,
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    };

    await expect(getAccessibleRoundingFacilityIds(context)).resolves.toEqual(["facility-2"]);
    expect(current.facilitiesQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(current.facilitiesQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(current.grantsQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(current.grantsQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(current.grantsQuery.is).toHaveBeenCalledWith("revoked_at", null);
    expect(current.grantsQuery.in).toHaveBeenCalledWith("facility_id", ["facility-1", "facility-2"]);
  });
});
