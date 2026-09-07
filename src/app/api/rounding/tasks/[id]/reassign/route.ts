import { NextResponse } from "next/server";
import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getAccessibleRoundingFacilityIds, getRoundingRequestContext, isRoundingManagerRole, revalidateRoundingRequestContext } from "@/lib/rounding/auth";

type Body = {
  newStaffId?: string;
  reason?: string;
};

const REASSIGNABLE_STATUSES = new Set([
  "upcoming",
  "due_soon",
  "due_now",
  "overdue",
  "critically_overdue",
  "reassigned",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getRoundingRequestContext({ managerOnly: true });
  if ("response" in auth) return auth.response;

  let { context } = auth;
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
  const accessibleFacilityIds = await getAccessibleRoundingFacilityIds(context);
  const { data: task, error: taskError } = await context.admin
    .from("resident_observation_tasks")
    .select("id, organization_id, entity_id, facility_id, resident_id, assigned_staff_id, shift_assignment_id, status, completed_log_id")
    .eq("id", taskId)
    .eq("organization_id", context.organizationId)
    .in("facility_id", accessibleFacilityIds)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    logError("rounding.tasks.reassign.lookup", taskError, { taskId });
  }
  if (taskError || !task) {
    return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, task.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }
  if (task.completed_log_id || !REASSIGNABLE_STATUSES.has(task.status)) {
    return NextResponse.json({ error: `Task cannot be reassigned from status ${task.status}` }, { status: 409 });
  }

  const { data: newStaff, error: staffError } = await context.admin
    .from("staff")
    .select("id")
    .eq("id", newStaffId)
    .eq("facility_id", task.facility_id)
    .eq("organization_id", context.organizationId)
    .eq("employment_status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (staffError || !newStaff) {
    return NextResponse.json({ error: "New staff member not found in this facility" }, { status: 404 });
  }

  const freshAuth = await revalidateRoundingRequestContext(context, { managerOnly: true, facilityId: task.facility_id });
  if ("response" in freshAuth) return freshAuth.response;
  context = freshAuth.context;

  const { error: taskUpdateError } = await context.admin.rpc(
    "reassign_rounding_task_review" as never,
    {
      p_task_id: task.id,
      p_new_staff_id: newStaffId,
      p_reason: reason,
      p_actor_id: context.userId,
      p_actor_role: context.appRole,
      p_session_id: context.sessionId,
      p_claim_version: context.authClaimVersion,
      p_organization_id: context.organizationId,
      p_facility_id: task.facility_id,
    } as never,
  );

  if (taskUpdateError) {
    logError("rounding.tasks.reassign.update", taskUpdateError, { taskId: task.id });
    return NextResponse.json(
      { error: taskUpdateError.code === "42501"
        ? "No longer authorized to reassign this task"
        : taskUpdateError.code === "P0001"
          ? "Task is no longer available for reassignment"
          : "Could not reassign observation task" },
      { status: taskUpdateError.code === "42501" ? 403 : taskUpdateError.code === "P0001" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, taskId: task.id, assignedStaffId: newStaffId, status: "reassigned" });
}
