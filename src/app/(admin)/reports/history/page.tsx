"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type RunHistoryRow = {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

export default function ReportHistoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<RunHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        const { data, error: queryErr } = await supabase
          .from("report_runs")
          .select("id, source_type, source_id, status, started_at, completed_at")
          .eq("organization_id", ctx.ctx.organizationId)
          .order("started_at", { ascending: false })
          .limit(100);
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as RunHistoryRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load report history.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <>
      <></>
      
      <div className="relative z-10 space-y-6 w-full">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Run History {rows.some((r) => r.status === "failed") && <></>}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Trace who ran what, when it completed, and what status was recorded.
            </p>
          </div>
        </header>
        
      {error && <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium w-full">{error}</p>}
      
      <div className="p-6 sm:p-8 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Recent Report Runs</h3>
          </div>
          {loading ? (
            <div className="p-16 text-center text-slate-500">
               <p className="text-sm font-mono tracking-wider uppercase">Loading Run Logs…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 ">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Run History</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Report execution logs will populate here once dispatched.</p>
             </div>
          ) : (
            <MotionList className="space-y-4">
                {rows.map((row) => (
                  <MotionItem key={row.id}>
                    <div className={cn("p-6 rounded-lg group transition-all duration-300 hover:scale-[1.01] cursor-default border w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 shadow-sm hover:shadow-md", row.status === "failed" ? "border-rose-500/20 bg-rose-50 dark:bg-rose-900/10 hover:border-rose-500/40" : "border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20")}>
                        <div className="flex flex-col min-w-[250px] gap-1 shrink-0">
                           <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Source: <span className="font-semibold text-primary-600 dark:text-primary-400">{row.source_type}</span></span>
                           <span className="font-bold text-slate-900 dark:text-slate-100 uppercase text-sm tracking-wide">
                              {row.source_id.replace(/-/g, ' ')}
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Status</span>
                              <div>
                                {row.status === "completed" ? (
                                  <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 uppercase tracking-wider font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Completed</Badge>
                                ) : row.status === "failed" ? (
                                  <Badge className="bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 uppercase tracking-wider font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Failed</Badge>
                                ) : (
                                  <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 uppercase tracking-wider font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">{row.status}</Badge>
                                )}
                              </div>
                           </div>
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Started</span>
                              <span className="font-mono text-[11px] text-slate-900 dark:text-slate-100 font-medium tracking-wide">{new Date(row.started_at).toLocaleString()}</span>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Completed</span>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 font-medium tracking-wide">{row.completed_at ? new Date(row.completed_at).toLocaleString() : "—"}</span>
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
