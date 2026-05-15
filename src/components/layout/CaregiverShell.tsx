"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Clock3, Home, Pill, User } from "lucide-react";
import { useTheme } from "next-themes";

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
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const themeSet = useRef(false);
  const { appRole, loading, organizationId, user } = useHavenAuth();
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
  }, [effectiveRole, loading, organizationId, user?.id]);

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

  // Caregiver portal is dark-only by design: shifts include night rotations
  // (11P-7A) and bedside use in dim resident rooms; a light flash mid-shift
  // is both glare-painful and a clinical-misread risk. The `dark` class on
  // the outer wrapper enforces dark-variant tokens even if a future theme
  // toggle or `useTheme` race momentarily flips the theme state.
  // `setTheme("dark")` below remains for cross-component side effects
  // (portals rendering outside this wrapper) but is no longer the only
  // guardrail.
  useEffect(() => {
    if (!themeSet.current) {
      setTheme("dark");
      themeSet.current = true;
    }
  }, [setTheme]);

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
          className="fixed inset-y-0 left-0 z-50 hidden w-20 flex-col border-r border-border bg-background/95 pt-4 pb-6 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:flex"
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

        <div className="flex min-w-0 flex-1 flex-col md:ml-20">
          <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-8 md:py-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
                {facilityName}
              </h1>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                {shiftLabel}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <PilotFeedbackLauncher shellKind="caregiver" compact />
              <button
                type="button"
                onClick={() => void roundingSync.flush()}
                className="tap-responsive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full"
                aria-label="Sync queued caregiver rounds"
              >
                <StatusPill variant={syncState.variant} dot pulsing={syncState.pulsing}>
                  {syncState.label}
                </StatusPill>
              </button>
              <button
                type="button"
                aria-label="Alerts"
                className="tap-responsive relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <span
                  aria-hidden
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning"
                />
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-8">
            <div className={isDeeperWorkflowPage ? "space-y-4" : undefined}>{children}</div>
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
        "tap-responsive flex h-16 w-16 flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold tracking-wide transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-[state=active]:bg-accent data-[state=active]:text-accent-foreground",
        "data-[state=inactive]:text-muted-foreground hover:text-foreground active:text-foreground",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
