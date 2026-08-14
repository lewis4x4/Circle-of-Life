"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CalendarHeart,
  CreditCard,
  HeartPulse,
  Loader2,
  LogOut,
  Megaphone,
  UserCircle2,
} from "lucide-react";

import { BottomNav, BottomNavItem } from "@/components/ui/bottom-nav";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  // Family portal is light-locked at the route group layout
  // (`src/app/(family)/layout.tsx` wraps in `<div className="light">`). We
  // intentionally do NOT call `setTheme("light")` here — that would clobber
  // the user's admin theme choice when navigating between the two shells.
  // The CSS variable cascade from the wrapping `.light` class is sufficient
  // for every element rendered inside this tree.

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setSessionEmail(data.session?.user?.email ?? null);
      } catch {
        if (!cancelled) setSessionEmail(null);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setSessionEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const navItems = useMemo(
    () => [
      {
        href: "/family",
        label: "Today",
        icon: <CalendarHeart className="h-5 w-5" aria-hidden />,
        active: pathname === "/family" || pathname === "/family/",
      },
      {
        href: "/family/calendar",
        label: "Calendar",
        icon: <CalendarDays className="h-5 w-5" aria-hidden />,
        active: pathname.startsWith("/family/calendar"),
      },
      {
        href: "/family/care-plan",
        label: "Care",
        icon: <HeartPulse className="h-5 w-5" aria-hidden />,
        active: pathname.startsWith("/family/care-plan"),
      },
      {
        href: "/family/messages",
        label: "Updates",
        icon: <Megaphone className="h-5 w-5" aria-hidden />,
        active: pathname.startsWith("/family/messages"),
      },
      {
        href: "/family/billing",
        label: "Billing",
        icon: <CreditCard className="h-5 w-5" aria-hidden />,
        active:
          pathname.startsWith("/family/billing") ||
          pathname.startsWith("/family/invoices") ||
          pathname.startsWith("/family/payments"),
      },
    ],
    [pathname],
  );

  return (
    <div className="family-shell relative flex min-h-screen flex-col bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] font-sans text-foreground antialiased">
        <div className="absolute right-4 top-4 z-50 flex items-center gap-2 md:right-6 md:top-6">
          <PilotFeedbackLauncher shellKind="family" compact />
          <button
            type="button"
            aria-label="Notifications"
            className="haven-chrome-floating-chip tap-responsive relative inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Bell className="h-5 w-5" aria-hidden />
            <span
              aria-hidden
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning"
            />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Family account menu"
              className="haven-chrome-floating-chip tap-responsive inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <UserCircle2 className="h-5 w-5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="mt-2 w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground">
                  {sessionEmail ?? "Family Portal"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Signing out…
                    </>
                  ) : (
                    <>
                      <LogOut className="mr-2 h-4 w-4" aria-hidden />
                      Sign out
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <main className="relative z-10 w-full flex-1">{children}</main>

        <BottomNav aria-label="Family navigation">
          {navItems.map((item) => (
            <BottomNavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={item.active}
            />
          ))}
        </BottomNav>
    </div>
  );
}
