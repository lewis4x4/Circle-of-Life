"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Subtitle, SysLabel, TitleH1 } from "@/components/ui/moonshot/typography";
import { isDemoMode } from "@/lib/demo-mode";
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

const DEMO_ALERTS: CeoAlertDisplay[] = [
  {
    id: "demo-1",
    severity: "critical",
    title: "Occupancy Below 85% — Oakridge",
    description:
      "Dropped from 86.2% to 84.1% over 14 days. Cash flow break-even requires >88%.",
    facility: "Oakridge ALF",
    age: "2h ago",
  },
  {
    id: "demo-2",
    severity: "critical",
    title: "Staffing Ratio Breach — Cedar Park Night Shift",
    description:
      "Night shift at 5/7 required (71%). Agency unable to fill 2 remaining slots.",
    facility: "Cedar Park",
    age: "4h ago",
  },
  {
    id: "demo-3",
    severity: "warning",
    title: "AR > 90 Days Exceeds Threshold — Cedar Park",
    description:
      "$60K in AR over 90 days, up 40% from prior month. Collection activities initiated.",
    facility: "Cedar Park",
    age: "1d ago",
  },
  {
    id: "demo-4",
    severity: "warning",
    title: "Medication Error Rate Elevated — Plantation",
    description: "3 errors in past 7 days (vs 0.8 avg). Root cause analysis requested.",
    facility: "Plantation",
    age: "1d ago",
  },
  {
    id: "demo-5",
    severity: "warning",
    title: "Survey Deficiency Open > 30 Days",
    description:
      "Tag F-241 dignity violation POC still in draft status. Due date approaching.",
    facility: "Homewood Lodge",
    age: "3d ago",
  },
  {
    id: "demo-6",
    severity: "info",
    title: "Lease Renewal Due — Grande Cypress",
    description:
      "Commercial lease expires Aug 2026. Renewal negotiation should begin.",
    facility: "Grande Cypress",
    age: "5d ago",
  },
];

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
  const demo = isDemoMode();

  const kpis = initialKpis;
  const displayAlerts = initialAlerts.length > 0 ? initialAlerts : DEMO_ALERTS;

  const occupancyValue =
    kpis?.census.occupancyPct != null ? `${kpis.census.occupancyPct}%` : "91.8%";
  const incidentsValue = kpis ? `${kpis.clinical.openIncidents}` : "1.2x";
  const arValue = kpis
    ? `$${(kpis.financial.totalBalanceDueCents / 100).toLocaleString()}`
    : "342";
  const deficienciesValue = kpis
    ? `${kpis.compliance.openSurveyDeficiencies}`
    : "+18";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix
        primaryClass="bg-indigo-900/10"
        secondaryClass="bg-emerald-900/10"
      />
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
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
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
          {demo ? (
            <div className="rounded-[1.5rem] border border-amber-300/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-900 shadow-sm backdrop-blur-xl dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              Demo data mode is active on this CEO view. KPIs, alerts, and
              comparative charts may include illustrative values when live
              executive data is missing.
            </div>
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
              trend="up"
              trendValue={demo ? "+2.3%" : undefined}
              sparklineVariant={2}
            />
            <MetricCardMoonshot
              label="OPEN DEFICIENCIES"
              value={deficienciesValue}
              color={CEO_PALETTE.growth}
              trend="flat"
              sparklineVariant={1}
            />
            <MetricCardMoonshot
              label="TOTAL AR OUTSTANDING"
              value={arValue}
              color={CEO_PALETTE.info}
              trend="flat"
              sparklineVariant={3}
            />
            <MetricCardMoonshot
              label="OPEN INCIDENTS"
              value={incidentsValue}
              color={CEO_PALETTE.critical}
              trend="flat"
              sparklineVariant={4}
            />
          </KineticGrid>

          <CeoDashboardTabs tab={tab} displayAlerts={displayAlerts} />
        </div>
      </div>
    </div>
  );
}
