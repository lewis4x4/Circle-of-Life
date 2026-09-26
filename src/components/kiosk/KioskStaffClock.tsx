"use client";

import { Users } from "lucide-react";
import { useEffect, useState } from "react";

import { KIOSK_FLOOR_TABLET_LINE, KIOSK_STAFF_COPY, formatKioskClock, kioskPunchTitle } from "@/lib/kiosk/screens";
import { KIOSK_COPY, KIOSK_PIN_IDLE_MS, formatWorkedMinutes } from "@/lib/timeclock/kiosk-contract";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskHeader } from "./KioskHeader";
import { StaffActions } from "./StaffActions";
import { StaffCredentials } from "./StaffCredentials";
import { StaffNamePicker } from "./StaffNamePicker";
import { StaffNamePin } from "./StaffNamePin";
import { useKiosk, useKioskClock } from "./kiosk-context";
import { useKioskRoster } from "./use-kiosk-roster";
import { useStaffPunch, type StaffConfirmation } from "./use-staff-punch";

const IDLE_EVENTS = ["pointerdown", "keydown", "input"] as const;

function confirmationBody(confirmation: StaffConfirmation, facilityName: string): string {
  if (confirmation.offline) return KIOSK_COPY.offlineSaved;
  const parts = [confirmation.displayName ?? confirmation.firstName, facilityName].filter(Boolean) as string[];
  if (confirmation.punchType !== "in" && confirmation.todayWorkedMinutes !== null) {
    parts.push(`${formatWorkedMinutes(confirmation.todayWorkedMinutes)} today`);
  }
  return parts.join(" · ");
}

/** Calls `onIdle` after `ms` without a touch or key while `active`. */
function useIdle(active: boolean, ms: number, onIdle: () => void) {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(onIdle, ms);
    const touch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onIdle, ms);
    };
    for (const name of IDLE_EVENTS) window.addEventListener(name, touch, true);
    return () => {
      window.clearTimeout(timer);
      for (const name of IDLE_EVENTS) window.removeEventListener(name, touch, true);
    };
  }, [active, ms, onIdle]);
}

/**
 * `/kiosk/staff`: the timeclock punch at the front door. It opens on the name
 * list (tap your name, then the PIN); the employee-number screen (`11`, `11b`)
 * is one link away. Then the valid next action (`12`) and the receipt (`13`).
 * The PIN, employee-number and next-action screens go back to the name list
 * after 30 seconds without input; the shell sends the list home after 60.
 */
export function KioskStaffClock({
  newClientPunchId,
  confirmMs,
  pinIdleMs = KIOSK_PIN_IDLE_MS,
  rosterRefreshMs,
}: { newClientPunchId?: () => string; confirmMs?: number; pinIdleMs?: number; rosterRefreshMs?: number } = {}) {
  const { device, timeZone, pendingPunches, goHome, now } = useKiosk();
  const clock = useKioskClock();
  const { roster, refresh } = useKioskRoster({ refreshMs: rosterRefreshMs });
  const flow = useStaffPunch({ newClientPunchId, onThrottled: () => void refresh() });
  const facilityName = device?.facilityName ?? "";

  // Tiles stay held until the throttle ends, then the list is asked again.
  const rosterThrottle = roster.state === "success-populated" || roster.state === "success-empty" ? roster.throttledUntil : null;
  const [throttleOver, setThrottleOver] = useState<string | null>(null);
  const throttledUntil = rosterThrottle && rosterThrottle !== throttleOver ? rosterThrottle : null;
  useEffect(() => {
    if (!throttledUntil) return;
    const wait = Math.max(0, new Date(throttledUntil).getTime() - now().getTime());
    const id = window.setTimeout(() => {
      setThrottleOver(throttledUntil);
      void refresh();
    }, wait);
    return () => window.clearTimeout(id);
  }, [throttledUntil, now, refresh]);

  useIdle(flow.phase === "pin" || flow.phase === "number" || flow.phase === "choose", pinIdleMs, flow.startOver);

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader title={KIOSK_STAFF_COPY.title} back={flow.phase !== "confirm"} />
      {!flow.online ? (
        <p role="status" className="mx-10 mt-4 rounded-[12px] border border-warning/40 bg-warning/10 px-4 py-3 text-base text-foreground">
          {KIOSK_COPY.offlineBanner}
          {pendingPunches > 0 ? ` ${pendingPunches} waiting.` : ""}
        </p>
      ) : pendingPunches > 0 ? (
        <p role="status" className="mx-10 mt-4 text-sm text-muted-foreground">
          {pendingPunches} saved punch{pendingPunches === 1 ? "" : "es"} sending.
        </p>
      ) : null}

      {flow.phase === "roster" ? (
        <StaffNamePicker roster={roster} throttledUntil={throttledUntil} timeZone={timeZone} onPick={flow.pickName} onUseNumber={flow.chooseEmployeeNumber} />
      ) : null}

      {flow.phase === "pin" && flow.picked ? (
        <>
          <StaffNamePin
            person={flow.picked}
            pin={flow.pin}
            onPin={flow.setPin}
            error={flow.error}
            busy={flow.busy}
            onSubmit={() => void flow.identify()}
            onNotYou={flow.startOver}
          />
          <p className="flex h-14 shrink-0 items-center justify-center border-t border-border px-6 text-center text-[15px] text-muted-foreground">
            {KIOSK_STAFF_COPY.privacy}
          </p>
        </>
      ) : null}

      {flow.phase === "number" ? (
        <>
          <StaffCredentials
            stage={flow.stage}
            onStage={flow.setStage}
            identifier={flow.identifier}
            onIdentifier={flow.setIdentifier}
            pin={flow.pin}
            onPin={flow.setPin}
            error={flow.error}
            busy={flow.busy}
            onSubmit={() => void flow.identify()}
            onBackToNames={flow.startOver}
          />
          <p className="flex h-14 shrink-0 items-center justify-center border-t border-border px-6 text-center text-[15px] text-muted-foreground">
            {KIOSK_STAFF_COPY.privacy}
          </p>
        </>
      ) : null}

      {flow.phase === "choose" && flow.identified ? (
        <StaffActions
          identified={flow.identified}
          offline={!flow.online}
          timeZone={timeZone}
          time={clock ? formatKioskClock(clock, timeZone) : "\u00a0"}
          busy={flow.busy}
          onPunch={(type) => void flow.punch(type)}
          onStartOver={flow.startOver}
        />
      ) : null}

      {flow.phase === "confirm" && flow.confirmation ? (
        <ConfirmPanel
          title={
            flow.confirmation.offline
              ? `${KIOSK_COPY.actionLabels[flow.confirmation.punchType]} saved at ${formatKioskClock(flow.confirmation.punchedAt, timeZone)}`
              : kioskPunchTitle(flow.confirmation.punchType, flow.confirmation.punchedAt, timeZone)
          }
          body={confirmationBody(flow.confirmation, facilityName)}
          card={flow.confirmation.offline ? undefined : { icon: Users, content: KIOSK_FLOOR_TABLET_LINE[flow.confirmation.punchType] }}
          showClearsNote
          onDone={goHome}
          resetMs={confirmMs}
        />
      ) : null}
    </main>
  );
}
