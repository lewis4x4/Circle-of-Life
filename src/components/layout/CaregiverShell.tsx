"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Pill, ClipboardList, AlertTriangle, User } from "lucide-react";
import { useTheme } from "next-themes";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { createClient } from "@/lib/supabase/client";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";

export function CaregiverShell({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const pathname = usePathname();
  const themeSet = useRef(false);
  const [facilityName, setFacilityName] = useState("Facility");
  const [shiftLabel, setShiftLabel] = useState("Shift");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const resolved = await loadCaregiverFacilityContext(supabase);
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    if (!themeSet.current) {
      setTheme("dark");
      themeSet.current = true;
    }
  }, [setTheme]);

  return (
    <div className="caregiver-shell min-h-screen text-zinc-100 flex font-sans selection:bg-teal-900 selection:text-teal-100 pb-20 md:pb-0">
      {/* Tablet Side Navigation Rail */}
      <nav className="hidden md:flex flex-col w-20 border-r border-white/5 bg-black/40 backdrop-blur-xl z-50 fixed inset-y-0 left-0 pt-4 pb-6">
        <div className="flex-1 flex flex-col items-center gap-6 mt-4">
          <SideNavItem
            icon={<Home className="w-6 h-6" />}
            label="Home"
            href="/caregiver"
            active={pathname === "/caregiver"}
          />
          <SideNavItem
            icon={<Pill className="w-6 h-6" />}
            label="Meds"
            href="/caregiver/meds"
            active={pathname.startsWith("/caregiver/meds")}
          />
          <SideNavItem
            icon={<ClipboardList className="w-6 h-6" />}
            label="Rounds"
            href="/caregiver/rounds"
            active={pathname.startsWith("/caregiver/rounds")}
          />
          <SideNavItem
            icon={<AlertTriangle className="w-6 h-6" />}
            label="Report"
            href="/caregiver/incident-draft"
            active={pathname.startsWith("/caregiver/incident-draft")}
          />
        </div>
        <div className="flex flex-col items-center">
          <SideNavItem
            icon={<User className="w-6 h-6" />}
            label="Me"
            href="/caregiver/me"
            active={pathname.startsWith("/caregiver/me")}
          />
        </div>
      </nav>

      <div className="flex-1 flex flex-col min-w-0 md:ml-20">
        {/* Shift Header */}
        <header className="sticky top-0 z-40 bg-black/20 backdrop-blur-xl border-b border-white/5 px-4 md:px-8 py-3 md:py-4 flex justify-between items-center">
          <div>
            <h1 className="text-lg md:text-xl font-display font-semibold tracking-tight text-white leading-tight">{facilityName}</h1>
            <p className="text-xs md:text-sm text-zinc-400 font-medium tracking-wide uppercase mt-0.5">{shiftLabel}</p>
          </div>
          <div className="flex items-center gap-4">
            <PilotFeedbackLauncher shellKind="caregiver" compact />
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 tap-responsive cursor-pointer hover:bg-white/10 transition-colors">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"></span>
              <span className="text-xs font-semibold text-zinc-200 uppercase tracking-widest">Sync</span>
            </div>
            <button className="relative p-2 md:p-2.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:text-white tap-responsive hover:bg-white/10 transition-colors" aria-label="Alerts">
              <AlertTriangle className="w-4 h-4 md:w-5 md:h-5" />
              <span className="absolute top-0 right-0 md:top-0.5 md:right-0.5 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"></span>
            </button>
          </div>
        </header>

        {/* Scrollable Content View */}
        <main className="flex-1 p-4 md:p-8">
          <div className={isDeeperWorkflowPage ? "space-y-4" : undefined}>{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] bg-black/80 backdrop-blur-xl border-t border-white/10 flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom)] pt-1 z-50">
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
          label="Rounds"
          href="/caregiver/rounds"
          active={pathname.startsWith("/caregiver/rounds")}
        />
        <TabItem
          icon={<AlertTriangle className="w-6 h-6" />}
          label="Report"
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

function SideNavItem({
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
      className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl gap-1.5 tap-responsive transition-all ${
        active 
          ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] border border-white/5" 
          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
      }`}
    >
      <div className={active ? "scale-110 transition-transform" : "scale-100 transition-transform"}>
        {icon}
      </div>
      <span className="text-[10px] font-semibold tracking-wide">{label}</span>
    </Link>
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
