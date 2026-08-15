/**
 * Quiet Operator copy for workers' comp list cells (`/admin/insurance/workers-comp`).
 * Reflects real data gaps — never fabricates dates, reserves, or paid amounts.
 */

/** Return-to-work column — posted ISO date or explicit missing copy. */
export function workersCompReturnToWorkDateCopy(date: string | null | undefined): string {
  if (date) return date;
  return "No return-to-work date posted";
}
