import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import type { CompletionPayload, ObservationExceptionType, ObservationEntryMode, ObservationQuickStatus } from "@/lib/rounding/types";
import { getCompletionTaskStatus } from "@/lib/rounding/update-task-status";

function inferExceptionType(payload: CompletionPayload): ObservationExceptionType | null {
  if (payload.exceptionType) {
    return payload.exceptionType;
  }
  if (payload.quickStatus === "not_found") {
    return "resident_not_found";
  }
  if (payload.quickStatus === "refused") {
    return "resident_declined_interaction";
  }
  if (payload.fallHazardObserved) {
    return "environmental_hazard_present";
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  const taskId = (await params).id;

  let body: CompletionPayload;
  try {
    body = (await request.json()) as CompletionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const VALID_QUICK_STATUSES = new Set<ObservationQuickStatus>([
    "awake", "asleep", "calm", "agitated", "confused", "distressed", "not_found", "refused",
  ]);
  if (!body.quickStatus || !VALID_QUICK_STATUSES.has(body.quickStatus)) {
    return NextResponse.json({ error: "A valid quickStatus is required" }, { status: 400 });
  }

  const VALID_EXCEPTION_TYPES = new Set<ObservationExceptionType>([
    "resident_not_found", "resident_declined_interaction", "resident_appears_ill",
    "resident_appears_injured", "environmental_hazard_present", "family_concern_reported",
    "assignment_impossible", "other",
  ]);
  if (body.exceptionType && !VALID_EXCEPTION_TYPES.has(body.exceptionType)) {
    return NextResponse.json({ error: "Invalid exceptionType" }, { status: 400 });
  }

  const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
  if (body.exceptionSeverity && !VALID_SEVERITIES.has(body.exceptionSeverity)) {
    return NextResponse.json({ error: "Invalid exceptionSeverity" }, { status: 400 });
  }

  if (body.interventionCodes !== undefined && !Array.isArray(body.interventionCodes)) {
    return NextResponse.json({ error: "interventionCodes must be an array" }, { status: 400 });
  }

  const { data: task, error: taskError } = await context.admin
    .from("resident_observation_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    console.error("[rounding/tasks/complete] task lookup", taskError);
  }
  if (taskError || !task) {
    return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  }

  const TERMINAL_STATUSES = new Set(["completed_on_time", "completed_late", "excused"]);
  if (TERMINAL_STATUSES.has(task.status as string)) {
    return NextResponse.json({ error: `Task is already ${task.status}` }, { status: 409 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, task.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  if (!isRoundingManagerRole(context.appRole) && task.assigned_staff_id !== context.currentStaffId) {
    return NextResponse.json({ error: "Not allowed to complete this observation task" }, { status: 403 });
  }

  const staffId = context.currentStaffId ?? task.assigned_staff_id;
  if (!staffId) {
    return NextResponse.json({ error: "A staff profile is required to complete a task" }, { status: 422 });
  }

  const observedAt = body.observedAt ? new Date(body.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime())) {
    return NextResponse.json({ error: "Invalid observedAt timestamp" }, { status: 400 });
  }

  const now = new Date();
  const entryMode: ObservationEntryMode =
    observedAt.getTime() < now.getTime() - 5 * 60 * 1000 ? "late" : "live";
  const exceptionType = inferExceptionType(body);
  const exceptionPresent = !!exceptionType;
  const completionStatus = getCompletionTaskStatus({
    observedAt,
    graceEndsAt: task.grace_ends_at,
  });

  const { data: insertedLog, error: logError } = await context.admin
    .from("resident_observation_logs")
    .insert({
      organization_id: task.organization_id,
      entity_id: task.entity_id,
      facility_id: task.facility_id,
      resident_id: task.resident_id,
      task_id: task.id,
      assigned_staff_id: task.assigned_staff_id,
      staff_id: staffId,
      observed_at: observedAt.toISOString(),
      entered_at: now.toISOString(),
      entry_mode: entryMode,
      quick_status: body.quickStatus,
      resident_location: body.residentLocation ?? null,
      resident_position: body.residentPosition ?? null,
      resident_state: body.residentState ?? null,
      distress_present: body.distressPresent ?? false,
      breathing_concern: body.breathingConcern ?? false,
      pain_concern: body.painConcern ?? false,
      toileting_assisted: body.toiletingAssisted ?? false,
      hydration_offered: body.hydrationOffered ?? false,
      repositioned: body.repositioned ?? false,
      skin_concern_observed: body.skinConcernObserved ?? false,
      fall_hazard_observed: body.fallHazardObserved ?? false,
      refused_assistance: body.refusedAssistance ?? false,
      intervention_codes: body.interventionCodes ?? [],
      exception_present: exceptionPresent,
      note: body.note ?? null,
      late_reason: entryMode === "late" ? body.lateReason ?? "late_entry" : null,
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (logError || !insertedLog) {
    console.error("[rounding/tasks/complete] insert log", logError);
    return NextResponse.json({ error: "Could not save observation log" }, { status: 500 });
  }

  if (exceptionType) {
    const { error: exceptionError } = await context.admin
      .from("resident_observation_exceptions")
      .insert({
        organization_id: task.organization_id,
        entity_id: task.entity_id,
        facility_id: task.facility_id,
        resident_id: task.resident_id,
        log_id: insertedLog.id,
        exception_type: exceptionType,
        severity: body.exceptionSeverity ?? "medium",
        requires_follow_up: true,
        follow_up_status: "open",
      });

    if (exceptionError) {
      console.error("[rounding/tasks/complete] insert exception", exceptionError);
      return NextResponse.json({ error: "Could not save observation exception" }, { status: 500 });
    }
  }

  const { error: taskUpdateError } = await context.admin
    .from("resident_observation_tasks")
    .update({
      status: completionStatus,
      completed_log_id: insertedLog.id,
    })
    .eq("id", task.id)
    .eq("organization_id", context.organizationId);

  if (taskUpdateError) {
    console.error("[rounding/tasks/complete] update task", taskUpdateError);
    return NextResponse.json({ error: "Could not update observation task" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    taskId: task.id,
    logId: insertedLog.id,
    status: completionStatus,
  });
}
