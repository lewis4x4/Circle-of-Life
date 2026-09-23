/**
 * The floor unlock this page is running under (COL-690, spec 40 §1 "Offline").
 *
 * The floor app sets it on unlock and clears it on lock. The offline rounding
 * and care-event queues stamp it on every item they queue, so the device
 * replay path can later write the item as its owner after someone else has
 * unlocked the tablet.
 *
 * Kept in page memory with a sessionStorage mirror so a reload inside one
 * unlock keeps attribution and the heartbeat. The unlock id is not a
 * credential: without the device token (IndexedDB) and the session cookies it
 * opens nothing. Never localStorage.
 */

const STORAGE_KEY = "haven-floor-unlock";

let currentUnlockId: string | null = null;
const listeners = new Set<(unlockId: string | null) => void>();

function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function setFloorUnlockId(unlockId: string): void {
  currentUnlockId = unlockId;
  sessionStore()?.setItem(STORAGE_KEY, unlockId);
  for (const listener of listeners) listener(unlockId);
}

export function clearFloorUnlockId(): void {
  currentUnlockId = null;
  sessionStore()?.removeItem(STORAGE_KEY);
  for (const listener of listeners) listener(null);
}

/** The current floor unlock id, or null off a floor tablet (or while locked). */
export function currentFloorUnlockId(): string | null {
  if (currentUnlockId) return currentUnlockId;
  const stored = sessionStore()?.getItem(STORAGE_KEY) ?? null;
  currentUnlockId = stored || null;
  return currentUnlockId;
}

export function subscribeFloorUnlockId(listener: (unlockId: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
