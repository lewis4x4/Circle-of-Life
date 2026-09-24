/**
 * Lock this floor tablet from the page (spec 40 §1 "Lock"): end the unlock and
 * the session on the server, then forget everything the page held for that
 * person (unlock id, top-bar profile, query cache, working facility).
 */

import { workingFacilityKey } from "@/lib/caregiver/facility-context";
import { FLOOR_DEVICE_HEADER, FLOOR_LOCK_ENDPOINT, FLOOR_LOCK_PATH, type FloorInactiveReason, type FloorLockReason } from "@/lib/floor/contract";
import { resolveFloorDeviceStore } from "@/lib/floor/device-store";
import { clearFloorCache } from "@/lib/floor/memory-cache";
import { forgetFloorRetryOwner } from "@/lib/floor/retry-owner";
import { clearFloorUnlockId, currentFloorUnlockId } from "@/lib/floor/session-context";
import { clearFloorUnlockProfile, currentFloorUnlockProfile } from "@/lib/floor/unlock-profile";

/** Page-side forgetting, shared by lock, heartbeat end and a fresh unlock. */
export function forgetFloorPerson(): void {
  const profile = currentFloorUnlockProfile();
  if (profile) {
    try {
      window.sessionStorage.removeItem(workingFacilityKey(profile.userId));
    } catch {
      // Storage unavailable: nothing was kept there.
    }
  }
  clearFloorUnlockId();
  clearFloorUnlockProfile();
  clearFloorCache();
  forgetFloorRetryOwner();
}

/**
 * POST the lock. `keepalive` lets the request finish while the page is being
 * hidden or unloaded (screen sleep, the web app closing). Pass the device
 * token the page already holds: the request then leaves synchronously, before
 * the page can be torn down, instead of after an IndexedDB read.
 *
 * The unlock id is read now, at the call, never later: a lock that waits on
 * IndexedDB must not pick up the next person's unlock id and end their
 * unlock instead. If the tablet is offline the same request goes out again
 * when the network comes back (the route answers 204 whatever state the
 * unlock is in); until then the heartbeat is gone and the database ends the
 * unlock at the next unlock on this tablet or the 12-hour cap.
 */
export function sendFloorLock(
  reason: FloorLockReason,
  fetchImpl: typeof fetch = fetch,
  deviceToken?: string | null,
  options: { target?: Pick<Window, "addEventListener" | "removeEventListener"> } = {},
): Promise<void> {
  const unlockId = currentFloorUnlockId() ?? "";
  const target = options.target ?? (typeof window !== "undefined" ? window : undefined);
  const post = (token: string | null): Promise<boolean> => {
    try {
      return fetchImpl(FLOOR_LOCK_ENDPOINT, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(token ? { [FLOOR_DEVICE_HEADER]: token } : {}) },
        body: JSON.stringify({ unlock_id: unlockId, reason }),
      }).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  };
  const sendOnce = (token: string | null) =>
    post(token).then((delivered) => {
      if (delivered || !unlockId || !target) return;
      const retry = () => {
        target.removeEventListener("online", retry);
        void post(token);
      };
      target.addEventListener("online", retry);
    });
  if (deviceToken) return sendOnce(deviceToken);
  return resolveFloorDeviceStore()
    .getDevice()
    .catch(() => null)
    .then((device) => sendOnce(device?.token ?? null));
}

/**
 * Expire this tablet's Supabase session cookies in the page, without the
 * network. The lock route clears them too, but a lock made offline never
 * reaches it, and `signOut` does not clear local state when it cannot reach
 * the auth server. The shell actor cache cookie is HttpOnly and bound to the
 * session it was minted for; it is useless once these are gone.
 */
export function clearBrowserSessionCookies(doc: Pick<Document, "cookie"> | undefined = typeof document !== "undefined" ? document : undefined): string[] {
  if (!doc) return [];
  const cleared: string[] = [];
  for (const part of doc.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name || !/^sb-.+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(name)) continue;
    doc.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    cleared.push(name);
  }
  return cleared;
}

/** Where the lock screen goes, carrying why it locked. */
export function floorLockHref(reason: FloorInactiveReason | null): string {
  return reason ? `${FLOOR_LOCK_PATH}?reason=${encodeURIComponent(reason)}` : FLOOR_LOCK_PATH;
}
