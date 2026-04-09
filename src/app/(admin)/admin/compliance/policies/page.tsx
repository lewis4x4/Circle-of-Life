"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { format, parseISO } from "date-fns";

type Row = {
  id: string;
  title: string;
  category: string;
  version: number;
  status: string;
  published_at: string | null;
};

export default function PoliciesListPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("policy_documents")
        .select("id, title, category, version, status, published_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (!error && data) setRows(data as Row[]);
      else setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-500/10"
      />
      
      <div className="relative z-10 space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-slate-500 mb-2 uppercase tracking-widest font-bold")}>
              ← Compliance
            </Link>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Policy Library
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Versioned policies and acknowledgment tracking for your facility.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/compliance/policies/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg")} >
               + New Policy
            </Link>
          </div>
        </header>

        <div className="glass-panel p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5 pl-2">
             <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
               Active Policies
             </h3>
             <span className="text-xs font-medium text-slate-500">{loading ? "Loading…" : `${rows.length} shown`}</span>
           </div>

           {!ready ? (
             <div className="p-12 text-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-[2.5rem] border border-amber-200 dark:border-amber-900/50 backdrop-blur-md">
               <p className="font-semibold text-lg">Select a facility</p>
               <p className="text-sm opacity-80 mt-1">Policies are managed per facility.</p>
             </div>
           ) : loading ? (
             <p className="text-sm font-mono text-slate-500 pl-2">Loading policies…</p>
           ) : rows.length === 0 ? (
             <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No policies</p>
               <p className="text-sm opacity-80 mt-1">Upload and version your operational policies.</p>
             </div>
           ) : (
             <MotionList className="space-y-3">
               {rows.map((r) => {
                 const isDraft = r.status === "draft";
                 return (
                   <MotionItem
                     key={r.id}
                     className={cn(
                       "p-5 rounded-[1.5rem] border shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center justify-between group overflow-hidden relative transition-colors",
                       isDraft 
                         ? "border-amber-200/80 bg-white dark:border-amber-900/30 dark:bg-amber-950/20 hover:border-amber-300 dark:hover:border-amber-800/40"
                         : "border-slate-200/80 bg-white dark:border-white/5 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20"
                     )}
                   >
                     {isDraft && <div className="absolute left-0 top-0 w-1.5 h-full bg-amber-500" />}
                     <div className="flex-1 min-w-0 pl-1">
                       <div className="flex items-center gap-3 mb-1">
                         <span className={cn(
                           "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border",
                           isDraft 
                             ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" 
                             : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                         )}>
                           {r.status}
                         </span>
                         <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                           {r.published_at ? `Published ${format(parseISO(r.published_at.length <= 10 ? `${r.published_at}T12:00:00.000Z` : r.published_at), "MMM d, yyyy")}` : "Not Published"}
                         </span>
                       </div>
                       <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight mt-2">{r.title}</p>
                       <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2">
                         <span className="text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md text-xs">{r.category}</span>
                         <span className="font-mono text-xs">v{r.version}</span>
                       </p>
                     </div>
                     <div className="shrink-0 flex items-center gap-3 pl-1 sm:pl-0">
                       <Link
                         href={`/admin/compliance/policies/${r.id}/edit`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "h-10 rounded-full px-5 font-bold uppercase tracking-widest text-[10px] bg-white dark:bg-white/5 dark:border-white/10"
                         )}
                       >
                         Manage
                       </Link>
                     </div>
                   </MotionItem>
                 );
               })}
             </MotionList>
           )}
        </div>
      </div>
    </div>
  );
}
