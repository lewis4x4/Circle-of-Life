"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { 
  Bell, 
  Search, 
  UserCircle2, 
  ChevronDown, 
  Check,
  PanelLeftClose,
  PanelLeftOpen,
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
  Smartphone,
  Star,
} from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SurveyVisitModeBar } from "@/components/compliance/SurveyVisitModeBar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setTheme, theme } = useTheme();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);
  const setAvailableFacilities = useFacilityStore((s) => s.setAvailableFacilities);

  const currentFacility = availableFacilities.find((f) => f.id === selectedFacilityId);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    "Command & Triage": true,
    "Resident Pipeline": true,
    "Clinical & Daily Ops": true,
    "Quality & Risk": true,
  });
  
  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setSessionEmail(data.session?.user?.email ?? null);
      } catch (err) {
        console.warn("[AdminShell] getSession failed", err);
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

  const refreshFacilities = useCallback(async () => {
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

  const navGroups = useMemo(() => [
    {
      group: "Command & Triage",
      items: [
        { key: "dashboard", href: "/admin", label: "Triage Inbox", enabled: true, icon: LayoutDashboard },
        { key: "executive", href: "/admin/executive", label: "Executive", enabled: true, icon: BarChart3 },
      ]
    },
    {
      group: "Resident Pipeline",
      items: [
        { key: "referrals", href: "/admin/referrals", label: "Referrals", enabled: true, icon: UserPlus },
        { key: "admissions", href: "/admin/admissions", label: "Admissions", enabled: true, icon: Home },
        { key: "discharge", href: "/admin/discharge", label: "Discharge", enabled: true, icon: DoorOpen },
        { key: "family-portal", href: "/admin/family-portal", label: "Family Portal", enabled: true, icon: Heart },
        { key: "family-messages", href: "/admin/family-messages", label: "Family Messages", enabled: true, icon: MessageCircle },
      ]
    },
    {
      group: "Clinical & Daily Ops",
      items: [
        { key: "residents", href: "/admin/residents", label: "Roster", enabled: true, icon: Users },
        { key: "assessments", href: "/admin/assessments/overdue", label: "Clinical Desk", enabled: true, icon: ClipboardCheck },
        { key: "medications", href: "/admin/medications", label: "Medications", enabled: true, icon: Pill },
        { key: "dietary", href: "/admin/dietary", label: "Dietary", enabled: true, icon: Utensils },
        { key: "transportation", href: "/admin/transportation", label: "Transportation", enabled: true, icon: Bus },
      ]
    },
    {
      group: "Quality & Risk",
      items: [
        { key: "incidents", href: "/admin/incidents", label: "Incidents", enabled: true, icon: ShieldAlert },
        { key: "infection", href: "/admin/infection-control", label: "Infection Control", enabled: true, icon: Biohazard },
        { key: "compliance", href: "/admin/compliance", label: "Compliance", enabled: true, icon: Scale },
        { key: "quality", href: "/admin/quality", label: "Quality Metrics", enabled: true, icon: LineChart },
        { key: "reputation", href: "/admin/reputation", label: "Reputation", enabled: true, icon: Star },
      ]
    },
    {
      group: "Workforce",
      items: [
        { key: "staff", href: "/admin/staff", label: "Staff Roster", enabled: true, icon: UserCog },
        { key: "schedules", href: "/admin/schedules", label: "Schedules", enabled: true, icon: CalendarDays },
        { key: "staffing", href: "/admin/staffing", label: "Staffing", enabled: true, icon: Activity },
        { key: "certifications", href: "/admin/certifications", label: "Certifications", enabled: true, icon: Award },
        { key: "training", href: "/admin/training", label: "Training", enabled: true, icon: GraduationCap },
        { key: "time-records", href: "/admin/time-records", label: "Time records", enabled: true, icon: Clock },
        { key: "payroll", href: "/admin/payroll", label: "Payroll", enabled: true, icon: Banknote },
      ]
    },
    {
      group: "Finance & Business",
      items: [
        { key: "billing", href: "/admin/billing", label: "Billing & AR", enabled: true, icon: CreditCard },
        { key: "finance", href: "/admin/finance", label: "Finance Hub", enabled: true, icon: Landmark },
        { key: "vendors", href: "/admin/vendors", label: "Vendors & AP", enabled: true, icon: Truck },
        { key: "insurance", href: "/admin/insurance", label: "Insurance", enabled: true, icon: Umbrella },
        { key: "notifications", href: "/admin/settings/notifications", label: "Settings", enabled: true, icon: Smartphone },
      ]
    }
  ], []);

  // Auto-expand the group that contains the active route
  useEffect(() => {
    let activeGroup = "";
    navGroups.forEach(g => {
      g.items.forEach(item => {
        if (pathname === item.href || pathname.startsWith(item.href + "/") && item.href !== "/admin") {
          activeGroup = g.group;
        }
        if (item.href === "/admin" && pathname === "/admin") {
          activeGroup = g.group;
        }
      });
    });
    if (activeGroup) {
      setExpandedGroups(prev => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }));
    }
  }, [pathname, navGroups]);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300">
      {/* Sidebar */}
      <aside 
        className={`border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-soft hidden lg:flex lg:flex-col transition-all duration-300 ease-in-out shrink-0 relative ${
          isSidebarCollapsed ? "w-16" : "w-[260px]"
        }`}
      >
        <div className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 overflow-hidden shrink-0">
          <div className="flex justify-between items-center w-full">
            <span className={`text-lg font-semibold font-display text-slate-900 dark:text-white tracking-tight whitespace-nowrap transition-opacity duration-300 ${isSidebarCollapsed ? "opacity-0 invisible w-0" : "opacity-100 visible"}`}>
              Haven Admin
            </span>
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 rounded-md text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5 flex-shrink-0" />}
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-4 overflow-y-auto overflow-x-hidden scrollbar-hide">
          {navGroups.map((group, gIdx) => {
            const isExpanded = expandedGroups[group.group] || isSidebarCollapsed;
            
            return (
              <div key={gIdx} className="flex flex-col">
                {/* Group Header */}
                {!isSidebarCollapsed && (
                  <button 
                    onClick={() => toggleGroup(group.group)}
                    className="flex w-full items-center justify-between px-3 py-1.5 mb-1 group text-left outline-none"
                  >
                    <span className="text-[10px] font-mono tracking-widest text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 uppercase transition-colors">
                      {group.group}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`} />
                  </button>
                )}
                
                {isSidebarCollapsed && <div className="h-4" />}

                {/* Group Items */}
                {isExpanded && (
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        (item.key === "executive" && pathname.startsWith("/admin/executive")) ||
                        (item.key === "referrals" && pathname.startsWith("/admin/referrals")) ||
                        (item.key === "reputation" && pathname.startsWith("/admin/reputation")) ||
                        (item.key === "admissions" && pathname.startsWith("/admin/admissions")) ||
                        (item.key === "discharge" && pathname.startsWith("/admin/discharge")) ||
                        (item.key === "quality" && pathname.startsWith("/admin/quality")) ||
                        (item.key === "medications" && pathname.startsWith("/admin/medications")) ||
                        (item.key === "infection" && pathname.startsWith("/admin/infection-control")) ||
                        (item.key === "compliance" && pathname.startsWith("/admin/compliance")) ||
                        (item.key === "finance" && pathname.startsWith("/admin/finance")) ||
                        (item.key === "insurance" && pathname.startsWith("/admin/insurance")) ||
                        (item.key === "vendors" && pathname.startsWith("/admin/vendors")) ||
                        (item.key === "family-portal" && pathname.startsWith("/admin/family-portal")) ||
                        (item.key === "training" && pathname.startsWith("/admin/training")) ||
                        (item.key === "payroll" && pathname.startsWith("/admin/payroll")) ||
                        (item.key === "dietary" && pathname.startsWith("/admin/dietary")) ||
                        (item.key === "transportation" && pathname.startsWith("/admin/transportation")) ||
                        (item.key === "notifications" && pathname.startsWith("/admin/settings"));
                        
                      const Icon = item.icon;
                      
                      if (!item.enabled) {
                        return (
                          <div
                            key={item.key}
                            className="flex items-center gap-3 rounded-md px-3 py-2 cursor-not-allowed opacity-50"
                            title={isSidebarCollapsed ? item.label : undefined}
                          >
                            <Icon className="w-5 h-5 shrink-0 text-slate-400" />
                            {!isSidebarCollapsed && <span className="text-sm font-medium text-slate-400 whitespace-nowrap">{item.label}</span>}
                          </div>
                        );
                      }
                      
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          title={isSidebarCollapsed ? item.label : undefined}
                          className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium tap-responsive transition-colors ${
                            isActive
                              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white shadow-sm"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/50 hover:text-slate-900 dark:hover:text-white"
                          }`}
                        >
                          <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"}`} />
                          <span className={`whitespace-nowrap transition-opacity duration-300 ${isSidebarCollapsed ? "opacity-0 invisible w-0" : "opacity-100 visible"}`}>
                            {item.label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 lg:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 transition-colors duration-300">
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 shadow-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 tap-responsive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-200 truncate max-w-[200px]">
                  {facilityTriggerLabel}
                </span>
                <ChevronDown className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px] dark:bg-slate-950 dark:border-slate-800">
                <DropdownMenuItem
                  onClick={() => setSelectedFacility(null)}
                  className="flex cursor-pointer items-center justify-between font-medium dark:focus:bg-slate-800"
                >
                  All facilities
                  {selectedFacilityId === null && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                </DropdownMenuItem>

                {facilitiesLoadFailed ? (
                  <div className="px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                    Could not load facilities. Check login and Supabase access.
                  </div>
                ) : null}

                {facilitiesLoadFailed ? (
                  <DropdownMenuItem
                    onClick={() => void refreshFacilities()}
                    className="cursor-pointer dark:focus:bg-slate-800"
                  >
                    Retry loading facilities
                  </DropdownMenuItem>
                ) : null}

                {availableFacilities.map((facility) => (
                  <DropdownMenuItem 
                    key={facility.id}
                    onClick={() => setSelectedFacility(facility.id)}
                    className="flex justify-between items-center cursor-pointer dark:focus:bg-slate-800"
                  >
                    {facility.name}
                    {selectedFacilityId === facility.id && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <div className="flex items-center gap-3">
            <Link
              href="/admin/search"
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 tap-responsive"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </Link>
            <button className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 tap-responsive" aria-label="Notifications">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-600 border-2 border-white dark:border-slate-950"></span>
            </button>
            
            <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-800" />

            {sessionEmail ? (
              <span
                className="hidden max-w-[168px] truncate text-xs text-slate-600 dark:text-slate-300 md:inline"
                title={sessionEmail}
              >
                {sessionEmail}
              </span>
            ) : null}

            {/* Global Theme Toggle */}
            <DropdownMenu>
              <DropdownMenuTrigger className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 tap-responsive outline-none">
                {mounted && theme === "dark" ? <Moon className="w-5 h-5" /> : mounted && theme === "light" ? <Sun className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36 dark:bg-slate-950 dark:border-slate-800">
                <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer dark:focus:bg-slate-800">
                  <Sun className="mr-2 h-4 w-4" /> Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer dark:focus:bg-slate-800">
                  <Moon className="mr-2 h-4 w-4" /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer dark:focus:bg-slate-800">
                  <Monitor className="mr-2 h-4 w-4" /> System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 tap-responsive ml-1" aria-label="Profile">
              <UserCircle2 className="w-7 h-7 text-slate-600 dark:text-slate-300" />
            </button>
          </div>
        </header>

        <SurveyVisitModeBar />

        {/* Dynamic Page Content with Global Ambient Matrix */}
        <main className="flex-1 overflow-auto p-6 lg:p-8 relative dark:bg-[#020202]">
          <div className="fixed top-0 right-0 h-[800px] w-[800px] rounded-full blur-[150px] bg-indigo-500/5 dark:bg-indigo-600/10 pointer-events-none transition-colors duration-[3000ms] z-0 mix-blend-screen" />
          <div className="fixed bottom-0 left-0 h-[600px] w-[600px] rounded-full blur-[120px] bg-emerald-500/5 dark:bg-emerald-900/10 pointer-events-none transition-colors duration-[3000ms] z-0 mix-blend-screen" />
          
          <div className="relative z-10 w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
