"use client";

import { useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  FLOOR_ERROR_COPY,
  FLOOR_HOME_PATH,
  FLOOR_LOCKED_COPY,
  FLOOR_SETUP_PATH,
  type FloorInactiveReason,
  type FloorRosterPerson,
} from "@/lib/floor/contract";
import { forgetFloorPerson, sendFloorLock } from "@/lib/floor/lock-client";
import { currentFloorUnlockId } from "@/lib/floor/session-context";
import { adoptFloorUnlock, requestFloorUnlock } from "@/lib/floor/unlock-client";
import { DEFAULT_DISPLAY_TIME_ZONE, formatDisplayTime } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";

import { FloorAvatar } from "./FloorAvatar";
import { FloorDeviceLine, FloorLockBar, FloorOnlineState, NotYouButton } from "./FloorLockChrome";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING, FLOOR_OUTLINE_BUTTON } from "./floor-styles";
import { PinPad } from "./PinPad";
import { RosterTile } from "./RosterTile";
import { useFloorRoster } from "./useFloorRoster";

const PIN_HELPER = "Same PIN you use at the front door. 5 tries, then a 15 minute lock.";
const INACTIVE_REASONS = new Set(Object.keys(FLOOR_LOCKED_COPY));

type Selection = { kind: "roster"; person: FloorRosterPerson } | { kind: "employee_number" };

function timeLabel(iso: string | null): string | null {
  return iso ? formatDisplayTime(iso, { timeZone: DEFAULT_DISPLAY_TIME_ZONE }) : null;
}

export function lockRulesLine(idleMinutes: number): string {
  const idle = `${idleMinutes} ${idleMinutes === 1 ? "minute" : "minutes"}`;
  return `Locks when the screen sleeps, after ${idle} idle, when you tap Switch, or when you clock out.`;
}

/**
 * `/floor/lock` (DESIGN.md 01, 02, 02b): who is on shift, then their PIN. The
 * page needs no session; the device token in IndexedDB is what lets it ask.
 */
export function FloorLockScreen({ reason }: { reason?: FloorInactiveReason | null } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { device, roster, unsent, retry } = useFloorRoster();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const employeeInputId = useId();

  const reasonParam = reason !== undefined ? reason : searchParams.get("reason");
  const lockedLine = reasonParam && INACTIVE_REASONS.has(reasonParam) ? FLOOR_LOCKED_COPY[reasonParam as FloorInactiveReason] : null;

  // Arriving here with an unlock still on the page (Back, a reload after an
  // offline lock) ends it: the lock screen never sits over someone's session.
  useEffect(() => {
    if (currentFloorUnlockId()) void sendFloorLock("switch");
    forgetFloorPerson();
  }, []);

  useEffect(() => {
    if (device === null) router.replace(FLOOR_SETUP_PATH);
  }, [device, router]);

  const rosterData = roster.status === "success-empty" || roster.status === "success-populated" ? roster.roster : null;
  const facilityName = rosterData?.facility_name || device?.facilityName || null;
  const deviceLabel = rosterData?.device_label || device?.deviceLabel || null;
  const idleMinutes = rosterData?.idle_lock_minutes ?? null;

  const choose = (next: Selection | null) => {
    setSelection(next);
    setError(null);
    setEmployeeNumber("");
    setAttempt((value) => value + 1);
  };

  async function unlock(pin: string) {
    if (!device || !selection || busy) return;
    if (selection.kind === "employee_number" && !employeeNumber.trim()) {
      setError("Type your employee number first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestFloorUnlock(
      device,
      selection.kind === "roster" ? { staff_id: selection.person.staff_id, pin } : { employee_number: employeeNumber.trim(), pin },
    );
    if (!result.ok) {
      setBusy(false);
      setError(FLOOR_ERROR_COPY[result.code]);
      setAttempt((value) => value + 1);
      return;
    }
    adoptFloorUnlock(device, result.value, selection.kind === "roster" ? selection.person.initials : null);
    router.replace(FLOOR_HOME_PATH);
  }

  if (selection) {
    const person = selection.kind === "roster" ? selection.person : null;
    const clockedIn = timeLabel(person?.clocked_in_at ?? null);
    const throttled = rosterData?.throttled_until ? FLOOR_ERROR_COPY.device_throttled : null;
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <FloorLockBar left={<NotYouButton onClick={() => choose(null)} />} />
        <main className="flex flex-1 items-center justify-center px-6 py-8">
          <PinPad
            key={attempt}
            busy={busy}
            error={error ?? throttled}
            helper={PIN_HELPER}
            onUnlock={(pin) => void unlock(pin)}
            header={
              person ? (
                <>
                  <FloorAvatar initials={person.initials} size="lg" filled />
                  <div className="flex flex-col items-center gap-1.5 text-center">
                    <h1 className="text-3xl font-semibold">{person.display_name}</h1>
                    <p className="text-[15px] tabular-nums text-muted-foreground">
                      {clockedIn ? `Clocked in at the front door, ${clockedIn}` : person.role_label}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex w-full flex-col gap-2">
                  <h1 className="sr-only">Unlock with your employee number</h1>
                  <label htmlFor={employeeInputId} className="text-[17px] font-semibold">
                    Employee number
                  </label>
                  <input
                    id={employeeInputId}
                    value={employeeNumber}
                    onChange={(event) => setEmployeeNumber(event.target.value.slice(0, 64))}
                    autoComplete="off"
                    inputMode="numeric"
                    className={cn("h-15 w-full rounded-[8px] border border-input bg-card px-4 text-xl tabular-nums text-foreground", FLOOR_FOCUS_RING)}
                  />
                  <span className="text-[13px] text-muted-foreground">For when your name is not on the list. Your manager sees it on the timesheet.</span>
                </div>
              )
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <FloorLockBar left={<FloorDeviceLine facilityName={facilityName} deviceLabel={deviceLabel} />} right={<FloorOnlineState />} />
      <main className="flex flex-1 flex-col items-center justify-center gap-9 px-6 py-10 md:px-16">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h1 className="text-[40px] font-semibold tracking-tight">Who&apos;s on shift?</h1>
          <p className="text-[17px] text-muted-foreground">Tap your name. Only people clocked in at the front door show here.</p>
          {lockedLine ? (
            <p role="status" className="mt-1 text-[15px] font-medium text-foreground">
              {lockedLine}
            </p>
          ) : null}
        </div>

        {roster.status === "idle" || roster.status === "loading" ? (
          <FloorStatePanel state="loading" title="Checking who is clocked in" />
        ) : roster.status === "error" ? (
          <FloorStatePanel
            state="error"
            title={FLOOR_ERROR_COPY[roster.code]}
            detail={roster.code === "device_unknown" ? "The administrator sets this tablet up again from Floor setup." : null}
            onRetry={retry}
          />
        ) : roster.status === "success-empty" ? (
          <FloorStatePanel
            state="empty"
            title="Nobody is clocked in at the front door yet."
            detail="Clock in at the front door, then your name shows here. Not on the list? Use your employee number."
          />
        ) : (
          <ul className="flex max-w-full flex-wrap justify-center gap-6" aria-label="People on shift">
            {roster.roster.roster.map((person, index) => (
              <li key={person.staff_id}>
                <RosterTile
                  displayName={person.display_name}
                  initials={person.initials}
                  roleLabel={person.role_label}
                  clockedInLabel={timeLabel(person.clocked_in_at)}
                  lastOnThisTablet={index === 0 && Boolean(person.last_on_this_device)}
                  unsent={person.user_id ? (unsent[person.user_id] ?? 0) : 0}
                  onSelect={() => choose({ kind: "roster", person })}
                />
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={() => choose({ kind: "employee_number" })} className={cn(FLOOR_OUTLINE_BUTTON, "h-13 rounded-[10px] px-6 text-base font-medium")}>
          Not listed? Use employee number
        </button>
      </main>
      <footer className="flex min-h-14 shrink-0 items-center justify-center border-t border-border px-6 text-center text-[13px] text-muted-foreground">
        {idleMinutes ? lockRulesLine(idleMinutes) : "Locks when the screen sleeps, when you tap Switch, or when you clock out."}
      </footer>
    </div>
  );
}
