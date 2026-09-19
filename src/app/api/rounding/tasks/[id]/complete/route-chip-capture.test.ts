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

function context() {
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
      status: "due_now",
      grace_ends_at: "2026-09-07T12:00:00.000Z",
    },
    error: null,
  }));
  const rpc = vi.fn();
  return {
    rpc,
    value: {
      actor: { client: { from: vi.fn() } },
      admin: { from: vi.fn(() => query), rpc },
      userId: "user-1",
      organizationId: "org-1",
      appRole: "caregiver",
      currentStaffId: "staff-1",
      sessionId: "session-1",
      authClaimVersion: 3,
    },
  };
}

function request(payload: Record<string, unknown>) {
  return new Request("https://haven.test/api/rounding/tasks/task-1/complete", {
    method: "POST",
    body: JSON.stringify({
      quickStatus: "awake",
      requestId: "6ad67702-0ab3-49f6-86d6-f93c55b1f93c",
      observedAt: "2026-09-07T12:00:00.000Z",
      residentLocation: "dining_room",
      residentState: "eating_meal",
      ...payload,
    }),
  });
}

function install() {
  const current = context();
  mocks.getContext.mockResolvedValue({ context: current.value });
  mocks.revalidate.mockResolvedValue({ context: current.value });
  mocks.managerRole.mockReturnValue(false);
  return current;
}

describe("chip capture routes through the composing command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessibleFacilities.mockResolvedValue(["facility-1"]);
  });

  it("records with chips and an empty note", async () => {
    const current = install();
    current.rpc.mockResolvedValue({ data: { log_id: "log-1", status: "completed_on_time" }, error: null });

    const response = await POST(
      request({ chipSelections: { meal_intake: ["ate_well"], mood_state: ["pleasant"] }, note: "" }),
      { params: Promise.resolve({ id: "task-1" }) },
    );

    expect(response.status).toBe(200);
    expect(current.rpc).toHaveBeenCalledWith("submit_observation", expect.objectContaining({
      p_task_id: "task-1",
      p_chip_selections: { meal_intake: ["ate_well"], mood_state: ["pleasant"] },
      p_resident_location: "dining_room",
      p_resident_state: "eating_meal",
      p_quick_status: "awake",
      p_note: "",
      p_actor_id: "user-1",
      p_actor_role: "caregiver",
      p_session_id: "session-1",
      p_claim_version: 3,
    }));
  });

  it("leaves a chip-less completion on the existing command", async () => {
    const current = install();
    current.rpc.mockResolvedValue({ data: { log_id: "log-1", status: "completed_on_time" }, error: null });

    await POST(request({}), { params: Promise.resolve({ id: "task-1" }) });

    expect(current.rpc.mock.calls[0][0]).toBe("complete_rounding_task_review");
  });

  it("sends an unrecognized chip code through rather than dropping it, and surfaces the refusal", async () => {
    const current = install();
    current.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "The observation chip not_a_real_code is not available at this facility" },
    });

    const response = await POST(
      request({ chipSelections: { meal_intake: ["ate_well", "not_a_real_code"] } }),
      { params: Promise.resolve({ id: "task-1" }) },
    );

    expect(current.rpc.mock.calls[0][1].p_chip_selections)
      .toEqual({ meal_intake: ["ate_well", "not_a_real_code"] });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Tap at least one meal, mood or medication chip");
    expect(body.error).not.toContain("not_a_real_code");
  });

  it.each([[[]], ["meal_intake"], [{ meal_intake: "ate_well" }], [{ meal_intake: [1] }]])(
    "refuses a malformed chip map %j before any write",
    async (chipSelections) => {
      const current = install();
      const response = await POST(request({ chipSelections }), { params: Promise.resolve({ id: "task-1" }) });
      expect(response.status).toBe(400);
      expect(current.rpc).not.toHaveBeenCalled();
    },
  );
});
