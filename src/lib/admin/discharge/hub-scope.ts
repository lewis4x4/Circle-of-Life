import {
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/** COL facilities — align scope with facility calendar boundaries. */
export const DISCHARGE_HUB_TZ = "America/New_York";

export type DischargeHubScope =
  | "today"
  | "week"
  | "month"
  | "quarter"
  | "all";

const SCOPE_KEYS: DischargeHubScope[] = [
  "today",
  "week",
  "month",
  "quarter",
  "all",
];

export function isDischargeHubScope(value: unknown): value is DischargeHubScope {
  return typeof value === "string" && (SCOPE_KEYS as string[]).includes(value);
}

export function dischargeHubScopeFromSearchParam(search: string | null): DischargeHubScope {
  return isDischargeHubScope(search) ? search : "month";
}

/**
 * UTC ISO inclusive lower bound for activity (`updated_at`, etc.).
 * `null` → all-time.
 */
export function dischargeHubScopeLowerBoundUtc(scope: DischargeHubScope): string | null {
  if (scope === "all") return null;
  const now = new Date();
  const zNow = toZonedTime(now, DISCHARGE_HUB_TZ);
  const zStart =
    scope === "today"
      ? startOfDay(zNow)
      : scope === "week"
        ? startOfWeek(zNow, { weekStartsOn: 0 })
        : scope === "month"
          ? startOfMonth(zNow)
          : startOfQuarter(zNow);
  return fromZonedTime(zStart, DISCHARGE_HUB_TZ).toISOString();
}
