"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Brain, Minus, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CeoGrowthFunnelChart, generateMockGrowthFunnelData } from "@/components/executive/ceo-growth-funnel-chart";
import { CeoRiskIndexChart, generateMockRiskIndexData } from "@/components/executive/ceo-risk-index-chart";
import { cn } from "@/lib/utils";
import type { CeoAlertDisplay } from "@/lib/executive/load-ceo-dashboard-data";

const TH = "text-left text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2";
const TD = "px-3 py-2.5 text-sm text-slate-200";
const TR = "border-b border-white/5 hover:bg-white/[0.02] transition-colors";

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
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

function SectionTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-white">{children}</h3>
      {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

const CHART_COLORS = {
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.3)",
};

const FUNNEL_DATA = generateMockGrowthFunnelData();
const RISK_DATA = generateMockRiskIndexData();

const OCCUPANCY_TREND = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"].map(
  (month, index) => ({
    month,
    Homewood: 88 + Math.sin(index * 0.7) * 4 + index * 0.3,
    Riverside: 91 + Math.cos(index * 0.5) * 3 + index * 0.2,
    "Cedar Park": 85 + Math.sin(index * 0.9) * 5 + index * 0.4,
    Oakview: 93 + Math.cos(index * 0.3) * 2 + index * 0.1,
    "Maple Creek": 87 + Math.sin(index * 0.6) * 3 + index * 0.35,
  }),
);

const FACILITY_SCORECARD = [
  ["Homewood Lodge", 94.2, 5_140_000, 2, true, 92, 4],
  ["Riverside Manor", 91.8, 4_560_000, 3, true, 88, 3],
  ["Cedar Park", 85.4, 5_200_000, 8, false, 72, 2],
  ["Oakview Heights", 96.1, 4_560_000, 1, true, 96, 5],
  ["Maple Creek", 89.7, 4_760_000, 4, false, 84, 4],
].map(([facility, occupancy, revenue, incidents, staffRatio, surveyReady, moveIns]) => ({
  facility,
  occupancy,
  revenue,
  incidents,
  staffRatio,
  surveyReady,
  moveIns,
}));

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

const fmtM = (value: number) => `$${(value / 1_000_000).toFixed(1)}M`;

export default function CeoDashboardTabs({
  tab,
  displayAlerts,
}: {
  tab: string;
  displayAlerts: CeoAlertDisplay[];
}) {
  if (tab === "Alerts") {
    return (
      <Panel>
        <SectionTitle sub="Executive-level alerts requiring leadership attention">
          Active Alerts & Escalations
        </SectionTitle>
        <div className="space-y-2">
          {displayAlerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-start gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.02]"
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  alert.severity === "critical"
                    ? "bg-rose-500/20"
                    : alert.severity === "warning"
                      ? "bg-amber-500/20"
                      : "bg-sky-500/20",
                )}
              >
                <AlertTriangle
                  className={cn(
                    "h-4 w-4",
                    alert.severity === "critical"
                      ? "text-rose-400"
                      : alert.severity === "warning"
                        ? "text-amber-400"
                        : "text-sky-400",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{alert.title}</p>
                <p className="mt-1 text-xs text-slate-400">{alert.description}</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {alert.facility} · {alert.age}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border border-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                  alert.severity === "critical"
                    ? "bg-rose-500/20 text-rose-400"
                    : alert.severity === "warning"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-sky-500/20 text-sky-400",
                )}
              >
                {alert.severity}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  if (tab === "Reports") {
    return (
      <>
        <Panel className="flex h-[380px] flex-col">
          <SectionTitle sub="Occupancy % by facility over trailing 10 months">
            Portfolio Occupancy Trend
          </SectionTitle>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={OCCUPANCY_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                <YAxis domain={[80, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} />
                <Area type="monotone" dataKey="Homewood" stroke={CHART_COLORS.emerald} fill={CHART_COLORS.emerald} fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="Riverside" stroke={CHART_COLORS.blue} fill={CHART_COLORS.blue} fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="Cedar Park" stroke={CHART_COLORS.rose} fill={CHART_COLORS.rose} fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="Oakview" stroke={CHART_COLORS.amber} fill={CHART_COLORS.amber} fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="Maple Creek" stroke={CHART_COLORS.violet} fill={CHART_COLORS.violet} fillOpacity={0.1} strokeWidth={2} />
                <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel>
          <SectionTitle sub="Key metrics by facility — current month">
            Facility Performance Scorecard
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5">
                  <th className={TH}>Facility</th>
                  <th className={TH}>Occupancy</th>
                  <th className={TH}>Revenue MTD</th>
                  <th className={TH}>Incidents</th>
                  <th className={TH}>Staff Ratio</th>
                  <th className={TH}>Survey Ready</th>
                  <th className={TH}>Move-Ins</th>
                </tr>
              </thead>
              <tbody>
                {FACILITY_SCORECARD.map((facility) => (
                  <tr key={String(facility.facility)} className={TR}>
                    <td className={cn(TD, "font-medium")}>{facility.facility}</td>
                    <td className={cn(TD, "font-mono", Number(facility.occupancy) < 88 ? "text-rose-400" : Number(facility.occupancy) < 92 ? "text-amber-400" : "text-emerald-400")}>
                      {facility.occupancy}%
                    </td>
                    <td className={cn(TD, "font-mono")}>{fmtM(Number(facility.revenue))}</td>
                    <td className={cn(TD, "font-mono", Number(facility.incidents) > 5 ? "font-bold text-rose-400" : "")}>
                      {facility.incidents}
                    </td>
                    <td className={TD}>
                      {facility.staffRatio ? (
                        <span className="text-xs font-bold text-emerald-400">COMPLIANT</span>
                      ) : (
                        <span className="text-xs font-bold text-rose-400">BREACH</span>
                      )}
                    </td>
                    <td className={cn(TD, "font-mono", Number(facility.surveyReady) < 80 ? "text-rose-400" : "text-emerald-400")}>
                      {facility.surveyReady}%
                    </td>
                    <td className={cn(TD, "font-mono")}>{facility.moveIns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  if (tab === "Benchmarks") {
    return (
      <Panel>
        <SectionTitle sub="Haven portfolio vs national ALF industry averages">
          Industry Benchmark Comparison
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <th className={TH}>Metric</th>
                <th className={TH}>Haven</th>
                <th className={TH}>Industry Avg</th>
                <th className={TH}>Percentile</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {BENCHMARKS.map((benchmark) => {
                const better = benchmark.percentile >= 75;
                return (
                  <tr key={benchmark.metric} className={TR}>
                    <td className={cn(TD, "font-medium")}>{benchmark.metric}</td>
                    <td className={cn(TD, "font-mono font-bold")}>{benchmark.haven}</td>
                    <td className={cn(TD, "font-mono text-slate-400")}>{benchmark.industry}</td>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-white/5">
                          <div
                            className={cn("h-full rounded-full", better ? "bg-emerald-500" : "bg-amber-500")}
                            style={{ width: `${benchmark.percentile}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-slate-400">{benchmark.percentile}th</span>
                      </div>
                    </td>
                    <td className={TD}>
                      {better ? (
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Minus className="h-4 w-4 text-amber-400" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  if (tab === "Haven Insight") {
    return (
      <Panel className="flex min-h-[300px] items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/20 to-indigo-600/20">
            <Brain className="h-7 w-7 text-violet-400" />
          </div>
          <p className="text-lg font-semibold text-white">Haven Insight</p>
          <p className="mx-auto max-w-md text-sm text-slate-400">
            Ask questions about your portfolio in plain English and get AI-powered answers from your live data.
          </p>
          <Link
            href="/admin/executive/nlq"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500"
          >
            <Brain className="h-4 w-4" /> Open Haven Insight
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Panel className="flex h-[360px] flex-col">
        <SectionTitle sub="7-stage conversion pipeline from Web Inquiries to Move-Ins">
          Growth & Acumen Funnel
        </SectionTitle>
        <div className="min-h-0 flex-1">
          <CeoGrowthFunnelChart data={FUNNEL_DATA} />
        </div>
      </Panel>
      <Panel className="flex h-[360px] flex-col">
        <SectionTitle sub="Severe Incidents (L3/L4) relative to Public Reputation scoring">
          Legal & Reputation Risk Index
        </SectionTitle>
        <div className="min-h-0 flex-1">
          <CeoRiskIndexChart data={RISK_DATA} />
        </div>
      </Panel>
    </div>
  );
}
