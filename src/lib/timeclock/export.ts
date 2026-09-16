/**
 * Payroll timecard CSV (COL-352, spec 37 §8). One row per staff member per
 * workweek in the pay period. Integer minutes, no rounding. The export is a
 * gate, not a submission: ADP alignment is COL-357.
 */

import { csvEscapeCell } from "@/lib/csv-export";
import { facilityDayStart, type Timesheet } from "@/lib/timeclock/compute";
import { TIMECLOCK_PAY_PERIOD_UNSET, resolveExceptionsToExport } from "@/lib/timeclock/display-copy";

export const TIMECARD_COLUMNS = [
  "employee_number",
  "staff_name",
  "period_start",
  "period_end",
  "workweek_start",
  "regular_minutes",
  "overtime_minutes",
  "meal_minutes",
  "exception_count",
  "unapproved_exceptions",
] as const;

export type TimecardRow = Record<(typeof TIMECARD_COLUMNS)[number], string>;

export type TimecardInput = {
  periodStartIso: string;
  /** Exclusive end; the CSV prints the inclusive last day. */
  periodEndIso: string;
  staff: Array<{ staffId: string; name: string; employeeNumber: string | null; sheet: Timesheet }>;
};

export function slugifyFacilityName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "facility";
}

export function timecardFilename(facilityName: string, periodStartIso: string): string {
  return `haven-timecard-${slugifyFacilityName(facilityName)}-${periodStartIso}.csv`;
}

export function inclusivePeriodEnd(periodEndIso: string): string {
  const [y, m, d] = periodEndIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

export function buildTimecardRows(input: TimecardInput): TimecardRow[] {
  const periodEnd = inclusivePeriodEnd(input.periodEndIso);
  const rows: TimecardRow[] = [];
  for (const person of input.staff) {
    for (const week of person.sheet.weeks) {
      const weekExceptions = person.sheet.exceptions.filter((e) => weekOf(person.sheet, e.at) === week.workweekStart);
      rows.push({
        employee_number: person.employeeNumber ?? "",
        staff_name: person.name,
        period_start: input.periodStartIso,
        period_end: periodEnd,
        workweek_start: week.workweekStart,
        regular_minutes: String(week.regularMinutes),
        overtime_minutes: String(week.overtimeMinutes),
        meal_minutes: String(week.mealMinutes),
        exception_count: String(weekExceptions.length),
        unapproved_exceptions: String(weekExceptions.filter((e) => !e.acknowledged).length),
      });
    }
  }
  return rows;
}

/** Workweek start (yyyy-MM-dd) an instant belongs to, using the sheet's own week list (compute.ts owns the boundary rule). */
function weekOf(sheet: Timesheet, at: Date): string | null {
  let match: string | null = null;
  for (const week of sheet.weeks) {
    if (facilityDayStart(week.workweekStart).getTime() <= at.getTime()) match = week.workweekStart;
  }
  return match;
}

export function buildTimecardCsv(rows: TimecardRow[]): string {
  const header = TIMECARD_COLUMNS.join(",");
  const body = rows.map((row) => TIMECARD_COLUMNS.map((column) => csvEscapeCell(row[column])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

export type ExportGate = { blocked: false } | { blocked: true; reason: string; code: "pay_period_unset" | "open_exceptions" };

/** The export is blocked while the pay period is unset or any exception in the period lacks an acknowledgment. */
export function exportGate(input: { payPeriodSet: boolean; unresolvedExceptions: number }): ExportGate {
  if (!input.payPeriodSet) return { blocked: true, reason: TIMECLOCK_PAY_PERIOD_UNSET, code: "pay_period_unset" };
  if (input.unresolvedExceptions > 0) return { blocked: true, reason: resolveExceptionsToExport(input.unresolvedExceptions), code: "open_exceptions" };
  return { blocked: false };
}
