"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  attachFacilityMetrics,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import {
  buildAggregateSnapshotQuery,
  buildFacilitySnapshotQuery,
} from "@/lib/executive/metric-snapshot-queries";
import { Button } from "@/components/ui/button";
import {
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
  type ResidentAssuranceFacilityTrendRow,
  type ResidentAssuranceFacilityRollup,
} from "@/lib/resident-assurance/command-center-brief";
import type { Database } from "@/types/database";

type ExecutiveOverviewPageClientProps = {
  initialMetrics: Record<string, number>;
  initialAlerts: AlertWithFacility[];
  initialFacilities: ExecutiveOverviewFacility[];
  initialAssuranceHeatMap: ResidentAssuranceFacilityRollup[];
  initialAssuranceTrends: ResidentAssuranceFacilityTrendRow[];
  initialHasServerData: boolean;
};

export function ExecutiveOverviewPageClient({
  initialMetrics,
  initialAlerts,
  initialFacilities,
  initialAssuranceHeatMap,
  initialAssuranceTrends,
  initialHasServerData,
}: ExecutiveOverviewPageClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const roleConfig = getRoleDashboardConfig(appRole as AppRole);
  const [, setLoading] = useState(!initialHasServerData);
  const [, setError] = useState<string | null>(null);

  // Core metrics
  const [metrics, setMetrics] = useState<Record<string, number>>(initialMetrics);

  // Watchlist alerts
  const [alerts, setAlerts] = useState<AlertWithFacility[]>(initialAlerts);

  // Portfolio Facilities
  const [facilities, setFacilities] = useState<ExecutiveOverviewFacility[]>(initialFacilities);
  const [assuranceHeatMap, setAssuranceHeatMap] = useState<ResidentAssuranceFacilityRollup[]>(initialAssuranceHeatMap);
  const [assuranceTrends, setAssuranceTrends] = useState<ResidentAssuranceFacilityTrendRow[]>(initialAssuranceTrends);

  // Skip the first client-side fetch when the server already supplied scoped
  // live data. If the server returned empty arrays, the client retries once;
  // it must still render blanks rather than demo fallback values.
  const skipNextLoadRef = useRef(initialHasServerData);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoading(true);
    setError(null);
    try {
      if (!organizationId) throw new Error("Organization missing on profile.");

      // 1. Fetch latest scoped executive snapshots. Aggregate metrics stay
      // separate from facility metrics; never smear portfolio averages into
      // facility rows.
      const { data: snapData, error: snapErr } = await buildAggregateSnapshotQuery(
        supabase,
        organizationId,
      );
        
      if (snapErr) throw snapErr;

      const { data: facilityMetricData, error: facilityMetricErr } = await buildFacilitySnapshotQuery(
        supabase,
        organizationId,
      );

      if (facilityMetricErr) throw facilityMetricErr;

      setMetrics(buildLatestMetricMap(snapData ?? []));

      // 2. Fetch Executive Alerts
      const { data: alertData, error: alertErr } = await supabase
        .from("exec_alerts")
        .select("*, facilities(name)")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .is("deleted_at", null)
        .order("severity", { ascending: false })
        .limit(5);

      if (alertErr) throw alertErr;
      
      setAlerts(alertData ?? []);

      // 3. Fetch Portfolio Facilities
      const { data: facData, error: facErr } = await supabase
        .from("facilities")
        .select("id, name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
        
      if (!facErr && facData && facData.length > 0) {
        setFacilities(attachFacilityMetrics(facData, facilityMetricData ?? []));
      } else {
        setFacilities([]);
      }

      const [assuranceRows, assuranceTrendRows] = await Promise.all([
        fetchResidentAssuranceFacilityHeatMap(supabase, organizationId),
        fetchResidentAssuranceFacilityTrendSeries(supabase, organizationId, 7),
      ]);
      if (assuranceRows.length > 0) {
        setAssuranceHeatMap(assuranceRows);
      } else {
        setAssuranceHeatMap([]);
      }

      if (assuranceTrendRows.length > 0) {
        setAssuranceTrends(assuranceTrendRows);
      } else {
        setAssuranceTrends([]);
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load executive overview.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // View helpers
  const hasMetric = (val: number | null | undefined): val is number => typeof val === "number" && Number.isFinite(val);
  const formatPct = (val?: number | null) => hasMetric(val) ? `${(val * 100).toFixed(1)}%` : null;
  const formatNum = (val?: number | null) => hasMetric(val) ? Math.round(val).toLocaleString() : null;
  const formatCur = (val?: number | null) => hasMetric(val) ? `$${(val / 100).toLocaleString()}` : null;
  const ownerPriorityCards = [
    {
      title: "Executive alerts",
      description: "High-severity portfolio exceptions to clear first.",
      href: "/admin/executive/alerts",
      stat: `${alerts.length} open`,
    },
    {
      title: "Finance hub",
      description: "Billed revenue, labor pressure, monthly financials.",
      href: "/admin/finance",
      stat: formatCur(metrics["rev_mtd"]) ?? "—",
    },
    {
      title: "Insurance & risk",
      description: "Claims, renewals, and portfolio risk posture.",
      href: "/admin/insurance",
      stat: `${alerts.filter((alert) => alert.category === "risk").length} risk alerts`,
    },
    {
      title: "High-severity incidents",
      description: "Open incident exceptions, leadership-level only.",
      href: "/admin/incidents?scope=open&severity=level_4",
      stat: `${alerts.filter((alert) => alert.category === "incident").length} related`,
    },
  ];

  const assuranceBandClass: Record<ResidentAssuranceFacilityRollup["heatBand"], string> = {
    stable: "border-success/20",
    watch: "border-warning/30",
    elevated: "border-warning/40",
    critical: "border-destructive/30",
  };

  const assuranceBandText: Record<ResidentAssuranceFacilityRollup["heatBand"], string> = {
    stable: "text-success",
    watch: "text-warning",
    elevated: "text-warning",
    critical: "text-destructive",
  };

  const KPI_TILES = [
    { key: "occ_pt", label: "Occupancy", format: "pct" as const, trend: "up" as const },
    { key: "rev_mtd", label: "Billed MTD", format: "cur" as const, trend: null },
    { key: "labor_pct", label: "Labor cost %", format: "pct" as const, trend: "down" as const },
    { key: "inc_rate", label: "Incidents / 1k days", format: "num" as const, trend: null },
    { key: "survey_rd", label: "Survey readiness", format: "pct" as const, trend: null },
  ];

  const dashEm = <span className="text-muted-foreground/60 tabular-nums">—</span>;

  function renderMetric(value: number | undefined, format: "pct" | "num" | "cur"): ReactNode {
    if (!hasMetric(value)) return dashEm;
    const formatted =
      format === "pct" ? formatPct(value) :
      format === "cur" ? formatCur(value) :
      formatNum(value);
    return formatted ?? dashEm;
  }

  /**
   * "Empty install" detection — an organization is connected and has facilities,
   * but no operational data has flowed yet. We replace the dashboard body with
   * a single onboarding card to avoid presenting a wall of "—" tiles, "0 OPEN"
   * priority cards, and "STABLE 0/0/0/0" heat-map rows that read as broken UI.
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
  const orgHasAssurance = assuranceHeatMap.some(
    (r) =>
      r.activeWatches > 0 ||
      r.pendingWatchApprovals > 0 ||
      r.openEscalations > 0 ||
      r.openIntegrityFlags > 0 ||
      r.criticalSafetyResidents > 0 ||
      r.highOrCriticalSafetyResidents > 0,
  );
  const isOrgEmpty =
    !orgHasMetrics && !orgHasAlerts && !orgHasFacilityMetrics && !orgHasAssurance;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            Executive intelligence
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Enterprise portfolio overview
          </p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {roleConfig.roleLabel} home — portfolio movement, exception pressure, leadership decisions only.
          </p>
        </div>
        <div className="hidden md:block">
          <ExecutiveHubNav />
        </div>
      </div>

      {isOrgEmpty ? (
        <ExecutiveEmptyOnboarding facilityCount={facilities.length} onRefreshComplete={load} />
      ) : (
        <ExecutiveDashboardBody
          metrics={metrics}
          alerts={alerts}
          facilities={facilities}
          assuranceHeatMap={assuranceHeatMap}
          assuranceTrends={assuranceTrends}
          ownerPriorityCards={ownerPriorityCards}
          roleConfig={roleConfig}
          KPI_TILES={KPI_TILES}
          hasMetric={hasMetric}
          renderMetric={renderMetric}
          assuranceBandClass={assuranceBandClass}
          assuranceBandText={assuranceBandText}
        />
      )}
    </div>
  );
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

type DashboardBodyProps = {
  metrics: Record<string, number>;
  alerts: AlertWithFacility[];
  facilities: ExecutiveOverviewFacility[];
  assuranceHeatMap: ResidentAssuranceFacilityRollup[];
  assuranceTrends: ResidentAssuranceFacilityTrendRow[];
  ownerPriorityCards: Array<{ title: string; description: string; href: string; stat: string }>;
  roleConfig: ReturnType<typeof getRoleDashboardConfig>;
  KPI_TILES: ReadonlyArray<{
    key: string;
    label: string;
    format: "pct" | "num" | "cur";
    trend: "up" | "down" | null;
  }>;
  hasMetric: (v: number | null | undefined) => v is number;
  renderMetric: (value: number | undefined, format: "pct" | "num" | "cur") => ReactNode;
  assuranceBandClass: Record<ResidentAssuranceFacilityRollup["heatBand"], string>;
  assuranceBandText: Record<ResidentAssuranceFacilityRollup["heatBand"], string>;
};

function ExecutiveDashboardBody({
  metrics,
  alerts,
  facilities,
  assuranceHeatMap,
  assuranceTrends,
  ownerPriorityCards,
  roleConfig,
  KPI_TILES,
  hasMetric,
  renderMetric,
  assuranceBandClass,
  assuranceBandText,
}: DashboardBodyProps) {
  return (
    <>
      {/* KPI strip — 2/3/5 responsive */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPI_TILES.map((tile) => {
          const value = metrics[tile.key];
          const present = hasMetric(value);
          return (
            <div
              key={tile.key}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {tile.label}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  {renderMetric(value, tile.format)}
                </span>
                {present && tile.trend === "up" && <TrendingUp className="size-3.5 text-success" />}
                {present && tile.trend === "down" && <TrendingDown className="size-3.5 text-warning" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Owner priority lanes */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Enterprise priorities</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {roleConfig.firstScreenPriority.join(" · ").replace(/_/g, " ")}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {ownerPriorityCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={cn(
                "group flex flex-col gap-2 rounded-lg border border-border bg-card p-4",
                "transition-colors hover:bg-secondary/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {card.stat}
              </span>
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                {card.title}
              </h3>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {card.description}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-foreground transition-colors group-hover:text-foreground/80">
                Open lane <ArrowRight className="size-3" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Watchlist (4/12) + Portfolio Health table (8/12) */}
      <div className="grid grid-cols-12 gap-6">
        {/* Watchlist */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
              <AlertTriangle className="size-4 text-warning" /> Executive watchlist
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
              <p className="text-[13px] font-medium text-foreground">No critical alerts.</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Nothing requires leadership intervention right now.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((alert) => {
                const isCritical = alert.severity === "critical";
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border bg-card p-3",
                      isCritical
                        ? "border-destructive/30"
                        : "border-warning/30",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isCritical && <></>}
                        <span
                          className={cn(
                            "truncate text-[10px] font-medium uppercase tracking-wider",
                            isCritical ? "text-destructive" : "text-warning",
                          )}
                        >
                          {alert.category} · {alert.facilities?.name || "Enterprise"}
                        </span>
                      </div>
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
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        {alert.body}
                      </p>
                    )}
                    {alert.why_it_matters && (
                      <div className="rounded-md border border-border bg-secondary/50 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
                        <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                          Business impact
                        </span>
                        <span className="mt-0.5 block text-foreground/80">{alert.why_it_matters}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Portfolio health table */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
              <Activity className="size-4 text-info" /> Portfolio health
            </h2>
            <Link
              href="/admin/executive/reports"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
                "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              )}
            >
              Detailed views <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-background/95">
                  <tr className="border-b border-border">
                    <th className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Facility
                    </th>
                    <th className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Occupancy
                    </th>
                    <th className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Labor %
                    </th>
                    <th className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Inc / 1k
                    </th>
                    <th className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Survey %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8">
                        <div className="text-[13px] font-medium text-foreground">No facilities in scope.</div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground">
                          Adjust the facility scope filter or wait for the next snapshot.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    facilities.map((fac) => {
                      const fm = fac.metrics ?? {};
                      const occ = fm["occ_pt"];
                      const labor = fm["labor_pct"];
                      const inc = fm["inc_rate"];
                      const survey = fm["survey_rd"];
                      const occGood = hasMetric(occ) && occ > 0.9;
                      const laborGood = hasMetric(labor) && labor < 0.55;
                      const facilityAlerts = alerts.filter((a) => a.facility_id === fac.id);
                      const hasCritical = facilityAlerts.some((a) => a.severity === "critical");
                      const hasWarning = facilityAlerts.length > 0;
                      return (
                        <tr
                          key={fac.id}
                          className="border-b border-border/60 transition-colors even:bg-muted/30 hover:bg-muted/50"
                        >
                          <td className="h-9 px-3">
                            <span className="inline-flex items-center gap-2">
                              {hasCritical ? (
                                <></>
                              ) : hasWarning ? (
                                <></>
                              ) : (
                                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                              )}
                              <span className="font-medium text-foreground">{fac.name}</span>
                            </span>
                          </td>
                          <td className="h-9 px-3 text-right">
                            <span
                              className={cn(
                                "inline-flex items-center justify-end gap-1 tabular-nums",
                                hasMetric(occ)
                                  ? occGood
                                    ? "text-success"
                                    : "text-warning"
                                  : "text-muted-foreground/60",
                              )}
                            >
                              {renderMetric(occ, "pct")}
                              {hasMetric(occ) && (occGood ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />)}
                            </span>
                          </td>
                          <td className="h-9 px-3 text-right">
                            <span
                              className={cn(
                                "inline-flex items-center justify-end gap-1 tabular-nums",
                                hasMetric(labor)
                                  ? laborGood
                                    ? "text-success"
                                    : "text-destructive"
                                  : "text-muted-foreground/60",
                              )}
                            >
                              {renderMetric(labor, "pct")}
                              {hasMetric(labor) && (laborGood ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />)}
                            </span>
                          </td>
                          <td className="h-9 px-3 text-right tabular-nums text-foreground">
                            {renderMetric(inc, "num")}
                          </td>
                          <td className="h-9 px-3 text-right tabular-nums text-foreground">
                            {renderMetric(survey, "pct")}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {facilities.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border bg-secondary/40">
                      <td className="h-9 px-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Enterprise avg
                      </td>
                      <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {renderMetric(metrics["occ_pt"], "pct")}
                      </td>
                      <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {renderMetric(metrics["labor_pct"], "pct")}
                      </td>
                      <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {renderMetric(metrics["inc_rate"], "num")}
                      </td>
                      <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                        {renderMetric(metrics["survey_rd"], "pct")}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Smart rounding heat map */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
            <Activity className="size-4 text-destructive" /> Smart rounding heat map
          </h2>
          <Link
            href="/admin/rounding"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
              "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            )}
          >
            Open assurance hub <ArrowRight className="size-3" />
          </Link>
        </div>

        {assuranceHeatMap.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
            <p className="text-[13px] font-medium text-foreground">No heat map data in scope.</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Wait for the next assurance rollup or change the facility scope.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {assuranceHeatMap.map((row) => (
              <Link
                key={row.facilityId}
                href={`/admin/executive/facility/${row.facilityId}`}
                className={cn(
                  "grid grid-cols-1 gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/40",
                  "md:grid-cols-[2fr_repeat(5,minmax(0,1fr))] md:items-center",
                  assuranceBandClass[row.heatBand],
                )}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {row.heatBand}
                  </p>
                  <h3 className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
                    {row.facilityName}
                  </h3>
                </div>
                <HeatMetric label="Watches" value={row.activeWatches} />
                <HeatMetric label="Pending" value={row.pendingWatchApprovals} />
                <HeatMetric label="Escalations" value={row.openEscalations} danger={row.openEscalations > 0} />
                <HeatMetric label="Integrity" value={row.openIntegrityFlags} danger={row.openIntegrityFlags > 0} />
                <div className="flex flex-col items-start md:items-end leading-tight">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Critical risk</span>
                  <span className={cn("text-[18px] font-semibold tabular-nums tracking-tight", assuranceBandText[row.heatBand])}>
                    {row.criticalSafetyResidents}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {row.highOrCriticalSafetyResidents} high + critical
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Smart rounding trend */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
              <Activity className="size-4 text-info" /> Smart rounding trend (7d)
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Daily heat pressure by facility.
            </p>
          </div>
          <Link
            href="/admin/reports/run/template/resident-assurance-heat-trend"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
              "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            )}
          >
            Run report <ArrowRight className="size-3" />
          </Link>
        </div>

        {assuranceTrends.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
            <p className="text-[13px] font-medium text-foreground">No 7-day heat data.</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              The trend chart appears once rollups have been generated.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {assuranceTrends.map((row) => (
              <Link
                key={row.facilityId}
                href={`/admin/executive/facility/${row.facilityId}`}
                className={cn(
                  "grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary/40",
                  "lg:grid-cols-[1.6fr_2.4fr_0.8fr_0.8fr_0.8fr] lg:items-center",
                )}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Facility</p>
                  <h3 className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
                    {row.facilityName}
                  </h3>
                </div>
                <div className="flex items-end gap-1.5">
                  {row.points.map((point) => (
                    <div key={`${row.facilityId}:${point.date}`} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-16 w-full items-end">
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
                          style={{ height: `${Math.max(10, Math.min(100, point.heatScore * 7))}%` }}
                          title={`${point.date}: heat ${point.heatScore}`}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {point.date.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
                <HeatMetric label="Latest" value={row.latestHeatScore} danger={row.latestHeatScore >= 7} />
                <HeatMetric label="Peak" value={row.peakHeatScore} danger={row.peakHeatScore >= 7} />
                <HeatMetric label="Avg" value={Number(row.avgHeatScore.toFixed(1))} danger={row.avgHeatScore >= 7} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function HeatMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col items-start md:items-end leading-tight">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-[18px] font-semibold tabular-nums tracking-tight",
          danger ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
