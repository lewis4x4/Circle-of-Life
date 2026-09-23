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
 * hidden (the screen-sleep lock). The route answers 204 whatever state the
 * unlock was in, and clears the session cookies on that response.
 */
export async function sendFloorLock(reason: FloorLockReason, fetchImpl: typeof fetch = fetch): Promise<void> {
  const device = await resolveFloorDeviceStore().getDevice().catch(() => null);
  const unlockId = currentFloorUnlockId() ?? "";
  try {
    await fetchImpl(FLOOR_LOCK_ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(device ? { [FLOOR_DEVICE_HEADER]: device.token } : {}),
      },
      body: JSON.stringify({ unlock_id: unlockId, reason }),
    });
  } catch {
    // Offline: the heartbeat and the 12-hour cap end the unlock server side.
  }
}

/** Where the lock screen goes, carrying why it locked. */
export function floorLockHref(reason: FloorInactiveReason | null): string {
  return reason ? `${FLOOR_LOCK_PATH}?reason=${encodeURIComponent(reason)}` : FLOOR_LOCK_PATH;
}
