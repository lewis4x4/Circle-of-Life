import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  accessibleFacilities: vi.fn(),
  managerRole: vi.fn(),
  revalidate: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/rounding/auth", () => ({
  getRoundingRequestContext: mocks.getContext,
  getAccessibleRoundingFacilityIds: mocks.accessibleFacilities,
  isRoundingManagerRole: mocks.managerRole,
  revalidateRoundingRequestContext: mocks.revalidate,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { POST } from "./route";

function taskQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "is"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({
    data: {
      id: "task-1",
      organization_id: "org-1",
      entity_id: "entity-1",
      facility_id: "facility-1",
      resident_id: "resident-1",
      assigned_staff_id: "staff-1",
      status: "upcoming",
      grace_ends_at: "2026-09-07T12:00:00.000Z",
    },
    error: null,
  }));
  return query;
}

function context(options?: { role?: string; staffId?: string | null }) {
  const query = taskQuery();
  const rpc = vi.fn();
  const actorFrom = vi.fn();
  const value = {
    actor: { client: { from: actorFrom } },
    admin: { from: vi.fn(() => query), rpc },
    userId: "user-1",
    organizationId: "org-1",
    appRole: options?.role ?? "owner",
    currentStaffId: options && "staffId" in options ? options.staffId : "staff-1",
    sessionId: "session-1",
    authClaimVersion: 3,
  };
  return { value, rpc, actorFrom };
}

function request() {
  return new Request("https://haven.test/api/rounding/tasks/task-1/complete", {
    method: "POST",
    body: JSON.stringify({ quickStatus: "awake" }),
  });
}

describe("rounding completion mutation authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessibleFacilities.mockResolvedValue(["facility-1"]);
  });

  it("rejects a manager without their own active facility staff identity before RPC mutation", async () => {
    const initial = context({ role: "owner", staffId: null });
    mocks.getContext.mockResolvedValue({ context: initial.value });
    mocks.revalidate.mockResolvedValue({ context: initial.value });
    mocks.managerRole.mockReturnValue(true);

    const response = await POST(request(), { params: Promise.resolve({ id: "task-1" }) });

    expect(response.status).toBe(422);
    expect(initial.rpc).not.toHaveBeenCalled();
    expect(initial.actorFrom).not.toHaveBeenCalled();
  });

  it("does not perform a follow-on write when locked RPC authority sees a concurrent reassignment", async () => {
    const current = context({ role: "caregiver", staffId: "staff-1" });
    current.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Rounding task assignee changed" },
    });
    mocks.getContext.mockResolvedValue({ context: current.value });
    mocks.revalidate.mockResolvedValue({ context: current.value });
    mocks.managerRole.mockReturnValue(false);

    const response = await POST(request(), { params: Promise.resolve({ id: "task-1" }) });

    expect(response.status).toBe(403);
    expect(current.rpc).toHaveBeenCalledWith("complete_rounding_task_review", expect.objectContaining({
      p_actual_staff_id: "staff-1",
      p_session_id: "session-1",
      p_claim_version: 3,
    }));
    expect(current.actorFrom).not.toHaveBeenCalled();
  });
});
