"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";

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
  averageCompletionDelayMinutes: number;
};

export default function AdminRoundingReportsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [breakdowns, setBreakdowns] = useState<{ byShift: BreakdownRow[]; byStaff: BreakdownRow[]; byResident: BreakdownRow[] }>({
    byShift: [],
    byStaff: [],
    byResident: [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId) {
      setSummary(null);
      setBreakdowns({ byShift: [], byStaff: [], byResident: [] });
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
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load report");
      }
      setSummary(json.summary ?? null);
      setBreakdowns({
        byShift: json.breakdowns?.byShift ?? [],
        byStaff: json.breakdowns?.byStaff ?? [],
        byResident: json.breakdowns?.byResident ?? [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load rounding report.");
      setSummary(null);
      setBreakdowns({ byShift: [], byStaff: [], byResident: [] });
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
  }, [breakdowns.byResident, breakdowns.byShift, breakdowns.byStaff]);

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
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Completion reports</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review expected, completed, on-time, late, and missed checks across the selected window.</p>
      </div>

      <RoundingHubNav />

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">From</span>
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">To</span>
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
        </label>
        <div className="flex items-end gap-3">
          <Button onClick={() => void load()}>Refresh report</Button>
          <Button variant="outline" onClick={exportCsv} disabled={csvRows.length <= 1}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Expected checks" value={loading ? "—" : String(summary?.expected ?? 0)} />
        <StatCard title="Completion rate" value={loading ? "—" : `${Math.round((summary?.completionRate ?? 0) * 100)}%`} />
        <StatCard title="On-time rate" value={loading ? "—" : `${Math.round((summary?.onTimeRate ?? 0) * 100)}%`} />
        <StatCard title="Missed rate" value={loading ? "—" : `${Math.round((summary?.missedRate ?? 0) * 100)}%`} />
      </div>

      <ReportTable title="By shift" description="Compare completion and missed checks by shift bucket." rows={breakdowns.byShift} />
      <ReportTable title="By staff" description="Compare task load and completion by assigned caregiver." rows={breakdowns.byStaff} />
      <ReportTable title="By resident" description="Review resident-level completion patterns." rows={breakdowns.byResident} />
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function ReportTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: BreakdownRow[];
}) {
  return (
    <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">On time</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Missed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-600 dark:text-slate-300">
                    No rows for this window.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={`${title}-${row.label}`}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right">{row.expected}</TableCell>
                    <TableCell className="text-right">{row.completed}</TableCell>
                    <TableCell className="text-right">{row.onTime}</TableCell>
                    <TableCell className="text-right">{row.late}</TableCell>
                    <TableCell className="text-right">{row.missed}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
