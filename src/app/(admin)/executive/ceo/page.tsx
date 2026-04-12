"use client";

/**
 * Moonshot CEO Command Center
 *
 * Stunning, interactive executive dashboard for CEO-level decision-making.
 * Features survey mode, drill-down capabilities, time range controls, and click-to-action links.
 */

import React, { useState, useMemo } from "react";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";

import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot, MetricCardGrid } from "@/components/executive/metric-card-moonshot";
import { CeoGrowthChart } from "@/components/ui/moonshot/executive-charts";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { isDemoMode } from "@/lib/demo-mode";
import { CEO_PALETTE } from "@/lib/moonshot-theme";

// ── MOCK DATA (DEMO MODE) ──

const MOCK_METRICS = {
  portfolioOccupancy: "91.8%",
  netMoveIns: "+18",
  totalWaitlist: "342",
  enterpriseRisk: "1.2x",
} as const;

const MOCK_METRICS_WITH_TRENDS = {
  portfolioOccupancy: {
    value: "91.8%",
    trend: "up" as const,
    trendValue: "+2.3%",
  },
  netMoveIns: {
    value: "+18",
    trend: "up" as const,
    trendValue: "+4.5%",
  },
  totalWaitlist: {
    value: "342",
    trend: "up" as const,
    trendValue: "+12.1%",
  },
  enterpriseRisk: {
    value: "1.2x",
    trend: "down" as const,
    trendValue: "-0.3x",
  },
} as const;

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

// ── MAIN COMPONENT ──

export default function CeoDashboardPage() {
  const demo = isDemoMode();
  const [activePillMenu, setActivePillMenu] = useState("CEO View");

  // Get metrics based on demo mode
  const metrics = useMemo(() => {
    if (!demo) {
      return {
        portfolioOccupancy: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        netMoveIns: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        totalWaitlist: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
        enterpriseRisk: { value: "—", trend: "flat" as "up" | "down" | "flat", trendValue: "" },
      };
    }
    return MOCK_METRICS_WITH_TRENDS;
  }, [demo]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      {/* Ambient Background */}
      <AmbientMatrix
        hasCriticals={metrics.enterpriseRisk.trend === "up"}
        primaryClass="bg-indigo-900/10"
        secondaryClass="bg-emerald-900/10"
      />

      <div className="relative z-10">
        {/* Enhanced Navigation */}
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            activeTopNav="command"
            activePillMenu={activePillMenu as any}
            onPillMenuChange={setActivePillMenu}
          />
        </div>

        {/* Header Section */}
        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Executive Officer</TitleH1>
              <Subtitle>Enterprise Growth & Risk Matrix</Subtitle>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="px-6 sm:px-12 pb-12">
          {/* Metric Cards */}
          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6" staggerMs={50}>
            <MetricCardMoonshot
              label="PORTFOLIO OCCUPANCY"
              value={metrics.portfolioOccupancy.value}
              color={CEO_PALETTE.positive}
              trend={metrics.portfolioOccupancy.trend}
              trendValue={demo ? metrics.portfolioOccupancy.trendValue : undefined}
              sparklineVariant={2}
            />
            <MetricCardMoonshot
              label="NET MOVE-INS MTD"
              value={metrics.netMoveIns.value}
              color={CEO_PALETTE.growth}
              trend={metrics.netMoveIns.trend}
              trendValue={demo ? metrics.netMoveIns.trendValue : undefined}
              sparklineVariant={1}
            />
            <MetricCardMoonshot
              label="TOTAL WAITLIST PIPELINE"
              value={metrics.totalWaitlist.value}
              color={CEO_PALETTE.info}
              trend={metrics.totalWaitlist.trend}
              trendValue={demo ? metrics.totalWaitlist.trendValue : undefined}
              sparklineVariant={3}
            />
            <MetricCardMoonshot
              label="ENTERPRISE QUALITY RISK MAP"
              value={metrics.enterpriseRisk.value}
              color={CEO_PALETTE.critical}
              trend={metrics.enterpriseRisk.trend}
              trendValue={demo ? metrics.enterpriseRisk.trendValue : undefined}
              sparklineVariant={4}
            />
          </KineticGrid>

          {/* Chart Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Growth & Acumen Funnel */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg h-80">
              <div className="mb-6">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Growth & Acumen Funnel
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Tours vs Move-in conversion pipeline over trailing 12 months.
                </p>
              </div>
              <div className="flex-1 min-h-0">
                {demo ? (
                  <CeoGrowthChart data={MOCK_GROWTH_DATA} />
                ) : (
                  <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                    <p className="text-sm text-slate-600 dark:text-slate-400">No growth snapshot data.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Legal & Reputation Risk Index */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg h-80">
              <div className="mb-6">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Legal & Reputation Risk Index
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Severe Incidents (L3/L4) relative to Public Reputation scoring.
                </p>
              </div>
              <div className="flex-1 min-h-0">
                {demo ? (
                  <CeoGrowthChart data={MOCK_RISK_DATA} />
                ) : (
                  <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300/80 p-6 text-center dark:border-slate-600">
                    <p className="text-sm text-slate-600 dark:text-slate-400">No risk index data.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
