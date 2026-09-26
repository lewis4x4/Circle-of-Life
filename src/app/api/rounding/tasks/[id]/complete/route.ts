import { NextResponse } from "next/server";
import { getAccessibleRoundingFacilityIds, getRoundingRequestContext, revalidateRoundingRequestContext, type RoundingRequestContext } from "@/lib/rounding/auth";
import { logError } from "@/lib/observability/logger";
import { buildRoundingReviewPayload, chipSelectionsShapeError, completionChoiceError, completionFieldError } from "@/lib/rounding/review-payload";
import type { CompletionPayload } from "@/lib/rounding/types";

function retryOwnerMatches(owner: NonNullable<CompletionPayload["retryOwner"]>, context: RoundingRequestContext) {
  return owner.userId === context.userId && owner.sessionId === context.sessionId
    && owner.organizationId === context.organizationId;
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
  if (body.retryOwner !== undefined) {
    const owner = body.retryOwner;
    if (!owner || typeof owner !== "object" || Array.isArray(owner)
      || ["userId", "sessionId", "organizationId", "facilityId"].some((key) =>
        typeof owner[key as keyof typeof owner] !== "string" || !owner[key as keyof typeof owner])) {
      return NextResponse.json({ error: "Invalid original retry owner" }, { status: 400 });
    }
    if (!retryOwnerMatches(owner, context)) {
      return NextResponse.json({ error: "This observation belongs to a different operator or session. Reconciliation required." }, { status: 403 });
    }
  }
  const requestId = body.requestId ?? body.offline?.queueId;
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "A valid requestId is required" }, { status: 400 });
  }
  if (typeof body.observedAt !== "string" || Number.isNaN(new Date(body.observedAt).getTime())) {
    return NextResponse.json({ error: "A valid observedAt timestamp is required" }, { status: 400 });
  }
  const fieldError = completionFieldError(body);
  if (fieldError) {
    return NextResponse.json({ error: fieldError }, { status: 400 });
  }

  if (request.headers.get("x-haven-sync") === "service-worker" && !body.offline) {
    return NextResponse.json({ error: "Offline observation has no original operator. Reconciliation required." }, { status: 409 });
  }
  if (body.offline && (body.offline.ownerUserId !== context.userId || body.offline.organizationId !== context.organizationId)) {
    return NextResponse.json({ error: "Sign in as the original operator to send this observation." }, { status: 403 });
  }
  const choiceError = completionChoiceError(body);
  if (choiceError) {
    return NextResponse.json({ error: choiceError }, { status: 400 });
  }

  // Chip capture. Presence of this key is what routes the write through the
  // composing command; the command itself rejects a code this facility does
  // not offer rather than dropping it, so nothing is validated twice here
  // beyond the shape. The floor tablet's chips stay on the review writer with
  // its flat answers (see `captureSurface`); the review writer checks the chips
  // against the vocabulary for cadence and monitoring checks.
  const chipShapeError = chipSelectionsShapeError(body);
  if (chipShapeError) {
    return NextResponse.json({ error: chipShapeError }, { status: 400 });
  }
  const hasChips = body.chipSelections !== undefined;
  const usesChipCapture = hasChips && body.captureSurface !== "floor";

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
  if (body.retryOwner && body.retryOwner.facilityId !== task.facility_id) {
    return NextResponse.json({ error: "The original observation facility no longer matches. Reconciliation required." }, { status: 409 });
  }

  // The locked command checks receipts before terminal/time-dependent rules.
  // An acknowledged-lost live submission must still replay hours later.
  const observedAt = new Date(body.observedAt);

  const freshAuth = await revalidateRoundingRequestContext(context, { facilityId: task.facility_id });
  if ("response" in freshAuth) return freshAuth.response;
  context = freshAuth.context;
  if (body.retryOwner && !retryOwnerMatches(body.retryOwner, context)) {
    return NextResponse.json({ error: "This observation belongs to a different operator or session. Reconciliation required." }, { status: 403 });
  }
  const freshStaffId = context.currentStaffId;
  if (!freshStaffId) {
    return NextResponse.json({ error: "A staff profile is required to complete a task" }, { status: 422 });
  }

  const { data: completionData, error: logInsertError } = usesChipCapture
    ? await context.admin.rpc(
      "submit_observation" as never,
      {
        p_task_id: task.id,
        p_chip_selections: body.chipSelections ?? {},
        p_resident_location: body.residentLocation ?? null,
        p_resident_state: body.residentState ?? null,
        p_quick_status: body.quickStatus,
        p_note: body.note ?? null,
        p_resident_position: body.residentPosition ?? null,
        p_intervention_codes: body.interventionCodes ?? null,
        p_observed_at: observedAt.toISOString(),
        p_late_reason: body.lateReason ?? null,
        p_request_id: requestId,
        p_offline: !!body.offline,
        p_actor_id: context.userId,
        p_actor_role: context.appRole,
        p_session_id: context.sessionId,
        p_claim_version: context.authClaimVersion,
      } as never,
    )
    : await context.admin.rpc(
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
      p_payload: buildRoundingReviewPayload(body, { requestId, observedAt, offline: !!body.offline }),
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
    // Migration 554: a check charted before its window opens. The message names the opening time.
    const notOpenYet = code === "22023" && logInsertError?.details === "check_not_open";
    const chipRejected = usesChipCapture && code === "22023" && !reasonRequired && !notOpenYet;
    return NextResponse.json({
      error: reasonRequired
        ? "Add a reason for this delayed entry, then retry."
        : notOpenYet
          ? logInsertError?.message ?? "This check is not open yet. Chart it when its window opens."
        : chipRejected
          ? "Tap at least one meal, mood or medication chip, and confirm where the resident was and how they presented."
          : error,
      reasonRequired,
      notOpenYet,
    }, { status });
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
