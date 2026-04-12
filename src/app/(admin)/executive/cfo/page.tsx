"use client";

/**
 * Moonshot CFO Command Center
 *
 * Stunning, interactive financial dashboard for CFO-level decision-making.
 * Features portfolio P&L waterfall, monthly trends, and financial risk metrics.
 */

import React, { useState, useMemo } from "react";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { SurveyVisitBanner } from "@/components/executive/survey-visit-banner";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CfoLaborDonutChart, CfoRevenueMatrixChart } from "@/components/ui/moonshot/executive-charts";
import { isDemoMode } from "@/lib/demo-mode";
import { CFO_PALETTE } from "@/lib/moonshot-theme";

// ── MOCK DATA (DEMO MODE) ──

const MOCK_LABOR_DATA = [
  { name: "Direct Care Nursing", value: 2420000 },
  { name: "Care Aides", value: 1310000 },
  { name: "Operations & Admin", value: 1240000 },
];

const MOCK_REVENUE_DATA = [
  { month: "Sep", collected: 6800000, ar30: 420000, ar60: 150000 },
  { month: "Oct", collected: 7100000, ar30: 380000, ar60: 180000 },
  { month: "Nov", collected: 7400000, ar30: 450000, ar60: 120000 },
  { month: "Dec", collected: 7200000, ar30: 510000, ar60: 190000 },
  { month: "Jan", collected: 8100000, ar30: 390000, ar60: 210000 },
  { month: "Feb", collected: 8450000, ar30: 410000, ar60: 140000 },
];

// ── MAIN COMPONENT ──

export default function CfoDashboardPage() {
  const demo = isDemoMode();
  const [activePillMenu, setActivePillMenu] = useState("Overview");

  // Get metrics based on demo mode
  const metrics = useMemo(() => {
    if (!demo) {
      return {
        revMtd: { value: "—", color: "slate" as const },
        colMtd: { value: "—", color: "slate" as const },
        laborPct: { value: "—", color: "slate" as const },
        agingAr: { value: "—", color: "slate" as const },
      };
    }
    return {
      revMtd: { value: "$84.5M", color: "indigo" as const },
      colMtd: { value: "$82.1M", color: "indigo" as const },
      laborPct: { value: "54.5%", color: "amber" as const },
      agingAr: { value: "$4.2M", color: "rose" as const },
    };
  }, [demo]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix
        hasCriticals={false}
        primaryClass="bg-indigo-900/10"
        secondaryClass="bg-amber-900/10"
      />

      <div className="relative z-10 space-y-6">
        {/* Survey Visit Mode Banner */}
        <SurveyVisitBanner />

        {/* Enhanced Navigation */}
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            activeTopNav="finance"
            activePillMenu={activePillMenu as any}
            onPillMenuChange={setActivePillMenu}
          />
        </div>

        {/* Header Section */}
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <SysLabel>SYS: Command Center</SysLabel>
              <TitleH1>Chief Financial Officer</TitleH1>
              <Subtitle>Enterprise Revenue & Margin Strategy</Subtitle>
            </div>
          </div>
        </header>

        {/* Metric Cards */}
        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" staggerMs={50}>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="Billed Revenue MTD"
               value={metrics.revMtd.value}
               color={metrics.revMtd.color}
               sparklineVariant={1}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="Cash Collected"
               value={metrics.colMtd.value}
               color={metrics.colMtd.color}
               sparklineVariant={2}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="Total Labor Cost %"
               value={metrics.laborPct.value}
               color={metrics.laborPct.color}
               sparklineVariant={3}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="Aging AR &gt; 60 Days"
               value={metrics.agingAr.value}
               color={metrics.agingAr.color}
               sparklineVariant={4}
             />
          </div>
        </KineticGrid>

        {/* Chart Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Labor vs Non-Labor Expenditure</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Year-to-date trailing payroll allocation.</p>
             <div className="flex-1 min-h-0">
               {demo ? (
                 <CfoLaborDonutChart data={MOCK_LABOR_DATA} />
               ) : (
                 <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                   <p className="text-sm text-slate-600 dark:text-slate-400">No labor allocation data.</p>
                 </div>
               )}
             </div>
          </div>
          <div className="h-80 rounded-xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Revenue Leakage Matrix</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Collected revenue relative to outstanding aging balances.</p>
             <div className="flex-1 min-h-0">
               {demo ? (
                 <CfoRevenueMatrixChart data={MOCK_REVENUE_DATA} />
               ) : (
                 <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                   <p className="text-sm text-slate-600 dark:text-slate-400">No revenue matrix data.</p>
                 </div>
               )}
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
