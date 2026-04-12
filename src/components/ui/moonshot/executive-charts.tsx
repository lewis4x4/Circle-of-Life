"use client";

import React from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Legend
} from "recharts";
import type { TooltipContentProps } from "recharts";

type ChartDatum = Record<string, string | number>;

// Recharts injects payload/active/label at runtime; mark as Partial so the
// `<CustomTooltip prefix="$" />` JSX call sites compile without TS demanding them.
type CustomTooltipProps = Partial<TooltipContentProps<number, string>> & {
  prefix?: string;
  suffix?: string;
};

const CHART_PX = 220;

/** Recharts needs explicit pixel dimensions during SSR/static measurement (avoids width/height -1 warnings). */
function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0" style={{ height: CHART_PX, minHeight: CHART_PX }}>
      {children}
    </div>
  );
}

const DARK_COLORS = {
  emerald: "#10b981",    // emerald-500
  indigo: "#6366f1",     // indigo-500
  rose: "#f43f5e",       // rose-500
  amber: "#f59e0b",      // amber-500
  blue: "#3b82f6",       // blue-500
  violet: "#8b5cf6",     // violet-500
  slate: "#64748b",      // slate-500
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.3)"
};

// --- CUSTOM TOOLTIPS ---
const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, prefix = "", suffix = "" }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/50 p-3 rounded-lg shadow-2xl">
        <p className="text-xs font-mono text-slate-400 mb-2 uppercase tracking-widest">{label}</p>
        {payload.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2 mb-1 last:mb-0">
            <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: p.color }} />
            <span className="text-sm font-semibold text-slate-100">
              {p.name}: <span className="font-mono">{prefix}{Number(p.value ?? 0).toLocaleString()}{suffix}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// --- CEO CHARTS ---

export function CeoGrowthChart({ data }: { data: ChartDatum[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorMoveIns" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={DARK_COLORS.emerald} stopOpacity={0.3} />
            <stop offset="95%" stopColor={DARK_COLORS.emerald} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorTours" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={DARK_COLORS.indigo} stopOpacity={0.3} />
            <stop offset="95%" stopColor={DARK_COLORS.indigo} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Area type="monotone" name="Facility Tours" dataKey="tours" stroke={DARK_COLORS.indigo} strokeWidth={2} fillOpacity={1} fill="url(#colorTours)" />
        <Area type="monotone" name="Net Move-ins" dataKey="moveIns" stroke={DARK_COLORS.emerald} strokeWidth={3} fillOpacity={1} fill="url(#colorMoveIns)" />
      </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

export function CeoRiskChart({ data }: { data: ChartDatum[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
        <XAxis dataKey="facility" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(244,63,94,0.05)' }} />
        <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Bar name="L3/L4 Incidents" dataKey="criticalIncidents" fill={DARK_COLORS.rose} radius={[4, 4, 0, 0]} />
        <Bar name="Avg Reputation Score (out of 50)" dataKey="reputationInverse" fill={DARK_COLORS.amber} radius={[4, 4, 0, 0]} />
      </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

// --- CFO CHARTS ---

export function CfoLaborDonutChart({ data }: { data: ChartDatum[] }) {
  const COLORS = [DARK_COLORS.emerald, DARK_COLORS.indigo, DARK_COLORS.amber];
  
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <PieChart>
        <Tooltip content={<CustomTooltip prefix="$" />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
        <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

export function CfoRevenueMatrixChart({ data }: { data: ChartDatum[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} />
        <Tooltip content={<CustomTooltip prefix="$" />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
        <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Bar name="Collected Revenue" dataKey="collected" stackId="a" fill={DARK_COLORS.indigo} radius={[0, 0, 4, 4]} />
        <Bar name="AR > 30 Days" dataKey="ar30" stackId="a" fill={DARK_COLORS.amber} />
        <Bar name="AR > 60 Days" dataKey="ar60" stackId="a" fill={DARK_COLORS.rose} radius={[4, 4, 0, 0]} />
      </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

// --- COO CHARTS ---

export function CooAgencyBurnChart({ data }: { data: ChartDatum[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} />
        <Tooltip content={<CustomTooltip suffix=" hrs" />} />
        <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Bar name="FTE Hours" dataKey="fteHours" fill={DARK_COLORS.blue} radius={[4, 4, 0, 0]} barSize={20} />
        <Line type="monotone" name="Agency/OT Spike" dataKey="agencyHours" stroke={DARK_COLORS.rose} strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#0f172a' }} />
      </ComposedChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

export function CooIncidentDensityChart({ data }: { data: ChartDatum[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorFalls" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={DARK_COLORS.amber} stopOpacity={0.8} />
            <stop offset="95%" stopColor={DARK_COLORS.amber} stopOpacity={0.2} />
          </linearGradient>
          <linearGradient id="colorMeds" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={DARK_COLORS.violet} stopOpacity={0.8} />
            <stop offset="95%" stopColor={DARK_COLORS.violet} stopOpacity={0.2} />
          </linearGradient>
          <linearGradient id="colorBehav" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={DARK_COLORS.rose} stopOpacity={0.8} />
            <stop offset="95%" stopColor={DARK_COLORS.rose} stopOpacity={0.2} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
        <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: DARK_COLORS.axis }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }} />
        <Area type="monotone" name="Behavioral" dataKey="behavioral" stackId="1" stroke={DARK_COLORS.rose} fill="url(#colorBehav)" />
        <Area type="monotone" name="Med Errors" dataKey="medErrors" stackId="1" stroke={DARK_COLORS.violet} fill="url(#colorMeds)" />
        <Area type="monotone" name="Falls" dataKey="falls" stackId="1" stroke={DARK_COLORS.amber} fill="url(#colorFalls)" />
      </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

// --- CFO WATERFALL TABLE & MONTHLY P&L ---

type WaterfallRow = {
  category: string;
  actual: number;
  budget: number;
  priorYear: number;
  isExpense?: boolean;
  isTotal?: boolean;
};

function fmtM(cents: number): string {
  return `$${(cents / 1_000_000).toFixed(1)}M`;
}

function varianceBadge(pct: number, isExpense: boolean) {
  // For expenses, positive variance (actual < budget) is favorable
  // For revenue, positive variance (actual > budget) is favorable
  const favorable = isExpense ? pct > 0 : pct > 0;
  const nearZero = Math.abs(pct) < 1;

  let bg: string;
  let text: string;
  if (nearZero) {
    bg = "bg-amber-500/20 text-amber-300";
    text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  } else if (favorable) {
    bg = "bg-emerald-500/20 text-emerald-300";
    text = `+${pct.toFixed(1)}%`;
  } else {
    bg = "bg-rose-500/20 text-rose-300";
    text = `${pct.toFixed(1)}%`;
  }

  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${bg}`}>
      {text}
    </span>
  );
}

export function CfoWaterfallTable({ data }: { data: WaterfallRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] backdrop-blur-md">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-white/10">
            {["Category", "Actual", "Budget", "Var %", "Prior Year", "YoY %"].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-slate-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const isExp = row.isExpense ?? false;
            const varPct =
              row.budget === 0
                ? 0
                : isExp
                  ? ((row.budget - row.actual) / row.budget) * 100
                  : ((row.actual - row.budget) / row.budget) * 100;
            const yoyPct =
              row.priorYear === 0
                ? 0
                : ((row.actual - row.priorYear) / row.priorYear) * 100;

            return (
              <tr
                key={i}
                className={`border-b border-white/5 ${row.isTotal ? "bg-white/5 font-bold" : "hover:bg-white/[0.02]"}`}
              >
                <td className="px-3 py-2 text-sm text-slate-200">{row.category}</td>
                <td className="px-3 py-2 text-sm font-mono text-slate-200">{fmtM(row.actual)}</td>
                <td className="px-3 py-2 text-sm font-mono text-slate-200">{fmtM(row.budget)}</td>
                <td className="px-3 py-2">{varianceBadge(varPct, isExp)}</td>
                <td className="px-3 py-2 text-sm font-mono text-slate-200">{fmtM(row.priorYear)}</td>
                <td className="px-3 py-2">{varianceBadge(yoyPct, isExp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type MonthlyPnLRow = {
  month: string;
  revenue: number;
  laborCost: number;
  noi: number;
};

export function CfoMonthlyPnLChart({ data }: { data: MonthlyPnLRow[] }) {
  return (
    <ChartBox>
      <ResponsiveContainer width="100%" height={CHART_PX} minWidth={0}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="cfo-pnl-revenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={DARK_COLORS.emerald} stopOpacity={0.3} />
              <stop offset="95%" stopColor={DARK_COLORS.emerald} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cfo-pnl-labor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={DARK_COLORS.rose} stopOpacity={0.3} />
              <stop offset="95%" stopColor={DARK_COLORS.rose} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={DARK_COLORS.grid} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: DARK_COLORS.axis }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: DARK_COLORS.axis }}
            tickFormatter={(v: number) => `$${(v / 1_000_000).toFixed(1)}M`}
          />
          <Tooltip content={<CustomTooltip prefix="$" />} />
          <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
          <Area
            type="monotone"
            name="Revenue"
            dataKey="revenue"
            stroke={DARK_COLORS.emerald}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#cfo-pnl-revenue)"
          />
          <Area
            type="monotone"
            name="Labor Cost"
            dataKey="laborCost"
            stroke={DARK_COLORS.rose}
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#cfo-pnl-labor)"
          />
          <Line
            type="monotone"
            name="NOI"
            dataKey="noi"
            stroke={DARK_COLORS.amber}
            strokeWidth={3}
            dot={{ r: 4, strokeWidth: 2, fill: "#0f172a" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}
