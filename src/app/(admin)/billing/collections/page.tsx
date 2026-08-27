"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, MessageSquareQuote } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import {
  COLLECTIONS_HUB_LIMIT,
  collectionsFollowUpDateIsPosted,
  collectionsHubLoadCapNotice,
  formatCollectionsFollowUpDate,
  formatCollectionsResidentName,
} from "@/lib/billing/collections-display-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";

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
  const loadCapNotice = collectionsHubLoadCapNotice(rows.length);

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
        .limit(COLLECTIONS_HUB_LIMIT);
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as CollectionRow[]);
    } catch (e) {
      setError(formatLiveDataLoadError(e, "Failed to load collections."));
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
      <></>
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
               Collections
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
               Ledger of follow-up calls, letters, promises, and escalations for past-due balances.
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-end">
            <Link
              href="/admin/billing/collections/new"
              className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-wider text-[10px]")}
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
          <div className="p-6 sm:p-8 rounded-lg border border-border bg-card shadow-sm relative overflow-hidden transition-all">
            <div className="mb-4 border-b border-border pb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-foreground mt-1">Activity Log</h3>
              <p className="text-[10px] font-mono tracking-wider text-muted-foreground mt-1 uppercase">
                 Scoped to selected facility
              </p>
            </div>
            {loadCapNotice ? (
              <p className="mb-4 text-[12px] text-muted-foreground">{loadCapNotice}</p>
            ) : null}
            
            <div className="flex items-center gap-3 px-[13px] py-2 border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:grid grid-cols-12 gap-4 mb-2">
               <div className="col-span-2">Date</div>
               <div className="col-span-2">Resident</div>
               <div className="col-span-2">Type</div>
               <div className="col-span-4">Summary</div>
               <div className="col-span-2 text-right">Follow-up</div>
            </div>
            
            <div className="relative z-10">
               <MotionList className="space-y-3">
                 {rows.map((r) => {
                   const name = formatCollectionsResidentName(
                     r.residents?.first_name,
                     r.residents?.last_name,
                   );
                   const followUpPosted = collectionsFollowUpDateIsPosted(r.follow_up_date);
                   const followUpLabel = formatCollectionsFollowUpDate(r.follow_up_date);
                   return (
                     <MotionItem key={r.id}>
                       <Link href={`/admin/residents/${r.resident_id}/billing`} className="group flex flex-col md:grid md:grid-cols-12 gap-4 md:items-center p-5 rounded-lg border border-border bg-card shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                          <div className="col-span-2">
                            <span className="md:hidden font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 block">Date</span>
                            <span className="text-sm font-semibold text-foreground">{r.activity_date}</span>
                          </div>
                          
                          <div className="col-span-2">
                            <span className="md:hidden font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 block">Resident</span>
                            <span className="text-sm font-medium text-success truncate w-full block">
                              {name}
                            </span>
                          </div>

                          <div className="col-span-2">
                             <span className="md:hidden font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 block">Type</span>
                             <span className="inline-flex text-xs font-mono tracking-wider uppercase bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                               {r.activity_type.replace(/_/g, " ")}
                             </span>
                          </div>

                          <div className="col-span-4 max-w-sm">
                            <span className="md:hidden font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 block">Summary</span>
                            <div className="flex items-start gap-2 max-w-full">
                               <MessageSquareQuote className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0 hidden lg:block" />
                               <span className="text-sm text-muted-foreground line-clamp-2">
                                 {r.description}
                               </span>
                            </div>
                          </div>

                          <div className="col-span-2 flex items-center justify-between md:justify-end gap-4 min-w-0">
                            <div className="flex flex-col items-start md:items-end min-w-0">
                              <span className="md:hidden font-bold uppercase tracking-wider text-[9px] text-muted-foreground mb-1 block text-right">Follow-up</span>
                              {followUpPosted ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold tracking-wider text-success bg-success/10 border border-success/20 px-2.5 py-1 rounded-full">
                                  <CalendarClock className="w-3 h-3" />
                                  {followUpLabel}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">{followUpLabel}</span>
                              )}
                            </div>
                            
                            <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center group-hover:border-success/20 group-hover:bg-success/10 transition-colors shrink-0">
                               <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-success transition-colors" />
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
