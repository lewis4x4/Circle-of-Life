"use client";

/**
 * Executive Scenario Modeling — Interactive What-If Projections
 *
 * CFOs/CEOs can adjust assumptions (occupancy, revenue growth, labor inflation)
 * and see projected KPIs update in real-time with charts.
 */

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, Sliders, RefreshCw } from "lucide-react";
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Legend, BarChart, Bar,
} from "recharts";
import { TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { cn } from "@/lib/utils";

// ── COLORS ──
const CC = { emerald: "#10b981", rose: "#f43f5e", amber: "#f59e0b", blue: "#3b82f6", indigo: "#6366f1", grid: "rgba(255,255,255,0.05)", axis: "rgba(255,255,255,0.3)" };

// ── BASELINE (COL current approximations) ──
const BASELINE = {
  totalBeds: 423,
  occupancyPct: 91.8,
  blendedRate: 3800, // $/bed/month
  monthlyLabor: 2_600_000,
  monthlyDebtService: 685_000,
  otherOpexPct: 20, // % of revenue
};

// ── DEFAULT ASSUMPTIONS ──
const DEFAULT_ASSUMPTIONS = {
  occupancyChange: 0,    // percentage point change
  revenueGrowth: 5.0,    // annual %
  laborInflation: 3.5,   // annual %
  newBeds: 0,
  horizonMonths: 12,
};

// ── SCENARIO PRESETS ──
const PRESETS = [
  { name: "Base Case", assumptions: { occupancyChange: 0, revenueGrowth: 5.0, laborInflation: 3.5, newBeds: 0, horizonMonths: 12 } },
  { name: "Optimistic", assumptions: { occupancyChange: 4, revenueGrowth: 8.0, laborInflation: 2.5, newBeds: 10, horizonMonths: 12 } },
  { name: "Conservative", assumptions: { occupancyChange: -2, revenueGrowth: 2.0, laborInflation: 5.0, newBeds: 0, horizonMonths: 12 } },
  { name: "Downside", assumptions: { occupancyChange: -6, revenueGrowth: -1.5, laborInflation: 6.0, newBeds: 0, horizonMonths: 12 } },
];

// ── HELPERS ──
const fmtM = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;
const fmtK = (v: number) => `$${(v / 1_000).toFixed(0)}K`;
const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg", className)}>{children}</div>
);

// ── PROJECTION ENGINE ──
function computeProjections(assumptions: typeof DEFAULT_ASSUMPTIONS) {
  const months: string[] = [];
  const data: Array<{ month: string; revenue: number; labor: number; noi: number; cashFlow: number; occupancy: number }> = [];

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();

  for (let i = 1; i <= assumptions.horizonMonths; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = `${monthNames[futureDate.getMonth()]} ${futureDate.getFullYear().toString().slice(2)}`;
    months.push(label);

    const pctMonth = i / assumptions.horizonMonths;
    const projectedBeds = BASELINE.totalBeds + Math.round(assumptions.newBeds * pctMonth);
    const projectedOccupancy = Math.min(Math.max((BASELINE.occupancyPct + assumptions.occupancyChange) / 100, 0.5), 1.0);
    const occupiedBeds = projectedBeds * projectedOccupancy;

    const monthlyRevGrowth = Math.pow(1 + assumptions.revenueGrowth / 100 / 12, i);
    const revenue = occupiedBeds * BASELINE.blendedRate * monthlyRevGrowth;

    const monthlyLaborGrowth = Math.pow(1 + assumptions.laborInflation / 100 / 12, i);
    const labor = BASELINE.monthlyLabor * monthlyLaborGrowth;

    const otherOpex = revenue * (BASELINE.otherOpexPct / 100);
    const noi = revenue - labor - otherOpex;
    const cashFlow = noi - BASELINE.monthlyDebtService;

    data.push({
      month: label,
      revenue: Math.round(revenue),
      labor: Math.round(labor),
      noi: Math.round(noi),
      cashFlow: Math.round(cashFlow),
      occupancy: projectedOccupancy * 100,
    });
  }

  const lastMonth = data[data.length - 1];
  const firstMonth = data[0];
  const totalNoi = data.reduce((s, d) => s + d.noi, 0);
  const totalCashFlow = data.reduce((s, d) => s + d.cashFlow, 0);
  const breakEvenMonth = data.findIndex(d => d.cashFlow < 0);

  return {
    data,
    summary: {
      endRevenue: lastMonth?.revenue ?? 0,
      endLabor: lastMonth?.labor ?? 0,
      endNoi: lastMonth?.noi ?? 0,
      endCashFlow: lastMonth?.cashFlow ?? 0,
      endOccupancy: lastMonth?.occupancy ?? 0,
      totalNoi,
      totalCashFlow,
      breakEvenMonth: breakEvenMonth >= 0 ? breakEvenMonth + 1 : null,
      revenueGrowthPct: firstMonth && lastMonth ? ((lastMonth.revenue - firstMonth.revenue) / firstMonth.revenue * 100) : 0,
    },
  };
}

// ── SLIDER COMPONENT ──
function AssumptionSlider({ label, value, onChange, min, max, step, unit, description }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit: string; description?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-mono uppercase tracking-wider text-slate-400">{label}</label>
        <span className={cn("text-sm font-mono font-bold", value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-slate-300")}>
          {value > 0 ? "+" : ""}{value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-indigo-500"
      />
      {description && <p className="text-[10px] text-slate-500">{description}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
export default function ExecutiveScenariosPage() {
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);

  const projection = useMemo(() => computeProjections(assumptions), [assumptions]);
  const { data, summary } = projection;

  const update = (key: keyof typeof assumptions, value: number) => {
    setAssumptions(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-amber-900/10" secondaryClass="bg-indigo-900/10" />

      <div className="relative z-10">
        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <Link href="/admin/executive" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Executive Overview
              </Link>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                  <Calculator className="w-5 h-5 text-white" />
                </div>
                <div>
                  <TitleH1>Scenario Modeling</TitleH1>
                  <Subtitle>Adjust assumptions and see projected KPIs update in real-time</Subtitle>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 sm:px-12 pb-12 space-y-6">

          {/* Summary Cards */}
          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot label="PROJECTED MONTHLY NOI" value={fmtK(summary.endNoi)} color="emerald" trend={summary.endNoi > 0 ? "up" : "down"} sparklineVariant={1} />
            <MetricCardMoonshot label="PROJECTED CASH FLOW" value={fmtK(summary.endCashFlow)} color={summary.endCashFlow >= 0 ? "blue" : "rose"} trend={summary.endCashFlow >= 0 ? "up" : "down"} sparklineVariant={2} />
            <MetricCardMoonshot label="END OCCUPANCY" value={`${summary.endOccupancy.toFixed(1)}%`} color="amber" trend={assumptions.occupancyChange >= 0 ? "up" : "down"} sparklineVariant={3} />
            <MetricCardMoonshot label="TOTAL NOI (PERIOD)" value={fmtM(summary.totalNoi)} color="indigo" trend="flat" sparklineVariant={4} />
          </KineticGrid>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Assumptions Panel */}
            <Panel className="lg:col-span-1 space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" /> Assumptions
                </h3>
                <button onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)} className="text-[10px] text-slate-500 hover:text-white transition-colors flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Reset
                </button>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.name}
                    onClick={() => setAssumptions(p.assumptions)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-indigo-500/30 text-slate-300 transition-all"
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="space-y-5 pt-2">
                <AssumptionSlider
                  label="Occupancy Change"
                  value={assumptions.occupancyChange}
                  onChange={v => update("occupancyChange", v)}
                  min={-15} max={10} step={0.5} unit="pp"
                  description="Percentage point change from current 91.8%"
                />
                <AssumptionSlider
                  label="Revenue Growth"
                  value={assumptions.revenueGrowth}
                  onChange={v => update("revenueGrowth", v)}
                  min={-5} max={15} step={0.5} unit="%"
                  description="Annual revenue growth rate"
                />
                <AssumptionSlider
                  label="Labor Inflation"
                  value={assumptions.laborInflation}
                  onChange={v => update("laborInflation", v)}
                  min={0} max={10} step={0.5} unit="%"
                  description="Annual labor cost increase"
                />
                <AssumptionSlider
                  label="New Beds"
                  value={assumptions.newBeds}
                  onChange={v => update("newBeds", v)}
                  min={0} max={50} step={1} unit=""
                  description="Additional beds added over the period"
                />
                <AssumptionSlider
                  label="Time Horizon"
                  value={assumptions.horizonMonths}
                  onChange={v => update("horizonMonths", v)}
                  min={6} max={36} step={6} unit=" mo"
                  description="Projection period in months"
                />
              </div>

              {summary.breakEvenMonth != null && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <p className="text-xs text-rose-400 font-semibold">
                    Warning: Cash flow goes negative in month {summary.breakEvenMonth}
                  </p>
                </div>
              )}
            </Panel>

            {/* Charts */}
            <Panel className="lg:col-span-2 space-y-6">
              {/* Revenue vs Labor vs NOI */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">Revenue, Labor &amp; NOI Projection</h3>
                <p className="text-xs text-slate-400 mb-4">Monthly projected values over {assumptions.horizonMonths} months</p>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CC.grid} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: CC.axis }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: CC.axis }} tickFormatter={v => fmtM(v as number)} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} formatter={(v) => fmtK(Number(v))} />
                      <Area type="monotone" dataKey="revenue" stroke={CC.emerald} fill={CC.emerald} fillOpacity={0.15} strokeWidth={2} name="Revenue" />
                      <Area type="monotone" dataKey="labor" stroke={CC.rose} fill={CC.rose} fillOpacity={0.15} strokeWidth={2} name="Labor" />
                      <Line type="monotone" dataKey="noi" stroke={CC.amber} strokeWidth={3} dot={{ r: 3, fill: "#0f172a" }} name="NOI" />
                      <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cash Flow */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">Monthly Cash Flow</h3>
                <p className="text-xs text-slate-400 mb-4">NOI minus debt service ({fmtK(BASELINE.monthlyDebtService)}/mo)</p>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CC.grid} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: CC.axis }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: CC.axis }} tickFormatter={v => fmtK(v as number)} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} formatter={(v) => fmtK(Number(v))} />
                      <Bar dataKey="cashFlow" radius={[4, 4, 0, 0]} name="Cash Flow">
                        {data.map((entry, i) => (
                          <rect key={i} fill={entry.cashFlow >= 0 ? CC.emerald : CC.rose} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Projection Table */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Monthly Detail</h3>
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-slate-900/90 backdrop-blur">
                      <tr className="border-b border-white/5">
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">Month</th>
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">Revenue</th>
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">Labor</th>
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">NOI</th>
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">Cash Flow</th>
                        <th className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2">Occ %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((d, i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-xs font-mono text-slate-300">{d.month}</td>
                          <td className="px-3 py-2 text-xs font-mono text-emerald-400">{fmtK(d.revenue)}</td>
                          <td className="px-3 py-2 text-xs font-mono text-rose-400">{fmtK(d.labor)}</td>
                          <td className={cn("px-3 py-2 text-xs font-mono font-bold", d.noi >= 0 ? "text-amber-400" : "text-rose-400")}>{fmtK(d.noi)}</td>
                          <td className={cn("px-3 py-2 text-xs font-mono font-bold", d.cashFlow >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtK(d.cashFlow)}</td>
                          <td className="px-3 py-2 text-xs font-mono text-slate-300">{d.occupancy.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
