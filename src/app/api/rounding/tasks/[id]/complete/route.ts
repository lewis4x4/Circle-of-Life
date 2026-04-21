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

function lateEntrySeverity(delayMinutes: number, exceptionPresent: boolean): "medium" | "high" | "critical" {
  let severity: "medium" | "high" | "critical" = "medium";
  if (delayMinutes >= 240) {
    severity = "critical";
  } else if (delayMinutes >= 60) {
    severity = "high";
  }

  if (exceptionPresent && severity === "medium") {
    severity = "high";
  }
  if (exceptionPresent && severity === "high" && delayMinutes >= 120) {
    severity = "critical";
  }

  return severity;
}

function lateEntryFlagType(delayMinutes: number, exceptionPresent: boolean) {
  if (exceptionPresent) return "late_entry_with_exception";
  if (delayMinutes >= 240) return "late_entry_over_4h";
  if (delayMinutes >= 60) return "late_entry_over_60m";
  return "late_entry_review";
}

function suspiciousPatternSeverity(sameMinuteCount: number, recentWindowCount: number): "high" | "critical" {
  if (sameMinuteCount >= 6 || recentWindowCount >= 12) {
    return "critical";
  }
  return "high";
}

function suspiciousPatternFlagType(sameMinuteCount: number, recentWindowCount: number) {
  if (recentWindowCount >= 8) return "high_velocity_documentation";
  if (sameMinuteCount >= 3) return "same_minute_batch_entry";
  return "pattern_review";
}

function payloadSignature(input: {
  quickStatus: ObservationQuickStatus;
  residentLocation?: string | null;
  residentPosition?: string | null;
  residentState?: string | null;
  distressPresent?: boolean;
  breathingConcern?: boolean;
  painConcern?: boolean;
  toiletingAssisted?: boolean;
  hydrationOffered?: boolean;
  repositioned?: boolean;
  skinConcernObserved?: boolean;
  fallHazardObserved?: boolean;
  refusedAssistance?: boolean;
  interventionCodes?: string[];
}) {
  return JSON.stringify({
    quickStatus: input.quickStatus,
    residentLocation: (input.residentLocation ?? "").trim().toLowerCase(),
    residentPosition: (input.residentPosition ?? "").trim().toLowerCase(),
    residentState: (input.residentState ?? "").trim().toLowerCase(),
    distressPresent: input.distressPresent ?? false,
    breathingConcern: input.breathingConcern ?? false,
    painConcern: input.painConcern ?? false,
    toiletingAssisted: input.toiletingAssisted ?? false,
    hydrationOffered: input.hydrationOffered ?? false,
    repositioned: input.repositioned ?? false,
    skinConcernObserved: input.skinConcernObserved ?? false,
    fallHazardObserved: input.fallHazardObserved ?? false,
    refusedAssistance: input.refusedAssistance ?? false,
    interventionCodes: (input.interventionCodes ?? []).slice().sort(),
  });
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
  if (entryMode === "late" && !body.lateReason?.trim()) {
    return NextResponse.json({ error: "lateReason is required for late entries" }, { status: 400 });
  }
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

  let integrityFlagCreated = false;
  let suspiciousPatternFlagCreated = false;
  if (entryMode === "late") {
    const delayMinutes = Math.max(1, Math.round((now.getTime() - observedAt.getTime()) / 60000));
    const { error: integrityFlagError } = await context.admin
      .from("resident_observation_integrity_flags")
      .insert({
        organization_id: task.organization_id,
        entity_id: task.entity_id,
        facility_id: task.facility_id,
        resident_id: task.resident_id,
        log_id: insertedLog.id,
        staff_id: staffId,
        flag_type: lateEntryFlagType(delayMinutes, exceptionPresent),
        severity: lateEntrySeverity(delayMinutes, exceptionPresent),
        status: "open",
        disposition_note: `Auto-created from a late observation entry (${delayMinutes} min after observation). Reason: ${body.lateReason?.trim()}`,
        updated_by: context.userId,
      });

    if (integrityFlagError) {
      console.error("[rounding/tasks/complete] insert integrity flag", integrityFlagError);
    } else {
      integrityFlagCreated = true;
    }
  }

  const sameMinuteStart = new Date(now);
  sameMinuteStart.setSeconds(0, 0);
  const sameMinuteEnd = new Date(sameMinuteStart.getTime() + 60_000);
  const recentPatternStart = new Date(now.getTime() - 5 * 60_000);
  const repeatedPatternStart = new Date(now.getTime() - 15 * 60_000);

  const { data: recentLogs, error: recentLogsError } = await context.admin
    .from("resident_observation_logs")
    .select("id, entered_at")
    .eq("organization_id", task.organization_id)
    .eq("facility_id", task.facility_id)
    .eq("staff_id", staffId)
    .is("deleted_at", null)
    .gte("entered_at", recentPatternStart.toISOString())
    .lte("entered_at", sameMinuteEnd.toISOString());

  if (recentLogsError) {
    console.error("[rounding/tasks/complete] recent logs", recentLogsError);
  } else {
    const recentWindowCount = (recentLogs ?? []).length;
    const sameMinuteCount = (recentLogs ?? []).filter((row) => {
      const enteredAt = new Date(row.entered_at).getTime();
      return enteredAt >= sameMinuteStart.getTime() && enteredAt < sameMinuteEnd.getTime();
    }).length;

    if (sameMinuteCount >= 3 || recentWindowCount >= 8) {
      const { error: suspiciousFlagError } = await context.admin
        .from("resident_observation_integrity_flags")
        .insert({
          organization_id: task.organization_id,
          entity_id: task.entity_id,
          facility_id: task.facility_id,
          resident_id: task.resident_id,
          log_id: insertedLog.id,
          staff_id: staffId,
          flag_type: suspiciousPatternFlagType(sameMinuteCount, recentWindowCount),
          severity: suspiciousPatternSeverity(sameMinuteCount, recentWindowCount),
          status: "open",
          disposition_note:
            `Auto-created from a suspicious documentation pattern: ${sameMinuteCount} entries in the same minute and ${recentWindowCount} entries in the last 5 minutes.`,
          updated_by: context.userId,
        });

      if (suspiciousFlagError) {
        console.error("[rounding/tasks/complete] insert suspicious integrity flag", suspiciousFlagError);
      } else {
        suspiciousPatternFlagCreated = true;
      }
    }
  }

  const { data: repeatedPatternLogs, error: repeatedPatternError } = await context.admin
    .from("resident_observation_logs")
    .select(`
      id,
      resident_id,
      quick_status,
      resident_location,
      resident_position,
      resident_state,
      distress_present,
      breathing_concern,
      pain_concern,
      toileting_assisted,
      hydration_offered,
      repositioned,
      skin_concern_observed,
      fall_hazard_observed,
      refused_assistance,
      intervention_codes,
      entered_at
    `)
    .eq("organization_id", task.organization_id)
    .eq("facility_id", task.facility_id)
    .eq("staff_id", staffId)
    .is("deleted_at", null)
    .gte("entered_at", repeatedPatternStart.toISOString())
    .lte("entered_at", now.toISOString());

  if (repeatedPatternError) {
    console.error("[rounding/tasks/complete] repeated pattern logs", repeatedPatternError);
  } else {
    const targetSignature = payloadSignature(body);
    const matchingResidents = new Set(
      ((repeatedPatternLogs ?? []) as Array<{
        resident_id: string;
        quick_status: ObservationQuickStatus;
        resident_location: string | null;
        resident_position: string | null;
        resident_state: string | null;
        distress_present: boolean;
        breathing_concern: boolean;
        pain_concern: boolean;
        toileting_assisted: boolean;
        hydration_offered: boolean;
        repositioned: boolean;
        skin_concern_observed: boolean;
        fall_hazard_observed: boolean;
        refused_assistance: boolean;
        intervention_codes: string[];
      }>).filter((row) => payloadSignature({
        quickStatus: row.quick_status,
        residentLocation: row.resident_location,
        residentPosition: row.resident_position,
        residentState: row.resident_state,
        distressPresent: row.distress_present,
        breathingConcern: row.breathing_concern,
        painConcern: row.pain_concern,
        toiletingAssisted: row.toileting_assisted,
        hydrationOffered: row.hydration_offered,
        repositioned: row.repositioned,
        skinConcernObserved: row.skin_concern_observed,
        fallHazardObserved: row.fall_hazard_observed,
        refusedAssistance: row.refused_assistance,
        interventionCodes: row.intervention_codes,
      }) === targetSignature).map((row) => row.resident_id),
    );

    if (matchingResidents.size >= 3) {
      const severity = matchingResidents.size >= 5 ? "critical" : "high";
      const { error: repeatedFlagError } = await context.admin
        .from("resident_observation_integrity_flags")
        .insert({
          organization_id: task.organization_id,
          entity_id: task.entity_id,
          facility_id: task.facility_id,
          resident_id: task.resident_id,
          log_id: insertedLog.id,
          staff_id: staffId,
          flag_type: "identical_payload_multi_resident",
          severity,
          status: "open",
          disposition_note:
            `Auto-created from repeated identical payload signatures across ${matchingResidents.size} residents within 15 minutes.`,
          updated_by: context.userId,
        });

      if (repeatedFlagError) {
        console.error("[rounding/tasks/complete] insert repeated payload integrity flag", repeatedFlagError);
      } else {
        suspiciousPatternFlagCreated = true;
      }
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
    integrityFlagCreated,
    suspiciousPatternFlagCreated,
  });
}
