"use client";

/**
 * AppShell — Mercury-pattern two-level admin navigation primitive.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Workspace strip (canvas-aligned): pillars · ⌘K · tools        │
 *   ├──────────┬───────────────────────────────────────────────────┤
 *   │ Sidebar  │                                                   │
 *   │ chrome   │   scrollable workspace — canvas (--background)     │
 *   │ (dark)   │                                                   │
 *   └──────────┴───────────────────────────────────────────────────┘
 *
 * Contextual sidebar lists only routes for the active pillar (≤9 items).
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
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  LineChart,
  Loader2,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  UserCircle2,
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
import { HavenShellBrandLink } from "@/components/layout/HavenShellBrandLink";
import { SurveyVisitShellToggle } from "@/components/compliance/SurveyVisitShellToggle";
import { SurveyVisitWorkspaceDock } from "@/components/compliance/SurveyVisitWorkspaceChrome";
import { PilotFeedbackLauncher } from "@/components/feedback/PilotFeedbackLauncher";
import { LazyOverlayShells } from "@/components/layout/LazyOverlayShells";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  PILLARS,
  REPORT_INCIDENT_HREF,
  findActivePillar,
  type Pillar,
  type PillarItem,
} from "@/lib/navigation/pillars";
import { shouldSuppressSurveyVisitChrome } from "@/lib/navigation/survey-visit-chrome-scope";
import { cn } from "@/lib/utils";

/** Controls on `--background` top strips (Mercury: canvas workspace rail, distinct from dark sidebar chrome). */
const WORKSPACE_WELL =
  "border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground";
const WORKSPACE_KBD =
  "rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground";
const WORKSPACE_ICON_LG =
  "grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const WORKSPACE_ICON_SM =
  "inline-flex size-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const AppShellCommandPalette = dynamic(
  () =>
    import("@/components/layout/AppShellCommandPalette").then((m) => ({
      default: m.AppShellCommandPalette,
    })),
  { ssr: false, loading: () => null },
);

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

  const surveyVisit = useSurveyVisitSession(safeSelectedFacilityId);

  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesLoadFailed, setFacilitiesLoadFailed] = useState(false);
  const facilityRefreshRequestRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const [signingOut, setSigningOut] = useState(false);
  const [pillarSheetOpen, setPillarSheetOpen] = useState(false);
  const [sheetPillarId, setSheetPillarId] = useState<Pillar["id"] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activePillar = useMemo(() => findActivePillar(pathname), [pathname]);
  const suppressSurveyVisitChrome = useMemo(() => shouldSuppressSurveyVisitChrome(pathname), [pathname]);

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

  const openPillarSheetIfMobile = useCallback((pillarId: Pillar["id"]) => {
    // On mobile, tapping any pillar opens its sub-routes in a sheet instead
    // of jumping straight to the first item. Desktop keeps default navigation
    // — the dropdown handles sub-route discovery there.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setSheetPillarId(pillarId);
      setPillarSheetOpen(true);
      return true;
    }
    return false;
  }, []);

  const handlePaletteSelect = useCallback(
    (href: string) => {
      setPaletteOpen(false);
      router.push(href);
    },
    [router],
  );

  // ── render helpers ───────────────────────────────────────────────

  const renderBrand = () => (
    <HavenShellBrandLink
      href="/admin"
      aria-label="Haven — admin home"
      className={cn(
        "flex h-9 shrink-0 rounded-md px-1.5 pr-4",
        "text-foreground transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    />
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
        title={facilityControlLoading ? undefined : facilityTriggerLabel}
        className={cn(
          WORKSPACE_WELL,
          "hidden md:flex min-h-9 max-w-[220px] items-center gap-2 rounded-md px-2.5 py-1",
          "text-[12px] font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Building2 className="size-3.5 shrink-0 opacity-90" aria-hidden />
        {facilityControlLoading ? (
          <Skeleton className="h-3 w-24 rounded bg-muted" aria-label="Loading facilities" />
        ) : (
          <span className="min-w-0 flex-1 truncate text-left leading-tight">{facilityTriggerLabel}</span>
        )}
        <ChevronDown className="size-3 shrink-0 opacity-90" aria-hidden />
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
            // min-h-8 so multi-line names breathe; no ellipsis.
            className="flex min-h-8 cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-1.5 text-[13px]"
          >
            <span className="pr-1 leading-tight break-words">{facility.name}</span>
            {safeSelectedFacilityId === facility.id && (
              <Check className="size-3.5 shrink-0 text-success mt-0.5" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderAllSectionsMenu = (pillarsForMenu: Pillar[]) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open all sections menu"
        className={cn(
          WORKSPACE_ICON_LG,
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <MenuIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[min(22rem,calc(100vw-1rem))] sm:w-72"
      >
        {pillarsForMenu.map((pillar, pillarIdx) => (
          <React.Fragment key={pillar.id}>
            {pillarIdx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {React.createElement(pillar.icon, { className: "size-3.5", "aria-hidden": true })}
              {pillar.label}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {pillar.items.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={item.key}
                    onClick={() => router.push(item.href)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
                  >
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderPillarTab = (pillar: Pillar) => {
    const first = pillar.items[0];
    if (!first) return null;
    return (
      <PillarTabWithDropdown
        key={pillar.id}
        pillar={pillar}
        active={activePillar?.id === pillar.id}
        firstHref={first.href}
        isItemActive={isItemActive}
        onActivePillarTap={openPillarSheetIfMobile}
      />
    );
  };

  const renderSearchTrigger = () => (
    <>
      {/* Desktop: pill-style trigger with placeholder + ⌘K kbd hint. */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          WORKSPACE_WELL,
          "hidden md:flex h-9 max-w-[280px] flex-1 items-center gap-2 rounded-md",
          "px-2.5 text-[12px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Open search (⌘K)"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">Search residents, staff…</span>
        <kbd className={cn(WORKSPACE_KBD, "ml-auto")}>
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
                WORKSPACE_ICON_LG,
                "md:hidden",
                "transition-colors",
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

  const renderGraceTrigger = () => (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("grace:open"))}
      className={cn(
        WORKSPACE_ICON_SM,
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Ask Grace"
      title="Ask Grace (⌘G)"
    >
      <MessageSquare className="size-4" aria-hidden />
    </button>
  );

  const renderHavenInsightTrigger = () => (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("haven-insight:open"))}
      className={cn(
        WORKSPACE_ICON_SM,
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Open Haven Insight"
      title="Haven Insight (⌘⇧I)"
    >
      <LineChart className="size-4" aria-hidden />
    </button>
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
          WORKSPACE_ICON_LG,
          "relative",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Bell className="size-4" aria-hidden />
        <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">Notifications</TooltipContent>
    </Tooltip>
  );

  // Icon-only theme toggle. Shows the icon of the theme you'll switch INTO
  // (Mercury convention) — so on light you see a moon, and tapping it goes
  // dark. Active theme is reflected in the aria-label so screen readers know
  // the current state. Persistence + cross-tab sync is handled by next-themes
  // (localStorage key `theme`).
  const renderThemeToggle = () => {
    // Avoid SSR / first-paint mismatch — render an empty placeholder until
    // next-themes has resolved the stored preference.
    if (!mounted) {
      return <span aria-hidden className="size-9" />;
    }
    const isDark = theme === "dark";
    const nextTheme = isDark ? "light" : "dark";
    const Icon = isDark ? Sun : Moon;
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label={`Toggle theme (currently ${isDark ? "dark" : "light"})`}
          onClick={() => setTheme(nextTheme)}
          className={cn(
            WORKSPACE_ICON_LG,
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">Switch to {nextTheme} mode</TooltipContent>
      </Tooltip>
    );
  };

  const renderProfileMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          WORKSPACE_ICON_LG,
          "outline-none",
          "transition-colors",
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
            ? "haven-chrome-rail-active"
            : "haven-chrome-rail-quiet",
        )}
      >
        <Icon
          className="size-4 shrink-0 opacity-95"
          aria-hidden
        />
        {/* No truncate — rail is 224px wide and every label is intentionally
            short. If a label ever overflows, rename the route, don't ellipsize. */}
        <span className="leading-tight">{item.label}</span>
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
      {/* ── Top bar (always visible) — popping grey so the chrome reads
          distinctly above the canvas. */}
      <header
        className={cn(
          "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2",
          "bg-stone-300 text-foreground border-b border-stone-400 shadow-md",
          "dark:bg-stone-900 dark:border-stone-700",
          "px-3 lg:px-4",
        )}
      >
        {renderBrand()}
        {renderFacilityScope()}
        {renderAllSectionsMenu(visiblePillars)}

        {/* Pillar tabs — desktop. Mobile uses the scroll strip below. */}
        <nav
          aria-label="Primary"
          className="hidden lg:flex h-full items-center gap-0.5 ml-2"
        >
          {visiblePillars.map(renderPillarTab)}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {renderSearchTrigger()}
          {renderGraceTrigger()}
          {renderHavenInsightTrigger()}
          {renderReportIncidentButton()}
          <PilotFeedbackLauncher shellKind="admin" facilityId={safeSelectedFacilityId} compact />
          {suppressSurveyVisitChrome ? null : <SurveyVisitShellToggle survey={surveyVisit} />}
          {renderNotificationsButton()}
          {renderThemeToggle()}
          {renderProfileMenu()}
        </div>
      </header>

      {suppressSurveyVisitChrome ? null : <SurveyVisitWorkspaceDock survey={surveyVisit} />}

      {/* ── Mobile pillar scroll strip ──────────────────────────── */}
      <nav
        className={cn(
          "lg:hidden sticky top-14 z-20 flex shrink-0 items-stretch gap-0.5 overflow-x-auto",
          "bg-background text-foreground border-b border-border px-2",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-label="Primary"
      >
        {visiblePillars.map((pillar) => {
          const active = activePillar?.id === pillar.id;
          const Icon = pillar.icon;
          const first = pillar.items[0];
          if (!first) return null;
          return (
            <Link
              key={pillar.id}
              href={first.href}
              aria-current={active ? "page" : undefined}
              aria-haspopup="menu"
              onClick={(event) => {
                if (openPillarSheetIfMobile(pillar.id)) {
                  event.preventDefault();
                }
              }}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-[12px]",
                "transition-colors duration-[var(--motion-duration-micro)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="whitespace-nowrap">{pillar.label}</span>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Layout row: contextual rail + main ─────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden border-t border-border">
        {activePillar && (
          <aside
            className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-border haven-chrome-sidebar"
            aria-label={`${activePillar.label} navigation`}
          >
            {/* No section header — the active pillar tab in the top bar is
                the heading. Repeating it here duplicates state and burns
                ~32px of vertical real estate on every page. */}
            <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-3 [scrollbar-gutter:stable]">
              <div className="flex flex-col gap-px">
                {activePillar.items.map(renderRailItem)}
              </div>
            </nav>
          </aside>
        )}

        <main className={cn("flex-1 overflow-y-auto bg-background text-foreground", activePillar && "border-l border-border")}>
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
          className="rounded-t-[14px] border-t border-border haven-chrome-sidebar p-0 max-h-[80dvh]"
          showCloseButton
        >
          {(() => {
            const sheetPillar =
              visiblePillars.find((p) => p.id === sheetPillarId) ?? activePillar;
            return (
              <>
                <SheetHeader className="px-4 pb-2 pt-4 text-left">
                  <SheetTitle className="text-[14px] font-semibold tracking-tight">
                    {sheetPillar?.label ?? "Navigation"}
                  </SheetTitle>
                </SheetHeader>
                <nav
                  aria-label={`${sheetPillar?.label ?? "Pillar"} items`}
                  className="flex flex-col gap-px px-2 pb-4"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a")) {
                      setPillarSheetOpen(false);
                    }
                  }}
                >
                  {sheetPillar?.items.map(renderRailItem)}
                </nav>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── ⌘K command palette ──────────────────────────────────── */}
      {paletteOpen ? (
        <AppShellCommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onSelect={handlePaletteSelect}
        />
      ) : null}
      <LazyOverlayShells />
    </div>
  );
}

/**
 * Pillar tab with its sub-route dropdown.
 *
 * Stateful so it works on touch as well as mouse:
 *  - mouseenter / mouseleave: open/close (desktop hover)
 *  - focus / blur (within the wrapper): open while focused (keyboard)
 *  - touch tap on the trigger: open the menu instead of navigating
 *  - click outside / Escape: close
 *
 * Previously the dropdown was pure CSS `group-hover` and `hidden lg:block`,
 * which meant tablets in landscape with touch input — and any user who
 * tapped a tab — saw nothing.
 */
function PillarTabWithDropdown({
  pillar,
  active,
  firstHref,
  isItemActive,
  onActivePillarTap,
}: {
  pillar: Pillar;
  active: boolean;
  firstHref: string;
  isItemActive: (href: string) => boolean;
  onActivePillarTap: (pillarId: Pillar["id"]) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / tap and Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = wrapperRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        // Only close if focus is leaving the whole wrapper.
        if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <Link
        href={firstHref}
        aria-current={active ? "page" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => {
          // Touch / pen users tap the tab to reveal the dropdown instead of
          // navigating immediately. Mouse users keep the original behavior:
          // hover reveals the menu, click navigates.
          if (event.pointerType === "touch" || event.pointerType === "pen") {
            if (!open) {
              event.preventDefault();
              setOpen(true);
            }
          }
        }}
        onClick={(event) => {
          if (!active) return;
          if (onActivePillarTap(pillar.id)) {
            event.preventDefault();
          }
        }}
        className={cn(
          "relative flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px]",
          "transition-colors duration-[var(--motion-duration-micro)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="whitespace-nowrap">{pillar.label}</span>
        {active && (
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
          />
        )}
      </Link>
      <div
        role="menu"
        aria-label={`${pillar.label} sections`}
        className={cn(
          "absolute left-0 top-full z-40 min-w-[208px] pt-2",
          "transition-opacity duration-100",
          open ? "visible opacity-100" : "invisible opacity-0 pointer-events-none",
        )}
      >
        <div className="rounded-md border border-border bg-popover p-1.5 shadow-lg ring-1 ring-foreground/10">
          {pillar.items.map((item) => {
            const Icon = item.icon;
            const itemActive = isItemActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                aria-current={itemActive ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded px-2 text-[13px] outline-none",
                  "transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  itemActive
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
