/**
 * Quiet Operator copy for rounding completion reports (`/admin/rounding/reports`).
 * Empty windows name the gap — never fabricate rates or counts.
 * Missing facility scope names the gap — never interpolate legacy "selected facility" copy.
 */

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "./observation-plan-display-copy";

export { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY as ROUNDING_REPORTS_SELECT_FACILITY_FIRST_COPY };

export const ROUNDING_REPORT_NO_VALUE_COPY = "No value posted";
export const ROUNDING_REPORTS_NO_FACILITY_NAME_COPY = "No facility name posted";

export type RoundingReportsFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header facility scope — never fabricates a facility name. */
export function resolveRoundingReportsFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): RoundingReportsFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

const ROUNDING_REPORTS_SUBTITLE_PREFIX =
  "Pre-configured exportable summaries for surveyor packets, internal QA, and executive review";

/** Page header subtitle — never interpolates "selected facility". */
export function formatRoundingReportsPageSubtitle(scope: RoundingReportsFacilityScope): string {
  if (scope.kind === "unscoped") {
    return `${ROUNDING_REPORTS_SUBTITLE_PREFIX}. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  if (scope.kind === "missing_name") {
    return `${ROUNDING_REPORTS_SUBTITLE_PREFIX}. ${ROUNDING_REPORTS_NO_FACILITY_NAME_COPY}.`;
  }
  return `${ROUNDING_REPORTS_SUBTITLE_PREFIX} at ${scope.name}.`;
}

/** KPI value on the completion reports strip — names empty windows, preserves posted zeros. */
export function formatRoundingReportKpiValue(hasData: boolean, formatted: string): string {
  if (!hasData) return ROUNDING_REPORT_NO_VALUE_COPY;
  return formatted;
}
