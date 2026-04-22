import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";

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
    console.error("[operations/tasks/bulk-complete] query", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  const updatableTasks: TaskRow[] = [];
  for (const task of tasks) {
    if (await actorCanMutateTask(actor, task)) {
      updatableTasks.push(task);
    }
  }

  if (updatableTasks.length === 0) {
    return NextResponse.json({ error: "No tasks to update" }, { status: 400 });
  }

  const now = new Date().toISOString();
  let completedCount = 0;

  for (const task of updatableTasks) {
    const slaMet = task.due_at ? new Date(task.due_at) >= new Date(now) : true;

    const { error: updateError } = await actor.admin
      .from("operation_task_instances" as never)
      .update({
        status: "completed",
        completed_at: now,
        completion_notes: body.completion_notes || "End of shift bulk complete",
        verified_by: actor.id,
        verified_at: now,
        sla_met: slaMet,
        sla_miss_reason: slaMet ? null : "Completed after due time",
        updated_at: now,
        updated_by: actor.id,
      } as never)
      .eq("id", task.id);

    if (updateError) {
      console.error("[operations/tasks/bulk-complete] update", updateError);
      continue;
    }

    completedCount += 1;

    await actor.admin.from("operation_audit_log" as never).insert({
      organization_id: task.organization_id,
      facility_id: task.facility_id,
      task_instance_id: task.id,
      event_type: "completed",
      from_status: task.status,
      to_status: "completed",
      actor_id: actor.id,
      actor_role: actor.appRole,
      event_notes: body.completion_notes || "Bulk completed (end of shift)",
      event_data: { bulk_complete: true, sla_met: slaMet },
    } as never);
  }

  return NextResponse.json({
    success: true,
    completed_count: completedCount,
    requested_count: body.task_ids.length,
  });
}
