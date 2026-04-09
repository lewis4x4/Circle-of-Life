"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, MessageSquareQuote, Phone } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../billing-hub-nav";

type CollectionRow = {
  id: string;
  activity_type: string;
  activity_date: string;
  description: string;
  outcome: string | null;
  follow_up_date: string | null;
  follow_up_notes: string | null;
  resident_id: string;
  invoice_id: string | null;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export default function AdminCollectionsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility to view collection activities.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const res = await supabase
        .from("collection_activities")
        .select(
          "id, activity_type, activity_date, description, outcome, follow_up_date, follow_up_notes, resident_id, invoice_id, residents(first_name, last_name)",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("activity_date", { ascending: false })
        .limit(200);
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as CollectionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load collections.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-emerald-50/20 dark:bg-black/20 p-8 rounded-[2.5rem] border border-emerald-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 <Phone className="h-3.5 w-3.5" aria-hidden /> SYS: Module 16
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Collections
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Ledger of follow-up calls, letters, promises, and escalations for past-due balances.
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-end">
            <Link
              href="/admin/billing/collections/new"
              className={cn(buttonVariants({ size: "lg" }), "rounded-full font-bold uppercase tracking-widest text-[10px] shadow-lg bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500")}
            >
              + Log Activity
            </Link>
          </div>
        </header>

        {error && (
          <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
        )}

        {loading ? (
          <AdminTableLoadingState />
        ) : rows.length === 0 && !error ? (
          <AdminEmptyState
            title="No collection activities"
            description="Log phone calls, promises, or escalations when working past-due accounts."
          />
        ) : (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Activity Log</h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
                 Scoped to selected facility
              </p>
            </div>
            
            <div className="relative z-10 hidden md:grid grid-cols-12 gap-4 pb-2 mb-2 px-6 text-[10px] font-bold uppercase tracking-widest text-slate-400">
               <div className="col-span-2">Date</div>
               <div className="col-span-2">Resident</div>
               <div className="col-span-2">Type</div>
               <div className="col-span-4">Summary</div>
               <div className="col-span-2 text-right">Follow-up</div>
            </div>
            
            <div className="relative z-10">
               <MotionList className="space-y-3">
                 {rows.map((r) => {
                   const name =
                     `${r.residents?.first_name ?? ""} ${r.residents?.last_name ?? ""}`.trim() || "—";
                   return (
                     <MotionItem key={r.id}>
                       <Link href={`/admin/residents/${r.resident_id}/billing`} className="group flex flex-col md:grid md:grid-cols-12 gap-4 md:items-center p-5 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transform-gpu transition-all hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:shadow-md outline-none">
                          <div className="col-span-2">
                            <span className="md:hidden font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 block">Date</span>
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.activity_date}</span>
                          </div>
                          
                          <div className="col-span-2">
                            <span className="md:hidden font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 block">Resident</span>
                            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400 truncate w-full block">
                              {name}
                            </span>
                          </div>

                          <div className="col-span-2">
                             <span className="md:hidden font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 block">Type</span>
                             <span className="inline-flex text-xs font-mono tracking-widest uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                               {r.activity_type.replace(/_/g, " ")}
                             </span>
                          </div>

                          <div className="col-span-4 max-w-sm">
                            <span className="md:hidden font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 block">Summary</span>
                            <div className="flex items-start gap-2 max-w-full">
                               <MessageSquareQuote className="w-4 h-4 text-slate-400 mt-0.5 shrink-0 hidden lg:block" />
                               <span className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                                 {r.description}
                               </span>
                            </div>
                          </div>

                          <div className="col-span-2 flex items-center justify-between md:justify-end gap-4 min-w-0">
                            <div className="flex flex-col items-start md:items-end min-w-0">
                              <span className="md:hidden font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 block text-right">Follow-up</span>
                              {r.follow_up_date ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 px-2.5 py-1 rounded-full">
                                  <CalendarClock className="w-3 h-3" />
                                  {r.follow_up_date}
                                </span>
                              ) : (
                                <span className="text-sm text-slate-400">—</span>
                              )}
                            </div>
                            
                            <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 transition-colors shrink-0">
                               <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                            </div>
                          </div>
                       </Link>
                     </MotionItem>
                   );
                 })}
               </MotionList>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
