import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  accessibleFacilities: vi.fn(),
  facilityAccess: vi.fn(),
  managerRole: vi.fn(),
  revalidate: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/rounding/auth", () => ({
  getRoundingRequestContext: mocks.getContext,
  getAccessibleRoundingFacilityIds: mocks.accessibleFacilities,
  assertRoundingFacilityAccess: mocks.facilityAccess,
  isRoundingManagerRole: mocks.managerRole,
  revalidateRoundingRequestContext: mocks.revalidate,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { PATCH } from "./route";

function adminForEscalation(row: Record<string, unknown> | null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "is"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  query.update = vi.fn(() => query);
  query.then = vi.fn((resolve) => resolve({ data: null, error: null }));
  return { admin: { from: vi.fn(() => query) }, query };
}

describe("rounding escalation current authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessibleFacilities.mockResolvedValue(["facility-1"]);
    mocks.facilityAccess.mockResolvedValue(true);
    mocks.managerRole.mockReturnValue(true);
  });

  it("does not mutate after an owner is demoted before the write", async () => {
    const { admin, query } = adminForEscalation({
      id: "escalation-1",
      organization_id: "org-1",
      facility_id: "facility-1",
      status: "open",
    });
    const context = {
      admin,
      userId: "user-1",
      organizationId: "org-1",
      appRole: "owner",
      currentStaffId: "staff-1",
    };
    mocks.getContext.mockResolvedValue({ context });
    mocks.revalidate.mockResolvedValue({
      response: Response.json({ error: "Insufficient permissions" }, { status: 403 }),
    });

    const response = await PATCH(
      new Request("https://haven.test/api/rounding/escalations/escalation-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "start_review" }),
      }),
      { params: Promise.resolve({ id: "escalation-1" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.revalidate).toHaveBeenCalledWith(context, {
      managerOnly: true,
      facilityId: "facility-1",
    });
    expect(query.update).not.toHaveBeenCalled();
  });

  it("returns the same not-found result for an ID outside current facility scope", async () => {
    const { admin, query } = adminForEscalation(null);
    mocks.getContext.mockResolvedValue({
      context: {
        admin,
        userId: "user-1",
        organizationId: "org-1",
        appRole: "owner",
        currentStaffId: "staff-1",
      },
    });

    const response = await PATCH(
      new Request("https://haven.test/api/rounding/escalations/foreign", {
        method: "PATCH",
        body: JSON.stringify({ action: "start_review" }),
      }),
      { params: Promise.resolve({ id: "foreign" }) },
    );

    expect(response.status).toBe(404);
    expect(query.in).toHaveBeenCalledWith("facility_id", ["facility-1"]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });

  it("lets current RLS reject a revoke after revalidation without a service-role mutation", async () => {
    const { admin } = adminForEscalation({
      id: "escalation-1",
      organization_id: "org-1",
      facility_id: "facility-1",
      status: "open",
    });
    const mutationQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["update", "eq"]) mutationQuery[method] = vi.fn(() => mutationQuery);
    mutationQuery.then = vi.fn((resolve) => resolve({
      data: null,
      error: { code: "HAVEN_AUTHORIZATION_STALE", message: "authorization revoked" },
    }));
    const actorFrom = vi.fn(() => mutationQuery);
    const context = {
      actor: { client: { from: actorFrom } },
      admin,
      userId: "user-1",
      organizationId: "org-1",
      appRole: "owner",
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    };
    mocks.getContext.mockResolvedValue({ context });
    mocks.revalidate.mockResolvedValue({ context });

    const response = await PATCH(
      new Request("https://haven.test/api/rounding/escalations/escalation-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "start_review" }),
      }),
      { params: Promise.resolve({ id: "escalation-1" }) },
    );

    expect(response.status).toBe(500);
    expect(actorFrom).toHaveBeenCalledWith("resident_observation_escalations");
    expect(admin.from).toHaveBeenCalledTimes(1);
  });
});
