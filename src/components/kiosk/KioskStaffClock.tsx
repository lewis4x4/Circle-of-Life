"use client";

import { Users } from "lucide-react";

import { KIOSK_FLOOR_TABLET_LINE, KIOSK_STAFF_COPY, formatKioskClock, kioskPunchTitle } from "@/lib/kiosk/screens";
import { KIOSK_COPY, formatWorkedMinutes } from "@/lib/timeclock/kiosk-contract";

import { ConfirmPanel } from "./ConfirmPanel";
import { KioskHeader } from "./KioskHeader";
import { StaffActions } from "./StaffActions";
import { StaffCredentials } from "./StaffCredentials";
import { useKiosk, useKioskClock } from "./kiosk-context";
import { useStaffPunch, type StaffConfirmation } from "./use-staff-punch";

function confirmationBody(confirmation: StaffConfirmation, facilityName: string): string {
  if (confirmation.offline) return KIOSK_COPY.offlineSaved;
  const parts = [confirmation.displayName ?? confirmation.firstName, facilityName].filter(Boolean) as string[];
  if (confirmation.punchType !== "in" && confirmation.todayWorkedMinutes !== null) {
    parts.push(`${formatWorkedMinutes(confirmation.todayWorkedMinutes)} today`);
  }
  return parts.join(" · ");
}

/** `/kiosk/staff` (`11`, `11b`, `12`, `13`): the timeclock punch at the front door. */
export function KioskStaffClock({ newClientPunchId, confirmMs }: { newClientPunchId?: () => string; confirmMs?: number } = {}) {
  const { device, timeZone, pendingPunches, goHome } = useKiosk();
  const clock = useKioskClock();
  const flow = useStaffPunch({ newClientPunchId });
  const facilityName = device?.facilityName ?? "";

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

      {flow.phase === "credentials" ? (
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
