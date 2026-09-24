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

/** Under All facilities the tiles are an org-wide rollup; say so instead of gating them. */
export function complianceRollupScopeCopy(): string {
  return "Tile totals cover all your facilities. Findings, the compliance score and preparedness below are kept per building.";
}

/** Why the per-building sections of the hub need one facility (COL-651 gate reason). */
export function complianceFacilityGateReason(): string {
  return "Survey deficiencies, the compliance score, emergency preparedness and reminders belong to one building.";
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
  return "Survey visit sessions run per building; choose one to see its status.";
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
 * State for one hub KPI tile. A failed snapshot is "Unavailable", never 0
 * (COL-649). The hub passes `facilityReady: true` for its tiles because the
 * snapshot rolls up across facilities under All facilities (COL-651).
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

/**
 * Header alert for a low compliance-rule pass rate. The threshold is the
 * `compliance.score_alert_below_pct` operating rule (COL-710), off unless an
 * owner or org admin sets it; the old fixed `score < 75` trigger was removed
 * in COL-649. Null when the rule is off, unreadable, or the score is not in.
 */
export function complianceScoreAlert(
  score: { percentage: number } | null,
  rule: { off: true } | { off: false; belowPct: number } | null,
): string | null {
  if (!score || !rule || rule.off) return null;
  if (score.percentage >= rule.belowPct) return null;
  return `Compliance pass rate is ${score.percentage}%, below the ${rule.belowPct}% alert level.`;
}

/** Header alert for overdue emergency drills and checks; null when none are overdue. */
export function complianceOverdueEmergencyAlert(items: ReadonlyArray<{ overdue: boolean }>): string | null {
  const overdue = items.filter((i) => i.overdue).length;
  if (overdue === 0) return null;
  return overdue === 1
    ? "1 emergency drill or check is overdue."
    : `${overdue} emergency drills or checks are overdue.`;
}
