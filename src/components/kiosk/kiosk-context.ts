"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { KIOSK_DEVICE_HEADER } from "@/lib/timeclock/kiosk-contract";
import type { KioskDevice, KioskStore } from "@/lib/timeclock/kiosk-store";

export type KioskContextValue = {
  store: KioskStore;
  fetchImpl: typeof fetch;
  now: () => Date;
  timeZone: string;
  /** Null only on /kiosk/setup; every other screen renders after a device is known. */
  device: KioskDevice | null;
  setDevice: (device: KioskDevice) => Promise<void>;
  /** The server no longer knows this tablet: drop the token and go to setup. */
  forgetDevice: () => Promise<void>;
  online: boolean;
  /** A request failed at the network: treat the tablet as offline until the browser says otherwise. */
  markOffline: () => void;
  pendingPunches: number;
  refreshPending: () => Promise<void>;
  goHome: () => void;
};

export const KioskContext = createContext<KioskContextValue | null>(null);

export function useKiosk(): KioskContextValue {
  const value = useContext(KioskContext);
  if (!value) throw new Error("useKiosk must be used inside KioskShell");
  return value;
}

/**
 * The live clock. Null until mounted, so the server HTML and the first client
 * render agree (COL-659); the header shows a blank until then.
 */
export function useKioskClock(): Date | null {
  const { now } = useKiosk();
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    setClock(now());
    const id = window.setInterval(() => setClock(now()), 1000);
    return () => window.clearInterval(id);
  }, [now]);
  return clock;
}

/** Device token header plus JSON, never cookies: the kiosk has no session. */
export function kioskRequestInit(token: string, init: RequestInit & { json?: unknown } = {}): RequestInit {
  const { json, headers, ...rest } = init;
  return {
    ...rest,
    credentials: "omit",
    headers: { ...(json === undefined ? {} : { "Content-Type": "application/json" }), [KIOSK_DEVICE_HEADER]: token, ...(headers as Record<string, string> | undefined) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  };
}
