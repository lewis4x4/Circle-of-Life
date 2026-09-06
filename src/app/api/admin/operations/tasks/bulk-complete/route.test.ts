import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(),
  actorCanMutateTask: vi.fn(),
}));

import { POST } from "./route";
import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";

const actor = {
  id: "00000000-0000-0000-0000-000000000001",
  appRole: "owner",
  admin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
};

describe("/api/admin/operations/tasks/bulk-complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  });

  it.each([["completed", 1, 0], ["awaiting_verification", 0, 1]] as const)("filters authorized tasks and reports %s separately", async (outcome, completedCount, awaitingCount) => {
    const loadedTasks = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        organization_id: "org-1",
        facility_id: "fac-1",
        assigned_to: null,
        status: "pending",
        due_at: null,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        organization_id: "org-1",
        facility_id: "fac-1",
        assigned_to: null,
        status: "pending",
        due_at: null,
      },
    ];

    const queryChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: loadedTasks, error: null }),
      update: vi.fn(),
      insert: vi.fn(),
    };

    actor.admin.from.mockReturnValue(queryChain as never);
    vi.mocked(actorCanMutateTask)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    actor.admin.rpc.mockResolvedValue({ data: [{ task_instance_id: loadedTasks[0].id, outcome }], error: null });

    const request = new Request("http://localhost/api/admin/operations/tasks/bulk-complete", {
      method: "POST",
      body: JSON.stringify({ task_ids: loadedTasks.map((task) => task.id), completion_notes: "" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(actor.admin.rpc).toHaveBeenCalledWith(
      "bulk_complete_operation_tasks",
      expect.objectContaining({ p_task_ids: [loadedTasks[0].id], p_completion_notes: null }),
    );
    expect(payload).toEqual({
      success: true,
      completed_count: completedCount,
      awaiting_verification_count: awaitingCount,
      requested_count: 2,
    });
    expect(queryChain.update).not.toHaveBeenCalled();
    expect(queryChain.insert).not.toHaveBeenCalled();
  });

  it("returns 403 when loaded tasks are not authorized", async () => {
    const loadedTask = {
      id: "11111111-1111-1111-1111-111111111111",
      organization_id: "org-1",
      facility_id: "fac-1",
      assigned_to: null,
      status: "pending",
      due_at: null,
    };

    const queryChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [loadedTask], error: null }),
      update: vi.fn(),
      insert: vi.fn(),
    };

    actor.admin.from.mockReturnValue(queryChain as never);
    vi.mocked(actorCanMutateTask).mockResolvedValue(false as never);

    const request = new Request("http://localhost/api/admin/operations/tasks/bulk-complete", {
      method: "POST",
      body: JSON.stringify({ task_ids: [loadedTask.id] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "No authorized tasks to update" });
    expect(actor.admin.rpc).not.toHaveBeenCalled();
    expect(queryChain.update).not.toHaveBeenCalled();
    expect(queryChain.insert).not.toHaveBeenCalled();
  });

  it("returns 500 when RPC completion fails", async () => {
    const loadedTask = {
      id: "11111111-1111-1111-1111-111111111111",
      organization_id: "org-1",
      facility_id: "fac-1",
      assigned_to: null,
      status: "pending",
      due_at: null,
    };

    const queryChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [loadedTask], error: null }),
      update: vi.fn(),
      insert: vi.fn(),
    };

    actor.admin.from.mockReturnValue(queryChain as never);
    vi.mocked(actorCanMutateTask).mockResolvedValue(true as never);
    actor.admin.rpc.mockResolvedValue({ data: null, error: { message: "audit failed" } });

    const request = new Request("http://localhost/api/admin/operations/tasks/bulk-complete", {
      method: "POST",
      body: JSON.stringify({ task_ids: [loadedTask.id] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).not.toBe(true);
    expect(payload.error).toBe("Failed to complete tasks");
    expect(queryChain.update).not.toHaveBeenCalled();
    expect(queryChain.insert).not.toHaveBeenCalled();
  });
});
