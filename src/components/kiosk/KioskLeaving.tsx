"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  KIOSK_SIGN_OUT_MIN_LETTERS,
  KIOSK_VISITOR_COPY,
  KIOSK_VISITOR_ERROR_COPY,
  KIOSK_VISITOR_OPEN_ENDPOINT,
  KIOSK_VISITOR_SIGN_OUT_ENDPOINT,
  kioskPrefixLetterCount,
  type KioskOpenMatchesResponse,
  type KioskOpenVisit,
  type KioskSignOutResponse,
  type KioskVisitorErrorCode,
} from "@/lib/kiosk/contract";
import { KIOSK_LEAVING_COPY, kioskSignedOutLine } from "@/lib/kiosk/screens";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskHeader } from "./KioskHeader";
import { OpenVisitRow } from "./OpenVisitRow";
import { kioskRequestInit, useKiosk } from "./kiosk-context";

/** Wait this long after the last letter before asking, so typing "Carol" is one request, not five. */
export const KIOSK_LEAVING_DEBOUNCE_MS = 250;

type SearchState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "success-empty" }
  | { state: "success-populated"; matches: KioskOpenVisit[] };

function errorCode(body: unknown): KioskVisitorErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof code === "string" && code in KIOSK_VISITOR_ERROR_COPY ? (code as KioskVisitorErrorCode) : "unavailable";
}

/**
 * `/kiosk/leaving` (`17`, `17b`). Nothing is listed, and nothing is asked of
 * the server, until three letters are typed; then at most five open visits,
 * first name and last initial only.
 */
export function KioskLeaving({ debounceMs = KIOSK_LEAVING_DEBOUNCE_MS }: { debounceMs?: number } = {}) {
  const router = useRouter();
  const { device, fetchImpl, timeZone, forgetDevice, goHome } = useKiosk();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ state: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState<KioskSignOutResponse | null>(null);
  const requestSeq = useRef(0);
  const enough = kioskPrefixLetterCount(query) >= KIOSK_SIGN_OUT_MIN_LETTERS;

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!enough || !device) {
      setSearch((current) => (current.state === "idle" ? current : { state: "idle" }));
      return;
    }
    setSearch((current) => (current.state === "loading" ? current : { state: "loading" }));
    const timer = window.setTimeout(async () => {
      try {
        const url = `${KIOSK_VISITOR_OPEN_ENDPOINT}?prefix=${encodeURIComponent(query.trim())}`;
        const response = await fetchImpl(url, kioskRequestInit(device.token, { method: "GET" }));
        const body = (await response.json().catch(() => null)) as unknown;
        if (seq !== requestSeq.current) return;
        if (!response.ok) {
          const code = errorCode(body);
          if (code === "device_unknown") {
            await forgetDevice();
            router.replace("/kiosk/setup");
            return;
          }
          setSearch({ state: "error", message: KIOSK_VISITOR_ERROR_COPY[code] });
          return;
        }
        const matches = (body as KioskOpenMatchesResponse).matches ?? [];
        setSearch(matches.length > 0 ? { state: "success-populated", matches } : { state: "success-empty" });
      } catch {
        if (seq === requestSeq.current) setSearch({ state: "error", message: KIOSK_VISITOR_ERROR_COPY.unavailable });
      }
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [query, enough, device, fetchImpl, debounceMs, forgetDevice, router]);

  async function signOut(visit: KioskOpenVisit) {
    if (!device || busyId) return;
    setBusyId(visit.entry_id);
    try {
      const response = await fetchImpl(KIOSK_VISITOR_SIGN_OUT_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: { entry_id: visit.entry_id } }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (response.ok) {
        setSignedOut(body as KioskSignOutResponse);
        return;
      }
      setSearch({ state: "error", message: KIOSK_VISITOR_ERROR_COPY[errorCode(body)] });
    } catch {
      setSearch({ state: "error", message: KIOSK_VISITOR_ERROR_COPY.unavailable });
    } finally {
      setBusyId(null);
    }
  }

  if (signedOut) {
    return (
      <main className="flex min-h-dvh flex-col bg-background">
        <KioskHeader title={KIOSK_LEAVING_COPY.title} back />
        <ConfirmPanel
          title={KIOSK_LEAVING_COPY.doneTitle}
          body={kioskSignedOutLine(signedOut.display_name, signedOut.checked_in_at, signedOut.checked_out_at, timeZone)}
          onDone={goHome}
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader title={KIOSK_LEAVING_COPY.title} back />
      <div className="flex flex-1 flex-col gap-5 px-10 py-7">
        <label htmlFor="kiosk-leaving-name" className="text-[22px] font-semibold text-foreground">
          {KIOSK_VISITOR_COPY.signOutHint}
        </label>
        <div className="relative w-155 max-w-full">
          <Search className="pointer-events-none absolute left-4.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="kiosk-leaving-name"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 60))}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby="kiosk-leaving-status"
            className="h-17 w-full rounded-[12px] border-[2.5px] border-chrome-primary bg-card pl-14 pr-4.5 text-[26px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          />
        </div>
        <div id="kiosk-leaving-status" role="status" className="text-base empty:hidden">
          {search.state === "loading" ? <p className="text-muted-foreground">{KIOSK_LEAVING_COPY.searching}</p> : null}
          {search.state === "success-populated" ? <p className="text-muted-foreground">{KIOSK_LEAVING_COPY.hint}</p> : null}
          {search.state === "success-empty" ? <p className="text-muted-foreground">{KIOSK_LEAVING_COPY.none}</p> : null}
          {search.state === "error" ? <p className="font-semibold text-destructive">{search.message}</p> : null}
        </div>
        {search.state === "success-populated" ? (
          <ul aria-label="Open visits" className="flex w-205 max-w-full flex-col gap-3">
            {search.matches.map((visit) => (
              <OpenVisitRow key={visit.entry_id} visit={visit} timeZone={timeZone} disabled={busyId !== null} onSignOut={() => void signOut(visit)} />
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
