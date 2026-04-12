"use client";

/**
 * Moonshot CFO Command Center
 *
 * Financial dashboard for CFO-level decision-making with 7 sub-tabs.
 */

import React, { useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Area, AreaChart, PieChart, Pie, Cell, Legend,
} from "recharts";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { CfoWaterfallTable, CfoMonthlyPnLChart } from "@/components/ui/moonshot/executive-charts";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { CFO_PALETTE } from "@/lib/moonshot-theme";
import { cn } from "@/lib/utils";

// ── PILL TABS ──
const CFO_TABS = ["Overview", "Revenue Cycle", "Labor Economics", "Cash & Liquidity", "Capex & Debt", "Budget Variance", "Scenarios"];

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

// ── COLORS ──
const CHART_COLORS = { emerald: "#10b981", rose: "#f43f5e", amber: "#f59e0b", blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", grid: "rgba(255,255,255,0.05)", axis: "rgba(255,255,255,0.3)" };

// ── MOCK DATA: OVERVIEW ──
const WATERFALL_DATA = [
  { category: "Total Revenue", actual: 57_600_000, budget: 58_200_000, priorYear: 54_800_000 },
  { category: "Labor Cost", actual: 30_100_000, budget: 29_100_000, priorYear: 27_400_000, isExpense: true },
  { category: "Other OpEx", actual: 11_900_000, budget: 12_400_000, priorYear: 12_100_000, isExpense: true },
  { category: "NOI", actual: 15_600_000, budget: 16_700_000, priorYear: 15_300_000, isTotal: true },
  { category: "Debt Service", actual: 8_200_000, budget: 8_200_000, priorYear: 8_200_000, isExpense: true },
  { category: "CapEx", actual: 2_800_000, budget: 3_200_000, priorYear: 2_100_000, isExpense: true },
  { category: "Net Cash Flow", actual: 4_600_000, budget: 5_300_000, priorYear: 5_000_000, isTotal: true },
];
const MONTHLY_PNL = [
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

// ── MOCK DATA: REVENUE CYCLE ──
const FAC = ["Homewood Lodge", "Riverside Manor", "Cedar Park", "Oakview Heights", "Maple Creek"];
const REVENUE_BY_FACILITY = FAC.map((f, i) => ({
  facility: f,
  privatePay: [2_840_000, 2_160_000, 3_020_000, 1_980_000, 2_400_000][i],
  medicaid: [1_620_000, 1_880_000, 1_440_000, 2_100_000, 1_760_000][i],
  ltcInsurance: [680_000, 520_000, 740_000, 480_000, 600_000][i],
  beds: [92, 77, 98, 74, 82][i],
  occupancy: [94.2, 91.8, 89.4, 96.1, 92.7][i],
}));
const AR_AGING = FAC.map((f, i) => ({
  facility: f,
  current: [420_000, 380_000, 510_000, 340_000, 460_000][i],
  days30: [180_000, 140_000, 260_000, 120_000, 200_000][i],
  days60: [80_000, 60_000, 140_000, 40_000, 100_000][i],
  days90: [20_000, 10_000, 60_000, 5_000, 30_000][i],
}));
const COLLECTION_TREND = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"].map((m, i) => ({
  month: m, dso: 34 - i * 0.5 + Math.sin(i) * 2, collected: 4_800_000 + i * 80_000 + Math.sin(i) * 200_000,
}));

// ── MOCK DATA: LABOR ECONOMICS ──
const LABOR_TREND = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"].map((m, i) => ({
  month: m, directCare: 1_600_000 + i * 20_000, careAides: 800_000 + i * 15_000, admin: 400_000 + i * 5_000, agency: 120_000 + Math.sin(i * 1.1) * 60_000,
}));
const LABOR_BY_FACILITY = FAC.map((f, i) => ({
  facility: f,
  laborPct: [52.4, 54.8, 58.2, 50.1, 55.6][i],
  overtimeHrs: [420, 380, 680, 280, 520][i],
  agencySpend: [82_000, 64_000, 148_000, 42_000, 96_000][i],
  fteCount: [86, 72, 94, 68, 78][i],
  turnoverPct: [18.2, 14.6, 24.8, 12.4, 20.1][i],
}));

// ── MOCK DATA: CASH & LIQUIDITY ──
const CASH_TREND = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"].map((m, i) => ({
  month: m, cashBalance: 8_200_000 + i * 150_000 + Math.sin(i) * 400_000, inflow: 5_200_000 + i * 50_000, outflow: 4_800_000 + i * 40_000,
}));
const PAYMENT_MIX = [
  { name: "ACH/Wire", value: 62 },
  { name: "Check", value: 24 },
  { name: "Credit Card", value: 8 },
  { name: "Medicaid EFT", value: 6 },
];
const PIE_COLORS = [CHART_COLORS.indigo, CHART_COLORS.amber, CHART_COLORS.rose, CHART_COLORS.emerald];

// ── MOCK DATA: CAPEX & DEBT ──
const CAPEX_ITEMS = [
  { project: "HVAC Replacement — Cedar Park", budget: 480_000, spent: 320_000, status: "In Progress", completion: 67 },
  { project: "Roof Repair — Homewood", budget: 220_000, spent: 210_000, status: "Near Complete", completion: 95 },
  { project: "Kitchen Renovation — Oakview", budget: 350_000, spent: 80_000, status: "In Progress", completion: 23 },
  { project: "Generator Upgrade — Riverside", budget: 180_000, spent: 0, status: "Planned", completion: 0 },
  { project: "Assisted Living Wing Expansion — Maple Creek", budget: 1_200_000, spent: 120_000, status: "Design Phase", completion: 10 },
];
const DEBT_SCHEDULE = FAC.map((f, i) => ({
  facility: f,
  principal: [4_200_000, 3_800_000, 5_100_000, 3_400_000, 4_600_000][i],
  rate: [5.25, 4.75, 5.50, 4.50, 5.00][i],
  monthlyPayment: [28_400, 24_800, 34_200, 22_100, 30_600][i],
  maturity: ["Mar 2031", "Jun 2029", "Dec 2032", "Sep 2028", "Jan 2030"][i],
}));

// ── MOCK DATA: BUDGET VARIANCE ──
const VARIANCE_DATA = FAC.map((f, i) => ({
  facility: f,
  revActual: [5_140_000, 4_560_000, 5_200_000, 4_560_000, 4_760_000][i],
  revBudget: [5_200_000, 4_600_000, 5_400_000, 4_400_000, 4_800_000][i],
  expActual: [4_120_000, 3_640_000, 4_420_000, 3_480_000, 3_920_000][i],
  expBudget: [3_900_000, 3_500_000, 4_100_000, 3_400_000, 3_700_000][i],
  noiActual: [1_020_000, 920_000, 780_000, 1_080_000, 840_000][i],
  noiBudget: [1_300_000, 1_100_000, 1_300_000, 1_000_000, 1_100_000][i],
}));

// ── MOCK DATA: SCENARIOS ──
const SCENARIOS = [
  { name: "Base Case", occupancy: 92, revGrowth: 5.2, laborInflation: 3.5, noi: 15_600_000, cashFlow: 4_600_000 },
  { name: "Optimistic", occupancy: 96, revGrowth: 8.0, laborInflation: 2.5, noi: 19_200_000, cashFlow: 7_400_000 },
  { name: "Conservative", occupancy: 88, revGrowth: 2.0, laborInflation: 5.0, noi: 11_800_000, cashFlow: 2_200_000 },
  { name: "Downside", occupancy: 82, revGrowth: -1.5, laborInflation: 6.0, noi: 8_400_000, cashFlow: -200_000 },
];

// ── HELPERS ──
const fmtM = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;
const fmtK = (v: number) => `$${(v / 1_000).toFixed(0)}K`;
const varPct = (actual: number, budget: number) => ((actual - budget) / budget * 100).toFixed(1);
function VarBadge({ value }: { value: number }) {
  const color = value > 2 ? "text-emerald-400 bg-emerald-500/20" : value < -2 ? "text-rose-400 bg-rose-500/20" : "text-amber-400 bg-amber-500/20";
  return <span className={cn("text-[11px] font-mono font-bold px-2 py-0.5 rounded", color)}>{value > 0 ? "+" : ""}{value.toFixed(1)}%</span>;
}

// ══════════════════════════════════════════════════════════
export default function CfoDashboardPage() {
  const [tab, setTab] = useState("Overview");

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-indigo-900/10" secondaryClass="bg-amber-900/10" />
      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2 showTopNav={false} activeTopNav="finance" activePillMenu={tab} onPillMenuChange={setTab} customPillTabs={CFO_TABS} />
        </div>
        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <Link href="/admin/executive" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Executive Overview
              </Link>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Financial Officer</TitleH1>
              <Subtitle>Enterprise Revenue &amp; Margin Strategy</Subtitle>
            </div>
          </div>
        </header>

        <div className="px-6 sm:px-12 pb-12 space-y-6">
          {/* Metric Cards — always visible */}
          <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
            <MetricCardMoonshot label="NET REVENUE YTD" value="$57.6M" color={CFO_PALETTE.positive} trend="up" trendValue="+5.2%" sparklineVariant={1} />
            <MetricCardMoonshot label="NOI MARGIN" value="27.1%" color={CFO_PALETTE.growth} trend="up" trendValue="+1.4%" sparklineVariant={2} />
            <MetricCardMoonshot label="DAYS SALES OUTSTANDING" value="28.4" color={CFO_PALETTE.info} trend="down" trendValue="-2.1" sparklineVariant={3} />
            <MetricCardMoonshot label="AGENCY SPEND VS BUDGET" value="+112%" color="rose" trend="up" trendValue="+18%" sparklineVariant={4} />
          </KineticGrid>

          {/* ═══ OVERVIEW ═══ */}
          {tab === "Overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Panel className="lg:col-span-3"><SectionTitle sub="Actual vs Budget vs Prior Year — year-to-date">Portfolio P&amp;L Waterfall</SectionTitle><CfoWaterfallTable data={WATERFALL_DATA} /></Panel>
              <Panel className="lg:col-span-2 flex flex-col"><SectionTitle sub="Revenue, labor cost, and NOI over trailing 10 months">Monthly P&amp;L Trend</SectionTitle><div className="flex-1 min-h-0"><CfoMonthlyPnLChart data={MONTHLY_PNL} /></div></Panel>
            </div>
          )}

          {/* ═══ REVENUE CYCLE ═══ */}
          {tab === "Revenue Cycle" && (<>
            <Panel>
              <SectionTitle sub="Revenue by payer type and occupancy per facility">Revenue by Facility &amp; Payer Mix</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Facility</th><th className={TH}>Private Pay</th><th className={TH}>Medicaid</th><th className={TH}>LTC Insurance</th><th className={TH}>Beds</th><th className={TH}>Occupancy</th>
              </tr></thead><tbody>
                {REVENUE_BY_FACILITY.map(r => (<tr key={r.facility} className={TR}>
                  <td className={cn(TD, "font-medium")}>{r.facility}</td>
                  <td className={cn(TD, "font-mono")}>{fmtM(r.privatePay)}</td>
                  <td className={cn(TD, "font-mono")}>{fmtM(r.medicaid)}</td>
                  <td className={cn(TD, "font-mono")}>{fmtK(r.ltcInsurance)}</td>
                  <td className={cn(TD, "font-mono")}>{r.beds}</td>
                  <td className={cn(TD, "font-mono", r.occupancy < 92 ? "text-amber-400" : "text-emerald-400")}>{r.occupancy}%</td>
                </tr>))}
              </tbody></table></div>
            </Panel>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel>
                <SectionTitle sub="AR outstanding by aging bucket per facility">AR Aging by Facility</SectionTitle>
                <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                  <th className={TH}>Facility</th><th className={TH}>Current</th><th className={TH}>31-60d</th><th className={TH}>61-90d</th><th className={TH}>90+d</th>
                </tr></thead><tbody>
                  {AR_AGING.map(a => (<tr key={a.facility} className={TR}>
                    <td className={cn(TD, "font-medium")}>{a.facility}</td>
                    <td className={cn(TD, "font-mono")}>{fmtK(a.current)}</td>
                    <td className={cn(TD, "font-mono")}>{fmtK(a.days30)}</td>
                    <td className={cn(TD, "font-mono", a.days60 > 100_000 ? "text-amber-400" : "")}>{fmtK(a.days60)}</td>
                    <td className={cn(TD, "font-mono", a.days90 > 20_000 ? "text-rose-400" : "")}>{fmtK(a.days90)}</td>
                  </tr>))}
                </tbody></table></div>
              </Panel>
              <Panel className="h-[320px] flex flex-col">
                <SectionTitle sub="DSO trend and collections over 10 months">Collection Performance</SectionTitle>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={COLLECTION_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} />
                      <Bar yAxisId="right" dataKey="collected" fill={CHART_COLORS.indigo} radius={[4,4,0,0]} barSize={16} name="Collected" />
                      <Line yAxisId="left" type="monotone" dataKey="dso" stroke={CHART_COLORS.amber} strokeWidth={3} dot={{ r: 3, fill: "#0f172a" }} name="DSO" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </>)}

          {/* ═══ LABOR ECONOMICS ═══ */}
          {tab === "Labor Economics" && (<>
            <Panel className="h-[340px] flex flex-col">
              <SectionTitle sub="Direct care, aides, admin, and agency spend — trailing 10 months">Labor Cost Breakdown Trend</SectionTitle>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={LABOR_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} tickFormatter={v => fmtM(v as number)} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} formatter={(v) => fmtK(Number(v))} />
                    <Area type="monotone" dataKey="directCare" stackId="1" stroke={CHART_COLORS.emerald} fill={CHART_COLORS.emerald} fillOpacity={0.3} name="Direct Care" />
                    <Area type="monotone" dataKey="careAides" stackId="1" stroke={CHART_COLORS.blue} fill={CHART_COLORS.blue} fillOpacity={0.3} name="Care Aides" />
                    <Area type="monotone" dataKey="admin" stackId="1" stroke={CHART_COLORS.amber} fill={CHART_COLORS.amber} fillOpacity={0.3} name="Admin/Ops" />
                    <Area type="monotone" dataKey="agency" stackId="1" stroke={CHART_COLORS.rose} fill={CHART_COLORS.rose} fillOpacity={0.3} name="Agency" />
                    <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <SectionTitle sub="Labor % of revenue, overtime, agency spend, turnover by facility">Facility Labor Scorecard</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Facility</th><th className={TH}>Labor %</th><th className={TH}>OT Hours</th><th className={TH}>Agency $</th><th className={TH}>FTEs</th><th className={TH}>Turnover</th>
              </tr></thead><tbody>
                {LABOR_BY_FACILITY.map(l => (<tr key={l.facility} className={TR}>
                  <td className={cn(TD, "font-medium")}>{l.facility}</td>
                  <td className={cn(TD, "font-mono", l.laborPct > 55 ? "text-rose-400" : "text-emerald-400")}>{l.laborPct}%</td>
                  <td className={cn(TD, "font-mono", l.overtimeHrs > 500 ? "text-amber-400" : "")}>{l.overtimeHrs}</td>
                  <td className={cn(TD, "font-mono", l.agencySpend > 100_000 ? "text-rose-400" : "")}>{fmtK(l.agencySpend)}</td>
                  <td className={cn(TD, "font-mono")}>{l.fteCount}</td>
                  <td className={cn(TD, "font-mono", l.turnoverPct > 20 ? "text-rose-400" : l.turnoverPct > 15 ? "text-amber-400" : "text-emerald-400")}>{l.turnoverPct}%</td>
                </tr>))}
              </tbody></table></div>
            </Panel>
          </>)}

          {/* ═══ CASH & LIQUIDITY ═══ */}
          {tab === "Cash & Liquidity" && (<>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Panel className="lg:col-span-2 h-[340px] flex flex-col">
                <SectionTitle sub="Cash balance, inflows, and outflows — trailing 10 months">Cash Position Trend</SectionTitle>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={CASH_TREND} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} tickFormatter={v => fmtM(v as number)} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} formatter={(v) => fmtM(Number(v))} />
                      <Bar dataKey="inflow" fill={CHART_COLORS.emerald} radius={[4,4,0,0]} barSize={12} name="Inflow" />
                      <Bar dataKey="outflow" fill={CHART_COLORS.rose} radius={[4,4,0,0]} barSize={12} name="Outflow" />
                      <Line type="monotone" dataKey="cashBalance" stroke={CHART_COLORS.amber} strokeWidth={3} dot={{ r: 3, fill: "#0f172a" }} name="Cash Balance" />
                      <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel className="flex flex-col">
                <SectionTitle sub="Payment method distribution">Payment Mix</SectionTitle>
                <div className="flex-1 min-h-0 min-h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={PAYMENT_MIX} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value" stroke="none">
                        {PAYMENT_MIX.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#fff", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </>)}

          {/* ═══ CAPEX & DEBT ═══ */}
          {tab === "Capex & Debt" && (<>
            <Panel>
              <SectionTitle sub="Active and planned capital projects">Capital Expenditure Tracker</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Project</th><th className={TH}>Budget</th><th className={TH}>Spent</th><th className={TH}>Status</th><th className={TH}>Completion</th>
              </tr></thead><tbody>
                {CAPEX_ITEMS.map(c => (<tr key={c.project} className={TR}>
                  <td className={cn(TD, "font-medium max-w-[280px]")}>{c.project}</td>
                  <td className={cn(TD, "font-mono")}>{fmtK(c.budget)}</td>
                  <td className={cn(TD, "font-mono", c.spent / c.budget > 0.9 ? "text-amber-400" : "")}>{fmtK(c.spent)}</td>
                  <td className={TD}><span className={cn("text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/5",
                    c.status === "Near Complete" ? "bg-emerald-500/20 text-emerald-400" : c.status === "In Progress" ? "bg-sky-500/20 text-sky-400" : "bg-slate-500/10 text-slate-400"
                  )}>{c.status}</span></td>
                  <td className={TD}>
                    <div className="flex items-center gap-2"><div className="w-20 h-2 rounded-full bg-white/5 overflow-hidden"><div className={cn("h-full rounded-full", c.completion >= 80 ? "bg-emerald-500" : c.completion >= 40 ? "bg-amber-500" : "bg-slate-500")} style={{ width: `${c.completion}%` }} /></div>
                    <span className="text-xs font-mono text-slate-400">{c.completion}%</span></div>
                  </td>
                </tr>))}
              </tbody></table></div>
            </Panel>
            <Panel>
              <SectionTitle sub="Outstanding principal, rates, and payment schedules">Debt Service Schedule</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Facility</th><th className={TH}>Principal</th><th className={TH}>Rate</th><th className={TH}>Monthly Pmt</th><th className={TH}>Maturity</th>
              </tr></thead><tbody>
                {DEBT_SCHEDULE.map(d => (<tr key={d.facility} className={TR}>
                  <td className={cn(TD, "font-medium")}>{d.facility}</td>
                  <td className={cn(TD, "font-mono")}>{fmtM(d.principal)}</td>
                  <td className={cn(TD, "font-mono")}>{d.rate}%</td>
                  <td className={cn(TD, "font-mono")}>{fmtK(d.monthlyPayment)}</td>
                  <td className={cn(TD, "font-mono text-slate-400")}>{d.maturity}</td>
                </tr>))}
              </tbody></table></div>
            </Panel>
          </>)}

          {/* ═══ BUDGET VARIANCE ═══ */}
          {tab === "Budget Variance" && (
            <Panel>
              <SectionTitle sub="Revenue, expense, and NOI variance by facility — current month">Monthly Budget Variance by Facility</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Facility</th><th className={TH}>Rev Actual</th><th className={TH}>Rev Budget</th><th className={TH}>Rev Var</th><th className={TH}>Exp Actual</th><th className={TH}>Exp Budget</th><th className={TH}>Exp Var</th><th className={TH}>NOI Actual</th><th className={TH}>NOI Budget</th><th className={TH}>NOI Var</th>
              </tr></thead><tbody>
                {VARIANCE_DATA.map(v => (<tr key={v.facility} className={TR}>
                  <td className={cn(TD, "font-medium")}>{v.facility}</td>
                  <td className={cn(TD, "font-mono")}>{fmtM(v.revActual)}</td>
                  <td className={cn(TD, "font-mono text-slate-400")}>{fmtM(v.revBudget)}</td>
                  <td className={TD}><VarBadge value={Number(varPct(v.revActual, v.revBudget))} /></td>
                  <td className={cn(TD, "font-mono")}>{fmtM(v.expActual)}</td>
                  <td className={cn(TD, "font-mono text-slate-400")}>{fmtM(v.expBudget)}</td>
                  <td className={TD}><VarBadge value={-Number(varPct(v.expActual, v.expBudget))} /></td>
                  <td className={cn(TD, "font-mono font-bold")}>{fmtM(v.noiActual)}</td>
                  <td className={cn(TD, "font-mono text-slate-400")}>{fmtM(v.noiBudget)}</td>
                  <td className={TD}><VarBadge value={Number(varPct(v.noiActual, v.noiBudget))} /></td>
                </tr>))}
              </tbody></table></div>
            </Panel>
          )}

          {/* ═══ SCENARIOS ═══ */}
          {tab === "Scenarios" && (
            <Panel>
              <SectionTitle sub="Financial projections under different operating assumptions">Scenario Planning Matrix</SectionTitle>
              <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-white/5">
                <th className={TH}>Scenario</th><th className={TH}>Occupancy</th><th className={TH}>Rev Growth</th><th className={TH}>Labor Inflation</th><th className={TH}>Projected NOI</th><th className={TH}>Net Cash Flow</th>
              </tr></thead><tbody>
                {SCENARIOS.map(s => (<tr key={s.name} className={cn(TR, s.name === "Base Case" && "bg-white/[0.03]")}>
                  <td className={cn(TD, "font-bold")}>{s.name}</td>
                  <td className={cn(TD, "font-mono")}>{s.occupancy}%</td>
                  <td className={cn(TD, "font-mono", s.revGrowth < 0 ? "text-rose-400" : "text-emerald-400")}>{s.revGrowth > 0 ? "+" : ""}{s.revGrowth}%</td>
                  <td className={cn(TD, "font-mono", s.laborInflation > 4 ? "text-rose-400" : "text-amber-400")}>{s.laborInflation}%</td>
                  <td className={cn(TD, "font-mono font-bold")}>{fmtM(s.noi)}</td>
                  <td className={cn(TD, "font-mono font-bold", s.cashFlow < 0 ? "text-rose-400" : "text-emerald-400")}>{fmtM(s.cashFlow)}</td>
                </tr>))}
              </tbody></table></div>
            </Panel>
          )}

        </div>
      </div>
    </div>
  );
}
