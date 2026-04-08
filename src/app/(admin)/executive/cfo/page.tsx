"use client";

import { useMemo } from "react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CfoLaborDonutChart, CfoRevenueMatrixChart } from "@/components/ui/moonshot/executive-charts";

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

export default function CfoDashboardPage() {
  const metrics = useMemo(() => ({
    rev_mtd: { value: "$84.5M", color: "indigo" },
    col_mtd: { value: "$82.1M", color: "indigo" },
    labor_pct: { value: "54.5%", color: "amber" },
    aging_ar: { value: "$4.2M", color: "rose" }
  }), []);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-900/10" secondaryClass="bg-amber-900/10" />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Command Center</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Chief Financial Officer
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">Enterprise Revenue & Margin Strategy</p>
            </div>
            <div className="hidden md:block">
              <ExecutiveHubNav />
            </div>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" staggerMs={50}>
          <div className="h-[120px]">
             <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
               <Sparkline colorClass="text-indigo-500" variant={1} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                   Billed Revenue MTD
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{metrics.rev_mtd.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
               <Sparkline colorClass="text-indigo-500" variant={2} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                   Cash Collected
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{metrics.col_mtd.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
               <Sparkline colorClass="text-amber-500" variant={3} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-500 flex items-center gap-2">
                   Total Labor Cost %
                 </h3>
                 <div className="flex items-end gap-2 pb-1">
                   <p className="text-3xl font-mono tracking-tighter text-amber-600 dark:text-amber-500">{metrics.labor_pct.value}</p>
                 </div>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Aging AR &gt; 60 Days
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1">{metrics.aging_ar.value}</p>
               </div>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Labor vs Non-Labor Expenditure</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Year-to-date trailing payroll allocation.</p>
             <div className="flex-1 min-h-0">
               <CfoLaborDonutChart data={MOCK_LABOR_DATA} />
             </div>
          </div>
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Revenue Leakage Matrix</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Collected revenue relative to outstanding aging balances.</p>
             <div className="flex-1 min-h-0">
               <CfoRevenueMatrixChart data={MOCK_REVENUE_DATA} />
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
