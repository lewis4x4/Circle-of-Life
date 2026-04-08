"use client";

import { useMemo } from "react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CooAgencyBurnChart, CooIncidentDensityChart } from "@/components/ui/moonshot/executive-charts";

const MOCK_AGENCY_DATA = [
  { month: "Sep", fteHours: 12400, agencyHours: 850 },
  { month: "Oct", fteHours: 12500, agencyHours: 1100 },
  { month: "Nov", fteHours: 12300, agencyHours: 2400 },
  { month: "Dec", fteHours: 12200, agencyHours: 3100 },
  { month: "Jan", fteHours: 12800, agencyHours: 1800 },
  { month: "Feb", fteHours: 13000, agencyHours: 600 },
];

const MOCK_INCIDENT_DATA = [
  { week: "W1", falls: 4, medErrors: 1, behavioral: 2 },
  { week: "W2", falls: 6, medErrors: 0, behavioral: 3 },
  { week: "W3", falls: 3, medErrors: 2, behavioral: 5 },
  { week: "W4", falls: 5, medErrors: 0, behavioral: 2 },
  { week: "W5", falls: 4, medErrors: 1, behavioral: 4 },
  { week: "W6", falls: 2, medErrors: 0, behavioral: 1 },
];

export default function CooDashboardPage() {
  const metrics = useMemo(() => ({
    med_pass: { value: "98.9%", color: "emerald" },
    staff_fill: { value: "93.4%", color: "amber" },
    inc_rate: { value: "3.5", color: "rose" },
    audits: { value: "14 Open", color: "blue" }
  }), []);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-blue-900/10" secondaryClass="bg-emerald-900/10" />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Command Center</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Chief Operating Officer
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">Enterprise Operations & Clinical Safety</p>
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
                   Med-Pass Compliance
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">{metrics.med_pass.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
               <Sparkline colorClass="text-amber-500" variant={1} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-500 flex items-center gap-2">
                   Staffing Schedule Fill
                 </h3>
                 <div className="flex items-end gap-2 pb-1">
                   <p className="text-3xl font-mono tracking-tighter text-amber-600 dark:text-amber-500">{metrics.staff_fill.value}</p>
                 </div>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
               <Sparkline colorClass="text-rose-500" variant={3} />
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Incidents / 1k Days
                 </h3>
                 <p className="text-3xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1">{metrics.inc_rate.value}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[120px]">
             <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[inset_0_0_15px_rgba(59,130,246,0.05)]">
               <div className="relative z-10 flex flex-col h-full justify-between">
                 <h3 className="text-[10px] font-mono tracking-widest uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
                   Open Corrective Actions
                 </h3>
                 <p className="text-2xl font-mono tracking-tighter text-blue-600 dark:text-blue-400 pb-1 mt-auto leading-tight">{metrics.audits.value}</p>
               </div>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Nursing Agency Burn & Churn</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">FTE contracted hours vs variable emergency staffing density.</p>
             <div className="flex-1 min-h-0">
               <CooAgencyBurnChart data={MOCK_AGENCY_DATA} />
             </div>
          </div>
          <div className="h-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Safety Risk Dispersion Matrix</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Stacked incident volume broken down by acuity classifications.</p>
             <div className="flex-1 min-h-0">
               <CooIncidentDensityChart data={MOCK_INCIDENT_DATA} />
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
