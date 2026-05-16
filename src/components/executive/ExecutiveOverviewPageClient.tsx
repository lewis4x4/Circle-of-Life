"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";

import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import {
  attachFacilityMetrics,
  buildLatestMetricMap,
  type AlertWithFacility,
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import { useAuth } from "@/hooks/useAuth";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import {
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
  type ResidentAssuranceFacilityTrendRow,
  type ResidentAssuranceFacilityRollup,
} from "@/lib/resident-assurance/command-center-brief";

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
  const supabase = createClient();
  const { user } = useAuth();
  const roleConfig = getRoleDashboardConfig(getAppRoleFromClaims(user));
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
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      // 1. Fetch latest scoped executive snapshots. Aggregate metrics stay
      // separate from facility metrics; never smear portfolio averages into
      // facility rows.
      const { data: snapData, error: snapErr } = await supabase
        .from("exec_metric_snapshots")
        .select("facility_id, metric_code, metric_value_numeric")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("facility_id", null)
        .is("deleted_at", null)
        .order("snapshot_date", { ascending: false })
        .limit(50);
        
      if (snapErr) throw snapErr;

      const { data: facilityMetricData, error: facilityMetricErr } = await supabase
        .from("exec_metric_snapshots")
        .select("facility_id, metric_code, metric_value_numeric")
        .eq("organization_id", ctx.ctx.organizationId)
        .not("facility_id", "is", null)
        .is("deleted_at", null)
        .order("snapshot_date", { ascending: false })
        .limit(500);

      if (facilityMetricErr) throw facilityMetricErr;

      setMetrics(buildLatestMetricMap(snapData ?? []));

      // 2. Fetch Executive Alerts
      const { data: alertData, error: alertErr } = await supabase
        .from("exec_alerts")
        .select("*, facilities(name)")
        .eq("organization_id", ctx.ctx.organizationId)
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
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
        
      if (!facErr && facData && facData.length > 0) {
        setFacilities(attachFacilityMetrics(facData, facilityMetricData ?? []));
      } else {
        setFacilities([]);
      }

      const [assuranceRows, assuranceTrendRows] = await Promise.all([
        fetchResidentAssuranceFacilityHeatMap(supabase, ctx.ctx.organizationId),
        fetchResidentAssuranceFacilityTrendSeries(supabase, ctx.ctx.organizationId, 7),
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
  }, [supabase]);

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
        <ExecutiveEmptyOnboarding facilityCount={facilities.length} />
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

function ExecutiveEmptyOnboarding({ facilityCount }: { facilityCount: number }) {
  const steps = [
    {
      title: "Run the executive KPI snapshot",
      body: "Generates occupancy, billed MTD, labor cost %, incident rate, and survey readiness from live operational data.",
      href: "/admin/executive/settings",
      cta: "Open snapshot settings",
    },
    {
      title: "Generate the first resident assurance rollup",
      body: "Computes watch load, escalation pressure, and integrity flags per facility. Populates the heat map and 7-day trend chart.",
      href: "/admin/rounding",
      cta: "Open assurance hub",
    },
    {
      title: "Configure executive alert rules",
      body: "Define the thresholds that surface critical alerts in the watchlist (occupancy drop, labor overrun, severity-4 incident, etc.).",
      href: "/admin/executive/alerts",
      cta: "Open alerts",
    },
    {
      title: "Set facility-level metric thresholds",
      body: "Each facility can carry its own occupancy / labor / incident thresholds. The dashboard colors these once they're set.",
      href: "/admin/settings/thresholds",
      cta: "Open thresholds",
    },
  ] as const;

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
          You&rsquo;re connected, but no live data has landed yet
        </h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {facilityCount > 0
            ? `${facilityCount} ${facilityCount === 1 ? "facility is" : "facilities are"} in scope. Once the executive snapshot runs and the first rollups complete, this dashboard fills in automatically.`
            : "Add a facility to start collecting operational data. Once it's in scope, the executive snapshot and rollups will populate this dashboard."}
        </p>
      </div>

      <ol className="mt-5 flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-[11px] font-medium tabular-nums text-foreground">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                  {step.title}
                </h3>
                <Link
                  href={step.href}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5",
                    "text-[12px] font-medium text-muted-foreground transition-colors",
                    "hover:bg-secondary hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {step.cta} <ArrowRight className="size-3" aria-hidden />
                </Link>
              </div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

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
                <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
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

      {/* Resident assurance heat map */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
            <Activity className="size-4 text-destructive" /> Resident assurance heat map
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

      {/* Resident assurance trend */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
              <Activity className="size-4 text-info" /> Resident assurance trend (7d)
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
                      <span className="text-[10px] font-mono text-muted-foreground">
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
