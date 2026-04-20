"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { downloadTextFile } from "@/lib/onboarding/download";
import {
  buildStandupBoardPrintHtml,
  buildStandupNarrative,
  fetchPreviousPublishedStandupSnapshotDetail,
  saveStandupBoardReport,
  fetchStandupSnapshotDetail,
  STANDUP_SECTION_LABELS,
  type StandupMetricRow,
  type StandupSectionKey,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatMetricValue(metric: StandupMetricRow): string {
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "—";
  if (metric.valueType === "currency") return USD.format(metric.valueNumeric / 100);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

export default function ExecutiveStandupBoardPage() {
  const params = useParams<{ week: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [detail, setDetail] = useState<StandupSnapshotDetail | null>(null);
  const [previousDetail, setPreviousDetail] = useState<StandupSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [savingBoardReport, setSavingBoardReport] = useState(false);

  const week = typeof params?.week === "string" ? params.week : "";

  const load = useCallback(async () => {
    if (!week) {
      setError("Standup week is missing.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrganizationId(ctx.ctx.organizationId);
      const { data: authData } = await supabase.auth.getUser();
      setUserId(authData.user?.id ?? null);
      const [snapshot, previous] = await Promise.all([
        fetchStandupSnapshotDetail(supabase, ctx.ctx.organizationId, week),
        fetchPreviousPublishedStandupSnapshotDetail(supabase, ctx.ctx.organizationId, week),
      ]);
      setDetail(snapshot);
      setPreviousDetail(previous);
    } catch (loadError) {
      setDetail(null);
      setPreviousDetail(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load board packet.");
    } finally {
      setLoading(false);
    }
  }, [supabase, week]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilities = useMemo(() => (detail?.facilities ?? []).filter((facility) => facility.facilityId != null), [detail]);
  const totals = useMemo(() => (detail?.facilities ?? []).find((facility) => facility.facilityId == null) ?? null, [detail]);
  const narrative = useMemo(() => (detail ? buildStandupNarrative(detail, previousDetail) : null), [detail, previousDetail]);

  const sectionMetricKeys = useMemo(() => {
    const keys = new Map<StandupSectionKey, string[]>();
    if (!detail) return keys;
    for (const facility of detail.facilities) {
      for (const key of Object.keys(facility.metrics)) {
        const metric = facility.metrics[key];
        if (!keys.has(metric.sectionKey)) keys.set(metric.sectionKey, []);
        const arr = keys.get(metric.sectionKey)!;
        if (!arr.includes(key)) arr.push(key);
      }
    }
    return keys;
  }, [detail]);

  function onExportBoardPacket() {
    if (!detail) return;
    const html = buildStandupBoardPrintHtml(detail, previousDetail);
    downloadTextFile(`executive-standup-${detail.snapshot.weekOf}.html`, html, "text/html;charset=utf-8");
  }

  async function onSaveBoardReport() {
    if (!detail || !organizationId || !userId) {
      setError("Sign in required.");
      return;
    }
    setSavingBoardReport(true);
    setError(null);
    try {
      await saveStandupBoardReport(supabase, {
        organizationId,
        userId,
        weekOf: detail.snapshot.weekOf,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save board packet report.");
    } finally {
      setSavingBoardReport(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-8 print:px-4">
        <div className="mb-8 flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Board packet</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Executive Standup Board View</h1>
            <p className="mt-2 text-sm text-slate-600">Print or save this page as PDF for a board-ready packet.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button type="button" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print / Save PDF
            </Button>
            <Button type="button" variant="outline" onClick={onExportBoardPacket}>
              Export HTML packet
            </Button>
            <Button type="button" variant="outline" onClick={() => void onSaveBoardReport()} disabled={savingBoardReport}>
              {savingBoardReport ? "Saving…" : "Save in executive reports"}
            </Button>
            <Link
              href={`/admin/executive/standup/${week}`}
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 px-4 text-xs font-semibold uppercase tracking-widest text-slate-700"
            >
              Back to draft
            </Link>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="text-sm text-slate-500">Loading board packet…</div>
        ) : !detail ? (
          <div className="text-sm text-slate-500">No standup data found for this week.</div>
        ) : (
          <div className="space-y-8">
            <header className="border-b border-slate-200 pb-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Haven executive standup</p>
                  <h2 className="mt-2 text-4xl font-semibold tracking-tight">Week of {detail.snapshot.weekOf}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
                    Published ownership packet with portfolio scorecard, facility ranking, and workbook-equivalent section detail.
                  </p>
                </div>
                <div className="text-right text-sm text-slate-600">
                  <div>Status: <span className="font-semibold capitalize text-slate-900">{detail.snapshot.status}</span></div>
                  <div>Generated: {new Date(detail.snapshot.generatedAt).toLocaleString()}</div>
                  <div>Published: {detail.snapshot.publishedAt ? new Date(detail.snapshot.publishedAt).toLocaleString() : "Not yet"}</div>
                  <div>Confidence: <span className="font-semibold capitalize text-slate-900">{detail.snapshot.confidenceBand}</span></div>
                </div>
              </div>
            </header>

            <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {["current_ar_cents", "current_total_census", "total_beds_open", "hospital_and_rehab_total"].map((metricKey) => {
                const metric = totals?.metrics[metricKey];
                if (!metric) return null;
                return (
                  <Card key={metricKey} className="border-slate-200 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{metric.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold text-slate-900">{formatMetricValue(metric)}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-slate-200 shadow-none">
                <CardHeader>
                  <CardTitle>Facility ranking</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {facilities
                    .slice()
                    .sort((a, b) => b.pressureScore - a.pressureScore)
                    .map((facility, index) => (
                      <div key={facility.facilityId} className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm last:border-none">
                        <div>
                          <div className="font-semibold text-slate-900">{index + 1}. {facility.facilityName}</div>
                          <div className="text-slate-600">{facility.topConcern}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Pressure</div>
                          <div className="font-semibold text-slate-900">{facility.pressureScore}</div>
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-none">
                <CardHeader>
                  <CardTitle>Executive insights</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  {narrative ? (
                    <>
                      <p className="font-semibold">{narrative.headline}</p>
                      {(narrative.bullets.length > 0 ? narrative.bullets : ["No narrative insights available."]).map((insight) => (
                        <p key={insight}>{insight}</p>
                      ))}
                    </>
                  ) : (
                    <p>No insight summary available yet.</p>
                  )}
                </CardContent>
              </Card>
            </section>

            {narrative ? (
              <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>Changes since last published week</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(narrative.changes.length > 0 ? narrative.changes : ["No prior published week available for comparison."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>Data quality</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(narrative.dataQuality.length > 0 ? narrative.dataQuality : ["No data quality warnings."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
              </section>
            ) : null}

            {(Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
              const metricKeys = sectionMetricKeys.get(sectionKey) ?? [];
              if (metricKeys.length === 0) return null;
              return (
                <section key={sectionKey}>
                  <h3 className="mb-4 text-2xl font-semibold tracking-tight">{sectionLabel}</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-300">
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Metric</th>
                          {facilities.map((facility) => (
                            <th key={facility.facilityId} className="px-3 py-2 text-left font-semibold text-slate-600">{facility.facilityName}</th>
                          ))}
                          {totals ? <th className="px-3 py-2 text-left font-semibold text-slate-600">Totals</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {metricKeys.map((metricKey) => {
                          const sample = facilities.find((facility) => facility.metrics[metricKey])?.metrics[metricKey] ?? totals?.metrics[metricKey];
                          if (!sample) return null;
                          return (
                            <tr key={metricKey} className="border-b border-slate-100 align-top">
                              <td className="px-3 py-3">
                                <div className="font-medium text-slate-900">{sample.label}</div>
                                <div className="mt-1 text-xs text-slate-500">{sample.description}</div>
                              </td>
                              {facilities.map((facility) => (
                                <td key={`${facility.facilityId}:${metricKey}`} className="px-3 py-3">
                                  <div className="font-semibold text-slate-900">{formatMetricValue(facility.metrics[metricKey])}</div>
                                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                    {facility.metrics[metricKey].sourceMode} · {facility.metrics[metricKey].confidenceBand}
                                  </div>
                                </td>
                              ))}
                              {totals ? (
                                <td className="px-3 py-3">
                                  <div className="font-semibold text-slate-900">{formatMetricValue(totals.metrics[metricKey])}</div>
                                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                    {totals.metrics[metricKey].sourceMode} · {totals.metrics[metricKey].confidenceBand}
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
