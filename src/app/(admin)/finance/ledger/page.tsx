"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowLeft, ArrowRight, CircleDollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function LedgerPage() {
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
        .eq("status", "posted")
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(200);
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

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <FinanceHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-emerald-50/20 dark:bg-black/20 p-8 rounded-[2.5rem] border border-emerald-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 <CircleDollarSign className="h-3.5 w-3.5" aria-hidden /> SYS: Module 17
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              General Ledger
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Posted journal headers across the selected operational facility boundaries. Open an entry for line details.
            </p>
          </div>
        </header>

        {error ? (
          <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Posted Entries</h3>
            <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
              {loading ? "Loading…" : `${rows.length} rows`}
            </p>
          </div>
          
          <div className="relative z-10">
            {rows.length === 0 && !loading ? (
              <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10 mx-2">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No entries yet</p>
                <p className="text-sm opacity-80 mt-1">Period close processes or active journals will populate here.</p>
              </div>
            ) : (
              <MotionList className="space-y-3">
                {rows.map((r) => (
                  <MotionItem key={r.id}>
                    <Link
                      href={`/admin/finance/journal-entries/${r.id}`}
                      className="group flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transform-gpu transition-all hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:shadow-md"
                    >
                      <div className="min-w-0 flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 transition-colors mt-0.5">
                           <CircleDollarSign className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                            {r.memo ? (
                              <span className="line-clamp-2 leading-snug">{r.memo}</span>
                            ) : (
                              <span className="italic text-slate-400">No memo provided</span>
                            )}
                          </p>
                          <p className="text-xs font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase mt-2">
                            Entry: {r.entry_date}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex shrink-0 items-center justify-between sm:justify-end gap-6 sm:w-1/3">
                        <div className="flex flex-col items-start sm:items-end w-full">
                           <span className="font-bold uppercase tracking-widest text-[10px] text-slate-400 mb-1">Posted</span>
                           <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 px-3 py-1.5 rounded-full shadow-sm">
                             {r.posted_at ? r.posted_at.slice(0, 19).replace("T", " ") : "Pending"}
                           </span>
                        </div>
                        <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 transition-colors shrink-0 hidden sm:flex">
                             <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
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
