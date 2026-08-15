"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, LineChart } from "lucide-react";

import { QualityHubNav } from "./quality-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { fetchQualityHubSnapshot } from "@/lib/quality/load-quality-hub";
import {
  formatQualityHubMeasureName,
  formatQualityHubMeasureUnit,
  formatQualityHubPeriodEnd,
  formatQualityHubPeriodStart,
  formatQualityHubPbjRowCount,
  formatQualityHubResultValue,
  qualityHubMetricValue,
} from "@/lib/quality/quality-hub-display-copy";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

function qualityHubKpiClass(value: string | number): string {
  return typeof value === "number"
    ? "text-4xl font-mono tracking-tighter pb-1"
    : "text-[13px] font-medium leading-snug pb-1";
}

export default function AdminQualityHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, user, organizationId, loading: authLoading } = useHavenAuth();

  const facilityReady =
    selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId);

  const {
    data,
    isPending,
    error: queryError,
  } = useQuery({
    queryKey: ["quality", "hub", selectedFacilityId, organizationId],
    enabled: facilityReady && !!organizationId,
    queryFn: () => fetchQualityHubSnapshot(selectedFacilityId!, organizationId!),
  });

  const measures = data?.measures ?? [];
  const latest = data?.latest ?? [];
  const pbjRows = data?.pbjRows ?? [];

  const loading = authLoading || (facilityReady && isPending && !data);
  const loadError =
    !authLoading && facilityReady && !organizationId
      ? "Organization missing on profile."
      : queryError
        ? queryError instanceof Error
          ? queryError.message
          : "Could not load quality data."
        : null;

  const homeHref = useMemo(() => {
    const effectiveRole = getAppRoleFromClaims(user) || appRole;
    return effectiveRole ? getDashboardRouteForRole(effectiveRole) : "/admin";
  }, [appRole, user]);

  const noFacility = !facilityReady;
  const metricCtx = { noFacility, loading };
  const measuresKpi = qualityHubMetricValue(measures.length, metricCtx);
  const latestKpi = qualityHubMetricValue(latest.length, metricCtx);
  const pbjKpi = qualityHubMetricValue(pbjRows.length, metricCtx);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <div className="relative z-10 space-y-8 max-w-6xl mx-auto">
      <div>
        
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Measure Catalog
        </h1>
      </div>

      <QualityHubNav />

      {noFacility ? (
        <div className="rounded-lg bg-amber-50/40 dark:bg-amber-950/20 p-8 border border-amber-200/50 dark:border-amber-900/50 ">
          <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-300 mb-2">Facility Required</h3>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Select a facility in the header to load results and PBJ batches. Measures are listed for the facility&apos;s organization.
          </p>
        </div>
      ) : null}

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      <KineticGrid className="grid-cols-1 sm:grid-cols-3 gap-5" staggerMs={60}>
        <div className="h-[140px]">
          <V2Card className="border-primary-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]" hoverColor="indigo">
            <MonolithicWatermark value={loading ? 0 : measures.length} className="text-info/10 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-wider uppercase text-primary-600 dark:text-primary-400">
                 Active Measures
              </h3>
              <p className={cn("text-primary-600 dark:text-primary-400", qualityHubKpiClass(measuresKpi))}>{measuresKpi}</p>
            </div>
          </V2Card>
        </div>
        <div className="h-[140px]">
          <V2Card className="border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]" hoverColor="emerald">
            <MonolithicWatermark value={loading ? 0 : latest.length} className="text-success/10 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-wider uppercase text-emerald-600 dark:text-emerald-400">
                 Latest Snapshot Rows
              </h3>
              <p className={cn("text-emerald-600 dark:text-emerald-400", qualityHubKpiClass(latestKpi))}>{latestKpi}</p>
            </div>
          </V2Card>
        </div>
        <div className="h-[140px]">
          <V2Card className="border-slate-500/20 shadow-[inset_0_0_15px_rgba(100,116,139,0.05)]" hoverColor="slate">
            <MonolithicWatermark value={loading ? 0 : pbjRows.length} className="text-muted-foreground/10 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-wider uppercase text-slate-500 dark:text-slate-400">
                 PBJ Batches
              </h3>
              <p className={cn("text-slate-600 dark:text-slate-400", qualityHubKpiClass(pbjKpi))}>{pbjKpi}</p>
            </div>
          </V2Card>
        </div>
      </KineticGrid>

      <Link href="/admin/quality/measures/new" className="group block focus-visible:outline-none mt-2">
        <div className="p-5 flex items-center gap-4 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:border-primary/40 hover:bg-muted/40 cursor-pointer">
          <div className="rounded-lg bg-primary/10 p-3 shadow-sm border border-primary/20 group-hover:bg-primary/20 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
            <LineChart className="h-6 w-6 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-primary-700 dark:group-hover:text-primary-400">
              Define a measure
            </h3>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Org admins add catalog rows (<code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded text-slate-500">measure_key</code>, CMS tag optional).</p>
          </div>
        </div>
      </Link>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary-500 drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">Measure Catalog</h2>
        </div>
        
        {noFacility || loading ? (
          <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : measures.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-muted rounded-lg border border-border max-w-xl mx-auto mt-8">
             <p className="font-medium">No Baseline Quality Measures.</p>
             <p className="text-sm opacity-80 mt-1">Use &apos;Define a measure&apos; to populate standard telemetry data.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <TableRowHeader>
              <span className="flex-[2] min-w-0">Measure</span>
              <span className="flex-1 min-w-0">Key / Domain</span>
              <span className="w-[90px] shrink-0 text-right">Unit</span>
            </TableRowHeader>
            <MotionList className="space-y-1 p-1">
              {measures.map((m) => (
                <MotionItem key={m.id}>
                  <TableRow>
                    <span className="flex-[2] min-w-0 text-[13px] font-medium text-foreground truncate">{formatQualityHubMeasureName(m.name)}</span>
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground truncate">{m.measure_key}</span>
                      {m.domain ? <span className="text-[11px] text-muted-foreground truncate">· {m.domain}</span> : null}
                    </span>
                    <span className="w-[90px] min-w-0 shrink-0 truncate text-right text-[12px] font-medium text-foreground">{formatQualityHubMeasureUnit(m.unit)}</span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <LineChart className="h-6 w-6 text-emerald-500 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">Latest Facilities Telemetry</h2>
        </div>
        
        {noFacility || loading ? (
           <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : latest.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-muted rounded-lg border border-border max-w-xl mx-auto mt-8">
             <p className="font-medium">No Results.</p>
             <p className="text-sm opacity-80 mt-1">Import or enter results in a facility follow-up.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <TableRowHeader>
              <span className="flex-[2] min-w-0">Measure</span>
              <span className="flex-1 min-w-0">Period</span>
              <span className="w-[110px] shrink-0 text-right">Value</span>
            </TableRowHeader>
            <MotionList className="space-y-1 p-1">
              {latest.map((r) => (
                <MotionItem key={r.id ?? `${r.quality_measure_id}-${r.period_end}`}>
                  <TableRow>
                    <span className="flex-[2] min-w-0 text-[13px] font-medium text-foreground truncate">{formatQualityHubMeasureName(r.quality_measures?.name)}</span>
                    <span className="flex-1 min-w-0 text-[11px] text-muted-foreground font-mono tabular-nums truncate">
                      {formatQualityHubPeriodStart(r.period_start)} → {formatQualityHubPeriodEnd(r.period_end)}
                    </span>
                    <span className="w-[110px] min-w-0 shrink-0 truncate text-right text-[13px] font-medium text-foreground font-mono tabular-nums">
                      {formatQualityHubResultValue(r.value_numeric, r.value_text)}
                    </span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-200">PBJ export batches</h2>
          </div>
        </div>
        
        {noFacility || loading ? (
          <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : pbjRows.length === 0 ? (
          <div className="text-center text-muted-foreground bg-muted rounded-lg border border-border max-w-xl mx-auto mt-4 px-8 py-6">
             <p className="font-medium text-sm">No PBJ batches recorded.</p>
             <p className="text-xs opacity-80 mt-1">Generation ships in Enhanced.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <TableRowHeader>
              <span className="flex-[2] min-w-0">Period</span>
              <span className="flex-1 min-w-0">Status</span>
              <span className="w-[80px] shrink-0 text-right">Rows</span>
              <span className="w-[140px] shrink-0 text-right">Created</span>
            </TableRowHeader>
            <MotionList className="space-y-1 p-1">
              {pbjRows.map((p) => (
                <MotionItem key={p.id}>
                  <TableRow>
                    <span className="flex-[2] min-w-0 text-[12px] font-mono text-foreground tabular-nums truncate">{p.period_start} → {p.period_end}</span>
                    <span className="flex-1 min-w-0 text-[12px] text-foreground capitalize truncate">{p.status.replace(/_/g, " ")}</span>
                    <span className="w-[80px] min-w-0 shrink-0 truncate text-right text-[12px] font-medium text-foreground tabular-nums">{formatQualityHubPbjRowCount(p.row_count)}</span>
                    <span className="w-[140px] shrink-0 text-right text-[11px] text-muted-foreground font-mono tabular-nums truncate">
                      {new Date(p.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-500 font-mono tracking-wider uppercase mt-4">
        <span>Dashboard:</span>
        <Link href={homeHref} className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-[10px] text-primary-600 dark:text-primary-400 leading-none pb-0.5")}>
          Back to dashboard
        </Link>
      </div>
      </div>
    </div>
  );
}
