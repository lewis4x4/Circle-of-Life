"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AccountNotLinkedNotice } from "@/components/auth/AccountNotLinkedNotice";
import { WorkingFacilitySelector } from "@/components/caregiver/WorkingFacilitySelector";
import { RoundingOutbox } from "@/components/rounding/RoundingOutbox";
import { StatusPill } from "@/components/ui/status-pill";
import { RoleAppFrame } from "@/design-system/components/RoleAppFrame";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { hasLinkedStaffRecord, loadAccountLinkContact, type AccountLinkContact } from "@/lib/auth/account-link";
import { getAppRoleFromClaims, isMedTechRole } from "@/lib/auth/app-role";
import { isHousekeeperAllowedPath, isStaffLinkOptionalPath } from "@/lib/auth/caregiver-route-access";
import { loadCaregiverFacilityContextForUser } from "@/lib/caregiver/facility-context";
import { currentAssignmentInterval, nextAssignmentInterval, fetchUserAssignmentIntervals } from "@/lib/schedules/assignment-context";
import { routeIsWithin } from "@/lib/navigation/route-match";
import { createClient } from "@/lib/supabase/client";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";

type SyncState = {
  variant: "default" | "success" | "warning" | "destructive";
  label: string;
  pulsing: boolean;
};

function deriveSyncState({
  ready,
  lastError,
  isSyncing,
  online,
  pendingCount,
}: {
  ready: boolean;
  lastError: string | null;
  isSyncing: boolean;
  online: boolean;
  pendingCount: number;
}): SyncState {
  if (!ready) return { variant: "default", label: "Checking sync…", pulsing: false };
  if (lastError) return { variant: "warning", label: "Sync unavailable", pulsing: false };
  if (isSyncing) return { variant: "warning", label: "Syncing", pulsing: true };
  if (!online) {
    return {
      variant: "destructive",
      label: pendingCount > 0 ? `Offline · ${pendingCount}` : "Offline",
      pulsing: false,
    };
  }
  if (pendingCount > 0) {
    return { variant: "warning", label: `Queued · ${pendingCount}`, pulsing: false };
  }
  return { variant: "success", label: "Synced", pulsing: false };
}

export function CaregiverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { appRole, fullName, loading, organizationId, user } = useHavenAuth();
  const [workingFacilityId, setWorkingFacilityId] = useState("");
  const [facilityName, setFacilityName] = useState("Facility");
  const [shiftLabel, setShiftLabel] = useState<string | null>(null);
  // null until checked (or when the check failed): pages render as before.
  const [staffLinked, setStaffLinked] = useState<boolean | null>(null);
  const [linkContact, setLinkContact] = useState<AccountLinkContact | null>(null);
  const effectiveRole = getAppRoleFromClaims(user) || appRole;
  const isHousekeeper = effectiveRole === "housekeeper";
  // Med-techs hold both apps (owner ruling 2026-09-22): the cockpit is their home.
  const isMedTech = isMedTechRole(effectiveRole);
  const roundingSync = useRoundingOfflineSync();
  const syncState = useMemo(
    () =>
      deriveSyncState({
        ready: roundingSync.ready,
        lastError: roundingSync.lastError,
        isSyncing: roundingSync.isSyncing,
        online: roundingSync.online,
        pendingCount: roundingSync.pendingCount,
      }),
    [roundingSync.ready, roundingSync.lastError, roundingSync.isSyncing, roundingSync.online, roundingSync.pendingCount],
  );

  useEffect(() => {
    if (loading || !user?.id) return;

    const supabase = createClient();
    let cancelled = false;
    let shiftRequest = 0;
    let shiftTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshShift = () => {};
    setShiftLabel(null);
    void (async () => {
      try {
        const resolved = await loadCaregiverFacilityContextForUser(supabase, {
          userId: user.id,
          selectedFacilityId: workingFacilityId,
          organizationId,
          appRole: effectiveRole,
        });
        if (!resolved.ok || cancelled) return;
        setFacilityName(resolved.ctx.facilityName ?? "Facility");
        // Floor logins with no staff record hit 403s and zeros on every page;
        // show one "not set up yet" state instead (COL-661).
        if (isMedTech || isHousekeeper) {
          void Promise.all([
            hasLinkedStaffRecord(supabase, user.id),
            loadAccountLinkContact(supabase, resolved.ctx.facilityId),
          ]).then(([linked, contact]) => {
            if (cancelled) return;
            setStaffLinked(linked);
            setLinkContact(contact);
          }).catch((error) => {
            console.error("[CaregiverShell] staff link check failed", error);
          });
        }
        refreshShift = () => {
          const attempt = ++shiftRequest;
          if (shiftTimer) clearTimeout(shiftTimer);
          const now = new Date();
          void fetchUserAssignmentIntervals(supabase, { userId: user.id, facilityId: resolved.ctx.facilityId, from: now, to: new Date(now.getTime() + 86400000) }).then((rows) => {
            if (cancelled || attempt !== shiftRequest) return;
            const current = currentAssignmentInterval(rows, now);
            const next = nextAssignmentInterval(rows, now);
            setShiftLabel(current ? `${current.label} · scheduled` : "No scheduled work block now");
            const boundary = current?.ends_at || next?.starts_at;
            shiftTimer = setTimeout(refreshShift, boundary ? Math.max(1000, Math.min(900000, new Date(boundary).getTime() - now.getTime() + 1)) : 900000);
          }).catch(() => {
            if (!cancelled && attempt === shiftRequest) setShiftLabel("Schedule unavailable");
          });
        };
        refreshShift();
      } catch (error) {
        if (!cancelled) {
          console.error("[CaregiverShell] Failed to load caregiver facility context", error);
        }
      }
    })();
    const onVisible = () => { if (document.visibilityState === "visible") refreshShift(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (shiftTimer) clearTimeout(shiftTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [effectiveRole, isHousekeeper, isMedTech, loading, organizationId, user?.id, workingFacilityId]);

  const isDeeperWorkflowPage = useMemo(
    () =>
      pathname !== "/caregiver" &&
      [
        "/caregiver/tasks",
        "/caregiver/rounds",
        "/caregiver/meds",
        "/caregiver/followups",
        "/caregiver/prn-followup",
        "/caregiver/report",
        "/caregiver/incident-draft",
        "/caregiver/handoff",
      ].some((route) => routeIsWithin(pathname, route)),
    [pathname],
  );

  // Caregiver portal is dark-locked at the route group layout
  // (`src/app/(caregiver)/layout.tsx` wraps in `<div className="dark">`).
  // We intentionally do NOT call `setTheme("dark")` here — that would
  // clobber the user's admin theme choice when navigating between shells.
  // The CSS variable cascade from the wrapping `.dark` class is sufficient.

  useEffect(() => {
    if (isHousekeeper && !isHousekeeperAllowedPath(pathname)) {
      router.replace("/caregiver/housekeeper");
    }
  }, [isHousekeeper, pathname, router]);

  return (
    <div className="dark">
      <RoleAppFrame
        app={isHousekeeper ? "housekeeper" : "med-tech"}
        person={fullName}
        building={
          <>
            {/* The facility picker sits beside the heading, not inside it (COL-658). */}
            <h1 className="break-words text-lg font-semibold tracking-tight haven-chrome-fg md:text-xl">
              {facilityName}
            </h1>
            {user?.id && <WorkingFacilitySelector userId={user.id} onResolved={setWorkingFacilityId} />}
            {shiftLabel ? <p className="mt-0.5 text-xs haven-chrome-fg-muted">{shiftLabel}</p> : null}
          </>
        }
        headerActions={
          <>
            <PilotFeedbackLauncher shellKind="caregiver" compact />
            <button
              type="button"
              onClick={() => void roundingSync.flush()}
              className="tap-responsive rounded-full haven-chrome-tw-ring-offset-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Sync queued caregiver rounds"
            >
              <StatusPill variant={syncState.variant} dot pulsing={syncState.pulsing} className="text-chrome-foreground">
                {syncState.label}
              </StatusPill>
            </button>
          </>
        }
      >
        <div className="flex-1 p-4 md:p-8">
          <RoundingOutbox />
          {!workingFacilityId ? (
            <p role="status">Choose your working facility in the header to begin this shift.</p>
          ) : staffLinked === false && !isStaffLinkOptionalPath(pathname) ? (
            <AccountNotLinkedNotice kind="staff" contact={linkContact} />
          ) : (
            <div key={workingFacilityId} className={isDeeperWorkflowPage ? "space-y-4" : undefined}>{children}</div>
          )}
        </div>
      </RoleAppFrame>
    </div>
  );
}
