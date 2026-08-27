"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Printer, RefreshCw } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildStandupPacketDocument } from "@/lib/executive/standup-packet";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { downloadBlobFromUrl } from "@/lib/download-blob";
import { createClient } from "@/lib/supabase/client";
import { downloadTextFile } from "@/lib/onboarding/download";
import {
  buildStandupBoardPrintHtml,
  fetchPreviousPublishedStandupSnapshotDetail,
  saveStandupBoardReport,
  fetchStandupSnapshotDetail,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";
import {
  EXECUTIVE_STANDUP_BOARD_LOADING_MESSAGE,
  hasExecutiveStandupOrgScopedDetailData,
  resolveExecutiveStandupFetchErrorBannerMessage,
  resolveExecutiveStandupOrganizationGapMessage,
} from "@/lib/executive/standup-page-state";
import { RecordDetailHeader } from "@/design-system/components/record-detail";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";

export default function ExecutiveStandupBoardPage() {
  const params = useParams<{ week: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const [detail, setDetail] = useState<StandupSnapshotDetail | null>(null);
  const [previousDetail, setPreviousDetail] = useState<StandupSnapshotDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingBoardReport, setSavingBoardReport] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const week = typeof params?.week === "string" ? params.week : "";

  const hasOrgScopedDetailData = hasExecutiveStandupOrgScopedDetailData(detail);
  const organizationGapMessage = resolveExecutiveStandupOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedPackData: hasOrgScopedDetailData,
  });
  const fetchErrorBannerMessage = resolveExecutiveStandupFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!week) {
      setFetchError("Standup week is missing.");
      setFetching(false);
      return;
    }

    if (!organizationId) {
      setDetail(null);
      setPreviousDetail(null);
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);
    try {
      const [snapshot, previous] = await Promise.all([
        fetchStandupSnapshotDetail(supabase, organizationId, week),
        fetchPreviousPublishedStandupSnapshotDetail(supabase, organizationId, week),
      ]);
      setDetail(snapshot);
      setPreviousDetail(previous);
    } catch (loadError) {
      setDetail(null);
      setPreviousDetail(null);
      setFetchError(formatLiveDataLoadError(loadError, "Could not load board packet."));
    } finally {
      setFetching(false);
    }
  }, [authLoading, organizationId, supabase, week]);

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
    if (!detail || !organizationId || !user?.id) {
      setActionError("Sign in required.");
      return;
    }
    setSavingBoardReport(true);
    setActionError(null);
    try {
      await saveStandupBoardReport(supabase, {
        organizationId,
        userId: user.id,
        weekOf: detail.snapshot.weekOf,
        status: detail.snapshot.status,
        confidenceBand: detail.snapshot.confidenceBand,
        version: detail.snapshot.publishedVersion,
        publishedAt: detail.snapshot.publishedAt,
        completenessPct: detail.snapshot.completenessPct,
      });
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "Could not save board packet report.");
    } finally {
      setSavingBoardReport(false);
    }
  }

  async function onDownloadPdf() {
    if (!detail) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      await downloadBlobFromUrl(
        `/api/executive/standup/${encodeURIComponent(detail.snapshot.weekOf)}/pdf`,
        `executive-standup-${detail.snapshot.weekOf}.pdf`,
      );
    } catch (downloadError) {
      setActionError(downloadError instanceof Error ? downloadError.message : "Could not generate standup PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8 print:px-4">
        <div className="print:hidden">
          <RecordDetailHeader
            title="Executive Standup Board View"
            subtitle="Print or save this page as PDF for a board-ready packet."
            backLink={{ label: "Back to draft", href: `/admin/executive/standup/${week}` }}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button type="button" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print / Save PDF
                </Button>
                <Button type="button" variant="outline" onClick={() => void onDownloadPdf()} disabled={downloadingPdf}>
                  {downloadingPdf ? "Generating PDF…" : "Download PDF"}
                </Button>
                <Button type="button" variant="outline" onClick={onExportBoardPacket}>
                  Export HTML packet
                </Button>
                <Button type="button" variant="outline" onClick={() => void onSaveBoardReport()} disabled={savingBoardReport}>
                  {savingBoardReport ? "Saving…" : "Save in executive reports"}
                </Button>
              </div>
            }
          />
        </div>

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => void load()} />
        ) : null}

        {actionError ? (
          <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}

        {loading ? (
          <Card className="rounded-lg border border-border bg-card shadow-sm">
            <CardContent
              className="flex items-center gap-3 p-6 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {EXECUTIVE_STANDUP_BOARD_LOADING_MESSAGE}
            </CardContent>
          </Card>
        ) : !detail ? (
          <Card className="rounded-lg border border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle>No standup board packet yet</CardTitle>
              <CardDescription>
                This week has no standup data to preview. Generate a draft from the standup pack page first.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-8">
            <section className="overflow-hidden rounded-[8px] border border-border bg-card px-8 py-10">
              <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Haven executive standup packet</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{packet?.title ?? "Executive Standup Pack"}</p>
                  <p className="mt-2 text-sm uppercase tracking-[0.18em] text-muted-foreground">Week of {detail.snapshot.weekOf}</p>
                  <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
                    {packet?.subtitle ?? "Owner and board operating packet"}. Designed for fast comprehension, defensible trust, and immediate action.
                  </p>
                  <div className="mt-8 grid gap-4 sm:grid-cols-3">
                    {[
                      { label: "Status", value: <span className="capitalize">{detail.snapshot.status}</span> },
                      { label: "Confidence", value: <span className="capitalize">{detail.snapshot.confidenceBand}</span> },
                      { label: "Completeness", value: `${detail.snapshot.completenessPct.toFixed(0)}%` },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-[8px] border border-border bg-muted/10 px-4 py-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                        <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-[8px] border border-border bg-muted/10 px-5 py-5 text-sm">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Prepared</div>
                    <div className="mt-2 text-xl font-semibold text-foreground">{detail.snapshot.generatedByName ?? detail.snapshot.generatedById ?? "System"}</div>
                    <div className="mt-2 tabular-nums text-muted-foreground">{new Date(detail.snapshot.generatedAt).toLocaleString()}</div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-muted/10 px-5 py-5 text-sm">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Published</div>
                    <div className="mt-2 text-xl font-semibold text-foreground">{detail.snapshot.publishedByName ?? detail.snapshot.publishedById ?? "Not published"}</div>
                    <div className="mt-2 tabular-nums text-muted-foreground">{detail.snapshot.publishedAt ? new Date(detail.snapshot.publishedAt).toLocaleString() : "Not yet"}</div>
                    <div className="mt-2 tabular-nums text-muted-foreground">Version {detail.snapshot.publishedVersion}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <Card className="border-border shadow-none">
                <CardHeader>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Primary focus</div>
                  <CardTitle className="text-3xl tracking-tight">{packet?.focusStatement ?? "No focus statement available."}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Executive packet summary for the current week. This is the fastest read on what leadership should pay attention to right now.
                </CardContent>
              </Card>
              {packet?.spotlightFacility ? (
                <Card className="border-border shadow-none">
                  <CardHeader>
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Facility spotlight</div>
                    <CardTitle className="text-3xl tracking-tight">{packet.spotlightFacility.facilityName}</CardTitle>
                    <CardDescription>{packet.spotlightFacility.topConcern}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-foreground">
                    {packet.spotlightFacility.interventions.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </section>

            <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {packet?.summaryCards.map((card) => {
                if (!card) return null;
                return (
                  <Card key={card.key} className="border-border shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold tabular-nums text-foreground">{card.value}</div>
                      <div className="mt-2 text-sm text-muted-foreground">{card.delta}</div>
                      <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{card.confidenceBand} confidence</div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-border shadow-none">
                <CardHeader>
                  <CardTitle>Facility ranking</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail?.facilities.filter((facility) => facility.facilityId != null)
                    .slice()
                    .sort((a, b) => b.pressureScore - a.pressureScore)
                    .map((facility, index) => (
                      <div key={facility.facilityId} className="flex items-center justify-between border-b border-border pb-3 text-sm last:border-none">
                        <div>
                          <div className="font-semibold text-foreground">{index + 1}. {facility.facilityName}</div>
                          <div className="text-muted-foreground">{facility.topConcern}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Pressure</div>
                          <div className="font-semibold tabular-nums text-foreground">{facility.pressureScore}</div>
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <Card className="border-border shadow-none">
                <CardHeader>
                  <CardTitle>Executive insights</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-foreground">
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
                <Card className="border-border shadow-none">
                  <CardHeader>
                    <CardTitle>Changes since last published week</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-foreground">
                    {(packet.narrative.changes.length > 0 ? packet.narrative.changes : ["No prior published week available for comparison."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-border shadow-none">
                  <CardHeader>
                    <CardTitle>Data quality</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-foreground">
                    {(packet.narrative.dataQuality.length > 0 ? packet.narrative.dataQuality : ["No data quality warnings."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-border shadow-none">
                  <CardHeader>
                    <CardTitle>Intervention queue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-foreground">
                    {(packet.narrative.actions.length > 0 ? packet.narrative.actions : ["No intervention recommendations."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
              </section>
            ) : null}

            {packet && packet.narrative.facilityActions.length > 0 ? (
              <section className="space-y-4">
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">Why this is red</h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {packet.narrative.facilityActions.slice(0, 6).map((action) => (
                    <Card key={action.facilityId} className="border-border shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3">
                          <span>{action.facilityName}</span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">Pressure {action.pressureScore}</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 text-sm text-foreground">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Why red</div>
                          <ul className="mt-2 space-y-1">
                            {(action.whyRed.length > 0 ? action.whyRed : ["No active red flags beyond the summary concern."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Variance flags</div>
                          <ul className="mt-2 space-y-1">
                            {(action.varianceFlags.length > 0 ? action.varianceFlags : ["No material week-over-week delta against the prior published packet."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Interventions</div>
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
              <Card className="border-border shadow-none">
                <CardHeader>
                  <CardTitle>Legend</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-foreground">
                  {(packet?.legend ?? []).map((item) => (
                    <p key={item.label}><strong>{item.label}</strong>: {item.description}</p>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-border shadow-none">
                <CardHeader>
                  <CardTitle>Methodology</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-foreground">
                  {(packet?.methodology ?? []).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </CardContent>
              </Card>
            </section>

            {packet?.reviewNotes || packet?.draftNotes ? (
              <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {packet.reviewNotes ? (
                  <Card className="border-border shadow-none">
                    <CardHeader>
                      <CardTitle>Review notes</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-foreground">
                      <p>{packet.reviewNotes}</p>
                    </CardContent>
                  </Card>
                ) : null}
                {packet.draftNotes ? (
                  <Card className="border-border shadow-none">
                    <CardHeader>
                      <CardTitle>Draft notes</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-foreground">
                      <p>{packet.draftNotes}</p>
                    </CardContent>
                  </Card>
                ) : null}
              </section>
            ) : null}

            {packet?.comparison ? (
              <section className="space-y-4">
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">Comparison appendix</h3>
                <Card className="border-border shadow-none">
                  <CardHeader>
                    <CardTitle>{packet.comparison.headline}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-foreground">
                    {(packet.comparison.portfolioDeltas.length > 0 ? packet.comparison.portfolioDeltas : ["No material portfolio deltas between these weeks."]).map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </CardContent>
                </Card>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {packet.comparison.facilityComparisons.slice(0, 6).map((facility) => (
                    <Card key={facility.facilityId} className="border-border shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-3">
                          <span>{facility.facilityName}</span>
                          <span className="text-sm font-medium tabular-nums text-muted-foreground">
                            {facility.pressureDelta > 0 ? "+" : ""}{facility.pressureDelta} pressure
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-foreground">
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
                  <h3 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">{section.sectionLabel}</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Metric</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Previous</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Current</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Delta</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Source</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.metrics.map((metric) => {
                          return (
                            <tr key={metric.key} className="border-b border-border/50 align-top">
                              <td className="px-3 py-3">
                                <div className="font-medium text-foreground">{metric.label}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{metric.description}</div>
                              </td>
                              <td className="px-3 py-3 tabular-nums font-semibold text-foreground">{metric.fromValue}</td>
                              <td className="px-3 py-3 tabular-nums font-semibold text-foreground">{metric.toValue}</td>
                              <td className="px-3 py-3 tabular-nums text-muted-foreground">{metric.delta}</td>
                              <td className="px-3 py-3 text-muted-foreground">{metric.sourceMode}</td>
                              <td className="px-3 py-3 text-muted-foreground">{metric.confidenceBand}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            <section className="space-y-4">
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">Workbook appendix</h3>
              {packet?.appendixSections.map((section) => {
                if (section.metrics.length === 0) return null;
                return (
                  <Card key={`appendix-${section.sectionKey}`} className="border-border shadow-none">
                    <CardHeader>
                      <CardTitle>{section.sectionLabel}</CardTitle>
                      <CardDescription>Full section listing, including low-signal or incomplete rows intentionally kept out of the primary packet.</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Metric</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Previous</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Current</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Delta</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Source</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.metrics.map((metric) => (
                            <tr key={`appendix-${metric.key}`} className="border-b border-border/50 align-top">
                              <td className="px-3 py-3">
                                <div className="font-medium text-foreground">{metric.label}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{metric.description}</div>
                              </td>
                              <td className="px-3 py-3 tabular-nums font-semibold text-foreground">{metric.fromValue}</td>
                              <td className="px-3 py-3 tabular-nums font-semibold text-foreground">{metric.toValue}</td>
                              <td className="px-3 py-3 tabular-nums text-muted-foreground">{metric.delta}</td>
                              <td className="px-3 py-3 text-muted-foreground">{metric.sourceMode}</td>
                              <td className="px-3 py-3 text-muted-foreground">{metric.confidenceBand}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
