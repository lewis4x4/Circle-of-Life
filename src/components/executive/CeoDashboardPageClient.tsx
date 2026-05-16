"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Subtitle, TitleH1 } from "@/components/ui/typography";
import type { CeoAlertDisplay } from "@/lib/executive/load-ceo-dashboard-data";
import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { CEO_PALETTE } from "@/lib/moonshot-theme";

const CeoDashboardTabs = dynamic(
  () => import("@/components/executive/ceo/CeoDashboardTabs"),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="h-[360px] animate-pulse rounded-2xl border border-white/5 bg-slate-900/40" />
        <div className="h-[360px] animate-pulse rounded-2xl border border-white/5 bg-slate-900/40" />
      </div>
    ),
  },
);

const CEO_TABS = ["CEO View", "Alerts", "Reports", "Benchmarks", "Haven Insight"];

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
  const kpis = initialKpis;
  const displayAlerts = initialAlerts;

  const occupancyValue =
    kpis?.census.occupancyPct != null ? `${kpis.census.occupancyPct}%` : "—";
  const incidentsValue = kpis ? `${kpis.clinical.openIncidents}` : "—";
  const arValue = kpis
    ? `$${(kpis.financial.totalBalanceDueCents / 100).toLocaleString()}`
    : "—";
  const deficienciesValue = kpis
    ? `${kpis.compliance.openSurveyDeficiencies}`
    : "—";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <></>
      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            showTopNav={false}
            activeTopNav="command"
            activePillMenu={tab}
            onPillMenuChange={setTab}
            customPillTabs={CEO_TABS}
          />
        </div>

        <header className="px-6 py-8 sm:px-12">
          <div className="mb-4 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <Link
                href="/admin/executive"
                className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Executive Overview
              </Link>
              
              <TitleH1>Chief Executive Officer</TitleH1>
              <Subtitle>Enterprise Growth &amp; Risk Matrix</Subtitle>
            </div>
          </div>
          {initialError ? (
            <AdminLiveDataFallbackNotice
              message={initialError}
              onRetry={() => window.location.reload()}
            />
          ) : null}
        </header>

        <div className="space-y-6 px-6 pb-12 sm:px-12">
          <KineticGrid
            className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            staggerMs={50}
          >
            <MetricCardMoonshot
              label="PORTFOLIO OCCUPANCY"
              value={occupancyValue}
              color={CEO_PALETTE.positive}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="OPEN DEFICIENCIES"
              value={deficienciesValue}
              color={CEO_PALETTE.growth}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="TOTAL AR OUTSTANDING"
              value={arValue}
              color={CEO_PALETTE.info}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="OPEN INCIDENTS"
              value={incidentsValue}
              color={CEO_PALETTE.critical}
              showSparkline={false}
            />
          </KineticGrid>

          <CeoDashboardTabs tab={tab} displayAlerts={displayAlerts} />
        </div>
      </div>
    </div>
  );
}
