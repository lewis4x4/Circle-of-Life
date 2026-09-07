import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { logError } from "@/lib/observability/logger";

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  assigned_to: string | null;
  assigned_role: string | null;
  status: string;
};

const TRUSTED_DEFER_CONFLICTS = new Set([
  "Deferred time must be in the future",
  "Task cannot be deferred from this state",
  "This defer request was already saved with different content. Refresh the task before retrying",
]);

function deferRequestKey(actorId: string, taskId: string) {
  return createHash("sha256")
    .update(`operation-defer-v1:${actorId}:${taskId}`, "utf8")
    .digest("hex");
}

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

  let body: { deferred_until?: string; cancellation_reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.deferred_until) {
    return NextResponse.json({ error: "deferred_until is required" }, { status: 400 });
  }

  const deferredUntil = new Date(body.deferred_until);
  if (Number.isNaN(deferredUntil.getTime())) {
    return NextResponse.json({ error: "Invalid deferred_until" }, { status: 400 });
  }

  const { data, error } = await actor.admin
    .from("operation_task_instances" as never)
    .select(`
      id,
      organization_id,
      facility_id,
      assigned_to,
      assigned_role,
      status
    `)
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
    return NextResponse.json({ error: "Not authorized to defer this task" }, { status: 403 });
  }

  const currentResult = await revalidateOperationsActor(actor);
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (!(await actorCanMutateTask(currentActor, task))) {
    return NextResponse.json({ error: "Not authorized to defer this task" }, { status: 403 });
  }

  const { data: rpcData, error: rpcError } = await currentActor.admin.rpc(
    "defer_operation_task_review" as never,
    {
      p_task_id: id,
      p_actor_id: currentActor.id,
      p_actor_role: currentActor.appRole,
      p_deferred_until: deferredUntil.toISOString(),
      p_cancellation_reason: body.cancellation_reason ?? "",
      p_request_key: deferRequestKey(currentActor.id, id),
    } as never,
  );
  if (rpcError) {
    logError("admin.operations.tasks.defer", rpcError, {
      action: "rpc",
      taskId: id,
      facilityId: task.facility_id,
    });
    if (rpcError.code === "42501") {
      return NextResponse.json({ error: "Not authorized to defer this task" }, { status: 403 });
    }
    const trusted = TRUSTED_DEFER_CONFLICTS.has(rpcError.message);
    return NextResponse.json(
      { error: trusted ? rpcError.message : "Failed to defer task" },
      { status: trusted ? 409 : 500 },
    );
  }

  const receipt = rpcData as unknown as { new_task_id?: string } | null;
  if (!receipt?.new_task_id) {
    return NextResponse.json({ error: "Failed to defer task" }, { status: 500 });
  }
  return NextResponse.json({ success: true, new_task_id: receipt.new_task_id });
}
