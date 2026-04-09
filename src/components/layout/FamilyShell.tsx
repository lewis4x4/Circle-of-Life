"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CalendarHeart,
  CreditCard,
  Loader2,
  LogOut,
  MessageSquare,
  UserCircle2,
} from "lucide-react";
import { useTheme } from "next-themes";

import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const themeSet = useRef(false);
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

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("light");
      themeSet.current = true;
    }
  }, [setTheme]);

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

  return (
    <div className="family-shell min-h-screen flex flex-col font-sans selection:bg-orange-100 selection:text-orange-900 text-stone-900">
      {/* Hospitality Header */}
      <header className="sticky top-0 z-40 bg-white/40 backdrop-blur-2xl border-b border-white/50 shadow-[0_4px_30px_rgb(0,0,0,0.02)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl font-serif text-stone-800 tracking-tight shrink-0">Haven</span>
            <span className="w-1 h-1 rounded-full bg-stone-300 shrink-0"></span>
            <span
              className="text-stone-500 font-medium truncate text-sm sm:text-base font-display"
              title={sessionEmail ?? undefined}
            >
              {sessionEmail ?? "Family portal"}
            </span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <Link
              href="/family/messages"
              className="text-stone-400 hover:text-stone-600 tap-responsive transition-colors"
              aria-label="Messages"
            >
              <MessageSquare className="w-5 h-5" />
            </Link>
            <button type="button" className="relative text-stone-400 hover:text-stone-600 tap-responsive transition-colors" aria-label="Notifications">
              <Bell className="w-5 h-5" />
              <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-orange-400"></span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rounded-full p-1 tap-responsive outline-none text-stone-400 hover:text-stone-600 hover:bg-stone-100/50 transition-all focus-visible:ring-2 focus-visible:ring-orange-500/40"
                aria-label="Account menu"
              >
                <UserCircle2 className="w-6 h-6" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-card-light">
                <DropdownMenuGroup>
                  {sessionEmail ? (
                    <>
                      <DropdownMenuLabel className="truncate font-normal text-stone-500">
                        {sessionEmail}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-stone-100" />
                    </>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    className="cursor-pointer"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                  >
                    {signingOut ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing out…
                      </>
                    ) : (
                      <>
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign out
                      </>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        {/* Navigation Tabs - Desktop */}
        <div className="hidden md:flex max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-x-2 pb-2">
          {(
            [
              { href: "/family", label: "Today", exact: true },
              { href: "/family/calendar", label: "Calendar" },
              { href: "/family/care-plan", label: "Care Plan" },
              {
                href: "/family/billing",
                label: "Billing",
                match: (p: string) =>
                  p.startsWith("/family/billing") ||
                  p.startsWith("/family/invoices") ||
                  p.startsWith("/family/payments"),
              },
              { href: "/family/messages", label: "Messages" },
            ] as const
          ).map((tab) => {
            const isActive =
              "match" in tab && tab.match
                ? tab.match(pathname)
                : "exact" in tab && tab.exact
                  ? pathname === tab.href || pathname === `${tab.href}/`
                  : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
               <Link
                key={tab.href}
                href={tab.href}
                className={`py-1.5 px-3 rounded-full font-medium text-sm tap-responsive transition-all ${
                  isActive
                    ? "bg-stone-900 text-white shadow-md shadow-stone-900/10"
                    : "text-stone-500 hover:text-stone-800 hover:bg-stone-200/50"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 md:py-10">
        {children}
      </main>

      {/* Mobile Bottom Navigation (only visible md and below) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] bg-white/70 backdrop-blur-2xl border-t border-white/50 flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)] pt-1 z-50 shadow-[0_-4px_30px_rgba(0,0,0,0.03)]">
        <MobileTab
          href="/family"
          label="Today"
          icon={<CalendarHeart className="h-5 w-5" />}
          active={pathname === "/family" || pathname === "/family/"}
        />
        <MobileTab
          href="/family/calendar"
          label="Calendar"
          icon={<CalendarDays className="h-5 w-5" />}
          active={pathname.startsWith("/family/calendar")}
        />
        <MobileTab
          href="/family/care-plan"
          label="Care"
          icon={<UserCircle2 className="h-5 w-5" />}
          active={pathname.startsWith("/family/care-plan")}
        />
        <MobileTab
          href="/family/billing"
          label="Billing"
          icon={<CreditCard className="h-5 w-5" />}
          active={
            pathname.startsWith("/family/billing") ||
            pathname.startsWith("/family/invoices") ||
            pathname.startsWith("/family/payments")
          }
        />
      </nav>
    </div>
  );
}

function MobileTab({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1 w-16 h-full tap-responsive transition-colors ${
        active ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
      }`}
    >
      <div className={active ? "scale-110 transition-transform text-orange-500 drop-shadow-sm" : "scale-100 transition-transform"}>
        {icon}
      </div>
      <span className={`text-[10px] tracking-wide ${active ? "font-bold text-stone-900" : "font-medium"}`}>{label}</span>
    </Link>
  );
}
