import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { logError } from "@/lib/observability/logger";

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  status: string;
};

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  const { id } = await params;

  const { data, error } = await actor.admin
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, assigned_to, status")
    .eq("id", id)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  const task = data as unknown as TaskRow | null;
  if (error || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const canMutate = await actorCanMutateTask(actor, task);
  if (!canMutate) {
    return NextResponse.json({ error: "Not authorized to reinstate this task" }, { status: 403 });
  }

  const currentResult = await revalidateOperationsActor(actor);
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (!(await actorCanMutateTask(currentActor, task))) {
    return NextResponse.json({ error: "Not authorized to reinstate this task" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await currentActor.admin
    .from("operation_task_instances" as never)
    .update({
      status: "pending",
      missed_at: null,
      deferred_until: null,
      updated_at: now,
      updated_by: currentActor.id,
    } as never)
    .eq("id", id)
    .eq("organization_id", currentActor.organizationId)
    .eq("facility_id", task.facility_id);

  if (updateError) {
    logError("admin.operations.tasks.reinstate", updateError, {
      action: "update",
      taskId: id,
      facilityId: task.facility_id,
    });
    return NextResponse.json({ error: "Failed to reinstate task" }, { status: 500 });
  }

  await currentActor.admin.from("operation_audit_log" as never).insert({
    organization_id: task.organization_id,
    facility_id: task.facility_id,
    task_instance_id: task.id,
    event_type: "updated",
    from_status: task.status,
    to_status: "pending",
    actor_id: currentActor.id,
    actor_role: currentActor.appRole,
    event_notes: "Task reinstated from missed queue",
    event_data: { source: "admin-operations-missed" },
  } as never);

  return NextResponse.json({ success: true });
}
