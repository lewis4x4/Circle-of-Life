"use client";

import { KIOSK_LEAVING_COPY, formatKioskClock } from "@/lib/kiosk/screens";
import type { KioskOpenVisit } from "@/lib/kiosk/contract";
import { cn } from "@/lib/utils";

import { KIOSK_CARD, KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";

/** One open visit on the sign-out list: 84 px, the whole row is the button. */
export function OpenVisitRow({ visit, timeZone, disabled, onSignOut }: { visit: KioskOpenVisit; timeZone: string; disabled?: boolean; onSignOut: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSignOut}
        disabled={disabled}
        aria-label={`${KIOSK_LEAVING_COPY.signOut} ${visit.display_name}, ${visit.type_label}, in ${formatKioskClock(visit.checked_in_at, timeZone)}`}
        className={cn(KIOSK_CARD, "flex h-21 w-full items-center justify-between gap-4 rounded-[14px] px-6.5 text-left hover:bg-muted/40 disabled:opacity-60", KIOSK_FOCUS, KIOSK_PRESS)}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-2xl font-semibold text-foreground">{visit.display_name}</span>
          <span className="truncate text-base text-muted-foreground">{visit.type_label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-4.5">
          <span className="text-[17px] text-muted-foreground tabular-nums">in {formatKioskClock(visit.checked_in_at, timeZone)}</span>
          <span className="inline-flex h-13 items-center rounded-[10px] bg-chrome-primary px-5.5 text-lg font-semibold text-chrome-foreground">
            {KIOSK_LEAVING_COPY.signOut}
          </span>
        </span>
      </button>
    </li>
  );
}
