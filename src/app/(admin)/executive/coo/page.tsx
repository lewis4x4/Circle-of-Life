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
import { COO_PALETTE } from "@/lib/moonshot-theme";
import { cn } from "@/lib/utils";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";

const COO_TABS = [
  "Operations Hub",
  "Staffing",
  "Maintenance",
  "Dining",
  "Satisfaction",
  "Move Ops",
  "Vendors",
  "Readiness",
  "Haven Insight",
];

const TAB_SOURCE_LABELS: Record<string, string> = {
  "Operations Hub": "operations alert and transport source",
  Staffing: "schedule, shift coverage, and agency source",
  Maintenance: "work-order and preventive maintenance source",
  Dining: "dietary operations source",
  Satisfaction: "family and resident satisfaction source",
  "Move Ops": "admissions and move operations source",
  Vendors: "vendor and contract source",
  Readiness: "survey readiness and emergency-preparedness source",
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
        <SectionTitle sub="Waiting for the live executive KPI query to finish.">Loading live COO data</SectionTitle>
        <p className="text-sm text-slate-400">Operations values stay empty while the live source is loading.</p>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <SectionTitle sub="The live COO source returned an error.">Unable to load live COO data</SectionTitle>
        <p className="text-sm text-rose-300">{error}</p>
        <p className="mt-2 text-sm text-slate-400">No operations fallback is shown.</p>
      </Panel>
    );
  }

  return null;
}

function EmptyOperationsSourcePanel({ tab }: { tab: string }) {
  const sourceLabel = TAB_SOURCE_LABELS[tab] ?? "operations source";

  return (
    <Panel className="flex min-h-[320px] items-center justify-center">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-lg font-semibold text-white">Live {sourceLabel} is not loaded</p>
        <p className="text-sm text-slate-400">
          This COO tab stays empty until real operational data is connected. No mock alerts, residents, work orders, transport rows, staffing grids, vendor rows, or readiness scores are shown.
        </p>
      </div>
    </Panel>
  );
}

export default function CooDashboardPage() {
  const [tab, setTab] = useState("Operations Hub");
  const { kpis, loading, error } = useExecRoleKpis();

  const openIncidents = kpis ? `${kpis.clinical.openIncidents}` : "—";
  const medErrors = kpis ? `${kpis.clinical.medicationErrorsMtd}` : "—";
  const activeOutbreaks = kpis ? `${kpis.infection.activeOutbreaks}` : "—";
  const overdueTasks = kpis ? `${kpis.residentAssurance.overdueTasksCount}` : "—";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-sky-900/10" secondaryClass="bg-emerald-900/10" />
      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            showTopNav={false}
            activeTopNav="clinical"
            activePillMenu={tab}
            onPillMenuChange={setTab}
            customPillTabs={COO_TABS}
          />
        </div>
        <header className="px-6 py-8 sm:px-12">
          <div className="mb-4 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <Link href="/admin/executive" className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Executive Overview
              </Link>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Operating Officer</TitleH1>
              <Subtitle>Live operations command center. Empty tabs mean the real source is not connected yet.</Subtitle>
            </div>
          </div>
        </header>

        <div className="space-y-6 px-6 pb-12 sm:px-12">
          <SourceStatusPanel loading={loading} error={error} />

          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot
              label="OPEN INCIDENTS"
              value={openIncidents}
              color={COO_PALETTE.critical}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="MED ERRORS MTD"
              value={medErrors}
              color={COO_PALETTE.growth}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="ACTIVE OUTBREAKS"
              value={activeOutbreaks}
              color={COO_PALETTE.info}
              showSparkline={false}
            />
            <MetricCardMoonshot
              label="OVERDUE TASKS"
              value={overdueTasks}
              color={COO_PALETTE.positive}
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
                  Ask questions about live operations data after source tables and imports are connected.
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
            <EmptyOperationsSourcePanel tab={tab} />
          )}
        </div>
      </div>
    </div>
  );
}
