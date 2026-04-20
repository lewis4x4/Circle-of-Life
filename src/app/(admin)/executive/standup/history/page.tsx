"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Copy, History, Loader2, Sparkles, Upload } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canCreateDraftFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import {
  buildStandupImportCommand,
  currentStandupWeekOf,
  fetchStandupHistory,
  fetchStandupImportJobs,
  generateExecutiveStandupDraft,
  type StandupHistoryItem,
  type StandupImportJob,
} from "@/lib/executive/standup";

function badgeClass(status: string): string {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "archived") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function ExecutiveStandupHistoryPage() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StandupHistoryItem[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [canCreateDraft, setCanCreateDraft] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [importJobs, setImportJobs] = useState<StandupImportJob[]>([]);
  const [importJobsError, setImportJobsError] = useState<string | null>(null);
  const [workbookPath, setWorkbookPath] = useState("/Users/brianlewis/Downloads/2026 Standup Call Log.xlsx");
  const [copiedImport, setCopiedImport] = useState(false);
  const [compareFromWeek, setCompareFromWeek] = useState("");
  const [compareToWeek, setCompareToWeek] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImportJobsError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrganizationId(ctx.ctx.organizationId);
      setCanCreateDraft(canCreateDraftFinance(ctx.ctx.appRole));
      const [historyRows, recentImports] = await Promise.allSettled([
        fetchStandupHistory(supabase, ctx.ctx.organizationId, 52),
        fetchStandupImportJobs(supabase, ctx.ctx.organizationId, 8),
      ]);

      if (historyRows.status === "rejected") {
        throw historyRows.reason;
      }

      setRows(historyRows.value);
      if (recentImports.status === "fulfilled") {
        setImportJobs(recentImports.value);
      } else {
        setImportJobs([]);
        setImportJobsError(recentImports.reason instanceof Error ? recentImports.reason.message : "Could not load import jobs.");
      }
    } catch (loadError) {
      setRows([]);
      setImportJobs([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load standup history.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  async function onCopyImportCommand() {
    try {
      await navigator.clipboard.writeText(buildStandupImportCommand(workbookPath, organizationId));
      setCopiedImport(true);
      window.setTimeout(() => setCopiedImport(false), 1800);
    } catch {
      setImportJobsError("Clipboard write failed. Copy the import command manually.");
    }
  }

  async function onGenerateDraft() {
    if (!organizationId || !user?.id) {
      setError("Sign in required.");
      return;
    }
    setCreatingDraft(true);
    setError(null);
    try {
      await generateExecutiveStandupDraft(supabase, organizationId, user.id, null);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create standup draft.");
    } finally {
      setCreatingDraft(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (rows.length === 0) return;
    const fromQuery = searchParams.get("from");
    const toQuery = searchParams.get("to");
    const weekSet = new Set(rows.map((row) => row.weekOf));
    const newest = rows[0]?.weekOf ?? "";
    const previous = rows[1]?.weekOf ?? rows[0]?.weekOf ?? "";
    setCompareFromWeek(fromQuery && weekSet.has(fromQuery) ? fromQuery : previous);
    setCompareToWeek(toQuery && weekSet.has(toQuery) ? toQuery : newest);
  }, [rows, searchParams]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <ExecutiveHubNav />

        <header className="rounded-[2rem] border border-slate-200/70 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                <History className="h-3.5 w-3.5" />
                Standup archive
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Executive Standup History</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                Weekly standup packs remain immutable after publication so the owner can compare weeks without spreadsheet drift.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Refresh
            </Button>
            {rows.length === 0 && canCreateDraft ? (
              <Button type="button" onClick={() => void onGenerateDraft()} disabled={creatingDraft}>
                {creatingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate first draft
              </Button>
            ) : null}
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
              Loading standup history…
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader>
              <CardTitle>No standup weeks yet</CardTitle>
              <CardDescription>Generate the first weekly draft from the standup pack page.</CardDescription>
            </CardHeader>
            {canCreateDraft ? (
              <CardContent>
                <Button type="button" onClick={() => void onGenerateDraft()} disabled={creatingDraft}>
                  {creatingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate first draft for {currentStandupWeekOf()}
                </Button>
              </CardContent>
            ) : null}
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-lg">Compare published weeks</CardTitle>
                <CardDescription>Replace spreadsheet side-by-side review with an in-app change comparison across any two weekly packets.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">From week</div>
                  <select
                    className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
                    value={compareFromWeek}
                    onChange={(event) => setCompareFromWeek(event.target.value)}
                  >
                    {rows.map((row) => (
                      <option key={`from-${row.id}`} value={row.weekOf}>{row.weekOf}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">To week</div>
                  <select
                    className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
                    value={compareToWeek}
                    onChange={(event) => setCompareToWeek(event.target.value)}
                  >
                    {rows.map((row) => (
                      <option key={`to-${row.id}`} value={row.weekOf}>{row.weekOf}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Link
                    href={compareFromWeek && compareToWeek && compareFromWeek !== compareToWeek ? `/admin/executive/standup/compare?from=${encodeURIComponent(compareFromWeek)}&to=${encodeURIComponent(compareToWeek)}` : "#"}
                    aria-disabled={!compareFromWeek || !compareToWeek || compareFromWeek === compareToWeek}
                    className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-xs font-semibold uppercase tracking-widest ${
                      !compareFromWeek || !compareToWeek || compareFromWeek === compareToWeek
                        ? "pointer-events-none border border-slate-200 bg-slate-100 text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-zinc-500"
                        : "border border-indigo-200 bg-indigo-50 text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/15"
                    }`}
                  >
                    Compare weeks
                  </Link>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {rows.map((row, index) => {
                const compareTarget = rows[index + 1]?.weekOf ?? null;
                return (
                  <Card key={row.id} className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm transition-shadow hover:shadow-md dark:border-white/10 dark:bg-white/[0.03]">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-xl">{row.weekOf}</CardTitle>
                          <CardDescription className="mt-1">
                            Generated {new Date(row.generatedAt).toLocaleString()}
                            {row.publishedAt ? ` · Published ${new Date(row.publishedAt).toLocaleString()}` : ""}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className={badgeClass(row.status)}>
                          {row.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Completeness</div>
                          <div className="mt-1 font-semibold text-slate-900 dark:text-white">{row.completenessPct.toFixed(0)}%</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Confidence</div>
                          <div className="mt-1 font-semibold capitalize text-slate-900 dark:text-white">{row.confidenceBand}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/executive/standup/${row.weekOf}`}
                          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                        >
                          Open week
                        </Link>
                        <Link
                          href={`/admin/executive/standup/${row.weekOf}/board`}
                          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/15"
                        >
                          Board packet
                        </Link>
                        {compareTarget ? (
                          <Link
                            href={`/admin/executive/standup/compare?from=${encodeURIComponent(compareTarget)}&to=${encodeURIComponent(row.weekOf)}`}
                            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/15"
                          >
                            Compare previous
                          </Link>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Upload className="h-4 w-4" />
                    Historical Import Runbook
                  </CardTitle>
                  <CardDescription>
                    Slice 3 imports the legacy workbook into the standup archive. Run the importer locally, then refresh this page to verify the imported weeks.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest">
                  Historical continuity
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Workbook path</div>
                <Input value={workbookPath} onChange={(event) => setWorkbookPath(event.target.value)} spellCheck={false} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                {buildStandupImportCommand(workbookPath, organizationId)}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={() => void onCopyImportCommand()}>
                  {copiedImport ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copiedImport ? "Copied import command" : "Copy import command"}
                </Button>
                <p className="text-sm text-slate-500 dark:text-zinc-400">
                  Imports publish each workbook week into the immutable standup archive with spreadsheet lineage and low-confidence tags.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border border-slate-200/70 bg-white/70 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="text-lg">Recent import jobs</CardTitle>
              <CardDescription>Use this to confirm the workbook has been backfilled and to spot failed import attempts quickly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {importJobsError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                  {importJobsError}
                </div>
              ) : null}
              {importJobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-zinc-400">
                  No import jobs recorded yet.
                </div>
              ) : (
                importJobs.map((job) => (
                  <div key={job.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{job.sourceFileName}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                          Created {new Date(job.createdAt).toLocaleString()}
                          {job.finishedAt ? ` · Finished ${new Date(job.finishedAt).toLocaleString()}` : ""}
                        </div>
                      </div>
                      <Badge variant="outline" className={badgeClass(job.status)}>
                        {job.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Kind</div>
                        <div className="mt-1 capitalize text-slate-900 dark:text-white">{job.sourceKind}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Weeks</div>
                        <div className="mt-1 text-slate-900 dark:text-white">{job.importedWeekCount}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Metric rows</div>
                        <div className="mt-1 text-slate-900 dark:text-white">{job.importedMetricCount}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">Started</div>
                        <div className="mt-1 text-slate-900 dark:text-white">{job.startedAt ? new Date(job.startedAt).toLocaleString() : "Queued"}</div>
                      </div>
                    </div>
                    {job.errorText ? (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                        {job.errorText}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
