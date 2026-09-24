"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { loadCaregiverFacilityContext, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { usePublishedWorkShift } from "@/hooks/usePublishedWorkShift";
import type { ScheduleAssignmentInterval } from "@/lib/schedules/assignment-context";
import type { FloorInactiveReason, FloorLockReason } from "@/lib/floor/contract";
import { resolveFloorDeviceStore, type FloorDevice } from "@/lib/floor/device-store";
import { clearBrowserSessionCookies, floorLockHref, forgetFloorPerson, sendFloorLock } from "@/lib/floor/lock-client";
import { currentRetryOwner } from "@/lib/floor/check-submit";
import { replayFloorQueues } from "@/lib/floor/replay";
import { startFloorReplayScheduler } from "@/lib/floor/replay-scheduler";
import { resolveFloorRetryOwner } from "@/lib/floor/retry-owner";
import { currentFloorUnlockId } from "@/lib/floor/session-context";
import { currentFloorUnlockProfile, type FloorUnlockProfile } from "@/lib/floor/unlock-profile";
import { formatDisplayTime } from "@/lib/format/datetime";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { FloorSessionContext, type FloorSession } from "./FloorContext";
import { FloorLockScreen } from "./FloorLockScreen";
import { FloorStatePanel } from "./FloorStatePanel";
import { FloorTabBar } from "./FloorTabBar";
import { FloorTopBar } from "./FloorTopBar";
import { FLOOR_PRIMARY_BUTTON } from "./floor-styles";
import { useFloorLockTriggers } from "./useFloorLockTriggers";
import { useFloorSyncState } from "./useFloorSyncState";

const FLOOR_FACILITY_UNAVAILABLE_COPY = "This tablet could not open your building. Check the Wi-Fi, then lock the tablet and unlock again.";

type ShellState =
  | { status: "checking" }
  | { status: "not-a-tablet" }
  | { status: "facility-error"; message: string; device: FloorDevice; profile: FloorUnlockProfile }
  | { status: "ready"; device: FloorDevice; profile: FloorUnlockProfile; facility: CaregiverFacilityContext }
  | { status: "locked"; reason: FloorInactiveReason | null };

/** "Med tech · Day shift · on since 6:58 AM", from actual attendance and the person's published assignment. */
export function topBarDetailLine(profile: FloorUnlockProfile, facility: CaregiverFacilityContext, work?: ScheduleAssignmentInterval | null): string {
  const since = profile.clockedInAt
    ? `on since ${formatDisplayTime(profile.clockedInAt, { timeZone: facility.timeZone })}`
    : profile.onClock
      ? null
      : "not clocked in at the front door";
  return [profile.roleLabel || null, work ? `${work.label} · scheduled` : null, since].filter(Boolean).join(" · ");
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
  const { current: workAssignment } = usePublishedWorkShift(state.status === "ready" ? state.facility.facilityId : null, state.status === "ready" ? state.profile.userId : null);
  const locking = useRef(false);

  // Waiting to leave for /floor/lock until the network is back (offline lock).
  const pendingNavigation = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (pendingNavigation.current) window.removeEventListener("online", pendingNavigation.current);
    },
    [],
  );

  /**
   * Lock the page itself, with or without a network: the unlocked screens
   * unmount at once (the shell renders the lock screen from the client
   * bundle), everything the page held for the person is forgotten, and the
   * session cookies are expired here. Then the tablet moves to /floor/lock,
   * straight away online, or when the network comes back: an offline
   * navigation would fail to load and leave the error page, not a lock.
   */
  const endLocally = useCallback(
    (reason: FloorInactiveReason | null) => {
      forgetFloorPerson();
      clearBrowserSessionCookies();
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setState({ status: "locked", reason });
      const href = floorLockHref(reason);
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        router.replace(href);
        return;
      }
      const go = () => {
        window.removeEventListener("online", go);
        pendingNavigation.current = null;
        router.replace(href);
      };
      pendingNavigation.current = go;
      window.addEventListener("online", go);
    },
    [router, supabase],
  );

  // The token the page holds lets the lock leave synchronously when the page is going away.
  const deviceToken = useRef<string | null>(null);
  const lock = useCallback(
    (reason: FloorLockReason) => {
      if (locking.current) return;
      locking.current = true;
      const next = reason === "switch" ? null : reason;
      // The request carries this session's cookies so the route can revoke it;
      // offline it is retried when the network returns (sendFloorLock).
      const sent = sendFloorLock(reason, fetch, deviceToken.current);
      // The request already holds the unlock id; the page forgets the person now.
      forgetFloorPerson();
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        endLocally(next);
        return;
      }
      // Online: the content goes now; the page leaves once the route has
      // ended the unlock and cleared the cookies (unchanged online path).
      setState({ status: "locked", reason: next });
      void sent.finally(() => endLocally(next));
    },
    [endLocally],
  );

  // The mount check below runs once per shell; it reads the latest lock through a ref.
  const endLocallyRef = useRef(endLocally);
  useEffect(() => {
    endLocallyRef.current = endLocally;
  }, [endLocally]);

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
      deviceToken.current = device.token;
      const profile = currentFloorUnlockProfile();
      if (!profile || !currentFloorUnlockId()) {
        // A session with no unlock on this page (a new tab, a lost reload) is
        // not someone's unlock: end it and go to the lock screen.
        locking.current = true;
        await sendFloorLock("switch");
        if (active) endLocallyRef.current(null);
        return;
      }
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!active) return;
      if (!resolved.ok) {
        // The caregiver lookup's words are for the caregiver header ("choose your
        // working facility"); the tablet says what the operator can do instead.
        console.error("[floor] facility context failed", resolved.error);
        return setState({ status: "facility-error", message: FLOOR_FACILITY_UNAVAILABLE_COPY, device, profile });
      }
      if (resolved.ctx.facilityId !== device.facilityId) {
        return setState({
          status: "facility-error",
          message: "Your account does not have access to this tablet's building. Lock the tablet and ask the administrator.",
          device,
          profile,
        });
      }
      setState({ status: "ready", device, profile, facility: resolved.ctx });
      // Remember who saves checks for this unlock while Haven is reachable, so
      // a check charted after the Wi-Fi drops still reaches the outbox.
      void resolveFloorRetryOwner({
        unlockId: profile.unlockId,
        organizationId: resolved.ctx.organizationId,
        facilityId: resolved.ctx.facilityId,
        resolve: currentRetryOwner,
      }).catch(() => undefined);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const ready = state.status === "ready" ? state : null;
  // Someone is unlocked once the shell knows the device and the unlock, even
  // when their facility could not be read: the lock triggers run from then on.
  const unlocked = state.status === "ready" || state.status === "facility-error" ? state : null;
  const { sync, refresh: refreshSync } = useFloorSyncState(ready?.profile.userId ?? null);

  // Items other people left on this tablet go out as their owners: at unlock,
  // on reconnect and every minute, one pass at a time, stopped on lock.
  const readyUserId = ready?.profile.userId ?? null;
  useEffect(() => {
    if (!readyUserId) return;
    const scheduler = startFloorReplayScheduler({
      run: () => replayFloorQueues({ signedInUserId: readyUserId }),
      onSettled: refreshSync,
    });
    return () => scheduler.stop();
  }, [readyUserId, refreshSync]);

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
            workAssignment,
            lock: () => lock("switch"),
          }
        : null,
    [ready, supabase, lock, workAssignment],
  );

  if (state.status === "not-a-tablet") return <NotATabletNotice />;
  if (state.status === "locked") {
    return (
      <Suspense fallback={null}>
        <FloorLockScreen reason={state.reason} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {ready && session ? (
        <FloorTopBar
          initials={ready.profile.initials}
          displayName={ready.profile.displayName}
          detailLine={topBarDetailLine(ready.profile, ready.facility, workAssignment)}
          facilityName={ready.device.facilityName || ready.facility.facilityName}
          deviceLabel={ready.device.deviceLabel}
          sync={sync}
          timeZone={session.timeZone}
          onSwitch={session.lock}
        />
      ) : (
        <div className="h-14 shrink-0 border-b border-border bg-chrome-primary" aria-hidden />
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        {state.status === "checking" ? (
          <FloorStatePanel state="loading" title="Opening the floor tablet" pageTitle="Floor tablet" className="flex-1" />
        ) : state.status === "facility-error" ? (
          <FloorStatePanel state="error" title={state.message} onRetry={() => lock("switch")} retryLabel="Lock this tablet" pageTitle="Floor tablet" className="flex-1" />
        ) : (
          <FloorSessionContext.Provider value={session}>{children}</FloorSessionContext.Provider>
        )}
      </main>
      <FloorTabBar />
    </div>
  );
}
