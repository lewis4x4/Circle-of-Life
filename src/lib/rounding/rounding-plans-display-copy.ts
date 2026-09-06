/**
 * Quiet Operator copy for the observation plans list (`/admin/rounding/plans`).
 * Missing dates and timestamps name the gap — never a silent em dash.
 * Missing facility scope names the gap — never interpolate legacy "selected facility" copy.
 */

import { FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "./observation-plan-display-copy";

export { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY };

export const ROUNDING_PLAN_NO_DATE_COPY = "No date posted";
export const ROUNDING_PLAN_NO_TIME_COPY = "No time posted";
export const ROUNDING_PLANS_NO_FACILITY_NAME_COPY = "No facility name posted";

export type RoundingPlansFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope — never fabricates a facility name. */
export function resolveRoundingPlansFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): RoundingPlansFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

const ROUNDING_PLANS_SUBTITLE_BASE =
  "Resident cadence rules, active observation windows, and shift-ready task generation";

/** Page header subtitle — never interpolates "selected facility". */
export function formatRoundingPlansPageSubtitle(scope: RoundingPlansFacilityScope): string {
  if (scope.kind === "unscoped") {
    return `${ROUNDING_PLANS_SUBTITLE_BASE} are per facility. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  if (scope.kind === "missing_name") {
    return `${ROUNDING_PLANS_SUBTITLE_BASE}. ${ROUNDING_PLANS_NO_FACILITY_NAME_COPY}.`;
  }
  return `${ROUNDING_PLANS_SUBTITLE_BASE} at ${scope.name}.`;
}

/** Empty-state title when no observation plans exist for the scoped facility. */
export function formatRoundingPlansNoPlansEmptyTitle(scope: RoundingPlansFacilityScope): string {
  if (scope.kind === "named") return `No observation plans at ${scope.name}`;
  if (scope.kind === "unscoped") {
    return `No observation plans posted. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  return "No observation plans posted";
}

/** Empty-state title when plans exist but none match the active filter. */
export function formatRoundingPlansFilterEmptyTitle(scope: RoundingPlansFacilityScope): string {
  if (scope.kind === "named") return `No plans match this filter at ${scope.name}`;
  if (scope.kind === "unscoped") {
    return `No plans match this filter. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  return "No plans match this filter";
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: FACILITY_OPERATOR_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
};

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DATE_FORMAT,
  hour: "numeric",
  minute: "2-digit",
};

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", { ...DATE_FORMAT, timeZone: "UTC" });
const timestampDateFormatter = new Intl.DateTimeFormat("en-US", DATE_FORMAT);
const timestampFormatter = new Intl.DateTimeFormat("en-US", DATE_TIME_FORMAT);

/** Calendar dates retain their day; timestamp dates follow the facility's Eastern clock. */
export function formatRoundingPlanDateDisplay(value?: string | null): string {
  if (!value) return ROUNDING_PLAN_NO_DATE_COPY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return ROUNDING_PLAN_NO_DATE_COPY;
  const formatter = /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateOnlyFormatter : timestampDateFormatter;
  return formatter.format(parsed);
}

/** Last-updated datetime column — date plus hour and minute. */
export function formatRoundingPlanDateTimeDisplay(value?: string | null): string {
  if (!value) return ROUNDING_PLAN_NO_TIME_COPY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return ROUNDING_PLAN_NO_TIME_COPY;
  return timestampFormatter.format(parsed);
}
