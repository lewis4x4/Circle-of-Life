"use client";

import { Clock } from "lucide-react";

import { KIOSK_STAFF_COPY, kioskStaffStateLine } from "@/lib/kiosk/screens";
import { KIOSK_COPY, type KioskIdentifyResponse, type PunchType } from "@/lib/timeclock/kiosk-contract";
import { cn } from "@/lib/utils";

import { KIOSK_FOCUS, KIOSK_PRIMARY, KIOSK_SECONDARY } from "./kiosk-styles";

/**
 * Identified (`12-kiosk-clock-in`): greeting, where they stand, and one large
 * button for the valid next action. When two actions are valid (on the clock:
 * clock out or start a meal) the second is a smaller outlined button.
 */
export function StaffActions({
  identified,
  offline,
  time,
  timeZone,
  busy,
  onPunch,
  onStartOver,
}: {
  identified: KioskIdentifyResponse;
  offline: boolean;
  time: string;
  timeZone: string;
  busy: boolean;
  onPunch: (punchType: PunchType) => void;
  onStartOver: () => void;
}) {
  const [primary, ...others] = identified.next_actions;
  const name = identified.first_name.trim();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <h2 className="text-[44px] font-semibold leading-tight text-foreground">{name ? `Hello, ${name}.` : KIOSK_STAFF_COPY.chooseAction}</h2>
      <p className="text-xl text-muted-foreground">{offline ? KIOSK_STAFF_COPY.offlineChoose : kioskStaffStateLine(identified.state, identified.last_out_at, timeZone)}</p>
      {primary ? (
        <button type="button" className={cn(KIOSK_PRIMARY, "mt-3 h-28 w-115 max-w-full gap-4 rounded-[16px] text-[32px]")} disabled={busy} onClick={() => onPunch(primary)}>
          <Clock className="size-9" aria-hidden />
          {KIOSK_COPY.actionLabels[primary]}
        </button>
      ) : null}
      {others.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-4">
          {others.map((action) => (
            <button key={action} type="button" className={cn(KIOSK_SECONDARY, "h-18 w-115 max-w-full")} disabled={busy} onClick={() => onPunch(action)}>
              {KIOSK_COPY.actionLabels[action]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-lg text-muted-foreground tabular-nums">{time}</p>
      <button type="button" onClick={onStartOver} className={cn("mt-2 h-13 rounded-[10px] px-5 text-[17px] text-foreground underline underline-offset-4", KIOSK_FOCUS)}>
        {KIOSK_STAFF_COPY.notYou}
      </button>
    </div>
  );
}
