"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, TrendingUp, Utensils,
  CheckCircle, XCircle, Users, Shield, Minus,
  Bell, ArrowLeft, Brain
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from "recharts";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { MetricCardMoonshot } from "@/components/executive/metric-card-moonshot";
import { CooAgencyBurnChart, CooIncidentDensityChart } from "@/components/ui/moonshot/executive-charts";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { COO_PALETTE } from "@/lib/moonshot-theme";
import { cn } from "@/lib/utils";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";

// ── PILL TABS ──
const COO_TABS = ["Operations Hub", "Staffing", "Maintenance", "Dining", "Satisfaction", "Move Ops", "Vendors", "Readiness", "Haven Insight"];

const FAC_SHORT = ["Homewood", "Riverside", "Cedar Park", "Oakview", "Maple Creek"];

// ── CHART COLORS ──
const COLORS = {
  grid: "rgba(255,255,255,0.05)",
  axis: "rgba(255,255,255,0.3)",
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  indigo: "#6366f1",
};

// ── MOCK DATA ──

const ALERTS = [
  { id: "a1", severity: "critical" as const, title: "Fall with Injury — Room 214", facility: "Oakridge", time: "2h ago", icon: AlertTriangle },
  { id: "a2", severity: "warning" as const, title: "Night Shift Understaffed (2 gaps)", facility: "Homewood Lodge", time: "4h ago", icon: Users },
  { id: "a3", severity: "warning" as const, title: "Medication Error Reported", facility: "Plantation", time: "6h ago", icon: Shield },
  { id: "a4", severity: "info" as const, title: "Kitchen Inspection Due Tomorrow", facility: "Cedar Park", time: "8h ago", icon: Utensils },
  { id: "a5", severity: "info" as const, title: "Fire Drill Scheduled Tomorrow", facility: "All Facilities", time: "1d ago", icon: Bell },
];

const TRANSPORT = [
  { time: "8:00 AM", resident: "Margaret W.", facility: "Cedar Park", destination: "Dr. Chen — Cardiology", vehicle: "Van 1", driver: "Tom B.", status: "completed" },
  { time: "9:30 AM", resident: "Robert K.", facility: "Homewood", destination: "Regional Hospital — Lab", vehicle: "Van 2", driver: "Sarah M.", status: "in-transit" },
  { time: "10:15 AM", resident: "Helen M.", facility: "Oakview", destination: "Dr. Patel — Orthopedic", vehicle: "Van 1", driver: "Tom B.", status: "scheduled" },
  { time: "1:00 PM", resident: "James T.", facility: "Maple Creek", destination: "Walmart — Shopping", vehicle: "Bus", driver: "David R.", status: "scheduled" },
  { time: "2:30 PM", resident: "Dorothy L.", facility: "Riverside", destination: "Dr. Wilson — Dental", vehicle: "Van 2", driver: "Sarah M.", status: "scheduled" },
  { time: "3:00 PM", resident: "Group (8)", facility: "Homewood", destination: "Community Park — Outing", vehicle: "Bus", driver: "David R.", status: "scheduled" },
];

const SHIFT_DATA = FAC_SHORT.map((f, i) => ({
  facility: f,
  day: { required: [14,12,16,10,12][i], filled: [14,11,13,10,11][i], agency: [0,1,3,0,1][i] },
  evening: { required: [10,9,12,8,9][i], filled: [10,9,10,8,8][i], agency: [0,0,2,0,1][i] },
  night: { required: [6,5,7,5,5][i], filled: [5,5,5,5,4][i], agency: [1,0,2,0,1][i] },
  openShifts48hr: [2,3,8,1,5][i],
}));

const COMPLAINTS = [
  { id: 1, facility: "Cedar Park", type: "Maintenance", description: "Room 214 not fixed after 3 days", severity: "high", age: 3, status: "escalated" },
  { id: 2, facility: "Maple Creek", type: "Staffing", description: "Call light response avg 12 min night shift", severity: "high", age: 2, status: "investigating" },
  { id: 3, facility: "Homewood", type: "Dining", description: "Pureed diet presentation — family complaint", severity: "medium", age: 5, status: "in-progress" },
  { id: 4, facility: "Riverside", type: "Activities", description: "Weekend activities cancelled 2 weeks", severity: "medium", age: 4, status: "scheduled" },
  { id: 5, facility: "Oakview", type: "Communication", description: "Family not notified of med change 48hrs", severity: "high", age: 1, status: "investigating" },
];

const AGENCY_DATA = [
  { month: "Sep", fteHours: 124000, agencyHours: 850 },
  { month: "Oct", fteHours: 125000, agencyHours: 1100 },
  { month: "Nov", fteHours: 123000, agencyHours: 2400 },
  { month: "Dec", fteHours: 122000, agencyHours: 3100 },
  { month: "Jan", fteHours: 128000, agencyHours: 1800 },
  { month: "Feb", fteHours: 130000, agencyHours: 600 },
];

const INCIDENT_DATA = [
  { week: "W1", falls: 4, medErrors: 1, behavioral: 2 },
  { week: "W2", falls: 6, medErrors: 0, behavioral: 3 },
  { week: "W3", falls: 3, medErrors: 2, behavioral: 5 },
  { week: "W4", falls: 5, medErrors: 0, behavioral: 2 },
  { week: "W5", falls: 4, medErrors: 1, behavioral: 4 },
  { week: "W6", falls: 2, medErrors: 0, behavioral: 1 },
];

const WORK_ORDERS = [
  { id: "WO-1842", facility: "Cedar Park", description: "Room 214 HVAC not cooling", priority: "urgent", age: 3, assigned: "Mike T.", category: "HVAC" },
  { id: "WO-1838", facility: "Homewood", description: "Dining dishwasher error E4", priority: "urgent", age: 5, assigned: "Jake R.", category: "Kitchen" },
  { id: "WO-1835", facility: "Maple Creek", description: "Parking lot light #7 out", priority: "high", age: 7, assigned: "Unassigned", category: "Exterior" },
  { id: "WO-1831", facility: "Riverside", description: "Room 108 toilet running", priority: "medium", age: 4, assigned: "Chris L.", category: "Plumbing" },
  { id: "WO-1829", facility: "Oakview", description: "Activity room carpet stain", priority: "low", age: 9, assigned: "Lisa M.", category: "Housekeeping" },
  { id: "WO-1827", facility: "Cedar Park", description: "Emergency exit alarm false trigger", priority: "urgent", age: 2, assigned: "Mike T.", category: "Life Safety" },
  { id: "WO-1824", facility: "Homewood", description: "Room 302 ceiling water stain", priority: "high", age: 6, assigned: "Jake R.", category: "Plumbing" },
  { id: "WO-1820", facility: "Maple Creek", description: "Nurse station printer jam", priority: "low", age: 8, assigned: "Unassigned", category: "IT" },
];

const MAINT_METRICS = FAC_SHORT.map((f, i) => ({
  facility: f, openOrders: [12,8,18,6,14][i], avgDays: [3.2,2.8,5.4,2.1,4.1][i],
  overdue: [2,1,6,0,3][i], preventive: [92,96,78,98,84][i], emergencyCalls: [4,2,7,1,5][i],
}));

const DIETARY_METRICS = FAC_SHORT.map((f, i) => ({
  facility: f, satisfaction: [4.2,4.5,3.8,4.6,4.1][i], costPerDay: [14.20,13.80,15.60,13.20,14.80][i],
  budgetPerDay: [14.00,14.00,14.50,13.50,14.00][i], wastePct: [8.2,6.4,12.1,5.8,9.4][i],
  specialDiets: [34,28,42,22,30][i], residents: [81,77,83,74,72][i], inspectionScore: [96,98,88,99,92][i],
}));

const SATISFACTION_DATA = FAC_SHORT.map((f, i) => ({
  facility: f,
  dimensions: [
    { subject: "Care Quality", value: [4.4,4.6,4.0,4.7,4.3][i] },
    { subject: "Staff Response", value: [4.0,4.2,3.5,4.4,3.9][i] },
    { subject: "Food Quality", value: [4.2,4.5,3.8,4.6,4.1][i] },
    { subject: "Activities", value: [4.1,4.3,3.7,4.5,4.0][i] },
    { subject: "Cleanliness", value: [4.5,4.7,3.6,4.8,4.3][i] },
    { subject: "Communication", value: [4.0,4.2,3.5,4.4,3.9][i] },
  ],
  nps: [42,56,18,64,38][i],
}));

const MOVE_OPS = [
  { name: "Patricia V.", facility: "Homewood", date: "Apr 14", type: "move-in", room: "Room 218", readiness: 85 },
  { name: "Harold K.", facility: "Oakview", date: "Apr 15", type: "move-in", room: "Room 104", readiness: 100 },
  { name: "Dorothy M.", facility: "Cedar Park", date: "Apr 16", type: "move-in", room: "Room 306", readiness: 60 },
  { name: "George S.", facility: "Riverside", date: "Apr 17", type: "move-out", room: "Room 112", readiness: 90 },
  { name: "Ruth L.", facility: "Maple Creek", date: "Apr 18", type: "move-in", room: "Room 208", readiness: 40 },
];

const READINESS_CHECKLIST = ["Room deep cleaned", "Maintenance cleared", "Welcome packet", "Care plan meeting", "Dietary preferences entered", "Emergency contacts verified", "Medication list confirmed", "Family orientation scheduled"];

const VENDORS = [
  { vendor: "Sysco Foods", category: "Dietary", contract: "Active", nextReview: "Jul 2026", spend: 1240000, trend: "up", onTime: 94, issues: 2 },
  { vendor: "McKesson Medical", category: "Medical Supplies", contract: "Active", nextReview: "Sep 2026", spend: 860000, trend: "stable", onTime: 97, issues: 0 },
  { vendor: "Cintas Linens", category: "Laundry/Linen", contract: "Active", nextReview: "May 2026", spend: 420000, trend: "up", onTime: 88, issues: 4 },
  { vendor: "Johnson Controls", category: "HVAC/Building", contract: "Active", nextReview: "Dec 2026", spend: 380000, trend: "stable", onTime: 91, issues: 1 },
  { vendor: "Stericycle", category: "Waste Mgmt", contract: "Active", nextReview: "Aug 2026", spend: 180000, trend: "stable", onTime: 99, issues: 0 },
  { vendor: "TempForce Staffing", category: "Agency Staff", contract: "Month-to-Month", nextReview: "N/A", spend: 2120000, trend: "up", onTime: 82, issues: 8 },
];

const EMERGENCY_DATA = FAC_SHORT.map((f, i) => ({
  facility: f, drills: [6,6,4,6,5][i], drillsReq: 6,
  genTest: ["Apr 8","Apr 7","Mar 28","Apr 9","Apr 1"][i], genStatus: ["pass","pass","fail","pass","pass"][i] as string,
  evacCurrent: [true,true,false,true,true][i],
  supplyCheck: ["Apr 10","Apr 9","Apr 5","Apr 10","Apr 3"][i], supplyStatus: ["good","good","low","good","fair"][i] as string,
}));

const HOUSEKEEPING = FAC_SHORT.map((f, i) => ({
  facility: f, inspected: [76,72,68,70,65][i], passRate: [94,97,82,98,88][i],
  deepScheduled: [8,6,10,5,7][i], deepCompleted: [8,6,7,5,5][i],
  laundryHrs: [4.2,3.8,5.6,3.2,4.8][i], icScore: [96,98,84,99,90][i],
}));

// ── HELPER: Panel wrapper ──
function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg", className)}>{children}</div>;
}

// ── HELPER: Section title ──
function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-white">{children}</h3>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── HELPER: Status badge ──
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    completed: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "DONE" },
    "in-transit": { bg: "bg-sky-500/20", text: "text-sky-400", label: "EN ROUTE" },
    scheduled: { bg: "bg-slate-500/10", text: "text-slate-400", label: "SCHED" },
    escalated: { bg: "bg-rose-500/20", text: "text-rose-400", label: "ESCALATED" },
    investigating: { bg: "bg-amber-500/20", text: "text-amber-400", label: "INVESTIGATING" },
    "in-progress": { bg: "bg-sky-500/20", text: "text-sky-400", label: "IN PROGRESS" },
    resolved: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "RESOLVED" },
  };
  const s = map[status] ?? map.scheduled;
  return <span className={cn("inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/5", s.bg, s.text)}>{s.label}</span>;
}

// ── HELPER: Priority badge ──
function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    urgent: { bg: "bg-rose-500/20", text: "text-rose-400" },
    high: { bg: "bg-amber-500/20", text: "text-amber-400" },
    medium: { bg: "bg-sky-500/20", text: "text-sky-400" },
    low: { bg: "bg-slate-500/10", text: "text-slate-400" },
    critical: { bg: "bg-rose-500/20", text: "text-rose-400" },
  };
  const p = map[priority] ?? map.medium;
  return <span className={cn("inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/5", p.bg, p.text)}>{priority}</span>;
}

// ── HELPER: Shift cell color ──
function shiftColor(filled: number, required: number): string {
  const pct = required > 0 ? filled / required : 1;
  if (pct >= 1) return "bg-emerald-500/20 text-emerald-400";
  if (pct >= 0.85) return "bg-amber-500/20 text-amber-400";
  return "bg-rose-500/20 text-rose-400";
}

// ── HELPER: Readiness color ──
function readinessColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

// ── TABLE STYLES ──
const TH = "text-left text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2";
const TD = "px-3 py-2.5 text-sm text-slate-200";
const TR = "border-b border-white/5 hover:bg-white/[0.02] transition-colors";

// ══════════════════════════════════════════════════════════
// ── MAIN COMPONENT ──
// ══════════════════════════════════════════════════════════

export default function CooDashboardPage() {
  const [tab, setTab] = useState("Operations Hub");
  const { kpis, isDemo } = useExecRoleKpis();

  // Derive COO metric card values from live data when available
  const incidentsValue = kpis ? `${kpis.clinical.openIncidents}` : "58";
  const deficienciesValue = kpis ? `${kpis.compliance.openSurveyDeficiencies}` : "4.3 / 5.0";
  const certsValue = kpis ? `${kpis.workforce.certificationsExpiring30d}` : "3";
  const outbreaksValue = kpis ? `${kpis.infection.activeOutbreaks}` : "93.4%";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-sky-900/10" secondaryClass="bg-emerald-900/10" />

      <div className="relative z-10">
        <div className="border-b border-white/5">
          <ExecutiveNavV2
            showTopNav={false}
            activeTopNav="clinical"
            activePillMenu={tab}
            onPillMenuChange={setTab}
            customPillTabs={COO_TABS}
          />
        </div>

        <header className="px-6 sm:px-12 py-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <Link href="/admin/executive" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Executive Overview
              </Link>
              <SysLabel>SYS: COMMAND CENTER</SysLabel>
              <TitleH1>Chief Operating Officer</TitleH1>
              <Subtitle>Enterprise Operations &amp; Service Delivery</Subtitle>
            </div>
          </div>
          {isDemo ? (
            <div className="rounded-[1.5rem] border border-amber-300/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-900 shadow-sm backdrop-blur-xl dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              Demo data mode is active on this COO view. Operations metrics, facility tables, and trend charts may be illustrative when live executive operations data is missing.
            </div>
          ) : null}
        </header>

        <div className="px-6 sm:px-12 pb-12 space-y-6">

          {/* ═══ TAB 1: OPERATIONS HUB ═══ */}
          {tab === "Operations Hub" && (
            <>
              {/* Metric Cards */}
              <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
                <MetricCardMoonshot label="ACTIVE OUTBREAKS" value={outbreaksValue} color={COO_PALETTE.positive} trend="flat" trendValue={isDemo ? "+1.8%" : undefined} sparklineVariant={1} />
                <MetricCardMoonshot label="OPEN INCIDENTS" value={incidentsValue} color={COO_PALETTE.critical} trend="flat" trendValue={isDemo ? "-3" : undefined} sparklineVariant={3} />
                <MetricCardMoonshot label="OPEN DEFICIENCIES" value={deficienciesValue} color={COO_PALETTE.growth} trend="flat" sparklineVariant={2} />
                <MetricCardMoonshot label="CERTS EXPIRING 30D" value={certsValue} color={COO_PALETTE.info} trend="flat" sparklineVariant={4} />
              </KineticGrid>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Alerts */}
                <Panel>
                  <SectionTitle sub="Action required — sorted by severity">Operational Alerts</SectionTitle>
                  <div className="space-y-1">
                    {ALERTS.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                          a.severity === "critical" ? "bg-rose-500/20" : a.severity === "warning" ? "bg-amber-500/20" : "bg-sky-500/20"
                        )}>
                          <a.icon className={cn("w-4 h-4", a.severity === "critical" ? "text-rose-400" : a.severity === "warning" ? "text-amber-400" : "text-sky-400")} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-200 truncate">{a.title}</p>
                          <p className="text-xs text-slate-400">{a.facility} · {a.time}</p>
                        </div>
                        <PriorityBadge priority={a.severity} />
                      </div>
                    ))}
                  </div>
                </Panel>

                {/* Transportation */}
                <Panel>
                  <SectionTitle sub="6 trips scheduled · 3 vans, 1 bus">Transportation — Today</SectionTitle>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead><tr className="border-b border-white/5">
                        <th className={TH}>Time</th><th className={TH}>Resident</th><th className={TH}>Destination</th><th className={TH}>Status</th>
                      </tr></thead>
                      <tbody>
                        {TRANSPORT.map((t, i) => (
                          <tr key={i} className={TR}>
                            <td className={cn(TD, "font-mono text-xs")}>{t.time}</td>
                            <td className={TD}>{t.resident}</td>
                            <td className={cn(TD, "text-xs text-slate-400")}>{t.destination}</td>
                            <td className={TD}><StatusBadge status={t.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Shift Heatmap */}
                <Panel>
                  <SectionTitle sub="Real-time shift coverage across all facilities">Shift Coverage Heatmap</SectionTitle>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead><tr className="border-b border-white/5">
                        <th className={TH}>Facility</th><th className={TH}>Day</th><th className={TH}>Evening</th><th className={TH}>Night</th><th className={TH}>48hr Open</th>
                      </tr></thead>
                      <tbody>
                        {SHIFT_DATA.map((s) => (
                          <tr key={s.facility} className={TR}>
                            <td className={cn(TD, "font-medium")}>{s.facility}</td>
                            {(["day","evening","night"] as const).map((shift) => (
                              <td key={shift} className={TD}>
                                <span className={cn("inline-flex items-center text-xs font-mono font-bold px-2 py-1 rounded", shiftColor(s[shift].filled, s[shift].required))}>
                                  {s[shift].filled}/{s[shift].required}
                                  {s[shift].agency > 0 && <span className="ml-1 text-[9px] text-amber-400">+{s[shift].agency}ag</span>}
                                </span>
                              </td>
                            ))}
                            <td className={TD}>
                              <span className={cn("font-mono text-xs font-bold", s.openShifts48hr > 5 ? "text-rose-400" : s.openShifts48hr > 2 ? "text-amber-400" : "text-slate-400")}>
                                {s.openShifts48hr}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                {/* Complaints */}
                <Panel>
                  <SectionTitle sub="Open complaints requiring attention">Active Complaints & Grievances</SectionTitle>
                  <div className="space-y-1">
                    {COMPLAINTS.filter(c => c.status !== "resolved").map((c) => (
                      <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-200">{c.description}</p>
                          <p className="text-xs text-slate-400">{c.facility} · {c.type} · {c.age}d ago</p>
                        </div>
                        <PriorityBadge priority={c.severity} />
                        <StatusBadge status={c.status} />
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          )}

          {/* ═══ TAB 2: STAFFING ═══ */}
          {tab === "Staffing" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Panel className="h-[360px]">
                  <SectionTitle sub="FTE contracted hours vs variable emergency staffing density">Nursing Agency Burn & Churn</SectionTitle>
                  <div className="h-[260px]"><CooAgencyBurnChart data={AGENCY_DATA} /></div>
                </Panel>
                <Panel className="h-[360px]">
                  <SectionTitle sub="Stacked incident volume broken down by acuity">Safety Risk Dispersion Matrix</SectionTitle>
                  <div className="h-[260px]"><CooIncidentDensityChart data={INCIDENT_DATA} /></div>
                </Panel>
              </div>

              <Panel>
                <SectionTitle sub="Scheduled vs required for today and tomorrow">48-Hour Shift Forecast</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5">
                      <th className={TH}>Facility</th><th className={TH}>Day Shift</th><th className={TH}>Evening Shift</th><th className={TH}>Night Shift</th><th className={TH}>Open in 48hr</th>
                    </tr></thead>
                    <tbody>
                      {SHIFT_DATA.map((s) => (
                        <tr key={s.facility} className={TR}>
                          <td className={cn(TD, "font-medium")}>{s.facility}</td>
                          {(["day","evening","night"] as const).map((shift) => (
                            <td key={shift} className={TD}>
                              <span className={cn("font-mono text-xs font-bold px-2 py-1 rounded", shiftColor(s[shift].filled, s[shift].required))}>
                                {s[shift].filled}/{s[shift].required}
                              </span>
                            </td>
                          ))}
                          <td className={TD}>
                            <span className={cn("font-mono text-sm font-bold", s.openShifts48hr > 5 ? "text-rose-400" : "text-slate-300")}>{s.openShifts48hr}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {/* ═══ TAB 3: MAINTENANCE ═══ */}
          {tab === "Maintenance" && (
            <>
              <Panel>
                <SectionTitle sub="Sorted by priority and age">Work Order Priority Queue</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5">
                      <th className={TH}>WO#</th><th className={TH}>Facility</th><th className={TH}>Description</th><th className={TH}>Priority</th><th className={TH}>Days</th><th className={TH}>Assigned</th><th className={TH}>Category</th>
                    </tr></thead>
                    <tbody>
                      {WORK_ORDERS.map((wo) => (
                        <tr key={wo.id} className={TR}>
                          <td className={cn(TD, "font-mono text-xs text-slate-400")}>{wo.id}</td>
                          <td className={TD}>{wo.facility}</td>
                          <td className={cn(TD, "text-xs max-w-[240px] truncate")}>{wo.description}</td>
                          <td className={TD}><PriorityBadge priority={wo.priority} /></td>
                          <td className={cn(TD, "font-mono", wo.age > 5 ? "text-rose-400" : "text-slate-300")}>{wo.age}d</td>
                          <td className={cn(TD, "text-xs", wo.assigned === "Unassigned" ? "text-rose-400" : "text-slate-300")}>{wo.assigned}</td>
                          <td className={cn(TD, "text-xs text-slate-400")}>{wo.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel>
                <SectionTitle sub="Open orders, resolution times, compliance">Facility Maintenance Scorecard</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5">
                      <th className={TH}>Facility</th><th className={TH}>Open</th><th className={TH}>Avg Days</th><th className={TH}>Overdue</th><th className={TH}>Preventive %</th><th className={TH}>Emergency/Mo</th>
                    </tr></thead>
                    <tbody>
                      {MAINT_METRICS.map((m) => (
                        <tr key={m.facility} className={TR}>
                          <td className={cn(TD, "font-medium")}>{m.facility}</td>
                          <td className={cn(TD, "font-mono")}>{m.openOrders}</td>
                          <td className={cn(TD, "font-mono")}>{m.avgDays}</td>
                          <td className={cn(TD, "font-mono", m.overdue > 3 ? "text-rose-400" : "text-slate-300")}>{m.overdue}</td>
                          <td className={cn(TD, "font-mono", m.preventive < 85 ? "text-rose-400" : m.preventive < 95 ? "text-amber-400" : "text-emerald-400")}>{m.preventive}%</td>
                          <td className={cn(TD, "font-mono")}>{m.emergencyCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {/* ═══ TAB 4: DINING ═══ */}
          {tab === "Dining" && (
            <Panel>
              <SectionTitle sub="Satisfaction, cost, waste, special diets, inspection scores">Facility Dining Scorecard</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead><tr className="border-b border-white/5">
                    <th className={TH}>Facility</th><th className={TH}>Satisfaction</th><th className={TH}>Cost/Day</th><th className={TH}>Budget/Day</th><th className={TH}>Waste %</th><th className={TH}>Special Diets</th><th className={TH}>Residents</th><th className={TH}>Inspection</th>
                  </tr></thead>
                  <tbody>
                    {DIETARY_METRICS.map((d) => (
                      <tr key={d.facility} className={TR}>
                        <td className={cn(TD, "font-medium")}>{d.facility}</td>
                        <td className={cn(TD, "font-mono", d.satisfaction < 4.0 ? "text-rose-400" : "text-emerald-400")}>{d.satisfaction}/5.0</td>
                        <td className={cn(TD, "font-mono", d.costPerDay > d.budgetPerDay ? "text-rose-400" : "text-emerald-400")}>${d.costPerDay.toFixed(2)}</td>
                        <td className={cn(TD, "font-mono text-slate-400")}>${d.budgetPerDay.toFixed(2)}</td>
                        <td className={cn(TD, "font-mono", d.wastePct > 10 ? "text-rose-400" : d.wastePct > 7 ? "text-amber-400" : "text-emerald-400")}>{d.wastePct}%</td>
                        <td className={cn(TD, "font-mono")}>{d.specialDiets}</td>
                        <td className={cn(TD, "font-mono text-slate-400")}>{d.residents}</td>
                        <td className={cn(TD, "font-mono", d.inspectionScore < 90 ? "text-rose-400" : "text-emerald-400")}>{d.inspectionScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ═══ TAB 5: SATISFACTION ═══ */}
          {tab === "Satisfaction" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {SATISFACTION_DATA.map((fac) => (
                  <Panel key={fac.facility} className="flex flex-col items-center">
                    <h4 className="text-xs font-semibold text-slate-200 mb-1">{fac.facility}</h4>
                    <p className="text-[10px] text-slate-400 mb-2">NPS: <span className={cn("font-bold", fac.nps > 50 ? "text-emerald-400" : fac.nps > 30 ? "text-amber-400" : "text-rose-400")}>{fac.nps}</span></p>
                    <div className="w-full h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={fac.dimensions} cx="50%" cy="50%" outerRadius="70%">
                          <PolarGrid stroke="rgba(255,255,255,0.1)" />
                          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} />
                          <Radar dataKey="value" stroke={COLORS.cyan} fill={COLORS.cyan} fillOpacity={0.2} strokeWidth={2} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                ))}
              </div>

              <Panel>
                <SectionTitle sub="All complaints with status tracking">Complaints & Resolution Tracker</SectionTitle>
                <div className="space-y-1">
                  {COMPLAINTS.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200">{c.description}</p>
                        <p className="text-xs text-slate-400">{c.facility} · {c.type} · {c.age}d ago</p>
                      </div>
                      <PriorityBadge priority={c.severity} />
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}

          {/* ═══ TAB 6: MOVE OPS ═══ */}
          {tab === "Move Ops" && (
            <Panel>
              <SectionTitle sub="Upcoming moves with readiness progress">Move-In / Move-Out Readiness Tracker</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead><tr className="border-b border-white/5">
                    <th className={TH}>Name</th><th className={TH}>Facility</th><th className={TH}>Date</th><th className={TH}>Type</th><th className={TH}>Room</th><th className={TH}>Readiness</th>
                  </tr></thead>
                  <tbody>
                    {MOVE_OPS.map((m, i) => (
                      <tr key={i} className={TR}>
                        <td className={cn(TD, "font-medium")}>{m.name}</td>
                        <td className={TD}>{m.facility}</td>
                        <td className={cn(TD, "font-mono text-xs")}>{m.date}</td>
                        <td className={TD}>
                          <span className={cn("inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/5",
                            m.type === "move-in" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                          )}>{m.type}</span>
                        </td>
                        <td className={cn(TD, "font-mono text-xs text-slate-400")}>{m.room}</td>
                        <td className={TD}>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 rounded-full bg-white/5 overflow-hidden">
                              <div className={cn("h-full rounded-full", readinessColor(m.readiness))} style={{ width: `${m.readiness}%` }} />
                            </div>
                            <span className={cn("text-xs font-mono font-bold", m.readiness >= 90 ? "text-emerald-400" : m.readiness >= 70 ? "text-amber-400" : "text-rose-400")}>{m.readiness}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6">
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">Readiness Checklist</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {READINESS_CHECKLIST.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {/* ═══ TAB 7: VENDORS ═══ */}
          {tab === "Vendors" && (
            <Panel>
              <SectionTitle sub="Contract status, spend, performance, issues">Vendor Performance & Contract Management</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead><tr className="border-b border-white/5">
                    <th className={TH}>Vendor</th><th className={TH}>Category</th><th className={TH}>Contract</th><th className={TH}>Next Review</th><th className={TH}>Spend YTD</th><th className={TH}>Trend</th><th className={TH}>On-Time %</th><th className={TH}>Issues</th>
                  </tr></thead>
                  <tbody>
                    {VENDORS.map((v) => (
                      <tr key={v.vendor} className={TR}>
                        <td className={cn(TD, "font-medium")}>{v.vendor}</td>
                        <td className={cn(TD, "text-xs text-slate-400")}>{v.category}</td>
                        <td className={TD}><StatusBadge status={v.contract === "Active" ? "completed" : "scheduled"} /></td>
                        <td className={cn(TD, "font-mono text-xs")}>{v.nextReview}</td>
                        <td className={cn(TD, "font-mono")}>${(v.spend / 1_000_000).toFixed(2)}M</td>
                        <td className={TD}>
                          {v.trend === "up" ? <TrendingUp className="w-4 h-4 text-amber-400" /> : <Minus className="w-4 h-4 text-slate-400" />}
                        </td>
                        <td className={cn(TD, "font-mono", v.onTime < 90 ? "text-amber-400" : "text-emerald-400")}>{v.onTime}%</td>
                        <td className={cn(TD, "font-mono", v.issues > 2 ? "text-rose-400 font-bold" : "text-slate-300")}>{v.issues}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ═══ TAB 8: READINESS ═══ */}
          {tab === "Readiness" && (
            <>
              <Panel>
                <SectionTitle sub="Drills, generators, evacuation plans, supply status">Emergency Preparedness Matrix</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5">
                      <th className={TH}>Facility</th><th className={TH}>Drills</th><th className={TH}>Generator Test</th><th className={TH}>Gen Status</th><th className={TH}>Evac Plan</th><th className={TH}>Supply Check</th><th className={TH}>Supply</th>
                    </tr></thead>
                    <tbody>
                      {EMERGENCY_DATA.map((e) => (
                        <tr key={e.facility} className={TR}>
                          <td className={cn(TD, "font-medium")}>{e.facility}</td>
                          <td className={cn(TD, "font-mono", e.drills < e.drillsReq ? "text-rose-400" : "text-emerald-400")}>{e.drills}/{e.drillsReq}</td>
                          <td className={cn(TD, "font-mono text-xs")}>{e.genTest}</td>
                          <td className={TD}>{e.genStatus === "pass" ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}</td>
                          <td className={TD}>{e.evacCurrent ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}</td>
                          <td className={cn(TD, "font-mono text-xs")}>{e.supplyCheck}</td>
                          <td className={TD}>
                            <span className={cn("text-xs font-bold uppercase", e.supplyStatus === "good" ? "text-emerald-400" : e.supplyStatus === "fair" ? "text-amber-400" : "text-rose-400")}>{e.supplyStatus}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel>
                <SectionTitle sub="Room inspections, deep cleans, laundry, infection control">Housekeeping & Infection Control</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5">
                      <th className={TH}>Facility</th><th className={TH}>Inspected</th><th className={TH}>Pass Rate</th><th className={TH}>Deep Sched</th><th className={TH}>Deep Done</th><th className={TH}>Laundry (hrs)</th><th className={TH}>IC Score</th>
                    </tr></thead>
                    <tbody>
                      {HOUSEKEEPING.map((h) => (
                        <tr key={h.facility} className={TR}>
                          <td className={cn(TD, "font-medium")}>{h.facility}</td>
                          <td className={cn(TD, "font-mono")}>{h.inspected}</td>
                          <td className={cn(TD, "font-mono", h.passRate < 90 ? "text-rose-400" : "text-emerald-400")}>{h.passRate}%</td>
                          <td className={cn(TD, "font-mono")}>{h.deepScheduled}</td>
                          <td className={cn(TD, "font-mono", h.deepCompleted < h.deepScheduled ? "text-amber-400" : "text-emerald-400")}>{h.deepCompleted}</td>
                          <td className={cn(TD, "font-mono", h.laundryHrs > 5 ? "text-amber-400" : "text-slate-300")}>{h.laundryHrs}</td>
                          <td className={cn(TD, "font-mono", h.icScore < 90 ? "text-rose-400" : "text-emerald-400")}>{h.icScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {/* ═══ HAVEN INSIGHT ═══ */}
          {tab === "Haven Insight" && (
            <Panel className="min-h-[300px] flex items-center justify-center">
              <div className="text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center mx-auto">
                  <Brain className="w-7 h-7 text-violet-400" />
                </div>
                <p className="text-lg font-semibold text-white">Haven Insight</p>
                <p className="text-sm text-slate-400 max-w-md">Ask questions about your operations in plain English and get AI-powered answers from your live data.</p>
                <Link href="/admin/executive/nlq" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-500 hover:to-indigo-500 transition-all shadow-lg shadow-violet-500/20">
                  <Brain className="w-4 h-4" /> Open Haven Insight
                </Link>
              </div>
            </Panel>
          )}

        </div>
      </div>
    </div>
  );
}
