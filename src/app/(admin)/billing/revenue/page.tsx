"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, TrendingUp } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { SourceReadinessCallout } from "@/components/common/source-readiness-callout";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { REVENUE_SOURCE_READINESS } from "@/lib/reporting-source-readiness";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/v2-card";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type SupabasePayment = {
  payment_date: string;
  amount: number;
  deleted_at: string | null;
};

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, 1);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(d);
}

export default function AdminRevenuePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [byMonth, setByMonth] = useState<{ key: string; cents: number; count: number }[]>([]);
  const [lookbackStart, setLookbackStart] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [facilityYear, facilityMonth, facilityDay] = todayFacilityDateIso()
        .split("-")
        .map(Number);
      const since = new Date(Date.UTC(facilityYear, facilityMonth - 1, facilityDay));
      since.setUTCMonth(since.getUTCMonth() - 14);
      const sinceStr = [
        since.getUTCFullYear(),
        String(since.getUTCMonth() + 1).padStart(2, "0"),
        String(since.getUTCDate()).padStart(2, "0"),
      ].join("-");
      setLookbackStart(sinceStr);
      let q = supabase
        .from("payments" as never)
        .select("payment_date, amount, deleted_at")
        .is("deleted_at", null)
        .gte("payment_date", sinceStr)
        .eq("refunded", false)
        .limit(2000);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabasePayment>;
      if (res.error) throw res.error;
      const payments = res.data ?? [];
      const map = new Map<string, { cents: number; count: number }>();
      for (const p of payments) {
        const k = monthKey(p.payment_date);
        const cur = map.get(k) ?? { cents: 0, count: 0 };
        cur.cents += Math.max(0, p.amount);
        cur.count += 1;
        map.set(k, cur);
      }
      const rows = [...map.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.key.localeCompare(a.key));
      setByMonth(rows);
    } catch {
      setByMonth([]);
      setError("Could not load payment revenue.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grand = useMemo(() => byMonth.reduce((acc, r) => acc + r.cents, 0), [byMonth]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
               Received Revenue
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
               Cash collected from payments already recorded in Haven, grouped by calendar month.
            </p>
          </div>
        </header>

        <SourceReadinessCallout copy={REVENUE_SOURCE_READINESS} />

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {!isLoading && byMonth.length > 0 ? (
           <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6" staggerMs={75}>
             <div className="col-span-1 md:col-span-2 lg:col-span-3 h-[180px]">
               <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
                 <></>
                 <MonolithicWatermark value={Math.round((grand / 100) / 1000) + 'k'} className="text-success/10 opacity-50" />
                 <div className="relative z-10 flex flex-col h-full justify-between p-2">
                   <h3 className="text-[11px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                     <TrendingUp className="h-4 w-4" /> Trailing 14 Months Window
                   </h3>
                   <div>
                     <p className="text-2xl lg:text-2xl font-medium tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400 pb-1 flex flex-col">
                       {billingCurrency.format(grand / 100)}
                     </p>
                     <p className="font-mono text-sm tracking-wider uppercase text-emerald-600/60 dark:text-emerald-400/60 mt-1">Across {byMonth.length} active months</p>
                     <p className="mt-2 text-sm text-muted-foreground">
                       Includes payments dated on or after {lookbackStart} Eastern.
                     </p>
                   </div>
                 </div>
               </V2Card>
             </div>
           </KineticGrid>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && byMonth.length === 0 && !error ? (
          <AdminEmptyState
            title="No recorded payments in range"
            description="This page stays empty until payment activity is entered or imported into Haven for the selected scope."
          />
        ) : null}
        
        {!isLoading && byMonth.length > 0 ? (
          <div className="p-6 sm:p-8 rounded-lg border border-border bg-card shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-foreground mt-1">Monthly Breakdown</h3>
              <p className="text-[10px] font-mono tracking-wider text-muted-foreground mt-1 uppercase">
                 Monthly Periods
              </p>
            </div>
            
            <div className="relative z-10">
               <MotionList className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {byMonth.map((r) => (
                    <MotionItem key={r.key}>
                      <div className="group flex flex-col justify-between p-6 h-full rounded-lg border border-border bg-card shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md">
                         <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 group-hover:bg-success/10 group-hover:border-success/20 transition-colors">
                               <CalendarDays className="w-5 h-5 text-muted-foreground group-hover:text-success transition-colors" />
                            </div>
                            <div>
                               <span className="font-semibold text-foreground tracking-tight text-xl">
                                  {monthLabel(r.key)}
                               </span>
                            </div>
                         </div>
                         <div className="flex items-end justify-between w-full mt-auto">
                            <div className="flex flex-col">
                               <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">Volume</span>
                               <span className="text-lg font-mono font-medium text-muted-foreground tabular-nums">
                                  {r.count} <span className="text-sm">Txns</span>
                               </span>
                            </div>
                            <div className="flex flex-col items-end">
                               <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">Received</span>
                               <span className="text-2xl font-medium text-success tabular-nums">
                                  {billingCurrency.format(r.cents / 100)}
                               </span>
                            </div>
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
