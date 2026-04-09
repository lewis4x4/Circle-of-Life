"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type BenchmarkRow = {
  id: string;
  metric_key: string;
  benchmark_type: string;
  scope_type: string;
  effective_from: string;
  effective_to: string | null;
};

export default function ReportsBenchmarksPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        const { data, error: queryErr } = await supabase
          .from("report_benchmarks")
          .select("id, metric_key, benchmark_type, scope_type, effective_from, effective_to")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null)
          .order("effective_from", { ascending: false });
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as BenchmarkRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load benchmarks.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <>
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/5"
        secondaryClass="bg-violet-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Benchmarks
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Compare facilities to portfolio, target thresholds, and prior periods.
            </p>
          </div>
        </header>

      {error && <p className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium max-w-7xl mx-auto">{error}</p>}
      
      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Defined Benchmarks</h3>
            <p className="text-sm font-mono tracking-wide mt-1 text-slate-500 dark:text-slate-400">Central benchmark definitions used by report templates.</p>
          </div>
          {rows.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Definitions Found</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Configure central benchmarks in reports admin.</p>
             </div>
          ) : (
             <MotionList className="space-y-4">
                {rows.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                        <div className="flex flex-col min-w-[300px] gap-1 shrink-0">
                           <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Metric Key</span>
                           <span className="font-bold text-slate-900 dark:text-slate-100 uppercase text-sm tracking-wide">
                              {row.metric_key.replace(/_/g, ' ')}
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Type</span>
                              <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full w-fit">{row.benchmark_type}</Badge>
                           </div>
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Scope</span>
                              <span className="font-mono text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest">{row.scope_type}</span>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Window</span>
                              <span className="font-mono text-[11px] font-medium text-slate-600 dark:text-slate-400 tracking-wide">{row.effective_from} - {row.effective_to ?? "Open"}</span>
                           </div>
                        </div>
                    </div>
                  </MotionItem>
                ))}
            </MotionList>
          )}
      </div>
      </div>
    </>
  );
}
