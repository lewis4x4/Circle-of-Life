/** Operator copy for the timeclock manager surfaces (COL-352). No em dashes. */

import { formatDurationHoursMinutes } from "@/lib/format/datetime";
import { formatKioskTime, type PunchType } from "@/lib/timeclock/kiosk-contract";
import type { CorrectionReason, CorrectionType, ExceptionType, StatusNow } from "@/lib/timeclock/compute";

export const TIMECLOCK_NAV_LABEL = "Timeclock";
export const TIMECLOCK_PAGE_TITLE = "Timeclock";
export const TIMECLOCK_PAGE_SUBTITLE = "Who is in the building now, this period's minutes, and the exceptions that need a manager.";
export const TIMECLOCK_MANAGER_ONLY = "Timeclock review is for facility administrators and above. Ask your facility administrator to review your punches or correct a missed punch.";
export const TIMECLOCK_NO_ROWS = "No punches in this period yet.";
export const TIMECLOCK_PAY_PERIOD_UNSET = "Set the pay period to export";
/** Shown beside the period while no pay period is set, so a one-week view is not read as a pay period (COL-659). */
export const TIMECLOCK_PERIOD_UNSET_WEEK_NOTE = "one week, pay period not set";
export const TIMECLOCK_EXPORT_LABEL = "Export payroll CSV";
export const TIMECLOCK_COMPARE_LABEL = "Compare with uPunch";
export const TIMECLOCK_FULL_HISTORY = "Full history";
export const TIMECLOCK_ACCESS_REMOVED = "Timeclock access removed";

export function resolveExceptionsToExport(count: number): string {
  return `Resolve ${count} exception${count === 1 ? "" : "s"} to export`;
}

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  missing_out: "Missing clock out",
  missing_meal_end: "Meal never ended",
  long_shift: "Shift longer than 16 hours",
  clock_skew: "Tablet clock differed from server",
  offline_capture: "Captured offline",
  rejected_offline_sync: "Offline punch refused at sync",
  short_turnaround: "Under 8 hours between shifts",
};

export const CORRECTION_TYPE_LABELS: Record<Exclude<CorrectionType, "acknowledge">, string> = {
  add_punch: "Add missing punch",
  void_punch: "Void punch",
  change_time: "Change punch time",
};

export const CORRECTION_REASON_LABELS: Record<CorrectionReason, string> = {
  missed_punch: "Missed punch",
  wrong_punch_type: "Wrong punch type",
  device_outage: "Device outage",
  manager_verified_time: "Manager verified time",
  duplicate: "Duplicate",
};

export const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  in: "In",
  out: "Out",
  meal_start: "Meal start",
  meal_end: "Meal end",
};

export function formatStatusNow(status: StatusNow, timeZone = "America/New_York"): string {
  if (status.state === "in") return status.since ? `In since ${formatKioskTime(status.since, timeZone)}` : "In";
  if (status.state === "meal") return "On meal";
  return "Out";
}

/** Manager-surface durations as h:mm ("7:05"), never a bare minute count (COL-659). */
export function formatMinutesCompact(minutes: number): string {
  return formatDurationHoursMinutes(minutes);
}

export function formatPeriodLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  };
  // endIso is exclusive; show the last calendar day.
  const [y, m, d] = endIso.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
  return `${fmt(startIso)} to ${fmt(last)}`;
}

export function formatDayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export function formatDateTime(at: Date | string, timeZone = "America/New_York"): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(date)} ${formatKioskTime(date, timeZone)}`;
}
