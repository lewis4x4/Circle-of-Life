import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/** COL facilities anchor per foundation spec — hub scope aligns to facility calendar boundaries. */
export const ADMISSIONS_HUB_TZ = "America/New_York";

export type AdmissionsHubScope = "today" | "week" | "month" | "all";

const SCOPE_KEYS: AdmissionsHubScope[] = ["today", "week", "month", "all"];

export function isAdmissionsHubScope(value: unknown): value is AdmissionsHubScope {
  return typeof value === "string" && (SCOPE_KEYS as string[]).includes(value);
}

export function admissionsHubScopeFromSearchParam(search: string | null): AdmissionsHubScope {
  return isAdmissionsHubScope(search) ? search : "today";
}

/**
 * UTC ISO inclusive lower bound for `updated_at` / activity timestamps.
 * `null` → all-time (no lower filter).
 */
export function admissionsHubActivityLowerBoundUtc(scope: AdmissionsHubScope): string | null {
  if (scope === "all") return null;
  const now = new Date();
  const zNow = toZonedTime(now, ADMISSIONS_HUB_TZ);
  const zStart =
    scope === "today"
      ? startOfDay(zNow)
      : scope === "week"
        ? startOfWeek(zNow, { weekStartsOn: 0 })
        : startOfMonth(zNow);
  return fromZonedTime(zStart, ADMISSIONS_HUB_TZ).toISOString();
}

/**
 * UTC ISO inclusive upper bound for calendar period (end-of-day/week/month wall clock NY).
 */
export function admissionsHubCalendarUpperBoundUtc(scope: AdmissionsHubScope): string | null {
  if (scope === "all") return null;
  const now = new Date();
  const zNow = toZonedTime(now, ADMISSIONS_HUB_TZ);
  const zEnd =
    scope === "today"
      ? endOfDay(zNow)
      : scope === "week"
        ? endOfWeek(zNow, { weekStartsOn: 0 })
        : endOfMonth(zNow);
  return fromZonedTime(zEnd, ADMISSIONS_HUB_TZ).toISOString();
}
