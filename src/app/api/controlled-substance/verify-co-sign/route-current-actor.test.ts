import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  facilityAccess: vi.fn(),
  verifyWitness: vi.fn(),
}));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: mocks.facilityAccess,
}));
vi.mock("@/lib/supabase/witness-auth", () => ({
  verifyWitnessCredentials: mocks.verifyWitness,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { POST } from "./route";

function request() {
  return new Request("https://haven.test/api/controlled-substance/verify-co-sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      countId: "count-1",
      email: "witness@example.test",
      password: "secret",
      facilityId: "facility-1",
    }),
  });
}

function countAdmin() {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "is"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data: [{
        id: "count-1",
        facility_id: "facility-1",
        organization_id: "org-1",
        outgoing_staff_id: "outgoing-1",
        incoming_staff_id: null,
      }],
      error: null,
    }).then(resolve);
  return { from: vi.fn(() => query) };
}

describe("controlled-substance current actor gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue({
      actor: {
        id: "outgoing-1",
        organizationId: "org-1",
        appRole: "nurse",
        admin: {},
      },
    });
    mocks.revalidateActor.mockImplementation(async (actor) => ({ actor }));
  });

  it("does not verify witness credentials when the current actor is denied", async () => {
    mocks.requireActor.mockResolvedValue({
      response: Response.json({ error: "Sign in again to continue." }, { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.facilityAccess).not.toHaveBeenCalled();
    expect(mocks.verifyWitness).not.toHaveBeenCalled();
  });

  it("does not invoke the witness provider when current facility access is denied", async () => {
    mocks.facilityAccess.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.verifyWitness).not.toHaveBeenCalled();
  });

  it("does not invoke the witness provider when the actor is disabled after the first check", async () => {
    const admin = countAdmin();
    mocks.requireActor.mockResolvedValue({
      actor: { id: "outgoing-1", organizationId: "org-1", appRole: "nurse", admin },
    });
    mocks.facilityAccess.mockResolvedValue(true);
    mocks.revalidateActor.mockResolvedValue({
      response: Response.json({ error: "Sign in again to continue." }, { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.facilityAccess).toHaveBeenCalledTimes(1);
    expect(mocks.verifyWitness).not.toHaveBeenCalled();
  });

  it("does not invoke the witness provider when facility access is revoked after revalidation", async () => {
    const admin = countAdmin();
    const actor = { id: "outgoing-1", organizationId: "org-1", appRole: "nurse", admin };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.facilityAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.verifyWitness).not.toHaveBeenCalled();
  });
});
