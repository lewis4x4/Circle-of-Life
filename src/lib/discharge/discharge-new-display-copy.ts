/**
 * Quiet Operator copy for the new discharge / med rec draft page.
 * Missing resident joins and blank posted names name real gaps — never fabricate person labels.
 */

export const DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const DISCHARGE_NEW_NO_NAME_POSTED_COPY = "No name posted";

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
