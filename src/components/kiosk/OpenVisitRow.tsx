"use client";

import { KIOSK_LEAVING_COPY, kioskOpenVisitLine } from "@/lib/kiosk/screens";
import type { KioskOpenVisit } from "@/lib/kiosk/contract";
import { cn } from "@/lib/utils";

import { KIOSK_CARD, KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";

/** One open visit on the sign-out list: 84 px, the whole row is the button. */
export function OpenVisitRow({ visit, timeZone, disabled, onChoose }: { visit: KioskOpenVisit; timeZone: string; disabled?: boolean; onChoose: () => void }) {
  const line = kioskOpenVisitLine(visit.type_label, visit.checked_in_at, timeZone);
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        aria-label={`${KIOSK_LEAVING_COPY.signOut} ${visit.display_name}, ${line}`}
        className={cn(KIOSK_CARD, "flex min-h-21 w-full items-center justify-between gap-4 rounded-[14px] px-6.5 py-3 text-left hover:bg-muted/40 disabled:opacity-60", KIOSK_FOCUS, KIOSK_PRESS)}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-2xl font-semibold text-foreground">{visit.display_name}</span>
          <span className="truncate text-[17px] text-muted-foreground tabular-nums">{line}</span>
        </span>
        <span className="inline-flex h-13 shrink-0 items-center rounded-[10px] bg-chrome-primary px-5.5 text-lg font-semibold text-chrome-foreground">
          {KIOSK_LEAVING_COPY.signOut}
        </span>
      </button>
    </li>
  );
}
