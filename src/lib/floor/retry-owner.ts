/**
 * The operator a floor check is saved as (`CompletionPayload.retryOwner`),
 * resolved while online and remembered for the unlock (spec 40 §1 "Offline").
 *
 * Resolving it needs `haven_current_edge_actor`, a network call. A check
 * charted with the Wi-Fi down must still reach the offline queue under the
 * person who unlocked, so the shell resolves the owner on unlock and the save
 * path falls back to that copy when the tablet cannot reach Haven. Page
 * memory only; cleared on every lock and unlock.
 */

import type { RetryOwner } from "@/lib/floor/check-submit";

type Remembered = { unlockId: string; owner: RetryOwner };

let remembered: Remembered | null = null;

export function rememberFloorRetryOwner(unlockId: string, owner: RetryOwner): void {
  remembered = { unlockId, owner };
}

export function forgetFloorRetryOwner(): void {
  remembered = null;
}

/** The remembered owner, only for this unlock and this facility. */
export function rememberedFloorRetryOwner(unlockId: string | null, facilityId: string): RetryOwner | null {
  if (!remembered || !unlockId || remembered.unlockId !== unlockId) return null;
  return remembered.owner.facilityId === facilityId ? remembered.owner : null;
}

/**
 * Online: ask Haven (the server checks the owner again on save) and remember
 * the answer. Offline, or when Haven cannot be reached: the owner remembered
 * for this unlock. With neither, the resolve error stands.
 */
export async function resolveFloorRetryOwner(input: {
  unlockId: string | null;
  organizationId: string;
  facilityId: string;
  resolve: (organizationId: string, facilityId: string) => Promise<RetryOwner>;
  online?: boolean;
}): Promise<RetryOwner> {
  const cached = rememberedFloorRetryOwner(input.unlockId, input.facilityId);
  const online = input.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  if (!online && cached) return cached;
  try {
    const owner = await input.resolve(input.organizationId, input.facilityId);
    if (input.unlockId) rememberFloorRetryOwner(input.unlockId, owner);
    return owner;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}
