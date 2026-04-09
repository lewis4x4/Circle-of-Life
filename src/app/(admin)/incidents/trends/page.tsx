"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, TrendingUp } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";

const DAYS = 90;

type Row = {
  id: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function startIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function humanCategory(raw: string): string {
  return raw.replace(/_/g, " ");
}

export default function AdminIncidentTrendsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const since = startIso(DAYS);
      let q = supabase
        .from("incidents" as never)
        .select("id, category, severity, status, occurred_at")
        .is("deleted_at", null)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(800);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const res = (await q) as unknown as QueryListResult<Row>;
      if (res.error) throw res.error;
      setRows(res.data ?? []);
    } catch {
      setError("Incident analytics could not be loaded.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const byCategory = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    let open = 0;
    for (const r of rows) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
      bySeverity.set(r.severity, (bySeverity.get(r.severity) ?? 0) + 1);
      if (r.status !== "closed" && r.status !== "resolved") open += 1;
    }
    const catSorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const sevOrder = ["level_4", "level_3", "level_2", "level_1"];
    const sevSorted = sevOrder
      .filter((s) => bySeverity.has(s))
      .map((s) => [s, bySeverity.get(s) ?? 0] as const);
    const maxCat = catSorted[0]?.[1] ?? 1;
    const maxSev = Math.max(1, ...sevSorted.map(([, n]) => n));
    return { byCategory: catSorted, bySeverity: sevSorted, open, total: rows.length, maxCat, maxSev };
  }, [rows]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={stats.open > 0} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-rose-500/10"
      />
      
      <div className="relative z-10 space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-slate-500 mb-2 uppercase tracking-widest font-bold")}>
              ← Incident queue
            </Link>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Incident Trends {stats.open > 0 && <PulseDot colorClass="bg-rose-500" />}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Last {DAYS} days scoped to your facility selection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="glass-panel px-4 py-2 rounded-xl flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Totals</span>
              <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-200 tabular-nums">{stats.total}</span>
            </div>
            <div className="glass-panel px-4 py-2 rounded-xl border-amber-200/50 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20 flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-500">Open</span>
              <span className="font-mono text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums">{stats.open}</span>
            </div>
          </div>
        </header>

        {loading ? (
          <p className="text-sm font-mono text-slate-500 text-center py-12">Loading trends…</p>
        ) : error ? (
          <div className="p-12 text-center text-rose-600 bg-rose-50 dark:bg-rose-950/20 rounded-[2.5rem] border border-rose-200 dark:border-rose-900/50">
            <p className="font-medium text-lg">{error}</p>
            <button onClick={() => void load()} className="mt-4 text-sm underline hover:no-underline">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
            <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Incidents Found</p>
            <p className="text-sm opacity-80 mt-1">When reportable events land in Supabase, their category and severity distributions will appear here.</p>
          </div>
        ) : (
          <KineticGrid className="grid-cols-1 lg:grid-cols-2 gap-6" staggerMs={75}>
            <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-indigo-500" /> By Category
                </h3>
              </div>
              <div className="space-y-5">
                {stats.byCategory.slice(0, 12).map(([cat, count]) => (
                  <div key={cat} className="space-y-1.5 focus-within:outline-none group">
                    <div className="flex justify-between text-sm">
                      <span className="truncate pr-2 font-medium text-slate-800 dark:text-slate-200 font-mono tracking-tight capitalize">{humanCategory(cat)}</span>
                      <span className="shrink-0 font-bold tabular-nums text-slate-900 dark:text-white">{count}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800 shadow-inner relative">
                      <div
                        className="h-full rounded-full bg-indigo-500 relative transition-all duration-1000 group-hover:brightness-110"
                        style={{ width: `${Math.max(2, Math.round((count / stats.maxCat) * 100))}%` }}
                      >
                         <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-rose-500" /> By Severity
                </h3>
              </div>
              <div className="space-y-5">
                {stats.bySeverity.map(([sev, count]) => (
                  <div key={sev} className="space-y-1.5 focus-within:outline-none group">
                    <div className="flex justify-between text-sm items-center">
                      <span className="uppercase tracking-widest text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-black/40 px-2 py-0.5 rounded shadow-sm">{sev.replace(/_/g, " ")}</span>
                      <span className="font-bold tabular-nums text-slate-900 dark:text-white text-lg">{count}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800 shadow-inner relative">
                      <div
                        className={cn(
                          "h-full rounded-full relative transition-all duration-1000 group-hover:brightness-110",
                          sev === "level_4"
                            ? "bg-rose-500"
                            : sev === "level_3"
                              ? "bg-amber-500"
                              : sev === "level_2"
                                ? "bg-amber-300 dark:bg-yellow-600"
                                : "bg-slate-400",
                        )}
                        style={{ width: `${Math.max(2, Math.round((count / stats.maxSev) * 100))}%` }}
                      >
                         <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </KineticGrid>
        )}
      </div>
    </div>
  );
}
