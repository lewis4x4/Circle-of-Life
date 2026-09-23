"use client";

import { formatDisplayDateTime } from "@/lib/format/datetime";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, LineChart } from "lucide-react";

import { QualityHubNav } from "./quality-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
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
import {
  deriveQualityHubState,
  QUALITY_HUB_LOADING_MESSAGE,
  resolveQualityHubFetchErrorBannerMessage,
  resolveQualityHubOrganizationGapMessage,
  resolveQualityHubQueryErrorMessage,
} from "@/lib/quality/quality-hub-page-state";
import { TableRow, TableRowHeader, TableRowList } from "@/components/ui/table-row";
import { KPITile } from "@/design-system/components/KPITile";
import { PageHeader } from "@/design-system/components/PageHeader";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { enumLabel } from "@/lib/display/enum-label";

export default function AdminQualityHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, user, organizationId, loading: authLoading } = useHavenAuth();

  const facilityReady =
    selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId);

  const {
    data,
    isPending,
    isError,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["quality", "hub", selectedFacilityId, organizationId],
    enabled: facilityReady && !!organizationId,
    queryFn: () => fetchQualityHubSnapshot(selectedFacilityId!, organizationId!),
  });

  const measures = data?.measures ?? [];
  const latest = data?.latest ?? [];
  const pbjRows = data?.pbjRows ?? [];

  const hasOrgScopedData = measures.length > 0 || latest.length > 0 || pbjRows.length > 0;

  const hubLoadState =
    !facilityReady || !organizationId
      ? "idle"
      : isPending
        ? "loading"
        : isError
          ? "error"
          : "ready";

  const hubState = deriveQualityHubState({
    authLoading,
    organizationId,
    loadState: hubLoadState,
    hasFacility: facilityReady,
  });

  const organizationGapMessage = resolveQualityHubOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });

  const fetchErrorBannerMessage = resolveQualityHubFetchErrorBannerMessage({
    authLoading,
    fetchError: resolveQualityHubQueryErrorMessage(queryError),
  });

  const hubLoading =
    hubState === "auth_loading" || hubState === "loading";

  const homeHref = useMemo(() => {
    const effectiveRole = getAppRoleFromClaims(user) || appRole;
    return effectiveRole ? getDashboardRouteForRole(effectiveRole) : "/admin";
  }, [appRole, user]);

  const noFacility = hubState === "no_facility";
  const noOrganization = hubState === "no_organization";
  const showHubContent = !noFacility && !organizationGapMessage && !hubLoading && !fetchErrorBannerMessage;

  const metricCtx = { noOrganization, loading: hubLoading };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <div className="relative z-10 space-y-8 max-w-6xl mx-auto">
      <PageHeader title="Measure catalog" />

      <QualityHubNav />

      {noFacility ? (
        <FacilityGateNotice reason="Measure results and PBJ batches are reported per building; the catalog is listed for that building's organization." />
      ) : null}

      {organizationGapMessage ? (
        <section
          aria-label="Organization scope required"
          className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 p-6"
        >
          <p className="text-sm text-muted-foreground">{organizationGapMessage}</p>
        </section>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice
          message={fetchErrorBannerMessage}
          onRetry={() => void refetch()}
        />
      ) : null}

      {hubState === "auth_loading" || hubState === "loading" ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {QUALITY_HUB_LOADING_MESSAGE}
        </p>
      ) : null}

      {noFacility ? null : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <KPITile
          label="Active measures"
          value={qualityHubMetricValue(measures.length, metricCtx)}
          info="Quality measures in the catalog for this building's organization."
        />
        <KPITile
          label="Latest snapshot rows"
          value={qualityHubMetricValue(latest.length, metricCtx)}
          info="Measure results in the most recent snapshot for this building."
        />
        <KPITile
          label="PBJ batches"
          value={qualityHubMetricValue(pbjRows.length, metricCtx)}
          info="Payroll-based journal staffing batches recorded for this building."
        />
      </div>
      )}

      {showHubContent ? (
        <>
      <Link href="/admin/quality/measures/new" className="group block focus-visible:outline-none mt-2">
        <div className="p-5 flex items-center gap-4 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:border-primary/40 hover:bg-muted/40 cursor-pointer">
          <div className="rounded-lg bg-primary/10 p-3 shadow-sm border border-primary/20 group-hover:bg-primary/20 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
            <LineChart className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-primary">
              Define a measure
            </h3>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Org admins add measures to the catalog (a short code for each, CMS tag optional).</p>
          </div>
        </div>
      </Link>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">Measures</h2>
        </div>
        
        {measures.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-muted rounded-lg border border-border max-w-xl mx-auto mt-8">
             <p className="font-medium">No catalog measures posted.</p>
             <p className="text-sm opacity-80 mt-1">Use &apos;Define a measure&apos; when your org is ready to add catalog rows.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <TableRowList label="Quality measures" minWidthClassName="min-w-[28rem]">
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
                    <span className="w-[90px] shrink-0 text-right text-[12px] font-medium text-foreground">{formatQualityHubMeasureUnit(m.unit)}</span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
            </TableRowList>
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <LineChart className="h-6 w-6 text-emerald-500 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-100">Latest Facilities Telemetry</h2>
        </div>
        
        {latest.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-muted rounded-lg border border-border max-w-xl mx-auto mt-8">
             <p className="font-medium">No telemetry rows posted.</p>
             <p className="text-sm opacity-80 mt-1">Import or enter results in a facility follow-up.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <TableRowList label="Latest facility results" minWidthClassName="min-w-[28rem]">
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
                    <span className="w-[110px] shrink-0 text-right text-[13px] font-medium text-foreground font-mono tabular-nums">
                      {formatQualityHubResultValue(r.value_numeric, r.value_text)}
                    </span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
            </TableRowList>
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-200">PBJ export batches</h2>
          </div>
        </div>
        
        {pbjRows.length === 0 ? (
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
                    <span className="flex-1 min-w-0 text-[12px] text-foreground capitalize truncate">{enumLabel(p.status)}</span>
                    <span className="w-[80px] shrink-0 text-right text-[12px] font-medium text-foreground tabular-nums">{formatQualityHubPbjRowCount(p.row_count)}</span>
                    <span className="w-[140px] shrink-0 text-right text-[11px] text-muted-foreground font-mono tabular-nums truncate">
                      {formatDisplayDateTime(p.created_at)}
                    </span>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        )}
      </div>
        </>
      ) : null}

      <div className="mt-4 text-sm">
        <Link href={homeHref} className={buttonVariants({ variant: "link", size: "sm" })}>
          Back to dashboard
        </Link>
      </div>
      </div>
    </div>
  );
}
