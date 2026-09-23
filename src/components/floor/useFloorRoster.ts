"use client";

import { useCallback, useEffect, useState } from "react";

import type { FloorErrorCode, FloorRosterResponse } from "@/lib/floor/contract";
import { resolveFloorDeviceStore, type FloorDevice } from "@/lib/floor/device-store";
import { countUnsentByOwner, replayFloorQueues } from "@/lib/floor/replay";
import { fetchFloorRoster } from "@/lib/floor/unlock-client";

/** People clock in and out at the front door all shift; the lock screen asks again this often. */
const ROSTER_REFRESH_MS = 60_000;

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

  const load = useCallback(
    async (showLoading: boolean) => {
      if (!device) return;
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
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [device, load, replay]);

  return { device, roster, unsent, retry: () => void load(true) };
}
