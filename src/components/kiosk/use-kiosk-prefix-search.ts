"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { KIOSK_SEARCH_DEBOUNCE_MS, KIOSK_VISITOR_ERROR_COPY, kioskPrefixLetterCount, type KioskVisitorErrorCode } from "@/lib/kiosk/contract";

import { kioskRequestInit, useKiosk } from "./kiosk-context";

export type KioskPrefixSearchState<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; code: KioskVisitorErrorCode; message: string }
  | { state: "success-empty" }
  | { state: "success-populated"; matches: T[] };

export function kioskVisitorErrorCode(body: unknown): KioskVisitorErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof code === "string" && code in KIOSK_VISITOR_ERROR_COPY ? (code as KioskVisitorErrorCode) : "unavailable";
}

/**
 * A kiosk type-ahead against one of the visitor routes: nothing is asked
 * before `minLetters` letters, the request waits for a pause in typing, and a
 * response that arrives after a newer keystroke is thrown away (sequence
 * counter), so the list always matches what is in the box. A token the server
 * no longer knows sends the tablet back to setup.
 */
export function useKioskPrefixSearch<T>({
  query,
  endpoint,
  minLetters,
  enabled = true,
  debounceMs = KIOSK_SEARCH_DEBOUNCE_MS,
}: {
  query: string;
  endpoint: string;
  minLetters: number;
  enabled?: boolean;
  debounceMs?: number;
}): KioskPrefixSearchState<T> {
  const router = useRouter();
  const { device, fetchImpl, forgetDevice } = useKiosk();
  const [search, setSearch] = useState<KioskPrefixSearchState<T>>({ state: "idle" });
  const requestSeq = useRef(0);
  const enough = enabled && kioskPrefixLetterCount(query) >= minLetters;

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!enough || !device) {
      setSearch((current) => (current.state === "idle" ? current : { state: "idle" }));
      return;
    }
    setSearch((current) => (current.state === "loading" ? current : { state: "loading" }));
    const timer = window.setTimeout(async () => {
      try {
        const url = `${endpoint}?prefix=${encodeURIComponent(query.trim())}`;
        const response = await fetchImpl(url, kioskRequestInit(device.token, { method: "GET" }));
        const body = (await response.json().catch(() => null)) as unknown;
        if (seq !== requestSeq.current) return;
        if (!response.ok) {
          const code = kioskVisitorErrorCode(body);
          if (code === "device_unknown") {
            await forgetDevice();
            router.replace("/kiosk/setup");
            return;
          }
          setSearch({ state: "error", code, message: KIOSK_VISITOR_ERROR_COPY[code] });
          return;
        }
        const matches = ((body as { matches?: T[] } | null)?.matches ?? []) as T[];
        setSearch(matches.length > 0 ? { state: "success-populated", matches } : { state: "success-empty" });
      } catch {
        if (seq === requestSeq.current) setSearch({ state: "error", code: "unavailable", message: KIOSK_VISITOR_ERROR_COPY.unavailable });
      }
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, enough, device, fetchImpl, endpoint, debounceMs, forgetDevice, router]);

  return search;
}
