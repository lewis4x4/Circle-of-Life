"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type Row = {
  id: string;
  resident_id: string;
  facility_id: string;
  order_text: string;
  prescriber_name: string;
  received_at: string;
  cosignature_due_at: string;
  cosignature_status: string;
  implemented: boolean;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export default function AdminVerbalOrdersPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility to view verbal orders.");
      return;
    }
    try {
      const q = supabase
        .from("verbal_orders")
        .select(
          `
          id,
          resident_id,
          facility_id,
          order_text,
          prescriber_name,
          received_at,
          cosignature_due_at,
          cosignature_status,
          implemented,
          residents ( first_name, last_name )
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("received_at", { ascending: false })
        .limit(200);

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load verbal orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0 text-slate-500 hover:bg-transparent hover:text-slate-900 dark:hover:text-white")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-400 mb-2 block w-fit">
              Verbal Orders
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
            Verbal Orders Hub
          </h1>
          <p className="text-sm font-medium tracking-wide text-slate-600 dark:text-slate-400 mt-2">
            Co-signature tracking and implementation status.
          </p>
        </div>
        <div>
          <Link href="/admin/medications/verbal-orders/new" className={cn(buttonVariants(), "h-12 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 shadow-md text-white gap-2")}>
            <Plus className="h-4 w-4" />
            New Verbal Order
          </Link>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      ) : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] p-16 text-center backdrop-blur-3xl shadow-sm">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">No Verbal Orders</p>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 mt-1">There are no pending verbal orders for this facility.</p>
        </div>
      ) : (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] p-6 md:p-8 shadow-sm backdrop-blur-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
          
          <div className="hidden lg:grid grid-cols-[2fr_3fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Order Context</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Prescriber</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Received</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Co-Sign Due</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Status</div>
          </div>

          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {rows.map((r) => {
                const name = r.residents
                  ? [r.residents.first_name, r.residents.last_name].filter(Boolean).join(" ")
                  : "—";
                const due = new Date(r.cosignature_due_at);
                const now = Date.now();
                const hoursLeft = (due.getTime() - now) / 36e5;
                let urgency: "ok" | "warn" | "bad" = "ok";
                if (r.cosignature_status === "expired") urgency = "bad";
                else if (hoursLeft <= 24) urgency = "warn";

                return (
                  <MotionItem key={r.id}>
                    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr_1fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                      
                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Resident</span>
                        <span className="font-semibold text-lg text-slate-900 dark:text-white tracking-tight">{name}</span>
                      </div>

                      <div className="flex flex-col min-w-0 pr-4">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Order Context</span>
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 truncate" title={r.order_text}>
                          {r.order_text}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Prescriber</span>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-300">{r.prescriber_name}</span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Received</span>
                        <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                          {formatDistanceToNow(new Date(r.received_at), { addSuffix: true })}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Co-Sign Due</span>
                        {r.cosignature_status === "pending" || r.cosignature_status === "expired" ? (
                          <span
                            className={cn(
                              "text-[11px] font-mono font-bold tracking-widest uppercase px-2 py-0.5 rounded border block w-fit",
                              urgency === "bad"
                                ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                                : urgency === "warn"
                                  ? "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                                  : "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                            )}
                          >
                            {due.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-400">—</span>
                        )}
                      </div>

                      <div className="flex flex-col lg:items-end justify-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Status</span>
                        <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                          <Badge variant="outline" className={cn("px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm",
                                r.cosignature_status === "expired" && "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
                                r.cosignature_status === "pending" && "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
                                r.cosignature_status === "signed" && "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                          )}>
                            {r.cosignature_status}
                          </Badge>
                          {r.implemented && (
                            <Badge variant="secondary" className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-400">
                              Implemented
                            </Badge>
                          )}
                        </div>
                      </div>

                    </div>
                  </MotionItem>
                );
              })}
            </MotionList>
          </div>
        </div>
      )}
    </div>
  );
}
