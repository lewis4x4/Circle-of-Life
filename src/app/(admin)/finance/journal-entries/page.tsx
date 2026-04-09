"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight, BookOpenText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function JournalEntriesListPage() {
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        return;
      }
      let q = supabase
        .from("journal_entries")
        .select("*")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(100);
      if (selectedFacilityId != null) {
        q = q.or(`facility_id.eq.${selectedFacilityId},facility_id.is.null`);
      }
      const { data, error: qErr } = await q;
      if (qErr) setError(qErr.message);
      else setRows((data ?? []) as JournalRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityNote = useMemo(
    () =>
      selectedFacilityId == null
        ? "All facilities"
        : "Filtered to selected facility (and entity-level rows with no facility).",
    [selectedFacilityId],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <FinanceHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-violet-50/20 dark:bg-black/20 p-8 rounded-[2.5rem] border border-violet-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 <BookOpenText className="h-3.5 w-3.5" aria-hidden /> SYS: Module 17
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Journal Entries
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              {facilityNote}
            </p>
          </div>
          <div className="flex shrink-0">
             <Link className={cn(buttonVariants({ size: "lg" }), "rounded-full font-bold uppercase tracking-widest text-[10px] shadow-lg bg-violet-600 hover:bg-violet-700 text-white border border-violet-500")} href="/admin/finance/journal-entries/new">
               + New Journal
             </Link>
          </div>
        </header>

        {error ? (
          <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Recent Entries</h3>
            <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
              {loading ? "Loading…" : `${rows.length} rows`}
            </p>
          </div>
          
          <div className="relative z-10">
            {rows.length === 0 && !loading ? (
              <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10 mx-2">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No journal logs found</p>
                <p className="text-sm opacity-80 mt-1">Create a new manual journal entry to begin.</p>
              </div>
            ) : (
              <MotionList className="space-y-3">
                {rows.map((r) => (
                  <MotionItem key={r.id}>
                    <Link
                      href={`/admin/finance/journal-entries/${r.id}`}
                      className="group flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transform-gpu transition-all hover:border-violet-300 dark:hover:border-violet-500/40 hover:shadow-md"
                    >
                      <div className="min-w-0 flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:bg-violet-50 dark:group-hover:bg-violet-500/10 group-hover:border-violet-200 dark:group-hover:border-violet-500/20 transition-colors mt-0.5">
                           <BookOpenText className="w-5 h-5 text-slate-400 group-hover:text-violet-500 transition-colors" />
                        </div>
                        <div className="flex flex-col gap-2">
                           <div className="flex items-center gap-3">
                             <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border", 
                               r.status === 'posted' ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400" :
                               "bg-amber-50 text-amber-700 border-amber-200 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400"
                             )}>
                               {r.status}
                             </Badge>
                             <span className="text-xs font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                               Entry: {r.entry_date}
                             </span>
                           </div>
                           <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                              {r.memo ? (
                                <span className="line-clamp-2 leading-snug">{r.memo}</span>
                              ) : (
                                <span className="italic text-slate-400">No memo provided</span>
                              )}
                           </p>
                        </div>
                      </div>
                      
                      <div className="flex shrink-0 items-center justify-end">
                        <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-violet-200 dark:group-hover:border-violet-500/20 group-hover:bg-violet-50 dark:group-hover:bg-violet-500/10 transition-colors shrink-0">
                             <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" />
                        </div>
                      </div>
                    </Link>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
