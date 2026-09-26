"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FloorErrorCode, FloorRosterResponse } from "@/lib/floor/contract";
import { resolveFloorDeviceStore, type FloorDevice } from "@/lib/floor/device-store";
import { countUnsentByOwner, replayFloorQueues } from "@/lib/floor/replay";
import { fetchFloorRoster } from "@/lib/floor/unlock-client";

/** People clock in and out at the front door all shift; the lock screen asks again this often. */
const ROSTER_REFRESH_MS = 15_000;
/** A wake or a touch asks again when the names on screen are older than this. */
const ROSTER_STALE_MS = 5_000;

export type RosterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: FloorErrorCode }
  | { status: "success-empty"; roster: FloorRosterResponse }
  | { status: "success-populated"; roster: FloorRosterResponse };

/**
 * The lock screen's data: the enrolled device (null sends the page to setup),
 * who is on shift, and how many items each person still has waiting on this
 * tablet. While the tablet sits locked it also sends those items as their
 * owners, so an offline check never waits for its owner to come back.
 */
export function useFloorRoster() {
  const [device, setDevice] = useState<FloorDevice | null | undefined>(undefined);
  const [roster, setRoster] = useState<RosterState>({ status: "idle" });
  const [unsent, setUnsent] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    resolveFloorDeviceStore()
      .getDevice()
      .then((found) => {
        if (active) setDevice(found);
      })
      .catch(() => {
        if (active) setDevice(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshUnsent = useCallback(async () => {
    try {
      setUnsent(await countUnsentByOwner());
    } catch {
      // The pill is a courtesy; a failed count shows none.
    }
  }, []);

  const lastLoadAt = useRef(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (!device) return;
      lastLoadAt.current = Date.now();
      if (showLoading) setRoster({ status: "loading" });
      const result = await fetchFloorRoster(device);
      if (!result.ok) {
        setRoster((current) =>
          // A refresh that fails offline keeps the names already on screen.
          !showLoading && result.code === "unavailable" && current.status.startsWith("success") ? current : { status: "error", code: result.code },
        );
        return;
      }
      setRoster(result.value.roster.length > 0 ? { status: "success-populated", roster: result.value } : { status: "success-empty", roster: result.value });
    },
    [device],
  );

  const replay = useCallback(async () => {
    await replayFloorQueues({ signedInUserId: null }).catch(() => null);
    await refreshUnsent();
  }, [refreshUnsent]);

  useEffect(() => {
    if (!device) return;
    void load(true);
    void replay();
    const timer = window.setInterval(() => {
      void load(false);
      void replay();
    }, ROSTER_REFRESH_MS);
    const onOnline = () => {
      void load(false);
      void replay();
    };
    // Someone who just clocked in at the front door walks up to a tablet that has been
    // asleep (Auto-Lock) or idle: ask again the moment it wakes or is touched, so their
    // name is there before they look for it, not up to a refresh later.
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadAt.current < ROSTER_STALE_MS) return;
      void load(false);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pointerdown", onWake, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pointerdown", onWake, true);
    };
  }, [device, load, replay]);

  return { device, roster, unsent, retry: () => void load(true) };
}
