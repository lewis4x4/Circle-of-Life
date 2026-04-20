"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildStandupPacketDocument } from "@/lib/executive/standup-packet";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { downloadTextFile } from "@/lib/onboarding/download";
import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  saveStandupBoardReport,
  fetchStandupSnapshotDetail,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";

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

  const packet = useMemo(() => (detail ? buildStandupPacketDocument(detail, previousDetail) : null), [detail, previousDetail]);

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
            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-8 py-10 text-white shadow-none">
              <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Haven executive standup packet</p>
                  <h2 className="mt-3 text-5xl font-semibold tracking-tight">Week of {detail.snapshot.weekOf}</h2>
                  <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-300">
                    Published ownership packet with portfolio scorecard, facility ranking, executive actions, and workbook-equivalent section detail.
                  </p>
                  <div className="mt-8 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Status</div>
                      <div className="mt-2 text-xl font-semibold capitalize">{detail.snapshot.status}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Confidence</div>
                      <div className="mt-2 text-xl font-semibold capitalize">{detail.snapshot.confidenceBand}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Completeness</div>
                      <div className="mt-2 text-xl font-semibold">{detail.snapshot.completenessPct.toFixed(0)}%</div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-sm text-slate-200">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Prepared</div>
                    <div className="mt-2 text-xl font-semibold text-white">{detail.snapshot.generatedByName ?? detail.snapshot.generatedById ?? "System"}</div>
                    <div className="mt-2">{new Date(detail.snapshot.generatedAt).toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 text-sm text-slate-200">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Published</div>
                    <div className="mt-2 text-xl font-semibold text-white">{detail.snapshot.publishedByName ?? detail.snapshot.publishedById ?? "Not published"}</div>
                    <div className="mt-2">{detail.snapshot.publishedAt ? new Date(detail.snapshot.publishedAt).toLocaleString() : "Not yet"}</div>
                    <div className="mt-2 text-slate-400">Version {detail.snapshot.publishedVersion}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {packet?.summaryCards.map((card) => {
                if (!card) return null;
                return (
                  <Card key={card.key} className="border-slate-200 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{card.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold text-slate-900">{card.value}</div>
                      <div className="mt-2 text-sm text-indigo-600">{card.delta}</div>
                      <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">{card.confidenceBand} confidence</div>
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
                  {detail?.facilities.filter((facility) => facility.facilityId != null)
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
                  {packet ? (
                    <>
                      <p className="font-semibold">{packet.narrative.headline}</p>
                      {(packet.narrative.bullets.length > 0 ? packet.narrative.bullets : ["No narrative insights available."]).map((insight) => (
                        <p key={insight}>{insight}</p>
                      ))}
                    </>
                  ) : (
                    <p>No insight summary available yet.</p>
                  )}
                </CardContent>
              </Card>
            </section>

            {packet ? (
              <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>Changes since last published week</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(packet.narrative.changes.length > 0 ? packet.narrative.changes : ["No prior published week available for comparison."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>Data quality</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(packet.narrative.dataQuality.length > 0 ? packet.narrative.dataQuality : ["No data quality warnings."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>Intervention queue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(packet.narrative.actions.length > 0 ? packet.narrative.actions : ["No intervention recommendations."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
              </section>
            ) : null}

            {packet && packet.narrative.facilityActions.length > 0 ? (
              <section className="space-y-4">
                <h3 className="text-2xl font-semibold tracking-tight">Why this is red</h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {packet.narrative.facilityActions.slice(0, 6).map((action) => (
                    <Card key={action.facilityId} className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3">
                          <span>{action.facilityName}</span>
                          <span className="text-sm font-medium text-slate-500">Pressure {action.pressureScore}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 text-sm text-slate-700">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Why red</div>
                          <ul className="mt-2 space-y-1">
                            {(action.whyRed.length > 0 ? action.whyRed : ["No active red flags beyond the summary concern."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Variance flags</div>
                          <ul className="mt-2 space-y-1">
                            {(action.varianceFlags.length > 0 ? action.varianceFlags : ["No material week-over-week delta against the prior published packet."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Interventions</div>
                          <ul className="mt-2 space-y-1">
                            {action.interventions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-slate-200 shadow-none">
                <CardHeader>
                  <CardTitle>Legend</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  {(packet?.legend ?? []).map((item) => (
                    <p key={item.label}><strong>{item.label}</strong>: {item.description}</p>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-slate-200 shadow-none">
                <CardHeader>
                  <CardTitle>Methodology</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  {(packet?.methodology ?? []).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </CardContent>
              </Card>
            </section>

            {packet?.reviewNotes || packet?.draftNotes ? (
              <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {packet.reviewNotes ? (
                  <Card className="border-slate-200 shadow-none">
                    <CardHeader>
                      <CardTitle>Review notes</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-slate-700">
                      <p>{packet.reviewNotes}</p>
                    </CardContent>
                  </Card>
                ) : null}
                {packet.draftNotes ? (
                  <Card className="border-slate-200 shadow-none">
                    <CardHeader>
                      <CardTitle>Draft notes</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-slate-700">
                      <p>{packet.draftNotes}</p>
                    </CardContent>
                  </Card>
                ) : null}
              </section>
            ) : null}

            {packet?.comparison ? (
              <section className="space-y-4">
                <h3 className="text-2xl font-semibold tracking-tight">Comparison appendix</h3>
                <Card className="border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle>{packet.comparison.headline}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    {(packet.comparison.portfolioDeltas.length > 0 ? packet.comparison.portfolioDeltas : ["No material portfolio deltas between these weeks."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {packet.comparison.facilityComparisons.slice(0, 6).map((facility) => (
                    <Card key={facility.facilityId} className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3">
                          <span>{facility.facilityName}</span>
                          <span className="text-sm font-medium text-slate-500">
                            {facility.pressureDelta > 0 ? "+" : ""}{facility.pressureDelta} pressure
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-slate-700">
                        <p>{packet.comparison!.fromWeek}: {facility.concernFrom}</p>
                        <p>{packet.comparison!.toWeek}: {facility.concernTo}</p>
                        <ul className="space-y-1">
                          {(facility.metricDeltas.length > 0 ? facility.metricDeltas : ["No material metric shifts for this facility."]).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ) : null}

            {packet?.sections.map((section) => {
              if (section.metrics.length === 0) return null;
              return (
                <section key={section.sectionKey}>
                  <h3 className="mb-4 text-2xl font-semibold tracking-tight">{section.sectionLabel}</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-300">
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Metric</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Previous</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Current</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Delta</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Source</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.metrics.map((metric) => {
                          return (
                            <tr key={metric.key} className="border-b border-slate-100 align-top">
                              <td className="px-3 py-3">
                                <div className="font-medium text-slate-900">{metric.label}</div>
                                <div className="mt-1 text-xs text-slate-500">{metric.description}</div>
                              </td>
                              <td className="px-3 py-3 font-semibold text-slate-900">{metric.fromValue}</td>
                              <td className="px-3 py-3 font-semibold text-slate-900">{metric.toValue}</td>
                              <td className="px-3 py-3 text-indigo-600">{metric.delta}</td>
                              <td className="px-3 py-3 text-slate-700">{metric.sourceMode}</td>
                              <td className="px-3 py-3 text-slate-700">{metric.confidenceBand}</td>
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
