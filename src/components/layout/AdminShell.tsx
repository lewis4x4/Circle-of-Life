"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { 
  Bell,
  Loader2,
  LogOut,
  Search,
  Settings,
  UserCircle2,
  ChevronDown, 
  Check,
  LayoutDashboard,
  Users,
  UserPlus,
  Home,
  DoorOpen,
  ShieldAlert,
  UserCog,
  CreditCard,
  ClipboardCheck,
  Award,
  GraduationCap,
  Utensils,
  Bus,
  CalendarDays,
  ArrowLeftRight,
  Clock,
  Banknote,
  Activity,
  Pill,
  Biohazard,
  Scale,
  Landmark,
  Umbrella,
  Truck,
  MessageCircle,
  Heart,
  Sun,
  Moon,
  Monitor,
  BarChart3,
  LineChart,
  FileText,
  Smartphone,
  Star,
  ActivitySquare,
  BriefcaseMedical,
  Stethoscope,
  Building2,
  ShieldCheck,
  Zap,
  Hotel,
  BookOpen,
  BrainCircuit,
  MessageSquare,
} from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { FACILITY_LIST_TTL_MS, useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SurveyVisitModeBar } from "@/components/compliance/SurveyVisitModeBar";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);
  const setAvailableFacilities = useFacilityStore((s) => s.setAvailableFacilities);

  const currentFacility = availableFacilities.find((f) => f.id === selectedFacilityId);

  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const { email: sessionEmail, appRole } = useHavenAuth();
  const roleConfig = useMemo(() => getRoleDashboardConfig(appRole), [appRole]);
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

  const refreshFacilities = useCallback(async () => {
    const st = useFacilityStore.getState();
    if (
      st.facilitiesFetchedAt != null &&
      st.availableFacilities.length > 0 &&
      Date.now() - st.facilitiesFetchedAt < FACILITY_LIST_TTL_MS
    ) {
      setFacilitiesLoading(false);
      setFacilitiesLoadFailed(false);
      return;
    }

    setFacilitiesLoading(true);
    setFacilitiesLoadFailed(false);
    try {
      const list = await fetchAdminFacilityOptions();
      setAvailableFacilities(list);
      const persistedId = useFacilityStore.getState().selectedFacilityId;
      if (persistedId != null && !list.some((f) => f.id === persistedId)) {
        setSelectedFacility(null);
      }
    } catch (err) {
      console.warn("[AdminShell] refreshFacilities failed", err);
      setAvailableFacilities([]);
      setFacilitiesLoadFailed(true);
    } finally {
      setFacilitiesLoading(false);
    }
  }, [setAvailableFacilities, setSelectedFacility]);

  useEffect(() => {
    void refreshFacilities();
  }, [refreshFacilities]);

  const facilityTriggerLabel = facilitiesLoading
    ? "Loading facilities…"
    : selectedFacilityId === null
      ? "All facilities"
      : (currentFacility?.name ?? "Select facility…");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const allNavGroups = useMemo(() => [
    {
      group: "Command",
      icon: Zap,
      items: [
        { key: "dashboard", href: "/admin", label: "Triage Inbox", enabled: true, icon: LayoutDashboard },
        { key: "executive", href: "/admin/executive", label: "Executive summary", enabled: true, icon: BarChart3 },
        { key: "reports", href: "/admin/reports", label: "Reports hub", enabled: true, icon: FileText },
        { key: "facilities", href: "/admin/facilities", label: "Facilities", enabled: true, icon: Hotel },
      ]
    },
    {
      group: "Pipeline",
      icon: ActivitySquare,
      items: [
        { key: "referrals", href: "/admin/referrals", label: "Referrals CRM", enabled: true, icon: UserPlus },
        { key: "admissions", href: "/admin/admissions", label: "Recent admissions", enabled: true, icon: Home },
        { key: "discharge", href: "/admin/discharge", label: "Discharge management", enabled: true, icon: DoorOpen },
        { key: "family-portal", href: "/admin/family-portal", label: "Family Portal connections", enabled: true, icon: Heart },
        { key: "family-messages", href: "/admin/family-messages", label: "Family Messages triage", enabled: true, icon: MessageCircle },
      ]
    },
    {
      group: "Clinical Ops",
      icon: Stethoscope,
      items: [
        { key: "residents", href: "/admin/residents", label: "Resident roster", enabled: true, icon: Users },
        { key: "assessments", href: "/admin/assessments/overdue", label: "Clinical Desk (Assessments)", enabled: true, icon: ClipboardCheck },
        { key: "rounding", href: "/admin/rounding", label: "Smart Rounding", enabled: true, icon: Clock },
        { key: "medications", href: "/admin/medications", label: "Medication management", enabled: true, icon: Pill },
        { key: "dietary", href: "/admin/dietary", label: "Dietary & Nutrition", enabled: true, icon: Utensils },
        { key: "transportation", href: "/admin/transportation", label: "Transportation log", enabled: true, icon: Bus },
      ]
    },
    {
      group: "Quality & Risk",
      icon: ShieldCheck,
      items: [
        { key: "incidents-new", href: "/admin/incidents/new", label: "Report Incident", enabled: true, icon: ShieldAlert },
        { key: "incidents", href: "/admin/incidents", label: "Incident queue", enabled: true, icon: ShieldAlert },
        { key: "infection", href: "/admin/infection-control", label: "Infection Control", enabled: true, icon: Biohazard },
        { key: "compliance", href: "/admin/compliance", label: "Compliance & Safety", enabled: true, icon: Scale },
        { key: "quality", href: "/admin/quality", label: "Quality Metrics", enabled: true, icon: LineChart },
        { key: "reputation", href: "/admin/reputation", label: "Reputation tracker", enabled: true, icon: Star },
      ]
    },
    {
      group: "Knowledge",
      icon: BrainCircuit,
      items: [
        { key: "kb-chat", href: "/admin/knowledge", label: "Ask Knowledge Base", enabled: true, icon: MessageSquare },
        { key: "kb-admin", href: "/admin/knowledge/admin", label: "KB Admin", enabled: true, icon: BookOpen },
      ]
    },
    {
      group: "Workforce",
      icon: BriefcaseMedical,
      items: [
        { key: "staff", href: "/admin/staff", label: "Staff Roster", enabled: true, icon: UserCog },
        { key: "schedules", href: "/admin/schedules", label: "Schedules", enabled: true, icon: CalendarDays },
        { key: "shift-swaps", href: "/admin/shift-swaps", label: "Shift swaps", enabled: true, icon: ArrowLeftRight },
        { key: "staffing", href: "/admin/staffing", label: "Staffing alerts", enabled: true, icon: Activity },
        { key: "certifications", href: "/admin/certifications", label: "Certifications tracker", enabled: true, icon: Award },
        { key: "training", href: "/admin/training", label: "Training hub", enabled: true, icon: GraduationCap },
        { key: "time-records", href: "/admin/time-records", label: "Time records", enabled: true, icon: Clock },
        { key: "payroll", href: "/admin/payroll", label: "Payroll integrations", enabled: true, icon: Banknote },
        { key: "users", href: "/admin/settings/users", label: "User Management", enabled: true, icon: Users },
      ]
    },
    {
      group: "Finance",
      icon: Building2,
      items: [
        { key: "billing", href: "/admin/billing", label: "Billing & AR", enabled: true, icon: CreditCard },
        { key: "finance", href: "/admin/finance", label: "Finance Hub", enabled: true, icon: Landmark },
        { key: "vendors", href: "/admin/vendors", label: "Vendors & AP", enabled: true, icon: Truck },
        { key: "insurance", href: "/admin/insurance", label: "Insurance", enabled: true, icon: Umbrella },
        { key: "feedback", href: "/admin/feedback", label: "Pilot feedback", enabled: true, icon: MessageSquare },
        { key: "notifications", href: "/admin/settings/notifications", label: "Settings", enabled: true, icon: Smartphone },
      ]
    }
  ], []);

  const navGroups = useMemo(
    () => allNavGroups.filter((group) => roleConfig.visibleGroups.includes(group.group)),
    [allNavGroups, roleConfig.visibleGroups],
  );

  // Determine active group for styling the top-nav pill
  const activeGroup = useMemo(() => {
    let active = "";
    navGroups.forEach(g => {
      g.items.forEach(item => {
        if (pathname === item.href || pathname.startsWith(item.href + "/") && item.href !== "/admin") {
          active = g.group;
        }
        if (item.href === "/admin" && pathname === "/admin") {
          active = g.group;
        }
      });
    });
    return active;
  }, [pathname, navGroups]);

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 dark:bg-[#050505] font-sans transition-colors duration-300">
      
      {/* ─── MOONSHOT UNIFIED TOP NAVIGATION ───────────────────────────────────── */}
      <header className="h-16 flex items-center justify-between px-4 lg:px-8 border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-black/40 backdrop-blur-xl z-50 sticky top-0 shrink-0">
        
        <div className="flex items-center gap-6">
          {/* Logo / Brand */}
          <Link
            href={roleConfig.route}
            className="flex items-center gap-2 tap-responsive shrink-0 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#050505]"
            aria-label={`Haven — go to ${roleConfig.roleLabel.toLowerCase()} home`}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
              <span className="text-white font-display font-bold text-lg leading-none mt-0.5">H</span>
            </div>
            <span className="text-xl font-semibold font-display text-slate-900 dark:text-white tracking-tight hidden md:block">
              Haven
            </span>
            <span className="hidden 2xl:inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
              {roleConfig.roleLabel}
            </span>
          </Link>

          {/* Module Switcher (The Mega Menu) */}
          <nav className="hidden xl:flex items-center gap-1 bg-slate-100/50 dark:bg-white/[0.03] p-1 rounded-2xl border border-slate-200/50 dark:border-white/5">
             {navGroups.map((group) => {
               const isActive = activeGroup === group.group;
               const GroupIcon = group.icon;

               return (
                 <DropdownMenu key={group.group}>
                   <DropdownMenuTrigger className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all outline-none tap-responsive ${
                     isActive 
                       ? "bg-white dark:bg-white/10 text-indigo-600 dark:text-white shadow-sm border border-slate-200 dark:border-white/10" 
                       : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/5"
                   }`}>
                     <GroupIcon className={`w-4 h-4 ${isActive ? 'text-indigo-500 dark:text-indigo-400' : ''}`} />
                     {group.group}
                     <ChevronDown className="w-3.5 h-3.5 opacity-50 ml-1" />
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="start" sideOffset={12} className="w-[320px] rounded-[1.5rem] p-3 dark:bg-zinc-950/95 dark:backdrop-blur-3xl dark:border-white/10 shadow-2xl">
                      <div className="mb-2 px-3 pt-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">{group.group} Hub</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {group.items.map((item) => {
                           const ItemIcon = item.icon;
                           const isItemActive = pathname === item.href || (pathname.startsWith(item.href + "/") && item.href !== "/admin") || (item.href === "/admin" && pathname === "/admin");
                           
                           if (!item.enabled) return null;

                           return (
                             <DropdownMenuItem
                               key={item.key}
                               className="p-0"
                               nativeButton={false}
                               render={
                                 <Link
                                   href={item.href}
                                   className={`flex items-center gap-3 rounded-xl px-3 py-3 w-full cursor-pointer transition-all outline-none ${
                                     isItemActive
                                       ? "bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white"
                                       : "text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-white/5"
                                   }`}
                                 >
                                   <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isItemActive ? "bg-indigo-100 dark:bg-white/10" : "bg-slate-100 dark:bg-white/5"}`}>
                                     <ItemIcon className={`w-4 h-4 ${isItemActive ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-zinc-400"}`} />
                                   </div>
                                   <span className="text-sm font-medium tracking-wide">{item.label}</span>
                                 </Link>
                               }
                             />
                           );
                        })}
                      </div>
                   </DropdownMenuContent>
                 </DropdownMenu>
               );
             })}
          </nav>
        </div>
        
        {/* Right Nav Utilities */}
        <div className="flex items-center gap-3">
          
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="admin-facility-filter-trigger"
              aria-label={
                facilitiesLoadFailed
                  ? "Facility filter — failed to load list, open for retry"
                  : facilitiesLoading
                    ? "Facility filter — loading"
                    : `Facility filter — ${selectedFacilityId === null ? "all facilities" : currentFacility?.name ?? "selected facility"}`
              }
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 shadow-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 tap-responsive focus-visible:outline-none transition-all"
            >
              <Building2 className="w-4 h-4 text-slate-500 dark:text-zinc-400" aria-hidden />
              <span className="text-sm font-medium text-slate-900 dark:text-slate-200 truncate max-w-[140px] md:max-w-[200px]">
                {facilityTriggerLabel}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 dark:text-zinc-500 ml-1" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px] rounded-[1.2rem] p-2 dark:bg-zinc-950/95 dark:backdrop-blur-xl dark:border-white/10">
              <DropdownMenuItem
                onClick={() => setSelectedFacility(null)}
                className="flex cursor-pointer items-center justify-between font-medium rounded-lg p-3 dark:focus:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center"><Building2 className="w-3 h-3" /></div>
                  All facilities
                </div>
                {selectedFacilityId === null && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
              </DropdownMenuItem>

              <DropdownMenuSeparator className="dark:bg-white/10 my-1" />

              {facilitiesLoadFailed && (
                <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Could not load facilities. Check login and Supabase access.
                  <button onClick={() => void refreshFacilities()} className="mt-2 text-indigo-400 underline">Retry</button>
                </div>
              )}

              {availableFacilities.map((facility) => (
                <DropdownMenuItem 
                  key={facility.id}
                  onClick={() => setSelectedFacility(facility.id)}
                  className="flex justify-between items-center cursor-pointer rounded-lg p-3 dark:focus:bg-white/5"
                >
                  <span className="truncate pr-2">{facility.name}</span>
                  {selectedFacilityId === facility.id && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-8 w-px bg-slate-200 dark:bg-white/10 mx-1 hidden md:block" />

          <Link
            href="/admin/search"
            className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-zinc-300 tap-responsive transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </Link>

          <PilotFeedbackLauncher shellKind="admin" facilityId={selectedFacilityId} compact />
          
          <button className="relative p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-zinc-300 tap-responsive transition-colors" aria-label="Notifications">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white dark:border-[#050505]"></span>
          </button>
          
          {/* Global Theme Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-zinc-300 tap-responsive outline-none transition-colors">
              {mounted && theme === "dark" ? <Moon className="w-5 h-5" /> : mounted && theme === "light" ? <Sun className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 rounded-xl dark:bg-zinc-950 dark:border-white/10">
              <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer rounded-lg dark:focus:bg-white/5">
                <Sun className="mr-2 h-4 w-4" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer rounded-lg dark:focus:bg-white/5">
                <Moon className="mr-2 h-4 w-4" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer rounded-lg dark:focus:bg-white/5">
                <Monitor className="mr-2 h-4 w-4" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="ml-2 rounded-full p-1 tap-responsive outline-none border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black/40 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
              aria-label="Account menu"
            >
              <UserCircle2 className="h-7 w-7 text-slate-600 dark:text-zinc-300" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-xl dark:border-white/10 dark:bg-zinc-950 p-2">
              <DropdownMenuGroup>
                {sessionEmail && (
                  <div className="px-3 py-2 mb-2 flex flex-col gap-1 border-b border-slate-100 dark:border-white/10">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Signed In</span>
                    <span className="truncate font-medium text-sm text-slate-900 dark:text-zinc-200">
                      {sessionEmail}
                    </span>
                  </div>
                )}
                <DropdownMenuItem
                  className="cursor-pointer rounded-lg dark:focus:bg-white/5 py-2.5"
                  onClick={() => router.push("/admin/settings/notifications")}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Account Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer rounded-lg dark:focus:bg-white/5 py-2.5 mt-1"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-rose-500" />
                      <span className="text-rose-500 font-medium">Signing out…</span>
                    </>
                  ) : (
                    <>
                      <LogOut className="mr-2 h-4 w-4 text-rose-500" />
                      <span className="text-rose-500 font-medium">Sign out securely</span>
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      
      {/* Mobile Nav Warning / Trigger could go here in future */}
      <SurveyVisitModeBar />

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto relative">
        <div className="fixed top-[-20%] right-[-10%] h-[1000px] w-[1000px] rounded-full blur-[180px] bg-indigo-500/10 dark:bg-indigo-600-[0.03] pointer-events-none z-0 mix-blend-screen" />
        <div className="fixed bottom-[-10%] left-[-10%] h-[800px] w-[800px] rounded-full blur-[150px] bg-emerald-500/10 dark:bg-emerald-900/[0.04] pointer-events-none z-0 mix-blend-screen" />
        
        <div className="relative z-10 w-full h-full p-6 lg:p-10 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>

    </div>
  );
}
