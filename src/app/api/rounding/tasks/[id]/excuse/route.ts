import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

type Body = {
  reason?: string;
  note?: string;
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
    return NextResponse.json({ error: "Only clinical and facility leaders can excuse tasks" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  if (reason.length > 2000) {
    return NextResponse.json({ error: "reason must be 2000 characters or fewer" }, { status: 400 });
  }

  const taskId = (await params).id;
  const { data: task, error: taskError } = await context.admin
    .from("resident_observation_tasks")
    .select("id, organization_id, facility_id, status")
    .eq("id", taskId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    console.error("[rounding/tasks/excuse] task lookup", taskError);
  }
  if (taskError || !task) {
    return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, task.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const TERMINAL_STATUSES = new Set(["completed_on_time", "completed_late", "excused"]);
  if (TERMINAL_STATUSES.has(task.status as string)) {
    return NextResponse.json({ error: `Task is already ${task.status} and cannot be excused` }, { status: 409 });
  }

  const { error: updateError } = await context.admin
    .from("resident_observation_tasks")
    .update({
      status: "excused",
      excused_reason: [reason, body.note?.trim()].filter(Boolean).join(" — ") || reason,
      excused_by: context.userId,
    })
    .eq("id", task.id)
    .eq("organization_id", context.organizationId);

  if (updateError) {
    console.error("[rounding/tasks/excuse] update", updateError);
    return NextResponse.json({ error: "Could not excuse observation task" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, taskId: task.id, status: "excused" });
}
