/**
 * Quiet Operator copy for resident roster "Updated" column.
 * Missing or unparseable timestamps name the gap — never invent dates or silent em dashes.
 */

export const RESIDENT_ROSTER_NO_DATE_COPY = "No date posted";
export const RESIDENT_ROSTER_NO_ACUITY_COPY = "No acuity posted";
export const RESIDENT_ROSTER_NO_ADL_COPY = "No ADL posted";
/** Location gaps, shared by the roster and the resident overview so both name them the same way. */
export const RESIDENT_NO_UNIT_COPY = "No unit on file";
export const RESIDENT_NO_BED_COPY = "No bed linked";

const statusSinceFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * COL-750: "since Sep 22, 3:10 PM" (Eastern) for an away status, dated when it
 * actually began. Null when the timestamp cannot be read.
 */
export function formatRosterStatusSince(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `since ${statusSinceFormatter.format(parsed)}`;
}
