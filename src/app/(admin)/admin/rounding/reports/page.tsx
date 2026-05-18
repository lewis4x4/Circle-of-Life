"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileBarChart,
  RefreshCw,
  UserRound,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

type LoadState = "idle" | "loading" | "ready" | "error";

type BoardState = "no_facility" | "loading" | "error" | "empty" | "populated";

type Tone = "default" | "success" | "warning" | "danger";

const EMPTY_SUMMARY: ReportSummary = {
  expected: 0,
  completed: 0,
  onTime: 0,
  late: 0,
  missed: 0,
  completionRate: 0,
  onTimeRate: 0,
  missedRate: 0,
  avgDelayMin: 0,
};

const EMPTY_BREAKDOWNS: {
  byShift: BreakdownRow[];
  byStaff: BreakdownRow[];
  byResident: BreakdownRow[];
} = {
  byShift: [],
  byStaff: [],
  byResident: [],
};

/* -------------------------------------------------------------------------- */
/*  Value-derived tone helpers                                                */
/* -------------------------------------------------------------------------- */

function resolveRateTone(rate: number, hasData: boolean): Tone {
  if (!hasData) return "default";
  const pct = rate * 100;
  if (pct < 50) return "danger";
  if (pct < 80) return "warning";
  return "success";
}

function resolveMissedTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 3) return "warning";
  return "danger";
}

function resolveLateTone(count: number): Tone {
  if (count === 0) return "default";
  if (count <= 5) return "warning";
  return "danger";
}

function rateRowTone(rate: number): Tone {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warning";
  return "danger";
}

function deriveBoardState(args: {
  loadState: LoadState;
  hasFacility: boolean;
  hasData: boolean;
}): BoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (!args.hasData) return "empty";
  return "populated";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function AdminRoundingReportsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  );
  const [to, setTo] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
  );
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReportSummary>(EMPTY_SUMMARY);
  const [breakdowns, setBreakdowns] = useState(EMPTY_BREAKDOWNS);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setSummary(EMPTY_SUMMARY);
      setBreakdowns(EMPTY_BREAKDOWNS);
      setLoadState("ready");
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
        breakdowns?: {
          byShift?: BreakdownRow[];
          byStaff?: BreakdownRow[];
          byResident?: BreakdownRow[];
        };
      };
      if (!response.ok) throw new Error(json.error ?? "Could not load report");

      const s = json.summary;
      if (s && s.expected > 0) {
        setSummary({
          expected: s.expected,
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
          byShift: json.breakdowns?.byShift ?? [],
          byStaff: json.breakdowns?.byStaff ?? [],
          byResident: json.breakdowns?.byResident ?? [],
        });
      } else {
        setSummary(EMPTY_SUMMARY);
        setBreakdowns(EMPTY_BREAKDOWNS);
      }
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not load completion report data.",
      );
      setSummary(EMPTY_SUMMARY);
      setBreakdowns(EMPTY_BREAKDOWNS);
      setLoadState("error");
    }
  }, [from, selectedFacilityId, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvRows = useMemo(() => {
    return [
      ["bucket", "label", "expected", "completed", "on_time", "late", "missed"],
      ...breakdowns.byShift.map((row) => [
        "shift",
        row.label,
        row.expected,
        row.completed,
        row.onTime,
        row.late,
        row.missed,
      ]),
      ...breakdowns.byStaff.map((row) => [
        "staff",
        row.label,
        row.expected,
        row.completed,
        row.onTime,
        row.late,
        row.missed,
      ]),
      ...breakdowns.byResident.map((row) => [
        "resident",
        row.label,
        row.expected,
        row.completed,
        row.onTime,
        row.late,
        row.missed,
      ]),
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
    anchor.download = "rounding-completion-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasData = summary.expected > 0;

  const boardState = deriveBoardState({
    loadState,
    hasFacility: Boolean(selectedFacilityId),
    hasData,
  });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Completion reports"
        subtitle="Expected, completed, on-time, late, and missed checks across shifts, staff, and residents."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={exportCsv}
              disabled={csvRows.length <= 1}
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              aria-label="Refresh completion report"
              title="Refresh"
              disabled={loadState === "loading"}
            >
              <RefreshCw
                className={cn("size-4", loadState === "loading" && "animate-spin")}
                aria-hidden
              />
            </Button>
          </>
        }
      />

      <RoundingHubNav />

      {boardState === "no_facility" ? (
        <AllFacilitiesInterstitial />
      ) : boardState === "error" ? (
        <LoadErrorNotice
          message={errorMessage ?? "Could not load completion report data."}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {/* Date range pickers */}
          <section aria-label="Report window">
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
              <DateField
                id="report-from"
                label="From"
                value={from}
                onChange={setFrom}
              />
              <DateField id="report-to" label="To" value={to} onChange={setTo} />
            </div>
          </section>

          {/* KPI strip */}
          <section aria-label="Completion metrics">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Completion rate"
                value={hasData ? `${Math.round(summary.completionRate * 100)}%` : "—"}
                tone={resolveRateTone(summary.completionRate, hasData)}
                hint={`${summary.completed} of ${summary.expected} checks`}
              />
              <KpiCard
                label="On-time rate"
                value={hasData ? `${Math.round(summary.onTimeRate * 100)}%` : "—"}
                tone={resolveRateTone(summary.onTimeRate, hasData)}
                hint={`${summary.onTime} on time`}
              />
              <KpiCard
                label="Late checks"
                value={hasData ? String(summary.late) : "—"}
                tone={resolveLateTone(summary.late)}
                hint={`Avg ${summary.avgDelayMin.toFixed(1)}m delay`}
              />
              <KpiCard
                label="Missed checks"
                value={hasData ? String(summary.missed) : "—"}
                tone={resolveMissedTone(summary.missed)}
                hint={
                  hasData
                    ? `${Math.round(summary.missedRate * 100)}% miss rate`
                    : "No data for window"
                }
              />
            </div>
          </section>

          {boardState === "empty" ? (
            <NoDataEmptyState />
          ) : (
            <>
              <BreakdownSection
                title="By shift"
                icon={<Clock className="size-4" aria-hidden />}
                rows={breakdowns.byShift}
              />
              <BreakdownSection
                title="By staff member"
                icon={<UserRound className="size-4" aria-hidden />}
                rows={breakdowns.byStaff}
              />
              <BreakdownSection
                title="By resident"
                icon={<FileBarChart className="size-4" aria-hidden />}
                rows={breakdowns.byResident}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Date field                                                                */
/* -------------------------------------------------------------------------- */

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground tabular-nums shadow-sm transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  KPI card                                                                  */
/* -------------------------------------------------------------------------- */

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: Tone;
  hint: string;
}) {
  return (
    <article
      aria-label={`${label}: ${value}`}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3",
        tone === "danger" && "border-danger/40",
        tone === "warning" && "border-warning/40",
        tone === "success" && "border-success/40",
        tone === "default" && "border-border",
      )}
    >
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Breakdown section                                                          */
/* -------------------------------------------------------------------------- */

function BreakdownSection({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: BreakdownRow[];
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        <span className="text-[12px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? "record" : "records"}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-[13px] text-muted-foreground">
            No rows returned for this window.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border text-[12px] font-semibold text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Label</th>
                <th className="px-4 py-2.5 text-right">Expected</th>
                <th className="px-4 py-2.5 text-right">Completed</th>
                <th className="px-4 py-2.5 text-right">On time</th>
                <th className="px-4 py-2.5 text-right">Late</th>
                <th className="px-4 py-2.5 text-right">Missed</th>
                <th className="px-4 py-2.5 text-right">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const rate =
                  row.expected > 0 ? Math.round((row.completed / row.expected) * 100) : 0;
                const tone = rateRowTone(rate);

                return (
                  <tr key={row.label} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium text-foreground">{row.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                      {row.expected}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                      {row.completed}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={cn(row.onTime > 0 && "text-success")}>{row.onTime}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={cn(row.late > 0 && "text-warning")}>{row.late}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={cn(row.missed > 0 && "text-danger")}>{row.missed}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <RatePill rate={rate} tone={tone} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RatePill({ rate, tone }: { rate: number; tone: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
        tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
        tone === "success" && "border-success/40 bg-success/10 text-success",
        tone === "default" && "border-border bg-muted text-foreground",
      )}
    >
      {rate}%
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notices + empty states                                                    */
/* -------------------------------------------------------------------------- */

function AllFacilitiesInterstitial() {
  return (
    <section
      aria-label="Facility scope required"
      className="rounded-lg border border-dashed border-border bg-card p-6"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Completion reports operate per facility
          </p>
          <p className="text-[13px] text-muted-foreground">
            Rounding completion data is facility-scoped. Select a facility from the top bar to
            continue.
          </p>
        </div>
      </div>
    </section>
  );
}

function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 shrink-0 text-[12px]"
      >
        Retry
      </Button>
    </div>
  );
}

function NoDataEmptyState() {
  return (
    <section
      aria-label="No completion data"
      className="rounded-lg border border-dashed border-border bg-card p-8 text-center"
    >
      <CheckCircle2 className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">
        No completion data in this window
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Adjust the date range, or check that rounding cycles ran in the selected window.
      </p>
    </section>
  );
}
