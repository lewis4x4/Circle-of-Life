"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  KIOSK_COPY,
  KIOSK_ROSTER_ENDPOINT,
  KIOSK_ROSTER_REFRESH_MS,
  type KioskErrorCode,
  type KioskRosterEntry,
  type KioskRosterResponse,
} from "@/lib/timeclock/kiosk-contract";

import { kioskRequestInit, useKiosk } from "./kiosk-context";

export type KioskRosterState =
  | { state: "loading" }
  | { state: "error"; code: KioskErrorCode }
  /** No connection and nothing saved on this tablet yet. */
  | { state: "offline-empty" }
  | { state: "success-empty"; throttledUntil: string | null }
  | { state: "success-populated"; roster: KioskRosterEntry[]; throttledUntil: string | null; saved: boolean };

/** Only an explicit device_unknown forgets the tablet; anything unreadable is "Haven is down". */
function readError(body: unknown): KioskErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && code in KIOSK_COPY.errors) return code as KioskErrorCode;
  return "unavailable";
}

/**
 * The names on Staff clock. The last good list comes from this tablet's
 * offline store first, so names show with no connection; then the server's
 * list replaces it and is saved again. Refreshed every 5 minutes while the
 * screen is open, when the network comes back, and on demand (after a
 * throttle, to learn when it ends).
 */
export function useKioskRoster({ refreshMs = KIOSK_ROSTER_REFRESH_MS }: { refreshMs?: number } = {}) {
  const router = useRouter();
  const { device, fetchImpl, store, now, online, forgetDevice, markOffline } = useKiosk();
  const [roster, setRoster] = useState<KioskRosterState>({ state: "loading" });
  const hasList = useRef(false);
  const seq = useRef(0);

  const showSaved = useCallback(async () => {
    const saved = await store.getRoster();
    if (saved && device && saved.facilityId === device.facilityId && saved.roster.length > 0) {
      hasList.current = true;
      setRoster({ state: "success-populated", roster: saved.roster, throttledUntil: null, saved: true });
      return true;
    }
    return false;
  }, [store, device]);

  const refresh = useCallback(async () => {
    if (!device) return;
    const mine = ++seq.current;
    // Offline: the saved list, and no request until the network is back.
    if (!online) {
      if (!hasList.current && !(await showSaved()) && mine === seq.current) setRoster({ state: "offline-empty" });
      return;
    }
    try {
      const response = await fetchImpl(KIOSK_ROSTER_ENDPOINT, kioskRequestInit(device.token, { method: "GET" }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (mine !== seq.current) return;
      if (!response.ok) {
        const code = readError(body);
        if (code === "device_unknown") {
          await forgetDevice();
          router.replace("/kiosk/setup");
          return;
        }
        // Haven is down: keep whatever list is showing, else the saved one.
        if (code === "unavailable" && (hasList.current || (await showSaved()))) return;
        setRoster({ state: "error", code });
        return;
      }
      const data = body as KioskRosterResponse;
      const list = Array.isArray(data.roster) ? data.roster : [];
      const throttledUntil = data.throttled_until && new Date(data.throttled_until).getTime() > now().getTime() ? data.throttled_until : null;
      hasList.current = list.length > 0;
      setRoster(list.length > 0 ? { state: "success-populated", roster: list, throttledUntil, saved: false } : { state: "success-empty", throttledUntil });
      await store.setRoster({ facilityId: device.facilityId, fetchedAt: now().toISOString(), roster: list });
    } catch {
      if (mine !== seq.current) return;
      markOffline();
      if (hasList.current || (await showSaved())) return;
      setRoster({ state: "offline-empty" });
    }
  }, [device, online, fetchImpl, forgetDevice, router, showSaved, store, now, markOffline]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await showSaved();
      if (!cancelled) await refresh();
    })();
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showSaved, refresh, refreshMs]);

  return { roster, refresh };
}
