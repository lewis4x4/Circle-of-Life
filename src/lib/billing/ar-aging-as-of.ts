/**
 * Point-in-time AR aging helpers — compares invoice due dates to an explicit “as-of” calendar date.
 * Snapshot history engine can swap implementations later without changing hub UI contracts.
 */

/** Today (calendar) in America/New_York as YYYY-MM-DD */
export function billingNyTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Whole days past due as of end of `asOfIso` (YYYY-MM-DD). Mirrors legacy hub semantics using date-only midnight parsing. */
export function daysPastDueAsOf(dueDateIso: string, asOfIso: string): number {
  if (!dueDateIso || !asOfIso) return 0;
  const due = new Date(`${dueDateIso.slice(0, 10)}T23:59:59`);
  const asOf = new Date(`${asOfIso.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(asOf.getTime())) return 0;
  const ms = asOf.getTime() - due.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
