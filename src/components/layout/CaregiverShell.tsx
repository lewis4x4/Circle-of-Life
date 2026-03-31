"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Pill, ClipboardList, AlertTriangle, User } from "lucide-react";
import { useTheme } from "next-themes";

export function CaregiverShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const themeSet = useRef(false);

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("dark");
      themeSet.current = true;
    }
  }, [setTheme]);

  return (
    <div className="caregiver-shell min-h-screen bg-black text-zinc-100 flex flex-col font-sans selection:bg-teal-900 selection:text-teal-100 pb-20">
      {/* Shift Header */}
      <header className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-zinc-900 px-4 py-3 flex justify-between items-center">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white leading-tight">Oakridge ALF</h1>
          <p className="text-xs text-zinc-400 font-medium">Night Shift (11P - 7A)</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-zinc-900 px-2 py-1 rounded-full border border-zinc-800 tap-responsive cursor-pointer">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
            <span className="text-xs font-medium text-zinc-300">Sync</span>
          </div>
          <button className="relative p-2 rounded-full bg-zinc-900 text-zinc-300 hover:text-white tap-responsive" aria-label="Alerts">
            <AlertTriangle className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500"></span>
          </button>
        </div>
      </header>

      {/* Scrollable Content View */}
      <main className="flex-1 overflow-x-hidden p-4">
        {children}
      </main>

      {/* 64px Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] bg-black/80 backdrop-blur-lg border-t border-zinc-900 flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)] pt-1 z-50">
        <TabItem
          icon={<Home className="w-6 h-6" />}
          label="Home"
          href="/caregiver"
          active={pathname === "/caregiver"}
        />
        <TabItem
          icon={<Pill className="w-6 h-6" />}
          label="Meds"
          href="/caregiver/meds"
          active={pathname.startsWith("/caregiver/meds")}
        />
        <TabItem
          icon={<ClipboardList className="w-6 h-6" />}
          label="Tasks"
          href="/caregiver/tasks"
          active={pathname.startsWith("/caregiver/tasks")}
        />
        <TabItem
          icon={<AlertTriangle className="w-6 h-6" />}
          label="Alert"
          href="/caregiver/incident-draft"
          active={pathname.startsWith("/caregiver/incident-draft")}
        />
        <TabItem
          icon={<User className="w-6 h-6" />}
          label="Me"
          href="/caregiver/me"
          active={pathname.startsWith("/caregiver/me")}
        />
      </nav>
    </div>
  );
}

function TabItem({
  icon,
  label,
  href,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center w-16 h-full gap-1 tap-responsive ${
        active ? "text-white" : "text-zinc-500"
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}
