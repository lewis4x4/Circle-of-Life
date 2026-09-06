"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Clock3, Home, Pill, User } from "lucide-react";

import { WorkingFacilitySelector } from "@/components/caregiver/WorkingFacilitySelector";
import { RoundingOutbox } from "@/components/rounding/RoundingOutbox";
import { BottomNav, BottomNavItem } from "@/components/ui/bottom-nav";
import { StatusPill } from "@/components/ui/status-pill";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { isHousekeeperAllowedPath } from "@/lib/auth/caregiver-route-access";
import { loadCaregiverFacilityContextForUser } from "@/lib/caregiver/facility-context";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient } from "@/lib/supabase/client";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import { cn } from "@/lib/utils";

type SyncState = {
  variant: "success" | "warning" | "destructive";
  label: string;
  pulsing: boolean;
};

function deriveSyncState({
  isSyncing,
  online,
  pendingCount,
}: {
  isSyncing: boolean;
  online: boolean;
  pendingCount: number;
}): SyncState {
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
  const { appRole, loading, organizationId, user } = useHavenAuth();
  const [workingFacilityId, setWorkingFacilityId] = useState("");
  const [facilityName, setFacilityName] = useState("Facility");
  const [shiftLabel, setShiftLabel] = useState("Shift");
  const effectiveRole = getAppRoleFromClaims(user) || appRole;
  const isHousekeeper = effectiveRole === "housekeeper";
  const roundingSync = useRoundingOfflineSync();
  const syncState = useMemo(
    () =>
      deriveSyncState({
        isSyncing: roundingSync.isSyncing,
        online: roundingSync.online,
        pendingCount: roundingSync.pendingCount,
      }),
    [roundingSync.isSyncing, roundingSync.online, roundingSync.pendingCount],
  );

  useEffect(() => {
    if (loading || !user?.id) return;

    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await loadCaregiverFacilityContextForUser(supabase, {
          userId: user.id,
          selectedFacilityId: workingFacilityId,
          organizationId,
          appRole: effectiveRole,
        });
        if (!resolved.ok || cancelled) return;
        const shiftType = currentShiftForTimezone(resolved.ctx.timeZone);
        const label =
          shiftType === "day"
            ? "Day Shift (7A - 3P)"
            : shiftType === "evening"
              ? "Evening Shift (3P - 11P)"
              : "Night Shift (11P - 7A)";
        setFacilityName(resolved.ctx.facilityName ?? "Facility");
        setShiftLabel(label);
      } catch (error) {
        if (!cancelled) {
          console.error("[CaregiverShell] Failed to load caregiver facility context", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveRole, loading, organizationId, user?.id, workingFacilityId]);

  const isDeeperWorkflowPage = useMemo(
    () =>
      pathname !== "/caregiver" &&
      [
        "/caregiver/tasks",
        "/caregiver/rounds",
        "/caregiver/meds",
        "/caregiver/followups",
        "/caregiver/prn-followup",
        "/caregiver/incident-draft",
        "/caregiver/handoff",
      ].some((route) => pathname.startsWith(route)),
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

  const caregiverNavItems = [
    { href: "/caregiver", icon: <Home className="h-5 w-5" aria-hidden />, label: "Home", isActive: pathname === "/caregiver" },
    { href: "/caregiver/meds", icon: <Pill className="h-5 w-5" aria-hidden />, label: "Meds", isActive: pathname.startsWith("/caregiver/meds") },
    { href: "/caregiver/rounds", icon: <ClipboardList className="h-5 w-5" aria-hidden />, label: "Rounds", isActive: pathname.startsWith("/caregiver/rounds") },
    { href: "/caregiver/incident-draft", icon: <AlertTriangle className="h-5 w-5" aria-hidden />, label: "Report", isActive: pathname.startsWith("/caregiver/incident-draft") },
  ];
  const housekeeperNavItems = [
    { href: "/caregiver/housekeeper", icon: <Home className="h-5 w-5" aria-hidden />, label: "Home", isActive: pathname.startsWith("/caregiver/housekeeper") },
    { href: "/caregiver/clock", icon: <Clock3 className="h-5 w-5" aria-hidden />, label: "Clock", isActive: pathname.startsWith("/caregiver/clock") },
    { href: "/caregiver/schedules", icon: <ClipboardList className="h-5 w-5" aria-hidden />, label: "Schedule", isActive: pathname.startsWith("/caregiver/schedules") },
  ];
  const primaryItems = isHousekeeper ? housekeeperNavItems : caregiverNavItems;
  const meItem = { href: "/caregiver/me", icon: <User className="h-5 w-5" aria-hidden />, label: "Me", isActive: pathname.startsWith("/caregiver/me") };

  return (
    <div className="dark">
      <div className="flex min-h-screen bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] font-sans text-foreground antialiased md:pb-0">
        {/* Tablet / desktop side rail (md+) */}
        <nav
          aria-label="Caregiver navigation (tablet)"
          className="haven-chrome-sidebar fixed inset-y-0 left-0 z-50 hidden w-20 flex-col border-r border-border pt-4 pb-6 md:flex"
        >
          <div className="mt-4 flex flex-1 flex-col items-center gap-6">
            {primaryItems.map((item) => (
              <SideNavItem key={item.href} {...item} />
            ))}
          </div>
          <div className="flex flex-col items-center">
            <SideNavItem {...meItem} />
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col md:ml-20 md:border-l md:border-border">
          <header className="haven-chrome-topnav sticky top-0 z-40 flex items-center justify-between border-b border-border px-4 py-3 md:px-8 md:py-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight haven-chrome-fg md:text-xl">
                {facilityName}
                {user?.id && <WorkingFacilitySelector userId={user.id} onResolved={setWorkingFacilityId} />}
              </h1>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider haven-chrome-fg-muted">
                {shiftLabel}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/caregiver/acknowledgments" className="text-xs underline">Required reading</Link>
              <PilotFeedbackLauncher shellKind="caregiver" compact />
              <button
                type="button"
                onClick={() => void roundingSync.flush()}
                className="tap-responsive rounded-full haven-chrome-tw-ring-offset-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Sync queued caregiver rounds"
              >
                <StatusPill variant={syncState.variant} dot pulsing={syncState.pulsing}>
                  {syncState.label}
                </StatusPill>
              </button>

            </div>
          </header>

          <main className="flex-1 p-4 md:p-8">
            <RoundingOutbox />
            {workingFacilityId ? <div key={workingFacilityId} className={isDeeperWorkflowPage ? "space-y-4" : undefined}>{children}</div> : <p role="status">Choose your working facility in the header to begin this shift.</p>}
          </main>
        </div>

        {/* Mobile bottom tab bar */}
        <BottomNav aria-label="Caregiver navigation" className="md:hidden">
          {primaryItems.map((item) => (
            <BottomNavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={item.isActive}
            />
          ))}
          <BottomNavItem
            href={meItem.href}
            icon={meItem.icon}
            label={meItem.label}
            active={meItem.isActive}
          />
        </BottomNav>
      </div>
    </div>
  );
}

function SideNavItem({
  href,
  icon,
  label,
  isActive,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      aria-label={label}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "tap-responsive relative flex h-16 w-16 flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold tracking-wide transition-colors",
        "haven-chrome-tw-ring-offset-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isActive ? "haven-chrome-narrow-rail-active" : "haven-chrome-narrow-rail-quiet",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
