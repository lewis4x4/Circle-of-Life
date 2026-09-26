"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  KIOSK_SEARCH_DEBOUNCE_MS,
  KIOSK_SIGN_OUT_MIN_LETTERS,
  KIOSK_VISITOR_ERROR_COPY,
  KIOSK_VISITOR_OPEN_ENDPOINT,
  KIOSK_VISITOR_SIGN_OUT_ENDPOINT,
  type KioskOpenVisit,
  type KioskSignOutResponse,
  type KioskVisitorErrorCode,
} from "@/lib/kiosk/contract";
import { KIOSK_LEAVING_COPY, kioskSignOutConfirmTitle, kioskSignedOutLine, kioskSignedOutTitle } from "@/lib/kiosk/screens";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskConfirmSheet } from "./KioskConfirmSheet";
import { KioskHeader } from "./KioskHeader";
import { OpenVisitRow } from "./OpenVisitRow";
import { kioskRequestInit, useKiosk } from "./kiosk-context";
import { kioskVisitorErrorCode, useKioskPrefixSearch } from "./use-kiosk-prefix-search";

/** Kept for callers and tests that set the pause before a search. */
export const KIOSK_LEAVING_DEBOUNCE_MS = KIOSK_SEARCH_DEBOUNCE_MS;

function leavingError(code: KioskVisitorErrorCode): string {
  return code in KIOSK_LEAVING_COPY.errors ? KIOSK_LEAVING_COPY.errors[code as keyof typeof KIOSK_LEAVING_COPY.errors] : KIOSK_VISITOR_ERROR_COPY[code];
}

/**
 * `/kiosk/leaving`, reached from "Leaving? Sign out" on the home screen.
 * Nothing is listed, and nothing is asked of the server, until three letters
 * are typed; then at most five open visits, first name and last initial only.
 * A tap asks "Sign out Brian L.?" before anything is written. The shell sends
 * this screen home after 60 seconds without input.
 */
export function KioskLeaving({ debounceMs = KIOSK_LEAVING_DEBOUNCE_MS }: { debounceMs?: number } = {}) {
  const router = useRouter();
  const { device, fetchImpl, timeZone, forgetDevice, goHome } = useKiosk();
  const [query, setQuery] = useState("");
  const [choosing, setChoosing] = useState<KioskOpenVisit | null>(null);
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState<KioskSignOutResponse | null>(null);
  const search = useKioskPrefixSearch<KioskOpenVisit>({ query, endpoint: KIOSK_VISITOR_OPEN_ENDPOINT, minLetters: KIOSK_SIGN_OUT_MIN_LETTERS, debounceMs });

  async function signOut(visit: KioskOpenVisit) {
    if (!device || busy) return;
    setBusy(true);
    try {
      const response = await fetchImpl(KIOSK_VISITOR_SIGN_OUT_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: { entry_id: visit.entry_id } }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (response.ok) {
        setSignedOut(body as KioskSignOutResponse);
        return;
      }
      const code = kioskVisitorErrorCode(body);
      if (code === "device_unknown") {
        await forgetDevice();
        router.replace("/kiosk/setup");
        return;
      }
      setSignOutError(leavingError(code));
    } catch {
      setSignOutError(KIOSK_VISITOR_ERROR_COPY.unavailable);
    } finally {
      setBusy(false);
      setChoosing(null);
    }
  }

  if (signedOut) {
    return (
      <main className="flex min-h-dvh flex-col bg-background">
        <KioskHeader title={KIOSK_LEAVING_COPY.title} />
        <ConfirmPanel
          title={kioskSignedOutTitle(signedOut.display_name)}
          body={kioskSignedOutLine(signedOut.checked_in_at, signedOut.checked_out_at, timeZone)}
          onDone={goHome}
        />
      </main>
    );
  }

  const errorMessage = signOutError ?? (search.state === "error" ? leavingError(search.code) : null);
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader title={KIOSK_LEAVING_COPY.title} back />
      <div className="flex flex-1 flex-col gap-5 px-10 py-7">
        <div className="flex flex-col gap-2.5">
          <label htmlFor="kiosk-leaving-name" className="text-[22px] font-semibold text-foreground">
            {KIOSK_LEAVING_COPY.nameLabel}
          </label>
          <div className="relative w-155 max-w-full">
            <Search className="pointer-events-none absolute left-4.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id="kiosk-leaving-name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value.slice(0, 60));
                setSignOutError(null);
              }}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="search"
              aria-describedby="kiosk-leaving-helper kiosk-leaving-status"
              className="h-17 w-full rounded-[12px] border-[2.5px] border-chrome-primary bg-card pl-14 pr-4.5 text-[26px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
            />
          </div>
          <p id="kiosk-leaving-helper" className="text-base text-muted-foreground">
            {KIOSK_LEAVING_COPY.nameHelper}
          </p>
        </div>
        <div id="kiosk-leaving-status" role="status" className="text-lg empty:hidden">
          {!signOutError && search.state === "loading" ? <p className="text-muted-foreground">{KIOSK_LEAVING_COPY.searching}</p> : null}
          {!signOutError && search.state === "success-populated" ? <p className="text-muted-foreground">{KIOSK_LEAVING_COPY.hint}</p> : null}
          {!errorMessage && search.state === "success-empty" ? <p className="text-foreground">{KIOSK_LEAVING_COPY.none}</p> : null}
          {errorMessage ? <p className="font-semibold text-destructive">{errorMessage}</p> : null}
        </div>
        {search.state === "success-populated" && !signOutError ? (
          <ul aria-label={KIOSK_LEAVING_COPY.listLabel} className="flex w-205 max-w-full flex-col gap-3">
            {search.matches.map((visit) => (
              <OpenVisitRow key={visit.entry_id} visit={visit} timeZone={timeZone} disabled={busy} onChoose={() => setChoosing(visit)} />
            ))}
          </ul>
        ) : null}
      </div>
      {choosing ? (
        <KioskConfirmSheet
          title={kioskSignOutConfirmTitle(choosing.display_name)}
          confirmLabel={KIOSK_LEAVING_COPY.signOut}
          cancelLabel={KIOSK_LEAVING_COPY.cancel}
          busy={busy}
          onConfirm={() => void signOut(choosing)}
          onCancel={() => setChoosing(null)}
        />
      ) : null}
    </main>
  );
}
