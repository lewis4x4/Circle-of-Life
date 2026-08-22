/**
 * Quiet Operator copy for the compliance hub when dates, scores, or snapshot fields are absent.
 * Copy reflects real data gaps — never fabricates survey scores, due dates, or deficiencies.
 */

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
