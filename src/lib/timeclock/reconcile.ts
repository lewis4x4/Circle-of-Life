/**
 * uPunch comparison for the parallel run (COL-352, spec 37 §9). The upload is
 * parsed in the browser and discarded; nothing here touches the network or
 * storage. Haven minutes come from compute.ts; uPunch hours are converted to
 * minutes (nearest minute for decimal hours, exact for H:MM) and grouped by
 * the same workweek boundary.
 */

import { csvEscapeCell } from "@/lib/csv-export";
import { facilityDayStart, workweekStartIso, type WeekTotals } from "@/lib/timeclock/compute";

export const MATCH_TOLERANCE_MINUTES = 5;

export type HoursFormat = "decimal" | "hmm";
export type IdentifierKind = "employee_number" | "name";

export type ColumnMapping = {
  identifier: string;
  date: string;
  hours: string;
  identifierKind: IdentifierKind;
  hoursFormat: HoursFormat;
};

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] };

/** RFC 4180 style parser: quoted cells, doubled quotes, CRLF or LF. First row is the header. */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0]!.map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, index) => {
      row[h] = (r[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

/** Decimal hours to the nearest minute, or H:MM exactly. Null when unreadable. */
export function hoursToMinutes(value: string, format: HoursFormat): number | null {
  const v = value.trim();
  if (!v) return null;
  if (format === "hmm") {
    const m = /^(\d{1,3}):([0-5]\d)$/.exec(v);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}

/** Accepts yyyy-mm-dd, m/d/yyyy, mm/dd/yy and returns yyyy-mm-dd or null. */
export function normalizeDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(v);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  return null;
}

export function normalizeName(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (v.includes(",")) {
    const [last, first] = v.split(",").map((s) => s.trim());
    return `${first ?? ""} ${last ?? ""}`.trim();
  }
  return v;
}

export function normalizeEmployeeNumber(value: string): string {
  return value.trim().toUpperCase();
}

export type HavenStaffWeeks = {
  staffId: string;
  name: string;
  employeeNumber: string | null;
  weeks: WeekTotals[];
};

export type ComparisonRow = {
  staffId: string | null;
  staffName: string;
  employeeNumber: string;
  workweekStart: string;
  havenMinutes: number;
  upunchMinutes: number;
  differenceMinutes: number;
  match: boolean;
};

export type ComparisonResult = {
  rows: ComparisonRow[];
  /** Uploaded rows whose identifier matched nobody, grouped by identifier. */
  unmatched: Array<{ identifier: string; rows: number; minutes: number }>;
  /** Uploaded rows that could not be read (bad date or hours). */
  skipped: number;
};

export function reconcileUpunch(input: { upload: ParsedCsv; mapping: ColumnMapping; haven: HavenStaffWeeks[]; toleranceMinutes?: number }): ComparisonResult {
  const tolerance = input.toleranceMinutes ?? MATCH_TOLERANCE_MINUTES;
  const byNumber = new Map<string, HavenStaffWeeks>();
  const byName = new Map<string, HavenStaffWeeks>();
  for (const person of input.haven) {
    if (person.employeeNumber) byNumber.set(normalizeEmployeeNumber(person.employeeNumber), person);
    byName.set(normalizeName(person.name), person);
  }

  const upunch = new Map<string, Map<string, number>>(); // staffId -> workweek -> minutes
  const unmatched = new Map<string, { rows: number; minutes: number }>();
  let skipped = 0;
  for (const row of input.upload.rows) {
    const rawId = row[input.mapping.identifier] ?? "";
    const dateIso = normalizeDate(row[input.mapping.date] ?? "");
    const minutes = hoursToMinutes(row[input.mapping.hours] ?? "", input.mapping.hoursFormat);
    if (!rawId.trim() || !dateIso || minutes === null) {
      skipped += 1;
      continue;
    }
    const person = input.mapping.identifierKind === "employee_number" ? byNumber.get(normalizeEmployeeNumber(rawId)) : byName.get(normalizeName(rawId));
    if (!person) {
      const key = rawId.trim();
      const entry = unmatched.get(key) ?? { rows: 0, minutes: 0 };
      entry.rows += 1;
      entry.minutes += minutes;
      unmatched.set(key, entry);
      continue;
    }
    const week = workweekStartIso(facilityDayStart(dateIso));
    const weeks = upunch.get(person.staffId) ?? new Map<string, number>();
    weeks.set(week, (weeks.get(week) ?? 0) + minutes);
    upunch.set(person.staffId, weeks);
  }

  const rows: ComparisonRow[] = [];
  for (const person of input.haven) {
    const uploaded = upunch.get(person.staffId) ?? new Map<string, number>();
    const weekKeys = new Set<string>([...person.weeks.map((w) => w.workweekStart), ...uploaded.keys()]);
    for (const week of [...weekKeys].sort()) {
      const haven = person.weeks.find((w) => w.workweekStart === week)?.workedMinutes ?? 0;
      const up = uploaded.get(week) ?? 0;
      if (haven === 0 && up === 0) continue;
      const difference = haven - up;
      rows.push({
        staffId: person.staffId,
        staffName: person.name,
        employeeNumber: person.employeeNumber ?? "",
        workweekStart: week,
        havenMinutes: haven,
        upunchMinutes: up,
        differenceMinutes: difference,
        match: Math.abs(difference) <= tolerance,
      });
    }
  }
  rows.sort((a, b) => a.staffName.localeCompare(b.staffName) || a.workweekStart.localeCompare(b.workweekStart));

  return {
    rows,
    unmatched: [...unmatched.entries()].map(([identifier, v]) => ({ identifier, rows: v.rows, minutes: v.minutes })).sort((a, b) => a.identifier.localeCompare(b.identifier)),
    skipped,
  };
}

export const COMPARISON_COLUMNS = ["employee_number", "staff_name", "workweek_start", "haven_minutes", "upunch_minutes", "difference_minutes", "match"] as const;

export function buildComparisonCsv(result: ComparisonResult): string {
  const header = COMPARISON_COLUMNS.join(",");
  // Numeric cells are written as-is: a signed integer cannot inject a formula, and the
  // shared escaper would prefix a negative difference with an apostrophe.
  const body = result.rows.map((r) =>
    [csvEscapeCell(r.employeeNumber), csvEscapeCell(r.staffName), r.workweekStart, String(r.havenMinutes), String(r.upunchMinutes), String(r.differenceMinutes), r.match ? "Match" : "Differs"].join(","),
  );
  const extra = result.unmatched.map((u) => ["", csvEscapeCell(u.identifier), "", "", String(u.minutes), "", "Unmatched"].join(","));
  return [header, ...body, ...extra].join("\r\n") + "\r\n";
}
