/**
 * The operating day this job records, and whether this invocation is the one
 * that should record it.
 *
 * Resident-days are counted on the midnight census: the residents in census
 * when an operating day begins are that day's resident-day. So the job runs in
 * the 00:00 hour in America/New_York and stamps the day it is standing in.
 *
 * pg_cron runs in UTC (the scheduled-job monitor requires it), and the offset
 * between UTC and America/New_York moves twice a year. The schedule therefore
 * fires at both 04:30 and 05:30 UTC and this gate lets exactly one of them
 * through — the one that is 00:30 where the facilities are. Same pattern as the
 * executive refresh pipeline in docs/designs/2026-05-24-hygiene-pipeline-plan.md.
 */

/** Wall-clock date and hour where the facilities are, not where the server is. */
export function facilityWallClock(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour)) {
    throw new Error("Unable to read the facilities' wall clock");
  }
  return { date, hour };
}

/** The hour the midnight census belongs to. */
export const MIDNIGHT_CENSUS_HOUR = 0;

export type CensusRunDecision =
  | { run: true; logDate: string | null; reason: "midnight_census_hour" | "explicit_request" }
  | { run: false; logDate: null; reason: string };

/**
 * An operator asking for a specific day, or a re-run forced by hand, is an
 * explicit instruction and proceeds. An unattended invocation only proceeds in
 * the midnight hour, so the twin UTC schedules do not record the same day twice
 * against two different moments.
 *
 * `logDate: null` means "let the database pick today where the facilities are",
 * which keeps one definition of the operating day rather than two.
 */
export function decideCensusRun(input: {
  now: Date;
  requestedLogDate?: string | null;
  force?: boolean;
}): CensusRunDecision {
  if (input.requestedLogDate) {
    return { run: true, logDate: input.requestedLogDate, reason: "explicit_request" };
  }
  if (input.force) {
    return { run: true, logDate: null, reason: "explicit_request" };
  }
  const { hour } = facilityWallClock(input.now);
  if (hour !== MIDNIGHT_CENSUS_HOUR) {
    return {
      run: false,
      logDate: null,
      reason:
        `Not the ${MIDNIGHT_CENSUS_HOUR}:00 hour in America/New_York (local hour ${hour}); ` +
        `the other scheduled invocation records this day.`,
    };
  }
  return { run: true, logDate: null, reason: "midnight_census_hour" };
}

/** YYYY-MM-DD or nothing. A malformed date is refused, never coerced. */
export function parseRequestedLogDate(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: "log_date must be YYYY-MM-DD" };
  }
  return { ok: true, value };
}
