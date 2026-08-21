/**
 * Quiet Operator copy for snack pass (time + passer only).
 * Missing passer names a real gap — never fabricate "Staff".
 */

import { DIET_MEAL_SNACK_LOG_LIMIT } from "@/lib/dietary/load-dietary-hub-bootstrap";

export const SNACK_PASS_NO_PASSER_COPY = "No passer posted";
export const SNACK_PASS_RECENT_PREVIEW_LIMIT = 5;
export const SNACK_PASS_LIST_LOADING_MESSAGE = "Loading snack passes…";

const LEGACY_GENERIC_PASSER = "Staff";

/** Passer on a recent snack-pass row when the profile name is unset, blank, or legacy generic. */
export function formatSnackPassPasserDisplay(fullName: string | null | undefined): string {
  const trimmed = typeof fullName === "string" ? fullName.trim() : "";
  if (!trimmed || trimmed === LEGACY_GENERIC_PASSER) return SNACK_PASS_NO_PASSER_COPY;
  return trimmed;
}

export function snackPassRecentPreviewRows<T>(logs: readonly T[]): T[] {
  return logs.slice(0, SNACK_PASS_RECENT_PREVIEW_LIMIT);
}

/** Names the preview slice and hub load cap so training never sees a silent list. */
export function snackPassRecentPreviewFootnote(
  loadedCount: number,
  loadedCap: number = DIET_MEAL_SNACK_LOG_LIMIT,
): string | null {
  if (loadedCount <= SNACK_PASS_RECENT_PREVIEW_LIMIT) return null;
  const shown = SNACK_PASS_RECENT_PREVIEW_LIMIT;
  if (loadedCount >= loadedCap) {
    return `Showing ${shown} most recent of ${loadedCount} loaded. Older passes are not listed on this hub.`;
  }
  return `Showing ${shown} most recent of ${loadedCount} loaded.`;
}
