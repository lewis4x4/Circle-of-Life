import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";
import { appendEscalationDelivery, normalizeEscalationHistory, parseEscalationLadder, resolveEscalation, type OperationEscalationTask } from "@/lib/operations/escalation";

type TemplateRow = {
  escalation_ladder: unknown;
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

  let body: { reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const { data: taskData, error: taskError } = await actor.admin
    .from("operation_task_instances" as never)
    .select("id, organization_id, facility_id, template_id, template_name, assigned_to, assigned_role, status, current_escalation_level, escalation_history, license_threatening, due_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  const task = taskData as unknown as OperationEscalationTask | null;
  if (taskError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const canMutate = await actorCanMutateTask(actor, task);
  if (!canMutate) {
    return NextResponse.json({ error: "Not authorized to escalate this task" }, { status: 403 });
  }

  if (!task.template_id) {
    return NextResponse.json({ error: "Task is not linked to a template escalation ladder" }, { status: 409 });
  }

  const { data: templateData, error: templateError } = await actor.admin
    .from("operation_task_templates" as never)
    .select("escalation_ladder")
    .eq("id", task.template_id)
    .maybeSingle();

  const template = templateData as unknown as TemplateRow | null;
  if (templateError || !template) {
    return NextResponse.json({ error: "Task template not found" }, { status: 404 });
  }

  const escalationLadder = parseEscalationLadder(template.escalation_ladder);
  if (escalationLadder.length === 0) {
    return NextResponse.json({ error: "No escalation ladder configured for this task" }, { status: 409 });
  }

  const resolution = await resolveEscalation(actor.admin, {
    task,
    escalationLadder,
    reason: body.reason || "Manual escalation from operations queue",
    initiatedBy: actor.id,
  });

  if (!resolution.nextStep) {
    return NextResponse.json({ error: "Escalation ladder is already exhausted" }, { status: 409 });
  }

  const history = [...normalizeEscalationHistory(task.escalation_history), resolution.historyEntry];
  const { error: updateError } = await actor.admin
    .from("operation_task_instances" as never)
    .update({
      assigned_to: resolution.assignedUserId,
      assigned_role: resolution.assignedRole,
      current_escalation_level: resolution.nextLevel,
      escalation_triggered_at: new Date().toISOString(),
      escalation_history: history,
      due_at: resolution.nextDueAt,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    } as never)
    .eq("id", task.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await actor.admin.from("operation_audit_log" as never).insert({
    organization_id: task.organization_id,
    facility_id: task.facility_id,
    task_instance_id: task.id,
    event_type: "escalated",
    from_status: task.status,
    to_status: task.status,
    actor_id: actor.id,
    actor_role: actor.appRole,
    event_notes: body.reason || "Manual escalation from operations queue",
    event_data: {
      escalation_level: resolution.nextLevel,
      channel: resolution.nextStep.channel,
      escalated_to_role: resolution.nextStep.role,
      assigned_user_id: resolution.assignedUserId,
      next_due_at: resolution.nextDueAt,
    },
  } as never);

  await appendEscalationDelivery(actor.admin, {
    organizationId: task.organization_id,
    facilityId: task.facility_id,
    taskInstanceId: task.id,
    escalationLevel: resolution.nextLevel,
    targetRole: resolution.nextStep.role,
    targetUserId: resolution.assignedUserId,
    targetPhone: resolution.assignedUserPhone,
    channel: resolution.nextStep.channel,
    deliveryStatus: "queued",
    createdBy: actor.id,
    providerPayload: {
      source: "manual",
      queued_only: true,
    },
  });

  return NextResponse.json({
    success: true,
    escalation_level: resolution.nextLevel,
    assigned_role: resolution.assignedRole,
    assigned_user_id: resolution.assignedUserId,
    channel: resolution.nextStep.channel,
  });
}
