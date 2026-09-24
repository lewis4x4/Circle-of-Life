"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenCheck,
  CalendarDays,
  CalendarHeart,
  ChefHat,
  ClipboardList,
  Clock3,
  CreditCard,
  FileText,
  HeartPulse,
  Home,
  Loader2,
  LogOut,
  Megaphone,
  Pill,
  User,
  Users,
} from "lucide-react";

import { BottomNav, BottomNavItem } from "@/components/ui/bottom-nav";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import {
  activeRoleAppTab,
  ROLE_APP_TABS,
  type RoleAppIcon,
  type RoleAppKey,
} from "@/lib/navigation/role-app-tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ICONS: Record<RoleAppIcon, React.ComponentType<{ className?: string }>> = {
  meds: Pill,
  residents: Users,
  rounds: ClipboardList,
  clock: Clock3,
  schedule: CalendarDays,
  me: User,
  home: Home,
  kitchen: ChefHat,
  reading: BookOpenCheck,
  today: CalendarHeart,
  calendar: CalendarDays,
  care: HeartPulse,
  updates: Megaphone,
  documents: FileText,
  billing: CreditCard,
};

const APP_NAV_LABEL: Record<RoleAppKey, string> = {
  "med-tech": "Med-Tech navigation",
  housekeeper: "Housekeeping navigation",
  cook: "Kitchen navigation",
  family: "Family navigation",
};

export type RoleAppFrameProps = {
  /** Which app's tab list to render (see `ROLE_APP_TABS`). */
  app: RoleAppKey;
  /** The building: its name, and the working-facility picker where the app has one. */
  building: React.ReactNode;
  /** The signed-in person's name. Never an email or login handle (COL-659). */
  person: string | null;
  /** App-specific status controls for the header (sync pill, feedback). */
  headerActions?: React.ReactNode;
  /** Hide the tabs, e.g. while an account is not linked yet and every tab would be empty. */
  hideNav?: boolean;
  children: React.ReactNode;
};

/**
 * RoleAppFrame — the one layout of the staff and family apps (COL-714).
 *
 * Header: building on the left; person and Sign out on the right. Navigation:
 * a bottom tab bar on phones, a narrow side rail from `md` up. The tabs are data
 * (`ROLE_APP_TABS`), so every app looks and behaves the same and the active tab
 * is computed once, across route groups.
 *
 * Pages scroll inside the frame, below the viewport-high shell, so a full-bleed
 * page (the med-tech cockpit) can size itself to the space it is given. On a
 * phone the header scrolls away with the page and only the tab bar stays
 * (COL-657); from `md` up it pins.
 */
export function RoleAppFrame({ app, building, person, headerActions, hideNav = false, children }: RoleAppFrameProps) {
  const pathname = usePathname();
  const activeKey = activeRoleAppTab(app, pathname);
  const tabs = ROLE_APP_TABS[app];
  const navLabel = APP_NAV_LABEL[app];
  const signOut = useRoleAppSignOut();

  return (
    <div
      data-role-app={app}
      className={cn(
        "flex h-dvh bg-background font-sans text-foreground antialiased",
        !hideNav && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
      )}
    >
      {hideNav ? null : (
        <nav
          aria-label={`${navLabel} (tablet)`}
          className="haven-chrome-sidebar fixed inset-y-0 left-0 z-50 hidden w-20 flex-col items-center gap-4 border-r border-border pt-6 pb-6 md:flex"
        >
          {tabs.map((tab) => (
            <RailItem key={tab.key} href={tab.href} label={tab.label} icon={tab.icon} active={tab.key === activeKey} />
          ))}
        </nav>
      )}

      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto", !hideNav && "md:ml-20")}>
        <header className="haven-chrome-topnav z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2 md:sticky md:top-0 md:px-8 md:py-3">
          <div className="min-w-0 flex-1">{building}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {headerActions}
            {person ? <span className="haven-chrome-fg max-w-56 truncate font-medium">{person}</span> : null}
            <button
              type="button"
              onClick={() => void signOut.run()}
              disabled={signOut.pending}
              className="tap-responsive inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 haven-chrome-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {signOut.pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden />
              )}
              {signOut.pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
          {signOut.error ? (
            <p role="alert" className="basis-full text-sm text-destructive">
              {signOut.error}
            </p>
          ) : null}
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>

      {hideNav ? null : (
        <BottomNav aria-label={navLabel} className="md:hidden">
          {tabs.map((tab) => {
            const Icon = ICONS[tab.icon];
            return (
              <BottomNavItem
                key={tab.key}
                href={tab.href}
                label={tab.label}
                icon={<Icon className="h-5 w-5" />}
                active={tab.key === activeKey}
              />
            );
          })}
        </BottomNav>
      )}
    </div>
  );
}

function RailItem({ href, label, icon, active }: { href: string; label: string; icon: RoleAppIcon; active: boolean }) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "tap-responsive relative flex h-16 w-16 flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold tracking-wide transition-colors",
        "haven-chrome-tw-ring-offset-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "haven-chrome-narrow-rail-active" : "haven-chrome-narrow-rail-quiet",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

/** Sign out the same way from every app: forget the facility choice, then go to login. */
function useRoleAppSignOut() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const { error: signOutError } = await createClient().auth.signOut({ scope: "local" });
      if (signOutError) {
        setError(signOutError.message);
        return;
      }
      const facility = useFacilityStore.getState();
      facility.clearFacilityCache();
      facility.resetSelectedFacility();
      syncSelectedFacilityCookie(null);
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }, [router]);

  return { run, pending, error };
}
