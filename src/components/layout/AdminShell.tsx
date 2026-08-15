"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  ActivitySquare,
  ArrowLeftRight,
  AtSign,
  Award,
  Banknote,
  Bell,
  Biohazard,
  BookCheck,
  BookOpen,
  BrainCircuit,
  BriefcaseMedical,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  CloudUpload,
  Contact,
  HardDrive,
  Inbox,
  KanbanSquare,
  Clock,
  CreditCard,
  DoorOpen,
  FileText,
  GraduationCap,
  Home,
  Hotel,
  House,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Menu,
  Megaphone,
  MessageSquare,
  Monitor,
  Moon,
  FileCheck2,
  FileSignature,
  NotebookPen,
  NotebookText,
  Pill,
  Radar,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Sun,
  Sunrise,
  Truck,
  Umbrella,
  UserCog,
  UserPlus,
  Users,
  Users2,
  Wallet,
  Utensils,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { FACILITY_LIST_TTL_MS, useFacilityStore } from "@/hooks/useFacilityStore";
import { useSurveyVisitSession } from "@/hooks/useSurveyVisitSession";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { HavenShellBrandLink } from "@/components/layout/HavenShellBrandLink";
import { UserMenu } from "@/components/layout/UserMenu/UserMenu";
import { IdentityBlock } from "@/components/ui/identity-block";
import { SurveyVisitShellToggle } from "@/components/compliance/SurveyVisitShellToggle";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { shouldSuppressSurveyVisitChrome } from "@/lib/navigation/survey-visit-chrome-scope";
import { cn } from "@/lib/utils";

/** Workspace strip inside main column (`--background`); persisted sidebar uses `haven-chrome-*`. Mercury pattern. */
const WORKSPACE_WELL =
  "border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground";
const WORKSPACE_KBD =
  "rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground";
const WORKSPACE_ICON =
  "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type AdminNavItem = {
  key: string;
  href: string;
  label: string;
  enabled: boolean;
  icon: LucideIcon;
};

type AdminNavGroup = {
  group: string;
  icon: LucideIcon;
  items: AdminNavItem[];
};

function getRoleHomeLabel(appRole: string, roleLabel: string): string {
  switch (appRole) {
    case "admin_assistant":
      return "Front desk home";
    case "coordinator":
      return "Coordinator home";
    case "nurse":
      return "Medication home";
    default:
      return `${roleLabel} home`;
  }
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const facilitiesFetchedAt = useFacilityStore((s) => s.facilitiesFetchedAt);
  const facilitiesCacheUserId = useFacilityStore((s) => s.facilitiesCacheUserId);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);
  const setAvailableFacilities = useFacilityStore((s) => s.setAvailableFacilities);
  const clearFacilityCache = useFacilityStore((s) => s.clearFacilityCache);

  const {
    email: sessionEmail,
    appRole,
    user,
    organizationId,
    orgName,
    fullName,
    avatarUrl,
    loading: authLoading,
  } = useHavenAuth();
  const currentUserId = user?.id ?? null;
  const hasFreshOwnedFacilityCache =
    currentUserId != null &&
    facilitiesCacheUserId === currentUserId &&
    facilitiesFetchedAt != null &&
    availableFacilities.length > 0 &&
    Date.now() - facilitiesFetchedAt < FACILITY_LIST_TTL_MS;
  const visibleFacilities = hasFreshOwnedFacilityCache ? availableFacilities : [];
  const selectedFacilityIsValid =
    selectedFacilityId == null ||
    visibleFacilities.some((facility) => facility.id === selectedFacilityId);
  const safeSelectedFacilityId = selectedFacilityIsValid ? selectedFacilityId : null;
  const currentFacility = visibleFacilities.find((f) => f.id === safeSelectedFacilityId);
  const surveyVisit = useSurveyVisitSession(safeSelectedFacilityId, {
    userId: currentUserId,
    appRole,
    organizationId,
    loading: authLoading,
  });

  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const facilityRefreshRequestRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const roleConfig = useMemo(() => getRoleDashboardConfig(appRole), [appRole]);
  const suppressSurveyVisitChrome = useMemo(() => shouldSuppressSurveyVisitChrome(pathname), [pathname]);
  const [signingOut, setSigningOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      facilityRefreshRequestRef.current += 1;
      clearFacilityCache();
      setSelectedFacility(null);
      syncSelectedFacilityCookie(null);

      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [clearFacilityCache, router, setSelectedFacility]);

  const refreshFacilities = useCallback(async () => {
    if (authLoading) {
      setFacilitiesLoading(true);
      setFacilitiesLoadFailed(false);
      return;
    }

    if (currentUserId == null) {
      facilityRefreshRequestRef.current += 1;
      clearFacilityCache();
      setSelectedFacility(null);
      syncSelectedFacilityCookie(null);
      setFacilitiesLoading(false);
      setFacilitiesLoadFailed(false);
      return;
    }

    const st = useFacilityStore.getState();
    if (
      st.facilitiesCacheUserId === currentUserId &&
      st.facilitiesFetchedAt != null &&
      st.availableFacilities.length > 0 &&
      Date.now() - st.facilitiesFetchedAt < FACILITY_LIST_TTL_MS
    ) {
      if (
        st.selectedFacilityId != null &&
        !st.availableFacilities.some((f) => f.id === st.selectedFacilityId)
      ) {
        setSelectedFacility(null);
        syncSelectedFacilityCookie(null);
      }
      setFacilitiesLoading(false);
      setFacilitiesLoadFailed(false);
      return;
    }

    if (st.facilitiesCacheUserId != null && st.facilitiesCacheUserId !== currentUserId) {
      facilityRefreshRequestRef.current += 1;
      clearFacilityCache();
      setSelectedFacility(null);
      syncSelectedFacilityCookie(null);
    }

    const requestId = facilityRefreshRequestRef.current + 1;
    facilityRefreshRequestRef.current = requestId;
    setFacilitiesLoading(true);
    setFacilitiesLoadFailed(false);
    try {
      const list = await fetchAdminFacilityOptions();
      if (
        facilityRefreshRequestRef.current !== requestId ||
        currentUserIdRef.current !== currentUserId
      ) {
        return;
      }

      setAvailableFacilities(list, currentUserId);
      const persistedId = useFacilityStore.getState().selectedFacilityId;
      if (persistedId != null && !list.some((f) => f.id === persistedId)) {
        setSelectedFacility(null);
        syncSelectedFacilityCookie(null);
      }
    } catch (err) {
      if (
        facilityRefreshRequestRef.current !== requestId ||
        currentUserIdRef.current !== currentUserId
      ) {
        return;
      }

      console.warn("[AdminShell] refreshFacilities failed", err);
      clearFacilityCache();
      setFacilitiesLoadFailed(true);
    } finally {
      if (
        facilityRefreshRequestRef.current === requestId &&
        currentUserIdRef.current === currentUserId
      ) {
        setFacilitiesLoading(false);
      }
    }
  }, [authLoading, clearFacilityCache, currentUserId, setAvailableFacilities, setSelectedFacility]);

  useEffect(() => {
    void refreshFacilities();
  }, [refreshFacilities]);

  useEffect(() => {
    if (authLoading) return;
    if (currentUserId == null) {
      syncSelectedFacilityCookie(null);
      return;
    }
    if (facilitiesLoading || facilitiesLoadFailed) return;
    syncSelectedFacilityCookie(safeSelectedFacilityId);
  }, [
    authLoading,
    currentUserId,
    facilitiesLoadFailed,
    facilitiesLoading,
    safeSelectedFacilityId,
  ]);

  const handleFacilityScopeChange = useCallback(
    (facilityId: string | null) => {
      setSelectedFacility(facilityId);
      syncSelectedFacilityCookie(facilityId);
      router.refresh();
    },
    [router, setSelectedFacility],
  );

  const facilityControlLoading = authLoading || facilitiesLoading;
  const facilityTriggerLabel = facilityControlLoading
    ? "Loading facilities…"
    : safeSelectedFacilityId === null
      ? "All facilities"
      : (currentFacility?.name ?? "Select facility…");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close mobile nav when route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const allNavGroups = useMemo<AdminNavGroup[]>(
    () => [
      {
        group: "Command",
        icon: Zap,
        items: [
          { key: "dashboard", href: "/admin", label: "Triage Inbox", enabled: true, icon: LayoutDashboard },
          { key: "approvals", href: "/admin/approvals", label: "Approvals inbox", enabled: true, icon: ListChecks },
          { key: "briefing", href: "/admin/briefing", label: "Morning huddle", enabled: true, icon: Sunrise },
          { key: "meetings", href: "/admin/meetings", label: "Meeting hub", enabled: true, icon: NotebookPen },
          { key: "master-calendar", href: "/admin/calendar", label: "Master calendar", enabled: true, icon: CalendarDays },
          { key: "letters", href: "/admin/letters", label: "Letters & documents", enabled: true, icon: FileSignature },
          { key: "internal-forms", href: "/admin/forms", label: "Internal forms", enabled: true, icon: ClipboardList },
          { key: "acknowledgments", href: "/admin/acknowledgments", label: "Policy acknowledgments", enabled: true, icon: FileCheck2 },
          { key: "contacts", href: "/admin/contacts", label: "Contacts & on-call", enabled: true, icon: Contact },
          { key: "front-desk", href: "/admin/front-desk", label: "Front desk", enabled: true, icon: Users },
          { key: "cash-trust", href: "/admin/cash", label: "Cash & resident trust", enabled: true, icon: Wallet },
          { key: "survey-binder", href: "/admin/survey-binder", label: "Survey binder", enabled: true, icon: BookCheck },
          { key: "drive-import", href: "/admin/drive-import", label: "Drive import", enabled: true, icon: CloudUpload },
          { key: "drive-cutover", href: "/admin/drive-cutover", label: "Drive cutover", enabled: true, icon: ShieldCheck },
          { key: "workspace", href: "/admin/workspace", label: "My workspace", enabled: true, icon: NotebookText },
          { key: "files", href: "/admin/files", label: "My files", enabled: true, icon: HardDrive },
          { key: "publish-queue", href: "/admin/workspace/publish-queue", label: "Publish queue", enabled: true, icon: Inbox },
          { key: "teams", href: "/admin/teams", label: "Team spaces", enabled: true, icon: Users2 },
          { key: "kanban", href: "/admin/kanban", label: "My board", enabled: true, icon: KanbanSquare },
          { key: "handoff", href: "/admin/handoff", label: "Shift handoff", enabled: true, icon: ClipboardCheck },
          { key: "mentions", href: "/admin/mentions", label: "My mentions", enabled: true, icon: AtSign },
          { key: "workspace-search", href: "/admin/workspace/search", label: "Search workspace", enabled: true, icon: Search },
          { key: "executive", href: "/admin/executive", label: "Executive summary", enabled: true, icon: LineChart },
          { key: "reports", href: "/admin/reports", label: "Reports hub", enabled: true, icon: FileText },
          { key: "facilities", href: "/admin/facilities", label: "Facilities", enabled: true, icon: Hotel },
        ],
      },
      {
        group: "Pipeline",
        icon: ActivitySquare,
        items: [
          { key: "referrals", href: "/admin/referrals", label: "Referrals CRM", enabled: true, icon: UserPlus },
          { key: "admissions", href: "/pipeline/recent-admissions", label: "Admissions overview", enabled: true, icon: Home },
          { key: "discharge", href: "/pipeline/discharge-management", label: "Medication reconciliation", enabled: true, icon: DoorOpen },
          { key: "family-messages", href: "/admin/family-messages", label: "Family notes", enabled: true, icon: Megaphone },
        ],
      },
      {
        group: "Clinical Ops",
        icon: Stethoscope,
        items: [
          { key: "residents", href: "/admin/residents", label: "Resident roster", enabled: true, icon: Users },
          { key: "care-plans", href: "/admin/care-plans/reviews-due", label: "Care plan reviews", enabled: true, icon: ClipboardList },
          { key: "assessments", href: "/admin/assessments/overdue", label: "Clinical Desk", enabled: true, icon: ClipboardCheck },
          { key: "rounding", href: "/admin/rounding", label: "Smart Rounding", enabled: true, icon: Clock },
          { key: "med-tech", href: "/med-tech", label: "Med-Tech cockpit", enabled: true, icon: Pill },
          { key: "medication-errors", href: "/admin/medications/errors", label: "Medication errors", enabled: true, icon: ShieldAlert },
          { key: "medications", href: "/admin/medications", label: "Medications", enabled: true, icon: Pill },
          { key: "dietary", href: "/admin/dietary", label: "Dietary & Nutrition", enabled: true, icon: Utensils },
          { key: "transportation", href: "/admin/transportation", label: "Transportation", enabled: true, icon: Truck },
        ],
      },
      {
        group: "Quality & Risk",
        icon: ShieldCheck,
        items: [
          { key: "risk", href: "/admin/risk", label: "Risk command", enabled: true, icon: Radar },
          { key: "incidents-new", href: "/admin/incidents/new", label: "Report incident", enabled: true, icon: ShieldAlert },
          { key: "incidents", href: "/admin/incidents", label: "Incident queue", enabled: true, icon: ShieldAlert },
          { key: "infection", href: "/admin/infection-control", label: "Infection Control", enabled: true, icon: Biohazard },
          { key: "compliance", href: "/admin/compliance", label: "Compliance & Safety", enabled: true, icon: Scale },
          { key: "quality", href: "/admin/quality", label: "Quality metrics", enabled: true, icon: LineChart },
        ],
      },
      {
        group: "Knowledge",
        icon: BrainCircuit,
        items: [
          { key: "kb-chat", href: "/admin/knowledge", label: "Ask knowledge base", enabled: true, icon: MessageSquare },
          { key: "kb-admin", href: "/admin/knowledge/admin", label: "KB admin", enabled: true, icon: BookOpen },
        ],
      },
      {
        group: "Workforce",
        icon: BriefcaseMedical,
        items: [
          { key: "staff", href: "/admin/staff", label: "Staff roster", enabled: true, icon: UserCog },
          { key: "schedules", href: "/admin/schedules", label: "Schedules", enabled: true, icon: CalendarDays },
          { key: "shift-swaps", href: "/admin/shift-swaps", label: "Shift swaps", enabled: true, icon: ArrowLeftRight },
          { key: "staffing", href: "/admin/staffing", label: "Staffing alerts", enabled: true, icon: Activity },
          { key: "certifications", href: "/admin/certifications", label: "Certifications", enabled: true, icon: Award },
          { key: "training", href: "/admin/training", label: "Training", enabled: true, icon: GraduationCap },
          { key: "time-records", href: "/admin/time-records", label: "Time records", enabled: true, icon: Clock },
          { key: "payroll", href: "/admin/payroll", label: "Payroll", enabled: true, icon: Banknote },
          { key: "users", href: "/admin/settings/users", label: "User management", enabled: true, icon: Users },
        ],
      },
      {
        group: "Finance",
        icon: Building2,
        items: [
          { key: "billing", href: "/admin/billing", label: "Billing & AR", enabled: true, icon: CreditCard },
          { key: "finance", href: "/admin/finance", label: "Finance hub", enabled: true, icon: Landmark },
          { key: "vendors", href: "/admin/vendors", label: "Vendors & AP", enabled: true, icon: Truck },
          { key: "insurance", href: "/admin/insurance", label: "Insurance", enabled: true, icon: Umbrella },
          { key: "feedback", href: "/admin/feedback", label: "Pilot feedback", enabled: true, icon: MessageSquare },
          { key: "notifications", href: "/admin/settings/notifications", label: "Settings", enabled: true, icon: Smartphone },
        ],
      },
    ],
    [],
  );

  const navGroups = useMemo<AdminNavGroup[]>(() => {
    const visibleKeySet = roleConfig.visibleItemKeys ? new Set(roleConfig.visibleItemKeys) : null;
    const baseGroups = allNavGroups
      .filter((group) => roleConfig.visibleGroups.includes(group.group))
      .map((group) => ({
        ...group,
        items: visibleKeySet
          ? group.items.filter((item) => visibleKeySet.has(item.key))
          : group.items.filter((item) =>
              roleConfig.route === "/admin" ? true : item.key !== "dashboard",
            ),
      }))
      .filter((group) => group.items.length > 0);

    if (roleConfig.route === "/admin" || baseGroups.length === 0) {
      return baseGroups;
    }

    const homeItem: AdminNavItem = {
      key: "role-home",
      href: roleConfig.route,
      label: getRoleHomeLabel(appRole, roleConfig.roleLabel),
      enabled: true,
      icon: House,
    };

    const preferredHomeGroup = roleConfig.visibleGroups.includes("Command")
      ? "Command"
      : baseGroups[0]?.group;

    if (!preferredHomeGroup) return baseGroups;

    const existingGroup = baseGroups.find((group) => group.group === preferredHomeGroup);
    if (existingGroup) {
      return baseGroups.map((group) =>
        group.group === preferredHomeGroup ? { ...group, items: [homeItem, ...group.items] } : group,
      );
    }

    const groupTemplate = allNavGroups.find((group) => group.group === preferredHomeGroup);
    if (!groupTemplate) return baseGroups;

    return [{ ...groupTemplate, items: [homeItem] }, ...baseGroups];
  }, [
    allNavGroups,
    appRole,
    roleConfig.roleLabel,
    roleConfig.route,
    roleConfig.visibleGroups,
    roleConfig.visibleItemKeys,
  ]);

  const isItemActive = useCallback(
    (href: string) => {
      if (href === "/admin") return pathname === "/admin";
      return pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname],
  );

  const toggleGroup = useCallback((groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }, []);

  const renderNav = (className?: string) => (
    <nav
      className={cn(
        "flex-1 overflow-y-auto px-2 py-3 [scrollbar-gutter:stable]",
        className,
      )}
      aria-label="Primary"
    >
      <div className="flex flex-col gap-4">
        {navGroups.map((group) => {
          const GroupIcon = group.icon;
          const collapsed = collapsedGroups.has(group.group);
          return (
            <div key={group.group} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleGroup(group.group)}
                className={cn(
                  "group/header flex h-7 w-full items-center gap-2 rounded-md px-2",
                  "text-[11px] font-medium uppercase tracking-wider haven-chrome-fg-muted haven-chrome-tab-idle",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                )}
                aria-expanded={!collapsed}
              >
                <GroupIcon className="size-3.5 haven-chrome-fg-muted opacity-70 transition-opacity group-hover/header:opacity-100" />
                <span className="flex-1 text-left">{group.group}</span>
                <ChevronDown
                  className={cn(
                    "size-3 opacity-50 transition-transform",
                    collapsed && "-rotate-90",
                  )}
                />
              </button>
              {!collapsed && (
                <ul className="mt-1 flex flex-col gap-px">
                  {group.items.map((item) => {
                    if (!item.enabled) return null;
                    const ItemIcon = item.icon;
                    const active = isItemActive(item.href);
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            // 2px left accent bar chosen over icon-tint: matches bottom-nav pattern from S2
                            // and provides a clear brand-primary signal without relying on color alone (rule 4).
                            "group/item relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
                            "transition-colors duration-[var(--motion-duration-micro)]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "haven-chrome-rail-active" : "haven-chrome-rail-quiet",
                          )}
                        >
                          <ItemIcon
                            className={cn(
                              "size-4 shrink-0 transition-colors",
                              active
                                ? "haven-chrome-fg"
                                : "haven-chrome-fg-muted group-hover/item:text-[hsl(var(--chrome-foreground))]",
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );

  const renderBrand = () => (
    <HavenShellBrandLink
      href={roleConfig.route}
      aria-label={`Haven — go to ${roleConfig.roleLabel.toLowerCase()} home`}
      className={cn(
        "flex h-14 w-full shrink-0 border-b border-border px-4",
        "haven-chrome-fg transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span className="haven-chrome-fg-muted ml-auto rounded border border-[hsl(var(--chrome-foreground)/0.2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
        {roleConfig.roleLabel}
      </span>
    </HavenShellBrandLink>
  );

  const renderFacilityScope = () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="admin-facility-filter-trigger"
        aria-label={
          facilitiesLoadFailed
            ? "Facility filter — failed to load list, open for retry"
            : facilityControlLoading
              ? "Facility filter — loading"
              : `Facility filter — ${
                  safeSelectedFacilityId === null ? "all facilities" : currentFacility?.name ?? "selected facility"
                }`
        }
        className={cn(
          WORKSPACE_WELL,
          "mx-2 my-2 flex min-h-9 items-center gap-2 rounded-md px-2.5",
          "text-[13px] font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Building2 className="size-4 shrink-0 opacity-90" aria-hidden />
        {facilityControlLoading ? (
          <Skeleton className="h-3.5 flex-1 rounded bg-muted" aria-label="Loading facilities" />
        ) : (
          <span
            className="flex-1 min-w-0 max-w-[min(28rem,calc(100vw-12rem))] truncate text-left"
            title={
              !facilityControlLoading && safeSelectedFacilityId !== null && currentFacility?.name
                ? currentFacility.name
                : undefined
            }
          >
            {facilityTriggerLabel}
          </span>
        )}
        <ChevronDown className="size-3.5 shrink-0 opacity-90" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[244px] p-1">
        <DropdownMenuItem
          onClick={() => handleFacilityScopeChange(null)}
          className="flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
        >
          <span className="flex items-center gap-2">
            <Building2 className="size-3.5 text-muted-foreground" />
            All facilities
          </span>
          {safeSelectedFacilityId === null && <Check className="size-3.5 text-success" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        {facilitiesLoadFailed && (
          <div className="px-2 py-2 text-[12px] text-warning">
            Could not load facilities.
            <button
              onClick={() => void refreshFacilities()}
              className="ml-1 underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        {visibleFacilities.map((facility) => (
          <DropdownMenuItem
            key={facility.id}
            onClick={() => handleFacilityScopeChange(facility.id)}
            className="flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
          >
            <span className="truncate pr-2">{facility.name}</span>
            {safeSelectedFacilityId === facility.id && (
              <Check className="size-3.5 shrink-0 text-success" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderSidebarFooter = () => (
    <div className="shrink-0 border-t border-border p-2">
      <UserMenu
        fullName={fullName}
        email={sessionEmail}
        roleLabel={roleConfig.roleLabel}
        organizationId={organizationId}
        orgName={orgName}
        avatarUrl={avatarUrl}
        userId={currentUserId}
        signingOut={signingOut}
        onSignOut={handleSignOut}
        contentSide="top"
        contentAlign="start"
        contentSideOffset={8}
        triggerClassName={cn(
          "flex h-12 w-full items-center gap-2 rounded-md px-2 text-left",
          "transition-colors hover:bg-[hsl(var(--chrome-foreground)/0.08)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        triggerChildren={(orgName) => (
          <>
            <IdentityBlock
              fullName={fullName}
              email={sessionEmail}
              roleLabel={roleConfig.roleLabel}
              orgName={orgName}
              avatarUrl={avatarUrl}
              userId={currentUserId}
              size="sm"
              className="min-w-0 flex-1 [&_[data-slot=avatar]]:ring-1 [&_[data-slot=avatar]]:ring-[hsl(var(--chrome-foreground)/0.15)] [&_p]:text-[hsl(var(--chrome-foreground-muted))] [&_p:first-of-type]:text-[hsl(var(--chrome-foreground))] [&_svg]:text-[hsl(var(--chrome-foreground-muted))]"
            />
            <ChevronsRight className="haven-chrome-fg-muted size-3.5 shrink-0" aria-hidden />
          </>
        )}
      />
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground antialiased">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex w-[308px] shrink-0 flex-col border-r border-border haven-chrome-sidebar",
        )}
        aria-label="Sidebar"
      >
        {renderBrand()}
        {renderFacilityScope()}
        {renderNav()}
        {renderSidebarFooter()}
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0 lg:border-l lg:border-border">
        {/* Topbar */}
        <header
          className={cn(
            "bg-background text-foreground flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 lg:px-5",
            "sticky top-0 z-30",
          )}
        >
          {/* Mobile hamburger — single Sheet hosts both trigger and drawer */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              className={cn(
                WORKSPACE_ICON,
                "lg:hidden",
              )}
              aria-label="Open navigation"
            >
              <Menu className="size-4" aria-hidden />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[328px] border-r border-border haven-chrome-sidebar p-0"
              showCloseButton={false}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Primary navigation</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                {renderBrand()}
                {renderFacilityScope()}
                {renderNav()}
                {renderSidebarFooter()}
              </div>
            </SheetContent>
          </Sheet>

          {/* Search */}
          <Link
            href="/admin/search"
            className={cn(
              WORKSPACE_WELL,
              "ml-1 hidden md:flex h-8 max-w-[440px] flex-1 items-center gap-2 rounded-md",
              "px-2.5 text-[12px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label="Search"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">Search residents, staff, incidents…</span>
            <kbd className={cn(WORKSPACE_KBD, "ml-auto")}>
              ⌘K
            </kbd>
          </Link>

          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href="/admin/search"
                    aria-label="Search"
                    className={cn(
                      WORKSPACE_ICON,
                      "md:hidden",
                    )}
                  />
                }
              >
                <Search className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">Search (⌘K)</TooltipContent>
            </Tooltip>

            <PilotFeedbackLauncher shellKind="admin" facilityId={safeSelectedFacilityId} compact />

            {suppressSurveyVisitChrome ? null : <SurveyVisitShellToggle survey={surveyVisit} />}

            <Tooltip>
              <TooltipTrigger
                aria-label="Notifications"
                className={cn(
                  WORKSPACE_ICON,
                  "relative",
                )}
              >
                <Bell className="size-4" aria-hidden />
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  WORKSPACE_ICON,
                  "outline-none",
                )}
                aria-label="Toggle theme"
              >
                {mounted && theme === "dark" ? (
                  <Moon className="size-4" />
                ) : mounted && theme === "light" ? (
                  <Sun className="size-4" />
                ) : (
                  <Monitor className="size-4" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36 p-1">
                <DropdownMenuItem
                  onClick={() => setTheme("light")}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
                >
                  <Sun className="size-3.5" /> Light
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme("dark")}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
                >
                  <Moon className="size-3.5" /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme("system")}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
                >
                  <Monitor className="size-3.5" /> System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Scrolling main — full-bleed, no mx-auto/max-w. Pages that need a
            narrow column for long-form content (settings forms, etc.) apply
            max-w on an inner block, not on this wrapper. */}
        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-5 py-5 lg:px-6 lg:py-6 2xl:px-8 2xl:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
