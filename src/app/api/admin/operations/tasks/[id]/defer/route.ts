import { NextRequest, NextResponse } from "next/server";

import { actorCanMutateTask, requireOperationsActor } from "@/lib/operations/auth";

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_to: string | null;
  assigned_role: string | null;
  status: string;
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  estimated_minutes: number | null;
  requires_dual_sign: boolean;
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
      template_id,
      template_name,
      template_category,
      template_cadence_type,
      assigned_to,
      assigned_role,
      status,
      priority,
      license_threatening,
      estimated_minutes,
      requires_dual_sign
    `)
    .eq("id", id)
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

  const deferredShift = inferShiftFromDate(deferredUntil);
  const now = new Date().toISOString();

  const { data: newTaskData, error: insertError } = await actor.admin
    .from("operation_task_instances" as never)
    .insert({
      organization_id: task.organization_id,
      facility_id: task.facility_id,
      template_id: task.template_id,
      template_name: task.template_name,
      template_category: task.template_category,
      template_cadence_type: task.template_cadence_type,
      assigned_shift_date: deferredUntil.toISOString().slice(0, 10),
      assigned_shift: deferredShift,
      assigned_to: task.assigned_to,
      assigned_role: task.assigned_role,
      status: "pending",
      priority: task.priority,
      license_threatening: task.license_threatening,
      estimated_minutes: task.estimated_minutes,
      requires_dual_sign: task.requires_dual_sign,
      due_at: deferredUntil.toISOString(),
      created_by: actor.id,
      updated_by: actor.id,
    } as never)
    .select("id")
    .single();

  const newTask = newTaskData as unknown as { id: string } | null;
  if (insertError || !newTask) {
    console.error("[operations/tasks/defer] insert", insertError);
    return NextResponse.json({ error: "Failed to defer task" }, { status: 500 });
  }

  const { error: updateError } = await actor.admin
    .from("operation_task_instances" as never)
    .update({
      status: "deferred",
      deferred_until: deferredUntil.toISOString(),
      cancellation_reason: body.cancellation_reason || "Deferred to a later queue date",
      updated_at: now,
      updated_by: actor.id,
    } as never)
    .eq("id", id);

  if (updateError) {
    console.error("[operations/tasks/defer] update", updateError);
    return NextResponse.json({ error: "Failed to update deferred task" }, { status: 500 });
  }

  await actor.admin.from("operation_audit_log" as never).insert({
    organization_id: task.organization_id,
    facility_id: task.facility_id,
    task_instance_id: task.id,
    event_type: "deferred",
    from_status: task.status,
    to_status: "deferred",
    actor_id: actor.id,
    actor_role: actor.appRole,
    event_notes: body.cancellation_reason || `Deferred to ${deferredUntil.toISOString()}`,
    event_data: {
      deferred_to: deferredUntil.toISOString(),
      new_task_id: newTask.id,
      source: "admin-operations",
    },
  } as never);

  return NextResponse.json({ success: true, new_task_id: newTask.id });
}

function inferShiftFromDate(date: Date): "day" | "evening" | "night" {
  const hour = date.getHours();
  if (hour >= 7 && hour < 15) return "day";
  if (hour >= 15 && hour < 23) return "evening";
  return "night";
}
