"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Loader2, Save } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { downloadBlobFromUrl } from "@/lib/download-blob";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { downloadTextFile } from "@/lib/onboarding/download";
import {
  buildStandupBoardPrintHtml,
  buildStandupPdfUrl,
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
import { formatStandupMetricValue } from "@/lib/executive/executive-display-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import {
  EXECUTIVE_STANDUP_WEEK_LOADING_MESSAGE,
  hasExecutiveStandupOrgScopedDetailData,
  resolveExecutiveStandupFetchErrorBannerMessage,
  resolveExecutiveStandupOrganizationGapMessage,
} from "@/lib/executive/standup-page-state";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import type { Database } from "@/types/database";

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
  const { user, organizationId, appRole, loading: authLoading } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const canPublish = canMutateFinance(role);
  const [detail, setDetail] = useState<StandupSnapshotDetail | null>(null);
  const [previousDetail, setPreviousDetail] = useState<StandupSnapshotDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [savingBoardReport, setSavingBoardReport] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [draftNotesDraft, setDraftNotesDraft] = useState("");
  const [reviewNotesDraft, setReviewNotesDraft] = useState("");

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
      setDetail(null);
      setPreviousDetail(null);
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
      setEdits({});
      setDraftNotesDraft(snapshot?.snapshot.draftNotes ?? "");
      setReviewNotesDraft(snapshot?.snapshot.reviewNotes ?? "");
    } catch (loadError) {
      setDetail(null);
      setPreviousDetail(null);
      setFetchError(formatLiveDataLoadError(loadError, "Could not load standup detail."));
    } finally {
      setFetching(false);
    }
  }, [authLoading, organizationId, supabase, week]);

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
      setActionError("Sign in required.");
      return;
    }
    const editKey = `${facilityId}:${metricKey}`;
    setSavingKey(editKey);
    setActionError(null);
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
      setActionError(saveError instanceof Error ? saveError.message : "Could not save standup metric.");
    } finally {
      setSavingKey(null);
    }
  }

  async function onPublish() {
    if (!detail || !user?.id) {
      setActionError("Sign in required.");
      return;
    }
    if (!publishReadiness.canPublish) {
      setActionError(publishReadiness.blockers[0] ?? "Standup is not ready to publish.");
      return;
    }
    setPublishing(true);
    setActionError(null);
    try {
      await publishStandupSnapshot(supabase, {
        snapshotId: detail.snapshot.id,
        weekOf: detail.snapshot.weekOf,
        userId: user.id,
        reviewNotes: reviewNotesDraft.trim() || null,
      });
      await load();
    } catch (publishError) {
      setActionError(publishError instanceof Error ? publishError.message : "Could not publish standup snapshot.");
    } finally {
      setPublishing(false);
    }
  }

  async function onSaveNotes() {
    if (!detail || !user?.id) {
      setActionError("Sign in required.");
      return;
    }
    setSavingNotes(true);
    setActionError(null);
    try {
      await saveStandupSnapshotNotes(supabase, {
        snapshotId: detail.snapshot.id,
        userId: user.id,
        draftNotes: draftNotesDraft.trim() || null,
        reviewNotes: reviewNotesDraft.trim() || null,
      });
      await load();
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "Could not save standup notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function onDownloadPdf() {
    if (!detail) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      await downloadBlobFromUrl(
        buildStandupPdfUrl(detail.snapshot.weekOf),
        `executive-standup-${detail.snapshot.weekOf}.pdf`,
      );
    } catch (downloadError) {
      setActionError(downloadError instanceof Error ? downloadError.message : "Could not download standup PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  function onExportBoardPacket() {
    if (!detail) return;
    const html = buildStandupBoardPrintHtml(detail, previousDetail);
    downloadTextFile(`executive-standup-${detail.snapshot.weekOf}.html`, html, "text/html;charset=utf-8");
  }

  async function onSaveBoardReport() {
    if (!detail || !user?.id || !organizationId) {
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

  return (
    <div className="w-full space-y-6 pb-12">
      <ExecutiveHubNav />

      <RecordDetailHeader
        title={`Standup Week ${week}`}
        subtitle="Draft weeks can be completed in-app. Published weeks remain immutable for owner trust and week-over-week comparison."
        backLink={{ label: "Standup pack", href: "/admin/executive/standup" }}
        statusChips={
          detail ? (
            <Badge variant="outline" className="tabular-nums text-[10px] uppercase tracking-wider">
              {detail.snapshot.status} · {detail.snapshot.completenessPct.toFixed(0)}% complete
            </Badge>
          ) : undefined
        }
        actions={
          detail ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Refresh
              </Button>
              <Link
                href={`/admin/executive/standup/${week}/board`}
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-xs font-medium transition-colors hover:bg-muted"
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Board preview
              </Link>
              <Button type="button" variant="outline" onClick={onExportBoardPacket}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export board packet
              </Button>
              <Button type="button" variant="outline" onClick={() => void onDownloadPdf()} disabled={downloadingPdf}>
                {downloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Download PDF
              </Button>
              <Button type="button" variant="outline" onClick={() => void onSaveBoardReport()} disabled={savingBoardReport}>
                {savingBoardReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save in executive reports
              </Button>
              <Button type="button" onClick={() => void onPublish()} disabled={!canPublish || detail.snapshot.status !== "draft" || publishing || !publishReadiness.canPublish}>
                {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Publish week
              </Button>
            </div>
          ) : undefined
        }
      />

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
        <div
          className="rounded-[8px] border border-border bg-card p-6 flex items-center gap-3 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {EXECUTIVE_STANDUP_WEEK_LOADING_MESSAGE}
        </div>
      ) : !detail ? (
        <RecordDetailSection title="No standup week yet">
          <p className="text-sm text-muted-foreground">
            This week has no standup packet. Generate a draft from the standup pack page first.
          </p>
          <div className="mt-4">
            <Link href="/admin/executive/standup" className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-xs font-medium transition-colors hover:bg-muted">
              Back to standup pack
            </Link>
          </div>
        </RecordDetailSection>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              { label: "Generated", value: new Date(detail.snapshot.generatedAt).toLocaleString() },
              { label: "Published", value: detail.snapshot.publishedAt ? new Date(detail.snapshot.publishedAt).toLocaleString() : "Not yet" },
              { label: "Completeness", value: `${detail.snapshot.completenessPct.toFixed(0)}%` },
              { label: "Confidence", value: <span className="capitalize">{detail.snapshot.confidenceBand}</span> },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[8px] border border-border bg-card p-[14px] transition-all duration-[var(--motion-duration)] hover:-translate-y-0.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{value}</p>
              </div>
            ))}
          </div>

          {narrative ? (
            <RecordDetailSection title="Executive narrative">
              <p className="mb-4 text-sm font-medium text-foreground">{narrative.headline}</p>
              <div className="grid gap-6 lg:grid-cols-4">
                {[
                  { label: "Current week", items: narrative.bullets },
                  { label: "Changes", items: narrative.changes.length > 0 ? narrative.changes : ["No prior published week available for comparison."] },
                  { label: "Data quality", items: narrative.dataQuality.length > 0 ? narrative.dataQuality : ["No data quality warnings."] },
                  { label: "Actions", items: narrative.actions.length > 0 ? narrative.actions : ["No intervention recommendations."] },
                ].map(({ label, items }) => (
                  <div key={label}>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
                    <ul className="space-y-2 text-sm text-foreground">
                      {items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </RecordDetailSection>
          ) : null}

          {narrative && narrative.facilityActions.length > 0 ? (
            <RecordDetailSection title="Why Is This Red?">
              <p className="mb-4 text-sm text-muted-foreground">Per-facility pressure reasons, variance flags, and intervention recommendations.</p>
              <div className="grid gap-4 xl:grid-cols-3">
                {narrative.facilityActions.slice(0, 6).map((action) => (
                  <div key={action.facilityId} className="rounded-[8px] border border-border bg-card p-4 transition-all duration-[var(--motion-duration)] hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">{action.facilityName}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{action.topConcern}</div>
                      </div>
                      <Badge variant="outline" className="tabular-nums shrink-0">Pressure {action.pressureScore}</Badge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: "Why red", items: action.whyRed.length > 0 ? action.whyRed : ["No active red flags beyond the headline concern."] },
                        { label: "Variance flags", items: action.varianceFlags.length > 0 ? action.varianceFlags : ["No material deltas versus the prior published week."] },
                        { label: "Recommended actions", items: action.interventions },
                      ].map(({ label, items }) => (
                        <div key={label}>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
                          <ul className="mt-2 space-y-1 text-sm text-foreground">
                            {items.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </RecordDetailSection>
          ) : null}

          <RecordDetailSection title="Weekly close status">
            <p className="mb-4 text-sm text-muted-foreground">Track the unresolved rows before publishing the standup packet.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: "Auto rows", value: summaryCounts.auto, danger: false },
                { label: "Manual rows", value: summaryCounts.manual, danger: false },
                { label: "Forecast rows", value: summaryCounts.forecast, danger: false },
                { label: "Unresolved", value: summaryCounts.unresolved, danger: true },
              ].map(({ label, value, danger }) => (
                <div key={label}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className={`mt-1 text-xl font-semibold tabular-nums ${danger ? "text-destructive" : "text-foreground"}`}>{value}</div>
                </div>
              ))}
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Section completion">
            <p className="mb-4 text-sm text-muted-foreground">Each section closes independently so the standup week can be reviewed like a lightweight executive close.</p>
            <div className="grid gap-4 xl:grid-cols-3">
              {sectionStatuses.map((section) => (
                <div key={section.sectionKey} className="rounded-[8px] border border-border bg-card p-4 transition-all duration-[var(--motion-duration)] hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground">{section.sectionLabel}</div>
                      <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                        {section.totalRows} rows · {section.autoRows} auto · {section.manualRows} manual · {section.forecastRows} forecast
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{section.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="mt-3 text-sm text-foreground">
                    {section.unresolvedRows > 0 ? `${section.unresolvedRows} unresolved rows.` : "No unresolved rows."}
                    {section.lowConfidenceRows > 0 ? ` ${section.lowConfidenceRows} low-confidence rows still require review.` : ""}
                  </div>
                </div>
              ))}
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Publish gating">
            <p className="mb-4 text-sm text-muted-foreground">Published weeks stay immutable, so the draft must clear these checks before publish.</p>
            <div className="space-y-3">
              <div className={`rounded-[8px] border px-4 py-3 text-sm ${publishReadiness.canPublish ? "border-success/20 bg-success/10 text-success" : "border-warning/20 bg-warning/10 text-warning"}`}>
                {publishReadiness.canPublish ? "This packet is ready to publish." : "This packet still has publish blockers."}
              </div>
              <ul className="space-y-2 text-sm text-foreground">
                {(publishReadiness.blockers.length > 0 ? publishReadiness.blockers : ["No blockers."]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Draft notes">
            <p className="mb-3 text-sm text-muted-foreground">Internal prep notes for admins before the week is published.</p>
            <textarea
              className="min-h-[120px] w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground"
              value={draftNotesDraft}
              onChange={(event) => setDraftNotesDraft(event.target.value)}
              placeholder="Working notes, unresolved follow-ups, or prep context for this week's packet."
            />
          </RecordDetailSection>

          <RecordDetailSection
            title="Review notes"
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void onSaveNotes()} disabled={savingNotes}>
                {savingNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save notes
              </Button>
            }
          >
            <p className="mb-3 text-sm text-muted-foreground">These notes are required and stored with the published weekly packet.</p>
            <textarea
              className="min-h-[120px] w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground"
              value={reviewNotesDraft}
              onChange={(event) => setReviewNotesDraft(event.target.value)}
              placeholder="Add owner/admin review notes, context, or board commentary."
            />
          </RecordDetailSection>

          {(Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
            const metricKeys = sectionMetricKeys.get(sectionKey) ?? [];
            if (metricKeys.length === 0) return null;
            return (
              <RecordDetailSection key={sectionKey} title={sectionLabel}>
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Metric</th>
                        {facilities.map((facility) => (
                          <th key={facility.facilityId} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            {facility.facilityName}
                          </th>
                        ))}
                        {totals ? <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Totals</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {metricKeys.map((metricKey) => {
                        const sampleMetric = facilities.find((facility) => facility.metrics[metricKey])?.metrics[metricKey] ?? totals?.metrics[metricKey];
                        if (!sampleMetric) return null;
                        return (
                          <tr key={metricKey} className="border-b border-border/50">
                            <td className="px-3 py-3 align-top">
                              <div className="font-medium text-foreground">{sampleMetric.label}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{sampleMetric.description}</div>
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
                                      <div className="font-semibold tabular-nums text-foreground">{formatStandupMetricValue(metric)}</div>
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
                                  <div className="font-semibold tabular-nums text-foreground">{formatStandupMetricValue(totals.metrics[metricKey])}</div>
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
                </div>
              </RecordDetailSection>
            );
          })}
        </>
      )}
    </div>
  );
}
