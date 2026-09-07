import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(),
  revalidateOperationsActor: vi.fn(),
  actorCanMutateTask: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { PATCH } from "./route";
import { actorCanMutateTask, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "org",
  facility_id: "facility",
  assigned_to: null,
  assigned_role: null,
  status: "pending",
  due_at: null,
};
const rpc = vi.fn();
const actor = {
  id: "actor",
  organizationId: "org",
  appRole: "manager",
  admin: {
    from: vi.fn(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: task, error: null }),
      };
      return query;
    }),
    rpc,
  },
};

describe("operation task completion error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanMutateTask).mockResolvedValue(true as never);
  });

  it("logs but does not return unexpected RPC schema details", async () => {
    const sentinel = "relation public.operation_task_instances violates constraint private_dual_sign_check";
    rpc.mockResolvedValue({ data: null, error: { message: sentinel, code: "23514" } });

    const response = await PATCH(
      new Request("https://local.test/task", { method: "PATCH", body: "{}" }) as never,
      { params: Promise.resolve({ id: task.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Task could not be completed. Refresh the task and retry." });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith(
      "admin.operations.tasks.complete",
      expect.objectContaining({ message: sentinel }),
      { action: "rpc", taskId: task.id, facilityId: task.facility_id },
    );
  });

  it("preserves an explicit domain conflict from the reviewed command", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Task cannot be completed from this state" } });

    const response = await PATCH(
      new Request("https://local.test/task", { method: "PATCH", body: "{}" }) as never,
      { params: Promise.resolve({ id: task.id }) },
    );

    expect(await response.json()).toEqual({ error: "Task cannot be completed from this state" });
  });

  it("does not call the RPC after an owner is demoted to caregiver with facility access retained", async () => {
    const demotedActor = { ...actor, appRole: "caregiver" };
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: demotedActor } as never);
    vi.mocked(actorCanMutateTask).mockResolvedValue(false as never);

    const response = await PATCH(
      new Request("https://local.test/task", { method: "PATCH", body: "{}" }) as never,
      { params: Promise.resolve({ id: task.id }) },
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(actorCanMutateTask).toHaveBeenLastCalledWith(demotedActor, task);
  });

  it("returns generic not found for a cross-organization task id", async () => {
    const foreignQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    actor.admin.from.mockReturnValueOnce(foreignQuery as never);

    const response = await PATCH(
      new Request("https://local.test/task", { method: "PATCH", body: "{}" }) as never,
      { params: Promise.resolve({ id: "foreign-task" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Task not found" });
    expect(foreignQuery.eq).toHaveBeenCalledWith("organization_id", actor.organizationId);
    expect(rpc).not.toHaveBeenCalled();
  });
});
