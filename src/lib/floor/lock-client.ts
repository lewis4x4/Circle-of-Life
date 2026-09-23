/**
 * Lock this floor tablet from the page (spec 40 §1 "Lock"): end the unlock and
 * the session on the server, then forget everything the page held for that
 * person (unlock id, top-bar profile, query cache, working facility).
 */

import { workingFacilityKey } from "@/lib/caregiver/facility-context";
import { FLOOR_DEVICE_HEADER, FLOOR_LOCK_ENDPOINT, FLOOR_LOCK_PATH, type FloorInactiveReason, type FloorLockReason } from "@/lib/floor/contract";
import { resolveFloorDeviceStore } from "@/lib/floor/device-store";
import { clearFloorCache } from "@/lib/floor/memory-cache";
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
}

/**
 * POST the lock. `keepalive` lets the request finish while the page is being
 * hidden or unloaded (screen sleep, the web app closing). Pass the device
 * token the page already holds: the request then leaves synchronously, before
 * the page can be torn down, instead of after an IndexedDB read. The route
 * answers 204 whatever state the unlock was in, and clears the session
 * cookies on that response.
 */
export function sendFloorLock(reason: FloorLockReason, fetchImpl: typeof fetch = fetch, deviceToken?: string | null): Promise<void> {
  const post = (token: string | null) => {
    try {
      return fetchImpl(FLOOR_LOCK_ENDPOINT, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(token ? { [FLOOR_DEVICE_HEADER]: token } : {}) },
        body: JSON.stringify({ unlock_id: currentFloorUnlockId() ?? "", reason }),
      }).then(
        () => undefined,
        // Offline: the heartbeat and the 12-hour cap end the unlock server side.
        () => undefined,
      );
    } catch {
      return Promise.resolve();
    }
  };
  if (deviceToken) return post(deviceToken);
  return resolveFloorDeviceStore()
    .getDevice()
    .catch(() => null)
    .then((device) => post(device?.token ?? null));
}

/** Where the lock screen goes, carrying why it locked. */
export function floorLockHref(reason: FloorInactiveReason | null): string {
  return reason ? `${FLOOR_LOCK_PATH}?reason=${encodeURIComponent(reason)}` : FLOOR_LOCK_PATH;
}
