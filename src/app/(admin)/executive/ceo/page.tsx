"use client";

/**
 * Moonshot CEO Command Center — 6 sub-tabs
 */

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Shield, Users, Building, Minus } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Area, AreaChart, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from "recharts";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { CeoGrowthFunnelChart, generateMockGrowthFunnelData } from "@/components/executive/ceo-growth-funnel-chart";
import { CeoRiskIndexChart, generateMockRiskIndexData } from "@/components/executive/ceo-risk-index-chart";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CEO_PALETTE } from "@/lib/moonshot-theme";
import { cn } from "@/lib/utils";

// ── PILL TABS ──
const CEO_TABS = ["Overview", "CEO View", "CFO View", "COO View", "Alerts", "Reports", "Benchmarks", "NLQ"];

// ── SHARED STYLES ──
const TH = "text-left text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2";
const TD = "px-3 py-2.5 text-sm text-slate-200";
const TR = "border-b border-white/5 hover:bg-white/[0.02] transition-colors";
function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg", className)}>{children}</div>;
}
function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return <div className="mb-4"><h3 className="text-sm font-semibold text-white">{children}</h3>{sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}</div>;
}

// ── CHART COLORS ──
const CC = { emerald: "#10b981", rose: "#f43f5e", amber: "#f59e0b", blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", cyan: "#22d3ee", grid: "rgba(255,255,255,0.05)", axis: "rgba(255,255,255,0.3)" };

// ── MOCK DATA: CEO VIEW ──
const FUNNEL_DATA = generateMockGrowthFunnelData();
const RISK_DATA = generateMockRiskIndexData();

// ── MOCK DATA: ALERTS TAB ──
const CEO_ALERTS = [
  { id: 1, severity: "critical", title: "Occupancy Below 85% — Oakridge", description: "Dropped from 86.2% to 84.1% over 14 days. Cash flow break-even requires >88%.", facility: "Oakridge ALF", age: "2h" },
  { id: 2, severity: "critical", title: "Staffing Ratio Breach — Cedar Park Night Shift", description: "Night shift at 5/7 required (71%). Agency unable to fill 2 remaining slots.", facility: "Cedar Park", age: "4h" },
  { id: 3, severity: "warning", title: "AR > 90 Days Exceeds Threshold — Cedar Park", description: "$60K in AR over 90 days, up 40% from prior month. Collection activities initiated.", facility: "Cedar Park", age: "1d" },
  { id: 4, severity: "warning", title: "Medication Error Rate Elevated — Plantation", description: "3 errors in past 7 days (vs 0.8 avg). Root cause analysis requested.", facility: "Plantation", age: "1d" },
  { id: 5, severity: "warning", title: "Survey Deficiency Open > 30 Days", description: "Tag F-241 dignity violation POC still in draft status. Due date approaching.", facility: "Homewood Lodge", age: "3d" },
  { id: 6, severity: "info", title: "Lease Renewal Due — Grande Cypress", description: "Commercial lease expires Aug 2026. Renewal negotiation should begin.", facility: "Grande Cypress", age: "5d" },
];

// ── MOCK DATA: REPORTS TAB ──
const OCCUPANCY_TREND = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"].map((m, i) => ({
  month: m,
  "Homewood": 88 + Math.sin(i*0.7)*4 + i*0.3,
  "Riverside": 91 + Math.cos(i*0.5)*3 + i*0.2,
  "Cedar Park": 85 + Math.sin(i*0.9)*5 + i*0.4,
  "Oakview": 93 + Math.cos(i*0.3)*2 + i*0.1,
  "Maple Creek": 87 + Math.sin(i*0.6)*3 + i*0.35,
}));

// ── MOCK DATA: BENCHMARKS TAB ──
const BENCHMARKS = [
  { metric: "Portfolio Occupancy", haven: 91.8, industry: 87.2, percentile: 78 },
  { metric: "Revenue per Bed", haven: 5240, industry: 4680, percentile: 82 },
  { metric: "Labor Cost %", haven: 54.5, industry: 58.2, percentile: 71 },
  { metric: "Incident Rate / 1k Days", haven: 3.5, industry: 5.2, percentile: 85 },
  { metric: "Days Sales Outstanding", haven: 28.4, industry: 34.6, percentile: 76 },
  { metric: "Staff Turnover %", haven: 18.2, industry: 24.8, percentile: 74 },
  { metric: "Survey Readiness Score", haven: 86.4, industry: 78.0, percentile: 80 },
  { metric: "Family Satisfaction", haven: 4.3, industry: 3.8, percentile: 83 },
];

// ── MOCK DATA: FACILITY SCORECARD ──
const FAC = ["Homewood Lodge", "Riverside Manor", "Cedar Park", "Oakview Heights", "Maple Creek"];
const FACILITY_SCORECARD = FAC.map((f, i) => ({
  facility: f,
  occupancy: [94.2, 91.8, 85.4, 96.1, 89.7][i],
  revenue: [5_140_000, 4_560_000, 5_200_000, 4_560_000, 4_760_000][i],
  incidents: [2, 3, 8, 1, 4][i],
  staffRatio: [true, true, false, true, false][i],
  surveyReady: [92, 88, 72, 96, 84][i],
  moveIns: [4, 3, 2, 5, 4][i],
}));

const fmtM = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

// ══════════════════════════════════════════════════════════
export default function CeoDashboardPage() {
  const [tab, setTab] = useState("CEO View");

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-indigo-900/10" secondaryClass="bg-emerald-900/10" />
      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2 showTopNav={false} activeTopNav="command" activePillMenu={tab} onPillMenuChange={setTab} />
        </div>

        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <Link href="/admin/executive" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Executive Overview
              </Link>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Executive Officer</TitleH1>
              <Subtitle>Enterprise Growth &amp; Risk Matrix</Subtitle>
            </div>
          </div>
        </header>

        <div className="px-6 sm:px-12 pb-12 space-y-6">
          {/* Metric Cards — always visible */}
          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot label="PORTFOLIO OCCUPANCY" value="91.8%" color={CEO_PALETTE.positive} trend="up" trendValue="+2.3%" sparklineVariant={2} />
            <MetricCardMoonshot label="NET MOVE-INS MTD" value="+18" color={CEO_PALETTE.growth} trend="up" trendValue="+4.5%" sparklineVariant={1} />
            <MetricCardMoonshot label="TOTAL WAITLIST PIPELINE" value="342" color={CEO_PALETTE.info} trend="up" trendValue="+12.1%" sparklineVariant={3} />
            <MetricCardMoonshot label="ENTERPRISE QUALITY RISK MAP" value="1.2x" color={CEO_PALETTE.critical} trend="down" trendValue="-0.3x" sparklineVariant={4} />
          </KineticGrid>

          {/* ═══ CEO VIEW (default) ═══ */}
          {tab === "CEO View" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Panel className="h-[360px] flex flex-col">
                <SectionTitle sub="7-stage conversion pipeline from Web Inquiries to Move-Ins">Growth &amp; Acumen Funnel</SectionTitle>
                <div className="flex-1 min-h-0"><CeoGrowthFunnelChart data={FUNNEL_DATA} /></div>
              </Panel>
              <Panel className="h-[360px] flex flex-col">
                <SectionTitle sub="Severe Incidents (L3/L4) relative to Public Reputation scoring">Legal &amp; Reputation Risk Index</SectionTitle>
                <div className="flex-1 min-h-0"><CeoRiskIndexChart data={RISK_DATA} /></div>
              </Panel>
            </div>
          )}

          {/* ═══ ALERTS ═══ */}
          {tab === "Alerts" && (
            <Panel>
              <SectionTitle sub="Executive-level alerts requiring leadership attention">Active Alerts &amp; Escalations</SectionTitle>
              <div className="space-y-2">
                {CEO_ALERTS.map(a => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.02] transition-colors">
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      a.severity === "critical" ? "bg-rose-500/20" : a.severity === "warning" ? "bg-amber-500/20" : "bg-sky-500/20"
                    )}>
                      <AlertTriangle className={cn("w-4 h-4", a.severity === "critical" ? "text-rose-400" : a.severity === "warning" ? "text-amber-400" : "text-sky-400")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{a.title}</p>
                      <p className="text-xs text-slate-400 mt-1">{a.description}</p>
                      <p className="text-[10px] text-slate-500 mt-1">{a.facility} · {a.age} ago</p>
                    </div>
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/5 shrink-0",
                      a.severity === "critical" ? "bg-rose-500/20 text-rose-400" : a.severity === "warning" ? "bg-amber-500/20 text-amber-400" : "bg-sky-500/20 text-sky-400"
                    )}>{a.severity}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* ═══ REPORTS ═══ */}
          {tab === "Reports" && (<>
            <Panel className="h-[380px] flex flex-col">
              <SectionTitle sub="Occupancy % by facility over trailing 10 months">Portfolio Occupancy Trend</SectionTitle>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={OCCUPANCY_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CC.grid} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CC.axis }} />
                    <YAxis domain={[80, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CC.axis }} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} />
                    <Area type="monotone" dataKey="Homewood" stroke={CC.emerald} fill={CC.emerald} fillOpacity={0.1} strokeWidth={2} />
                    <Area type="monotone" dataKey="Riverside" stroke={CC.blue} fill={CC.blue} fillOpacity={0.1} strokeWidth={2} />
                    <Area type="monotone" dataKey="Cedar Park" stroke={CC.rose} fill={CC.rose} fillOpacity={0.1} strokeWidth={2} />
                    <Area type="monotone" dataKey="Oakview" stroke={CC.amber} fill={CC.amber} fillOpacity={0.1} strokeWidth={2} />
                    <Area type="monotone" dataKey="Maple Creek" stroke={CC.violet} fill={CC.violet} fillOpacity={0.1} strokeWidth={2} />
                    <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <SectionTitle sub="Key metrics by facility — current month">Facility Performance Scorecard</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Facility</th><th className={TH}>Occupancy</th><th className={TH}>Revenue MTD</th><th className={TH}>Incidents</th><th className={TH}>Staff Ratio</th><th className={TH}>Survey Ready</th><th className={TH}>Move-Ins</th>
              </tr></thead><tbody>
                {FACILITY_SCORECARD.map(f => (<tr key={f.facility} className={TR}>
                  <td className={cn(TD, "font-medium")}>{f.facility}</td>
                  <td className={cn(TD, "font-mono", f.occupancy < 88 ? "text-rose-400" : f.occupancy < 92 ? "text-amber-400" : "text-emerald-400")}>{f.occupancy}%</td>
                  <td className={cn(TD, "font-mono")}>{fmtM(f.revenue)}</td>
                  <td className={cn(TD, "font-mono", f.incidents > 5 ? "text-rose-400 font-bold" : "")}>{f.incidents}</td>
                  <td className={TD}>{f.staffRatio ? <span className="text-emerald-400 text-xs font-bold">COMPLIANT</span> : <span className="text-rose-400 text-xs font-bold">BREACH</span>}</td>
                  <td className={cn(TD, "font-mono", f.surveyReady < 80 ? "text-rose-400" : "text-emerald-400")}>{f.surveyReady}%</td>
                  <td className={cn(TD, "font-mono")}>{f.moveIns}</td>
                </tr>))}
              </tbody></table></div>
            </Panel>
          </>)}

          {/* ═══ BENCHMARKS ═══ */}
          {tab === "Benchmarks" && (
            <Panel>
              <SectionTitle sub="Haven portfolio vs national ALF industry averages">Industry Benchmark Comparison</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Metric</th><th className={TH}>Haven</th><th className={TH}>Industry Avg</th><th className={TH}>Percentile</th><th className={TH}>Status</th>
              </tr></thead><tbody>
                {BENCHMARKS.map(b => {
                  const better = b.percentile >= 75;
                  return (<tr key={b.metric} className={TR}>
                    <td className={cn(TD, "font-medium")}>{b.metric}</td>
                    <td className={cn(TD, "font-mono font-bold")}>{b.haven}</td>
                    <td className={cn(TD, "font-mono text-slate-400")}>{b.industry}</td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded-full bg-white/5 overflow-hidden"><div className={cn("h-full rounded-full", better ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${b.percentile}%` }} /></div>
                        <span className="text-xs font-mono text-slate-400">{b.percentile}th</span>
                      </div>
                    </td>
                    <td className={TD}>{better ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <Minus className="w-4 h-4 text-amber-400" />}</td>
                  </tr>);
                })}
              </tbody></table></div>
            </Panel>
          )}

          {/* ═══ NLQ (placeholder) ═══ */}
          {tab === "NLQ" && (
            <Panel className="min-h-[300px] flex items-center justify-center">
              <div className="text-center">
                <p className="text-lg font-semibold text-slate-300">Natural Language Query</p>
                <p className="text-sm text-slate-500 mt-2">Ask questions about your portfolio in plain English.</p>
                <div className="mt-4 px-6 py-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-slate-400 italic">&quot;What is our occupancy trend for Cedar Park over the last 6 months?&quot;</div>
                <p className="text-xs text-slate-600 mt-4">Coming soon — powered by Haven AI</p>
              </div>
            </Panel>
          )}

        </div>
      </div>
    </div>
  );
}
