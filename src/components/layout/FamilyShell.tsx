"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, CalendarHeart, CreditCard, MessageSquare, UserCircle2 } from "lucide-react";
import { useTheme } from "next-themes";

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const themeSet = useRef(false);

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("light");
      themeSet.current = true;
    }
  }, [setTheme]);

  return (
    <div className="family-shell min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans">
      {/* Hospitality Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-serif font-medium text-stone-800 tracking-tight">Haven</span>
            <span className="w-1 h-1 rounded-full bg-stone-300"></span>
            <span className="text-stone-600 font-medium">Sarah Davis</span>
          </div>
          
          <div className="flex items-center gap-4">
            <Link
              href="/family/messages"
              className="text-stone-400 hover:text-stone-600 tap-responsive"
              aria-label="Messages"
            >
              <MessageSquare className="w-5 h-5" />
            </Link>
            <button className="relative text-stone-400 hover:text-stone-600 tap-responsive" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
            <button className="text-stone-300 hover:text-stone-500 tap-responsive" aria-label="Profile">
              <UserCircle2 className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Navigation Tabs - Desktop */}
        <div className="hidden md:flex max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-x-8">
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
                className={`py-3 border-b-2 font-medium text-sm tap-responsive ${
                  isActive
                    ? "border-orange-600 text-stone-900"
                    : "border-transparent text-stone-500 hover:text-stone-700"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {children}
      </main>

      {/* Mobile Bottom Navigation (only visible md and below) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] bg-white border-t border-stone-200 flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)] pt-1 z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        <MobileTab
          href="/family"
          label="Today"
          icon={<CalendarHeart className="h-4 w-4" />}
          active={pathname === "/family" || pathname === "/family/"}
        />
        <MobileTab
          href="/family/calendar"
          label="Calendar"
          icon={<CalendarDays className="h-4 w-4" />}
          active={pathname.startsWith("/family/calendar")}
        />
        <MobileTab
          href="/family/care-plan"
          label="Care"
          icon={<UserCircle2 className="h-4 w-4" />}
          active={pathname.startsWith("/family/care-plan")}
        />
        <MobileTab
          href="/family/billing"
          label="Billing"
          icon={<CreditCard className="h-4 w-4" />}
          active={
            pathname.startsWith("/family/billing") ||
            pathname.startsWith("/family/invoices") ||
            pathname.startsWith("/family/payments")
          }
        />
        <MobileTab
          href="/family/messages"
          label="Chat"
          icon={<MessageSquare className="h-4 w-4" />}
          active={pathname.startsWith("/family/messages")}
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
      className={`flex flex-col items-center justify-center gap-1 tap-responsive ${
        active ? "text-orange-600" : "text-stone-400"
      }`}
    >
      {icon}
      <span className={`text-xs ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
    </Link>
  );
}
