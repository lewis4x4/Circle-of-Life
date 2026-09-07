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
vi.mock("@/lib/rounding/observation-plan-validation", () => ({
  validateObservationPlanPayload: () => [],
}));

import { POST } from "./route";

function chain(finalResult: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "is", "update"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => finalResult);
  query.single = vi.fn(async () => finalResult);
  query.then = vi.fn((resolve) => resolve(finalResult));
  return query;
}

function body(extra?: Record<string, unknown>) {
  return {
    facilityId: "facility-1",
    residentId: "resident-1",
    status: "active",
    sourceType: "manual",
    effectiveFrom: "2026-09-06T12:00:00.000Z",
    rationale: "Current clinical monitoring requires this exact observation cadence.",
    rules: [{ intervalType: "fixed_minutes", intervalMinutes: 60, graceMinutes: 15 }],
    ...extra,
  };
}

function request(payload: Record<string, unknown>) {
  return new Request("https://haven.test/api/rounding/plans", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

describe("rounding plan current scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facilityAccess.mockResolvedValue(true);
    mocks.accessibleFacilities.mockResolvedValue(["facility-1"]);
    mocks.managerRole.mockReturnValue(true);
  });

  it("makes a foreign or inaccessible plan indistinguishable from an unknown plan", async () => {
    const facilityQuery = chain({ data: { entity_id: "entity-trusted" }, error: null });
    const residentQuery = chain({ data: { id: "resident-1" }, error: null });
    const existingPlanQuery = chain({ data: null, error: null });
    const actor = { client: { from: vi.fn(() => existingPlanQuery) } };
    const context = {
      actor,
      admin: { from: vi.fn((table: string) => table === "facilities" ? facilityQuery : residentQuery) },
      userId: "user-1",
      organizationId: "org-1",
      appRole: "owner",
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    };
    mocks.getContext.mockResolvedValue({ context });
    mocks.revalidate.mockResolvedValue({ context });

    const response = await POST(request(body({ id: "foreign-plan" })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Observation plan not found" });
    expect(existingPlanQuery.eq).toHaveBeenCalledWith("facility_id", "facility-1");
    expect(existingPlanQuery.in).toHaveBeenCalledWith("facility_id", ["facility-1"]);
    expect(existingPlanQuery.update).not.toHaveBeenCalled();
  });

  it("derives plan and rule entity scope only from the validated facility", async () => {
    const facilityQuery = chain({ data: { entity_id: "entity-trusted" }, error: null });
    const residentQuery = chain({ data: { id: "resident-1" }, error: null });
    const createdPlanQuery = chain({ data: { id: "plan-1" }, error: null });
    const rulesQuery = chain({ data: null, error: null });
    const planInsert = vi.fn(() => createdPlanQuery);
    const rulesInsert = vi.fn(() => rulesQuery);
    const actor = {
      client: {
        from: vi.fn((table: string) => table === "resident_observation_plans"
          ? { ...createdPlanQuery, insert: planInsert }
          : { ...rulesQuery, insert: rulesInsert }),
      },
    };
    const context = {
      actor,
      admin: { from: vi.fn((table: string) => table === "facilities" ? facilityQuery : residentQuery) },
      userId: "user-1",
      organizationId: "org-1",
      appRole: "owner",
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    };
    mocks.getContext.mockResolvedValue({ context });
    mocks.revalidate.mockResolvedValue({ context });

    const response = await POST(request(body({ entityId: "entity-attacker" })));

    expect(response.status).toBe(200);
    expect(planInsert).toHaveBeenCalledWith(expect.objectContaining({ entity_id: "entity-trusted" }));
    expect(planInsert).not.toHaveBeenCalledWith(expect.objectContaining({ entity_id: "entity-attacker" }));
    expect(rulesInsert).toHaveBeenCalledWith([
      expect.objectContaining({ entity_id: "entity-trusted" }),
    ]);
  });
});
