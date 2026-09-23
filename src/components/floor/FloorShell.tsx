"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { loadCaregiverFacilityContext, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { currentShiftFor } from "@/lib/caregiver/shift";
import type { FloorInactiveReason, FloorLockReason } from "@/lib/floor/contract";
import { resolveFloorDeviceStore, type FloorDevice } from "@/lib/floor/device-store";
import { floorLockHref, forgetFloorPerson, sendFloorLock } from "@/lib/floor/lock-client";
import { replayFloorQueues } from "@/lib/floor/replay";
import { currentFloorUnlockId } from "@/lib/floor/session-context";
import { currentFloorUnlockProfile, type FloorUnlockProfile } from "@/lib/floor/unlock-profile";
import { formatDisplayTime } from "@/lib/format/datetime";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { FloorSessionContext, type FloorSession } from "./FloorContext";
import { FloorStatePanel } from "./FloorStatePanel";
import { FloorTabBar } from "./FloorTabBar";
import { FloorTopBar } from "./FloorTopBar";
import { FLOOR_PRIMARY_BUTTON } from "./floor-styles";
import { useFloorLockTriggers } from "./useFloorLockTriggers";
import { useFloorSyncState } from "./useFloorSyncState";

type ShellState =
  | { status: "checking" }
  | { status: "not-a-tablet" }
  | { status: "facility-error"; message: string; device: FloorDevice; profile: FloorUnlockProfile }
  | { status: "ready"; device: FloorDevice; profile: FloorUnlockProfile; facility: CaregiverFacilityContext };

/** "Med tech · Day shift · on since 6:58 AM", from the unlock and the facility's shift definitions. */
export function topBarDetailLine(profile: FloorUnlockProfile, facility: CaregiverFacilityContext, now: Date = new Date()): string {
  const shift = currentShiftFor(facility, now);
  const since = profile.clockedInAt
    ? `on since ${formatDisplayTime(profile.clockedInAt, { timeZone: facility.timeZone })}`
    : profile.onClock
      ? null
      : "not clocked in at the front door";
  return [profile.roleLabel || null, shift.configured ? `${shift.label} shift` : null, since].filter(Boolean).join(" · ");
}

/** A med tech who signs in on a PC or phone lands on `/floor`; the floor app is for the tablets. */
function NotATabletNotice() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="flex max-w-md flex-col items-center gap-4 rounded-[14px] border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">This page is for the floor tablets.</h1>
        <p className="text-base text-muted-foreground">On this computer or phone, use the caregiver app for rounds, reports and handoff.</p>
        <Link href="/caregiver" className={cn(FLOOR_PRIMARY_BUTTON, "h-13 px-6 text-base")}>
          Open the caregiver app
        </Link>
      </section>
    </main>
  );
}

/**
 * Everything unlocked on a floor tablet renders inside this shell: the top bar,
 * the tab bar, the lock triggers and the heartbeat. With no unlock on the page
 * it locks; with no enrolled device it is not a floor tablet.
 */
export function FloorShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ShellState>({ status: "checking" });
  const locking = useRef(false);

  const endLocally = useCallback(
    (reason: FloorInactiveReason | null) => {
      forgetFloorPerson();
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      router.replace(floorLockHref(reason));
    },
    [router, supabase],
  );

  const lock = useCallback(
    (reason: FloorLockReason) => {
      if (locking.current) return;
      locking.current = true;
      void sendFloorLock(reason).finally(() => endLocally(reason === "switch" ? null : reason));
    },
    [endLocally],
  );

  const ended = useCallback(
    (reason: FloorInactiveReason) => {
      if (locking.current) return;
      locking.current = true;
      endLocally(reason);
    },
    [endLocally],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const device = await resolveFloorDeviceStore().getDevice().catch(() => null);
      if (!active) return;
      if (!device) return setState({ status: "not-a-tablet" });
      const profile = currentFloorUnlockProfile();
      if (!profile || !currentFloorUnlockId()) {
        // A session with no unlock on this page (a new tab, a lost reload) is
        // not someone's unlock: end it and go to the lock screen.
        locking.current = true;
        await sendFloorLock("switch");
        if (active) endLocally(null);
        return;
      }
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!active) return;
      if (!resolved.ok) return setState({ status: "facility-error", message: resolved.error, device, profile });
      if (resolved.ctx.facilityId !== device.facilityId) {
        return setState({
          status: "facility-error",
          message: "Your account does not have access to this tablet's building. Lock the tablet and ask the administrator.",
          device,
          profile,
        });
      }
      setState({ status: "ready", device, profile, facility: resolved.ctx });
      // Items other people left on this tablet go out as their owners.
      void replayFloorQueues({ signedInUserId: profile.userId }).catch(() => undefined);
    })();
    return () => {
      active = false;
    };
  }, [supabase, endLocally]);

  const ready = state.status === "ready" ? state : null;
  // Someone is unlocked once the shell knows the device and the unlock, even
  // when their facility could not be read: the lock triggers run from then on.
  const unlocked = state.status === "ready" || state.status === "facility-error" ? state : null;
  const sync = useFloorSyncState(ready?.profile.userId ?? null);

  useFloorLockTriggers({
    enabled: Boolean(unlocked),
    deviceToken: unlocked?.device.token ?? null,
    unlockId: unlocked?.profile.unlockId ?? null,
    idleLockMinutes: unlocked?.profile.idleLockMinutes ?? 3,
    onLock: lock,
    onEnded: ended,
  });

  const session: FloorSession | null = useMemo(
    () =>
      ready
        ? {
            supabase,
            device: ready.device,
            profile: ready.profile,
            facility: ready.facility,
            timeZone: ready.facility.timeZone,
            lock: () => lock("switch"),
          }
        : null,
    [ready, supabase, lock],
  );

  if (state.status === "not-a-tablet") return <NotATabletNotice />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {ready && session ? (
        <FloorTopBar
          initials={ready.profile.initials}
          displayName={ready.profile.displayName}
          detailLine={topBarDetailLine(ready.profile, ready.facility)}
          facilityName={ready.device.facilityName || ready.facility.facilityName}
          deviceLabel={ready.device.deviceLabel}
          sync={sync}
          timeZone={session.timeZone}
          onSwitch={session.lock}
        />
      ) : (
        <div className="h-14 shrink-0 border-b border-border bg-chrome-primary" aria-hidden />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {state.status === "checking" ? (
          <FloorStatePanel state="loading" title="Opening the floor tablet" className="flex-1" />
        ) : state.status === "facility-error" ? (
          <FloorStatePanel state="error" title={state.message} onRetry={() => lock("switch")} retryLabel="Lock this tablet" className="flex-1" />
        ) : (
          <FloorSessionContext.Provider value={session}>{children}</FloorSessionContext.Provider>
        )}
      </div>
      <FloorTabBar />
    </div>
  );
}
