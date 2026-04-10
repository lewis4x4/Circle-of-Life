import { toDate } from "date-fns-tz";

/** Florida facility wall times for pay-period filtering (matches AGENTS.md). */
const PAY_PERIOD_TZ = "America/New_York";

/**
 * Inclusive pay period as UTC instants for `time_records.clock_in` filtering.
 * `period_start` / `period_end` are `yyyy-MM-dd` date strings from `payroll_export_batches`.
 */
export function payPeriodClockBoundsUtc(periodStart: string, periodEnd: string): { startIso: string; endIso: string } {
  const start = toDate(`${periodStart}T00:00:00`, { timeZone: PAY_PERIOD_TZ });
  const end = toDate(`${periodEnd}T23:59:59.999`, { timeZone: PAY_PERIOD_TZ });
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
