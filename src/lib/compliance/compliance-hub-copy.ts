/**
 * Quiet Operator copy for the compliance hub when dates, scores, or snapshot fields are absent.
 * Copy reflects real data gaps — never fabricates survey scores, due dates, or deficiencies.
 */

import {
  canClaimAllClear,
  metricLoading,
  metricNeedsFacility,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";

/** Label for a POC submission due date — never a silent dash. */
export function compliancePocDueDateLabel(dueDate: string | null): string {
  if (dueDate) return dueDate;
  return "No POC due date posted";
}

/** Full deficiency-row line for plan-of-correction due date. */
export function compliancePocDueLine(dueDate: string | null): string {
  return `POC Due: ${compliancePocDueDateLabel(dueDate)}`;
}

/** KPI tile body while compliance snapshot metrics are loading. */
export function complianceSnapshotTileLoadingCopy(): string {
  return "Loading metrics…";
}

/** Survey visit status box while snapshot is loading. */
export function complianceSurveyVisitLoadingCopy(): string {
  return "Checking survey visit status…";
}

/** Survey visit status when snapshot loaded and no active session. */
export function complianceSurveyVisitInactiveCopy(): string {
  return "No active session.";
}

/** One-line gap when no facility is selected in the header scope. */
export function complianceFacilityNotSelectedCopy(): string {
  return "Select a facility to load compliance data.";
}

/** One-line gap when rule-based compliance score is absent for the facility. */
export function complianceScoreEmptyCopy(): string {
  return "Survey score not loaded for this facility";
}

/** Compliance score card while the latest scan is loading. */
export function complianceScoreLoadingCopy(): string {
  return "Loading compliance score…";
}

/** Survey visit status when no facility is scoped in the header selector. */
export function complianceSurveyVisitNotScopedCopy(): string {
  return "Select a facility to check survey visit status.";
}

/** Survey visit status line from snapshot — never fabricates inactive when unscoped. */
export function complianceSurveyVisitStatusCopy(surveyVisitActive: boolean | null): string {
  if (surveyVisitActive === null) return complianceSurveyVisitNotScopedCopy();
  if (surveyVisitActive) return "● Session active for this facility.";
  return complianceSurveyVisitInactiveCopy();
}

/** KPI tile display value — number when loaded, explicit copy while loading. */
export function complianceSnapshotTileDisplay(value: number | null): string | number {
  if (value === null) return complianceSnapshotTileLoadingCopy();
  return value;
}

/**
 * State for one hub KPI tile. The hub is per-facility (its own banner says
 * "Select a facility"), so with no facility the tile names that instead of a
 * 0; a failed snapshot is "Unavailable", never 0 (COL-649).
 */
export function complianceTileState(input: {
  facilityReady: boolean;
  loading: boolean;
  error: string | null;
  value: number | null | undefined;
}): MetricState<number> {
  if (!input.facilityReady) return metricNeedsFacility();
  if (input.loading) return metricLoading();
  if (input.error || typeof input.value !== "number") return metricUnavailable();
  return metricValue(input.value);
}

/** Heading shown only when `complianceDeficienciesAllClear` is true. */
export const COMPLIANCE_DEFICIENCIES_ALL_CLEAR_TITLE = "All Clear";

/** "All Clear" on open deficiencies only after a successful read for a chosen facility. */
export function complianceDeficienciesAllClear(input: {
  facilityReady: boolean;
  loading: boolean;
  error: string | null;
  openCount: number;
}): boolean {
  return canClaimAllClear({
    loading: input.loading,
    error: input.error,
    scopeReady: input.facilityReady,
    scopeSize: input.facilityReady ? 1 : 0,
    issueCount: input.openCount,
  });
}

/** Header alert for overdue emergency drills and checks; null when none are overdue. */
export function complianceOverdueEmergencyAlert(items: ReadonlyArray<{ overdue: boolean }>): string | null {
  const overdue = items.filter((i) => i.overdue).length;
  if (overdue === 0) return null;
  return overdue === 1
    ? "1 emergency drill or check is overdue."
    : `${overdue} emergency drills or checks are overdue.`;
}
