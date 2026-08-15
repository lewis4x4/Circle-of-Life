/**
 * Quiet Operator copy for the new discharge / med rec draft page.
 * Missing resident joins, blank posted names, and unparseable dates name real gaps —
 * never fabricate person labels or timestamps.
 */

import { differenceInCalendarDays, format, parseISO } from "date-fns";

export const DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const DISCHARGE_NEW_NO_NAME_POSTED_COPY = "No name posted";
export const DISCHARGE_NEW_NO_DATE_COPY = "No date posted";

export type DischargeNewResidentNameJoin = {
  first_name: string | null;
  last_name: string | null;
} | null | undefined;

const DISCHARGE_NEW_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

function trimName(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isPlaceholderResidentName(first: string, last: string): boolean {
  const combined = [first, last].filter((part) => part.length > 0).join(" ");
  if (!combined) return true;
  return DISCHARGE_NEW_PLACEHOLDER_RESIDENT_NAMES.has(combined.toLowerCase());
}

/** Resident label on the new med rec draft page — "Last, First" when posted. */
export function formatDischargeNewResidentLabel(
  resident: DischargeNewResidentNameJoin,
): string {
  if (!resident) return DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY;

  const first = trimName(resident.first_name);
  const last = trimName(resident.last_name);

  if (isPlaceholderResidentName(first, last)) return DISCHARGE_NEW_NO_NAME_POSTED_COPY;

  if (last && first) return `${last}, ${first}`;
  if (last) return last;
  if (first) return first;

  return DISCHARGE_NEW_NO_NAME_POSTED_COPY;
}

const DISCHARGE_NEW_PLACEHOLDER_STARTED_VALUES = new Set(["—", "unknown"]);

function parseDischargeNewStartedAt(iso: string | null | undefined): Date | null {
  const trimmed = (iso ?? "").trim();
  if (!trimmed) return null;
  if (DISCHARGE_NEW_PLACEHOLDER_STARTED_VALUES.has(trimmed.toLowerCase())) return null;

  try {
    const parsed = parseISO(trimmed.length > 10 ? trimmed : `${trimmed}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Started timestamp on in-progress med rec draft cards — formatted date or a named gap. */
export function formatDischargeNewStartedLabel(iso: string | null | undefined): string {
  const parsed = parseDischargeNewStartedAt(iso);
  if (!parsed) return DISCHARGE_NEW_NO_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}

/** Calendar days since draft start; 0 when the posted timestamp is missing or unparseable. */
export function getDischargeNewStartedDaysAgo(
  iso: string | null | undefined,
  referenceDate = new Date(),
): number {
  const parsed = parseDischargeNewStartedAt(iso);
  if (!parsed) return 0;
  return differenceInCalendarDays(referenceDate, parsed);
}
