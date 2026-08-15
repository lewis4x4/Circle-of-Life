/**
 * Quiet Operator copy for the admin shift swaps hub (`/admin/shift-swaps`).
 * Missing covering staff names real gaps — never fabricate labels.
 */

export const SHIFT_SWAP_NO_COVERING_STAFF_COPY = "No covering staff posted";

/** Covering staff name on a shift swap row when unset, blank, or a lone em dash. */
export function formatShiftSwapCoveringName(name: string | null | undefined): string {
  if (name == null) return SHIFT_SWAP_NO_COVERING_STAFF_COPY;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "—") return SHIFT_SWAP_NO_COVERING_STAFF_COPY;
  return trimmed;
}
