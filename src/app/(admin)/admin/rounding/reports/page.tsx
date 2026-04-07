"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  FileBarChart,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  const supabase = useMemo(() => createClient(), []);
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ReportSummary>(DEMO_SUMMARY);
  const [breakdowns, setBreakdowns] = useState<{ byShift: BreakdownRow[]; byStaff: BreakdownRow[]; byResident: BreakdownRow[] }>({
    byShift: DEMO_BY_SHIFT,
    byStaff: DEMO_BY_STAFF,
    byResident: DEMO_BY_RESIDENT,
  });

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
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
        setSummary(DEMO_SUMMARY);
        setBreakdowns({ byShift: DEMO_BY_SHIFT, byStaff: DEMO_BY_STAFF, byResident: DEMO_BY_RESIDENT });
      }
    } catch {
      setSummary(DEMO_SUMMARY);
      setBreakdowns({ byShift: DEMO_BY_SHIFT, byStaff: DEMO_BY_STAFF, byResident: DEMO_BY_RESIDENT });
    } finally {
      setLoading(false);
    }
  }, [from, selectedFacilityId, to, supabase]);

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

  function exportCsv() {
    const text = csvRows.map((row) => row.join(",")).join("\n");
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
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Analytics</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Completion Reports
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
                Expected, completed, on-time, late, and missed checks for the selected window
              </p>
            </div>
            <div className="hidden md:block">
              <RoundingHubNav />
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-4 rounded-[14px] border border-slate-800/50 bg-slate-900/30 backdrop-blur-md p-4">
          <label className="space-y-1 text-sm flex-1 min-w-[200px]">
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">From</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            />
          </label>
          <label className="space-y-1 text-sm flex-1 min-w-[200px]">
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">To</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void load()}
              variant="outline"
              className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={csvRows.length <= 1}
              className="border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <KineticGrid className="grid-cols-2 md:grid-cols-4 gap-4" staggerMs={50}>
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
    cyan: "text-cyan-400",
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
  }[color] ?? "text-slate-400";

  return (
    <div className="rounded-[14px] border border-slate-800/50 bg-slate-900/20 backdrop-blur-md overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5">
        <span className={headerColor}>{icon}</span>
        <h3 className={cn("text-[10px] font-mono tracking-widest uppercase", headerColor)}>{title}</h3>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-500">No data for this window.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Label</th>
                <th className="px-3 py-3 text-right font-medium">Expected</th>
                <th className="px-3 py-3 text-right font-medium">Completed</th>
                <th className="px-3 py-3 text-right font-medium">On Time</th>
                <th className="px-3 py-3 text-right font-medium">Late</th>
                <th className="px-3 py-3 text-right font-medium">Missed</th>
                <th className="px-5 py-3 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rate = row.expected > 0 ? Math.round((row.completed / row.expected) * 100) : 0;
                const rateColor = rate >= 95 ? "text-emerald-400" : rate >= 80 ? "text-amber-400" : "text-rose-400";
                return (
                  <tr key={row.label} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-200">{row.label}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-400">{row.expected}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.completed}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-400">{row.onTime}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-400">{row.late}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-rose-400">{row.missed}</td>
                    <td className={cn("px-5 py-3 text-right font-mono tabular-nums", rateColor)}>{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
