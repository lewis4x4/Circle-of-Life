"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { KIOSK_STAFF_COPY, kioskRosterFilter, kioskThrottledCopy } from "@/lib/kiosk/screens";
import { KIOSK_COPY, type KioskRosterEntry } from "@/lib/timeclock/kiosk-contract";
import { cn } from "@/lib/utils";

import { KIOSK_CARD, KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";
import type { KioskRosterState } from "./use-kiosk-roster";

const LINK = cn("inline-flex min-h-12 items-center rounded-[8px] px-1 text-[17px] font-semibold text-foreground underline underline-offset-4", KIOSK_FOCUS);

/**
 * Staff clock's first screen: "Tap your name". The filter narrows the tiles on
 * every keystroke, on this tablet only. A throttled tablet still shows the
 * names, says when PIN entry reopens, and holds the tiles until then.
 */
export function StaffNamePicker({
  roster,
  throttledUntil,
  timeZone,
  onPick,
  onUseNumber,
}: {
  roster: KioskRosterState;
  /** Set while PIN entry is closed on this tablet; ISO. */
  throttledUntil: string | null;
  timeZone: string;
  onPick: (entry: KioskRosterEntry) => void;
  onUseNumber: () => void;
}) {
  const [filter, setFilter] = useState("");
  const names = roster.state === "success-populated" ? kioskRosterFilter(roster.roster, filter) : [];
  const throttled = throttledUntil !== null;

  return (
    <>
      <div className="flex flex-1 flex-col gap-5 px-10 pb-6 pt-7">
        <div className="flex flex-col gap-4 min-[1000px]:flex-row min-[1000px]:items-end min-[1000px]:justify-between">
          <h2 className="text-[30px] font-semibold text-foreground">{KIOSK_STAFF_COPY.tapName}</h2>
          {roster.state === "success-populated" ? (
            <div className="relative w-120 max-w-full">
              <label htmlFor="kiosk-staff-filter" className="sr-only">
                {KIOSK_STAFF_COPY.filterLabel}
              </label>
              <Search className="pointer-events-none absolute left-4.5 top-1/2 size-5.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="kiosk-staff-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value.slice(0, 60))}
                placeholder={KIOSK_STAFF_COPY.filterPlaceholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="search"
                aria-controls="kiosk-staff-names"
                className="h-15 w-full rounded-[10px] border-[1.5px] border-input bg-card pl-13 pr-4.5 text-xl text-foreground placeholder:text-muted-foreground focus:border-chrome-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
              />
            </div>
          ) : null}
        </div>

        <div role="status" className="text-lg empty:hidden">
          {throttled ? <p className="font-semibold text-destructive">{kioskThrottledCopy(throttledUntil, timeZone)}</p> : null}
          {roster.state === "loading" ? <p className="text-muted-foreground">{KIOSK_STAFF_COPY.loadingNames}</p> : null}
          {roster.state === "offline-empty" ? <p className="text-foreground">{KIOSK_STAFF_COPY.offlineNoNames}</p> : null}
          {roster.state === "error" ? <p className="font-semibold text-destructive">{KIOSK_COPY.errors[roster.code]}</p> : null}
          {roster.state === "success-populated" && names.length === 0 ? <p className="text-foreground">{KIOSK_STAFF_COPY.noFilterMatch}</p> : null}
        </div>

        {names.length > 0 ? (
          <ul id="kiosk-staff-names" aria-label={KIOSK_STAFF_COPY.namesLabel} className="grid grid-cols-3 content-start gap-4 landscape:grid-cols-4">
            {names.map((entry) => (
              <li key={entry.staff_id} className="flex">
                <button
                  type="button"
                  disabled={throttled}
                  onClick={() => onPick(entry)}
                  className={cn(
                    KIOSK_CARD,
                    "flex min-h-18 w-full items-center justify-center rounded-[14px] px-4 py-3 text-center text-[22px] font-semibold leading-tight text-foreground hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50",
                    KIOSK_FOCUS,
                    KIOSK_PRESS,
                  )}
                >
                  {entry.display_name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border px-6 py-2 text-center text-[17px] text-muted-foreground">
        <span>{KIOSK_STAFF_COPY.notOnList}</span>
        <button type="button" onClick={onUseNumber} className={LINK}>
          {KIOSK_STAFF_COPY.useNumber}
        </button>
      </footer>
    </>
  );
}
