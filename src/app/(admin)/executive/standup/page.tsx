"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, FileSpreadsheet, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useAuth } from "@/hooks/useAuth";
import { canCreateDraftFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import {
  STANDUP_METRIC_DEFINITIONS,
  STANDUP_SECTION_LABELS,
  currentStandupWeekOf,
  fetchExecutiveStandupLive,
  fetchStandupSnapshotForWeek,
  generateExecutiveStandupDraft,
  type ExecutiveStandupLive,
  type StandupMetricRow,
  type StandupSectionKey,
} from "@/lib/executive/standup";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatMetricValue(metric: StandupMetricRow): string {
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "Manual / future feed";
  if (metric.valueType === "currency") return USD.format(metric.valueNumeric / 100);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

function sourceBadgeClass(metric: StandupMetricRow): string {
  if (metric.sourceMode === "auto") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (metric.sourceMode === "forecast") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (metric.sourceMode === "hybrid") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function confidenceBadgeClass(metric: StandupMetricRow): string {
  if (metric.confidenceBand === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (metric.confidenceBand === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export default function ExecutiveStandupPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<ExecutiveStandupLive | null>(null);
  const [draftStatus, setDraftStatus] = useState<{
    id: string;
    status: string;
    generatedAt: string;
    completenessPct: number;
    confidenceBand: string;
  } | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [canCreateDraft, setCanCreateDraft] = useState(false);

  const weekOf = currentStandupWeekOf();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        throw new Error(ctx.error);
      }

      const [liveData, snapshot] = await Promise.all([
        fetchExecutiveStandupLive(supabase, ctx.ctx.organizationId, selectedFacilityId),
        fetchStandupSnapshotForWeek(supabase, ctx.ctx.organizationId, weekOf),
      ]);

      setLive(liveData);
      setDraftStatus(
        snapshot
          ? {
              id: snapshot.id,
              status: snapshot.status,
              generatedAt: snapshot.generated_at,
              completenessPct: snapshot.completeness_pct,
              confidenceBand: snapshot.confidence_band,
            }
          : null,
      );
      setCanCreateDraft(canCreateDraftFinance(ctx.ctx.appRole));
    } catch (loadError) {
      setLive(null);
      setDraftStatus(null);
      setCanCreateDraft(false);
      setError(loadError instanceof Error ? loadError.message : "Could not load executive standup.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase, weekOf]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityCards = useMemo(() => {
    return (live?.facilities ?? []).filter((facility) => facility.facilityId != null).slice(0, 5);
  }, [live]);

  const totalRow = useMemo(() => {
    return (live?.facilities ?? []).find((facility) => facility.facilityId == null) ?? null;
  }, [live]);

  const sections = useMemo(() => {
    return Object.entries(STANDUP_SECTION_LABELS).map(([sectionKey, sectionLabel]) => ({
      sectionKey: sectionKey as StandupSectionKey,
      sectionLabel,
      metrics: STANDUP_METRIC_DEFINITIONS.filter((metric) => metric.sectionKey === sectionKey),
    }));
  }, []);

  async function onGenerateDraft() {
    if (!user?.id) {
      setError("Sign in required.");
      return;
    }
    setCreatingDraft(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      await generateExecutiveStandupDraft(supabase, ctx.ctx.organizationId, user.id, selectedFacilityId);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create standup draft.");
    } finally {
      setCreatingDraft(false);
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
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Owner Operating System
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Executive Standup Pack</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                Live operating graph plus a frozen weekly standup pack. This replaces the current spreadsheet workflow with
                governed metrics, draft generation, and board-ready exports.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest">
                <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
                Week Of {weekOf}
              </Badge>
              {draftStatus ? (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest">
                  Draft {draftStatus.status} · {draftStatus.completenessPct.toFixed(0)}% complete
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest">
                  No draft yet
                </Badge>
              )}
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Link
                href="/admin/executive/standup/history"
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                History
              </Link>
              {draftStatus ? (
                <Link
                  href={`/admin/executive/standup/${weekOf}`}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 px-4 text-xs font-semibold uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/15"
                >
                  Open draft
                </Link>
              ) : null}
              <Button type="button" onClick={() => void onGenerateDraft()} disabled={!canCreateDraft || creatingDraft || Boolean(draftStatus)}>
                <Sparkles className={`mr-2 h-4 w-4 ${creatingDraft ? "animate-spin" : ""}`} />
                {draftStatus ? "Draft exists" : "Generate draft"}
              </Button>
            </div>
          </div>
        </header>

        {error ? (
          <Card className="border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10">
            <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-700 dark:text-rose-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-6">
          {(loading ? Array.from({ length: 6 }) : ["current_ar_cents", "current_total_census", "total_beds_open", "expected_discharges", "overtime_hours", "hospital_and_rehab_total"]).map(
            (metricKey, index) => {
              if (loading) {
                return <Skeleton key={`standup-kpi-${index}`} className="h-[140px] rounded-[1.75rem]" />;
              }
              const metric = totalRow?.metrics[metricKey as string];
              return (
                <Card key={metricKey as string} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <CardHeader className="pb-3">
                    <CardDescription className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">
                      {metric?.label ?? "Metric"}
                    </CardDescription>
                    <CardTitle className="text-2xl font-semibold text-slate-900 dark:text-white">
                      {metric ? formatMetricValue(metric) : "—"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {metric ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={sourceBadgeClass(metric)}>{metric.sourceMode}</Badge>
                        <Badge variant="outline" className={confidenceBadgeClass(metric)}>{metric.confidenceBand} confidence</Badge>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            },
          )}
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Facility pressure board</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Ranked by live operating pressure. Total row is shown in the workbook tables below.</p>
            </div>
            <Link href="/admin/facilities" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-300">
              Open facilities →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-5">
            {loading
              ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={`facility-card-${index}`} className="h-[200px] rounded-[1.75rem]" />)
              : facilityCards.map((facility) => (
                  <Card key={facility.facilityId} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
                    <CardHeader>
                      <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">{facility.facilityName}</CardTitle>
                      <CardDescription>{facility.topConcern}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-slate-600 dark:text-zinc-300">
                      <div className="flex items-center justify-between"><span>Census</span><span className="font-semibold">{formatMetricValue(facility.metrics.current_total_census)}</span></div>
                      <div className="flex items-center justify-between"><span>Current AR</span><span className="font-semibold">{formatMetricValue(facility.metrics.current_ar_cents)}</span></div>
                      <div className="flex items-center justify-between"><span>Open beds</span><span className="font-semibold">{formatMetricValue(facility.metrics.total_beds_open)}</span></div>
                      <div className="flex items-center justify-between"><span>Hospital / rehab</span><span className="font-semibold">{formatMetricValue(facility.metrics.hospital_and_rehab_total)}</span></div>
                      <div className="flex items-center justify-between"><span>Overtime</span><span className="font-semibold">{formatMetricValue(facility.metrics.overtime_hours)}</span></div>
                    </CardContent>
                  </Card>
                ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Workbook-equivalent sections</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Metrics with manual or forecast source modes are modeled but not yet fully automated.</p>
          </div>

          {sections.map((section) => (
            <Card key={section.sectionKey} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">{section.sectionLabel}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">Metric</th>
                      {(live?.facilities ?? []).map((facility) => (
                        <th key={`${section.sectionKey}-${facility.facilityName}`} className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-zinc-400">
                          {facility.facilityName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.metrics.map((definition) => (
                      <tr key={definition.key} className="border-b border-slate-100 dark:border-white/5">
                        <td className="px-3 py-3 align-top text-slate-900 dark:text-white">
                          <div className="font-medium">{definition.label}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{definition.description}</div>
                        </td>
                        {(live?.facilities ?? []).map((facility) => {
                          const metric = facility.metrics[definition.key];
                          return (
                            <td key={`${facility.facilityName}-${definition.key}`} className="px-3 py-3 align-top">
                              {metric ? (
                                <div className="space-y-2">
                                  <div className="font-semibold text-slate-900 dark:text-white">{formatMetricValue(metric)}</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="outline" className={sourceBadgeClass(metric)}>{metric.sourceMode}</Badge>
                                    <Badge variant="outline" className={confidenceBadgeClass(metric)}>{metric.confidenceBand}</Badge>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}
