import { NextResponse } from "next/server";

import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

type WatchAction = "approve" | "pause" | "resume" | "end" | "cancel";

type Body = {
  action?: WatchAction;
  reason?: string;
};

const TERMINAL_TASK_STATUSES = new Set(["completed_on_time", "completed_late", "excused"]);

function buildDefaultReason(action: WatchAction) {
  switch (action) {
    case "approve":
      return "Watch approved from the Resident Assurance watch center.";
    case "pause":
      return "Watch paused from the Resident Assurance watch center.";
    case "resume":
      return "Watch resumed from the Resident Assurance watch center.";
    case "end":
      return "Watch ended from the Resident Assurance watch center.";
    case "cancel":
      return "Watch cancelled from the Resident Assurance watch center.";
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can manage watch instances" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const action = body.action;
  const reason = body.reason?.trim();
  if (reason && reason.length > 2000) {
    return NextResponse.json({ error: "reason must be 2000 characters or fewer" }, { status: 400 });
  }

  const watchInstanceId = (await params).id;
  const { data: watch, error: watchError } = await context.admin
    .from("resident_watch_instances")
    .select("id, organization_id, entity_id, facility_id, resident_id, protocol_id, status, starts_at, ends_at")
    .eq("id", watchInstanceId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (watchError) {
    console.error("[rounding/watch-instances] lookup", watchError);
  }
  if (watchError || !watch) {
    return NextResponse.json({ error: "Watch instance not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, watch.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const note = reason || buildDefaultReason(action);
  const patch: Record<string, string | null> = {
    updated_by: context.userId,
  };

  let eventType = "";
  let updateFutureTasks = false;

  switch (action) {
    case "approve":
      if (watch.status !== "pending_approval") {
        return NextResponse.json({ error: `Only pending watches can be approved; current status is ${watch.status}` }, { status: 409 });
      }
      patch.status = "active";
      patch.approved_by = context.userId;
      eventType = "watch_approved";
      break;
    case "pause":
      if (watch.status !== "active") {
        return NextResponse.json({ error: `Only active watches can be paused; current status is ${watch.status}` }, { status: 409 });
      }
      patch.status = "paused";
      eventType = "watch_paused";
      updateFutureTasks = true;
      break;
    case "resume":
      if (watch.status !== "paused") {
        return NextResponse.json({ error: `Only paused watches can be resumed; current status is ${watch.status}` }, { status: 409 });
      }
      patch.status = "active";
      eventType = "watch_resumed";
      break;
    case "end":
      if (!["pending_approval", "active", "paused"].includes(watch.status)) {
        return NextResponse.json({ error: `Only active or pending watches can be ended; current status is ${watch.status}` }, { status: 409 });
      }
      patch.status = "ended";
      patch.ends_at = now;
      patch.ended_by = context.userId;
      patch.end_reason = note;
      eventType = "watch_ended";
      updateFutureTasks = true;
      break;
    case "cancel":
      if (watch.status !== "pending_approval") {
        return NextResponse.json({ error: `Only pending watches can be cancelled; current status is ${watch.status}` }, { status: 409 });
      }
      patch.status = "cancelled";
      patch.ends_at = now;
      patch.ended_by = context.userId;
      patch.end_reason = note;
      eventType = "watch_cancelled";
      updateFutureTasks = true;
      break;
  }

  const { error: updateError } = await context.admin
    .from("resident_watch_instances")
    .update(patch)
    .eq("id", watch.id)
    .eq("organization_id", context.organizationId);

  if (updateError) {
    console.error("[rounding/watch-instances] update", updateError);
    return NextResponse.json({ error: "Could not update watch instance" }, { status: 500 });
  }

  let excusedTaskCount = 0;
  if (updateFutureTasks) {
    const { data: openTasks, error: openTasksError } = await context.admin
      .from("resident_observation_tasks")
      .select("id, status")
      .eq("watch_instance_id", watch.id)
      .eq("organization_id", context.organizationId)
      .is("deleted_at", null)
      .gte("due_at", now);

    if (openTasksError) {
      console.error("[rounding/watch-instances] open tasks", openTasksError);
    } else if (openTasks && openTasks.length > 0) {
      const taskIdsToExcuse = openTasks
        .filter((task) => !TERMINAL_TASK_STATUSES.has(task.status))
        .map((task) => task.id);

      if (taskIdsToExcuse.length > 0) {
        const { error: taskUpdateError } = await context.admin
          .from("resident_observation_tasks")
          .update({
            status: "excused",
            excused_reason: note,
            excused_by: context.userId,
            updated_by: context.userId,
          })
          .in("id", taskIdsToExcuse)
          .eq("organization_id", context.organizationId);

        if (taskUpdateError) {
          console.error("[rounding/watch-instances] excuse future tasks", taskUpdateError);
        } else {
          excusedTaskCount = taskIdsToExcuse.length;
        }
      }
    }
  }

  const { error: eventError } = await context.admin
    .from("resident_watch_events")
    .insert({
      organization_id: context.organizationId,
      entity_id: watch.entity_id,
      facility_id: watch.facility_id,
      resident_id: watch.resident_id,
      watch_instance_id: watch.id,
      event_type: eventType,
      occurred_at: now,
      note,
      created_by: context.userId,
    });

  if (eventError) {
    console.error("[rounding/watch-instances] event", eventError);
  }

  return NextResponse.json({
    ok: true,
    id: watch.id,
    action,
    status: patch.status,
    excusedTaskCount,
  });
}
