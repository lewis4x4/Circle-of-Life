"use client";

import { loadExecutiveOverview } from "@/lib/executive/load-executive-overview";
import type { ResidentDayWindow } from "@/lib/executive/resident-days";
import { startupMark } from "@/lib/observability/startup-performance";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import { AdminLiveDataFallbackNotice } from "@/components/common/AdminLiveDataFallbackNotice";
import { CensusNoticesPanel } from "@/components/executive/CensusNoticesPanel";
import { CollectionEscalationsPanel } from "@/components/executive/CollectionEscalationsPanel";
import { EscalatedFromFacilitiesPanel } from "@/components/executive/EscalatedFromFacilitiesPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ResidentAssuranceFacilityTrendRow,
  type ResidentAssuranceFacilityRollup,
} from "@/lib/resident-assurance/command-center-brief";
import {
  ROUNDING_EXPECTATION_NOT_RECORDED_COPY,
  roundingBandLabel,
  roundingCountsMeaningLine,
  roundingLastObservedLine,
  roundingTrendCoverageLine,
} from "@/lib/resident-assurance/assurance-coverage-copy";
import {
  type PresenceCensus,
} from "@/lib/executive/presence-census";
import {
  formatExecutiveOccPtPctWithSuffix,
  formatExecutiveRelativeAge,
} from "@/lib/executive/executive-display-copy";
import {
  occupancyCalculationLine,
  occupancyContextOccPtFraction,
  occupancyCoverageHeading,
  executiveKpiEmptyCopy,
  occupancyLoadedFootnote,
  type ExecutiveKpiMetricKey,
  type OccupancyContext,
} from "@/lib/executive/kpi-tile-copy";
import {
  buildExecutiveCoverage,
  coverageFollowUps,
  coverageGapLine,
  coverageHeadline,
  coverageSummaryLine,
  noAlertsCopy,
  type CoverageRow,
} from "@/lib/executive/evidence-coverage";
import {
  OCCUPANCY_CHANGE_UNAVAILABLE_COPY,
  metricChangeLine,
  type MetricChange,
} from "@/lib/executive/metric-change";
import {
  BILLED_REVENUE_SCOPE_LINE,
  billedRevenuePeriodLine,
  facilityTodayIsoDate,
  incidentRateBasis,
  metricFreshness,
  metricRecordedLine,
  snapshotFreshnessLine,
  type ExecutiveSnapshotState,
} from "@/lib/executive/snapshot-evidence";
import { presenceLabel, presenceTone, type ResidencyStatus } from "@/lib/residents/presence";
import type { StatusPillTone } from "@/components/ui/status-pill";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

/** Named loading copy while auth hydrates or the first client fetch is in flight. */
export const EXECUTIVE_OVERVIEW_LOADING_MESSAGE = "Loading portfolio overview…";

/** This page is always the whole portfolio; the top-bar facility choice does not narrow it. */
export const EXECUTIVE_SCOPE_NOTE =
  "Every figure on this page covers the whole portfolio. The facility chosen in the top bar does not narrow it.";

/**
 * Data the product does not record yet. Named here so the gap is visible work
 * rather than something the page quietly papers over.
 */
const NOT_RECORDED_FOLLOW_UPS = [
  ROUNDING_EXPECTATION_NOT_RECORDED_COPY,
  "Alerts record an owner account but not a person's name, so this page names the facility and age instead of an owner.",
] as const;

type ExecutiveOverviewPageClientProps = {
  initialMetrics: Record<string, number>;
  initialAlerts: AlertWithFacility[];
  initialFacilities: ExecutiveOverviewFacility[];
  initialAssuranceHeatMap: ResidentAssuranceFacilityRollup[];
  initialAssuranceTrends: ResidentAssuranceFacilityTrendRow[];
  initialPresenceCensus: PresenceCensus;
  initialOccupancyContext: OccupancyContext | null;
  initialSnapshot: ExecutiveSnapshotState;
  initialResidentDayWindow: ResidentDayWindow | null;
  initialMetricChanges: Record<string, MetricChange>;
  initialMetricDates: Record<string, string>;
  initialHasServerData: boolean;
};

export function ExecutiveOverviewPageClient({
  initialMetrics,
  initialAlerts,
  initialFacilities,
  initialAssuranceHeatMap,
  initialAssuranceTrends,
  initialPresenceCensus,
  initialOccupancyContext,
  initialSnapshot,
  initialResidentDayWindow,
  initialMetricChanges,
  initialMetricDates,
  initialHasServerData,
}: ExecutiveOverviewPageClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const [loading, setLoading] = useState(!initialHasServerData);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Core metrics
  const [metrics, setMetrics] = useState<Record<string, number>>(initialMetrics);

  // Watchlist alerts
  const [alerts, setAlerts] = useState<AlertWithFacility[]>(initialAlerts);

  // Portfolio Facilities
  const [facilities, setFacilities] = useState<ExecutiveOverviewFacility[]>(initialFacilities);
  const [assuranceHeatMap, setAssuranceHeatMap] = useState<ResidentAssuranceFacilityRollup[]>(initialAssuranceHeatMap);
  const [assuranceTrends, setAssuranceTrends] = useState<ResidentAssuranceFacilityTrendRow[]>(initialAssuranceTrends);

  // Live resident-presence census (in-house vs on-hold) — additive to occupancy.
  const [presenceCensus, setPresenceCensus] = useState<PresenceCensus>(initialPresenceCensus);
  const [occupancyContext, setOccupancyContext] = useState<OccupancyContext | null>(initialOccupancyContext);

  // When the displayed figures were recorded, and the change since the run before.
  const [snapshot, setSnapshot] = useState<ExecutiveSnapshotState>(initialSnapshot);
  // How much of the incident-rate window was counted rather than projected.
  const [residentDayWindow, setResidentDayWindow] = useState<ResidentDayWindow | null>(
    initialResidentDayWindow,
  );
  const [metricChanges, setMetricChanges] = useState<Record<string, MetricChange>>(initialMetricChanges);
  // Each displayed figure carries the day it was recorded, which a run that
  // skipped that metric does not.
  const [metricDates, setMetricDates] = useState<Record<string, string>>(initialMetricDates);

  // Skip the first client-side fetch when the server already supplied scoped
  // live data. If the server returned empty arrays, the client retries once;
  // it must still render blanks rather than demo fallback values.
  // COL-674: the three hand-off panels mount only after the overview has
  // loaded, so their reads used to start one full round trip after everything
  // else. They now start alongside the overview and each panel consumes its own
  // promise when it mounts. What each panel reads and renders is unchanged.
  const panelReadsRef = useRef<Map<ExecutivePanelRpc, Promise<unknown>> | null>(null);
  useEffect(() => {
    if (authLoading || !organizationId || panelReadsRef.current) return;
    panelReadsRef.current = new Map(
      EXECUTIVE_PANEL_RPCS.map((name) => [name, startExecutivePanelRead(supabase, name)] as const),
    );
  }, [authLoading, organizationId, supabase]);
  const panelLoads = useMemo<ExecutivePanelLoads>(() => {
    // Each prefetched read is handed over once; a later remount reads fresh.
    const take = (name: ExecutivePanelRpc) => () => {
      const started = panelReadsRef.current?.get(name);
      panelReadsRef.current?.delete(name);
      return started ?? startExecutivePanelRead(supabase, name);
    };
    return {
      escalations: take("home_escalations_for_executive"),
      censusNotices: take("home_census_notices_for_executive"),
      collectionEscalations: take("home_collection_escalations_for_executive"),
    };
  }, [supabase]);

  const skipNextLoadRef = useRef(initialHasServerData);
  const requestGeneration = useRef(0);
  useEffect(() => { startupMark("executive-mounted"); }, []);

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    if (!organizationId) {
      setFetchError(null);
      setLoading(false);
      return;
    }

    const generation = ++requestGeneration.current;
    startupMark("executive-fetch-start");
    setLoading(true);
    setFetchError(null);
    try {
      const data = await loadExecutiveOverview(supabase, organizationId, { strict: true });
      if (generation !== requestGeneration.current) return;
      setMetrics(data.metrics);
      setAlerts(data.alerts);
      setFacilities(data.facilities);
      setPresenceCensus(data.presenceCensus);
      setOccupancyContext(data.occupancyContext);
      setAssuranceHeatMap(data.assuranceHeatMap);
      setAssuranceTrends(data.assuranceTrends);
      setSnapshot(data.snapshot);
      setResidentDayWindow(data.residentDayWindow);
      setMetricChanges(data.metricChanges);
      setMetricDates(data.metricDates);

    } catch (e) {
      if (generation !== requestGeneration.current) return;
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" &&
              e !== null &&
              "message" in e &&
              typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : "Failed to load executive overview.";
      setFetchError(message);
    } finally {
      if (generation === requestGeneration.current) {
        startupMark("executive-fetch-end");
        setLoading(false);
      }
    }
  }, [authLoading, organizationId, supabase]);

  useEffect(() => {
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load]);

  /**
   * "Empty install" detection — an organization is connected and has facilities,
   * but no operational data has flowed yet. We replace the dashboard body with
   * a single onboarding card to avoid presenting a wall of unnamed KPI gaps, "0 OPEN"
   * priority cards, and rounding rows that read as broken UI.
   *
   * The trigger is intentionally strict: any one of metrics / alerts / per-
   * facility metrics being non-empty means we have *something* worth showing,
   * so we render the full dashboard instead.
   */
  const orgHasMetrics = Object.values(metrics).some(hasMetric);
  const orgHasAlerts = alerts.length > 0;
  const orgHasFacilityMetrics = facilities.some(
    (f) => f.metrics && Object.values(f.metrics).some(hasMetric),
  );
  const orgHasAssurance = assuranceHeatMap.some((r) => r.observed);
  const isOrgEmpty =
    !orgHasMetrics && !orgHasAlerts && !orgHasFacilityMetrics && !orgHasAssurance;

  const hasOrgScopedData =
    orgHasMetrics || orgHasAlerts || orgHasFacilityMetrics || orgHasAssurance || facilities.length > 0;

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const showOverviewLoading =
    (authLoading || loading) && !hasOrgScopedData && !organizationGapMessage;

  const coverage = buildExecutiveCoverage({
    facilityCount: facilities.length,
    occupancy: occupancyContext,
    metrics,
    snapshot,
    residentDays: residentDayWindow,
    metricDates,
    todayIsoDate: facilityTodayIsoDate(),
    observedFacilityCount: assuranceHeatMap.filter((row) => row.observed).length,
    surveyFacilityCount: facilities.filter((facility) => hasMetric(facility.metrics?.survey_rd))
      .length,
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            Executive intelligence
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-muted-foreground">
            <PortfolioScopePill facilityCount={facilities.length} />
            <span aria-hidden>·</span>
            <span className="leading-relaxed">{snapshotFreshnessLine(snapshot)}</span>
          </div>
        </div>
        <ExecutiveHubNav />
      </div>

      {organizationGapMessage ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 p-4 text-sm text-muted-foreground">
          {organizationGapMessage}
        </div>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => void load()} />
      ) : null}

      {showOverviewLoading ? (
        <ExecutiveOverviewLoadingBody />
      ) : organizationGapMessage || fetchErrorBannerMessage ? null : isOrgEmpty ? (
        <ExecutiveEmptyOnboarding facilityCount={facilities.length} onRefreshComplete={load} />
      ) : (
        <ExecutiveDashboardBody
          metrics={metrics}
          alerts={alerts}
          facilities={facilities}
          assuranceHeatMap={assuranceHeatMap}
          assuranceTrends={assuranceTrends}
          presenceCensus={presenceCensus}
          occupancyContext={occupancyContext}
          snapshot={snapshot}
          residentDayWindow={residentDayWindow}
          metricChanges={metricChanges}
          metricDates={metricDates}
          coverage={coverage}
          panelLoads={panelLoads}
        />
      )}
    </div>
  );
}

/**
 * The scope this page reads, shown as a control-shaped chip so it reads as the
 * page's own filter rather than as prose. The top-bar facility chooser is a
 * different control and does not apply here; the chip says so in three words
 * and carries the full sentence for assistive technology.
 */
function PortfolioScopePill({ facilityCount }: { facilityCount: number }) {
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const availableFacilities = useFacilityStore((state) => state.availableFacilities);
  // The persisted list is the only place a selection can be named; a missing or
  // malformed one costs the name, never the scope statement itself.
  const selectedName =
    selectedFacilityId == null || !Array.isArray(availableFacilities)
      ? null
      : availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null;

  const note = selectedName
    ? `${selectedName} is selected in the top bar and does not narrow it.`
    : EXECUTIVE_SCOPE_NOTE;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2 pr-2.5 text-[12px] font-medium text-foreground"
      title={note}
    >
      <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      All facilities{facilityCount > 0 ? ` · ${facilityCount} in scope` : ""}
      {selectedName ? (
        <span className="font-normal text-muted-foreground">· top-bar facility not applied</span>
      ) : null}
      <span className="sr-only"> — {note}</span>
    </span>
  );
}

// View helpers shared by the header, tiles and tables.
function hasMetric(val: number | null | undefined): val is number {
  return typeof val === "number" && Number.isFinite(val);
}
function formatPct(val?: number | null) {
  return hasMetric(val) ? `${(val * 100).toFixed(1)}%` : null;
}
function formatNum(val?: number | null) {
  return hasMetric(val) ? Math.round(val).toLocaleString() : null;
}
function formatCur(val?: number | null) {
  return hasMetric(val) ? `$${(val / 100).toLocaleString()}` : null;
}

type ExecutiveRefreshFunctionStatus = {
  name: string;
  ok: boolean;
  status: number;
};

type ExecutiveRefreshState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | {
      kind: "error";
      message: string;
      snapshot?: ExecutiveRefreshFunctionStatus;
      scorer?: ExecutiveRefreshFunctionStatus;
      risk?: ExecutiveRefreshFunctionStatus;
      missing?: string[];
    };

/** Skeleton body while auth hydrates or the first scoped fetch is in flight. */
function ExecutiveOverviewLoadingBody() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <p className="text-[13px] text-muted-foreground">{EXECUTIVE_OVERVIEW_LOADING_MESSAGE}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Skeleton className="h-24 rounded-lg bg-muted" />
        <Skeleton className="h-24 rounded-lg bg-muted" />
        <Skeleton className="h-24 rounded-lg bg-muted" />
        <Skeleton className="h-24 rounded-lg bg-muted" />
        <Skeleton className="col-span-2 h-24 rounded-lg bg-muted md:col-span-1" />
      </div>
      <Skeleton className="h-28 rounded-lg bg-muted" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-32 rounded-lg bg-muted" />
        <Skeleton className="h-32 rounded-lg bg-muted" />
        <Skeleton className="h-32 rounded-lg bg-muted" />
        <Skeleton className="h-32 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

function ExecutiveEmptyOnboarding({
  facilityCount,
  onRefreshComplete,
}: {
  facilityCount: number;
  onRefreshComplete: () => Promise<void>;
}) {
  const router = useRouter();
  const [refreshState, setRefreshState] = useState<ExecutiveRefreshState>({ kind: "idle" });
  const isRefreshing = refreshState.kind === "loading";

  const configurationLinks = [
    {
      title: "Executive snapshot settings",
      body: "Adjust snapshot preferences for scheduled runs. Use the refresh button above to generate data now.",
      href: "/admin/executive/settings",
      cta: "Open settings",
    },
    {
      title: "Facility metric thresholds",
      body: "Set per-facility color thresholds for metrics produced by snapshots and rollups.",
      href: "/admin/settings/thresholds",
      cta: "Open thresholds",
    },
  ] as const;

  const operationalShortcutLinks = [
    {
      title: "Open Smart Rounding hub",
      body: "Review live rounding coverage, assurance signals, and follow-up work. This is an operational dashboard, not a setup step.",
      href: "/admin/rounding",
      cta: "Open hub",
    },
    {
      title: "Open alert triage queue",
      body: "Work active executive alerts and exceptions after refresh jobs create them. Alert thresholds are configured elsewhere.",
      href: "/admin/executive/alerts",
      cta: "Open triage",
    },
  ] as const;

  const getStatusHint = (status: number) => {
    switch (status) {
      case 0:
        return "Function is not deployed to Supabase.";
      case 401:
        return "Secret mismatch between Netlify and Supabase Edge Function.";
      case 404:
        return "Organization not found in the database.";
      case 500:
        return "Function threw an error — check the Edge Function logs in Supabase Dashboard.";
      case 502:
        return "Upstream Edge Function did not return a 2xx response — see other status row.";
      case 503:
        return "Required environment variable missing on Supabase Edge side.";
      case 504:
        return "Netlify gateway timeout — the Edge Function took longer than the serverless function limit. Try parallelization or background invocation.";
      default:
        return null;
    }
  };

  const refreshExecutiveDashboard = useCallback(async () => {
    setRefreshState({ kind: "loading" });

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;

    const isFunctionStatus = (value: unknown): value is ExecutiveRefreshFunctionStatus => {
      if (!isRecord(value)) return false;
      return (
        typeof value.name === "string" &&
        typeof value.ok === "boolean" &&
        typeof value.status === "number"
      );
    };

    const isStringArray = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === "string");

    try {
      const response = await fetch("/api/admin/executive/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const rawPayload: unknown = await response.json().catch(() => null);
      const payload = isRecord(rawPayload) ? rawPayload : null;
      const payloadOk = payload?.ok === true;
      const payloadError = typeof payload?.error === "string" ? payload.error : null;
      const snapshot = isFunctionStatus(payload?.snapshot) ? payload.snapshot : undefined;
      const scorer = isFunctionStatus(payload?.scorer) ? payload.scorer : undefined;
      const risk = isFunctionStatus(payload?.risk) ? payload.risk : undefined;
      const missing = isStringArray(payload?.missing) ? payload.missing : undefined;

      if (!response.ok || !payloadOk) {
        if (response.status === 504 && !payload) {
          setRefreshState({
            kind: "error",
            message: "Netlify gateway timeout (504) — the refresh took longer than the serverless function limit.",
          });
          return;
        }

        setRefreshState({
          kind: "error",
          message: payloadError || "Executive refresh failed.",
          snapshot,
          scorer,
          risk,
          missing,
        });
        return;
      }

      setRefreshState({
        kind: "success",
        message: "Refresh complete. Reloading the executive dashboard with the latest snapshot data.",
      });
      router.refresh();
      await onRefreshComplete();
    } catch (error) {
      setRefreshState({
        kind: "error",
        message: error instanceof Error ? error.message : "Executive refresh failed.",
        snapshot: {
          name: "exec-kpi-snapshot",
          ok: false,
          status: 0,
        },
        scorer: {
          name: "resident-safety-scorer",
          ok: false,
          status: 0,
        },
        risk: {
          name: "risk-nightly-scorer",
          ok: false,
          status: 0,
        },
      });
    }
  }, [onRefreshComplete, router]);

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
          {facilityCount > 0
            ? "Snapshot pending — run the executive refresh"
            : "We couldn't load facilities for your organization"}
        </h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {facilityCount > 0
            ? `${facilityCount} ${facilityCount === 1 ? "facility is" : "facilities are"} in scope. The executive KPI snapshot hasn't been computed yet — click below to generate the latest KPIs and resident safety scores from your live operational data.`
            : "Underlying data may exist, but the dashboard couldn't read it. Confirm you're signed in with an account that has owner or org-admin access to this organization, then refresh this page. If the issue persists, the executive snapshot may need to be triggered server-side."}
        </p>
      </div>

      <div className="mt-5 rounded-lg border border-border/70 bg-secondary/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
              Generate dashboard data
            </h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              Runs the executive KPI snapshot, resident safety scorer, and risk nightly scorer server-side, then refreshes this page.
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={refreshExecutiveDashboard}
            disabled={isRefreshing}
            className="w-full sm:w-auto"
          >
            <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} aria-hidden />
            {isRefreshing ? "Refreshing dashboard…" : "Refresh executive dashboard now"}
          </Button>
        </div>
        {refreshState.kind === "success" && (
          <p className="mt-3 text-[12px] font-medium text-success" role="status">
            {refreshState.message}
          </p>
        )}
        {refreshState.kind === "error" && (
          <div className="mt-3" role="alert">
            <p className="text-[12px] font-medium text-destructive">{refreshState.message}</p>
            {(refreshState.snapshot || refreshState.scorer || refreshState.risk) && (
              <div className="mt-2 flex flex-col gap-2">
                {[refreshState.snapshot, refreshState.scorer, refreshState.risk].filter(Boolean).map((fnStatus) => {
                  if (!fnStatus) return null;
                  const hint = getStatusHint(fnStatus.status);
                  return (
                    <div key={fnStatus.name} className="text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium", fnStatus.ok ? "text-success" : "text-destructive")}>
                          {fnStatus.ok ? "✓" : "✗"}
                        </span>
                        <span className="font-medium text-foreground">{fnStatus.name}</span>
                        <span className="tabular-nums text-muted-foreground">{fnStatus.status}</span>
                      </div>
                      {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
                    </div>
                  );
                })}
              </div>
            )}
            {refreshState.missing && refreshState.missing.length > 0 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Missing environment variables: <span className="font-medium">{refreshState.missing.join(", ")}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-border/60 bg-card p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
            Configuration
          </h3>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Optional configuration — these tune the dashboard but don&rsquo;t generate data themselves.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Configuration</p>
            <ol className="grid gap-3 md:grid-cols-2">
              {configurationLinks.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-[11px] font-medium tabular-nums text-foreground">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h4 className="text-[13px] font-semibold tracking-tight text-foreground">
                      {step.title}
                    </h4>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                    <Link
                      href={step.href}
                      className={cn(
                        "inline-flex h-7 w-fit items-center gap-1 rounded-md border border-border bg-card px-2.5",
                        "text-[12px] font-medium text-muted-foreground transition-colors",
                        "hover:bg-secondary hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      {step.cta} <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Operational shortcuts</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              These links open live operational dashboards. They do not generate data or change configuration.
            </p>
            <ol className="grid gap-3 md:grid-cols-2">
              {operationalShortcutLinks.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-[11px] font-medium tabular-nums text-foreground">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h4 className="text-[13px] font-semibold tracking-tight text-foreground">
                      {step.title}
                    </h4>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                    <Link
                      href={step.href}
                      className={cn(
                        "inline-flex h-7 w-fit items-center gap-1 rounded-md border border-border bg-card px-2.5",
                        "text-[12px] font-medium text-muted-foreground transition-colors",
                        "hover:bg-secondary hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      {step.cta} <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-border/60 pt-4 text-[12px] text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        Connection status: organization is set up and reachable from the executive shell.
      </div>
    </div>
  );
}

const PRESENCE_TONE_DOT: Record<StatusPillTone, string> = {
  muted: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * Resident presence band — the in-house vs on-hold split of the occupied
 * population. Additive only: it reuses the occupancy denominator (held beds
 * still count as occupied) and never introduces a second occupancy number.
 * Labels/tones come from the shared presence vocabulary so Command and the
 * resident record read identically.
 */
function ResidentPresenceBand({ census }: { census: PresenceCensus }) {
  if (census.total <= 0) return null;
  const stats: Array<{ status: ResidencyStatus; value: number }> = [
    { status: "active", value: census.inHouse },
    { status: "hospital", value: census.hospital },
    { status: "loa", value: census.onLeave },
  ];
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Resident presence — all facilities
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {census.total} in census · {census.onHold} on hold
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {stats.map((stat) => (
          <div key={stat.status} className="flex items-center gap-2">
            <span
              className={cn("size-2 shrink-0 rounded-full", PRESENCE_TONE_DOT[presenceTone(stat.status)])}
              aria-hidden
            />
            <span className="text-[13px] text-muted-foreground">{presenceLabel(stat.status)}</span>
            <span className="text-[15px] font-semibold tabular-nums text-foreground">{stat.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Counted across every facility, not the one chosen in the top bar. Held beds (hospital &amp;
        leave) stay counted as occupied in occupancy above — this is the in-house vs on-hold split,
        not a second occupancy figure.
      </p>
    </div>
  );
}

const COVERAGE_STATE_LABEL: Record<CoverageRow["state"], string> = {
  reported: "Reported",
  partial: "Partial",
  estimated: "Estimated",
  not_reported: "Not reported",
  past: "Earlier day",
  unreadable: "Unknown",
};

/**
 * State on the strip is carried by the words themselves ("2 of 5", "Estimated")
 * and marked by a dot. The dot takes the colour so the reading stays on
 * foreground text, which holds its contrast in both themes.
 */
const COVERAGE_DOT_CLASS: Record<CoverageRow["state"], string> = {
  reported: "bg-success",
  partial: "bg-warning",
  estimated: "bg-info",
  not_reported: "bg-muted-foreground/60",
  past: "bg-warning",
  unreadable: "bg-destructive",
};

/**
 * Coverage in one line. The strip carries the whole answer at a glance; the
 * per-measure evidence stays one keystroke away rather than filling the screen
 * above the comparison an owner came here to read.
 */
function CoverageStrip({ rows }: { rows: CoverageRow[] }) {
  return (
    <details className="group rounded-lg border border-border bg-card" aria-labelledby="coverage-heading">
      <summary
        className={cn(
          "flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <h2 id="coverage-heading" className="text-[13px] font-semibold tracking-tight text-foreground">
          {coverageHeadline(rows)}
        </h2>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {rows.map((row) => (
            <span key={row.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", COVERAGE_DOT_CLASS[row.state])}
                aria-hidden
              />
              {row.label} <span className="font-medium text-foreground">{row.short}</span>
            </span>
          ))}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-foreground">
          View coverage
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {coverageSummaryLine(rows)} {coverageGapLine(rows)}
        </p>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", COVERAGE_DOT_CLASS[row.state])}
                  aria-hidden
                />
                <span className="text-[13px] font-medium text-foreground">{row.label}</span>
                <span className="text-[12px] text-muted-foreground">
                  {COVERAGE_STATE_LABEL[row.state]}
                </span>
              </div>
              <p className="pl-[calc(0.375rem+0.5rem)] text-[12px] leading-relaxed text-muted-foreground">
                {row.detail}
              </p>
            </li>
          ))}
        </ul>
        <div className="border-t border-border/60 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Not recorded anywhere yet
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {NOT_RECORDED_FOLLOW_UPS.map((item) => (
              <li key={item} className="text-[11px] leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

/**
 * Reporting follow-up — the gaps as work, each pointed at a page that exists.
 * Kept apart from alerts: a measure that never arrived is not an exception.
 */
function ReportingFollowUpPanel({ coverage }: { coverage: CoverageRow[] }) {
  const followUps = coverageFollowUps(coverage);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading" className="text-[14px] font-semibold tracking-tight text-foreground">
        Reporting follow-up
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {followUps.length === 0 ? (
          <p className="px-3 py-2.5 text-[13px] text-muted-foreground">
            Every measure on this page is reported. Nothing is outstanding.
          </p>
        ) : (
          <ul>
            {followUps.map((row) => (
              <li
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2 last:border-b-0"
              >
                <span className="text-[13px] leading-snug text-foreground">{row.followUp.summary}</span>
                <Link
                  href={row.followUp.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground",
                    "transition-colors hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {row.followUp.actionLabel} <ArrowRight className="size-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Recorded exceptions only — never an all-clear for what was never reported. */
function RecordedAlertsPanel({
  alerts,
  coverage,
}: {
  alerts: AlertWithFacility[];
  coverage: CoverageRow[];
}) {
  const emptyCopy = noAlertsCopy(coverage);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="attention-heading">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="attention-heading"
          className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground"
        >
          <AlertTriangle className="size-4 text-warning" aria-hidden /> Recorded alerts
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {alerts.length} recorded {alerts.length === 1 ? "alert" : "alerts"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {alerts.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <p className="text-[13px] font-medium text-foreground">{emptyCopy.headline}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{emptyCopy.body}</p>
            </div>
          ) : (
            alerts.map((alert) => {
              const isCritical = alert.severity === "critical";
              return (
                <div
                  key={alert.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border bg-card p-3",
                    isCritical ? "border-destructive/30" : "border-warning/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[10px] font-medium uppercase tracking-wider",
                        isCritical ? "text-destructive" : "text-warning",
                      )}
                    >
                      {alert.category} · {alert.facilities?.name || "All facilities"}
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-medium uppercase tracking-wider",
                        isCritical
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-warning/30 bg-warning/10 text-warning",
                      )}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <h3 className="text-[13px] font-semibold leading-snug text-foreground">
                    {alert.title}
                  </h3>
                  {alert.body && (
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{alert.body}</p>
                  )}
                  {alert.why_it_matters && (
                    <div className="rounded-md border border-border bg-secondary/50 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
                      <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                        Business impact
                      </span>
                      <span className="mt-0.5 block text-foreground/80">{alert.why_it_matters}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>First recorded {formatExecutiveRelativeAge(alert.first_triggered_at)}</span>
                    <span aria-hidden>·</span>
                    <span>{alert.owner_user_id ? "Owner assigned" : "No owner assigned"}</span>
                    {alert.deep_link_path ? (
                      <Link
                        href={alert.deep_link_path}
                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open the record <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
      </div>
    </section>
  );
}

type KpiTile = {
  key: ExecutiveKpiMetricKey;
  label: string;
  format: "pct" | "num" | "cur";
};

const KPI_TILES: readonly KpiTile[] = [
  { key: "occ_pt", label: "Occupancy", format: "pct" },
  { key: "rev_mtd", label: "Billed month to date", format: "cur" },
  { key: "labor_pct", label: "Labor cost % of billed revenue", format: "pct" },
  { key: "inc_rate", label: "Incidents per 1,000 resident-days", format: "num" },
  { key: "survey_rd", label: "Survey readiness", format: "pct" },
] as const;

function formatMetricValue(value: number, format: "pct" | "num" | "cur"): string {
  if (format === "pct") return formatPct(value) ?? "";
  if (format === "cur") return formatCur(value) ?? "";
  return formatNum(value) ?? "";
}

/**
 * One tile per portfolio figure. Every tile states the period or basis it was
 * computed on, and change is only drawn against a dated earlier recording.
 */
function PortfolioFiguresStrip({
  metrics,
  occupancyContext,
  snapshot,
  residentDayWindow,
  metricChanges,
  metricDates,
}: {
  metrics: Record<string, number>;
  occupancyContext: OccupancyContext | null;
  snapshot: ExecutiveSnapshotState;
  residentDayWindow: ResidentDayWindow | null;
  metricChanges: Record<string, MetricChange>;
  metricDates: Record<string, string>;
}) {
  const incidentBasis = incidentRateBasis(snapshot, residentDayWindow);
  const todayIsoDate = facilityTodayIsoDate();
  const portfolioOcc = occupancyContextOccPtFraction(occupancyContext);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="figures-heading">
      <h2 id="figures-heading" className="text-[14px] font-semibold tracking-tight text-foreground">
        Portfolio figures
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {KPI_TILES.map((tile) => {
          const change = metricChanges[tile.key];
          const rawValue = metrics[tile.key];

          // The tile and the comparison footer describe the same figure, so they
          // carry the same coverage wording.
          const label =
            tile.key === "occ_pt" ? occupancyCoverageHeading(occupancyContext) : tile.label;

          // Occupancy reads live from the bed grid; every other figure comes
          // from the recorded run and may only be shown with its basis.
          const value =
            tile.key === "occ_pt"
              ? portfolioOcc !== undefined
                ? formatExecutiveOccPtPctWithSuffix(portfolioOcc)
                : hasMetric(rawValue)
                  ? formatExecutiveOccPtPctWithSuffix(rawValue)
                  : null
              : tile.key === "inc_rate"
                ? hasMetric(rawValue) && incidentBasis.usable
                  ? formatMetricValue(rawValue, tile.format)
                  : null
                : hasMetric(rawValue)
                  ? formatMetricValue(rawValue, tile.format)
                  : null;

          const missingCopy =
            tile.key === "inc_rate" && hasMetric(rawValue) && !incidentBasis.usable
              ? incidentBasis.line
              : executiveKpiEmptyCopy(tile.key);

          const changeLine = metricChangeLine(change, tile.format);

          // Occupancy is read live from the bed grid, so it has no recorded day
          // of its own; every other figure is aged against the operating day
          // rather than against the run, which may have skipped it.
          const recordedLine =
            tile.key === "occ_pt"
              ? null
              : metricRecordedLine(metricFreshness(metricDates[tile.key], todayIsoDate));

          // One qualifier stays visible — the one that changes how the figure
          // is read. A figure describing an earlier day outranks its basis,
          // which moves into the disclosure with the rest.
          const basisLine =
            tile.key === "occ_pt"
              ? occupancyCalculationLine(occupancyContext)
              : tile.key === "rev_mtd"
                ? billedRevenuePeriodLine(snapshot)
                : tile.key === "inc_rate"
                  ? incidentBasis.line
                  : changeLine;
          const summaryLine = recordedLine ?? basisLine;

          const detailLines = [
            // Displaced by a recorded-day line above; it still belongs to the figure.
            recordedLine ? basisLine : null,
            ...(tile.key === "occ_pt"
              ? [
                  occupancyContext ? occupancyLoadedFootnote(occupancyContext) : null,
                  OCCUPANCY_CHANGE_UNAVAILABLE_COPY,
                ]
              : tile.key === "rev_mtd"
                ? [BILLED_REVENUE_SCOPE_LINE, changeLine]
                : tile.key === "labor_pct"
                  ? ["Payroll cost for the period divided by billed revenue for the same period."]
                  : tile.key === "inc_rate"
                    ? [incidentBasis.detail, changeLine]
                    : ["Most recent recorded readiness review per facility, averaged.", changeLine]),
          ];

          const details = (value != null ? detailLines : []).filter(
            (line): line is string => Boolean(line),
          );

          return (
            <div
              key={tile.key}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <div className="flex items-baseline gap-2">
                {value != null ? (
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {value}
                  </span>
                ) : (
                  <span className="text-[13px] font-medium leading-snug text-muted-foreground">
                    {missingCopy}
                  </span>
                )}
                {/* Direction is only drawn against a dated earlier recording,
                    never against a target — the label says which. */}
                {value != null && changeLine && change && change.direction !== "flat" ? (
                  change.direction === "up" ? (
                    <TrendingUp className="size-3.5 text-muted-foreground" aria-label={changeLine} />
                  ) : (
                    <TrendingDown className="size-3.5 text-muted-foreground" aria-label={changeLine} />
                  )
                ) : null}
              </div>
              {/* Basis belongs to a figure. When there is no figure, the line
                  in its place already says why. */}
              {value != null && summaryLine ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{summaryLine}</p>
              ) : null}
              {details.length > 0 ? (
                <details className="group/calc mt-auto pt-0.5">
                  <summary
                    className={cn(
                      "inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground",
                      "transition-colors hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "[&::-webkit-details-marker]:hidden",
                    )}
                  >
                    How this is calculated
                    <ChevronDown
                      className="size-3 transition-transform group-open/calc:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  {details.map((line) => (
                    <p key={line} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PORTFOLIO_MEASURES: ReadonlyArray<{ key: ExecutiveKpiMetricKey; label: string; format: "pct" | "num" | "cur" }> = [
  { key: "occ_pt", label: "Occupancy", format: "pct" },
  { key: "labor_pct", label: "Labor %", format: "pct" },
  { key: "inc_rate", label: "Incidents / 1k", format: "num" },
  { key: "survey_rd", label: "Survey %", format: "pct" },
];

/** Facility comparison — each cell either a reported figure or a named gap. */
function PortfolioComparisonTable({
  facilities,
  metrics,
  occupancyContext,
}: {
  facilities: ExecutiveOverviewFacility[];
  metrics: Record<string, number>;
  occupancyContext: OccupancyContext | null;
}) {
  const portfolioOcc = occupancyContextOccPtFraction(occupancyContext);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison-heading">
      <div className="flex items-center justify-between">
        <h2
          id="comparison-heading"
          className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground"
        >
          <Activity className="size-4 text-info" aria-hidden /> Portfolio comparison
        </h2>
        <Link
          href="/admin/executive/reports"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
            "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Open executive reports <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* The table scrolls inside the card, so the region needs to be reachable
            by keyboard on narrow viewports. */}
        <div
          className="max-h-[480px] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label="Portfolio comparison by facility"
        >
          <table className="w-full text-[13px]">
            <caption className="sr-only">
              Reported measures by facility. Cells without a figure say why the measure is missing.
            </caption>
            <thead className="sticky top-0 z-10 bg-background/95">
              <tr className="border-b border-border">
                <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Facility
                </th>
                {PORTFOLIO_MEASURES.map((measure) => (
                  <th
                    key={measure.key}
                    scope="col"
                    className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {measure.label}
                  </th>
                ))}
                <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {facilities.length === 0 ? (
                <tr>
                  <td colSpan={PORTFOLIO_MEASURES.length + 2} className="px-3 py-8">
                    <div className="text-[13px] font-medium text-foreground">No facilities in scope.</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      Confirm facility access for this account, or wait for the next recorded run.
                    </div>
                  </td>
                </tr>
              ) : (
                facilities.map((facility) => {
                  const facilityMetrics = facility.metrics ?? {};
                  const reported = PORTFOLIO_MEASURES.filter((measure) =>
                    hasMetric(facilityMetrics[measure.key]),
                  ).length;
                  return (
                    <tr
                      key={facility.id}
                      className="border-b border-border/60 transition-colors even:bg-muted/30 hover:bg-muted/50"
                    >
                      <th scope="row" className="h-9 px-3 text-left font-medium text-foreground">
                        {facility.name}
                      </th>
                      {PORTFOLIO_MEASURES.map((measure) => {
                        const value = facilityMetrics[measure.key];
                        return (
                          <td key={measure.key} className="h-9 px-3 text-right">
                            {hasMetric(value) ? (
                              <span
                                className={cn(
                                  "tabular-nums",
                                  facilityMeasureToneClass(measure.key, value),
                                )}
                              >
                                {measure.key === "occ_pt"
                                  ? formatExecutiveOccPtPctWithSuffix(value)
                                  : formatMetricValue(value, measure.format)}
                              </span>
                            ) : (
                              <span className="text-[12px] leading-snug text-muted-foreground">
                                {executiveKpiEmptyCopy(measure.key)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="h-9 px-3 text-right text-[12px] tabular-nums text-muted-foreground">
                        {reported} of {PORTFOLIO_MEASURES.length}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {facilities.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/40">
                  <th scope="row" className="h-9 px-3 text-left text-[12px] font-semibold text-muted-foreground">
                    {occupancyCoverageHeading(occupancyContext)}
                  </th>
                  <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                    {portfolioOcc !== undefined
                      ? formatExecutiveOccPtPctWithSuffix(portfolioOcc)
                      : hasMetric(metrics.occ_pt)
                        ? formatExecutiveOccPtPctWithSuffix(metrics.occ_pt)
                        : (
                          <span className="text-[12px] font-normal text-muted-foreground">
                            {executiveKpiEmptyCopy("occ_pt")}
                          </span>
                        )}
                  </td>
                  {PORTFOLIO_MEASURES.slice(1).map((measure) => (
                    <td
                      key={measure.key}
                      className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground"
                    >
                      {hasMetric(metrics[measure.key]) ? (
                        formatMetricValue(metrics[measure.key], measure.format)
                      ) : (
                        <span className="text-[12px] font-normal text-muted-foreground">
                          {executiveKpiEmptyCopy(measure.key)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="h-9 px-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {occupancyCalculationLine(occupancyContext) ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {occupancyCalculationLine(occupancyContext)} Facility percentages below that figure are
          weighted by bed count, so the portfolio percentage can sit below a facility&rsquo;s own.
        </p>
      ) : null}
    </section>
  );
}

/** Colour follows the value, not the column — and only where a threshold is defined. */
function facilityMeasureToneClass(key: ExecutiveKpiMetricKey, value: number): string {
  if (key === "occ_pt") return value > 0.9 ? "text-success" : "text-warning";
  if (key === "labor_pct") return value < 0.55 ? "text-success" : "text-destructive";
  return "text-foreground";
}

/**
 * Rounding assurance — one row per facility: whether anything was recorded,
 * when, what is open, and the day-by-day record with its gaps left visible.
 */
function RoundingAssuranceTable({
  heatMap,
  trends,
}: {
  heatMap: ResidentAssuranceFacilityRollup[];
  trends: ResidentAssuranceFacilityTrendRow[];
}) {
  const trendByFacility = new Map(trends.map((row) => [row.facilityId, row]));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rounding-heading">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h2
            id="rounding-heading"
            className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground"
          >
            <Activity className="size-4 text-info" aria-hidden /> Rounding assurance
          </h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {ROUNDING_EXPECTATION_NOT_RECORDED_COPY}
          </p>
        </div>
        <Link
          href="/admin/rounding"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
            "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Open Smart Rounding <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {heatMap.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
          <p className="text-[13px] font-medium text-foreground">No rounding records in scope.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Nothing has been recorded for the facilities this account can see.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div
            className="overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="region"
            aria-label="Rounding findings by facility"
          >
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                Recorded rounding findings by facility, with the days that carry no record shown as gaps.
              </caption>
              <thead className="bg-background/95">
                <tr className="border-b border-border">
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Facility
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recorded
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last entry
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Open watches
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Awaiting approval
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Escalations
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Data checks
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Critical residents
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last 7 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {heatMap.map((row) => {
                  const trend = trendByFacility.get(row.facilityId);
                  return (
                    <tr
                      key={row.facilityId}
                      className="border-b border-border/60 transition-colors even:bg-muted/30 hover:bg-muted/50"
                    >
                      <th scope="row" className="h-10 px-3 text-left font-medium text-foreground">
                        <Link
                          href={`/admin/executive/facility/${row.facilityId}`}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.facilityName}
                        </Link>
                      </th>
                      <td className="h-10 px-3">
                        <span
                          className={cn(
                            "inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 text-[10px] font-medium uppercase tracking-wider",
                            row.observed ? "border-border text-muted-foreground" : "border-warning/40 text-warning",
                          )}
                          title={roundingCountsMeaningLine(row.observed)}
                        >
                          {roundingBandLabel(row)}
                        </span>
                      </td>
                      <td className="h-10 px-3 text-[12px] text-muted-foreground">
                        {roundingLastObservedLine(row.lastObservedAt)}
                      </td>
                      <RoundingCountCell observed={row.observed} value={row.activeWatches} />
                      <RoundingCountCell observed={row.observed} value={row.pendingWatchApprovals} />
                      <RoundingCountCell observed={row.observed} value={row.openEscalations} danger />
                      <RoundingCountCell observed={row.observed} value={row.openIntegrityFlags} danger />
                      <RoundingCountCell observed={row.observed} value={row.criticalSafetyResidents} danger />
                      <td className="h-10 px-3">
                        {trend ? (
                          <div className="flex items-center gap-2">
                            <SevenDayRecord row={trend} />
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                              {roundingTrendCoverageLine(trend)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">No day series recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Bar height is the pressure recorded that day. A hatched slot means nothing was recorded for
        that facility that day — it is a gap, not a clear day.
      </p>
    </section>
  );
}

function RoundingCountCell({
  observed,
  value,
  danger = false,
}: {
  observed: boolean;
  value: number;
  danger?: boolean;
}) {
  if (!observed) {
    return (
      <td className="h-10 px-3 text-right text-[12px] text-muted-foreground" title="Nothing recorded">
        —
      </td>
    );
  }
  return (
    <td
      className={cn(
        "h-10 px-3 text-right text-[14px] font-semibold tabular-nums",
        danger && value > 0 ? "text-destructive" : "text-foreground",
      )}
    >
      {value}
    </td>
  );
}

/** Seven slots, one per day. Unrecorded days render as gaps rather than as zero. */
function SevenDayRecord({ row }: { row: ResidentAssuranceFacilityTrendRow }) {
  return (
    <div className="flex items-end gap-1" role="img" aria-label={sevenDayLabel(row)}>
      {row.points.map((point) => (
        <div key={`${row.facilityId}:${point.date}`} className="flex h-8 w-3 items-end" title={pointTitle(point)}>
          {point.observed ? (
            <div
              className={cn(
                "w-full rounded-t-sm",
                point.heatBand === "critical"
                  ? "bg-destructive"
                  : point.heatBand === "elevated"
                    ? "bg-warning"
                    : point.heatBand === "watch"
                      ? "bg-warning/60"
                      : "bg-success",
              )}
              style={{ height: `${Math.max(12, Math.min(100, point.heatScore * 7))}%` }}
            />
          ) : (
            // A gap reads as a low, hatched baseline — visibly not a bar.
            <div className="h-1.5 w-full rounded-sm border border-dashed border-border" />
          )}
        </div>
      ))}
    </div>
  );
}

function pointTitle(point: ResidentAssuranceFacilityTrendPointLike): string {
  if (!point.observed) return `${point.date}: nothing recorded`;
  return `${point.date}: recorded pressure ${point.heatScore}`;
}

type ResidentAssuranceFacilityTrendPointLike = ResidentAssuranceFacilityTrendRow["points"][number];

function sevenDayLabel(row: ResidentAssuranceFacilityTrendRow): string {
  return `${row.facilityName}: ${roundingTrendCoverageLine(row)} in the last ${row.days} days.`;
}

const SUPPORTING_LINKS = [
  {
    title: "Executive alerts",
    description: "Every recorded portfolio exception, not just the latest five.",
    href: "/admin/executive/alerts",
  },
  {
    title: "Financial overview",
    description: "Billed revenue, labor cost, and monthly financial statements.",
    href: "/admin/finance",
  },
  {
    title: "Insurance and risk",
    description: "Claims, renewals, and portfolio risk posture.",
    href: "/admin/insurance",
  },
  {
    title: "Open incidents",
    description: "Incident records still open at level 4.",
    href: "/admin/incidents?scope=open&severity=level_4",
  },
] as const;

function SupportingDestinations() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="destinations-heading">
      <div>
        <h2 id="destinations-heading" className="text-[14px] font-semibold tracking-tight text-foreground">
          Where to go next
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Destinations, not outstanding work. Anything needing a decision appears above.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SUPPORTING_LINKS.map((link) => (
          <Link
            key={link.title}
            href={link.href}
            className={cn(
              "group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
              "transition-colors hover:bg-secondary/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">{link.title}</h3>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{link.description}</p>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-medium text-foreground">
              Open <ArrowRight className="size-3" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

type DashboardBodyProps = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: ExecutiveOverviewFacility[];
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
  presenceCensus: PresenceCensus;
  occupancyContext: OccupancyContext | null;
  snapshot: ExecutiveSnapshotState;
  residentDayWindow: ResidentDayWindow | null;
  metricChanges: Record<string, MetricChange>;
  metricDates: Record<string, string>;
  coverage: CoverageRow[];
  panelLoads: ExecutivePanelLoads;
};

const EXECUTIVE_PANEL_RPCS = [
  "home_escalations_for_executive",
  "home_census_notices_for_executive",
  "home_collection_escalations_for_executive",
] as const;
type ExecutivePanelRpc = (typeof EXECUTIVE_PANEL_RPCS)[number];
type ExecutivePanelLoads = {
  escalations: () => Promise<unknown>;
  censusNotices: () => Promise<unknown>;
  collectionEscalations: () => Promise<unknown>;
};

/** Same read each panel makes on its own; started early (COL-674). */
function startExecutivePanelRead(supabase: ReturnType<typeof createClient>, name: ExecutivePanelRpc): Promise<unknown> {
  const read = (async () => {
    const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc(name);
    if (error) throw new Error(error.message);
    return data;
  })();
  // A panel that never mounts (error or empty state) must not leave an unhandled rejection.
  read.catch(() => undefined);
  return read;
}

function ExecutiveDashboardBody({
  metrics,
  alerts,
  facilities,
  assuranceHeatMap,
  assuranceTrends,
  presenceCensus,
  occupancyContext,
  snapshot,
  residentDayWindow,
  metricChanges,
  metricDates,
  coverage,
  panelLoads,
}: DashboardBodyProps): ReactNode {
  return (
    <>
      {/* Coverage first and compact, then the work, then the comparison an
          owner opens this page for — the explanations sit behind them. */}
      <CoverageStrip rows={coverage} />

      {/* COL-593 §5.4: what a building did not clear by the end of its operator
          day lands with its Facility Executive here. Renders nothing otherwise. */}
      <EscalatedFromFacilitiesPanel load={panelLoads.escalations} />
      {/* COL-569: monthly census confirmations from the buildings this executive owns. */}
      <CensusNoticesPanel load={panelLoads.censusNotices} />
      <CollectionEscalationsPanel load={panelLoads.collectionEscalations} />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <ReportingFollowUpPanel coverage={coverage} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <RecordedAlertsPanel alerts={alerts} coverage={coverage} />
        </div>
      </div>

      <PortfolioComparisonTable
        facilities={facilities}
        metrics={metrics}
        occupancyContext={occupancyContext}
      />

      <PortfolioFiguresStrip
        metrics={metrics}
        occupancyContext={occupancyContext}
        snapshot={snapshot}
        residentDayWindow={residentDayWindow}
        metricChanges={metricChanges}
        metricDates={metricDates}
      />

      <RoundingAssuranceTable heatMap={assuranceHeatMap} trends={assuranceTrends} />

      <ResidentPresenceBand census={presenceCensus} />

      <SupportingDestinations />
    </>
  );
}
