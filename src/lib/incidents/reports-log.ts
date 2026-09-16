/**
 * The Incident Reports Log (spec 07A §6.2 `v_incident_reports_log`, §7 Tier 3,
 * §9 item 10, Appendix A). The paper log's columns in the paper log's order,
 * plus the level word as the last column. Booleans render as a check mark or
 * nothing, never "true". No PHI in file names: facility slug and month only.
 */

import { fromZonedTime } from "date-fns-tz";

import { csvEscapeCell } from "@/lib/csv-export";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";
import type { Database } from "@/types/database";

export type IncidentReportsLogRow = Database["public"]["Views"]["v_incident_reports_log"]["Row"];

export const INCIDENT_REPORTS_LOG_COLUMNS = [
  "Date",
  "Room",
  "Resident",
  "Fall",
  "Bruise",
  "Scrapes or burn",
  "Cut, laceration, or puncture",
  "Non-apparent",
  "Other",
  "Contributing factors",
  "Shift",
  "Level",
] as const;

export type IncidentReportsLogColumn = (typeof INCIDENT_REPORTS_LOG_COLUMNS)[number];

/** Columns whose cells are a check mark or empty. */
export const INCIDENT_REPORTS_LOG_MARK_COLUMNS: ReadonlySet<IncidentReportsLogColumn> = new Set([
  "Fall",
  "Bruise",
  "Scrapes or burn",
  "Cut, laceration, or puncture",
  "Non-apparent",
  "Other",
]);

export const INCIDENT_REPORTS_LOG_CHECK_MARK = "✓";
export const INCIDENT_REPORTS_LOG_NO_DATE_COPY = "No date posted";
export const INCIDENT_REPORTS_LOG_NO_ROOM_COPY = "No room posted";
export const INCIDENT_REPORTS_LOG_NO_RESIDENT_COPY = "No resident posted";

const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function reportsLogMark(value: boolean | null | undefined): string {
  return value === true ? INCIDENT_REPORTS_LOG_CHECK_MARK : "";
}

export function reportsLogShiftWord(shift: IncidentReportsLogRow["shift"]): string {
  switch (shift) {
    case "day":
      return "Day";
    case "evening":
      return "Evening";
    case "night":
      return "Night";
    default:
      return "";
  }
}

/** "Sep 14, 2026" from the view's facility-local `yyyy-mm-dd`; no zone math, the view already did it. */
export function reportsLogDateLabel(logDate: string | null | undefined): string {
  const match = logDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(logDate) : null;
  if (!match) return INCIDENT_REPORTS_LOG_NO_DATE_COPY;
  const noon = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(noon.getTime())) return INCIDENT_REPORTS_LOG_NO_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(noon);
}

/** One row's cells in column order; the screen table and the CSV both use this. */
export function incidentReportsLogCells(row: IncidentReportsLogRow): string[] {
  return [
    reportsLogDateLabel(row.log_date),
    row.room?.trim() || INCIDENT_REPORTS_LOG_NO_ROOM_COPY,
    row.resident?.trim() || INCIDENT_REPORTS_LOG_NO_RESIDENT_COPY,
    reportsLogMark(row.fall),
    reportsLogMark(row.bruise),
    reportsLogMark(row.scrapes_or_burn),
    reportsLogMark(row.cut_laceration_puncture),
    reportsLogMark(row.non_apparent),
    reportsLogMark(row.other),
    row.contributing_factors?.trim() ?? "",
    reportsLogShiftWord(row.shift),
    row.severity == null ? "" : formatLevelWord(row.severity),
  ];
}

export function buildIncidentReportsLogCsv(rows: readonly IncidentReportsLogRow[]): string {
  const header = INCIDENT_REPORTS_LOG_COLUMNS.map((column) => csvEscapeCell(column)).join(",");
  const body = rows.map((row) => incidentReportsLogCells(row).map((cell) => csvEscapeCell(cell)).join(","));
  return [header, ...body].join("\r\n");
}

export type MonthRange = {
  yearMonth: string;
  /** "September 2026" */
  label: string;
  /** First calendar day of the month, `yyyy-mm-dd`, for the view's `log_date`. */
  firstDate: string;
  /** Last calendar day of the month, `yyyy-mm-dd`, inclusive. */
  lastDate: string;
  /** Midnight on the first day in the facility zone, as UTC. */
  startIso: string;
  /** Midnight on the first day of the next month in the facility zone, as UTC (exclusive). */
  endIso: string;
  previousYearMonth: string;
  nextYearMonth: string;
};

export function isYearMonth(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = YEAR_MONTH_RE.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** Current `yyyy-mm` in the facility zone. */
export function currentYearMonth(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(now);
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthLabel(yearMonth: string): string {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  const noon = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(noon);
}

/** Month bounds in the facility zone: calendar dates for `log_date` and UTC instants for `occurred_at`. */
export function monthRange(yearMonth: string, timeZone: string): MonthRange {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const nextYearMonth = shiftYearMonth(yearMonth, 1);
  const firstDate = `${yearMonth}-01`;
  return {
    yearMonth,
    label: monthLabel(yearMonth),
    firstDate,
    lastDate: `${yearMonth}-${String(daysInMonth).padStart(2, "0")}`,
    startIso: fromZonedTime(`${firstDate}T00:00:00`, timeZone).toISOString(),
    endIso: fromZonedTime(`${nextYearMonth}-01T00:00:00`, timeZone).toISOString(),
    previousYearMonth: shiftYearMonth(yearMonth, -1),
    nextYearMonth,
  };
}

/** `incident-reports-log-<facility-slug>-<yyyy-mm>.csv`; the facility name is the only identifier. */
export function incidentReportsLogFileName(facilityName: string | null | undefined, yearMonth: string): string {
  const slug =
    (facilityName ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "facility";
  return `incident-reports-log-${slug}-${yearMonth}.csv`;
}
