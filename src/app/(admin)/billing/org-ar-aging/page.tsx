"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const OPEN = ["draft", "sent", "partial", "overdue"] as const;

type Row = { entityId: string; entityName: string; totalCents: number };

type SupabaseInv = {
  entity_id: string;
  balance_due: number;
  status: string;
  deleted_at: string | null;
};

type SupabaseEntity = { id: string; name: string };

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

export default function AdminOrgArAgingPage() {
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
        .select("entity_id, balance_due, status, deleted_at")
        .is("deleted_at", null)
        .gt("balance_due", 0)
        .in("status", [...OPEN])
        .limit(800);
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
      const agg = new Map<string, number>();
      for (const inv of invs) {
        agg.set(inv.entity_id, (agg.get(inv.entity_id) ?? 0) + Math.max(0, inv.balance_due));
      }
      const entityIds = [...agg.keys()];
      const eres = (await supabase
        .from("entities" as never)
        .select("id, name")
        .in("id", entityIds)) as unknown as QueryListResult<SupabaseEntity>;
      if (eres.error) throw eres.error;
      const nameBy = new Map((eres.data ?? []).map((e) => [e.id, e.name] as const));
      setRows(
        [...agg.entries()]
          .map(([entityId, totalCents]) => ({
            entityId,
            entityName: nameBy.get(entityId) ?? "Entity",
            totalCents,
          }))
          .sort((a, b) => b.totalCents - a.totalCents),
      );
    } catch {
      setRows([]);
      setError("Could not load org-level AR.");
    } finally {
      setIsLoading(false);
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
                 <Building2 className="h-3.5 w-3.5" aria-hidden /> SYS: Module 16
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Org AR Aging
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Open invoice balances rolled up to legal entity.
            </p>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && rows.length === 0 && !error ? (
          <AdminEmptyState title="No open entity AR" description="Zero-balance and closed statuses are excluded." />
        ) : null}
        
        {!isLoading && rows.length > 0 ? (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">By Entity</h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
                 Sum of open invoices
              </p>
            </div>
            
            <div className="relative z-10">
               <MotionList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rows.map((r) => (
                    <MotionItem key={r.entityId}>
                      <div className="group flex flex-col justify-between p-6 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transition-all hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-500/40 min-h-[140px]">
                         <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 group-hover:border-emerald-200 dark:group-hover:border-emerald-500/20 transition-colors">
                               <Building2 className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                            </div>
                            <div className="flex-1 mt-1">
                               <span className="font-semibold text-slate-900 dark:text-slate-100 tracking-tight text-lg line-clamp-2 leading-tight">
                                  {r.entityName}
                               </span>
                            </div>
                         </div>
                         <div className="flex flex-col items-start mt-6 pt-4 border-t border-slate-100 dark:border-white/5">
                            <span className="font-bold uppercase tracking-widest text-[10px] text-slate-400 mb-1">Open AR</span>
                            <span className="text-2xl font-display font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                               {billingCurrency.format(r.totalCents / 100)}
                            </span>
                         </div>
                      </div>
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
