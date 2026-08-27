/**
 * Quiet Operator copy for the admin dietary hub (`/admin/dietary`).
 * Missing resident names name real gaps — never fabricate labels.
 */

import { DIET_ORDERS_HUB_LIMIT } from "@/lib/dietary/load-dietary-hub-bootstrap";

export const DIETARY_HUB_NO_RESIDENT_COPY = "No resident posted";

/** Names the hub fetch ceiling so the diet-order list is not a silent 50-row slice. */
export function dietOrdersHubLoadCapNotice(
  loadedCount: number,
  loadedCap: number = DIET_ORDERS_HUB_LIMIT,
): string | null {
  if (loadedCount < loadedCap) return null;
  return `Loaded the ${loadedCap} most recent diet orders. Older orders are not listed on this hub.`;
}

const LEGACY_UNKNOWN_RESIDENT = "Unknown";

/** Resident name on diet-order roster and attention cards when the join is unset, blank, or legacy generic copy. */
export function formatDietaryHubResidentDisplay(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const combined = `${first?.trim() ?? ""} ${last?.trim() ?? ""}`.trim();
  if (!combined || combined === LEGACY_UNKNOWN_RESIDENT) {
    return DIETARY_HUB_NO_RESIDENT_COPY;
  }
  return combined;
}
