"use client";

/**
 * Moonshot CEO Command Center
 *
 * Executive dashboard for CEO-level decision-making.
 * Features growth funnel pipeline, risk index, and key portfolio metrics.
 */

import React, { useState } from "react";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot, MetricCardGrid } from "@/components/executive/metric-card-moonshot";
import { CeoGrowthFunnelChart, generateMockGrowthFunnelData } from "@/components/executive/ceo-growth-funnel-chart";
import { CeoRiskIndexChart, generateMockRiskIndexData } from "@/components/executive/ceo-risk-index-chart";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CEO_PALETTE } from "@/lib/moonshot-theme";

// ── MAIN COMPONENT ──

export default function CeoDashboardPage() {
  const [activePillMenu, setActivePillMenu] = useState("CEO View");

  const growthFunnelData = generateMockGrowthFunnelData();
  const riskIndexData = generateMockRiskIndexData();

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      {/* Ambient Background */}
      <AmbientMatrix
        hasCriticals={false}
        primaryClass="bg-indigo-900/10"
        secondaryClass="bg-emerald-900/10"
      />

      <div className="relative z-10">
        {/* Enhanced Navigation */}
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            showTopNav={false}
            activeTopNav="command"
            activePillMenu={activePillMenu}
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
              value="91.8%"
              color={CEO_PALETTE.positive}
              trend="up"
              trendValue="+2.3%"
              sparklineVariant={2}
            />
            <MetricCardMoonshot
              label="NET MOVE-INS MTD"
              value="+18"
              color={CEO_PALETTE.growth}
              trend="up"
              trendValue="+4.5%"
              sparklineVariant={1}
            />
            <MetricCardMoonshot
              label="TOTAL WAITLIST PIPELINE"
              value="342"
              color={CEO_PALETTE.info}
              trend="up"
              trendValue="+12.1%"
              sparklineVariant={3}
            />
            <MetricCardMoonshot
              label="ENTERPRISE QUALITY RISK MAP"
              value="1.2x"
              color={CEO_PALETTE.critical}
              trend="down"
              trendValue="-0.3x"
              sparklineVariant={4}
            />
          </KineticGrid>

          {/* Chart Panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Growth & Acumen Funnel */}
            <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg h-[360px]">
              <div className="mb-6">
                <h4 className="font-semibold text-slate-200 text-sm">
                  Growth & Acumen Funnel
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  7-stage conversion pipeline from Web Inquiries to Move-Ins.
                </p>
              </div>
              <div className="flex-1 min-h-0">
                <CeoGrowthFunnelChart data={growthFunnelData} />
              </div>
            </div>

            {/* Legal & Reputation Risk Index */}
            <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur flex flex-col p-6 shadow-lg h-[360px]">
              <div className="mb-6">
                <h4 className="font-semibold text-slate-200 text-sm">
                  Legal & Reputation Risk Index
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Severe Incidents (L3/L4) relative to Public Reputation scoring.
                </p>
              </div>
              <div className="flex-1 min-h-0">
                <CeoRiskIndexChart data={riskIndexData} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
