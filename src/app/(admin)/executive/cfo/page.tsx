"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Brain } from "lucide-react";

import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CFO_PALETTE } from "@/lib/moonshot-theme";
import { cn } from "@/lib/utils";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";

const CFO_TABS = [
  "Overview",
  "Revenue Cycle",
  "Labor Economics",
  "Cash & Liquidity",
  "Capex & Debt",
  "Budget Variance",
  "Scenarios",
  "Haven Insight",
];

const TAB_SOURCE_LABELS: Record<string, string> = {
  Overview: "P&L waterfall and monthly trend source",
  "Revenue Cycle": "resident billing, payer mix, and AR aging source",
  "Labor Economics": "payroll, agency, overtime, and staffing economics source",
  "Cash & Liquidity": "cash, collections, and payments source",
  "Capex & Debt": "capex project and debt schedule source",
  "Budget Variance": "budget-vs-actual ledger source",
  Scenarios: "finance scenario model source",
};

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/5 bg-slate-900/50 p-6 shadow-lg backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-white">{children}</h3>
      {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

function SourceStatusPanel({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <Panel>
        <SectionTitle sub="Waiting for the live executive KPI query to finish.">Loading live CFO data</SectionTitle>
        <p className="text-sm text-slate-400">No seeded finance values are rendered while the source is loading.</p>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <SectionTitle sub="The live CFO source returned an error.">Unable to load live CFO data</SectionTitle>
        <p className="text-sm text-rose-300">{error}</p>
        <p className="mt-2 text-sm text-slate-400">No seeded finance fallback is shown.</p>
      </Panel>
    );
  }

  return null;
}

function EmptyFinanceSourcePanel({ tab }: { tab: string }) {
  const sourceLabel = TAB_SOURCE_LABELS[tab] ?? "finance source";

  return (
    <Panel className="flex min-h-[320px] items-center justify-center">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-lg font-semibold text-white">Live {sourceLabel} is not loaded</p>
        <p className="text-sm text-slate-400">
          This CFO tab stays empty until real finance data is connected. No mock facility rows, AR aging tables, charts, budget values, or scenario assumptions are shown.
        </p>
      </div>
    </Panel>
  );
}

export default function CfoDashboardPage() {
  const [tab, setTab] = useState("Overview");
  const { kpis, loading, error } = useExecRoleKpis();

  const revenueValue = kpis
    ? `$${(kpis.financial.totalBalanceDueCents / 100).toLocaleString()}`
    : "—";
  const occupancyValue =
    kpis?.census.occupancyPct != null ? `${kpis.census.occupancyPct}%` : "—";
  const openInvoices = kpis ? `${kpis.financial.openInvoicesCount}` : "—";
  const certsExpiring = kpis ? `${kpis.workforce.certificationsExpiring30d}` : "—";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-indigo-900/10" secondaryClass="bg-amber-900/10" />
      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            showTopNav={false}
            activeTopNav="finance"
            activePillMenu={tab}
            onPillMenuChange={setTab}
            customPillTabs={CFO_TABS}
          />
        </div>
        <header className="px-6 py-8 sm:px-12">
          <div className="mb-4 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <Link href="/admin/executive" className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Executive Overview
              </Link>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Financial Officer</TitleH1>
              <Subtitle>Live finance command center. Empty tabs mean the real source is not connected yet.</Subtitle>
            </div>
          </div>
        </header>

        <div className="space-y-6 px-6 pb-12 sm:px-12">
          <SourceStatusPanel loading={loading} error={error} />

          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot
              label="TOTAL AR OUTSTANDING"
              value={revenueValue}
              color={CFO_PALETTE.positive}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="PORTFOLIO OCCUPANCY"
              value={occupancyValue}
              color={CFO_PALETTE.growth}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="OPEN INVOICES"
              value={openInvoices}
              color={CFO_PALETTE.info}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="CERTS EXPIRING 30D"
              value={certsExpiring}
              color="rose"
              showSparkline={false}
            />
          </KineticGrid>

          {tab === "Haven Insight" ? (
            <Panel className="flex min-h-[300px] items-center justify-center">
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/20 to-indigo-600/20">
                  <Brain className="h-7 w-7 text-violet-400" />
                </div>
                <p className="text-lg font-semibold text-white">Haven Insight</p>
                <p className="mx-auto max-w-md text-sm text-slate-400">
                  Ask questions about live finance data after source tables and imports are connected.
                </p>
                <Link
                  href="/admin/executive/nlq"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500"
                >
                  <Brain className="h-4 w-4" /> Open Haven Insight
                </Link>
              </div>
            </Panel>
          ) : (
            <EmptyFinanceSourcePanel tab={tab} />
          )}
        </div>
      </div>
    </div>
  );
}
