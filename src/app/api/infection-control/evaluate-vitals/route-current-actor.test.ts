import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  facilityAccess: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: mocks.facilityAccess,
}));
vi.mock("@/lib/infection-control/evaluate-vitals", () => ({
  evaluateVitalSignAlertsForDailyLog: mocks.evaluate,
}));

import { POST } from "./route";

function adminForLog() {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({
    data: {
      id: "log-1",
      organization_id: "org-1",
      facility_id: "facility-1",
      resident_id: "resident-1",
      logged_by: "different-caregiver",
    },
    error: null,
  }));
  return { from: vi.fn(() => query) };
}

describe("evaluate-vitals fresh ownership authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facilityAccess.mockResolvedValue(true);
  });

  it("does not evaluate after a nurse is demoted to a non-owning caregiver", async () => {
    const admin = adminForLog();
    const initialActor = { id: "actor-1", organizationId: "org-1", appRole: "nurse", admin };
    const demotedActor = { ...initialActor, appRole: "caregiver" };
    mocks.requireActor.mockResolvedValue({ actor: initialActor });
    mocks.revalidateActor.mockResolvedValue({ actor: demotedActor });

    const response = await POST(new Request("https://haven.test/api/infection-control/evaluate-vitals", {
      method: "POST",
      body: JSON.stringify({ dailyLogId: "log-1" }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Not allowed to evaluate vitals for this log" });
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});
