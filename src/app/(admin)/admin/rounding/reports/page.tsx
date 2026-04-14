"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  FileBarChart,
  RefreshCw,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";

type BreakdownRow = {
  label: string;
  expected: number;
  completed: number;
  onTime: number;
  late: number;
  missed: number;
};

type ReportSummary = {
  expected: number;
  completed: number;
  onTime: number;
  late: number;
  missed: number;
  completionRate: number;
  onTimeRate: number;
  missedRate: number;
  avgDelayMin: number;
};

const DEMO_SUMMARY: ReportSummary = {
  expected: 95,
  completed: 87,
  onTime: 80,
  late: 7,
  missed: 3,
  completionRate: 0.916,
  onTimeRate: 0.842,
  missedRate: 0.032,
  avgDelayMin: 4.2,
};

const DEMO_BY_SHIFT: BreakdownRow[] = [
  { label: "Day (7a–3p)", expected: 42, completed: 40, onTime: 38, late: 2, missed: 0 },
  { label: "Evening (3p–11p)", expected: 32, completed: 29, onTime: 26, late: 3, missed: 1 },
  { label: "Night (11p–7a)", expected: 21, completed: 18, onTime: 16, late: 2, missed: 2 },
];

const DEMO_BY_STAFF: BreakdownRow[] = [
  { label: "Maria Santos", expected: 24, completed: 24, onTime: 23, late: 1, missed: 0 },
  { label: "James Wilson", expected: 22, completed: 20, onTime: 18, late: 2, missed: 1 },
  { label: "Sarah Kim", expected: 26, completed: 24, onTime: 22, late: 2, missed: 1 },
  { label: "Lisa Nguyen", expected: 23, completed: 19, onTime: 17, late: 2, missed: 1 },
];

const DEMO_BY_RESIDENT: BreakdownRow[] = [
  { label: "Dorothy Henderson (112A)", expected: 12, completed: 12, onTime: 11, late: 1, missed: 0 },
  { label: "Robert Chen (204B)", expected: 8, completed: 8, onTime: 8, late: 0, missed: 0 },
  { label: "Eleanor Vasquez (118)", expected: 18, completed: 16, onTime: 14, late: 2, missed: 1 },
  { label: "Harold Mitchell (301A)", expected: 6, completed: 5, onTime: 5, late: 0, missed: 1 },
  { label: "Margaret Thompson (215)", expected: 12, completed: 11, onTime: 10, late: 1, missed: 0 },
  { label: "William O'Brien (102)", expected: 8, completed: 7, onTime: 6, late: 1, missed: 1 },
];

export default function AdminRoundingReportsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [, setLoading] = useState(true);
  const [summary, setSummary] = useState<ReportSummary>(DEMO_SUMMARY);
  const [demoFallbackActive, setDemoFallbackActive] = useState(true);
  const [breakdowns, setBreakdowns] = useState<{ byShift: BreakdownRow[]; byStaff: BreakdownRow[]; byResident: BreakdownRow[] }>({
    byShift: DEMO_BY_SHIFT,
    byStaff: DEMO_BY_STAFF,
    byResident: DEMO_BY_RESIDENT,
  });

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setDemoFallbackActive(true);
      setSummary(DEMO_SUMMARY);
      setBreakdowns({ byShift: DEMO_BY_SHIFT, byStaff: DEMO_BY_STAFF, byResident: DEMO_BY_RESIDENT });
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/rounding/reports/completion?facilityId=${encodeURIComponent(selectedFacilityId)}&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as {
        error?: string;
        summary?: ReportSummary;
        breakdowns?: { byShift?: BreakdownRow[]; byStaff?: BreakdownRow[]; byResident?: BreakdownRow[] };
      };
      if (!response.ok) throw new Error(json.error ?? "Could not load report");

      const s = json.summary;
      if (s && s.expected > 0) {
        setDemoFallbackActive(false);
        setSummary({
          expected: s.expected ?? 0,
          completed: s.completed ?? 0,
          onTime: s.onTime ?? 0,
          late: s.late ?? 0,
          missed: s.missed ?? 0,
          completionRate: s.completionRate ?? 0,
          onTimeRate: s.onTimeRate ?? 0,
          missedRate: s.missedRate ?? 0,
          avgDelayMin: s.avgDelayMin ?? 0,
        });
        setBreakdowns({
          byShift: json.breakdowns?.byShift ?? DEMO_BY_SHIFT,
          byStaff: json.breakdowns?.byStaff ?? DEMO_BY_STAFF,
          byResident: json.breakdowns?.byResident ?? DEMO_BY_RESIDENT,
        });
      } else {
        setDemoFallbackActive(true);
        setSummary(DEMO_SUMMARY);
        setBreakdowns({ byShift: DEMO_BY_SHIFT, byStaff: DEMO_BY_STAFF, byResident: DEMO_BY_RESIDENT });
      }
    } catch {
      setDemoFallbackActive(true);
      setSummary(DEMO_SUMMARY);
      setBreakdowns({ byShift: DEMO_BY_SHIFT, byStaff: DEMO_BY_STAFF, byResident: DEMO_BY_RESIDENT });
    } finally {
      setLoading(false);
    }
  }, [from, selectedFacilityId, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvRows = useMemo(() => {
    return [
      ["bucket", "label", "expected", "completed", "on_time", "late", "missed"],
      ...breakdowns.byShift.map((row) => ["shift", row.label, row.expected, row.completed, row.onTime, row.late, row.missed]),
      ...breakdowns.byStaff.map((row) => ["staff", row.label, row.expected, row.completed, row.onTime, row.late, row.missed]),
      ...breakdowns.byResident.map((row) => ["resident", row.label, row.expected, row.completed, row.onTime, row.late, row.missed]),
    ];
  }, [breakdowns]);

  function csvCell(value: string | number) {
    const s = String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportCsv() {
    const text = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "resident-assurance-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix primaryClass="bg-emerald-700/10" secondaryClass="bg-cyan-900/10" />

      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Analytics
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Completion Reports
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Expected, completed, on-time, late, and missed checks for the selected window
            </p>
          </div>
          <div className="hidden md:block">
            <RoundingHubNav />
          </div>
        </header>

        {demoFallbackActive ? (
          <AdminLiveDataFallbackNotice
            message="Demo mode is active on Completion Reports. These metrics and breakdowns are illustrative because no live rounding report data was returned for the selected window."
            onRetry={() => void load()}
          />
        ) : null}

        <div className="flex flex-wrap items-end gap-6 glass-panel rounded-[2rem] border border-slate-200 dark:border-white/5 bg-white/60 dark:bg-slate-900/40 backdrop-blur-xl p-6 shadow-sm">
          <label className="space-y-1 text-sm flex-1 min-w-[200px]">
            <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400">From Window</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-black/30 px-4 text-sm font-mono tracking-widest text-slate-700 dark:text-slate-200 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner uppercase font-semibold"
            />
          </label>
          <label className="space-y-1 text-sm flex-1 min-w-[200px]">
             <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400">To Window</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
               className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-black/30 px-4 text-sm font-mono tracking-widest text-slate-700 dark:text-slate-200 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner uppercase font-semibold"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void load()}
              variant="outline"
              className="h-12 rounded-full border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-6 font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-slate-50 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-colors"
            >
              <RefreshCw className="mr-2 h-4 w-4 text-slate-400" />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={csvRows.length <= 1}
               className="h-12 rounded-full border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 px-6 font-bold uppercase tracking-widest text-[10px] shadow-sm hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 transition-colors"
            >
              <Download className="mr-2 h-4 w-4 opacity-70" />
              Export
            </Button>
          </div>
        </div>

        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
          <ReportMetric
            label="Completion Rate"
            value={`${Math.round(summary.completionRate * 100)}%`}
            detail={`${summary.completed} / ${summary.expected}`}
            color="emerald"
            sparkVariant={2}
          />
          <ReportMetric
            label="On-Time Rate"
            value={`${Math.round(summary.onTimeRate * 100)}%`}
            detail={`${summary.onTime} on time`}
            color="cyan"
            sparkVariant={1}
          />
          <ReportMetric
            label="Late Checks"
            value={String(summary.late)}
            detail={`Avg ${summary.avgDelayMin.toFixed(1)}m delay`}
            color="amber"
            sparkVariant={4}
          />
          <ReportMetric
            label="Missed Checks"
            value={String(summary.missed)}
            detail={`${Math.round(summary.missedRate * 100)}% miss rate`}
            color={summary.missed > 0 ? "rose" : "emerald"}
            sparkVariant={3}
          />
        </KineticGrid>

        <BreakdownSection title="By Shift" icon={<Clock aria-hidden className="h-4 w-4" />} rows={breakdowns.byShift} color="cyan" />
        <BreakdownSection title="By Staff Member" icon={<CheckCircle2 aria-hidden className="h-4 w-4" />} rows={breakdowns.byStaff} color="indigo" />
        <BreakdownSection title="By Resident" icon={<FileBarChart aria-hidden className="h-4 w-4" />} rows={breakdowns.byResident} color="emerald" />

        <div className="block md:hidden pt-2">
          <RoundingHubNav />
        </div>
      </div>
    </div>
  );
}

function ReportMetric({
  label,
  value,
  detail,
  color,
  sparkVariant,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
  sparkVariant: number;
}) {
  const colorMap = {
    emerald: { border: "border-emerald-500/20", text: "text-emerald-400", spark: "text-emerald-500" },
    cyan: { border: "border-cyan-500/20", text: "text-cyan-400", spark: "text-cyan-500" },
    amber: { border: "border-amber-500/20", text: "text-amber-400", spark: "text-amber-500" },
    rose: { border: "border-rose-500/20", text: "text-rose-400", spark: "text-rose-500" },
    indigo: { border: "border-indigo-500/20", text: "text-indigo-400", spark: "text-indigo-500" },
  }[color] ?? { border: "", text: "text-slate-400", spark: "text-slate-500" };

  return (
    <div className="h-[120px]">
      <V2Card hoverColor={color} className={colorMap.border}>
        <Sparkline colorClass={colorMap.spark} variant={sparkVariant as 1 | 2 | 3 | 4} />
        <div className="relative z-10 flex flex-col h-full justify-between">
          <h3 className={cn("text-[10px] font-mono tracking-widest uppercase", colorMap.text)}>{label}</h3>
          <div>
            <p className={cn("text-3xl font-mono tracking-tighter", colorMap.text)}>{value}</p>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{detail}</p>
          </div>
        </div>
      </V2Card>
    </div>
  );
}

function BreakdownSection({
  title,
  icon,
  rows,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  rows: BreakdownRow[];
  color: string;
}) {
  const headerColor = {
    cyan: "text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/20",
    indigo: "text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20",
    emerald: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20",
  }[color] ?? "text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10";
  
  const iconColor = {
    cyan: "text-cyan-500",
    indigo: "text-indigo-500",
    emerald: "text-emerald-500",
  }[color] ?? "text-slate-500";

  return (
    <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm overflow-hidden overflow-x-auto relative">
      <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center gap-3">
         <div className={cn("w-10 h-10 flex shrink-0 items-center justify-center rounded-full border", headerColor)}>
            <span className={iconColor}>{icon}</span>
         </div>
        <div>
          <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white capitalize tracking-tight">{title}</h3>
          <p className="text-[10px] mt-0.5 font-bold font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase">{rows.length} Records</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center bg-white/50 dark:bg-white/[0.015] rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10">
          <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Data Present</p>
          <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Select a broader window.</p>
        </div>
      ) : (
        <MotionList className="space-y-3 min-w-[700px]">
            {rows.map((row) => {
              const rate = row.expected > 0 ? Math.round((row.completed / row.expected) * 100) : 0;
              const rateColor = rate >= 95 ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20" : rate >= 80 ? "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20" : "text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20";
              
              return (
                <MotionItem key={row.label}>
                    <div className="p-5 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                         <div className="flex flex-col min-w-[200px] gap-1 shrink-0">
                           <span className="font-bold text-slate-900 dark:text-slate-100 uppercase text-[11px] tracking-widest truncate">
                              {row.label}
                           </span>
                        </div>
                        <div className="grid grid-cols-6 gap-2 w-full text-center">
                             <div className="flex flex-col gap-1.5 justify-center">
                                <span className="text-[8px] font-bold uppercase font-mono tracking-widest text-slate-400">Total</span>
                                <span className="font-mono text-sm tracking-tighter font-semibold text-slate-600 dark:text-zinc-300">{row.expected}</span>
                             </div>
                             <div className="flex flex-col gap-1.5 justify-center">
                                <span className="text-[8px] font-bold uppercase font-mono tracking-widest text-slate-400">Done</span>
                                <span className="font-mono text-sm tracking-tighter font-semibold text-slate-600 dark:text-zinc-300">{row.completed}</span>
                             </div>
                             <div className="flex flex-col gap-1.5 justify-center">
                                <span className="text-[8px] font-bold uppercase font-mono tracking-widest text-emerald-500">On Time</span>
                                <span className="font-mono text-sm tracking-tighter font-semibold text-emerald-700 dark:text-emerald-400">{row.onTime}</span>
                             </div>
                            <div className="flex flex-col gap-1.5 justify-center">
                                <span className="text-[8px] font-bold uppercase font-mono tracking-widest text-amber-500">Late</span>
                                <span className="font-mono text-sm tracking-tighter font-semibold text-amber-700 dark:text-amber-400">{row.late}</span>
                             </div>
                             <div className="flex flex-col gap-1.5 justify-center">
                                <span className="text-[8px] font-bold uppercase font-mono tracking-widest text-rose-500">Missed</span>
                                <span className="font-mono text-sm tracking-tighter font-semibold text-rose-700 dark:text-rose-400">{row.missed}</span>
                             </div>
                             <div className="flex flex-col items-end justify-center pr-2">
                                <Badge className={cn("uppercase tracking-widest font-mono text-[10px] font-bold shadow-sm px-2.5 py-1 rounded-full border", rateColor)}>
                                   {rate}% rate
                                </Badge>
                             </div>
                        </div>
                    </div>
                </MotionItem>
              );
            })}
        </MotionList>
      )}
    </div>
  );
}
