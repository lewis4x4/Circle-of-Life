import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  canMutate: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: mocks.requireActor,
  revalidateOperationsActor: mocks.revalidateActor,
  actorCanMutateTask: mocks.canMutate,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { PATCH } from "./route";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "org-1",
  facility_id: "facility-1",
  assigned_to: null,
  assigned_role: null,
  status: "pending",
};
const rpc = vi.fn();
const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
const admin = { from: vi.fn(() => query), rpc };
const actor = { id: "actor-1", organizationId: "org-1", appRole: "owner", currentActor: { client: admin }, admin: { from: vi.fn(() => { throw new Error("Service reads forbidden"); }), rpc: vi.fn(() => { throw new Error("Service command forbidden"); }) } };

function request(reason = "Coverage gap") {
  return new Request("https://haven.test/api/admin/operations/tasks/task/defer", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deferred_until: new Date(Date.now() + 86_400_000).toISOString(),
      cancellation_reason: reason,
    }),
  });
}

describe("operation task atomic defer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.maybeSingle.mockResolvedValue({ data: task, error: null });
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.canMutate.mockResolvedValue(true);
    rpc.mockResolvedValue({ data: { new_task_id: "replacement-1", replayed: false }, error: null });
  });

  it("uses one RPC and no direct service-role insert/update", async () => {
    const response = await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, new_task_id: "replacement-1" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("defer_operation_task_review", expect.objectContaining({
      p_task_id: task.id,
      p_actor_id: actor.id,
      p_actor_role: "owner",
      p_request_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("does not call the RPC after refreshed mutation scope is lost", async () => {
    const demotedActor = { ...actor, appRole: "caregiver" };
    mocks.revalidateActor.mockResolvedValue({ actor: demotedActor });
    mocks.canMutate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns stable keys across lost-response retries", async () => {
    await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });
    await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });

    const first = rpc.mock.calls[0]?.[1] as { p_request_key: string };
    const second = rpc.mock.calls[1]?.[1] as { p_request_key: string };
    expect(first.p_request_key).toBe(second.p_request_key);
  });

  it("sanitizes unexpected RPC errors", async () => {
    const sentinel = "private operation_task_instances constraint leaked";
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: sentinel } });

    const response = await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to defer task" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(mocks.logError).toHaveBeenCalledWith(
      "admin.operations.tasks.defer",
      expect.objectContaining({ message: sentinel }),
      { action: "rpc", taskId: task.id, facilityId: task.facility_id },
    );
  });

  it("tells the operator that a managed occurrence cannot be deferred by the legacy command", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Managed occurrences cannot be deferred by the legacy command" } });

    const response = await PATCH(request() as never, { params: Promise.resolve({ id: task.id }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Managed occurrences cannot be deferred by the legacy command" });
  });

  it("hides cross-organization task identifiers before RPC", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await PATCH(request() as never, { params: Promise.resolve({ id: "foreign-task" }) });

    expect(response.status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("organization_id", actor.organizationId);
    expect(rpc).not.toHaveBeenCalled();
  });
});
