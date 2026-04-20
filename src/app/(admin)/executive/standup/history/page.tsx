"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Loader2 } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { fetchStandupHistory, type StandupHistoryItem } from "@/lib/executive/standup";

function badgeClass(status: string): string {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function ExecutiveStandupHistoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StandupHistoryItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const data = await fetchStandupHistory(supabase, ctx.ctx.organizationId, 52);
      setRows(data);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load standup history.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rows.map((row) => (
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
                  <Link
                    href={`/admin/executive/standup/${row.weekOf}`}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    Open week
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
