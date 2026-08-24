/**
 * Quiet Operator copy for the admin observation escalations board
 * (`/admin/rounding/escalations`). Missing facility scope names the gap —
 * never interpolate legacy "selected facility" copy.
 */

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "@/lib/rounding/observation-plan-display-copy";

export { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY as ESCALATIONS_SELECT_FACILITY_FIRST_COPY };

export const ESCALATIONS_NO_FACILITY_NAME_COPY = "No facility name posted";

export const ESCALATIONS_ET_TIMEZONE_CUE =
  "Escalation times use Eastern (ET).";

const ESCALATIONS_NEW_YORK_TZ = "America/New_York";

const ESCALATIONS_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ESCALATIONS_NEW_YORK_TZ,
};

export type EscalationsFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope — never fabricates a facility name. */
export function resolveEscalationsFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): EscalationsFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

const ESCALATIONS_UNSCOPED_SUBTITLE_COPY =
  "Missed or overdue checks requiring operator review and survey-ready resolution are per facility.";

const ESCALATIONS_NAMED_SUBTITLE_PREFIX =
  "Missed or overdue checks requiring operator review and survey-ready resolution";

/** Page header subtitle — never interpolates "selected facility". */
export function formatEscalationsPageSubtitle(scope: EscalationsFacilityScope): string {
  if (scope.kind === "unscoped") {
    return `${ESCALATIONS_UNSCOPED_SUBTITLE_COPY} ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  if (scope.kind === "missing_name") {
    return `${ESCALATIONS_NAMED_SUBTITLE_PREFIX}. ${ESCALATIONS_NO_FACILITY_NAME_COPY}.`;
  }
  return `${ESCALATIONS_NAMED_SUBTITLE_PREFIX} at ${scope.name}.`;
}

/** No-facility interstitial body — reuses the shared select-facility gap copy. */
export function formatEscalationsNoFacilityInterstitialBody(): string {
  return OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY;
}

/** Empty-state title when a facility is scoped but no open escalations exist. */
export function formatEscalationsNoOpenEmptyTitle(scope: EscalationsFacilityScope): string {
  if (scope.kind === "named") return `No open escalations at ${scope.name}`;
  if (scope.kind === "missing_name") return "No open escalations posted";
  return "No open escalations posted";
}

/** Named loading copy for the escalations board while data loads. */
export function formatEscalationsLoadingNotice(): string {
  return "Loading escalations…";
}

/** Timestamp cell — date and time in Eastern (ET). */
export function formatEscalationsDateTimeEt(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "No time posted";

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "No time posted";

  try {
    return new Intl.DateTimeFormat("en-US", ESCALATIONS_DATE_TIME_FORMAT).format(date);
  } catch {
    return "No time posted";
  }
}
