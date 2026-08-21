"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminOperationalListPanel,
} from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import {
  HavenInsightPanel,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  OfficerLinkOutPanel,
  officerAlarmTone,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  formatExecutiveArOutstandingCents,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOpenIncidentCount,
  formatExecutiveSurveyDeficiencyCount,
  executivePortfolioOccupancyFootnote,
  resolveOfficerOccupancyTileLabel,
} from "@/lib/executive/executive-display-copy";
import type { CeoAlertDisplay } from "@/lib/executive/load-ceo-dashboard-data";
import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

const CEO_TABS = ["CEO View", "Alerts", "Reports", "Benchmarks", "Haven Insight"];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function ceoSeverityTone(severity: CeoAlertDisplay["severity"]): StatusPillTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function CeoAlertsWatchlist({ alerts }: { alerts: CeoAlertDisplay[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> Active alerts &amp; escalations
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
        </span>
      </div>
      {alerts.length === 0 ? (
        <AdminEmptyState
          title="No critical alerts"
          description="Executive-level exceptions across the portfolio will appear here as they trigger."
        />
      ) : (
        <AdminOperationalListPanel>
          <div className="divide-y divide-border">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                <StatusPill tone={ceoSeverityTone(alert.severity)} className="mt-0.5 shrink-0">
                  {alert.severity}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">{alert.title}</p>
                  {alert.description ? (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{alert.description}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {alert.facility} · {alert.age}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </AdminOperationalListPanel>
      )}
    </section>
  );
}

type CeoDashboardPageClientProps = {
  initialKpis: ExecKpiPayload | null;
  initialAlerts: CeoAlertDisplay[];
  initialError: string | null;
};

export default function CeoDashboardPageClient({
  initialKpis,
  initialAlerts,
  initialError,
}: CeoDashboardPageClientProps) {
  const [tab, setTab] = useState("CEO View");
  const { organizationId, loading: authLoading } = useHavenAuth();
  const kpis = initialKpis;
  const displayAlerts = initialAlerts;

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: kpis != null,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError: initialError,
  });
  const showKpiSkeleton = authLoading && kpis == null;

  const occupancyPct = kpis?.census.occupancyPct;
  const occupancyScope = kpis?.census.occupancyScope;
  const deficiencies = kpis?.compliance.openSurveyDeficiencies;
  const arCents = kpis?.financial.totalBalanceDueCents;
  const openIncidents = kpis?.clinical.openIncidents;

  const occValue = formatExecutiveOccupancyPctWithSuffix(occupancyPct);
  const occupancyLabel = resolveOfficerOccupancyTileLabel(false, occupancyScope);
  const occupancyFootnote = executivePortfolioOccupancyFootnote(occupancyScope);
  const deficienciesValue = formatExecutiveSurveyDeficiencyCount(deficiencies);
  const arValue = formatExecutiveArOutstandingCents(arCents);
  const incidentsValue = formatExecutiveOpenIncidentCount(openIncidents);

  const lanes: OfficerLane[] = [
    {
      stat: arCents == null ? "Financials" : `${money.format(arCents / 100)} AR`,
      title: "Finance hub",
      description: "Billed revenue, labor pressure, and monthly financials.",
      href: "/admin/finance",
    },
    {
      stat: "Claims & renewals",
      title: "Insurance & risk",
      description: "Policies, renewals, and portfolio risk posture.",
      href: "/admin/insurance",
    },
    {
      stat: "Facility compare",
      title: "Benchmarks",
      description: "Facility-vs-facility performance and cohorts.",
      href: "/admin/executive/benchmarks",
    },
    {
      stat: "Board packets",
      title: "Reports",
      description: "Executive KPI exports and board-packet archive.",
      href: "/admin/executive/reports",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <div className="border-b border-border">
        <ExecutiveNavV2
          showTopNav={false}
          activeTopNav="command"
          activePillMenu={tab}
          onPillMenuChange={setTab}
          customPillTabs={CEO_TABS}
        />
      </div>

      <OfficerHeader title="Chief Executive Officer" subtitle="Enterprise growth & risk — all facilities." />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => window.location.reload()} />
        ) : null}

        {showKpiSkeleton ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <OfficerKpiStrip>
              <OfficerKpiTile label={occupancyLabel} value={occValue} />
              <OfficerKpiTile label="Open deficiencies" value={deficienciesValue} tone={officerAlarmTone(deficiencies, "warning")} />
              <OfficerKpiTile label="Total AR outstanding" value={arValue} />
              <OfficerKpiTile label="Open incidents" value={incidentsValue} tone={officerAlarmTone(openIncidents, "danger")} />
            </OfficerKpiStrip>
            {occupancyFootnote ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">{occupancyFootnote}</p>
            ) : null}
          </div>
        )}

        {!showKpiSkeleton && tab === "CEO View" ? (
          <>
            <OfficerLanes lanes={lanes} subheading="Leadership decisions and portfolio drill-ins." />
            <CeoAlertsWatchlist alerts={displayAlerts} />
          </>
        ) : !showKpiSkeleton && tab === "Alerts" ? (
          <CeoAlertsWatchlist alerts={displayAlerts} />
        ) : !showKpiSkeleton && tab === "Reports" ? (
          <OfficerLinkOutPanel
            title="Executive reports"
            description="Portfolio KPI exports (CSV / print) and the board-packet archive."
            href="/admin/executive/reports"
            cta="Open reports"
          />
        ) : !showKpiSkeleton && tab === "Benchmarks" ? (
          <OfficerLinkOutPanel
            title="Portfolio benchmarks"
            description="Facility-vs-facility comparison across occupancy, labor, incidents, and survey readiness."
            href="/admin/executive/benchmarks"
            cta="Open benchmarks"
          />
        ) : !showKpiSkeleton ? (
          <HavenInsightPanel domain="portfolio" />
        ) : null}
      </div>
    </div>
  );
}
