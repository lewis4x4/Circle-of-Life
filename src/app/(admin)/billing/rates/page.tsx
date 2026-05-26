"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Percent } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type RateRow = {
  id: string;
  name: string;
  effectiveDate: string;
  endDate: string | null;
  basePrivateCents: number;
  baseSemiPrivateCents: number | null;
  careSurchargeLevel1Cents: number;
  careSurchargeLevel2Cents: number;
  careSurchargeLevel3Cents: number;
  communityFeeCents: number | null;
  notes: string | null;
  current: boolean;
};

type SupabaseRateRow = {
  id: string;
  name: string;
  effective_date: string;
  end_date: string | null;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number | null;
  care_surcharge_level_2: number | null;
  care_surcharge_level_3: number | null;
  community_fee: number | null;
  notes: string | null;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function AdminBillingRatesPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<RateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("rate_schedules" as never)
        .select(
          "id, name, effective_date, end_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, notes, deleted_at",
        )
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })
        .limit(100);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabaseRateRow>;
      if (res.error) throw res.error;
      const list = res.data ?? [];
      setRows(
        list.map((r) => ({
          id: r.id,
          name: r.name,
          effectiveDate: r.effective_date,
          endDate: r.end_date,
          basePrivateCents: r.base_rate_private,
          baseSemiPrivateCents: r.base_rate_semi_private,
          careSurchargeLevel1Cents: r.care_surcharge_level_1 ?? 0,
          careSurchargeLevel2Cents: r.care_surcharge_level_2 ?? 0,
          careSurchargeLevel3Cents: r.care_surcharge_level_3 ?? 0,
          communityFeeCents: r.community_fee,
          notes: r.notes,
          current: r.end_date == null,
        })),
      );
    } catch {
      setRows([]);
      setError("Live rate schedules are unavailable.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Rate Schedules
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Private base rates and surcharges mapped by effective dates. Current versions are retained as read-only history until a replacement schedule is created.
            </p>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Version history is read-only and reflects stored schedule fields.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
             <Link className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-wider text-[10px]")} href="/admin/billing/rates/new">
               + Add Schedule
             </Link>
             <Badge className="bg-muted text-muted-foreground border border-border uppercase tracking-wider font-mono text-[9px] font-bold px-3 shadow-none">
                <Percent className="mr-1.5 h-3 w-3" />
                {rows.filter((r) => r.current).length} active
             </Badge>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && rows.length === 0 && !error ? (
          <AdminEmptyState
            title="No rate schedules"
            description="Add a rate schedule for this facility or pick a facility that already has pricing configured."
          />
        ) : null}
        
        {!isLoading && rows.length > 0 ? (
          <div className="p-6 sm:p-8 rounded-lg border border-border bg-card shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-foreground mt-1">Version History</h3>
              <p className="text-[10px] font-mono tracking-wider text-muted-foreground mt-1 uppercase">
                Effective dating controls
              </p>
            </div>
            
            <div className="relative z-10">
               <MotionList className="space-y-3">
                  {rows.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="group flex flex-col gap-5 p-5 rounded-lg border border-border bg-card shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                         <div className="min-w-0 flex flex-col gap-2">
                           <div className="flex items-center gap-3">
                              {row.current ? (
                                <Badge className="bg-success/10 text-success border-success/20 uppercase tracking-wider font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border">
                                  Current
                                </Badge>
                              ) : (
                                <Badge className="bg-muted text-muted-foreground border-border uppercase tracking-wider font-mono text-[9px] font-bold shadow-none px-2.5 py-1 rounded-full border">
                                  Historical
                                </Badge>
                              )}
                              <Badge className="bg-muted/60 text-muted-foreground border-border uppercase tracking-wider font-mono text-[9px] font-bold shadow-none px-2.5 py-1 rounded-full border">
                                Read only
                              </Badge>
                              <span className="font-semibold text-foreground tracking-tight text-lg">
                                 {row.name}
                              </span>
                           </div>
                           <p className="text-xs font-mono tracking-wider text-muted-foreground uppercase mt-1">
                              Duration: {formatDate(row.effectiveDate)} — {row.endDate ? formatDate(row.endDate) : "Ongoing"}
                           </p>
                         </div>
                         <div className="flex flex-col items-start sm:items-end w-full sm:w-1/3">
                            <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">Base Private Rate</span>
                            <span className="text-xl font-medium text-success tabular-nums">
                               {billingCurrency.format(row.basePrivateCents / 100)}
                            </span>
                         </div>
                        </div>
                        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5">
                          {[
                            ["Base semi-private", row.baseSemiPrivateCents],
                            ["Care surcharge L1", row.careSurchargeLevel1Cents],
                            ["Care surcharge L2", row.careSurchargeLevel2Cents],
                            ["Care surcharge L3", row.careSurchargeLevel3Cents],
                            ["Community fee", row.communityFeeCents],
                          ].map(([label, cents]) => (
                            <div key={label} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {label}
                              </p>
                              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                                {typeof cents === "number" ? billingCurrency.format(cents / 100) : "—"}
                              </p>
                            </div>
                          ))}
                        </div>
                        {row.notes ? (
                          <div className="rounded-md bg-muted/30 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes</p>
                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.notes}</p>
                          </div>
                        ) : null}
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
