/**
 * Quiet Operator copy for the admin shift swaps hub (`/admin/shift-swaps`).
 * Missing staff records and blank posted names name real gaps — never fabricate labels.
 */

export const SHIFT_SWAP_NO_STAFF_COPY = "No staff posted";
export const SHIFT_SWAP_NO_NAME_COPY = "No name posted";

export type ShiftSwapStaffMini = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Staff label on a shift swap row or CSV export when the join is missing or blank. */
export function formatShiftSwapStaffLabel(
  staff: ShiftSwapStaffMini | null | undefined,
): string {
  if (!staff) return SHIFT_SWAP_NO_STAFF_COPY;
  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (!name) return SHIFT_SWAP_NO_NAME_COPY;
  return name;
}
