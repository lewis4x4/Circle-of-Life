"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Timer, UserCircle } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/v2-card";
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
      <></>
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
               AR Aging
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
               Open balances bucketed by days past due date (per invoice, rolled up by resident).
            </p>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {!isLoading && rows.length > 0 ? (
          <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6" staggerMs={75}>
             <div className="col-span-1 md:col-span-2 h-[160px]">
               <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
                 <></>
                 <MonolithicWatermark value={Math.round((totals.total / 100) / 1000) + 'k'} className="text-success/10 opacity-50" />
                 <div className="relative z-10 flex flex-col h-full justify-between p-2">
                   <h3 className="text-[11px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                     <Timer className="h-4 w-4" /> Total Open AR
                   </h3>
                   <div>
                     <p className="text-4xl lg:text-2xl font-medium tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 pb-1 flex flex-col">
                       {billingCurrency.format(totals.total / 100)}
                     </p>
                   </div>
                 </div>
               </V2Card>
             </div>

            {(
              [
                { label: "0–30 days",  cents: totals.b0_30,  color: "slate",  wmClass: "text-muted-foreground/10", textClass: "text-muted-foreground" },
                { label: "31–60 days", cents: totals.b31_60, color: "amber",  wmClass: "text-warning/10",          textClass: "text-amber-600 dark:text-amber-400" },
                { label: "61–90 days", cents: totals.b61_90, color: "orange", wmClass: "text-warning/10",          textClass: "text-amber-700 dark:text-amber-300" },
              ] as const
            ).map(({ label, cents, color, wmClass, textClass }) => (
              <div key={label} className="h-[160px]">
                 <V2Card hoverColor={color}>
                   <MonolithicWatermark value={Math.round((cents / 100) / 100)} className={`${wmClass} opacity-50`} />
                   <div className="relative z-10 flex flex-col h-full justify-between p-2">
                     <h3 className={`text-[10px] font-bold tracking-wider uppercase ${textClass}`}>
                       {label}
                     </h3>
                     <p className={`text-2xl font-mono font-medium tracking-tight tabular-nums pb-1 ${textClass}`}>
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
          <div className="p-6 sm:p-8 rounded-lg border border-border bg-card shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-foreground mt-1">Outstanding by Resident</h3>
              <p className="text-[10px] font-mono tracking-wider text-muted-foreground mt-1 uppercase">
                 Sorted descending
              </p>
            </div>
            
            <div className="relative z-10">
               <MotionList className="space-y-3">
                  {rows.map((r) => (
                    <MotionItem key={r.residentId}>
                      <Link
                        href={`/admin/residents/${r.residentId}/billing`}
                        className="group flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between p-5 rounded-lg border border-border bg-card shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      >
                         <div className="min-w-0 flex items-center gap-4">
                           <div className="w-12 h-12 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 group-hover:bg-success/10 group-hover:border-success/20 transition-colors">
                              <UserCircle className="w-5 h-5 text-muted-foreground group-hover:text-success transition-colors" />
                           </div>
                           <div>
                              <p className="text-lg font-semibold text-foreground tracking-tight">
                                 {r.residentName}
                              </p>
                           </div>
                         </div>
                         
                         <div className="flex flex-wrap items-center gap-4 lg:gap-8 lg:mr-4">
                            <div className="flex flex-col">
                               <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">Total Outstanding</span>
                               <span className="text-lg font-medium text-foreground tabular-nums">
                                  {billingCurrency.format(r.totalCents / 100)}
                               </span>
                            </div>
                            
                            <div className="h-10 w-px bg-slate-200 dark:bg-white/10 hidden md:block mx-2"></div>
                            
                            <div className="hidden md:flex flex-col text-right">
                               <span className="font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 leading-none">0–30</span>
                               <span className="text-xs font-mono font-medium text-muted-foreground tabular-nums leading-none">
                                  {billingCurrency.format(r.b0_30 / 100)}
                               </span>
                            </div>
                            <div className="hidden md:flex flex-col text-right">
                               <span className="font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 leading-none">31–60</span>
                               <span className="text-xs font-mono font-medium text-muted-foreground tabular-nums leading-none">
                                  {billingCurrency.format(r.b31_60 / 100)}
                               </span>
                            </div>
                            <div className="hidden lg:flex flex-col text-right">
                               <span className="font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 leading-none">61–90</span>
                               <span className="text-xs font-mono font-medium text-muted-foreground tabular-nums leading-none">
                                  {billingCurrency.format(r.b61_90 / 100)}
                               </span>
                            </div>
                            <div className="hidden lg:flex flex-col text-right">
                               <span className="font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 leading-none">91+</span>
                               <span className={cn("text-xs font-mono font-medium tabular-nums leading-none", r.b91 > 0 ? "text-destructive font-bold" : "text-muted-foreground")}>
                                  {billingCurrency.format(r.b91 / 100)}
                               </span>
                            </div>
                            
                            <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center group-hover:border-success/20 group-hover:bg-success/10 transition-colors shrink-0 ml-2">
                               <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-success transition-colors" />
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
