import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";
import { logError } from "@/lib/observability/logger";

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  status: string;
  due_at: string | null;
};

export async function POST(request: NextRequest) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;

  let body: { task_ids?: string[]; completion_notes?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!Array.isArray(body.task_ids) || body.task_ids.length === 0) {
    return NextResponse.json({ error: "task_ids array is required" }, { status: 400 });
  }

  const { data, error } = await actor.admin
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, assigned_to, status, due_at")
    .in("id", body.task_ids)
    .is("deleted_at", null);

  const tasks = (data ?? []) as unknown as TaskRow[];
  if (error) {
    logError("admin.operations.tasks.bulk-complete", error, {
      action: "query",
      taskIdCount: body.task_ids.length,
    });
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  const updatableTasks: TaskRow[] = [];
  for (const task of tasks) {
    if (await actorCanMutateTask(actor, task)) {
      updatableTasks.push(task);
    }
  }

  if (tasks.length === 0) {
    return NextResponse.json({ error: "No tasks to update" }, { status: 400 });
  }

  if (updatableTasks.length === 0) {
    return NextResponse.json({ error: "No authorized tasks to update" }, { status: 403 });
  }

  const completedAt = new Date().toISOString();
  const { data: completedRows, error: rpcError } = await actor.admin.rpc(
    "bulk_complete_operation_tasks" as never,
    {
      p_task_ids: updatableTasks.map((task) => task.id),
      p_actor_id: actor.id,
      p_actor_role: actor.appRole,
      p_completion_notes: body.completion_notes || null,
      p_completed_at: completedAt,
    } as never,
  );

  if (rpcError) {
    logError("admin.operations.tasks.bulk-complete", rpcError, {
      action: "rpc",
      taskCount: updatableTasks.length,
    });
    return NextResponse.json({ error: "Failed to complete tasks" }, { status: 500 });
  }

  const completedCount = Array.isArray(completedRows)
    ? (completedRows as Array<{ task_instance_id: string }>).length
    : 0;

  return NextResponse.json({
    success: true,
    completed_count: completedCount,
    requested_count: body.task_ids.length,
  });
}
