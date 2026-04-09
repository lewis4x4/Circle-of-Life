"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileClock, Timer, UserCircle } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const OPEN = ["draft", "sent", "partial", "overdue"] as const;

type Row = {
  residentId: string;
  residentName: string;
  totalCents: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91: number;
};

type SupabaseInv = {
  id: string;
  resident_id: string;
  due_date: string;
  balance_due: number;
  status: string;
  deleted_at: string | null;
};

type SupabaseRes = { id: string; first_name: string | null; last_name: string | null };

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function daysPastDue(dueDate: string): number {
  const due = new Date(`${dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 0;
  const now = new Date();
  const ms = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export default function AdminArAgingPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("invoices" as never)
        .select("id, resident_id, due_date, balance_due, status, deleted_at")
        .is("deleted_at", null)
        .gt("balance_due", 0)
        .in("status", [...OPEN])
        .limit(500);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabaseInv>;
      if (res.error) throw res.error;
      const invs = res.data ?? [];
      if (invs.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }
      const resIds = [...new Set(invs.map((i) => i.resident_id))];
      const rres = (await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .in("id", resIds)) as unknown as QueryListResult<SupabaseRes>;
      if (rres.error) throw rres.error;
      const nameBy = new Map<string, string>();
      for (const r of rres.data ?? []) {
        const fn = r.first_name?.trim() ?? "";
        const ln = r.last_name?.trim() ?? "";
        nameBy.set(r.id, `${fn} ${ln}`.trim() || "Resident");
      }

      const agg = new Map<string, Row>();
      for (const inv of invs) {
        const bal = Math.max(0, inv.balance_due);
        const days = daysPastDue(inv.due_date);
        let bucket: keyof Pick<Row, "b0_30" | "b31_60" | "b61_90" | "b91"> = "b0_30";
        if (days > 90) bucket = "b91";
        else if (days > 60) bucket = "b61_90";
        else if (days > 30) bucket = "b31_60";

        const cur =
          agg.get(inv.resident_id) ??
          ({
            residentId: inv.resident_id,
            residentName: nameBy.get(inv.resident_id) ?? "Resident",
            totalCents: 0,
            b0_30: 0,
            b31_60: 0,
            b61_90: 0,
            b91: 0,
          } satisfies Row);
        cur.totalCents += bal;
        cur[bucket] += bal;
        agg.set(inv.resident_id, cur);
      }
      setRows([...agg.values()].sort((a, b) => b.totalCents - a.totalCents));
    } catch {
      setRows([]);
      setError("Could not load AR aging.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + r.totalCents,
        b0_30: acc.b0_30 + r.b0_30,
        b31_60: acc.b31_60 + r.b31_60,
        b61_90: acc.b61_90 + r.b61_90,
        b91: acc.b91 + r.b91,
      }),
      { total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b91: 0 },
    );
  }, [rows]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-emerald-50/20 dark:bg-black/20 p-8 rounded-[2.5rem] border border-emerald-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 <FileClock className="h-3.5 w-3.5" aria-hidden /> SYS: Module 16
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               AR Aging
               {totals.b91 > 0 && <PulseDot colorClass="bg-rose-500" />}
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Open balances bucketed by days past due date (per invoice, rolled up by resident).
            </p>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {!isLoading && rows.length > 0 ? (
          <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6" staggerMs={75}>
             <div className="col-span-1 md:col-span-2 h-[160px]">
               <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
                 <Sparkline colorClass="text-emerald-500" variant={2} />
                 <MonolithicWatermark value={Math.round((totals.total / 100) / 1000) + 'k'} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
                 <div className="relative z-10 flex flex-col h-full justify-between p-2">
                   <h3 className="text-[11px] font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                     <Timer className="h-4 w-4" /> Total Open AR
                   </h3>
                   <div>
                     <p className="text-4xl lg:text-5xl font-display font-medium tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 pb-1 flex flex-col">
                       {billingCurrency.format(totals.total / 100)}
                     </p>
                   </div>
                 </div>
               </V2Card>
             </div>

            {(
              [
                ["0–30 days", totals.b0_30, "slate"],
                ["31–60 days", totals.b31_60, "amber"],
                ["61–90 days", totals.b61_90, "orange"],
              ] as const
            ).map(([label, cents, color]) => (
              <div key={label} className="h-[160px]">
                 <V2Card hoverColor={color} className={`border-${color}-500/20 dark:border-${color}-500/20`}>
                   <MonolithicWatermark value={Math.round((cents / 100) / 100)} className={`text-${color}-600/5 dark:text-${color}-400/5 opacity-50`} />
                   <div className="relative z-10 flex flex-col h-full justify-between p-2">
                     <h3 className={`text-[10px] font-bold tracking-widest uppercase text-${color}-600 dark:text-${color}-400`}>
                       {label}
                     </h3>
                     <p className={`text-2xl font-mono font-medium tracking-tight tabular-nums text-${color}-600 dark:text-${color}-400 pb-1`}>
                       {billingCurrency.format(cents / 100)}
                     </p>
                   </div>
                 </V2Card>
              </div>
            ))}
          </KineticGrid>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && rows.length === 0 && !error ? (
          <AdminEmptyState title="No open AR" description="Paid, void, and zero-balance invoices are excluded." />
        ) : null}
        
        {!isLoading && rows.length > 0 ? (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Outstanding by Resident</h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
                 Sorted descending
              </p>
            </div>
            
            <div className="relative z-10">
               <MotionList className="space-y-3">
                  {rows.map((r) => (
                    <MotionItem key={r.residentId}>
                      <Link
                        href={`/admin/residents/${r.residentId}/billing`}
                        className="group flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between p-5 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transform-gpu transition-all hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:shadow-md outline-none"
                      >
                         <div className="min-w-0 flex items-center gap-4">
                           <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 transition-colors">
                              <UserCircle className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                           </div>
                           <div>
                              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                                 {r.residentName}
                              </p>
                           </div>
                         </div>
                         
                         <div className="flex flex-wrap items-center gap-4 lg:gap-8 lg:mr-4">
                            <div className="flex flex-col">
                               <span className="font-bold uppercase tracking-widest text-[10px] text-slate-400 mb-1">Total Outstanding</span>
                               <span className="text-lg font-display font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                                  {billingCurrency.format(r.totalCents / 100)}
                               </span>
                            </div>
                            
                            <div className="h-10 w-px bg-slate-200 dark:bg-white/10 hidden md:block mx-2"></div>
                            
                            <div className="flex flex-col hidden md:flex text-right">
                               <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 leading-none">0–30</span>
                               <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-400 tabular-nums leading-none">
                                  {billingCurrency.format(r.b0_30 / 100)}
                               </span>
                            </div>
                            <div className="flex flex-col hidden md:flex text-right">
                               <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 leading-none">31–60</span>
                               <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-400 tabular-nums leading-none">
                                  {billingCurrency.format(r.b31_60 / 100)}
                               </span>
                            </div>
                            <div className="flex flex-col hidden lg:flex text-right">
                               <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 leading-none">61–90</span>
                               <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-400 tabular-nums leading-none">
                                  {billingCurrency.format(r.b61_90 / 100)}
                               </span>
                            </div>
                            <div className="flex flex-col hidden lg:flex text-right">
                               <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400 mb-1 leading-none">91+</span>
                               <span className={cn("text-xs font-mono font-medium tabular-nums leading-none", r.b91 > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-slate-600 dark:text-slate-400")}>
                                  {billingCurrency.format(r.b91 / 100)}
                               </span>
                            </div>
                            
                            <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 transition-colors shrink-0 ml-2">
                               <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                            </div>
                         </div>
                      </Link>
                    </MotionItem>
                  ))}
               </MotionList>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
