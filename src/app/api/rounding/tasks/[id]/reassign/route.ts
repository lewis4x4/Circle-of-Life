import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

type Body = {
  newStaffId?: string;
  reason?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can reassign tasks" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStaffId = body.newStaffId?.trim();
  const reason = body.reason?.trim();
  if (!newStaffId || !reason) {
    return NextResponse.json({ error: "newStaffId and reason are required" }, { status: 400 });
  }

  const taskId = (await params).id;
  const { data: task, error: taskError } = await context.admin
    .from("resident_observation_tasks")
    .select("id, organization_id, entity_id, facility_id, resident_id, assigned_staff_id, shift_assignment_id")
    .eq("id", taskId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    console.error("[rounding/tasks/reassign] task lookup", taskError);
  }
  if (taskError || !task) {
    return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, task.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data: newStaff, error: staffError } = await context.admin
    .from("staff")
    .select("id")
    .eq("id", newStaffId)
    .eq("facility_id", task.facility_id)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (staffError || !newStaff) {
    return NextResponse.json({ error: "New staff member not found in this facility" }, { status: 404 });
  }

  const releasedAt = new Date().toISOString();
  if (task.assigned_staff_id) {
    const { error: releaseError } = await context.admin
      .from("resident_observation_assignments")
      .update({ released_at: releasedAt })
      .eq("task_id", task.id)
      .eq("staff_id", task.assigned_staff_id)
      .is("released_at", null);

    if (releaseError) {
      console.error("[rounding/tasks/reassign] release current assignment", releaseError);
      return NextResponse.json({ error: "Could not release current assignment" }, { status: 500 });
    }
  }

  const { error: assignmentError } = await context.admin
    .from("resident_observation_assignments")
    .insert({
      organization_id: context.organizationId,
      entity_id: task.entity_id,
      facility_id: task.facility_id,
      resident_id: task.resident_id,
      task_id: task.id,
      shift_assignment_id: task.shift_assignment_id,
      staff_id: newStaffId,
      assignment_type: "reassignment",
      assigned_at: releasedAt,
      reason,
      created_by: context.userId,
    });

  if (assignmentError) {
    console.error("[rounding/tasks/reassign] insert assignment", assignmentError);
    return NextResponse.json({ error: "Could not create reassignment history" }, { status: 500 });
  }

  const { error: taskUpdateError } = await context.admin
    .from("resident_observation_tasks")
    .update({
      assigned_staff_id: newStaffId,
      reassigned_from_staff_id: task.assigned_staff_id,
      reassignment_reason: reason,
      status: "reassigned",
    })
    .eq("id", task.id)
    .eq("organization_id", context.organizationId);

  if (taskUpdateError) {
    console.error("[rounding/tasks/reassign] update task", taskUpdateError);
    return NextResponse.json({ error: "Could not reassign observation task" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, taskId: task.id, assignedStaffId: newStaffId, status: "reassigned" });
}
