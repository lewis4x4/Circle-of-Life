/**
 * Printed care-event artefacts (spec 07A Appendix A): the incident form in
 * COL's paper layout, the physician notification sheet that goes out by fax,
 * and the Incident Reports Log in the paper log's column order.
 *
 * Two rules hold for all three.
 *
 * The audit row is written **before** anything renders. A sheet handed to a
 * physician or a surveyor always has a row saying what it was. If the row
 * cannot be written, the view renders nothing at all.
 *
 * The audit payload carries ids, a kind and a range, never a name. The sheets
 * themselves carry PHI by design and never leave the browser except through
 * the printer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { enumLabel } from "@/lib/display/enum-label";

type Client = SupabaseClient<Database>;

export type CareEventPrintKind = "incident_form" | "physician_sheet" | "incident_reports_log" | "taxonomy_packet";

/** Shown in place of the sheet when the print could not be recorded. */
export const PRINT_NOT_RECORDED_LINE = "Print could not be recorded. Try again.";

/**
 * Records the print. Resolves to the audit row id, or throws — the caller must
 * treat a throw as "render nothing".
 */
export async function recordCareEventPrint(
  supabase: Client,
  input: {
    kind: CareEventPrintKind;
    careEventId?: string | null;
    facilityId?: string | null;
    from?: string | null;
    to?: string | null;
  },
): Promise<string> {
  const result = await supabase.rpc("care_event_print_record", {
    p_print_kind: input.kind,
    p_care_event_id: input.careEventId ?? null,
    p_facility_id: input.facilityId ?? null,
    p_from: input.from ?? null,
    p_to: input.to ?? null,
  });
  if (result.error) throw result.error;
  if (typeof result.data !== "string" || result.data.length === 0) {
    throw new Error("print: the print was not recorded");
  }
  return result.data;
}

/**
 * The footer every page carries:
 * `Printed from Haven by {name} on {date time} Eastern · {facility}`.
 *
 * `name` is typed by the administrator at print time and is never stored; it is
 * not read from the session, because the person at the printer is not always
 * the person signed in.
 *
 * The COL-354 decision also asked for `Page N of M` in this line. It is not
 * here, deliberately. A string in the body renders once, in one place, and
 * cannot know the page it lands on, so a literal "Page N of M" is what would
 * print on every sheet. Page numbering belongs in an `@page` margin box, which
 * `globals.css` now declares; engines that implement it number the pages, and
 * Chrome falls back to the page numbers its own print dialog adds. Better an
 * honest line plus a real mechanism than a decided phrase that lies on paper.
 */
export function printFooterLine(input: {
  printedBy: string;
  printedAt: Date;
  facilityName: string;
  timeZone?: string;
}): string {
  const name = input.printedBy.trim() || "________________";
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone ?? "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(input.printedAt);
  return `Printed from Haven by ${name} on ${stamp} Eastern · ${input.facilityName}`;
}

/** A blank line where the paper form expects a value Haven does not hold. */
export const PRINT_BLANK = "________________________";

export function printValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : PRINT_BLANK;
}

/** Yes / No / a blank, the way the paper form's checkboxes read. */
export function printYesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return PRINT_BLANK;
}

export function printDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return PRINT_BLANK;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return PRINT_BLANK;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date, not an instant. `v_incident_reports_log.log_date` is already
 * evaluated in the facility's clock, and the range bounds are days the operator
 * typed. Parsing "2026-09-16" with `new Date` gives UTC midnight, which renders
 * as the 15th in Eastern and dates every log row one day early.
 */
export function printDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return PRINT_BLANK;
  const calendar = CALENDAR_DATE_RE.exec(iso);
  if (calendar) {
    const [, year, month, day] = calendar;
    const asUtc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (Number.isNaN(asUtc.getTime())) return PRINT_BLANK;
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(asUtc);
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return PRINT_BLANK;
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
}

/**
 * The paper Incident Reports Log's column order, exactly. `v_incident_reports_log`
 * produces every one of these; the order here is the log's, not the view's.
 */
export const INCIDENT_REPORTS_LOG_COLUMNS = [
  { key: "log_date", label: "Date" },
  { key: "room", label: "Room" },
  { key: "resident", label: "Resident" },
  { key: "fall", label: "Fall" },
  { key: "bruise", label: "Bruise" },
  { key: "scrapes_or_burn", label: "Scrapes or burn" },
  { key: "cut_laceration_puncture", label: "Cut, laceration or puncture" },
  { key: "non_apparent", label: "Non-apparent" },
  { key: "other", label: "Other" },
  { key: "contributing_factors", label: "Contributing factors" },
  { key: "shift", label: "Shift" },
] as const;

export type IncidentReportsLogColumnKey = (typeof INCIDENT_REPORTS_LOG_COLUMNS)[number]["key"];

/** An X where the paper log has a tick, and an empty cell otherwise. */
export function printTick(value: boolean | null | undefined): string {
  return value === true ? "X" : "";
}

const SHIFT_WORDS: Record<string, string> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
};

export function printShift(shift: string | null | undefined): string {
  if (!shift) return "";
  return SHIFT_WORDS[shift] ?? enumLabel(shift);
}

/**
 * A coded list (contributing factors, corrective chips) as words. The paper
 * form was filled in by hand, so a printed "improper_footwear" is the one thing
 * on the sheet that could only have come from a database.
 */
export function printCodeList(codes: readonly string[] | null | undefined): string {
  if (!codes || codes.length === 0) return PRINT_BLANK;
  return codes
    .map((code) => enumLabel(code))
    .join("; ");
}

/** One coded value as words: `right_hip` is not something a physician reads. */
export function printCode(code: string | null | undefined): string {
  const trimmed = code?.trim();
  if (!trimmed) return PRINT_BLANK;
  return enumLabel(trimmed);
}

export function describePrintError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/forbidden/i.test(message)) return "This print is for the Administrator or Assistant.";
  if (/unknown print kind/i.test(message)) return PRINT_NOT_RECORDED_LINE;
  return PRINT_NOT_RECORDED_LINE;
}
