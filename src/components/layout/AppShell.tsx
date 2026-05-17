"use client";

/**
 * AppShell — Mercury-pattern two-level admin navigation primitive.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ logo · facility scope · Command Pipeline Clinical Quality    │  ← top bar
 *   │                              Workforce Knowledge       ⌘K …  │
 *   ├──────────┬───────────────────────────────────────────────────┤
 *   │ active   │                                                   │
 *   │ pillar   │   page content                                    │  ← contextual rail (left)
 *   │ items    │                                                   │      shows only the active
 *   │ (≤ 9)    │                                                   │      pillar's items, no
 *   │          │                                                   │      group headers, no
 *   │          │                                                   │      collapse toggles.
 *   └──────────┴───────────────────────────────────────────────────┘
 *
 * Single primitive consumed by `src/app/(admin)/admin/layout.tsx`. Pillar
 * data lives in `@/lib/navigation/pillars` so the chrome stays presentational.
 *
 * Anti-patterns enforced here (per Quiet Operator DNA):
 *  - No hamburger menu on desktop.
 *  - No nested collapsible sections — pillars cap at 9 items.
 *  - No "More" overflow menu — auxiliary routes live in the ⌘K palette.
 *  - Survey Visit Mode banner is page-level chrome, not nav.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  UserCircle2,
} from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { FACILITY_LIST_TTL_MS, useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { SurveyVisitModeBar } from "@/components/compliance/SurveyVisitModeBar";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  AUXILIARY_ROUTES,
  PILLARS,
  REPORT_INCIDENT_HREF,
  findActivePillar,
  type Pillar,
  type PillarItem,
} from "@/lib/navigation/pillars";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
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

  const { email: sessionEmail, appRole, user, loading: authLoading } = useHavenAuth();
  const currentUserId = user?.id ?? null;
  const roleConfig = useMemo(() => getRoleDashboardConfig(appRole), [appRole]);

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

  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const facilityRefreshRequestRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const [signingOut, setSigningOut] = useState(false);
  const [pillarSheetOpen, setPillarSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activePillar = useMemo(() => findActivePillar(pathname), [pathname]);

  // ── ⌘K global hotkey ─────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (inEditable && !(event.metaKey || event.ctrlKey)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close transient surfaces on route change.
  useEffect(() => {
    setPillarSheetOpen(false);
    setPaletteOpen(false);
  }, [pathname]);

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

      console.warn("[AppShell] refreshFacilities failed", err);
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
    syncSelectedFacilityCookie(currentUserId == null ? null : safeSelectedFacilityId);
  }, [authLoading, currentUserId, safeSelectedFacilityId]);

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
    ? "Loading…"
    : safeSelectedFacilityId === null
      ? "All facilities"
      : (currentFacility?.name ?? "Select facility");

  const isItemActive = useCallback(
    (href: string) => {
      if (href === "/admin") return pathname === "/admin";
      return pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname],
  );

  const handlePillarTabClick = useCallback(
    (pillar: Pillar) => {
      const isActive = activePillar?.id === pillar.id;
      if (isActive) {
        // On mobile, re-tapping the active pillar opens its items in a sheet.
        // On desktop the rail already shows them, so this is a no-op.
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
          setPillarSheetOpen(true);
        }
        return;
      }
      const first = pillar.items[0];
      if (first) router.push(first.href);
    },
    [activePillar, router],
  );

  const handlePaletteSelect = useCallback(
    (href: string) => {
      setPaletteOpen(false);
      router.push(href);
    },
    [router],
  );

  // ── render helpers ───────────────────────────────────────────────

  const renderBrand = () => (
    <Link
      href="/admin"
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-md px-1.5 text-foreground",
        "transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Haven — admin home"
    >
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-foreground text-background"
      >
        <span className="text-[13px] font-semibold leading-none">H</span>
      </span>
      <span className="hidden sm:inline text-[14px] font-semibold tracking-tight">Haven</span>
    </Link>
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
          "hidden md:flex h-9 items-center gap-2 rounded-md border border-border/60 bg-card px-2.5",
          "text-[12px] font-medium text-foreground transition-colors",
          "hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "max-w-[200px]",
        )}
      >
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {facilityControlLoading ? (
          <Skeleton className="h-3 w-24 rounded bg-muted" aria-label="Loading facilities" />
        ) : (
          <span className="truncate text-left">{facilityTriggerLabel}</span>
        )}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
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

  const renderPillarTab = (pillar: Pillar) => {
    const active = activePillar?.id === pillar.id;
    return (
      <button
        key={pillar.id}
        type="button"
        onClick={() => handlePillarTabClick(pillar)}
        aria-current={active ? "page" : undefined}
        className={cn(
          // 36px hit target, generous horizontal padding so the 2px accent
          // underline reads as a strong active signal without crowding.
          "relative flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px]",
          "transition-colors duration-[var(--motion-duration-micro)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="truncate">{pillar.label}</span>
        {active && (
          // 2px accent underline aligned to the tab's text baseline (rule 4:
          // never rely on color alone — paired with aria-current + font-medium).
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
          />
        )}
      </button>
    );
  };

  const renderSearchTrigger = () => (
    <>
      {/* Desktop: pill-style trigger with placeholder + ⌘K kbd hint. */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "hidden md:flex h-9 max-w-[280px] flex-1 items-center gap-2 rounded-md border border-border/60 bg-card",
          "px-2.5 text-[12px] text-muted-foreground transition-colors",
          "hover:border-border hover:bg-secondary hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Open search (⌘K)"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">Search residents, staff, incidents…</span>
        <kbd className="ml-auto rounded border border-border/60 bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      {/* Mobile: icon-only trigger. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open search (⌘K)"
              className={cn(
                "grid size-9 place-items-center rounded-md text-muted-foreground md:hidden",
                "transition-colors hover:bg-secondary hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
          }
        >
          <Search className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">Search (⌘K)</TooltipContent>
      </Tooltip>
    </>
  );

  const renderReportIncidentButton = () => (
    // Self-labeled (visible "Report incident" text on sm+, accessible label on
    // mobile). No Tooltip wrapper: base-ui's useRender cannot disambiguate
    // when both the wrapping <TooltipTrigger> and the render-prop element
    // carry children (see Base UI render-prop contract).
    <Link
      href={REPORT_INCIDENT_HREF}
      className={cn(
        // Semantic danger, but lower-temperature than `variant="destructive"`:
        // a soft tint + ring so it reads as a global action, not an alert.
        "flex h-9 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5",
        "text-[12px] font-medium text-destructive transition-colors",
        "hover:border-destructive/50 hover:bg-destructive/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive",
      )}
      aria-label="Report incident"
    >
      <ShieldAlert className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">Report incident</span>
    </Link>
  );

  const renderNotificationsButton = () => (
    <Tooltip>
      <TooltipTrigger
        aria-label="Notifications"
        className={cn(
          "relative grid size-9 place-items-center rounded-md text-muted-foreground",
          "transition-colors hover:bg-secondary hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Bell className="size-4" aria-hidden />
        <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">Notifications</TooltipContent>
    </Tooltip>
  );

  const renderProfileMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          "grid size-9 place-items-center rounded-md text-muted-foreground outline-none",
          "transition-colors hover:bg-secondary hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <UserCircle2 className="size-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-1">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="truncate text-[12px] font-medium text-foreground">
            {sessionEmail ?? "Signed in"}
          </span>
          <span className="truncate text-[11px] font-normal text-muted-foreground">
            {roleConfig.roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
            onClick={() => router.push("/admin/settings/notifications")}
          >
            <Settings className="size-3.5 text-muted-foreground" /> Account settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setTheme("light")}
            className="flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
          >
            <span className="flex items-center gap-2">
              <Sun className="size-3.5" /> Light
            </span>
            {mounted && theme === "light" && <Check className="size-3.5 text-success" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme("dark")}
            className="flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
          >
            <span className="flex items-center gap-2">
              <Moon className="size-3.5" /> Dark
            </span>
            {mounted && theme === "dark" && <Check className="size-3.5 text-success" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme("system")}
            className="flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
          >
            <span className="flex items-center gap-2">
              <Monitor className="size-3.5" /> System
            </span>
            {mounted && theme === "system" && <Check className="size-3.5 text-success" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          variant="destructive"
          className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          {signingOut ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Signing out…
            </>
          ) : (
            <>
              <LogOut className="size-3.5" />
              Sign out
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderRailItem = (item: PillarItem) => {
    const Icon = item.icon;
    const active = isItemActive(item.href);
    return (
      <Link
        key={item.key}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          // 36px row · 13px horizontal padding · accent left-border when active
          // (per surface-map.md). Decorative color only on active state.
          "group/item relative flex h-9 items-center gap-2 rounded-md px-[13px] text-[13px]",
          "transition-colors duration-[var(--motion-duration-micro)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-secondary text-foreground font-medium before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-r-sm before:bg-accent"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            active ? "text-foreground" : "text-muted-foreground group-hover/item:text-foreground",
          )}
          aria-hidden
        />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  // Filter pillars to the role's allowed set, defaulting to all 6 when the
  // role config doesn't list anything (e.g. owner / facility_admin). Legacy
  // role configs use group names ("Clinical Ops") — map them to pillar ids.
  const visiblePillars = useMemo(() => {
    const roleGroups = roleConfig.visibleGroups;
    if (!roleGroups || roleGroups.length === 0) return PILLARS;
    const allowed = new Set<string>();
    for (const g of roleGroups) {
      if (g === "Clinical Ops") allowed.add("clinical");
      else if (g === "Quality & Risk") allowed.add("quality");
      else if (g === "Finance") continue; // dropped from primary nav
      else allowed.add(g.toLowerCase());
    }
    const filtered = PILLARS.filter((p) => allowed.has(p.id));
    return filtered.length > 0 ? filtered : PILLARS;
  }, [roleConfig.visibleGroups]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground antialiased">
      {/* ── Top bar (always visible) ────────────────────────────── */}
      <header
        className={cn(
          "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background",
          "px-3 lg:px-4",
        )}
      >
        {renderBrand()}
        {renderFacilityScope()}

        {/* Pillar tabs — desktop. Mobile uses the scroll strip below. */}
        <nav
          aria-label="Primary"
          className="hidden lg:flex h-full items-center gap-0.5 ml-2"
        >
          {visiblePillars.map(renderPillarTab)}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {renderSearchTrigger()}
          {renderReportIncidentButton()}
          <PilotFeedbackLauncher shellKind="admin" facilityId={safeSelectedFacilityId} compact />
          {renderNotificationsButton()}
          {renderProfileMenu()}
        </div>
      </header>

      {/* ── Mobile pillar scroll strip ──────────────────────────── */}
      <div
        className={cn(
          "lg:hidden sticky top-14 z-20 flex shrink-0 items-stretch gap-0.5 overflow-x-auto",
          "border-b border-border/60 bg-card px-2",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-label="Primary"
        role="tablist"
      >
        {visiblePillars.map((pillar) => {
          const active = activePillar?.id === pillar.id;
          const Icon = pillar.icon;
          return (
            <button
              key={pillar.id}
              type="button"
              role="tab"
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              onClick={() => handlePillarTabClick(pillar)}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-[12px]",
                "transition-colors duration-[var(--motion-duration-micro)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="whitespace-nowrap">{pillar.label}</span>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Survey Visit Mode banner — page-level chrome, never nav. */}
      <SurveyVisitModeBar />

      {/* ── Layout row: contextual rail + main ─────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {activePillar && (
          <aside
            className="hidden lg:flex w-[224px] shrink-0 flex-col border-r border-border/60 bg-card"
            aria-label={`${activePillar.label} navigation`}
          >
            <div className="px-[13px] py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {activePillar.label}
              </p>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 pb-3 [scrollbar-gutter:stable]">
              <div className="flex flex-col gap-px">
                {activePillar.items.map(renderRailItem)}
              </div>
            </nav>
          </aside>
        )}

        <main className="flex-1 overflow-y-auto">
          {/* Full-bleed: pages that need a narrow column for long-form
              content (settings forms, etc.) apply max-w on an inner block,
              not on this wrapper. */}
          <div className="w-full px-5 py-5 lg:px-6 lg:py-6 2xl:px-8 2xl:py-8">{children}</div>
        </main>
      </div>

      {/* ── Mobile contextual rail (bottom sheet) ───────────────── */}
      <Sheet open={pillarSheetOpen} onOpenChange={setPillarSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[14px] border-t border-border bg-card p-0 max-h-[80dvh]"
          showCloseButton
        >
          <SheetHeader className="px-4 pb-2 pt-4 text-left">
            <SheetTitle className="text-[14px] font-semibold tracking-tight">
              {activePillar?.label ?? "Navigation"}
            </SheetTitle>
          </SheetHeader>
          <nav
            aria-label={`${activePillar?.label ?? "Pillar"} items`}
            className="flex flex-col gap-px px-2 pb-4"
          >
            {activePillar?.items.map(renderRailItem)}
          </nav>
        </SheetContent>
      </Sheet>

      {/* ── ⌘K command palette ──────────────────────────────────── */}
      <AppShellCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSelect={handlePaletteSelect}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Command palette — indexes every pillar item + auxiliary route.
// Dynamic search for residents / staff / incident numbers can layer
// on later via a debounced Supabase query; for now the palette covers
// 100% of static routes which is the most common power-user need.
// ────────────────────────────────────────────────────────────────

function AppShellCommandPalette({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (href: string) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to any page, resident, staff member, or incident."
      className="sm:max-w-[560px]"
    >
      <Command shouldFilter loop>
        <CommandInput placeholder="Search residents, staff, incidents, routes…" autoFocus />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {PILLARS.map((pillar) => (
            <CommandGroup key={pillar.id} heading={pillar.label}>
              {pillar.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={`${pillar.id}-${item.key}`}
                    value={`${pillar.label} ${item.label} ${item.href}`}
                    onSelect={() => onSelect(item.href)}
                  >
                    <Icon className="text-muted-foreground" aria-hidden />
                    <span>{item.label}</span>
                    <CommandShortcut>{pillar.label}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="Finance & Settings">
            {AUXILIARY_ROUTES.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={`aux-${item.key}`}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => onSelect(item.href)}
                >
                  <Icon className="text-muted-foreground" aria-hidden />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
