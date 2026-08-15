/**
 * Quiet Operator copy for the admin live rounding board (`/admin/rounding/live`).
 * Missing shift types name real gaps — never fabricate shift labels.
 */

export const LIVE_ROUNDING_NO_SHIFT_TYPE_COPY = "No shift posted";

export const LIVE_ROUNDING_NO_DUE_DATE_COPY = "No date posted";

const LIVE_ROUNDING_LEGACY_UNKNOWN_DUE = "Unknown";
const LIVE_ROUNDING_EM_DASH = "—";

/** Shift type cell on a live rounding task row — full phrase, no dangling "shift". */
export function formatLiveRoundingShiftType(shiftType: string | null | undefined): string {
  const trimmed = shiftType?.trim();
  if (!trimmed) return LIVE_ROUNDING_NO_SHIFT_TYPE_COPY;
  return `${trimmed} shift`;
}

/** Due-at cell on a live rounding task row — relative time or named gap when unposted. */
export function formatLiveRoundingDueLabel(
  value: string | null | undefined,
  now = Date.now(),
): string {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    trimmed === LIVE_ROUNDING_EM_DASH ||
    trimmed === LIVE_ROUNDING_LEGACY_UNKNOWN_DUE
  ) {
    return LIVE_ROUNDING_NO_DUE_DATE_COPY;
  }

  const dueAt = new Date(trimmed);
  if (Number.isNaN(dueAt.getTime())) return LIVE_ROUNDING_NO_DUE_DATE_COPY;

  const diff = dueAt.getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return "Now";
  if (diff > 0) return `in ${mins}m`;
  return `${mins}m ago`;
}
