"use client";

import { useEffect, useRef } from "react";

import {
  FLOOR_DEVICE_HEADER,
  FLOOR_HEARTBEAT_ENDPOINT,
  FLOOR_HEARTBEAT_INTERVAL_MS,
  type FloorInactiveReason,
  type FloorLockReason,
} from "@/lib/floor/contract";
import {
  FLOOR_ACTIVITY_EVENTS,
  createIdleTimer,
  heartbeatOutcome,
  idleLockMs,
  lockReasonForVisibility,
} from "@/lib/floor/lock-triggers";

/**
 * Wires spec 40 §1 "Lock" to the page while someone is unlocked: the screen
 * going dark, the facility's idle minutes, and the 60-second heartbeat that
 * learns about a punch-out, a revoked tablet or the 12-hour cap. `onLock` is
 * the tablet's own lock; `onEnded` is the server saying the unlock is over.
 */
export function useFloorLockTriggers(input: {
  enabled: boolean;
  deviceToken: string | null;
  unlockId: string | null;
  idleLockMinutes: number;
  onLock: (reason: FloorLockReason) => void;
  onEnded: (reason: FloorInactiveReason) => void;
}) {
  const { enabled, deviceToken, unlockId, idleLockMinutes } = input;
  const onLock = useRef(input.onLock);
  const onEnded = useRef(input.onEnded);
  useEffect(() => {
    onLock.current = input.onLock;
    onEnded.current = input.onEnded;
  });

  // Screen dark and idle.
  useEffect(() => {
    if (!enabled) return;
    const timer = createIdleTimer({ idleMs: idleLockMs(idleLockMinutes), onIdle: () => onLock.current("idle") });
    const onActivity = () => timer.reset();
    const onVisibility = () => {
      const reason = lockReasonForVisibility(document.visibilityState);
      if (reason) {
        timer.stop();
        onLock.current(reason);
      }
    };
    // Closing the home-screen web app can unload the page without a
    // visibilitychange first. A reload locks too: the tablet cannot tell a
    // reload from a close while the page is going away, and a close must not
    // leave the unlock and its session open.
    const onPageHide = () => {
      timer.stop();
      onLock.current("sleep");
    };
    for (const name of FLOOR_ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      timer.stop();
      for (const name of FLOOR_ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled, idleLockMinutes]);

  // Heartbeat: now, then every interval.
  useEffect(() => {
    if (!enabled || !deviceToken || !unlockId) return;
    let active = true;
    const beat = async () => {
      let outcome;
      try {
        const response = await fetch(`${FLOOR_HEARTBEAT_ENDPOINT}?unlock_id=${encodeURIComponent(unlockId)}`, {
          headers: { [FLOOR_DEVICE_HEADER]: deviceToken },
          cache: "no-store",
        });
        outcome = heartbeatOutcome({ ok: response.ok, status: response.status, body: await response.json().catch(() => null) });
      } catch {
        outcome = heartbeatOutcome({ ok: false, status: 0, body: null });
      }
      if (active && outcome.action === "lock") onEnded.current(outcome.reason);
    };
    void beat();
    const timer = window.setInterval(() => void beat(), FLOOR_HEARTBEAT_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, deviceToken, unlockId]);
}
