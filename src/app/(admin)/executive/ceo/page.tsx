"use client";

import { useMemo } from "react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CeoGrowthChart, CeoRiskChart } from "@/components/ui/moonshot/executive-charts";

const MOCK_GROWTH_DATA = [
  { month: "Jan", tours: 12, moveIns: 4 },
  { month: "Feb", tours: 18, moveIns: 6 },
  { month: "Mar", tours: 24, moveIns: 10 },
  { month: "Apr", tours: 20, moveIns: 8 },
  { month: "May", tours: 32, moveIns: 15 },
  { month: "Jun", tours: 40, moveIns: 22 },
  { month: "Jul", tours: 38, moveIns: 20 },
  { month: "Aug", tours: 45, moveIns: 26 },
  { month: "Sep", tours: 52, moveIns: 30 },
  { month: "Oct", tours: 48, moveIns: 33 },
  { month: "Nov", tours: 60, moveIns: 42 },
  { month: "Dec", tours: 65, moveIns: 48 },
];

const MOCK_RISK_DATA = [
  { facility: "Grande Cypress", criticalIncidents: 1, reputationInverse: 48 },
  { facility: "Homewood Lodge", criticalIncidents: 4, reputationInverse: 39 },
  { facility: "Oakridge", criticalIncidents: 12, reputationInverse: 25 },
  { facility: "Plantation", criticalIncidents: 0, reputationInverse: 49 },
  { facility: "Rising Oaks", criticalIncidents: 2, reputationInverse: 45 },
];

export default function CeoDashboardPage() {
  // Static placeholders for V1 CEO Dashboard since data pipelines are still hydrating
  const metrics = useMemo(() => ({
    occ_pt: { value: "86.1%", trend: "up", color: "emerald" },
    move_ins: { value: "48", trend: "up", color: "indigo" },
    waitlist: { value: "112", color: "indigo" },
    inc_rate: { value: "3.5", trend: "down", color: "rose" },
    survey_rd: { value: "86.4%", color: "blue" },
  }), []);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-900/10" secondaryClass="bg-emerald-900/10" />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Command Center</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Chief Executive Officer
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">Enterprise Growth & Risk Matrix</p>
            </div>
            <div className="hidden md:block">
              <ExecutiveHubNav />
            </div>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" staggerMs={50}>
          <div className="h-[120px]">
             <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
               <Sparkline colorClass="text-emerald-500" variant={2} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Portfolio Occupancy
                 </h3>
                 <div className="flex items-end gap-2 pb-1">
                   <p className="text-3xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400">{metrics.occ_pt.value}</p>
                 </div>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
               <Sparkline colorClass="text-indigo-500" variant={1} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                   Net Move-ins MTD
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{metrics.move_ins.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[inset_0_0_15px_rgba(59,130,246,0.05)]">
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
                   Total Waitlist Pipeline
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-blue-600 dark:text-blue-400 pb-1">{metrics.waitlist.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Enterprise Quality Risk Map
                 </h3>
                 <p className="text-xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1 mt-auto leading-tight">2 Facilities Elevated</p>
               </div>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Growth & Acumen Funnel</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Tours vs Move-in conversion pipeline over trailing 12 months.</p>
             <div className="flex-1 min-h-0">
               <CeoGrowthChart data={MOCK_GROWTH_DATA} />
             </div>
          </div>
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Legal & Reputation Risk Index</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Severe Incidents (L3/L4) relative to Public Reputation scoring.</p>
             <div className="flex-1 min-h-0">
               <CeoRiskChart data={MOCK_RISK_DATA} />
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
