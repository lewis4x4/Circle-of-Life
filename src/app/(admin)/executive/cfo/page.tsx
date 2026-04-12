"use client";

/**
 * Moonshot CFO Command Center
 *
 * Financial dashboard for CFO-level decision-making.
 * Features portfolio P&L waterfall, monthly P&L trend, and financial KPI cards.
 */

import React, { useState } from "react";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import {
  CfoWaterfallTable,
  CfoMonthlyPnLChart,
} from "@/components/ui/moonshot/executive-charts";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CFO_PALETTE } from "@/lib/moonshot-theme";

// ── MOCK DATA ──

const WATERFALL_DATA = [
  { category: "Total Revenue",  actual: 57_600_000, budget: 58_200_000, priorYear: 54_800_000 },
  { category: "Labor Cost",     actual: 30_100_000, budget: 29_100_000, priorYear: 27_400_000, isExpense: true },
  { category: "Other OpEx",     actual: 11_900_000, budget: 12_400_000, priorYear: 12_100_000, isExpense: true },
  { category: "NOI",            actual: 15_600_000, budget: 16_700_000, priorYear: 15_300_000, isTotal: true },
  { category: "Debt Service",   actual:  8_200_000, budget:  8_200_000, priorYear:  8_200_000, isExpense: true },
  { category: "CapEx",          actual:  2_800_000, budget:  3_200_000, priorYear:  2_100_000, isExpense: true },
  { category: "Net Cash Flow",  actual:  4_600_000, budget:  5_300_000, priorYear:  5_000_000, isTotal: true },
];

const MONTHLY_PNL_DATA = [
  { month: "Jul", revenue: 5_400_000, laborCost: 2_800_000, noi: 1_400_000 },
  { month: "Aug", revenue: 5_500_000, laborCost: 2_850_000, noi: 1_450_000 },
  { month: "Sep", revenue: 5_600_000, laborCost: 2_900_000, noi: 1_500_000 },
  { month: "Oct", revenue: 5_700_000, laborCost: 2_950_000, noi: 1_520_000 },
  { month: "Nov", revenue: 5_800_000, laborCost: 3_000_000, noi: 1_550_000 },
  { month: "Dec", revenue: 5_900_000, laborCost: 3_050_000, noi: 1_580_000 },
  { month: "Jan", revenue: 6_000_000, laborCost: 3_100_000, noi: 1_600_000 },
  { month: "Feb", revenue: 5_800_000, laborCost: 3_050_000, noi: 1_500_000 },
  { month: "Mar", revenue: 5_950_000, laborCost: 3_100_000, noi: 1_560_000 },
  { month: "Apr", revenue: 5_950_000, laborCost: 3_100_000, noi: 1_540_000 },
];

// ── MAIN COMPONENT ──

export default function CfoDashboardPage() {
  const [activePillMenu, setActivePillMenu] = useState("Overview");

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      {/* Ambient Background */}
      <AmbientMatrix
        hasCriticals={false}
        primaryClass="bg-indigo-900/10"
        secondaryClass="bg-amber-900/10"
      />

      <div className="relative z-10">
        {/* Enhanced Navigation */}
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            activeTopNav="finance"
            activePillMenu={activePillMenu as any}
            onPillMenuChange={setActivePillMenu}
            customPillTabs={[
              "Overview",
              "Revenue Cycle",
              "Labor Economics",
              "Cash & Liquidity",
              "Capex & Debt",
              "Budget Variance",
              "Scenarios",
            ]}
          />
        </div>

        {/* Header Section */}
        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Financial Officer</TitleH1>
              <Subtitle>Enterprise Revenue &amp; Margin Strategy</Subtitle>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="px-6 sm:px-12 pb-12 space-y-6">
          {/* Metric Cards */}
          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot
              label="NET REVENUE YTD"
              value="$57.6M"
              color={CFO_PALETTE.positive}
              trend="up"
              trendValue="+5.2%"
              sparklineVariant={1}
            />
            <MetricCardMoonshot
              label="NOI MARGIN"
              value="27.1%"
              color={CFO_PALETTE.growth}
              trend="up"
              trendValue="+1.4%"
              sparklineVariant={2}
            />
            <MetricCardMoonshot
              label="DAYS SALES OUTSTANDING"
              value="28.4"
              color={CFO_PALETTE.info}
              trend="down"
              trendValue="-2.1"
              sparklineVariant={3}
            />
            <MetricCardMoonshot
              label="AGENCY SPEND VS BUDGET"
              value="+112%"
              color="rose"
              trend="up"
              trendValue="+18%"
              sparklineVariant={4}
            />
          </KineticGrid>

          {/* Chart Panels — 3fr / 2fr split */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: Portfolio P&L Waterfall */}
            <div className="lg:col-span-3 rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg">
              <div className="mb-4">
                <h4 className="font-semibold text-slate-200 text-sm">
                  Portfolio P&amp;L Waterfall
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Actual vs Budget vs Prior Year — year-to-date.
                </p>
              </div>
              <CfoWaterfallTable data={WATERFALL_DATA} />
            </div>

            {/* Right: Monthly P&L Trend */}
            <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg flex flex-col">
              <div className="mb-4">
                <h4 className="font-semibold text-slate-200 text-sm">
                  Monthly P&amp;L Trend
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Revenue, labor cost, and NOI over trailing 10 months.
                </p>
              </div>
              <div className="flex-1 min-h-0">
                <CfoMonthlyPnLChart data={MONTHLY_PNL_DATA} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
