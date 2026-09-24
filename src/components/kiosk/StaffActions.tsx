"use client";

import { Clock } from "lucide-react";

import { KIOSK_STAFF_COPY, kioskStaffStateLine } from "@/lib/kiosk/screens";
import { KIOSK_COPY, formatKioskTime, type KioskIdentifyResponse, type PunchType } from "@/lib/timeclock/kiosk-contract";
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
      <section aria-label="Published schedule context" className="w-full max-w-2xl rounded-xl border border-border bg-card p-4 text-left text-base">
        <h3 className="font-semibold">Your published plan today</h3>
        {offline || identified.planned_context?.status !== "ready" ? <p className="mt-1 text-muted-foreground">Schedule context is unavailable. You can still record your actual time.</p> : identified.planned_context.blocks.length === 0 ? <p className="mt-1 text-muted-foreground">No published work block was found for you today at this facility. You can still record your actual time.</p> : <ul className="mt-2 space-y-2">{identified.planned_context.blocks.map((block, index) => <li key={`${block.starts_at}-${index}`} className="flex items-start gap-2">
          {block.color && /^#[0-9a-f]{6}$/i.test(block.color) && <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: block.color }} />}
          <span>{block.label} · {formatKioskTime(block.starts_at, block.time_zone)}–{formatKioskTime(block.ends_at, block.time_zone)}{new Date(block.starts_at).toLocaleDateString("en-CA", { timeZone: block.time_zone }) !== new Date(block.ends_at).toLocaleDateString("en-CA", { timeZone: block.time_zone }) ? " (+1 day)" : ""}{block.block_count && block.block_count > 1 ? ` · block ${(block.block_index ?? index) + 1} of ${block.block_count}` : ""}</span>
        </li>)}</ul>}
        <p className="mt-2 text-sm text-muted-foreground">Planned times do not clock you in or out. For split work, record the actual out and in; gaps are not deducted automatically.</p>
      </section>
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
