"use client";

/**
 * Moonshot COO Command Center
 *
 * Stunning, interactive operational dashboard for COO-level decision-making.
 * Features real-time operations, staffing, maintenance, dining, and satisfaction metrics.
 */

import React, { useState, useMemo } from "react";
import { SysLabel, TitleH1, Subtitle, MetricValue } from "@/components/ui/moonshot/typography";
import { SurveyVisitBanner } from "@/components/executive/survey-visit-banner";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CooAgencyBurnChart, CooIncidentDensityChart } from "@/components/ui/moonshot/executive-charts";
import { isDemoMode } from "@/lib/demo-mode";
import { COO_PALETTE } from "@/lib/moonshot-theme";

// ── MOCK DATA (DEMO MODE) ──

const MOCK_AGENCY_DATA = [
  { month: "Sep", fteHours: 124000, agencyHours: 850 },
  { month: "Oct", fteHours: 125000, agencyHours: 1100 },
  { month: "Nov", fteHours: 123000, agencyHours: 2400 },
  { month: "Dec", fteHours: 122000, agencyHours: 3100 },
  { month: "Jan", fteHours: 128000, agencyHours: 1800 },
  { month: "Feb", fteHours: 130000, agencyHours: 600 },
];

const MOCK_INCIDENT_DATA = [
  { week: "W1", falls: 4, medErrors: 1, behavioral: 2 },
  { week: "W2", falls: 6, medErrors: 0, behavioral: 3 },
  { week: "W3", falls: 3, medErrors: 2, behavioral: 5 },
  { week: "W4", falls: 5, medErrors: 0, behavioral: 2 },
  { week: "W5", falls: 4, medErrors: 1, behavioral: 4 },
  { week: "W6", falls: 2, medErrors: 0, behavioral: 1 },
];

// Operational metrics
const MOCK_METRICS = {
  shiftFillRate: { value: "93.4%", trend: "up" as const, trendValue: "+1.8%" },
  openWorkOrders: { value: "58", trend: "down" as const, trendValue: "-3" },
  satisfaction: { value: "4.3 / 5.0", trend: "up" as const, trendValue: "+0.2" },
  moveIns: { value: "3", trend: "flat" as const, trendValue: "" },
};

// ── MAIN COMPONENT ──

export default function CooDashboardPage() {
  const demo = isDemoMode();
  const [activePillMenu, setActivePillMenu] = useState("Operations Hub");

  // Get metrics based on demo mode
  const metrics = useMemo(() => {
    if (!demo) {
      return {
        shiftFillRate: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        openWorkOrders: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        satisfaction: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        moveIns: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
      };
    }
    return MOCK_METRICS;
  }, [demo]);

  // Status badge component
  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, { bg: string; color: string; border: string; label: string }> = {
      completed: { bg: "bg-emerald-500/20", color: "text-emerald-500", border: "border-emerald-500/40", label: "DONE" },
      "in-transit": { bg: "bg-sky-500/20", color: "text-sky-500", border: "border-sky-500/40", label: "EN ROUTE" },
      scheduled: { bg: "bg-slate-500/10", color: "text-slate-400", border: "border-slate-500/20", label: "SCHED" },
      escalated: { bg: "bg-rose-500/20", color: "text-rose-500", border: "border-rose-500/40", label: "ESCALATED" },
    };
    const s = map[status] || map.scheduled;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em] px-2.5 py-1 rounded-full" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
        {s.label}
      </span>
    );
  };

  // Priority badge component
  const PriorityBadge = ({ priority }: { priority: string }) => {
    const map: Record<string, { bg: string; color: string; border: string }> = {
      urgent: { bg: "bg-rose-500/20", color: "text-rose-500", border: "border-rose-500/40" },
      high: { bg: "bg-amber-500/20", color: "text-amber-500", border: "border-amber-500/40" },
      medium: { bg: "bg-sky-500/20", color: "text-sky-500", border: "border-sky-500/40" },
      low: { bg: "bg-slate-500/10", color: "text-slate-400", border: "border-slate-500/20" },
    };
    const p = map[priority] || map.medium;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em] px-2.5 py-1 rounded-full" style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}`, textTransform: "uppercase" }}>
        {priority}
      </span>
    );
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix
        hasCriticals={metrics.openWorkOrders.trend === "up"}
        primaryClass="bg-sky-900/10"
        secondaryClass="bg-emerald-900/10"
      />

      <div className="relative z-10 space-y-6">
        {/* Survey Visit Mode Banner */}
        <SurveyVisitBanner />

        {/* Enhanced Navigation */}
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            activeTopNav="clinical"
            activePillMenu={activePillMenu as any}
            onPillMenuChange={setActivePillMenu}
          />
        </div>

        {/* Header Section */}
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <SysLabel>SYS: Command Center</SysLabel>
              <TitleH1>Chief Operating Officer</TitleH1>
              <Subtitle>Enterprise Operations & Service Delivery</Subtitle>
            </div>
          </div>
        </header>

        {/* Metric Cards */}
        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" staggerMs={50}>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="SHIFT FILL RATE (TODAY)"
               value={metrics.shiftFillRate.value}
               color={COO_PALETTE.positive}
               trend={metrics.shiftFillRate.trend}
               trendValue={demo ? metrics.shiftFillRate.trendValue : undefined}
               sparklineVariant={1}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="OPEN WORK ORDERS"
               value={metrics.openWorkOrders.value}
               color={COO_PALETTE.critical}
               trend={metrics.openWorkOrders.trend}
               trendValue={demo ? metrics.openWorkOrders.trendValue : undefined}
               sparklineVariant={3}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="RESIDENT SATISFACTION"
               value={metrics.satisfaction.value}
               color={COO_PALETTE.growth}
               trend={metrics.satisfaction.trend}
               trendValue={demo ? metrics.satisfaction.trendValue : undefined}
               sparklineVariant={2}
             />
          </div>
          <div className="h-[120px]">
             <MetricCardMoonshot
               label="MOVE-INS THIS WEEK"
               value={metrics.moveIns.value}
               color={COO_PALETTE.info}
               trend={metrics.moveIns.trend}
               trendValue={demo ? metrics.moveIns.trendValue : undefined}
               sparklineVariant={4}
             />
          </div>
        </KineticGrid>

        {/* Chart Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Nursing Agency Burn & Churn</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">FTE contracted hours vs variable emergency staffing density.</p>
             <div className="flex-1 min-h-0">
               {demo ? (
                 <CooAgencyBurnChart data={MOCK_AGENCY_DATA} />
               ) : (
                 <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                   <p className="text-sm text-slate-600 dark:text-slate-400">No agency staffing data.</p>
                 </div>
               )}
             </div>
          </div>
          <div className="h-80 rounded-xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg">
             <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Safety Risk Dispersion Matrix</h4>
             <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Stacked incident volume broken down by acuity classifications.</p>
             <div className="flex-1 min-h-0">
               {demo ? (
                 <CooIncidentDensityChart data={MOCK_INCIDENT_DATA} />
               ) : (
                 <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                   <p className="text-sm text-slate-600 dark:text-slate-400">No incident density data.</p>
                 </div>
               )}
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
