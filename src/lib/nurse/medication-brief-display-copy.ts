/**
 * Quiet Operator copy for nurse medication brief watchlist room labels.
 * The resident assurance payload has no room field — name the gap instead of a silent dash.
 */

import { canClaimAllClear } from "@/lib/metrics/metric-state";

export const NURSE_WATCHLIST_NO_ROOM_COPY = "No room posted";

const LEGACY_NO_ROOM_SENTINEL = "—";

/** Dose alert count — real zero remains numeric; unavailable count names the gap. */
export function formatDoseAlertCount(value: number | null): number | string {
  return value === null ? "None posted" : value;
}

/** Dashboard label for watchlist rows: posted rooms vs safety watch (no room on file). */
export function formatNurseWatchlistRoomLabel(room: string): string {
  const trimmed = room.trim();
  if (
    !trimmed ||
    trimmed === LEGACY_NO_ROOM_SENTINEL ||
    trimmed === NURSE_WATCHLIST_NO_ROOM_COPY
  ) {
    return "Safety watch";
  }
  return `Room ${room}`;
}

export const NURSE_COUNT_UNAVAILABLE_COPY = "Unavailable";

export type NurseStatCardCopy = {
  value: number | string;
  urgency: "critical" | "normal";
  subLabel: string;
};

/**
 * Stat card copy for a brief count. `null` means the read failed: show
 * "Unavailable" (warning-level) rather than a 0 that reads as an all-clear.
 */
export function describeBriefCount(
  value: number | null,
  copy: { positive: string; zero: string; unavailable: string },
): NurseStatCardCopy {
  if (value === null) {
    return { value: NURSE_COUNT_UNAVAILABLE_COPY, urgency: "critical", subLabel: copy.unavailable };
  }
  return value > 0
    ? { value, urgency: "critical", subLabel: copy.positive }
    : { value, urgency: "normal", subLabel: copy.zero };
}

/**
 * "All verified" goes through canClaimAllClear: the discrepancy read worked
 * and at least one count is on file. Zero discrepancies over zero counts is
 * "no counts on file", not a verified narcotics count (COL-649).
 */
export function describeControlledCounts(
  openDiscrepancies: number | null,
  countsOnFile: number | null,
): NurseStatCardCopy {
  const card = describeBriefCount(openDiscrepancies, {
    positive: "Discrepancies found",
    zero: "All verified",
    unavailable: "Controlled counts unavailable — check the count log",
  });
  if (openDiscrepancies === 0 && !canClaimAllClear({ scopeSize: countsOnFile, issueCount: openDiscrepancies })) {
    return countsOnFile === 0
      ? { value: "No counts", urgency: "normal", subLabel: "No controlled substance counts on file" }
      : { value: NURSE_COUNT_UNAVAILABLE_COPY, urgency: "critical", subLabel: "Count log unavailable — check the count log" };
  }
  return card;
}

export function describeMedErrors7d(value: number | null): NurseStatCardCopy {
  return describeBriefCount(value, {
    positive: "Reports and medication incidents",
    zero: "None reported",
    unavailable: "Med errors unavailable",
  });
}

export function describeEmarCompliance(pct: number | null, scheduledToday: number | null): NurseStatCardCopy {
  if (scheduledToday === 0) {
    return { value: "No doses", urgency: "normal", subLabel: "No eMAR doses scheduled today" };
  }
  if (pct === null) {
    return { value: NURSE_COUNT_UNAVAILABLE_COPY, urgency: "critical", subLabel: "eMAR compliance unavailable" };
  }
  return pct < 95
    ? { value: `${pct}%`, urgency: "critical", subLabel: "Below 95% threshold" }
    : { value: `${pct}%`, urgency: "normal", subLabel: "On target" };
}
