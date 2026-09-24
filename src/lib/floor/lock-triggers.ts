/**
 * When an unlocked floor tablet locks itself (spec 40 §1 "Lock"): the screen
 * goes dark, nobody taps for the facility's idle minutes, the Switch button,
 * or a heartbeat that finds the unlock over. Pure pieces here; the shell wires
 * them to the page.
 */

import type { FloorHeartbeatResponse, FloorInactiveReason, FloorLockReason } from "@/lib/floor/contract";

export type TimerApi = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const browserTimers: TimerApi = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type IdleTimer = {
  /** Any tap or key press: start the idle window again. */
  reset(): void;
  stop(): void;
};

/** Minutes from the facility setting, bounded the way the database bounds it (1 to 30). */
export function idleLockMs(idleLockMinutes: number): number {
  const minutes = Number.isFinite(idleLockMinutes) ? Math.min(30, Math.max(1, Math.round(idleLockMinutes))) : 3;
  return minutes * 60_000;
}

/** Calls `onIdle` once after `idleMs` without a `reset()`. */
export function createIdleTimer(input: { idleMs: number; onIdle: () => void; timers?: TimerApi }): IdleTimer {
  const timers = input.timers ?? browserTimers;
  let handle: unknown = null;
  let stopped = false;
  const arm = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = timers.setTimeout(() => {
      handle = null;
      if (!stopped) {
        stopped = true;
        input.onIdle();
      }
    }, input.idleMs);
  };
  arm();
  return {
    reset() {
      if (!stopped) arm();
    },
    stop() {
      stopped = true;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
  };
}

/** Events that count as someone using the tablet. */
export const FLOOR_ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** A hidden page is a sleeping or switched-away tablet: lock. */
export function lockReasonForVisibility(visibilityState: DocumentVisibilityState): FloorLockReason | null {
  return visibilityState === "hidden" ? "sleep" : null;
}

/**
 * What a heartbeat answer means for the tablet. `keep` for an active unlock and
 * for anything that is not an answer about the unlock (network, 503): an
 * offline tablet keeps working and the next beat asks again.
 */
export type HeartbeatOutcome = { action: "keep" } | { action: "lock"; reason: FloorInactiveReason };

export function heartbeatOutcome(input: { ok: boolean; status: number; body: unknown }): HeartbeatOutcome {
  if (!input.ok) {
    // A refused or unknown device is over for good; anything else is a pause.
    return input.status === 401 ? { action: "lock", reason: "device_revoked" } : { action: "keep" };
  }
  const body = input.body as Partial<FloorHeartbeatResponse> | null;
  if (!body || typeof body !== "object" || body.active === true) return { action: "keep" };
  return { action: "lock", reason: (body.reason as FloorInactiveReason | undefined) ?? "unknown" };
}
