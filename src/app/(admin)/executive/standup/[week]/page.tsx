"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Loader2, Save } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { downloadTextFile } from "@/lib/onboarding/download";
import {
  buildStandupBoardPrintHtml,
  buildStandupNarrative,
  evaluateStandupPublishReadiness,
  STANDUP_SECTION_LABELS,
  fetchStandupSnapshotDetail,
  fetchPreviousPublishedStandupSnapshotDetail,
  publishStandupSnapshot,
  saveStandupSnapshotNotes,
  saveStandupMetricInput,
  saveStandupBoardReport,
  standupMetricDefinitionByKey,
  summarizeStandupSections,
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

function editable(metric: StandupMetricRow, snapshot: StandupSnapshotDetail["snapshot"]): boolean {
  return snapshot.status === "draft" && metric.sourceMode !== "auto";
}

function normalizeInput(metric: StandupMetricRow, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (metric.valueType === "currency") return Math.round(parsed * 100);
  return parsed;
}

export default function ExecutiveStandupWeekDetailPage() {
  const params = useParams<{ week: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [detail, setDetail] = useState<StandupSnapshotDetail | null>(null);
  const [previousDetail, setPreviousDetail] = useState<StandupSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [savingBoardReport, setSavingBoardReport] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [draftNotesDraft, setDraftNotesDraft] = useState("");
  const [reviewNotesDraft, setReviewNotesDraft] = useState("");

  const week = typeof params?.week === "string" ? params.week : "";

  const load = useCallback(async () => {
    if (!week) {
      setDetail(null);
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
      const [snapshot, previous] = await Promise.all([
        fetchStandupSnapshotDetail(supabase, ctx.ctx.organizationId, week),
        fetchPreviousPublishedStandupSnapshotDetail(supabase, ctx.ctx.organizationId, week),
      ]);
      setDetail(snapshot);
      setPreviousDetail(previous);
      setCanPublish(canMutateFinance(ctx.ctx.appRole));
      setEdits({});
      setDraftNotesDraft(snapshot?.snapshot.draftNotes ?? "");
      setReviewNotesDraft(snapshot?.snapshot.reviewNotes ?? "");
    } catch (loadError) {
      setDetail(null);
      setPreviousDetail(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load standup detail.");
    } finally {
      setLoading(false);
    }
  }, [supabase, week]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilities = useMemo(() => {
    return (detail?.facilities ?? []).filter((facility) => facility.facilityId != null);
  }, [detail]);

  const totals = useMemo(() => {
    return (detail?.facilities ?? []).find((facility) => facility.facilityId == null) ?? null;
  }, [detail]);

  const sectionMetricKeys = useMemo(() => {
    const keys = new Map<StandupSectionKey, string[]>();
    if (!detail) return keys;
    for (const facility of detail.facilities) {
      for (const key of Object.keys(facility.metrics)) {
        const definition = standupMetricDefinitionByKey(key);
        if (!definition) continue;
        if (!keys.has(definition.sectionKey)) keys.set(definition.sectionKey, []);
        const arr = keys.get(definition.sectionKey)!;
        if (!arr.includes(key)) arr.push(key);
      }
    }
    return keys;
  }, [detail]);

  const summaryCounts = useMemo(() => {
    if (!detail) return { manual: 0, forecast: 0, auto: 0, unresolved: 0 };
    const rows = facilities.flatMap((facility) => Object.values(facility.metrics));
    return rows.reduce(
      (acc, metric) => {
        if (metric.sourceMode === "manual") acc.manual += 1;
        else if (metric.sourceMode === "forecast") acc.forecast += 1;
        else acc.auto += 1;
        if (metric.valueNumeric == null && !(metric.valueText?.trim())) acc.unresolved += 1;
        return acc;
      },
      { manual: 0, forecast: 0, auto: 0, unresolved: 0 },
    );
  }, [detail, facilities]);

  const narrative = useMemo(() => {
    return detail ? buildStandupNarrative(detail, previousDetail) : null;
  }, [detail, previousDetail]);

  const sectionStatuses = useMemo(() => {
    return detail ? summarizeStandupSections(detail) : [];
  }, [detail]);

  const publishReadiness = useMemo(() => {
    return detail ? evaluateStandupPublishReadiness(detail, reviewNotesDraft) : { canPublish: false, blockers: ["Standup detail is unavailable."] };
  }, [detail, reviewNotesDraft]);

  async function onSaveMetric(facilityId: string, metricKey: string, metric: StandupMetricRow) {
    if (!detail || !user?.id || !organizationId) {
      setError("Sign in required.");
      return;
    }
    const editKey = `${facilityId}:${metricKey}`;
    setSavingKey(editKey);
    setError(null);
    try {
      const raw = edits[editKey] ?? "";
      await saveStandupMetricInput(supabase, {
        snapshotId: detail.snapshot.id,
        organizationId,
        weekOf: detail.snapshot.weekOf,
        facilityId,
        metricKey,
        userId: user.id,
        valueNumeric: metric.valueType === "text" ? null : normalizeInput(metric, raw),
        valueText: metric.valueType === "text" ? raw.trim() || null : null,
        sourceMode: metric.sourceMode,
      });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save standup metric.");
    } finally {
      setSavingKey(null);
    }
  }

  async function onPublish() {
    if (!detail || !user?.id) {
      setError("Sign in required.");
      return;
    }
    if (!publishReadiness.canPublish) {
      setError(publishReadiness.blockers[0] ?? "Standup is not ready to publish.");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await publishStandupSnapshot(supabase, {
        snapshotId: detail.snapshot.id,
        userId: user.id,
        reviewNotes: reviewNotesDraft.trim() || null,
      });
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Could not publish standup snapshot.");
    } finally {
      setPublishing(false);
    }
  }

  async function onSaveNotes() {
    if (!detail || !user?.id) {
      setError("Sign in required.");
      return;
    }
    setSavingNotes(true);
    setError(null);
    try {
      await saveStandupSnapshotNotes(supabase, {
        snapshotId: detail.snapshot.id,
        userId: user.id,
        draftNotes: draftNotesDraft.trim() || null,
        reviewNotes: reviewNotesDraft.trim() || null,
      });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save standup notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  function onExportBoardPacket() {
    if (!detail) return;
    const html = buildStandupBoardPrintHtml(detail, previousDetail);
    downloadTextFile(`executive-standup-${detail.snapshot.weekOf}.html`, html, "text/html;charset=utf-8");
  }

  async function onSaveBoardReport() {
    if (!detail || !user?.id || !organizationId) {
      setError("Sign in required.");
      return;
    }
    setSavingBoardReport(true);
    setError(null);
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
      setError(saveError instanceof Error ? saveError.message : "Could not save board packet report.");
    } finally {
      setSavingBoardReport(false);
    }
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <ExecutiveHubNav />

        <header className="rounded-[2rem] border border-slate-200/70 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                Weekly packet detail
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Standup Week {week}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                Draft weeks can be completed in-app. Published weeks remain immutable for owner trust and week-over-week comparison.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {detail ? (
                <>
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest">
                    {detail.snapshot.status} · {detail.snapshot.completenessPct.toFixed(0)}% complete
                  </Badge>
                  <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Refresh
                  </Button>
                  <Link
                    href={`/admin/executive/standup/${week}/board`}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Board preview
                  </Link>
                  <Button type="button" variant="outline" onClick={onExportBoardPacket}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Export board packet
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void onSaveBoardReport()} disabled={savingBoardReport}>
                    {savingBoardReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save in executive reports
                  </Button>
                  <Button type="button" onClick={() => void onPublish()} disabled={!canPublish || detail.snapshot.status !== "draft" || publishing || !publishReadiness.canPublish}>
                    {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Publish week
                  </Button>
                </>
              ) : null}
            </div>
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
              Loading standup week…
            </CardContent>
          </Card>
        ) : !detail ? (
          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader>
              <CardTitle>No standup found for this week</CardTitle>
              <CardDescription>Generate a draft from the standup pack page first.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/admin/executive/standup"
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                Back to standup pack
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader className="pb-2">
                  <CardDescription>Generated</CardDescription>
                  <CardTitle className="text-lg">{new Date(detail.snapshot.generatedAt).toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader className="pb-2">
                  <CardDescription>Published</CardDescription>
                  <CardTitle className="text-lg">{detail.snapshot.publishedAt ? new Date(detail.snapshot.publishedAt).toLocaleString() : "Not yet"}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader className="pb-2">
                  <CardDescription>Completeness</CardDescription>
                  <CardTitle className="text-lg">{detail.snapshot.completenessPct.toFixed(0)}%</CardTitle>
                </CardHeader>
              </Card>
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader className="pb-2">
                  <CardDescription>Confidence</CardDescription>
                  <CardTitle className="text-lg capitalize">{detail.snapshot.confidenceBand}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            {narrative ? (
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader>
                  <CardTitle className="text-lg">Executive narrative</CardTitle>
                  <CardDescription>{narrative.headline}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6 lg:grid-cols-4">
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Current week</div>
                    <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                      {narrative.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Changes</div>
                    <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                      {(narrative.changes.length > 0 ? narrative.changes : ["No prior published week available for comparison."]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Data quality</div>
                    <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                      {(narrative.dataQuality.length > 0 ? narrative.dataQuality : ["No data quality warnings."]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Actions</div>
                    <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                      {(narrative.actions.length > 0 ? narrative.actions : ["No intervention recommendations."]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {narrative && narrative.facilityActions.length > 0 ? (
              <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                <CardHeader>
                  <CardTitle className="text-lg">Why Is This Red?</CardTitle>
                  <CardDescription>Per-facility pressure reasons, variance flags, and intervention recommendations.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 xl:grid-cols-3">
                  {narrative.facilityActions.slice(0, 6).map((action) => (
                    <div key={action.facilityId} className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">{action.facilityName}</div>
                          <div className="mt-1 text-sm text-slate-500 dark:text-zinc-400">{action.topConcern}</div>
                        </div>
                        <Badge variant="outline">Pressure {action.pressureScore}</Badge>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Why red</div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-zinc-300">
                            {(action.whyRed.length > 0 ? action.whyRed : ["No active red flags beyond the headline concern."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Variance flags</div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-zinc-300">
                            {(action.varianceFlags.length > 0 ? action.varianceFlags : ["No material deltas versus the prior published week."]).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Recommended actions</div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-zinc-300">
                            {action.interventions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Weekly close status</CardTitle>
                <CardDescription>Track the unresolved rows before publishing the standup packet.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Auto rows</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{summaryCounts.auto}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Manual rows</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{summaryCounts.manual}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Forecast rows</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{summaryCounts.forecast}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Unresolved</div>
                  <div className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{summaryCounts.unresolved}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Section completion</CardTitle>
                <CardDescription>Each section closes independently so the standup week can be reviewed like a lightweight executive close.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-3">
                {sectionStatuses.map((section) => (
                  <div key={section.sectionKey} className="rounded-xl border border-slate-200/80 p-4 dark:border-white/10">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{section.sectionLabel}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                          {section.totalRows} rows · {section.autoRows} auto · {section.manualRows} manual · {section.forecastRows} forecast
                        </div>
                      </div>
                      <Badge variant="outline">{section.status.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="mt-3 text-sm text-slate-700 dark:text-zinc-300">
                      {section.unresolvedRows > 0 ? `${section.unresolvedRows} unresolved rows.` : "No unresolved rows."}
                      {section.lowConfidenceRows > 0 ? ` ${section.lowConfidenceRows} low-confidence rows still require review.` : ""}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Publish gating</CardTitle>
                <CardDescription>Published weeks stay immutable, so the draft must clear these checks before publish.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`rounded-xl border px-4 py-3 text-sm ${publishReadiness.canPublish ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                  {publishReadiness.canPublish ? "This packet is ready to publish." : "This packet still has publish blockers."}
                </div>
                <ul className="space-y-2 text-sm text-slate-700 dark:text-zinc-300">
                  {(publishReadiness.blockers.length > 0 ? publishReadiness.blockers : ["No blockers."]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Draft notes</CardTitle>
                <CardDescription>Internal prep notes for admins before the week is published.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  className="min-h-[120px] w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-3 text-sm"
                  value={draftNotesDraft}
                  onChange={(event) => setDraftNotesDraft(event.target.value)}
                  placeholder="Working notes, unresolved follow-ups, or prep context for this week's packet."
                />
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Review notes</CardTitle>
                <CardDescription>These notes are required and stored with the published weekly packet.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  className="min-h-[120px] w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-4 py-3 text-sm"
                  value={reviewNotesDraft}
                  onChange={(event) => setReviewNotesDraft(event.target.value)}
                  placeholder="Add owner/admin review notes, context, or board commentary."
                />
                <div className="flex justify-end">
                  <Button type="button" variant="outline" onClick={() => void onSaveNotes()} disabled={savingNotes}>
                    {savingNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save notes
                  </Button>
                </div>
              </CardContent>
            </Card>

            {(Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
              const metricKeys = sectionMetricKeys.get(sectionKey) ?? [];
              if (metricKeys.length === 0) return null;
              return (
                <Card key={sectionKey} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <CardHeader>
                    <CardTitle className="text-xl">{sectionLabel}</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-white/10">
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">Metric</th>
                          {facilities.map((facility) => (
                            <th key={facility.facilityId} className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">
                              {facility.facilityName}
                            </th>
                          ))}
                          {totals ? <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">Totals</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {metricKeys.map((metricKey) => {
                          const sampleMetric = facilities.find((facility) => facility.metrics[metricKey])?.metrics[metricKey] ?? totals?.metrics[metricKey];
                          if (!sampleMetric) return null;
                          return (
                            <tr key={metricKey} className="border-b border-slate-100 dark:border-white/5">
                              <td className="px-3 py-3 align-top">
                                <div className="font-medium text-slate-900 dark:text-white">{sampleMetric.label}</div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{sampleMetric.description}</div>
                              </td>
                              {facilities.map((facility) => {
                                const metric = facility.metrics[metricKey];
                                const editKey = `${facility.facilityId}:${metricKey}`;
                                const editableMetric = editable(metric, detail.snapshot);
                                const displayValue =
                                  editKey in edits
                                    ? edits[editKey]
                                    : metric.valueType === "currency"
                                      ? metric.valueNumeric == null
                                        ? ""
                                        : (metric.valueNumeric / 100).toString()
                                      : metric.valueNumeric == null
                                        ? metric.valueText ?? ""
                                        : metric.valueNumeric.toString();

                                return (
                                  <td key={editKey} className="px-3 py-3 align-top">
                                    {editableMetric ? (
                                      <div className="space-y-2">
                                        <Input
                                          value={displayValue}
                                          onChange={(event) =>
                                            setEdits((current) => ({ ...current, [editKey]: event.target.value }))
                                          }
                                          placeholder={metric.sourceMode === "forecast" ? "Enter forecast" : "Enter value"}
                                        />
                                        <div className="flex items-center gap-2">
                                          <Badge variant="outline">{metric.sourceMode}</Badge>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={savingKey === editKey}
                                            onClick={() => void onSaveMetric(facility.facilityId!, metricKey, metric)}
                                          >
                                            {savingKey === editKey ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                                            Save
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        <div className="font-semibold text-slate-900 dark:text-white">{formatMetricValue(metric)}</div>
                                        <div className="flex flex-wrap gap-1.5">
                                          <Badge variant="outline">{metric.sourceMode}</Badge>
                                          <Badge variant="outline">{metric.confidenceBand}</Badge>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              {totals ? (
                                <td className="px-3 py-3 align-top">
                                  <div className="space-y-2">
                                    <div className="font-semibold text-slate-900 dark:text-white">{formatMetricValue(totals.metrics[metricKey])}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      <Badge variant="outline">{totals.metrics[metricKey].sourceMode}</Badge>
                                      <Badge variant="outline">{totals.metrics[metricKey].confidenceBand}</Badge>
                                    </div>
                                  </div>
                                </td>
                              ) : null}
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
