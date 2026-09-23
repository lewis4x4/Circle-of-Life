/**
 * The `complete_rounding_task_review` payload, built from a `CompletionPayload`.
 * One builder for the signed-in completion route and the floor tablet's device
 * replay (`floor_replay_complete_rounding_task`), so a replayed check is the
 * same write the owner would have made signed in.
 */
import type { CompletionPayload, ObservationExceptionType, ObservationQuickStatus } from "@/lib/rounding/types";

export function inferExceptionType(payload: CompletionPayload): ObservationExceptionType | null {
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

const VALID_QUICK_STATUSES = new Set<ObservationQuickStatus>([
  "awake", "asleep", "calm", "agitated", "confused", "distressed", "not_found", "refused",
]);

const VALID_EXCEPTION_TYPES = new Set<ObservationExceptionType>([
  "resident_not_found", "resident_declined_interaction", "resident_appears_ill",
  "resident_appears_injured", "environmental_hazard_present", "family_concern_reported",
  "assignment_impossible", "other",
]);

const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

const TEXT_FIELDS = ["residentLocation", "residentPosition", "residentState", "note", "lateReason"] as const;
const BOOLEAN_FIELDS = ["distressPresent", "breathingConcern", "painConcern", "toiletingAssisted", "hydrationOffered", "repositioned", "skinConcernObserved", "fallHazardObserved", "refusedAssistance"] as const;

/** Field types before the quick status check. Null when they are well formed. */
export function completionFieldError(body: CompletionPayload): string | null {
  for (const field of TEXT_FIELDS) {
    if (body[field] != null && typeof body[field] !== "string") return `${field} must be text`;
  }
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") return `${field} must be a boolean`;
  }
  return null;
}

/** Quick status, exception and intervention shape. Null when they are well formed. */
export function completionChoiceError(body: CompletionPayload): string | null {
  if (!body.quickStatus || !VALID_QUICK_STATUSES.has(body.quickStatus)) return "A valid quickStatus is required";
  if (body.exceptionType && !VALID_EXCEPTION_TYPES.has(body.exceptionType)) return "Invalid exceptionType";
  if (body.exceptionSeverity && !VALID_SEVERITIES.has(body.exceptionSeverity)) return "Invalid exceptionSeverity";
  if (body.interventionCodes !== undefined && (!Array.isArray(body.interventionCodes) || body.interventionCodes.some((code) => typeof code !== "string"))) {
    return "interventionCodes must be an array";
  }
  return null;
}

export function buildRoundingReviewPayload(body: CompletionPayload, input: { requestId: string; observedAt: Date; offline: boolean }) {
  const exceptionType = inferExceptionType(body);
  return {
    request_id: input.requestId,
    observed_at: input.observedAt.toISOString(),
    offline: input.offline,
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
  };
}
