/**
 * Quiet Operator copy for the admin live rounding board (`/admin/rounding/live`).
 * Missing shift types name real gaps — never fabricate shift labels.
 */

export const LIVE_ROUNDING_NO_SHIFT_TYPE_COPY = "No shift posted";

/** Shift type cell on a live rounding task row — full phrase, no dangling "shift". */
export function formatLiveRoundingShiftType(shiftType: string | null | undefined): string {
  const trimmed = shiftType?.trim();
  if (!trimmed) return LIVE_ROUNDING_NO_SHIFT_TYPE_COPY;
  return `${trimmed} shift`;
}
