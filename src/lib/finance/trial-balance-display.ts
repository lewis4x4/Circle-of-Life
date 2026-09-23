/**
 * What the trial balance says when it has no rows (COL-649). "No posted
 * entries in the selected range" is only true once the report has actually run
 * for the entity and dates on screen; before that, or with no legal entity, it
 * names what is missing instead.
 */
export type TrialBalanceRun = { entityId: string; dateFrom: string; dateTo: string };

export function trialBalanceEmptyCopy(input: {
  error: string | null;
  loading: boolean;
  entityId: string;
  dateFrom: string;
  dateTo: string;
  lastRun: TrialBalanceRun | null;
  rowCount: number;
}): string | null {
  if (input.error || input.loading || input.rowCount > 0) return null;
  if (!input.entityId) return "No legal entity is set up yet, so there is no trial balance to run.";
  const ranForScreen =
    input.lastRun !== null &&
    input.lastRun.entityId === input.entityId &&
    input.lastRun.dateFrom === input.dateFrom &&
    input.lastRun.dateTo === input.dateTo;
  if (!ranForScreen) return "Run the report to see results for this entity and date range.";
  return `No posted entries between ${input.dateFrom} and ${input.dateTo}.`;
}
