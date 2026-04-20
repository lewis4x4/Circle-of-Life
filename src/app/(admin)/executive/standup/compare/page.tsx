"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import {
  buildStandupComparison,
  fetchStandupHistory,
  fetchStandupSnapshotDetail,
  STANDUP_SECTION_LABELS,
  type StandupComparison,
  type StandupMetricRow,
  type StandupSectionKey,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatMetricValue(metric: StandupMetricRow | undefined): string {
  if (!metric) return "—";
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "—";
  if (metric.valueType === "currency") return USD.format(metric.valueNumeric / 100);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

function formatDelta(metricLeft: StandupMetricRow | undefined, metricRight: StandupMetricRow | undefined): string {
  if (!metricLeft || !metricRight || metricLeft.valueNumeric == null || metricRight.valueNumeric == null) return "—";
  const delta = metricRight.valueNumeric - metricLeft.valueNumeric;
  if (delta === 0) return "No change";
  if (metricRight.valueType === "currency") return `${delta > 0 ? "+" : "-"}${USD.format(Math.abs(delta) / 100)}`;
  if (metricRight.valueType === "hours") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)} hrs`;
  if (metricRight.valueType === "percent") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
}

export default function ExecutiveStandupComparePage() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<Array<{ weekOf: string; id: string }>>([]);
  const [leftDetail, setLeftDetail] = useState<StandupSnapshotDetail | null>(null);
  const [rightDetail, setRightDetail] = useState<StandupSnapshotDetail | null>(null);
  const [comparison, setComparison] = useState<StandupComparison | null>(null);

  const fromWeek = searchParams.get("from") ?? "";
  const toWeek = searchParams.get("to") ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const history = await fetchStandupHistory(supabase, ctx.ctx.organizationId, 52);
      setHistoryRows(history.map((row) => ({ id: row.id, weekOf: row.weekOf })));

      if (!fromWeek || !toWeek || fromWeek === toWeek) {
        setLeftDetail(null);
        setRightDetail(null);
        setComparison(null);
        setLoading(false);
        return;
      }

      const [fromDetail, toDetail] = await Promise.all([
        fetchStandupSnapshotDetail(supabase, ctx.ctx.organizationId, fromWeek),
        fetchStandupSnapshotDetail(supabase, ctx.ctx.organizationId, toWeek),
      ]);

      if (!fromDetail || !toDetail) {
        throw new Error("One or both standup weeks could not be loaded for comparison.");
      }

      setLeftDetail(fromDetail);
      setRightDetail(toDetail);
      setComparison(buildStandupComparison(fromDetail, toDetail));
    } catch (loadError) {
      setLeftDetail(null);
      setRightDetail(null);
      setComparison(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load standup comparison.");
    } finally {
      setLoading(false);
    }
  }, [fromWeek, supabase, toWeek]);

  useEffect(() => {
    void load();
  }, [load]);

  const sectionMetricKeys = useMemo(() => {
    const keys = new Map<StandupSectionKey, string[]>();
    if (!leftDetail || !rightDetail) return keys;
    const allFacilities = [...leftDetail.facilities, ...rightDetail.facilities];
    for (const facility of allFacilities) {
      for (const key of Object.keys(facility.metrics)) {
        const metric = facility.metrics[key];
        if (!keys.has(metric.sectionKey)) keys.set(metric.sectionKey, []);
        const arr = keys.get(metric.sectionKey)!;
        if (!arr.includes(key)) arr.push(key);
      }
    }
    return keys;
  }, [leftDetail, rightDetail]);

  const leftTotals = useMemo(() => leftDetail?.facilities.find((facility) => facility.facilityId == null) ?? null, [leftDetail]);
  const rightTotals = useMemo(() => rightDetail?.facilities.find((facility) => facility.facilityId == null) ?? null, [rightDetail]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <ExecutiveHubNav />

        <header className="rounded-[2rem] border border-slate-200/70 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Standup compare
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Executive Standup Comparison</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                Compare any two weekly standup packets without going back to spreadsheet side-by-side review.
              </p>
            </div>
            <Link
              href="/admin/executive/standup/history"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              Back to history
            </Link>
          </div>
        </header>

        {error ? (
          <Card className="border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10">
            <CardContent className="p-4 text-sm text-rose-700 dark:text-rose-300">{error}</CardContent>
          </Card>
        ) : null}

        {loading ? (
          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardContent className="flex items-center gap-3 p-6 text-sm text-slate-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading comparison…
            </CardContent>
          </Card>
        ) : !comparison || !leftDetail || !rightDetail ? (
          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Select two different weeks to compare</CardTitle>
              <CardDescription>Use the compare controls on standup history to launch a week-over-week view.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-500 dark:text-zinc-400">
              {historyRows.length > 0 ? `Available weeks: ${historyRows.map((row) => row.weekOf).join(", ")}` : "No standup weeks available yet."}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">{comparison.headline}</CardTitle>
                <CardDescription>
                  Comparing <span className="font-semibold">{comparison.fromWeek}</span> to <span className="font-semibold">{comparison.toWeek}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Portfolio deltas</div>
                  <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                    {(comparison.portfolioDeltas.length > 0 ? comparison.portfolioDeltas : ["No material portfolio deltas between these weeks."]).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {["current_ar_cents", "current_total_census", "total_beds_open", "callouts_last_week"].map((metricKey) => {
                    const leftMetric = leftTotals?.metrics[metricKey];
                    const rightMetric = rightTotals?.metrics[metricKey];
                    return (
                      <div key={metricKey} className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">{rightMetric?.label ?? leftMetric?.label ?? metricKey}</div>
                        <div className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{comparison.fromWeek}</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{formatMetricValue(leftMetric)}</div>
                        <div className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{comparison.toWeek}</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{formatMetricValue(rightMetric)}</div>
                        <div className="mt-3 text-sm font-medium text-indigo-600 dark:text-indigo-300">{formatDelta(leftMetric, rightMetric)}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Facility movement</CardTitle>
                <CardDescription>Pressure shift, top-concern change, and the biggest metric movement by facility.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-3">
                {comparison.facilityComparisons.map((facility) => (
                  <div key={facility.facilityId} className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{facility.facilityName}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                          {comparison.fromWeek}: {facility.concernFrom}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-zinc-400">
                          {comparison.toWeek}: {facility.concernTo}
                        </div>
                      </div>
                      <Badge variant="outline">{facility.pressureDelta > 0 ? `+${facility.pressureDelta}` : facility.pressureDelta} pressure</Badge>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm text-slate-700 dark:text-zinc-300">
                      {(facility.metricDeltas.length > 0 ? facility.metricDeltas : ["No material metric shifts for this facility."]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>

            {(Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
              const metricKeys = sectionMetricKeys.get(sectionKey) ?? [];
              if (metricKeys.length === 0) return null;
              return (
                <Card key={sectionKey} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <CardHeader>
                    <CardTitle className="text-lg">{sectionLabel}</CardTitle>
                    <CardDescription>Total-row comparison across the two selected weeks.</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-white/10">
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">Metric</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">{comparison.fromWeek}</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">{comparison.toWeek}</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricKeys.map((metricKey) => {
                          const leftMetric = leftTotals?.metrics[metricKey];
                          const rightMetric = rightTotals?.metrics[metricKey];
                          const sample = rightMetric ?? leftMetric;
                          if (!sample) return null;
                          return (
                            <tr key={metricKey} className="border-b border-slate-100 dark:border-white/5">
                              <td className="px-3 py-3">
                                <div className="font-medium text-slate-900 dark:text-white">{sample.label}</div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{sample.description}</div>
                              </td>
                              <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{formatMetricValue(leftMetric)}</td>
                              <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{formatMetricValue(rightMetric)}</td>
                              <td className="px-3 py-3 text-indigo-600 dark:text-indigo-300">{formatDelta(leftMetric, rightMetric)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
