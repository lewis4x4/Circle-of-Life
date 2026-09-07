import { NextResponse } from "next/server";
import { getAccessibleRoundingFacilityIds, getRoundingRequestContext, revalidateRoundingRequestContext } from "@/lib/rounding/auth";
import { logError } from "@/lib/observability/logger";
import type { CompletionPayload, ObservationExceptionType, ObservationQuickStatus } from "@/lib/rounding/types";

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
  if ("response" in auth) return auth.response;

  let { context } = auth;
  const taskId = (await params).id;

  let body: CompletionPayload;
  try {
    body = (await request.json()) as CompletionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid completion payload" }, { status: 400 });
  }
  const requestId = body.requestId ?? body.offline?.queueId;
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "A valid requestId is required" }, { status: 400 });
  }
  if (typeof body.observedAt !== "string" || Number.isNaN(new Date(body.observedAt).getTime())) {
    return NextResponse.json({ error: "A valid observedAt timestamp is required" }, { status: 400 });
  }
  for (const field of ["residentLocation", "residentPosition", "residentState", "note", "lateReason"] as const) {
    if (body[field] != null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be text` }, { status: 400 });
    }
  }
  for (const field of ["distressPresent", "breathingConcern", "painConcern", "toiletingAssisted", "hydrationOffered", "repositioned", "skinConcernObserved", "fallHazardObserved", "refusedAssistance"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 });
    }
  }

  const VALID_QUICK_STATUSES = new Set<ObservationQuickStatus>([
    "awake", "asleep", "calm", "agitated", "confused", "distressed", "not_found", "refused",
  ]);
  if (request.headers.get("x-haven-sync") === "service-worker" && !body.offline) {
    return NextResponse.json({ error: "Offline observation has no original operator. Reconciliation required." }, { status: 409 });
  }
  if (body.offline && (body.offline.ownerUserId !== context.userId || body.offline.organizationId !== context.organizationId)) {
    return NextResponse.json({ error: "Sign in as the original operator to send this observation." }, { status: 403 });
  }
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

  if (body.interventionCodes !== undefined && (!Array.isArray(body.interventionCodes) || body.interventionCodes.some((code) => typeof code !== "string"))) {
    return NextResponse.json({ error: "interventionCodes must be an array" }, { status: 400 });
  }

  const accessibleFacilityIds = await getAccessibleRoundingFacilityIds(context);
  const { data: task, error: taskError } = await context.admin
    .from("resident_observation_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("organization_id", context.organizationId)
    .in("facility_id", accessibleFacilityIds)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError) {
    logError("rounding.tasks.complete", taskError, { taskId });
  }
  if (taskError || !task) {
    return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  }
  if (body.offline && (!body.observedAt || body.offline.facilityId !== task.facility_id)) {
    return NextResponse.json({ error: "Offline observation scope or original time is missing or does not match." }, { status: 409 });
  }

  // The locked command checks receipts before terminal/time-dependent rules.
  // An acknowledged-lost live submission must still replay hours later.
  const observedAt = new Date(body.observedAt);
  const exceptionType = inferExceptionType(body);

  const freshAuth = await revalidateRoundingRequestContext(context, { facilityId: task.facility_id });
  if ("response" in freshAuth) return freshAuth.response;
  context = freshAuth.context;
  const freshStaffId = context.currentStaffId;
  if (!freshStaffId) {
    return NextResponse.json({ error: "A staff profile is required to complete a task" }, { status: 422 });
  }

  const { data: completionData, error: logInsertError } = await context.admin.rpc(
    "complete_rounding_task_review" as never,
    {
      p_task_id: task.id,
      p_actor_id: context.userId,
      p_actor_role: context.appRole,
      p_session_id: context.sessionId,
      p_claim_version: context.authClaimVersion,
      p_organization_id: context.organizationId,
      p_facility_id: task.facility_id,
      p_actual_staff_id: freshStaffId,
      p_payload: {
        request_id: requestId,
        observed_at: observedAt.toISOString(),
        offline: !!body.offline,
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
        exception_present: !!exceptionType,
        exception_type: exceptionType,
        exception_severity: body.exceptionSeverity ?? "medium",
        note: body.note ?? null,
        late_reason: body.lateReason ?? null,
      },
    } as never,
  );
  const completion = completionData as {
    log_id?: string; status?: string; integrityFlagCreated?: boolean;
    suspiciousPatternFlagCreated?: boolean; replayed?: boolean;
  } | null;

  if (logInsertError || !completion?.log_id) {
    logError("rounding.tasks.complete", logInsertError, { taskId, residentId: task.resident_id });
    const code = logInsertError?.code;
    const status = code === "42501" ? 403 : code === "P0002" ? 404
      : code === "23505" || code === "P0001" ? 409 : code === "22023" || code === "22P02" ? 400 : 500;
    const error = status === 403 ? "Not allowed to complete this observation task"
      : status === 404 ? "Observation task not found"
      : status === 409 ? "This completion conflicts with an existing observation. Keep it for reconciliation."
      : status === 400 ? "Check the observation time, late-entry reason, and completion details."
      : "Could not save observation. Retry with the same request.";
    const reasonRequired = code === "22023" && logInsertError?.message === "lateReason is required for late entries";
    return NextResponse.json({ error: reasonRequired ? "Add a reason for this delayed entry, then retry." : error, reasonRequired }, { status });
  }

  return NextResponse.json({
    ok: true,
    taskId: task.id,
    logId: completion.log_id,
    status: completion.status,
    integrityFlagCreated: completion.integrityFlagCreated ?? false,
    suspiciousPatternFlagCreated: completion.suspiciousPatternFlagCreated ?? false,
    replayed: completion.replayed ?? false,
  });
}
