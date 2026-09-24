"use client";

/**
 * Front-door kiosk frame (COL-692, spec 40 §7). No session: the device token in
 * IndexedDB (`haven-timeclock`) is the only credential. The shell reads it once
 * for every /kiosk screen, sends a tablet without one to /kiosk/setup, replays
 * offline punches whenever the network is back (whatever screen is showing),
 * and returns any screen but home to home after 30 seconds without input.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { KIOSK_IDLE_RESET_MS } from "@/lib/kiosk/contract";
import { KIOSK_SETUP_COPY, KIOSK_TIME_ZONE } from "@/lib/kiosk/screens";
import { replayKioskQueue, resolveKioskStore, type KioskDevice, type KioskStore } from "@/lib/timeclock/kiosk-store";

import { KioskContext, type KioskContextValue } from "./kiosk-context";

export const KIOSK_HOME_PATH = "/kiosk";
export const KIOSK_SETUP_PATH = "/kiosk/setup";

export type KioskShellProps = {
  children: ReactNode;
  store?: KioskStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeZone?: string;
  /** Test hook: override navigator.onLine. */
  online?: boolean;
  idleMs?: number;
};

const IDLE_EVENTS = ["pointerdown", "keydown", "input"] as const;

export function KioskShell({ children, store: storeProp, fetchImpl: fetchProp, now: nowProp, timeZone = KIOSK_TIME_ZONE, online: onlineProp, idleMs = KIOSK_IDLE_RESET_MS }: KioskShellProps) {
  const router = useRouter();
  const pathname = usePathname() ?? KIOSK_HOME_PATH;
  const store = useMemo(() => resolveKioskStore(storeProp), [storeProp]);
  const fetchImpl = useMemo<typeof fetch>(() => fetchProp ?? ((input, init) => fetch(input, init)), [fetchProp]);
  const now = useMemo<() => Date>(() => nowProp ?? (() => new Date()), [nowProp]);

  const [loaded, setLoaded] = useState(false);
  const [device, setDeviceState] = useState<KioskDevice | null>(null);
  // Starts true on both server and client; the browser's real state arrives after mount.
  const [online, setOnline] = useState<boolean>(onlineProp ?? true);
  const [pendingPunches, setPendingPunches] = useState(0);
  const onSetup = pathname === KIOSK_SETUP_PATH;

  const refreshPending = useCallback(async () => {
    setPendingPunches((await store.listQueue()).length);
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await store.getDevice();
      if (cancelled) return;
      setDeviceState(existing);
      setLoaded(true);
      await refreshPending();
    })();
    return () => {
      cancelled = true;
    };
  }, [store, refreshPending]);

  useEffect(() => {
    if (loaded && !device && !onSetup) router.replace(KIOSK_SETUP_PATH);
  }, [loaded, device, onSetup, router]);

  useEffect(() => {
    if (onlineProp !== undefined) {
      setOnline(onlineProp);
      return;
    }
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [onlineProp]);

  // Offline punches go out in capture order as soon as the tablet is back online.
  useEffect(() => {
    if (!online || !device) return;
    void replayKioskQueue({ store, fetchImpl, now }).then(refreshPending);
  }, [online, device, store, fetchImpl, now, refreshPending]);

  const goHome = useCallback(() => router.replace(KIOSK_HOME_PATH), [router]);

  // Idle: any screen but home and setup returns home after 30 seconds without input.
  useEffect(() => {
    if (pathname === KIOSK_HOME_PATH || onSetup) return;
    let timer = window.setTimeout(goHome, idleMs);
    const touch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(goHome, idleMs);
    };
    for (const name of IDLE_EVENTS) window.addEventListener(name, touch, true);
    return () => {
      window.clearTimeout(timer);
      for (const name of IDLE_EVENTS) window.removeEventListener(name, touch, true);
    };
  }, [pathname, onSetup, idleMs, goHome]);

  const setDevice = useCallback(
    async (next: KioskDevice) => {
      await store.setDevice(next);
      setDeviceState(next);
    },
    [store],
  );

  const forgetDevice = useCallback(async () => {
    await store.clearDevice();
    setDeviceState(null);
  }, [store]);

  const markOffline = useCallback(() => setOnline(false), []);

  const value = useMemo<KioskContextValue>(
    () => ({ store, fetchImpl, now, timeZone, device, setDevice, forgetDevice, online, markOffline, pendingPunches, refreshPending, goHome }),
    [store, fetchImpl, now, timeZone, device, setDevice, forgetDevice, online, markOffline, pendingPunches, refreshPending, goHome],
  );

  const ready = loaded && (device !== null || onSetup);
  return (
    <KioskContext.Provider value={value}>
      {ready ? (
        children
      ) : (
        <main className="flex min-h-dvh items-center justify-center bg-background">
          <p role="status" className="text-lg text-muted-foreground">
            {KIOSK_SETUP_COPY.loading}
          </p>
        </main>
      )}
    </KioskContext.Provider>
  );
}
