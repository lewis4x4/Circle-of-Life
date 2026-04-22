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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  const { id } = await params;

  let body: { completion_notes?: string; completion_evidence_paths?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const { data, error } = await actor.admin
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, assigned_to, status, due_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  const task = data as unknown as TaskRow | null;
  if (error || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const canMutate = await actorCanMutateTask(actor, task);
  if (!canMutate) {
    return NextResponse.json({ error: "Not authorized to complete this task" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const slaMet = task.due_at ? new Date(task.due_at) >= new Date(now) : true;

  const { error: updateError } = await actor.admin
    .from("operation_task_instances" as never)
    .update({
      status: "completed",
      completed_at: now,
      completion_notes: body.completion_notes || null,
      completion_evidence_paths: Array.isArray(body.completion_evidence_paths) ? body.completion_evidence_paths : [],
      verified_by: actor.id,
      verified_at: now,
      sla_met: slaMet,
      sla_miss_reason: slaMet ? null : "Completed after due time",
      updated_at: now,
      updated_by: actor.id,
    } as never)
    .eq("id", id);

  if (updateError) {
    console.error("[operations/tasks/complete] update", updateError);
    return NextResponse.json({ error: "Failed to complete task" }, { status: 500 });
  }

  await actor.admin.from("operation_audit_log" as never).insert({
    organization_id: task.organization_id,
    facility_id: task.facility_id,
    task_instance_id: task.id,
    event_type: "completed",
    from_status: task.status,
    to_status: "completed",
    actor_id: actor.id,
    actor_role: actor.appRole,
    event_notes: body.completion_notes || "Completed via operations queue",
    event_data: {
      sla_met: slaMet,
      auto_verified: true,
      evidence_count: Array.isArray(body.completion_evidence_paths) ? body.completion_evidence_paths.length : 0,
    },
  } as never);

  return NextResponse.json({ success: true });
}
