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

function taskQuery(status = "upcoming") {
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
      status,
      grace_ends_at: "2026-09-07T12:00:00.000Z",
    },
    error: null,
  }));
  return query;
}

function context(options?: { role?: string; staffId?: string | null; status?: string }) {
  const query = taskQuery(options?.status);
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

function request(payload: Record<string, unknown> = {}) {
  return new Request("https://haven.test/api/rounding/tasks/task-1/complete", {
    method: "POST",
    body: JSON.stringify({ quickStatus: "awake", requestId: "6ad67702-0ab3-49f6-86d6-f93c55b1f93c", observedAt: "2026-09-07T12:00:00.000Z", ...payload }),
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


describe("completion receipt HTTP contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.accessibleFacilities.mockResolvedValue(["facility-1"]); });
  function install(status = "upcoming") {
    const current = context({ role: "caregiver", status });
    mocks.getContext.mockResolvedValue({ context: current.value });
    mocks.revalidate.mockResolvedValue({ context: current.value });
    return current;
  }
  it("returns a committed receipt despite terminal status and later retry time", async () => {
    const current = install("completed_on_time");
    current.rpc.mockResolvedValue({ data: { log_id: "original-log", status: "completed_on_time", integrityFlagCreated: true, suspiciousPatternFlagCreated: true, replayed: true }, error: null });
    const response = await POST(request(), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ logId: "original-log", replayed: true, integrityFlagCreated: true, suspiciousPatternFlagCreated: true });
    expect(current.actorFrom).not.toHaveBeenCalled();
    expect(current.rpc.mock.calls[0][1].p_payload).toMatchObject({ request_id: "6ad67702-0ab3-49f6-86d6-f93c55b1f93c", observed_at: "2026-09-07T12:00:00.000Z" });
    expect(current.rpc.mock.calls[0][1].p_payload).not.toHaveProperty("entered_at");
  });
  it.each([["23505",409],["P0001",409],["42501",403],["P0002",404],["22023",400],["XX000",500]])("maps %s without any follow-on mutation", async (code, status) => {
    const current = install();
    current.rpc.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request(), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(status);
    expect(current.actorFrom).not.toHaveBeenCalled();
  });
  it("binds old outbox queue IDs to receipts and retains original late reason", async () => {
    const current = install();
    current.rpc.mockResolvedValue({ data: { log_id: "log", status: "completed_late" }, error: null });
    const response = await POST(request({ requestId: undefined, lateReason: "Original reason", offline: { queueId: "338b2cb1-fbef-4d9b-8855-c766c42c937e", ownerUserId: "user-1", organizationId: "org-1", facilityId: "facility-1" } }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(current.rpc.mock.calls[0][1].p_payload).toMatchObject({ request_id: "338b2cb1-fbef-4d9b-8855-c766c42c937e", offline: true, late_reason: "Original reason" });
  });
  it("denies a revoked actor before receipt retrieval", async () => {
    const current = install("completed_on_time");
    mocks.revalidate.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await POST(request(), { params: Promise.resolve({ id: "task-1" }) })).status).toBe(403);
    expect(current.rpc).not.toHaveBeenCalled();
  });
  const retryOwner = { userId: "user-1", sessionId: "session-1", organizationId: "org-1", facilityId: "facility-1" };
  it.each(["userId", "sessionId", "organizationId", "facilityId"])("rejects a retry with changed original %s before mutation", async (field) => {
    const current = install();
    const response = await POST(request({ retryOwner: { ...retryOwner, [field]: "different" } }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(field === "facilityId" ? 409 : 403);
    expect(current.rpc).not.toHaveBeenCalled();
  });
  it.each(["userId", "sessionId", "organizationId"])("rechecks retry %s after authority revalidation", async (field) => {
    const current = install();
    mocks.revalidate.mockResolvedValue({ context: { ...current.value, [field]: "changed-during-request" } });
    const response = await POST(request({ retryOwner }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(403);
    expect(current.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, "invalid", { ...retryOwner, sessionId: null }])("rejects malformed retry owner %j", async (owner) => {
    const current = install();
    const response = await POST(request({ retryOwner: owner }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(400);
    expect(current.rpc).not.toHaveBeenCalled();
  });
  it("accepts the original retry owner and preserves the clinical command", async () => {
    const current = install();
    current.rpc.mockResolvedValue({ data: { log_id: "original-log", replayed: true }, error: null });
    const response = await POST(request({ retryOwner, quickStatus: "distressed", note: "Synthetic original note" }), { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(current.rpc.mock.calls[0][1].p_payload).toMatchObject({ quick_status: "distressed", note: "Synthetic original note" });
    expect(current.rpc.mock.calls[0][1].p_payload).not.toHaveProperty("retryOwner");
  });
  it.each([{ requestId: undefined }, { observedAt: undefined }, { interventionCodes: [false] }, { distressPresent: "false" }])("rejects incomplete or mistyped command input %j", async (payload) => {
    const current = install();
    expect((await POST(request(payload), { params: Promise.resolve({ id: "task-1" }) })).status).toBe(400);
    expect(current.rpc).not.toHaveBeenCalled();
  });
});
