/**
 * The lock screen's calls (spec 40 §4): the roster and the unlock, both with
 * the device token. A verified unlock becomes this page's unlock id and
 * top-bar profile, and the tablet's facility becomes the working facility the
 * reused caregiver reads resolve.
 */

import { workingFacilityKey } from "@/lib/caregiver/facility-context";
import {
  FLOOR_DEVICE_HEADER,
  FLOOR_ROSTER_ENDPOINT,
  FLOOR_UNLOCK_ENDPOINT,
  publicFloorErrorCode,
  type FloorErrorCode,
  type FloorRosterResponse,
  type FloorUnlockRequest,
  type FloorUnlockResponse,
} from "@/lib/floor/contract";
import type { FloorDevice } from "@/lib/floor/device-store";
import { forgetFloorPerson } from "@/lib/floor/lock-client";
import { setFloorUnlockId } from "@/lib/floor/session-context";
import { initialsFromDisplayName, setFloorUnlockProfile } from "@/lib/floor/unlock-profile";

export type FloorCallResult<T> = { ok: true; value: T } | { ok: false; code: FloorErrorCode };

async function errorCodeOf(response: Response): Promise<FloorErrorCode> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return publicFloorErrorCode(typeof body?.error === "string" ? body.error : response.status >= 500 ? "unavailable" : "not_recognized");
}

export async function fetchFloorRoster(device: FloorDevice, fetchImpl: typeof fetch = fetch): Promise<FloorCallResult<FloorRosterResponse>> {
  try {
    const response = await fetchImpl(FLOOR_ROSTER_ENDPOINT, {
      headers: { [FLOOR_DEVICE_HEADER]: device.token },
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return { ok: false, code: await errorCodeOf(response) };
    return { ok: true, value: (await response.json()) as FloorRosterResponse };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function requestFloorUnlock(
  device: FloorDevice,
  request: FloorUnlockRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<FloorCallResult<FloorUnlockResponse>> {
  try {
    const response = await fetchImpl(FLOOR_UNLOCK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", [FLOOR_DEVICE_HEADER]: device.token },
      body: JSON.stringify(request),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, code: await errorCodeOf(response) };
    return { ok: true, value: (await response.json()) as FloorUnlockResponse };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** Make a verified unlock this page's person. Anything the page held before is dropped first. */
export function adoptFloorUnlock(device: FloorDevice, unlock: FloorUnlockResponse, initials: string | null, now: Date = new Date()): void {
  forgetFloorPerson();
  setFloorUnlockId(unlock.unlock_id);
  setFloorUnlockProfile({
    unlockId: unlock.unlock_id,
    userId: unlock.user_id,
    displayName: unlock.display_name,
    initials: initials || initialsFromDisplayName(unlock.display_name),
    roleLabel: unlock.role_label,
    clockedInAt: unlock.clocked_in_at,
    onClock: unlock.on_clock,
    idleLockMinutes: unlock.idle_lock_minutes,
    unlockedAt: now.toISOString(),
  });
  try {
    window.sessionStorage.setItem(workingFacilityKey(unlock.user_id), device.facilityId);
  } catch {
    // Without storage the reused reads fall back to the person's only facility.
  }
}
